import { Router, Request, Response } from 'express';
import { API_BASE_URL } from '../config';

const router = Router();
const DISCOVERY_CACHE_CONTROL = 'public, max-age=86400, s-maxage=86400';

const AI_AGENT_DESCRIPTOR = {
  name: 'BuyWhere',
  description: 'Agent-native product catalog API — 370M+ products, 900,000+ direct merchants worldwide, location-aware deliver_to ranking',
  version: '1.0',
  protocols: {
    mcp: 'https://api.buywhere.ai/mcp',
    rest: 'https://api.buywhere.ai/v1',
  },
  auth: {
    type: 'api_key',
    header: 'X-API-Key',
    obtain: 'https://api.buywhere.ai/v1/auth/register',
  },
  capabilities: ['search_products', 'get_deals', 'compare_prices'],
  llms_txt: 'https://buywhere.ai/llms.txt',
};

// BUY-75173: align api /.well-known/agent.json with apex public/.well-known/agent.json
// (version 1.1.0). Object is byte-equivalent to public/.well-known/agent.json when
// serialised by res.json() — same keys, same order, same values.
const A2A_AGENT_CARD = {
  name: 'BuyWhere',
  description:
    'Real-time shopping API and agent-native product catalog for AI agents: 370M+ products from 900,000+ merchants worldwide, with location-aware deliver_to ranking and per-result availability labels.',
  url: 'https://buywhere.ai',
  provider: {
    organization: 'BuyWhere',
    url: 'https://buywhere.ai',
  },
  version: '1.1.0',
  capabilities: {
    streaming: true,
    pushNotifications: false,
    stateTransitionHistory: true,
  },
  authentication: {
    schemes: ['apiKey', 'oauth2'],
  },
  defaultInputModes: ['text'],
  defaultOutputModes: ['text', 'json'],
  skills: [
    {
      id: 'product-search',
      name: 'Product Search',
      description:
        'Search 370M+ products worldwide by keyword, category, price range, merchant, country, and deliver_to for deliverable-first ranking.',
      tags: ['e-commerce', 'search', 'products', 'availability'],
      examples: [
        'Find wireless earbuds under 150 USD that ship to US',
        'Find coffee makers deliverable to Singapore with local or ships_to_you availability',
      ],
    },
    {
      id: 'location-aware-shopping',
      name: 'Location-Aware Shopping',
      description:
        'Use deliver_to=<ISO country> to rank products your end user can actually receive; every result includes availability: local, ships_to_you, unavailable, or unknown.',
      tags: ['delivery', 'availability', 'cross-border', 'ranking'],
      examples: [
        'Show laptop deals deliverable to AU and hide unavailable results',
        'Find skincare products that ship to GB with availability labels',
      ],
    },
    {
      id: 'cross-storefront-comparison',
      name: 'Cross-Storefront Product Comparison',
      description:
        'Compare products, prices, attributes, and availability across 900,000+ independent storefronts worldwide.',
      tags: ['comparison', 'price-comparison', 'affiliate', 'merchant'],
      examples: [
        'Compare iPhone 16 Pro Max prices across stores that ship to Singapore',
        'Find equivalent robot vacuums across US and EU storefronts with best delivered price',
      ],
    },
    {
      id: 'deal-finder',
      name: 'Deal Finder',
      description:
        'Find discounted products and price drops across the global catalog, with filters for category, currency, country, and deliverability.',
      tags: ['deals', 'discounts', 'pricing'],
      examples: [
        'Show the best monitor deals today that ship to CA',
        'Find air purifier discounts deliverable to SG under 300 SGD',
      ],
    },
  ],
  protocols: {
    mcp: {
      serverUrl: 'https://api.buywhere.ai/mcp',
      transport: 'streamable-http',
      notes:
        'Canonical MCP endpoint: JSON-RPC over HTTP POST (Streamable HTTP).',
    },
    rest: {
      serverUrl: 'https://api.buywhere.ai/v1',
      transport: 'https',
    },
  },
  contact: {
    email: 'hello@buywhere.ai',
  },
};

