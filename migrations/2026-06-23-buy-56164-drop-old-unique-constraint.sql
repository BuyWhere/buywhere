-- BUY-56164: Drop old unique constraint on products table
--
-- The old products_sku_source_unique constraint was replaced by
-- products_sku_source_country_unique to account for table partitioning
-- by country_code. This migration drops the old constraint if it still exists.
--
-- Idempotent: checks for constraint before dropping.
--
-- Applied 2026-06-23 for BUY-56164.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'products'::regclass
      AND conname = 'products_sku_source_unique'
      AND contype = 'u'
  ) THEN
    ALTER TABLE products DROP CONSTRAINT products_sku_source_unique;
    RAISE NOTICE 'Dropped old constraint products_sku_source_unique';
  ELSE
    RAISE NOTICE 'Constraint products_sku_source_unique does not exist, skipping';
  END IF;
END $$;
