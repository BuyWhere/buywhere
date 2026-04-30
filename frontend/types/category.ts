export interface ProductResponse {
  id: number;
  sku: string;
  source: string;
  merchant_id: string;
  name: string;
  description?: string;
  price: number;
  price_formatted: string;
  currency: string;
  region: string;
  country_code: string;
  buy_url: string;
  affiliate_url?: string;
  image_url?: string;
  brand?: string;
  category?: string;
  category_path?: string[];
  rating?: number;
  review_count?: number;
  is_available: boolean;
  in_stock?: boolean;
  stock_level?: string;
  last_checked?: string;
  updated_at: string;
  price_trend?: 'up' | 'down' | 'stable';
  confidence_score?: number;
}

export interface ProductListResponse {
  total: number;
  limit: number;
  offset: number;
  items: ProductResponse[];
  has_more: boolean;
  next_cursor?: number;
  facets?: Record<string, FacetBucket[]>;
}

export interface FacetBucket {
  value: string;
  label: string;
  count: number;
}

export type SortOption = 'relevance' | 'price_asc' | 'price_desc' | 'newest';

export interface FilterState {
  category?: string;
  price_min?: number;
  price_max?: number;
  sort_by: SortOption;
}

export interface SEOMetadata {
  title: string;
  description: string;
  canonical_url: string;
}