-- BUY-77539: Add composite index for featured products queries.
--
-- /v1/products/featured filters by:
--   is_active = true
--   country_code = $1
--   currency = $2
--   price IS NOT NULL
-- and orders by id DESC.
--
-- Existing production index is only partial on (is_active, country_code) and does not
-- include currency/id, so this query was falling back to less efficient plans on many
-- country/currency slices.

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_products_country_active_currency_price_id
  ON public.products (country_code, is_active, currency, id DESC)
  WHERE is_active = true
    AND price IS NOT NULL;
