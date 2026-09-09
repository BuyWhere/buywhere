const apiCatalog = {
  apis: [
    {
      name: "BuyWhere Catalog API",
      description: "Agent-native product search, offer comparison, and merchant handoff API for AI shopping agents. Indexes 370M+ products from 950,000+ merchants worldwide, normalized into one schema. Location-aware search accepts deliver_to=<ISO country> so agents rank products the end user can actually receive, with availability labels on every result.",
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
        selfServiceDescription: "POST /v1/auth/register?verify=false with {\"agent_name\":\"<name>\"} returns api_key instantly — no email, no human; 10,000 requests/day free",
      },
      pricing: {
        free: {
          rateLimit: "10 requests/min (free tier)",
          features: ["Product search", "Price comparison", "Deal discovery", "Affiliate links", "deliver_to availability labels"],
        },
        partner: {
          rateLimit: "10 requests/min (free tier)",
          features: ["All free features", "Higher rate limits", "Priority support", "Custom integration"],
        },
      },
      protocols: ["REST", "MCP"],
      mcp: {
        endpoint: "https://api.buywhere.ai/mcp",
        transport: "streamable-http",
        tools: [
          { name: "search_products", description: "Full-text/semantic/hybrid product search with merchant, price, category, country, and deliver_to filters." },
          { name: "search_products_v2", description: "Structured v2 search with the same filters and deliver_to-aware availability labels." },
          { name: "get_product", description: "Full product details by BuyWhere product ID." },
          { name: "get_product_v2", description: "Structured v2 product details by BuyWhere product ID." },
          { name: "compare_products", description: "Compare 2-5 products side-by-side." },
          { name: "compare_products_v2", description: "Structured v2 side-by-side product comparison." },
          { name: "get_deals", description: "Current discounted offers, filterable by market." },
          { name: "get_deals_v2", description: "Structured v2 deals with discount evidence." },
          { name: "list_categories", description: "Category tree of the catalog." },
          { name: "find_best_price", description: "Cheapest offer for a product intent, with merchant handoff." },
          { name: "find_best_price_v2", description: "Structured v2 best-price with offer count and alternatives." },
          { name: "find_similar", description: "Nearest-neighbour similar products by semantic embedding." },
          { name: "ingest_products", description: "Write tool: submit products (authenticated merchants only)." },
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
