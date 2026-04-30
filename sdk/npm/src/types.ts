export interface Product {
  id: number;
  sku: string;
  source: string;
  merchant_id: string;
  name: string;
  description: string;
  price: number;
  currency: string;
  buy_url: string;
  affiliate_url: string | null;
  image_url: string | null;
  category: string;
  category_path: string[];
  is_available: boolean;
  metadata: Record<string, unknown>;
  updated_at: string;
  match_score?: number;
  price_rank?: number;
  original_price?: number;
  discount_pct?: number;
  savings_vs_most_expensive?: number;
  savings_pct?: number;
}

export interface ProductListResponse {
  total: number;
  limit: number;
  offset: number;
  has_more: boolean;
  items: Product[];
}

export interface ProductResponse {
  id: number;
  sku: string;
  source: string;
  merchant_id: string;
  name: string;
  description: string;
  price: number;
  currency: string;
  buy_url: string;
  affiliate_url: string | null;
  image_url: string | null;
  category: string;
  category_path: string[];
  is_available: boolean;
  metadata: Record<string, unknown>;
  updated_at: string;
}

export interface CompareMatch {
  id: number;
  sku: string;
  source: string;
  merchant_id: string;
  name: string;
  description: string | null;
  price: number;
  currency: string;
  buy_url: string;
  affiliate_url: string | null;
  image_url: string | null;
  brand: string | null;
  category: string | null;
  category_path: string[] | null;
  rating: number | null;
  is_available: boolean;
  last_checked: string | null;
  metadata: Record<string, unknown> | null;
  updated_at: string;
  match_score: number;
  savings_vs_most_expensive?: number;
  savings_pct?: number;
}

export interface CompareHighlights {
  cheapest: CompareMatch | null;
  best_rated: CompareMatch | null;
  fastest_shipping: CompareMatch | null;
}

export interface CompareResponse {
  source_product_id: number;
  source_product_name: string;
  total_matches: number;
  matches: CompareMatch[];
  highlights: CompareHighlights | null;
}

export interface CompareSearchMatch {
  id: number;
  sku: string;
  source: string;
  merchant_id: string;
  name: string;
  description: string | null;
  price: number;
  currency: string;
  buy_url: string;
  affiliate_url: string | null;
  image_url: string | null;
  brand: string | null;
  category: string | null;
  category_path: string[] | null;
  rating: number | null;
  is_available: boolean;
  in_stock?: boolean | null;
  stock_level?: string | null;
  last_checked: string | null;
  metadata: Record<string, unknown> | null;
  updated_at: string | null;
  match_score: number;
}

export interface CompareSearchResponse {
  query: string;
  items: CompareSearchMatch[];
  total: number;
  cheapest_product_id: number | null;
  best_rated_product_id: number | null;
  fastest_shipping_product_id: number | null;
}

export interface CompareMatrixResponse {
  total_products: number;
  comparisons: CompareResponse[];
}

export interface FieldDiff {
  field: string;
  values: unknown[];
  all_identical: boolean;
}

export interface CompareDiffResponse {
  products: Product[];
  field_diffs: FieldDiff[];
  identical_fields: string[];
  cheapest_product_id: number;
  most_expensive_product_id: number;
  price_spread: number;
  price_spread_pct: number;
}

export interface TrendingResponse {
  data: Product[];
  meta: {
    period: string;
    period_hours: number;
    country_code: string;
    top_searches: Array<{
      query: string;
      category: string | null;
      search_count: number;
    }>;
    limit: number;
  };
}

export interface Category {
  name: string;
  count: number;
  children: Category[];
}

export interface CategoryResponse {
  categories: Category[];
  total: number;
}

export interface DealItem {
  id: number;
  name: string;
  price: number;
  original_price: number;
  discount_pct: number;
  currency: string;
  source: string;
  category: string;
  buy_url: string;
  affiliate_url: string | null;
  image_url: string | null;
  metadata: Record<string, unknown>;
}

export interface DealsResponse {
  total: number;
  limit: number;
  offset: number;
  items: DealItem[];
}

export interface IngestProduct {
  sku: string;
  merchant_id?: string;
  title: string;
  description?: string;
  price: number;
  currency?: string;
  url: string;
  image_url?: string;
  category?: string;
  category_path?: string[];
  brand?: string;
  is_active?: boolean;
  metadata?: Record<string, unknown>;
}

export interface IngestRequest {
  source: string;
  products: IngestProduct[];
}

export interface IngestResponse {
  ingested: number;
  updated: number;
  failed: number;
  errors: string[];
}

export interface ChangelogRelease {
  version: string;
  date: string;
  changes: {
    category: string;
    group: string | null;
    description: string;
  }[];
}

export interface ChangelogResponse {
  api_version: string;
  releases: ChangelogRelease[];
}

export interface HealthStatus {
  status: string;
  version: string;
  environment: string;
}

export interface ApiInfo {
  api: string;
  version: string;
  endpoints: Record<string, string>;
  auth: string;
  docs: string;
}

export interface AffiliateResolution {
  product_id: number;
  buy_url: string;
  affiliate_url: string | null;
  resolved_url: string;
  tracked_click: boolean;
}

export interface RateLimitInfo {
  limit: number;
  remaining: number;
  reset: number;
}

export interface SearchOptions {
  q?: string;
  category?: string;
  min_price?: number;
  max_price?: number;
  source?: string;
  in_stock?: boolean;
  limit?: number;
  offset?: number;
}

export interface CompareOptions {
  product_id: number;
  min_price?: number;
  max_price?: number;
}

export interface CompareSearchOptions {
  q: string;
  limit?: number;
}

export interface CompareByIdOptions {
  min_price?: number;
  max_price?: number;
}

export interface CompareDiffOptions {
  product_ids: number[];
  include_image_similarity?: boolean;
}

export interface CompareMatrixOptions {
  product_ids: number[];
  min_price?: number;
  max_price?: number;
}

export interface DealsOptions {
  category?: string;
  min_discount_pct?: number;
  limit?: number;
  offset?: number;
}

export interface ExportOptions {
  format?: "csv" | "json";
  category?: string;
  source?: string;
  min_price?: number;
  max_price?: number;
  limit?: number;
  offset?: number;
}

export type SubscribeCallback = (deal: DealItem) => void | Promise<void>;

export interface SubscribeOptions {
  category?: string;
  min_discount_pct?: number;
}
