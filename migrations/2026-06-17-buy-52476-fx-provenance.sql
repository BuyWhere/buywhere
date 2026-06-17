-- BUY-52476 [INFRA][Wave 1/4.4] FX provenance + explicit currency on api.products
--
-- Subtask 1.4 of BUY-52290. Owner: Rex (CTO). Engineer: Bolt.
--
-- ADDS ONLY. No VACUUM/CLUSTER/REINDEX. No change to existing
-- products.currency DEFAULT 'SGD' (per task 4 recommendation, audit without
-- breaking existing ingest jobs).
--
-- Three additive changes on the served catalog (roundhouse, api.products):
--
--   1) fx_rates(currency PK, rate_sgd, as_of)
--      Proves provenance for any currency conversion. Refreshed every 6h
--      by routine 'fx-refresh' (BUY-52476).
--
--   2) products.fx_as_of TIMESTAMPTZ NULL
--      Nullable: rows with no converted price stay NULL. The
--      /v1/products price-conversion read-path populates this with the
--      fx_rates.as_of used at conversion time (lazy audit trail).
--
--   3) products.currency_assumed BOOLEAN NOT NULL DEFAULT FALSE
--      Tracks rows where the effective currency was defaulted to 'SGD'
--      because the ingest path did not specify a currency. Set TRUE in
--      code paths that fall back to the column default; non-SG merchants
--      inserting currency='SGD' either flip this to TRUE or get rejected
--      (per INGEST_CURRENCY_ASSUMED_POLICY env flag, default: flip TRUE).
--
-- All statements are idempotent. Mirrored in api/src/migrate.ts so the
-- schema self-heals on every deploy.

BEGIN;

-- 1. fx_rates table: currency -> SGD rate with provenance timestamp.
CREATE TABLE IF NOT EXISTS fx_rates (
  currency   TEXT          PRIMARY KEY,
  rate_sgd   NUMERIC(20,8) NOT NULL CHECK (rate_sgd > 0),
  as_of      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- Helps the 6h refresh routine check "what currencies are stale?" without
-- scanning the whole table.
CREATE INDEX IF NOT EXISTS idx_fx_rates_as_of ON fx_rates (as_of DESC);

-- 2. fx_as_of on products: nullable audit column.
--    Null means "this row's price has not been converted at read time" OR
--    "this row's price is already in its target currency (no conversion)".
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS fx_as_of TIMESTAMPTZ;

-- Cheap partial index for the "show me rows with provenance" report:
-- only rows that were ever converted get into the index.
CREATE INDEX IF NOT EXISTS idx_products_fx_as_of_nonnull
  ON products (fx_as_of DESC)
  WHERE fx_as_of IS NOT NULL;

-- 3. currency_assumed on products: tracks default-to-SGD fallbacks.
--    NOT NULL DEFAULT FALSE is safe because PG backfills existing rows
--    in a single metadata-only ALTER on PostgreSQL 11+.
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS currency_assumed BOOLEAN NOT NULL DEFAULT FALSE;

-- Helps the "audit: which rows assumed SGD?" report without a full scan.
CREATE INDEX IF NOT EXISTS idx_products_currency_assumed_true
  ON products (currency)
  WHERE currency_assumed = TRUE;

COMMIT;
