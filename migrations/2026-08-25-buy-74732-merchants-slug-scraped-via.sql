-- BUY-74732: Add slug + scraped_via columns to merchants, and scraped_via to
-- products, so the wire can surface the verified-mark signal that drives the FE
-- `<MerchantBadge>` ✓ on `first_party` rows.
--
-- All statements are idempotent — they mirror the embedded migrations in
-- api/src/migrate.ts (runMigrations), which self-heals on every deploy.
--
-- Why three columns:
--   - merchants.slug: URL-safe kebab-case identifier (e.g. "tangs-sg"). The
--     `lookupMerchantMap` SELECT prefers this column over the JS-side slugify
--     of `merchants.name`. Lets Oracle stamp a stable slug without us
--     re-deriving it on every request.
--   - merchants.scraped_via: how the merchant was sourced (first_party /
--     affiliate / aggregator). Acts as the legacy fallback when
--     products.scraped_via is null on a row.
--   - products.scraped_via: per-row provenance. Stamped at ingest by the
--     scraper when known; nullable today because most existing rows weren't
--     backfilled. Forward-compatible — wire emits null when missing, FE keeps
--     using config.verified for US retailers.
--
-- Applied via api/src/migrate.ts on deploy. This file exists for ops/audit
-- parity with the migration history (see migrations/2026-06-16-buy-52288-…).

BEGIN;

ALTER TABLE merchants ADD COLUMN IF NOT EXISTS slug         TEXT;
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS scraped_via TEXT;
ALTER TABLE products  ADD COLUMN IF NOT EXISTS scraped_via TEXT;

COMMIT;
