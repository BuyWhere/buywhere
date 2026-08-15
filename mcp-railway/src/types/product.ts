export interface ProductPrice {
  amount: number | null;
  currency: string;
}

// BUY-65559 / BUY-65685: Sentinel-price guard (parallel to PR #36 in @buywhere/mcp).
// When the catalog row has a sentinel amount (< 10 from the ingest pipeline,
// written as `1` placeholder when the merchant page had no parseable price),
// the JSON-RPC tool output now substitutes `price` with a string hint
// ("see merchant (price unavailable in catalog) — click through to confirm")
// instead of the structured object. AI agents cannot accidentally format
// `price.amount` as `.00` when the field is a string. Until BUY-52807 ships
// an ingest-time sanity bound, this is the band-aid.
export type ProductPriceField = ProductPrice | string;

export interface ComparisonAttribute {
  key: string;
  label: string;
  value: unknown;
}

export interface CanonicalProduct {
  id: string;
  title: string;
  price: ProductPriceField;
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
  // Affiliate-tracked URL (BUY-18436); present when platform has active affiliate config
  affiliate_url?: string | null;
  // BUY-52474: tracking URLs the FE should use for outbound clicks so that
  // `clicks` (via /api/click) and `affiliate_clicks` (via /r/) tables grow
  // from real /v1 traffic. Optional because they're only present when the
  // product has a destination URL to track.
  click_url?: string | null;
  affiliate_redirect_url?: string | null;
}

export interface SearchResponse {
  results: CanonicalProduct[];
  total: number;
  page: { limit: number; offset: number };
  response_time_ms: number;
  cached: boolean;
  // BUY-67275: see api tree — hasMore was previously fed into `cached`.
  has_more?: boolean;
}
