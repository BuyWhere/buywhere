"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const config_1 = require("../config");
const apiKey_1 = require("../middleware/apiKey");
const queryLog_1 = require("../middleware/queryLog");
const router = (0, express_1.Router)();
// MCP tools manifest
const TOOLS = [
    {
        name: 'search_products',
        description: 'Search the BuyWhere product catalog by keyword. Returns products from e-commerce platforms across multiple regions (Singapore, US, etc.).',
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
        description: 'Get discounted products sorted by discount percentage. Returns products with original price and discount percentage. Supports region (sea, us, eu, au) and country (SG, US, VN, MY, ...) filters.',
        inputSchema: {
            type: 'object',
            properties: {
                min_discount: { type: 'number', description: 'Minimum discount percentage (default 10)', default: 10 },
                region: { type: 'string', description: 'Filter by region (sea, us, eu, au)' },
                country: { type: 'string', description: 'Filter by ISO country code (SG, US, VN, MY)' },
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
];
// Tool handlers
async function handleSearchProducts(args) {
    const t0 = Date.now();
    const q = args.q || '';
    const domain = args.domain || '';
    const region = args.region || '';
    // country_code is canonical; `country` kept as alias for backward compat
    const country = ((args.country_code || args.country) || '').toUpperCase();
    const minPrice = args.min_price != null ? Number(args.min_price) : null;
    const maxPrice = args.max_price != null ? Number(args.max_price) : null;
    const limit = Math.min(Number(args.limit) || 20, 100);
    const offset = Number(args.offset) || 0;
    // Infer default currency from country_code; price filters apply in this currency
    const COUNTRY_CURRENCY = { SG: 'SGD', US: 'USD', VN: 'VND', TH: 'THB', MY: 'MYR' };
    const currency = country ? (COUNTRY_CURRENCY[country] || 'SGD') : 'SGD';
    const cacheKey = `fts:${q}:${domain}:${region}:${country}:${currency}:${minPrice}:${maxPrice}:${limit}:${offset}`;
    try {
        const cached = await config_1.redis.get(cacheKey);
        if (cached) {
            const parsed = JSON.parse(cached);
            return { ...parsed, meta: { ...parsed.meta, cached: true, response_time_ms: Date.now() - t0 } };
        }
    }
    catch (_) { /* redis miss — proceed */ }
    const conditions = [];
    const params = [];
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
    let rows;
    let total;
    if (q) {
        // Count matching rows to pick query strategy
        const countResult = await config_1.db.query(`SELECT COUNT(*) FROM products ${where}`, params);
        total = parseInt(countResult.rows[0].count, 10);
        if (total <= 1000) {
            params.push(limit, offset);
            const result = await config_1.db.query(`SELECT id, sku AS source, source AS domain, url, title,
                price, currency, image_url, metadata, updated_at,
                region, country_code,
                ts_rank(search_vector, plainto_tsquery('english', $1)) AS rank
         FROM products ${where}
         ORDER BY rank DESC
         LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
            rows = result.rows;
        }
        else {
            const CANDIDATE_LIMIT = Math.min((limit + offset) * 10, 5000);
            params.push(CANDIDATE_LIMIT);
            const candidateResult = await config_1.db.query(`SELECT id, sku AS source, source AS domain, url, title,
                price, currency, image_url, metadata, updated_at,
                region, country_code,
                ts_rank(search_vector, plainto_tsquery('english', $1)) AS rank
         FROM products ${where}
         ORDER BY rank DESC
         LIMIT $${params.length}`, params);
            rows = candidateResult.rows.slice(offset, offset + limit);
        }
    }
    else {
        const countResult = await config_1.db.query(`SELECT COUNT(*) FROM products ${where}`, params);
        total = parseInt(countResult.rows[0].count, 10);
        params.push(limit, offset);
        const result = await config_1.db.query(`SELECT id, sku AS source, platform AS domain, url, name AS title,
              price, original_price, currency, image_url, metadata, updated_at,
              region, country_code
       FROM products ${where}
       ORDER BY updated_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
        rows = result.rows;
    }
    const data = rows.map(r => ({
        id: r.id,
        source: r.source,
        domain: r.domain,
        url: r.url,
        title: r.title,
        price: r.price,
        currency: r.currency || currency,
        image_url: r.image_url,
        metadata: r.metadata,
        region: r.region || null,
        country_code: r.country_code || null,
        updated_at: r.updated_at,
    }));
    const result = {
        data,
        meta: { total: total, limit, offset, response_time_ms: Date.now() - t0, cached: false },
    };
    try {
        await config_1.redis.set(cacheKey, JSON.stringify(result), 'EX', 60);
    }
    catch (_) { /* cache write failure is non-fatal */ }
    return result;
}
async function handleGetProduct(args) {
    const t0 = Date.now();
    const { id } = args;
    const result = await config_1.db.query(`SELECT id, sku AS source, source AS domain, url, title,
            price, currency, image_url, brand, category_path,
            avg_rating AS rating, review_count, metadata, updated_at, region, country_code
     FROM products WHERE id = $1`, [id]);
    if (!result.rows.length)
        throw { code: -32001, message: 'Product not found' };
    return { data: result.rows[0], meta: { response_time_ms: Date.now() - t0 } };
}
async function handleCompareProducts(args) {
    const t0 = Date.now();
    const ids = args.ids;
    if (!ids || ids.length < 2)
        throw { code: -32602, message: 'Provide at least 2 product IDs' };
    const placeholders = ids.map((_, i) => `$${i + 1}`).join(',');
    const result = await config_1.db.query(`SELECT id, sku AS source, source AS domain, url, title,
            price, currency, image_url, brand, category_path,
            avg_rating AS rating, review_count, metadata, updated_at, region, country_code
     FROM products WHERE id IN (${placeholders})`, ids);
    return { data: result.rows, meta: { count: result.rows.length, response_time_ms: Date.now() - t0 } };
}
async function handleGetDeals(args) {
    const t0 = Date.now();
    const minDiscount = Number(args.min_discount) || 10;
    const region = args.region || '';
    const country = args.country || '';
    const limit = Math.min(Number(args.limit) || 20, 100);
    const offset = Number(args.offset) || 0;
    const conditions = [
        `(metadata->>'original_price')::numeric > price`,
        `price > 0`,
        `(1 - price / NULLIF((metadata->>'original_price')::numeric, 0)) * 100 >= $1`,
    ];
    const params = [minDiscount];
    if (region) {
        params.push(region);
        conditions.push(`region = $${params.length}`);
    }
    if (country) {
        params.push(country.toUpperCase());
        conditions.push(`country_code = $${params.length}`);
    }
    const whereClause = conditions.join(' AND ');
    params.push(limit, offset);
    const limitIdx = params.length - 1;
    const offsetIdx = params.length;
    const result = await config_1.db.query(`SELECT id, sku AS source, source AS domain, url, title,
            price, (metadata->>'original_price')::numeric AS original_price,
            currency, image_url, metadata, updated_at, region, country_code,
            ROUND((1 - price / NULLIF((metadata->>'original_price')::numeric, 0)) * 100) AS discount_pct
     FROM products
     WHERE ${whereClause}
     ORDER BY discount_pct DESC
     LIMIT $${limitIdx} OFFSET $${offsetIdx}`, params);
    const countResult = await config_1.db.query(`SELECT COUNT(*) FROM products WHERE ${whereClause}`, params.slice(0, params.length - 2));
    return {
        data: result.rows,
        meta: { total: parseInt(countResult.rows[0].count, 10), limit, offset, response_time_ms: Date.now() - t0 },
    };
}
async function handleListCategories(_args) {
    const t0 = Date.now();
    const result = await config_1.db.query(`SELECT category_path[1] AS slug,
            category_path[1] AS name,
            COUNT(*) AS product_count
     FROM products
     WHERE category_path IS NOT NULL AND array_length(category_path, 1) > 0
     GROUP BY 1
     ORDER BY product_count DESC
     LIMIT 100`);
    return { data: result.rows, meta: { total: result.rows.length, response_time_ms: Date.now() - t0 } };
}
async function dispatchTool(name, args) {
    switch (name) {
        case 'search_products': return handleSearchProducts(args);
        case 'get_product': return handleGetProduct(args);
        case 'compare_products': return handleCompareProducts(args);
        case 'get_deals': return handleGetDeals(args);
        case 'list_categories': return handleListCategories(args);
        default:
            throw { code: -32601, message: `Unknown tool: ${name}` };
    }
}
// JSON-RPC 2.0 response helpers
function jsonrpcOk(id, result) {
    return { jsonrpc: '2.0', id, result };
}
function jsonrpcErr(id, code, message, data) {
    return { jsonrpc: '2.0', id, error: { code, message, ...(data != null ? { data } : {}) } };
}
// GET /mcp — info endpoint for browser / reviewer verification.
// Returns a JSON descriptor instead of Express's default 404 so registry
// reviewers and DevRel verifiers can confirm the endpoint is live without
// needing to craft a JSON-RPC POST. The actual MCP protocol uses POST only.
router.get('/', (_req, res) => {
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
router.post('/', async (req, res, next) => {
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
router.post('/', apiKey_1.requireApiKey, apiKey_1.checkRateLimit, (0, queryLog_1.queryLogMiddleware)('mcp'), async (req, res) => {
    const body = req.body;
    // Validate JSON-RPC envelope
    if (!body || body.jsonrpc !== '2.0' || !body.method) {
        return res.status(400).json(jsonrpcErr(body?.id ?? null, -32600, 'Invalid JSON-RPC request'));
    }
    const { id, method, params } = body;
    const args = (params && typeof params === 'object' && !Array.isArray(params)) ? params : {};
    try {
        switch (method) {
            case 'tools/call': {
                const toolName = args.name;
                const toolArgs = (args.arguments && typeof args.arguments === 'object') ? args.arguments : {};
                if (!toolName) {
                    return res.json(jsonrpcErr(id, -32602, 'Missing tool name'));
                }
                const result = await dispatchTool(toolName, toolArgs);
                return res.json(jsonrpcOk(id, {
                    content: [{ type: 'text', text: JSON.stringify(result) }],
                }));
            }
            default:
                return res.json(jsonrpcErr(id, -32601, `Method not found: ${method}`));
        }
    }
    catch (err) {
        const e = err;
        if (e.code && e.message) {
            return res.json(jsonrpcErr(id, e.code, e.message));
        }
        console.error('[mcp] error:', err);
        return res.json(jsonrpcErr(id, -32603, 'Internal error'));
    }
});
exports.default = router;
