import { Router, Request, Response, NextFunction } from 'express';
import { db, redis, vectorDb } from '../config';
import { embedQuery } from '../jobs/embedProducts';
import { requireApiKey, checkRateLimit } from '../middleware/apiKey';
import { queryLogMiddleware } from '../middleware/queryLog';
import { recordQueryCacheLookup } from '../monitoring/cacheStats';
import { buildErrorEnvelope, ErrorCode, ErrorCodeType } from '../middleware/errors';
import { buildProduct, buildSearchResponse, COUNTRY_CURRENCY, CURRENCY_RATES, deriveEmptiness, SUPPORTED_REGIONS } from '../lib/response';
import { getCachedFxRates } from '../lib/fxRatesLoader';
import { buildDeviceFilter } from '../lib/deviceClassifier';

const router = Router();

// BUY-56185: Detect statement_timeout poisoned connections.
// When PostgreSQL's statement_timeout fires, the query is cancelled but the
// connection enters PQTRANS_INERROR state. Returning such a connection to the
// pool poises every subsequent query on it with "current transaction is aborted".
// client.state returns 'error' in this state — discard instead of reusing.
function releaseClientSafely(client: any) {
  try {
    if (client && typeof client.state === 'string' && client.state === 'error') {
      client.release(true); // discard — do NOT return poisoned connection to pool
    } else {
      client.release();
    }
  } catch (_) {
    // Swallow release errors — pool will remove the bad client anyway.
  }
}

type McpMarket = { country: string; dbRegion: string; rawRegion: string };

function normalizeMcpMarket(args: Record<string, unknown>, defaultCountry = ''): McpMarket {
  const rawRegion = String(args.region || '').trim();
  const regionLower = rawRegion.toLowerCase();
  const explicitCountry = String(
    (args.deliver_to as string) || (args.country_code as string) || (args.country as string) || ''
  ).trim().toUpperCase();
  const regionCountry: Record<string, string> = {
    us: 'US',
    sea: 'SG',
    sg: 'SG',
    my: 'MY',
    th: 'TH',
    vn: 'VN',
    ph: 'PH',
    id: 'ID',
    gb: 'GB',
    uk: 'GB',
    in: 'IN',
    au: 'AU',
  };
  const regionLooksIso = /^[A-Z]{2}$/.test(rawRegion);
  const regionCountryCode = regionCountry[regionLower] || (regionLooksIso ? rawRegion : '');
  return {
    country: explicitCountry || regionCountryCode || defaultCountry,
    dbRegion: rawRegion && !regionLooksIso ? regionLower : '',
    rawRegion,
  };
}

// MCP tools manifest
const TOOLS = [
  {
    name: 'search_products',
    description: 'Search the BuyWhere product catalog by keyword. Returns products from e-commerce platforms across multiple regions (Singapore, US, etc.). Use compact=true for agent-optimized responses with structured_specs, comparison_attributes, and normalized_price_usd fields.',
    inputSchema: {
      type: 'object',
      properties: {
        api_version: { type: 'string', enum: ['v1', 'v2'], description: 'Tool surface version. v1 (default) keeps deliver_to optional for backward compatibility. v2 (BUY-71817, P2.7) requires deliver_to as a non-empty ISO-3166 alpha-2 string; calls without it return INVALID_ARGUMENT. Recommended for new integrations.', default: 'v1' },
        deliver_to: { type: 'string', description: 'Buyer\'s ISO 3166-1 alpha-2 country code (e.g. "SG", "US", "MY", "TH", "VN"). ALWAYS pass this — it scopes results to products deliverable to that market, ranks them local-first, and labels availability per row. Takes precedence over country_code and country. REQUIRED on api_version=v2.', pattern: '^[A-Z]{2}$' },
        q: { type: 'string', description: 'Keyword search query' },
        query: { type: 'string', description: 'Alias for q (accepted for agent convenience; use q)' },
        domain: { type: 'string', description: 'Filter by merchant platform (e.g. lazada, shopee, amazon)' },
        region: { type: 'string', description: 'Filter by region (sea, us, eu, au)' },
        country_code: { type: 'string', enum: ['SG', 'US', 'VN', 'TH', 'MY'], description: 'Filter by ISO country code. Also infers default currency for price filters (SG→SGD, US→USD, VN→VND, TH→THB, MY→MYR).' },
        country: { type: 'string', description: 'Alias for country_code (deprecated, use country_code)' },
        min_price: { type: 'number', description: 'Minimum price (in currency inferred from country_code, or SGD by default)' },
        max_price: { type: 'number', description: 'Maximum price (in currency inferred from country_code, or SGD by default)' },
        limit: { type: 'integer', description: 'Number of results (max 100, default 20)', default: 20 },
        offset: { type: 'integer', description: 'Pagination offset', default: 0 },
        compact: { type: 'boolean', description: 'Return agent-optimized compact shape: structured_specs, comparison_attributes, normalized_price_usd. Reduces response size ~40%. Recommended for agent tool-use.', default: false },
        category: { type: 'string', description: 'Filter by product category name (e.g. "Laptops", "Smartphones", "Televisions"). Use to exclude accessories and get actual products.' },
        mode: { type: 'string', enum: ['keyword', 'semantic', 'hybrid'], description: 'Search mode: keyword=FTS only, semantic=vector only, hybrid=RRF blend of FTS+vector (default). Falls back to keyword if vector DB or GEMINI_API_KEY unavailable.', default: 'hybrid' },
      },
    },
  },
  {
    name: 'get_product',
    description: 'Get a specific product by its ID, including full details and current price.',
    inputSchema: {
      type: 'object',
      required: ['id'],
      properties: {
        id: { type: 'string', description: 'Product UUID' },
      },
    },
  },
  {
    name: 'compare_products',
    description: 'Compare multiple products side-by-side. Returns price, brand, rating, and category for each.',
    inputSchema: {
      type: 'object',
      required: ['ids'],
      properties: {
        ids: {
          type: 'array',
          items: { type: 'string' },
          description: 'Array of product IDs to compare (2-10)',
          minItems: 2,
          maxItems: 10,
        },
      },
    },
  },
  {
    name: 'get_deals',
    description: 'Get discounted products sorted by discount percentage. Returns products with original price and discount percentage. Supports currency, region (sea, us, eu, au) and country (SG, US, VN, MY, ...) filters.',
    inputSchema: {
      type: 'object',
      properties: {
        api_version: { type: 'string', enum: ['v1', 'v2'], description: 'Tool surface version. v1 (default) keeps deliver_to optional for backward compatibility. v2 (BUY-71817, P2.7) requires deliver_to as a non-empty ISO-3166 alpha-2 string; calls without it return INVALID_ARGUMENT. Recommended for new integrations.', default: 'v1' },
        deliver_to: { type: 'string', description: 'Buyer\'s ISO 3166-1 alpha-2 country code (e.g. "SG", "US"). REQUIRED on api_version=v2.', pattern: '^[A-Z]{2}$' },
        min_discount: { type: 'number', description: 'Minimum discount percentage (default 10)', default: 10 },
        currency: { type: 'string', description: 'Filter by currency code (SGD, USD, MYR, VND, THB). Defaults to SGD.', default: 'SGD' },
        region: { type: 'string', description: 'Filter by region (sea, us, eu, au)' },
        country_code: { type: 'string', enum: ['SG', 'US', 'VN', 'TH', 'MY'], description: 'Filter by ISO country code. Alias: country.' },
        country: { type: 'string', description: 'Alias for country_code (deprecated, use country_code)' },
        limit: { type: 'integer', description: 'Number of results (max 100, default 20)', default: 20 },
        offset: { type: 'integer', description: 'Pagination offset', default: 0 },
      },
    },
  },
  {
    name: 'list_categories',
    description: 'List top-level product categories available in the BuyWhere catalog.',
    inputSchema: {
      type: 'object',
      properties: {
        region: { type: 'string', enum: ['us', 'sg', 'my', 'gb', 'in', 'au'], description: 'Region alias mapped to ISO country code.' },
        country_code: { type: 'string', enum: ['SG', 'US', 'VN', 'TH', 'MY', 'GB', 'IN', 'AU'], description: 'Filter by ISO country code. Defaults to SG.' },
        country: { type: 'string', description: 'Alias for country_code (deprecated, use country_code)' },
      },
    },
  },
  {
    name: 'find_best_price',
    description: 'Use this whenever a user asks about prices, wants to find the cheapest option, or asks "what\'s the best price for X" or "where can I buy X for the lowest price". This finds the best current price across all merchants.',
    inputSchema: {
      type: 'object',
      required: ['product_name'],
      properties: {
        api_version: { type: 'string', enum: ['v1', 'v2'], description: 'Tool surface version. v1 (default) keeps deliver_to optional for backward compatibility. v2 (BUY-71817, P2.7) requires deliver_to as a non-empty ISO-3166 alpha-2 string; calls without it return INVALID_ARGUMENT. Recommended for new integrations.', default: 'v1' },
        deliver_to: { type: 'string', description: 'Buyer\'s ISO 3166-1 alpha-2 country code (e.g. "SG", "US"). REQUIRED on api_version=v2.', pattern: '^[A-Z]{2}$' },
        product_name: { type: 'string', description: 'Product name to find best price for (e.g., "iphone 15 pro 256gb", "samsung galaxy s24")' },
        category: { type: 'string', description: 'Category to filter by (e.g., "electronics", "fashion")' },
        country_code: { type: 'string', enum: ['SG', 'MY', 'TH', 'PH', 'VN', 'ID', 'US'], description: 'Country to search in (defaults to SG). Alias: country.' },
        country: { type: 'string', description: 'Alias for country_code (deprecated, use country_code)' },
        region: { type: 'string', enum: ['us', 'sea'], description: 'Region filter - use "us" for United States or "sea" for Southeast Asia' },
      },
    },
  },
  {
    name: 'find_similar',
    description: 'Find products similar to a given product using vector similarity. Returns up to 10 nearest neighbours by semantic meaning (title+description embedding). Useful for "more like this" recommendations.',
    inputSchema: {
      type: 'object',
      required: ['product_id'],
      properties: {
        product_id: { type: 'string', description: 'UUID of the source product' },
        limit: { type: 'integer', description: 'Number of similar products to return (1-10, default 10)', default: 10 },
      },
    },
  },
  {
    name: 'ingest_products',
    description: 'Ingest (upsert) a batch of products into the BuyWhere catalog. Use this to add or update product listings from any merchant/source. Requires a valid API key with ingest permissions. Accepts up to 1000 products per call with source, SKU, title, price, URL, and optional metadata.',
    inputSchema: {
      type: 'object',
      required: ['source', 'products'],
      properties: {
        source: { type: 'string', description: 'Data source identifier (e.g. "shopee_sg", "amazon_sg", "lazada_sg")' },
        products: {
          type: 'array',
          description: 'Array of product objects to ingest (max 1000)',
          items: {
            type: 'object',
            required: ['sku', 'merchant_id', 'title', 'price', 'url'],
            properties: {
              sku: { type: 'string', description: 'Unique stock keeping unit identifier' },
              merchant_id: { type: 'string', description: 'Merchant identifier' },
              title: { type: 'string', description: 'Product title' },
              description: { type: 'string', description: 'Product description' },
              price: { type: 'number', description: 'Current price (must be >= 0)' },
              currency: { type: 'string', description: 'Currency code (default: SGD)', default: 'SGD' },
              url: { type: 'string', description: 'Product URL on the merchant site' },
              image_url: { type: 'string', description: 'Main product image URL' },
              category: { type: 'string', description: 'Product category' },
              brand: { type: 'string', description: 'Brand name' },
              is_active: { type: 'boolean', description: 'Whether the product is active (default: true)' },
              is_available: { type: 'boolean', description: 'Whether the product is in stock' },
              country_code: { type: 'string', description: 'ISO country code (e.g. "SG", "US")' },
              region: { type: 'string', description: 'Region identifier (e.g. "sea", "us")' },
              metadata: { type: 'object', description: 'Additional product metadata' },
            },
          },
        },
      },
    },
  },
];

