-- BUY-71135: P1.3-NM near-miss rate KPIs
-- Adds near_miss_rate column to monitoring.alert_history for sweep breach tracking.
-- Also adds sweep_id to correlate with the 225-cell basket sweep runs.
--
-- Applied 2026-08-17T23:58Z against the catalog DB (sakura proxy).

-- Add near_miss_rate column for P1.3-NM sweep tracking
ALTER TABLE monitoring.alert_history
  ADD COLUMN IF NOT EXISTS near_miss_rate NUMERIC(5,4);

-- Add sweep_id to correlate alerts with specific 225-cell basket runs
ALTER TABLE monitoring.alert_history
  ADD COLUMN IF NOT EXISTS sweep_id TEXT;

-- Add predicate_fails_reason for per-cell child issue filing (dominant failure mode)
ALTER TABLE monitoring.alert_history
  ADD COLUMN IF NOT EXISTS predicate_fails_reason TEXT;

-- Add index for efficient querying by sweep_id
CREATE INDEX IF NOT EXISTS idx_alert_history_sweep_id
  ON monitoring.alert_history (sweep_id) WHERE sweep_id IS NOT NULL;

-- Add index for near_miss_rate filtering (breach detection)
CREATE INDEX IF NOT EXISTS idx_alert_history_near_miss_rate
  ON monitoring.alert_history (near_miss_rate) WHERE near_miss_rate IS NOT NULL;
