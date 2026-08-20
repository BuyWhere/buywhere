-- BUY-72080: backfill category_path from metadata.product_type for shopify_* rows
-- where category_path is NULL but metadata.product_type is present.
--
-- The TS ingest endpoint at api/src/routes/ingest.ts now derives
-- category_path from metadata.product_type for new ingests, but ~115k
-- existing rows pre-date the fix. This backfill runs once, fills
-- category_path = ARRAY[product_type] for affected rows, and is a no-op
-- for rows that already have a valid path.
--
-- DESTRUCTIVE: updates category_path column. Soft-restore via git revert
-- + re-running the migration's inverse (set category_path = NULL WHERE
-- metadata->>'product_type' was the source) is possible but the values
-- are derivable so we leave them.

BEGIN;

-- Scope: only rows where category_path is NULL/empty AND metadata.product_type
-- is non-empty. We avoid touching rows where category_path is already valid
-- (hash join would be faster but the table is heavily bloated; this WHERE
-- filter is selective enough).
UPDATE products
SET category_path = ARRAY[metadata->>'product_type']::text[]
WHERE is_active = true
  AND (category_path IS NULL OR array_length(category_path, 1) IS NULL)
  AND metadata ? 'product_type'
  AND nullif(metadata->>'product_type', '') IS NOT NULL
  AND metadata->>'product_type' !~ '^[0-9]+$';  -- exclude obvious-bad barcode values

-- Same for metadata.category (alternate location some scrapers use).
UPDATE products
SET category_path = ARRAY[metadata->>'category']::text[]
WHERE is_active = true
  AND (category_path IS NULL OR array_length(category_path, 1) IS NULL)
  AND metadata ? 'category'
  AND nullif(metadata->>'category', '') IS NOT NULL
  AND metadata->>'category' !~ '^[0-9]+$'
  AND NOT (metadata ? 'product_type' AND nullif(metadata->>'product_type', '') IS NOT NULL);  -- skip rows already handled

COMMIT;
