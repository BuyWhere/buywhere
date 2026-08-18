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
  url: string;
  image_url: string | null;
  region: string | null;
  country_code: string | null;
  in_stock?: boolean;
  availability?: {
    in_stock: boolean;
    status: 'in_stock' | 'out_of_stock';
  };
  updated_at: string | null;
  // BUY-71396: render-gate freshness timestamp (A2 metric)
  url_last_checked_at?: string | null;
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

export type NearMissPredicateFail = 'price' | 'currency' | 'availability' | 'image_url' | 'merchant_url';

/** BUY-71542 / P2.6: why an empty 200-OK response has no data. */
export type EmptinessReason =
  | 'no_data'            // catalog has zero indexed products for the requested region/category
  | 'no_match'           // catalog has products but none matched the query/filters
  | 'api_error'          // a DB or infrastructure error occurred; caller should retry
  | 'quota'              // rate-limit or quota exceeded
  | 'region_unsupported' // requested region/market is not yet indexed
  | 'category_unsupported'; // requested category has no indexed products

/** BUY-71542 / P2.6: diagnostic block surfaced in meta for empty responses. */
export interface EmptinessDiagnostic {
  engine_status: 'ok' | 'degraded' | 'error';
  indexed_for_region: boolean;
  category_recognized: boolean;
  rate_limit_remaining: number | null; // requests remaining in current minute window; null if unknown
}

export type SearchConfidence = 'high' | 'low';

export interface SearchMeta {
  total: number;
  limit: number;
  offset: number;
  response_time_ms: number;
  cached: boolean;
  // BUY-71134 / P1.3-NM: additive telemetry for the nightly zero-result sweep.
  near_miss?: boolean;
  near_miss_predicate_fails?: NearMissPredicateFail[];
  // BUY-60309: degraded flag when deals query timed out or was cancelled
  degraded?: boolean;
  // BUY-67275: true when more pages exist. Previously hasMore was (incorrectly)
  // fed into `cached`, so cached lied on every multi-page response.
  has_more?: boolean;
  // BUY-71542 / P2.6: why the response has zero results. Only present when
  // the response is empty (products/results/items/data all have length 0).
  emptiness_reason?: EmptinessReason;
  /** BUY-71542 / P2.6: signal quality of an empty or near-empty response. */
  confidence?: SearchConfidence;
  /** BUY-71542 / P2.6: diagnostic signals surfaced for empty responses. */
  diagnostic?: EmptinessDiagnostic;
}

export interface SearchResponse {
  // BUY-71275: keep all MCP/agent-facing search collection aliases in sync.
  products: CanonicalProduct[];
  results: CanonicalProduct[];
  items: CanonicalProduct[];
  data: CanonicalProduct[];
  meta: SearchMeta;
}
