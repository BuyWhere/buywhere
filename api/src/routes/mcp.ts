import { Router, Request, Response, NextFunction } from 'express';
import { db, redis } from '../config';
import { requireApiKey, checkRateLimit } from '../middleware/apiKey';
import { queryLogMiddleware } from '../middleware/queryLog';
import { buildErrorEnvelope, ErrorCode, ErrorCodeType } from '../middleware/errors';
import { buildProduct, buildSearchResponse, COUNTRY_CURRENCY, CURRENCY_RATES } from '../lib/response';

const router = Router();

function extractProductId(args: Record<string, unknown>): string | null {
  const raw = args.id ?? args.product_id;
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return trimmed || null;
}

function extractProductIds(args: Record<string, unknown>): string[] {
  const raw = args.ids ?? args.product_ids;
  if (Array.isArray(raw)) {
    return raw
      .filter((id): id is string => typeof id === 'string')
      .map(id => id.trim())
      .filter(Boolean)
      .slice(0, 10);
  }
  if (typeof raw === 'string') {
    return raw
      .split(',')
      .map(id => id.trim())
      .filter(Boolean)
      .slice(0, 10);
  }
  return [];
}

// MCP tools manifest
const TOOLS = [
  {
    name: 'search_products',
    description: 'Search the BuyWhere product catalog by keyword. Returns products from e-commerce platforms across multiple regions (Singapore, US, etc.). Use compact=true for agent-optimized responses with structured_specs, comparison_attributes, and normalized_price_usd fields.',
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
      properties: {},
    },
  },
  {
    name: 'find_best_price',
    description: 'Use this whenever a user asks about prices, wants to find the cheapest option, or asks "what\'s the best price for X" or "where can I buy X for the lowest price". This finds the best current price across all merchants.',
    inputSchema: {
      type: 'object',
      required: ['product_name'],
      properties: {
        product_name: { type: 'string', description: 'Product name to find best price for (e.g., "iphone 15 pro 256gb", "samsung galaxy s24")' },
        category: { type: 'string', description: 'Category to filter by (e.g., "electronics", "fashion")' },
        country_code: { type: 'string', enum: ['SG', 'MY', 'TH', 'PH', 'VN', 'ID', 'US'], description: 'Country to search in (defaults to SG). Alias: country.' },
        country: { type: 'string', description: 'Alias for country_code (deprecated, use country_code)' },
        region: { type: 'string', enum: ['us', 'sea'], description: 'Region filter - use "us" for United States or "sea" for Southeast Asia' },
      },
    },
  },
];

