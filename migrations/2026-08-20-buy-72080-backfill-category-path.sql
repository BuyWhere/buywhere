-- BUY-72080: backfill category_path for rows where it's NULL/empty but the
-- source value is recoverable from metadata.product_type, metadata.category,
-- or the top-level `category` column (depending on which scraper wrote the
-- row). Skips rows that already have a valid path.
--
-- The TS ingest endpoint at api/src/routes/ingest.ts now derives
-- category_path on every new ingest (PRs #644, #645, #646), but ~115k+
-- existing rows pre-date the fix. This migration backfills those.
--
-- DESTRUCTIVE: updates category_path column. Soft-restore is possible via
-- git revert + inverse migration, but the values are derivable so we leave
-- them.
--
-- Apply on sakura (production catalog DB): psql -f <this>.sql

BEGIN;

-- 1. From metadata.product_type (Node buywhere-ingest shopify scraper)
UPDATE products
SET category_path = ARRAY[metadata->>'product_type']::text[]
WHERE is_active = true
  AND (category_path IS NULL OR array_length(category_path, 1) IS NULL)
  AND metadata ? 'product_type'
  AND nullif(metadata->>'product_type', '') IS NOT NULL
  AND metadata->>'product_type' !~ '^[0-9]+$';  -- exclude obvious-bad barcode values

-- 2. From metadata.category (alternate scraper location)
UPDATE products
SET category_path = ARRAY[metadata->>'category']::text[]
WHERE is_active = true
  AND (category_path IS NULL OR array_length(category_path, 1) IS NULL)
  AND metadata ? 'category'
  AND nullif(metadata->>'category', '') IS NOT NULL
  AND metadata->>'category' !~ '^[0-9]+$'
  AND NOT (metadata ? 'product_type' AND nullif(metadata->>'product_type', '') IS NOT NULL);

-- 3. From the top-level `category` column (scripts/batch_shopify_scraper.py
--    sets category = product_type but never category_path or metadata.product_type).
--    Skip rows with empty/blank category.
UPDATE products
SET category_path = ARRAY[category]::text[]
WHERE is_active = true
  AND (category_path IS NULL OR array_length(category_path, 1) IS NULL)
  AND category IS NOT NULL
  AND nullif(category, '') IS NOT NULL
  AND category !~ '^[0-9]+$'
  AND NOT (
    (metadata ? 'product_type' AND nullif(metadata->>'product_type', '') IS NOT NULL)
    OR (metadata ? 'category' AND nullif(metadata->>'category', '') IS NOT NULL)
  );

COMMIT;

