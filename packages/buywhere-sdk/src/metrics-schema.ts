export const MACHINE_RELEVANT_METRICS_SCHEMA = {
  type: 'object',
  properties: {
    latency: {
      type: 'object',
      description: 'API response latency metrics',
      properties: {
        p50_ms: { type: 'number', description: '50th percentile latency in milliseconds' },
        p95_ms: { type: 'number', description: '95th percentile latency in milliseconds' },
        p99_ms: { type: 'number', description: '99th percentile latency in milliseconds' },
        avg_ms: { type: 'number', description: 'Average latency in milliseconds' },
      },
      required: ['p50_ms', 'p95_ms', 'p99_ms', 'avg_ms'],
    },
    accuracy: {
      type: 'object',
      description: 'Result quality and relevance metrics',
      properties: {
        exact_match_rate: { type: 'number', minimum: 0, maximum: 1, description: 'Rate of exact query matches (0-1)' },
        relevance_score_avg: { type: 'number', minimum: 0, maximum: 1, description: 'Average relevance score across results (0-1)' },
        zero_results_rate: { type: 'number', minimum: 0, maximum: 1, description: 'Rate of queries returning no results (0-1)' },
      },
      required: ['exact_match_rate', 'relevance_score_avg', 'zero_results_rate'],
    },
    freshness: {
      type: 'object',
      description: 'Data freshness metrics',
      properties: {
        prices_updated_last_1h: { type: 'integer', description: 'Number of prices updated in the last hour' },
        prices_updated_last_24h: { type: 'integer', description: 'Number of prices updated in the last 24 hours' },
        avg_price_freshness_minutes: { type: 'number', description: 'Average age of price data in minutes' },
      },
      required: ['prices_updated_last_1h', 'prices_updated_last_24h', 'avg_price_freshness_minutes'],
    },
    coverage: {
      type: 'object',
      description: 'Catalog coverage metrics',
      properties: {
        total_products: { type: 'integer', description: 'Total number of products in catalog' },
        products_with_current_price: { type: 'integer', description: 'Products with up-to-date pricing' },
        total_merchants: { type: 'integer', description: 'Total number of merchants tracked' },
        active_merchants: { type: 'integer', description: 'Merchants with active listings' },
        country: { type: 'string', enum: ['SG', 'MY', 'TH', 'PH', 'VN', 'ID', 'US'] },
        category: { type: 'string', description: 'Category filter if applied (undefined for all)' },
      },
      required: ['total_products', 'products_with_current_price', 'total_merchants', 'active_merchants', 'country'],
    },
    timestamp: { type: 'string', format: 'date-time', description: 'ISO timestamp when metrics were generated' },
  },
  required: ['latency', 'accuracy', 'freshness', 'coverage', 'timestamp'],
} as const;

export const METRICS_ENDPOINT_RESPONSE = {
  type: 'object',
  example: {
    latency: {
      p50_ms: 45,
      p95_ms: 120,
      p99_ms: 250,
      avg_ms: 52,
    },
    accuracy: {
      exact_match_rate: 0.78,
      relevance_score_avg: 0.85,
      zero_results_rate: 0.05,
    },
    freshness: {
      prices_updated_last_1h: 15420,
      prices_updated_last_24h: 287540,
      avg_price_freshness_minutes: 12.5,
    },
    coverage: {
      total_products: 1247583,
      products_with_current_price: 1189234,
      total_merchants: 67,
      active_merchants: 52,
      country: 'SG',
      category: undefined,
    },
    timestamp: '2026-04-27T12:00:00.000Z',
  },
} as const;
