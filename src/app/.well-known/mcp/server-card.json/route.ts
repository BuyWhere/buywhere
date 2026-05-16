const serverCard = {
  name: "buywhere-catalog",
  title: "BuyWhere Catalog MCP Server",
  description: "Agent-native product catalog API. Search, compare, and retrieve products from 7 merchants (Shopee, Lazada, Amazon SG, Amazon US, Walmart, FairPrice, Carousell) across Singapore and the United States.",
  version: "1.0.0",
  homepage: "https://buywhere.ai",
  documentation: "https://api.buywhere.ai/docs/guides/mcp",
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
  ],
};

export function GET() {
  return Response.json(serverCard, {
    headers: {
      "Cache-Control": "public, max-age=3600",
    },
  });
}
