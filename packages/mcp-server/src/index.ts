#!/usr/bin/env node
/**
 * @buywhere/mcp-server — stdio MCP server for BuyWhere product catalog.
 *
 * Bridges stdio (Claude Desktop, Cursor, Windsurf, etc.) to the BuyWhere
 * remote MCP endpoint (api.buywhere.ai/mcp) via JSON-RPC 2.0. All tool
 * calls are forwarded to the live server, keeping tool schemas in sync.
 *
 * Tools: search_products, get_product, compare_products, get_deals,
 *        list_categories, find_best_price, find_similar
 *
 * Environment variables:
 *   BUYWHERE_API_KEY   — Required. Bearer token for API auth.
 *   BUYWHERE_API_URL   — Optional. Base URL WITHOUT the /mcp suffix
 *                        (default: https://api.buywhere.ai). The /mcp path is
 *                        appended automatically; a trailing /mcp is tolerated.
 *
 * Tool schemas below are kept in lockstep with the live /mcp `tools/list`
 * contract. Run `npm run check-drift` to verify (scripts/check-schema-drift.mjs).
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
  type CallToolResult,
} from '@modelcontextprotocol/sdk/types.js';

const API_BASE_URL = (process.env.BUYWHERE_API_URL ?? 'https://api.buywhere.ai').replace(/\/$/, '');
const API_KEY = process.env.BUYWHERE_API_KEY ?? '';
// Older README revisions documented BUYWHERE_API_URL as already including /mcp.
// Tolerate that form so existing configs don't resolve to /mcp/mcp (404).
const MCP_URL = /\/mcp$/.test(API_BASE_URL) ? API_BASE_URL : `${API_BASE_URL}/mcp`;

if (!API_KEY) {
  process.stderr.write('Error: BUYWHERE_API_KEY environment variable is required.\n');
  process.exit(1);
}

const REQUEST_TIMEOUT_MS = 30_000;
const MAX_RETRIES = 2;
const RETRY_DELAY_BASE_MS = 1_000;

interface JsonRpcResponse {
  result?: CallToolResult;
  error?: { code: number; message: string };
}

/**
 * JSON-RPC error codes that are deterministic for a given request: retrying
 * cannot change the outcome, so surface them immediately instead of burning
 * the full backoff budget (~3s) on a guaranteed-identical answer.
 *   -32700 parse error   -32600 invalid request   -32601 method not found
 *   -32602 invalid params        -32001 BuyWhere NOT_FOUND (server-defined)
 * -32603 (internal error) is intentionally NOT listed — it can be transient.
 */
const NON_RETRYABLE_RPC_CODES = new Set([-32700, -32600, -32601, -32602, -32001]);

