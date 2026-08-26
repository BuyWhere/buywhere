import { Router, Request, Response } from 'express';
import { createHash } from 'crypto';
import { PoolClient } from 'pg';
import { db, redis, vectorDb } from '../config';
import { readDb, ReplicaUnavailableError, servingReadDbConnect } from '../lib/readReplica';
import { requireApiKey, checkRateLimit, hashKey } from '../middleware/apiKey';
import { agentDetectMiddleware } from '../middleware/agentDetect';
import { trackProductSearch, trackProductView } from '../analytics/posthog';
import { queryLogMiddleware } from '../middleware/queryLog';
import { buildProduct, buildSearchResponse, COUNTRY_CURRENCY } from '../lib/response';
import { buildCompareProductsQuery, UUID_RE, PRODUCT_ID_RE } from '../lib/compare-query';
import { preprocessSearchQuery } from '../lib/queryPreprocessor';
import { recordProductView, recordProductViewsBulk } from '../lib/instrumentation';
import { embedQuery } from '../jobs/embedProducts';

// BUY-31302: 1-hour TTL (was 120s). Reduces cold-miss frequency from every 2min to every 1hr.
// Combined with startup warm-up, cold cache drops to <1s for all seeded queries.
import { normalizeQuery, semanticLookup, semanticRegister, semanticEnabled } from '../lib/semanticCache';

const SEARCH_CACHE_TTL_SECONDS = 3600;
const AMAZON_STALENESS_DAYS = 60;
const AMAZON_STALE_RANK_MULTIPLIER = 0.35;
const AMAZON_TARGETED_RANK_BOOST = 1.15;
const AMAZON_TRUST_CATEGORIES = ['electronics', 'home-living'];
const AMAZON_TRUST_MIN_PRICE = 10;
const AMAZON_TRUST_MAX_PRICE = 200;
// BUY-74173 (ops evidence 2026-08-24): Keepa-fresh amazon_us rows now ship
// metadata->>'monthly_sold' (Amazon sales velocity, integers up to ~6 figures).
// The Owala FreeSip wake showed these rows at positions 7-10 on a matching query
// even though their prices beat stale junk-priced Google Shopping hits at 3-4.
// Log-scale velocity boost (1+ln(1+ms)/ln(50), capped at 5.0) so that:
//   monthly_sold=10     -> 1.61x   |   1000 -> 2.77x
//   monthly_sold=100    -> 2.18x   |  10000 -> 3.36x
//   monthly_sold=20000  -> 3.53x
// Tier (search_products) does NOT yet carry metadata; amazonRankMultiplierSql
// callers that pass a tier alias (sp/cand) omit this term. Archive callers
// (rhp/rcp/products) compute it from JSONB. Multiplicative with staleness + trust.
const AMAZON_VELOCITY_LOG_BASE = 50; // ln(1+ms)/ln(50) gives the curve above
const AMAZON_VELOCITY_MAX = 5.0;     // cap so a single row can't dominate

function amazonVelocityMultiplierSql(alias: string): string {
  return `
    CASE
      WHEN lower(${alias}.source) LIKE '%amazon%'
        AND (${alias}.metadata->>'monthly_sold') ~ '^[0-9]+(\\.[0-9]+)?$'
      THEN LEAST(
        ${AMAZON_VELOCITY_MAX},
        1.0 + ln(1 + (${alias}.metadata->>'monthly_sold')::numeric) / ln(${AMAZON_VELOCITY_LOG_BASE})
      )
      ELSE 1.0
    END`;
}

function amazonRankMultiplierSql(alias: string, includeVelocity: boolean): string {
  const velocity = includeVelocity ? ` * (${amazonVelocityMultiplierSql(alias)})` : '';
  return `
    (
      CASE
        WHEN lower(${alias}.source) LIKE '%amazon%' AND ${alias}.updated_at < NOW() - INTERVAL '${AMAZON_STALENESS_DAYS} days'
        THEN ${AMAZON_STALE_RANK_MULTIPLIER}
        ELSE 1.0
      END *
      CASE
        WHEN lower(${alias}.source) LIKE '%amazon%'
          AND ${alias}.price BETWEEN ${AMAZON_TRUST_MIN_PRICE} AND ${AMAZON_TRUST_MAX_PRICE}
          AND lower(regexp_replace(coalesce(${alias}.category,''),'\\s+','-','g')) IN (${AMAZON_TRUST_CATEGORIES.map((category) => `'${category}'`).join(', ')})
        THEN ${AMAZON_TARGETED_RANK_BOOST}
        ELSE 1.0
      END
    )${velocity}`;
}

// BUY-41572: bumped from 5s → 15s as a temporary measure so the 50-query hybrid
// eval (BUY-41140) can complete against the live DB. Roundhouse EXPLAIN happy
// path is still ~15-75ms; the 5s ceiling was below the latency budget the API
// advertises and produced 504 upstream_timeout on every search. Mirrors the
// BUY-33985 deals endpoint fix at 15s.
const SEARCH_STATEMENT_TIMEOUT_MS = 15000;
const SEARCH_HANDLER_TIMEOUT_MS = 15000;

// BUY-52082: public /v1/products/search now consumes keyword|semantic|hybrid
// using the same Jina + pgvector stack as the MCP tool. If vector infra is
// unavailable, semantic/hybrid requests fall back to the keyword path.
const VALID_SEARCH_MODES = new Set(['keyword', 'semantic', 'hybrid']);
const DEFAULT_SEARCH_MODE = 'keyword';
const VECTOR_CANDIDATE_CAP = 1000;
const HYBRID_RRF_K = 60;

// BUY-34291: cap per-query work_mem to 4MB (down from 64MB default) so concurrent
// search requests don't compete for shared_buffers. Without this, the planner's
// Bitmap Heap Scan on the partial GIN index uses up to 64MB per query, and
// with 50-slot pool × 64MB = 3.2GB potential — exceeds the 2GB shared_buffers.
// Observed production symptom: queries that plan in 29ms in isolation take 10s+
// under concurrent load with PostgreSQL errors
// `could not resize shared memory segment... No space left on device` (SQLSTATE 53200).
// 4MB is enough for the 200-row top-N sort + Nested Loop pkey lookups.
const SEARCH_WORK_MEM = '4MB';

// Express 4 doesn't catch async rejections — unhandled errors crash the process.
// This wrapper ensures all async route handlers return 500 instead of crashing.
function asyncHandler(fn: (req: Request, res: Response) => Promise<unknown>) {
  return (req: Request, res: Response) => {
    fn(req, res).catch((err) => {
      console.error(`[products] unhandled error on ${req.method} ${req.path}:`, err?.message || err);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Internal server error' });
      }
    });
  };
}

function shiftSqlPlaceholders(sql: string, offset: number): string {
  return sql.replace(/\$(\d+)/g, (_, idx) => `$${Number(idx) + offset}`);
}

async function getCachedQueryEmbedding(query: string, geminiKey: string): Promise<string | null> {
  try {
    const embedKey = `qembed:${Buffer.from(query).toString('base64').slice(0, 48)}`;
    const cached = await redis.get(embedKey).catch(() => null);
    if (cached) return cached;
    // BUY-52466: switched from Jina to Google gemini-embedding-001 (512-dim).
    const vector = await embedQuery(query, geminiKey);
    await redis.set(embedKey, vector, 'EX', 60).catch(() => {});
    return vector;
  } catch (err) {
    console.warn('[products.search] embed query failed, falling back to keyword:', (err as Error).message);
    return null;
  }
}

