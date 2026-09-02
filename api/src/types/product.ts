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
  name?: string;
  price: ProductPrice;
  merchant: string;
  // BUY-74689: opaque `merchants.id` reference. Distinct from `merchant` (the
  // platform slug, e.g. `bestdenki`, `shopee_sg`) — `merchant_id` joins 1:1 to
  // `merchants.id` and is the lookup key for `merchant_name` / `merchant_slug`.
  merchant_id?: string | null;
  // BUY-67318: when the probe worker confirms the listing is dead (HTTP 404/410
  // or other 4xx) we null the URL so the FE doesn't render a buy button to a
  // page that no longer exists. The redirect handler (/r/direct/{id}) already
  // returns 410 in this case; the serializer removes the link from search and
  // listings too. `url_status: 'dead'` is still emitted so consumers can show
  // a tombstone / "no longer available" UI.
  url: string | null;
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
  meta?: Record<string, unknown> | null;
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
  // BUY-74689: human-readable storefront name resolved from the `merchants` table.
  // `merchant` / `merchant_id` keep the platform slug for filtering; `merchant_name`
  // (and the URL-safe kebab-case `merchant_slug`) carry the real storefront label so
  // card badges stop falling through to "Shopify" / "Shopee SG". Null when the row is
  // not present in `merchants` (orphaned merchant_id) — this is the documented
  // fallback that BUY-74683 handled on the FE side.
  merchant_name?: string | null;
  merchant_slug?: string | null;
  // BUY-74732: how the catalog row was sourced. Drives the FE `<MerchantBadge>`
  // verified-mark: only `first_party` (data published by the merchant directly,
  // e.g. an official Shopify storefront) renders ✓. Resolved by:
  //   1) the `products.scraped_via` column when present, OR
  //   2) the `merchants.scraped_via` fallback (legacy rows that only stamped
  //      the merchant-level flag), OR
  //   3) null when neither is known (the FE falls back to its legacy
  //      config.verified path so US retailers keep showing ✓).
  scraped_via?: 'first_party' | 'affiliate' | 'aggregator' | string | null;
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
  // BUY-74262: expose raw source column alongside merchant alias.
  // `source` is the retailer/feed origin (e.g. "amazon_us", "shopify");
  // `merchant` is the same value mapped from `domain` alias for backward compat.
  source?: string | null;
}

export type NearMissPredicateFail = 'price' | 'currency' | 'availability' | 'image_url' | 'merchant_url';

/** BUY-71542 / P2.6 + BUY-72044 / P2.6A: why an empty 200-OK response has no data.
 *  BUY-74597: timeout / partial_timeout distinguish infra-timeouts from true empty.
 */
export type EmptinessReason =
  | 'no_data'            // catalog has zero indexed products for the requested region/category
  | 'no_match'           // catalog has products but none matched the query/filters
  | 'api_error'          // a DB or infrastructure error occurred; caller should retry
  | 'quota'              // rate-limit or quota exceeded
  | 'region_unsupported' // requested region/market is not yet indexed
  | 'category_unsupported' // requested category has no indexed products
  | 'deliver_to_missing' // BUY-72044 / P2.6A: caller omitted deliver_to/country_code and the global filter
                          // produced empty because none of the relevant rows are deliverable to a default region.
  | 'timeout'            // BUY-74597: request could not finish inside the user-facing timeout budget
  | 'partial_timeout'    // BUY-74597: request partially completed but exceeded budget; partial results returned
  | 'auth_failure';      // BUY-74597: auth/upstream credential failure prevented lookup

/** BUY-71542 / P2.6 + BUY-72044 / P2.6A: diagnostic block surfaced in meta for empty responses.
 *  BUY-74597: adds timed_out_stage so agents can see which stage failed.
 */
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
  /** BUY-74597: when emptiness_reason is timeout/partial_timeout, the stage that timed out
   *  (e.g. catalog_search, offer_aggregation, merchant_join). No internal DSNs here. */
  timed_out_stage?: string | null;
  /** BUY-79690: true when the destination was present but not a supported ISO market. */
  invalid_deliver_to?: boolean;
}

export type SearchConfidence = 'high' | 'low';

/** BUY-74597: telemetry classification so timeout/degraded can be counted separately from true-empty. */
export type DegradedKind =
  | 'timeout'
  | 'partial_timeout'
  | 'auth_failure'
  | 'upstream_exception'
  | 'circuit_open'
  | 'unknown';

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
  /** BUY-74597: explicit response status for agent integrators. Mirrors legacy `meta.degraded`. */
  status?: 'ok' | 'degraded' | 'partial_timeout';
  /** BUY-74597: classification for telemetry counters (timeout/auth_failure/upstream_exception/circuit_open). */
  degraded_kind?: DegradedKind;
  /** BUY-75024: agent-readable stage/reason for degraded fallbacks (e.g. catalog_search). */
  degraded_reason?: string;
  /**
   * BUY-76440: the search mode that actually produced this response
   * ('keyword' | 'semantic' | 'hybrid'). Lets integrators verify mode-identity
   * — that mode=semantic/hybrid really ran the embedding-ranked path rather than
   * silently degrading to FTS. Absent on non-search builders (deals, bulk-lookup).
   */
  mode_used?: 'keyword' | 'semantic' | 'hybrid';
  /** BUY-76440: human-readable engine that served the mode, e.g. 'keyword (fts)' | 'semantic (pgvector hnsw)' | 'hybrid (rrf + pgvector hnsw)'. */
  mode_used_engine?: string;
  /** BUY-79690: normalized destination echoed when any of deliver_to|country|country_code was present. */
  deliver_to?: string;
}

export interface SearchResponse {
  /** F33 contract aliases of data */
  products?: CanonicalProduct[];
  results?: CanonicalProduct[];
  items?: CanonicalProduct[];
  data: CanonicalProduct[];
  meta: SearchMeta;
}
