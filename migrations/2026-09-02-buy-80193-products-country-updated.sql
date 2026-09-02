-- BUY-80193: /v1/products?country=AU (and JP/MY/TH/TW/VN/PH/KR) timed out at ~8s.
-- Default browse sorts by updated_at DESC after filtering is_active + country_code.
-- Planner used idx_products_updated_at (global) and filtered, scanning until it
-- found a matching country row — or timed out on smaller country slices.
-- Partial btree lets LIMIT 1 short-circuit per country.

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_products_active_country_updated_at
  ON public.products (country_code, updated_at DESC)
  WHERE is_active = true;