// Tool handlers
async function handleSearchProducts(args: Record<string, unknown>) {
  const t0 = Date.now();
  const q = (args.q as string) || '';
  const domain = (args.domain as string) || '';
  const region = (args.region as string) || '';
  // country_code is canonical; `country` kept as alias for backward compat
  // Default to SG when no country/region specified (BUY-6598: SG market is primary)
  const rawCountry = (((args.country_code as string) || (args.country as string)) || '').toUpperCase();
  const country = rawCountry || (!region ? 'SG' : '');
  const category = (args.category as string) || '';
  const minPrice = args.min_price != null ? Number(args.min_price) : null;
  const maxPrice = args.max_price != null ? Number(args.max_price) : null;
  const limit = Math.min(Number(args.limit) || 20, 100);
  const offset = Number(args.offset) || 0;
  const compact = args.compact === true;
  const currency = country ? (COUNTRY_CURRENCY[country] || 'SGD') : 'SGD';

  const cacheKey = `fts:${q}:${domain}:${region}:${country}:${category}:${currency}:${minPrice}:${maxPrice}:${limit}:${offset}:${compact ? 'c' : 'f'}`;
  try {
    const cached = await redis.get(cacheKey);
    if (cached) {
      const parsed = JSON.parse(cached);
      if (parsed.results) {
        return { ...parsed, cached: true, response_time_ms: Date.now() - t0 };
      }
    }
  } catch (_) { /* redis miss — proceed */ }

  const conditions: string[] = [];
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

  if (q) {
    // Count matching rows to pick query strategy
    const countResult = await db.query(
      `SELECT COUNT(*) FROM products ${where}`,
      params
    );
    total = parseInt(countResult.rows[0].count, 10);

    if (total <= 1000) {
      params.push(limit, offset);
      const result = await db.query(
        `SELECT id, sku AS source, source AS domain, url, title,
                price, currency, image_url, metadata, updated_at,
                region, country_code,
                ts_rank(search_vector, plainto_tsquery('english', $1)) AS rank
         FROM products ${where}
         ORDER BY rank DESC
         LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params
      );
      rows = result.rows;
    } else {
      const CANDIDATE_LIMIT = Math.min((limit + offset) * 10, 5000);
      params.push(CANDIDATE_LIMIT);
      const candidateResult = await db.query(
        `SELECT id, sku AS source, source AS domain, url, title,
                price, currency, image_url, metadata, updated_at,
                region, country_code,
                ts_rank(search_vector, plainto_tsquery('english', $1)) AS rank
         FROM products ${where}
         ORDER BY rank DESC
         LIMIT $${params.length}`,
        params
      );
      rows = candidateResult.rows.slice(offset, offset + limit);
    }
  } else {
    const countResult = await db.query(`SELECT COUNT(*) FROM products ${where}`, params);
    total = parseInt(countResult.rows[0].count, 10);
    params.push(limit, offset);
    const result = await db.query(
      `SELECT id, sku AS source, source AS domain, url, title,
              price, currency, image_url, metadata, updated_at,
              region, country_code
       FROM products ${where}
       ORDER BY updated_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    rows = result.rows;
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
  const id = extractProductId(args);
  if (!id) throw { code: -32602, message: 'id is required' };
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
  } catch {
    throw { code: -32001, message: 'Product not found' };
  }
  if (!result.rows.length) throw { code: -32001, message: 'Product not found' };
  const product = buildProduct(result.rows[0] as Record<string, unknown>, 'SGD', false);
  return buildSearchResponse([product], 1, 1, 0, Date.now() - t0, false);
}

async function handleCompareProducts(args: Record<string, unknown>) {
  const t0 = Date.now();
  const ids = extractProductIds(args);
  if (!ids || ids.length < 2) throw { code: -32602, message: 'Provide at least 2 product IDs' };
  const result = await db.query(
    `SELECT id, sku AS source_id, source AS domain, url,
            title, price, currency, image_url, metadata,
            category_path, brand, avg_rating AS rating, review_count, updated_at, region, country_code
     FROM products
     WHERE id = ANY($1::text[])
     ORDER BY array_position($1::text[], id::text)`,
    [ids]
  );
  const products = result.rows.map((r: Record<string, unknown>) => buildProduct(r, 'SGD', false));
  const uniqueCurrencies = [...new Set(
    result.rows.map((r: Record<string, unknown>) => r.currency).filter((currency): currency is string => typeof currency === 'string' && currency.length > 0)
  )];
  const currenciesMixed = uniqueCurrencies.length > 1;

  return {
    ...buildSearchResponse(products, products.length, ids.length, 0, Date.now() - t0, false),
    currencies_mixed: currenciesMixed,
    ...(currenciesMixed && {
      currency_warning: `Products span multiple currencies (${uniqueCurrencies.join(', ')}). Prices are not comparable across currencies — do not aggregate or rank by price in comparison_summary.`,
    }),
  };
}

async function handleGetDeals(args: Record<string, unknown>) {
  const t0 = Date.now();
  const minDiscount = Number(args.min_discount) || 10;
  const currency = ((args.currency as string) || 'SGD').toUpperCase();
  const region = (args.region as string) || '';
  const country = ((args.country_code as string) || (args.country as string) || '').toUpperCase();
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

  const conditions: string[] = [
    `currency = $1`,
    `(metadata->>'original_price')::numeric > price`,
    `(metadata->>'original_price')::numeric < price * 100`,
    `price > 0`,
    `(1 - price / NULLIF((metadata->>'original_price')::numeric, 0)) * 100 >= $2`,
  ];
  const params: unknown[] = [currency, minDiscount];

  if (region) {
    params.push(region);
    conditions.push(`region = $${params.length}`);
  }
  if (country) {
    params.push(country.toUpperCase());
    conditions.push(`country_code = $${params.length}`);
  }

  const whereClause = conditions.join(' AND ');

  const [countResult, dataResult] = await Promise.all([
    db.query(
      `SELECT COUNT(*) FROM products WHERE ${whereClause}`,
      params
    ),
    (() => {
      const dataParams = [...params, limit, offset];
      const limitIdx = dataParams.length - 1;
      const offsetIdx = dataParams.length;
      return db.query(
        `SELECT id, sku AS source, source AS domain, url, title,
                price, (metadata->>'original_price')::numeric AS original_price,
                currency, image_url, metadata, updated_at, region, country_code,
                ROUND((1 - price / NULLIF((metadata->>'original_price')::numeric, 0)) * 100) AS discount_pct
         FROM products
         WHERE ${whereClause}
         ORDER BY discount_pct DESC
         LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
        dataParams
      );
    })(),
  ]);

  const products = dataResult.rows.map((r: Record<string, unknown>) =>
    buildProduct(r, currency, false)
  );
  const total = parseInt(countResult.rows[0].count, 10);
  const result = buildSearchResponse(products, total, limit, offset, Date.now() - t0, false);

  redis.set(cacheKey, JSON.stringify(result), 'EX', 60).catch(() => {});

  return result;
}

async function handleListCategories(_args: Record<string, unknown>) {
  const t0 = Date.now();
  const cacheKey = 'categories_mcp:top100';
  try {
    const cached = await redis.get(cacheKey);
    if (cached) {
      const parsed = JSON.parse(cached);
      return { ...parsed, meta: { ...parsed.meta, cached: true, response_time_ms: Date.now() - t0 } };
    }
  } catch (_) {}

  const result = await db.query(
    `SELECT category_path[1] AS slug,
            category_path[1] AS name,
            COUNT(*) AS product_count
     FROM products
     WHERE category_path IS NOT NULL AND array_length(category_path, 1) > 0
     GROUP BY 1
     ORDER BY product_count DESC
     LIMIT 100`
  );
  const data = { data: result.rows, meta: { total: result.rows.length, response_time_ms: Date.now() - t0, cached: false } };
  redis.set(cacheKey, JSON.stringify(data), 'EX', 300).catch(() => {});
  return data;
}

async function handleFindBestPrice(args: Record<string, unknown>) {
  const t0 = Date.now();
  const productName = (args.product_name as string) || '';
  if (!productName) throw { code: -32602, message: 'product_name is required' };

  const country = (((args.country_code as string) || (args.country as string)) || 'SG').toUpperCase();
  const region = (args.region as string) || '';
  const category = (args.category as string) || '';
  const limit = 10;

  const conditions: string[] = ['is_active = true'];
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

  params.push(limit);
  const where = `WHERE ${conditions.join(' AND ')}`;
  const result = await db.query(
    `SELECT id, title, price, currency, source AS domain, url, image_url,
            country_code,
            ts_rank(search_vector, plainto_tsquery('english', $1)) AS rank
     FROM products ${where}
     ORDER BY price ASC, rank DESC
     LIMIT $${params.length}`,
    params
  );

  const currency = COUNTRY_CURRENCY[country] || 'SGD';
  const toUsd = CURRENCY_RATES[currency] ?? 1;

  const data = result.rows.map((r: Record<string, unknown>) => ({
    id: r.id,
    title: r.title,
    price: { amount: r.price != null ? parseFloat(r.price as string) : null, currency: r.currency || currency },
    normalized_price_usd: r.price != null ? Math.round(Number(r.price) * toUsd * 100) / 100 : null,
    merchant: r.domain as string,
    url: r.url as string,
    image_url: r.image_url as string,
    country_code: r.country_code as string,
  }));

  return {
    best_price: data[0] ?? null,
    alternatives: data.slice(1),
    meta: { total: data.length, country, response_time_ms: Date.now() - t0 },
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
    default:
      throw { code: -32601, message: `Unknown tool: ${name}` };
  }
}

function isDirectToolMethod(method: string): boolean {
  return TOOLS.some(tool => tool.name === method);
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

// POST /mcp — authenticated methods: tools/call and legacy direct tool method names.
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
        const result = await dispatchTool(toolName, toolArgs);
        return res.json(jsonrpcOk(id, {
          content: [{ type: 'text', text: JSON.stringify(result) }],
        }));
      }

      default:
        if (isDirectToolMethod(method)) {
          const result = await dispatchTool(method, args);
          return res.json(jsonrpcOk(id, {
            content: [{ type: 'text', text: JSON.stringify(result) }],
          }));
        }
        return res.json(jsonrpcErr(id, -32601, `Method not found: ${method}`));
    }
  } catch (err: unknown) {
    const e = err as { code?: number; message?: string };
    if (typeof e.code === 'number' && e.message) {
      const envelopeCode = e.code === -32001 ? ErrorCode.NOT_FOUND
        : e.code === -32602 ? ErrorCode.INVALID_PARAMETER
        : ErrorCode.INTERNAL_ERROR;
      return res.json(jsonrpcErr(id, e.code, e.message, undefined, envelopeCode));
    }
    console.error('[mcp] error:', err);
    return res.json(jsonrpcErr(id, -32603, 'Internal error', undefined, ErrorCode.INTERNAL_ERROR));
  }
});

export default router;
