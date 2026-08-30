import { Router, Request, Response } from 'express';
import { createHash } from 'crypto';
import { PoolClient } from 'pg';
import { db, redis, vectorDb } from '../config';
import { readDb, ReplicaUnavailableError, servingReadDbConnect } from '../lib/readReplica';
import { requireApiKey, checkRateLimit, hashKey } from '../middleware/apiKey';
import { agentDetectMiddleware } from '../middleware/agentDetect';
import { trackProductSearch, trackProductView } from '../analytics/posthog';
import { recordQueryCacheLookup } from '../monitoring/cacheStats';
import { queryLogMiddleware } from '../middleware/queryLog';
import { buildProduct, buildSearchResponse, COUNTRY_CURRENCY } from '../lib/response';
import { buildCompareProductsQuery, UUID_RE, PRODUCT_ID_RE } from '../lib/compare-query';
import { preprocessSearchQuery } from '../lib/queryPreprocessor';
import { shipScopeForUrl } from '../lib/shipsTo';
import { deviceStorageExclusionFragment, deviceStorageExclusionFragmentProducts, STORAGE_CATEGORY_SQL_TIER_JOIN, tierStorageExclusionNeeded, LAPTOP_ACCESSORY_PG_RE_SOURCE } from '../lib/searchRelevanceTaxonomy';
import { recordProductView, recordProductViewsBulk } from '../lib/instrumentation';
import { embedQuery } from '../jobs/embedProducts';
import { detectIdentifier, identifierMatchPredicate, identifierForcesKeywordMode, IdentifierDetection } from '../lib/identifierDetector';
import { lookupMerchantMap } from '../lib/merchantLookup';

// BUY-31302: 1-hour TTL (was 120s). Reduces cold-miss frequency from every 2min to every 1hr.
// Combined with startup warm-up, cold cache drops to <1s for all seeded queries.
import { semanticLookup as semLookup, semanticRegister as semRegister, semanticEnabled as semEnabled } from '../lib/semanticCache';

const SEARCH_CACHE_TTL_SECONDS = 3600;

// BUY-41572: bumped from 5s → 15s as a temporary measure so the 50-query hybrid
// eval (BUY-41140) can complete against the live DB. Roundhouse EXPLAIN happy
// path is still ~15-75ms; the 5s ceiling was below the latency budget the API
// advertises and produced 504 upstream_timeout on every search. Mirrors the
// BUY-33985 deals endpoint fix at 15s.
// Sprint A (2026-07-03): env-tunable latency budget. Agents abandon long before
// 15s; degraded-200s replace 504s below so a slow answer is still an answer.
const SEARCH_STATEMENT_TIMEOUT_MS = Math.max(1000, Number(process.env.SEARCH_STATEMENT_TIMEOUT_MS) || 8000);
const SEARCH_HANDLER_TIMEOUT_MS = Math.max(2000, Number(process.env.SEARCH_HANDLER_TIMEOUT_MS) || 10000);

// BUY-65260: slow cold misses can hit the handler timeout before any successful
// payload exists in Redis. Cache the degraded 200 briefly so replay bursts do not
// pay the same 10s timeout floor on every identical query.
const SEARCH_DEGRADED_CACHE_TTL_SECONDS = Math.max(5, Number(process.env.SEARCH_DEGRADED_CACHE_TTL_SECONDS) || 30);
const SG_SEARCH_FRESHNESS_GUARDRAIL_HOURS = 48;
const SG_SEARCH_FRESHNESS_GUARDRAIL_CACHE_VERSION = 'tier-cand-rank-v10-b77644'; // BUY-77644: bust stale degraded responses after tier cand/rank fix

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
// BUY-67275-bitmap (2026-08-09): raised 4MB -> 32MB. At 4MB the FTS bitmap for a
// head term (laptop = 277k TIDs) goes LOSSY: 4,915 lossy heap blocks + 37,550 row
// rechecks = 30,691 buffers / ~9s cold. Exact bitmap = 586 buffers. The old 4MB was
// chosen for SQLSTATE 53200, which is a PARALLEL bitmap DSM failure — both search
// paths already set max_parallel_workers_per_gather=0, so this is single-process
// work_mem and never touches shared memory.
const SEARCH_WORK_MEM = '32MB';
// BUY-62711: Archive fallback ladder collapsed. The search tier (search_products) now serves
// virtually all keyword traffic (~99%). Archive path is only a last-resort fallback
// on tier errors. Dead kill-switches removed: SEARCH_OR_TOPUP, SEO_HEAD_PREEMPT.
// Contract preserved: tier error -> archive -> degraded-200.
const GENERAL_SEARCH_FALLBACK_TIMEOUT_MS = Math.max(250, Number(process.env.GENERAL_SEARCH_FALLBACK_TIMEOUT_MS) || 1200);

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


// BUY-62624: dedupe product rows by id. A LEFT JOIN on affiliate_links can fan out
// one row per matching affiliate link (same product, multiple tracking URLs), which
// renders identical product cards. Keep the first occurrence (highest-ranked/first in
// the ordered result set) and drop the rest. Applied to every search result path.
function dedupeProductRows(rows: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  const seen = new Set<string>();
  const out: Array<Record<string, unknown>> = [];
  for (const row of rows) {
    const id = String(row.id);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(row);
  }
  return out;
}

function shiftSqlPlaceholders(sql: string, offset: number): string {
  return sql.replace(/\$(\d+)/g, (_, idx) => `$${Number(idx) + offset}`);
}

