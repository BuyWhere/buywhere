-- BUY-52473 [INFRA][Wave 1/4.1] Extend query_log to capture returned_product_ids + positions (api.products)
--
-- Additive only — no DROP/ALTER on existing columns. Both new columns are
-- NULLABLE with no DEFAULT, so ALTER TABLE ... ADD COLUMN is metadata-only
-- in PostgreSQL and completes in milliseconds (well under the 60s DDL
-- kill-watch threshold on maglev).
--
--   * returned_product_ids bigint[]  — ordered list of product IDs in the
--     exact same order (and same id-space) as the response `results` array.
--     Index 0 = top result. NULL for handlers that don't return product
--     IDs (e.g. /merchants, /categories). Default null so existing writers
--     are unaffected.
--   * country_code        varchar(2) — 2-letter ISO code from the request
--     (canonical: req.query.country_code; alias: req.query.country) or
--     resolved from req.countryCode middleware. Default null. Backs the
--     per-region impression accounting.
--
-- GIN index on returned_product_ids is DEFERRED until query patterns on
-- the new column are clear (the verify query in BUY-52473 uses
-- unnest(returned_product_ids) over a 7-day window, which the planner
-- can serve from a heap scan of the (created_at, endpoint) range filter
-- without an index on the array column).
--
-- Mirrored in api/src/migrate.ts (runMigrations) so the schema self-heals
-- on every deploy. All statements are idempotent.

BEGIN;

ALTER TABLE query_log ADD COLUMN IF NOT EXISTS returned_product_ids bigint[];
ALTER TABLE query_log ADD COLUMN IF NOT EXISTS country_code        varchar(2);

COMMIT;
