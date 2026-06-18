const apiCatalog = {
  apis: [
    {
      name: "BuyWhere Catalog API",
      description: "Product search, offer comparison, and merchant handoff API for AI shopping agents. Indexes 5M+ products from 40+ retailers across Singapore, Southeast Asia, and the US. Purpose-built for AI shopping agents with BM25-ranked search, structured price comparison, deals discovery, and affiliate link tracking.",
      documentationUrl: "https://buywhere.ai/docs/API_DOCUMENTATION",
      specificationUrl: "https://api.buywhere.ai/openapi.json",
      signupUrl: "https://buywhere.ai/api-keys",
      authentication: {
        type: "apiKey",
        in: "header",
        headerName: "Authorization",
        scheme: "Bearer",
        documentationUrl: "https://buywhere.ai/api-keys",
        selfService: true,
        selfServiceDescription: "POST /v1/auth/register with {\"agent_name\":\"<name>\"} returns api_key in 3 seconds, no email required",
      },
      pricing: {
        free: {
          rateLimit: "100 requests/min",
          features: ["Product search", "Price comparison", "Deal discovery", "Affiliate links"],
        },
        partner: {
          rateLimit: "1000 requests/min",
          features: ["All free features", "Higher rate limits", "Priority support", "Custom integration"],
        },
      },
      protocols: ["REST", "MCP"],
      mcp: {
        endpoint: "https://api.buywhere.ai/mcp",
        tools: [
          {
            name: "search_products",
            description: "Search and compare products across retailers. Returns structured results with prices, offers, and affiliate links.",
          },
          {
            name: "get_deals",
            description: "Find current deals, discounts, and price drops across all retailers.",
          },
          {
            name: "get_price_history",
            description: "Retrieve historical price data for a specific product.",
          },
          {
            name: "compare_prices",
            description: "Compare prices for a specific product across multiple retailers.",
          },
          {
            name: "get_retailers",
            description: "List supported retailers and their regions.",
          },
        ],
      },
      regions: ["SG", "MY", "ID", "TH", "PH", "VN", "US"],
      categories: ["electronics", "fashion", "home-garden", "sports", "toys", "books", "automotive", "health-beauty", "groceries"],
      support: {
        contact: "https://buywhere.ai/contact",
        quickstart: "https://buywhere.ai/quickstart",
        docs: "https://buywhere.ai/docs/API_DOCUMENTATION",
        changelog: "https://buywhere.ai/changelog",
      },
    },
  ],
};

export function GET() {
  return Response.json(apiCatalog, {
    headers: {
      "Cache-Control": "public, max-age=3600",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
