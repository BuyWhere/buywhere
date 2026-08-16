import { randomUUID } from 'crypto';
import { Router, Request, Response, NextFunction } from 'express';
import { db, redis, vectorDb } from '../config';
import { embedQuery } from '../jobs/embedProducts';
import { requireApiKey, checkRateLimit } from '../middleware/apiKey';
import { queryLogMiddleware } from '../middleware/queryLog';
import { recordQueryCacheLookup } from '../monitoring/cacheStats';
import { buildErrorEnvelope, ErrorCode, ErrorCodeType } from '../middleware/errors';
import { buildProduct, buildSearchResponse, COUNTRY_CURRENCY, CURRENCY_RATES } from '../lib/response';
import { getCachedFxRates } from '../lib/fxRatesLoader';
import { buildDeviceFilter } from '../lib/deviceClassifier';

const router = Router();
const MCP_DB_ACQUIRE_TIMEOUT_MS = parseInt(process.env.MCP_DB_ACQUIRE_TIMEOUT_MS || '1000', 10);

async function acquireMcpClient() {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      db.connect(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('mcp_db_pool_acquire_timeout')), MCP_DB_ACQUIRE_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// BUY-56185/BUY-69684: Detect statement_timeout poisoned connections.
// When PostgreSQL's statement_timeout fires, the query is cancelled but the
// connection enters PQTRANS_INERROR state. Returning such a connection to the
// pool poises every subsequent query on it with "current transaction is aborted".
// NOTE: client.state tracks the socket connection state ('connected','connecting')
// and is NOT set to 'error' for transaction-level errors — we must check
// client.transactionStatus (pg's PQTRANS_* codes) to detect aborted transactions.
function releaseClientSafely(client: any) {
  try {
    // PQTRANS_INERROR = 3 — transaction aborted due to statement_timeout or other error.
    // Discard the connection so a fresh one is acquired from the pool next time.
    if (client && client.transactionStatus === 3) {
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
    description: 'Search the BuyWhere product catalog by keyword. Always pass deliver_to when the buyer market is known; it takes precedence over country_code/country and prevents all-market scans. Returns a results array where each item has: id, title, price ({amount, currency}), normalized_price_usd, merchant, url, image_url, region, country_code, click_url, affiliate_redirect_url, and updated_at. Covers e-commerce platforms across Singapore, Malaysia, Indonesia, Thailand, Vietnam, and US. Use compact=true for agent-optimized responses adding structured_specs, comparison_attributes, and normalized_price_usd fields.',
    inputSchema: {
      type: 'object',
      properties: {
        q: { type: 'string', description: 'Keyword search query' },
        query: { type: 'string', description: 'Alias for q (accepted for agent convenience; use q)' },
        domain: { type: 'string', description: 'Filter by merchant platform (e.g. lazada, shopee, amazon)' },
        region: { type: 'string', description: 'Filter by region (sea, us, eu, au)' },
        country_code: { type: 'string', enum: ['SG', 'US', 'VN', 'TH', 'MY'], description: 'Filter by ISO country code. Also infers default currency for price filters (SG→SGD, US→USD, VN→VND, TH→THB, MY→MYR).' },
        deliver_to: { type: 'string', description: 'Buyer delivery country/market. Preferred over country_code/country when known.' },
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
        id: { type: 'string', description: 'Product ID (numeric catalog ID)' },
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
    description: 'Get discounted products sorted by discount percentage. Returns a results array where each item has: id, title, price ({amount, currency}), normalized_price_usd, merchant, url, image_url, region, country_code, click_url, and updated_at. Also includes original_price and discount_pct when available. Covers Singapore, Malaysia, Indonesia, Thailand, Vietnam, and US e-commerce. Supports currency, region (sea, us, eu, au) and country (SG, US, VN, MY, ...) filters.',
    inputSchema: {
      type: 'object',
      properties: {
        min_discount: { type: 'number', description: 'Minimum discount percentage (default 10)', default: 10 },
        currency: { type: 'string', description: 'Filter by currency code (SGD, USD, MYR, VND, THB). Defaults to SGD.', default: 'SGD' },
        region: { type: 'string', description: 'Filter by region (sea, us, eu, au)' },
        country_code: { type: 'string', enum: ['SG', 'US', 'VN', 'TH', 'MY'], description: 'Filter by ISO country code. Alias: country.' },
        deliver_to: { type: 'string', description: 'Buyer delivery country/market. Preferred over country_code/country when known.' },
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
    description: 'Use this whenever a user asks about prices, wants to find the cheapest option, or asks "what\'s the best price for X" or "where can I buy X for the lowest price". Returns a results array where each item has: id, title, price ({amount, currency}), normalized_price_usd, merchant, url, image_url, region, country_code, click_url, and updated_at. Results are from across all merchants. Also includes structured_specs and comparison_attributes when available.',
    inputSchema: {
      type: 'object',
      properties: {
        q: { type: 'string', description: 'Keyword search query — alias for product_name' },
        product_name: { type: 'string', description: 'Product name to find best price for (e.g., "iphone 15 pro 256gb", "samsung galaxy s24")' },
        category: { type: 'string', description: 'Category to filter by (e.g., "electronics", "fashion")' },
        country_code: { type: 'string', enum: ['SG', 'MY', 'TH', 'PH', 'VN', 'ID', 'US'], description: 'Country to search in (defaults to SG). Alias: country.' },
        deliver_to: { type: 'string', description: 'Buyer delivery country/market. Preferred over country_code/country when known.' },
        country: { type: 'string', description: 'Alias for country_code (deprecated, use country_code)' },
        region: { type: 'string', enum: ['us', 'sea'], description: 'Region filter - use "us" for United States or "sea" for Southeast Asia' },
      },
    },
  },
  {
    name: 'find_similar',
    description: 'Find products similar to a given product using vector similarity. Returns up to 10 nearest neighbours by semantic meaning (title+description embedding). Useful for "more like this" recommendations. Accepts product_id directly, or product_name for automatic lookup.',
    inputSchema: {
      type: 'object',
      properties: {
        product_id: { type: 'string', description: 'Numeric catalog product ID (products.id; mutually exclusive with product_name). For legacy vector rows, an exact SKU is also accepted.' },
        product_name: { type: 'string', description: 'Product name to find similar items for (auto-resolves to best-matching product ID). Preferred when agent starts with a name/query.' },
        country_code: { type: 'string', enum: ['SG', 'US', 'VN', 'TH', 'MY'], description: 'Country to scope product_name lookup (defaults to SG)' },
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
  // BUY-68587 direction-correction: agents passing the natural alias `query`
  // (instead of canonical `q`) silently fell into the no-q browse branch and got
  // 0 rows with a reltuples-derived "total" (~397M) that looked like fabricated
  // cache data. Accept the alias so the query actually runs.
  const q = (args.q as string) || (args.query as string) || '';
  const mode = (args.mode as string) || 'hybrid';
  const geminiKey = process.env.GEMINI_API_KEY ?? '';
  const useVector = vectorDb != null && geminiKey !== '' && q !== '' && mode !== 'keyword';
  const domain = (args.domain as string) || '';
  const requestedMarket = normalizeMcpMarket(args, q ? 'SG' : '');
  const region = requestedMarket.dbRegion;
  // country_code is canonical; `country` kept as alias for backward compat.
  // deliver_to is the buyer market and must take precedence to prevent
  // cross-market results when callers pass stale/default country_code values.
  // BUY-6598: Default to SG for search queries. BUY-31962: skip default for
  // empty-q browse mode — no index on country_code makes filtered scan slow,
  // and recent rows are predominantly US/null so SG filter finds nothing.
  const country = requestedMarket.country;
  const category = (args.category as string) || '';
  const minPrice = args.min_price != null ? Number(args.min_price) : null;
  const maxPrice = args.max_price != null ? Number(args.max_price) : null;
  const limit = Math.min(Number(args.limit) || 20, 100);
  const offset = Number(args.offset) || 0;
  const compact = args.compact === true;
  const currency = country ? (COUNTRY_CURRENCY[country] || 'SGD') : 'SGD';
  const COUNT_CAP = 1001;

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
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  let rows: unknown[];
  let total: number;

  // BUY-57370: catch pool exhaustion fast — under concurrent load (e.g. Tune
  // automated testing), the 50-connection pool can saturate when US-partition
  // queries hold connections for 5-12s. Without .catch(), the raw pg PoolError
  // (string code like '57P01') escapes to the outer handler which checks
  // typeof code === 'number' — fails for string codes — and returns the
  // opaque -32603 "Internal error" that Tune detected.
  // BUY-69823: bound pool acquisition separately from statement_timeout so
  // api.buywhere.ai/mcp fails fast with a standardized envelope under contention
  // instead of consuming the whole 12s query budget before the handler starts.
  const searchClient = await acquireMcpClient().catch((err) => {
    console.warn('[search_products] db.connect failed:', err.message);
    throw { code: -32603, message: 'Database connection timeout' };
  });
  try {
    // BUY-56185: reduced from 30s to 12s — keyword+country FTS on 14M rows should
    // complete within 12s via GIN index; anything longer signals plan regression or
    // pool exhaustion. Failing fast prevents cascading connection starvation.
    await searchClient.query('SET statement_timeout = 12000');
    await searchClient.query('SET work_mem = \'64MB\''); // BUY-26343: encourage GIN bitmap plan over btree index scan for FTS queries
    const COUNT_CAP = 1001;
    if (q) {
      // BUY-69998: do not run a separate COUNT for keyword searches. Under SG/VN
      // country/category probes the count can consume the whole statement_timeout
      // before the bounded result query runs. We report a capped page-derived total
      // after fetching rows instead.
      total = 0;

      // BUY-31962 / BUY-41138: hybrid search (RRF) or keyword FTS fallback.
      // Hybrid and semantic paths embed the query via Jina AI, query the vector DB
      // separately, then merge in application code (two separate PG instances).
      if (useVector) {
        // Embed query (retrieval.query task); Redis-cache 60s keyed by base64 query
        let queryVec: string | null = null;
        let embedTimedOut = false;
        try {
          const embedKey = `qembed:${Buffer.from(q).toString('base64').slice(0, 48)}`;
          queryVec = await recordQueryCacheLookup(redis, embedKey, () => redis.get(embedKey));
          if (!queryVec) {
            // BUY-70290: cap embed latency at 3s — Gemini API occasionally hangs
            // for 12-18s, turning a fast FTS search into a multi-second ordeal.
            queryVec = await Promise.race([
              embedQuery(q, geminiKey),
              new Promise<null>((_resolve, reject) =>
                setTimeout(() => reject(new Error('embed timeout after 3000ms')), 3000)
              ),
            ]);
            if (queryVec) {
              await redis.set(embedKey, queryVec, 'EX', 60).catch(() => {});
            }
          }
        } catch (embedErr) {
          console.warn('[search] embed query failed/timeout, falling back to FTS:', (embedErr as Error).message);
          queryVec = null;
          embedTimedOut = true;
        }

        if (queryVec && vectorDb && !embedTimedOut) {
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
              const ftsResult = await searchClient.query<{ id: string }>(
                `SELECT id FROM products ${where} LIMIT 200`,
                params
              );
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
                      price, currency, image_url, metadata, updated_at, region, country_code, category, category_path
               FROM products WHERE ${detailConditions.join(' AND ')}`,
              detailParams
            );
            // Preserve ranking order
            const byId = new Map(detailResult.rows.map(r => [(r as Record<string, unknown>).id as string, r]));
            rows = pageIds.map(id => byId.get(id)).filter(Boolean) as Record<string, unknown>[];
          }
        } else {
          // Embed failed — fall through to keyword FTS
          const CANDIDATE_LIMIT = Math.min((limit + offset) * 10, 5000);
          params.push(CANDIDATE_LIMIT, limit, offset);
          const result = await searchClient.query(
            `SELECT * FROM (
               SELECT id, sku AS source, source AS domain, url, title,
                      price, currency, image_url, metadata, updated_at, region, country_code, category, category_path
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

  // BUY-69738: category was removed from SQL WHERE (caused heap scan at 400M+ rows).
  // Filter in-memory after fetch — ILIKE match is cheap on the bounded result set.
  if (category && rows.length > 0) {
    const catLower = category.toLowerCase();
    rows = (rows as Record<string, unknown>[]).filter(r =>
      ((r.category as string) || '').toLowerCase().includes(catLower)
    );
  }

  if (q) {
    total = Math.min((rows as Record<string, unknown>[]).length + offset, COUNT_CAP);
  }

  // Defense in depth for buyer-market routing: SQL includes country_code/region
  // predicates, but this prevents stale cached rows or future query variants from
  // returning another market in top results.
  if (country && rows.length > 0) {
    rows = (rows as Record<string, unknown>[]).filter(r =>
      ((r.country_code as string) || '').toUpperCase() === country
    );
  }
  if (region && rows.length > 0) {
    rows = (rows as Record<string, unknown>[]).filter(r =>
      ((r.region as string) || '').toLowerCase() === region.toLowerCase()
    );
  }

  const products = (rows as Record<string, unknown>[]).map(r =>
    buildProduct(r, currency, compact)
  );

  const result = buildSearchResponse(
    products, total!, limit, offset, Date.now() - t0, false
  );

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
  void (args.deliver_to as string);
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
    await dealsClient.query('SET statement_timeout = 15000'); // 2026-08-15: fail fast — a 60s DB hang dead-airs the MCP transport
    // BUY-68615: force index path on production catalog DB.
    // At 400M+ rows, the planner may choose seqscan even with the discount index,
    // which times out. Bounded LIMIT + enable_seqscan=off ensures the index is used.
    // BUY-69340 + BUY-69646 merged (2026-08-15): walk the deals index IN ORDER
    // (currency, discount_pct DESC) so the response is the TRUE top discounts —
    // the unordered 10K candidate walk could miss the best deals entirely and
    // shipped 10K full rows (metadata jsonb) to Node per call (27-30s observed
    // under replica load). The ordered walk early-stops at candidateLimit
    // PASSING rows (same worst case as the unordered walk when filters are
    // selective), candidates are id-thin, and full rows join only for the
    // returned page. updated_at tiebreak preserved in SQL.
    await dealsClient.query('SET enable_seqscan = off');
    const candidateLimit = 2000;
    const candidateParams = [...params, candidateLimit];
    const dataResult = await dealsClient.query(
      `WITH cand AS (
         SELECT id, discount_pct AS cand_discount, updated_at AS cand_updated
         FROM products
         WHERE ${whereClause}
         ORDER BY discount_pct DESC
         LIMIT $${candidateParams.length}
       )
       SELECT p.id, p.sku AS source, p.source AS domain, p.url, p.title,
              p.price,
              CASE WHEN p.metadata->>'original_price' ~ '^[0-9]+(\\.[0-9]+)?$'
                   THEN (p.metadata->>'original_price')::numeric ELSE NULL END AS original_price,
              p.currency, p.image_url, p.metadata, p.updated_at, p.region, p.country_code,
              p.discount_pct
       FROM cand JOIN products p ON p.id = cand.id
       ORDER BY cand.cand_discount DESC, cand.cand_updated DESC
       LIMIT ${limit} OFFSET ${offset}`,
      candidateParams
    );
    total = dataResult.rows.length;
    products = dataResult.rows.map((r: Record<string, unknown>) =>
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

  redis.set(cacheKey, JSON.stringify(result), 'EX', 60).catch(() => {});

  return result;
}

// Single-flight guard: at most one DB scan runs per country at a time.
// Concurrent cache-misses coalesce on the same Promise instead of spawning N parallel GROUP-BY scans.
const categoryListInflight = new Map<string, Promise<{ data: unknown[]; meta: Record<string, unknown> }>>();

function buildHardcodedCategories() {
  return [
    { slug: 'electronics', name: 'Electronics', product_count: 0 },
    { slug: 'computers', name: 'Computers', product_count: 0 },
    { slug: 'mobile-phones', name: 'Mobile Phones', product_count: 0 },
    { slug: 'home', name: 'Home', product_count: 0 },
    { slug: 'fashion', name: 'Fashion', product_count: 0 },
  ];
}

async function handleListCategories(args: Record<string, unknown>) {
  const t0 = Date.now();
  void (args.deliver_to as string);
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
  // BUY-69823: wrap the whole queryPromise in a hard wall-clock timeout so pool
  // contention + slow queries never exceed ~6s. If timeout fires, return an
  // explicit unavailable fallback instead of zero-count categories.
  const MAT_VIEW_TIMEOUT_MS = 8000;
  const LIVE_TIMEOUT_MS = 1800;
  const HARD_TIMEOUT_MS = 6000;
  const queryPromise = (async () => {
    const client = await acquireMcpClient().catch((err) => {
      console.warn('[list_categories] db.connect failed:', err.message);
      throw { code: -32603, message: 'Database connection timeout' };
    });
    try {
      await client.query('SET statement_timeout = 8000');
      // BUY-69472: set lock_timeout so concurrent matview refresh / long-held
      // ACCESS EXCLUSIVE locks degrade to fallback instead of hard -32603.
      await client.query('SET lock_timeout = 5000');
      let rows: Array<{ slug: string; name: string; product_count: number }> = [];
      try {
        const tableCheck = await client.query(
          `SELECT to_regclass('public.mcp_category_summary_by_country') AS tbl`
        );
        if (tableCheck.rows[0]?.tbl) {
          const summaryResult = await client.query(
            `SELECT slug, name, product_count
             FROM mcp_category_summary_by_country
             WHERE country_code = $1
               AND NULLIF(BTRIM(slug), '') IS NOT NULL
             ORDER BY product_count DESC
             LIMIT 100`,
            [country]
          );
          rows = summaryResult.rows;
        }
        // BUY-69823: if matview empty, try a bounded live GROUP BY with a tighter
        // per-query timeout — prevents a 50K-row scan from burning the full 8s.
        if (rows.length === 0) {
          try {
            await client.query(`SET statement_timeout = ${LIVE_TIMEOUT_MS}`);
            await client.query(`SET work_mem = '256MB'`);
            await client.query(`SET enable_hashagg = off`);
            const liveResult = await client.query(
              `SELECT category_path[1] AS slug, category_path[1] AS name, COUNT(*) AS product_count
               FROM products
               WHERE country_code = $1
                 AND category_path[1] IS NOT NULL
                 AND NULLIF(BTRIM(category_path[1]), '') IS NOT NULL
                 AND is_active = true
               GROUP BY category_path[1]
               ORDER BY COUNT(*) DESC
               LIMIT 100`,
              [country]
            );
            if (liveResult.rows.length > 0) rows = liveResult.rows;
          } catch (_) {
            // live GROUP BY timed out — fall through to recent-products fallback
          } finally {
            await client.query(`SET statement_timeout = ${MAT_VIEW_TIMEOUT_MS}`);
          }
        }
        if (rows.length === 0) {
          // BUY-60056: materialized view is empty/stale in production. Instead of
          // returning unavailable or running a full-table GROUP BY, sample recent
          // products through the updated_at path and derive a bounded category list.
          // BUY-69823: use LIVE_TIMEOUT_MS so a 50K-row scan never exceeds 1.8s.
          try {
            await client.query(`SET statement_timeout = ${LIVE_TIMEOUT_MS}`);
            const fallbackResult = await client.query(
              `SELECT slug, slug AS name, COUNT(*)::int AS product_count
               FROM (
                 SELECT category_path, country_code
                 FROM products
                 WHERE country_code = $1
                   AND category_path[1] IS NOT NULL
                   AND NULLIF(BTRIM(category_path[1]), '') IS NOT NULL
                   AND is_active = true
                 ORDER BY updated_at DESC
                 LIMIT 50000
               ) _recent_categories
               CROSS JOIN LATERAL (SELECT category_path[1] AS slug) _cat
               GROUP BY slug
               ORDER BY product_count DESC
               LIMIT 100`,
              [country]
            );
            rows = fallbackResult.rows;
          } catch (_) {
            // recent-products fallback timed out — fall through to hardcoded
          }
        }
      } catch (dbErr: any) {
        // BUY-69472: lock_timeout (55P03) or statement_timeout (57014) —
        // degrade to hardcoded fallback instead of hard -32603.
        const pgCode = dbErr?.code;
        if (pgCode === '55P03' || pgCode === '57014') {
          console.warn(`[list_categories] DB lock/statement timeout for ${country} (code=${pgCode}), falling back to hardcoded categories`);
        } else {
          throw dbErr;
        }
      }
      if (rows.length === 0) {
        rows = buildHardcodedCategories();
      }
      const data = {
        data: rows,
        meta: { total: rows.length, country_code: country, response_time_ms: 0, cached: false, unavailable: rows.every((row) => Number(row.product_count) === 0) },
      };
      redis.set(cacheKey, JSON.stringify(data), 'EX', 600).catch(() => {}); // 10 min TTL
      return data;
    } finally {
      releaseClientSafely(client);
    }
  })();

  // BUY-69823: hard wall-clock timeout prevents pool contention + slow queries
  // from burning the entire request budget. Race the queryPromise against a
  // timeout; if timeout wins, return hardcoded categories instead of a 5xx.
  const hardTimeoutPromise = new Promise<ReturnType<typeof buildHardcodedCategories>>((resolve) => {
    setTimeout(() => {
      resolve([
        { slug: 'electronics', name: 'Electronics', product_count: 0 },
        { slug: 'computers', name: 'Computers', product_count: 0 },
        { slug: 'mobile-phones', name: 'Mobile Phones', product_count: 0 },
        { slug: 'home', name: 'Home', product_count: 0 },
        { slug: 'fashion', name: 'Fashion', product_count: 0 },
      ]);
    }, HARD_TIMEOUT_MS);
  });

  categoryListInflight.set(country, queryPromise);
  try {
    const rows = await Promise.race([queryPromise.then(r => r.data), hardTimeoutPromise]);
    const result = { data: rows, meta: { total: rows.length, country_code: country, response_time_ms: Date.now() - t0, cached: false, unavailable: false } };
    return result;
  } catch (err) {
    // If the promise rejects, return hardcoded categories with a warning
    console.warn('[list_categories] unexpected error, returning hardcoded:', err);
    return {
      data: [
        { slug: 'electronics', name: 'Electronics', product_count: 0 },
        { slug: 'computers', name: 'Computers', product_count: 0 },
        { slug: 'mobile-phones', name: 'Mobile Phones', product_count: 0 },
        { slug: 'home', name: 'Home', product_count: 0 },
        { slug: 'fashion', name: 'Fashion', product_count: 0 },
      ],
      meta: { total: 5, country_code: country, response_time_ms: Date.now() - t0, cached: false, unavailable: false },
    };
  } finally {
    categoryListInflight.delete(country);
  }
}

async function handleFindBestPrice(args: Record<string, unknown>) {
  const t0 = Date.now();
  void (args.deliver_to as string);
  const productName = ((args.product_name as string) || (args.q as string) || '').trim();
  if (!productName) throw { code: -32602, message: 'product_name (or q) is required' };

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
  const bestPriceClient = await acquireMcpClient().catch((err) => {
    console.warn('[find_best_price] db.connect failed:', err.message);
    throw { code: -32603, message: 'Database connection timeout' };
  });
  let result: { rows: Record<string, unknown>[] };
  let ftsTimedOut = false;
  let crossMarketFallback = false;
  const requestedCountry = country;
  try {
    await bestPriceClient.query('SET statement_timeout = 3000');
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
      `WITH cand AS (
         SELECT id, price, updated_at
         FROM products
         WHERE ${candidateWhere}
         LIMIT $${params.length}
       ), page_ids AS (
         SELECT id, price, updated_at
         FROM cand
         ORDER BY price ASC, updated_at DESC
         LIMIT $${params.length + 1}
       )
       SELECT p.id, p.title, p.price, p.currency, p.source AS domain, p.url, p.image_url,
              p.country_code, p.updated_at, p.category, p.category_path, p.metadata
       FROM page_ids pi
       JOIN products p ON p.id = pi.id
       ORDER BY pi.price ASC, pi.updated_at DESC`,
      [...params, limit]
    );
  } catch (err: unknown) {
    // BUY-70222: catch SQLSTATE 57014 (statement_timeout) and fail open with a
    // structured empty response instead of surfacing JSON-RPC -32603 to callers.
    const pgErr = err as { code?: string };
    if (pgErr?.code === '57014') {
      console.warn('[find_best_price] FTS timed out for country=', country, 'product=', productName);
      ftsTimedOut = true;
      result = { rows: [] };
    } else {
      releaseClientSafely(bestPriceClient);
      throw err;
    }
  }

  // BUY-70482: If FTS returned zero rows (timeout or no match), attempt a cross-market
  // FTS fallback with a tight statement_timeout so we degrade gracefully without
  // scanning all partitions. Bounded LIMIT keeps the response within p95 ≤5s.
  // Empirical probe: `LIMIT 10` global FTS returns 10-55ms regardless of table size.
  try {
    if (result.rows.length === 0) {
      await bestPriceClient.query('SET statement_timeout = 1500');
      const fallbackResult = await bestPriceClient.query(
        `SELECT id, title, price, currency, source AS domain, url, image_url,
                country_code, updated_at, category, category_path, metadata
         FROM products
         WHERE is_active = true
           AND price > 0
           AND search_vector @@ plainto_tsquery('english', $1)
         ORDER BY price ASC, updated_at DESC
         LIMIT $2`,
        [productName, limit]
      );
      if (fallbackResult.rows.length > 0) {
        result = fallbackResult;
        ftsTimedOut = false;
        crossMarketFallback = true;
        console.log('[find_best_price] country FTS empty, cross-market FTS fallback succeeded for country=', country, 'product=', productName, 'rows=', fallbackResult.rows.length);
      }
    }
  } catch (fallbackErr: unknown) {
    const fbErr = fallbackErr as { code?: string };
    if (fbErr?.code === '57014') {
      console.warn('[find_best_price] cross-market FTS fallback timed out for country=', country, 'product=', productName);
    } else {
      console.warn('[find_best_price] cross-market FTS fallback error:', fbErr);
    }
  } finally {
    // BUY-56185: discard connections poisoned by statement_timeout
    releaseClientSafely(bestPriceClient);
  }

  // BUY-69738: filter by category in-memory instead of SQL (ILIKE causes heap scan at scale)
  if (category && result.rows.length > 0) {
    const catLower = category.toLowerCase();
    result.rows = result.rows.filter(r =>
      ((r.category as string) || '').toLowerCase().includes(catLower)
    );
  }

  const currency = COUNTRY_CURRENCY[country] || 'SGD';
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

  // BUY-63229: median-based outlier guard — normalize each row's price to USD by
  // its own currency so scam listings priced in foreign currency can't slip past.
  const rates = getCachedFxRates();
  const rowToUsd = (r: Record<string, unknown>) => {
    const curr = ((r.currency as string) || currency).toUpperCase();
    const fxRate = rates[curr] ?? CURRENCY_RATES[curr] ?? 1;
    const price = r.price != null ? Number(r.price) : 0;
    return price * fxRate;
  };

  let guardApplied = false;
  let medianUsd: number | null = null;
  let minAllowedUsd: number | null = null;
  let finalRows = result.rows.filter(r => !isAccessory(r));

  if (finalRows.length >= 3) {
    const sortedUsd = finalRows.map(rowToUsd).sort((a, b) => a - b);
    const mid = Math.floor(sortedUsd.length / 2);
    medianUsd = sortedUsd.length % 2 === 0
      ? (sortedUsd[mid - 1] + sortedUsd[mid]) / 2
      : sortedUsd[mid];
    minAllowedUsd = (medianUsd as number) * 0.15;
    const filtered = finalRows.filter(r => rowToUsd(r) >= (minAllowedUsd as number));
    if (filtered.length > 0) {
      finalRows = filtered;
      guardApplied = filtered.length < result.rows.filter(r => !isAccessory(r)).length;
      if (guardApplied) {
        console.log(`[find_best_price] BUY-63229 outlier guard: rejected ${result.rows.filter(r => !isAccessory(r)).length - filtered.length}/${result.rows.filter(r => !isAccessory(r)).length} candidates. median_usd=${(medianUsd as number).toFixed(2)}, min_allowed_usd=${(minAllowedUsd as number).toFixed(2)}, product="${productName}", country=${country}`);
      }
    }
  }

  const data = finalRows.slice(0, 10).map((r: Record<string, unknown>) => {
    const price = r.price != null ? parseFloat(r.price as string) : null;
    const curr = ((r.currency as string) || currency).toUpperCase();
    const fxRate = rates[curr] ?? CURRENCY_RATES[curr] ?? 1;
    return {
      id: r.id,
      title: r.title,
      price: { amount: price, currency: curr },
      normalized_price_usd: price != null ? Math.round(price * fxRate * 100) / 100 : null,
      merchant: r.domain as string,
      url: r.url as string,
      image_url: r.image_url as string,
      country_code: r.country_code as string,
    };
  });

  return {
    best_price: data[0] ?? null,
    alternatives: data.slice(1),
    meta: {
      total: data.length,
      guard_applied: guardApplied,
      ...(medianUsd != null ? { median_usd: Math.round(medianUsd * 100) / 100 } : {}),
      ...(minAllowedUsd != null ? { min_allowed_usd: Math.round(minAllowedUsd * 100) / 100 } : {}),
      country: country || (region.toLowerCase() === 'us' ? 'US' : 'SG'),
      response_time_ms: Date.now() - t0,
      ...(crossMarketFallback ? { cross_market_fallback: true, requested_country: requestedCountry } : {}),
      ...(ftsTimedOut ? { timed_out: true, unavailable: true, message: 'Best-price search temporarily unavailable; please retry.' } : {}),
    },
  };
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
  const requestedId = (args.product_id as string || '').trim();
  const productName = (args.product_name as string || '').trim();
  const countryCode = ((args.country_code as string) || 'SG').toUpperCase();
  const limit = Math.min(Math.max(Number(args.limit) || 10, 1), 10);

  let resolvedId = requestedId;
  if (!resolvedId && productName) {
    const conditions = ['is_active = true'];
    const params: unknown[] = [];
    params.push(productName);
    conditions.push(`search_vector @@ plainto_tsquery('english', $${params.length})`);
    if (countryCode) {
      params.push(countryCode);
      conditions.push(`country_code = $${params.length}`);
    }
    const lookupResult = await db.query(
      // BUY-32028/70294: bound the FTS candidates BEFORE ranking. An unbounded
      // rank sort over the whole match set re-introduces the multi-second sort
      // the ts-rank guard exists to prevent. Rank only a 50-row slice.
      `SELECT id, sku FROM (
         SELECT id, sku, ts_rank(search_vector, plainto_tsquery('english', $1)) AS _rank
         FROM (
           SELECT id, sku, search_vector FROM products WHERE ${conditions.join(' AND ')} LIMIT 50
         ) _lookup_candidates
       ) _ranked_lookup_candidates
       ORDER BY _rank DESC LIMIT 1`,
      params
    );
    if (!lookupResult.rows.length) {
      throw { code: -32001, message: `No product found matching "${productName}" in ${countryCode}` };
    }
    resolvedId = String((lookupResult.rows[0] as Record<string, unknown>).id);
  }

  if (!resolvedId) {
    throw { code: -32602, message: 'missing required parameter: provide product_id or product_name' };
  }
  // Public contract: product_id is products.id (currently bigint text in MCP JSON).
  // Legacy vector data in search_proof.product_vectors is keyed by sku, so exact SKU
  // input remains accepted as a compatibility bridge while canonical coverage catches up.
  const isNumericProductId = /^\d+$/.test(resolvedId);
  const isUuidLike = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(resolvedId);
  if (!isNumericProductId && isUuidLike) {
    throw { code: -32602, message: `Invalid product_id format: expected catalog product id or exact SKU, got "${resolvedId}"` };
  }

  if (!vectorDb) {
    throw { code: -32001, message: 'Vector search not available - vector DB not configured' };
  }

  let sourceProductId = resolvedId;
  let sourceSku: string | null = null;
  try {
    const sourceResult = await db.query<{ id: string; sku: string | null }>(
      isNumericProductId
        ? `SELECT id::text AS id, sku FROM products WHERE id = $1 AND is_active = true LIMIT 1`
        : `SELECT id::text AS id, sku FROM products WHERE sku = $1 AND is_active = true ORDER BY updated_at DESC LIMIT 1`,
      [resolvedId]
    );
    if (sourceResult.rows.length) {
      sourceProductId = String(sourceResult.rows[0].id);
      sourceSku = sourceResult.rows[0].sku ? String(sourceResult.rows[0].sku) : null;
    }
  } catch {
    if (!isNumericProductId) sourceSku = resolvedId;
  }
  const lookupKeys = Array.from(new Set([sourceProductId, sourceSku, resolvedId].filter(Boolean).map(String)));

  let refResult;
  try {
    refResult = await vectorDb.query<{ vector_key: string; embedding: string; vector_table: string }>(
      `SELECT product_id::text AS vector_key, embedding::text, 'product_embeddings' AS vector_table
         FROM product_embeddings
        WHERE product_id::text = ANY($1::text[])
        ORDER BY CASE WHEN product_id::text = $2 THEN 0 ELSE 1 END
        LIMIT 1`,
      [lookupKeys, sourceProductId]
    );
  } catch {
    refResult = { rows: [] };
  }

  if (!refResult.rows.length) {
    try {
      refResult = await vectorDb.query<{ vector_key: string; embedding: string; vector_table: string }>(
        `SELECT sku AS vector_key, embedding::text, 'search_proof.product_vectors' AS vector_table
           FROM search_proof.product_vectors
          WHERE sku = ANY($1::text[])
          ORDER BY CASE WHEN sku = $2 THEN 0 ELSE 1 END
          LIMIT 1`,
        [lookupKeys, sourceSku || resolvedId]
      );
    } catch {
      refResult = { rows: [] };
    }
  }

  if (!refResult.rows.length) {
    throw { code: -32001, message: 'No embedding found for this product - backfill may still be running' };
  }
  const refEmbedding = refResult.rows[0].embedding;
  const vectorKey = refResult.rows[0].vector_key;
  const vectorTable = refResult.rows[0].vector_table;

  let nearResult;
  if (vectorTable === 'search_proof.product_vectors') {
    try {
      nearResult = await vectorDb.query<{ vector_key: string; distance: number }>(
        `SELECT sku AS vector_key, (embedding <=> $1::vector)::float AS distance
           FROM search_proof.product_vectors
          WHERE sku != $2
          ORDER BY distance LIMIT $3`,
        [refEmbedding, vectorKey, limit]
      );
    } catch {
      nearResult = { rows: [] };
    }
  } else {
    try {
      nearResult = await vectorDb.query<{ vector_key: string; distance: number }>(
        `SELECT product_id::text AS vector_key, (embedding <=> $1::vector)::float AS distance
           FROM product_embeddings
          WHERE product_id::text != $2
          ORDER BY distance LIMIT $3`,
        [refEmbedding, vectorKey, limit]
      );
    } catch {
      nearResult = { rows: [] };
    }
  }
  if (!nearResult.rows.length) {
    throw { code: -32001, message: 'No similar products found' };
  }

  const nearKeys = nearResult.rows.map(r => r.vector_key);
  const ph = nearKeys.map((_, i) => `$${i + 1}`).join(',');
  const detailResult = await db.query(
    vectorTable === 'search_proof.product_vectors'
      ? `SELECT id::text AS id, sku, title, price, currency, source AS domain, url, image_url FROM products WHERE sku IN (${ph}) AND is_active = true`
      : `SELECT id::text AS id, sku, title, price, currency, source AS domain, url, image_url FROM products WHERE id::text IN (${ph}) AND is_active = true`,
    nearKeys
  );

  const distMap = new Map(nearResult.rows.map(r => [r.vector_key, r.distance]));
  const byKey = new Map(detailResult.rows.map(r => [vectorTable === 'search_proof.product_vectors' ? String((r as Record<string, unknown>).sku) : String((r as Record<string, unknown>).id), r]));
  const similar = nearKeys
    .map(id => {
      const p = byKey.get(id) as Record<string, unknown> | undefined;
      if (!p) return null;
      const dist = distMap.get(id) ?? 1;
      const rowCurrency = (p.currency as string) || '';
      return {
        id: p.id,
        sku: p.sku,
        title: p.title,
        price: p.price,
        currency: rowCurrency,
        domain: p.domain,
        url: p.url,
        image_url: p.image_url,
        similarity: +Math.max(0, 1 - dist).toFixed(4),
      };
    })
    .filter(Boolean);

  return {
    product_id: sourceProductId,
    requested_product_id: requestedId || undefined,
    matched_product_name: productName || undefined,
    sku: sourceSku,
    similar,
    total: similar.length,
    meta: { vector_table: vectorTable, vector_key: vectorKey },
    response_time_ms: Date.now() - t0,
  };
}

async function dispatchTool(name: string, args: Record<string, unknown>) {
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
// BUY-70000: every response (success or error) carries `request_id` and a
// top-level `timestamp` so agent-facing monitoring suites can correlate
// JSON-RPC calls with query_log entries without scraping server logs.
// `request_id` prefers a string JSON-RPC id; when the caller used a numeric
// or null id we fall back to a generated UUID so the field is always present.
// BUY-70114: `request_id` is always a server-generated UUID for traceability.
// The JSON-RPC `id` is preserved separately for protocol correlation.
function jsonrpcRequestId(_id: unknown): string {
  return randomUUID();
}
function jsonrpcOk(id: unknown, result: unknown) {
  return { jsonrpc: '2.0', id, request_id: jsonrpcRequestId(id), timestamp: new Date().toISOString(), result };
}
function jsonrpcErr(id: unknown, code: number, message: string, data?: unknown, envelopeCode?: string) {
  const errorData: Record<string, unknown> = data != null ? { detail: data } : {};
  if (envelopeCode) {
    errorData.envelope = buildErrorEnvelope(envelopeCode as ErrorCodeType, message);
  }
  return {
    jsonrpc: '2.0',
    id,
    request_id: jsonrpcRequestId(id),
    timestamp: new Date().toISOString(),
    error: { code, message, ...(Object.keys(errorData).length ? { data: errorData } : {}) },
  };
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

      default:
        return res.json(jsonrpcErr(id, -32601, `Method not found: ${method}`));
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

export default router;
