-- BUY-86406: support merchant_id filter on /v1/products list path.
-- 2c9b1c0ee wired the filter into the WHERE clause, but the fast-path
-- child tables (products_partitioned_sg, products_partitioned_us) had
-- no merchant_id index, so the query degenerated to a full partition
-- scan and tripped the 4s statement_timeout -> 500.
--
-- Parent `products` already has idx_products_merchant_id. This adds
-- the equivalent on the two live child tables. CREATE INDEX CONCURRENTLY
-- so it does not block writes.
--
-- Run with:
--   psql "application_name=ops-ddl $DSN" -f api/migrations/BUY-86406-merchant-id-index.sql
--
-- Verify after:
--   SELECT indexname, indexdef FROM pg_indexes
--    WHERE tablename IN ('products_partitioned_sg','products_partitioned_us')
--      AND indexname LIKE '%merchant%';

SET statement_timeout = '3600000';
SET lock_timeout = '60000';

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_products_partitioned_sg_merchant_id
  ON products_partitioned_sg(merchant_id)
  WHERE merchant_id IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_products_partitioned_us_merchant_id
  ON products_partitioned_us(merchant_id)
  WHERE merchant_id IS NOT NULL;
