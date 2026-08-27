-- BUY-75445: Extend monitoring.v_ceo_kpis with the P2.7 gate-counter (external-agent
-- v2 call volume) so the BUY-75346 daily monitor can self-verify the 14-day streak.
--
-- Why this migration:
--   The v2 wire writer (BUY-75415, api/src/monitoring/v2KpiWriter.ts) writes
--   monitoring.deliver_to_calls rows tagged bucket='external-agent' for every
--   non-internal v2 tools/call. The 14-day P2.7 adoption gate requires
--   `external-agent rows > 0/day`, but no public endpoint exposes the count.
--   The existing view already powers silently_empty_rate_24h + deliver_to_pass_rate_24h
--   via the same sink — adding the gate-counter here keeps the readback shape
--   consistent and centralises window math in one place.
--
-- Window coverage:
--   The existing view only computes 24h aggregates (the silently_empty_rate_24h +
--   deliver_to_pass_rate_24h columns are 24h-scoped today). Reed's BUY-75445
--   request explicitly asks for 24h / 7d / 30d variants of the new counter; we
--   add those six fields without retrofitting window-scoping onto the two
--   pre-existing rate columns (kept 24h to preserve consumer contracts). Future
--   work can lift the rate columns to per-window if Reed asks.
--
-- Idempotent: CREATE OR REPLACE VIEW (atomic swap), and the new CTE names do not
-- collide with existing objects. Safe to re-run.

BEGIN;

-- Replace v_ceo_kpis with the extended version. The 7 P1.3-NM columns and the
-- two pre-existing rate columns are preserved verbatim (positional + type).
CREATE OR REPLACE VIEW monitoring.v_ceo_kpis AS
WITH daily_sweeps AS (
  SELECT
    date_trunc('day'::text, (sweep_results.swept_at AT TIME ZONE 'UTC'::text))::date
      AS day,
    avg(sweep_results.near_miss_rate) AS daily_near_miss_rate
  FROM monitoring.sweep_results
  WHERE sweep_results.swept_at >= (CURRENT_DATE - '7 days'::interval)
  GROUP BY (date_trunc('day'::text,
           (sweep_results.swept_at AT TIME ZONE 'UTC'::text))::date)
),
seven_day AS (
  SELECT COALESCE(avg(daily_sweeps.daily_near_miss_rate), 0::numeric)
    AS near_miss_rate
  FROM daily_sweeps
),
latest_sweep AS (
  SELECT COALESCE(max(sweep_results.near_miss_rate), 0::numeric)
    AS max_near_miss_rate
  FROM monitoring.sweep_results
  WHERE sweep_results.sweep_id = (
    SELECT sweep_results_1.sweep_id
      FROM monitoring.sweep_results sweep_results_1
     ORDER BY sweep_results_1.swept_at DESC
     LIMIT 1
  )
),
empty_window AS (
  SELECT
    count(*)                                          FILTER (WHERE TRUE) AS total_empty,
    count(*)                                          FILTER (WHERE emptiness_reason IS NULL) AS silently_empty
  FROM monitoring.mcp_empty_responses
  WHERE called_at >= NOW() - INTERVAL '24 hours'
),
deliver_to_window AS (
  SELECT
    count(*)                                    FILTER (WHERE TRUE) AS total_calls,
    count(*)                                    FILTER (WHERE deliver_to_iso IS NOT NULL AND gate_passed) AS pass_calls
  FROM monitoring.deliver_to_calls
  WHERE called_at >= NOW() - INTERVAL '24 hours'
),
-- BUY-75445: per-window external-agent call counters. bucket='external-agent'
-- is written by api/src/monitoring/v2KpiWriter.ts after the INTERNAL_KEY_PREFIXES
-- filter (rex-/monitor-/health-/atlas-/probe-/test-) — so the count is the
-- gate counter Reed needs. Internal probes never reach these rows.
ext_agent_24h AS (
  SELECT
    count(*)                                                       AS calls,
    count(*) FILTER (WHERE deliver_to_iso IS NOT NULL AND gate_passed) AS calls_passed
  FROM monitoring.deliver_to_calls
  WHERE bucket = 'external-agent'
    AND called_at >= NOW() - INTERVAL '24 hours'
),
ext_agent_7d AS (
  SELECT
    count(*)                                                       AS calls,
    count(*) FILTER (WHERE deliver_to_iso IS NOT NULL AND gate_passed) AS calls_passed
  FROM monitoring.deliver_to_calls
  WHERE bucket = 'external-agent'
    AND called_at >= NOW() - INTERVAL '7 days'
),
ext_agent_30d AS (
  SELECT
    count(*)                                                       AS calls,
    count(*) FILTER (WHERE deliver_to_iso IS NOT NULL AND gate_passed) AS calls_passed
  FROM monitoring.deliver_to_calls
  WHERE bucket = 'external-agent'
    AND called_at >= NOW() - INTERVAL '30 days'
)
SELECT
  CURRENT_DATE                                  AS report_date,
  0::numeric                                    AS zero_result_rate,
  seven_day.near_miss_rate,
  seven_day.near_miss_rate < 0.03               AS near_miss_7day_mean_under_threshold,
  latest_sweep.max_near_miss_rate < 0.04        AS near_miss_latest_sweep_under_threshold,
  CASE
    WHEN seven_day.near_miss_rate < 0.03
         AND latest_sweep.max_near_miss_rate < 0.04 THEN 'healthy'::text
    WHEN seven_day.near_miss_rate < 0.05             THEN 'warning'::text
    ELSE                                                  'critical'::text
  END                                           AS p1_3_nm_status,
  now()                                         AS computed_at,
  CASE
    WHEN empty_window.total_empty = 0            THEN NULL
    ELSE round(empty_window.silently_empty::numeric
              / empty_window.total_empty::numeric, 6)
  END                                           AS silently_empty_rate_24h,
  CASE
    WHEN deliver_to_window.total_calls = 0      THEN NULL
    ELSE round(deliver_to_window.pass_calls::numeric
              / deliver_to_window.total_calls::numeric, 6)
  END                                           AS deliver_to_pass_rate_24h,
  -- BUY-75445: P2.7 gate-counter — Reed's 14-day monitor at BUY-75346 reads
  -- these to confirm the streak without DB access.
  ext_agent_24h.calls::bigint                   AS mcp_v2_external_agent_calls_24h,
  ext_agent_7d.calls::bigint                    AS mcp_v2_external_agent_calls_7d,
  ext_agent_30d.calls::bigint                   AS mcp_v2_external_agent_calls_30d,
  ext_agent_24h.calls_passed::bigint            AS mcp_v2_external_agent_calls_with_deliver_to_24h,
  ext_agent_7d.calls_passed::bigint             AS mcp_v2_external_agent_calls_with_deliver_to_7d,
  ext_agent_30d.calls_passed::bigint            AS mcp_v2_external_agent_calls_with_deliver_to_30d
FROM seven_day, latest_sweep, empty_window, deliver_to_window,
     ext_agent_24h, ext_agent_7d, ext_agent_30d;

COMMIT;