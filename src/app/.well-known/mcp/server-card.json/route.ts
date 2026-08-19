const serverCard = {
  name: "buywhere-catalog",
  title: "BuyWhere Catalog MCP Server",
  description: "Agent-native product catalog API. Search, compare, and retrieve products from 7 merchants (Shopee, Lazada, Amazon SG, Amazon US, Walmart, FairPrice, Carousell) across Singapore and the United States. Use deliver_to on the v2 tool surface (search_products_v2, find_best_price_v2, get_deals_v2) to rank products your end user can receive, with availability labels on every result.",
  version: "1.1.0",
  homepage: "https://buywhere.ai",
  documentation: "https://api.buywhere.ai/docs/agent-dx",
  transports: [
    {
      type: "streamable-http",
      url: "https://mcp.buywhere.ai/mcp",
    },
  ],
  authentication: {
    type: "apiKey",
    scheme: "Bearer",
    documentation: "https://buywhere.ai/api-keys",
  },
  // BUY-71820 (P2.7) — surface v2 tool surface. v2 is "announced" not "live" until
  // Rex's wire PR lands. Once v2 ships, move search_products_v2 / find_best_price_v2
  // / get_deals_v2 into the top-level `tools` array and set
  // `recommended_version: "v2"`. Until then, the v1 tools below are the only ones
  // callable; the v2 block documents the upcoming contract so agents can be built
  // against a stable target.
  versions: {
    v1: {
      status: "live",
      sunset: "no date set (v2 adoption ≥80% triggers 2026-Q1 sunset RFC)",
      tools: ["search_products", "find_best_price", "get_deals"],
    },
    v2: {
      status: "announced",
      ships_in: "P2.7 (Rex, ~3 days after spec sign-off)",
      required_param: "deliver_to (ISO 3166-1 alpha-2 country code, e.g. SG, US, MY)",
      tools: ["search_products_v2", "find_best_price_v2", "get_deals_v2"],
      migration_guide: "https://api.buywhere.ai/docs/agent-dx#migration-guide-v1-v2",
    },
    recommended_version: "v1",
  },
  tools: [
    {
      name: "search_products",
      description:
        "Search the BuyWhere product catalog by keyword. Returns ranked results from 7 merchants across Singapore and the United States.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Keyword search query" },
          category: { type: "string", description: "Category slug filter" },
          min_price: { type: "number", description: "Minimum price" },
          max_price: { type: "number", description: "Maximum price" },
          source: { type: "string", description: "Merchant platform filter" },
          limit: { type: "integer", default: 10, description: "Max results (1-50)" },
        },
        required: ["query"],
      },
    },
    {
      name: "get_product",
      description: "Retrieve full details for a specific product by its BuyWhere product ID.",
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
      description: "Find the single cheapest listing for a product across all covered merchants in Singapore and the United States.",
      inputSchema: {
        type: "object",
        properties: {
          product_name: { type: "string", description: "Product name to search for" },
          category: { type: "string", description: "Category slug filter" },
        },
      },
    },
    {
      name: "get_deals",
      description: "Find products with significant price drops compared to their original price.",
      inputSchema: {
        type: "object",
        properties: {
          category: { type: "string", description: "Category slug filter" },
          min_discount_pct: { type: "number", default: 10, description: "Minimum discount percentage" },
          limit: { type: "integer", default: 20, description: "Max results" },
        },
      },
    },
    {
      name: "compare_products",
      description: "Compare 2 to 10 products side-by-side across merchants.",
      inputSchema: {
        type: "object",
        properties: {
          ids: { type: "string", description: "Comma-separated BuyWhere product IDs (2-10)" },
        },
        required: ["ids"],
      },
    },
    {
      name: "list_categories",
      description: "List top-level product categories with product counts.",
      inputSchema: {
        type: "object",
        properties: {
          currency: { type: "string", description: "Currency code (default SGD)" },
        },
      },
    },
  ],
  // v2 tool surface — advertised for forward planning; not yet callable.
  // These schemas match docs/agent-dx.md and the P2.7 spec. Once Rex's wire
  // PR ships, move these entries into the top-level `tools` array above and
  // remove this block.
  tools_v2_announced: [
    {
      name: "search_products_v2",
      description:
        "Search the BuyWhere product catalog by keyword. v2 requires deliver_to so results can be ranked for the end user's market, with per-row availability. include_unshippable defaults to true on v2 (v1 default was false).",
      inputSchema: {
        type: "object",
        required: ["query", "deliver_to"],
        properties: {
          query: { type: "string", description: "Keyword search query" },
          deliver_to: {
            type: "string",
            description: "End-user ISO 3166-1 alpha-2 country code (e.g. SG, US, MY, TH, ID, VN, PH, GB, AU, IN). Required on v2.",
          },
          category: { type: "string", description: "Category slug filter" },
          min_price: { type: "number", description: "Minimum price (currency inferred from deliver_to)" },
          max_price: { type: "number", description: "Maximum price (currency inferred from deliver_to)" },
          source: { type: "string", description: "Merchant platform filter" },
          include_unshippable: {
            type: "boolean",
            default: true,
            description: "Include results that cannot ship to deliver_to. v2 default true; v1 default false.",
          },
          limit: { type: "integer", default: 10, description: "Max results (1-50)" },
        },
      },
    },
    {
      name: "find_best_price_v2",
      description:
        "Find the single cheapest deliverable listing for a product across covered merchants. v2 requires deliver_to.",
      inputSchema: {
        type: "object",
        required: ["product_name", "deliver_to"],
        properties: {
          product_name: { type: "string", description: "Product name to search for" },
          deliver_to: {
            type: "string",
            description: "End-user ISO 3166-1 alpha-2 country code. Required on v2.",
          },
          category: { type: "string", description: "Category slug filter" },
          include_unshippable: { type: "boolean", default: false },
        },
      },
    },
    {
      name: "get_deals_v2",
      description:
        "Find products with significant price drops, deliverability-filtered. v2 requires deliver_to.",
      inputSchema: {
        type: "object",
        required: ["deliver_to"],
        properties: {
          deliver_to: {
            type: "string",
            description: "End-user ISO 3166-1 alpha-2 country code. Required on v2.",
          },
          category: { type: "string", description: "Category slug filter" },
          min_discount_pct: { type: "number", default: 10, description: "Minimum discount percentage" },
          include_unshippable: { type: "boolean", default: true },
          limit: { type: "integer", default: 20, description: "Max results" },
        },
      },
    },
  ],
};

export function GET() {
  return Response.json(serverCard, {
    headers: {
      "Cache-Control": "public, max-age=3600",
    },
  });
}
