"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const config_1 = require("../config");
const router = (0, express_1.Router)();
// GET /.well-known/ai-plugin.json — MCP/OpenAI plugin discovery
router.get('/ai-plugin.json', (_req, res) => {
    res.json({
        schema_version: 'v1',
        name_for_human: 'BuyWhere Product Catalog',
        name_for_model: 'buywhere_catalog',
        description_for_human: 'Cross-border product catalog for AI agents. Search 1.5M+ products across Shopee, Lazada, Amazon, Walmart, and 20+ retailers in Singapore, US, and Southeast Asia.',
        description_for_model: 'Use this plugin to search the BuyWhere product catalog for AI agents. Search by keyword, filter by merchant/retailer, price range, country, and currency (SGD, USD, VND, THB, MYR). Compare prices across merchants, find deals, and browse categories. Register for a free API key at https://api.buywhere.ai/v1/auth/register.',
        auth: {
            type: 'user_http',
            authorization_type: 'bearer',
        },
        api: {
            type: 'openapi',
            url: `${config_1.API_BASE_URL}/openapi.json`,
            is_user_authenticated: true,
        },
        logo_url: 'https://buywhere.ai/favicon.svg',
        contact_email: 'api@buywhere.ai',
        legal_info_url: 'https://buywhere.ai/terms',
    });
});
// GET /.well-known/mcp.json — MCP server discovery manifest
router.get('/mcp.json', (_req, res) => {
    res.json({
        name: 'BuyWhere Product Catalog',
        description: "Structured product catalog and price comparison API for AI agents. Real-time pricing from Singapore's major e-commerce platforms.",
        version: '0.1.0',
        mcp_endpoint: 'https://api.buywhere.ai/mcp',
        documentation: 'https://api.buywhere.ai/docs/guides/mcp',
        capabilities: ['search_products', 'get_product', 'compare_products', 'get_deals', 'list_categories', 'find_best_price', 'resolve_product_query'],
        coverage: 'Singapore',
        data_freshness: 'real-time',
    });
});
// GET /.well-known/api-catalog — API contract discovery metadata for monitors
router.get('/api-catalog', (_req, res) => {
    res.json({
        name: 'BuyWhere API',
        version: '1.0',
        description: 'Structured product catalog and price comparison API with REST + MCP interfaces.',
        base_url: `${config_1.API_BASE_URL}`,
        endpoints: {
            rest: `${config_1.API_BASE_URL}/v1/products`,
            openapi: `${config_1.API_BASE_URL}/openapi.json`,
            mcp: `${config_1.API_BASE_URL}/mcp`,
            health: `${config_1.API_BASE_URL}/health`,
            docs: `${config_1.API_BASE_URL}/docs/guides/mcp`,
        },
        updated_at: new Date().toISOString(),
    });
});
// GET /.well-known/glama.json — Glama.ai agent discovery manifest
router.get('/glama.json', (_req, res) => {
    res.json({
        "$schema": "https://glama.ai/mcp/schemas/connector.json",
        name: "buywhere",
        display_name: "BuyWhere",
        description: "Agent-native product catalog API. Search 1.5M+ products across Shopee, Lazada, Amazon, Walmart, and 20+ e-commerce platforms. Compare prices, find deals, browse categories.",
        icon_url: "https://buywhere.ai/assets/icon.png",
        public_repository: true,
        homepage_url: "https://buywhere.ai",
        repository_url: "https://github.com/BuyWhere/buywhere",
        server: {
            transport: "stdio",
            command: "npx",
            args: ["@buywhere/mcp-server"],
            env: {
                BUYWHERE_API_KEY: {
                    description: "BuyWhere API key",
                    required: true,
                },
                BUYWHERE_API_URL: {
                    description: "API base URL",
                    default: "https://api.buywhere.ai",
                },
            },
        },
        maintainers: [{ email: "api@buywhere.ai" }],
        tools: [
            { name: "search_products", description: "Full-text search across 1.5M+ products from 20+ e-commerce platforms" },
            { name: "get_product", description: "Get full product details by BuyWhere product ID" },
            { name: "compare_prices", description: "Compare prices for a product across all platforms" },
            { name: "get_deals", description: "Find products with active discounts" },
            { name: "browse_categories", description: "Browse the product category taxonomy tree" },
            { name: "get_category_products", description: "Get products within a specific category" },
        ],
        categories: ["shopping", "e-commerce", "price-comparison"],
        regions: ["SG", "US", "MY", "TH", "PH", "VN", "ID"],
    });
});
// GET /openapi.json — OpenAPI 3.0 spec
router.get('/openapi.json', (_req, res) => {
    res.json({
        openapi: '3.0.0',
        info: {
            title: 'BuyWhere Product Catalog API',
            version: '1',
            description: 'Agent-native product catalog API for Southeast Asia and US commerce. Search 1.5M+ products across Shopee, Lazada, Amazon, Walmart, FairPrice, Carousell, and 20+ e-commerce platforms. Compare prices, discover deals, and find best prices through REST or MCP.',
        },
        servers: [{ url: `${config_1.API_BASE_URL}/v1` }],
        paths: {
            '/auth/register': {
                post: {
                    summary: 'Register an agent and receive an API key',
                    operationId: 'registerAgent',
                    requestBody: {
                        required: true,
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    required: ['agent_name'],
                                    properties: {
                                        agent_name: { type: 'string', description: 'Name or identifier of your agent' },
                                        contact: { type: 'string', description: 'Contact email (optional)' },
                                        use_case: { type: 'string', description: 'Brief description of your use case' },
                                    },
                                },
                            },
                        },
                    },
                    responses: {
                        '201': {
                            description: 'API key issued',
                            content: {
                                'application/json': {
                                    schema: {
                                        type: 'object',
                                        properties: {
                                            api_key: { type: 'string' },
                                            tier: { type: 'string' },
                                            rate_limit: {
                                                type: 'object',
                                                properties: {
                                                    rpm: { type: 'integer' },
                                                    daily: { type: 'integer' },
                                                },
                                            },
                                        },
                                    },
                                },
                            },
                        },
                    },
                },
            },
            '/products/search': {
                get: {
                    summary: 'Search products by keyword with full-text search',
                    operationId: 'searchProducts',
                    security: [{ BearerAuth: [] }],
                    parameters: [
                        { name: 'q', in: 'query', schema: { type: 'string' }, description: 'Keyword search query (full-text)' },
                        { name: 'domain', in: 'query', schema: { type: 'string' }, description: 'Filter by merchant platform (e.g. lazada, shopee)' },
                        { name: 'region', in: 'query', schema: { type: 'string' }, description: 'Filter by region (sea, us, eu, au)' },
                        { name: 'country_code', in: 'query', schema: { type: 'string', enum: ['SG', 'US', 'VN', 'TH', 'MY'] }, description: 'Filter by ISO country code. When provided without an explicit `currency` param, the default currency is inferred (SG→SGD, US→USD, VN→VND, TH→THB, MY→MYR). `min_price`/`max_price` apply in the inferred currency. Default: SG.' },
                        { name: 'min_price', in: 'query', schema: { type: 'number' }, description: 'Minimum price in the active currency (inferred from country_code or explicit currency param)' },
                        { name: 'max_price', in: 'query', schema: { type: 'number' }, description: 'Maximum price in the active currency (inferred from country_code or explicit currency param)' },
                        { name: 'currency', in: 'query', schema: { type: 'string', default: 'SGD' }, description: 'Explicit currency override. If omitted and country_code is set, currency is inferred from country_code.' },
                        { name: 'compact', in: 'query', schema: { type: 'boolean', default: false }, description: 'Return minimal payload for AI agents (id, title, price, currency, url, specs)' },
                        { name: 'limit', in: 'query', schema: { type: 'integer', default: 20, maximum: 100 } },
                        { name: 'offset', in: 'query', schema: { type: 'integer', default: 0 } },
                    ],
                    responses: {
                        '200': { description: 'Product list with meta (total, response_time_ms, cached)' },
                        '401': { description: 'Missing or invalid API key' },
                        '429': { description: 'Rate limit exceeded' },
                    },
                },
            },
            '/products/deals': {
                get: {
                    summary: 'Get discounted products sorted by discount percentage',
                    operationId: 'getDeals',
                    security: [{ BearerAuth: [] }],
                    parameters: [
                        { name: 'currency', in: 'query', schema: { type: 'string', default: 'SGD' } },
                        { name: 'country_code', in: 'query', schema: { type: 'string', enum: ['SG', 'US', 'VN', 'TH', 'MY'] }, description: 'Filter by ISO country code. When set, only deals from that country are returned.' },
                        { name: 'min_discount', in: 'query', schema: { type: 'number', default: 10 }, description: 'Minimum discount percentage (0-90)' },
                        { name: 'limit', in: 'query', schema: { type: 'integer', default: 20, maximum: 100 } },
                        { name: 'offset', in: 'query', schema: { type: 'integer', default: 0 } },
                    ],
                    responses: {
                        '200': { description: 'Discounted products with price, original_price, and discount_pct' },
                        '401': { description: 'Missing or invalid API key' },
                    },
                },
            },
            '/products/compare': {
                get: {
                    summary: 'Compare multiple products side-by-side',
                    operationId: 'compareProducts',
                    security: [{ BearerAuth: [] }],
                    parameters: [
                        { name: 'ids', in: 'query', required: true, schema: { type: 'string' }, description: 'Comma-separated product IDs (2-10)' },
                    ],
                    responses: {
                        '200': { description: 'Array of products with price, brand, rating, category_path' },
                        '400': { description: 'Fewer than 2 IDs provided' },
                        '401': { description: 'Missing or invalid API key' },
                    },
                },
            },
            '/products/{id}': {
                get: {
                    summary: 'Get a product by ID',
                    operationId: 'getProduct',
                    security: [{ BearerAuth: [] }],
                    parameters: [
                        { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
                    ],
                    responses: {
                        '200': { description: 'Product detail' },
                        '404': { description: 'Product not found' },
                    },
                },
            },
            '/products/{id}/prices': {
                get: {
                    summary: 'Get price history for a product',
                    operationId: 'getProductPrices',
                    security: [{ BearerAuth: [] }],
                    parameters: [
                        { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
                        { name: 'days', in: 'query', schema: { type: 'integer', default: 30, maximum: 90 }, description: 'Look-back window in days' },
                    ],
                    responses: {
                        '200': { description: 'Price history with min/max/avg stats' },
                        '404': { description: 'Product not found' },
                    },
                },
            },
            '/categories': {
                get: {
                    summary: 'List top-level product categories',
                    operationId: 'listCategories',
                    security: [{ BearerAuth: [] }],
                    parameters: [
                        { name: 'currency', in: 'query', schema: { type: 'string', default: 'SGD' } },
                    ],
                    responses: {
                        '200': { description: 'Category list with slug, name, and product_count' },
                    },
                },
            },
            '/categories/{slug}': {
                get: {
                    summary: 'Get products within a category',
                    operationId: 'getCategoryProducts',
                    security: [{ BearerAuth: [] }],
                    parameters: [
                        { name: 'slug', in: 'path', required: true, schema: { type: 'string' }, description: 'Category slug (from /categories)' },
                        { name: 'currency', in: 'query', schema: { type: 'string', default: 'SGD' } },
                        { name: 'limit', in: 'query', schema: { type: 'integer', default: 20, maximum: 100 } },
                        { name: 'offset', in: 'query', schema: { type: 'integer', default: 0 } },
                    ],
                    responses: {
                        '200': { description: 'Category detail with subcategories and products' },
                        '404': { description: 'Category not found' },
                    },
                },
            },
        },
        components: {
            securitySchemes: {
                BearerAuth: { type: 'http', scheme: 'bearer' },
            },
        },
    });
});
// GET /.well-known/mcp/server-card.json — Smithery skip-scan card
// Allows Smithery.ai to catalogue the server without a live endpoint scan.
// Ref: https://smithery.ai/docs/build/publish#troubleshooting
router.get('/mcp/server-card.json', (_req, res) => {
    res.json({
        serverInfo: {
            name: 'BuyWhere Product Catalog',
            version: '1.0.0',
        },
        description: "Agent-native product catalog API for Southeast Asia and US commerce. Search 1.5M+ products across Shopee, Lazada, Amazon SG, Amazon US, Walmart, Carousell, FairPrice, Harvey Norman, and 20+ e-commerce platforms. Compare prices across merchants, discover deals, browse categories, find best prices — all through a single MCP endpoint.",
        contact: { email: 'api@buywhere.ai', url: 'https://buywhere.ai' },
        license: 'MIT',
        servers: [
            {
                url: 'https://api.buywhere.ai/mcp',
                description: 'Production MCP endpoint (Streamable HTTP + SSE)',
                transport: ['streamable-http', 'sse'],
            },
        ],
        tools: [
            { name: 'search_products', description: 'Full-text product search with price, category, merchant, region, and rating filters across 1.5M+ products from 20+ e-commerce platforms. Supports multiple currencies and compact JSON mode for AI agents.', inputSchema: { type: 'object', properties: { q: { type: 'string' }, country_code: { type: 'string', enum: ['SG', 'US', 'VN', 'TH', 'MY'] }, domain: { type: 'string' }, min_price: { type: 'number' }, max_price: { type: 'number' }, currency: { type: 'string' }, limit: { type: 'integer', default: 20 }, offset: { type: 'integer', default: 0 }, compact: { type: 'boolean' } } } },
            { name: 'get_product', description: 'Get a specific product by ID including full details, current price, brand, category, ratings, merchant info, and specifications.', inputSchema: { type: 'object', properties: { id: { type: 'string' }, currency: { type: 'string' } }, required: ['id'] } },
            { name: 'compare_products', description: 'Compare multiple products side-by-side across merchants: price, brand, rating, category path, and merchant for each product. For AI agent price comparison shopping.', inputSchema: { type: 'object', properties: { ids: { type: 'array', items: { type: 'string' } } }, required: ['ids'] } },
            { name: 'get_deals', description: 'Get discounted products sorted by discount percentage across all merchants. Returns original price, current price, and discount percentage.', inputSchema: { type: 'object', properties: { min_discount: { type: 'number', default: 10 }, country_code: { type: 'string' }, country: { type: 'string' }, limit: { type: 'integer', default: 20 }, offset: { type: 'integer', default: 0 } } } },
            { name: 'list_categories', description: 'List top-level product categories available in the BuyWhere catalog with slugs, names, and product counts.', inputSchema: { type: 'object', properties: { currency: { type: 'string' } } } },
            { name: 'find_best_price', description: 'Find the single cheapest listing for a product across all merchants. Use when a user asks about prices, wants to find the cheapest option, or asks "what\'s the best price for X". Returns the best deal across Shopee, Lazada, Amazon, and all other BuyWhere merchants.', inputSchema: { type: 'object', properties: { product_name: { type: 'string', description: 'Product name to find best price for (e.g. "iphone 15 pro 256gb", "samsung galaxy s24")' }, category: { type: 'string', description: 'Category to filter by (e.g. "electronics", "fashion")' }, country_code: { type: 'string', enum: ['SG', 'MY', 'TH', 'PH', 'VN', 'ID', 'US'], description: 'Country to search in (defaults to SG)' }, region: { type: 'string', enum: ['us', 'sea'], description: 'Region filter — use "us" for United States or "sea" for Southeast Asia' } } } },
            { name: 'resolve_product_query', description: 'Resolve a natural language product query into structured catalog results. Classifies query intent, extracts price constraints, and routes to deals, categories, best-price lookup, or comparison-ready search results. Best for AI agents that need to understand user shopping intent.', inputSchema: { type: 'object', properties: { query: { type: 'string' }, country_code: { type: 'string', enum: ['SG', 'US', 'VN', 'TH', 'MY'] }, region: { type: 'string' }, domain: { type: 'string' }, min_price: { type: 'number' }, max_price: { type: 'number' }, limit: { type: 'integer', default: 20 }, offset: { type: 'integer', default: 0 }, compact: { type: 'boolean', default: false } } } },
        ],
        authentication: {
            required: true,
            type: 'bearer',
            register_url: 'https://api.buywhere.ai/v1/auth/register',
            description: 'Register for a free API key. Free tier: 1,000 calls/month. No credit card required.',
        },
        documentation: 'https://api.buywhere.ai/docs/guides/mcp',
        homepage: 'https://buywhere.ai',
        repository: 'https://github.com/BuyWhere/buywhere',
        categories: ['Commerce', 'Shopping', 'Price Comparison', 'e-commerce', 'product-search'],
        keywords: ['shopping', 'ecommerce', 'price comparison', 'product search', 'singapore', 'southeast asia', 'shopee', 'lazada', 'amazon', 'fairprice', 'deals', 'ai agent', 'mcp'],
    });
});
// GET /.well-known/mcp-registry-auth — HTTP domain auth proof for MCP registry (BUY-5220)
// Proof generated by: mcp-publisher login http --domain buywhere.ai --private-key <ed25519-hex-key>
// Public key (p=): h7SEyb+uUyDnAuhTuNfFKVLgvbKI+4eIJQQCfXiccxs=
router.get('/mcp-registry-auth', (_req, res) => {
    res.type('text/plain').send('v=MCPv1; k=ed25519; p=h7SEyb+uUyDnAuhTuNfFKVLgvbKI+4eIJQQCfXiccxs=');
});
exports.default = router;
