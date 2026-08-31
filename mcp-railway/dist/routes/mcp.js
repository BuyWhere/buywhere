"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const crypto_1 = require("crypto");
const config_1 = require("../config");
// BUY-76535: search_products uses the primary `db` pool (see handler); the
// readReplica servingReadDbConnect() is intentionally no longer referenced here.
const embedProducts_1 = require("../jobs/embedProducts");
const apiKey_1 = require("../middleware/apiKey");
const queryLog_1 = require("../middleware/queryLog");
const errors_1 = require("../middleware/errors");
const response_1 = require("../lib/response");
const deviceClassifier_1 = require("../lib/deviceClassifier");
const instrumentation_1 = require("../lib/instrumentation");
const healthSnapshot_1 = require("../monitoring/healthSnapshot");
const shoppingJobFunnel_1 = require("../monitoring/shoppingJobFunnel");
const cacheStats_1 = require("../monitoring/cacheStats");
// BUY-73521: start funnel writer on module load (idempotent).
(0, shoppingJobFunnel_1.startShoppingJobFunnel)();
// BUY-73521: v2 buyer-context tools that participate in the purchase funnel.
// All have REQUIRED deliver_to per the v2 wire contract (BUY-72533).
const V2_BUYER_TOOLS = new Set([
    'search_products_v2',
    'find_best_price_v2',
    'get_product_v2',
    'compare_products_v2',
    'get_deals_v2',
]);
// BUY-76909: Countries whose standalone child tables answer FTS in <100ms. The
// parent `products` table has 373M rows / 297GB with severe bloat (11M dead
// tuples), so PK-joins and fallback scans against it time out. Route the FBP
// final join + ILIKE fallback to products_partitioned_{cc} for these countries.
const FAST_CHILD_TABLE_COUNTRIES = new Set([
    'SG', 'US', 'MY', 'TH', 'VN', 'PH', 'ID', 'GB', 'CA', 'AU', 'IN', 'IT', 'ES', 'MX',
    'ZA', 'BR', 'NZ', 'NL', 'PL', 'SE', 'CH', 'DK', 'JP', 'DE', 'FR', 'IE', 'NO',
    'BE', 'AT', 'PT',
]);
const router = (0, express_1.Router)();
const MCP_DB_ACQUIRE_TIMEOUT_MS = parseInt(process.env.MCP_DB_ACQUIRE_TIMEOUT_MS || '1000', 10);
// BUY-78767: MCP clients abort well before a 8–30s PG timeout. Bound catalog
// tools to a wall-clock so tools/call always flushes JSON. PG timeout is kept
// slightly under the wall so cancelled queries don't occupy the pool after we
// have already responded. Mirror of api/src/routes/mcp.ts BUY-78735.
const MCP_CATALOG_WALL_MS = parseInt(process.env.MCP_CATALOG_WALL_MS || '3500', 10);
const MCP_CATALOG_STATEMENT_TIMEOUT_MS = Math.max(1000, parseInt(process.env.MCP_CATALOG_STATEMENT_TIMEOUT_MS || String(Math.max(1000, MCP_CATALOG_WALL_MS - 500)), 10));
const MCP_CATALOG_WALL_TOOLS = new Set([
    'search_products',
    'search_products_v2',
    'get_deals',
    'get_deals_v2',
    'find_best_price',
    'find_best_price_v2',
]);
// BUY-75291: per-(q,cc) MCP FTS snapshot TTL. 60s bounds staleness between
// ingestion flushes; ingestion drops fts:* keys as soon as a run lands.
// Override via MCP_FTS_CACHE_TTL_SECONDS env.
const MCP_FTS_CACHE_TTL_SECONDS = parseInt(process.env.MCP_FTS_CACHE_TTL_SECONDS || '60', 10);
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
// BUY-76535: threshold 3 was too low — 15 concurrent MCP probes exhaust the 50-conn pool
// in seconds, causing rapid circuit trips that keep all markets permanently degraded.
// Raised to 10 (enough to absorb a full concurrent probe wave) and cooldown to 120s
// (enough for pool to drain before re-admitting traffic).
const MCP_DEGRADED_CIRCUIT_THRESHOLD = Number(process.env.MCP_DEGRADED_CIRCUIT_THRESHOLD || 10);
const MCP_DEGRADED_CIRCUIT_COOLDOWN_MS = Number(process.env.MCP_DEGRADED_CIRCUIT_COOLDOWN_MS || 120000);
const mcpDegradedCircuitState = new Map();
function mcpCircuitKey(tool, stage, country) {
    return `${tool}:${stage}:${(country || 'GLOBAL').toUpperCase()}`;
}
function isMcpCircuitOpen(tool, stage, country) {
    const state = mcpDegradedCircuitState.get(mcpCircuitKey(tool, stage, country));
    return !!state && state.openedUntil > Date.now();
}
function recordMcpCircuitSuccess(tool, stage, country) {
    mcpDegradedCircuitState.delete(mcpCircuitKey(tool, stage, country));
}
function recordMcpCircuitFailure(tool, stage, country) {
    const key = mcpCircuitKey(tool, stage, country);
    const prev = mcpDegradedCircuitState.get(key) || { failures: 0, openedUntil: 0 };
    const failures = prev.failures + 1;
    mcpDegradedCircuitState.set(key, {
        failures,
        openedUntil: failures >= MCP_DEGRADED_CIRCUIT_THRESHOLD ? Date.now() + MCP_DEGRADED_CIRCUIT_COOLDOWN_MS : prev.openedUntil,
    });
}
function classifyMcpDegradedKind(err) {
    const e = err;
    const message = String(e?.message || '');
    if (e?.code === '57014' || e?.code === '55P03' || message.includes('mcp_db_pool_acquire_timeout') || message.includes('mcp_catalog_wall_timeout') || /timeout/i.test(message))
        return 'timeout';
    if (e?.code === '28P01' || e?.code === '28000' || e?.code === '42501' || /auth|password|permission/i.test(message))
        return 'auth_failure';
    return 'upstream_exception';
}
function buildMcpDegradedSearchResponse(opts) {
    const regionSupported = !opts.country || healthSnapshot_1.SUPPORTED_REGIONS.includes(opts.country.toUpperCase());
    const emptinessReason = opts.kind === 'partial_timeout' ? 'partial_timeout' : (opts.kind === 'timeout' ? 'timeout' : opts.kind === 'auth_failure' ? 'auth_failure' : 'api_error');
    return {
        results: [],
        total: 0,
        page: { limit: opts.limit, offset: opts.offset },
        response_time_ms: opts.responseTimeMs,
        cached: false,
        degraded: true,
        status: 'degraded',
        degraded_kind: opts.kind === 'partial_timeout' ? 'timeout' : opts.kind,
        degraded_reason: opts.stage,
        emptiness_reason: emptinessReason,
        confidence: 'low',
        diagnostic: {
            engine_status: opts.kind === 'auth_failure' ? 'error' : 'degraded',
            indexed_for_region: regionSupported,
            category_recognized: false,
            rate_limit_remaining: null,
            deliver_to_present: opts.deliverToPresent,
            timed_out_stage: opts.stage,
        },
    };
}
function buildMcpDegradedBestPriceResponse(opts) {
    const country = opts.country || 'SG';
    const emptinessReason = opts.kind === 'partial_timeout' ? 'partial_timeout' : (opts.kind === 'timeout' ? 'timeout' : opts.kind === 'auth_failure' ? 'auth_failure' : 'api_error');
    return {
        best_price: null,
        alternatives: [],
        meta: {
            total: 0,
            product_name: opts.productName,
            country_code: country,
            currency: response_1.COUNTRY_CURRENCY[country] || 'SGD',
            response_time_ms: opts.responseTimeMs,
            degraded: true,
            status: 'degraded',
            degraded_kind: opts.kind === 'partial_timeout' ? 'timeout' : opts.kind,
            degraded_reason: opts.stage,
            emptiness_reason: emptinessReason,
            confidence: 'low',
            diagnostic: {
                engine_status: opts.kind === 'auth_failure' ? 'error' : 'degraded',
                indexed_for_region: healthSnapshot_1.SUPPORTED_REGIONS.includes(country.toUpperCase()),
                category_recognized: false,
                rate_limit_remaining: null,
                deliver_to_present: opts.deliverToPresent,
                timed_out_stage: opts.stage,
            },
        },
    };
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
        description: 'Search the BuyWhere product catalog by keyword. Returns schema.org/Product entities with name, description, image, and offers (schema.org/AggregateOffer with lowPrice, highPrice, priceCurrency). Covers e-commerce platforms across Singapore, Malaysia, Indonesia, Thailand, Vietnam, and US. Use compact=true for agent-optimized responses with structured_specs, comparison_attributes, and normalized_price_usd fields. BUY-74597 degraded contract: when the catalog query cannot complete inside the user-facing timeout, this tool returns a 200-OK envelope with `meta.status="degraded"` / `degraded=true`, `emptiness_reason="timeout"` (or `"partial_timeout"` / `"auth_failure"`), `confidence="low"`, and `diagnostic.timed_out_stage` naming the failed stage (catalog_search / offer_aggregation / merchant_join). It never returns an unqualified empty result when the cause is timeout, auth failure, upstream exception, or circuit breaker. Branch on `degraded === true` (or `status === "degraded"`) instead of treating empty `results` as no_match.',
        inputSchema: {
            type: 'object',
            properties: {
                q: { type: 'string', description: 'Keyword search query' },
                // BUY-75287: accept the `query` alias for `q`. Without it, callers
                // passing `query` get 0 rows + the pg_class.reltuples "total"
                // (~364,777,600). Affects mcp.buywhere.ai surface — same root cause as
                // api.buywhere.ai. Re-applies the BUY-68587 / BUY-70288 alias that
                // intervening refactors removed.
                query: { type: 'string', description: 'Alias for q (accepted for agent convenience; use q). Without this, callers passing `query` get 0 rows and the reltuples-derived total — see BUY-75287.' },
                domain: { type: 'string', description: 'Filter by merchant platform (e.g. lazada, shopee, amazon)' },
                region: { type: 'string', description: 'Filter by region (sea, us, eu, au)' },
                country_code: { type: 'string', enum: ['SG', 'US', 'VN', 'TH', 'MY'], description: 'Filter by ISO country code. Also infers default currency for price filters (SG→SGD, US→USD, VN→VND, TH→THB, MY→MYR).' },
                country: { type: 'string', description: 'Alias for country_code (deprecated, use country_code)' },
                market: { type: 'string', description: 'Alias for country_code (deprecated, use country_code).' },
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
        description: 'Get discounted products sorted by discount percentage. Returns schema.org/Product entities with schema.org/Offer properties: price, priceCurrency, availability, originalPrice, and discountPercentage. Covers Singapore, Malaysia, Indonesia, Thailand, Vietnam, and US e-commerce. Supports currency, region (sea, us, eu, au) and country (SG, US, VN, MY, ...) filters. BUY-74597 degraded contract: when the discount-index scan cannot complete inside the user-facing timeout, this tool returns a 200-OK envelope with `meta.status="degraded"` / `degraded=true`, `emptiness_reason="timeout"` (or `"partial_timeout"` / `"auth_failure"`), `confidence="low"`, and `diagnostic.timed_out_stage` (typically `offer_aggregation`). It never returns an unqualified empty result when the cause is timeout, auth failure, upstream exception, or circuit breaker.',
        inputSchema: {
            type: 'object',
            properties: {
                min_discount: { type: 'number', description: 'Minimum discount percentage (default 10)', default: 10 },
                currency: { type: 'string', description: 'Filter by currency code (SGD, USD, MYR, VND, THB). Defaults to SGD.', default: 'SGD' },
                region: { type: 'string', description: 'Filter by region (sea, us, eu, au)' },
                country_code: { type: 'string', enum: ['SG', 'US', 'VN', 'TH', 'MY'], description: 'Filter by ISO country code. Alias: country.' },
                country: { type: 'string', description: 'Alias for country_code (deprecated, use country_code)' },
                market: { type: 'string', description: 'Alias for country_code (deprecated, use country_code).' },
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
                market: { type: 'string', description: 'Alias for country_code (deprecated, use country_code).' },
                region: { type: 'string', description: 'Alias for country_code/market (us→US, sg→SG, my→MY, gb→GB, in→IN, au→AU).' },
            },
        },
    },
    {
        name: 'find_best_price',
        description: 'Use this whenever a user asks about prices, wants to find the cheapest option, or asks "what\'s the best price for X" or "where can I buy X for the lowest price". Returns schema.org/Product entities with schema.org/AggregateOffer (lowPrice, offerCount, priceCurrency) across all merchants. BUY-74597 degraded contract: when the candidates query cannot complete inside the user-facing timeout, this tool returns a 200-OK envelope with `meta.degraded=true`, `meta.status="degraded"`, `meta.emptiness_reason="timeout"` (or `"partial_timeout"` / `"auth_failure"`), `meta.confidence="low"`, and `meta.diagnostic.timed_out_stage="catalog_search"`, with `best_price=null` and `alternatives=[]`. It never returns an unqualified empty result when the cause is timeout, auth failure, upstream exception, or circuit breaker.',
        inputSchema: {
            type: 'object',
            required: ['product_name'],
            properties: {
                product_name: { type: 'string', description: 'Product name to find best price for (e.g., "iphone 15 pro 256gb", "samsung galaxy s24")' },
                q: { type: 'string', description: 'Alias for product_name (deprecated, use product_name).' },
                category: { type: 'string', description: 'Category to filter by (e.g., "electronics", "fashion")' },
                country_code: { type: 'string', enum: ['SG', 'MY', 'TH', 'PH', 'VN', 'ID', 'US'], description: 'Country to search in (defaults to SG). Alias: country.' },
                country: { type: 'string', description: 'Alias for country_code (deprecated, use country_code)' },
                market: { type: 'string', description: 'Alias for country_code (deprecated, use country_code).' },
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
// BUY-72537: v2 tool surface — REQUIRED deliver_to, shopping_job_id, outbound_url resolver.
// Mirrors the api.buywhere.ai/mcp v2 surface so both endpoints expose identical 13-tool manifest.
// v1 stays callable in parallel until 2026-12-31Z (per Reed spec).
const V2_TOOLS = [
    {
        name: 'search_products_v2',
        description: 'REQUIRED deliver_to. Search the BuyWhere product catalog by keyword. The deliver_to parameter is REQUIRED (ISO country code, e.g. "SG", "US") — it takes precedence over country_code/country and prevents all-market scans. Always pass deliver_to="SG" (or your buyer\'s country). Returns schema.org/Product entities with name, description, image, and offers (schema.org/AggregateOffer with lowPrice, highPrice, priceCurrency). Covers e-commerce platforms across Singapore, Malaysia, Indonesia, Thailand, Vietnam, and US. Use compact=true for agent-optimized responses with structured_specs, comparison_attributes, and normalized_price_usd fields.',
        inputSchema: {
            type: 'object',
            required: ['deliver_to'],
            properties: {
                q: { type: 'string', description: 'Keyword search query' },
                // BUY-75287: `query` alias for q — see v1 schema above for rationale.
                query: { type: 'string', description: 'Alias for q (accepted for agent convenience; use q). Without this, callers passing `query` get 0 rows and the reltuples-derived total — see BUY-75287.' },
                domain: { type: 'string', description: 'Filter by merchant platform (e.g. lazada, shopee, amazon)' },
                region: { type: 'string', description: 'Filter by region (sea, us, eu, au)' },
                country_code: { type: 'string', enum: ['SG', 'US', 'VN', 'TH', 'MY'], description: 'Filter by ISO country code. Also infers default currency for price filters (SG→SGD, US→USD, VN→VND, TH→THB, MY→MYR).' },
                deliver_to: { type: 'string', description: 'REQUIRED. Buyer delivery country/market (ISO country code, e.g. "SG", "US").' },
                country: { type: 'string', description: 'Alias for country_code (deprecated, use country_code)' },
                market: { type: 'string', description: 'Alias for country_code (deprecated, use country_code).' },
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
        name: 'get_product_v2',
        description: 'REQUIRED deliver_to. Get a specific product by its ID, including full details and current price. Always pass deliver_to="SG" (or your buyer\'s country). Response includes a resolved outbound_url (https://…) that routes the buyer through the BuyWhere click tracker when the product has merchant offers.',
        inputSchema: {
            type: 'object',
            required: ['id', 'deliver_to'],
            properties: {
                id: { type: 'string', description: 'Product UUID' },
                deliver_to: { type: 'string', description: 'REQUIRED. Buyer delivery country/market (ISO country code, e.g. "SG", "US").' },
            },
        },
    },
    {
        name: 'compare_products_v2',
        description: 'REQUIRED deliver_to. Compare multiple products side-by-side. Always pass deliver_to="SG" (or your buyer\'s country). Returns price, brand, rating, category, and a resolved outbound_url per product for the buyer market.',
        inputSchema: {
            type: 'object',
            required: ['ids', 'deliver_to'],
            properties: {
                ids: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Array of product IDs to compare (2-10)',
                    minItems: 2,
                    maxItems: 10,
                },
                deliver_to: { type: 'string', description: 'REQUIRED. Buyer delivery country/market (ISO country code, e.g. "SG", "US").' },
            },
        },
    },
    {
        name: 'get_deals_v2',
        description: 'REQUIRED deliver_to. Get discounted products sorted by discount percentage. Always pass deliver_to="SG" (or your buyer\'s country). Returns schema.org/Product entities with schema.org/Offer properties: price, priceCurrency, availability, originalPrice, and discountPercentage. Covers Singapore, Malaysia, Indonesia, Thailand, Vietnam, and US e-commerce. Supports currency, region (sea, us, eu, au) and country (SG, US, VN, MY, ...) filters.',
        inputSchema: {
            type: 'object',
            required: ['deliver_to'],
            properties: {
                min_discount: { type: 'number', description: 'Minimum discount percentage (default 10)', default: 10 },
                currency: { type: 'string', description: 'Filter by currency code (SGD, USD, MYR, VND, THB). Defaults to SGD.', default: 'SGD' },
                region: { type: 'string', description: 'Filter by region (sea, us, eu, au)' },
                country_code: { type: 'string', enum: ['SG', 'US', 'VN', 'TH', 'MY'], description: 'Filter by ISO country code. Alias: country.' },
                deliver_to: { type: 'string', description: 'REQUIRED. Buyer delivery country/market (ISO country code, e.g. "SG", "US").' },
                country: { type: 'string', description: 'Alias for country_code (deprecated, use country_code)' },
                market: { type: 'string', description: 'Alias for country_code (deprecated, use country_code).' },
                limit: { type: 'integer', description: 'Number of results (max 100, default 20)', default: 20 },
                offset: { type: 'integer', description: 'Pagination offset', default: 0 },
            },
        },
    },
    {
        name: 'find_best_price_v2',
        description: 'REQUIRED deliver_to. Use this whenever a user asks about prices, wants to find the cheapest option, or asks "what\'s the best price for X" or "where can I buy X for the lowest price". Always pass deliver_to="SG" (or your buyer\'s country). Returns schema.org/Product entities with schema.org/AggregateOffer (lowPrice, offerCount, priceCurrency) across all merchants. Response includes a shopping_job_id (UUID) you can use to resume a multi-merchant price-comparison session for the buyer.',
        inputSchema: {
            type: 'object',
            required: ['deliver_to'],
            properties: {
                q: { type: 'string', description: 'Keyword search query — alias for product_name' },
                product_name: { type: 'string', description: 'Product name to find best price for (e.g., "iphone 15 pro 256gb", "samsung galaxy s24")' },
                category: { type: 'string', description: 'Category to filter by (e.g., "electronics", "fashion")' },
                country_code: { type: 'string', enum: ['SG', 'MY', 'TH', 'PH', 'VN', 'ID', 'US'], description: 'Country to search in (defaults to SG). Alias: country.' },
                deliver_to: { type: 'string', description: 'REQUIRED. Buyer delivery country/market (ISO country code, e.g. "SG", "US").' },
                country: { type: 'string', description: 'Alias for country_code (deprecated, use country_code)' },
                market: { type: 'string', description: 'Alias for country_code (deprecated, use country_code).' },
                region: { type: 'string', enum: ['us', 'sea'], description: 'Region filter - use "us" for United States or "sea" for Southeast Asia' },
            },
        },
    },
];
// Combined surface — v1 + v2 — for tools/list and the GET /mcp info endpoint.
const TOOLS_ALL = [...TOOLS, ...V2_TOOLS];
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
    void args.deliver_to;
    // BUY-75287: accept the `query` alias for `q`. Without this, callers (Atlas
    // cycle 23, agents) passing `query` instead of canonical `q` silently fall
    // into the no-q browse branch: 0 rows plus a pg_class.reltuples "total"
    // (~364,777,600) that looks like fabricated cache data. Same regression was
    // fixed twice before (BUY-68587, BUY-70288) and re-broken by intervening
    // refactors; this re-applies and documents the contract on both handlers.
    const q = (args.q || args.query || '').trim();
    // BUY-78767: default keyword so canonical tools/call search_products matches
    // REST FTS latency. Hybrid/semantic still available when mode is explicit.
    const mode = args.mode || 'keyword';
    const geminiKey = process.env.GEMINI_API_KEY ?? '';
    const useVector = config_1.vectorDb != null && geminiKey !== '' && q !== '' && mode !== 'keyword';
    const domain = args.domain || '';
    const region = args.region || '';
    // country_code is canonical; `country` kept as alias for backward compat
    // BUY-6598: Default to SG for search queries. BUY-31962: skip default for
    // empty-q browse mode — no index on country_code makes filtered scan slow,
    // and recent rows are predominantly US/null so SG filter finds nothing.
    // BUY-73666: deliver_to takes precedence over country_code/country per tool
    // schema contract. Without this, MCP clients passing deliver_to="US" get SG
    // results because the country filter was never applied.
    const rawCountry = ((args.deliver_to || args.country_code || args.country) || '').toUpperCase();
    const hasExplicitCountry = !!(args.deliver_to || args.country_code || args.country);
    const country = rawCountry || (q && !region ? 'SG' : '');
    const category = args.category || '';
    const minPrice = args.min_price != null ? Number(args.min_price) : null;
    const maxPrice = args.max_price != null ? Number(args.max_price) : null;
    const limit = Math.min(Number(args.limit) || 20, 100);
    const offset = Number(args.offset) || 0;
    const compact = args.compact === true;
    const currency = country ? (response_1.COUNTRY_CURRENCY[country] || 'SGD') : 'SGD';
    const deliverToPresent = Boolean((typeof args.deliver_to === 'string' && args.deliver_to.trim() !== '') ||
        (typeof args.country_code === 'string' && args.country_code.trim() !== '') ||
        (typeof args.country === 'string' && args.country.trim() !== ''));
    if (isMcpCircuitOpen('search_products', 'catalog_search', country || null)) {
        return buildMcpDegradedSearchResponse({
            tool: 'search_products',
            stage: 'catalog_search',
            kind: 'circuit_open',
            limit,
            offset,
            responseTimeMs: Date.now() - t0,
            country: country || null,
            deliverToPresent,
        });
    }
    const cacheKey = `fts:${q}:${domain}:${region}:${country}:${category}:${currency}:${minPrice}:${maxPrice}:${limit}:${offset}:${compact ? 'c' : 'f'}:${useVector ? mode : 'kw'}`;
    try {
        const cached = await config_1.redis.get(cacheKey);
        if (cached) {
            const parsed = JSON.parse(cached);
            // BUY-76552: empty arrays are truthy in JS — skip cache for zero-result
            // or degraded responses to prevent cache poisoning that perpetuates
            // transient 0-result outages (cache → serve 0 → cache 0 → …).
            if (parsed.results && parsed.results.length > 0 && !parsed.degraded) {
                // BUY-75411: record cache-hit wall-clock latency so the admin probe
                // can report p95 over the sliding window. Sorted set key shape
                // matches api/src/monitoring/cacheStats.ts exactly.
                await (0, cacheStats_1.recordCacheHitLatency)(config_1.redis, Date.now() - t0);
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
    // BUY-72082: Tier search via search_products partitioned table (97M rows,
    // GIN-indexed, country-partitioned) instead of the 368M-row products table.
    // Drops is_active (tier only contains active products) and category ILIKE
    // (tier category is a slug, not free-text). Uses sp.* prefix to avoid
    // ambiguity when the tier query joins back to products for full columns.
    const tierConditions = [];
    const tierParams = [];
    if (q) {
        tierParams.push(q);
        tierConditions.push(`sp.search_vector @@ plainto_tsquery('english', $${tierParams.length})`);
    }
    if (domain) {
        tierParams.push(domain);
        tierConditions.push(`sp.source = $${tierParams.length}`);
    }
    if (minPrice != null) {
        tierParams.push(minPrice);
        tierConditions.push(`sp.price >= $${tierParams.length}`);
    }
    if (maxPrice != null) {
        tierParams.push(maxPrice);
        tierConditions.push(`sp.price <= $${tierParams.length}`);
    }
    if (region) {
        tierParams.push(region);
        tierConditions.push(`sp.region = $${tierParams.length}`);
    }
    const useChildTable = FAST_CHILD_TABLE_COUNTRIES.has((country || '').toUpperCase());
    const ftsTable = useChildTable
        ? `products_partitioned_${(country || 'SG').toLowerCase()}`
        : 'search_products';
    const detailTable = useChildTable ? ftsTable : 'products';
    // Child tables are already country-partitioned; extra country_code filter
    // on search_products is what forced the slow global GIN recheck.
    if (country && !useChildTable) {
        tierParams.push(country.toUpperCase());
        tierConditions.push(`sp.country_code = $${tierParams.length}`);
    }
    if (useChildTable) {
        tierConditions.push('sp.is_active = true');
    }
    // NOTE: category ILIKE intentionally omitted — search_products has category
    // as a slug; REST tier uses exact match. Add tierParams/tierConditions here
    // if category filtering on the tier becomes needed.
    const tierWhere = tierConditions.length ? `WHERE ${tierConditions.join(' AND ')}` : '';
    let rows;
    let total;
    // BUY-57657: add connect timeout so pool exhaustion fails fast at 2s instead of
    // blocking the entire 12s statement_timeout. The DB itself is fast (70-130ms) so
    // any 8-12s MCP latency is pool-acquisition contention, not query execution.
    // BUY-76535 (SEV-1 2026-08-28, ALL-MARKET): search_products is served from the
    // PRIMARY `db` pool, NOT the read replica. Previously search reads were routed to
    // the replica (REPLICA_DATABASE_URL / servingReadDbConnect / readDb) for load
    // spreading. That routing produced the recurring all-market degraded_envelope
    // (degraded_kind=upstream_exception, degraded_reason=catalog_search): the replica
    // passes the WAL-freshness probe yet does not serve the data interactive search
    // needs — search_products browse returns total=0 (products.reltuples=0) while the
    // primary holds ~365M rows, and FTS fast-fails with upstream_exception on every
    // market. get_deals/find_best_price (primary `db`) stayed healthy throughout,
    // isolating replica routing as the SEV-1 source. The primary search_products tier
    // + GIN FTS path was verified fast (8-650ms). Revisit replicas only after one is
    // provisioned with a populated search_products tier (BUY-76552/BUY-76643).
    const searchClient = await config_1.db.connect();
    // BUY-76552: Named prepared statements prevent 08P01 (parameter-count
    // mismatch). Without explicit names, pg@8 reuses the unnamed "" statement,
    // and consecutive queries with different param counts cause
    // "bind message supplies N parameters but prepared statement requires M".
    // Each query shape gets its own named statement; same shape = same name =
    // server caches the parse. Different param counts get different names.
    let _spQueryCounter = 0;
    function spQuery(sql, values, nameSuffix) {
        return searchClient.query({ text: sql, values, name: `sp_${nameSuffix}` });
    }
    try {
        // BUY-78767: one SET statement_timeout, no BEGIN/SET LOCAL round-trips.
        // Child-table FTS is <10ms; extra SET LOCAL hops were burning the 3.5s wall
        // under pool contention.
        await searchClient.query(`SET statement_timeout = ${MCP_CATALOG_STATEMENT_TIMEOUT_MS}`);
        if (useChildTable) {
            await searchClient.query(`SET enable_seqscan = off`);
        }
        if (q) {
            // BUY-76553: SKIP separate count query — run the main FTS search directly.
            // The COUNT(*) subquery was choosing a slow bitmap plan on the replica (26s+
            // timeout for broad queries like 'laptop', 'phone') while the main FTS CTE
            // query using the same WHERE clause returns results in <250ms. The CTE
            // `WITH cand AS (SELECT ... FROM search_products sp WHERE ... LIMIT 1000)`
            // naturally bounds the scan to 1000 rows and uses the GIN index; the COUNT
            // wrapper forced a different plan that scanned more of the table.
            // We derive total from the search results: if rows.length === COUNT_CAP,
            // total >= COUNT_CAP (capped).
            let queryVec = null;
            if (useVector) {
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
                    // BUY-73859: the vector half of hybrid/semantic search reads the
                    // global product_embeddings index (separate Postgres instance) with
                    // no country scoping. When a buyer country filter is present, FTS
                    // stays scoped to the country via the search_products tier, but the
                    // vector candidates were unrestricted — so SG/MY/TH/VN queries
                    // returned US google_shopping rows interleaved with local results.
                    // Since the embeddings table does not carry country_code (and lives
                    // in a different DB than products), resolve a vector candidate's
                    // country by batch-lookup against the search_products tier (which is
                    // partitioned by country_code) before it can enter the RRF merge or
                    // become an unranked semantic result.
                    async function filterVectorByCountry(vecIds) {
                        if (!country || vecIds.length === 0)
                            return vecIds;
                        const vph = vecIds.map((_, i) => `$${i + 1}`).join(',');
                        const ccRes = await spQuery(`SELECT DISTINCT sp.id FROM search_products sp
               WHERE sp.id IN (${vph}) AND sp.country_code = $${vecIds.length + 1}`, [...vecIds, country], `vecf_${vecIds.length}`);
                        const inCountry = new Set(ccRes.rows.map(r => r.id));
                        return vecIds.filter(id => inCountry.has(id));
                    }
                    if (mode === 'semantic') {
                        // Vector-only: fetch top-N nearest neighbours from vector DB, then fetch details
                        const vecRows = await config_1.vectorDb.query(`SELECT product_id FROM product_embeddings
               ORDER BY embedding <=> $1::vector LIMIT ${Math.min(limit + offset, 200)}`, [queryVec]);
                        const countryFiltered = await filterVectorByCountry(vecRows.rows.map(r => r.product_id));
                        candidateIds = countryFiltered.slice(0, limit + offset);
                    }
                    else {
                        // Hybrid: app-level RRF of FTS ranks + vector ranks
                        const [ftsResult, vecResult] = await Promise.all([
                            // BUY-72082: FTS half of RRF via tier table (GIN-indexed, bounded)
                            spQuery(`SELECT sp.id FROM search_products sp ${tierWhere} LIMIT ${Math.min(limit + offset, 200)}`, tierParams, `tierh_${tierParams.length}`),
                            config_1.vectorDb.query(`SELECT product_id FROM product_embeddings ORDER BY embedding <=> $1::vector LIMIT ${Math.min(limit + offset, 200)}`, [queryVec]),
                        ]);
                        const vecCountryFiltered = await filterVectorByCountry(vecResult.rows.map(r => r.product_id));
                        const ftsRank = new Map(ftsResult.rows.map((r, i) => [r.id, i + 1]));
                        // Note: also drop FTS ids from the country-scoped vector set that the
                        // tier query already excluded (belt-and-suspenders for any id that
                        // slipped a tier partition but is absent from products).
                        const vecRank = new Map(vecCountryFiltered
                            .filter(id => !ftsRank.has(id))
                            .map((id, i) => [id, i + 1]));
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
                        const detailResult = await spQuery(`SELECT id, sku AS source, source AS domain, url, title,
                      price, currency, image_url, metadata, updated_at, region, country_code,
                      url_last_checked_at, url_status
               FROM ${detailTable} WHERE id IN (${ph}) AND is_active = true`, pageIds, `det_p${pageIds.length}`);
                        // Preserve ranking order
                        const byId = new Map(detailResult.rows.map(r => [r.id, r]));
                        rows = pageIds.map(id => byId.get(id)).filter(Boolean);
                    }
                }
                else {
                    // BUY-72082: Embed failed — fall through to tier keyword FTS.
                    // Stage 1: bounded FTS + ranking on search_products tier (GIN-indexed, 97M rows).
                    // Stage 2: full MCP output columns from products via PK lookup (≤limit+offset rows).
                    // BUY-77819: Respect the user's limit parameter instead of hardcoded 200.
                    const pageLimit = Math.min(limit + offset, 200);
                    const cand = await spQuery(`SELECT sp.id FROM ${ftsTable} sp ${tierWhere} LIMIT ${pageLimit}`, tierParams, `fts_idfb${tierParams.length}`);
                    const candIds = cand.rows.map(r => r.id);
                    if (candIds.length === 0) {
                        rows = [];
                        total = 0;
                    }
                    else {
                        const ph = candIds.map((_, i) => `$${i + 1}`).join(',');
                        const detailResult = await spQuery(`SELECT id, sku AS source, source AS domain, url, title, price, currency,
                      image_url, metadata, updated_at, region, country_code, category,
                      category_path, url_last_checked_at, url_status,
                      ts_rank(search_vector, plainto_tsquery('english', $${candIds.length + 1})) AS rank
               FROM ${ftsTable}
               WHERE id IN (${ph})
               ORDER BY rank DESC
               LIMIT ${pageLimit}`, [...candIds, q], `fts_detfb${candIds.length}`);
                        rows = detailResult.rows.slice(offset, offset + limit);
                        total = candIds.length + offset;
                    }
                }
            }
            else {
                // BUY-78767: Keyword FTS returns columns from search_products itself.
                // PK-joining to products (373M) times out; REST tryTierSearch does the same.
                const pageLimit = Math.min(Math.max(limit + offset, 1), 20);
                const tierFts = await searchClient.query(`SELECT sp.id, sp.sku AS source, sp.source AS domain, sp.url, sp.title, sp.price, sp.currency,
                  sp.image_url, sp.metadata, sp.updated_at, sp.region, sp.country_code, sp.category,
                  sp.category_path, sp.url_last_checked_at, sp.url_status
           FROM ${ftsTable} sp ${tierWhere}
           LIMIT ${pageLimit}`, tierParams);
                rows = tierFts.rows.slice(offset, offset + limit);
                total = tierFts.rows.length + offset;
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
            const rawResult = await spQuery(`SELECT id, sku AS source, source AS domain, url, title,
                price, currency, image_url, metadata, updated_at,
                url_last_checked_at, url_status,
                region, country_code
         FROM ${detailTable}
         ORDER BY updated_at DESC
         LIMIT $1`, [fetchLimit], 'browse_raw');
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
        console.log(`[search_products] SUCCESS total=${total} results=${rows?.length} table=${detailTable}`);
        recordMcpCircuitSuccess('search_products', 'catalog_search', country || null);
    }
    catch (err) {
        await searchClient.query('ROLLBACK').catch(() => { });
        // BUY-74597: classify and return the canonical degraded envelope. Never throw
        // an opaque -32603 for catalog timeouts, auth failures, or upstream exceptions.
        const degradedKind = classifyMcpDegradedKind(err);
        recordMcpCircuitFailure('search_products', 'catalog_search', country || null);
        const errMsg = err?.message || String(err);
        const errCode = err?.code || 'none';
        console.warn(`[search_products] BUY-74597: catalog_search degraded (${degradedKind}) — raw error: code=${errCode} msg=${errMsg.slice(0, 200)}`);
        console.warn(`[search_products] DEBUG: tierParams.length=${tierParams.length} tierWhere="${tierWhere}" q="${q}" country="${country}" domain="${domain}" mode="${mode}" useVector=${useVector}`);
        console.warn(`[search_products] DEBUG: full error object:`, JSON.stringify(err).slice(0, 500));
        return buildMcpDegradedSearchResponse({
            tool: 'search_products',
            stage: 'catalog_search',
            kind: degradedKind,
            limit,
            offset,
            responseTimeMs: Date.now() - t0,
            country: country || null,
            deliverToPresent,
        });
    }
    finally {
        // BUY-56185: always use safe release to discard connections poisoned by statement_timeout
        releaseClientSafely(searchClient);
    }
    const products = rows.map(r => (0, response_1.buildProduct)(r, currency, compact));
    const result = (0, response_1.buildSearchResponse)(products, total, limit, offset, Date.now() - t0, false);
    if (q && products.length === 0) {
        // BUY-73908: stamp emptiness_reason onto the canonical envelope so v2
        // callers see the same diagnostic the REST path emits. Use any cast
        // to bypass the missing-index-signature error on SearchResponse.
        result.meta = { ...result.meta, emptiness_reason: 'no_match' };
    }
    try {
        await config_1.redis.set(cacheKey, JSON.stringify(result), 'EX', MCP_FTS_CACHE_TTL_SECONDS);
    }
    catch (_) { /* cache write failure is non-fatal */ }
    // F24 (2026-08-22): nudge agents that skipped deliver_to — added after the
    // cache write so the cached envelope stays neutral.
    if (!args.deliver_to) {
        result.hint =
            'Treat deliver_to as REQUIRED for buyer-facing use: pass deliver_to=<ISO-3166 country of your end user> to shipping-rank results; without it products may be undeliverable.';
    }
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
              avg_rating AS rating, review_count, metadata, updated_at, region, country_code,
              url_last_checked_at, url_status
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
    const placeholders = validIds.map((_, i) => `$${i + 1}`).join(',');
    let result;
    try {
        result = await config_1.db.query(`SELECT id, sku AS source, source AS domain, url, title,
              price, currency, image_url, brand, category_path,
              avg_rating AS rating, review_count, metadata, updated_at, region, country_code,
              url_last_checked_at, url_status
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
    const deliverToPresent = Boolean(typeof args.deliver_to === 'string' && args.deliver_to.trim() !== '');
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
    if (isMcpCircuitOpen('get_deals', 'offer_aggregation', country || null)) {
        return buildMcpDegradedSearchResponse({
            tool: 'get_deals',
            stage: 'offer_aggregation',
            kind: 'circuit_open',
            limit,
            offset,
            responseTimeMs: Date.now() - t0,
            country: country || null,
            deliverToPresent,
        });
    }
    const cacheKey = `deals_mcp:${currency}:${minDiscount}:${region}:${country}:${(args.category || '').trim()}:${limit}:${offset}`;
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
    // BUY-77178: category filter — BUY-77834 fix
    // The prior `LOWER(category) = $N` exact-match against the single text column
    // never matched slug-style input like "home_and_kitchen" / "sports_and_outdoors"
    // / "video_games" — those names don't exist verbatim in `category`. The index
    // walk then burned the full 30s statement_timeout returning 0 rows and surfaced
    // category_recognized:false to agents. Mirroring search_products: keep the SQL
    // WHERE untouched (so the deals index walk is bounded), and apply the category
    // filter as a post-fetch ILIKE on the bounded candidate set against both
    // `category` text AND `category_path[1]`. LIKE wildcards make slug input
    // ("home_and_kitchen") still match real names like "home & kitchen".
    const category = (args.category || '').trim();
    const categoryLower = category.toLowerCase();
    const discountSelect = useDiscountCol
        ? 'discount_pct'
        : `ROUND(((1 - price / NULLIF((metadata->>'original_price')::numeric, 0)) * 100)::numeric, 1) AS discount_pct`;
    const whereClause = conditions.join(' AND ');
    // BUY-64112: strict discount-first query only. The prior recent-window sample
    // + laptop/watch fallback returned keyword rows with discount_pct=0 and hid
    // real discounted products. Query the indexed discount predicate directly.
    let dealsClient = null;
    let products = [];
    let total = 0;
    try {
        dealsClient = await acquireMcpClient();
        await dealsClient.query(`SET statement_timeout = ${MCP_CATALOG_STATEMENT_TIMEOUT_MS}`); // BUY-78767: wall-clock fail-fast; 30s hung tools/call 0-byte.
        await dealsClient.query('SET enable_seqscan = off'); // BUY-68615: force index path on production catalog DB
        // BUY-69340 + BUY-69646 merged (2026-08-15): walk the deals index IN ORDER
        // (currency, discount_pct DESC) so the response is the TRUE top discounts —
        // the unordered 10K candidate walk could miss the best deals entirely and
        // shipped 10K full rows (metadata jsonb) to Node per call (27-30s observed
        // under replica load). The ordered walk early-stops at candidateLimit
        // PASSING rows (same worst case as the unordered walk when filters are
        // selective), candidates are id-thin, and full rows join only for the
        // returned page. updated_at tiebreak preserved in SQL.
        // BUY-77834 fix: widen the candidate walk when a category filter is present —
        // the post-fetch filter only sees the candidate set.
        const candidateLimit = categoryLower ? 20000 : 2000;
        const candidateParams = [...params, candidateLimit];
        const dataResult = await dealsClient.query(`WITH cand AS (
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
              p.url_last_checked_at, p.url_status,
              p.discount_pct,
              p.category, p.category_path
       FROM cand JOIN products p ON p.id = cand.id
       ORDER BY cand.cand_discount DESC, cand.cand_updated DESC
       LIMIT ${categoryLower ? 1000 : limit} OFFSET ${categoryLower ? 0 : offset}`, candidateParams);
        total = dataResult.rows.length;
        // BUY-77834: post-fetch category filter on the bounded candidate set. SQL
        // WHERE was kept category-free so the (currency, discount_pct DESC) index
        // walk stays bounded. Match caller input against `category` text AND
        // `category_path[1]` so slug-style names ("home_and_kitchen") still match
        // real names ("Home & Kitchen" via category_path[1] — list_categories feeds
        // from this column on SG). LIKE wildcard gives a forgiving match.
        if (categoryLower) {
            const rawRows = dataResult.rows;
            const matched = rawRows.filter((r) => {
                const catText = (r.category || '').toLowerCase();
                const catPath = (r.category_path || [])
                    .map((v) => String(v).toLowerCase())
                    .join(' ');
                return catText.includes(categoryLower) || catPath.includes(categoryLower);
            });
            products = matched.slice(offset, offset + limit).map((r) => (0, response_1.buildProduct)(r, currency, false));
            total = matched.length;
        }
        else {
            products = dataResult.rows.map((r) => (0, response_1.buildProduct)(r, currency, false));
        }
        recordMcpCircuitSuccess('get_deals', 'offer_aggregation', country || null);
    }
    catch (err) {
        const degradedKind = classifyMcpDegradedKind(err);
        recordMcpCircuitFailure('get_deals', 'offer_aggregation', country || null);
        console.warn(`[get_deals] BUY-74597: offer_aggregation degraded (${degradedKind}) — returning MCP degraded envelope`);
        return buildMcpDegradedSearchResponse({
            tool: 'get_deals',
            stage: 'offer_aggregation',
            kind: degradedKind,
            limit,
            offset,
            responseTimeMs: Date.now() - t0,
            country: country || null,
            deliverToPresent,
        });
    }
    finally {
        // BUY-56185: discard connections poisoned by statement_timeout
        if (dealsClient)
            releaseClientSafely(dealsClient);
    }
    const result = (0, response_1.buildSearchResponse)(products, total, limit, offset, Date.now() - t0, false);
    // BUY-60076: surface `unavailable:true` when the strict + regional fallback
    // returned zero rows, mirroring api/src/routes/mcp.ts so callers can
    // distinguish "no live deals" from "server bug".
    if ((region || country) && products.length === 0) {
        result.unavailable = true;
    }
    // BUY-77834: surface the category_recognized signal when the caller passed
    // a category filter. The post-fetch filter is now bounded (no more 30s walks),
    // so we can reliably report whether the category had ANY rows.
    if (categoryLower && products.length === 0) {
        result.meta = {
            ...(result.meta || {}),
            emptiness_reason: 'category_unsupported',
            confidence: 'low',
            diagnostic: {
                category_recognized: false,
                timed_out_stage: null,
            },
        };
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
            const meta = {
                total: rows.length,
                country_code: country,
                response_time_ms: 0,
                cached: false,
            };
            meta.unavailable = false;
            // BUY-71112: expose both `categories` (canonical) and `data` (legacy)
            // so callers expecting either key keep working. Bug was: returning only
            // `data` matched the legacy envelope but broke consumers reading
            // `result.categories`. Pinned the live MCP probe evidence: SG/TH/VN
            // returned `{data:[...100 items...], meta}` with no `categories` key.
            const data = { categories: rows, data: rows, meta };
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
// BUY-76206: normalize find_best_price product queries before they reach
// plainto_tsquery / buildDeviceFilter. Strips trailing price/shipping/store
// noise and collapses whitespace so ranking is driven by the product noun,
// not spurious lexemes (mirrors the queryPreprocessor the search_products
// path uses). Kept inline here to avoid a cross-tree import; the full
// queryPreprocessor port is tracked under BUY-76206.
const FBP_NOISE_TERMS = [
    'price', 'prices', 'cheap', 'cheapest', 'best', 'buy', 'preorder', 'pre-order',
    'official', 'original', 'genuine', 'sale', 'deal', 'discount', 'ship', 'shipping',
    'free ship', 'in stock', 'stock', 'new', 'warranty', 'sg', 'singapore', 'store',
    'shop', 'online', 'fast', 'delivery', 'near me',
    '$', 's$', 'us$', 'rm', '฿', '₫', 'php', 'idr',
];
function normalizeFbpQuery(raw) {
    // Strip currency/cents sequences ("S$199", "US$50", "฿30,000", "30,000") first so the
    // currency letter doesn't linger as an orphan token. Use a conservative 4+ digit
    // price/year drop only; short model digits ("15", "s24", "ps5") are product identity
    // and must be preserved.
    let q = raw.toLowerCase()
        .replace(/\b(?:s|us|rm)?[$฿₫]\s?\d{1,3}(?:,\d{3})*\.?\d*\b/g, ' ')
        .replace(/[$฿₫]/g, ' ')
        .replace(/[^\p{L}\p{N}\s-]/gu, ' ');
    for (const t of FBP_NOISE_TERMS) {
        q = q.replace(new RegExp(`\\b${t.replace(/[$฿₫]/g, '\\$&')}\\b`, 'g'), ' ');
    }
    // Drop leftover standalone year/price-like tokens (2026, 30000); never bare 1-3
    // digit model tags.
    q = q.split(' ').filter(tok => !/^\d{4,}$/.test(tok)).join(' ');
    return q.replace(/\s+/g, ' ').trim();
}
async function handleFindBestPrice(args) {
    const t0 = Date.now();
    void args.deliver_to;
    const deliverToPresent = Boolean((typeof args.deliver_to === 'string' && args.deliver_to.trim() !== '') ||
        (typeof args.country_code === 'string' && args.country_code.trim() !== '') ||
        (typeof args.country === 'string' && args.country.trim() !== ''));
    const productName = (args.product_name || args.q || '').trim();
    if (!productName)
        throw { code: -32602, message: 'product_name is required' };
    const country = ((args.country_code || args.country) || 'SG').toUpperCase();
    const region = args.region || '';
    const category = args.category || '';
    const limit = 10;
    // BUY-76206: rank on a noise-stripped query; keep the raw productName for the
    // response envelope and the title-ILIKE fallback (which needs the full string).
    const searchName = normalizeFbpQuery(productName) || productName;
    // BUY-67522: infer exact device-family queries and reject accessory results.
    const deviceFilter = (0, deviceClassifier_1.buildDeviceFilter)(searchName, country);
    if (isMcpCircuitOpen('find_best_price', 'catalog_search', country || null)) {
        return buildMcpDegradedBestPriceResponse({
            productName,
            country,
            responseTimeMs: Date.now() - t0,
            kind: 'circuit_open',
            stage: 'catalog_search',
            deliverToPresent,
        });
    }
    const CANDIDATE_POOL = Math.max(limit * 50, 500);
    // BUY-72082: Tier search via search_products partitioned table (97M rows,
    // GIN-indexed, country-partitioned) instead of the 368M-row products table.
    // Stage 1 selects candidate ids + price + updated_at from the tier; stage 2
    // joins back to products by PK for the full MCP output columns. This mirrors
    // the search_products fix and avoids the full-table FTS scans that push FBP
    // over the 30s statement_timeout across SEA markets.
    const tierConditions = [];
    const tierParams = [];
    // BUY-76206: FTS on the noise-stripped query (searchName) instead of the raw string.
    tierParams.push(searchName);
    tierConditions.push(`sp.search_vector @@ plainto_tsquery('english', $${tierParams.length})`);
    if (region) {
        tierParams.push(region);
        tierConditions.push(`sp.region = $${tierParams.length}`);
    }
    if (category) {
        tierParams.push(`%${category}%`);
        tierConditions.push(`sp.category ILIKE $${tierParams.length}`);
    }
    // BUY-67522: for exact device queries, enforce a floor that accessories cannot satisfy.
    if (deviceFilter.minLocal > 0) {
        tierParams.push(deviceFilter.minLocal);
        tierConditions.push(`sp.price >= $${tierParams.length}`);
    }
    // BUY-76909: route candidates AND hydration to the country child table when one
    // exists. The products parent (373M rows / 297GB, 11M dead tuples) times out PK
    // joins even with indexes, and search_products ids do not overlap child-table ids
    // for recent ingest (verified live), so cross-tier joins return 0 rows. The child
    // table has a GIN index on search_vector and (post-BUY-77453 DDL) a btree on (id)
    // — the full query answers in ~15ms.
    const requestedCountry = country || (region.toLowerCase() === 'us' ? 'US' : 'SG');
    const useChildTable = FAST_CHILD_TABLE_COUNTRIES.has(requestedCountry);
    const tierTable = useChildTable ? `products_partitioned_${requestedCountry.toLowerCase()}` : 'search_products';
    const tbl = useChildTable ? `products_partitioned_${requestedCountry.toLowerCase()}` : 'products';
    if (!useChildTable && country) {
        tierParams.push(country);
        tierConditions.push(`sp.country_code = $${tierParams.length}`);
    }
    const tierWhere = tierConditions.length ? `WHERE ${tierConditions.join(' AND ')}` : '';
    // BUY-31962: same subquery pattern as search_products — fetch candidates via GIN
    // index (no sort), then ORDER BY price ASC on the small candidate set. Avoids the
    // O(N log N) full-sort that causes the 10s/30s timeout on large FTS result sets.
    // BUY-76206 (2026-08-27): rank relevant products FIRST (ts_rank DESC), then price ASC.
    // The previous pure price-ASC order let a cheap accessory that merely shared a
    // lexeme win ("laptop stand" → $ backpack), producing wrong/empty FBP results.
    // ts_rank runs on the FTS-matched candidate window only, so the GIN scan is unchanged
    // and the sort stays bounded (CANDIDATE_POOL).
    // BUY-69626: add a bounded title-ILIKE fallback that scans recent market-local rows
    // when FTS misses sparse/stale search_vector entries, instead of returning nothing.
    const bestPriceClient = await acquireMcpClient();
    let result;
    try {
        await bestPriceClient.query(`SET statement_timeout = ${MCP_CATALOG_STATEMENT_TIMEOUT_MS}`); // BUY-78767: wall-clock fail-fast
        await bestPriceClient.query('SET enable_seqscan = off'); // BUY-76212: force GIN index plan; without this, planner picks seq scan on SG partition (largest) and times out at 25s
        tierParams.push(CANDIDATE_POOL, limit);
        result = await bestPriceClient.query(`WITH cand AS (
         SELECT sp.id, sp.price, sp.updated_at, sp.title,
                ts_rank(sp.search_vector, plainto_tsquery('english', $1)) AS rk
         FROM ${tierTable} sp ${tierWhere}
         LIMIT $${tierParams.length - 1}
       ), page_ids AS (
         SELECT id, price, updated_at, rk
         FROM cand
         ORDER BY (CASE WHEN title ~* '(replacement|repair|ear ?pad|earpad|cushion|protector|charger|cable|adapter|strap|skin|decal|sticker|holder|mount|assembly)' THEN 1 ELSE 0 END) ASC,
                  rk DESC NULLS LAST,
                  (CASE WHEN price BETWEEN 5 AND 10000 THEN price END) ASC NULLS LAST,
                  updated_at DESC
         LIMIT $${tierParams.length}
       )
       SELECT p.id, p.title, p.price, p.currency, p.source AS domain, p.url, p.image_url,
              p.country_code, p.updated_at, p.category, p.category_path, p.metadata,
              p.url_last_checked_at, p.url_status
       FROM page_ids pi
       JOIN ${tbl} p ON p.id = pi.id
       WHERE p.is_active = true
       ORDER BY (CASE WHEN pi.price BETWEEN 5 AND 10000 THEN pi.price END) ASC NULLS LAST, pi.updated_at DESC`, tierParams);
        // BUY-69626: FTS returned nothing — try bounded title-ILIKE on recent market slice
        if (result.rows.length === 0) {
            await bestPriceClient.query('SET statement_timeout = 4500');
            const titlePattern = `%${productName}%`;
            // requestedCountry already declared above for BUY-76909 child-table routing
            const minPrice = deviceFilter.minLocal > 0 ? deviceFilter.minLocal : 0;
            result = await bestPriceClient.query(`SELECT * FROM (
           SELECT id, title, price, currency, source AS domain, url, image_url,
                  country_code, updated_at, category, category_path, metadata
           FROM ${tbl}
           WHERE is_active = true AND price > 0
             AND country_code = $1
             ${minPrice > 0 ? `AND price >= $${4}` : ''}
           ORDER BY updated_at DESC
           LIMIT $${minPrice > 0 ? 3 : 2}
         ) _recent
         WHERE title ILIKE $${minPrice > 0 ? 3 : 2}
         ${category ? `AND category ILIKE $${minPrice > 0 ? 5 : 4}` : ''}
         ORDER BY (CASE WHEN price BETWEEN 5 AND 10000 THEN price END) ASC NULLS LAST
         LIMIT $${minPrice > 0 ? (category ? 6 : 5) : (category ? 4 : 3)}`, minPrice > 0
                ? (category ? [requestedCountry, CANDIDATE_POOL, titlePattern, minPrice, `%${category}%`] : [requestedCountry, CANDIDATE_POOL, titlePattern, minPrice])
                : (category ? [requestedCountry, CANDIDATE_POOL, titlePattern, `%${category}%`] : [requestedCountry, CANDIDATE_POOL, titlePattern]));
        }
        recordMcpCircuitSuccess('find_best_price', 'catalog_search', country || null);
    }
    catch (err) {
        const degradedKind = classifyMcpDegradedKind(err);
        recordMcpCircuitFailure('find_best_price', 'catalog_search', country || null);
        console.warn(`[find_best_price] BUY-74597: catalog_search degraded (${degradedKind}) — returning MCP degraded envelope`);
        return buildMcpDegradedBestPriceResponse({
            productName,
            country,
            responseTimeMs: Date.now() - t0,
            kind: degradedKind,
            stage: 'catalog_search',
            deliverToPresent,
        });
    }
    finally {
        // BUY-56185: discard connections poisoned by statement_timeout
        releaseClientSafely(bestPriceClient);
    }
    const currency = response_1.COUNTRY_CURRENCY[country] || 'SGD';
    const toUsd = response_1.CURRENCY_RATES[currency] ?? 1;
    const neg = deviceFilter.negativeTerms;
    const ACCESSORY_PATTERN = /\b(replacement|repair|ear ?pads?|earpads?|cushions?|protective|protector|silicone|cover|case|sleeve|pouch|charger|charging|cable|adapter|strap|band|skin|decal|sticker|holder|mount|stand|assembly|spare parts?|compatible with|for use with|kit)\b/i;
    const isAccessory = (r) => {
        if (ACCESSORY_PATTERN.test(String(r.title ?? '')))
            return true;
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
    // BUY-76206: if ALL results are accessories, fall back to the unfiltered set
    // rather than returning empty. The SQL found products; returning nothing is
    // worse than returning accessories (the user can refine the query).
    const filteredAccessories = result.rows.filter(r => !isAccessory(r));
    const candidates = filteredAccessories.length > 0 ? filteredAccessories : result.rows;
    const data = candidates.map((r) => ({
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
            // BUY-75411: MCP /search_products uses fts:* keys; prior ingestion
            // paths only busted products:* + search:*, so per-(q,cc) snapshots
            // survived reindexes indefinitely. Clear the FTS namespace on success.
            const ftsKeys = await config_1.redis.keys('fts:*');
            if (ftsKeys.length > 0)
                await config_1.redis.del(...ftsKeys);
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
    const refResult = await config_1.vectorDb.query(`SELECT embedding::text FROM product_embeddings WHERE product_id = $1`, [productId]);
    if (!refResult.rows.length) {
        throw { code: -32001, message: 'No embedding found for this product — backfill may still be running' };
    }
    const refEmbedding = refResult.rows[0].embedding;
    // Step 2: find nearest neighbours in vector DB (excluding source product)
    const nearResult = await config_1.vectorDb.query(`SELECT product_id, (embedding <=> $1::vector)::float AS distance
     FROM product_embeddings WHERE product_id != $2
     ORDER BY distance LIMIT $3`, [refEmbedding, productId, limit]);
    if (!nearResult.rows.length) {
        throw { code: -32001, message: 'No similar products found' };
    }
    // Step 3: fetch product details from main DB
    const nearIds = nearResult.rows.map(r => r.product_id);
    const ph = nearIds.map((_, i) => `$${i + 1}`).join(',');
    const detailResult = await config_1.db.query(`SELECT id, title, price, currency, source AS domain, url, image_url
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
// BUY-69625: Validate country_code against each tool's supported enum.
// BUY-73666: `market` is a common agent alias for `country_code`. When agents pass
// market=MY it was silently ignored because no handler read args.market, causing
// every non-SG query to fall through to the SG default. Normalize once at
// dispatch time so all downstream handlers see country_code set correctly.
const MARKET_TO_COUNTRY = {
    sg: "SG", us: "US", my: "MY", th: "TH", vn: "VN",
    gb: "GB", uk: "GB", in: "IN", au: "AU", ph: "PH", id: "ID",
};
function normalizeMarketArg(args) {
    const market = (args.market || "").trim();
    if (!market)
        return;
    const mapped = MARKET_TO_COUNTRY[market.toLowerCase()] || market.toUpperCase();
    if (!args.country_code && !args.country) {
        args.country_code = mapped;
    }
}
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
    const raw = (args.country_code || args.country || args.market || '').toUpperCase();
    if (raw && !allowed.includes(raw)) {
        throw { code: -32602, message: `Country code "${raw}" is not supported by ${toolName}. Supported: ${allowed.join(', ')}`, envelopeCode: 'MARKET_UNSUPPORTED' };
    }
}
// 2026-08-30: same alias normalisation as the api tree, so both hosts accept the same
// argument spellings (query/q/product_name, id/product_id, ids/product_ids).
function normalizeToolArgAliases(args) {
    const alias = (from, to) => {
        if (args[to] === undefined && args[from] !== undefined)
            args[to] = args[from];
    };
    alias('query', 'q');
    alias('q', 'query');
    alias('q', 'product_name');
    alias('product_name', 'q');
    alias('product_id', 'id');
    alias('id', 'product_id');
    alias('product_ids', 'ids');
    alias('ids', 'product_ids');
}
function mcpCatalogWallEnvelope(name, args, startedAt) {
    const country = String((args.deliver_to || args.country_code || args.country || 'SG')).toUpperCase();
    const limit = Math.min(Number(args.limit) || 20, 100);
    const offset = Number(args.offset) || 0;
    const deliverToPresent = Boolean((typeof args.deliver_to === 'string' && args.deliver_to.trim() !== '') ||
        (typeof args.country_code === 'string' && args.country_code.trim() !== '') ||
        (typeof args.country === 'string' && args.country.trim() !== ''));
    const responseTimeMs = Date.now() - startedAt;
    if (name.startsWith('find_best_price')) {
        recordMcpCircuitFailure('find_best_price', 'catalog_search', country);
        return buildMcpDegradedBestPriceResponse({
            productName: String((args.product_name || args.q || args.query || '')),
            country,
            responseTimeMs,
            kind: 'timeout',
            stage: 'catalog_search',
            deliverToPresent,
        });
    }
    const tool = name.startsWith('get_deals') ? 'get_deals' : 'search_products';
    const stage = name.startsWith('get_deals') ? 'offer_aggregation' : 'catalog_search';
    recordMcpCircuitFailure(tool, stage, country);
    return buildMcpDegradedSearchResponse({
        tool,
        stage,
        kind: 'timeout',
        limit,
        offset,
        responseTimeMs,
        country,
        deliverToPresent,
    });
}
async function withMcpCatalogWall(name, args, work) {
    if (!MCP_CATALOG_WALL_TOOLS.has(name))
        return work();
    const startedAt = Date.now();
    let timer;
    const wall = new Promise((_, reject) => {
        timer = setTimeout(() => reject(Object.assign(new Error('mcp_catalog_wall_timeout'), { code: '57014' })), MCP_CATALOG_WALL_MS);
    });
    try {
        return await Promise.race([work(), wall]);
    }
    catch (err) {
        const message = String(err?.message || '');
        if (message.includes('mcp_catalog_wall_timeout')) {
            console.warn(`[mcp] BUY-78767: ${name} hit ${MCP_CATALOG_WALL_MS}ms catalog wall — flushing degraded envelope`);
            return mcpCatalogWallEnvelope(name, args, startedAt);
        }
        throw err;
    }
    finally {
        if (timer)
            clearTimeout(timer);
    }
}
async function dispatchTool(name, args) {
    normalizeMarketArg(args);
    normalizeToolArgAliases(args);
    validateCountryCode(name, args);
    return withMcpCatalogWall(name, args, async () => {
        switch (name) {
            case 'search_products': return handleSearchProducts(args);
            case 'get_product': return handleGetProduct(args);
            case 'compare_products': return handleCompareProducts(args);
            case 'get_deals': return handleGetDeals(args);
            case 'list_categories': return handleListCategories(args);
            case 'find_best_price': return handleFindBestPrice(args);
            case 'ingest_products': return handleIngestProducts(args);
            case 'find_similar': return handleFindSimilar(args);
            case 'search_products_v2': return handleSearchProductsV2(args);
            case 'get_product_v2': return handleGetProductV2(args);
            case 'compare_products_v2': return handleCompareProductsV2(args);
            case 'get_deals_v2': return handleGetDealsV2(args);
            case 'find_best_price_v2': return handleFindBestPriceV2(args);
            default:
                throw { code: -32601, message: `Unknown tool: ${name}` };
        }
    });
}
// BUY-72537: v2 surface — REQUIRED deliver_to, plus v2-specific response fields.
// v2 validates `deliver_to` is present (rejects with -32602 INVALID_ARGUMENT otherwise),
// then delegates to the v1 handler with the same args (v1 logic is unchanged).
// v2-specific extras:
//   - find_best_price_v2: response includes `shopping_job_id` (UUID)
//   - get_product_v2 + compare_products_v2: response includes `outbound_url` per product
// BUY-72700: Set of valid ISO 3166-1 alpha-2 codes that BuyWhere supports for deliver_to.
// When an unknown code (e.g. "ZZ") is passed, v2 tools must return 200 OK with empty
// results and meta.emptiness_reason="invalid_deliver_to" — NOT a JSON-RPC error.
const VALID_DELIVER_TO = new Set([
    'SG', 'US', 'VN', 'TH', 'MY', 'GB', 'IN', 'AU', 'PH', 'ID',
]);
function requireDeliverTo(args, toolName) {
    const raw = args.deliver_to;
    const value = typeof raw === 'string' ? raw.trim() : '';
    if (!value) {
        throw { code: -32602, message: `${toolName} requires deliver_to (ISO country code, e.g. "SG", "US")` };
    }
    // Normalise to uppercase for downstream handlers.
    const normalised = value.toUpperCase();
    // BUY-72700: reject non-ISO-alpha-2 (e.g. "USA", "123", " sg ") and unknown codes (e.g. "ZZ").
    if (!/^[A-Z]{2}$/.test(normalised) || !VALID_DELIVER_TO.has(normalised)) {
        throw { code: 'INVALID_DELIVER_TO', toolName, raw: normalised };
    }
    args.deliver_to = normalised;
    return normalised;
}
// BUY-73952: deliver_to default inference — v2 callers that supply country_code
// (or its alias `country`) but omit deliver_to still get shipping-ranked results.
// Mirrors the REST contract in routes/products.ts: set deliver_to = country_code
// when missing, and let the caller distinguish the inferred case via meta.deliver_to_inferred.
// Returns true when inference happened so the wrapper can stamp the flag in response.meta.
function inferDeliverTo(args) {
    const existing = typeof args.deliver_to === 'string' ? args.deliver_to.trim() : '';
    if (existing)
        return false;
    const cc = typeof args.country_code === 'string' ? args.country_code.trim() : '';
    const countryAlias = typeof args.country === 'string' ? args.country.trim() : '';
    const source = cc || countryAlias;
    if (!source)
        return false;
    // BUY-73952: per parent spec, deliver_to defaults to country_code verbatim.
    // requireDeliverTo will reject unsupported / non-ISO-alpha-2 codes with the
    // structured INVALID_DELIVER_TO envelope (BUY-72700) rather than missing-deliver_to.
    args.deliver_to = source.toUpperCase();
    return true;
}
// BUY-72700: Build a 200-OK response with empty results and meta.emptiness_reason.
function buildInvalidDeliverToResponse(toolName, rawDeliverTo) {
    return {
        data: [],
        products: [],
        results: [],
        items: [],
        meta: {
            total: 0,
            limit: 0,
            offset: 0,
            response_time_ms: 0,
            cached: false,
            emptiness_reason: 'invalid_deliver_to',
            deliver_to: rawDeliverTo,
            hint: `deliver_to="${rawDeliverTo}" is not a supported country code. Supported: ${Array.from(VALID_DELIVER_TO).join(', ')}.`,
        },
    };
}
async function handleSearchProductsV2(args) {
    let deliverTo;
    let inferred = false;
    try {
        // BUY-73952: infer deliver_to from country_code/country when omitted.
        inferred = inferDeliverTo(args);
        deliverTo = requireDeliverTo(args, 'search_products_v2');
    }
    catch (e) {
        if (e?.code === 'INVALID_DELIVER_TO') {
            return buildInvalidDeliverToResponse('search_products_v2', e.raw);
        }
        throw e;
    }
    args.country_code = deliverTo;
    const result = await handleSearchProducts(args);
    applyNoMatchMeta(result);
    // BUY-73952: stamp meta.deliver_to_inferred when defaulting happened.
    if (inferred && result && typeof result === 'object' && result.meta && typeof result.meta === 'object') {
        result.meta.deliver_to_inferred = true;
    }
    return result;
}
function applyNoMatchMeta(response) {
    if (!response || typeof response !== 'object')
        return;
    const meta = response.meta && typeof response.meta === 'object'
        ? response.meta
        : (response.meta = {});
    if (meta.emptiness_reason)
        return;
    const dataCount = Array.isArray(response.data) ? response.data.length : null;
    const productsCount = Array.isArray(response.products) ? response.products.length : null;
    const resultsCount = Array.isArray(response.results) ? response.results.length : null;
    const itemsCount = Array.isArray(response.items) ? response.items.length : null;
    const bestPriceCount = response.best_price ? 1 : 0;
    const alternativesCount = Array.isArray(response.alternatives) ? response.alternatives.length : 0;
    const total = typeof meta.total === 'number' ? meta.total : Number(meta.total ?? NaN);
    if (total === 0 || dataCount === 0 || productsCount === 0 || resultsCount === 0 || itemsCount === 0 || (response.best_price === null && alternativesCount === 0 && !dataCount && !productsCount && !resultsCount && !itemsCount)) {
        meta.emptiness_reason = 'no_match';
        if (!Number.isFinite(total))
            meta.total = bestPriceCount + alternativesCount;
    }
}
async function handleGetDealsV2(args) {
    let deliverTo;
    let inferred = false;
    try {
        // BUY-73952: infer deliver_to from country_code/country when omitted.
        inferred = inferDeliverTo(args);
        deliverTo = requireDeliverTo(args, 'get_deals_v2');
    }
    catch (e) {
        if (e?.code === 'INVALID_DELIVER_TO') {
            return buildInvalidDeliverToResponse('get_deals_v2', e.raw);
        }
        throw e;
    }
    args.country_code = deliverTo;
    const result = await handleGetDeals(args);
    applyNoMatchMeta(result);
    // BUY-73952: stamp meta.deliver_to_inferred when defaulting happened.
    if (inferred && result && typeof result === 'object' && result.meta && typeof result.meta === 'object') {
        result.meta.deliver_to_inferred = true;
    }
    return result;
}
async function handleCompareProductsV2(args) {
    let deliverTo;
    let inferred = false;
    try {
        // BUY-73952: infer deliver_to from country_code/country when omitted.
        inferred = inferDeliverTo(args);
        deliverTo = requireDeliverTo(args, 'compare_products_v2');
    }
    catch (e) {
        if (e?.code === 'INVALID_DELIVER_TO') {
            return buildInvalidDeliverToResponse('compare_products_v2', e.raw);
        }
        throw e;
    }
    args.country_code = deliverTo;
    const result = await handleCompareProducts(args);
    applyNoMatchMeta(result);
    // BUY-73952: stamp meta.deliver_to_inferred when defaulting happened.
    if (inferred && result && typeof result === 'object' && result.meta && typeof result.meta === 'object') {
        result.meta.deliver_to_inferred = true;
    }
    attachOutboundUrls(result);
    return result;
}
async function handleFindBestPriceV2(args) {
    let deliverTo;
    let inferred = false;
    try {
        // BUY-73952: infer deliver_to from country_code/country when omitted.
        inferred = inferDeliverTo(args);
        deliverTo = requireDeliverTo(args, 'find_best_price_v2');
    }
    catch (e) {
        if (e?.code === 'INVALID_DELIVER_TO') {
            return buildInvalidDeliverToResponse('find_best_price_v2', e.raw);
        }
        throw e;
    }
    args.country_code = deliverTo;
    const result = await handleFindBestPrice(args);
    applyNoMatchMeta(result);
    // BUY-73952: stamp meta.deliver_to_inferred when defaulting happened.
    if (inferred && result && typeof result === 'object' && result.meta && typeof result.meta === 'object') {
        result.meta.deliver_to_inferred = true;
    }
    attachShoppingJobId(result, args);
    return result;
}
async function handleGetProductV2(args) {
    let deliverTo;
    let inferred = false;
    try {
        // BUY-73952: infer deliver_to from country_code/country when omitted.
        inferred = inferDeliverTo(args);
        deliverTo = requireDeliverTo(args, 'get_product_v2');
    }
    catch (e) {
        if (e?.code === 'INVALID_DELIVER_TO') {
            return buildInvalidDeliverToResponse('get_product_v2', e.raw);
        }
        throw e;
    }
    args.country_code = deliverTo;
    const result = await handleGetProduct(args);
    applyNoMatchMeta(result);
    // BUY-73952: stamp meta.deliver_to_inferred when defaulting happened.
    if (inferred && result && typeof result === 'object' && result.meta && typeof result.meta === 'object') {
        result.meta.deliver_to_inferred = true;
    }
    attachOutboundUrls(result);
    return result;
}
// Resolve `outbound_url` (https://…) for every product in a v2 response that carries one.
function attachOutboundUrls(response) {
    const products = response?.results;
    if (!Array.isArray(products))
        return;
    for (const product of products) {
        if (!product || typeof product !== 'object')
            continue;
        const url = typeof product.url === 'string' ? product.url : '';
        const merchant = typeof product.merchant === 'string' ? product.merchant : null;
        const productId = typeof product.id === 'string' ? product.id : null;
        if (!url || !productId)
            continue;
        product.outbound_url = (0, instrumentation_1.buildClickUrl)({
            productId,
            destinationUrl: url,
            merchantId: merchant,
        });
    }
}
// Attach a shopping_job_id (UUID) to find_best_price_v2 responses. Deterministic v5 over
// (product_name, deliver_to, country) so retries return the same id; randomUUID fallback.
function attachShoppingJobId(response, args) {
    const productName = String(args.product_name || args.q || '').trim();
    const deliverTo = String(args.deliver_to || '').trim().toUpperCase();
    const country = String(args.country_code || args.country || '').trim().toUpperCase();
    const sessionKey = productName && deliverTo
        ? `${productName.toLowerCase()}|${deliverTo}|${country}`
        : '';
    if (sessionKey) {
        try {
            response.shopping_job_id = uuidV5(sessionKey, V2_SHOPPING_NAMESPACE);
        }
        catch {
            response.shopping_job_id = (0, crypto_1.randomUUID)();
        }
    }
    else {
        response.shopping_job_id = (0, crypto_1.randomUUID)();
    }
    response.shopping_session_key = sessionKey || null;
}
const V2_SHOPPING_NAMESPACE = 'c0d4f1a3-2b51-4d8e-9f10-buywhere-v2-shopping';
function uuidV5(name, namespace) {
    const nsBytes = parseUuidBytes(namespace);
    const nameBytes = new Uint8Array(Buffer.from(name, 'utf8'));
    const combined = new Uint8Array(nsBytes.length + nameBytes.length);
    combined.set(nsBytes, 0);
    combined.set(nameBytes, nsBytes.length);
    const hash = (0, crypto_1.createHash)('sha1').update(combined).digest();
    const bytes = new Uint8Array(hash.buffer, hash.byteOffset, 16);
    bytes[6] = (bytes[6] & 0x0f) | 0x50; // version 5
    bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10
    let hex = '';
    for (let i = 0; i < 16; i++)
        hex += bytes[i].toString(16).padStart(2, '0');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}
function parseUuidBytes(uuid) {
    const hex = uuid.replace(/-/g, '');
    if (hex.length !== 32)
        throw new Error('invalid namespace uuid');
    const out = new Uint8Array(16);
    for (let i = 0; i < 16; i++)
        out[i] = parseInt(hex.substr(i * 2, 2), 16);
    return out;
}
// JSON-RPC 2.0 response helpers
// BUY-70000 / BUY-70351: every response (success or error) carries `request_id`
// and a top-level `timestamp` so agent-facing monitoring suites can correlate
// JSON-RPC calls with query_log entries without scraping server logs.
// BUY-70351: `request_id` is always a server-generated UUID for traceability.
// The JSON-RPC `id` is preserved separately for protocol correlation.
function jsonrpcRequestId(_id) {
    return (0, crypto_1.randomUUID)();
}
function jsonrpcOk(id, result) {
    // JSON-RPC 2.0 allows only jsonrpc/id/result|error at the top level; extra keys make
    // the official MCP Inspector and strict clients reject the response (2026-08-29).
    return { jsonrpc: '2.0', id, result };
}
function jsonrpcErr(id, code, message, data, envelopeCode) {
    const errorData = data != null ? { detail: data } : {};
    if (envelopeCode) {
        errorData.envelope = (0, errors_1.buildErrorEnvelope)(envelopeCode, message);
    }
    return {
        jsonrpc: '2.0',
        id,
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
// BUY-69817: Helper to extract a normalised region from tool args. Falls back to SG.
function extractRegion(toolArgs) {
    const raw = (toolArgs.deliver_to
        || toolArgs.country_code
        || toolArgs.country
        || toolArgs.region
        || 'SG').toString().trim().toUpperCase();
    const REGION_TO_COUNTRY = {
        SG: 'SG', US: 'US', MY: 'MY', TH: 'TH', VN: 'VN',
        PH: 'PH', ID: 'ID', GB: 'GB', IN: 'IN', AU: 'AU',
        SEA: 'SG',
    };
    const normalised = REGION_TO_COUNTRY[raw] || raw;
    return healthSnapshot_1.SUPPORTED_REGIONS.includes(normalised)
        ? normalised
        : 'SG';
}
// GET /mcp/health — public health surface.
// Backward-compatible: returns status/server/ts/catalog keys plus
// the new per-tool/per-region breakdown (BUY-69817).
router.get('/health', async (_req, res) => {
    try {
        const [countResult, pong] = await Promise.all([
            config_1.db.query(`SELECT reltuples::bigint AS count FROM pg_class WHERE relname = 'products'`),
            config_1.redis.ping(),
        ]);
        const catalogTotal = parseInt(countResult.rows[0]?.count ?? '0', 10);
        // 503 only if the snapshotter itself cannot produce ANY data.
        // Degraded status (per-tool/per-region breakdown) is a 200 — agents
        // need the signal, not an error.
        let snapshot;
        try {
            snapshot = (0, healthSnapshot_1.computeSnapshot)();
        }
        catch (_snapErr) {
            // Failure-open — return stale snapshot, never 5xx.
            snapshot = { status: 'ok', server: 'mcp', ts: new Date().toISOString(), tools: {}, regions: {}, catalog: { total_products: catalogTotal } };
        }
        // BUY-69817: X-BuyWhere-Degraded-Regions header so in-flight tool calls
        // can self-correct before hitting a timeout.
        const degradedRegions = (0, healthSnapshot_1.getDegradedRegions)();
        if (degradedRegions.length > 0) {
            res.set('X-BuyWhere-Degraded-Regions', degradedRegions.join(','));
        }
        // BUY-69817: slo section — p95_current_ms is the max across all tools.
        // availability_* (30d aggregate) requires query_log data; tracked separately.
        const toolP95s = Object.values(snapshot.tools)
            .map(t => t.p95_ms)
            .filter((p) => p !== null);
        const p95CurrentMs = toolP95s.length > 0 ? Math.max(...toolP95s) : null;
        res.json({
            ...snapshot,
            slo: {
                window: '5m',
                p95_target_ms: healthSnapshot_1.P95_TARGET_MS,
                p95_current_ms: p95CurrentMs,
            },
            catalog: { total_products: catalogTotal },
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
// GET /mcp/health/tools — per-tool p50/p95/error rate breakdown.
router.get('/health/tools', async (_req, res) => {
    try {
        const snapshot = (0, healthSnapshot_1.computeSnapshot)();
        res.json({
            status: snapshot.status,
            server: 'mcp',
            ts: snapshot.ts,
            tools: snapshot.tools,
        });
    }
    catch (err) {
        // Failure-open: empty toolset is still 200 with last-known snapshot.
        res.status(200).json({
            status: 'ok',
            server: 'mcp',
            ts: new Date().toISOString(),
            tools: {},
            note: 'snapshotter degraded',
        });
    }
});
// GET /mcp/health/regions — per-region status with degraded-tool list.
router.get('/health/regions', async (_req, res) => {
    try {
        const snapshot = (0, healthSnapshot_1.computeSnapshot)();
        res.json({
            status: snapshot.status,
            server: 'mcp',
            ts: snapshot.ts,
            regions: snapshot.regions,
        });
    }
    catch (err) {
        res.status(200).json({
            status: 'ok',
            server: 'mcp',
            ts: new Date().toISOString(),
            regions: {},
            note: 'snapshotter degraded',
        });
    }
});
// GET /mcp/health/cache_hit_latency — BUY-75411 MCP search_products cache-hit p95.
// Public and cheap: reads Redis sorted-set samples only; no DB query.
router.get('/health/cache_hit_latency', async (req, res) => {
    const windowParam = Number(req.query.window ?? 3600);
    const windowSeconds = Number.isFinite(windowParam) && windowParam > 0 && windowParam <= 7 * 24 * 3600
        ? Math.floor(windowParam)
        : 3600;
    const ttlSeconds = MCP_FTS_CACHE_TTL_SECONDS;
    try {
        const latency = await (0, cacheStats_1.readCacheHitLatencyPercentiles)(config_1.redis, windowSeconds);
        const p95 = latency.p95_ms ?? null;
        res.json({
            window_seconds: latency.window_seconds ?? windowSeconds,
            sample_count: latency.sample_count ?? 0,
            p50_ms: latency.p50_ms ?? null,
            p95_ms: p95,
            p99_ms: latency.p99_ms ?? null,
            max_ms: latency.max_ms ?? null,
            buckets_considered: latency.buckets_considered ?? 0,
            cache_ttl_seconds: ttlSeconds,
            available: latency.available === true,
            reason: latency.reason ?? null,
            threshold_ms: 200,
            passes_p95_under_200ms: p95 !== null && p95 <= 200,
            probe_note: 'MCP search_products cache-hit latency samples from Redis sorted set qembed:fts:cache_hit:60:<bucket>',
            ts: new Date().toISOString(),
        });
    }
    catch (err) {
        res.status(500).json({ error: 'mcp_cache_hit_latency_failed', message: err.message });
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
        tools: TOOLS_ALL.map(t => t.name),
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
        return res.json(jsonrpcOk(id, { tools: TOOLS_ALL }));
    }
    return next();
});
// BUY-77590/BUY-77744: authenticated MCP JSON-RPC handler for POST /mcp.
async function handleMcpAuthenticated(req, res) {
    const body = req.body;
    // Validate JSON-RPC envelope
    if (!body || body.jsonrpc !== '2.0' || !body.method) {
        res.status(400).json(jsonrpcErr(body?.id ?? null, -32600, 'Invalid JSON-RPC request', undefined, errors_1.ErrorCode.INVALID_JSON));
        return;
    }
    const { id, method, params } = body;
    const args = (params && typeof params === 'object' && !Array.isArray(params)) ? params : {};
    // BUY-69817: record tool calls into the in-memory health snapshotter and
    // set the X-BuyWhere-Degraded-Regions header so in-flight agents can
    // self-correct. Recording is fire-and-forget and never throws.
    let _toolName;
    let _toolArgs = {};
    let _startMs = Date.now();
    // Set degraded-region headers on every response so agents always see them,
    // including on validation errors. Both names are kept: spec uses singular,
    // initial shipped implementation exposed the plural header.
    const degradedRegionsHeader = (0, healthSnapshot_1.getDegradedRegions)().join(',') || '';
    res.setHeader('X-BuyWhere-Degraded-Region', degradedRegionsHeader);
    res.setHeader('X-BuyWhere-Degraded-Regions', degradedRegionsHeader);
    try {
        switch (method) {
            case 'tools/call': {
                const toolName = args.name;
                const toolArgs = (args.arguments && typeof args.arguments === 'object') ? args.arguments : {};
                if (!toolName) {
                    res.json(jsonrpcErr(id, -32602, 'Missing tool name'));
                    return;
                }
                // BUY-22733: surface tool name to queryLog middleware so the finish
                // handler emits `mcp_tool_call` (with tool_name) instead of `api_query`.
                res.locals.mcpToolName = toolName;
                _toolName = toolName;
                _toolArgs = toolArgs;
                _startMs = Date.now();
                // BUY-73521: extract raw API key for funnel tracking (hashed, never stored raw)
                const rawApiKey = req.apiKeyRecord?.key;
                // BUY-73521: resolve shopping_job_id — client-supplied or server-minted.
                let funnelJobId;
                let funnelIsReplay = false;
                if (V2_BUYER_TOOLS.has(toolName)) {
                    const clientJobId = args.shopping_job_id
                        ?? args.job_id
                        ?? null;
                    const resolved = (0, shoppingJobFunnel_1.resolveShoppingJobId)(clientJobId, toolArgs);
                    funnelJobId = resolved.jobId;
                    funnelIsReplay = resolved.isReplay;
                    (0, shoppingJobFunnel_1.recordJobCreated)({
                        shoppingJobId: funnelJobId,
                        isReplay: funnelIsReplay,
                        toolName,
                        args: toolArgs,
                        apiKey: rawApiKey,
                    });
                }
                const result = await dispatchTool(toolName, toolArgs);
                try {
                    (0, healthSnapshot_1.recordToolCall)({
                        tool: toolName,
                        region: extractRegion(toolArgs),
                        latency_ms: Date.now() - _startMs,
                        error: false,
                    });
                }
                catch { }
                // BUY-73521: record downstream funnel stages from the result.
                // Only fire each stage if the result actually contains that stage's data.
                if (funnelJobId) {
                    const productIds = (0, shoppingJobFunnel_1.extractProductIds)(result);
                    const offerUrlPresent = (0, shoppingJobFunnel_1.hasOutboundUrl)(result);
                    try {
                        // product_resolved: at least one product id in response
                        if (productIds.length > 0) {
                            (0, shoppingJobFunnel_1.recordProductResolved)({ shoppingJobId: funnelJobId, toolName, args: toolArgs, apiKey: rawApiKey, result });
                        }
                        // executable_offer_found: merchant + (price available or offer url)
                        if (productIds.length > 0 && offerUrlPresent) {
                            (0, shoppingJobFunnel_1.recordExecutableOfferFound)({ shoppingJobId: funnelJobId, toolName, args: toolArgs, apiKey: rawApiKey, result });
                        }
                        // outbound_link_returned: outbound_url present
                        if (offerUrlPresent) {
                            (0, shoppingJobFunnel_1.recordOutboundLinkReturned)({ shoppingJobId: funnelJobId, toolName, args: toolArgs, apiKey: rawApiKey, result });
                        }
                    }
                    catch (e) {
                        console.warn('[mcp][funnel] record error:', e);
                    }
                }
                // BUY-73521: inject shopping_job_id into the response JSON so callers
                // can continue the session without re-supplying it.
                if (funnelJobId && result && typeof result === 'object') {
                    result.shopping_job_id = funnelJobId;
                }
                res.json(jsonrpcOk(id, {
                    content: [{ type: 'text', text: JSON.stringify(result) }],
                }));
                return;
            }
            // BUY-68192: backward compatibility for direct tool-name JSON-RPC methods
            // (e.g., "search_products", "list_categories"). Some MCP clients and
            // heartbeat probes invoke tools by name instead of wrapping them in the
            // MCP "tools/call" envelope. Route known tool names to dispatchTool.
            default: {
                const knownTool = TOOLS_ALL.find((t) => t.name === method);
                if (knownTool) {
                    res.locals.mcpToolName = method;
                    _toolName = method;
                    _toolArgs = args;
                    _startMs = Date.now();
                    const result = await dispatchTool(method, args);
                    try {
                        (0, healthSnapshot_1.recordToolCall)({
                            tool: method,
                            region: extractRegion(args),
                            latency_ms: Date.now() - _startMs,
                            error: false,
                        });
                    }
                    catch { }
                    res.json(jsonrpcOk(id, {
                        content: [{ type: 'text', text: JSON.stringify(result) }],
                    }));
                    return;
                }
                res.json(jsonrpcErr(id, -32601, `Method not found: ${method}`));
                return;
            }
        }
    }
    catch (err) {
        if (_toolName) {
            try {
                (0, healthSnapshot_1.recordToolCall)({
                    tool: _toolName,
                    region: extractRegion(_toolArgs),
                    latency_ms: Date.now() - _startMs,
                    error: true,
                });
            }
            catch { }
        }
        const e = err;
        if (typeof e.code === 'number' && e.message) {
            const envelopeCode = e.envelopeCode || (e.code === -32001 ? errors_1.ErrorCode.NOT_FOUND
                : e.code === -32602 ? errors_1.ErrorCode.INVALID_PARAMETER
                    : errors_1.ErrorCode.INTERNAL_ERROR);
            const status = envelopeCode === errors_1.ErrorCode.MARKET_UNSUPPORTED ? 400 : 200;
            res.status(status).json(jsonrpcErr(id, e.code, e.message, undefined, envelopeCode));
            return;
        }
        console.error('[mcp] error:', err);
        res.json(jsonrpcErr(id, -32603, 'Internal error', undefined, errors_1.ErrorCode.INTERNAL_ERROR));
    }
}
// POST /mcp — authenticated methods: tools/call (and any future additions)
router.post('/', apiKey_1.requireApiKey, apiKey_1.checkRateLimit, (0, queryLog_1.queryLogMiddleware)('mcp'), handleMcpAuthenticated);
exports.default = router;