// ── Identifier lookup (BUY-72362). Runs BEFORE tier/keyword/archive/vector.
// Detects ASIN/EAN/GTIN/UPC/Apple-part/model-number queries and resolves them
// to an exact match against `gtin` / `mpn` / `sku`. FTS cannot resolve these
// shapes — ASINs share no meaningful tokens with product titles — and the
// tokenised fallback for generic SKUs (`SKU-12345` → fishing reels) is a
// confident wrong answer. Returns true if it handled the request (including
// the deliberate "no exact match" 0-result case); returns false if the query
// is not identifier-shaped, so the caller falls through to the FTS path
// unchanged. Errors also return false to preserve the existing fail-open
// contract. Cached alongside the FTS path under `search:...` keys.
async function tryIdentifierLookup(
  req: Request,
  res: Response,
  p: {
    id: IdentifierDetection; countryCode?: string; currency: string; limit: number; offset: number;
    minPrice?: number; maxPrice?: number; brand?: string; domain?: string;
    compact: boolean; requestStart: number; cacheKey: string;
    deliverTo?: string; includeUnshippable?: boolean;
  },
): Promise<boolean> {
  let client: PoolClient;
  try { client = await servingReadDbConnect(); } catch { return false; }
  try {
    const conds: string[] = [];
    const params: unknown[] = [];
    let i = 1;
    const idIdx = i; params.push(p.id.normalized); i++;
    conds.push(identifierMatchPredicate(p.id, idIdx).sql);
    if (p.minPrice != null || p.maxPrice != null) { conds.push(`sp.currency = $${i}`); params.push(p.currency); i++; }
    if (p.brand) { conds.push(`sp.brand ILIKE $${i}`); params.push(`%${p.brand}%`); i++; }
    if (p.domain) { conds.push(`sp.source = $${i}`); params.push(p.domain); i++; }
    conds.push(`sp.is_active = true`);
    conds.push(`sp.price > 0`);
    const whereSql = `WHERE ${conds.join(' AND ')}`;
    const limitIdx = i; params.push(p.limit + 1); i++;
    const offsetIdx = i; params.push(p.offset); i++;

    await client.query('BEGIN');
    // BUY-72362 follow-on: parent `products` is 368M rows and cold lookups can
    // exceed the original 2s budget. Use the country-specific child partition
    // when the caller supplied a market (sub-100ms with the partition btree),
    // and give the parent path the same headroom as the REST search tier.
    await client.query(`SET LOCAL statement_timeout = '8000'`);
    await client.query(`SET LOCAL max_parallel_workers_per_gather = 0`);
    const cols = (alias: string) => `${alias}.id, ${alias}.source AS domain, ${alias}.url, al.destination_url AS affiliate_url,
      ${alias}.title, ${alias}.price, ${alias}.currency, ${alias}.image_url, ${alias}.region, ${alias}.country_code, ${alias}.updated_at, ${alias}.in_stock,
      ${alias}.sku AS source_id, ${alias}.brand, ${alias}.mpn, ${alias}.gtin, ${alias}.category_path, ${alias}.category, ${alias}.merchant_id,
      ${alias}.avg_rating, ${alias}.review_count, ${alias}.created_at, ${alias}.description, ${alias}.metadata,
      jsonb_build_object('brand', ${alias}.brand, 'category', ${alias}.category,
        'availability', CASE WHEN ${alias}.in_stock IS FALSE THEN 'out_of_stock' ELSE 'in_stock' END) AS metadata`;

    let rows: Array<Record<string, unknown>> = [];
    let source = 'identifier_partition';
    const countryCode = p.countryCode?.toUpperCase();
    const partitionTable = countryCode ? `products_partitioned_${countryCode.toLowerCase()}` : null;
    try {
      if (partitionTable) {
        await client.query('SAVEPOINT before_parent');
        const r = await client.query(
          `SELECT ${cols('sp')} FROM ${partitionTable} sp
           LEFT JOIN affiliate_links al ON al.product_id = sp.id::text AND al.merchant_id = sp.merchant_id
           ${whereSql}
           ORDER BY sp.id DESC
           LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
          params,
        );
        rows = r.rows;
      } else {
        throw new Error('no_country_code');
      }
    } catch (partitionErr) {
      await client.query('ROLLBACK TO SAVEPOINT before_parent').catch(() => {});
      source = 'identifier_parent';
      const r = await client.query(
        `SELECT ${cols('sp')} FROM products sp
         LEFT JOIN affiliate_links al ON al.product_id = sp.id::text AND al.merchant_id = sp.merchant_id
         ${whereSql}
         ORDER BY sp.id DESC
         LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
        params,
      );
      rows = r.rows;
    }
    await client.query('COMMIT');
    client.release();

    if (rows.length === 0) {
      const emptyBody = buildSearchResponse([], 0, p.limit, p.offset, Date.now() - p.requestStart, false) as unknown as Record<string, unknown>;
      emptyBody.source = source;
      emptyBody.identifier_kind = p.id.kind;
      annotateDeliverTo(emptyBody, p.deliverTo, p.includeUnshippable !== false, p.id.raw);
      redis.set(p.cacheKey, JSON.stringify(emptyBody), 'EX', SEARCH_CACHE_TTL_SECONDS).catch(() => {});
      res.set('X-Identifier-Lookup', p.id.kind);
      res.set('X-Identifier-Resolved', '0');
      res.json(emptyBody);
      return true;
    }

    const hasMore = rows.length > p.limit;
    const pageRows = hasMore ? rows.slice(0, p.limit) : rows;
    const products = pageRows.map((r) => buildProduct(r as Record<string, unknown>, p.currency, p.compact));
    const total = p.offset + rows.length;
    const responseBody = buildSearchResponse(products, total, p.limit, p.offset, Date.now() - p.requestStart, false) as unknown as Record<string, unknown>;
    responseBody.source = source;
    responseBody.identifier_kind = p.id.kind;
    annotateDeliverTo(responseBody, p.deliverTo, p.includeUnshippable !== false, p.id.raw);
    redis.set(p.cacheKey, JSON.stringify(responseBody), 'EX', SEARCH_CACHE_TTL_SECONDS).catch(() => {});
    res.set('X-Identifier-Lookup', p.id.kind);
    res.set('X-Identifier-Resolved', String(rows.length));
    res.json(responseBody);
    return true;
  } catch (e) {
    try { await client.query('ROLLBACK').catch(() => {}); } catch { /* ignore */ }
    try { client.release(); } catch { /* ignore */ }
    console.warn('[identifier] fell back:', (e as Error)?.message);
    return false;
  }
}

// ── Search-tier path (Phase 3). Serves from the RAM-fitting `search_products` tier
// (quality-gated ~113M rows, ~4.7GB GIN that fits the replica cache -> no timeouts).
// AND-first-then-OR for precision+recall. Returns true if it responded; returns false
// on ANY error/replica issue so the caller falls through to the archive path unchanged
// (hybrid = zero recall risk). Default-on after BUY-61117; opt out with
// SEARCH_USE_TIER=0 or force with ?_tier=1 (test override).
async function tryTierSearch(
  req: Request,
  res: Response,
  p: {
    q: string; countryCode?: string; currency: string; limit: number; offset: number;
    minPrice?: number; maxPrice?: number; category?: string; brand?: string; domain?: string;
    compact: boolean; requestStart: number; cacheKey: string;
    deliverTo?: string; includeUnshippable?: boolean;
  },
): Promise<boolean> {
  const lexemes = p.q.trim().split(/\s+/).map((w) => w.replace(/[^\p{L}\p{N}]/gu, '')).filter(Boolean);
  if (lexemes.length === 0) return false;
  const tsOr = lexemes.join(' | ');
  // BUY-69621: HARD-exclude storage/SSD categories when the query targets a
  // device family (laptop/phone/tablet/…). No-op (fail-open) for storage
  // queries (`ssd`, `nvme`) and non-device queries. Uses `sp.` alias (tier
  // path reads from search_products sp). See lib/searchRelevanceTaxonomy.
  const storageExcl = deviceStorageExclusionFragment(p.q);
  // BUY-69727: search_products.category can be mis-tagged at ingest (newegg_us
  // writes 'home-living' for electronics) while products.metadata carries the
  // true category. The cand-CTE exclusion above cannot see metadata; this
  // post-rank join filter runs over the bounded top set (≤200 rows) only, so
  // the PK join to products is cheap. It fires for the same query set as
  // storageExcl (both derive from the same device/storage gates).
  const storageJoinFilter = tierStorageExclusionNeeded(p.q)
    ? ` JOIN products m ON m.id = sp.id AND NOT ${STORAGE_CATEGORY_SQL_TIER_JOIN}`
    : '';

  const conds: string[] = [];
  const params: unknown[] = [];
  let i = 1;
  const qIdx = i; params.push(p.q); i++;                    // $1 = raw q (rank + AND match)
  const orIdx = i; params.push(tsOr); i++;                  // $2 = OR lexeme string
  if (p.minPrice != null || p.maxPrice != null) { conds.push(`sp.currency = $${i}`); params.push(p.currency); i++; } // hotfix: currency restricts recall only when price-filtering
  if (p.countryCode) { conds.push(`sp.country_code = $${i}`); params.push(p.countryCode); i++; }
  if (p.minPrice != null && Number.isFinite(p.minPrice)) { conds.push(`sp.price >= $${i}`); params.push(p.minPrice); i++; }
  if (p.maxPrice != null && Number.isFinite(p.maxPrice)) { conds.push(`sp.price <= $${i}`); params.push(p.maxPrice); i++; }
  if (p.brand) { conds.push(`sp.brand ILIKE $${i}`); params.push(`%${p.brand}%`); i++; }
  if (p.domain) { conds.push(`sp.source = $${i}`); params.push(p.domain); i++; }
  // DEF-02: category filter that actually works — normalize the stored category to a
  // slug (lower, spaces->hyphens) and compare to the slug param, instead of the old
  // broken `category ILIKE '%pet-supplies%'` substring match.
  if (p.category) { conds.push(`lower(regexp_replace(coalesce(sp.category,''),'\\s+','-','g')) = lower($${i})`); params.push(p.category); i++; }
  let dtIdx = 0;
  if (p.deliverTo) { dtIdx = i; params.push(p.deliverTo); i++; } // rank-only: local-first ordering, never filters
  // BUY-72744: exclude synthetic Amazon rows in tier search.
  const synthAmazonExcl = "NOT (sp.merchant_id = 'amazon.com' AND (length(sp.sku) != 10 OR (sp.country_code = 'US' AND sp.currency = 'SGD')))";
  const filterSql = ' AND ' + (conds.length ? conds.join(' AND ') + ' AND ' : '') + synthAmazonExcl;
  const isGenericPhoneQuery = lexemes.length === 1 && lexemes[0]?.toLowerCase() === 'phone';
  const limitIdx = i; params.push(p.limit + 1); i++;
  const offsetIdx = i; params.push(p.offset); i++;
  const orderPrefix = dtIdx ? `(sp.country_code = $${dtIdx}) DESC NULLS LAST, ` : '';

  const cols = `sp.id, sp.source AS domain, sp.url, al.destination_url AS affiliate_url,
    sp.title, sp.price, sp.currency, sp.image_url, sp.region, sp.country_code, sp.updated_at, sp.in_stock,
    jsonb_build_object('brand', sp.brand, 'category', sp.category,
      'availability', CASE WHEN sp.in_stock IS FALSE THEN 'out_of_stock' ELSE 'in_stock' END) AS metadata`;

  // BUY-63738 + BUY-77675: add laptop accessory demotion and boost to tier
  // search results. Accessories (backpacks, skins, cases, sleeves, mics,
  // IEMs, headphones, desks, portable monitors, privacy screens, screen
  // cleaners, keyboards) should rank lower for laptop queries. The
  // `LAPTOP_ACCESSORY_PG_RE_SOURCE` alternation is the canonical Postgres
  // ARE-regex source — shared with `seo-landing-pages.ts` via the constant
  // exported from searchRelevanceTaxonomy so the API tier and the SEO page
  // both demote the same accessory set.
  const laptopAccessoryPenalty = `
    CASE
      WHEN sp.title ~* '${LAPTOP_ACCESSORY_PG_RE_SOURCE}'
        OR sp.category ~* '${LAPTOP_ACCESSORY_PG_RE_SOURCE}'
      THEN 0.25 ELSE 1.0
    END`;
  // BUY-69753: boost phone-handset brands and demote phone accessories in title-fallback
  // results. The `phone` token has no FTS entry (no rows match sp.search_vector @@
  // plainto_tsquery('english','phone')), so the query falls through to title LIKE
  // '%phone%' — which matches "Cell Phone Holder" before actual handsets. Apply a
  // handset brand boost (2x) for titles containing known phone brand names, and a
  // strong demotion (0.15x) for titles containing phone-accessory keywords.
  const phoneHandsetBoost = `
    CASE
      WHEN lower(sp.title) ~* '\\m(iphone|galaxy s|galaxy a|galaxy z|pixel [0-9]|moto g|moto e|oneplus|redmi|realme|infinix|oppo|vivo|xperia|smartphone|android phone|nokia)\\M'
        OR lower(sp.category) ~* '\\m(smartphone|phone|android)\\M'
      THEN 2.0 ELSE 1.0
    END`;
  // BUY-69753: phone accessory penalty mirrors the laptop accessory penalty above.
  // Titles with holder/case/cover/pouch/etc. AND the word "phone" are accessories.
  const phoneAccessoryPenalty = `
    CASE
      WHEN lower(sp.title) ~* '\\mphone\\M'
        AND (lower(sp.title) ~* '\\m(holder|stand|mount|case|cover|protector|pouch|lanyard|strap|cable|charger|armband|tripod|wallet|adapter)\\M'
          OR lower(sp.category) ~* '\\m(accessory|accessories)\\M')
      THEN 0.15 ELSE 1.0
    END`;

  const laptopBoost = `
    CASE
      WHEN lower(sp.title) LIKE '%laptop%' OR lower(sp.title) LIKE '%notebook%' OR lower(sp.title) LIKE '%macbook%'
        OR lower(sp.category) LIKE '%laptop%'
      THEN 2.0 ELSE 1.0
    END`;
  // BUY-77644: project the columns needed for ranking into the cand CTE so the
  // top CTE can rank against the bounded candidate set without a second join to
  // search_products. The old plan joined search_products in top (BUY-54980) which
  // forced 1000 PK lookups and blew the 4s tier timeout for broad terms like
  // `s24 case` (~3.6s). Selecting title/category/source/price/updated_at in cand
  // keeps the same ranking semantics in ~40-110ms.
  const rankCols = `title, category, source, price, updated_at`;
  const mkQuery = (match: string, extraFilter = '') => `
    WITH cand AS (
      SELECT id, search_vector, ${rankCols} FROM search_products sp
      WHERE ${match}${filterSql}${extraFilter}${storageExcl}
      -- perf: no ORDER BY — sorting forces enumeration of the FULL match set before
      -- LIMIT (broad OR fallbacks time out at the 4s tier cap; same anti-pattern as
      -- the archive fix in 9e3ad8e, measured 60x there). LIMIT stops early; ts_rank
      -- below ranks the bounded candidate set.
      -- BUY-67275-bitmap: 5000 -> 1000. The top CTE keeps only 200 rows, so 5000 was a 10x
      -- over-fetch that inflated the bitmap into lossy territory for head terms.
      LIMIT 1000
    ), top AS (
      -- BUY-54980/BUY-77644: rank columns are now in cand, so no join needed here.
      -- The CASE expressions reference the cand alias (c.*) directly.
      SELECT c.id, ts_rank(c.search_vector, plainto_tsquery('english', $${qIdx})) *
            (${laptopBoost.replace(/sp\./g, 'c.')}) *
            (${laptopAccessoryPenalty.replace(/sp\./g, 'c.')}) *
            (${phoneHandsetBoost.replace(/sp\./g, 'c.')}) *
            (${phoneAccessoryPenalty.replace(/sp\./g, 'c.')}) AS rank
      FROM cand c
      ORDER BY rank DESC LIMIT 200
    )
    SELECT ${cols}, top.rank AS _fts_rank
    FROM top JOIN search_products sp ON sp.id = top.id${storageJoinFilter}
    LEFT JOIN affiliate_links al ON al.product_id = sp.id::text AND al.merchant_id = sp.merchant_id
    ORDER BY ${orderPrefix}top.rank DESC
    LIMIT $${limitIdx} OFFSET $${offsetIdx}`;

  const andMatch = `sp.search_vector @@ plainto_tsquery('english', $${qIdx}) AND $${orIdx}::text IS NOT NULL`;
  const orMatch = `sp.search_vector @@ to_tsquery('english', $${orIdx})`;
  // BUY-63738 + BUY-77675: add accessory penalty to title fallback queries so
  // accessories don't dominate results when FTS returns no matches. Uses
  // 0.25x multiplier like mkQuery. Shared regex source from
  // LAPTOP_ACCESSORY_PG_RE_SOURCE keeps the API tier and the SEO page in
  // sync — when widening the accessory list, update both
  // `LAPTOP_ACCESSORY_SOFT_TOKENS` (searchRelevanceTaxonomy.ts) and
  // `LAPTOP_ACCESSORY_RE` (seo-landing-pages.ts).
  const laptopAccessoryPenaltyTitle = `
    CASE
      WHEN sp.title ~* '${LAPTOP_ACCESSORY_PG_RE_SOURCE}'
        OR sp.category ~* '${LAPTOP_ACCESSORY_PG_RE_SOURCE}'
      THEN 0.25 ELSE 1
    END`;
  // BUY-67275 (#37, 2026-08-14): bound the fallback candidates BEFORE ordering —
  // the orderPrefix/penalty ORDER BY otherwise enumerates every LIKE match
  // (same full-sort anti-pattern as mkQuery pre-cand and the archive path).
  const titleFallbackQuery = `
    WITH tcand AS (
      SELECT sp.id FROM search_products sp
      WHERE lower(sp.title) LIKE lower($${qIdx} || '%')${filterSql}${storageExcl}
      LIMIT 1000
    )
    SELECT ${cols}, 0 AS _fts_rank
    FROM tcand JOIN search_products sp ON sp.id = tcand.id${storageJoinFilter}
    LEFT JOIN affiliate_links al ON al.product_id = sp.id::text AND al.merchant_id = sp.merchant_id
    ORDER BY ${orderPrefix}((${phoneHandsetBoost}) * (${laptopAccessoryPenaltyTitle}) * (${phoneAccessoryPenalty})) DESC, sp.id DESC
    LIMIT $${limitIdx} OFFSET $${offsetIdx}`;
  const tokenTitleFallbackQuery = `
    WITH tcand AS (
      SELECT sp.id FROM search_products sp
      WHERE lower(sp.title) LIKE lower('%' || $${qIdx} || '%')${filterSql}${storageExcl}
      LIMIT 1000
    )
    SELECT ${cols}, 0 AS _fts_rank
    FROM tcand JOIN search_products sp ON sp.id = tcand.id${storageJoinFilter}
    LEFT JOIN affiliate_links al ON al.product_id = sp.id::text AND al.merchant_id = sp.merchant_id
    ORDER BY ${orderPrefix}((${phoneHandsetBoost}) * (${laptopAccessoryPenaltyTitle}) * (${phoneAccessoryPenalty})) DESC, sp.id DESC
    LIMIT $${limitIdx} OFFSET $${offsetIdx}`;
  const phoneCategoryFallbackQuery = `
    WITH pcand AS (
      SELECT sp.id FROM search_products sp
      WHERE (
        lower(coalesce(sp.category,'')) ~* '\\m(smartphone|smartphones|cell phone|cell phones|mobile phone|mobile phones)\\M'
        OR lower(sp.title) ~* '\\m(iphone|galaxy s|galaxy a|galaxy z|pixel [0-9]|moto g|moto e|oneplus|redmi|realme|infinix|oppo|vivo|xperia|smartphone|android phone|nokia)\\M'
      )
      AND NOT (
        lower(sp.title) ~* '\\m(holder|stand|mount|case|cover|protector|pouch|lanyard|strap|cable|charger|armband|tripod|wallet|adapter|kit|kits)\\M'
        OR lower(coalesce(sp.category,'')) ~* '\\m(accessory|accessories|case|cases|cover|covers)\\M'
      )${filterSql}${storageExcl}
      ORDER BY sp.id DESC
      LIMIT 1000
    )
    SELECT ${cols}, 0 AS _fts_rank
    FROM pcand JOIN search_products sp ON sp.id = pcand.id${storageJoinFilter}
    LEFT JOIN affiliate_links al ON al.product_id = sp.id::text AND al.merchant_id = sp.merchant_id
    ORDER BY ${orderPrefix}((${phoneHandsetBoost}) * (${phoneAccessoryPenalty})) DESC, sp.id DESC
    LIMIT $${limitIdx} OFFSET $${offsetIdx}`;

  let client: PoolClient;
  try { client = await servingReadDbConnect(); } catch { return false; }
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL statement_timeout = '4000'`);
    await client.query(`SET LOCAL gin_fuzzy_search_limit = 0`); // fuzzy sampling breaks multi-word AND
    await client.query(`SET LOCAL max_parallel_workers_per_gather = 0`);
    // BUY-67275-headterm (2026-08-09): do NOT lead with titleFallbackQuery for
    // single-lexeme queries. `lower(sp.title) LIKE lower($1||'%')` cannot use
    // idx_sp_trgm (the lower() wrapper defeats it; that index has idx_scan=0), so
    // it seq-scans 119M rows and ALWAYS blows the 4s tier timeout — killing the
    // tier for precisely the head terms (laptop/macbook/dyson/airpods/ps5) and
    // eating 4s of the 10s handler budget before the archive even starts. FTS
    // first (idx_sp_fts); the title-prefix scan stays below as a 0-result fallback.
    let rows = isGenericPhoneQuery
      ? (await client.query(phoneCategoryFallbackQuery, params)).rows
      : (await client.query(mkQuery(andMatch), params)).rows;
    if (rows.length === 0 && !isGenericPhoneQuery && lexemes.length === 1) {
      rows = (await client.query(titleFallbackQuery, params)).rows;
    }
    if (rows.length === 0) {
      // BUY-77644: broad OR fallbacks on multi-word queries union huge posting lists
      // (`running | shoes` = ~1.2M rows) and can exceed the 4s tier timeout even with
      // a LIMIT, causing a degraded archive fallback. For multi-word broad terms we
      // now skip the OR top-up entirely and let the faster archive path serve them.
      // Single-lexeme head terms keep the OR fallback because their posting lists are
      // smaller and the archive path is already fast for them.
      if (rows.length === 0 && lexemes.length === 1) {
        rows = (await client.query(mkQuery(orMatch), params)).rows;   // recall fallback
      }
      if (rows.length === 0 && isGenericPhoneQuery) {
        rows = (await client.query(phoneCategoryFallbackQuery, params)).rows;
      }
      if (rows.length === 0) {
        rows = (await client.query(titleFallbackQuery, params)).rows;
      }
      if (rows.length === 0 && lexemes.length === 1) {
        rows = (await client.query(tokenTitleFallbackQuery, params)).rows;
      }
    }
    // deliver_to local-first pass (2026-07-14): the cand CTE gathers the NEWEST 5000
    // matches by id, a window that churns under ~4.5M-rows/day ingest and often
    // contains zero rows from the user's country. Run a targeted pass over the
    // composite GIN (country_code, search_vector) and prepend those rows so
    // local products always lead the page when they exist.
    if (dtIdx && rows.length > 0) {
      await client.query('SAVEPOINT localpass'); // a failed local pass must not poison the tx (COMMIT would fail -> archive fallback)
      try {
        const localRows = (await client.query(mkQuery(andMatch, ` AND sp.country_code = $${dtIdx}`), params)).rows;
        if (localRows.length > 0) {
          const localIds = new Set(localRows.map((r) => String((r as Record<string, unknown>).id)));
          rows = [...localRows, ...rows.filter((r) => !localIds.has(String((r as Record<string, unknown>).id)))].slice(0, p.limit + 1);
        }
      } catch { await client.query('ROLLBACK TO SAVEPOINT localpass').catch(() => {}); /* local pass is best-effort — global rows already in hand */ }
    }
    await client.query('COMMIT');
    client.release();
    if (rows.length === 0) {
      return false;
    }
    if (res.headersSent) return true;
    const hasMore = rows.length > p.limit;
    const pageRows = hasMore ? rows.slice(0, p.limit) : rows;
    const products = pageRows.map((r) => buildProduct(r as Record<string, unknown>, p.currency, p.compact));
    const total = p.offset + rows.length;
    const responseBody = buildSearchResponse(products, total, p.limit, p.offset, Date.now() - p.requestStart, false) as unknown as Record<string, unknown>;
    responseBody.source = 'search_products_tier';
    annotateDeliverTo(responseBody, p.deliverTo, p.includeUnshippable !== false, p.q);
    redis.set(p.cacheKey, JSON.stringify(responseBody), 'EX', 3600).catch(() => {});
    if (semEnabled() && p.offset === 0) {
      const rp = p.cacheKey.split(':');
      semRegister(redis, `a1:${rp[1]}|${rp.slice(3).join(':')}`, rp[2],
        (res.locals.semVec as string | null) ?? null, p.cacheKey).catch(() => {});
    }
    res.set('X-Search-Tier', '1');
    res.json(responseBody);
    return true;
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch { /* ignore */ }
    try { client.release(); } catch { /* ignore */ }
    console.warn('[tier] fell back to archive:', (e as Error)?.message);
    return false;
  }
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

// deliver_to soft contract (2026-07-14): annotate availability relative to the END
// USER's country, optionally filter to local-only, and hint agents to pass deliver_to.
// v1 labels (merchant-country == deliver_to -> 'local', else 'unknown') until
// per-merchant ships-to enrichment lands. Never hides results unless the caller
// explicitly sets include_unshippable=false.
function annotateDeliverTo(body: Record<string, unknown>, deliverTo: string | undefined, includeUnshippable: boolean, q: string): void {
  const items = (body.data as Array<Record<string, unknown>>) || [];
  const meta = body.meta as Record<string, unknown> | undefined;
  if (deliverTo) {
    for (const it of items) {
      if (it.country_code === deliverTo) { it.availability = 'local'; continue; }
      // ships-to upgrade (2026-07-15): merchant-level scope from merchant_shipping.
      const scope = shipScopeForUrl(it.url);
      it.availability = scope === 'worldwide' ? 'ships_to_you'
        : scope === 'domestic' ? 'unavailable'
        : 'unknown';
    }
    if (!includeUnshippable) {
      const kept = items.filter((it) => it.availability === 'local' || it.availability === 'ships_to_you');
      body.data = kept;
      if (meta) meta.total = kept.length;
    }
    if (meta) meta.deliver_to = deliverTo;
  } else if (meta) {
    // F24 (2026-08-22): hint fires on EVERY deliver_to-less response (was q-only).
    meta.hint = "IMPORTANT — treat deliver_to as REQUIRED for buyer-facing use: pass deliver_to=<ISO-3166 country of your end user, e.g. deliver_to=SG> to rank deliverable products first (adds an availability label per product). Without it, results are not shipping-ranked and may be undeliverable to your user. Add include_unshippable=false to return only same-country products.";
  }
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
    // Backward compatibility: early public docs and clients used
    // `/v1/products?q=...` or `/v1/products?query=...` for search. Treat
    // those as the canonical bounded search route instead of falling through
    // to the unsearched list query, which is intentionally optimized for
    // paginated browsing and has its own cache key.
    const legacySearchQuery = (req.query.q || req.query.query) as string | undefined;
    if (legacySearchQuery) {
      const searchParams = new URLSearchParams();
      for (const [key, value] of Object.entries(req.query)) {
        if (value === undefined) continue;
        const targetKey = key === 'query' ? 'q' : key === 'country' ? 'country_code' : key;
        if (Array.isArray(value)) {
          for (const item of value) searchParams.append(targetKey, String(item));
        } else {
          searchParams.set(targetKey, String(value));
        }
      }
      return res.redirect(307, `/v1/products/search?${searchParams.toString()}`);
    }

    const requestStart = Date.now();

    // Pagination — contract defaults: page=1, limit=20, max 100
    const rawPage = parseInt((req.query.page as string) || '1');
    const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1;
    const rawLimit = parseInt((req.query.limit as string) || '20');
    const limit = Math.min(Math.max(1, Number.isFinite(rawLimit) ? rawLimit : 20), 100);
    const offset = (page - 1) * limit;

    // Filters — country defaults to SG to prevent cross-region pollution (BUY-6598)
    const category = req.query.category as string | undefined;
    // BUY-77897: accept both `country_code` (canonical) and `country` (alias used by most callers)
    const countryCode = ((req.query.country_code as string | undefined) || (req.query.country as string | undefined))?.toUpperCase() || 'SG';
    const currency = (req.query.currency as string) || (COUNTRY_CURRENCY[countryCode] || 'SGD');

    // Sort — whitelist to safe columns, default to created_at desc
    const sortParam = (req.query.sort as string) || 'created_at';
    const sortColumn = LIST_SORT_COLUMNS[sortParam] || 'created_at';
    const orderParam = (req.query.order as string)?.toLowerCase();
    const order = orderParam === 'asc' ? 'ASC' : 'DESC';

    const cacheKey = `list:${currency}:${countryCode}:${category || ''}:${sortColumn}:${order}:${page}:${limit}`;
    res.locals.cacheHit = false;
    try {
      const cached = await recordQueryCacheLookup(redis, cacheKey, () => redis.get(cacheKey));
      if (cached) {
        res.locals.cacheHit = true;
        const parsed = JSON.parse(cached);
        parsed.pagination.response_time_ms = Date.now() - requestStart;
        recordProductViewsBulk({
          productIds: (parsed.data || parsed.products || parsed.results || [])
            .map((product: { id?: string | number }) => product.id)
            .filter(Boolean),
          source: 'products.list.cache',
          req,
        });
        res.set('Cache-Control', 'public, max-age=30, s-maxage=30');
        res.set('X-Cache', 'HIT');
        return res.json(parsed);
      }
    } catch (_) {
      // Redis miss or error — fall through to DB
    }

    // BUY-77920: do NOT filter currency/price in the same scan as ORDER BY id DESC.
    // products_partitioned_sg_id_idx + is_active/country_code is ~0.1ms; adding
    // currency = SGD AND price > 0 forces a backward id scan that skips until
    // those predicates match and hits statement_timeout (30s LB 500).
    // Over-fetch on the indexed predicates, then apply currency/price in the
    // outer query (or in-process if the inner already returns LIMIT).
    const conditions: string[] = ['is_active = true'];
    const params: unknown[] = [];
    let idx = 1;

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

    // BUY-77664 FIX: Use partitioned tables for list endpoint (much faster than 413GB parent).
    const LIST_TABLE = /^[A-Z]{2}$/.test(countryCode)
      ? `products_partitioned_${countryCode.toLowerCase()}`
      : 'products';

    // Keep SELECT/ORDER references stable while swapping the physical table.
    const TABLE_ALIAS = 'products';
    const SELECT_COLUMNS = `${TABLE_ALIAS}.id, ${TABLE_ALIAS}.sku AS source_id, ${TABLE_ALIAS}.source AS domain, ${TABLE_ALIAS}.url,
                NULL::text AS affiliate_url,
                ${TABLE_ALIAS}.title, ${TABLE_ALIAS}.price, ${TABLE_ALIAS}.currency, ${TABLE_ALIAS}.image_url, ${TABLE_ALIAS}.metadata, ${TABLE_ALIAS}.updated_at,
                ${TABLE_ALIAS}.region, ${TABLE_ALIAS}.country_code, ${TABLE_ALIAS}.created_at, ${TABLE_ALIAS}.description, ${TABLE_ALIAS}.brand, ${TABLE_ALIAS}.mpn, ${TABLE_ALIAS}.gtin,
                ${TABLE_ALIAS}.category_path, ${TABLE_ALIAS}.category, ${TABLE_ALIAS}.merchant_id, ${TABLE_ALIAS}.avg_rating, ${TABLE_ALIAS}.review_count`;

    // Use id DESC — primary key index is the only valid index on this table (created_at/is_active
    // indexes are invalid due to interrupted CONCURRENTLY builds; BUY-39987 tracks the rebuild).
    // Sort param is honoured for id-tied pages but the primary sort is always id DESC.
    const orderBy = `ORDER BY ${TABLE_ALIAS}.id DESC`;

    // BUY-77835: route the heavy catalog list query to the read replica (when
    // healthy) so it does not compete with interactive /v1/products/search on
    // the saturated primary. readDb() falls back to primary if replica is not
    // configured or caught up. connectionTimeoutMillis: 5000 on replica pool
    // prevents indefinite hangs; BUY-77920 adds per-request try/catch + primary
    // fallback so the endpoint degrades gracefully when the replica is unreachable.
    let listDb = readDb();

    // pg_class reltuples is instant (system catalog, cached).
    let countResult;
    try {
      countResult = await listDb.query(
        `SELECT reltuples::bigint AS count FROM pg_class WHERE relname = $1`,
        [LIST_TABLE]
      );
    } catch (err) {
      console.warn(`[products:list] readDb() query failed, falling back to primary: ${(err as Error).message}`);
      listDb = db;
      countResult = await listDb.query(
        `SELECT reltuples::bigint AS count FROM pg_class WHERE relname = $1`,
        [LIST_TABLE]
      );
    }

    // BUY-77664 emergency: use a dedicated client with a short statement_timeout so
    // IO-saturated scans fail fast (returning 500) instead of hanging the Railway LB
    // timeout (30s -> 502). The pool's default timeout is 30s which causes 502s.
    let dataResult;
    let listClient;
    try {
      listClient = await listDb.connect();
    } catch (err) {
      console.warn(`[products:list] readDb().connect() failed, falling back to primary: ${(err as Error).message}`);
      listDb = db;
      listClient = await listDb.connect();
    }
    try {
      await listClient.query(`SET statement_timeout = '4s'`);
      // BUY-77920: newest partition rows are often USD (cross-listed). Filtering
      // currency=SGD AND ORDER BY id DESC never terminates — the planner walks
      // the id index looking for SGD and hits the 30s LB timeout. List by
      // indexed is_active/country_code + id DESC, then drop rows with no price.
      dataResult = await listClient.query(
        `SELECT ${SELECT_COLUMNS}
         FROM ${LIST_TABLE} products
         ${whereClause}
           AND products.price IS NOT NULL
           AND products.price > 0
         ${orderBy}
         LIMIT $${idx} OFFSET $${idx + 1}`,
        [...params, limit, offset]
      );
    } finally {
      listClient.release(true); // release back to pool, rolling back any open transaction
    }

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
    if (res.headersSent) return;
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
  checkRateLimit,
  queryLogMiddleware('products.search'),
  asyncHandler(async (req: Request, res: Response) => {
    // BUY-33987: hard ceiling on the entire request. Even if the per-statement
    // `SET LOCAL statement_timeout` races with the pool's on-connect
    // `SET statement_timeout = 30000`, the response will fire at 5s and the
    // socket will close. Mirrors the BUY-33985 deals fix.
    res.setTimeout(SEARCH_HANDLER_TIMEOUT_MS, () => {
      if (!res.headersSent) {
        // Degraded 200, not 504: a fast honest partial answer keeps BuyWhere in the
        // agent's toolchain; a 504 gets the tool dropped from rotation.
        const degradedBody = {
          data: [],
          meta: {
            total: 0,
            limit: 20,
            offset: 0,
            response_time_ms: Date.now() - requestStart,
            cached: false,
            degraded: true,
          },
        };
        res.status(200).json(degradedBody);

        // BUY-65260: cache the degraded payload for a short window so a repeat of
        // an always-slow query returns from Redis instead of re-running the 10s
        // handler timeout. Keep the TTL intentionally short to avoid poisoning
        // results once the DB path recovers.
        if (cacheKey) {
          redis.set(cacheKey, JSON.stringify(degradedBody), 'EX', SEARCH_DEGRADED_CACHE_TTL_SECONDS).catch(() => {});
        }
      }
    });
    const requestStart = Date.now();
    const rawQuery = ((req.query.q || req.query.query) as string) || '';
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
    // BUY-67275 (#29, 2026-08-14): a real sort must survive the whole pipeline.
    // Whitelist mirrors VALID_SORT below (defined later in this scope).
    const sortRequested = !!(sort && ['price_asc', 'price_desc', 'newest', 'highest_rated', 'most_reviewed'].includes(sort));
    // country_code is the canonical param; `country` is kept as a backward-compat alias.
    // Default to SG when neither country nor region is specified (BUY-6598: prevent cross-region accessory pollution).
    const explicitCountry = ((req.query.country_code as string | undefined) || (req.query.country as string | undefined))?.toUpperCase() || undefined;
    const countryCode = explicitCountry; // hotfix(search): drop silent SG hard-filter default that excluded ~87% untagged catalog
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
    // BUY-67275 (#29): an explicit sort forces the keyword path — the hybrid
    // vector/RRF rerank overrides SQL ORDER BY, so sorted+hybrid can never be
    // correct. Keyword archive path honors buildSortOrder end-to-end.
    const searchMode = sortRequested ? 'keyword' : (rawMode && VALID_SEARCH_MODES.has(rawMode) ? rawMode : DEFAULT_SEARCH_MODE);
    // deliver_to soft contract (2026-07-14): the END USER's country. Ranks local-first
    // and labels availability; never hard-filters (country_code remains the hard filter).
    const deliverTo = ((req.query.deliver_to as string) || '').toUpperCase() || undefined;
    const includeUnshippable = req.query.include_unshippable !== 'false';

    // BUY-42589: canonicalize SG retailer brand names (harvey norman, courts, gaincity, etc.)
    // to source= filters. The retailer name is in the source field, not in product titles,
    // so FTS alone returns near-zero matches even when 10k+ products exist.
    const { cleanedQuery, canonicalSources, extractedMinPrice, extractedMaxPrice } = preprocessSearchQuery(rawQuery, minPrice, maxPrice);
    const q = cleanedQuery || rawQuery;
    // BUY-2026-08-08: apply natural-language price intent ("sofa under 500", "over 1000").
    // The preprocessor strips these phrases from the FTS text but its extracted bounds
    // were previously discarded, so "under 500" returned ,400 results. Only fill when
    // the caller did not pass an explicit min_price/max_price (preprocessor already guards).
    if (minPrice === undefined && extractedMinPrice !== undefined) minPrice = extractedMinPrice;
    if (maxPrice === undefined && extractedMaxPrice !== undefined) maxPrice = extractedMaxPrice;

    // Sprint C (1.4): normalize the q component of the cache key — lowercase,
    // sorted, punctuation-stripped token set — so "Running Shoes", "running shoe s"
    // orderings and casings share one cache entry (AND/OR matching is order-
    // independent, so results are identical). Falls back to trimmed lowercase q
    // when normalization strips everything (pure-punctuation queries).
    const qNorm = q.toLowerCase().trim().split(/\s+/)
      .map((w) => w.replace(/[^\p{L}\p{N}]/gu, '')).filter(Boolean).sort().join(' ')
      || q.toLowerCase().trim();
    const cacheKey = `fts:${SG_SEARCH_FRESHNESS_GUARDRAIL_CACHE_VERSION}:${qNorm}:${domain || ''}:${region || ''}:${countryCode || ''}:${category || ''}:${categoryId || ''}:${categoryPath?.join(',') || ''}:${brand || ''}:${merchantId || ''}:${availability || ''}:${currency}:${minPrice ?? ''}:${maxPrice ?? ''}:${limit}:${offset}:${sort || ''}:${fields?.join(',') || ''}:${compact ? 'c' : 'f'}:${searchMode}:${deliverTo || ''}:${includeUnshippable ? '1' : '0'}`;
    res.locals.cacheHit = false;
    try {
      const cached = await recordQueryCacheLookup(redis, cacheKey, () => redis.get(cacheKey));
      if (cached) {
        res.locals.cacheHit = true;
        const parsed = JSON.parse(cached);
        const elapsed = Date.now() - requestStart;
        parsed.cached = true;
        parsed.response_time_ms = elapsed;
        const cachedProducts = parsed.products || parsed.results || parsed.data || [];
        recordProductViewsBulk({
          productIds: cachedProducts
            .map((product: { id?: string | number }) => product.id)
            .filter(Boolean),
          source: 'products.search.cache',
          queryHash: q ? createHash('sha256').update(q.toLowerCase()).digest('hex').slice(0, 32) : null,
          req,
        });
        res.set('Cache-Control', 'public, max-age=30, s-maxage=30');
        res.set('X-Cache', 'HIT');
        return res.json(parsed);
      }
      // Semantic cache (2026-08-06): vector-similar reuse within the same scope.
      // Scope = cacheKey minus the qNorm segment (qNorm can contain no colons).
      if (semEnabled() && q && offset === 0) {
        const semParts = cacheKey.split(':');
        const semScope = `a1:${semParts[1]}|${semParts.slice(3).join(':')}`;
        let semVec: string | null = null;
        const semGk = process.env.GEMINI_API_KEY ?? '';
        if (semGk) semVec = await getCachedQueryEmbedding(q, semGk);
        const semHit = await semLookup(redis, semScope, qNorm, semVec);
        res.locals.semScope = semScope;
        res.locals.semQNorm = qNorm;
        res.locals.semVec = semVec;
        res.locals.semCacheKey = cacheKey;
        if (semHit) {
          res.locals.cacheHit = true;
          const semParsed = JSON.parse(semHit.body);
          semParsed.cached = true;
          semParsed.semantic_cache = true;
          semParsed.response_time_ms = Date.now() - requestStart;
          res.set('Cache-Control', 'public, max-age=30, s-maxage=30');
          res.set('X-Cache', 'HIT-SEMANTIC');
          return res.json(semParsed);
        }
      }
    } catch (_) {
      // Redis miss or error — fall through to DB
    }

    // BUY-33987: only active products are surfaced to API consumers; the partial
    // GIN index `products_*_search_vector_idx WHERE is_active = true` lets the
    // planner skip dead rows and the inactive non-leaf rows that previously
    // bloated the bitmap. EXPLAIN ANALYZE on roundhouse (post-fix) shows the
    // planner switches to the partial index and execution drops to ~15-30ms.
    // BUY-60385: Exclude zero-price products from search results (deceptive $0.00
    // prices from upstream feeds). A meaningful price > $0 is a basic data quality
    // requirement for any product listing. Products with $0 prices are either
    // out-of-stock markers, missing price fields, or feed parsing errors.
    // BUY-61117: make the RAM-fitting search tier the default for keyword search.
    // Hermes QA found the archive path still returns degraded:true,total=0 for
    // common cold broad queries across SG+US. Tier-first preserves Richmond's
    // single-table archive constraints because it falls through unchanged on any
    // tier error, and SEARCH_USE_TIER=0 remains a runtime kill switch.
    const useSearchTier = req.query._tier === '1' || (req.query._tier !== '0' && process.env.SEARCH_USE_TIER !== '0');
    // BUY-72362: identifier-shaped queries (ASIN/EAN/GTIN/UPC/Apple-part) bypass
    // FTS entirely. The detector is conservative — it only matches short,
    // whitespace-free inputs against known global identifier formats, so a
    // natural-language query never reaches this branch. When it does fire, we
    // route to an exact-match lookup against `gtin`/`mpn`/`sku` and cache the
    // zero-result envelope (so `SKU-12345`-style non-matches cannot leak the
    // FTS fishing-reel noise). The vector arm is gated to `keyword` for the
    // same reason — ASIN/EAN lookup is a mechanical equality, not a similarity
    // search.
    const identifier = detectIdentifier(rawQuery);
    if (identifier && !sortRequested) {
      const handled = await tryIdentifierLookup(req, res, {
        id: identifier, countryCode, currency, limit, offset, minPrice, maxPrice,
        brand, domain, compact, requestStart, cacheKey,
        deliverTo, includeUnshippable,
      });
      if (handled) return;
    }
    // BUY-67275 (#29, 2026-08-13): the tier has its own ORDER BY (rank/accessory
    // penalty) and ignores `sort`. When the caller asks for a real sort, skip the
    // tier so the archive path (which honors buildSortOrder) serves it ordered.
    if (q && searchMode === 'keyword' && useSearchTier && !sortRequested) {
      const handled = await tryTierSearch(req, res, {
        q, countryCode, currency, limit, offset, minPrice, maxPrice,
        category, brand, domain, compact, requestStart, cacheKey,
        deliverTo, includeUnshippable,
      });
      if (handled) return;
    }

    const baseConditions: string[] = ['is_active = true', 'price > 0'];
    // BUY-72744: exclude synthetic Amazon rows with malformed ASINs (not exactly 10 chars starting with B)
    // and US-priced-as-SGD currency mismatches. The scraper fix is on main but stale catalog rows remain.
    baseConditions.push(
      "NOT (merchant_id = 'amazon.com' AND (length(sku) != 10 OR (country_code = 'US' AND currency = 'SGD')))"
    );
    // BUY-69621: HARD-exclude storage/SSD categories from device-typed queries
    // (laptop/phone/…). Flows through baseConditions into every archive + hybrid
    // candidate WHERE (recent_hits, non-FTS branch, fts_cand, semantic
    // vectorFilterQuery). No-op (fail-open) for storage queries and non-device
    // queries. Unqualified `category` matches the unaliased `products` table.
    const storageExclProducts = deviceStorageExclusionFragmentProducts(q);
    if (storageExclProducts) baseConditions.push(`1 = 1${storageExclProducts}`);
    const baseParams: unknown[] = [];
    let baseIdx = 1;
    if (minPrice !== undefined || maxPrice !== undefined) {
      baseConditions.push(`currency = $${baseIdx}`);
      baseParams.push(currency);
      baseIdx++;
    }

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
      baseConditions.push(`(country_code = $${baseIdx} OR country_code IS NULL)`);
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
    let ftsOrParamIdx = 0;
    let ftsOrFn = 'to_tsquery';
    if (q) {
      // Use full-text search via GIN-indexed search_vector only.
      // The ILIKE fallback was removed: it defeats the GIN index and causes full table scans (3s vs 130ms).
      // MATCH with OR-semantics (to_tsquery 'a | b') so a multi-word query does not require
      // EVERY lexeme in one product. plainto_tsquery AND-joined them ('run' & 'shoe') which gave
      // near-zero recall on the skewed catalog ('running shoes'->0 while 'running'->N, 'shoes'->N).
      // RANK still uses plainto_tsquery (below) so products matching MORE terms sort to the top.
      ftsParamIdx = searchParams.length + 1;      // RANK param (plainto / AND-relevance)
      searchParams.push(q);
      const tsOr = q.trim().split(/\s+/)
        .map((w) => w.replace(/[^\p{L}\p{N}]/gu, '')).filter(Boolean).join(' | ');
      // Sprint A 0.2: if q is pure punctuation, tsOr is empty — NEVER fall back to
      // feeding raw q into to_tsquery ("no operand in tsquery" -> 500). Use
      // plainto_tsquery for the OR slot instead: it is safe on arbitrary input and
      // yields an empty tsquery (0 results, 200) on junk.
      ftsOrFn = tsOr ? 'to_tsquery' : 'plainto_tsquery';
      ftsOrParamIdx = searchParams.length + 1;    // MATCH param (OR-recall)
      searchParams.push(tsOr || q);
      searchConditions.push(`search_vector @@ ${ftsOrFn}('english', $${ftsOrParamIdx})`);
    }

    // AND-first-then-OR (BUY search-tail 2026-07-03): the two match strings + a
    // multi-word flag, used at execution to try the strict plainto (AND) match
    // before the broad to_tsquery (OR) match. See execFtsQuery below.
    const ftsIsMultiWord = q ? q.trim().split(/\s+/).filter(Boolean).length > 1 : false;
    const ftsLexemes = q
      ? q.trim().split(/\s+/).map((w) => w.replace(/[^\p{L}\p{N}]/gu, '')).filter(Boolean)
      : [];
    const ftsOrMatch = `search_vector @@ ${ftsOrFn}('english', $${ftsOrParamIdx})`;
    // The OR->AND swap below drops the to_tsquery($ftsOrParamIdx) reference, which
    // would orphan that bind param (Postgres: \"could not determine data type of
    // parameter\"). Keep it referenced with an always-true typed no-op so the param
    // stays typed. tsOr is never null (we push `tsOr || q`).
    // Sprint A 1.1-delta: strict pass uses websearch_to_tsquery — same AND semantics
    // as plainto but adds quoted-phrase + '-term' support and is safe on raw input.
    const ftsAndMatch = `search_vector @@ websearch_to_tsquery('english', $${ftsParamIdx}) AND $${ftsOrParamIdx}::text IS NOT NULL`;

    // BUY-67275 (2026-08-09): with `sort=` supplied we skip ts_rank, which drops the ONLY
    // reference to the RANK bind param ($ftsParamIdx). Postgres then rejects the statement
    // with "could not determine data type of parameter $N" and the handler 500s (confirmed
    // in buywhere-api logs). Same trap, same remedy as the OR->AND swap above: keep the
    // param referenced with an always-true typed no-op.
    const ftsRankParamKeepAlive = (q && ftsParamIdx) ? ` AND $${ftsParamIdx}::text IS NOT NULL` : '';

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
               products.region, products.country_code, ${specColumnsJoined}`;

    const VALID_SORT = new Set(['relevance', 'price_asc', 'price_desc', 'newest', 'highest_rated', 'most_reviewed']);
    const effectiveSort = sort && VALID_SORT.has(sort) ? sort : undefined;
    const useFtsRanking = (!effectiveSort || effectiveSort === 'relevance') && ftsParamIdx;
    // BUY-59878: SG freshness guardrail disabled — caused GIN scan timeouts on SG queries.
    // Re-enable by setting to: countryCode === 'SG' && (!effectiveSort || effectiveSort === 'relevance') && Boolean(q);
    const useSgFreshnessGuardrail = false;
    const freshSearchConditions = useSgFreshnessGuardrail
      ? [...searchConditions, `products.updated_at >= NOW() - INTERVAL '${SG_SEARCH_FRESHNESS_GUARDRAIL_HOURS} hours'`]
      : searchConditions;
    const freshWhereClause = freshSearchConditions.length ? `WHERE ${freshSearchConditions.join(' AND ')}` : '';
    const recentSliceConditions = useSgFreshnessGuardrail
      ? [...baseConditions, `products.updated_at >= NOW() - INTERVAL '${SG_SEARCH_FRESHNESS_GUARDRAIL_HOURS} hours'`]
      : baseConditions;
    const recentSliceWhereClause = recentSliceConditions.length ? `WHERE ${recentSliceConditions.join(' AND ')}` : '';
    const broadRecentSliceWhereClause = baseConditions.length ? `WHERE ${baseConditions.join(' AND ')}` : '';

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
    // BUY-60112/60117: 5000 was too small — only 23/12062 "dog food" SG products
    // BUY-60123 v2: 50000 is too large — bounded CTE times out at 8s on prod with 1.5M fresh SG products in 48h.
    // Reducing to 2000 keeps the scan in <50ms on the index (products_sg_updated_at_idx). Recall is acceptable
    // because the bounded slice is a fallback — any results beat a degraded 8s timeout.
    // landed in the top-5000-by-id slice. 50k captures 125+ and stays ~50ms on the
    // replica ( MATERIALIZED CTE forces sequential scan of 50k rows, ~50ms cold).
    const RECENT_SLICE_CAP = 2000;

    const seoFallbackTerms = q.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 6);
    // BUY-62711: archive fallback is ONE bounded FTS pass + ONE ILIKE last-resort.
    const archiveFallbackTermConditions = seoFallbackTerms.map((_, i) => `products.title ILIKE $${baseIdx + i}`);
    const generalFallbackLimitParamIdx = baseIdx + seoFallbackTerms.length;
    const generalFallbackWhereClause = `WHERE ${[
      ...baseConditions,
      ...(archiveFallbackTermConditions.length ? [`(${archiveFallbackTermConditions.join(' OR ')})`] : []),
    ].join(' AND ')}`;
    const generalFallbackQuery = `
      SELECT ${joinedColumns}
      FROM products
      LEFT JOIN affiliate_links al ON al.product_id = products.id::text AND al.merchant_id = products.merchant_id
      ${generalFallbackWhereClause}
      ORDER BY products.updated_at DESC
      LIMIT $${generalFallbackLimitParamIdx}
    `;
    const generalFallbackParams = [
      ...baseParams,
      ...seoFallbackTerms.map((term) => `%${term}%`),
      requestedRows,
    ];

    const sendFallbackProducts = async (
      rows: Array<Record<string, unknown>>,
      source: string,
    ): Promise<void> => {
      dataResult = { rows: dedupeProductRows(rows) };
      total = dataResult.rows.length;
      hasMore = dataResult.rows.length > limit;
      if (hasMore) dataResult.rows = dataResult.rows.slice(0, limit);

      const responseTimeMs = Date.now() - requestStart;
      const fallbackProducts = dataResult.rows.map((row) =>
        buildProduct(row as Record<string, unknown>, currency, compact)
      );
      const responseBody = buildSearchResponse(
        fallbackProducts, total, limit, offset, responseTimeMs, false, undefined, hasMore
      );
      annotateDeliverTo(responseBody as unknown as Record<string, unknown>, deliverTo, includeUnshippable, q);
      redis.set(cacheKey, JSON.stringify(responseBody), 'EX', SEARCH_CACHE_TTL_SECONDS).catch(() => {});
      res.set('X-Search-Fallback', source);
      res.json(responseBody);
    };

    let dataQuery: string;
    if (useFtsRanking) {
      // BUY-59923: do not sort every FTS hit by ts_rank. High-cardinality brand
      // terms (`iphone 16 pro`, `dyson airwrap`) can match millions of SG rows;
      // `ORDER BY ts_rank(...) LIMIT 200` still computes rank for the full hit set
      // and was timing out at the 15s edge. Bound first by the partition-pruned id
      // index, then rank that small slice for response relevance.
      const rankedWhereClause = useSgFreshnessGuardrail ? freshWhereClause : whereClause;
      // BUY-77644: project rank columns (search_vector/title/category/category_path)
      // into recent_hits so the top_ids CTE can rank against the bounded candidate
      // set without a second join to products. The old plan joined products in
      // top_ids (5000 PK lookups per query) and was timing out at ~39s for samsung
      // because the access penalty's ~12-regex match costs compound on every join.
      // Selecting the needed columns in the CTE keeps the same ranking semantics
      // and runs in ~227ms for the same query.
      dataQuery = `
        WITH recent_hits AS MATERIALIZED (
          SELECT id, country_code, search_vector, title, category, category_path
          FROM products
          ${rankedWhereClause}
          -- perf(search): no ORDER BY updated_at — sorting the full FTS match set
          -- (67K–millions of rows) forced a heap scan of every match (nike cold 8.2s->0.14s,
          -- espresso machine 3.7s->0.26s). LIMIT stops early; candidates ranked by ts_rank below.
          LIMIT ${CANDIDATE_CAP}
        ), top_ids AS (
          SELECT rh.id, rh.country_code,
                 ts_rank(rh.search_vector, plainto_tsquery('english', $${ftsParamIdx})) *
                 -- BUY-63738: boost laptop products and penalize accessories
                 CASE
                   WHEN lower(rh.title) LIKE '%laptop%' OR lower(rh.title) LIKE '%notebook%' OR lower(rh.title) LIKE '%macbook%'
                     OR lower(rh.category) LIKE '%laptop%'
                     OR array_to_string(rh.category_path, ' ') LIKE '%laptop%'
                   THEN 2.0 ELSE 1.0
                 END *
                 CASE
                   WHEN rh.title ~* '${LAPTOP_ACCESSORY_PG_RE_SOURCE}'
                     OR rh.category ~* '${LAPTOP_ACCESSORY_PG_RE_SOURCE}'
                     OR array_to_string(rh.category_path, ' ') ~* '${LAPTOP_ACCESSORY_PG_RE_SOURCE}'
                   THEN 0.25 ELSE 1.0
                 END AS rank
          FROM recent_hits rh
          ORDER BY rank DESC, rh.id DESC
        )
        SELECT ${joinedColumns}, top_ids.rank AS _fts_rank
        FROM top_ids
        JOIN products ON products.id = top_ids.id
        LEFT JOIN affiliate_links al ON al.product_id = products.id::text AND al.merchant_id = products.merchant_id
        ORDER BY top_ids.rank DESC
        LIMIT $${limitParamIdx} OFFSET $${offsetParamIdx}
      `;
    } else {
      // BUY-67275 (#29, 2026-08-14): never ORDER BY over the full FTS match set —
      // sorting millions of matched rows blew the statement timeout and every cold
      // sorted query answered degraded/empty. Same remedy as the ranked branch:
      // bound candidates first (LIMIT early-stop, no ORDER BY inside the CTE),
      // then sort only that slice. Sorted results are "best N of the first
      // SORT_CANDIDATE_CAP matches", the same trade the relevance path makes.
      dataQuery = q ? `
        WITH sort_hits AS MATERIALIZED (
          SELECT id
          FROM products
          ${useSgFreshnessGuardrail ? freshWhereClause : whereClause}${ftsRankParamKeepAlive}
          LIMIT ${SORT_CANDIDATE_CAP}
        )
        SELECT ${joinedColumns}
        FROM sort_hits
        JOIN products ON products.id = sort_hits.id
        LEFT JOIN affiliate_links al ON al.product_id = products.id::text AND al.merchant_id = products.merchant_id
        ORDER BY ${buildSortOrder()}
        LIMIT $${limitParamIdx} OFFSET $${offsetParamIdx}
      ` : `
        SELECT ${joinedColumns}
        FROM products
        LEFT JOIN affiliate_links al ON al.product_id = products.id::text AND al.merchant_id = products.merchant_id
        ${useSgFreshnessGuardrail ? freshWhereClause : whereClause}${ftsRankParamKeepAlive}
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
      await client.query(`SET LOCAL gin_fuzzy_search_limit = 0`);

      // AND-first-then-OR execution (non-SG relevance multi-word queries only; SG
      // queries are already bounded by the freshness guardrail, so their OR cost is
      // capped). Try the strict plainto (AND) match first — a small, fast candidate
      // set (e.g. products literally titled \"dog food\") that avoids unioning the
      // huge \"dog\" | \"food\" posting lists on the memory-starved search replica.
      // Fall back to the broad OR match only when AND under-fills the page (preserves
      // recall for skewed-catalog terms like \"running shoes\" where no product has
      // both lexemes). Non-FTS/sorted queries just run the base query + the existing
      // SG-freshness fallback, unchanged.
      const execFtsQuery = async (baseQuery: string): Promise<{ rows: Array<Record<string, unknown>> }> => {
        if (useFtsRanking && ftsIsMultiWord) {
          // BUY-61117: the previous bounded SG path materialized a 2000-row slice of
          // ALL fresh SG products (no FTS in the CTE WHERE) then applied the FTS
          // filter after materialization. Without a (country_code, updated_at)
          // index, scanning 300M+ fresh SG rows took seconds per query, and the
          // 10-query fallback ladder exceeded the handler timeout → degraded 0-result
          // responses. Fix: include the FTS match IN the CTE WHERE so the GIN index
          // (idx_products_search_country) bounds the scan to matching products only,
          // then sort+limit the small result set. This mirrors the single-word
          // dataQuery pattern that already works in <100ms for SG.
          const runBoundedSgMatch = async (
            matchExpr: string,
            params = dataParams,
            sliceWhereClause = recentSliceWhereClause,
          ): Promise<{ rows: Array<Record<string, unknown>> }> => {
            // BUY-77644: project search_vector into the bounded CTE so top_ids can
            // rank directly without a per-row PK join back to products. Mirrors the
            // recent_hits fix above; same 227ms-vs-39s speedup.
            const boundedQuery = `
              WITH recent_candidates AS MATERIALIZED (
                SELECT id, country_code, search_vector
                FROM products
                ${sliceWhereClause}
                  AND ${matchExpr}
                -- perf(search): no ORDER BY updated_at (same early-stop fix as recent_hits above)
                LIMIT ${CANDIDATE_CAP}
              ), top_ids AS (
                SELECT rc.id, rc.country_code, ts_rank(rc.search_vector, plainto_tsquery('english', $${ftsParamIdx})) AS rank
                FROM recent_candidates rc
                ORDER BY rank DESC, rc.id DESC
                LIMIT $${limitParamIdx} OFFSET $${offsetParamIdx}
              )
              SELECT ${joinedColumns}, top_ids.rank AS _fts_rank
              FROM top_ids
              JOIN products ON products.id = top_ids.id
              LEFT JOIN affiliate_links al ON al.product_id = products.id::text AND al.merchant_id = products.merchant_id
              ORDER BY top_ids.rank DESC
            `;
            return client.query(boundedQuery, params);
          };
          if (useSgFreshnessGuardrail) {
            // BUY-61117: simplified 4-step ladder. AND match first (precise),
            // then OR match (recall). Each step tries fresh-48h first, then broad.
            // The GIN index bounds each query to matching products only, so each
            // step is fast (<100ms typical). If all 4 steps return 0 rows, the
            // outer 57014 catch fires the ILIKE timeout fallback as before.
            let boundedRes = await runBoundedSgMatch(ftsAndMatch);
            if (boundedRes.rows.length > 0) return boundedRes;
            boundedRes = await runBoundedSgMatch(ftsAndMatch, dataParams, broadRecentSliceWhereClause);
            if (boundedRes.rows.length > 0) return boundedRes;

            boundedRes = await runBoundedSgMatch(ftsOrMatch);
            if (boundedRes.rows.length > 0) return boundedRes;
            return runBoundedSgMatch(ftsOrMatch, dataParams, broadRecentSliceWhereClause);
          }

          // perf+relevance: gather via the BOUNDED id-only AND match (proven ~140ms cold,
          // both-term precise), mirroring the SG path above. The old string-swapped unbounded
          // andQuery fell through to OR-junk in prod (coffee maker -> 'Peacemaker' chair).
          const andQuery = baseQuery.split(ftsOrMatch).join(ftsAndMatch); // retained for SG-widen refs below
          let andRes = await runBoundedSgMatch(ftsAndMatch);
          // SG queries embed the freshness guardrail; if the strict AND match finds
          // nothing fresh, widen it past the freshness window before giving up on AND.
          if (useSgFreshnessGuardrail && andRes.rows.length === 0) {
            const andFresh = freshWhereClause.split(ftsOrMatch).join(ftsAndMatch);
            const andBroad = whereClause.split(ftsOrMatch).join(ftsAndMatch);
            andRes = await client.query(andQuery.replace(andFresh, andBroad), dataParams);
          }
          // BUY-60052: broad 3+ token first-touch queries can still hit the slow
          // zero-AND -> broad-OR fallback (`iphone 16 pro` was observed at 8.5s
          // degraded on a cold SG replica). Before touching OR, try bounded
          // N-1 strict passes (drop one lexeme, keep AND semantics) so common
          // modifier/model queries still return relevant rows from the same
          // recent_hits CTE without unioning huge OR posting lists.
          if (andRes.rows.length === 0 && ftsLexemes.length >= 3) {
            const relaxedQueries = [...new Map(
              ftsLexemes
                .map((lexeme, dropIdx) => ({ lexeme, query: ftsLexemes.filter((__, idx) => idx !== dropIdx).join(' ') }))
                .sort((a, b) => a.lexeme.length - b.lexeme.length)
                .map((entry) => [entry.query, entry.query])
            ).values()];
            for (const relaxedQuery of relaxedQueries) {
              const relaxedParamIdx = dataParams.length + 1;
              const relaxedMatch = `search_vector @@ websearch_to_tsquery('english', $${relaxedParamIdx}) AND $${ftsOrParamIdx}::text IS NOT NULL`;
              const relaxedSql = baseQuery.split(ftsOrMatch).join(relaxedMatch);
              const relaxedParams = [...dataParams, relaxedQuery];
              let relaxedRes = await client.query(relaxedSql, relaxedParams);
              if (useSgFreshnessGuardrail && relaxedRes.rows.length === 0) {
                const relaxedFresh = freshWhereClause.split(ftsOrMatch).join(relaxedMatch);
                const relaxedBroad = whereClause.split(ftsOrMatch).join(relaxedMatch);
                relaxedRes = await client.query(relaxedSql.replace(relaxedFresh, relaxedBroad), relaxedParams);
              }
              if (relaxedRes.rows.length > 0) return relaxedRes;
            }
          }
          // BUY-60112: the remaining zero-AND SG path was still dropping into the
          // broad OR GIN scan and returning 8s degraded empty responses for broad
          // terms (`dog food`, `wireless headphones`, `iphone 16 pro`). Keep OR
          // semantics for recall, but evaluate them over a bounded recent id slice
          // first so first-touch stays fast without re-enabling OR top-up.
          // BUY-59847: non-SG broad probes (e.g. `wireless headphones`, `baby formula`,
          // `dog food`, `nintendo switch`) had zero matches on the strict AND pass
          // then dropped into the unbounded OR top-up below. The OR scan can churn
          // the 4GB replica for the full 8s statement_timeout and return degraded
          // 0-result pages. Reuse the GIN-bounded CTE path (same as SG) over the
          // country/currency broad slice — bounded by CANDIDATE_CAP rows so the
          // scan stays index-friendly — for any zero-AND multi-word non-SG query,
          // before falling through to the unbounded OR top-up.
          if (andRes.rows.length === 0) {
            const recentSliceRes = await runBoundedSgMatch(ftsOrMatch);
            if (recentSliceRes.rows.length > 0) return recentSliceRes;
            return runBoundedSgMatch(ftsOrMatch, dataParams, broadRecentSliceWhereClause);
          }
          if (andRes.rows.length === 0 && useSgFreshnessGuardrail) {
            const recentSliceRes = await runBoundedSgMatch(ftsOrMatch);
            if (recentSliceRes.rows.length > 0) return recentSliceRes;
            return runBoundedSgMatch(ftsOrMatch, dataParams, broadRecentSliceWhereClause);
          }
          // BUY-62711: OR top-up removed. The tier now serves virtually all keyword traffic.
          // Archive path is only a fallback on tier errors.
          if (andRes.rows.length > 0) return andRes;
        }
        // BUY-67275 (#29): sorted queries skip the ranked ladders but still paid
        // the broad OR bitmap (Postgres builds the FULL union bitmap before LIMIT
        // can stop the heap fetch — 'cast iron skillet' SG timed out at 8s). Try
        // strict AND candidates first (small bitmap, better relevance for an
        // explicit sort anyway); fall back to broad OR only when AND is empty.
        if (!useFtsRanking && ftsIsMultiWord && q) {
          const andFirst = await client.query(baseQuery.split(ftsOrMatch).join(ftsAndMatch), dataParams);
          if (andFirst.rows.length > 0) return andFirst;
        }
        let r = await client.query(baseQuery, dataParams);
        if (useSgFreshnessGuardrail && r.rows.length === 0) {
          r = await client.query(baseQuery.replace(freshWhereClause, whereClause), dataParams);
        }
        return r;
      };
      const geminiKey = process.env.GEMINI_API_KEY ?? '';
      const activeVectorDb = q !== '' && searchMode !== 'keyword' && vectorDb != null && geminiKey !== ''
        ? vectorDb
        : null;

      // BUY-62711: laptop/SEO pre-empts removed - tier now serves ~99% of keyword traffic.

      if (activeVectorDb) {
        const queryVector = await getCachedQueryEmbedding(q, geminiKey);
        if (queryVector) {
          try {
            // BUY-63271: mark a savepoint before any local (client) queries so a statement
            // timeout in the hybrid FTS candidate query does not leave the transaction
            // in ABORTED state and break the fail-open FTS fallback.
            await client.query('SAVEPOINT before_vector');
            const candidateCap = Math.min(Math.max(requestedRows * 10, 200), VECTOR_CANDIDATE_CAP);
            // BUY-65476 + BUY-52089: filter by model_ver to avoid legacy 1024-dim vectors.
            // The query embedding is 512-dim (gemini-embedding-001) - only match rows with same dimension.
            // Note: When 0 results return (embed worker blocked on proxy outage), we do NOT fall back
            // to FTS silently — that would make semantic = keyword (the original bug). Instead,
            // we return 0 results, which at least makes semantic DIFFERENT from keyword.
            const semanticCandidates = await activeVectorDb.query<{ product_id: string }>(
              `SELECT product_id FROM product_embeddings
               WHERE model_ver = 'gemini-embedding-001@512'
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
                `WITH fts_cand AS MATERIALIZED (
                   SELECT id, search_vector
                   FROM products
                  ${useSgFreshnessGuardrail ? freshWhereClause : whereClause}
                   LIMIT ${CANDIDATE_CAP}
                 ), fts_top AS (
                   SELECT id
                   FROM fts_cand
                   ORDER BY ts_rank(search_vector, plainto_tsquery('english', $${ftsParamIdx})) DESC
                   LIMIT 200
                 )
                 SELECT id FROM fts_top`,
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
          } catch (vectorErr) {
            // BUY-52089: vector infra may be unavailable (e.g., dimension mismatch BUY-63231)
            // Fall back to FTS so the public API returns results instead of 500.
            // BUY-63271: roll back to the savepoint so an aborted local transaction does not
            // poison the fail-open fallback and surface as a 500.
            await client.query('ROLLBACK TO SAVEPOINT before_vector').catch(() => {});
            console.warn('[search] vector search failed, falling back to FTS:', (vectorErr as Error)?.message || vectorErr);
            dataResult = await execFtsQuery(dataQuery);
          }
        } else {
          dataResult = await execFtsQuery(dataQuery);
        }
      } else {
        dataResult = await execFtsQuery(dataQuery);
      }
      await client.query('COMMIT');
    } catch (err: unknown) {
      await client.query('ROLLBACK').catch(() => {});
      const pgErr = err as { code?: string };
      if (pgErr.code === '57014') {
        if (q && offset === 0 && !domain && !merchantId && !canonicalSources?.length) {
          try {
            await client.query('BEGIN');
            await client.query(`SET LOCAL statement_timeout = '${GENERAL_SEARCH_FALLBACK_TIMEOUT_MS}'`);
            const fallbackResult = await client.query(generalFallbackQuery, generalFallbackParams);
            await client.query('COMMIT');
            if (fallbackResult.rows.length > 0 && !res.headersSent) {
              client.release();
              await sendFallbackProducts(fallbackResult.rows, 'general_search_fallback');
              return;
            }
          } catch {
            await client.query('ROLLBACK').catch(() => {});
          }
        }
        // BUY-60112/60117 last-resort: SG multi-word zero-AND queries time out on
        // the unbounded GIN scan. Use a simple ILIKE scan — no id threshold (IDs are
        // in the trillions for this table, so id > 800000000 matches ALL rows and
        // forces a slow index scan). ORDER BY id DESC + LIMIT lets Postgres push the
        // limit into a parallel sequential scan of just the matching rows (~700ms cold).
        if (countryCode === 'SG' && ftsParamIdx && ftsIsMultiWord && !domain && !merchantId && !canonicalSources?.length) {
          try {
            const tokens = q.trim().split(/\s+/).filter(Boolean);
            const ilikeConditions = tokens.map((_, i) => `title ILIKE $${baseIdx + i}`);
            const ilikeParams = tokens.map((t) => `%${t}%`);
            const sgFallbackQuery = `
              SELECT ${joinedColumns}, 0 AS _fts_rank
              FROM products
              WHERE ${baseConditions.join(' AND ')}
                AND (${ilikeConditions.join(' AND ')})
              ORDER BY id DESC
              LIMIT $${baseIdx + tokens.length} OFFSET $${baseIdx + tokens.length + 1}
            `;
            await client.query('BEGIN');
            const sgFallbackResult = await client.query(sgFallbackQuery, [...baseParams, ...ilikeParams, requestedRows, offset]);
            await client.query('COMMIT');
            if (sgFallbackResult.rows.length > 0 && !res.headersSent) {
              client.release();
              await sendFallbackProducts(sgFallbackResult.rows, 'sg_timeout_fallback');
              return;
            }
          } catch {
            await client.query('ROLLBACK').catch(() => {});
          }
        }
        client.release();
        if (!res.headersSent) {
          res.status(200).json({
            data: [],
            meta: {
              total: 0,
              limit: 20,
              offset: 0,
              response_time_ms: 0,
              cached: false,
              degraded: true,
            },
          });
        }
        return;
      }
      // BUY-34291: shared_buffers exhaustion (SQLSTATE 53200) under load — return
      // 503 with retry hint instead of crashing. The query was correct; the DB
      // is just under memory pressure. Client should retry.
      if (pgErr.code === '53200' || (typeof (err as Error)?.message === 'string' && (err as Error).message.includes('No space left on device'))) {
        client.release();
        if (!res.headersSent) {
          res.status(503).json({ error: 'Search temporarily unavailable', reason: 'db_memory_pressure', retry_after_ms: 1000 });
        }
        return;
      }
      client.release();
      throw err;
    }
    client.release();

    // BUY-62624: collapse affiliate_links fan-out duplicates before pagination
    // math so hasMore reflects distinct results.
    dataResult.rows = dedupeProductRows(dataResult.rows);

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

    // BUY-52290: pre-compute before field-selection so IDs are never stripped.
    // Use the full products array (not filteredProducts) so no IDs are lost.
    res.locals.returnedProductIds = products.map((p) => p.id).filter(Boolean).slice(0, 100);
    res.locals.resultCount = products.length;

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
        'affiliate_url', 'click_url', 'affiliate_redirect_url',
        'has_affiliate_tracking', 'is_affiliate', 'affiliate_disclosure',
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
      filteredProducts, total, limit, offset, responseTimeMs, false, undefined, hasMore ?? false
    );
    annotateDeliverTo(responseBody as unknown as Record<string, unknown>, deliverTo, includeUnshippable, q);

    // Cache result in Redis (fire-and-forget)
    redis.set(cacheKey, JSON.stringify(responseBody), 'EX', SEARCH_CACHE_TTL_SECONDS).catch(() => {});

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

    if (res.headersSent) return;
    res.json(responseBody);
  })
);

