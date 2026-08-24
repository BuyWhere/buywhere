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
  category_path: string[] | null;
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
  // BUY-74173: disclose Amazon price staleness to agents/UI.
  price_as_of?: string;
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

/** BUY-71542 / P2.6 + BUY-72044 / P2.6A: why an empty 200-OK response has no data. */
export type EmptinessReason =
  | 'no_data'            // catalog has zero indexed products for the requested region/category
  | 'no_match'           // catalog has products but none matched the query/filters
  | 'api_error'          // a DB or infrastructure error occurred; caller should retry
  | 'quota'              // rate-limit or quota exceeded
  | 'region_unsupported' // requested region/market is not yet indexed
  | 'category_unsupported' // requested category has no indexed products
  | 'deliver_to_missing'; // BUY-72044 / P2.6A: caller omitted deliver_to/country_code and the global filter
                          // produced empty because none of the relevant rows are deliverable to a default region.

/** BUY-71542 / P2.6 + BUY-72044 / P2.6A: diagnostic block surfaced in meta for empty responses. */
export interface EmptinessDiagnostic {
  engine_status: 'ok' | 'degraded' | 'error' | 'fallback';
  indexed_for_region: boolean;
  category_recognized: boolean;
  rate_limit_remaining: number | null; // requests remaining in current minute window; null if unknown
  /**
   * BUY-72044 / P2.6A: whether the caller supplied any of `deliver_to` / `country_code` / `country`.
   * Always populated (true|false, never null) so the agent can verify the engine saw the absence
   * of a buyer-market filter without re-parsing the request.
   */
  deliver_to_present: boolean;
}

export type SearchConfidence = 'high' | 'low';

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
  // BUY-71542 / P2.6 + BUY-72044 / P2.6A: why the response has zero results. Only present when
  // the response is empty (products/results/items/data all have length 0).
  emptiness_reason?: EmptinessReason;
  /** BUY-71542 / P2.6 + BUY-72044 / P2.6A: signal quality of an empty or near-empty response. */
  confidence?: SearchConfidence;
  /** BUY-71542 / P2.6 + BUY-72044 / P2.6A: diagnostic signals surfaced for empty responses. */
  diagnostic?: EmptinessDiagnostic;
}

export interface SearchResponse {
  /** F33 contract aliases of data */
  products?: CanonicalProduct[];
  results?: CanonicalProduct[];
  items?: CanonicalProduct[];
  data: CanonicalProduct[];
  meta: SearchMeta;
}
