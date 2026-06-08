-- BUY-22737 / BUY-35381: monitoring.uptime_daily view
-- Reuses the existing monitoring.p95_raw_measurements table as the probe store
-- (12,128 historical rows preserved from the 2026-05/06 non-prod prober run).
-- No new tables, no concurrent DDL. Single CREATE OR REPLACE.
--
-- Applied 2026-06-08T09:18Z against the roundhouse Postgres (DATABASE_URL).

CREATE OR REPLACE VIEW monitoring.uptime_daily AS
SELECT
  date_trunc('day', measured_at AT TIME ZONE 'UTC')::date AS day,
  endpoint,
  market AS region,
  COUNT(*)                                          AS total,
  COUNT(*) FILTER (WHERE status_code BETWEEN 200 AND 399) AS ok_count,
  percentile_cont(0.50) WITHIN GROUP (ORDER BY response_time_ms) AS p50_ms,
  percentile_cont(0.95) WITHIN GROUP (ORDER BY response_time_ms) AS p95_ms,
  percentile_cont(0.99) WITHIN GROUP (ORDER BY response_time_ms) AS p99_ms
FROM monitoring.p95_raw_measurements
GROUP BY 1, 2, 3;
