import { randomUUID } from 'crypto';
import { Router, Request, Response, NextFunction } from 'express';
import { db, redis, vectorDb } from '../config';
import { embedQuery } from '../jobs/embedProducts';
import { requireApiKey, checkRateLimit } from '../middleware/apiKey';
import { queryLogMiddleware } from '../middleware/queryLog';
import { buildErrorEnvelope, ErrorCode, ErrorCodeType } from '../middleware/errors';
<<<<<<< HEAD
import { buildProduct, buildSearchResponse, COUNTRY_CURRENCY, CURRENCY_RATES, formatPriceField, formatSimilarPriceField, isSentinelPrice, PRICE_UNAVAILABLE_TEXT } from '../lib/response';
import { buildDeviceFilter } from '../lib/deviceClassifier';

// formatPriceLine: formats a price for MCP text display (mirrors formatPriceField logic
// but returns a human-readable string; used by formatProductForMcp only).
function formatPriceLine(price: Record<string, unknown> | undefined, url: string | undefined): string {
  if (!price || isSentinelPrice(price.amount)) {
    const link = url ? ` — ${url}` : '';
    return `Price: ${PRICE_UNAVAILABLE_TEXT}${link}`;
  }
  return `Price: ${price.currency ?? 'SGD'} ${price.amount}`;
}

function formatProductForMcp(p: Record<string, unknown>): string {
  const price = p.price as Record<string, unknown> | undefined;
  const merchant = p.merchant as Record<string, unknown> | undefined;
  const avail = p.availability as Record<string, unknown> | undefined;

  const lines: string[] = [
    `**${p.title ?? p.name ?? ''}**`,
    `ID: ${p.id}`,
    formatPriceLine(price, p.url as string | undefined),
    `Category: ${p.category ?? ''}`,
    `Merchant: ${merchant?.name ?? merchant?.merchant_id ?? ''}` +
      (merchant?.platform ? ` (${merchant.platform})` : ''),
    `In stock: ${avail?.in_stock ? 'Yes' : 'No'}`,
    `URL: ${p.url ?? ''}`,
  ];

  return lines.join('\n');
}

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

// BUY-56185/BUY-56635: Detect statement_timeout poisoned connections.
// When PostgreSQL's statement_timeout fires, the query is cancelled but the
// connection enters PQTRANS_INERROR state (transactionStatus === 3). Returning such
// a connection to the pool poisons every subsequent query with "current transaction
// is aborted". Discard it instead of returning it to the pool.
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

