import { Router, Request, Response } from 'express';
import { API_BASE_URL } from '../config';

const router = Router();

// GET /.well-known/ai-plugin.json — MCP/OpenAI plugin discovery
router.get('/ai-plugin.json', (_req: Request, res: Response) => {
  res.json({
    schema_version: 'v1',
    name_for_human: 'BuyWhere Product Catalog',
    name_for_model: 'buywhere_catalog',
    description_for_human: 'Search and retrieve product data from Singapore\'s leading merchants.',
    description_for_model:
      'Use this plugin to search the BuyWhere product catalog. You can search by keyword, filter by domain/merchant, price range, and currency. All prices are in SGD by default. Register for a free API key at the auth endpoint.',
    auth: {
      type: 'user_http',
      authorization_type: 'bearer',
    },
    api: {
      type: 'openapi',
      url: `${API_BASE_URL}/openapi.json`,
      is_user_authenticated: true,
    },
    logo_url: `${API_BASE_URL}/logo.png`,
    contact_email: 'api@buywhere.ai',
    legal_info_url: 'https://buywhere.ai/terms',
  });
});

// GET /.well-known/mcp.json — MCP server discovery manifest
router.get('/mcp.json', (_req: Request, res: Response) => {
  res.json({
    name: 'BuyWhere Product Catalog',
    description: "Structured product catalog and price comparison API for AI agents. Real-time pricing from Singapore's major e-commerce platforms.",
    version: '0.1.0',
    mcp_endpoint: 'https://api.buywhere.ai/mcp',
    documentation: 'https://api.buywhere.ai/docs/guides/mcp',
    capabilities: ['search_products', 'get_offers', 'compare_prices', 'get_categories'],
    coverage: 'Singapore',
    data_freshness: 'real-time',
  });
});

// GET /openapi.json — OpenAPI 3.0 spec
router.get('/openapi.json', (_req: Request, res: Response) => {
  res.json({
    openapi: '3.0.0',
    info: {
      title: 'BuyWhere Product Catalog API',
      version: '1',
      description: 'Agent-native product catalog API for Singapore merchants',
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
router.get('/mcp/server-card.json', (_req: Request, res: Response) => {
  res.json({
    name: 'BuyWhere Product Catalog',
    description: "Structured product catalog and price comparison API for AI agents. Real-time pricing from Singapore's major e-commerce platforms (Lazada, Shopee, Best Denki, and others). Covers 2M+ products.",
    version: '0.1.0',
    contact: { email: 'api@buywhere.ai', url: 'https://buywhere.ai' },
    license: { name: 'Commercial', url: 'https://buywhere.ai/terms' },
    servers: [
      {
        url: 'https://api.buywhere.ai/mcp',
        description: 'Production MCP endpoint (Singapore)',
        transport: ['streamable-http', 'sse'],
      },
    ],
    tools: [
      { name: 'search_products', description: 'Search products by keyword, category, price range, merchant' },
      { name: 'get_offers', description: 'Get live retailer offers for a product ID' },
      { name: 'compare_prices', description: 'Compare prices across retailers for a list of product IDs' },
      { name: 'get_categories', description: 'List available product categories and subcategories' },
      { name: 'get_deals', description: 'Get current deals and promotions by region/category' },
    ],
    authentication: {
      required: true,
      type: 'bearer',
      register_url: 'https://api.buywhere.ai/v1/auth/register',
      description: 'Register for a free API key. Free tier: 1,000 calls/month.',
    },
    documentation: 'https://api.buywhere.ai/docs/guides/mcp',
    homepage: 'https://smithery.ai/server/buywhere',
  });
});

export default router;
