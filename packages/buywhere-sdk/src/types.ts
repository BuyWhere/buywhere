export interface Product {
  id: number;
  name: string;
  price: number;
  currency: string;
  source: string;
  buy_url: string;
  affiliate_url?: string;
  is_available: boolean;
  rating?: number;
  image_url?: string;
}

export interface ProductDetail {
  id: number;
  name: string;
  brand: string;
  description: string;
  category: string;
  prices: MerchantPrice[];
  lowest_price: string;
  lowest_price_merchant: string;
  image_url?: string;
  rating?: number;
  reviews_count?: number;
  last_updated: string;
}

export interface GetProductParams {
  product_id: number;
}

export interface SearchParams {
  query: string;
  country?: string;
  region?: string;
  currency?: string;
  limit?: number;
  offset?: number;
  price_min?: number;
  price_max?: number;
  platform?: string;
}

export interface SearchResponse {
  total: number;
  limit: number;
  offset: number;
  has_more: boolean;
  items: Product[];
}

export interface MerchantPrice {
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

export interface ComparisonProduct {
  id: number;
  name: string;
  brand: string;
  sku: string;
  prices: MerchantPrice[];
  lowest_price: string;
  lowest_price_merchant: string;
  lowest_price_best_value: boolean;
}

export interface ComparisonCategory {
  id: string;
  name: string;
  slug: string;
  description: string;
  icon: string;
}

export interface CompareParams {
  product_ids: ProductId[];
  category?: string;
  region?: Region;
  country?: Country;
}

export interface CompareResponse {
  category?: ComparisonCategory;
  products: ComparisonProduct[];
  meta: {
    total_products: number;
    total_merchants: number;
    last_updated: string;
  };
}

export interface DealProduct {
  id: number;
  name: string;
  price: number;
  original_price?: number;
  currency: string;
  discount_pct?: number;
  merchant: string;
  url: string;
  ends_at?: string;
  is_exclusive?: boolean;
}

export interface DealsParams {
  country?: string;
  category?: string;
  limit?: number;
  offset?: number;
}

export interface DealsResponse {
  deals: DealProduct[];
  meta: {
    total: number;
    has_more: boolean;
    last_updated: string;
  };
}

export interface PriceHistoryPoint {
  date: string;
  price: number;
  currency: string;
  merchant?: string;
}

export interface PriceHistoryResponse {
  product_id: number;
  product_name: string;
  country: string;
  currency: string;
  period: string;
  price_history: PriceHistoryPoint[];
  lowest_price: number;
  highest_price: number;
  average_price: number;
  lowest_price_date: string;
  highest_price_date: string;
}

export interface GetPriceHistoryParams {
  product_id: ProductId;
  country?: Country;
  period?: '7d' | '30d' | '90d' | '1y';
}

export interface DealsFeedParams {
  country?: Country;
  category?: string;
  limit?: number;
  offset?: number;
  min_discount_pct?: number;
}

export interface DealsFeedResponse {
  deals: DealProduct[];
  meta: {
    total: number;
    has_more: boolean;
    last_updated: string;
  };
}

export type Region = 'SG' | 'US' | 'MY' | 'TH' | 'PH' | 'VN' | 'ID';
export type Country = 'SG' | 'MY' | 'TH' | 'PH' | 'VN' | 'ID' | 'US';
export type ProductId = string | number;

export interface ClientConfig {
  apiKey: string;
  baseUrl?: string;
  timeout?: number;
  defaultCurrency?: string;
  defaultCountry?: Country;
  retry?: RetryConfig;
  circuitBreaker?: CircuitBreakerConfig;
}

export interface RetryConfig {
  maxRetries?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  backoffMultiplier?: number;
}

export interface CircuitBreakerConfig {
  failureThreshold?: number;
  resetTimeoutMs?: number;
  halfOpenMaxAttempts?: number;
}

export interface RequestOptions {
  headers?: Record<string, string>;
  timeout?: number;
  skipRetry?: boolean;
}

export interface AuthMeResponse {
  key_id: string;
  tier: string;
  name?: string | null;
  developer_id?: string | null;
  rate_limit?: number | null;
  is_active?: boolean;
}

export interface PriceHistoryOptions {
  limit?: number;
  since?: string;
  country?: Country;
  period?: '7d' | '30d' | '90d' | '1y';
}

export interface RotateApiKeyResponse {
  newApiKey: string;
  oldKeyExpiresAt: string;
}

export interface Webhook {
  id: string;
  url: string;
  product_ids: number[];
  events: string[];
  active: boolean;
  filter_category?: string | null;
  filter_brand?: string | null;
  filter_price_min?: string | null;
  filter_price_max?: string | null;
  created_at: string;
}

export interface WebhookCreateResponse extends Webhook {
  message?: string;
}

export interface WebhookListResponse {
  webhooks: Webhook[];
  total: number;
}

export interface RetailerReview {
  retailer: string;
  rating: number;
  review_count: number;
  review_url: string;
  last_review_date?: string;
}

export interface ReviewSummary {
  product_id: number;
  product_name: string;
  overall_rating: number;
  total_reviews: number;
  retailer_reviews: RetailerReview[];
  summary: string;
  pros?: string[];
  cons?: string[];
  top_keywords: string[];
  last_updated: string;
}

export interface GetProductReviewsParams {
  product_id: number;
  country?: Country;
}

export interface ProductAlert {
  id: string;
  product_id: number;
  target_price: number;
  direction: 'above' | 'below';
  callback_url: string;
  active: boolean;
  created_at: string;
  triggered_at?: string;
}

export interface GetProductAlertsParams {
  product_id: number;
  country?: Country;
}

export interface UTMParams {
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_term?: string;
  utm_content?: string;
}

export interface BatchSearchParams {
  queries: Array<{
    query: string;
    country?: Country;
    limit?: number;
    price_min?: number;
    price_max?: number;
  }>;
}

export interface BatchSearchResult {
  results: SearchResponse[];
  errors: Array<{ index: number; error: string }>;
}

export interface AgentSearchResult {
  id: number;
  sku: string;
  source: string;
  title: string;
  price: number;
  currency: string;
  price_sgd: number;
  url: string;
  brand: string;
  category: string;
  image_url: string;
  rating: number;
  review_count: number;
  is_available: boolean;
  in_stock: boolean;
  stock_level: string;
  confidence_score: number;
  availability_prediction: 'in_stock' | 'low_stock' | 'out_of_stock' | 'unknown';
  competitor_count: number;
  buybox_price: number;
  affiliate_url: string;
  headline: string;
  data_freshness: string;
  freshness_score: number;
}

export interface AgentSearchResponse {
  total: number;
  limit: number;
  offset: number;
  has_more: boolean;
  query_processed: string;
  results: AgentSearchResult[];
  query_time_ms: number;
  cache_hit: boolean;
}

export interface AgentSearchParams {
  q: string;
  limit?: number;
  offset?: number;
  cursor?: string;
  source?: string;
  platform?: string;
  min_price?: number;
  max_price?: number;
  price_min?: number;
  price_max?: number;
  availability?: boolean;
  sort_by?: 'relevance' | 'price_asc' | 'price_desc' | 'newest' | 'highest_rated' | 'most_reviewed';
  currency?: string;
  include_agent_insights?: boolean;
  include_price_history?: boolean;
  include_availability_prediction?: boolean;
}
