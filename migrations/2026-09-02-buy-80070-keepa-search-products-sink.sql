-- BUY-80070: Keepa amazon_us writer (/root/keepa_acquire.py, root cron */15)
-- upserts products directly. It never POSTs /v1/ingest, so the BUY-79109
-- fire-and-forget hook in ingest.ts never sees those ids.
--
-- Statement-level AFTER INSERT OR UPDATE trigger promotes amazon_us rows
-- into search_products using the same INSERT…SELECT as the TS helper.
--
-- Safety:
--   * WHEN (NEW.source = 'amazon_us') so Shopify ingest is untouched
--   * statement_timeout 25s; on timeout / error, WARNING and continue
--     (never abort the Keepa products write)
--   * ON CONFLICT (id) DO NOTHING
--   * skip application_name crate-search-products-sink (ingest helper) to
--     avoid double-promote on the /v1/ingest path
--   * FOR EACH ROW but only amazon_us; GIN idx_sp_fts now has fastupdate=on
--
-- Idempotent. Safe to re-run.

BEGIN;

CREATE OR REPLACE FUNCTION public.fn_promote_amazon_us_search_products()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
  -- Ingest helper already promoted this id; skip to avoid extra GIN work.
  IF current_setting('application_name', true) = 'crate-search-products-sink' THEN
    RETURN NEW;
  END IF;

  IF NEW.source IS DISTINCT FROM 'amazon_us' THEN
    RETURN NEW;
  END IF;

  IF NEW.is_active IS NOT TRUE
     OR NEW.price IS NULL
     OR NEW.price <= 0 THEN
    RETURN NEW;
  END IF;

  BEGIN
    PERFORM set_config('statement_timeout', '25s', true);
    INSERT INTO search_products (
      id, sku, source, merchant_id, title, brand, category,
      description_short, price, currency, discount_pct, in_stock,
      image_url, url, country_code, region, gtin, mpn,
      canonical_id, avg_rating, review_count, updated_at, promoted_at
    )
    VALUES (
      NEW.id, NEW.sku, NEW.source, NEW.merchant_id, NEW.title, NEW.brand, NEW.category,
      LEFT(NEW.description, 500), NEW.price, NEW.currency, NEW.discount_pct, NEW.in_stock,
      NEW.image_url, NEW.url, NEW.country_code, NEW.region, NEW.gtin, NEW.mpn,
      NEW.canonical_id, NEW.avg_rating, NEW.review_count, NEW.updated_at, now()
    )
    ON CONFLICT (id) DO NOTHING;
  EXCEPTION
    WHEN query_canceled OR lock_not_available OR deadlock_detected THEN
      RAISE WARNING 'BUY-80070 search_products sink skip id=%: %', NEW.id, SQLERRM;
    WHEN OTHERS THEN
      RAISE WARNING 'BUY-80070 search_products sink skip id=%: %', NEW.id, SQLERRM;
  END;

  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_promote_amazon_us_search_products ON public.products;

CREATE TRIGGER trg_promote_amazon_us_search_products
AFTER INSERT OR UPDATE OF source, is_active, price, title, brand, category,
  description, currency, discount_pct, in_stock, image_url, url, country_code,
  region, gtin, mpn, canonical_id, avg_rating, review_count, updated_at
ON public.products
FOR EACH ROW
WHEN (NEW.source = 'amazon_us')
EXECUTE FUNCTION public.fn_promote_amazon_us_search_products();

COMMENT ON FUNCTION public.fn_promote_amazon_us_search_products() IS
  'BUY-80070: promote Keepa amazon_us products rows into search_products. Skip timeout. Never abort the products write.';

COMMIT;