// MCP tools manifest
const TOOLS = [
  {
    name: 'search_products',
    description: 'Search the BuyWhere product catalog by keyword. Returns schema.org/Product entities with name, description, image, and offers (schema.org/AggregateOffer with lowPrice, highPrice, priceCurrency). Covers e-commerce platforms across Singapore, Malaysia, Indonesia, Thailand, Vietnam, and US. Use compact=true for agent-optimized responses with structured_specs, comparison_attributes, and normalized_price_usd fields.',
    inputSchema: {
      type: 'object',
      properties: {
        q: { type: 'string', description: 'Keyword search query' },
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
    description: 'Get discounted products sorted by discount percentage. Returns schema.org/Product entities with schema.org/Offer properties: price, priceCurrency, availability, originalPrice, and discountPercentage. Covers Singapore, Malaysia, Indonesia, Thailand, Vietnam, and US e-commerce. Supports currency, region (sea, us, eu, au) and country (SG, US, VN, MY, ...) filters.',
    inputSchema: {
      type: 'object',
      properties: {
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
        country_code: { type: 'string', enum: ['SG', 'US', 'VN', 'TH', 'MY', 'GB', 'IN', 'AU'], description: 'Filter by ISO country code. Defaults to SG.' },
        country: { type: 'string', description: 'Alias for country_code (deprecated, use country_code)' },
        region: { type: 'string', description: 'Alias for country_code/market (us→US, sg→SG, my→MY, gb→GB, in→IN, au→AU).' },
      },
    },
  },
  {
    name: 'find_best_price',
    description: 'Use this whenever a user asks about prices, wants to find the cheapest option, or asks "what\'s the best price for X" or "where can I buy X for the lowest price". Returns schema.org/Product entities with schema.org/AggregateOffer (lowPrice, offerCount, priceCurrency) across all merchants.',
    inputSchema: {
      type: 'object',
      required: ['product_name'],
      properties: {
        product_name: { type: 'string', description: 'Product name to find best price for (e.g., "iphone 15 pro 256gb", "samsung galaxy s24")' },
        q: { type: 'string', description: 'Alias for product_name (deprecated, use product_name).' },
        category: { type: 'string', description: 'Category to filter by (e.g., "electronics", "fashion")' },
        country_code: { type: 'string', enum: ['SG', 'MY', 'TH', 'PH', 'VN', 'ID', 'US'], description: 'Country to search in (defaults to SG). Alias: country.' },
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
        product_id: { type: 'string', description: 'Numeric ID of the source product (mutually exclusive with product_name)' },
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
  const q = (args.q as string) || '';
  const mode = (args.mode as string) || 'hybrid';
  const geminiKey = process.env.GEMINI_API_KEY ?? '';
  const useVector = vectorDb != null && geminiKey !== '' && q !== '' && mode !== 'keyword';
  const domain = (args.domain as string) || '';
  const region = (args.region as string) || '';
  // country_code is canonical; `country` kept as alias for backward compat
  // BUY-6598: Default to SG for search queries. BUY-31962: skip default for
  // empty-q browse mode — no index on country_code makes filtered scan slow,
  // and recent rows are predominantly US/null so SG filter finds nothing.
  const rawCountry = (((args.country_code as string) || (args.country as string)) || '').toUpperCase();
  const hasExplicitCountry = !!(args.country_code || args.country);
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
    const cached = await redis.get(cacheKey);
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

  // BUY-57657: add connect timeout so pool exhaustion fails fast at 2s instead of
  // blocking the entire 12s statement_timeout. The DB itself is fast (70-130ms) so
  // any 8-12s MCP latency is pool-acquisition contention, not query execution.
  const searchClient = await Promise.race([
    db.connect(),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('db.connect timeout after 2000ms')), 2000)
    ),
  ]).catch(() => {
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
          queryVec = await redis.get(embedKey).catch(() => null);
          if (!queryVec) {
            queryVec = await embedQuery(q, geminiKey);
            await redis.set(embedKey, queryVec, 'EX', 60).catch(() => {});
          }
        } catch (embedErr) {
          console.warn('[search] embed query failed, falling back to FTS:', (embedErr as Error).message);
        }

        if (queryVec && vectorDb) {
          let candidateIds: string[];

          if (mode === 'semantic') {
            // Vector-only: fetch top-200 nearest neighbours from vector DB, then fetch details
            const vecRows = await vectorDb.query<{ product_id: string }>(
              `SELECT product_id FROM product_embeddings
               ORDER BY embedding <=> $1::vector LIMIT 200`,
              [queryVec]
            );
            candidateIds = vecRows.rows.map(r => r.product_id).slice(0, limit + offset);
          } else {
            // Hybrid: app-level RRF of FTS ranks + vector ranks
            const [ftsResult, vecResult] = await Promise.all([
              searchClient.query<{ id: string }>(
                `SELECT id FROM products ${where} LIMIT 200`,
                params
              ),
              vectorDb.query<{ product_id: string }>(
                `SELECT product_id FROM product_embeddings ORDER BY embedding <=> $1::vector LIMIT 200`,
                [queryVec]
              ),
            ]);
            const ftsRank = new Map(ftsResult.rows.map((r, i) => [r.id, i + 1]));
            const vecRank = new Map(vecResult.rows.map((r, i) => [r.product_id, i + 1]));
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

          total = candidateIds.length;
          const pageIds = candidateIds.slice(offset, offset + limit);

          if (pageIds.length === 0) {
            rows = [];
          } else {
            const ph = pageIds.map((_, i) => `$${i + 1}`).join(',');
            const detailResult = await searchClient.query(
              `SELECT id, sku AS source, source AS domain, url, title,
                      price, currency, image_url, metadata, updated_at, region, country_code
               FROM products WHERE id IN (${ph}) AND is_active = true`,
              pageIds
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

  // BUY-69998: never leak another market into top results even if a row's
  // country_code was null/mismatched after the SQL filter.
  if (country) {
    const want = country.toUpperCase();
    rows = (rows as Record<string, unknown>[]).filter(r =>
      String(r.country_code || '').toUpperCase() === want
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
  const formattedText = formatProductForMcp(product as unknown as Record<string, unknown>);
  return {
    content: [{ type: 'text', text: formattedText }],
    product,  // Keep the structured data available too
    response_time_ms: Date.now() - t0,
  };
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
  // BUY-59768: infer currency from country_code (or region) when not explicitly set.
  const REGION_TO_COUNTRY: Record<string, string> = { sg: 'SG', us: 'US', my: 'MY', th: 'TH', vn: 'VN', gb: 'GB' };
  const explicitCurrency = ((args.currency as string) || '').toUpperCase();
  const regionArg = ((args.region as string) || '').toLowerCase();
  const dealsCountry = ((args.country_code as string) || (args.country as string) || REGION_TO_COUNTRY[regionArg] || '').toUpperCase();
  const currency = explicitCurrency || (dealsCountry ? (COUNTRY_CURRENCY[dealsCountry] || 'SGD') : 'SGD');
  const region = regionArg;
  const country = dealsCountry;
  const limit = Math.min(Number(args.limit) || 20, 100);
  const offset = Number(args.offset) || 0;

  const cacheKey = `deals_mcp:${currency}:${minDiscount}:${region}:${country}:${limit}:${offset}`;
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
  if (country) {
    params.push(country.toUpperCase());
    conditions.push(`country_code = $${params.length}`);
  }

  const discountSelect = useDiscountCol
    ? 'discount_pct'
    : `ROUND(((1 - price / NULLIF((metadata->>'original_price')::numeric, 0)) * 100)::numeric, 1) AS discount_pct`;
  const whereClause = conditions.join(' AND ');

  // BUY-64112: strict discount-first query only. The prior recent-window sample
  // + laptop/watch fallback returned keyword rows with discount_pct=0 and hid
  // real discounted products. Query the indexed discount predicate directly.
  const dealsClient = await acquireMcpClient().catch((err: unknown) => {
    console.error('[mcp] get_deals db.connect failed:', err);
    throw { code: -32603, message: 'Database unavailable' };
  });
  let products: ReturnType<typeof buildProduct>[] = [];
  let total = 0;
  try {
    await dealsClient.query('SET statement_timeout = 15000'); // 2026-08-15: fail fast — a 60s DB hang dead-airs the MCP transport
    await dealsClient.query('SET enable_seqscan = off'); // BUY-68615: force index path on production catalog DB
    // BUY-69340 + BUY-69646 merged (2026-08-15): walk the deals index IN ORDER
    // (currency, discount_pct DESC) so the response is the TRUE top discounts —
    // the unordered 10K candidate walk could miss the best deals entirely and
    // shipped 10K full rows (metadata jsonb) to Node per call (27-30s observed
    // under replica load). The ordered walk early-stops at candidateLimit
    // PASSING rows (same worst case as the unordered walk when filters are
    // selective), candidates are id-thin, and full rows join only for the
    // returned page. updated_at tiebreak preserved in SQL.
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
  // BUY-60076: surface `unavailable:true` when the strict + regional fallback
  // returned zero rows, mirroring api/src/routes/mcp.ts so callers can
  // distinguish "no live deals" from "server bug".
  if ((region || country) && products.length === 0) {
    (result as { unavailable?: boolean }).unavailable = true;
  }

  redis.set(cacheKey, JSON.stringify(result), 'EX', 60).catch(() => {});

  return result;
}

// Single-flight guard: at most one DB scan runs per country at a time.
// Concurrent cache-misses coalesce on the same Promise instead of spawning N parallel GROUP-BY scans.
const categoryListInflight = new Map<string, Promise<{ data: unknown[]; meta: Record<string, unknown> }>>();

async function handleListCategories(args: Record<string, unknown>) {
  const t0 = Date.now();
  // BUY-60069: accept the public `region` alias and normalize it to the same
  // ISO-2 country code used by the cache key and materialized-view lookup.
  const REGION_TO_COUNTRY: Record<string, string> = {
    sg: 'SG',
    us: 'US',
    my: 'MY',
    th: 'TH',
    vn: 'VN',
    gb: 'GB',
    uk: 'GB',
    in: 'IN',
    au: 'AU',
    sea: 'SG',
  };
  const normalizeCountry = (value: unknown) => {
    const raw = String(value || '').trim();
    if (!raw) return '';
    return REGION_TO_COUNTRY[raw.toLowerCase()] || raw.toUpperCase();
  };
  const country = normalizeCountry(args.country_code || args.country || args.region) || 'SG';
  const cacheKey = `categories_mcp:top100:${country}`;

  // 1. Redis fast path
  try {
    const cached = await redis.get(cacheKey);
    if (cached) {
      const parsed = JSON.parse(cached);
      return { ...parsed, meta: { ...parsed.meta, cached: true, response_time_ms: Date.now() - t0 } };
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
    const client = await acquireMcpClient();
    try {
      await client.query('SET statement_timeout = 8000');
      const tableCheck = await client.query(
        `SELECT to_regclass('public.mcp_category_summary_by_country') AS tbl`
      );
      let rows: Array<{ slug: string; name: string; product_count: number }>;
      const MAT_VIEW_TIMEOUT_MS = 8000;
      // BUY-60096: canonical MCP must never let category fallback monopolize the shared pool.
      // If the materialized view is empty, keep fallbacks bounded so cold misses stay under 5s.
      const LIVE_TIMEOUT_MS = 1800;
      const FALLBACK_COUNTRIES = new Set(['SG', 'US', 'MY', 'TH', 'VN', 'GB', 'PH', 'ID', 'IN', 'AU']);
      rows = [];
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
      // BUY-59768: view empty or missing for this country — fall through to a
      // bounded live GROUP BY on the country_code partition (uses partition
      // pruning on the LIST-partitioned `products` table so US 30M rows stay
      // tractable). This runs with a separate timeout and only for countries
      // known to have a partition (US excluded — its 30M-row scan still
      // exceeds the timeout budget even with partition pruning).
      if (rows.length === 0 && FALLBACK_COUNTRIES.has(country)) {
        try {
          // BUY-59768: deployed Railway Postgres has small work_mem; force the planner
          // to use a memory-frugal sort-based aggregate instead of HashAggregate.
          await client.query(`SET statement_timeout = ${LIVE_TIMEOUT_MS}`);
          await client.query(`SET work_mem = '256MB'`);
          await client.query(`SET enable_hashagg = off`);
          const liveResult = await client.query(
            `SELECT category_path[1] AS slug, category_path[1] AS name, COUNT(*) AS product_count
             FROM products
             WHERE country_code = $1
               AND category_path[1] IS NOT NULL
               AND is_active = true
             GROUP BY category_path[1]
             ORDER BY COUNT(*) DESC
             LIMIT 100`,
            [country]
          );
          if (liveResult.rows.length > 0) rows = liveResult.rows;
        } catch (_) {
          // Live GROUP BY timed out or failed — leave rows empty and surface unavailable
        } finally {
          await client.query(`SET statement_timeout = ${MAT_VIEW_TIMEOUT_MS}`);
        }
      }
      // BUY-60170/BUY-60200: third fallback — sample recent products via updated_at
      // index, then GROUP BY category. Probe #36 showed cold cache misses returning
      // unavailable because a global 50K sample may contain zero rows for the requested
      // country during ingestion skew. Keep the bounded updated_at scan, but push the
      // country/category predicates into the inner query so each market gets its own
      // recent sample before grouping.
      if (rows.length === 0) {
        try {
          await client.query(`SET statement_timeout = ${LIVE_TIMEOUT_MS}`);
          const recentResult = await client.query(
            `SELECT slug, slug AS name, COUNT(*)::int AS product_count
             FROM (
               SELECT category_path
               FROM products
               WHERE country_code = $1
                 AND category_path[1] IS NOT NULL
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
          if (recentResult.rows.length > 0) rows = recentResult.rows;
        } catch (_) {
          // recent-products fallback timed out — fall through to static category defaults
        }
      }
      if (rows.length === 0) {
        rows = ['Electronics', 'Computers', 'Mobile Phones', 'Home', 'Fashion'].map((name) => ({
          slug: name.toLowerCase().replace(/\s+/g, '-'),
          name,
          product_count: 0,
        }));
      }
      const meta: Record<string, unknown> = {
        total: rows.length,
        country_code: country,
        response_time_ms: 0,
        cached: false,
      };
      meta.unavailable = false;
      const data = { data: rows, meta };
      redis.set(cacheKey, JSON.stringify(data), 'EX', 600).catch(() => {}); // 10 min TTL
      return data;
    } finally {
      releaseClientSafely(client);
    }
  })();

  categoryListInflight.set(country, queryPromise);
  try {
    const result = await queryPromise;
    return { ...result, meta: { ...result.meta, response_time_ms: Date.now() - t0 } };
  } finally {
    categoryListInflight.delete(country);
  }
}

async function handleFindBestPrice(args: Record<string, unknown>) {
  const t0 = Date.now();
  const productName = ((args.product_name as string) || (args.q as string) || '').trim();
  if (!productName) throw { code: -32602, message: 'product_name is required' };

  const country = (((args.country_code as string) || (args.country as string)) || 'SG').toUpperCase();
  const region = (args.region as string) || '';
  const category = (args.category as string) || '';
  const limit = 10;

  // BUY-67522: infer exact device-family queries and reject accessory results.
  const deviceFilter = buildDeviceFilter(productName, country);

  // BUY-26343: price > 0 prevents returning corrupt zero-price records
  const conditions: string[] = ['is_active = true', 'price > 0'];
  const params: unknown[] = [];

  params.push(productName);
  conditions.push(`search_vector @@ plainto_tsquery('english', $${params.length})`);

  if (country) {
    params.push(country);
    conditions.push(`country_code = $${params.length}`);
  }
  if (region) {
    params.push(region);
    conditions.push(`region = $${params.length}`);
  }
  if (category) {
    params.push(`%${category}%`);
    conditions.push(`category ILIKE $${params.length}`);
  }

  // BUY-67522: for exact device queries, enforce a floor that accessories cannot satisfy.
  if (deviceFilter.minLocal > 0) {
    params.push(deviceFilter.minLocal);
    conditions.push(`price >= $${params.length}`);
  }

  const CANDIDATE_POOL = Math.max(limit * 50, 500);
  params.push(CANDIDATE_POOL, limit);
  const where = `WHERE ${conditions.join(' AND ')}`;

  // BUY-31962: same subquery pattern as search_products — fetch candidates via GIN
  // index (no sort), then ORDER BY price ASC on the small candidate set. Avoids the
  // O(N log N) full-sort that causes the 10s/30s timeout on large FTS result sets.
  // BUY-69626: add a bounded title-ILIKE fallback that scans recent market-local rows
  // when FTS misses sparse/stale search_vector entries, instead of returning nothing.
  // (Deduped 2026-08-14: 921c3fa re-added the CANDIDATE_POOL/where declarations that
  // were already defined above — a TS2451 redeclare error that broke every deploy.)
  //
  // BUY-70112: category-qualified queries (e.g. Fashion/SG) hit statement_timeout in the
  // primary FTS query because PostgreSQL misestimates the BitmapAnd selectivity:
  // the planner assumes BitmapAnd(2.3M FTS rows × 99M SG rows) = few rows, but the
  // ILIKE filter on the full SG set removes everything — forcing a sequential scan on
  // 500M+ rows before returning anything.
  //
  // Fix: skip the primary FTS path entirely when a category filter is present.
  // The bounded fallback (recent market-local rows, ordered by updated_at DESC, LIMIT 5000,
  // then ILIKE + price-order) is both faster AND handles category predicates correctly.
  // The primary path is still used for non-category queries where FTS is the right signal.
  let result: { rows: Record<string, unknown>[] } = { rows: [] };
  if (!category) {
    try {
      const primaryClient = await acquireMcpClient();
      try {
        await primaryClient.query('SET statement_timeout = 10000');
        result = await primaryClient.query(
          `WITH cand AS (
             SELECT id, price, updated_at
             FROM products ${where}
             LIMIT $${params.length - 1}
           ), page_ids AS (
             SELECT id, price, updated_at
             FROM cand
             ORDER BY price ASC, updated_at DESC
             LIMIT $${params.length}
           )
           SELECT p.id, p.title, p.price, p.currency, p.source AS domain, p.url, p.image_url,
                  p.country_code, p.updated_at, p.category, p.category_path, p.metadata
           FROM page_ids pi
           JOIN products p ON p.id = pi.id
           ORDER BY pi.price ASC, pi.updated_at DESC`,
          params
        );
      } finally {
        // BUY-56185: discard connections poisoned by statement_timeout.
        releaseClientSafely(primaryClient);
      }
    } catch (primaryErr) {
      // BUY-70088/BUY-70097: broad/sparse strings can produce huge FTS candidate
      // sets and hit statement_timeout. Preserve MCP contract by trying the
      // fallback instead of surfacing generic JSON-RPC -32603.
      console.warn('[mcp] find_best_price primary query failed:', (primaryErr as Error).message);
      result = { rows: [] };
    }
  }

  // BUY-69626: FTS returned nothing — try bounded title-ILIKE on recent market slice
  // BUY-70064: Fixed parameter order — $2 must be titlePattern for both LIMIT and ILIKE.
  // Prior bug: params were [country, CANDIDATE_POOL, titlePattern] making $2=CANDIDATE_POOL,
  // which is an integer but used as text in LIMIT/ILIKE → PostgreSQL type error → -32603.
  // BUY-70112: category-qualified queries also skip primary and enter here directly because
  // the primary FTS path times out on broad category predicates (Fashion/SG pattern).
  if (result.rows.length === 0) {
    const titlePattern = `%${productName}%`;
    const requestedCountry = country || (region.toLowerCase() === 'us' ? 'US' : 'SG');
    const minPrice = deviceFilter.minLocal > 0 ? deviceFilter.minLocal : 0;
    // Parameter order: $1=country, $2=titlePattern, $3=CANDIDATE_POOL, $4=minPrice, $5=category
    // SQL placeholders must match this ordering.
    try {
      const fallbackClient = await acquireMcpClient();
      try {
        await fallbackClient.query('SET statement_timeout = 4500');
        const fallbackParams: unknown[] = [requestedCountry, titlePattern, CANDIDATE_POOL];
        const fallbackConditions = ['is_active = true', 'price > 0', 'country_code = $1'];
        if (minPrice > 0) {
          fallbackParams.push(minPrice);
          fallbackConditions.push(`price >= $${fallbackParams.length}`);
        }
        if (category) {
          fallbackParams.push(`%${category}%`);
        }
        const categoryPredicate = category ? `AND category ILIKE $${fallbackParams.length}` : '';
        result = await fallbackClient.query(
          `SELECT * FROM (
             SELECT id, title, price, currency, source AS domain, url, image_url,
                    country_code, updated_at, category, category_path, metadata
             FROM products
             WHERE ${fallbackConditions.join(' AND ')}
             ORDER BY updated_at DESC
             LIMIT $3
           ) _recent
           WHERE title ILIKE $2
           ${categoryPredicate}
           ORDER BY price ASC
           LIMIT ${limit}`,
          fallbackParams
        );
      } finally {
        // BUY-56185: discard connections poisoned by statement_timeout.
        releaseClientSafely(fallbackClient);
      }
    } catch (fallbackErr) {
      // BUY-70064/BUY-70097: fallback is best-effort only. If sparse
      // markets/timeouts hit the fallback, preserve MCP contract by returning no
      // best_price instead of surfacing a generic JSON-RPC -32603.
      console.warn('[mcp] find_best_price fallback failed:', (fallbackErr as Error).message);
      result = { rows: [] };
    }
  }

  const currency = COUNTRY_CURRENCY[country] || 'SGD';
  const toUsd = CURRENCY_RATES[currency] ?? 1;

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
    // Positive signal: the product_type/category clearly names the device family.
    const positiveSignals: string[] = [];
    if (deviceFilter.type === 'phone') positiveSignals.push('smartphone', 'mobile phone', 'mobile phones');
    if (deviceFilter.type === 'console') positiveSignals.push('game console', 'gaming console', 'consoles');
    if (deviceFilter.type === 'laptop') positiveSignals.push('laptop', 'notebook');
    if (deviceFilter.type === 'tablet') positiveSignals.push('tablet');
    if (deviceFilter.type === 'wearable') positiveSignals.push('smart watch', 'smartwatch', 'fitness tracker');
    const hasPositive = positiveSignals.some(s => text.includes(s));
    const hasNegative = neg.some(t => text.includes(t));
    // If the title explicitly contains a positive device word and no accessory word, keep it.
    if (!hasNegative && hasPositive) return false;
    // If any negative term appears, treat as accessory unless a positive signal also appears.
    if (hasNegative && !hasPositive) return true;
    // Fallback: multi-model titles like "For iPhone 15 14 13 ... screen protector" are accessories.
    if (/\bfor\b.*\b(iphone|galaxy|ipad|ps5|xbox|macbook)\b.*\b\d+\b.*(protector|case|cover|glass|film|cable|adapter|charger|controller|game)\b/.test(text)) return true;
    if (/\bcompatible\b/.test(text) && hasNegative) return true;
    return false;
  };

  const candidates = result.rows.filter(r => !isAccessory(r));

  const data = candidates.map((r: Record<string, unknown>) => {
    const amount = r.price != null ? parseFloat(r.price as string) : null;
    const rowCurrency = (r.currency as string) || currency;
    return {
      id: r.id,
      title: r.title,
      // BUY-65559 / BUY-65685: sentinel-price guard — string when sentinel,
      // structured object otherwise. Parallel to PR #36 in @buywhere/mcp.
      price: formatPriceField(amount, rowCurrency),
      normalized_price_usd: isSentinelPrice(amount) || amount == null ? null : Math.round(amount * toUsd * 100) / 100,
      merchant: r.domain as string,
      url: r.url as string,
      image_url: r.image_url as string,
      country_code: r.country_code as string,
    };
  });

  return {
    best_price: data[0] ?? null,
    alternatives: data.slice(1),
    meta: { total: data.length, country, response_time_ms: Date.now() - t0 },
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
  const productId = (args.product_id as string || '').trim();
  const productName = (args.product_name as string || '').trim();
  const countryCode = ((args.country_code as string) || 'SG').toUpperCase();
  const limit = Math.min(Number(args.limit) || 10, 10);

  // BUY-70124: Resolve product_name → product_id via FTS when product_id is not provided.
  let resolvedId = productId;
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
      `SELECT id, title FROM products WHERE ${conditions.join(' AND ')} ORDER BY ts_rank(search_vector, plainto_tsquery('english', $1)) DESC LIMIT 1`,
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

  if (!vectorDb) {
    throw { code: -32001, message: 'Vector search not available — vector DB not configured' };
  }

  // Step 1: get reference embedding from vector DB
  const refResult = await vectorDb.query<{ embedding: string }>(
    `SELECT embedding::text FROM product_embeddings WHERE product_id = $1`,
    [resolvedId]
  );
  if (!refResult.rows.length) {
    throw { code: -32001, message: 'No embedding found for this product — backfill may still be running' };
  }
  const refEmbedding = refResult.rows[0].embedding;

  // Step 2: find nearest neighbours in vector DB (excluding source product)
  const nearResult = await vectorDb.query<{ product_id: string; distance: number }>(
    `SELECT product_id, (embedding <=> $1::vector)::float AS distance
     FROM product_embeddings WHERE product_id != $2
     ORDER BY distance LIMIT $3`,
    [refEmbedding, resolvedId, limit]
  );
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
      // BUY-65693: sentinel-price guard for find_similar. Mirror BUY-65685
      // (find_best_price / buildProduct): the raw DB `price` value can be a
      // sentinel placeholder (`1`) from the ingest pipeline, which AI agents
      // then format as `.00`. Apply formatSimilarPriceField so the JSON-RPC
      // `price` slot becomes either the structured `{amount, currency}` or
      // the sentinel hint string. When the structured form is returned the
      // sibling `currency` field is redundant, so we omit it.
      const rowCurrency = (p.currency as string) || '';
      const amount = p.price != null ? parseFloat(p.price as string) : null;
      const formattedPrice = formatSimilarPriceField(amount, rowCurrency);
      const isStructured = typeof formattedPrice === 'object';
      return {
        id: p.id,
        title: p.title,
        price: formattedPrice,
        ...(isStructured ? {} : { currency: rowCurrency }),
        domain: p.domain,
        url: p.url,
        image_url: p.image_url,
        similarity: +Math.max(0, 1 - dist).toFixed(4),
      };
    })
    .filter(Boolean);

  return {
    product_id: resolvedId,
    matched_product_name: productName || undefined,
    similar,
    total: similar.length,
    response_time_ms: Date.now() - t0,
  };
}


// BUY-69625: Validate country_code against each tool's supported enum.
// A bogus code (e.g. "ZZ") silently falls through to default-market queries,
// making it impossible to verify the filter was honoured.
const VALID_COUNTRY_CODES: Record<string, string[]> = {
  search_products: ['SG', 'US', 'VN', 'TH', 'MY'],
  get_deals: ['SG', 'US', 'VN', 'TH', 'MY'],
  list_categories: ['SG', 'US', 'VN', 'TH', 'MY', 'GB', 'IN', 'AU'],
  find_best_price: ['SG', 'MY', 'TH', 'PH', 'VN', 'ID', 'US'],
};

function validateCountryCode(toolName: string, args: Record<string, unknown>): void {
  const allowed = VALID_COUNTRY_CODES[toolName];
  if (!allowed) return; // tool doesn't use country_code
  const raw = ((args.country_code as string) || (args.country as string) || '').toUpperCase();
  if (raw && !allowed.includes(raw)) {
    throw { code: -32602, message: `Country code "${raw}" is not supported by ${toolName}. Supported: ${allowed.join(', ')}`, envelopeCode: 'MARKET_UNSUPPORTED' };
  }
}
function buildToolCallResponse(result: unknown) {
  if (
    result &&
    typeof result === 'object' &&
    Array.isArray((result as { content?: unknown }).content)
  ) {
    return result;
  }
  return { content: [{ type: 'text', text: JSON.stringify(result) }] };
}

async function dispatchTool(name: string, args: Record<string, unknown>) {
  validateCountryCode(name, args);
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
function jsonrpcRequestId(id: unknown): string {
  if (typeof id === 'string' && id) return id;
  if (typeof id === 'number' && Number.isFinite(id)) return String(id);
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
        // BUY-22733: surface tool name to queryLog middleware so the finish
        // handler emits `mcp_tool_call` (with tool_name) instead of `api_query`.
        res.locals.mcpToolName = toolName;
        const result = await dispatchTool(toolName, toolArgs);
        return res.json(jsonrpcOk(id, buildToolCallResponse(result)));
      }

      // BUY-68192: backward compatibility for direct tool-name JSON-RPC methods
      // (e.g., "search_products", "list_categories"). Some MCP clients and
      // heartbeat probes invoke tools by name instead of wrapping them in the
      // MCP "tools/call" envelope. Route known tool names to dispatchTool.
      default: {
        const knownTool = TOOLS.find((t) => t.name === method);
        if (knownTool) {
          res.locals.mcpToolName = method;
          const result = await dispatchTool(method, args);
          return res.json(jsonrpcOk(id, buildToolCallResponse(result)));
        }
        return res.json(jsonrpcErr(id, -32601, `Method not found: ${method}`));
      }
    }
  } catch (err: unknown) {
    const e = err as { code?: number; message?: string; envelopeCode?: string };
    if (typeof e.code === 'number' && e.message) {
      const envelopeCode = e.envelopeCode || (e.code === -32001 ? ErrorCode.NOT_FOUND
        : e.code === -32602 ? ErrorCode.INVALID_PARAMETER
        : ErrorCode.INTERNAL_ERROR);
      const status = envelopeCode === ErrorCode.MARKET_UNSUPPORTED ? 400 : 200;
      return res.status(status).json(jsonrpcErr(id, e.code, e.message, undefined, envelopeCode));
    }
    console.error('[mcp] error:', err);
    return res.json(jsonrpcErr(id, -32603, 'Internal error', undefined, ErrorCode.INTERNAL_ERROR));
  }
});

export default router;