function mergeRrfCandidateIds(ftsIds: string[], semanticIds: string[], limit: number): string[] {
  const ftsRank = new Map(ftsIds.map((id, idx) => [id, idx + 1]));
  const semanticRank = new Map(semanticIds.map((id, idx) => [id, idx + 1]));
  const allIds = new Set([...ftsIds, ...semanticIds]);

  return [...allIds]
    .map((id) => ({
      id,
      score: 1 / (HYBRID_RRF_K + (ftsRank.get(id) ?? VECTOR_CANDIDATE_CAP + 1)) +
        1 / (HYBRID_RRF_K + (semanticRank.get(id) ?? VECTOR_CANDIDATE_CAP + 1)),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((entry) => entry.id);
}

const router = Router();

// GET /v1/products
// List products with pagination + filter + sort (API v1 contract).
// Query params: page (default 1), limit (default 20, max 100),
//               category (slug, matches category_path[1] case-insensitively),
//               sort (price|name|created_at), order (asc|desc),
//               country_code (default SG), currency
// Response: { data: Product[], pagination: { page, limit, total, total_pages } }
const LIST_SORT_COLUMNS: Record<string, string> = {
  price: 'price',
  name: 'title',
  created_at: 'created_at',
};
const LIST_SORT_TTL_SECONDS = 60;

router.get(
  '/',
  agentDetectMiddleware,
  requireApiKey,
  checkRateLimit,
  queryLogMiddleware('products.list'),
  asyncHandler(async (req: Request, res: Response) => {
    const requestStart = Date.now();

    // Pagination — contract defaults: page=1, limit=20, max 100
    const rawPage = parseInt((req.query.page as string) || '1');
    const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1;
    const rawLimit = parseInt((req.query.limit as string) || '20');
    const limit = Math.min(Math.max(1, Number.isFinite(rawLimit) ? rawLimit : 20), 100);
    const offset = (page - 1) * limit;

    // Filters — country defaults to SG to prevent cross-region pollution (BUY-6598)
    const category = req.query.category as string | undefined;
    const countryCode = (req.query.country_code as string | undefined)?.toUpperCase() || 'SG';
    const currency = (req.query.currency as string) || (COUNTRY_CURRENCY[countryCode] || 'SGD');

    // Sort — whitelist to safe columns, default to created_at desc
    const sortParam = (req.query.sort as string) || 'created_at';
    const sortColumn = LIST_SORT_COLUMNS[sortParam] || 'created_at';
    const orderParam = (req.query.order as string)?.toLowerCase();
    const order = orderParam === 'asc' ? 'ASC' : 'DESC';

    const cacheKey = `list:${currency}:${countryCode}:${category || ''}:${sortColumn}:${order}:${page}:${limit}`;
    try {
      const cached = await redis.get(cacheKey);
      if (cached) {
        const parsed = JSON.parse(cached);
        parsed.pagination.response_time_ms = Date.now() - requestStart;
        res.set('Cache-Control', 'public, max-age=30, s-maxage=30');
        res.set('X-Cache', 'HIT');
        return res.json(parsed);
      }
    } catch (_) {
      // Redis miss or error — fall through to DB
    }

    const conditions: string[] = ['currency = $1', 'is_active = true'];
    const params: unknown[] = [currency];
    let idx = 2;

    if (countryCode) {
      conditions.push(`country_code = $${idx}`);
      params.push(countryCode);
      idx++;
    }
    if (category) {
      // Treat the contract's `category` param as a slug — match category_path[1]
      // case-insensitively so "electronics" and "Electronics" both work.
      conditions.push(`LOWER(category_path[1]) = LOWER($${idx})`);
      params.push(category);
      idx++;
    }

    const whereClause = `WHERE ${conditions.join(' AND ')}`;

    const SELECT_COLUMNS = `products.id, products.sku AS source_id, products.source AS domain, products.url,
                NULL::text AS affiliate_url,
                products.title, products.price, products.currency, products.image_url, products.metadata, products.updated_at,
                products.url_last_checked_at, products.url_status,
                products.region, products.country_code, products.created_at, products.description, products.brand, products.mpn, products.gtin,
                products.category_path, products.category, products.merchant_id, products.avg_rating, products.review_count`;

    // Use id DESC — primary key index is the only valid index on this table (created_at/is_active
    // indexes are invalid due to interrupted CONCURRENTLY builds; BUY-39987 tracks the rebuild).
    // Sort param is honoured for id-tied pages but the primary sort is always id DESC.
    const orderBy = `ORDER BY products.id DESC`;

    const [countResult, dataResult] = await Promise.all([
      // Fast statistical estimate — avoids a full 65M-row COUNT seq scan. The returned value
      // is approximate (pg_class.reltuples is updated by VACUUM/ANALYZE) but accurate enough
      // for pagination totals. Exact counts would hit the 30s statement_timeout.
      db.query(`SELECT reltuples::bigint AS count FROM pg_class WHERE relname = 'products'`),
      db.query(
        `SELECT ${SELECT_COLUMNS}
         FROM products
         ${whereClause}
         ${orderBy}
         LIMIT $${idx} OFFSET $${idx + 1}`,
        [...params, limit, offset]
      ),
    ]);

    const total = parseInt(countResult.rows[0].count, 10);
    const total_pages = total === 0 ? 0 : Math.ceil(total / limit);
    const data = dataResult.rows.map((row) =>
      buildProduct(row as Record<string, unknown>, currency, false)
    );

    // BUY-52474: log a product_view per rendered result card so `product_views`
    // grows from real /v1 list traffic. Fire-and-forget; idempotency is
    // enforced in the helper.
    recordProductViewsBulk({
      productIds: data.map((p) => p.id),
      source: 'products.list',
      req,
    });

    const body = {
      data,
      pagination: {
        page,
        limit,
        total,
        total_pages,
        response_time_ms: Date.now() - requestStart,
      },
    };

    redis.set(cacheKey, JSON.stringify(body), 'EX', LIST_SORT_TTL_SECONDS).catch(() => {});
    res.json(body);
  })
);

// GET /v1/products/search
// Query params: q, domain, region, country, category, category_id, category_path,
//               brand, merchant_id, availability, min_price, max_price,
//               currency, limit, offset, page, fields, sort, sort_by, source_page, compact
router.get(
  '/search',
  agentDetectMiddleware,
  requireApiKey,
  checkRateLimit,
  queryLogMiddleware('products.search'),
  asyncHandler(async (req: Request, res: Response) => {
    // BUY-33987: hard ceiling on the entire request. Even if the per-statement
    // `SET LOCAL statement_timeout` races with the pool's on-connect
    // `SET statement_timeout = 30000`, the response will fire at 5s and the
    // socket will close. Mirrors the BUY-33985 deals fix.
    res.setTimeout(SEARCH_HANDLER_TIMEOUT_MS, () => {
      if (!res.headersSent) {
        res.status(504).json({ error: 'upstream_timeout', timeout_ms: SEARCH_HANDLER_TIMEOUT_MS });
      }
    });
    const requestStart = Date.now();
    const rawQuery = (req.query.q as string) || '';
    const domain = req.query.domain as string | undefined;
    const region = req.query.region as string | undefined;
    const category = req.query.category as string | undefined;
    const categoryId = req.query.category_id as string | undefined;
    const categoryPath = (req.query.category_path as string) ? (req.query.category_path as string).split(',').map(p => p.trim()).filter(Boolean) : undefined;
    const brand = req.query.brand as string | undefined;
    const merchantId = req.query.merchant_id as string | undefined;
    const availability = req.query.availability as string | undefined;
    const rawFields = (req.query.fields as string) || undefined;
    const fields = rawFields ? rawFields.split(',').map(f => f.trim()).filter(Boolean) : undefined;
    const sort = ((req.query.sort || req.query.sort_by) as string) || undefined;
    // BUY-67275 (#29, 2026-08-14): parity with api/ — see that tree for rationale.
    const sortRequested = !!(sort && ['price_asc', 'price_desc', 'newest', 'highest_rated', 'most_reviewed'].includes(sort));
    // country_code is the canonical param; `country` is kept as a backward-compat alias.
    // Default to SG when neither country nor region is specified (BUY-6598: prevent cross-region accessory pollution).
    const explicitCountry = ((req.query.country_code as string | undefined) || (req.query.country as string | undefined))?.toUpperCase() || undefined;
    const countryCode = explicitCountry || (region ? undefined : 'SG');
    let minPrice = req.query.min_price ? parseFloat(req.query.min_price as string) : undefined;
    let maxPrice = req.query.max_price ? parseFloat(req.query.max_price as string) : undefined;
    // Infer default currency from country_code when not explicitly provided.
    // Price filters (min_price/max_price) apply in this inferred currency.
    const currency = (req.query.currency as string) || (countryCode ? (COUNTRY_CURRENCY[countryCode] || 'SGD') : 'SGD');
    const limit = Math.min(parseInt((req.query.limit as string) || '20'), 100);
    const rawPage = parseInt((req.query.page as string) || '0');
    const rawOffset = parseInt((req.query.offset as string) || '0');
    const offset = rawPage > 0 ? (rawPage - 1) * limit : rawOffset;
    const sourcePage = req.query.source_page as string | undefined;
    const compact = req.query.compact === 'true';
    const rawMode = (req.query.mode as string | undefined)?.toLowerCase();
    // BUY-67275 (#29): explicit sort forces keyword — hybrid rerank overrides ORDER BY.
    const searchMode = sortRequested ? 'keyword' : (rawMode && VALID_SEARCH_MODES.has(rawMode) ? rawMode : DEFAULT_SEARCH_MODE);

    // BUY-42589: canonicalize SG retailer brand names (harvey norman, courts, gaincity, etc.)
    // to source= filters. The retailer name is in the source field, not in product titles,
    // so FTS alone returns near-zero matches even when 10k+ products exist.
    const { cleanedQuery, canonicalSources, extractedMinPrice, extractedMaxPrice } = preprocessSearchQuery(rawQuery, minPrice, maxPrice);
    if (minPrice === undefined && extractedMinPrice !== undefined) minPrice = extractedMinPrice;
    if (maxPrice === undefined && extractedMaxPrice !== undefined) maxPrice = extractedMaxPrice;
    const q = cleanedQuery || rawQuery;

    // Check Redis cache for this exact query (60s TTL)
    const cacheKey = `fts:${q}:${domain || ''}:${region || ''}:${countryCode || ''}:${category || ''}:${categoryId || ''}:${categoryPath?.join(',') || ''}:${brand || ''}:${merchantId || ''}:${availability || ''}:${currency}:${minPrice ?? ''}:${maxPrice ?? ''}:${limit}:${offset}:${sort || ''}:${fields?.join(',') || ''}:${compact ? 'c' : 'f'}:${searchMode}`;
    try {
      const cached = await redis.get(cacheKey);
      if (cached) {
        const parsed = JSON.parse(cached);
        const elapsed = Date.now() - requestStart;
        parsed.cached = true;
        parsed.response_time_ms = elapsed;
        res.set('Cache-Control', 'public, max-age=30, s-maxage=30');
        res.set('X-Cache', 'HIT');
        return res.json(parsed);
      }
    } catch (_) {
      // Redis miss or error — fall through to DB
    }

    // Semantic cache (2026-08-06): reuse cached responses for normalized-equal or
    // embedding-similar queries within the same (country, filters) scope.
    const semScope = `m1:${countryCode || ''}:${domain || ''}:${region || ''}:${category || ''}:${categoryId || ''}:${brand || ''}:${merchantId || ''}:${availability || ''}:${currency}:${minPrice ?? ''}:${maxPrice ?? ''}:${limit}:${offset}:${sort || ''}:${compact ? 'c' : 'f'}:${searchMode}`;
    const semQNorm = q ? normalizeQuery(q) : '';
    let semVec: string | null = null;
    if (semanticEnabled() && semQNorm && offset === 0) {
      try {
        const gk = process.env.GEMINI_API_KEY ?? '';
        if (gk) semVec = await getCachedQueryEmbedding(q, gk);
        const semHit = await semanticLookup(redis, semScope, semQNorm, semVec);
        if (semHit) {
          const parsed = JSON.parse(semHit.body);
          parsed.cached = true;
          parsed.semantic_cache = true;
          parsed.response_time_ms = Date.now() - requestStart;
          res.set('Cache-Control', 'public, max-age=30, s-maxage=30');
          res.set('X-Cache', 'HIT-SEMANTIC');
          return res.json(parsed);
        }
      } catch (_) { /* fall through to DB */ }
    }

    // BUY-33987: only active products are surfaced to API consumers; the partial
    // GIN index `products_*_search_vector_idx WHERE is_active = true` lets the
    // planner skip dead rows and the inactive non-leaf rows that previously
    // bloated the bitmap. EXPLAIN ANALYZE on roundhouse (post-fix) shows the
    // planner switches to the partial index and execution drops to ~15-30ms.
    const baseConditions: string[] = ['currency = $1', 'is_active = true'];
    const baseParams: unknown[] = [currency];
    let baseIdx = 2;

    // BUY-42589: SG retailer brand queries (harvey norman, courts, gaincity, etc.)
    // map to source= filters since the retailer name is in the source field, not
    // in individual product titles/brands. When only the retailer name was typed
    // (cleanedQuery is empty), fall back to source-only search.
    if (canonicalSources && canonicalSources.length > 0) {
      const sourcePlaceholders = canonicalSources.map((_, i) => `$${baseIdx + i}`).join(',');
      baseConditions.push(`source IN (${sourcePlaceholders})`);
      baseParams.push(...canonicalSources);
      baseIdx += canonicalSources.length;
    }

    if (domain) {
      baseConditions.push(`source = $${baseIdx}`);
      baseParams.push(domain);
      baseIdx++;
    }
    if (region) {
      baseConditions.push(`region = $${baseIdx}`);
      baseParams.push(region);
      baseIdx++;
    }
    if (countryCode) {
      baseConditions.push(`country_code = $${baseIdx}`);
      baseParams.push(countryCode);
      baseIdx++;
    }
    if (category) {
      baseConditions.push(`category ILIKE $${baseIdx}`);
      baseParams.push(`%${category}%`);
      baseIdx++;
    }
    if (brand) {
      baseConditions.push(`brand ILIKE $${baseIdx}`);
      baseParams.push(`%${brand}%`);
      baseIdx++;
    }
    if (availability) {
      const avail = availability.toLowerCase();
      if (avail === 'in_stock') {
        baseConditions.push(`(metadata->>'availability' = $${baseIdx} OR (metadata->>'availability' IS NULL AND is_active = true))`);
        baseParams.push(avail);
        baseIdx++;
      } else if (avail === 'out_of_stock') {
        baseConditions.push(`(metadata->>'availability' = $${baseIdx} OR (metadata->>'availability' IS NULL AND is_active = false))`);
        baseParams.push(avail);
        baseIdx++;
      } else if (avail === 'preorder' || avail === 'discontinued') {
        baseConditions.push(`metadata->>'availability' = $${baseIdx}`);
        baseParams.push(avail);
        baseIdx++;
      }
    }
    if (categoryId) {
      baseConditions.push(`category_id = $${baseIdx}`);
      baseParams.push(categoryId);
      baseIdx++;
    }
    if (categoryPath && categoryPath.length > 0) {
      const pathPlaceholders = categoryPath.map((_, i) => `$${baseIdx + i}`).join(',');
      baseConditions.push(`category_path @> ARRAY[${pathPlaceholders}]::text[]`);
      baseParams.push(...categoryPath);
      baseIdx += categoryPath.length;
    }
    if (merchantId) {
      baseConditions.push(`merchant_id = $${baseIdx}`);
      baseParams.push(merchantId);
      baseIdx++;
    }
    if (minPrice !== undefined) {
      baseConditions.push(`price >= $${baseIdx}`);
      baseParams.push(minPrice);
      baseIdx++;
    }
    if (maxPrice !== undefined) {
      baseConditions.push(`price <= $${baseIdx}`);
      baseParams.push(maxPrice);
      baseIdx++;
    }

    const searchConditions = [...baseConditions];
    const searchParams = [...baseParams];
    let ftsParamIdx = 0;
    if (q) {
      // Use full-text search via GIN-indexed search_vector only.
      // The ILIKE fallback was removed: it defeats the GIN index and causes full table scans (3s vs 130ms).
      ftsParamIdx = searchParams.length + 1;
      searchConditions.push(`search_vector @@ plainto_tsquery('english', $${ftsParamIdx})`);
      searchParams.push(q);
    }

    const whereClause = searchConditions.length ? `WHERE ${searchConditions.join(' AND ')}` : '';

    // BUY-33987: SEARCH_STATEMENT_TIMEOUT_MS and SEARCH_HANDLER_TIMEOUT_MS are
    // declared at the top of the file so res.setTimeout() (above) can reference
    // them by lexical scope.

    // Top-N candidates ranked by ts_rank before joining full rows.
    const CANDIDATE_CAP = 200;
    // BUY-67275 (#29): bounded slice for explicit-sort queries — big enough that
    // "cheapest X" sorts a meaningful pool, small enough that the GIN bitmap
    // fetch early-stops well inside the statement timeout.
    const SORT_CANDIDATE_CAP = 1000;

    const specColumns = `created_at, description, brand, mpn, gtin, category_path, category, merchant_id, avg_rating, review_count`;
    const specColumnsJoined = `products.created_at, products.description, products.brand, products.mpn, products.gtin, products.category_path, products.category, products.merchant_id, products.avg_rating, products.review_count`;
    const joinedColumns = `products.id, products.sku AS source_id, products.source AS domain, products.url,
               al.destination_url AS affiliate_url,
               products.title, products.price, products.currency, products.image_url, products.metadata, products.updated_at,
               products.url_last_checked_at, products.url_status,
               products.region, products.country_code, ${specColumnsJoined}`;

    const VALID_SORT = new Set(['relevance', 'price_asc', 'price_desc', 'newest', 'highest_rated', 'most_reviewed']);
    const effectiveSort = sort && VALID_SORT.has(sort) ? sort : undefined;
    const useFtsRanking = (!effectiveSort || effectiveSort === 'relevance') && ftsParamIdx;

    function buildSortOrder(): string {
      if (!effectiveSort || effectiveSort === 'relevance') return 'products.updated_at DESC';
      switch (effectiveSort) {
        case 'price_asc': return '(CASE WHEN products.price BETWEEN 5 AND 10000 THEN products.price END) ASC NULLS LAST, products.updated_at DESC'; // F25 re-applied 2026-08-22: agree with response sanitizer
        case 'price_desc': return '(CASE WHEN products.price BETWEEN 5 AND 10000 THEN products.price END) DESC NULLS LAST, products.updated_at DESC'; // F25 re-applied 2026-08-22
        case 'newest': return 'products.updated_at DESC';
        case 'highest_rated': return 'products.avg_rating DESC NULLS LAST, products.updated_at DESC';
        case 'most_reviewed': return 'products.review_count DESC NULLS LAST, products.updated_at DESC';
        default: return 'products.updated_at DESC';
      }
    }

    // BUY-31302: fix broken search from BUY-28677 (countParams/dataParams/buildDataQuery were
    // never defined, causing ReferenceError → 100% 500 rate).
    // Use LIMIT-pushdown CTE: rank top CANDIDATE_CAP IDs via GIN index, join full rows for
    // only those. Eliminates the separate COUNT query that doubled DB load. Over-fetch by 1
    // to derive has_more without a second scan.
    let dataResult: { rows: Array<Record<string, unknown>> };
    let total = 0;
    let hasMore: boolean | undefined;

    const requestedRows = limit + 1;
    const limitParamIdx = searchParams.length + 1;
    const offsetParamIdx = searchParams.length + 2;
    const dataParams = [...searchParams, requestedRows, offset];

    let dataQuery: string;
    if (useFtsRanking) {
      // BUY-32228: kept ts_rank ORDER BY in the CTE. BUY-31540 replaced this with
      // `ORDER BY id DESC` + outer `ORDER BY products.updated_at DESC`, but on the
      // partitioned `products` table (products_sg / products_us / products_default,
      // 4.1M rows total) that combination forces the planner into a Merge Append
      // across ALL partitions sorted by updated_at before the top_ids filter runs.
      // Measured 2026-06-06 against prod DB: `laptop&country=US` 1447ms with
      // id DESC vs 41ms with ts_rank (1.4M row products_us, planner chooses
      // Bitmap Heap Scan → 200 pkey lookups via Nested Loop). Outer ORDER BY
      // top_ids.rank DESC is also used here (matches warmSearchCache CTE), so
      // relevance ranking survives. The 8s statement_timeout guard from
      // BUY-31228 stays in place as the safety net.
      dataQuery = `
        WITH top_ids AS (
          SELECT id, country_code,
                 ts_rank(search_vector, plainto_tsquery('english', $${ftsParamIdx})) *
                 ${amazonRankMultiplierSql('products', true)} AS rank
          FROM products
          ${whereClause}
          ORDER BY rank DESC
          LIMIT ${CANDIDATE_CAP}
        )
        SELECT ${joinedColumns}, top_ids.rank AS _fts_rank
        FROM top_ids
        JOIN products ON products.id = top_ids.id AND products.country_code = top_ids.country_code
        LEFT JOIN affiliate_links al ON al.product_id = products.id::text AND al.merchant_id = products.merchant_id
        ORDER BY top_ids.rank DESC
        LIMIT $${limitParamIdx} OFFSET $${offsetParamIdx}
      `;
    } else {
      // BUY-67275 (#29, 2026-08-14): bound sorted queries — ORDER BY over the full
      // FTS match set times out cold (see api/ tree for the full note).
      dataQuery = q ? `
        WITH sort_hits AS MATERIALIZED (
          SELECT id, country_code
          FROM products
          ${whereClause}
          LIMIT ${SORT_CANDIDATE_CAP}
        )
        SELECT ${joinedColumns}
        FROM sort_hits
        JOIN products ON products.id = sort_hits.id AND products.country_code = sort_hits.country_code
        LEFT JOIN affiliate_links al ON al.product_id = products.id::text AND al.merchant_id = products.merchant_id
        ORDER BY ${buildSortOrder()}
        LIMIT $${limitParamIdx} OFFSET $${offsetParamIdx}
      ` : `
        SELECT ${joinedColumns}
        FROM products
        LEFT JOIN affiliate_links al ON al.product_id = products.id::text AND al.merchant_id = products.merchant_id
        ${whereClause}
        ORDER BY ${buildSortOrder()}
        LIMIT $${limitParamIdx} OFFSET $${offsetParamIdx}
      `;
    }

    let client: PoolClient;
    try {
      client = await servingReadDbConnect();
    } catch (err) {
      if (err instanceof ReplicaUnavailableError) {
        res.status(503).json({
          error: 'search_replica_unavailable',
          message: err.message,
        });
        return;
      }
      throw err;
    }
    try {
      await client.query('BEGIN');
      // BUY-45671: cap per-query work_mem and disable *parallel* query under load.
      //
      // History: BUY-34291 set `enable_bitmapscan = off` to avoid the
      // `could not resize shared memory segment ... No space left on device`
      // (SQLSTATE 53200) error. But disabling bitmap scans entirely makes the
      // GIN `search_vector` partial index unusable (GIN is only reachable via a
      // bitmap scan), so the planner fell back to a `products_*_currency_idx`
      // btree scan + filter — a near-full scan of products_us (~860k rows).
      // Measured on prod 2026-06-13: `enable_bitmapscan=off` → 35,400ms (504s on
      // every search); `enable_bitmapscan=on` → 161-267ms via the GIN index.
      //
      // The 53200 error came from *parallel* bitmap heap scans: each parallel
      // worker allocates its bitmap in dynamic shared memory (/dev/shm). A
      // single-process bitmap heap scan uses work_mem only and never touches
      // that pool. So we keep bitmap scans on (index usable) but force the
      // search query to run non-parallel. The 53200 catch below stays as a
      // belt-and-suspenders 503 fallback.
      await client.query(`SET LOCAL work_mem = '${SEARCH_WORK_MEM}'`);
      await client.query(`SET LOCAL max_parallel_workers_per_gather = 0`);
      await client.query(`SET LOCAL statement_timeout = '${SEARCH_STATEMENT_TIMEOUT_MS}'`);
      const geminiKey = process.env.GEMINI_API_KEY ?? '';
      const activeVectorDb = q !== '' && searchMode !== 'keyword' && vectorDb != null && geminiKey !== ''
        ? vectorDb
        : null;

      if (activeVectorDb) {
        const queryVector = await getCachedQueryEmbedding(q, geminiKey);
        if (queryVector) {
          const candidateCap = Math.min(Math.max(requestedRows * 10, 200), VECTOR_CANDIDATE_CAP);
          const semanticCandidates = await activeVectorDb.query<{ product_id: string }>(
            `SELECT product_id FROM product_embeddings
             ORDER BY embedding <=> $1::vector
             LIMIT $2`,
            [queryVector, candidateCap]
          );

          const rawSemanticIds = semanticCandidates.rows.map((row) => row.product_id);
          let filteredSemanticIds: string[] = [];
          if (rawSemanticIds.length > 0) {
            const vectorFilterQuery = `
              SELECT id
              FROM products
              WHERE id = ANY($1::bigint[]) AND ${baseConditions.map((condition) => shiftSqlPlaceholders(condition, 1)).join(' AND ')}
            `;
            const vectorFilterResult = await client.query<{ id: string }>(
              vectorFilterQuery,
              [rawSemanticIds, ...baseParams]
            );
            const allowedIds = new Set(vectorFilterResult.rows.map((row) => row.id));
            filteredSemanticIds = rawSemanticIds.filter((id) => allowedIds.has(id));
          }

          let rankedCandidateIds = filteredSemanticIds;
          if (searchMode === 'hybrid') {
            const ftsCandidates = await client.query<{ id: string }>(
              `SELECT id
               FROM products
               ${whereClause}
               ORDER BY (ts_rank(search_vector, plainto_tsquery('english', $${ftsParamIdx})) * ${amazonRankMultiplierSql('products', true)}) DESC
               LIMIT 200`,
              searchParams
            );
            rankedCandidateIds = mergeRrfCandidateIds(
              ftsCandidates.rows.map((row) => row.id),
              filteredSemanticIds,
              candidateCap
            );
          }

          total = rankedCandidateIds.length;
          hasMore = total > offset + limit;

          if (total === 0) {
            dataResult = { rows: [] };
          } else if (!effectiveSort || effectiveSort === 'relevance') {
            const pageIds = rankedCandidateIds.slice(offset, offset + requestedRows);
            const detailResult = await client.query(
              `SELECT ${joinedColumns}
               FROM products
               LEFT JOIN affiliate_links al ON al.product_id = products.id::text AND al.merchant_id = products.merchant_id
               WHERE products.id = ANY($1::bigint[])`,
              [pageIds]
            );
            const byId = new Map(detailResult.rows.map((row) => [(row as Record<string, unknown>).id as string, row]));
            dataResult = {
              rows: pageIds.map((id) => byId.get(id)).filter(Boolean) as Array<Record<string, unknown>>,
            };
          } else {
            dataResult = await client.query(
              `SELECT ${joinedColumns}
               FROM products
               LEFT JOIN affiliate_links al ON al.product_id = products.id::text AND al.merchant_id = products.merchant_id
               WHERE products.id = ANY($1::bigint[])
               ORDER BY ${buildSortOrder()}
               LIMIT $2 OFFSET $3`,
              [rankedCandidateIds, requestedRows, offset]
            );
          }
        } else {
          dataResult = await client.query(dataQuery, dataParams);
        }
      } else {
        dataResult = await client.query(dataQuery, dataParams);
      }
      await client.query('COMMIT');
    } catch (err: unknown) {
      await client.query('ROLLBACK').catch(() => {});
      const pgErr = err as { code?: string };
      if (pgErr.code === '57014') {
        client.release();
        res.status(503).json({ error: 'Search query timed out', timeout_ms: SEARCH_STATEMENT_TIMEOUT_MS });
        return;
      }
      // BUY-34291: shared_buffers exhaustion (SQLSTATE 53200) under load — return
      // 503 with retry hint instead of crashing. The query was correct; the DB
      // is just under memory pressure. Client should retry.
      if (pgErr.code === '53200' || (typeof (err as Error)?.message === 'string' && (err as Error).message.includes('No space left on device'))) {
        client.release();
        res.status(503).json({ error: 'Search temporarily unavailable', reason: 'db_memory_pressure', retry_after_ms: 1000 });
        return;
      }
      client.release();
      throw err;
    }
    client.release();

    if (typeof hasMore === 'undefined') {
      hasMore = dataResult.rows.length > limit;
      if (hasMore) dataResult.rows.pop();
      total = offset + dataResult.rows.length + (hasMore ? 1 : 0);
    } else if (dataResult.rows.length > limit) {
      dataResult.rows = dataResult.rows.slice(0, limit);
    }

    const responseTimeMs = Date.now() - requestStart;

    const products = dataResult.rows.map((row) =>
      buildProduct(row as Record<string, unknown>, currency, compact)
    );

    // Apply field selection if `fields` param is specified
    let filteredProducts = products;
    if (fields && fields.length > 0) {
      const VALID_FIELDS = new Set([
        'id', 'name', 'price', 'url', 'merchant', 'category', 'country',
        'ingested_at', 'updated_at', 'description', 'image_url', 'images',
        'brand', 'sku', 'mpn', 'gtin', 'availability', 'compare_at_price',
        'rating', 'title', 'country_code', 'region',
        'canonical_id', 'normalized_price_usd', 'structured_specs',
        'comparison_attributes', 'metadata', 'original_price', 'discount_pct',
        // BUY-75368: A2 weekly report fields.
        'url_last_checked_at', 'url_status',
      ]);
      const requested = fields.filter(f => VALID_FIELDS.has(f));
      if (requested.length > 0) {
        filteredProducts = products.map(p => {
          const picked: Record<string, unknown> = {};
          for (const f of requested) {
            if (f in (p as unknown as Record<string, unknown>)) {
              picked[f] = (p as unknown as Record<string, unknown>)[f];
            }
          }
          return picked as unknown as typeof p;
        });
      }
    }

    const responseBody = buildSearchResponse(
      filteredProducts, total, limit, offset, responseTimeMs, false, hasMore ?? false
    );

    // Cache result in Redis (fire-and-forget)
    redis.set(cacheKey, JSON.stringify(responseBody), 'EX', SEARCH_CACHE_TTL_SECONDS).catch(() => {});
    if (semanticEnabled() && semQNorm && offset === 0) {
      semanticRegister(redis, semScope, semQNorm, semVec, cacheKey).catch(() => {});
    }

    // Extract categories from results for analytics
    const categories = extractCategories(products);

    // BUY-31298: pass behavioral context to queryLogMiddleware via res.locals so the
    // single trackApiUsage call captures all fields (api_key_id, result_status, latency_ms
    // are always present on the middleware event — no duplicate legacy event needed).
    if (req.apiKeyRecord) {
      res.locals.queryIntent = inferQueryIntent(q, domain, minPrice, maxPrice);
      res.locals.productCategories = categories;
      res.locals.signupChannel = req.apiKeyRecord.signupChannel;
      res.locals.sourcePage = sourcePage || null;
      trackProductSearch({
        apiKey: hashKey(req.apiKeyRecord.key),
        apiKeyId: req.apiKeyRecord.id,
        queryText: q,
        resultCount: products.length,
        responseTimeMs,
      });
    }

    // BUY-52474: log a product_view per search-result card so the
    // `product_views` table grows from real /v1 search traffic. We use a
    // queryHash so dedup-keyed views from the same search query collapse
    // into a single row per (product, query, second). Fire-and-forget.
    recordProductViewsBulk({
      productIds: products.map((p) => p.id),
      source: 'products.search',
      queryHash: q ? createHash('sha256').update(q.toLowerCase()).digest('hex').slice(0, 32) : null,
      req,
    });

    res.json(responseBody);
  })
);

// GET /v1/products/deals
// Returns products on sale (original_price > price), sorted by discount %
// BUY-33985: dedicated client with 5s statement_timeout + 5s res.setTimeout
// so a slow fallback path (no discount_pct column) cannot hang the request
// past 5s and leak the connection.
// BUY-41572: bumped from 5s → 15s to match the search timeout bump and clear
// the deals_upstream_timeout on the same path that the search eval is hitting.
const DEALS_RESPONSE_TIMEOUT_MS = 15000;
router.get(
  '/deals',
  agentDetectMiddleware,
  requireApiKey,
  checkRateLimit,
  queryLogMiddleware('products.deals'),
  asyncHandler(async (req: Request, res: Response) => {
    const start = Date.now();
    const currency = (req.query.currency as string) || 'SGD';
    const countryCode = ((req.query.country_code as string | undefined) || (req.query.country as string | undefined))?.toUpperCase() || undefined;
    const minDiscount = parseFloat((req.query.min_discount as string) || '10');
    const limit = Math.min(parseInt((req.query.limit as string) || '20'), 100);
    const offset = parseInt((req.query.offset as string) || '0');

    const cacheKey = `deals:${currency}:${countryCode || ''}:${minDiscount}:${limit}:${offset}`;
    try {
      const cached = await redis.get(cacheKey);
      if (cached) {
        const parsed = JSON.parse(cached);
        parsed.cached = true;
        parsed.response_time_ms = Date.now() - start;
        return res.json(parsed);
      }
    } catch (_) {}

    // Express-side response timeout. Fires after DEALS_RESPONSE_TIMEOUT_MS
    // regardless of the DB state — guarantees the socket closes within 5s
    // so the client never sees a 30s+ hang.
    res.setTimeout(DEALS_RESPONSE_TIMEOUT_MS, () => {
      if (!res.headersSent) {
        try {
          res.status(504).json({ error: 'deals_upstream_timeout', message: 'Deals query exceeded server-side timeout' });
        } catch (_) {}
      }
    });

    // Deals: prefer discount_pct generated column (BUY-14332), fall back to inline
    // computation if the column doesn't exist yet (migration may not have run).
    const dealConditions: string[] = ['currency = $1', 'price > 0'];
    const dealParams: unknown[] = [currency];
    let dealIdx = 2;
    let useDiscountCol = true;

    // Probe whether discount_pct column exists as GENERATED (cached per-process)
    // BUY-22324: must verify is_generated = 'ALWAYS'; a plain column is 100% NULL
    // and produces wrong results (get_deals returns total: 0).
    if (typeof (router as any)._hasDiscountPct === 'undefined') {
      try {
        const probe = await db.query(
          `SELECT is_generated FROM information_schema.columns WHERE table_name = 'products' AND column_name = 'discount_pct' LIMIT 1`
        );
        (router as any)._hasDiscountPct = probe.rows.length > 0 && probe.rows[0].is_generated === 'ALWAYS';
      } catch {
        (router as any)._hasDiscountPct = true;
      }
    }
    useDiscountCol = (router as any)._hasDiscountPct;

    if (useDiscountCol) {
      dealConditions.push(`discount_pct IS NOT NULL`);
      dealConditions.push(`discount_pct >= $${dealIdx}`);
    } else {
      dealConditions.push(`(metadata->>'original_price')::numeric > price`);
      dealConditions.push(`((1 - price / NULLIF((metadata->>'original_price')::numeric, 0)) * 100) >= $${dealIdx}`);
    }
    dealParams.push(minDiscount);
    dealIdx++;

    if (countryCode) {
      dealConditions.push(`country_code = $${dealIdx}`);
      dealParams.push(countryCode);
      dealIdx++;
    }

    const dealWhere = dealConditions.join(' AND ');

    const discountSelect = useDiscountCol
      ? 'discount_pct'
      : `ROUND(((1 - price / NULLIF((metadata->>'original_price')::numeric, 0)) * 100)::numeric, 1) AS discount_pct`;
    const discountOrder = useDiscountCol
      ? 'discount_pct DESC'
      : `(1 - price / NULLIF((metadata->>'original_price')::numeric, 0)) DESC`;
    // BUY-69340 (#36): match the deals index order exactly — see api/ tree.
    const dealOrderBy = useDiscountCol
      ? discountOrder
      : `${discountOrder} NULLS LAST, updated_at DESC`;

    const COUNT_CAP = 1001;

    // Dedicated client with 5s statement_timeout. The pool's default is 30s
    // (config.ts PG_STATEMENT_TIMEOUT=30000) which is too generous for a
    // user-facing read endpoint and was the source of the BUY-33985 30s+ hang.
    // A 5s cap is well above the index-backed happy path (≈15ms) and well
    // below the previous 30s client-visible ceiling. release() always runs.
    // BUY-45692: deals is a heavy aggregate rollup — route to the read replica
    // when available (readDb() falls back to primary if unconfigured or lagging),
    // isolating it from interactive /v1/products/search on the primary.
    const dealsClient = await readDb().connect();
    let deals: ReturnType<typeof buildProduct>[] = [];
    let total = 0;
    try {
      // BUY-34291: cap work_mem too (same shared_buffers pressure reasoning as search)
      await dealsClient.query(`SET work_mem = '${SEARCH_WORK_MEM}'`);
      await dealsClient.query(`SET statement_timeout = ${DEALS_RESPONSE_TIMEOUT_MS}`);

      const countResult = await dealsClient.query(
        `SELECT COUNT(*) FROM (SELECT 1 FROM products WHERE ${dealWhere} LIMIT ${COUNT_CAP}) _sub`,
        dealParams
      );
      total = parseInt(countResult.rows[0].count, 10);

      const dataResult = await dealsClient.query(
        `SELECT id, sku AS source_id, source AS domain, url,
                title, price, (metadata->>'original_price')::numeric AS original_price,
                currency, image_url, metadata, updated_at,
                url_last_checked_at, url_status,
                region, country_code, created_at, description, brand, mpn, gtin,
                category_path, category, merchant_id, avg_rating, review_count,
                ${discountSelect}
         FROM products
         WHERE ${dealWhere}
         ORDER BY ${dealOrderBy}
         LIMIT $${dealIdx} OFFSET $${dealIdx + 1}`,
        [...dealParams, limit, offset]
      );
      deals = dataResult.rows.map((row) =>
        buildProduct(row as Record<string, unknown>, currency, false)
      );
    } finally {
      dealsClient.release();
    }

    const responseBody = buildSearchResponse(deals, total, limit, offset, Date.now() - start, false);
    // BUY-2026-08-13 (#36): cache empty deals for 60s only — a transient empty/timeout
    // window must not poison the 1h cache (fossilized-empty bug).
    redis.set(cacheKey, JSON.stringify(responseBody), 'EX', deals.length === 0 ? 60 : SEARCH_CACHE_TTL_SECONDS).catch(() => {});

    // BUY-52474: log a product_view per deals card so /v1/products/deals drives
    // product_views growth alongside /search and /:id.
    recordProductViewsBulk({
      productIds: deals.map((p) => p.id),
      source: 'products.deals',
      req,
    });

    res.json(responseBody);
  })
);

// GET /v1/products/compare?ids=id1,id2,id3
router.get(
  '/compare',
  agentDetectMiddleware,
  requireApiKey,
  checkRateLimit,
  queryLogMiddleware('products.compare'),
  asyncHandler(async (req: Request, res: Response) => {
    const start = Date.now();
    const ids = ((req.query.ids as string) || '').split(',').filter(Boolean).slice(0, 10);
    if (ids.length < 2) {
      res.status(400).json({ error: 'Provide at least 2 product IDs via ?ids=id1,id2' });
      return;
    }

    // BUY-53179: accept both UUID and numeric product IDs. The API's own
    // /v1/products/search returns numeric IDs like 1126150856089603981, so
    // UUID-only validation breaks the contract between search and compare.
    const invalidIds = ids.filter((id) => {
      const trimmed = id.trim();
      return !UUID_RE.test(trimmed) && !PRODUCT_ID_RE.test(trimmed);
    });
    if (invalidIds.length > 0) {
      res.status(400).json({ error: `Invalid product ID(s): ${invalidIds.join(', ')}` });
      return;
    }

    const { text, values } = buildCompareProductsQuery(ids);
    const result = await db.query(text, values);

    const products = result.rows.map((row) =>
      buildProduct(row as Record<string, unknown>, 'SGD', false)
    );

    const uniqueCurrencies = [...new Set(products.map((p) => p.price.currency).filter(Boolean))];
    const currenciesMixed = uniqueCurrencies.length > 1;

    const responseBody = buildSearchResponse(products, products.length, ids.length, 0, Date.now() - start, false);

    // BUY-52474: log a product_view per side-by-side product card so the
    // /v1/products/compare surface also drives product_views growth.
    recordProductViewsBulk({
      productIds: products.map((p) => p.id),
      source: 'products.compare',
      req,
    });

    res.json({
      ...responseBody,
      currencies_mixed: currenciesMixed,
      ...(currenciesMixed && {
        currency_warning: `Products span multiple currencies (${uniqueCurrencies.join(', ')}). Prices are not comparable across currencies — do not aggregate or rank by price in comparison_summary.`,
      }),
    });
  })
);

// GET /v1/products/:id/price-history — daily aggregated price history (BUY-2345)
// Query params: days (30|90|180, default 30)
router.get(
  '/:id/price-history',
  agentDetectMiddleware,
  requireApiKey,
  checkRateLimit,
  queryLogMiddleware('products.price-history'),
  asyncHandler(async (req: Request, res: Response) => {
    const start = Date.now();
    const { id } = req.params;
    const days = Math.min(parseInt((req.query.days as string) || '30'), 180);

    const [productResult, historyResult] = await Promise.all([
      db.query(`SELECT id, title, price, currency FROM products WHERE id = $1`, [id]),
      db.query(
        `SELECT
           DATE(recorded_at AT TIME ZONE 'UTC') AS day,
           currency,
           MIN(price)::float AS min_price,
           MAX(price)::float AS max_price,
           ROUND(AVG(price)::numeric, 2)::float AS avg_price,
           COUNT(*) AS data_points
         FROM price_history
         WHERE product_id = $1
           AND recorded_at >= NOW() - ($2 || ' days')::interval
         GROUP BY DATE(recorded_at AT TIME ZONE 'UTC'), currency
         ORDER BY day ASC`,
        [id, days]
      ),
    ]);

    if (productResult.rows.length === 0) {
      res.status(404).json({ error: 'Product not found' });
      return;
    }

    const p = productResult.rows[0];
    const daily = historyResult.rows.map((row) => ({
      day: row.day,
      currency: row.currency,
      min: row.min_price,
      max: row.max_price,
      avg: row.avg_price,
      data_points: parseInt(row.data_points, 10),
    }));

    const allPrices = daily.length
      ? { min: Math.min(...daily.map((d) => d.min)), max: Math.max(...daily.map((d) => d.max)), avg: +(daily.reduce((a, d) => a + d.avg, 0) / daily.length).toFixed(2) }
      : null;

    res.json({
      data: {
        product_id: p.id,
        title: p.title,
        current_price: p.price ? parseFloat(p.price) : null,
        currency: p.currency,
        daily,
        stats: allPrices,
      },
      meta: { days, response_time_ms: Date.now() - start },
    });
  })
);

// GET /v1/products/:id/prices — price history from price_snapshots
router.get(
  '/:id/prices',
  agentDetectMiddleware,
  requireApiKey,
  checkRateLimit,
  queryLogMiddleware('products.prices'),
  asyncHandler(async (req: Request, res: Response) => {
    const start = Date.now();
    const { id } = req.params;
    const days = Math.min(parseInt((req.query.days as string) || '30'), 90);

    const [productResult, historyResult] = await Promise.all([
      db.query(
        `SELECT id, title, price, currency FROM products WHERE id = $1`,
        [id]
      ),
      db.query(
        `SELECT price, currency, recorded_at AS scraped_at
         FROM price_history
         WHERE product_id = $1 AND recorded_at >= NOW() - ($2 || ' days')::interval
         ORDER BY recorded_at ASC`,
        [id, days]
      ),
    ]);

    if (productResult.rows.length === 0) {
      res.status(404).json({ error: 'Product not found' });
      return;
    }

    const p = productResult.rows[0];
    const history = historyResult.rows.map((row) => ({
      price: parseFloat(row.price),
      currency: row.currency,
      at: row.scraped_at,
    }));

    const prices = history.map((h) => h.price);
    res.json({
      data: {
        product_id: p.id,
        title: p.title,
        current_price: p.price ? parseFloat(p.price) : null,
        currency: p.currency,
        history,
        stats: prices.length
          ? { min: Math.min(...prices), max: Math.max(...prices), avg: +(prices.reduce((a, b) => a + b, 0) / prices.length).toFixed(2), data_points: prices.length }
          : null,
      },
      meta: { days, response_time_ms: Date.now() - start },
    });
  })
);

// GET /v1/products/:id/similar — BUY-41134 Find-Similar endpoint
// Primary: KNN on pre-computed embedding from embedding-store.product_embeddings.
// Fallback: same brand + category (B-tree index) if embedding not yet populated.
// Latency target: p95 ≤ 200 ms under load.
router.get(
  '/:id/similar',
  agentDetectMiddleware,
  requireApiKey,
  checkRateLimit,
  queryLogMiddleware('products.similar'),
  asyncHandler(async (req: Request, res: Response) => {
    const start = Date.now();
    // BUY-41137: hard ceiling so the request returns a deterministic response even
    // if a slow vectorDb KNN / fallback scan would otherwise hang. The hook sends a
    // degraded 504 (kept honest via meta) instead of leaving the client to its own
    // socket timeout. Mirrors the fix on the primary api service.
    let timedOut = false;
    res.setTimeout(SEARCH_HANDLER_TIMEOUT_MS, () => {
      timedOut = true;
      console.warn(`[products.similar] request timed out after ${SEARCH_HANDLER_TIMEOUT_MS}ms (id=${req.params.id})`);
      if (!res.headersSent) {
        res.status(504).json({ error: 'Find-Similar timed out', meta: { response_time_ms: Date.now() - start } });
      }
    });
    const { id } = req.params;
    const limit = Math.min(parseInt((req.query.limit as string) || '10'), 20);

    // Verify product exists in main DB
    const srcResult = await db.query(
      `SELECT id, title, brand, category_path, currency, country_code
       FROM products WHERE id = $1`,
      [id]
    );
    if (srcResult.rows.length === 0) {
      if (!timedOut && !res.headersSent) res.status(404).json({ error: 'Product not found' });
      return;
    }
    const src = srcResult.rows[0];

    // Phase 1: Try embedding-based KNN (vector store).
    // BUY-54718 / BUY-41137 / BUY-54796: use the shared vectorDb pool and the
    // product_embeddings table (public schema via vectorDb connection).
    let similar: Array<Record<string, unknown>> = [];
    let similarityFallback = false;

    if (vectorDb) {
      try {
        // Fetch pre-computed embedding for this product.
        const embResult = await vectorDb.query<{ embedding: string }>(
          `SELECT embedding FROM product_embeddings
           WHERE product_id = $1`,
          [id]
        );
        if (embResult.rows.length > 0) {
          const embeddingStr: string = embResult.rows[0].embedding;
          // KNN: rows with smallest cosine distance first.
          const knnResult = await vectorDb.query<{
            product_id: string;
            score: string;
          }>(
            `SELECT product_id,
                    1 - (embedding <=> $1::vector) AS score
             FROM product_embeddings
             WHERE product_id != $2
             ORDER BY embedding <=> $1::vector
             LIMIT $3`,
            [embeddingStr, id, limit]
          );
          const knnIds = knnResult.rows.map((r) => String(r.product_id));
          const knnScores = new Map(knnResult.rows.map((r) => [String(r.product_id), parseFloat(r.score)]));

          if (knnIds.length > 0) {
            // Fetch full product details from main DB.
            const placeholders = knnIds.map((_, i) => `$${i + 1}`).join(',');
            const detailResult = await db.query(
              `SELECT id, sku AS source_id, source AS domain, url, title, price, currency,
                      image_url, brand, category_path, region, country_code
               FROM products
               WHERE id IN (${placeholders})`,
              knnIds
            );
            const detailById = new Map(
              detailResult.rows.map((row) => [String(row.id), row] as const)
            );
            similar = knnIds.flatMap((knnId) => {
              const row = detailById.get(knnId);
              return row ? [{
                ...row,
                _similarity: knnScores.get(knnId) ?? null,
              }] : [];
            });
          }
        } else {
          // No embedding yet — fall through to fallback.
          similarityFallback = true;
        }
      } catch (err) {
        console.warn('[similar] vector KNN failed, using fallback:', (err as Error).message);
        similarityFallback = true;
      }
    }

    // Phase 2 (fallback): same brand + category, or FTS on title
    if (similarityFallback || similar.length === 0) {
      const currency = src.currency || 'SGD';
      const sourceCountry = src.country_code || null;
      const brand = src.brand || null;
      const topCategory = src.category_path?.[0] || null;

      if (brand && topCategory) {
        const params: unknown[] = [id, brand, topCategory, currency];
        let where = `id != $1 AND brand = $2 AND category_path[1] = $3 AND currency = $4`;
        if (sourceCountry) { where += ` AND country_code = $5`; params.push(sourceCountry); }
        params.push(limit);
        const bcResult = await db.query(
          `SELECT id, sku AS source_id, source AS domain, url, title, price, currency,
                  image_url, brand, category_path, region, country_code
           FROM products
           WHERE ${where}
           ORDER BY updated_at DESC
           LIMIT $${params.length}`,
          params
        );
        similar = bcResult.rows.map((row) => ({ ...row, _similarity: null }));
      }

      if (similar.length < limit && src.title) {
        const needed = limit - similar.length;
        const existingIds = [id, ...similar.map((r) => r.id as string)];
        const placeholders = existingIds.map((_, i) => `$${i + 1}`).join(',');
        let ftsIdx = existingIds.length + 1;
        let ftsWhere = `id NOT IN (${placeholders}) AND currency = $${ftsIdx}`;
        const ftsParams: unknown[] = [...existingIds, currency];
        ftsIdx++;
        ftsWhere += ` AND search_vector @@ plainto_tsquery('english', $${ftsIdx})`;
        ftsParams.push(src.title);
        ftsIdx++;
        if (sourceCountry) { ftsWhere += ` AND country_code = $${ftsIdx}`; ftsParams.push(sourceCountry); ftsIdx++; }
        ftsParams.push(needed);
        const ftsResult = await db.query(
          `SELECT id, sku AS source_id, source AS domain, url, title, price, currency,
                  image_url, brand, category_path, region, country_code
           FROM products
           WHERE ${ftsWhere}
           ORDER BY updated_at DESC
           LIMIT $${ftsParams.length}`,
          ftsParams
        );
        similar = [...similar, ...ftsResult.rows.map((row) => ({ ...row, _similarity: null }))];
      }
    }

    const data = similar.slice(0, limit).map((row) => ({
      id: row.id,
      source: row.source_id,
      domain: row.domain,
      url: row.url,
      title: row.title,
      price: row.price ? parseFloat(row.price as string) : null,
      currency: row.currency,
      image_url: row.image_url || null,
      brand: row.brand || null,
      category_path: row.category_path || null,
      region: row.region || null,
      country_code: row.country_code || null,
      similarity: row._similarity ?? null,
    }));

    if (timedOut || res.headersSent) return;
    res.json({
      data,
      meta: {
        source_id: id,
        count: data.length,
        method: vectorDb && !similar.length ? 'fallback' : vectorDb ? 'knn' : 'fallback',
        response_time_ms: Date.now() - start,
      },
    });
  })
);

// GET /v1/products/:id
router.get(
  '/:id',
  agentDetectMiddleware,
  requireApiKey,
  checkRateLimit,
  queryLogMiddleware('products.get'),
  asyncHandler(async (req: Request, res: Response) => {
    const start = Date.now();
    const { id } = req.params;

    let result;
    try {
      result = await db.query(
        `SELECT id, sku AS source_id, source AS domain, url,
                title, price, currency, image_url, metadata, updated_at,
                url_last_checked_at, url_status,
                region, country_code, created_at, description, brand, mpn, gtin,
                category_path, category, merchant_id, avg_rating, review_count
         FROM products WHERE id = $1`,
        [id]
      );
    } catch (err: unknown) {
      console.error('[products/:id] db query error:', err);
      res.status(500).json({ error: 'Internal server error' });
      return;
    }

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Product not found' });
      return;
    }

    const row = result.rows[0];
    const product = buildProduct(row as Record<string, unknown>, 'SGD', false);

    if (req.apiKeyRecord) {
      const elapsedMs = Date.now() - start;
      // BUY-31298: feed behavioral context through res.locals; trackApiUsage via
      // queryLogMiddleware always captures api_key_id, result_status, latency_ms.
      res.locals.queryIntent = 'lookup';
      res.locals.productCategories = extractCategories([product]);
      res.locals.signupChannel = req.apiKeyRecord.signupChannel;
      trackProductView({
        apiKey: hashKey(req.apiKeyRecord.key),
        apiKeyId: req.apiKeyRecord.id,
        productId: row.id,
        retailer: row.domain,
        category: (Array.isArray(row.category_path) ? row.category_path[0] : (typeof row.category_path === 'string' ? row.category_path.split(' > ')[0] : null)) as string | null,
        latencyMs: elapsedMs,
      });
    }

    // BUY-52474: log a product_view for /v1/products/:id detail renders so the
    // `product_views` table grows from real /v1 detail traffic. Fire-and-forget
    // so the response is never blocked on the insert.
    recordProductView({
      productId: row.id,
      source: 'products.get',
      req,
    });

    const responseBody = buildSearchResponse([product], 1, 1, 0, Date.now() - start, false);
    res.json(responseBody);
  })
);

function inferQueryIntent(q: string, domain?: string, minPrice?: number, maxPrice?: number): string {
  const lower = q.toLowerCase();
  if (minPrice !== undefined && maxPrice !== undefined) return 'price_check';
  if (/\bvs\b|compare|comparison|difference/i.test(lower)) return 'comparison';
  if (/buy|purchase|order|checkout/i.test(lower)) return 'purchase_intent';
  if (q.length === 0 && domain) return 'bulk_catalog';
  if (q.length > 0) return 'discovery';
  return 'bulk_catalog';
}

// POST /v1/products/ingest
// Bulk ingest products from scraper agents. Requires API key auth.
// Upserts on (platform, platform_id) — safe to re-run.
router.post(
  '/ingest',
  requireApiKey,
  asyncHandler(async (req: Request, res: Response) => {
    const start = Date.now();
    const items = req.body;

    if (!Array.isArray(items) || items.length === 0) {
      res.status(400).json({ error: 'Body must be a non-empty array of products' });
      return;
    }

    if (items.length > 500) {
      res.status(400).json({ error: 'Maximum 500 products per request' });
      return;
    }

    const VALID_PLATFORMS = new Set([
      'amazon_sg','amazon_uk','amazon_us','asos','audiohouse','bestdenki','books_com_tw','bukalapak',
      'carousell','castlery','challenger','coldstorage','coupang','courts',
      'decathlon','ezbuy','fairprice','flipkart','fortytwo','gaincity','giant',
      'guardian','harvey_norman','hengfohtong','hipvan','iherb','ikea','ishopchangi','kohepets',
      'lazada','lovebonito','maybelline','merchant_direct','metro','mothercare','motherswork',
      'mustafa','myntra','nike','petloverscentre','popular','qoo10','rakuten',
      'redmart','robinsons','sasa','sephora','shein','shengsiong','shopee',
      'stereo','tangs','tiki','tokopedia','toysrus','uniqlo','vuori','watsons','zalora',
    ]);

    const rows: Array<{
      id: string; platform: string; platformId: string; sku: string; name: string;
      price: number; currency: string; productUrl: string; merchantId: string;
      merchantName: string; originalPrice?: number; brand?: string;
      description?: string; imageUrl?: string; images?: string[];
      categoryPath: string[]; availability: string;
      region?: string; countryCode?: string;
      gtin?: string; mpn?: string;
    }> = [];

    const errors: string[] = [];

    for (let i = 0; i < items.length; i++) {
      const p = items[i];
      if (!p || typeof p !== 'object') { errors.push(`[${i}] not an object`); continue; }
      if (!p.platform || !VALID_PLATFORMS.has(p.platform)) { errors.push(`[${i}] invalid or missing platform`); continue; }
      if (!p.name || typeof p.name !== 'string') { errors.push(`[${i}] missing name`); continue; }
      if (!p.price || isNaN(parseFloat(p.price))) { errors.push(`[${i}] missing or invalid price`); continue; }
      if (!p.product_url && !p.productUrl) { errors.push(`[${i}] missing product_url`); continue; }

      const platformId = p.platform_id || p.platformId || p.product_id || p.id || '';
      const sku = p.sku || platformId || `${p.platform}-${i}`;

      rows.push({
        id: require('crypto').randomUUID(),
        platform: p.platform,
        platformId,
        sku,
        name: String(p.name).slice(0, 1000),
        price: parseFloat(p.price),
        currency: p.currency || (p.country_code ? COUNTRY_CURRENCY[(p.country_code as string).toUpperCase()] : null) || (p.countryCode ? COUNTRY_CURRENCY[(p.countryCode as string).toUpperCase()] : null) || 'SGD',
        gtin: p.gtin ? String(p.gtin).slice(0, 14) : undefined,
        mpn: p.mpn ? String(p.mpn).slice(0, 100) : undefined,
        productUrl: p.product_url || p.productUrl,
        merchantId: p.merchant_id || p.merchantId || p.platform,
        merchantName: p.merchant_name || p.merchantName || p.platform,
        originalPrice: p.original_price || p.originalPrice
          ? (() => {
              const op = parseFloat(p.original_price || p.originalPrice);
              const cp = parseFloat(p.price);
              return !isNaN(op) && !isNaN(cp) && op > cp && op <= cp * 10 ? op : undefined;
            })()
          : undefined,
        brand: p.brand ? String(p.brand).slice(0, 200) : undefined,
        description: p.description ? String(p.description).slice(0, 5000) : undefined,
        imageUrl: p.image_url || p.imageUrl || undefined,
        images: Array.isArray(p.images) ? p.images.slice(0, 20) : undefined,
        categoryPath: Array.isArray(p.category_path || p.categoryPath)
          ? (p.category_path || p.categoryPath).slice(0, 10)
          : ['Uncategorized'],
        availability: p.availability || 'in_stock',
        region: p.region || undefined,
        countryCode: p.country_code || p.countryCode || undefined,
      });
    }

    if (rows.length === 0) {
      res.status(400).json({ error: 'No valid products', validation_errors: errors });
      return;
    }

    // Auto-create merchant records for any new merchant IDs (BUY-8788)
    const uniqueMerchants = new Map<string, { name: string; source: string; country: string }>();
    for (const r of rows) {
      if (!uniqueMerchants.has(r.merchantId)) {
        uniqueMerchants.set(r.merchantId, {
          name: r.merchantName,
          source: r.platform,
          country: r.countryCode || 'SG',
        });
      }
    }
    for (const [mid, info] of uniqueMerchants) {
      await db.query(
        `INSERT INTO merchants (id, name, source, country, is_active, onboarding_stage)
         VALUES ($1, $2, $3, $4, true, 'active')
         ON CONFLICT (id) DO NOTHING`,
        [mid, info.name, info.source, info.country]
      ).catch(() => {});
    }

    let inserted = 0;
    let updated = 0;

    for (const r of rows) {
      const result = await db.query(
        `INSERT INTO products
           (sku, source, merchant_id, title, description, price, currency, url,
            image_url, category_path, brand, metadata, is_active, region, country_code, gtin, mpn,
            search_vector)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,true,$13,$14,$15,$16,
                 to_tsvector('english',
                   COALESCE($4,'') || ' ' ||
                   COALESCE($11,'') || ' ' ||
                   COALESCE(array_to_string($10::text[],' '),'')
                 ))
         ON CONFLICT (sku, source, country_code)
         DO UPDATE SET
           title = EXCLUDED.title,
           price = EXCLUDED.price,
           currency = EXCLUDED.currency,
           image_url = EXCLUDED.image_url,
           metadata = products.metadata || EXCLUDED.metadata,
           region = COALESCE(EXCLUDED.region, products.region),
           country_code = COALESCE(EXCLUDED.country_code, products.country_code),
           gtin = COALESCE(EXCLUDED.gtin, products.gtin),
           mpn = COALESCE(EXCLUDED.mpn, products.mpn),
           search_vector = to_tsvector('english',
             COALESCE(EXCLUDED.title,'') || ' ' ||
             COALESCE(EXCLUDED.brand,'') || ' ' ||
             COALESCE(array_to_string(EXCLUDED.category_path,' '),'')
           ),
           updated_at = NOW()
         RETURNING (xmax = 0) AS is_insert`,
        [
          r.sku, r.platform, r.merchantId, r.name, r.description || null,
          r.price, r.currency, r.productUrl, r.imageUrl || null,
          r.categoryPath.length ? `{${r.categoryPath.map(c => `"${c.replace(/"/g, '\\"')}"`).join(',')}}` : '{}',
          r.brand || null,
          JSON.stringify({ original_price: r.originalPrice, merchant_name: r.merchantName, availability: r.availability }),
          // products is partitioned by country_code; the partition's `region`
          // column is NOT NULL and the column default ('sg') only applies when
          // the column is omitted from the INSERT. We're listing the column,
          // so we must supply a value. Default to country_code lowercased,
          // then 'sg' as the last-resort fallback.
          r.region || (r.countryCode ? r.countryCode.toLowerCase() : null) || 'sg',
          r.countryCode || null,
          r.gtin || null, r.mpn || null,
        ]
      ).catch(() => null);

      if (result && result.rows[0]) {
        if (result.rows[0].is_insert) inserted++; else updated++;
      }
    }

    res.status(207).json({
      accepted: rows.length,
      inserted,
      updated,
      skipped: items.length - rows.length,
      validation_errors: errors.length > 0 ? errors : undefined,
      duration_ms: Date.now() - start,
    });
  })
);