let _hasDiscountPct: boolean | undefined;

async function probeDiscountPctColumn(): Promise<boolean> {
  try {
    const probe = await db.query(
      `SELECT is_generated FROM information_schema.columns WHERE table_name = 'products' AND column_name = 'discount_pct' LIMIT 1`
    );
    return probe.rows.length > 0 && probe.rows[0].is_generated === 'ALWAYS';
  } catch {
    return false;
  }
}

probeDiscountPctColumn().then(result => { _hasDiscountPct = result; }).catch(() => {});

// Tool handlers
async function handleSearchProducts(args: Record<string, unknown>) {
  const t0 = Date.now();
  // BUY-70288 re-apply: accept the `query` alias for `q` so agent-natural
  // calls don't silently fall into the no-q browse branch (which returns
  // a fabricated reltuples-derived "total" with 0 rows).
  const q = (args.q as string) || (args.query as string) || '';
  const mode = (args.mode as string) || 'hybrid';
  const geminiKey = process.env.GEMINI_API_KEY ?? '';
  const useVector = vectorDb != null && geminiKey !== '' && q !== '' && mode !== 'keyword';
  const domain = (args.domain as string) || '';
  const region = (args.region as string) || '';
  // BUY-71817 / P2.7: deliver_to takes precedence over country_code/country (matches
  // normalizeMcpMarket used by get_deals/find_best_price). When v2 caller passes
  // deliver_to=SG we want the same SG-scoped result as v1 with deliver_to=SG, so
  // we resolve through the same precedence chain here.
  // BUY-6598: Default to SG for search queries. BUY-31962: skip default for
  // empty-q browse mode — no index on country_code makes filtered scan slow,
  // and recent rows are predominantly US/null so SG filter finds nothing.
  const rawCountry = (((args.deliver_to as string) || (args.country_code as string) || (args.country as string)) || '').toUpperCase();
  const hasExplicitCountry = !!(args.deliver_to || args.country_code || args.country);
  const country = rawCountry || (q && !region ? 'SG' : '');
  const category = (args.category as string) || '';
  const minPrice = args.min_price != null ? Number(args.min_price) : null;
  const maxPrice = args.max_price != null ? Number(args.max_price) : null;
  const limit = Math.min(Number(args.limit) || 20, 100);
  const offset = Number(args.offset) || 0;
  const compact = args.compact === true;
  const currency = country ? (COUNTRY_CURRENCY[country] || 'SGD') : 'SGD';

  const cacheKey = `fts:${q}:${domain}:${region}:${country}:${category}:${currency}:${minPrice}:${maxPrice}:${limit}:${offset}:${compact ? 'c' : 'f'}:${useVector ? mode : 'kw'}`;
  try {
    const cached = await recordQueryCacheLookup(redis, cacheKey, () => redis.get(cacheKey));
    if (cached) {
      const parsed = JSON.parse(cached);
      if (parsed.results) {
        return { ...parsed, cached: true, response_time_ms: Date.now() - t0 };
      }
    }
  } catch (_) { /* redis miss — proceed */ }

  const conditions: string[] = ['is_active = true'];
  const params: unknown[] = [];

  if (q) {
    params.push(q);
    conditions.push(`search_vector @@ plainto_tsquery('english', $${params.length})`);
  }
  if (domain) {
    params.push(domain);
    conditions.push(`source = $${params.length}`);
  }
  if (minPrice != null) {
    params.push(minPrice);
    conditions.push(`price >= $${params.length}`);
  }
  if (maxPrice != null) {
    params.push(maxPrice);
    conditions.push(`price <= $${params.length}`);
  }
  if (region) {
    params.push(region);
    conditions.push(`region = $${params.length}`);
  }
  if (country) {
    params.push(country.toUpperCase());
    conditions.push(`country_code = $${params.length}`);
  }
  if (category) {
    params.push(`%${category}%`);
    conditions.push(`category ILIKE $${params.length}`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  let rows: unknown[];
  let total: number;

  // BUY-57370: catch pool exhaustion fast — under concurrent load (e.g. Tune
  // automated testing), the 50-connection pool can saturate when US-partition
  // queries hold connections for 5-12s. Without .catch(), the raw pg PoolError
  // (string code like '57P01') escapes to the outer handler which checks
  // typeof code === 'number' — fails for string codes — and returns the
  // opaque -32603 "Internal error" that Tune detected.
  const searchClient = await db.connect().catch((err) => {
    console.warn('[search_products] db.connect failed:', err.message);
    throw { code: -32603, message: 'Database connection timeout — pool may be exhausted' };
  });
  try {
    // BUY-56185: reduced from 30s to 12s — keyword+country FTS on 14M rows should
    // complete within 12s via GIN index; anything longer signals plan regression or
    // pool exhaustion. Failing fast prevents cascading connection starvation.
    await searchClient.query('SET statement_timeout = 12000');
    await searchClient.query('SET work_mem = \'256MB\''); // BUY-65095: bump from 64MB to 256MB — 389M rows GIN bitmap heap scan needs >128MB to stay under 12s statement_timeout. 64MB was timing out on count(*) and candidate subqueries even with LIMIT 1001.
    const COUNT_CAP = 1001;
    if (q) {
      const countResult = await searchClient.query(
        `SELECT COUNT(*) FROM (SELECT 1 FROM products ${where} LIMIT ${COUNT_CAP}) _sub`,
        params
      );
      total = parseInt(countResult.rows[0].count, 10);

      // BUY-31962 / BUY-41138: hybrid search (RRF) or keyword FTS fallback.
      // Hybrid and semantic paths embed the query via Jina AI, query the vector DB
      // separately, then merge in application code (two separate PG instances).
      if (useVector) {
        // Embed query (retrieval.query task); Redis-cache 60s keyed by base64 query
        let queryVec: string | null = null;
        try {
          const embedKey = `qembed:${Buffer.from(q).toString('base64').slice(0, 48)}`;
          queryVec = await recordQueryCacheLookup(redis, embedKey, () => redis.get(embedKey));
          if (!queryVec) {
            queryVec = await embedQuery(q, geminiKey);
            await redis.set(embedKey, queryVec, 'EX', 60).catch(() => {});
          }
        } catch (embedErr) {
          console.warn('[search] embed query failed, falling back to FTS:', (embedErr as Error).message);
        }

        if (queryVec && vectorDb) {
          let candidateIds: string[] = [];
          let vectorCandidateIds: string[] | null = null;

          if (mode === 'semantic') {
            // Vector-only: fetch top-200 nearest neighbours from vector DB, then fetch details
            try {
              // BUY-68327: api.buywhere.ai/mcp can still point at a mixed-dimension
              // vector table. Restrict to the 512-dim Gemini model and fail open to
              // keyword FTS if pgvector still rejects the query.
              const vecRows = await vectorDb.query<{ product_id: string }>(
                `SELECT product_id FROM product_embeddings
                 WHERE model_ver = 'gemini-embedding-001@512'
                 ORDER BY embedding <=> $1::vector LIMIT 200`,
                [queryVec]
              );
              vectorCandidateIds = vecRows.rows.map(r => r.product_id).slice(0, limit + offset);
            } catch (vecErr) {
              console.warn('[search] vector query failed, falling back to FTS:', (vecErr as Error).message);
              vectorCandidateIds = null;
            }
          } else {
            // Hybrid: app-level RRF of FTS ranks + vector ranks
            let vecRows: { product_id: string }[] = [];
            let ftsRows: { id: string }[] = [];
            try {
              // BUY-68327: keep vector failures (including 512/1024 dimension
              // mismatch) from rejecting the whole hybrid request.
              const vecResult = await vectorDb.query<{ product_id: string }>(
                `SELECT product_id FROM product_embeddings
                 WHERE model_ver = 'gemini-embedding-001@512'
                 ORDER BY embedding <=> $1::vector LIMIT 200`,
                [queryVec]
              );
              vecRows = vecResult.rows;
            } catch (vecErr) {
              console.warn('[search] hybrid vector query failed, FTS only:', (vecErr as Error).message);
            }
            try {
              const ftsResult = (await searchClient.query(
                `SELECT id FROM products ${where} LIMIT 200`,
                params
              )) as { rows: { id: string }[] };
              ftsRows = ftsResult.rows;
            } catch (ftsErr) {
              console.warn('[search] hybrid FTS query failed:', (ftsErr as Error).message);
            }
            const ftsRank = new Map(ftsRows.map((r, i) => [r.id, i + 1]));
            const vecRank = new Map(vecRows.map((r, i) => [r.product_id, i + 1]));
            const allIds = new Set([...ftsRank.keys(), ...vecRank.keys()]);
            candidateIds = [...allIds]
              .map(id => ({
                id,
                score: 1 / (60 + (ftsRank.get(id) ?? 201)) + 1 / (60 + (vecRank.get(id) ?? 201)),
              }))
              .sort((a, b) => b.score - a.score)
              .slice(0, limit + offset)
              .map(s => s.id);
          }

          if (vectorCandidateIds !== null) {
            candidateIds = vectorCandidateIds;
          }
          total = candidateIds.length;
          const pageIds = candidateIds.slice(offset, offset + limit);

          if (pageIds.length === 0) {
            rows = [];
          } else {
            const detailParams: unknown[] = [...pageIds];
            const ph = pageIds.map((_, i) => `$${i + 1}`).join(',');
            const detailConditions = [`id IN (${ph})`, 'is_active = true'];
            if (country) {
              detailParams.push(country.toUpperCase());
              detailConditions.push(`country_code = $${detailParams.length}`);
            }
            if (region) {
              detailParams.push(region);
              detailConditions.push(`region = $${detailParams.length}`);
            }
            const detailResult = await searchClient.query(
              `SELECT id, sku AS source, source AS domain, url, title,
                      price, currency, image_url, metadata, updated_at, region, country_code
               FROM products WHERE ${detailConditions.join(' AND ')}`,
              detailParams
            );
            // Preserve ranking order
            const byId = new Map((detailResult.rows as Array<Record<string, unknown>>).map((r) => [(r as Record<string, unknown>).id as string, r]));
            rows = pageIds.map(id => byId.get(id)).filter(Boolean) as Record<string, unknown>[];
          }
        } else {
          // Embed failed — fall through to keyword FTS
          const CANDIDATE_LIMIT = Math.min((limit + offset) * 10, 5000);
          params.push(CANDIDATE_LIMIT, limit, offset);
          const result = await searchClient.query(
            `SELECT * FROM (
               SELECT id, sku AS source, source AS domain, url, title,
                      price, currency, image_url, metadata, updated_at, region, country_code
               FROM products ${where}
               LIMIT $${params.length - 2}
             ) _candidates
             ORDER BY updated_at DESC
             LIMIT $${params.length - 1} OFFSET $${params.length}`,
            params
          );
          rows = result.rows;
        }
      } else {
        // Keyword (FTS) path — BUY-31962 subquery pattern
        const CANDIDATE_LIMIT = Math.min((limit + offset) * 10, 5000);
        params.push(CANDIDATE_LIMIT, limit, offset);
        const result = await searchClient.query(
          `SELECT * FROM (
             SELECT id, sku AS source, source AS domain, url, title,
                    price, currency, image_url, metadata, updated_at, region, country_code
             FROM products ${where}
             LIMIT $${params.length - 2}
           ) _candidates
           ORDER BY updated_at DESC
           LIMIT $${params.length - 1} OFFSET $${params.length}`,
          params
        );
        rows = result.rows;
      }
    } else {
      // No FTS — browse mode. Use reltuples for approximate total and fetch
      // recent products via idx_products_updated_at (3ms for 500 rows).
      // If user explicitly passed country_code/region, overfetch and filter
      // in-application (no composite index on country_code+updated_at).
      const approxResult = await searchClient.query(
        `SELECT reltuples::bigint AS estimate FROM pg_class WHERE relname = 'products'`
      );
      total = parseInt(approxResult.rows[0]?.estimate ?? '0', 10);

      const needsFilter = !!(country || region);
      const fetchLimit = needsFilter ? Math.min((limit + offset) * 20, 5000) : limit + offset;
      const rawResult = await searchClient.query(
        `SELECT id, sku AS source, source AS domain, url, title,
                price, currency, image_url, metadata, updated_at,
                region, country_code
         FROM products
         ORDER BY updated_at DESC
         LIMIT $1`,
        [fetchLimit]
      );
      if (needsFilter) {
        let filtered = rawResult.rows as Record<string, unknown>[];
        if (country) {
          filtered = filtered.filter(r => (r.country_code as string || '').toUpperCase() === country);
        }
        if (region) {
          filtered = filtered.filter(r => (r.region as string || '').toLowerCase() === region.toLowerCase());
        }
        rows = filtered.slice(offset, offset + limit);
      } else {
        rows = (rawResult.rows as unknown[]).slice(offset, offset + limit);
      }
    }
  } finally {
    // BUY-56185: always use safe release to discard connections poisoned by statement_timeout
    releaseClientSafely(searchClient);
  }

  // BUY-65095: when the query is a device-family term (laptop, phone, tablet),
  // post-filter FTS results to drop obvious accessories that the GIN index scores
  // high but are not the device itself (cleaners, privacy screens, dust plugs,
  // extenders, bags, sleeves, etc.). The GIN rank can't distinguish these so
  // they crowd out real products on sparse queries.
  const deviceFilter = buildDeviceFilter(q, country);
  let filteredRows = rows as Record<string, unknown>[];
  if (deviceFilter.type && q.trim().length < 30) {
    const neg = deviceFilter.negativeTerms;
    filteredRows = (rows as Record<string, unknown>[]).filter(r => {
      const text = [
        String(r.title || ''),
        String((r.category as string) || ''),
        String((r.category_path as string[] || []).join(' ')),
      ].join(' ').toLowerCase();
      const hasNeg = neg.some(t => text.includes(t));
      if (hasNeg) return false;
      // Also catch "for X inch" patterns — likely cases/covers
      if (/\bfor\b.*\d+\s*(inch|cm)\b/i.test(text)) return false;
      // Catch "laptop sleeve" / "laptop bag" / "laptop stand" etc.
      if (/\blaptop\s+(sleeve|bag|stand|case|cover|skin|filter|cleaner|extender|adapter|hub|dock)/i.test(text)) return false;
      return true;
    });
    if (filteredRows.length === 0 && rows.length > 0) {
      // Don't silently drop all results — fall back to unfiltered
      filteredRows = rows as Record<string, unknown>[];
      console.warn(`[search] laptop filter dropped all ${rows.length} results for q="${q}", reverting`);
    }
  }

  const products = filteredRows.map(r =>
    buildProduct(r, currency, compact)
  );

  const result = buildSearchResponse(
    products, total!, limit, offset, Date.now() - t0, false
  );

  // BUY-71542 / P2.6: apply emptiness metadata to empty search responses
  await applyEmptiness('search_products', result as unknown as Record<string, unknown>, {
    regionSupported: country ? SUPPORTED_REGIONS.has(country) : true,
    categoryRequested: !!category,
    requestedCategory: category || null,
    requestedCountry: country || null,
  }, Date.now() - t0);

  try {
    await redis.set(cacheKey, JSON.stringify(result), 'EX', 60);
  } catch (_) { /* cache write failure is non-fatal */ }

  return result;
}

async function handleGetProduct(args: Record<string, unknown>) {
  const t0 = Date.now();
  const { id } = args;

  if (!id || typeof id !== 'string' || !id.trim()) {
    throw { code: -32602, message: 'missing required parameter: id' };
  }

  let result;
  try {
    result = await db.query(
      `SELECT id, sku AS source, source AS domain, url, title,
              price, currency, image_url, brand, category_path,
              avg_rating AS rating, review_count, metadata, updated_at, region, country_code
       FROM products WHERE id = $1`,
      [id.trim()]
    );
  } catch {
    throw { code: -32001, message: 'Product not found' };
  }
  if (!result.rows.length) throw { code: -32001, message: 'Product not found' };
  const product = buildProduct(result.rows[0] as Record<string, unknown>, 'SGD', false);
  return buildSearchResponse([product], 1, 1, 0, Date.now() - t0, false);
}

async function handleCompareProducts(args: Record<string, unknown>) {
  const t0 = Date.now();
  const ids = args.ids as string[];
  if (!ids || !Array.isArray(ids) || ids.length < 2) {
    throw { code: -32602, message: 'Provide at least 2 product IDs' };
  }
  if (ids.length > 10) {
    throw { code: -32602, message: 'Provide at most 10 product IDs' };
  }
  const validIds = ids.filter((id) => id != null && String(id).trim());
  if (validIds.length < 2) {
    throw { code: -32602, message: 'Provide at least 2 valid product IDs' };
  }
  if (validIds.length > 10) {
    throw { code: -32602, message: 'Provide at most 10 valid product IDs' };
  }
  const placeholders = validIds.map((_, i) => `$${i + 1}`).join(',');
  let result;
  try {
    result = await db.query(
      `SELECT id, sku AS source, source AS domain, url, title,
              price, currency, image_url, brand, category_path,
              avg_rating AS rating, review_count, metadata, updated_at, region, country_code
       FROM products WHERE id IN (${placeholders})`,
      validIds
    );
  } catch {
    throw { code: -32001, message: 'Products not found' };
  }
  const products = result.rows.map((r: Record<string, unknown>) => buildProduct(r, 'SGD', false));
  return buildSearchResponse(products, products.length, validIds.length, 0, Date.now() - t0, false);
}

async function handleGetDeals(args: Record<string, unknown>) {
  const t0 = Date.now();
  const minDiscount = Number(args.min_discount) || 10;
  const market = normalizeMcpMarket(args);
  const region = market.rawRegion;
  const effectiveCountry = market.country;
  const currency = ((args.currency as string) || (effectiveCountry ? COUNTRY_CURRENCY[effectiveCountry] : '') || 'SGD').toUpperCase();
  const limit = Math.min(Number(args.limit) || 20, 100);
  const offset = Number(args.offset) || 0;

  const cacheKey = `deals_mcp:v2:${currency}:${minDiscount}:${region}:${region}:${effectiveCountry}:${limit}:${offset}`;
  try {
    const cached = await redis.get(cacheKey);
    if (cached) {
      const parsed = JSON.parse(cached);
      if (parsed.results) {
        return { ...parsed, cached: true, response_time_ms: Date.now() - t0 };
      }
    }
  } catch (_) {}

  // BUY-68615: hardcode true — production catalog DB has discount_pct GENERATED ALWAYS column.
  // The probe can mis-detect on cold pool connections; bypass it to use the fast indexed path.
  const useDiscountCol = true;
  

  const conditions: string[] = [
    `currency = $1`,
    `price > 0`,
    `is_active = true`,
  ];
  if (useDiscountCol) {
    conditions.push(`discount_pct >= $2`);
  } else {
    // Guard: only consider rows where original_price is a valid numeric string.
    // Matches the partial index predicate on idx_products_deals_country/region.
    conditions.push(`metadata->>'original_price' ~ '^[0-9]+(\\.[0-9]+)?$'`);
    conditions.push(`(metadata->>'original_price')::numeric > price`);
    conditions.push(`((1 - price / NULLIF((metadata->>'original_price')::numeric, 0)) * 100) >= $2`);
  }
  const params: unknown[] = [currency, minDiscount];

  if (region) {
    params.push(region);
    conditions.push(`region = $${params.length}`);
  }
  if (effectiveCountry) {
    params.push(effectiveCountry);
    conditions.push(`country_code = $${params.length}`);
  }

  const whereClause = conditions.join(' AND ');

  const discountSelect = useDiscountCol
    ? 'discount_pct'
    : `ROUND(((1 - price / NULLIF((metadata->>'original_price')::numeric, 0)) * 100)::numeric, 1) AS discount_pct`;
  const discountOrder = useDiscountCol
    ? 'discount_pct DESC'
    : `(1 - price / NULLIF((metadata->>'original_price')::numeric, 0)) DESC`;

  // Use dedicated client with bounded statement_timeout so a slow deals scan returns
  // a structured -32603 envelope to the MCP client instead of hanging the request.
  let products: ReturnType<typeof buildProduct>[] = [];
  let total = 0;
  const dealsClient = await db.connect().catch((err: unknown) => {
    console.error('[mcp] get_deals db.connect failed:', err);
    throw { code: -32603, message: 'Database unavailable' };
  });
  try {
    // BUY-64112: strict discount-first query only. The prior recent-window sample
    // + laptop/watch fallback returned keyword rows with discount_pct=0 and hid
    // real discounted products. Query the indexed discount predicate directly.
    // BUY-69354: fail-fast floor. At 400M+ rows, the planner underestimates the matching set
    // so ORDER BY over all matching rows times out. Use ordered index walk (ORDER BY discount_pct DESC)
    // to enable early-stop at candidateLimit, then filter/sort in-memory. 15s is the max wait
    // before we surface a graceful "no deals found" instead of hanging the client.
    await dealsClient.query('SET statement_timeout = 15000');
    // BUY-68615 originally forced enable_seqscan=off but at 400M+ rows this causes
    // timeouts (the index path is slower than seqscan when table is clustered by insertion).
    // Let the planner decide dynamically; the bounded LIMIT helps regardless.
    // Also: remove region/effectiveCountry from the SQL WHERE - those filters cause a heap scan
    // at 400M rows (no composite index). Apply them in-memory after the candidate fetch.
    const candidateLimit = 2000;
    const sqlParams = [currency, minDiscount, candidateLimit];
    const candidateResult = await dealsClient.query(
      `SELECT id, sku AS source, source AS domain, url, title,
              price,
              CASE WHEN metadata->>'original_price' ~ '^[0-9]+(\\.[0-9]+)?$'
                   THEN (metadata->>'original_price')::numeric ELSE NULL END AS original_price,
              currency, image_url, metadata, updated_at, region, country_code,
              ${discountSelect}
       FROM products
       WHERE currency = $1 AND price > 0 AND is_active = true
         AND discount_pct >= $2
       ORDER BY discount_pct DESC, updated_at DESC
       LIMIT $3`,
      sqlParams
    );
    // Apply region/country_code filters in-memory (these are not indexed and would cause heap scan)
    let filtered = candidateResult.rows;
    if (region) {
      filtered = filtered.filter((r: Record<string, unknown>) => r.region === region);
    }
    if (effectiveCountry) {
      filtered = filtered.filter((r: Record<string, unknown>) => r.country_code === effectiveCountry);
    }
    // Sort the filtered candidates by discount (desc) then updated_at (desc), then paginate.
    const sortedCandidates = filtered.sort(
      (a: Record<string, unknown>, b: Record<string, unknown>) => {
        const da = (a.discount_pct as number | null) ?? -1;
        const db = (b.discount_pct as number | null) ?? -1;
        if (da !== db) return db - da;
        const ua = new Date(a.updated_at as string).getTime();
        const ub = new Date(b.updated_at as string).getTime();
        return ub - ua;
      }
    );
    const paginated = sortedCandidates.slice(offset, offset + limit);
    // total reflects the bounded candidate window; the true full count is unbounded to compute.
    total = filtered.length;
    products = paginated.map((r: Record<string, unknown>) =>
      buildProduct(r, currency, false)
    );
  } finally {
    // BUY-56185: discard connections poisoned by statement_timeout
    releaseClientSafely(dealsClient);
  }

  const result = buildSearchResponse(products, total, limit, offset, Date.now() - t0, false);
  // BUY-60068: surface `meta.unavailable:true` when both the strict discount filter
  // and the regional fallback returned zero rows for the requested region/country,
  // so callers can distinguish "no live deals" from "server bug".
  if ((region || effectiveCountry) && products.length === 0) {
    (result as { unavailable?: boolean }).unavailable = true;
  }

  // BUY-71542 / P2.6: apply emptiness metadata
  await applyEmptiness('get_deals', result as unknown as Record<string, unknown>, {
    regionSupported: effectiveCountry ? SUPPORTED_REGIONS.has(effectiveCountry) : true,
    requestedCountry: effectiveCountry || null,
  }, Date.now() - t0);

  redis.set(cacheKey, JSON.stringify(result), 'EX', 60).catch(() => {});

  return result;
}

// Single-flight guard: at most one DB scan runs per country at a time.
// Concurrent cache-misses coalesce on the same Promise instead of spawning N parallel GROUP-BY scans.
const categoryListInflight = new Map<string, Promise<{ data: unknown[]; meta: Record<string, unknown> }>>();

async function handleListCategories(args: Record<string, unknown>) {
  const t0 = Date.now();
  const country = normalizeMcpMarket(args, 'SG').country;
  const cacheKey = `categories_mcp:top100:${country}`;

  // 1. Redis fast path
  try {
    const cached = await redis.get(cacheKey);
    if (cached) {
      const parsed = JSON.parse(cached);
      if (Array.isArray(parsed.data) && parsed.data.length > 0) {
        return { ...parsed, meta: { ...parsed.meta, cached: true, response_time_ms: Date.now() - t0 } };
      }
    }
  } catch (_) {}

  // 2. Single-flight: if a query is already in-flight for this country, piggyback on it
  const inflight = categoryListInflight.get(country);
  if (inflight) {
    const result = await inflight;
    return { ...result, meta: { ...result.meta, cached: true, response_time_ms: Date.now() - t0 } };
  }

  // 3. No in-flight query — start one and register it so concurrent callers coalesce
  const queryPromise = (async () => {
    const client = await db.connect().catch((err) => {
      console.warn('[list_categories] db.connect failed:', err.message);
      throw { code: -32603, message: 'Database connection timeout — pool may be exhausted' };
    });
    try {
      await client.query('SET statement_timeout = 8000');
      await client.query('SET work_mem = \'256MB\''); // BUY-65095: bump work_mem — fallback category scan benefits from larger bitmap heap
      const tableCheck = await client.query(
        `SELECT to_regclass('public.mcp_category_summary_by_country') AS tbl`
      );
      let rows: Array<{ slug: string; name: string; product_count: number }> = [];
      if (tableCheck.rows[0]?.tbl) {
        const summaryResult = await client.query(
          `SELECT slug, name, product_count
           FROM mcp_category_summary_by_country
           WHERE country_code = $1
           ORDER BY product_count DESC
           LIMIT 100`,
          [country]
        );
        rows = summaryResult.rows;
      }
      if (rows.length === 0) {
        // BUY-60056: materialized view is empty/stale in production. Instead of
        // returning unavailable or running a full-table GROUP BY, sample recent
        // products through the updated_at path and derive a bounded category list.
        const fallbackResult = await client.query(
          `SELECT slug, slug AS name, COUNT(*)::int AS product_count
           FROM (
             SELECT category_path, country_code
             FROM products
             ORDER BY updated_at DESC
             LIMIT 50000
           ) _recent_categories
           CROSS JOIN LATERAL (SELECT category_path[1] AS slug) _cat
           WHERE country_code = $1 AND slug IS NOT NULL
           GROUP BY slug
           ORDER BY product_count DESC
           LIMIT 100`,
          [country]
        );
        rows = fallbackResult.rows;
      }
      if (rows.length === 0) {
        rows = ['Electronics', 'Computers', 'Mobile Phones', 'Home', 'Fashion'].map((name) => ({
          slug: name.toLowerCase().replace(/\s+/g, '-'),
          name,
          product_count: 0,
        }));
      }
      const data = {
        data: rows,
        meta: { total: rows.length, country_code: country, response_time_ms: 0, cached: false, unavailable: false },
      };
      redis.set(cacheKey, JSON.stringify(data), 'EX', 600).catch(() => {}); // 10 min TTL
      return data;
    } finally {
      releaseClientSafely(client);
    }
  })();

  categoryListInflight.set(country, queryPromise);
  try {
    const result = await queryPromise;
    // BUY-71542 / P2.6: apply emptiness metadata (data may be non-empty because
    // of hardcoded fallback, but probe still useful for unknown markets)
    await applyEmptiness('list_categories', result as unknown as Record<string, unknown>, {
      regionSupported: SUPPORTED_REGIONS.has(country),
      requestedCountry: country,
    }, Date.now() - t0);
    return { ...result, meta: { ...result.meta, response_time_ms: Date.now() - t0 } };
  } finally {
    categoryListInflight.delete(country);
  }
}

async function handleFindBestPrice(args: Record<string, unknown>) {
  const t0 = Date.now();
  const productName = (args.product_name as string) || '';
  if (!productName) throw { code: -32602, message: 'product_name is required' };

  const market = normalizeMcpMarket(args, 'SG');
  const country = market.country;
  const region = market.rawRegion;
  const category = (args.category as string) || '';
  const limit = 10;

  // BUY-67522: infer exact device-family queries and reject accessory results.
  const deviceFilter = buildDeviceFilter(productName, country);

  const CANDIDATE_POOL = Math.max(limit * 50, 500);

  // BUY-31962: same subquery pattern as search_products — fetch candidates via GIN
  // index (no sort), then ORDER BY price ASC on the small candidate set. Avoids the
  // O(N log N) full-sort that causes the 10s/30s timeout on large FTS result sets.
  // BUY-57258: add connect timeout so pool exhaustion fails fast; reduce statement_timeout
  // to 5s to prevent cascading connection starvation during contention.
  // BUY-69646: the prior heap-scan candidate window (`ORDER BY updated_at DESC LIMIT 50000`
  // over the whole table) times out at catalog scale (400M+ rows). Drive candidates from the
  // search_vector GIN index with a bounded LIMIT instead — same proven pattern as the
  // mcp-railway fbp handler and search_products.
  const bestPriceClient = await db.connect().catch((err) => {
    console.warn('[find_best_price] db.connect failed:', err.message);
    throw { code: -32603, message: 'Database connection timeout' };
  });
  let result: { rows: Record<string, unknown>[] };
  try {
    await bestPriceClient.query('SET statement_timeout = 10000');
    await bestPriceClient.query('SET work_mem = \'256MB\''); // BUY-65095: bump work_mem — 389M rows GIN bitmap heap scan needs >128MB to stay under 10s timeout
    const requestedCountry = country;
    const minPrice = deviceFilter.minLocal > 0 ? deviceFilter.minLocal : 0;
    const conditions: string[] = ['is_active = true', 'price > 0'];
    const params: unknown[] = [];
    params.push(productName);
    conditions.push(`search_vector @@ plainto_tsquery('english', $${params.length})`);
    params.push(requestedCountry);
    conditions.push(`country_code = $${params.length}`);
    if (minPrice > 0) {
      params.push(minPrice);
      conditions.push(`price >= $${params.length}`);
    }
    params.push(CANDIDATE_POOL);
    const candidateWhere = conditions.join(' AND ');
    result = await bestPriceClient.query(
      `SELECT * FROM (
         SELECT id, title, price, currency, source AS domain, url, image_url,
                country_code, updated_at, category, category_path, metadata
         FROM products
         WHERE ${candidateWhere}
         LIMIT $${params.length}
       ) _candidates
       ORDER BY price ASC, updated_at DESC
       LIMIT $${params.length + 1}`,
      [...params, limit]
    );
  } finally {
    // BUY-56185: discard connections poisoned by statement_timeout
    releaseClientSafely(bestPriceClient);
  }

  const currency = COUNTRY_CURRENCY[country] || 'SGD';
  const rates = getCachedFxRates();
  const toUsd = rates[currency] ?? CURRENCY_RATES[currency] ?? 1;

  const neg = deviceFilter.negativeTerms;

  const isAccessory = (r: Record<string, unknown>) => {
    if (!deviceFilter.type) return false;
    const metadata = (r.metadata && typeof r.metadata === 'object') ? r.metadata as Record<string, unknown> : {};
    const text = [
      String(r.title || ''),
      String((r.category_path as string[] | undefined)?.join(' ') || ''),
      String((r.category as string) || ''),
      String(metadata.category || ''),
      String(metadata.product_type || ''),
    ].join(' ').toLowerCase();
    const positiveSignals: string[] = [];
    if (deviceFilter.type === 'phone') positiveSignals.push('smartphone', 'mobile phone', 'mobile phones');
    if (deviceFilter.type === 'console') positiveSignals.push('game console', 'gaming console', 'consoles');
    if (deviceFilter.type === 'laptop') positiveSignals.push('laptop', 'notebook');
    if (deviceFilter.type === 'tablet') positiveSignals.push('tablet');
    if (deviceFilter.type === 'wearable') positiveSignals.push('smart watch', 'smartwatch', 'fitness tracker');
    const hasPositive = positiveSignals.some(s => text.includes(s));
    const hasNegative = neg.some(t => text.includes(t));
    if (!hasNegative && hasPositive) return false;
    if (hasNegative && !hasPositive) return true;
    if (/\bfor\b.*\b(iphone|galaxy|ipad|ps5|xbox|macbook)\b.*\b\d+\b.*(protector|case|cover|glass|film|cable|adapter|charger|controller|game)\b/.test(text)) return true;
    if (/\bcompatible\b/.test(text) && hasNegative) return true;
    return false;
  };

  const candidates = result.rows.filter(r => !isAccessory(r));

  const data = candidates.map((r: Record<string, unknown>) => ({
    id: r.id,
    title: r.title,
    price: { amount: r.price != null ? parseFloat(r.price as string) : null, currency: r.currency || currency },
    normalized_price_usd: r.price != null ? Math.round(Number(r.price) * toUsd * 100) / 100 : null,
    merchant: r.domain as string,
    url: r.url as string,
    image_url: r.image_url as string,
    country_code: r.country_code as string,
  }));

  const finalResult = {
    best_price: data[0] ?? null,
    alternatives: data.slice(1),
    meta: { total: data.length, country: country || (region.toLowerCase() === 'us' ? 'US' : 'SG'), response_time_ms: Date.now() - t0 },
  };

  // BUY-71542 / P2.6: apply emptiness metadata
  await applyEmptiness('find_best_price', finalResult as unknown as Record<string, unknown>, {
    regionSupported: country ? SUPPORTED_REGIONS.has(country) : true,
    categoryRequested: !!category,
    requestedCategory: category || null,
    requestedCountry: country || null,
  }, Date.now() - t0);

  return finalResult;
}

// BUY-31929: MCP tool to ingest products — delegates to the same logic as
// POST /v1/ingest/products but via JSON-RPC tool call.
async function handleIngestProducts(args: Record<string, unknown>) {
  const t0 = Date.now();
  const source = String(args.source || '');
  const products = args.products;

  if (!source || source === 'undefined') {
    throw { code: -32602, message: 'Missing required parameter: source' };
  }
  if (!Array.isArray(products) || products.length === 0) {
    throw { code: -32602, message: 'Missing required parameter: products (non-empty array)' };
  }
  if (products.length > 1000) {
    throw { code: -32602, message: 'Maximum 1000 products per request' };
  }

  // Normalize source (reuse the same mapping as the REST endpoint)
  const SOURCE_NORMALIZATION: Record<string, string> = {
    'challenger': 'challenger_sg',
    'challenger.sg': 'challenger_sg',
    'challenger_sg': 'challenger_sg',
    'amazon_sg_toys': 'amazon_sg',
    'ikea.com.sg': 'ikea_sg',
  };
  const normalizedSource = SOURCE_NORMALIZATION[source] || source;

  // Validate each product
  interface ValidProduct {
    sku: string; merchant_id: string; title: string; description?: string;
    price: number; currency: string; url: string; image_url?: string;
    category?: string; category_path?: string[]; brand?: string;
    is_active?: boolean; is_available?: boolean; in_stock?: boolean;
    stock_level?: string; country_code?: string; region?: string;
    metadata?: Record<string, unknown>;
  }
  const validProducts: ValidProduct[] = [];
  const errors: Array<{ index: number; sku: string; error: string }> = [];

  for (let i = 0; i < products.length; i++) {
    const p = products[i] as Record<string, unknown> | null;
    if (!p || typeof p !== 'object') {
      errors.push({ index: i, sku: 'unknown', error: 'Not an object' });
      continue;
    }
    const sku = typeof p.sku === 'string' ? p.sku : '';
    if (!sku) { errors.push({ index: i, sku: 'unknown', error: 'Missing sku' }); continue; }
    if (!p.merchant_id || typeof p.merchant_id !== 'string') { errors.push({ index: i, sku, error: 'Missing merchant_id' }); continue; }
    if (!p.title || typeof p.title !== 'string') { errors.push({ index: i, sku, error: 'Missing title' }); continue; }
    if (p.price === undefined || p.price === null || typeof p.price !== 'number' || p.price < 0) { errors.push({ index: i, sku, error: 'Missing or invalid price' }); continue; }
    if (!p.url || typeof p.url !== 'string') { errors.push({ index: i, sku, error: 'Missing url' }); continue; }

    validProducts.push({
      sku,
      merchant_id: String(p.merchant_id),
      title: String(p.title).slice(0, 1000),
      price: p.price,
      currency: typeof p.currency === 'string' ? p.currency : 'SGD',
      url: String(p.url),
      description: typeof p.description === 'string' ? String(p.description).slice(0, 5000) : undefined,
      image_url: typeof p.image_url === 'string' ? p.image_url : undefined,
      category: typeof p.category === 'string' ? p.category : undefined,
      category_path: Array.isArray(p.category_path) ? p.category_path.map(String).slice(0, 10) : undefined,
      brand: typeof p.brand === 'string' ? String(p.brand).slice(0, 200) : undefined,
      is_active: typeof p.is_active === 'boolean' ? p.is_active : undefined,
      is_available: typeof p.is_available === 'boolean' ? p.is_available : undefined,
      in_stock: typeof p.in_stock === 'boolean' ? p.in_stock : undefined,
      stock_level: typeof p.stock_level === 'string' ? p.stock_level : undefined,
      country_code: typeof p.country_code === 'string' ? p.country_code : undefined,
      region: typeof p.region === 'string' ? p.region : undefined,
      metadata: (p.metadata && typeof p.metadata === 'object') ? p.metadata as Record<string, unknown> : undefined,
    });
  }

  if (validProducts.length === 0) {
    return {
      status: 'failed',
      rows_inserted: 0, rows_updated: 0, rows_failed: errors.length,
      errors,
      response_time_ms: Date.now() - t0,
    };
  }

  // Create ingestion run record
  let runId: number | null = null;
  try {
    const runResult = await db.query(
      `INSERT INTO ingestion_runs (source, status) VALUES ($1, 'running') RETURNING id`,
      [normalizedSource]
    );
    runId = runResult.rows[0]?.id || null;
  } catch (e) {
    console.warn('[mcp:ingest] Failed to create ingestion run record:', (e as Error).message);
  }

  // Check existing SKUs. The unique constraint is (sku, source, country_code), so
  // the pre-existing check must match — a (sku, source) hit in another country is a
  // different row. Use a values join for the composite match.
  const existingSkus = new Set<string>();
  const skuToId = new Map<string, number>();
  if (validProducts.length > 0) {
    const tuples = validProducts
      .map((p) => `('${p.sku.replace(/'/g, "''")}','${normalizedSource.replace(/'/g, "''")}','${(p.country_code || '').replace(/'/g, "''")}')`)
      .join(',');
    const existingResult = await db.query(
      `SELECT id, sku, source, country_code FROM products
         WHERE (sku, source, country_code) IN (${tuples})`
    );
    for (const r of existingResult.rows as { id: number; sku: string; source: string; country_code: string }[]) {
      const key = `${r.sku} ${r.source} ${r.country_code}`;
      existingSkus.add(key);
      skuToId.set(key, r.id);
    }
  }

  let rowsInserted = 0;
  let rowsUpdated = 0;

  try {
    const values: unknown[] = [];
    const placeholders: string[] = [];

    for (const p of validProducts) {
      const base = values.length + 1;
      const metadata: Record<string, unknown> = {
        ...(p.metadata || {}),
        origin_merchant_id: p.merchant_id,
        category: p.category || null,
      };
      if (p.in_stock !== undefined) metadata.in_stock = p.in_stock;
      if (p.stock_level !== undefined) metadata.stock_level = p.stock_level;
      if (p.is_available !== undefined) metadata.is_available = p.is_available;

      const catPath = (p.category_path && p.category_path.length > 0)
        ? `{${p.category_path.map(c => `"${c.replace(/"/g, '\\"')}"`).join(',')}}`
        : '{}';

      values.push(
        p.sku, normalizedSource, p.merchant_id, p.title,
        p.description || null,
        p.price, p.currency || 'SGD',
        p.url, p.image_url || null,
        catPath,
        p.brand || null,
        JSON.stringify(metadata),
        p.is_active !== false,
        // products is partitioned by country_code; the partition's `region`
        // column is NOT NULL and the column default ('sg') only applies when
        // the column is omitted from the INSERT. We're listing the column,
        // so we must supply a value. Default to country_code lowercased,
        // then 'sg' as the last-resort fallback.
        p.region || (p.country_code ? p.country_code.toLowerCase() : null) || 'sg',
        p.country_code || null,
      );

      placeholders.push(
        `($${base},$${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6},$${base + 7},$${base + 8},$${base + 9},$${base + 10},$${base + 11},$${base + 12},$${base + 13},$${base + 14})`
      );
    }

    await db.query(
      `INSERT INTO products
         (sku, source, merchant_id, title, description, price, currency, url,
          image_url, category_path, brand, metadata, is_active, region, country_code)
       VALUES ${placeholders.join(', ')}
       ON CONFLICT (sku, source, country_code)
       DO UPDATE SET
         title = EXCLUDED.title,
         description = EXCLUDED.description,
         price = EXCLUDED.price,
         currency = EXCLUDED.currency,
         url = EXCLUDED.url,
         image_url = COALESCE(NULLIF(EXCLUDED.image_url, ''), products.image_url),
         brand = EXCLUDED.brand,
         category_path = EXCLUDED.category_path,
         merchant_id = EXCLUDED.merchant_id,
         metadata = EXCLUDED.metadata,
         is_active = true,
         region = COALESCE(EXCLUDED.region, products.region),
         country_code = COALESCE(EXCLUDED.country_code, products.country_code),
         updated_at = NOW()`,
      values
    );

    for (const p of validProducts) {
      const key = `${p.sku} ${normalizedSource} ${p.country_code || ''}`;
      if (existingSkus.has(key)) {
        rowsUpdated++;
      } else {
        rowsInserted++;
      }
    }
  } catch (e) {
    const msg = (e as Error).message;
    console.error('[mcp:ingest] Bulk upsert failed:', msg);

    if (runId !== null) {
      await db.query(
        `UPDATE ingestion_runs SET status = 'failed', error_message = $1, finished_at = NOW() WHERE id = $2`,
        [msg.slice(0, 500), runId]
      ).catch(() => {});
    }

    return {
      run_id: runId, status: 'failed',
      rows_inserted: 0, rows_updated: 0, rows_failed: validProducts.length,
      errors: [{ index: -1, sku: 'batch', error: `Database error: ${msg}` }, ...errors],
      response_time_ms: Date.now() - t0,
    };
  }

  // Insert price history
  const finalResult = await db.query(
    `SELECT id, sku, source, country_code FROM products
       WHERE (sku, source, country_code) IN (${validProducts
         .map((p) => `('${p.sku.replace(/'/g, "''")}','${normalizedSource.replace(/'/g, "''")}','${(p.country_code || '').replace(/'/g, "''")}')`)
         .join(',')})`
  );
  for (const r of finalResult.rows as { id: number; sku: string; source: string; country_code: string }[]) {
    skuToId.set(`${r.sku} ${r.source} ${r.country_code}`, r.id);
  }

  const phValues: unknown[] = [];
  const phPlaceholders: string[] = [];
  for (const p of validProducts) {
    const productId = skuToId.get(`${p.sku} ${normalizedSource} ${p.country_code || ''}`);
    if (productId) {
      const base = phValues.length + 1;
      phValues.push(productId, p.price, p.currency || 'SGD', normalizedSource);
      phPlaceholders.push(`($${base},$${base + 1},$${base + 2},$${base + 3})`);
    }
  }
  if (phValues.length > 0) {
    try {
      await db.query(
        `INSERT INTO price_history (product_id, price, currency, source) VALUES ${phPlaceholders.join(', ')}`,
        phValues
      );
    } catch (e) {
      console.warn('[mcp:ingest] Price history insert failed:', (e as Error).message);
    }
  }

  const status = errors.length === 0 ? 'completed' : 'completed_with_errors';
  if (runId !== null) {
    await db.query(
      `UPDATE ingestion_runs SET status = $1, rows_inserted = $2, rows_updated = $3, rows_failed = $4, finished_at = NOW() WHERE id = $5`,
      [status, rowsInserted, rowsUpdated, errors.length, runId]
    ).catch(() => {});
  }

  // Invalidate caches
  if (rowsInserted > 0 || rowsUpdated > 0) {
    try {
      const keys = await redis.keys('products:*');
      if (keys.length > 0) await redis.del(...keys);
      const searchKeys = await redis.keys('search:*');
      if (searchKeys.length > 0) await redis.del(...searchKeys);
      await redis.set(`bw:ingestion:last_success:${normalizedSource}`, String(Date.now() / 1000));
    } catch (e) {
      console.warn('[mcp:ingest] Cache invalidation failed:', (e as Error).message);
    }
  }

  return {
    run_id: runId,
    status,
    rows_inserted: rowsInserted,
    rows_updated: rowsUpdated,
    rows_failed: errors.length,
    errors: errors.length > 0 ? errors : undefined,
    response_time_ms: Date.now() - t0,
  };
}


async function handleFindSimilar(args: Record<string, unknown>) {
  const t0 = Date.now();
  const productId = (args.product_id as string || '').trim();
  const limit = Math.min(Number(args.limit) || 10, 10);

  if (!productId) {
    throw { code: -32602, message: 'missing required parameter: product_id' };
  }

  // product_embeddings.product_id is bigint; reject non-numeric IDs upfront so the
  // SQL parameter doesn't blow up with "invalid input syntax for type bigint".
  // BUY-59390 — previously the handler exposed -32603 raw SQL errors.
  if (!/^\d+$/.test(productId)) {
    throw { code: -32602, message: `Invalid product_id format: expected numeric ID, got "${productId}"` };
  }

  if (!vectorDb) {
    throw { code: -32001, message: 'Vector search not available — vector DB not configured' };
  }

  // Step 1: get reference embedding from vector DB
  let refResult;
  try {
    refResult = await vectorDb.query<{ embedding: string }>(
      `SELECT embedding::text FROM product_embeddings WHERE product_id = $1`,
      [productId]
    );
  } catch {
    throw { code: -32001, message: 'No embedding found for this product — backfill may still be running' };
  }
  if (!refResult.rows.length) {
    throw { code: -32001, message: 'No embedding found for this product — backfill may still be running' };
  }
  const refEmbedding = refResult.rows[0].embedding;

  // Step 2: find nearest neighbours in vector DB (excluding source product)
  let nearResult;
  try {
    nearResult = await vectorDb.query<{ product_id: string; distance: number }>(
      `SELECT product_id, (embedding <=> $1::vector)::float AS distance
       FROM product_embeddings WHERE product_id != $2
       ORDER BY distance LIMIT $3`,
      [refEmbedding, productId, limit]
    );
  } catch {
    throw { code: -32001, message: 'No similar products found' };
  }
  if (!nearResult.rows.length) {
    throw { code: -32001, message: 'No similar products found' };
  }

  // Step 3: fetch product details from main DB
  const nearIds = nearResult.rows.map(r => r.product_id);
  const ph = nearIds.map((_, i) => `$${i + 1}`).join(',');
  const detailResult = await db.query(
    `SELECT id, title, price, currency, source AS domain, url, image_url
     FROM products WHERE id IN (${ph}) AND is_active = true`,
    nearIds
  );

  // Step 4: merge, preserving similarity order
  const distMap = new Map(nearResult.rows.map(r => [r.product_id, r.distance]));
  const byId = new Map(detailResult.rows.map(r => [(r as Record<string, unknown>).id as string, r]));
  const similar = nearIds
    .map(id => {
      const p = byId.get(id) as Record<string, unknown> | undefined;
      if (!p) return null;
      const dist = distMap.get(id) ?? 1;
      return {
        id: p.id,
        title: p.title,
        price: p.price,
        currency: p.currency,
        domain: p.domain,
        url: p.url,
        image_url: p.image_url,
        similarity: +Math.max(0, 1 - dist).toFixed(4),
      };
    })
    .filter(Boolean);

  const result = {
    product_id: productId,
    similar,
    total: similar.length,
    response_time_ms: Date.now() - t0,
  };

  // BUY-71542 / P2.6: apply emptiness metadata. find_similar returns
  // `similar: []` for empty results, which the resultIsEmpty() helper
  // catches. countryCode is the country of the reference product (when
  // known from the detail fetch), used to scope emptiness reasons.
  const countryCode = (detailResult.rows[0] as { country_code?: string } | undefined)?.country_code || null;
  await applyEmptiness('find_similar', result as unknown as Record<string, unknown>, {
    regionSupported: countryCode ? SUPPORTED_REGIONS.has(countryCode) : true,
    requestedCountry: countryCode,
  }, Date.now() - t0);

  return result;
}

async function dispatchTool(name: string, args: Record<string, unknown>) {
  // BUY-71817 / P2.7: enforce `deliver_to` REQUIRED on the v2 surface.
  // v1 callers (the existing fleet — Tune, Cart sweep, Tune probes, etc.) are
  // unaffected because they default to api_version=v1 or omit the flag entirely.
  // v2 callers must pass a non-empty ISO-3166 alpha-2 country code.
  // Gate fires BEFORE the handler so we never touch the DB / cache for a
  // guaranteed-malformed request. Returns INVALID_ARGUMENT (HTTP 400) via
  // the standard JSON-RPC error envelope so existing 4xx telemetry picks it up.
  const V2_DELIVER_TO_TOOLS = new Set(['search_products', 'get_deals', 'find_best_price']);
  if (V2_DELIVER_TO_TOOLS.has(name) && args.api_version === 'v2') {
    const dt = args.deliver_to;
    if (typeof dt !== 'string' || !/^[A-Za-z]{2}$/.test(dt)) {
      throw {
        code: -32602,
        message:
          `INVALID_ARGUMENT: deliver_to is REQUIRED on api_version=v2 for tool '${name}'. ` +
          `Pass an ISO 3166-1 alpha-2 country code (e.g. "SG", "US", "MY", "TH", "VN").`,
      };
    }
    // Normalize to uppercase so the rest of the handler sees the canonical form.
    args.deliver_to = dt.toUpperCase();
  }
  switch (name) {
    case 'search_products':  return handleSearchProducts(args);
    case 'get_product':      return handleGetProduct(args);
    case 'compare_products': return handleCompareProducts(args);
    case 'get_deals':        return handleGetDeals(args);
    case 'list_categories':  return handleListCategories(args);
    case 'find_best_price':  return handleFindBestPrice(args);
    case 'ingest_products':  return handleIngestProducts(args);
    case 'find_similar':     return handleFindSimilar(args);
    default:
      throw { code: -32601, message: `Unknown tool: ${name}` };
  }
}

// JSON-RPC 2.0 response helpers
function jsonrpcOk(id: unknown, result: unknown) {
  return { jsonrpc: '2.0', id, result };
}
function jsonrpcErr(id: unknown, code: number, message: string, data?: unknown, envelopeCode?: string) {
  const errorData: Record<string, unknown> = data != null ? { detail: data } : {};
  if (envelopeCode) {
    errorData.envelope = buildErrorEnvelope(envelopeCode as ErrorCodeType, message);
  }
  return { jsonrpc: '2.0', id, error: { code, message, ...(Object.keys(errorData).length ? { data: errorData } : {}) } };
}

// GET /mcp/auth/token — token endpoint descriptor (public, no auth).
// BUY-33837: matches the pre-migration mcp-server-production.js surface so
// legacy probes and OAuth-style clients still receive a JSON descriptor
// at /api/mcp/auth/token. Real token issuance moved to /v1/keys (API keys).
router.get('/auth/token', (_req: Request, res: Response) => {
  res.json({
    endpoint: '/api/mcp/auth/token',
    methods: ['GET'],
    grant_types_supported: ['client_credentials'],
    token_types_supported: ['Bearer'],
    response_type: 'json',
    note: 'Token issuance moved to /v1/keys (API key). This endpoint is informational.',
    production: true,
    domain: 'api.buywhere.ai',
    ts: new Date().toISOString(),
  });
});

// GET /mcp/auth/verify — bearer-token introspection (requires API key).
// Returns the scopes and identity bound to the presented key. Useful for
// agents that want to confirm a freshly-issued key before use.
router.get('/auth/verify', requireApiKey, (req: Request, res: Response) => {
  const k = (req as Request & { apiKey?: { clientId?: string; keyId?: string; scopes?: string[] } }).apiKey;
  res.json({
    authenticated: true,
    method: 'bearer_token',
    clientId: k?.clientId ?? null,
    keyId: k?.keyId ?? null,
    scopes: k?.scopes ?? [],
    timestamp: new Date().toISOString(),
    production: true,
    domain: 'api.buywhere.ai',
  });
});

// GET /mcp/metrics — process/system metrics (public, no auth).
// BUY-33837: process-scoped counters for ops dashboards. Cheap (no DB or
// Redis calls) and safe to expose unauthenticated.
router.get('/metrics', (_req: Request, res: Response) => {
  const mu = process.memoryUsage();
  res.json({
    timestamp: new Date().toISOString(),
    system: {
      uptime: process.uptime(),
      memory: {
        used: mu.heapUsed,
        total: mu.heapTotal,
        external: mu.external,
        rss: mu.rss,
      },
      cpu: process.cpuUsage(),
      version: process.version,
      platform: process.platform,
    },
    production: true,
    domain: 'api.buywhere.ai',
  });
});

// GET /mcp/health — public liveness probe (checks DB + Redis connectivity)
router.get('/health', async (_req: Request, res: Response) => {
  try {
    const [, pong] = await Promise.all([
      db.query('SELECT 1'),
      redis.ping(),
    ]);
    res.json({
      status: pong === 'PONG' ? 'ok' : 'degraded',
      db: 'ok',
      redis: pong === 'PONG' ? 'ok' : 'degraded',
      ts: new Date().toISOString(),
    });
  } catch (err: unknown) {
    res.status(503).json({
      status: 'down',
      error: (err as Error).message || String(err),
      ts: new Date().toISOString(),
    });
  }
});

// GET /mcp/health/authenticated — deeper probe requiring API key
router.get('/health/authenticated', requireApiKey, async (_req: Request, res: Response) => {
  try {
    const [countResult, pong] = await Promise.all([
      db.query('SELECT reltuples::bigint AS count FROM pg_class WHERE relname = \'products\''),
      redis.ping(),
    ]);
    res.json({
      status: 'ok',
      db: 'ok',
      redis: pong === 'PONG' ? 'ok' : 'degraded',
      product_count: countResult.rows[0]?.count ?? null,
      ts: new Date().toISOString(),
    });
  } catch (err: unknown) {
    res.status(503).json({
      status: 'down',
      error: (err as Error).message || String(err),
      ts: new Date().toISOString(),
    });
  }
});

// GET /mcp — info endpoint for browser / reviewer verification.
// Returns a JSON descriptor instead of Express's default 404 so registry
// reviewers and DevRel verifiers can confirm the endpoint is live without
// needing to craft a JSON-RPC POST. The actual MCP protocol uses POST only.
router.get('/', (_req: Request, res: Response) => {
  res.json({
    name: 'buywhere-catalog',
    description: 'BuyWhere MCP server. JSON-RPC 2.0 over HTTP POST.',
    protocol: 'mcp',
    protocolVersion: '2024-11-05',
    transport: 'http',
    methods: ['initialize', 'tools/list', 'tools/call'],
    tools: TOOLS.map(t => t.name),
    auth: 'Bearer token — register at https://api.buywhere.ai/v1/auth/register',
    usage: 'POST this URL with a JSON-RPC 2.0 envelope. See https://api.buywhere.ai/docs/guides/mcp',
  });
});

// POST /mcp — public methods (no auth): initialize + tools/list
// Directory scanners (Glama, Smithery) call these without credentials to introspect the server.
router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  const body = req.body;
  if (!body || body.jsonrpc !== '2.0' || !body.method) {
    return next(); // let the authenticated handler return the 400
  }
  const { id, method } = body;
  if (method === 'initialize') {
    return res.json(jsonrpcOk(id, {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'buywhere-catalog', version: '1.0.0' },
    }));
  }
  if (method === 'tools/list') {
    return res.json(jsonrpcOk(id, { tools: TOOLS }));
  }
  return next();
});

// POST /mcp — authenticated methods: tools/call (and any future additions)
router.post('/', requireApiKey, checkRateLimit, queryLogMiddleware('mcp'), async (req: Request, res: Response) => {
  const body = req.body;

  // Validate JSON-RPC envelope
  if (!body || body.jsonrpc !== '2.0' || !body.method) {
    return res.status(400).json(jsonrpcErr(body?.id ?? null, -32600, 'Invalid JSON-RPC request', undefined, ErrorCode.INVALID_JSON));
  }

  const { id, method, params } = body;
  const args = (params && typeof params === 'object' && !Array.isArray(params)) ? params : {};

  try {
    switch (method) {
      case 'tools/call': {
        const toolName = args.name as string;
        const toolArgs = (args.arguments && typeof args.arguments === 'object') ? args.arguments as Record<string, unknown> : {};
        if (!toolName) {
          return res.json(jsonrpcErr(id, -32602, 'Missing tool name'));
        }
        // BUY-66684: normalize `cc` to `country_code` so handlers' existing
        // `args.country_code`/`args.country` lookup logic fires. Some clients
        // (e.g. Tune probes #363/#367) send `cc` expecting it to be the canonical
        // short alias. Without this normalization, `cc=US` falls through to the
        // `q && !region ? 'SG'` default in handleSearchProducts and every market
        // returns identical SG rows.
        if (toolArgs.cc != null && toolArgs.country_code == null) {
          toolArgs.country_code = toolArgs.cc;
        }
        // BUY-22733: surface tool name to queryLog middleware so the finish
        // handler emits `mcp_tool_call` (with tool_name) instead of `api_query`.
        res.locals.mcpToolName = toolName;
        const result = await dispatchTool(toolName, toolArgs);
        return res.json(jsonrpcOk(id, {
          content: [{ type: 'text', text: JSON.stringify(result) }],
        }));
      }

      // BUY-72102: backward compatibility for direct tool-name JSON-RPC methods
      // (e.g., "search_products", "list_categories"). Some MCP clients and
      // heartbeat probes invoke tools by name instead of wrapping them in the
      // MCP "tools/call" envelope. Route known tool names to dispatchTool.
      // (BUY-68192 added this fallback to mcp-railway; api.buywhere.ai was
      //  missed, producing -32601 for bare-method probes while mcp.buywhere.ai
      //  stayed healthy. Port it here so both surfaces match.)
      default: {
        const knownTool = TOOLS.find((t) => t.name === method);
        if (knownTool) {
          res.locals.mcpToolName = method;
          const result = await dispatchTool(method, args);
          return res.json(jsonrpcOk(id, {
            content: [{ type: 'text', text: JSON.stringify(result) }],
          }));
        }
        return res.json(jsonrpcErr(id, -32601, `Method not found: ${method}`));
      }
    }
  } catch (err: unknown) {
    const e = err as { code?: number | string; message?: string };
    // BUY-57370: handle both numeric tool-error codes (e.g. -32603) and
    // PostgreSQL string error codes (e.g. '57014' for statement_timeout).
    // Without this, PG errors (string codes) always fall through to -32603,
    // masking the real cause from monitoring/Tune.
    if (typeof e.code === 'number' && e.message) {
      const envelopeCode = e.code === -32001 ? ErrorCode.NOT_FOUND
        : e.code === -32602 ? ErrorCode.INVALID_PARAMETER
        : ErrorCode.INTERNAL_ERROR;
      return res.json(jsonrpcErr(id, e.code, e.message, undefined, envelopeCode));
    }
    if (typeof e.code === 'string' && e.message) {
      // PostgreSQL error — log the real code for diagnostics, return -32603 for MCP compat
      console.error(`[mcp] pg error (code=${e.code}):`, e.message);
      return res.json(jsonrpcErr(id, -32603, `Internal error: ${e.message.slice(0, 120)}`, undefined, ErrorCode.INTERNAL_ERROR));
    }
    console.error('[mcp] error:', err);
    return res.json(jsonrpcErr(id, -32603, 'Internal error', undefined, ErrorCode.INTERNAL_ERROR));
  }
});

// ---------------------------------------------------------------------------
// BUY-71542 / P2.6 wire: empty-response envelopes carry `emptiness_reason`,
// `confidence`, and `diagnostic` so callers (and v_ceo_kpis.silently_empty_rate)
// can distinguish no_data / no_match / api_error / quota / region_unsupported /
// category_unsupported instead of guessing from a bare empty array.
//
// The helpers below apply emptiness metadata to MCP tool results. They are
// restored in BUY-72322 from 554950c75 collateral damage.
// ---------------------------------------------------------------------------

interface EmptinessProbeSignals {
  apiError?: boolean;
  regionHasAnyData?: boolean;
  categoryHasAnyData?: boolean;
  regionSupported?: boolean;
  categoryRequested?: boolean;
  requestedCategory?: string | null;
  requestedCountry?: string | null;
}

// Module-level cache of "does region X have any indexed products" — derived from
// a bounded recent-rows sample (idx_products_updated_at), refreshed at most once
// per 60s, so empty responses don't trigger unbounded country_code scans.
const regionProbeCache = new Map<string, { hasData: boolean; categories: Set<string>; probedAt: number }>();
const REGION_PROBE_TTL_MS = 60_000;

async function probeRegionAndCategories(country: string | null): Promise<{ hasData: boolean; categories: Set<string> }> {
  if (!country) return { hasData: true, categories: new Set() }; // unknown market — assume data exists
  const cached = regionProbeCache.get(country);
  if (cached && Date.now() - cached.probedAt < REGION_PROBE_TTL_MS) {
    return { hasData: cached.hasData, categories: cached.categories };
  }
  try {
    const sample = await db.query<{ country_code: string | null; category: string | null }>(
      `SELECT country_code, category FROM (
         SELECT country_code, category FROM products
         WHERE is_active = true
         ORDER BY updated_at DESC
         LIMIT 20000
       ) _recent`
    );
    const rows = sample.rows;
    const hasData = rows.some(r => (r.country_code || '').toUpperCase() === country);
    const categories = new Set(
      rows.filter(r => (r.country_code || '').toUpperCase() === country)
        .map(r => (r.category || '').toLowerCase().trim())
        .filter(Boolean)
    );
    regionProbeCache.set(country, { hasData, categories, probedAt: Date.now() });
    return { hasData, categories };
  } catch {
    return { hasData: true, categories: new Set() }; // probe failure — don't fabricate no_data
  }
}

/**
 * BUY-71542 / P2.6 spec item 5: api_error empties write monitoring.alert_history.
 */
async function recordApiErrorAlert(tool: string, detail: string, country: string | null, responseTimeMs: number): Promise<void> {
  try {
    const market = (country || 'SG').toLowerCase();
    const safeMarket = ['sg', 'us', 'my', 'vn', 'th'].includes(market) ? market : 'sg';
    await db.query(
      `INSERT INTO monitoring.alert_history (market, p95_ms, threshold_ms, resolution_notes)
       VALUES ($1, $2, $3, $4)`,
      [safeMarket, responseTimeMs, 0, `[P2.6 mcp_empty api_error] tool=${tool} country=${country || 'n/a'}: ${detail.slice(0, 400)}`]
    );
  } catch (e) {
    console.warn('[mcp:emptiness] alert_history write failed:', (e as Error).message);
  }
}

/**
 * BUY-71542 / P2.6: record every empty MCP response for silently_empty_rate KPI.
 * Writes a row to monitoring.mcp_empty_responses regardless of reason.
 * Fire-and-forget — never blocks the response.
 */
async function recordEmptinessTelemetry(
  tool: string,
  emptinessReason: string,
  country: string | null,
  category: string | null,
  confidence: string,
  responseTimeMs: number,
): Promise<void> {
  try {
    await db.query(
      `INSERT INTO monitoring.mcp_empty_responses
         (tool_name, emptiness_reason, requested_country_code, requested_category, confidence, response_time_ms)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [tool, emptinessReason, country || null, category || null, confidence, responseTimeMs]
    );
  } catch (e) {
    console.warn('[mcp:emptiness] telemetry insert failed:', (e as Error).message);
  }
}