// GET /v1/products/deals
// Returns products on sale (original_price > price), sorted by discount %
// BUY-60309: reduced timeouts (DEALS_QUERY_TIMEOUT_MS=4500, DEALS_RESPONSE_TIMEOUT_MS=5000),
// removed COUNT query, bounded sampling from recent active candidates.
// Timeout/cancel returns HTTP 200 with degraded envelope instead of 504.
// BUY-33985: dedicated client with statement_timeout + res.setTimeout to prevent hangs.
// BUY-41572: previously bumped from 5s → 15s (now reduced per BUY-60309).
const DEALS_QUERY_TIMEOUT_MS = 4500;
const DEALS_RESPONSE_TIMEOUT_MS = 5000;
const DEALS_SAMPLE_CAP = 5000; // max candidates to sample for deals
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

    // F24b (2026-08-22): deals honors deliver_to like search — annotation happens
    // post-cache on both paths so cached bodies stay per-request neutral.
    const deliverTo = (req.query.deliver_to as string | undefined)?.toUpperCase() || undefined;
    const includeUnshippable = req.query.include_unshippable !== 'false';
    const cacheKey = `deals:${currency}:${countryCode || ''}:${minDiscount}:${limit}:${offset}`;
    res.locals.cacheHit = false;
    try {
      const cached = await recordQueryCacheLookup(redis, cacheKey, () => redis.get(cacheKey));
      if (cached) {
        res.locals.cacheHit = true;
        const parsed = JSON.parse(cached);
        parsed.cached = true;
        parsed.response_time_ms = Date.now() - start;
        annotateDeliverTo(parsed as Record<string, unknown>, deliverTo, includeUnshippable, ''); // F24b
        recordProductViewsBulk({
          productIds: (parsed.products || parsed.results || parsed.data || [])
            .map((product: { id?: string | number }) => product.id)
            .filter(Boolean),
          source: 'products.deals.cache',
          req,
        });
        return res.json(parsed);
      }
    } catch (_) {}

    // Express-side response timeout. Fires after DEALS_RESPONSE_TIMEOUT_MS
    // regardless of the DB state — guarantees the socket closes within 5s
    // so the client never sees a 30s+ hang.
    // BUY-60309: returns HTTP 200 with degraded envelope instead of 504.
    res.setTimeout(DEALS_RESPONSE_TIMEOUT_MS, () => {
      if (!res.headersSent) {
        try {
          res.status(200).json({
            data: [],
            meta: {
              total: 0,
              limit: 20,
              offset: 0,
              response_time_ms: Date.now() - start,
              cached: false,
              degraded: true,
            },
          });
        } catch (_) {}
      }
    });

    // Deals: prefer discount_pct generated column (BUY-14332), fall back to inline
    // computation if the column doesn't exist yet (migration may not have run).
    // BUY-77748: price > 0 already enforced; also require price >= 5 so the deals
    // endpoint does not return items that buildProduct will nullify (PRICE_MIN=5).
    // A deal without a usable price is not a deal.
    const dealConditions: string[] = ['currency = $1', 'price > 0', 'price >= 5'];
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
        (router as any)._hasDiscountPct = false;
      }
    }
    useDiscountCol = (router as any)._hasDiscountPct;

    if (useDiscountCol) {
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
    // BUY-69340 (#36, 2026-08-14): with the generated column, ORDER BY must match
    // idx_products_deals_discount_pct (currency, discount_pct DESC) EXACTLY —
    // adding NULLS LAST / updated_at tiebreaks forces a Sort node over every
    // matching row (live EXPLAIN: 23K-cost sort -> 4.6s -> degraded empty),
    // while the bare index order early-stops at LIMIT in single-digit ms.
    // NULLS LAST is dead weight anyway: discount_pct >= min excludes NULLs.
    const dealOrderBy = useDiscountCol
      ? discountOrder
      : `${discountOrder} NULLS LAST, updated_at DESC`;

    // BUY-60309: removed COUNT query and added bounded sampling.
    // Sample recent active candidates, then filter/order that bounded slice.
    // BUY-45692: deals is a heavy aggregate rollup — route to the read replica
    // when available (readDb() falls back to primary if unconfigured or lagging),
    // isolating it from interactive /v1/products/search on the primary.
    const dealsClient = await readDb().connect();
    let deals: ReturnType<typeof buildProduct>[] = [];
    let total = 0;
    let degraded = false;
    try {
      // BUY-34291: cap work_mem too (same shared_buffers pressure reasoning as search)
      await dealsClient.query(`SET work_mem = '${SEARCH_WORK_MEM}'`);
      await dealsClient.query(`SET statement_timeout = ${DEALS_QUERY_TIMEOUT_MS}`);

      // BUY-64112: direct index-backed strict deal query.
      // The partial index idx_products_deals_country/region supports a direct
      // query matching its predicate (discount_pct IS NOT NULL AND price > 0
      // AND is_active = true), so ORDER BY discount_pct DESC + LIMIT/OFFSET is
      // sub-ms and needs no candidate window. Previously the bounded
      // updated_at sample (LIMIT DEALS_SAMPLE_CAP) excluded deals older than
      // the recent window, returning empty for healthy regions.
      const dealLimitIdx = dealIdx;
      dealParams.push(limit);
      const dealLimitParam = `$${dealLimitIdx}`;
      dealIdx++;
      const dealOffsetIdx = dealIdx;
      dealParams.push(offset);
      const dealOffsetParam = `$${dealOffsetIdx}`;
      dealIdx++;

      const dealResult = await dealsClient.query(
        `SELECT id, sku AS source_id, source AS domain, url,
                title, price, (metadata->>'original_price')::numeric AS original_price,
                currency, image_url, metadata, updated_at,
                region, country_code, created_at, description, brand, mpn, gtin,
                category_path, category, merchant_id, avg_rating, review_count,
                ${discountSelect}
         FROM products
         WHERE ${dealWhere}
         ORDER BY ${dealOrderBy}
         LIMIT ${dealLimitParam}::int OFFSET ${dealOffsetParam}::int`,
        dealParams
      );

      const sampleDeals = dealResult.rows;
      total = sampleDeals.length;
      deals = sampleDeals.map((row) =>
        buildProduct(row as Record<string, unknown>, currency, false)
      );
    } catch (err: unknown) {
      // BUY-60309: on timeout/cancel, return HTTP 200 degraded instead of crashing
      const pgErr = err as { code?: string };
      if (pgErr.code === '57014' || pgErr.code === '57000') {
        // Query cancelled or statement timeout
        degraded = true;
        deals = [];
        total = 0;
      } else {
        throw err; // Re-throw other errors
      }
    } finally {
      dealsClient.release();
    }

    const responseBody = buildSearchResponse(deals, total, limit, offset, Date.now() - start, false, degraded);
    // BUY-2026-08-13 (#36): NEVER cache a degraded (timed-out) deals payload — one slow
    // moment froze an empty response into the 1h cache and every later call re-served it
    // (the fossilized response_time_ms 4519/4554 signature). Cache real-but-empty briefly.
    if (!degraded) {
      const dealsTtl = deals.length === 0 ? 60 : SEARCH_CACHE_TTL_SECONDS;
      redis.set(cacheKey, JSON.stringify(responseBody), 'EX', dealsTtl).catch(() => {});
    }

    // BUY-52474: log a product_view per deals card so /v1/products/deals drives
    // product_views growth alongside /search and /:id.
    recordProductViewsBulk({
      productIds: deals.map((p) => p.id),
      source: 'products.deals',
      req,
    });

    annotateDeliverTo(responseBody as unknown as Record<string, unknown>, deliverTo, includeUnshippable, ''); // F24b
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
    if (!PRODUCT_ID_RE.test(String(id))) {
      res.status(400).json({ error: 'Invalid product id; id must be a positive integer' });
      return;
    }
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
    if (!PRODUCT_ID_RE.test(String(id))) {
      res.status(400).json({ error: 'Invalid product id; id must be a positive integer' });
      return;
    }
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
    // if pool exhaustion (from a slow vectorDb KNN) would otherwise hang. The prior
    // version of this hook only logged and never sent a response, leaving clients
    // hanging until their own socket timeout. The handler now races its work against
    // this deadline and responds 504 if it loses.
    let timedOut = false;
    res.setTimeout(SEARCH_HANDLER_TIMEOUT_MS, () => {
      timedOut = true;
      console.warn(`[products.similar] request timed out after ${SEARCH_HANDLER_TIMEOUT_MS}ms (id=${req.params.id})`);
      if (!res.headersSent) {
        res.status(504).json({ error: 'Find-Similar timed out', meta: { response_time_ms: Date.now() - start } });
      }
    });
    const { id } = req.params;
    if (!PRODUCT_ID_RE.test(String(id))) {
      if (!timedOut && !res.headersSent) res.status(400).json({ error: 'Invalid product id; id must be a positive integer' });
      return;
    }
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

// GET /v1/products/featured
// Keep this route above /:id so Express does not treat "featured" as a product id.
router.get(
  '/featured',
  agentDetectMiddleware,
  requireApiKey,
  checkRateLimit,
  queryLogMiddleware('products.featured'),
  asyncHandler(async (req: Request, res: Response) => {
    const start = Date.now();
    const rawCountry = (req.query.country_code as string | undefined) || (req.query.country as string | undefined);
    const countryCode = rawCountry?.toUpperCase() || 'SG';
    const currency = (req.query.currency as string) || (COUNTRY_CURRENCY[countryCode] || 'SGD');
    const limit = Math.min(parseInt((req.query.limit as string) || '12'), 50);
    const offset = Math.max(parseInt((req.query.offset as string) || '0'), 0);
    const compact = req.query.compact === 'true';

    const cacheKey = `featured:${countryCode}:${currency}:${limit}:${offset}:${compact ? 'c' : 'f'}`;
    res.locals.cacheHit = false;
    try {
      const cached = await recordQueryCacheLookup(redis, cacheKey, () => redis.get(cacheKey));
      if (cached) {
        res.locals.cacheHit = true;
        const parsed = JSON.parse(cached);
        parsed.cached = true;
        parsed.response_time_ms = Date.now() - start;
        recordProductViewsBulk({
          productIds: (parsed.products || parsed.results || parsed.data || [])
            .map((product: { id?: string | number }) => product.id)
            .filter(Boolean),
          source: 'products.featured.cache',
          req,
        });
        return res.json(parsed);
      }
    } catch (_) {}

    // BUY-77835: route featured to the country partition (or parent fallback)
    // so it does not scan the 413GB parent table. This mirrors the /v1/products
    // list routing and fixes the empty-response regression under primary I/O saturation.
    // BUY-77920: wrap readDb() in try/catch so the endpoint falls back to primary
    // if the replica is unreachable rather than 500-ing at the LB timeout.
    const FEATURED_TABLE = /^[A-Z]{2}$/.test(countryCode)
      ? `products_partitioned_${countryCode.toLowerCase()}`
      : 'products';
    // BUY-77920: do not AND currency into ORDER BY id DESC — newest SG rows are
    // USD and the planner walks the id index for 30s. Featured is "recent
    // in-market listings", not "recent listings in the viewer's currency".
    const featuredSql = `
         SELECT id, sku AS source_id, source AS domain, url,
                NULL::text AS affiliate_url,
                title, price, currency, image_url, metadata, updated_at,
                region, country_code
         FROM ${FEATURED_TABLE}
         WHERE is_active = true
           AND country_code = $1
           AND price IS NOT NULL
         ORDER BY id DESC
         LIMIT $2 OFFSET $3`;
    let featuredDb = readDb();
    let result;
    try {
      result = await featuredDb.query(featuredSql, [countryCode, limit, offset]);
    } catch (err) {
      console.warn(`[products:featured] readDb() query failed, falling back to primary: ${(err as Error).message}`);
      featuredDb = db;
      result = await featuredDb.query(featuredSql, [countryCode, limit, offset]);
    }

    const products = result.rows.map((row: Record<string, unknown>) => buildProduct(row, currency, compact));
    const responseBody = buildSearchResponse(products, products.length, limit, offset, Date.now() - start, false);
    redis.set(cacheKey, JSON.stringify(responseBody), 'EX', 300).catch(() => {});
    res.set('Cache-Control', 'public, max-age=60, s-maxage=300');
    res.json(responseBody);
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
    if (!PRODUCT_ID_RE.test(String(id))) {
      res.status(400).json({ error: 'Invalid product id; id must be a positive integer' });
      return;
    }

    let result;
    try {
      result = await db.query(
        `SELECT id, sku AS source_id, source AS domain, url,
                title, price, currency, image_url, metadata, updated_at,
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
      // BUY-67275 (#37, 2026-08-14): this key must byte-match the live search
      // handler's cacheKey (VER prefix + normalized q + trailing
      // searchMode/deliverTo/includeUnshippable segments) or every warm write is
      // dead weight the handler never reads — which is exactly what happened
      // after the key format grew. Defaults: compact=f, mode=DEFAULT_SEARCH_MODE,
      // deliver_to='', include_unshippable=1.
      const qNorm = q.toLowerCase().trim().split(/\s+/)
        .map((w) => w.replace(/[^\p{L}\p{N}]/gu, '')).filter(Boolean).sort().join(' ')
        || q.toLowerCase().trim();
      const cacheKey = `fts:${SG_SEARCH_FRESHNESS_GUARDRAIL_CACHE_VERSION}:${qNorm}:::${country}:::::::${currency}:::${limit}:${offset}:::f:${DEFAULT_SEARCH_MODE}::1`;

      const existing = await redis.get(cacheKey).catch(() => null);
      if (existing) {
        skipped++;
        continue;
      }

      // Sprint C: stagger cold warm-queries so the 4-min loop doesn't stampede
      // the replica with all seeds at once.
      await new Promise((resolve) => setTimeout(resolve, 1500));

      // Build the query the same way the handler does
      // BUY-33987: include `is_active = true` so the warm CTE matches the
      // handler's CTE exactly AND so the planner can pick the partial GIN
      // index `products_*_search_vector_idx WHERE is_active = true`. Without
      // this, the warm path is slower than the live path and the warm cache
      // becomes a liability instead of an asset.
      const conditions: string[] = ['currency = $1', 'is_active = true', 'price > 0'];
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
        JOIN products ON products.id = top_ids.id
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
      const responseBody = buildSearchResponse(products, total, limit, offset, 0, false, undefined, hasMore);

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
// TEST TRIGGER - Sun Aug 30 03:59:22 UTC 2026
