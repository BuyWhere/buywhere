-- BUY-77109: Capture HTTP response status code on affiliate_clicks so the
-- P6.1 acceptance gate (`affiliate_redirect_success_rate_24h`, target ≥99%)
-- can be derived from the existing click sink without a new wire.
--
-- Why this migration:
--   The /r/ redirect handler returns 302 (success) / 302→FALLBACK_URL
--   (no destination) / 410 (dead link, BUY-67318) / 403 (destination not
--   permitted). Today none of those outcomes is recorded — the table only
--   stores `was_dead_at_click` (boolean for 410). The success-rate KPI
--   requires distinguishing merchant-domain 302s from non-2xx outcomes.
--
-- Strategy:
--   Add `redirect_status_code SMALLINT` (nullable; legacy rows stay NULL and
--   are excluded from the rate numerator). The redirect handler is updated
--   in the same PR to write the actual status. No backfill — historical rows
--   without a status are treated as unknown (excluded from success count),
--   which is the safe default.
--
-- Idempotent: ALTER TABLE ... ADD COLUMN IF NOT EXISTS.

BEGIN;

ALTER TABLE affiliate_clicks
  ADD COLUMN IF NOT EXISTS redirect_status_code SMALLINT;

-- Cheap partial index supporting the success-rate KPI's denominator
-- (rows in the last 24h filtered by status). The view uses an
-- EXISTS-style WHERE clause on clicked_at + status code; the index
-- lets Postgres skip-scan instead of full-sequential the table.
CREATE INDEX IF NOT EXISTS idx_affiliate_clicks_status_clicked_at
  ON affiliate_clicks(redirect_status_code, clicked_at DESC)
  WHERE redirect_status_code IS NOT NULL;

COMMIT;
