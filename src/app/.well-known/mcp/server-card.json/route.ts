const serverCard = {
  name: "buywhere-catalog",
  title: "BuyWhere Catalog MCP Server",
  description: "Search products, compare offers, and generate merchant handoff paths for AI shopping agents.",
  version: "1.0.0",
  homepage: "https://buywhere.ai/integrate",
  documentation: "https://buywhere.ai/docs/quickstart-mcp",
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
  },
  tools: [
    {
      name: "search_products",
      description: "Search normalized product records by keyword, category, merchant, and price context for AI shopping agents.",
    },
    {
      name: "compare_products",
      description: "Compare product candidates, prices, merchants, and availability signals for AI shopping agents.",
    },
    {
      name: "get_product_offers",
      description: "Retrieve merchant offers, price facts, and availability metadata for AI shopping agents.",
    },
    {
      name: "get_merchant_handoff",
      description: "Generate source merchant handoff paths and affiliate-aware routing metadata for AI shopping agents.",
    },
    {
      name: "get_catalog_status",
      description: "Inspect catalog freshness, coverage, and operational status for AI shopping agents.",
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
