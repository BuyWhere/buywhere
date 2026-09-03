-- BUY-22737 / BUY-35381: monitoring.alert_history.kind column
-- Adds a `kind` discriminator so the deploy-fail routine (Rex's child BUY-35392)
-- can store 'deploy_fail' rows alongside the existing 'p95' threshold breach rows.
-- Single ALTER, no concurrency concerns.
--
-- Applied 2026-06-08T09:18Z against the roundhouse Postgres (DATABASE_URL).

ALTER TABLE monitoring.alert_history
  ADD COLUMN IF NOT EXISTS kind varchar(32) NOT NULL DEFAULT 'p95';
