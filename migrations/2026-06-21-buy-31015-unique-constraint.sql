-- BUY-31015: Add unique constraint for WooCommerce deep-page ingestion
--
-- The ingest endpoint (POST /v1/ingest) uses ON CONFLICT (sku, source, country_code)
-- to upsert products. For woocommerce_deep source (540 products), this was failing with:
-- "there is no unique or exclusion constraint matching the ON CONFLICT specification"
--
-- The products table is partitioned by country_code, so the unique constraint must
-- include country_code. This constraint is created on the parent table and will be
-- enforced on all partition tables (products_sg, products_us, products_my, etc.).
--
-- Idempotent: checks for constraint before adding.
-- Handles the partial-index CIC shell with the same name (BUY-55726 fix):
-- if a CREATE INDEX CONCURRENTLY was cancelled mid-flight, it leaves a shell
-- index in pg_class. DROP INDEX is needed before ADD CONSTRAINT, or else
-- PostgreSQL reports "relation already exists".
-- Lock timeout: uses statement_timeout to avoid blocking live writes on large tables.
--
-- Applied 2026-06-21 for BUY-54993. Updated 2026-06-23 for BUY-55726/BUY-56217.

DO $$
BEGIN
  -- If the constraint already exists, nothing to do.
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'products'::regclass
      AND conname = 'products_sku_source_country_unique'
      AND contype = 'u'
  ) THEN
    RAISE NOTICE 'Constraint products_sku_source_country_unique already exists, skipping';
    RETURN;
  END IF;

  -- Drop any leftover INDEX with the same name (partial-index CIC shell from a
  -- previous cancelled attempt). Without this, ALTER TABLE ADD CONSTRAINT would
  -- fail with "relation products_sku_source_country_unique already exists".
  IF EXISTS (
    SELECT 1 FROM pg_class c
    WHERE c.relkind = 'i'
      AND c.relname = 'products_sku_source_country_unique'
  ) THEN
    EXECUTE 'DROP INDEX public.products_sku_source_country_unique';
    RAISE NOTICE 'Dropped partial-index shell products_sku_source_country_unique';
  END IF;

  -- Set timeout to avoid blocking live writes (5 min for 14M+ row table)
  SET LOCAL statement_timeout = 300000;
  SET LOCAL lock_timeout = 60000;

  -- Add the unique constraint that the ingest endpoint expects
  ALTER TABLE products
    ADD CONSTRAINT products_sku_source_country_unique
    UNIQUE (sku, source, country_code);

  RAISE NOTICE 'Constraint products_sku_source_country_unique added successfully';
END $$;
