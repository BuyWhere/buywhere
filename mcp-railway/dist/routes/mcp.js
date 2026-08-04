"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const config_1 = require("../config");
const embedProducts_1 = require("../jobs/embedProducts");
const apiKey_1 = require("../middleware/apiKey");
const queryLog_1 = require("../middleware/queryLog");
const errors_1 = require("../middleware/errors");
const response_1 = require("../lib/response");
const router = (0, express_1.Router)();
const MCP_DB_ACQUIRE_TIMEOUT_MS = parseInt(process.env.MCP_DB_ACQUIRE_TIMEOUT_MS || '1000', 10);
async function acquireMcpClient() {
    let timer;
    try {
        return await Promise.race([
            config_1.catalogDb.connect(),
            new Promise((_, reject) => {
                timer = setTimeout(() => reject(new Error('mcp_catalog_db_pool_acquire_timeout')), MCP_DB_ACQUIRE_TIMEOUT_MS);
            }),
        ]);
    }
    finally {
        if (timer)
            clearTimeout(timer);
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
function releaseClientSafely(client) {
    try {
        // PQTRANS_INERROR = 3 — transaction aborted due to statement_timeout or other error.
        // Discard the connection so a fresh one is acquired from the pool next time.
        if (client && client.transactionStatus === 3) {
            client.release(true); // discard — do NOT return poisoned connection to pool
        }
        else {
            client.release();
        }
    }
    catch (_) {
        // Swallow release errors — pool will remove the bad client anyway.
    }
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
let _hasDiscountPct;
async function probeDiscountPctColumn() {
    try {
        const probe = await config_1.catalogDb.query(`SELECT is_generated FROM information_schema.columns WHERE table_name = 'products' AND column_name = 'discount_pct' LIMIT 1`);
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
    const mode = args.mode || 'hybrid';
    const geminiKey = process.env.GEMINI_API_KEY ?? '';
    const useVector = config_1.vectorDb != null && geminiKey !== '' && q !== '' && mode !== 'keyword';
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
    const cacheKey = `fts:${q}:${domain}:${region}:${country}:${category}:${currency}:${minPrice}:${maxPrice}:${limit}:${offset}:${compact ? 'c' : 'f'}:${useVector ? mode : 'kw'}`;
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
    // BUY-57657: add connect timeout so pool exhaustion fails fast at 2s instead of
    // blocking the entire 12s statement_timeout. The DB itself is fast (70-130ms) so
    // any 8-12s MCP latency is pool-acquisition contention, not query execution.
    const searchClient = await Promise.race([
        config_1.catalogDb.connect(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('catalog_db.connect timeout after 2000ms')), 2000)),
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
            const countResult = await searchClient.query(`SELECT COUNT(*) FROM (SELECT 1 FROM products ${where} LIMIT ${COUNT_CAP}) _sub`, params);
            total = parseInt(countResult.rows[0].count, 10);
            // BUY-31962 / BUY-41138: hybrid search (RRF) or keyword FTS fallback.
            // Hybrid and semantic paths embed the query via Jina AI, query the vector DB
            // separately, then merge in application code (two separate PG instances).
            if (useVector) {
                // Embed query (retrieval.query task); Redis-cache 60s keyed by base64 query
                let queryVec = null;
                try {
                    const embedKey = `qembed:${Buffer.from(q).toString('base64').slice(0, 48)}`;
                    queryVec = await config_1.redis.get(embedKey).catch(() => null);
                    if (!queryVec) {
                        queryVec = await (0, embedProducts_1.embedQuery)(q, geminiKey);
                        await config_1.redis.set(embedKey, queryVec, 'EX', 60).catch(() => { });
                    }
                }
                catch (embedErr) {
                    console.warn('[search] embed query failed, falling back to FTS:', embedErr.message);
                }
                if (queryVec && config_1.vectorDb) {
                    let candidateIds;
                    if (mode === 'semantic') {
                        // Vector-only: fetch top-200 nearest neighbours from vector DB, then fetch details
                        // BUY-65476: filter by model_ver to avoid legacy 1024-dim vectors
                        const vecRows = await config_1.vectorDb.query(`SELECT product_id FROM product_embeddings
               WHERE model_ver = 'gemini-embedding-001@512'
               ORDER BY embedding <=> $1::vector LIMIT 200`, [queryVec]);
                        candidateIds = vecRows.rows.map(r => r.product_id).slice(0, limit + offset);
                    }
                    else {
                        // Hybrid: app-level RRF of FTS ranks + vector ranks
                        const [ftsResult, vecResult] = await Promise.all([
                            searchClient.query(`SELECT id FROM products ${where} LIMIT 200`, params),
                            // BUY-65476: filter by model_ver to avoid legacy 1024-dim vectors
                            config_1.vectorDb.query(`SELECT product_id FROM product_embeddings
                 WHERE model_ver = 'gemini-embedding-001@512'
                 ORDER BY embedding <=> $1::vector LIMIT 200`, [queryVec]),
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
                    }
                    else {
                        const ph = pageIds.map((_, i) => `$${i + 1}`).join(',');
                        const detailResult = await searchClient.query(`SELECT id, sku AS source, source AS domain, url, title,
                      price, currency, image_url, metadata, updated_at, region, country_code
               FROM products WHERE id IN (${ph}) AND is_active = true`, pageIds);
                        // Preserve ranking order
                        const byId = new Map(detailResult.rows.map(r => [r.id, r]));
                        rows = pageIds.map(id => byId.get(id)).filter(Boolean);
                    }
                }
                else {
                    // Embed failed — fall through to keyword FTS
                    const CANDIDATE_LIMIT = Math.min((limit + offset) * 10, 5000);
                    params.push(CANDIDATE_LIMIT, limit, offset);
                    const result = await searchClient.query(`SELECT * FROM (
               SELECT id, sku AS source, source AS domain, url, title,
                      price, currency, image_url, metadata, updated_at, region, country_code
               FROM products ${where}
               LIMIT $${params.length - 2}
             ) _candidates
             ORDER BY updated_at DESC
             LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
                    rows = result.rows;
                }
            }
            else {
                // Keyword (FTS) path — BUY-31962 subquery pattern
                const CANDIDATE_LIMIT = Math.min((limit + offset) * 10, 5000);
                params.push(CANDIDATE_LIMIT, limit, offset);
                const result = await searchClient.query(`SELECT * FROM (
             SELECT id, sku AS source, source AS domain, url, title,
                    price, currency, image_url, metadata, updated_at, region, country_code
             FROM products ${where}
             LIMIT $${params.length - 2}
           ) _candidates
           ORDER BY updated_at DESC
           LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
                rows = result.rows;
            }
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
        // BUY-56185: always use safe release to discard connections poisoned by statement_timeout
        releaseClientSafely(searchClient);
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
        result = await config_1.catalogDb.query(`SELECT id, sku AS source, source AS domain, url, title,
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
    // BUY-26210: filter to numeric IDs only (products.id is bigint); non-numeric
    // strings like UUIDs cause Postgres type errors in the WHERE IN clause.
    const numericIds = validIds.filter((id) => /^\d+$/.test(id));
    if (numericIds.length < 2) {
        throw { code: -32001, message: 'Products not found' };
    }
    const placeholders = numericIds.map((_, i) => `$${i + 1}`).join(',');
    let result;
    try {
        result = await config_1.catalogDb.query(`SELECT id, sku AS source, source AS domain, url, title,
              price, currency, image_url, brand, category_path,
              avg_rating AS rating, review_count, metadata, updated_at, region, country_code
       FROM products WHERE id IN (${placeholders})`, numericIds);
    }
    catch {
        throw { code: -32001, message: 'Products not found' };
    }
    if (!result.rows.length) {
        throw { code: -32001, message: 'Products not found' };
    }
    const products = result.rows.map((r) => (0, response_1.buildProduct)(r, 'SGD', false));
    return (0, response_1.buildSearchResponse)(products, products.length, validIds.length, 0, Date.now() - t0, false);
}
async function getRegionalProductSample(country, fallbackQuery, limit, currency, t0) {
    try {
        const result = await config_1.catalogDb.query(`SELECT id, sku AS source, source AS domain, url, title,
              price, NULL::numeric AS original_price, currency, image_url,
              metadata, updated_at, region, country_code, 0::numeric AS discount_pct
       FROM products
       WHERE is_active = true
         AND price > 0
         AND country_code = $1
         AND search_vector @@ plainto_tsquery('english', $2)
       LIMIT $3`, [country, fallbackQuery, Number(limit) || 20]);
        if (!result.rows.length)
            return null;
        const products = result.rows.map((r) => (0, response_1.buildProduct)(r, currency, false));
        return (0, response_1.buildSearchResponse)(products, products.length, limit, 0, Date.now() - t0, false);
    }
    catch (err) {
        console.warn('[mcp] regional deals sample failed:', err?.message || err);
        return null;
    }
}
async function handleGetDeals(args) {
    const t0 = Date.now();
    const minDiscount = Number(args.min_discount) || 10;
    // BUY-59768: infer currency from country_code (or region) when not explicitly set.
    const REGION_TO_COUNTRY = { sg: 'SG', us: 'US', my: 'MY', th: 'TH', vn: 'VN', gb: 'GB' };
    const explicitCurrency = (args.currency || '').toUpperCase();
    const regionArg = (args.region || '').toLowerCase();
    const dealsCountry = (args.country_code || args.country || REGION_TO_COUNTRY[regionArg] || '').toUpperCase();
    const currency = explicitCurrency || (dealsCountry ? (response_1.COUNTRY_CURRENCY[dealsCountry] || 'SGD') : 'SGD');
    const region = regionArg;
    const country = dealsCountry;
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
    // BUY-63030: Inline all validated params (currency, minDiscount, region,
    // country) into the SQL string instead of using positional placeholders.
    // Each value is already constrained: currency is a known ISO code from
    // COUNTRY_CURRENCY, minDiscount is a clamped number, region/country are
    // validated ISO codes. Inlining eliminates the
    // "could not determine data type of parameter $N" errors that Postgres
    // raises when renumbered positional params appear in subquery+outer-query
    // boundaries without explicit casts.
    const conditions = [
        `currency = '${currency.replace(/'/g, "''")}'`,
        `price > 0`,
        `is_active = true`,
    ];
    if (useDiscountCol) {
        conditions.push(`discount_pct >= ${Number(minDiscount) || 10}::numeric`);
    }
    else {
        // Guard: only consider rows where original_price is a valid numeric string.
        // Matches the partial index predicate on idx_products_deals_country/region.
        conditions.push(`metadata->>'original_price' ~ '^[0-9]+(\\.[0-9]+)?$'`);
        conditions.push(`(metadata->>'original_price')::numeric > price`);
        conditions.push(`((1 - price / NULLIF((metadata->>'original_price')::numeric, 0)) * 100) >= ${Number(minDiscount) || 10}::numeric`);
    }
    if (region) {
        conditions.push(`region = '${String(region).replace(/'/g, "''")}'`);
    }
    if (country) {
        const c = country.toUpperCase().replace(/'/g, "''");
        conditions.push(`country_code = '${c}'`);
    }
    const discountSelect = useDiscountCol
        ? 'discount_pct'
        : `ROUND(((1 - price / NULLIF((metadata->>'original_price')::numeric, 0)) * 100)::numeric, 1) AS discount_pct`;
    // BUY-60076: bring the canonical mcp.buywhere.ai handleGetDeals in line with
    // the api/ service (BUY-60056): bound the deals scan with a recent-window
    // candidate set so the slow `SELECT COUNT(*)` over the filtered deals range
    // (which monopolised the pool connection for 60s under cold cache) is
    // replaced with a bounded 5k-row candidate inner scan. Mirrors api/src/routes/mcp.ts:574-635.
    // BUY-65298: the subquery must filter by country INSIDE the ordered scan so
    // the 50k-row window is relevant to the requested region. Previously the
    // unfiltered subquery returned recent GLOBAL products whose currency did not
    // match, resulting in empty results and cascading timeouts for every region.
    // BUY-65795: limit/offset are already-validated bounded integers (limit: 1-100,
    // offset: >=0), so interpolate them directly into LIMIT/OFFSET. Inner subquery
    // LIMIT is the bounded integer candidateLimit (also safe to inline).
    const dealsClient = await acquireMcpClient().catch((err) => {
        console.error('[mcp] get_deals db.connect failed:', err);
        throw { code: -32603, message: 'Database unavailable' };
    });
    let products = [];
    let total = 0;
    try {
        await dealsClient.query('SET statement_timeout = 4500');
        const candidateLimit = Math.max((limit + offset) * 200, 5000);
        const limitParam = Number(limit) || 20;
        const offsetParam = Number(offset) || 0;
        // Build inner subquery WHERE inline (country only, when set).
        const innerConditions = ['is_active = true', 'price > 0'];
        if (country) {
            const c = country.toUpperCase().replace(/'/g, "''");
            innerConditions.push(`country_code = '${c}'`);
        }
        const innerWhere = innerConditions.join(' AND ');
        const dataResult = await dealsClient.query(`SELECT id, sku AS source, source AS domain, url, title, price, original_price,
              currency, image_url, metadata, updated_at, region, country_code,
              discount_pct
       FROM (
         SELECT id, sku, source, url, title,
                price,
                CASE WHEN metadata->>'original_price' ~ '^[0-9]+(\\.[0-9]+)?$'
                     THEN (metadata->>'original_price')::numeric ELSE NULL END AS original_price,
                currency, image_url, metadata, updated_at, region, country_code, is_active,
                ${discountSelect}
         FROM products
         WHERE ${innerWhere}
         ORDER BY updated_at DESC
         LIMIT ${candidateLimit}
       ) _recent_deals
       WHERE ${conditions.join(' AND ')}
       ORDER BY discount_pct DESC NULLS LAST, updated_at DESC
       LIMIT ${limitParam} OFFSET ${offsetParam}`);
        total = dataResult.rows.length;
        products = dataResult.rows.map((r) => (0, response_1.buildProduct)(r, currency, false));
        if (products.length === 0 && country) {
            // BUY-60056/BUY-60076: many live rows lack original_price/discount
            // metadata, so the strict discount filter can be empty even while the
            // regional catalog is healthy. Fall back to a bounded FTS sample so
            // callers get a structured response under the 5s budget instead of a
            // 60s MONITOR_TIMEOUT.
            const fallbackQuery = country === 'US' ? 'watch' : 'laptop';
            const fallbackCountry = String(country).toUpperCase().replace(/'/g, "''");
            const fallbackLimit = Number(limit) || 20;
            const fallbackResult = await dealsClient.query(`SELECT id, sku AS source, source AS domain, url, title,
                price, NULL::numeric AS original_price, currency, image_url,
                metadata, updated_at, region, country_code, 0::numeric AS discount_pct
         FROM products
         WHERE is_active = true
           AND price > 0
           AND country_code = '${fallbackCountry}'
           AND search_vector @@ plainto_tsquery('english', '${fallbackQuery.replace(/'/g, "''")}')
         LIMIT ${fallbackLimit}`);
            total = fallbackResult.rows.length;
            products = fallbackResult.rows.map((r) => (0, response_1.buildProduct)(r, currency, false));
        }
    }
    finally {
        // BUY-56185: discard connections poisoned by statement_timeout
        releaseClientSafely(dealsClient);
    }
    const result = (0, response_1.buildSearchResponse)(products, total, limit, offset, Date.now() - t0, false);
    // BUY-60076: surface `unavailable:true` when the strict + regional fallback
    // returned zero rows, mirroring api/src/routes/mcp.ts so callers can
    // distinguish "no live deals" from "server bug".
    if ((region || country) && products.length === 0) {
        result.unavailable = true;
    }
    config_1.redis.set(cacheKey, JSON.stringify(result), 'EX', 60).catch(() => { });
    return result;
}
// Single-flight guard: at most one DB scan runs per country at a time.
// Concurrent cache-misses coalesce on the same Promise instead of spawning N parallel GROUP-BY scans.
const categoryListInflight = new Map();
async function handleListCategories(args) {
    const t0 = Date.now();
    // BUY-60069: accept the public `region` alias and normalize it to the same
    // ISO-2 country code used by the cache key and materialized-view lookup.
    const REGION_TO_COUNTRY = {
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
    const normalizeCountry = (value) => {
        const raw = String(value || '').trim();
        if (!raw)
            return '';
        return REGION_TO_COUNTRY[raw.toLowerCase()] || raw.toUpperCase();
    };
    const country = normalizeCountry(args.country_code || args.country || args.region) || 'SG';
    const cacheKey = `categories_mcp:top100:${country}`;
    // 1. Redis fast path
    try {
        const cached = await config_1.redis.get(cacheKey);
        if (cached) {
            const parsed = JSON.parse(cached);
            return { ...parsed, meta: { ...parsed.meta, cached: true, response_time_ms: Date.now() - t0 } };
        }
    }
    catch (_) { }
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
            const tableCheck = await client.query(`SELECT to_regclass('public.mcp_category_summary_by_country') AS tbl`);
            let rows;
            const MAT_VIEW_TIMEOUT_MS = 8000;
            // BUY-60096: canonical MCP must never let category fallback monopolize the shared pool.
            // If the materialized view is empty, keep fallbacks bounded so cold misses stay under 5s.
            const LIVE_TIMEOUT_MS = 1800;
            const FALLBACK_COUNTRIES = new Set(['SG', 'US', 'MY', 'TH', 'VN', 'GB', 'PH', 'ID', 'IN', 'AU']);
            rows = [];
            if (tableCheck.rows[0]?.tbl) {
                const summaryResult = await client.query(`SELECT slug, name, product_count
           FROM mcp_category_summary_by_country
           WHERE country_code = $1
           ORDER BY product_count DESC
           LIMIT 100`, [country]);
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
                    const liveResult = await client.query(`SELECT category_path[1] AS slug, category_path[1] AS name, COUNT(*) AS product_count
             FROM products
             WHERE country_code = $1
               AND category_path[1] IS NOT NULL
               AND is_active = true
             GROUP BY category_path[1]
             ORDER BY COUNT(*) DESC
             LIMIT 100`, [country]);
                    if (liveResult.rows.length > 0)
                        rows = liveResult.rows;
                }
                catch (_) {
                    // Live GROUP BY timed out or failed — leave rows empty and surface unavailable
                }
                finally {
                    await client.query(`SET statement_timeout = ${MAT_VIEW_TIMEOUT_MS}`);
                }
            }
            // BUY-60170/BUY-60200: third fallback — sample recent products via updated_at
            // index, then GROUP BY category. Probe #36 showed cold cache misses returning
            // unavailable because a global 50K sample may contain zero rows for the requested
            // country during ingestion skew. Keep the bounded updated_at scan, but push the
            // country/category predicates into the inner query so each market gets its own
            // recent sample before grouping.
            // BUY-65477: Also check `category` column as fallback since category_path
            // may be empty but category column is populated.
            if (rows.length === 0) {
                try {
                    await client.query(`SET statement_timeout = ${LIVE_TIMEOUT_MS}`);
                    const recentResult = await client.query(`SELECT slug, slug AS name, COUNT(*)::int AS product_count
             FROM (
               SELECT category_path, category
               FROM products
               WHERE country_code = $1
                 AND is_active = true
               ORDER BY updated_at DESC
               LIMIT 50000
             ) _recent_categories
             CROSS JOIN LATERAL (
               SELECT COALESCE(category_path[1], NULLIF(lower(regexp_replace(category, '\\s+', '-', 'g')), '')) AS slug
             ) _cat
             WHERE slug IS NOT NULL AND slug <> ''
             GROUP BY slug
             ORDER BY product_count DESC
             LIMIT 100`, [country]);
                    if (recentResult.rows.length > 0)
                        rows = recentResult.rows;
                }
                catch (_) {
                    // recent-products fallback timed out — fall through to static category defaults
                }
            }
            let staticFallback = false;
            if (rows.length === 0) {
                // BUY-63027: no live category data could be produced (view empty, live
                // GROUP BY timed out, recent-sample fallback empty). Fall back to static
                // category defaults so the response is still structured, but mark it
                // unavailable so we do not advertise fabricated zero-count categories as
                // a successful authoritative listing.
                staticFallback = true;
                rows = ['Electronics', 'Computers', 'Mobile Phones', 'Home', 'Fashion'].map((name) => ({
                    slug: name.toLowerCase().replace(/\s+/g, '-'),
                    name,
                    product_count: 0,
                }));
            }
            const meta = {
                total: rows.length,
                country_code: country,
                response_time_ms: 0,
                cached: false,
            };
            // BUY-63027: only the real catalog paths are "available". Static
            // zero-count defaults are explicitly unavailable so callers do not treat
            // them as an authoritative category listing.
            meta.unavailable = staticFallback;
            const data = { data: rows, meta };
            config_1.redis.set(cacheKey, JSON.stringify(data), 'EX', 600).catch(() => { }); // 10 min TTL
            return data;
        }
        finally {
            releaseClientSafely(client);
        }
    })();
    categoryListInflight.set(country, queryPromise);
    try {
        const result = await queryPromise;
        return { ...result, meta: { ...result.meta, response_time_ms: Date.now() - t0 } };
    }
    finally {
        categoryListInflight.delete(country);
    }
}
async function handleFindBestPrice(args) {
    const t0 = Date.now();
    const productName = args.product_name || '';
    if (!productName)
        throw { code: -32602, message: 'product_name is required' };
    // BUY-65298: derive the country from the region alias when only region is
    // supplied (mirrors the canonical mcp route). Previously this fell through to
    // the default 'SG' for any region-only caller, e.g. region='us' would have
    // returned Singapore rows and SGD prices.
    const REGION_TO_COUNTRY = {
        us: 'US',
        sea: 'SG',
    };
    const regionRaw = (args.region || '').toLowerCase();
    const regionDerived = REGION_TO_COUNTRY[regionRaw] || '';
    const explicitCountry = (args.country_code || args.country || '').toUpperCase();
    const country = explicitCountry || regionDerived || 'SG';
    const region = args.region || '';
    const category = args.category || '';
    const limit = 10;
    // BUY-26343: price > 0 prevents returning corrupt zero-price records
    const conditions = ['is_active = true', 'price > 0'];
    const params = [];
    params.push(productName);
    conditions.push(`search_vector @@ plainto_tsquery('english', $${params.length})`);
    if (country) {
        params.push(country);
        conditions.push(`country_code = $${params.length}`);
    }
    if (region && !regionDerived) {
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
    const bestPriceClient = await acquireMcpClient();
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
        // BUY-56185: discard connections poisoned by statement_timeout
        releaseClientSafely(bestPriceClient);
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
    // Create ingestion run record
    let runId = null;
    try {
        const runResult = await config_1.db.query(`INSERT INTO ingestion_runs (source, status) VALUES ($1, 'running') RETURNING id`, [normalizedSource]);
        runId = runResult.rows[0]?.id || null;
    }
    catch (e) {
        console.warn('[mcp:ingest] Failed to create ingestion run record:', e.message);
    }
    // Check existing SKUs. The unique constraint is (sku, source, country_code), so
    // the pre-existing check must match — a (sku, source) hit in another country is a
    // different row. Use a values join for the composite match.
    const existingSkus = new Set();
    const skuToId = new Map();
    if (validProducts.length > 0) {
        const tuples = validProducts
            .map((p) => `('${p.sku.replace(/'/g, "''")}','${normalizedSource.replace(/'/g, "''")}','${(p.country_code || '').replace(/'/g, "''")}')`)
            .join(',');
        const existingResult = await config_1.db.query(`SELECT id, sku, source, country_code FROM products
         WHERE (sku, source, country_code) IN (${tuples})`);
        for (const r of existingResult.rows) {
            const key = `${r.sku} ${r.source} ${r.country_code}`;
            existingSkus.add(key);
            skuToId.set(key, r.id);
        }
    }
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
            values.push(p.sku, normalizedSource, p.merchant_id, p.title, p.description || null, p.price, p.currency || 'SGD', p.url, p.image_url || null, catPath, p.brand || null, JSON.stringify(metadata), p.is_active !== false, 
            // products is partitioned by country_code; the partition's `region`
            // column is NOT NULL and the column default ('sg') only applies when
            // the column is omitted from the INSERT. We're listing the column,
            // so we must supply a value. Default to country_code lowercased,
            // then 'sg' as the last-resort fallback.
            p.region || (p.country_code ? p.country_code.toLowerCase() : null) || 'sg', p.country_code || null);
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
            const key = `${p.sku} ${normalizedSource} ${p.country_code || ''}`;
            if (existingSkus.has(key)) {
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
    const finalResult = await config_1.db.query(`SELECT id, sku, source, country_code FROM products
       WHERE (sku, source, country_code) IN (${validProducts
        .map((p) => `('${p.sku.replace(/'/g, "''")}','${normalizedSource.replace(/'/g, "''")}','${(p.country_code || '').replace(/'/g, "''")}')`)
        .join(',')})`);
    for (const r of finalResult.rows) {
        skuToId.set(`${r.sku} ${r.source} ${r.country_code}`, r.id);
    }
    const phValues = [];
    const phPlaceholders = [];
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
async function handleFindSimilar(args) {
    const t0 = Date.now();
    const productId = (args.product_id || '').trim();
    const limit = Math.min(Number(args.limit) || 10, 10);
    if (!productId) {
        throw { code: -32602, message: 'missing required parameter: product_id' };
    }
    if (!config_1.vectorDb) {
        throw { code: -32001, message: 'Vector search not available — vector DB not configured' };
    }
    // Step 1: get reference embedding from vector DB
    // BUY-65476: filter by model_ver to avoid legacy 1024-dim vectors
    const refResult = await config_1.vectorDb.query(`SELECT embedding::text FROM product_embeddings
     WHERE product_id = $1 AND model_ver = 'gemini-embedding-001@512'`, [productId]);
    if (!refResult.rows.length) {
        throw { code: -32001, message: 'No embedding found for this product — backfill may still be running' };
    }
    const refEmbedding = refResult.rows[0].embedding;
    // Step 2: find nearest neighbours in vector DB (excluding source product)
    // BUY-65476: filter by model_ver to avoid legacy 1024-dim vectors
    const nearResult = await config_1.vectorDb.query(`SELECT product_id, (embedding <=> $1::vector)::float AS distance
     FROM product_embeddings
     WHERE product_id != $2 AND model_ver = 'gemini-embedding-001@512'
     ORDER BY distance LIMIT $3`, [refEmbedding, productId, limit]);
    if (!nearResult.rows.length) {
        throw { code: -32001, message: 'No similar products found' };
    }
    // Step 3: fetch product details from main DB
    const nearIds = nearResult.rows.map(r => r.product_id);
    const ph = nearIds.map((_, i) => `$${i + 1}`).join(',');
    const detailResult = await config_1.catalogDb.query(`SELECT id, title, price, currency, source AS domain, url, image_url
     FROM products WHERE id IN (${ph}) AND is_active = true`, nearIds);
    // Step 4: merge, preserving similarity order
    const distMap = new Map(nearResult.rows.map(r => [r.product_id, r.distance]));
    const byId = new Map(detailResult.rows.map(r => [r.id, r]));
    const similar = nearIds
        .map(id => {
        const p = byId.get(id);
        if (!p)
            return null;
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
    return {
        product_id: productId,
        similar,
        total: similar.length,
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
        case 'find_similar': return handleFindSimilar(args);
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