/**
 * Apply emptiness metadata to a tool result when its payload is empty.
 * `resultIsEmpty(result)` decides emptiness per tool shape (search envelope with
 * products/results/data arrays, find_best_price best_price=null, list_categories
 * data=[], find_similar similar=[]).
 */
function resultIsEmpty(result: unknown): boolean {
  if (!result || typeof result !== 'object') return false;
  const r = result as unknown as Record<string, unknown>;
  for (const key of ['products', 'results', 'items', 'data', 'similar']) {
    if (Array.isArray(r[key])) return (r[key] as unknown[]).length === 0;
  }
  if ('best_price' in r) return r.best_price == null;
  if ('status' in r && 'rows_inserted' in r) return Number(r.rows_inserted) + Number(r.rows_updated) === 0 && Number(r.rows_failed) === 0;
  return false;
}

export async function applyEmptiness(
  tool: string,
  result: Record<string, unknown>,
  signals: EmptinessProbeSignals,
  responseTimeMs: number,
): Promise<void> {
  if (!resultIsEmpty(result)) return;

  const requestedCountry = (signals.requestedCountry || '').toUpperCase() || null;
  const regionSupported = signals.regionSupported ?? (requestedCountry ? SUPPORTED_REGIONS.has(requestedCountry) : true);
  const { hasData, categories } = await probeRegionAndCategories(requestedCountry);
  const categoryRequested = signals.categoryRequested ?? Boolean(signals.requestedCategory);
  const categoryHasAnyData = signals.categoryHasAnyData ?? (
    categoryRequested && signals.requestedCategory
      ? categories.has(signals.requestedCategory.toLowerCase().trim()) ||
        [...categories].some(c => c.includes(signals.requestedCategory!.toLowerCase().trim()))
      : true
  );

  const derived = deriveEmptiness({
    regionHasAnyData: signals.regionHasAnyData ?? hasData,
    categoryHasAnyData,
    apiError: signals.apiError === true,
    rateLimited: false,
    regionSupported,
    categoryRequested,
    requestedCategory: signals.requestedCategory || null,
    requestedCountry,
    rateLimitRemaining: null,
  });

  const meta = (result.meta && typeof result.meta === 'object')
    ? result.meta as Record<string, unknown>
    : {};
  result.meta = {
    ...meta,
    emptiness_reason: derived.emptiness_reason,
    confidence: derived.confidence,
    diagnostic: derived.diagnostic,
  };

  // BUY-71542 / P2.6: write telemetry row for silently_empty_rate KPI
  void recordEmptinessTelemetry(
    tool,
    derived.emptiness_reason,
    requestedCountry,
    signals.requestedCategory || null,
    derived.confidence,
    responseTimeMs,
  );

  if (derived.emptiness_reason === 'api_error') {
    void recordApiErrorAlert(tool, `emptiness_reason=api_error engine_status=${derived.diagnostic.engine_status}`, requestedCountry, responseTimeMs);
  }
}

export default router;
