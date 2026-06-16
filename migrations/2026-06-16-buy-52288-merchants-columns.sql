-- BUY-52288: GET /v1/merchants was returning HTTP 500 because the live
-- merchants table was created (2026-05/06 timeframe) with only
-- (id, name, source, country, created_at, onboarding_stage), but the
-- /v1/merchants route handlers (POST /upsert, GET /, GET /:id) reference
-- 10 other columns. The MERCHANTS_MIGRATION in api/src/migrate.ts uses
-- CREATE TABLE IF NOT EXISTS which is a no-op on an existing table, so the
-- columns were never added.
--
-- The same DB bug also broke the sitemap call
-- /v1/merchants?country=SG&onboarding_stage=ingested&is_active=true used by
-- getAllRegionMerchantListingSitemapEntries in src/lib/sitemaps.ts — every
-- region returned 500 → empty <urlset/> → Google Search Console reports
-- the merchant sitemap as empty.
--
-- This migration is mirrored in api/src/migrate.ts (runMigrations()) so the
-- schema self-heals on every deploy. All statements are idempotent.
--
-- A secondary issue: the site's BUYWHERE_API_KEY (bw_beta_e804b9c6...)
-- was not in the api_keys table, so the sitemap's authenticated call
-- returned 401. That key was registered manually as tier=internal on
-- 2026-06-16 13:55Z; the 401 root cause is not in the schema and is
-- out of scope for this migration.
--
-- Applied 2026-06-16 13:46Z against the roundhouse Postgres (DATABASE_URL).

BEGIN;

ALTER TABLE merchants ADD COLUMN IF NOT EXISTS domain            TEXT;
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS contact_email     TEXT;
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS contact_phone     TEXT;
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS scraping_priority TEXT     DEFAULT 'medium';
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS is_active         BOOLEAN  NOT NULL DEFAULT true;
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS first_indexed_at  TIMESTAMPTZ;
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS products_count    INTEGER;
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS last_scraped_at   TIMESTAMPTZ;
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS scrape_error      TEXT;
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- Backfill updated_at for the 70,090 pre-existing rows that were created
-- before the column existed. updated_at is NOT NULL, so this backfill is
-- required to make the ALTER TABLE succeed on a table that already has rows.
UPDATE merchants SET updated_at = created_at WHERE updated_at IS NULL;

COMMIT;
