"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const config_1 = require("../config");
const apiKey_1 = require("../middleware/apiKey");
const queryLog_1 = require("../middleware/queryLog");
const errors_1 = require("../middleware/errors");
const response_1 = require("../lib/response");
const router = (0, express_1.Router)();
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
            properties: {
                country_code: { type: 'string', enum: ['SG', 'US', 'VN', 'TH', 'MY'], description: 'Filter by ISO country code. Defaults to SG.' },
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
                product_name: { type: 'string', description: 'Product name to find best price for (e.g., "iphone 15 pro 256gb", "samsung galaxy s24")' },
                category: { type: 'string', description: 'Category to filter by (e.g., "electronics", "fashion")' },
                country_code: { type: 'string', enum: ['SG', 'MY', 'TH', 'PH', 'VN', 'ID', 'US'], description: 'Country to search in (defaults to SG). Alias: country.' },
                country: { type: 'string', description: 'Alias for country_code (deprecated, use country_code)' },
                region: { type: 'string', enum: ['us', 'sea'], description: 'Region filter - use "us" for United States or "sea" for Southeast Asia' },
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
let _hasDiscountPct;
async function probeDiscountPctColumn() {
    try {
        const probe = await config_1.db.query(`SELECT is_generated FROM information_schema.columns WHERE table_name = 'products' AND column_name = 'discount_pct' LIMIT 1`);
        return probe.rows.length > 0 && probe.rows[0].is_generated === 'ALWAYS';
    }
    catch {
        return false;
    }
}
probeDiscountPctColumn().then(result => { _hasDiscountPct = result; }).catch(() => { });
// Tool handlers
async function handleSearchProducts(args) {
    const t0 = Date.now();
    const q = args.q || '';
    const domain = args.domain || '';
    const region = args.region || '';
    // country_code is canonical; `country` kept as alias for backward compat
    // BUY-6598: Default to SG for search queries. BUY-31962: skip default for
    // empty-q browse mode — no index on country_code makes filtered scan slow,
    // and recent rows are predominantly US/null so SG filter finds nothing.
    const rawCountry = ((args.country_code || args.country) || '').toUpperCase();
    const hasExplicitCountry = !!(args.country_code || args.country);
    const country = rawCountry || (q && !region ? 'SG' : '');
    const category = args.category || '';
    const minPrice = args.min_price != null ? Number(args.min_price) : null;
    const maxPrice = args.max_price != null ? Number(args.max_price) : null;
    const limit = Math.min(Number(args.limit) || 20, 100);
    const offset = Number(args.offset) || 0;
    const compact = args.compact === true;
    const currency = country ? (response_1.COUNTRY_CURRENCY[country] || 'SGD') : 'SGD';
    const cacheKey = `fts:${q}:${domain}:${region}:${country}:${category}:${currency}:${minPrice}:${maxPrice}:${limit}:${offset}:${compact ? 'c' : 'f'}`;
    try {
        const cached = await config_1.redis.get(cacheKey);
        if (cached) {
            const parsed = JSON.parse(cached);
            if (parsed.results) {
                return { ...parsed, cached: true, response_time_ms: Date.now() - t0 };
            }
        }
    }
    catch (_) { /* redis miss — proceed */ }
    const conditions = ['is_active = true'];
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
    if (category) {
        params.push(`%${category}%`);
        conditions.push(`category ILIKE $${params.length}`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    let rows;
    let total;
    // Use a dedicated client with extended timeout — FTS on 14M rows can exceed the 10s pool default.
    const searchClient = await config_1.db.connect();
    try {
        await searchClient.query('SET statement_timeout = 30000'); // BUY-31962: bumped from 10s — non-FTS filtered scans on 14M rows can approach 10s
        const COUNT_CAP = 1001;
        if (q) {
            const countResult = await searchClient.query(`SELECT COUNT(*) FROM (SELECT 1 FROM products ${where} LIMIT ${COUNT_CAP}) _sub`, params);
            total = parseInt(countResult.rows[0].count, 10);
            // BUY-31962: ORDER BY updated_at DESC on large FTS result sets forces PostgreSQL to
            // sort all matching rows (100k+ for "laptop") before applying LIMIT, exceeding the 10s
            // timeout. Fix: fetch candidates via GIN index (no sort) in a subquery, then sort the
            // small candidate set. This turns an O(N log N) sort into O(C log C) where C << N.
            const CANDIDATE_LIMIT = Math.min((limit + offset) * 10, 5000);
            params.push(CANDIDATE_LIMIT, limit, offset);
            const result = await searchClient.query(`SELECT * FROM (
           SELECT id, sku AS source, source AS domain, url, title,
                  price, currency, image_url, metadata, updated_at,
                  region, country_code
           FROM products ${where}
           LIMIT $${params.length - 2}
         ) _candidates
         ORDER BY updated_at DESC
         LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
            rows = result.rows;
        }
        else {
            // No FTS — browse mode. Use reltuples for approximate total and fetch
            // recent products via idx_products_updated_at (3ms for 500 rows).
            // If user explicitly passed country_code/region, overfetch and filter
            // in-application (no composite index on country_code+updated_at).
            const approxResult = await searchClient.query(`SELECT reltuples::bigint AS estimate FROM pg_class WHERE relname = 'products'`);
            total = parseInt(approxResult.rows[0]?.estimate ?? '0', 10);
            const needsFilter = !!(country || region);
            const fetchLimit = needsFilter ? Math.min((limit + offset) * 20, 5000) : limit + offset;
            const rawResult = await searchClient.query(`SELECT id, sku AS source, source AS domain, url, title,
                price, currency, image_url, metadata, updated_at,
                region, country_code
         FROM products
         ORDER BY updated_at DESC
         LIMIT $1`, [fetchLimit]);
            if (needsFilter) {
                let filtered = rawResult.rows;
                if (country) {
                    filtered = filtered.filter(r => (r.country_code || '').toUpperCase() === country);
                }
                if (region) {
                    filtered = filtered.filter(r => (r.region || '').toLowerCase() === region.toLowerCase());
                }
                rows = filtered.slice(offset, offset + limit);
            }
            else {
                rows = rawResult.rows.slice(offset, offset + limit);
            }
        }
    }
    finally {
        searchClient.release();
    }
    const products = rows.map(r => (0, response_1.buildProduct)(r, currency, compact));
    const result = (0, response_1.buildSearchResponse)(products, total, limit, offset, Date.now() - t0, false);
    try {
        await config_1.redis.set(cacheKey, JSON.stringify(result), 'EX', 60);
    }
    catch (_) { /* cache write failure is non-fatal */ }
    return result;
}
async function handleGetProduct(args) {
    const t0 = Date.now();
    const { id } = args;
    if (!id || typeof id !== 'string' || !id.trim()) {
        throw { code: -32602, message: 'missing required parameter: id' };
    }
    let result;
    try {
        result = await config_1.db.query(`SELECT id, sku AS source, source AS domain, url, title,
              price, currency, image_url, brand, category_path,
              avg_rating AS rating, review_count, metadata, updated_at, region, country_code
       FROM products WHERE id = $1`, [id.trim()]);
    }
    catch {
        throw { code: -32001, message: 'Product not found' };
    }
    if (!result.rows.length)
        throw { code: -32001, message: 'Product not found' };
    const product = (0, response_1.buildProduct)(result.rows[0], 'SGD', false);
    return (0, response_1.buildSearchResponse)([product], 1, 1, 0, Date.now() - t0, false);
}
async function handleCompareProducts(args) {
    const t0 = Date.now();
    const ids = args.ids;
    if (!ids || !Array.isArray(ids) || ids.length < 2) {
        throw { code: -32602, message: 'Provide at least 2 product IDs' };
    }
    const validIds = ids.filter((id) => id != null && String(id).trim());
    if (validIds.length < 2) {
        throw { code: -32602, message: 'Provide at least 2 valid product IDs' };
    }
    const placeholders = validIds.map((_, i) => `$${i + 1}`).join(',');
    let result;
    try {
        result = await config_1.db.query(`SELECT id, sku AS source, source AS domain, url, title,
              price, currency, image_url, brand, category_path,
              avg_rating AS rating, review_count, metadata, updated_at, region, country_code
       FROM products WHERE id IN (${placeholders})`, validIds);
    }
    catch {
        throw { code: -32001, message: 'Products not found' };
    }
    const products = result.rows.map((r) => (0, response_1.buildProduct)(r, 'SGD', false));
    return (0, response_1.buildSearchResponse)(products, products.length, validIds.length, 0, Date.now() - t0, false);
}
async function handleGetDeals(args) {
    const t0 = Date.now();
    const minDiscount = Number(args.min_discount) || 10;
    const currency = (args.currency || 'SGD').toUpperCase();
    const region = args.region || '';
    const country = (args.country_code || args.country || '').toUpperCase();
    const limit = Math.min(Number(args.limit) || 20, 100);
    const offset = Number(args.offset) || 0;
    const cacheKey = `deals_mcp:${currency}:${minDiscount}:${region}:${country}:${limit}:${offset}`;
    try {
        const cached = await config_1.redis.get(cacheKey);
        if (cached) {
            const parsed = JSON.parse(cached);
            if (parsed.results) {
                return { ...parsed, cached: true, response_time_ms: Date.now() - t0 };
            }
        }
    }
    catch (_) { }
    let useDiscountCol = _hasDiscountPct;
    if (useDiscountCol === undefined) {
        useDiscountCol = await probeDiscountPctColumn();
        _hasDiscountPct = useDiscountCol;
    }
    const conditions = [
        `currency = $1`,
        `price > 0`,
        `is_active = true`,
    ];
    if (useDiscountCol) {
        conditions.push(`discount_pct >= $2`);
    }
    else {
        // Guard: only consider rows where original_price is a valid numeric string.
        // Matches the partial index predicate on idx_products_deals_country/region.
        conditions.push(`metadata->>'original_price' ~ '^[0-9]+(\\.[0-9]+)?$'`);
        conditions.push(`(metadata->>'original_price')::numeric > price`);
        conditions.push(`((1 - price / NULLIF((metadata->>'original_price')::numeric, 0)) * 100) >= $2`);
    }
    const params = [currency, minDiscount];
    if (region) {
        params.push(region);
        conditions.push(`region = $${params.length}`);
    }
    if (country) {
        params.push(country.toUpperCase());
        conditions.push(`country_code = $${params.length}`);
    }
    const whereClause = conditions.join(' AND ');
    const discountSelect = useDiscountCol
        ? 'discount_pct'
        : `ROUND(((1 - price / NULLIF((metadata->>'original_price')::numeric, 0)) * 100)::numeric, 1) AS discount_pct`;
    const discountOrder = useDiscountCol
        ? 'discount_pct DESC'
        : `(1 - price / NULLIF((metadata->>'original_price')::numeric, 0)) DESC`;
    // Use dedicated client with extended timeout when discount_pct column is absent.
    // When discount_pct exists (happy path), this query is fast via idx_products_deals.
    // Without it, the metadata regex+cast fallback can exceed the default 10s statement_timeout.
    const dealsClient = await config_1.db.connect();
    let products = [];
    let total = 0;
    try {
        // 5-minute timeout for both paths: fast path is index-backed but deals index may
        // still lag on very large scans; fallback regex on 13.7M rows needs the headroom.
        await dealsClient.query('SET statement_timeout = 300000');
        const countResult = await dealsClient.query(`SELECT COUNT(*) FROM (SELECT 1 FROM products WHERE ${whereClause} LIMIT 1001) _sub`, params);
        total = parseInt(countResult.rows[0].count, 10);
        const dataParams = [...params, limit, offset];
        const limitIdx = dataParams.length - 1;
        const offsetIdx = dataParams.length;
        const dataResult = await dealsClient.query(`SELECT id, sku AS source, source AS domain, url, title,
              price,
              CASE WHEN metadata->>'original_price' ~ '^[0-9]+(\\.[0-9]+)?$'
                   THEN (metadata->>'original_price')::numeric ELSE NULL END AS original_price,
              currency, image_url, metadata, updated_at, region, country_code,
              ${discountSelect}
       FROM products
       WHERE ${whereClause}
       ORDER BY ${discountOrder}
       LIMIT $${limitIdx} OFFSET $${offsetIdx}`, dataParams);
        products = dataResult.rows.map((r) => (0, response_1.buildProduct)(r, currency, false));
    }
    finally {
        dealsClient.release();
    }
    const result = (0, response_1.buildSearchResponse)(products, total, limit, offset, Date.now() - t0, false);
    config_1.redis.set(cacheKey, JSON.stringify(result), 'EX', 60).catch(() => { });
    return result;
}
async function handleListCategories(args) {
    const t0 = Date.now();
    const country = ((args.country_code || args.country) || 'SG').toUpperCase();
    const cacheKey = `categories_mcp:top100:${country}`;
    try {
        const cached = await config_1.redis.get(cacheKey);
        if (cached) {
            const parsed = JSON.parse(cached);
            return { ...parsed, meta: { ...parsed.meta, cached: true, response_time_ms: Date.now() - t0 } };
        }
    }
    catch (_) { }
    // Try the pre-aggregated summary table first (instant); fall back to slow GROUP BY if it doesn't exist yet.
    const client = await config_1.db.connect();
    try {
        const tableCheck = await client.query(`SELECT to_regclass('public.mcp_category_summary_by_country') AS tbl`);
        let rows;
        if (tableCheck.rows[0]?.tbl) {
            const summaryResult = await client.query(`SELECT slug, name, product_count
         FROM mcp_category_summary_by_country
         WHERE country_code = $1
         ORDER BY product_count DESC
         LIMIT 100`, [country]);
            rows = summaryResult.rows;
        }
        else {
            // Summary table not yet created — fall back to expensive GROUP BY with extended timeout
            await client.query('SET statement_timeout = 300000'); // 5 min
            const result = await client.query(`SELECT category_path[1] AS slug,
                category_path[1] AS name,
                COUNT(*) AS product_count
         FROM products
         WHERE category_path[1] IS NOT NULL
           AND country_code = $1
         GROUP BY category_path[1]
         ORDER BY product_count DESC
         LIMIT 100`, [country]);
            rows = result.rows;
        }
        const data = { data: rows, meta: { total: rows.length, country_code: country, response_time_ms: Date.now() - t0, cached: false } };
        config_1.redis.set(cacheKey, JSON.stringify(data), 'EX', 86400).catch(() => { });
        return data;
    }
    finally {
        client.release();
    }
}
async function handleFindBestPrice(args) {
    const t0 = Date.now();
    const productName = args.product_name || '';
    if (!productName)
        throw { code: -32602, message: 'product_name is required' };
    const country = ((args.country_code || args.country) || 'SG').toUpperCase();
    const region = args.region || '';
    const category = args.category || '';
    const limit = 10;
    const conditions = ['is_active = true'];
    const params = [];
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
    const CANDIDATE_POOL = Math.max(limit * 50, 500);
    params.push(CANDIDATE_POOL, limit);
    const where = `WHERE ${conditions.join(' AND ')}`;
    // BUY-31962: same subquery pattern as search_products — fetch candidates via GIN
    // index (no sort), then ORDER BY price ASC on the small candidate set. Avoids the
    // O(N log N) full-sort that causes the 10s/30s timeout on large FTS result sets.
    const bestPriceClient = await config_1.db.connect();
    let result;
    try {
        await bestPriceClient.query('SET statement_timeout = 10000');
        result = await bestPriceClient.query(`SELECT * FROM (
         SELECT id, title, price, currency, source AS domain, url, image_url,
                country_code, updated_at
         FROM products ${where}
         LIMIT $${params.length - 1}
       ) _candidates
       ORDER BY price ASC, updated_at DESC
       LIMIT $${params.length}`, params);
    }
    finally {
        bestPriceClient.release();
    }
    const currency = response_1.COUNTRY_CURRENCY[country] || 'SGD';
    const toUsd = response_1.CURRENCY_RATES[currency] ?? 1;
    const data = result.rows.map((r) => ({
        id: r.id,
        title: r.title,
        price: { amount: r.price != null ? parseFloat(r.price) : null, currency: r.currency || currency },
        normalized_price_usd: r.price != null ? Math.round(Number(r.price) * toUsd * 100) / 100 : null,
        merchant: r.domain,
        url: r.url,
        image_url: r.image_url,
        country_code: r.country_code,
    }));
    return {
        best_price: data[0] ?? null,
        alternatives: data.slice(1),
        meta: { total: data.length, country, response_time_ms: Date.now() - t0 },
    };
}
// BUY-31929: MCP tool to ingest products — delegates to the same logic as
// POST /v1/ingest/products but via JSON-RPC tool call.
async function handleIngestProducts(args) {
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
    const SOURCE_NORMALIZATION = {
        'challenger': 'challenger_sg',
        'challenger.sg': 'challenger_sg',
        'challenger_sg': 'challenger_sg',
        'amazon_sg_toys': 'amazon_sg',
        'ikea.com.sg': 'ikea_sg',
    };
    const normalizedSource = SOURCE_NORMALIZATION[source] || source;
    const validProducts = [];
    const errors = [];
    for (let i = 0; i < products.length; i++) {
        const p = products[i];
        if (!p || typeof p !== 'object') {
            errors.push({ index: i, sku: 'unknown', error: 'Not an object' });
            continue;
        }
        const sku = typeof p.sku === 'string' ? p.sku : '';
        if (!sku) {
            errors.push({ index: i, sku: 'unknown', error: 'Missing sku' });
            continue;
        }
        if (!p.merchant_id || typeof p.merchant_id !== 'string') {
            errors.push({ index: i, sku, error: 'Missing merchant_id' });
            continue;
        }
        if (!p.title || typeof p.title !== 'string') {
            errors.push({ index: i, sku, error: 'Missing title' });
            continue;
        }
        if (p.price === undefined || p.price === null || typeof p.price !== 'number' || p.price < 0) {
            errors.push({ index: i, sku, error: 'Missing or invalid price' });
            continue;
        }
        if (!p.url || typeof p.url !== 'string') {
            errors.push({ index: i, sku, error: 'Missing url' });
            continue;
        }
        // BUY-39599: Default country_code to 'SG' and region to country_code.toLowerCase()
        // to prevent NULL violations on NOT NULL partition columns.
        const cc = typeof p.country_code === 'string' ? p.country_code : 'SG';
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
            country_code: cc,
            region: typeof p.region === 'string' ? p.region : cc.toLowerCase(),
            metadata: (p.metadata && typeof p.metadata === 'object') ? p.metadata : undefined,
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
    // BUY-39599: Deduplicate by (sku, country_code) — PostgreSQL rejects ON CONFLICT
    // DO UPDATE when the same row would be affected twice in a single command.
    {
        const seen = new Set();
        const unique = [];
        for (const p of validProducts) {
            const dedupKey = `${p.sku}\0${p.country_code || 'SG'}`;
            if (seen.has(dedupKey))
                continue;
            seen.add(dedupKey);
            unique.push(p);
        }
        if (unique.length < validProducts.length) {
            const dupes = validProducts.length - unique.length;
            validProducts.length = 0;
            validProducts.push(...unique);
            console.warn(`[mcp:ingest] Deduped ${dupes} duplicate sku(s) from ${normalizedSource} batch`);
        }
    }
    // Create ingestion run record
    let runId = null;
    try {
        const runResult = await config_1.db.query(`INSERT INTO ingestion_runs (source, status) VALUES ($1, 'running') RETURNING id`, [normalizedSource]);
        runId = runResult.rows[0]?.id || null;
    }
    catch (e) {
        console.warn('[mcp:ingest] Failed to create ingestion run record:', e.message);
    }
    // Check existing SKUs
    const skus = validProducts.map(p => p.sku);
    const existingResult = await config_1.db.query(`SELECT sku FROM products WHERE sku = ANY($1::text[]) AND source = $2`, [skus, normalizedSource]);
    const existingSkus = new Set(existingResult.rows.map((r) => r.sku));
    let rowsInserted = 0;
    let rowsUpdated = 0;
    try {
        const values = [];
        const placeholders = [];
        for (const p of validProducts) {
            const base = values.length + 1;
            const metadata = {
                ...(p.metadata || {}),
                origin_merchant_id: p.merchant_id,
                category: p.category || null,
            };
            if (p.in_stock !== undefined)
                metadata.in_stock = p.in_stock;
            if (p.stock_level !== undefined)
                metadata.stock_level = p.stock_level;
            if (p.is_available !== undefined)
                metadata.is_available = p.is_available;
            const catPath = (p.category_path && p.category_path.length > 0)
                ? `{${p.category_path.map(c => `"${c.replace(/"/g, '\\"')}"`).join(',')}}`
                : '{}';
            values.push(p.sku, normalizedSource, p.merchant_id, p.title, p.description || null, p.price, p.currency || 'SGD', p.url, p.image_url || null, catPath, p.brand || null, JSON.stringify(metadata), p.is_active !== false, p.region || (p.country_code || 'SG').toLowerCase(), p.country_code || 'SG');
            placeholders.push(`($${base},$${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6},$${base + 7},$${base + 8},$${base + 9},$${base + 10},$${base + 11},$${base + 12},$${base + 13},$${base + 14})`);
        }
        await config_1.db.query(`INSERT INTO products
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
         updated_at = NOW()`, values);
        for (const p of validProducts) {
            if (existingSkus.has(p.sku)) {
                rowsUpdated++;
            }
            else {
                rowsInserted++;
            }
        }
    }
    catch (e) {
        const msg = e.message;
        console.error('[mcp:ingest] Bulk upsert failed:', msg);
        if (runId !== null) {
            await config_1.db.query(`UPDATE ingestion_runs SET status = 'failed', error_message = $1, finished_at = NOW() WHERE id = $2`, [msg.slice(0, 500), runId]).catch(() => { });
        }
        return {
            run_id: runId, status: 'failed',
            rows_inserted: 0, rows_updated: 0, rows_failed: validProducts.length,
            errors: [{ index: -1, sku: 'batch', error: `Database error: ${msg}` }, ...errors],
            response_time_ms: Date.now() - t0,
        };
    }
    // Insert price history
    const finalResult = await config_1.db.query(`SELECT id, sku FROM products WHERE sku = ANY($1::text[]) AND source = $2`, [skus, normalizedSource]);
    const skuToId = new Map(finalResult.rows.map((r) => [r.sku, r.id]));
    const phValues = [];
    const phPlaceholders = [];
    for (const p of validProducts) {
        const productId = skuToId.get(p.sku);
        if (productId) {
            const base = phValues.length + 1;
            phValues.push(productId, p.price, p.currency || 'SGD', normalizedSource);
            phPlaceholders.push(`($${base},$${base + 1},$${base + 2},$${base + 3})`);
        }
    }
    if (phValues.length > 0) {
        try {
            await config_1.db.query(`INSERT INTO price_history (product_id, price, currency, source) VALUES ${phPlaceholders.join(', ')}`, phValues);
        }
        catch (e) {
            console.warn('[mcp:ingest] Price history insert failed:', e.message);
        }
    }
    const status = errors.length === 0 ? 'completed' : 'completed_with_errors';
    if (runId !== null) {
        await config_1.db.query(`UPDATE ingestion_runs SET status = $1, rows_inserted = $2, rows_updated = $3, rows_failed = $4, finished_at = NOW() WHERE id = $5`, [status, rowsInserted, rowsUpdated, errors.length, runId]).catch(() => { });
    }
    // Invalidate caches
    if (rowsInserted > 0 || rowsUpdated > 0) {
        try {
            const keys = await config_1.redis.keys('products:*');
            if (keys.length > 0)
                await config_1.redis.del(...keys);
            const searchKeys = await config_1.redis.keys('search:*');
            if (searchKeys.length > 0)
                await config_1.redis.del(...searchKeys);
            await config_1.redis.set(`bw:ingestion:last_success:${normalizedSource}`, String(Date.now() / 1000));
        }
        catch (e) {
            console.warn('[mcp:ingest] Cache invalidation failed:', e.message);
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
async function dispatchTool(name, args) {
    switch (name) {
        case 'search_products': return handleSearchProducts(args);
        case 'get_product': return handleGetProduct(args);
        case 'compare_products': return handleCompareProducts(args);
        case 'get_deals': return handleGetDeals(args);
        case 'list_categories': return handleListCategories(args);
        case 'find_best_price': return handleFindBestPrice(args);
        case 'ingest_products': return handleIngestProducts(args);
        default:
            throw { code: -32601, message: `Unknown tool: ${name}` };
    }
}
// JSON-RPC 2.0 response helpers
function jsonrpcOk(id, result) {
    return { jsonrpc: '2.0', id, result };
}
function jsonrpcErr(id, code, message, data, envelopeCode) {
    const errorData = data != null ? { detail: data } : {};
    if (envelopeCode) {
        errorData.envelope = (0, errors_1.buildErrorEnvelope)(envelopeCode, message);
    }
    return { jsonrpc: '2.0', id, error: { code, message, ...(Object.keys(errorData).length ? { data: errorData } : {}) } };
}
// GET /mcp/auth/token — token endpoint descriptor (public, no auth).
// BUY-33837: matches the pre-migration mcp-server-production.js surface so
// legacy probes and OAuth-style clients still receive a JSON descriptor
// at /api/mcp/auth/token. Real token issuance moved to /v1/keys (API keys).
router.get('/auth/token', (_req, res) => {
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
router.get('/auth/verify', apiKey_1.requireApiKey, (req, res) => {
    const k = req.apiKey;
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
router.get('/metrics', (_req, res) => {
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
router.get('/health', async (_req, res) => {
    try {
        const [, pong] = await Promise.all([
            config_1.db.query('SELECT 1'),
            config_1.redis.ping(),
        ]);
        res.json({
            status: pong === 'PONG' ? 'ok' : 'degraded',
            db: 'ok',
            redis: pong === 'PONG' ? 'ok' : 'degraded',
            ts: new Date().toISOString(),
        });
    }
    catch (err) {
        res.status(503).json({
            status: 'down',
            error: err.message || String(err),
            ts: new Date().toISOString(),
        });
    }
});
// GET /mcp/health/authenticated — deeper probe requiring API key
router.get('/health/authenticated', apiKey_1.requireApiKey, async (_req, res) => {
    try {
        const [countResult, pong] = await Promise.all([
            config_1.db.query('SELECT reltuples::bigint AS count FROM pg_class WHERE relname = \'products\''),
            config_1.redis.ping(),
        ]);
        res.json({
            status: 'ok',
            db: 'ok',
            redis: pong === 'PONG' ? 'ok' : 'degraded',
            product_count: countResult.rows[0]?.count ?? null,
            ts: new Date().toISOString(),
        });
    }
    catch (err) {
        res.status(503).json({
            status: 'down',
            error: err.message || String(err),
            ts: new Date().toISOString(),
        });
    }
});
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
        return res.status(400).json(jsonrpcErr(body?.id ?? null, -32600, 'Invalid JSON-RPC request', undefined, errors_1.ErrorCode.INVALID_JSON));
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
    }
    catch (err) {
        const e = err;
        if (typeof e.code === 'number' && e.message) {
            const envelopeCode = e.code === -32001 ? errors_1.ErrorCode.NOT_FOUND
                : e.code === -32602 ? errors_1.ErrorCode.INVALID_PARAMETER
                    : errors_1.ErrorCode.INTERNAL_ERROR;
            return res.json(jsonrpcErr(id, e.code, e.message, undefined, envelopeCode));
        }
        console.error('[mcp] error:', err);
        return res.json(jsonrpcErr(id, -32603, 'Internal error', undefined, errors_1.ErrorCode.INTERNAL_ERROR));
    }
});
exports.default = router;
