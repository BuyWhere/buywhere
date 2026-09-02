-- BUY-75183: Acceptance-gate sinks + v_ceo_kpis columns for P2.6 (mcp_empty_responses)
-- and P2.7 (deliver_to_calls). Wire-LIVE on production mcp.buywhere.ai (verified
-- 2026-08-24 + 2026-08-25); this migration only adds the data sinks + the
-- readback columns Reed (CPO) needs to start the 14-day rolling clock.
--
-- Idempotent: every statement uses IF NOT EXISTS / OR REPLACE so re-runs on
-- deploy are safe (mirrors the embedded migrations in api/src/migrate.ts).
--
-- Why three objects:
--   1. monitoring.mcp_empty_responses — append-only sink. Every empty 200 OK
--      with an emptiness_reason (incl. api_error from BUY-74991) inserts a row.
--      silently_empty_count = rows where emptiness_reason IS NULL (a separate
--      sensor) lets v_ceo_kpis compute silently_empty_rate_24h.
--   2. monitoring.deliver_to_calls — per-call observability for the P2.7
--      v2 wire gate. Existing monitoring.mcp_v2_request_log already produces
--      these rows; the new table is the durable KPI sink with the gate outcome.
--      Backfill from mcp_v2_request_log captures the 33 rows from 08-21+ so
--      the 14-day clock starts from the wire-live moment, not from today.
--   3. monitoring.v_ceo_kpis — preserves the existing 7 columns (P1.3-NM
--      dependency) and appends silently_empty_rate_24h + deliver_to_pass_rate_24h.
--      View is OR REPLACE so the rewrite is atomic and existing readers do not
--      briefly see a malformed view.

BEGIN;

-- 1) Empty-response sink (P2.6 §3)
CREATE TABLE IF NOT EXISTS monitoring.mcp_empty_responses (
  id                     BIGSERIAL PRIMARY KEY,
  tool_name              TEXT        NOT NULL,
  region                 TEXT,
  category               TEXT,
  emptiness_reason       TEXT,
  confidence             TEXT,
  engine_status          TEXT,
  indexed_for_region     BOOLEAN,
  category_recognized    BOOLEAN,
  rate_limit_remaining   INT,
  called_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mcp_empty_responses_called_at
  ON monitoring.mcp_empty_responses (called_at DESC);

CREATE INDEX IF NOT EXISTS idx_mcp_empty_responses_silently_empty
  ON monitoring.mcp_empty_responses (called_at DESC)
  WHERE emptiness_reason IS NULL;

-- 2) deliver_to call sink (P2.7 §3)
CREATE TABLE IF NOT EXISTS monitoring.deliver_to_calls (
  id                      BIGSERIAL PRIMARY KEY,
  tool_name               TEXT        NOT NULL,
  deliver_to_iso          TEXT,
  deliver_to_inferred     BOOLEAN     NOT NULL DEFAULT FALSE,
  gate_passed             BOOLEAN     NOT NULL,
  empty                   BOOLEAN     NOT NULL DEFAULT FALSE,
  called_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_deliver_to_calls_called_at
  ON monitoring.deliver_to_calls (called_at DESC);

CREATE INDEX IF NOT EXISTS idx_deliver_to_calls_gate_passed_at
  ON monitoring.deliver_to_calls (called_at DESC, gate_passed)
  WHERE gate_passed = TRUE;

-- 3) Backfill from mcp_v2_request_log (the v2 wire already writes here).
--    Map the existing columns onto the new sink so the 14-day rolling clock
--    can include the rows already in flight (33 since 08-21).
INSERT INTO monitoring.deliver_to_calls
  (tool_name, deliver_to_iso, deliver_to_inferred, gate_passed, empty, called_at)
SELECT
  v.tool_name,
  v.country_code AS deliver_to_iso,
  FALSE          AS deliver_to_inferred,
  v.gate_passed,
  (v.outcome = 'success_empty') AS empty,
  v.received_at  AS called_at
FROM monitoring.mcp_v2_request_log v
WHERE NOT EXISTS (
  SELECT 1 FROM monitoring.deliver_to_calls d
  WHERE d.tool_name  = v.tool_name
    AND d.called_at  = v.received_at
);

-- 4) Extend v_ceo_kpis: keep all 7 existing columns, append the 2 new ones.
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
  END                                           AS deliver_to_pass_rate_24h
FROM seven_day, latest_sweep, empty_window, deliver_to_window;

COMMIT;
