// P2.7 v2-first MCP server-card. Wire version: v2.0.0-2026-09-15.
// v2 tools are listed first; v1 tools remain for the sunset clock.
//
// Sunset dates (Reed / BUY-72531):
//   2026-09-15Z — v2 wire live; v2 tools required deliver_to.
//   2026-10-01Z — v1 tools deprecated; prepend "[DEPRECATED — use v2]".
//   2026-12-31Z — v1 tools return HTTP 410 Gone; card omits v1.

const V2_VERSION = "v2.0.0-2026-09-15";
const V1_DEPRECATION_DATE = new Date("2026-10-01T00:00:00Z");
const V1_SUNSET_DATE = new Date("2026-12-31T23:59:59Z");

const v2Tools = [
  {
    name: "search_products_v2",
    description:
      "REQUIRED deliver_to. Search the BuyWhere product catalog by keyword with REQUIRED deliver_to. Returns ranked, deliverable-first results with schema.org/Product entities and a shopping_job_id envelope.",
    inputSchema: {
      type: "object",
      properties: {
        q: { type: "string", description: "Keyword search query (optional; supports browse-by-category and region-only queries)" },
        deliver_to: {
          type: "string",
          description: "Buyer delivery country/market (ISO 3166-1 alpha-2). REQUIRED.",
        },
        category: { type: "string", description: "Category slug filter" },
        min_price: { type: "number", description: "Minimum price" },
        max_price: { type: "number", description: "Maximum price" },
        source: { type: "string", description: "Merchant platform filter" },
        sort: { type: "string", enum: ["best_value", "lowest_price", "highest_rated"], default: "best_value" },
        limit: { type: "integer", default: 10, description: "Max results (1-50)" },
      },
      required: ["deliver_to"],
    },
  },
  {
    name: "find_best_price_v2",
    description:
      "REQUIRED deliver_to. Find the cheapest deliverable listing for a product across covered storefronts with REQUIRED deliver_to. Returns a shopping_job_id and a resolved outbound_url.",
    inputSchema: {
      type: "object",
      properties: {
        q: { type: "string", description: "Keyword search query — alias for product_name" },
        product_name: { type: "string", description: "Product name to find best price for (e.g., \"iphone 15 pro 256gb\", \"samsung galaxy s24\")" },
        deliver_to: {
          type: "string",
          description: "Buyer delivery country/market (ISO 3166-1 alpha-2). REQUIRED.",
        },
        category: { type: "string", description: "Category slug filter" },
      },
      required: ["deliver_to"],
    },
  },
  {
    name: "get_deals_v2",
    description:
      "REQUIRED deliver_to. Discounted products sorted by discount percentage with REQUIRED deliver_to. Returns a shopping_job_id envelope so the agent hands the user a single outbound_url.",
    inputSchema: {
      type: "object",
      properties: {
        deliver_to: {
          type: "string",
          description: "Buyer delivery country/market (ISO 3166-1 alpha-2). REQUIRED.",
        },
        category: { type: "string", description: "Category slug filter" },
        min_discount_pct: { type: "number", default: 10, description: "Minimum discount percentage" },
        limit: { type: "integer", default: 20, description: "Max results" },
      },
      required: ["deliver_to"],
    },
  },
  {
    name: "compare_products_v2",
    description:
      "REQUIRED deliver_to. Compare 2 to 10 products side-by-side with REQUIRED deliver_to. Each row carries the buyer's deliver_to availability state.",
    inputSchema: {
      type: "object",
      properties: {
        ids: {
          type: "array",
          items: { type: "string" },
          minItems: 2,
          maxItems: 10,
          description: "Array of BuyWhere product IDs (2-10)",
        },
        deliver_to: {
          type: "string",
          description: "Buyer delivery country/market (ISO 3166-1 alpha-2). REQUIRED.",
        },
      },
      required: ["ids", "deliver_to"],
    },
  },
  {
    name: "get_product_v2",
    description:
      "REQUIRED deliver_to. Retrieve full details for a specific product with REQUIRED deliver_to. Adds an outbound_url resolver so the agent can return a direct handoff to the merchant.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "BuyWhere product ID" },
        deliver_to: {
          type: "string",
          description: "Buyer delivery country/market (ISO 3166-1 alpha-2). REQUIRED.",
        },
      },
      required: ["id", "deliver_to"],
    },
  },
];

