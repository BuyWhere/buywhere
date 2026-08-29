import { Router, Request, Response } from 'express';
import crypto from 'crypto';
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
    mcp_endpoint: 'https://mcp.buywhere.ai/mcp',
    documentation: 'https://api.buywhere.ai/docs/guides/mcp',
    capabilities: ['search_products', 'get_product', 'compare_products', 'get_deals', 'list_categories'],
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
router.get('/mcp/server-card.json', (_req: Request, res: Response) => {
  res.json({
    serverInfo: {
      name: 'BuyWhere Product Catalog',
      version: '1.0.0',
    },
    description: "Agent-native product catalog API for Southeast Asia and US commerce. Search 1.5M+ products across Shopee, Lazada, Amazon SG, Amazon US, Walmart, Carousell, FairPrice, Harvey Norman, and 20+ e-commerce platforms. Compare prices across merchants, discover deals, browse categories — all through a single MCP endpoint.",
    contact: { email: 'api@buywhere.ai', url: 'https://buywhere.ai' },
    license: 'MIT',
    servers: [
      {
        url: 'https://mcp.buywhere.ai/mcp',
        description: 'Production MCP endpoint (Streamable HTTP + SSE)',
        transport: ['streamable-http', 'sse'],
      },
    ],
    tools: [
      { name: 'search_products', description: 'Full-text product search with price, category, merchant, region, and rating filters across 1.5M+ products from 20+ e-commerce platforms. Supports multiple currencies and compact JSON mode for AI agents.', inputSchema: { type: 'object', properties: { q: { type: 'string' }, country_code: { type: 'string', enum: ['SG', 'US', 'VN', 'TH', 'MY'] }, domain: { type: 'string' }, min_price: { type: 'number' }, max_price: { type: 'number' }, currency: { type: 'string' }, limit: { type: 'integer', default: 20 }, offset: { type: 'integer', default: 0 } } } },
      { name: 'get_product', description: 'Get a specific product by ID including full details, current price, brand, category, ratings, merchant info, and specifications.', inputSchema: { type: 'object', properties: { id: { type: 'string' }, currency: { type: 'string' } }, required: ['id'] } },
      { name: 'compare_products', description: 'Compare multiple products side-by-side across merchants: price, brand, rating, category path, and merchant for each product. For AI agent price comparison shopping.', inputSchema: { type: 'object', properties: { ids: { type: 'array', items: { type: 'string' } } }, required: ['ids'] } },
      { name: 'get_deals', description: 'Get discounted products sorted by discount percentage across all merchants. Returns original price, current price, and discount percentage.', inputSchema: { type: 'object', properties: { min_discount: { type: 'number', default: 10 }, country_code: { type: 'string' }, country: { type: 'string' }, category: { type: 'string', description: 'Filter by category name or slug (e.g. "electronics", "beauty"). Matches against category_path.' }, limit: { type: 'integer', default: 20 }, offset: { type: 'integer', default: 0 } } } },
      { name: 'list_categories', description: 'List top-level product categories available in the BuyWhere catalog with slugs, names, and product counts.', inputSchema: { type: 'object', properties: { currency: { type: 'string' } } } },
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
// Public key (p=): JkMD3wRId8C8vMuw02YDk8XTJAXR8NxVf669jecpY68=
// Raw private key (hex, 32-byte seed): 35236b922d7d90ccdd6673feab51c7ed2466cc206c06fabffdc64f63686794a3
router.get('/mcp-registry-auth', (_req: Request, res: Response) => {
  res.type('text/plain').send('v=MCPv1; k=ed25519; p=JkMD3wRId8C8vMuw02YDk8XTJAXR8NxVf669jecpY68=');
});

// Ed25519 key pair for JWS-signed Agent Card
// Load from env vars for production, generate at startup for local dev
function loadAgentCardKeys(): { privateKey: crypto.KeyObject; publicKeyB64: string } {
  const privateKeyPem = process.env.AGENT_CARD_PRIVATE_KEY;
  const publicKeyPem = process.env.AGENT_CARD_PUBLIC_KEY;

  let publicKeyObj: crypto.KeyObject;
  let privateKeyObj: crypto.KeyObject;

  if (privateKeyPem && publicKeyPem) {
    privateKeyObj = crypto.createPrivateKey(privateKeyPem.replace(/\\n/g, '\n'));
    publicKeyObj = crypto.createPublicKey(publicKeyPem.replace(/\\n/g, '\n'));
  } else {
    const pair = crypto.generateKeyPairSync('ed25519', {
      publicKeyEncoding: { type: 'spki', format: 'der' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    privateKeyObj = pair.privateKey as any;
    publicKeyObj = crypto.createPublicKey({ key: pair.publicKey as any, format: 'der', type: 'spki' });
  }

  // Extract raw 32-byte public key from SPKI DER for JWK x field (RFC 8037)
  const publicKeyDer = publicKeyObj.export({ type: 'spki', format: 'der' });
  const rawKey = publicKeyDer.subarray(-32);
  const publicKeyB64 = rawKey.toString('base64url');
  return { privateKey: privateKeyObj, publicKeyB64 };
}

const agentCardKeys = loadAgentCardKeys();

function base64url(buf: Buffer): string {
  return buf.toString('base64url');
}

function createJws(payload: Record<string, unknown>): string {
  const header = { alg: 'EdDSA', kid: 'buywhere-agent-card-v1', typ: 'JWT' };
  const headerB64 = base64url(Buffer.from(JSON.stringify(header)));
  const payloadB64 = base64url(Buffer.from(JSON.stringify(payload)));
  const signingInput = `${headerB64}.${payloadB64}`;
  const signature = crypto.sign(null, Buffer.from(signingInput), agentCardKeys.privateKey);
  return `${signingInput}.${base64url(signature)}`;
}

// GET /.well-known/jwks.json — JSON Web Key Set for the agent card signing key
router.get('/jwks.json', (_req: Request, res: Response) => {
  res.json({
    keys: [
      {
        kty: 'OKP',
        crv: 'Ed25519',
        kid: 'buywhere-agent-card-v1',
        x: agentCardKeys.publicKeyB64,
      },
    ],
  });
});

function buildAgentCard() {
  return {
    name: 'BuyWhere Product Catalog',
    description: 'Agent-native product catalog API for AI agent commerce. Search 1.5M+ products across 20+ e-commerce platforms in Singapore, US, and Southeast Asia.',
    url: `${API_BASE_URL}/a2a`,
    version: '1.0.0',
    capabilities: {
      streaming: true,
      pushNotifications: false,
      state: 'stateless',
    },
    authentication: {
      schemes: [
        {
          type: 'bearer',
          description: 'Register for a free API key at /v1/auth/register',
          registerUrl: `${API_BASE_URL}/v1/auth/register`,
        },
      ],
    },
    skills: [
      { id: 'search_products', name: 'Search Products', description: 'Full-text product search with price, category, merchant, region filters' },
      { id: 'get_product', name: 'Get Product', description: 'Get a specific product by ID with full details' },
      { id: 'compare_products', name: 'Compare Products', description: 'Compare multiple products side-by-side' },
      { id: 'get_deals', name: 'Get Deals', description: 'Get discounted products sorted by discount percentage' },
      { id: 'list_categories', name: 'List Categories', description: 'List top-level product categories' },
      { id: 'find_best_price', name: 'Find Best Price', description: 'Find the best current price across all merchants' },
    ],
    jwks: {
      keys: [
        {
          kty: 'OKP',
          crv: 'Ed25519',
          kid: 'buywhere-agent-card-v1',
          x: agentCardKeys.publicKeyB64,
        },
      ],
    },
  };
}

// GET /.well-known/agent.json — A2A Agent Card (Google A2A spec 1.0)
// Returns the full Agent Card JSON with JWS signature embedded in the `signature` field
router.get('/agent.json', (_req: Request, res: Response) => {
  const card = buildAgentCard();
  const jws = createJws(card);
  res.json({ ...card, signature: jws });
});

// GET /.well-known/agent-card — JWS-signed Agent Card as compact JWS
// Returns compact JWS: BASE64URL(header).BASE64URL(payload).BASE64URL(signature)
router.get('/agent-card', (_req: Request, res: Response) => {
  const card = buildAgentCard();
  const jws = createJws(card);
  res.set('Content-Type', 'application/jose');
  res.send(jws);
});

export default router;
