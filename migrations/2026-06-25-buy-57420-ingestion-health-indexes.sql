-- BUY-57420 Recurring ingestion pipeline health check
--
-- Add performance indexes for the /v1/ingest/health endpoint queries.
-- Root cause: ingestion_runs had only a primary key on (id), causing
-- sequential scans of 190K+ rows on every health check call.
--
-- Queries accelerated:
--   1. "runs in last 24h by source+status"  (46ms → 0.2ms)
--   2. "zombie runs >1h"                    (seq scan → instant)
--   3. "running runs filtered by time"      (partial index)

-- Wide index covering the most common 24h-window grouping query
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ingestion_runs_started_at
ON ingestion_runs (started_at);

-- Composite index for the GROUP BY source, status query pattern
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ingestion_runs_source_status_started
ON ingestion_runs (source, status, started_at DESC);

-- Partial index for zombie detection (filters 99.9% of rows)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ingestion_runs_running
ON ingestion_runs (status, started_at) WHERE status = 'running';
