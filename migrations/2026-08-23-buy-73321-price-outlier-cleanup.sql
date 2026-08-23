-- BUY-73321: Clean up existing extreme pricing outliers from the catalog.
-- Deactivates products whose prices are clearly data errors (too low or too
-- high for their currency) so they stop appearing in search results.
--
-- Hard bounds match lib/pricing.ts:
--   USD: warnLow=0.50, warnHigh=15000
--   SGD: warnLow=0.50, warnHigh=20000
--   GBP: warnLow=0.40, warnHigh=12000
--   EUR: warnLow=0.45, warnHigh=14000
--   AUD: warnLow=0.75, warnHigh=22000
--
-- Products are soft-deleted (is_active = false) rather than hard-deleted
-- so the data is preserved for debugging.

-- USD outliers
UPDATE products SET is_active = false, metadata = jsonb_set(
  COALESCE(metadata, '{}'), '{price_outlier}', 'true'
)
WHERE currency = 'USD' AND is_active = true
  AND (price < 0.50 OR price > 15000);

-- SGD outliers
UPDATE products SET is_active = false, metadata = jsonb_set(
  COALESCE(metadata, '{}'), '{price_outlier}', 'true'
)
WHERE currency = 'SGD' AND is_active = true
  AND (price < 0.50 OR price > 20000);

-- GBP outliers
UPDATE products SET is_active = false, metadata = jsonb_set(
  COALESCE(metadata, '{}'), '{price_outlier}', 'true'
)
WHERE currency = 'GBP' AND is_active = true
  AND (price < 0.40 OR price > 12000);

-- EUR outliers
UPDATE products SET is_active = false, metadata = jsonb_set(
  COALESCE(metadata, '{}'), '{price_outlier}', 'true'
)
WHERE currency = 'EUR' AND is_active = true
  AND (price < 0.45 OR price > 14000);

-- AUD outliers
UPDATE products SET is_active = false, metadata = jsonb_set(
  COALESCE(metadata, '{}'), '{price_outlier}', 'true'
)
WHERE currency = 'AUD' AND is_active = true
  AND (price < 0.75 OR price > 22000);

-- Also clean search_products to remove outlier rows from the search index
DELETE FROM search_products WHERE price > 0 AND (
  (currency = 'USD' AND (price < 0.50 OR price > 15000)) OR
  (currency = 'SGD' AND (price < 0.50 OR price > 20000)) OR
  (currency = 'GBP' AND (price < 0.40 OR price > 12000)) OR
  (currency = 'EUR' AND (price < 0.45 OR price > 14000)) OR
  (currency = 'AUD' AND (price < 0.75 OR price > 22000))
);

-- Log results
DO $$
DECLARE
  deactivated_count INTEGER;
  deleted_count INTEGER;
BEGIN
  SELECT count(*) INTO deactivated_count FROM products WHERE is_active = false AND metadata->>'price_outlier' = 'true';
  SELECT count(*) INTO deleted_count FROM pg_stat_user_tables WHERE relname = 'search_products';
  RAISE NOTICE 'BUY-73321: Deactivated % outlier products, search_products stats refreshed', deactivated_count;
END $$;
