#!/usr/bin/env node
/**
 * @buywhere/mcp-server — stdio MCP server for BuyWhere product catalog.
 *
 * Implements search_products, get_product, compare_products, get_deals,
 * and list_categories tools via the BuyWhere REST API.
 *
 * Environment variables:
 *   BUYWHERE_API_KEY   — Required. Bearer token for API auth.
 *   BUYWHERE_API_URL   — Optional. Base URL (default: https://api.buywhere.ai).
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js';

const API_BASE_URL = process.env.BUYWHERE_API_URL ?? 'https://api.buywhere.ai';
const API_KEY = process.env.BUYWHERE_API_KEY ?? '';
const PRODUCT_ID_RE = /^\d+$/;

if (!API_KEY) {
  process.stderr.write('Error: BUYWHERE_API_KEY environment variable is required.\n');
  process.exit(1);
}

async function apiGet(path: string, params: Record<string, unknown> = {}): Promise<unknown> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') {
      qs.set(k, String(v));
    }
  }
  const queryString = qs.toString();
  const url = `${API_BASE_URL}${path}${queryString ? `?${queryString}` : ''}`;

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`BuyWhere API error ${res.status}: ${body}`);
  }

  return res.json();
}

const TOOLS: Tool[] = [
  {
    name: 'search_products',
    description:
      'Search the BuyWhere product catalog by keyword. Returns products from e-commerce platforms across multiple regions (Singapore, US, etc.).',
    inputSchema: {
      type: 'object',
      properties: {
        q: { type: 'string', description: 'Keyword search query' },
        domain: { type: 'string', description: 'Filter by merchant platform (e.g. lazada, shopee, amazon)' },
        region: { type: 'string', description: 'Filter by region (sea, us, eu, au)' },
        country_code: {
          type: 'string',
          enum: ['SG', 'US', 'VN', 'TH', 'MY'],
          description: 'Filter by ISO country code',
        },
        min_price: { type: 'number', description: 'Minimum price' },
        max_price: { type: 'number', description: 'Maximum price' },
        limit: { type: 'integer', description: 'Number of results (max 100, default 20)', default: 20 },
        offset: { type: 'integer', description: 'Pagination offset', default: 0 },
        compact: {
          type: 'boolean',
          description: 'Return agent-optimized compact shape with structured_specs and comparison_attributes',
          default: false,
        },
        category: {
          type: 'string',
          description: 'Filter by product category name (e.g. "Laptops", "Smartphones", "Televisions"). Use to exclude accessories and get actual products.',
        },
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
        id: { type: 'string', description: 'Numeric BuyWhere product ID returned by search_products' },
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
          description: 'Array of product IDs to compare (2–10)',
          minItems: 2,
          maxItems: 10,
        },
      },
    },
  },
  {
    name: 'get_deals',
    description: 'Get discounted products sorted by discount percentage.',
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

async function handleToolCall(name: string, args: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case 'search_products':
      // BUY-6484: Must call /v1/products/search, NOT /v1/products
      return apiGet('/v1/products/search', args);

    case 'get_product': {
      const id = typeof args.id === 'number' && Number.isSafeInteger(args.id)
        ? String(args.id)
        : typeof args.id === 'string'
          ? args.id.trim()
          : '';
      if (!PRODUCT_ID_RE.test(id)) {
        throw new Error('Invalid get_product id: expected a numeric BuyWhere product ID returned by search_products');
      }
      return apiGet(`/v1/products/${encodeURIComponent(id)}`);
    }

    case 'compare_products': {
      const ids = (args.ids as string[]).join(',');
      return apiGet('/v1/products/compare', { ids });
    }

    case 'get_deals':
      return apiGet('/v1/products/deals', args);

    case 'list_categories':
      return apiGet('/v1/categories');

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

const server = new Server(
  { name: 'buywhere-catalog', version: '0.1.4' },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params;
  try {
    const result = await handleToolCall(name, args as Record<string, unknown>);
    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      content: [{ type: 'text', text: `Error: ${message}` }],
      isError: true,
    };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