// GET /.well-known/ai-plugin.json — MCP/OpenAI plugin discovery
router.get('/ai-plugin.json', (_req: Request, res: Response) => {
  res.json({
    schema_version: 'v1',
    name_for_human: 'BuyWhere Product Catalog',
    name_for_model: 'buywhere_catalog',
    description_for_human: 'Product catalog for AI agents: 370M+ products from 900,000+ storefronts worldwide, normalized into one schema. Location-aware: pass deliver_to and every result carries an availability label (local | ships_to_you | unavailable).',
    description_for_model:
      'Use this plugin to search the BuyWhere global product catalog for AI agents and LLM apps. Search 370M+ products across 900,000+ storefronts worldwide; pass deliver_to=<ISO country> for the end user delivery location so results rank deliverable-first and include availability labels (local | ships_to_you | unavailable | unknown). Filter by merchant/retailer, price range, country, currency, availability, and include_unshippable. Register for a free API key at https://api.buywhere.ai/v1/auth/register.',
    auth: {
      type: 'user_http',
      authorization_type: 'bearer',
    },
    api: {
      type: 'openapi',
      url: `${API_BASE_URL}/openapi.json`,
      is_user_authenticated: true,
    },
    logo_url: 'https://buywhere.ai/favicon.svg',
    contact_email: 'api@buywhere.ai',
    legal_info_url: 'https://buywhere.ai/terms',
  });
});

// GET /.well-known/mcp.json — MCP server discovery manifest.
// BUY-74774: removed inline stub. The apexDiscoveryProxy mounted later in
// the Express stack proxies this path to apex (buywhere.ai/.well-known/mcp.json)
// which serves the full v2-first 13-tool MCP server card (8063B vs the old
// 493B stub). Apex is the canonical source.
//
// This route is intentionally NOT defined here so Express falls through to
// the proxy. If apex proxying is ever disabled, deploy will roll back via
// deploy-api auto-rollback on smoke failure.

// GET /.well-known/api-catalog — API contract discovery metadata for monitors
router.get('/api-catalog', (_req: Request, res: Response) => {
  res.json({
    name: 'BuyWhere API',
    version: '1.0',
    description: 'Structured product catalog and price comparison API with REST + MCP interfaces.',
    base_url: `${API_BASE_URL}`,
    endpoints: {
      rest: `${API_BASE_URL}/v1/products`,
      openapi: `${API_BASE_URL}/openapi.json`,
      mcp: `${API_BASE_URL}/mcp`,
      health: `${API_BASE_URL}/health`,
      docs: `${API_BASE_URL}/docs/guides/mcp`,
    },
    auth: {
      type: 'api_key',
      header: 'Authorization: Bearer',
      obtain_at: 'https://buywhere.ai/api-keys',
      free: true,
    },
    signup_cta: 'Get your free API key in 60 seconds → https://buywhere.ai/api-keys',
    updated_at: new Date().toISOString(),
  });
});

