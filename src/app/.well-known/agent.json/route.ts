const AGENT_JSON = {
  name: 'Buywhere Product Catalog',
  description:
    'Agent-native product catalog and price comparison API covering 7 merchants across Singapore and the United States. Search, compare, and discover products from Shopee, Lazada, Amazon SG, Amazon US, Walmart, FairPrice, and Carousell.',
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
        'Search products by keyword, category, price range, and market across Singapore and US merchants',
      tags: ['e-commerce', 'search', 'products'],
      examples: [
        'Find Dyson hair dryer under 400 SGD in Singapore',
        'Wireless headphones under 150 USD on Amazon US or Walmart',
      ],
    },
    {
      id: 'cross-border-match',
      name: 'Cross-Border Product Matching',
      description:
        'Find equivalent products across Singapore and US markets with price and spec comparison',
      tags: ['cross-border', 'matching', 'price-comparison', 'affiliate'],
      examples: [
        'Compare this Shopee listing with Amazon US pricing',
        'Find the cheapest market for iPhone 16 Pro Max across SG and US',
      ],
    },
    {
      id: 'price-history',
      name: 'Price History & Alerts',
      description:
        'Retrieve historical price data and set up price drop alerts',
      tags: ['pricing', 'history', 'alerts'],
      examples: [
        'Show me 30-day price history for this product',
        'Alert me when this drops below 50 SGD',
      ],
    },
    {
      id: 'merchant-discovery',
      name: 'Merchant & Affiliate Discovery',
      description:
        'Discover which of the 7 covered merchants sell a product and retrieve affiliate links',
      tags: ['merchants', 'affiliate', 'deals'],
      examples: [
        'Which merchants sell wireless earbuds under 80 SGD?',
        'Get affiliate link for this Lazada listing',
      ],
    },
  ],
};

export function GET() {
  return Response.json(AGENT_JSON, {
    headers: {
      'Cache-Control': 'public, max-age=86400',
    },
  });
}
