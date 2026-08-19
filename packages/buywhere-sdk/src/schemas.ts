export interface BuyWhereScore {
  score: number;
  rank: number;
  reason_for_rank: string;
}

export interface MerchantReliability {
  score: number;
  tier: 'platinum' | 'gold' | 'silver' | 'standard';
  fulfillment_rating: number;
  last_fulfillment_at?: string;
}

export interface AvailabilityStatus {
  status: 'in_stock' | 'low_stock' | 'out_of_stock' | 'preorder' | 'unknown';
  stock_level?: number;
  restock_eta?: string;
}

export interface AgentSearchResult {
  buywhere_score: BuyWhereScore;
  confidence: number;
  merchant_reliability_score: MerchantReliability;
  availability_status: AvailabilityStatus;
  price_last_checked: string;
  exact_match: boolean;
}

export interface ResolveProductQueryInput {
  query: string;
  country?: Country;
  region?: 'us' | 'sea';
  limit?: number;
  price_min?: number;
  price_max?: number;
  include_out_of_stock?: boolean;
}

export interface ResolveProductQueryOutput {
  query_processed: string;
  total: number;
  results: Array<{
    product_id: number;
    title: string;
    buywhere_score: BuyWhereScore;
    confidence: number;
    merchant_reliability_score: MerchantReliability;
    availability_status: AvailabilityStatus;
    price_last_checked: string;
    exact_match: boolean;
    prices: Array<{
      merchant: string;
      price: number;
      currency: string;
      buy_url: string;
      affiliate_url?: string;
    }>;
  }>;
  query_time_ms: number;
  cache_hit: boolean;
}

export interface FindBestPriceInput {
  product_name: string;
  category?: string;
  country?: Country;
  region?: 'us' | 'sea';
}

export interface FindBestPriceOutput {
  product_name: string;
  best_price: {
    merchant: string;
    price: number;
    currency: string;
    buy_url: string;
    affiliate_url?: string;
  };
  all_prices: Array<{
    merchant: string;
    price: number;
    currency: string;
    price_diff?: number;
    savings_pct?: number;
  }>;
  buywhere_score: BuyWhereScore;
  confidence: number;
  merchant_reliability_score: MerchantReliability;
  price_last_checked: string;
  exact_match: boolean;
}

export interface CompareProductsInput {
  product_ids?: number[];
  category?: string;
  country?: Country;
  limit?: number;
}

export interface CompareProductsOutput {
  category?: {
    id: string;
    name: string;
    slug: string;
  };
  products: Array<{
    id: number;
    name: string;
    brand: string;
    buywhere_score: BuyWhereScore;
    confidence: number;
    merchant_reliability_score: MerchantReliability;
    availability_status: AvailabilityStatus;
    price_last_checked: string;
    exact_match: boolean;
    prices: MerchantPrice[];
    lowest_price: string;
    lowest_price_merchant: string;
  }>;
  meta: {
    total_products: number;
    total_merchants: number;
    last_updated: string;
  };
}

export interface GetProductDetailsInput {
  product_id: number;
  country?: Country;
  include_reviews?: boolean;
  include_price_history?: boolean;
}

export interface GetProductDetailsOutput {
  product: {
    id: number;
    name: string;
    brand: string;
    description: string;
    category: string;
    buywhere_score: BuyWhereScore;
    confidence: number;
    merchant_reliability_score: MerchantReliability;
    availability_status: AvailabilityStatus;
    price_last_checked: string;
    exact_match: boolean;
    prices: MerchantPrice[];
    lowest_price: string;
    lowest_price_merchant: string;
    image_url?: string;
    rating?: number;
    reviews_count?: number;
    last_updated: string;
  };
  reviews?: ReviewSummary;
  price_history?: PriceHistoryResponse;
}

export interface GetPurchaseOptionsInput {
  product_id: number;
  country?: Country;
  filter_merchant?: string;
  filter_price_min?: number;
  filter_price_max?: number;
  sort_by?: 'price_asc' | 'price_desc' | 'reliability' | 'rating';
}

export interface GetPurchaseOptionsOutput {
  product_id: number;
  product_name: string;
  buywhere_score: BuyWhereScore;
  confidence: number;
  options: Array<{
    merchant: string;
    price: number;
    currency: string;
    buy_url: string;
    affiliate_url?: string;
    in_stock: boolean;
    merchant_reliability_score: MerchantReliability;
    availability_status: AvailabilityStatus;
    price_last_checked: string;
    rating?: number;
    fulfillment_rating?: number;
  }>;
  recommended_merchant?: string;
  recommended_buy_url?: string;
}

