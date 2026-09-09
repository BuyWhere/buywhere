-- BUY-74597: separate timeout/degraded telemetry from true-empty.
-- Adds a nullable degraded_kind column on query_log so the KPI dashboards
-- (`silently_empty_rate_24h`) can exclude degraded responses without joining
-- JSON RPC content. No backfill — existing rows remain NULL (unknown).
-- Populated only for requests that flow through queryLogMiddleware after deploy.

ALTER TABLE query_log ADD COLUMN IF NOT EXISTS degraded_kind text;
CREATE INDEX IF NOT EXISTS idx_query_log_degraded_kind_at
  ON query_log (created_at DESC)
  WHERE degraded_kind IS NOT NULL;