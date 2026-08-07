-- BUY-66936: Fix stale deals indexes to use discount_pct column instead of computed expression.
--
-- Root cause: migrate.ts (BUY-14399) originally created idx_products_deals_country/region
-- with the formula ((1 - price / NULLIF(original_price,0)) * 100).  After BUY-64112 added
-- the discount_pct GENERATED column, mcpWarmup.ts updated its CREATE INDEX IF NOT EXISTS to
-- use discount_pct — but IF NOT EXISTS silently skips a create when the name already exists,
-- even if the definition differs.  The planner could not use the old-expression index for
-- discount_pct-filtered queries, so US (the largest country_code partition) fell back to a
-- heap scan + sort that exceeded the 4500ms statement_timeout.
--
-- Fix: drop the stale indexes and recreate them on the discount_pct column.  All other
-- services that reference these indexes (api, api-embed, mcp-railway) use CREATE INDEX
-- IF NOT EXISTS in mcpWarmup.ts; after this migration runs they will also find the
-- correctly-defined indexes and skip creation.

-- BUY-66936: country-aware deals index — keyed on (currency, country_code, discount_pct DESC)
-- so the planner can satisfy currency=, country_code=, discount_pct>= AND the ORDER BY
-- discount_pct DESC from the index alone without a heap sort.
DROP INDEX IF EXISTS idx_products_deals_country;
CREATE INDEX CONCURRENTLY idx_products_deals_country
  ON products (currency, country_code, discount_pct DESC)
  WHERE discount_pct IS NOT NULL AND price > 0 AND is_active = true
    AND country_code IS NOT NULL;

-- BUY-66936: region-aware deals index — same shape for region-filtered queries.
DROP INDEX IF EXISTS idx_products_deals_region;
CREATE INDEX CONCURRENTLY idx_products_deals_region
  ON products (currency, region, discount_pct DESC)
  WHERE discount_pct IS NOT NULL AND price > 0 AND is_active = true
    AND region IS NOT NULL;

-- BUY-66936: currency-only deals index — used when no country_code or region is specified.
DROP INDEX IF EXISTS idx_products_deals_discount_pct;
CREATE INDEX CONCURRENTLY idx_products_deals_discount_pct
  ON products (currency, discount_pct DESC)
  WHERE discount_pct IS NOT NULL AND price > 0;

-- BUY-66936: refresh pg_stat_user_indexes so the planner immediately sees the new indexes.
-- (CONCURRENTLY builds leave the stats stale until ANALYZE runs.)
ANALYZE products;