export interface MetricsInput {
  country?: Country;
  category?: string;
  period?: '1h' | '24h' | '7d' | '30d';
}

export interface MetricsOutput {
  latency: {
    p50_ms: number;
    p95_ms: number;
    p99_ms: number;
    avg_ms: number;
  };
  accuracy: {
    exact_match_rate: number;
    relevance_score_avg: number;
    zero_results_rate: number;
  };
  freshness: {
    prices_updated_last_1h: number;
    prices_updated_last_24h: number;
    avg_price_freshness_minutes: number;
  };
  coverage: {
    total_products: number;
    products_with_current_price: number;
    total_merchants: number;
    active_merchants: number;
    country: Country;
    category?: string;
  };
  timestamp: string;
}

type Country = 'SG' | 'MY' | 'TH' | 'PH' | 'VN' | 'ID' | 'US';

interface MerchantPrice {
  merchant: string;
  price: string;
  currency: string;
  url: string;
  in_stock: boolean;
  rating?: number;
  last_updated: string;
  price_diff?: number;
  savings_pct?: number;
  best_value?: boolean;
}

interface ReviewSummary {
  product_id: number;
  product_name: string;
  overall_rating: number;
  total_reviews: number;
  retailer_reviews: Array<{
    retailer: string;
    rating: number;
    review_count: number;
    review_url: string;
  }>;
  last_updated: string;
}

interface PriceHistoryResponse {
  product_id: number;
  product_name: string;
  country: string;
  currency: string;
  period: string;
  price_history: Array<{
    date: string;
    price: number;
    currency: string;
    merchant?: string;
  }>;
  lowest_price: number;
  highest_price: number;
  average_price: number;
}