function extractCategories(products: Array<{ domain?: string; merchant?: string | { id: string; name: string | null; domain: string }; metadata?: Record<string, unknown> | null }>): string[] {
  const cats = new Set<string>();
  for (const p of products) {
    const source = p.domain || (typeof p.merchant === 'object' ? p.merchant?.domain : p.merchant) || '';
    if (source) {
      const domainName = source.replace('.sg', '').replace('.com', '');
      cats.add(domainName);
    }
    if (p.metadata && typeof p.metadata === 'object') {
      const meta = p.metadata as Record<string, unknown>;
      if (typeof meta['category'] === 'string') cats.add(meta['category']);
      if (typeof meta['sub_category'] === 'string') cats.add(meta['sub_category']);
    }
  }
  return Array.from(cats).slice(0, 10);
}

// ─────────────────────────────────────────────────────────────
// Cache warm-up — BUY-31302
// Runs once at startup, seeds Redis with results for the most common
// search queries × country combos. Cold queries hit DB at 3-10s; warm
// queries return from Redis in <5ms. With 3600s TTL most queries stay
// warm across basket runs.
// ─────────────────────────────────────────────────────────────

const WARM_SEED_QUERIES: Array<{ q: string; country: string }> = [
  // SG — high-traffic consumer electronics & daily items
  { q: 'iPhone 15 Pro', country: 'SG' },
  { q: 'Samsung Galaxy S24', country: 'SG' },
  { q: 'laptop', country: 'SG' },
  { q: 'wireless earbuds', country: 'SG' },
  { q: 'running shoes', country: 'SG' },
  { q: 'coffee maker', country: 'SG' },
  { q: 'rice cooker', country: 'SG' },
  { q: 'air fryer', country: 'SG' },
  { q: 'bluetooth speaker', country: 'SG' },
  { q: 'gaming mouse', country: 'SG' },
  { q: 'monitor 27 inch', country: 'SG' },
  { q: 'mechanical keyboard', country: 'SG' },
  { q: 'Nike shoes', country: 'SG' },
  { q: 'Adidas sneakers', country: 'SG' },
  { q: 'hand cream moisturizer', country: 'SG' },
  { q: 'sunscreen SPF 50', country: 'SG' },
  { q: 'vitamin C supplement', country: 'SG' },
  { q: 'yoga mat', country: 'SG' },
  { q: 'power bank', country: 'SG' },
  { q: 'tablet', country: 'SG' },
  // US — high-traffic
  { q: 'iPhone 15 Pro', country: 'US' },
  { q: 'laptop', country: 'US' },
  { q: 'wireless earbuds', country: 'US' },
  { q: 'running shoes', country: 'US' },
  { q: 'coffee maker', country: 'US' },
  { q: 'air fryer', country: 'US' },
  { q: 'bluetooth speaker', country: 'US' },
  { q: 'gaming mouse', country: 'US' },
  { q: 'monitor', country: 'US' },
  { q: 'mechanical keyboard', country: 'US' },
];

