"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const crypto_1 = require("crypto");
const express_1 = require("express");
const config_1 = require("../config");
const embedProducts_1 = require("../jobs/embedProducts");
const apiKey_1 = require("../middleware/apiKey");
const queryLog_1 = require("../middleware/queryLog");
const errors_1 = require("../middleware/errors");
const response_1 = require("../lib/response");
const deviceClassifier_1 = require("../lib/deviceClassifier");
// formatPriceLine: formats a price for MCP text display (mirrors formatPriceField logic
// but returns a human-readable string; used by formatProductForMcp only).
function formatPriceLine(price, url) {
    if (!price || (0, response_1.isSentinelPrice)(price.amount)) {
        const link = url ? ` — ${url}` : '';
        return `Price: ${response_1.PRICE_UNAVAILABLE_TEXT}${link}`;
    }
    return `Price: ${price.currency ?? 'SGD'} ${price.amount}`;
}
function formatProductForMcp(p) {
    const price = p.price;
    const merchant = p.merchant;
    const avail = p.availability;
    const lines = [
        `**${p.title ?? p.name ?? ''}**`,
        `ID: ${p.id}`,
        formatPriceLine(price, p.url),
        `Category: ${p.category ?? ''}`,
        `Merchant: ${merchant?.name ?? merchant?.merchant_id ?? ''}` +
            (merchant?.platform ? ` (${merchant.platform})` : ''),
        `In stock: ${avail?.in_stock ? 'Yes' : 'No'}`,
        `URL: ${p.url ?? ''}`,
    ];
    return lines.join('\n');
}
const router = (0, express_1.Router)();
const MCP_DB_ACQUIRE_TIMEOUT_MS = parseInt(process.env.MCP_DB_ACQUIRE_TIMEOUT_MS || '1000', 10);
async function acquireMcpClient() {
    let timer;
    try {
        return await Promise.race([
            config_1.db.connect(),
            new Promise((_, reject) => {
                timer = setTimeout(() => reject(new Error('mcp_db_pool_acquire_timeout')), MCP_DB_ACQUIRE_TIMEOUT_MS);
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
        description: 'Search the BuyWhere product catalog by keyword. Returns a results array where each item has: id, title, price ({amount, currency}), normalized_price_usd, merchant, url, image_url, region, country_code, click_url, affiliate_redirect_url, and updated_at. Covers e-commerce platforms across Singapore, Malaysia, Indonesia, Thailand, Vietnam, and US. Use compact=true for agent-optimized responses adding structured_specs, comparison_attributes, and normalized_price_usd fields.',
        inputSchema: {
            type: 'object',
            properties: {
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
        description: 'Get discounted products sorted by discount percentage. Returns a results array where each item has: id, title, price ({amount, currency}), normalized_price_usd, merchant, url, image_url, region, country_code, click_url, and updated_at. Also includes original_price and discount_pct when available. Covers Singapore, Malaysia, Indonesia, Thailand, Vietnam, and US e-commerce. Supports currency, region (sea, us, eu, au) and country (SG, US, VN, MY, ...) filters.',
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
        description: 'Use this whenever a user asks about prices, wants to find the cheapest option, or asks "what\'s the best price for X" or "where can I buy X for the lowest price". Returns a results array where each item has: id, title, price ({amount, currency}), normalized_price_usd, merchant, url, image_url, region, country_code, click_url, and updated_at. Results are from across all merchants. Also includes structured_specs and comparison_attributes when available.',
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
                product_id: { type: 'string', description: 'Catalog product id (products.id; mutually exclusive with product_name). For legacy vector rows, an exact SKU is also accepted.' },
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
const REGION_TO_COUNTRY = {
    sg: 'SG', us: 'US', my: 'MY', th: 'TH', vn: 'VN', gb: 'GB', uk: 'GB',
    in: 'IN', au: 'AU', ph: 'PH', id: 'ID', sea: 'SG',
};
function normalizeCountryAndRegion(args) {
    const rawCountry = String(args.country_code || args.country || '').trim().toUpperCase();
    const rawRegion = String(args.region || '').trim();
    const regionCountry = rawRegion ? (REGION_TO_COUNTRY[rawRegion.toLowerCase()] || '') : '';
    return {
        rawCountry,
        regionCountry,
        // ISO/country-like region aliases are country filters, not literal products.region values.
        region: regionCountry ? '' : rawRegion,
    };
}
async function handleSearchProducts(args) {
    const t0 = Date.now();
    // BUY-68587 direction-correction: agents passing the natural alias `query`
    // (instead of canonical `q`) silently fell into the no-q browse branch and got
    // 0 rows with a reltuples-derived "total" (~397M) that looked like fabricated
    // cache data. Accept the alias so the query actually runs.
    const q = args.q || args.query || '';
    const mode = args.mode || 'hybrid';
    const geminiKey = process.env.GEMINI_API_KEY ?? '';
    const useVector = config_1.vectorDb != null && geminiKey !== '' && q !== '' && mode !== 'keyword';
    const domain = args.domain || '';
    const normalizedMarket = normalizeCountryAndRegion(args);
    const region = normalizedMarket.region;
    // country_code is canonical; `country` kept as alias for backward compat.
    // BUY-70218: callers also pass ISO markets via `region` (e.g. region=SG/VN);
    // normalize those to country_code so the SQL does not add a case-sensitive
    // products.region='SG' predicate and return empty results despite catalog hits.
    // BUY-6598: Default to SG for search queries. BUY-31962: skip default for
    // empty-q browse mode — no index on country_code makes filtered scan slow,
    // and recent rows are predominantly US/null so SG filter finds nothing.
    const rawCountry = normalizedMarket.rawCountry || normalizedMarket.regionCountry;
    const country = rawCountry || (q && !region ? 'SG' : '');
    const category = args.category || '';
    const minPrice = args.min_price != null ? Number(args.min_price) : null;
    const maxPrice = args.max_price != null ? Number(args.max_price) : null;
    const limit = Math.min(Number(args.limit) || 20, 100);
    const offset = Number(args.offset) || 0;
    const compact = args.compact === true;
    const currency = country ? (response_1.COUNTRY_CURRENCY[country] || 'SGD') : 'SGD';
    const cacheKey = `fts:v2:${q}:${domain}:${region}:${country}:${category}:${currency}:${minPrice}:${maxPrice}:${limit}:${offset}:${compact ? 'c' : 'f'}:${useVector ? mode : 'kw'}`;
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
    // BUY-70132: category ILIKE in SQL causes statement_timeout on large result sets.
    // Instead, fetch via GIN index + country_code filter, then filter in-memory on both
    // raw category AND category_path[1] (canonical). This handles broad labels like
    // "Electronics" that match category_path values but not raw category strings.
    // The category ILIKE is removed from SQL; post-filter applied after fetch.
    // if (category) {
    //   params.push(`%${category}%`);
    //   conditions.push(`category ILIKE $${params.length}`);
    // }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    let rows;
    let total;
    // blocking the entire 12s statement_timeout. The DB itself is fast (70-130ms) so
    // any 8-12s MCP latency is pool-acquisition contention, not query execution.
    const searchClient = await Promise.race([
        config_1.db.connect(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('db.connect timeout after 2000ms')), 2000)),
    ]).catch(() => {
        throw { code: -32603, message: 'Database connection timeout' };
    });
    try {
        // BUY-56185: reduced from 30s to 12s — keyword+country FTS on 14M rows should
        // complete within 12s via GIN index; anything longer signals plan regression or
        // pool exhaustion. Failing fast prevents cascading connection starvation.
        // BUY-70144: enable_seqscan=off forces GIN/btree index use on the 400M-row
        // catalog — the planner otherwise chooses a sequential scan on VN/sparse markets
        // because their row fraction is too small to win on cost estimates, and the 12s
        // statement_timeout fires before the partition pruning kicks in.
        await searchClient.query('SET statement_timeout = 12000');
        await searchClient.query('SET work_mem = \'64MB\''); // BUY-26343: encourage GIN bitmap plan over btree index scan for FTS queries
        await searchClient.query('SET enable_seqscan = off'); // BUY-70144: force index usage so sparse-country FTS uses GIN, not seqscan
        if (q) {
            // BUY-70144: Do not run the old preflight COUNT(*) over FTS hits.
            // On sparse markets (VN) the actual data query is fast via GIN, but the
            // capped count can still walk enough of the 400M-row catalog to hit
            // statement_timeout and surface JSON-RPC -32603. Use a page-based total
            // heuristic below for keyword mode; hybrid/semantic keeps candidate count.
            total = 0;
            // BUY-31962 / BUY-41138: hybrid search (RRF) or keyword FTS fallback.
            // Hybrid and semantic paths embed the query via Jina AI, query the vector DB
            // separately, then merge in application code (two separate PG instances).
            if (useVector) {
                // Embed query (retrieval.query task); Redis-cache 60s keyed by base64 query
                let queryVec = null;
                let embedTimedOut = false;
                try {
                    const embedKey = `qembed:${Buffer.from(q).toString('base64').slice(0, 48)}`;
                    queryVec = await config_1.redis.get(embedKey).catch(() => null);
                    if (!queryVec) {
                        // BUY-70290: cap embed latency at 3s — Gemini API occasionally hangs
                        // for 12-18s, turning a fast FTS search into a multi-second ordeal.
                        queryVec = await Promise.race([
                            (0, embedProducts_1.embedQuery)(q, geminiKey),
                            new Promise((_resolve, reject) => setTimeout(() => reject(new Error('embed timeout after 3000ms')), 3000)),
                        ]);
                        if (queryVec) {
                            await config_1.redis.set(embedKey, queryVec, 'EX', 60).catch(() => { });
                        }
                    }
                }
                catch (embedErr) {
                    console.warn('[search] embed query failed/timeout, falling back to FTS:', embedErr.message);
                    queryVec = null;
                    embedTimedOut = true;
                }
                if (queryVec && config_1.vectorDb && !embedTimedOut) {
                    let candidateIds;
                    if (mode === 'semantic') {
                        // Vector-only: fetch top-200 nearest neighbours from vector DB, then fetch details.
                        // Restrict to the 512-dim Gemini table; fail open to keyword FTS below
                        // instead of rejecting the whole MCP call on vector slowness/mismatch.
                        try {
                            const vecRows = await Promise.race([
                                config_1.vectorDb.query(`SELECT product_id FROM product_embeddings
                   WHERE model_ver = 'gemini-embedding-001@512'
                   ORDER BY embedding <=> $1::vector LIMIT 200`, [queryVec]),
                                new Promise((_, reject) => setTimeout(() => reject(new Error('vector timeout after 2000ms')), 2000)),
                            ]);
                            candidateIds = vecRows.rows.map(r => r.product_id).slice(0, limit + offset);
                        }
                        catch (vecErr) {
                            console.warn('[search] vector query failed, falling back to FTS:', vecErr.message);
                            candidateIds = [];
                            queryVec = null;
                        }
                    }
                    else {
                        // Hybrid: app-level RRF of FTS ranks + vector ranks.
                        // BUY-70304: fail open per leg. A slow/mismatched vector DB query was
                        // making otherwise-fast MY keyword searches surface JSON-RPC -32603.
                        let ftsRows = [];
                        let vecRows = [];
                        try {
                            // BUY-70445: run the hybrid FTS leg on its own bounded client. Under
                            // catalog DB I/O contention, a raw query on the outer searchClient can
                            // sit behind the pool/default 30s timeout and make otherwise-fast
                            // keyword searches surface JSON-RPC -32603. Match keyword mode's
                            // explicit statement timeout and fail open to vector-only/no-results.
                            const ftsClient = await acquireMcpClient();
                            try {
                                await ftsClient.query('SET statement_timeout = 4500');
                                await ftsClient.query('SET work_mem = \'64MB\'');
                                await ftsClient.query('SET enable_seqscan = off');
                                const ftsResult = await ftsClient.query(`SELECT id FROM products ${where} LIMIT 200`, params);
                                ftsRows = ftsResult.rows;
                            }
                            finally {
                                releaseClientSafely(ftsClient);
                            }
                        }
                        catch (ftsErr) {
                            console.warn('[search] hybrid FTS query failed:', ftsErr.message);
                        }
                        try {
                            const vecResult = await Promise.race([
                                config_1.vectorDb.query(`SELECT product_id FROM product_embeddings
                   WHERE model_ver = 'gemini-embedding-001@512'
                   ORDER BY embedding <=> $1::vector LIMIT 200`, [queryVec]),
                                new Promise((_, reject) => setTimeout(() => reject(new Error('vector timeout after 2000ms')), 2000)),
                            ]);
                            vecRows = vecResult.rows;
                        }
                        catch (vecErr) {
                            console.warn('[search] hybrid vector query failed, FTS only:', vecErr.message);
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
                    total = candidateIds.length;
                    const pageIds = candidateIds.slice(offset, offset + limit);
                    if (pageIds.length === 0) {
                        rows = [];
                    }
                    else {
                        // BUY-70539: hybrid RRF may include vector-only candidates. Do not reuse
                        // `where` here because it includes the keyword FTS predicate; reapplying
                        // that predicate filters out vector hits and yields total>0/results=[].
                        const detailConditions = ['is_active = true'];
                        const detailParams = [];
                        if (domain) {
                            detailParams.push(domain);
                            detailConditions.push(`source = $${detailParams.length}`);
                        }
                        if (minPrice != null) {
                            detailParams.push(minPrice);
                            detailConditions.push(`price >= $${detailParams.length}`);
                        }
                        if (maxPrice != null) {
                            detailParams.push(maxPrice);
                            detailConditions.push(`price <= $${detailParams.length}`);
                        }
                        if (region) {
                            detailParams.push(region);
                            detailConditions.push(`region = $${detailParams.length}`);
                        }
                        if (country) {
                            detailParams.push(country.toUpperCase());
                            detailConditions.push(`country_code = $${detailParams.length}`);
                        }
                        detailParams.push(pageIds);
                        const detailResult = await searchClient.query(`SELECT id, sku AS source, source AS domain, url, title,
                      price, currency, image_url, metadata, updated_at, region, country_code, category, category_path
               FROM products WHERE ${detailConditions.join(' AND ')} AND id = ANY($${detailParams.length}::bigint[])`, detailParams);
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
                      price, currency, image_url, metadata, updated_at, region, country_code, category, category_path
               FROM products ${where}
               LIMIT $${params.length - 2}
             ) _candidates
             ORDER BY updated_at DESC
             LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
                    rows = result.rows;
                    // BUY-70144: if we hit the candidate cap, use that as a lower-bound total
                    total = rows.length >= CANDIDATE_LIMIT ? CANDIDATE_LIMIT : rows.length;
                }
            }
            else {
                // Keyword (FTS) path — BUY-31962 subquery pattern
                // BUY-70263: gate high-cardinality single-token FTS queries with a quick count check.
                // Terms like "laptop", "skincare" match millions of rows for MY, causing the
                // GIN index scan to timeout even with enable_seqscan=off. If FTS matches exceed
                // a safe threshold, restrict the scan to recent rows to avoid statement_timeout.
                const queryTokenCount = q.split(/\s+/).filter(Boolean).length;
                let ftsTooBroad = false;
                const CANDIDATE_LIMIT = Math.min((limit + offset) * 10, 5000);
                const FTS_COUNT_THRESHOLD = 10000; // If FTS matches > 10K rows, restrict to recent data
                let finalWhere = where;
                let finalParams = [...params];
                if (queryTokenCount <= 1 && !domain && !minPrice && !maxPrice) {
                    try {
                        const countClient = await acquireMcpClient();
                        try {
                            await countClient.query('SET statement_timeout = 3000');
                            await countClient.query('SET enable_seqscan = off');
                            // Count only the FTS matches (without the CANDIDATE_LIMIT)
                            const countResult = await countClient.query(`SELECT COUNT(*) as cnt FROM products ${where}`, params);
                            const ftsCount = parseInt(countResult.rows[0]?.cnt ?? '0', 10);
                            if (ftsCount > FTS_COUNT_THRESHOLD) {
                                console.log(`[search_products] FTS count ${ftsCount} > threshold ${FTS_COUNT_THRESHOLD}, restricting to recent rows`);
                                ftsTooBroad = true;
                            }
                        }
                        finally {
                            releaseClientSafely(countClient);
                        }
                    }
                    catch (countErr) {
                        // Count query failed — proceed to primary and let it fail naturally if FTS is too slow
                        console.warn('[search_products] count check failed:', countErr.message);
                    }
                }
                // If FTS is too broad, restrict to recent rows (last 90 days) to keep the scan manageable
                if (ftsTooBroad) {
                    const constrainedConditions = [...conditions, `updated_at > NOW() - INTERVAL '90 days'`];
                    finalWhere = constrainedConditions.length ? `WHERE ${constrainedConditions.join(' AND ')}` : '';
                }
                finalParams.push(CANDIDATE_LIMIT, limit, offset);
                const result = await searchClient.query(`SELECT * FROM (
             SELECT id, sku AS source, source AS domain, url, title,
                    price, currency, image_url, metadata, updated_at, region, country_code, category, category_path
             FROM products ${finalWhere}
             LIMIT $${finalParams.length - 2}
           ) _candidates
           ORDER BY updated_at DESC
           LIMIT $${finalParams.length - 1} OFFSET $${finalParams.length}`, finalParams);
                rows = result.rows;
                // BUY-70144: if we hit the candidate cap, use that as a lower-bound total
                total = rows.length >= CANDIDATE_LIMIT ? CANDIDATE_LIMIT : rows.length;
            }
        }
        else {
            // No FTS — browse mode. Unfiltered browse can use reltuples as a catalog-size
            // estimate, but filtered browse must not report the global product count as
            // `total` (BUY-70314: agents used the 397M global count as result quality).
            const needsFilter = !!(country || region || domain || minPrice != null || maxPrice != null);
            const fetchLimit = needsFilter ? Math.min((limit + offset) * 20, 5000) : limit + offset;
            if (!needsFilter) {
                const approxResult = await searchClient.query(`SELECT reltuples::bigint AS estimate FROM pg_class WHERE relname = 'products'`);
                total = parseInt(approxResult.rows[0]?.estimate ?? '0', 10);
            }
            const browseParams = [...params, fetchLimit];
            const rawResult = await searchClient.query(`SELECT id, sku AS source, source AS domain, url, title,
                price, currency, image_url, metadata, updated_at,
                region, country_code
         FROM products ${where}
         ORDER BY updated_at DESC
         LIMIT $${browseParams.length}`, browseParams);
            rows = rawResult.rows.slice(offset, offset + limit);
            if (needsFilter) {
                total = rawResult.rows.length;
            }
        }
    }
    finally {
        // BUY-56185: always use safe release to discard connections poisoned by statement_timeout
        releaseClientSafely(searchClient);
    }
    // BUY-70132: post-filter on both raw category AND category_path[1] (canonical).
    // Removed ILIKE from SQL (was causing seqscan on large result sets).
    if (category && rows.length > 0) {
        const catLower = category.toLowerCase();
        rows = rows.filter(r => {
            const rawCat = (r.category || '').toLowerCase();
            const catPath = (r.category_path?.[0] || '').toLowerCase();
            return rawCat.includes(catLower) || catPath.includes(catLower);
        });
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
    // BUY-70395: agents parse content[0].text as the tool result. The old
    // markdown blob gave structured-data consumers nothing to parse while every
    // other tool returned JSON. Emit JSON as the text content and keep the
    // human-readable markdown alongside (not instead).
    const productJson = JSON.stringify(product);
    const formattedText = formatProductForMcp(product);
    return {
        content: [{ type: 'text', text: productJson }],
        product,
        markdown: formattedText,
        response_time_ms: Date.now() - t0,
    };
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
    // BUY-59768: infer currency from country_code (or region) when not explicitly set.
    const REGION_TO_COUNTRY = { sg: 'SG', us: 'US', my: 'MY', th: 'TH', vn: 'VN', gb: 'GB' };
    const explicitCurrency = (args.currency || '').toUpperCase();
    const regionArg = (args.region || '').toLowerCase();
    const dealsCountry = (args.country_code || args.country || REGION_TO_COUNTRY[regionArg] || '').toUpperCase();
    const currency = explicitCurrency || (dealsCountry ? (response_1.COUNTRY_CURRENCY[dealsCountry] || 'SGD') : 'SGD');
    // BUY-70428: an ISO-style region (sg/us/my/...) is a market selector, not a
    // literal products.region value. The old code kept BOTH `region='my'`
    // (lowercased!) and `country_code='MY'`, adding a redundant — and for
    // mixed-case catalogs, wrong — predicate on top of the country filter.
    // Normalize ISO regions to country_code and only pass a raw region
    // predicate through for genuinely non-ISO region labels.
    const region = REGION_TO_COUNTRY[regionArg] ? '' : regionArg;
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
    // BUY-68615: hardcode true — production catalog DB has discount_pct GENERATED ALWAYS column.
    // The probe can mis-detect on cold pool connections; bypass it to use the fast indexed path.
    const useDiscountCol = true;
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
    const discountSelect = useDiscountCol
        ? 'discount_pct'
        : `ROUND(((1 - price / NULLIF((metadata->>'original_price')::numeric, 0)) * 100)::numeric, 1) AS discount_pct`;
    const whereClause = conditions.join(' AND ');
    // BUY-64112: strict discount-first query only. The prior recent-window sample
    // + laptop/watch fallback returned keyword rows with discount_pct=0 and hid
    // real discounted products. Query the indexed discount predicate directly.
    const dealsClient = await acquireMcpClient().catch((err) => {
        console.error('[mcp] get_deals db.connect failed:', err);
        throw { code: -32603, message: 'Database unavailable' };
    });
    let products = [];
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
        // BUY-70554 (2026-08-16): page directly from the ordered deals index.
        // The prior id-thin CTE capped the walk at 400 candidates, then self-joined
        // all 400 IDs back through products_pkey before applying the caller's page
        // limit. On cold cache this spent ~10s on 400 random heap lookups even for
        // limit=3 and surfaced as -32603. The direct scan preserves discount-first
        // ordering, lets Postgres incremental-sort the current discount group by
        // updated_at, and early-stops after the requested page rows.
        const dataResult = await dealsClient.query(`SELECT id, sku AS source, source AS domain, url, title,
              price,
              CASE WHEN metadata->>'original_price' ~ '^[0-9]+(\\.[0-9]+)?$'
                   THEN (metadata->>'original_price')::numeric ELSE NULL END AS original_price,
              currency, image_url, metadata, updated_at, region, country_code,
              discount_pct
       FROM products
       WHERE ${whereClause}
       ORDER BY discount_pct DESC, updated_at DESC
       LIMIT ${limit} OFFSET ${offset}`, params);
        total = dataResult.rows.length;
        products = dataResult.rows.map((r) => (0, response_1.buildProduct)(r, currency, false));
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
            let rows;
            // BUY-70286: the primary matview read is an indexed sub-10ms scan when
            // healthy, but it had neither a try/catch nor a tight budget. Under
            // ingestion I/O contention it queued past the old 8s statement_timeout
            // and the rejection escaped as a raw -32603 (the observed "8.4s VN"
            // failure). Budget it at 2s and treat a timeout/abort exactly like an
            // empty read so the bounded live fallbacks below still run.
            // BUY-70428: the 2s budget is the right ceiling for a warm buffer cache
            // (observed 3-15ms), but the concurrent-REFRESH cycle + ingestion I/O
            // contention can evict the 36MB matview / 3.7MB index from the small
            // Railway shared_buffers. On a cold cache the indexed read alone took
            // 5.5s (EXPLAIN ANALYZE, all I/O) and timed out, cascading to the
            // placeholder fallback and unavailable:true for every region. 12s still
            // bounds the tool well under the transport ceiling while letting a
            // cold-cache read complete instead of degrading to static stubs.
            const MAT_VIEW_TIMEOUT_MS = 12000;
            // BUY-60096: canonical MCP must never let category fallback monopolize the shared pool.
            // If the materialized view is empty, keep fallbacks bounded so cold misses stay under 5s.
            const LIVE_TIMEOUT_MS = 1800;
            const FALLBACK_COUNTRIES = new Set(['SG', 'US', 'MY', 'TH', 'VN', 'GB', 'PH', 'ID', 'IN', 'AU']);
            await client.query(`SET statement_timeout = ${MAT_VIEW_TIMEOUT_MS}`);
            const tableCheck = await client.query(`SELECT to_regclass('public.mcp_category_summary_by_country') AS tbl`);
            rows = [];
            if (tableCheck.rows[0]?.tbl) {
                try {
                    const summaryResult = await client.query(`SELECT slug, name, product_count
             FROM mcp_category_summary_by_country
             WHERE country_code = $1
               AND slug IS NOT NULL AND slug <> ''
             ORDER BY product_count DESC
             LIMIT 100`, [country]);
                    rows = summaryResult.rows;
                }
                catch (_) {
                    // Matview read timed out or failed — fall through to the bounded
                    // live fallbacks instead of surfacing -32603. Autocommit means the
                    // next statement starts a fresh transaction, so the client is safe
                    // to reuse; releaseClientSafely still discards it if not.
                    rows = [];
                }
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
            if (rows.length === 0) {
                try {
                    await client.query(`SET statement_timeout = ${LIVE_TIMEOUT_MS}`);
                    const recentResult = await client.query(`SELECT slug, slug AS name, COUNT(*)::int AS product_count
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
            if (rows.length === 0) {
                rows = ['Electronics', 'Computers', 'Mobile Phones', 'Home', 'Fashion'].map((name) => ({
                    slug: name.toLowerCase().replace(/\s+/g, '-'),
                    name,
                    product_count: 0,
                }));
            }
            const allCountsZero = rows.every((row) => Number(row.product_count) === 0);
            // BUY-70395: pg returns COUNT(*) as bigint → JSON string ('7013'). The
            // REST endpoint parseInt()s it; do the same here so MCP and REST agree on
            // `product_count` being an int in the JSON payload.
            rows = rows.map((row) => ({ ...row, product_count: Number(row.product_count) }));
            const meta = {
                total: rows.length,
                country_code: country,
                response_time_ms: 0,
                cached: false,
            };
            meta.unavailable = allCountsZero;
            const data = { data: rows, meta };
            if (!allCountsZero) {
                config_1.redis.set(cacheKey, JSON.stringify(data), 'EX', 600).catch(() => { }); // 10 min TTL
            }
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
    const productName = (args.product_name || args.q || '').trim();
    if (!productName)
        throw { code: -32602, message: 'product_name is required' };
    const normalizedMarket = normalizeCountryAndRegion(args);
    const country = (normalizedMarket.rawCountry || normalizedMarket.regionCountry || 'SG').toUpperCase();
    const region = normalizedMarket.region;
    const category = args.category || '';
    const limit = 10;
    // BUY-67522: infer exact device-family queries and reject accessory results.
    const deviceFilter = (0, deviceClassifier_1.buildDeviceFilter)(productName, country);
    // BUY-26343: price > 0 prevents returning corrupt zero-price records
    const conditions = ['is_active = true', 'price > 0'];
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
    // BUY-67522: for exact device queries, enforce a floor that accessories cannot satisfy.
    if (deviceFilter.minLocal > 0) {
        params.push(deviceFilter.minLocal);
        conditions.push(`price >= $${params.length}`);
    }
    // BUY-70236: overfetch before accessory filtering — the TypeScript accessory filter
    // can remove all rows when the cheapest FTS matches are expensive accessories
    // (e.g. iPhone 15 camera skins at S$299 vs device at S$620+). The fallback ILIKE
    // path also benefits from returning a wider pre-filter set.
    // BUY-70332: device queries with a price floor (e.g. iPhone >= S$540) need a smaller
    // pool because the GIN index scan with price predicate is slower than unlimited FTS.
    const isDeviceQuery = deviceFilter.type && deviceFilter.minLocal > 0;
    const CANDIDATE_POOL = isDeviceQuery ? 50 : Math.max(limit * 50, 500);
    const PREFILTER_RESULT_POOL = Math.max(limit * 50, 500);
    params.push(CANDIDATE_POOL, PREFILTER_RESULT_POOL);
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
    let result = { rows: [] };
    // BUY-70661: track WHY the primary path returned 0 rows so monitoring can
    // distinguish genuine no-match from infrastructure failure (timeout / pool starvation).
    let primaryError = null;
    let primaryTimedOut = false;
    // BUY-70189/BUY-70314/BUY-70332: gate high-cardinality single-token FTS
    // queries with a quick capped count probe. Do not count-gate multi-token
    // queries: under catalog DB I/O contention the bounded ILIKE fallback can be
    // slower than primary FTS and can false-empty phrases like "wireless mouse".
    // BUY-70332 (follow-up): when the count probe reports count > pool, do NOT
    // divert to the ILIKE fallback. The primary FTS query is bounded by
    // LIMIT CANDIDATE_POOL itself, so a large FTS match set is exactly the case
    // the pool bound handles. The old diversion sampled 500 arbitrary (unordered)
    // market rows for a title ILIKE — for niche single-token terms like "nike"
    // the sample contains zero matches and the tool false-empties in ~100ms.
    const queryTokenCount = productName.split(/\s+/).filter(Boolean).length;
    let ftsTooBroad = false;
    void ftsTooBroad;
    if (false && !category && !deviceFilter.type && queryTokenCount <= 1) {
        try {
            const countClient = await acquireMcpClient();
            try {
                await countClient.query('SET statement_timeout = 3000');
                await countClient.query('SET enable_seqscan = off');
                // BUY-70304: cap before counting. COUNT(*) ... LIMIT is still an
                // unbounded aggregate, so SG laptop spent seconds in the gate before
                // falling into an accessory-prone ILIKE fallback. The subquery stops as
                // soon as we know there are more candidates than the primary pool.
                const countResult = await countClient.query(`SELECT COUNT(*) as cnt FROM (
             SELECT 1 FROM products ${where} LIMIT ${CANDIDATE_POOL + 1}
           ) _capped`, params.slice(0, -2) // Remove the CANDIDATE_POOL and limit params
                );
                const ftsCount = parseInt(countResult.rows[0]?.cnt ?? '0', 10);
                // Device-family queries need the FTS primary path: broad title-ILIKE
                // fallback over recent rows returns mice/bags/RAM that are later filtered
                // as accessories, producing false-empty results for "laptop".
                if (ftsCount > CANDIDATE_POOL && !deviceFilter.type) {
                    console.log(`[mcp] find_best_price: FTS count ${ftsCount} > pool ${CANDIDATE_POOL}, using ILIKE fallback`);
                    ftsTooBroad = true;
                }
            }
            finally {
                releaseClientSafely(countClient);
            }
        }
        catch (countErr) {
            // Count query failed — proceed to primary and let it fail naturally if FTS is too slow
            console.warn('[mcp] find_best_price count check failed:', countErr.message);
        }
    }
    if (!category && !ftsTooBroad) {
        try {
            const primaryClient = await acquireMcpClient();
            try {
                // BUY-70144: bumped to 20s — US "nike air max" FTS returns ~1001 rows
                // and takes ~3s via GIN; 10s was too tight and caused US to fall through
                // to the ILIKE fallback, which also timed out → 0 results for US queries.
                // BUY-70144: enable_seqscan=off ensures the planner uses the composite GIN
                // index even on sparse-result queries (low selectivity selectivity → the
                // planner misestimates cost and picks seqscan → statement_timeout).
                await primaryClient.query('SET statement_timeout = 20000');
                await primaryClient.query('SET enable_seqscan = off');
                result = await primaryClient.query(`WITH cand AS (
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
                  p.country_code, p.updated_at, p.category, p.category_path, p.metadata, p.in_stock
           FROM page_ids pi
           JOIN products p ON p.id = pi.id
           ORDER BY pi.price ASC, pi.updated_at DESC`, params);
            }
            finally {
                // BUY-56185: discard connections poisoned by statement_timeout.
                releaseClientSafely(primaryClient);
            }
        }
        catch (primaryErr) {
            // BUY-70088/BUY-70097: broad/sparse strings can produce huge FTS candidate
            // sets and hit statement_timeout. Preserve MCP contract by trying the
            // fallback instead of surfacing generic JSON-RPC -32603.
            const msg = primaryErr.message;
            if (msg.includes('statement timeout') || msg.includes('canceling statement')) {
                primaryTimedOut = true;
            }
            else if (msg.includes('mcp_db_pool_acquire_timeout')) {
                primaryError = 'pool_acquire_timeout';
            }
            else {
                primaryError = msg.slice(0, 120);
            }
            console.warn('[mcp] find_best_price primary query failed:', msg);
            result = { rows: [] };
        }
    }
    // BUY-69626: FTS returned nothing — try bounded title-ILIKE on recent market slice
    // BUY-70064: Fixed parameter order — $2 must be titlePattern for both LIMIT and ILIKE.
    // Prior bug: params were [country, CANDIDATE_POOL, titlePattern] making $2=CANDIDATE_POOL,
    // which is an integer but used as text in LIMIT/ILIKE → PostgreSQL type error → -32603.
    // BUY-70112: category-qualified queries also skip primary and enter here directly because
    // the primary FTS path times out on broad category predicates (Fashion/SG pattern).
    //
    // BUY-70661 restructure: use catalogDb with the exact primary query shape as fallback.
    // Direct tests confirm the primary CTE (GIN-indexed FTS + bounded LIMIT) produces 500
    // candidates in <25s from the sakura catalog DB. The primary path on the Railway MCP
    // service times out at 20s because the Railway→sakura network path adds latency or
    // the MCP pool is saturated. catalogDb is a separate pool with its own connection
    // so it bypasses MCP pool starvation.
    //
    // Tier-1 (catalogDb, primary FTS query shape): 30s for US/MY/VN, 15s for SG/TH/PH.
    // Tier-2 (catalogDb, title ILIKE): last-resort for queries with no FTS match.
    if (result.rows.length === 0) {
        const requestedCountry = country || (region.toLowerCase() === 'us' ? 'US' : 'SG');
        const minPrice = deviceFilter.minLocal > 0 ? deviceFilter.minLocal : 0;
        const LARGE_MARKETS = new Set(['US', 'MY', 'VN']);
        // Large markets need more time; the primary path gives them 20s but the Railway→sakura
        // hop adds latency so give catalogDb tier-1 30s before falling to title ILIKE.
        const tier1Timeout = LARGE_MARKETS.has(requestedCountry) ? 30000 : 15000;
        const tier2Timeout = 10000;
        // BUY-70661: Tier-1 — run the exact primary CTE query on catalogDb (separate pool,
        // bypasses MCP pool starvation from concurrent MCP connections on Railway).
        try {
            let catalogClient;
            try {
                catalogClient = await Promise.race([
                    config_1.catalogDb.connect(),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('catalog_db_pool_acquire_timeout')), 2000)),
                ]);
            }
            catch (acqErr) {
                console.warn('[mcp] find_best_price catalogDb acquire failed:', acqErr.message);
                catalogClient = null;
            }
            if (catalogClient) {
                try {
                    await catalogClient.query(`SET statement_timeout = ${tier1Timeout}`);
                    await catalogClient.query('SET enable_seqscan = off');
                    // Reconstruct the primary query conditions with country for catalogDb use.
                    // We rebuild params from scratch for catalogDb so the $N numbering is clean.
                    const cdParams = [productName];
                    const cdConditions = ['is_active = true', 'price > 0', `search_vector @@ plainto_tsquery('english', $1)`];
                    cdConditions.push(`country_code = $${cdParams.push(requestedCountry)}`);
                    if (minPrice > 0) {
                        cdConditions.push(`price >= $${cdParams.push(minPrice)}`);
                    }
                    // BUILD: cand picks up to CANDIDATE_POOL rows via GIN FTS + country filter.
                    // page_ids then orders by price so the final JOIN returns lowest-priced candidates.
                    const cdCANDIDATE_POOL = isDeviceQuery ? 50 : Math.max(limit * 50, 500);
                    cdParams.push(cdCANDIDATE_POOL, limit);
                    result = await catalogClient.query(`WITH cand AS (
               SELECT id, price, updated_at
               FROM products
               WHERE ${cdConditions.join(' AND ')}
               LIMIT $${cdParams.length - 1}
             ), page_ids AS (
               SELECT id, price, updated_at
               FROM cand
               ORDER BY price ASC, updated_at DESC
               LIMIT $${cdParams.length}
             )
             SELECT p.id, p.title, p.price, p.currency, p.source AS domain, p.url, p.image_url,
                    p.country_code, p.updated_at, p.category, p.category_path, p.metadata, p.in_stock
             FROM page_ids pi
             JOIN products p ON p.id = pi.id
             ORDER BY pi.price ASC, pi.updated_at DESC`, cdParams);
                }
                finally {
                    releaseClientSafely(catalogClient);
                }
            }
        }
        catch (fallbackErr) {
            const msg = fallbackErr.message;
            if (msg.includes('statement timeout') || msg.includes('canceling statement')) {
                primaryTimedOut = true;
            }
            else if (msg.includes('catalog_db_pool_acquire_timeout')) {
                primaryError = 'pool_acquire_timeout';
            }
            else {
                primaryError = msg.slice(0, 120);
            }
            console.warn('[mcp] find_best_price catalogDb tier-1 (primary query shape) failed:', msg);
            result = { rows: [] };
        }
        // BUY-70661: Tier-2 — last-resort title ILIKE on catalogDb.
        // Only runs when tier-1 failed (timeout or pool starve). title ILIKE is a broad
        // catch for queries with zero FTS match but title contains the search terms.
        if (result.rows.length === 0) {
            const titlePattern = `%${productName}%`;
            try {
                let catalogClient;
                try {
                    catalogClient = await Promise.race([
                        config_1.catalogDb.connect(),
                        new Promise((_, reject) => setTimeout(() => reject(new Error('catalog_db_pool_acquire_timeout')), 2000)),
                    ]);
                }
                catch (acqErr) {
                    console.warn('[mcp] find_best_price catalogDb acquire (tier-2) failed:', acqErr.message);
                    catalogClient = null;
                }
                if (catalogClient) {
                    try {
                        await catalogClient.query(`SET statement_timeout = ${tier2Timeout}`);
                        await catalogClient.query('SET enable_seqscan = off');
                        const fbParams = [requestedCountry, titlePattern, CANDIDATE_POOL];
                        const fbConditions = ['is_active = true', 'price > 0', 'country_code = $1', 'title ILIKE $2'];
                        if (minPrice > 0) {
                            fbParams.push(minPrice);
                            fbConditions.push(`price >= $${fbParams.length}`);
                        }
                        if (category) {
                            fbParams.push(`%${category}%`);
                        }
                        const catPred = category ? `AND category ILIKE $${fbParams.length}` : '';
                        result = await catalogClient.query(`SELECT id, title, price, currency, source AS domain, url, image_url,
                      country_code, updated_at, category, category_path, metadata, in_stock
               FROM products
               WHERE ${fbConditions.join(' AND ')}
               ${catPred}
               ORDER BY price ASC
               LIMIT ${PREFILTER_RESULT_POOL}`, fbParams);
                    }
                    finally {
                        releaseClientSafely(catalogClient);
                    }
                }
            }
            catch (tier2Err) {
                console.warn('[mcp] find_best_price catalogDb tier-2 ILIKE fallback failed:', tier2Err.message);
                result = { rows: [] };
            }
        }
    }
    const currency = response_1.COUNTRY_CURRENCY[country] || 'SGD';
    const toUsd = response_1.CURRENCY_RATES[currency] ?? 1;
    const neg = deviceFilter.negativeTerms;
    const isAccessory = (r) => {
        if (!deviceFilter.type)
            return false;
        const metadata = (r.metadata && typeof r.metadata === 'object') ? r.metadata : {};
        const text = [
            String(r.title || ''),
            String(r.category_path?.join(' ') || ''),
            String(r.category || ''),
            String(metadata.category || ''),
            String(metadata.product_type || ''),
        ].join(' ').toLowerCase();
        // Positive signal: the product_type/category clearly names the device family.
        const positiveSignals = [];
        if (deviceFilter.type === 'phone')
            positiveSignals.push('smartphone', 'mobile phone', 'mobile phones');
        if (deviceFilter.type === 'console')
            positiveSignals.push('game console', 'gaming console', 'consoles');
        if (deviceFilter.type === 'laptop')
            positiveSignals.push('laptop', 'notebook');
        if (deviceFilter.type === 'tablet')
            positiveSignals.push('tablet');
        if (deviceFilter.type === 'wearable')
            positiveSignals.push('smart watch', 'smartwatch', 'fitness tracker');
        const hasPositive = positiveSignals.some(s => text.includes(s));
        const hasNegative = neg.some(t => text.includes(t));
        // If the title explicitly contains a positive device word and no accessory word, keep it.
        if (!hasNegative && hasPositive)
            return false;
        // If any negative term appears, treat as accessory unless a positive signal also appears.
        if (hasNegative && !hasPositive)
            return true;
        // Fallback: multi-model titles like "For iPhone 15 14 13 ... screen protector" are accessories.
        if (/\bfor\b.*\b(iphone|galaxy|ipad|ps5|xbox|macbook)\b.*\b\d+\b.*(protector|case|cover|glass|film|cable|adapter|charger|controller|game)\b/.test(text))
            return true;
        if (/\bcompatible\b/.test(text) && hasNegative)
            return true;
        return false;
    };
    const candidates = result.rows.filter(r => !isAccessory(r)).slice(0, limit);
    const data = candidates.map((r) => {
        const amount = r.price != null ? parseFloat(r.price) : null;
        const rowCurrency = r.currency || currency;
        return {
            id: r.id,
            title: r.title,
            // BUY-65559 / BUY-65685: sentinel-price guard — string when sentinel,
            // structured object otherwise. Parallel to PR #36 in @buywhere/mcp.
            price: (0, response_1.formatPriceField)(amount, rowCurrency),
            normalized_price_usd: (0, response_1.isSentinelPrice)(amount) || amount == null ? null : Math.round(amount * toUsd * 100) / 100,
            merchant: r.domain,
            url: r.url,
            image_url: r.image_url,
            country_code: r.country_code,
            in_stock: r.in_stock !== false,
        };
    });
    // BUY-70661: surface infrastructure failure in response metadata so callers and
    // monitoring can distinguish genuine no-match from timeout/pool starvation.
    const meta = { total: data.length, country, response_time_ms: Date.now() - t0 };
    if (primaryTimedOut) {
        meta.timed_out = true;
    }
    if (primaryError) {
        meta.unavailable_reason = primaryError;
    }
    // If both primary and fallback returned empty, mark as potentially unavailable
    // so agents know to retry or use a different query — it's not a "genuinely no matches".
    if (data.length === 0 && (primaryTimedOut || primaryError)) {
        meta.unavailable = true;
    }
    return {
        best_price: data[0] ?? null,
        alternatives: data.slice(1),
        meta,
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
    const requestedId = (args.product_id || '').trim();
    const productName = (args.product_name || '').trim();
    const explicitCountryCode = (args.country_code || '').toUpperCase();
    const countryCode = explicitCountryCode || 'SG';
    const limit = Math.min(Math.max(Number(args.limit) || 10, 1), 10);
    let resolvedId = requestedId;
    if (!resolvedId && productName) {
        const conditions = ['is_active = true'];
        const params = [];
        params.push(productName);
        conditions.push(`search_vector @@ plainto_tsquery('english', $${params.length})`);
        if (countryCode) {
            params.push(countryCode);
            conditions.push(`country_code = $${params.length}`);
        }
        const lookupResult = await config_1.catalogDb.query(
        // BUY-32028/70294: bound the FTS candidates BEFORE ranking. An unbounded
        // rank sort over the whole match set re-introduces the multi-second sort
        // the ts-rank guard exists to prevent. Rank only a 50-row slice.
        `SELECT id, sku FROM (
         SELECT id, sku, ts_rank(search_vector, plainto_tsquery('english', $1)) AS _rank
         FROM (
           SELECT id, sku, search_vector FROM products WHERE ${conditions.join(' AND ')} LIMIT 50
         ) _lookup_candidates
       ) _ranked_lookup_candidates
       ORDER BY _rank DESC LIMIT 1`, params);
        if (!lookupResult.rows.length) {
            throw { code: -32001, message: `No product found matching "${productName}" in ${countryCode}` };
        }
        resolvedId = String(lookupResult.rows[0].id);
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
    if (!config_1.vectorDb && !config_1.VECTOR_DB_USES_CATALOG_DB) {
        throw { code: -32001, message: 'Vector search not available - vector DB not configured' };
    }
    let sourceProductId = resolvedId;
    let sourceSku = null;
    try {
        // BUY-70113: numeric ids must bind as bigint so products_pkey is used — an
        // `id = $1` with a text parameter (or `id::text`) is a full Seq Scan on the
        // ~300M-row catalog and blows the statement_timeout.
        // BUY-70652: when callers scope find_similar to a market, validate the anchor
        // product in that same market before entering the expensive vector path. TH
        // probes harvest no ids and use a fallback SG id; without this guard the handler
        // runs global KNN work for an out-of-market anchor and can surface 57014 as -32603.
        const countryPredicate = explicitCountryCode ? ' AND country_code = $2' : '';
        const sourceResult = await config_1.catalogDb.query(isNumericProductId
            ? `SELECT id::text AS id, sku FROM products WHERE id = $1::bigint AND is_active = true${countryPredicate} LIMIT 1`
            : `SELECT id::text AS id, sku FROM products WHERE sku = $1 AND is_active = true${countryPredicate} ORDER BY updated_at DESC LIMIT 1`, explicitCountryCode ? [resolvedId, explicitCountryCode] : [resolvedId]);
        if (sourceResult.rows.length) {
            sourceProductId = String(sourceResult.rows[0].id);
            sourceSku = sourceResult.rows[0].sku ? String(sourceResult.rows[0].sku) : null;
        }
        else if (explicitCountryCode) {
            throw { code: -32001, message: `Product not found in ${explicitCountryCode}` };
        }
        else if (!isNumericProductId) {
            // Non-numeric input that matched no product row: keep it as a raw legacy-SKU
            // probe for the sku-keyed vector table.
            sourceSku = resolvedId;
        }
    }
    catch (err) {
        const e = err;
        if (e?.code === -32001)
            throw err;
        if (!isNumericProductId)
            sourceSku = resolvedId;
    }
    // BUY-70113: numeric input may be a products.id OR a legacy vector SKU (Shopify
    // variant ids like "9641789751525" are 13-digit and indistinguishable by shape).
    // Probe both: canonical product_embeddings by product_id, then legacy
    // search_proof.product_vectors by sku — but run the legacy table on catalogDb,
    // which is where it lives (vectorDb has no search_proof schema).
    const lookupKeys = Array.from(new Set([sourceProductId, sourceSku, resolvedId].filter(Boolean).map(String)));
    let refResult;
    try {
        refResult = config_1.vectorDb
            ? await config_1.vectorDb.query(`SELECT product_id::text AS vector_key, embedding::text, 'product_embeddings' AS vector_table
             FROM product_embeddings
            WHERE product_id = ANY($1::bigint[])
            ORDER BY CASE WHEN product_id::text = $2 THEN 0 ELSE 1 END
            LIMIT 1`, [lookupKeys.filter(k => /^\d+$/.test(k)).map(k => k), sourceProductId])
            : { rows: [] };
    }
    catch {
        refResult = { rows: [] };
    }
    if (!refResult.rows.length) {
        try {
            // BUY-70113: search_proof.product_vectors lives in the CATALOG DB (sakura),
            // not the vector DB — the previous vectorDb probe always errored and the
            // swallowed catch made the legacy fallback dead code.
            refResult = await config_1.catalogDb.query(`SELECT sku AS vector_key, embedding::text, 'search_proof.product_vectors' AS vector_table
           FROM search_proof.product_vectors
          WHERE sku = ANY($1::text[])
          ORDER BY CASE WHEN sku = $2 THEN 0 ELSE 1 END
          LIMIT 1`, [lookupKeys, sourceSku || resolvedId]);
        }
        catch {
            refResult = { rows: [] };
        }
    }
    if (!refResult.rows.length && !config_1.VECTOR_DB_USES_CATALOG_DB && config_1.vectorDb) {
        // BUY-70314: standard search_products→find_similar flow must not fail just
        // because the selected source product has not been backfilled into vector DB.
        // If the catalog row exists, embed its own title/description at request time
        // and use that as the reference vector.
        const geminiKey = process.env.GEMINI_API_KEY ?? '';
        if (!geminiKey || !sourceProductId) {
            // BUY-70428: name the actual gap in the error so callers can act on it —
            // "backfill may still be running" is misleading when the service has no
            // embedding key configured and the request-time fallback is impossible.
            const reason = !geminiKey
                ? 'No embedding found for this product and request-time embedding is unavailable (GEMINI_API_KEY not set on this service)'
                : 'No embedding found for this product - backfill may still be running';
            throw { code: -32001, message: reason };
        }
        const productResult = await config_1.catalogDb.query(`SELECT title, description FROM products WHERE id = $1 AND is_active = true`, [sourceProductId]);
        if (!productResult.rows.length) {
            throw { code: -32001, message: 'Product not found' };
        }
        const sourceText = [productResult.rows[0].title, productResult.rows[0].description]
            .filter(Boolean)
            .join(' ')
            .slice(0, 2000);
        let fallbackEmbedding;
        try {
            fallbackEmbedding = await (0, embedProducts_1.embedQuery)(sourceText, geminiKey);
        }
        catch (e) {
            // BUY-70428: distinguish "embedding service failed" (quota/auth/network —
            // actionable) from "product not backfilled yet" so monitoring can tell a
            // data gap from an integration outage.
            const detail = e?.message ? `: ${e.message.slice(0, 120)}` : '';
            throw { code: -32001, message: `Request-time embedding failed for this product${detail}` };
        }
        // Fallback: embed product text and find similar via product_embeddings only
        let nearResult;
        try {
            nearResult = await config_1.vectorDb.query(`SELECT product_id::text AS vector_key, (embedding <=> $1::vector)::float AS distance
           FROM product_embeddings
          WHERE product_id::text != $2
          ORDER BY distance LIMIT $3`, [fallbackEmbedding, sourceProductId, limit]);
        }
        catch {
            nearResult = { rows: [] };
        }
        if (!nearResult.rows.length) {
            throw { code: -32001, message: 'No similar products found' };
        }
        const nearKeys = nearResult.rows.map(r => r.vector_key);
        const nearIds = nearKeys.map(k => parseInt(k, 10)).filter(n => !isNaN(n));
        const detailResult = await config_1.catalogDb.query(`SELECT id::text, title, price, currency, source AS domain, url, image_url
       FROM products WHERE id = ANY($1::bigint[]) AND is_active = true`, [nearIds]);
        const distMap = new Map(nearResult.rows.map(r => [r.vector_key, r.distance]));
        const byKey = new Map(detailResult.rows.map(r => [String(r.id), r]));
        const similar = nearKeys
            .map(key => {
            const p = byKey.get(key);
            if (!p)
                return null;
            const dist = distMap.get(key) ?? 1;
            return {
                id: p.id, title: p.title, price: p.price,
                currency: p.currency, domain: p.domain, url: p.url, image_url: p.image_url,
                similarity: +Math.max(0, 1 - dist).toFixed(4),
            };
        })
            .filter(Boolean);
        return {
            product_id: requestedId, similar,
            total: similar.length,
            response_time_ms: Date.now() - t0,
        };
    }
    const refEmbedding = refResult.rows[0].embedding;
    const vectorKey = refResult.rows[0].vector_key;
    const vectorTable = refResult.rows[0].vector_table;
    let nearResult;
    if (vectorTable === 'search_proof.product_vectors') {
        try {
            // BUY-70113: legacy search_proof vectors live in catalogDb; keep both the
            // reference lookup and nearest-neighbour scan on the same catalog database.
            const nearLimit = config_1.VECTOR_DB_USES_CATALOG_DB ? limit + 1 : limit;
            nearResult = await config_1.catalogDb.query(`SELECT sku AS vector_key, (embedding <=> $1::vector)::float AS distance
           FROM search_proof.product_vectors
          WHERE ($2::text IS NULL OR sku != $2)
          ORDER BY distance LIMIT $3`, [refEmbedding, config_1.VECTOR_DB_USES_CATALOG_DB ? null : vectorKey, nearLimit]);
            if (config_1.VECTOR_DB_USES_CATALOG_DB) {
                nearResult.rows = nearResult.rows.filter(r => r.vector_key !== vectorKey).slice(0, limit);
            }
        }
        catch {
            nearResult = { rows: [] };
        }
    }
    else {
        try {
            nearResult = config_1.vectorDb
                ? await config_1.vectorDb.query(`SELECT product_id::text AS vector_key, (embedding <=> $1::vector)::float AS distance
               FROM product_embeddings
              WHERE product_id::text != $2
              ORDER BY distance LIMIT $3`, [refEmbedding, vectorKey, limit])
                : { rows: [] };
        }
        catch {
            nearResult = { rows: [] };
        }
    }
    if (!nearResult.rows.length) {
        throw { code: -32001, message: 'No similar products found' };
    }
    const nearKeys = nearResult.rows.map(r => r.vector_key);
    const ph = nearKeys.map((_, i) => `$${i + 1}`).join(',');
    // BUY-70113: bind ids as bigint (products_pkey) — `id::text IN (...)` is a
    // catalog-wide Seq Scan and the 30s statement_timeout kills the whole call.
    const detailResult = await config_1.catalogDb.query(vectorTable === 'search_proof.product_vectors'
        ? `SELECT id::text AS id, sku, title, price, currency, source AS domain, url, image_url FROM products WHERE sku IN (${ph}) AND is_active = true`
        : `SELECT id::text AS id, sku, title, price, currency, source AS domain, url, image_url FROM products WHERE id = ANY($1::bigint[]) AND is_active = true`, vectorTable === 'search_proof.product_vectors' ? nearKeys : [nearKeys]);
    const distMap = new Map(nearResult.rows.map(r => [r.vector_key, r.distance]));
    const byKey = new Map(detailResult.rows.map(r => [vectorTable === 'search_proof.product_vectors' ? String(r.sku) : String(r.id), r]));
    const similar = nearKeys
        .map(id => {
        const p = byKey.get(id);
        if (!p)
            return null;
        const dist = distMap.get(id) ?? 1;
        const rowCurrency = p.currency || '';
        const amount = p.price != null ? parseFloat(p.price) : null;
        const formattedPrice = (0, response_1.formatSimilarPriceField)(amount, rowCurrency);
        const isStructured = typeof formattedPrice === 'object';
        return {
            id: p.id,
            sku: p.sku,
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
// BUY-69625: Validate country_code against each tool's supported enum.
// A bogus code (e.g. "ZZ") silently falls through to default-market queries,
// making it impossible to verify the filter was honoured.
const VALID_COUNTRY_CODES = {
    search_products: ['SG', 'US', 'VN', 'TH', 'MY'],
    get_deals: ['SG', 'US', 'VN', 'TH', 'MY'],
    list_categories: ['SG', 'US', 'VN', 'TH', 'MY', 'GB', 'IN', 'AU'],
    find_best_price: ['SG', 'MY', 'TH', 'PH', 'VN', 'ID', 'US'],
};
function validateCountryCode(toolName, args) {
    const allowed = VALID_COUNTRY_CODES[toolName];
    if (!allowed)
        return; // tool doesn't use country_code
    const raw = (args.country_code || args.country || '').toUpperCase();
    if (raw && !allowed.includes(raw)) {
        throw { code: -32602, message: `Country code "${raw}" is not supported by ${toolName}. Supported: ${allowed.join(', ')}`, envelopeCode: 'MARKET_UNSUPPORTED' };
    }
}
function buildToolCallResponse(result) {
    if (result &&
        typeof result === 'object' &&
        Array.isArray(result.content)) {
        return result;
    }
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
}
async function dispatchTool(name, args) {
    validateCountryCode(name, args);
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
// BUY-70000 / BUY-70351: every response (success or error) carries `request_id`
// and a top-level `timestamp` so agent-facing monitoring suites can correlate
// JSON-RPC calls with query_log entries without scraping server logs.
// BUY-70351: `request_id` is always a server-generated UUID for traceability.
// The JSON-RPC `id` is preserved separately for protocol correlation.
// (BUY-70395: commit 8732f31 re-introduced id-passthrough while syncing the
// BUY-70332 FBP fix onto this branch — keep the UUID contract.)
function jsonrpcRequestId(_id) {
    return (0, crypto_1.randomUUID)();
}
function jsonrpcOk(id, result) {
    return { jsonrpc: '2.0', id, request_id: jsonrpcRequestId(id), timestamp: new Date().toISOString(), result };
}
function jsonrpcErr(id, code, message, data, envelopeCode) {
    const errorData = data != null ? { detail: data } : {};
    if (envelopeCode) {
        errorData.envelope = (0, errors_1.buildErrorEnvelope)(envelopeCode, message);
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
    }
    catch (err) {
        const e = err;
        if (typeof e.code === 'number' && e.message) {
            const envelopeCode = e.envelopeCode || (e.code === -32001 ? errors_1.ErrorCode.NOT_FOUND
                : e.code === -32602 ? errors_1.ErrorCode.INVALID_PARAMETER
                    : errors_1.ErrorCode.INTERNAL_ERROR);
            const status = envelopeCode === errors_1.ErrorCode.MARKET_UNSUPPORTED ? 400 : 200;
            return res.status(status).json(jsonrpcErr(id, e.code, e.message, undefined, envelopeCode));
        }
        console.error('[mcp] error:', err);
        return res.json(jsonrpcErr(id, -32603, 'Internal error', undefined, errors_1.ErrorCode.INTERNAL_ERROR));
    }
});
exports.default = router;
