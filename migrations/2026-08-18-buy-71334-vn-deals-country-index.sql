-- BUY-71334: VN MCP get_deals latency regression
--
-- Root cause: /v1/deals was scanning discounted products across ALL country
-- partitions because country_code was not propagated from the MCP tool.
--
-- This index lets the planner satisfy get_deals for a single market by reading
-- only that country's discounted rows, eliminating the cross-partition sort
-- that caused stmt_timeout / >9s p95 on VN.
--
-- Safe to run CONCURRENTLY on the production catalog DB. Expected build time
-- is a few minutes on ~392M products; statement_timeout is raised for the
-- DDL session only.

SET statement_timeout = '600000';

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_products_country_code_discount
    ON products (country_code, discount_pct DESC)
    WHERE is_active = true AND discount_pct IS NOT NULL;

-- Verify
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'products'
  AND indexname = 'idx_products_country_code_discount';