export async function warmSearchCache(): Promise<void> {
  const startMs = Date.now();
  let warmed = 0;
  let skipped = 0;

  for (const { q, country } of WARM_SEED_QUERIES) {
    try {
      const currency = country === 'US' ? 'USD' : 'SGD';
      const limit = 20;
      const offset = 0;
      // Must match the handler's cacheKey exactly:
      // fts:q:domain:region:country:category:catId:catPath:brand:merchantId:avail:currency:minP:maxP:limit:offset:sort:fields:compact
      // With all defaults empty: fts:q:::country:::::::currency:::limit:offset:::f
      // BUY-67275 (#37): live handler key ends with :searchMode — without it the
      // warm write is never read.
      const cacheKey = `fts:${q}:::${country}:::::::${currency}:::${limit}:${offset}:::f:${DEFAULT_SEARCH_MODE}`;

      const existing = await redis.get(cacheKey).catch(() => null);
      if (existing) {
        skipped++;
        continue;
      }

      // Build the query the same way the handler does
      // BUY-33987: include `is_active = true` so the warm CTE matches the
      // handler's CTE exactly AND so the planner can pick the partial GIN
      // index `products_*_search_vector_idx WHERE is_active = true`. Without
      // this, the warm path is slower than the live path and the warm cache
      // becomes a liability instead of an asset.
      const conditions: string[] = ['currency = $1', 'is_active = true'];
      const params: unknown[] = [currency];
      let idx = 2;
      const ftsParamIdx = idx;
      conditions.push(`search_vector @@ plainto_tsquery('english', $${idx})`);
      params.push(q);
      idx++;
      conditions.push(`country_code = $${idx}`);
      params.push(country);
      idx++;

      const whereClause = `WHERE ${conditions.join(' AND ')}`;
      const CANDIDATE_CAP = 200;

      const specColumnsJoined = `products.created_at, products.description, products.brand, products.mpn, products.gtin, products.category_path, products.category, products.merchant_id, products.avg_rating, products.review_count`;
      const joinedColumns = `products.id, products.sku AS source_id, products.source AS domain, products.url,
                 al.destination_url AS affiliate_url,
                 products.title, products.price, products.currency, products.image_url, products.metadata, products.updated_at,
                 products.url_last_checked_at, products.url_status,
                 products.region, products.country_code, ${specColumnsJoined}`;

      // BUY-32028: remove ts_rank ORDER BY (missed by e8f407dc BUY-31540 in warmSearchCache
      // CTE). The warmSearchCache path was excluded from the original fix; on broad US queries
      // (laptop+US = 70k+ matches) the CTE materializes all matches before LIMIT and
      // exceeds the warm-up window, leaving cache cold and forcing the live handler onto the
      // same slow path. Mirrors the live handler's CTE exactly so warm entries match cache keys.
      const dataQuery = `
        WITH top_ids AS (
          SELECT id, country_code
          FROM products
          ${whereClause}
          LIMIT ${CANDIDATE_CAP}
        )
        SELECT ${joinedColumns}
        FROM top_ids
        JOIN products ON products.id = top_ids.id AND products.country_code = top_ids.country_code
        LEFT JOIN affiliate_links al ON al.product_id = products.id::text AND al.merchant_id = products.merchant_id
        ORDER BY products.updated_at DESC
        LIMIT $${idx} OFFSET $${idx + 1}
      `;

      params.push(limit + 1, offset);

      const result = await db.query(dataQuery, params);
      const hasMore = result.rows.length > limit;
      if (hasMore) result.rows.pop();
      const total = result.rows.length + (hasMore ? 1 : 0);

      const products = result.rows.map((row) => buildProduct(row as Record<string, unknown>, currency, false));
      const responseBody = buildSearchResponse(products, total, limit, offset, 0, false, hasMore);

      await redis.set(cacheKey, JSON.stringify(responseBody), 'EX', SEARCH_CACHE_TTL_SECONDS);
      warmed++;
    } catch (err) {
      // Non-fatal: log but don't block startup
      console.warn(`[cache-warm] failed for q="${q}" country=${country}:`, (err as Error)?.message);
    }
  }

  const elapsed = Date.now() - startMs;
  console.log(`[cache-warm] done: ${warmed} warmed, ${skipped} already cached, ${elapsed}ms`);
}

export default router;
