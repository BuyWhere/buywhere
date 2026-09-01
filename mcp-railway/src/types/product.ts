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
  /** schema.org Product.name — alias of title (BUY-78151 / BUY-79449). */
  name?: string;
  price: ProductPrice;
  merchant: string;
  url: string;
  image_url: string | null;
  region: string | null;
  country_code: string | null;
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
  // BUY-75368: A2 weekly report metric — last successful URL probe timestamp.
  // Always present (null when never checked) so consumers can rely on shape.
  url_last_checked_at?: string | null;
  url_status?: string | null;
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
}

/** BUY-74597: why an empty/degraded response has no usable data. */
export type EmptinessReason =
  | 'no_data'
  | 'no_match'
  | 'api_error'
  | 'quota'
  | 'region_unsupported'
  | 'category_unsupported'
  | 'deliver_to_missing'
  | 'timeout'
  | 'partial_timeout'
  | 'auth_failure';

export type SearchConfidence = 'high' | 'low';

export interface EmptinessDiagnostic {
  engine_status: 'ok' | 'degraded' | 'error' | 'fallback';
  indexed_for_region: boolean;
  category_recognized: boolean;
  rate_limit_remaining: number | null;
  deliver_to_present: boolean;
  timed_out_stage?: string | null;
}

export type DegradedKind =
  | 'timeout'
  | 'auth_failure'
  | 'upstream_exception'
  | 'circuit_open'
  | 'unknown';

export interface SearchResponse {
  results: CanonicalProduct[];
  total: number;
  page: { limit: number; offset: number };
  response_time_ms: number;
  cached: boolean;
  // BUY-67275: see api tree — hasMore was previously fed into `cached`.
  has_more?: boolean;
  // BUY-74597: degraded envelope fields.
  degraded?: boolean;
  status?: 'ok' | 'degraded' | 'partial_timeout';
  degraded_reason?: string;
  emptiness_reason?: EmptinessReason;
  confidence?: SearchConfidence;
  diagnostic?: EmptinessDiagnostic;
  degraded_kind?: DegradedKind;
}