export const OPENAI_TOOL_SCHEMAS = {
  tools: [
    {
      type: 'function',
      function: {
        name: 'resolve_product_query',
        description: 'Use this whenever a user asks to find, search, or look up products — especially when they want product recommendations or need to discover options for a shopping decision. Examples: "find me a laptop under $1000", "what are the best wireless headphones", "show me phones available in Singapore".',
        parameters: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'Natural language search query for products (e.g., "mechanical keyboard", "iphone 15 case")',
            },
            country: {
              type: 'string',
              enum: ['SG', 'MY', 'TH', 'PH', 'VN', 'ID', 'US'],
              description: 'Country to search in (defaults to SG)',
            },
            region: {
              type: 'string',
              enum: ['us', 'sea'],
              description: 'Region filter - use "us" for United States or "sea" for Southeast Asia',
            },
            limit: {
              type: 'integer',
              minimum: 1,
              maximum: 50,
              default: 10,
              description: 'Maximum number of results to return',
            },
            price_min: {
              type: 'number',
              description: 'Minimum price filter',
            },
            price_max: {
              type: 'number',
              description: 'Maximum price filter',
            },
            include_out_of_stock: {
              type: 'boolean',
              default: false,
              description: 'Whether to include out-of-stock products in results',
            },
          },
          required: ['query'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'find_best_price',
        description: 'Use this whenever a user asks about prices, wants to find the cheapest option, or asks "what\'s the best price for X" or "where can I buy X for the lowest price". This finds the best current price across all merchants.',
        parameters: {
          type: 'object',
          properties: {
            product_name: {
              type: 'string',
              description: 'Product name to find best price for (e.g., "iphone 15 pro 256gb", "samsung galaxy s24")',
            },
            category: {
              type: 'string',
              description: 'Category to filter by (e.g., "electronics", "fashion")',
            },
            country: {
              type: 'string',
              enum: ['SG', 'MY', 'TH', 'PH', 'VN', 'ID', 'US'],
              description: 'Country to search in (defaults to SG)',
            },
            region: {
              type: 'string',
              enum: ['us', 'sea'],
              description: 'Region filter - use "us" for United States or "sea" for Southeast Asia',
            },
          },
          required: ['product_name'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'compare_products',
        description: 'Use this whenever a user wants to compare multiple products, see side-by-side price comparisons, or understand the differences between product options. Returns products sorted by price with merchant listings.',
        parameters: {
          type: 'object',
          properties: {
            product_ids: {
              type: 'array',
              items: { type: 'integer' },
              description: 'Array of product IDs to compare',
            },
            category: {
              type: 'string',
              description: 'Category slug to filter products for comparison (e.g., "electronics", "fashion")',
            },
            country: {
              type: 'string',
              enum: ['SG', 'MY', 'TH', 'PH', 'VN', 'ID', 'US'],
              description: 'Country to search in (defaults to SG)',
            },
            limit: {
              type: 'integer',
              minimum: 1,
              maximum: 50,
              default: 10,
              description: 'Maximum number of products to compare',
            },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'get_product_details',
        description: 'Use this whenever a user wants detailed information about a specific product, needs to see all available prices from different merchants, or wants to see product reviews and price history. Requires a product_id from a previous search.',
        parameters: {
          type: 'object',
          properties: {
            product_id: {
              type: 'integer',
              description: 'The unique product ID to get details for',
            },
            country: {
              type: 'string',
              enum: ['SG', 'MY', 'TH', 'PH', 'VN', 'ID', 'US'],
              description: 'Country to get product details for (defaults to SG)',
            },
            include_reviews: {
              type: 'boolean',
              default: false,
              description: 'Include review summary in response',
            },
            include_price_history: {
              type: 'boolean',
              default: false,
              description: 'Include price history in response',
            },
          },
          required: ['product_id'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'get_purchase_options',
        description: 'Use this whenever a user is ready to buy and wants to see all purchase options, needs merchant choices for a product, or wants to compare fulfillment ratings and reliability across merchants. Returns all merchants with pricing and reliability scores.',
        parameters: {
          type: 'object',
          properties: {
            product_id: {
              type: 'integer',
              description: 'The unique product ID to get purchase options for',
            },
            country: {
              type: 'string',
              enum: ['SG', 'MY', 'TH', 'PH', 'VN', 'ID', 'US'],
              description: 'Country to get purchase options for (defaults to SG)',
            },
            filter_merchant: {
              type: 'string',
              description: 'Filter results to a specific merchant',
            },
            filter_price_min: {
              type: 'number',
              description: 'Minimum price filter',
            },
            filter_price_max: {
              type: 'number',
              description: 'Maximum price filter',
            },
            sort_by: {
              type: 'string',
              enum: ['price_asc', 'price_desc', 'reliability', 'rating'],
              default: 'price_asc',
              description: 'How to sort purchase options',
            },
          },
          required: ['product_id'],
        },
      },
    },
  ],
} as const;

export const MCP_TOOL_DEFINITIONS = [
  {
    name: 'resolve_product_query',
    description: 'Use this whenever a user asks to find, search, or look up products — especially when they want product recommendations or need to discover options for a shopping decision. Examples: "find me a laptop under $1000", "what are the best wireless headphones", "show me phones available in Singapore".',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Natural language search query for products' },
        country: { type: 'string', enum: ['SG', 'MY', 'TH', 'PH', 'VN', 'ID', 'US'] },
        region: { type: 'string', enum: ['us', 'sea'] },
        limit: { type: 'integer', minimum: 1, maximum: 50, default: 10 },
        price_min: { type: 'number' },
        price_max: { type: 'number' },
        include_out_of_stock: { type: 'boolean', default: false },
      },
      required: ['query'],
    },
  },
  {
    name: 'find_best_price',
    description: 'Use this whenever a user asks about prices, wants to find the cheapest option, or asks "what\'s the best price for X". This finds the best current price across all merchants.',
    inputSchema: {
      type: 'object',
      properties: {
        product_name: { type: 'string', description: 'Product name to find best price for' },
        category: { type: 'string' },
        country: { type: 'string', enum: ['SG', 'MY', 'TH', 'PH', 'VN', 'ID', 'US'] },
        region: { type: 'string', enum: ['us', 'sea'] },
      },
      required: ['product_name'],
    },
  },
  {
    name: 'compare_products',
    description: 'Use this whenever a user wants to compare multiple products or see side-by-side price comparisons.',
    inputSchema: {
      type: 'object',
      properties: {
        product_ids: { type: 'array', items: { type: 'integer' } },
        category: { type: 'string' },
        country: { type: 'string', enum: ['SG', 'MY', 'TH', 'PH', 'VN', 'ID', 'US'] },
        limit: { type: 'integer', minimum: 1, maximum: 50, default: 10 },
      },
    },
  },
  {
    name: 'get_product_details',
    description: 'Use this whenever a user wants detailed information about a specific product or needs to see all available prices from different merchants.',
    inputSchema: {
      type: 'object',
      properties: {
        product_id: { type: 'integer' },
        country: { type: 'string', enum: ['SG', 'MY', 'TH', 'PH', 'VN', 'ID', 'US'] },
        include_reviews: { type: 'boolean', default: false },
        include_price_history: { type: 'boolean', default: false },
      },
      required: ['product_id'],
    },
  },
  {
    name: 'get_purchase_options',
    description: 'Use this whenever a user is ready to buy and wants to see all purchase options or compare merchants.',
    inputSchema: {
      type: 'object',
      properties: {
        product_id: { type: 'integer' },
        country: { type: 'string', enum: ['SG', 'MY', 'TH', 'PH', 'VN', 'ID', 'US'] },
        filter_merchant: { type: 'string' },
        filter_price_min: { type: 'number' },
        filter_price_max: { type: 'number' },
        sort_by: { type: 'string', enum: ['price_asc', 'price_desc', 'reliability', 'rating'], default: 'price_asc' },
      },
      required: ['product_id'],
    },
  },
] as const;

export const AGENT_RESULT_SCHEMA = {
  type: 'object',
  properties: {
    buywhere_score: {
      type: 'object',
      properties: {
        score: { type: 'number', description: 'Overall BuyWhere quality score (0-100)' },
        rank: { type: 'integer', description: 'Ranking position among results' },
        reason_for_rank: { type: 'string', description: 'Explanation of why this product was ranked this way' },
      },
      required: ['score', 'rank', 'reason_for_rank'],
    },
    confidence: {
      type: 'number',
      minimum: 0,
      maximum: 1,
      description: 'Confidence score for the match quality (0-1)',
    },
    merchant_reliability_score: {
      type: 'object',
      properties: {
        score: { type: 'number', description: 'Merchant reliability score (0-100)' },
        tier: { type: 'string', enum: ['platinum', 'gold', 'silver', 'standard'] },
        fulfillment_rating: { type: 'number', description: 'Fulfillment rating (0-5)' },
        last_fulfillment_at: { type: 'string', description: 'ISO timestamp of last successful fulfillment' },
      },
      required: ['score', 'tier'],
    },
    availability_status: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['in_stock', 'low_stock', 'out_of_stock', 'preorder', 'unknown'] },
        stock_level: { type: 'integer', description: 'Estimated units available' },
        restock_eta: { type: 'string', description: 'Estimated restock date if out of stock' },
      },
      required: ['status'],
    },
    price_last_checked: {
      type: 'string',
      format: 'date-time',
      description: 'ISO timestamp of when the price was last verified',
    },
    exact_match: {
      type: 'boolean',
      description: 'Whether this is an exact match to the query or an approximate/fuzzy match',
    },
  },
  required: ['buywhere_score', 'confidence', 'merchant_reliability_score', 'availability_status', 'price_last_checked', 'exact_match'],
} as const;