async function callRemoteTool(
  toolName: string,
  toolArgs: Record<string, unknown>,
): Promise<CallToolResult> {
  const body = JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: { name: toolName, arguments: toolArgs },
  });

  let lastError: Error | undefined;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      await new Promise<void>(resolve => setTimeout(resolve, RETRY_DELAY_BASE_MS * attempt));
    }
    try {
      const res = await fetch(MCP_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${API_KEY}`,
          'Content-Type': 'application/json',
        },
        body,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      const json = (await res.json()) as JsonRpcResponse;

      // JSON-RPC application-level error — surface as tool error.
      // Deterministic codes short-circuit; transient ones fall through to retry.
      if (json.error) {
        const msg = json.error.message;
        if (NON_RETRYABLE_RPC_CODES.has(json.error.code)) {
          return { content: [{ type: 'text', text: `Error: ${msg}` }], isError: true };
        }
        lastError = new Error(msg);
        continue;
      }

      if (!res.ok) {
        const isRetryable = res.status === 429 || res.status >= 500;
        if (!isRetryable) {
          throw new Error(`BuyWhere API error ${res.status}`);
        }
        lastError = new Error(`BuyWhere API error ${res.status}`);
        continue;
      }

      return json.result ?? { content: [{ type: 'text', text: '{}' }] };
    } catch (err) {
      if (err instanceof Error && /^BuyWhere API error 4(?!29)/.test(err.message)) {
        return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
      }
      const isTimeout =
        err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
      if (isTimeout) {
        process.stderr.write(
          `[buywhere-mcp] timeout (attempt ${attempt + 1}/${MAX_RETRIES + 1}): ${toolName}\n`,
        );
        lastError = new Error(`Request timed out after ${REQUEST_TIMEOUT_MS}ms`);
      } else {
        lastError = err instanceof Error ? err : new Error(String(err));
      }
    }
  }
  throw lastError ?? new Error('Unknown error');
}

// Tool schemas mirror the live /mcp endpoint (ingest_products excluded — admin-only).
const TOOLS: Tool[] = [
  {
    name: 'search_products',
    description:
      'Search the BuyWhere product catalog by keyword. Returns products from e-commerce platforms across multiple regions (Singapore, US, etc.). Use compact=true for agent-optimized responses with structured_specs, comparison_attributes, and normalized_price_usd fields.',
    inputSchema: {
      type: 'object',
      properties: {
        q: { type: 'string', description: 'Keyword search query' },
        query: {
          type: 'string',
          description:
            'Alias for q (accepted for agent convenience; use q in prompts).',
        },
        domain: {
          type: 'string',
          description: 'Filter by merchant platform (e.g. lazada, shopee, amazon)',
        },
        region: { type: 'string', description: 'Filter by region (sea, us, eu, au)' },
        country_code: {
          type: 'string',
          enum: ['SG', 'US', 'VN', 'TH', 'MY'],
          description:
            'Filter by ISO country code. Also infers default currency for price filters (SG→SGD, US→USD, VN→VND, TH→THB, MY→MYR).',
        },
        country: {
          type: 'string',
          description: 'Alias for country_code (deprecated, use country_code)',
        },
        deliver_to: {
          type: 'string',
          description:
            'Treat as REQUIRED for buyer-facing use: ISO-3166 country code for delivery destination (e.g. "SG", "US"). Used for location-aware pricing and availability.',
        },
        market: {
          type: 'string',
          description:
            'Alias for country_code (deprecated, use country_code instead).',
        },
        min_price: {
          type: 'number',
          description:
            'Minimum price (in currency inferred from country_code, or SGD by default)',
        },
        max_price: {
          type: 'number',
          description:
            'Maximum price (in currency inferred from country_code, or SGD by default)',
        },
        limit: {
          type: 'integer',
          description: 'Number of results (max 100, default 20)',
          default: 20,
        },
        offset: { type: 'integer', description: 'Pagination offset', default: 0 },
        compact: {
          type: 'boolean',
          description:
            'Return agent-optimized compact shape: structured_specs, comparison_attributes, normalized_price_usd. Reduces response size ~40%. Recommended for agent tool-use.',
          default: false,
        },
        category: {
          type: 'string',
          description:
            'Filter by product category name (e.g. "Laptops", "Smartphones", "Televisions"). Use to exclude accessories and get actual products.',
        },
        mode: {
          type: 'string',
          enum: ['keyword', 'semantic', 'hybrid'],
          description:
            'Search mode: keyword=FTS only (default, matches REST /v1/products/search), semantic=vector only, hybrid=RRF blend of FTS+vector. Falls back to keyword if vector DB or GEMINI_API_KEY unavailable.',
          default: 'hybrid',
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
        id: { type: 'string', description: 'Product UUID' },
      },
    },
  },
  {
    name: 'compare_products',
    description:
      'Compare multiple products side-by-side. Returns price, brand, rating, and category for each.',
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
    description:
      'Get discounted products sorted by discount percentage. Returns products with original price and discount percentage. Supports currency, region (sea, us, eu, au) and country (SG, US, VN, MY, ...) filters.',
    inputSchema: {
      type: 'object',
      properties: {
        min_discount: {
          type: 'number',
          description: 'Minimum discount percentage (default 10)',
          default: 10,
        },
        currency: {
          type: 'string',
          description: 'Filter by currency code (SGD, USD, MYR, VND, THB). Defaults to SGD.',
          default: 'SGD',
        },
        region: { type: 'string', description: 'Filter by region (sea, us, eu, au)' },
        country_code: {
          type: 'string',
          enum: ['SG', 'US', 'VN', 'TH', 'MY'],
          description: 'Filter by ISO country code. Alias: country.',
        },
        country: {
          type: 'string',
          description: 'Alias for country_code (deprecated, use country_code)',
        },
        deliver_to: {
          type: 'string',
          description:
            'Treat as REQUIRED for buyer-facing use: ISO-3166 country code for delivery destination (e.g. "SG", "US"). Used for location-aware pricing and availability.',
        },
        market: {
          type: 'string',
          description:
            'Alias for country_code (deprecated, use country_code instead).',
        },
        limit: {
          type: 'integer',
          description: 'Number of results (max 100, default 20)',
          default: 20,
        },
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
        country_code: {
          type: 'string',
          enum: ['SG', 'US', 'VN', 'TH', 'MY', 'GB', 'IN', 'AU'],
          description: 'Filter by ISO country code. Defaults to SG.',
        },
        country: {
          type: 'string',
          description: 'Alias for country_code (deprecated, use country_code)',
        },
        region: {
          type: 'string',
          enum: ['us', 'sg', 'my', 'gb', 'in', 'au'],
          description: 'Region alias mapped to ISO country code.',
        },
        market: {
          type: 'string',
          description:
            'Alias for country_code (deprecated, use country_code instead).',
        },
      },
    },
  },
  {
    name: 'find_best_price',
    description:
      "Use this whenever a user asks about prices, wants to find the cheapest option, or asks \"what's the best price for X\" or \"where can I buy X for the lowest price\". This finds the best current price across all merchants.",
    inputSchema: {
      type: 'object',
      properties: {
        q: {
          type: 'string',
          description: 'Keyword search query — alias for product_name.',
        },
        product_name: {
          type: 'string',
          description:
            'Product name to find best price for (e.g., "iphone 15 pro 256gb", "samsung galaxy s24")',
        },
        category: {
          type: 'string',
          description: 'Category to filter by (e.g., "electronics", "fashion")',
        },
        country_code: {
          type: 'string',
          enum: ['SG', 'MY', 'TH', 'PH', 'VN', 'ID', 'US'],
          description: 'Country to search in (defaults to SG). Alias: country.',
        },
        country: {
          type: 'string',
          description: 'Alias for country_code (deprecated, use country_code)',
        },
        deliver_to: {
          type: 'string',
          description:
            'Treat as REQUIRED for buyer-facing use: ISO-3166 country code for delivery destination (e.g. "SG", "US"). Used for location-aware pricing.',
        },
        market: {
          type: 'string',
          description:
            'Alias for country_code (deprecated, use country_code instead).',
        },
        region: {
          type: 'string',
          enum: ['us', 'sea'],
          description: 'Region filter — use "us" for United States or "sea" for Southeast Asia',
        },
      },
    },
  },
  {
    name: 'find_similar',
    description:
      'Find products similar to a given product using vector similarity. Returns up to 10 nearest neighbours by semantic meaning (title+description embedding). Useful for "more like this" recommendations.',
    inputSchema: {
      type: 'object',
      required: ['product_id'],
      properties: {
        product_id: { type: 'string', description: 'UUID of the source product' },
        limit: {
          type: 'integer',
          description: 'Number of similar products to return (1-10, default 10)',
          default: 10,
        },
      },
    },
  },
  {
    name: 'search_products_v2',
    description:
      'v2 of search_products — same capability with a cleaner, location-first parameter design. Search the BuyWhere product catalog by keyword with location-aware delivery pricing. Required: deliver_to ISO country code.',
    inputSchema: {
      type: 'object',
      required: ['deliver_to'],
      properties: {
        deliver_to: {
          type: 'string',
          description:
            'REQUIRED. Buyer delivery country/market (ISO country code, e.g. "SG", "US"). Used for location-aware pricing and availability.',
        },
        q: {
          type: 'string',
          description: 'Keyword search query.',
        },
        query: {
          type: 'string',
          description:
            'Alias for q (accepted for agent convenience; use q in prompts).',
        },
        domain: {
          type: 'string',
          description: 'Filter by merchant platform (e.g. lazada, shopee, amazon)',
        },
        region: { type: 'string', description: 'Filter by region (sea, us, eu, au)' },
        country_code: {
          type: 'string',
          enum: ['SG', 'US', 'VN', 'TH', 'MY'],
          description: 'Filter by ISO country code.',
        },
        country: {
          type: 'string',
          description: 'Alias for country_code (deprecated, use country_code)',
        },
        min_price: {
          type: 'number',
          description:
            'Minimum price (in currency inferred from country_code, or SGD by default)',
        },
        max_price: {
          type: 'number',
          description:
            'Maximum price (in currency inferred from country_code, or SGD by default)',
        },
        limit: {
          type: 'integer',
          description: 'Number of results (max 100, default 20)',
          default: 20,
        },
        offset: { type: 'integer', description: 'Pagination offset', default: 0 },
        compact: {
          type: 'boolean',
          description:
            'Return agent-optimized compact shape: structured_specs, comparison_attributes, normalized_price_usd. Reduces response size ~40%.',
          default: false,
        },
        category: {
          type: 'string',
          description: 'Filter by product category name (e.g. "Laptops", "Smartphones").',
        },
        mode: {
          type: 'string',
          enum: ['keyword', 'semantic', 'hybrid'],
          description:
            'Search mode: keyword=FTS only (default), semantic=vector only, hybrid=RRF blend. Falls back to keyword if vector DB or GEMINI_API_KEY unavailable.',
          default: 'hybrid',
        },
      },
    },
  },
  {
    name: 'get_product_v2',
    description:
      'v2 of get_product — get a specific product by its ID with location-aware pricing. Required: deliver_to ISO country code.',
    inputSchema: {
      type: 'object',
      required: ['deliver_to', 'id'],
      properties: {
        deliver_to: {
          type: 'string',
          description:
            'REQUIRED. ISO country code for delivery destination (e.g. "SG", "US").',
        },
        id: { type: 'string', description: 'Product UUID' },
      },
    },
  },
  {
    name: 'compare_products_v2',
    description:
      'v2 of compare_products — compare multiple products side-by-side with location-aware pricing. Required: deliver_to ISO country code.',
    inputSchema: {
      type: 'object',
      required: ['deliver_to', 'ids'],
      properties: {
        deliver_to: {
          type: 'string',
          description:
            'REQUIRED. ISO country code for delivery destination (e.g. "SG", "US").',
        },
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
    name: 'get_deals_v2',
    description:
      'v2 of get_deals — get discounted products with location-aware pricing. Required: deliver_to ISO country code.',
    inputSchema: {
      type: 'object',
      required: ['deliver_to'],
      properties: {
        deliver_to: {
          type: 'string',
          description:
            'REQUIRED. Buyer delivery country/market (ISO country code, e.g. "SG", "US").',
        },
        min_discount: {
          type: 'number',
          description: 'Minimum discount percentage (default 10)',
          default: 10,
        },
        currency: {
          type: 'string',
          description: 'Filter by currency code (SGD, USD, MYR, VND, THB).',
        },
        region: { type: 'string', description: 'Filter by region (sea, us, eu, au)' },
        country_code: {
          type: 'string',
          enum: ['SG', 'US', 'VN', 'TH', 'MY'],
          description: 'Filter by ISO country code. Alias: country.',
        },
        country: {
          type: 'string',
          description: 'Alias for country_code (deprecated, use country_code)',
        },
        limit: {
          type: 'integer',
          description: 'Number of results (max 100, default 20)',
          default: 20,
        },
        offset: { type: 'integer', description: 'Pagination offset', default: 0 },
      },
    },
  },
  {
    name: 'find_best_price_v2',
    description:
      'v2 of find_best_price — find the best current price across all merchants with location-aware pricing. Required: deliver_to ISO country code.',
    inputSchema: {
      type: 'object',
      required: ['deliver_to'],
      properties: {
        deliver_to: {
          type: 'string',
          description:
            'REQUIRED. Buyer delivery country/market (ISO country code, e.g. "SG", "US"). Used for location-aware pricing.',
        },
        q: {
          type: 'string',
          description: 'Keyword search query — alias for product_name.',
        },
        product_name: {
          type: 'string',
          description:
            'Product name to find best price for (e.g., "iphone 15 pro 256gb")',
        },
        category: {
          type: 'string',
          description: 'Category to filter by (e.g., "electronics", "fashion")',
        },
        country_code: {
          type: 'string',
          enum: ['SG', 'MY', 'TH', 'PH', 'VN', 'ID', 'US'],
          description: 'Country to search in (defaults to SG). Alias: country.',
        },
        country: {
          type: 'string',
          description: 'Alias for country_code (deprecated, use country_code)',
        },
        region: {
          type: 'string',
          enum: ['us', 'sea'],
          description: 'Region filter — use "us" for United States or "sea" for Southeast Asia',
        },
      },
    },
  },
];

const server = new Server(
  { name: 'buywhere-catalog', version: '0.5.0' },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params;
  try {
    return await callRemoteTool(name, args as Record<string, unknown>);
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