const v1Tools = [
  {
    name: "search_products",
    description:
      "Search the BuyWhere product catalog by keyword. deliver_to is optional in v1 but strongly recommended; the v2 surface (search_products_v2) requires it. Returns deliverable-first availability labels.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Keyword search query" },
        category: { type: "string", description: "Category slug filter" },
        min_price: { type: "number", description: "Minimum price" },
        max_price: { type: "number", description: "Maximum price" },
        source: { type: "string", description: "Merchant platform filter" },
        deliver_to: { type: "string", description: "End-user ISO country code for deliverable-first ranking" },
        limit: { type: "integer", default: 10, description: "Max results (1-50)" },
      },
      required: ["query"],
    },
  },
  {
    name: "get_product",
    description: "Retrieve full details for a specific product by its BuyWhere product ID. v1 only — use get_product_v2 for the deliver_to-aware variant.",
    inputSchema: {
      type: "object",
      properties: {
        product_id: { type: "string", description: "BuyWhere product ID" },
      },
      required: ["product_id"],
    },
  },
  {
    name: "find_best_price",
    description: "Find the single cheapest deliverable listing for a product across covered storefronts. v1 only — use find_best_price_v2 for the deliver_to-aware variant.",
    inputSchema: {
      type: "object",
      properties: {
        product_name: { type: "string", description: "Product name to search for" },
        q: { type: "string", description: "Alias for product_name (deprecated, use product_name)." },
        category: { type: "string", description: "Category slug filter" },
        deliver_to: { type: "string", description: "End-user ISO country code for availability-aware ranking" },
      },
    },
  },
  {
    name: "get_deals",
    description: "Find products with significant price drops compared to their original price. v1 only — use get_deals_v2 for the deliver_to-aware variant.",
    inputSchema: {
      type: "object",
      properties: {
        category: { type: "string", description: "Category slug filter" },
        min_discount_pct: { type: "number", default: 10, description: "Minimum discount percentage" },
        deliver_to: { type: "string", description: "End-user ISO country code for deliverability filtering" },
        limit: { type: "integer", default: 20, description: "Max results" },
      },
    },
  },
  {
    name: "compare_products",
    description: "Compare 2 to 10 products side-by-side. v1 only — use compare_products_v2 for the deliver_to-aware variant with array ids.",
    inputSchema: {
      type: "object",
      properties: {
        ids: { type: "string", description: "Comma-separated BuyWhere product IDs (2-10)" },
        deliver_to: { type: "string", description: "End-user ISO country code for availability comparison" },
      },
      required: ["ids"],
    },
  },
  {
    name: "list_categories",
    description: "List top-level product categories with product counts. v1 only — not a buyer-context tool, so deliver_to is not required.",
    inputSchema: {
      type: "object",
      properties: {
        currency: { type: "string", description: "Currency code (default SGD)" },
      },
    },
  },
  {
    name: "find_similar",
    description: "Find products similar to a given product. v1 only — not a buyer-context tool.",
    inputSchema: {
      type: "object",
      properties: {
        product_id: { type: "string", description: "BuyWhere product ID" },
        limit: { type: "integer", default: 10, description: "Max results" },
      },
      required: ["product_id"],
    },
  },
  {
    name: "ingest_products",
    description: "Ingest or refresh a product URL in the catalog. v1 only — not a buyer-context tool.",
    inputSchema: {
      type: "object",
      properties: {
        product_url: { type: "string", description: "Product URL to ingest" },
      },
      required: ["product_url"],
    },
  },
];

function buildServerCard() {
  const now = new Date();
  const v1Deprecated = now >= V1_DEPRECATION_DATE && now < V1_SUNSET_DATE;
  const v1Sunset = now >= V1_SUNSET_DATE;

  const v1ToolsWithDeprecation = v1Tools.map((tool) => {
    if (!v1Deprecated) return tool;
    return {
      ...tool,
      description: `[DEPRECATED — use v2] ${tool.description}`,
    };
  });

  const tools = v1Sunset ? v2Tools : [...v2Tools, ...v1ToolsWithDeprecation];

  return {
    name: "buywhere-catalog",
    title: "BuyWhere Catalog MCP Server",
    description:
      "v2-first agent-native product catalog API. Use the v2 tools (search_products_v2, find_best_price_v2, get_deals_v2, compare_products_v2, get_product_v2) — all require deliver_to and return a shopping_job_id plus a resolved outbound_url. v1 tools remain listed until 2026-12-31Z (HTTP 410 Gone after).",
    version: "1.0.0",
    "x-buywhere-v2": V2_VERSION,
    homepage: "https://buywhere.ai",
    documentation: "https://buywhere.ai/agent-dx",
    transports: [
      {
        type: "streamable-http",
        url: "https://api.buywhere.ai/mcp",
      },
    ],
    authentication: {
      type: "apiKey",
      scheme: "Bearer",
      documentation: "https://buywhere.ai/api-keys",
      registration: {
        description: "Agents self-register with zero human steps",
        method: "POST",
        url: "https://api.buywhere.ai/v1/auth/register?verify=false",
        body: { agent_name: "<your-agent-name>" },
        returns: "api_key — 10,000 requests/day free, instantly",
      },
    },
    sunset: {
      v1_deprecation: "2026-10-01T00:00:00Z",
      v1_gone: "2026-12-31T23:59:59Z",
      v1_status: v1Sunset ? "gone" : v1Deprecated ? "deprecated" : "active",
    },
    tools,
  };
}

export const serverCard = buildServerCard();

export function GET() {
  return Response.json(serverCard, {
    headers: {
      "Cache-Control": "public, max-age=600",
      "Vary": "Accept",
    },
  });
}
