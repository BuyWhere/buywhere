export const BUYWHERE_FUNCTIONS = [
  {
    type: 'function' as const,
    function: {
      name: 'search_products',
      description: 'Search the BuyWhere product catalog by keyword, price range, platform, region, and country. Returns product listings with prices, merchant info, and availability.',
      parameters: {
        type: 'object',
        properties: {
          q: {
            type: 'string',
            description: 'Keyword search query (full-text, e.g. "wireless headphones", "iphone 15 case")',
          },
          country_code: {
            type: 'string',
            enum: ['SG', 'US', 'VN', 'TH', 'MY', 'ID', 'PH'],
            description: 'ISO country code to filter by region (default: SG)',
          },
          domain: {
            type: 'string',
            description: 'Filter by merchant platform (e.g. lazada, shopee, amazon_sg)',
          },
          min_price: {
            type: 'number',
            description: 'Minimum price in the active currency',
          },
          max_price: {
            type: 'number',
            description: 'Maximum price in the active currency',
          },
          currency: {
            type: 'string',
            default: 'SGD',
            description: 'Currency for price filters (SGD, USD, VND, THB, MYR)',
          },
          limit: {
            type: 'integer',
            default: 20,
            maximum: 100,
            description: 'Maximum number of results to return',
          },
          offset: {
            type: 'integer',
            default: 0,
            description: 'Offset for pagination',
          },
          compact: {
            type: 'boolean',
            default: false,
            description: 'Return minimal payload for AI agents (id, title, price, currency, url, specs)',
          },
        },
        required: ['q'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_product',
      description: 'Get full product details and current price by product ID. Includes brand, category, ratings, merchant info, and specifications.',
      parameters: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            format: 'uuid',
            description: 'The unique product ID',
          },
          currency: {
            type: 'string',
            default: 'SGD',
            description: 'Currency for price display',
          },
        },
        required: ['id'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'compare_products',
      description: 'Compare 2-10 products side-by-side across merchants: price, brand, rating, category path, and merchant. For AI agent price comparison shopping.',
      parameters: {
        type: 'object',
        properties: {
          ids: {
            type: 'array',
            items: { type: 'string' },
            minItems: 2,
            maxItems: 10,
            description: 'Product IDs to compare (2-10)',
          },
        },
        required: ['ids'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_deals',
      description: 'Get discounted products sorted by discount percentage across all merchants. Returns original price, current price, and discount percentage.',
      parameters: {
        type: 'object',
        properties: {
          country_code: {
            type: 'string',
            enum: ['SG', 'US', 'VN', 'TH', 'MY', 'ID', 'PH'],
            description: 'ISO country code to filter deals by region',
          },
          min_discount: {
            type: 'number',
            default: 10,
            description: 'Minimum discount percentage (0-90)',
          },
          currency: {
            type: 'string',
            default: 'SGD',
            description: 'Currency for price display',
          },
          limit: {
            type: 'integer',
            default: 20,
            maximum: 100,
            description: 'Maximum number of deals to return',
          },
          offset: {
            type: 'integer',
            default: 0,
            description: 'Offset for pagination',
          },
        },
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'list_categories',
      description: 'List top-level product categories available in the BuyWhere catalog with slugs, names, and product counts.',
      parameters: {
        type: 'object',
        properties: {
          country_code: {
            type: 'string',
            enum: ['SG', 'US', 'VN', 'TH', 'MY'],
            default: 'SG',
            description: 'Country to scope categories to',
          },
        },
      },
    },
  },
] as const;

export type BuyWhereFunctionName = (typeof BUYWHERE_FUNCTIONS)[number]['function']['name'];

export function getFunctionSchema(name: BuyWhereFunctionName) {
  return BUYWHERE_FUNCTIONS.find((f) => f.function.name === name);
}
