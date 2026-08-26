export interface ProductPrice {
  amount: number | null;
  currency: string;
}

export interface ComparisonAttribute {
  key: string;
  label: string;
  value: unknown;
}

export interface CanonicalProduct {
  id: string;
  title: string;
  price: ProductPrice;
  merchant: string;
  // BUY-74262: expose source field for per-source grouping/filtering (DQ signal loop)
  source?: string | null;
  url: string;
  image_url: string | null;
  region: string | null;
  country_code: string | null;
  in_stock?: boolean;
  updated_at: string | null;
  // Compact-mode only (agent-optimized extras):
  canonical_id?: string;
  normalized_price_usd?: number | null;
  structured_specs?: Record<string, unknown>;
  comparison_attributes?: ComparisonAttribute[];
  // Non-compact-only (legacy extras):
  metadata?: Record<string, unknown> | null;
  // Deal-specific:
  original_price?: number | null;
  discount_pct?: number | null;
  // Affiliate-tracked URL (BUY-18436); present when platform has active affiliate config
  affiliate_url?: string | null;
  // BUY-52474: tracking URLs the FE should use for outbound clicks so that
  // `clicks` (via /api/click) and `affiliate_clicks` (via /r/) tables grow
  // from real /v1 traffic. Optional because they're only present when the
  // product has a destination URL to track.
  click_url?: string | null;
  affiliate_redirect_url?: string | null;
  // Explicit machine-readable affiliate disclosure fields for agents/API clients.
  has_affiliate_tracking: boolean;
  is_affiliate: boolean;
  affiliate_disclosure?: string;
}

export interface SearchMeta {
  total: number;
  limit: number;
  offset: number;
  response_time_ms: number;
  cached: boolean;
  // BUY-60309: degraded flag when deals query timed out or was cancelled
  degraded?: boolean;
  // BUY-67275: true when more pages exist. Previously hasMore was (incorrectly)
  // fed into `cached`, so cached lied on every multi-page response.
  has_more?: boolean;
}

export interface SearchResponse {
  /** F33 contract aliases of data */
  products?: CanonicalProduct[];
  results?: CanonicalProduct[];
  items?: CanonicalProduct[];
  data: CanonicalProduct[];
  meta: SearchMeta;
}
