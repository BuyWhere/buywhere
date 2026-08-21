export const serverCard = {
  name: "buywhere-catalog",
  title: "BuyWhere Catalog MCP Server",
  description: "Agent-native product catalog API. Search, compare, and retrieve products from 392M+ products across 891,000+ storefronts worldwide. Use deliver_to to rank products your end user can receive, with availability labels on every result.",
  version: "1.0.0",
  homepage: "https://buywhere.ai",
  documentation: "https://api.buywhere.ai/docs/guides/mcp",
  transports: [
    {
      type: "streamable-http",
      url: "https://api.buywhere.ai/mcp",
    },
    {
      type: "sse",
      url: "https://api.buywhere.ai/mcp/sse",
      notes: "Legacy SSE endpoint for clients that explicitly require SSE transport.",
    },
  ],
  authentication: {
    type: "apiKey",
    scheme: "Bearer",
    documentation: "https://buywhere.ai/api-keys",
  },
  tools: [
    {
      name: "search_products",
      description:
        "Search the BuyWhere product catalog by keyword. Returns ranked results from 392M+ products worldwide with deliver_to-aware availability labels.",
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
      description: "Find the single cheapest deliverable listing for a product across covered storefronts worldwide.",
      inputSchema: {
        type: "object",
        properties: {
          product_name: { type: "string", description: "Product name to search for" },
          category: { type: "string", description: "Category slug filter" },
          deliver_to: { type: "string", description: "End-user ISO country code for availability-aware ranking" },
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
          deliver_to: { type: "string", description: "End-user ISO country code for deliverability filtering" },
          limit: { type: "integer", default: 20, description: "Max results" },
        },
      },
    },
    {
      name: "compare_products",
      description: "Compare 2 to 10 products side-by-side across merchants, prices, attributes, and availability.",
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
      description: "List top-level product categories with product counts.",
      inputSchema: {
        type: "object",
        properties: {
          currency: { type: "string", description: "Currency code (default SGD)" },
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