export const QUERY_RESULT_SCHEMA = {
  type: 'object',
  properties: {
    query_processed: { type: 'string', description: 'The search query after processing/normalization' },
    total: { type: 'integer', description: 'Total number of matching products' },
    results: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          product_id: { type: 'integer' },
          title: { type: 'string' },
          buywhere_score: AGENT_RESULT_SCHEMA.properties.buywhere_score,
          confidence: AGENT_RESULT_SCHEMA.properties.confidence,
          merchant_reliability_score: AGENT_RESULT_SCHEMA.properties.merchant_reliability_score,
          availability_status: AGENT_RESULT_SCHEMA.properties.availability_status,
          price_last_checked: AGENT_RESULT_SCHEMA.properties.price_last_checked,
          exact_match: AGENT_RESULT_SCHEMA.properties.exact_match,
          prices: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                merchant: { type: 'string' },
                price: { type: 'number' },
                currency: { type: 'string' },
                buy_url: { type: 'string' },
                affiliate_url: { type: 'string' },
              },
            },
          },
        },
      },
    },
    query_time_ms: { type: 'integer', description: 'Query processing time in milliseconds' },
    cache_hit: { type: 'boolean', description: 'Whether the result was served from cache' },
  },
  required: ['query_processed', 'total', 'results', 'query_time_ms'],
} as const;
