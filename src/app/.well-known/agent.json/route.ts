const AGENT_JSON = {
  name: 'Buywhere Product Catalog',
  description:
    'Agent-native product catalog and price comparison API: 288M+ products from 158,000+ storefronts worldwide, normalized into one schema with deliver_to delivery-location ranking and availability labels.',
  url: 'https://buywhere.ai',
  version: '1.0.0',
  capabilities: {
    streaming: true,
    pushNotifications: false,
    stateTransitionHistory: true,
  },
  authentication: {
    schemes: ['apiKey', 'oauth2'],
  },
  defaultInputModes: ['text'],
  defaultOutputModes: ['text', 'json'],
  skills: [
    {
      id: 'product-search',
      name: 'Product Search',
      description:
        'Search 288M+ products worldwide by keyword, category, price range, merchant, country, currency, and availability; pass deliver_to for the user delivery location to rank deliverable results first.',
      tags: ['e-commerce', 'search', 'products', 'global-catalog'],
      examples: [
        'Find espresso machines under 500 USD deliverable to Canada',
        'Search wireless headphones under 150 EUR with deliver_to=DE and availability labels',
      ],
    },
    {
      id: 'delivery-aware-comparison',
      name: 'Delivery-Aware Product Comparison',
      description:
        'Compare products across global storefronts by normalized price, rating, specs, merchant, and availability for a requested delivery location.',
      tags: ['comparison', 'delivery-location', 'availability', 'price-comparison'],
      examples: [
        'Compare iPhone 16 Pro prices available to ship to Australia',
        'Which standing desks are deliverable to Singapore with the best normalized USD price?',
      ],
    },
    {
      id: 'price-history',
      name: 'Price History & Alerts',
      description:
        'Retrieve historical price data and set price drop alerts using global product and availability context.',
      tags: ['pricing', 'history', 'alerts'],
      examples: [
        'Show me 30-day price history for this product with availability for delivery to GB',
        'Alert me when this drops below 50 USD and ships to my delivery location',
      ],
    },
    {
      id: 'merchant-discovery',
      name: 'Merchant & Affiliate Discovery',
      description:
        'Discover which of 158,000+ worldwide storefronts carry a product, whether each offer is deliverable to the user, and retrieve merchant handoff or affiliate links.',
      tags: ['merchants', 'affiliate', 'deals', 'worldwide'],
      examples: [
        'Which merchants sell noise-cancelling earbuds under 80 USD and deliver to the Philippines?',
        'Get the merchant handoff link for this listing if availability is local or ships_to_you',
      ],
    },
  ],
  protocols: {
    mcp: {
      serverUrl: 'https://api.buywhere.ai/mcp/sse',
      transport: 'sse',
      note: 'Use /mcp/sse for SSE clients; https://api.buywhere.ai/mcp is the canonical MCP endpoint in llms.txt and remains valid.',
    },
  },
};

export function GET() {
  return Response.json(AGENT_JSON, {
    headers: {
      'Cache-Control': 'public, max-age=86400',
    },
  });
}
