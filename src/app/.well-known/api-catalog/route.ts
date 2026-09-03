const apiCatalog = {
  apis: [
    {
      name: "BuyWhere Catalog API",
      description: "Agent-native product search, offer comparison, and merchant handoff API for AI shopping agents. Indexes 381M+ products from 950,000+ merchants worldwide, normalized into one schema. Location-aware search accepts deliver_to=<ISO country> so agents rank products the end user can actually receive, with availability labels on every result.",
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
        selfServiceDescription: "POST /v1/auth/register?verify=false with {\"agent_name\":\"<name>\"} returns api_key instantly — no email, no human; 1,000 requests/day free",
      },
      pricing: {
        free: {
          rateLimit: "100 requests/min",
          features: ["Product search", "Price comparison", "Deal discovery", "Affiliate links", "deliver_to availability labels"],
        },
        partner: {
          rateLimit: "1000 requests/min",
          features: ["All free features", "Higher rate limits", "Priority support", "Custom integration"],
        },
      },
      protocols: ["REST", "MCP"],
      mcp: {
        endpoint: "https://api.buywhere.ai/mcp",
        transport: "streamable-http",
        tools: [
          {
            name: "search_products",
            description: "Search and compare products across storefronts worldwide. Returns structured results with prices, offers, affiliate links, and deliver_to-aware availability labels.",
          },
          {
            name: "get_deals",
            description: "Find current deals, discounts, and price drops across 950,000+ retailers in the BuyWhere catalog.",
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
      regions: ["US", "SG", "GB", "EU", "AU", "MY", "ID", "TH", "PH", "VN"],
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