// GET /.well-known/glama.json — Glama.ai agent discovery manifest
router.get('/glama.json', (_req: Request, res: Response) => {
  res.json({
    "$schema": "https://glama.ai/mcp/schemas/connector.json",
    name: "buywhere",
    display_name: "BuyWhere",
    description: "Agent-native product catalog API. Search 370M+ products across Shopee, Lazada, Amazon, Walmart, and 20+ e-commerce platforms. Compare prices, find deals, browse categories.",
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
      { name: "search_products", description: "Full-text search across 370M+ products from 20+ e-commerce platforms" },
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

// GET /.well-known/ai-agent.json — generic agent identity descriptor
router.get('/ai-agent.json', (_req: Request, res: Response) => {
  res.set('Cache-Control', DISCOVERY_CACHE_CONTROL);
  res.json(AI_AGENT_DESCRIPTOR);
});

// GET /.well-known/agent.json — A2A agent card
router.get('/agent.json', (_req: Request, res: Response) => {
  res.set('Cache-Control', DISCOVERY_CACHE_CONTROL);
  res.json(A2A_AGENT_CARD);
});

export function sendOpenApiSpec(res: Response) {
  res.json({
    openapi: '3.0.0',
    info: {
      title: 'BuyWhere Product Catalog API',
      version: '1',
      description: 'Agent-native product catalog API for Southeast Asia and US commerce. Search 370M+ products across Shopee, Lazada, Amazon, Walmart, FairPrice, Carousell, and 20+ e-commerce platforms. Compare prices, discover deals, and find best prices through REST or MCP.',
    },
    servers: [{ url: `${API_BASE_URL}/v1` }],
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
          description: 'Public read endpoint: works without credentials at anonymous rate limits. Sending a Bearer API key raises limits to your tier (free tier: 10 requests/min, 10,000/day) and enables usage attribution.',
          operationId: 'searchProducts',
          security: [],
          parameters: [
            { name: 'q', in: 'query', schema: { type: 'string' }, description: 'Keyword search query (full-text). Alias: query.' },
            { name: 'query', in: 'query', schema: { type: 'string' }, description: 'Alias for q (accepted for agent convenience; prefer q).' },
            { name: 'deliver_to', in: 'query', schema: { type: 'string', enum: ['SG', 'US', 'VN', 'TH', 'MY', 'ID', 'PH'] }, description: 'REQUIRED for buyer-facing use: ISO-3166 country of the end user (e.g. "SG", "US"). Ranks deliverable products first and prevents all-market scans. Prefer over country_code.' },
            { name: 'domain', in: 'query', schema: { type: 'string' }, description: 'Filter by merchant platform (e.g. lazada, shopee)' },
            { name: 'region', in: 'query', schema: { type: 'string' }, description: 'Filter by region (sea, us, eu, au)' },
            { name: 'country_code', in: 'query', schema: { type: 'string', enum: ['SG', 'US', 'VN', 'TH', 'MY'] }, description: 'Filter by ISO country code. When provided without an explicit `currency` param, the default currency is inferred (SG→SGD, US→USD, VN→VND, TH→THB, MY→MYR). `min_price`/`max_price` apply in the inferred currency. Default: SG.' },
            { name: 'include_unshippable', in: 'query', schema: { type: 'boolean', default: true }, description: 'Include products not deliverable to deliver_to country (default true). Set to false to return only same-country products.' },
            { name: 'min_price', in: 'query', schema: { type: 'number' }, description: 'Minimum price in the active currency (inferred from country_code or explicit currency param)' },
            { name: 'max_price', in: 'query', schema: { type: 'number' }, description: 'Maximum price in the active currency (inferred from country_code or explicit currency param)' },
            { name: 'currency', in: 'query', schema: { type: 'string', default: 'SGD' }, description: 'Explicit currency override. If omitted and country_code is set, currency is inferred from country_code.' },
            { name: 'compact', in: 'query', schema: { type: 'boolean', default: false }, description: 'Return minimal payload for AI agents. Adds normalized_price_usd field. Reduces response ~40%.' },
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 20, maximum: 100 } },
            { name: 'offset', in: 'query', schema: { type: 'integer', default: 0 } },
            { name: 'mode', in: 'query', schema: { type: 'string', enum: ['keyword', 'semantic', 'hybrid'], default: 'keyword' }, description: 'Search mode. `keyword` (default) is full-text search on the indexed search_vector. `semantic` embeds the query (flow-embed-1, 1024-dim) and searches the pgvector pool, and `hybrid` RRF-merges the FTS and semantic candidate ranks. If vector infrastructure is unavailable, `semantic` and `hybrid` fall back to the keyword path.' },
          ],
          responses: {
            '200': {
              description: 'Product list with meta (total, response_time_ms, cached, mode)',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      data: {
                        type: 'array',
                        items: {
                          type: 'object',
                          properties: {
                            id: { type: 'string', format: 'uuid', description: 'Unique product identifier' },
                            title: { type: 'string', description: 'Product title' },
                            price: { type: 'object', properties: { amount: { type: 'number' }, currency: { type: 'string' } }, description: 'Current price object' },
                            merchant: { type: 'string', description: 'Merchant slug' },
                            url: { type: 'string', format: 'uri', description: 'Product page URL' },
                            image_url: { type: 'string', format: 'uri', description: 'Product image URL' },
                            country_code: { type: 'string', enum: ['SG', 'US', 'VN', 'TH', 'MY'], description: 'ISO country code' },
                            category_path: { type: 'array', items: { type: 'string' }, description: 'Category hierarchy' },
                            updated_at: { type: 'string', format: 'date-time' },
                            click_url: { type: 'string', format: 'uri', description: 'BuyWhere tracked click URL' },
                            affiliate_disclosure: { type: 'string', description: 'Affiliate disclosure text' },
                            metadata: { type: 'object', description: 'Additional product metadata' },
                          },
                        },
                      },
                      meta: {
                        type: 'object',
                        properties: {
                          total: { type: 'integer', description: 'Total matching products (approximate for large catalogs)' },
                          limit: { type: 'integer', description: 'Items returned per page' },
                          offset: { type: 'integer', description: 'Pagination offset' },
                          response_time_ms: { type: 'integer', description: 'Server processing time in milliseconds' },
                          cached: { type: 'boolean', description: 'Whether this response was served from cache' },
                          mode_used: { type: 'string', enum: ['keyword', 'semantic', 'hybrid'], description: 'Search mode used' },
                          mode_used_engine: { type: 'string', description: 'Detailed engine description (e.g. "keyword (fts)")' },
                          has_more: { type: 'boolean', description: 'Whether more results are available' },
                          hint: { type: 'string', description: 'Usage guidance for agents (e.g. deliver_to recommendation)' },
                          degraded: { type: 'boolean', description: 'Whether the response is degraded due to upstream issues' },
                          status: { type: 'string', enum: ['ok', 'degraded'], description: 'Response status' },
                          emptiness_reason: { type: 'string', description: 'Why results are empty (e.g. timeout, no_match)' },
                          confidence: { type: 'string', enum: ['high', 'medium', 'low'], description: 'Result confidence' },
                          diagnostic: {
                            type: 'object',
                            properties: {
                              engine_status: { type: 'string' },
                              indexed_for_region: { type: 'boolean' },
                              category_recognized: { type: 'boolean' },
                              timed_out_stage: { type: 'string', description: 'Stage that timed out (catalog_search, offer_aggregation)' },
                              deliver_to_present: { type: 'boolean' },
                              rate_limit_remaining: { type: 'integer', nullable: true },
                            },
                          },
                          degraded_kind: { type: 'string', description: 'Type of degradation (timeout, api_error, auth_failure)' },
                          degraded_reason: { type: 'string', description: 'Human-readable degradation reason' },
                          deliver_to: { type: 'string', description: 'Buyer delivery country used for ranking' },
                          deliver_to_inferred: { type: 'boolean', description: 'Whether deliver_to was inferred from country_code' },
                        },
                      },
                      search_mode: {
                        type: 'object',
                        description: 'Mode honesty: which engine the request asked for, which one actually ran, and why any fallback happened.',
                        properties: {
                          requested_mode: { type: 'string', nullable: true, enum: ['keyword', 'semantic', 'hybrid', null] },
                          executed_mode: { type: 'string', enum: ['keyword', 'semantic', 'hybrid'] },
                          fallback_reason: { type: 'string', nullable: true, description: 'e.g. vector_error, query_embed_failed, vector_db_unavailable, sort_forces_keyword' },
                        },
                      },
                    },
                  },
                },
              },
            },
            '400': {
              description: 'Invalid query parameters (limit out of range, malformed country code, inverted or negative price range, unknown mode)',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      error: {
                        type: 'object',
                        properties: {
                          code: { type: 'string', example: 'invalid_request' },
                          message: { type: 'string' },
                          details: { type: 'array', items: { type: 'object', properties: { field: { type: 'string' }, issue: { type: 'string' } } } },
                        },
                      },
                    },
                  },
                },
              },
            },
            '429': { description: 'Rate limit exceeded' },
          },
        },
      },
      '/products/{id}/price-history': {
        get: {
          summary: 'Historical price points for a product',
          operationId: 'getPriceHistory',
          security: [{ BearerAuth: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'BuyWhere product ID' },
          ],
          responses: {
            '200': { description: 'Price history series', content: { 'application/json': { schema: { type: 'object' } } } },
            '401': { description: 'Missing or invalid API key' },
          },
        },
      },
      '/usage/counters': {
        get: {
          summary: 'Usage counters for the calling API key',
          operationId: 'getUsageCounters',
          security: [{ BearerAuth: [] }],
          responses: {
            '200': { description: 'Request counters and remaining quota', content: { 'application/json': { schema: { type: 'object' } } } },
            '401': { description: 'Missing or invalid API key' },
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
      // BUY-77195: documented as /v1/featured for backward compat (also reachable at /v1/products/featured)
      '/featured': {
        get: {
          summary: 'Get featured products (newest active products)',
          operationId: 'getFeatured',
          security: [{ BearerAuth: [] }],
          description: 'Returns the most recently added active products, ordered by product ID descending. Alias: /v1/products/featured.',
          parameters: [
            { name: 'country', in: 'query', schema: { type: 'string', enum: ['SG', 'US', 'VN', 'TH', 'MY'] }, description: 'ISO country code filter (alias: country_code). Default: SG.' },
            { name: 'country_code', in: 'query', schema: { type: 'string', enum: ['SG', 'US', 'VN', 'TH', 'MY'] }, description: 'ISO country code filter. Default: SG.' },
            { name: 'currency', in: 'query', schema: { type: 'string' }, description: 'Currency filter. Inferred from country_code if omitted.' },
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 12, maximum: 50 } },
            { name: 'offset', in: 'query', schema: { type: 'integer', default: 0 } },
            { name: 'compact', in: 'query', schema: { type: 'boolean', default: false }, description: 'Return minimal payload for AI agents.' },
          ],
          responses: {
            '200': { description: 'Featured product list' },
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
      '/products/{id}/similar': {
        get: {
          summary: 'Find similar products by embedding similarity',
          operationId: 'findSimilarProducts',
          security: [{ BearerAuth: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' }, description: 'UUID of the source product' },
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 10, minimum: 1, maximum: 20 }, description: 'Number of similar products to return' },
          ],
          responses: {
            '200': { description: 'Array of similar products with similarity scores' },
            '400': { description: 'Invalid product id' },
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
}

// GET /openapi.json — OpenAPI 3.0 spec
router.get('/openapi.json', (_req: Request, res: Response) => {
  sendOpenApiSpec(res);
});

// GET /.well-known/mcp/server-card.json — Smithery skip-scan card
// Allows Smithery.ai to catalogue the server without a live endpoint scan.
// Ref: https://smithery.ai/docs/build/publish#troubleshooting
router.get('/mcp/server-card.json', (_req: Request, res: Response) => {
  res.json({
    serverInfo: {
      name: 'BuyWhere Product Catalog',
      version: '1.0.0',
    },
    description: "Agent-native product catalog API for Southeast Asia and US commerce. Search 370M+ products across Shopee, Lazada, Amazon SG, Amazon US, Walmart, Carousell, FairPrice, Harvey Norman, and 20+ e-commerce platforms. Compare prices across merchants, discover deals, browse categories, find best prices — all through a single MCP endpoint.",
    contact: { email: 'api@buywhere.ai', url: 'https://buywhere.ai' },
    license: 'MIT',
    servers: [
      {
        url: 'https://api.buywhere.ai/mcp',
        description: 'Production MCP endpoint (Streamable HTTP)',
        transport: ['streamable-http'],
      },
    ],
    tools: [
      { name: 'search_products', description: 'Full-text product search with price, category, merchant, region, and rating filters across 370M+ products from 20+ e-commerce platforms. Supports multiple currencies and compact JSON mode for AI agents.', inputSchema: { type: 'object', properties: { q: { type: 'string' }, country_code: { type: 'string', enum: ['SG', 'US', 'VN', 'TH', 'MY'] }, domain: { type: 'string' }, min_price: { type: 'number' }, max_price: { type: 'number' }, currency: { type: 'string' }, limit: { type: 'integer', default: 20 }, offset: { type: 'integer', default: 0 }, compact: { type: 'boolean' } } } },
      { name: 'get_product', description: 'Get a specific product by ID including full details, current price, brand, category, ratings, merchant info, and specifications.', inputSchema: { type: 'object', properties: { id: { type: 'string' }, currency: { type: 'string' } }, required: ['id'] } },
      { name: 'compare_products', description: 'Compare multiple products side-by-side across merchants: price, brand, rating, category path, and merchant for each product. For AI agent price comparison shopping.', inputSchema: { type: 'object', properties: { ids: { type: 'array', items: { type: 'string' } } }, required: ['ids'] } },
      { name: 'get_deals', description: 'Get discounted products sorted by discount percentage across all merchants. Returns original price, current price, and discount percentage.', inputSchema: { type: 'object', properties: { min_discount: { type: 'number', default: 10 }, category: { type: 'string', description: 'Filter by product category name (e.g. "electronics", "beauty", "fashion")' }, country_code: { type: 'string' }, country: { type: 'string' }, limit: { type: 'integer', default: 20 }, offset: { type: 'integer', default: 0 } } } },
      { name: 'list_categories', description: 'List top-level product categories available in the BuyWhere catalog with slugs, names, and product counts.', inputSchema: { type: 'object', properties: { country_code: { type: 'string', enum: ['SG', 'US', 'VN', 'TH', 'MY'] }, country: { type: 'string' } } } },
      { name: 'find_best_price', description: 'Find the single cheapest listing for a product across all merchants. Use when a user asks about prices, wants to find the cheapest option, or asks "what\'s the best price for X". Returns the best deal across Shopee, Lazada, Amazon, and all other BuyWhere merchants.', inputSchema: { type: 'object', properties: { q: { type: 'string', description: 'Keyword search query — alias for product_name' }, product_name: { type: 'string', description: 'Product name to find best price for (e.g. "iphone 15 pro 256gb", "samsung galaxy s24")' }, category: { type: 'string', description: 'Category to filter by (e.g. "electronics", "fashion")' }, country_code: { type: 'string', enum: ['SG', 'MY', 'TH', 'PH', 'VN', 'ID', 'US'], description: 'Country to search in (defaults to SG)' }, region: { type: 'string', enum: ['us', 'sea'], description: 'Region filter — use "us" for United States or "sea" for Southeast Asia' } } } },
      { name: 'find_similar', description: 'Find products similar to a given product using vector similarity. Returns up to 10 nearest neighbours by semantic meaning (title+description embedding). Useful for "more like this" recommendations.', inputSchema: { type: 'object', required: ['product_id'], properties: { product_id: { type: 'string', description: 'UUID of the source product' }, limit: { type: 'integer', default: 10, description: 'Number of similar products to return (1-10)' } } } },
      { name: 'ingest_products', description: 'Ingest (upsert) a batch of products into the BuyWhere catalog. Accepts up to 1000 products per call with source, SKU, title, price, URL, and optional metadata. Requires an API key with ingest permissions.', inputSchema: { type: 'object', required: ['source', 'products'], properties: { source: { type: 'string', description: 'Data source identifier (e.g. "shopee_sg", "amazon_sg", "lazada_sg")' }, products: { type: 'array', description: 'Array of product objects to ingest (max 1000)', items: { type: 'object', required: ['sku', 'merchant_id', 'title', 'price', 'url'], properties: { sku: { type: 'string' }, merchant_id: { type: 'string' }, title: { type: 'string' }, description: { type: 'string' }, price: { type: 'number' }, currency: { type: 'string', default: 'SGD' }, url: { type: 'string' }, image_url: { type: 'string' }, category: { type: 'string' }, brand: { type: 'string' }, is_active: { type: 'boolean', default: true }, is_available: { type: 'boolean' }, country_code: { type: 'string' }, region: { type: 'string' }, metadata: { type: 'object' } } } } } } },
      { name: 'search_products_v2', description: 'REQUIRED deliver_to. v2 search with shipping-aware ranking. Always pass deliver_to=<ISO country code> for the buyer\'s market. Returns schema.org/Product with structured_specs, comparison_attributes, normalized_price_usd.', inputSchema: { type: 'object', required: ['deliver_to'], properties: { q: { type: 'string' }, domain: { type: 'string' }, region: { type: 'string' }, country_code: { type: 'string', enum: ['SG', 'US', 'VN', 'TH', 'MY'] }, deliver_to: { type: 'string', description: 'REQUIRED. Buyer delivery country (ISO code, e.g. "SG", "US")' }, country: { type: 'string' }, min_price: { type: 'number' }, max_price: { type: 'number' }, limit: { type: 'integer', default: 20 }, offset: { type: 'integer', default: 0 }, compact: { type: 'boolean', default: false }, category: { type: 'string' }, mode: { type: 'string', enum: ['keyword', 'semantic', 'hybrid'], default: 'keyword' } } } },
      { name: 'get_product_v2', description: 'REQUIRED deliver_to. v2 single-product lookup. Returns resolved outbound_url (BuyWhere click-tracked redirect) for the buyer market.', inputSchema: { type: 'object', required: ['id', 'deliver_to'], properties: { id: { type: 'string' }, deliver_to: { type: 'string', description: 'REQUIRED. Buyer delivery country (ISO code)' } } } },
      { name: 'compare_products_v2', description: 'REQUIRED deliver_to. v2 side-by-side comparison with shipping-aware per-row availability.', inputSchema: { type: 'object', required: ['ids', 'deliver_to'], properties: { ids: { type: 'array', items: { type: 'string' }, minItems: 2, maxItems: 10 }, deliver_to: { type: 'string', description: 'REQUIRED. Buyer delivery country (ISO code)' } } } },
      { name: 'get_deals_v2', description: 'REQUIRED deliver_to. v2 deals lookup. Returns schema.org/Product with per-row availability for the buyer market.', inputSchema: { type: 'object', required: ['deliver_to'], properties: { min_discount: { type: 'number', default: 10 }, category: { type: 'string', description: 'Filter by product category name (e.g. "electronics", "beauty", "fashion")' }, currency: { type: 'string', default: 'SGD' }, region: { type: 'string' }, country_code: { type: 'string', enum: ['SG', 'US', 'VN', 'TH', 'MY'] }, deliver_to: { type: 'string', description: 'REQUIRED. Buyer delivery country (ISO code)' }, country: { type: 'string' }, limit: { type: 'integer', default: 20 }, offset: { type: 'integer', default: 0 } } } },
      { name: 'find_best_price_v2', description: 'REQUIRED deliver_to. v2 cheapest-listing lookup. Returns shopping_job_id for multi-merchant price-comparison session resume.', inputSchema: { type: 'object', required: ['deliver_to'], properties: { q: { type: 'string' }, product_name: { type: 'string' }, category: { type: 'string' }, country_code: { type: 'string', enum: ['SG', 'MY', 'TH', 'PH', 'VN', 'ID', 'US'] }, deliver_to: { type: 'string', description: 'REQUIRED. Buyer delivery country (ISO code)' }, country: { type: 'string' }, region: { type: 'string', enum: ['us', 'sea'] } } } },
    ],
    authentication: {
      required: true,
      type: 'bearer',
      register_url: 'https://api.buywhere.ai/v1/auth/register',
      description: 'Register for a free API key. Free tier: 10,000 requests/day. No credit card required.',
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
router.get('/mcp-registry-auth', (_req: Request, res: Response) => {
  res.type('text/plain').send('v=MCPv1; k=ed25519; p=h7SEyb+uUyDnAuhTuNfFKVLgvbKI+4eIJQQCfXiccxs=');
});

export default router;
