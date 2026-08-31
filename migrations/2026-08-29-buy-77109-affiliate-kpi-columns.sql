-- BUY-77109: P6.1 acceptance-gate KPI columns on monitoring.v_ceo_kpis.
--
-- Spec: buywhere-repo/specs/P6.1-affiliate-acceptance-gate-spec.md
--       (work-product filed on BUY-75629; acceptance gate BUY-77108).
--
-- Three new columns, all 24h-window, refreshed hourly by the BUY-77109
-- probe worker running in monitoring-api:
--
-- 1. affiliate_click_intent_page_total_24h
--    SUM of affiliate_clicks rows in the last 24h where source='product_card'
--    AND source_page starts with one of /cheapest-, /best-, /top-, /review-.
--    The /r/ redirect handler writes source_page from the ?pathname=
--    query param set at click time by src/lib/click-attribution.ts. Source
--    is set to 'product_card' by the same attribution layer.
--    Excludes internal probes (is_internal=true) so QA traffic doesn't
--    inflate the metric.
--
-- 2. intent_page_r_link_density_avg_24h
--    Average count of `href="/r/"` matches per intent-page HTML response,
--    sampled across 5 canonical probe slugs by the BUY-77109 probe worker
--    (see monitoring.intent_page_r_link_probes). Refreshes hourly; if no
--    probe rows exist in the window, returns 0 (not NULL) so the route
--    surfaces a numeric baseline.
--
-- 3. affiliate_redirect_success_rate_24h
--    % of /r/ clicks in the last 24h that completed with HTTP 2xx (302 to
--    merchant domain). Excludes NULL redirect_status_code (legacy rows
--    pre-BUY-77109 schema) from both numerator and denominator — treats
--    unknown as "not counted" rather than counting it as a failure.
--    Excludes internal probes (is_internal=true).
--
-- Schema design:
--   - monitoring.intent_page_r_link_probes is the sink table for the
--     hourly probe worker (one row per slug per probe cycle). Kept narrow:
--     slug, r_link_count, probed_at, http_status, html_size_bytes.
--   - The view reads only the last 24h of probe rows; index on probed_at
--     keeps the aggregation cheap.
--   - replaces the view atomically with CREATE OR REPLACE VIEW — no DDL
--     churn on dependent consumers.
--
-- Idempotent: CREATE TABLE IF NOT EXISTS + CREATE OR REPLACE VIEW. Safe
-- to re-run; the partial indexes are likewise IF NOT EXISTS.

BEGIN;

-- Probe sink — written by the BUY-77109 hourly worker running in
-- monitoring-api/api/src/monitoring/intent_page_probe.js. The worker is
-- shipped in the same PR; the table is the contract.
CREATE TABLE IF NOT EXISTS monitoring.intent_page_r_link_probes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL,
  probed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  http_status INTEGER,
  r_link_count INTEGER NOT NULL,
  html_size_bytes INTEGER
);
CREATE INDEX IF NOT EXISTS idx_intent_page_probes_slug_probed_at
  ON monitoring.intent_page_r_link_probes(slug, probed_at DESC);
CREATE INDEX IF NOT EXISTS idx_intent_page_probes_probed_at
  ON monitoring.intent_page_r_link_probes(probed_at DESC);

-- Extend v_ceo_kpis. P1.3-NM columns + the two pre-existing rate columns
-- + the six BUY-75445 external-agent counters are preserved verbatim
-- (positional + type). Only the SELECT list gains three new fields.
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
),
-- BUY-77109 P6.1 acceptance-gate CTEs. All three respect the 24h window
-- and the is_internal probe filter so QA traffic doesn't poison the metric.
affiliate_intent_clicks_24h AS (
  SELECT
    count(*) FILTER (WHERE redirect_status_code BETWEEN 200 AND 399) AS ok_clicks,
    count(*)                                                        AS total_clicks
  FROM affiliate_clicks
  WHERE clicked_at >= NOW() - INTERVAL '24 hours'
    AND (is_internal = false OR is_internal IS NULL)
    AND source = 'product_card'
    AND (
      source_page LIKE '/cheapest-%' OR
      source_page LIKE '/best-%'      OR
      source_page LIKE '/top-%'       OR
      source_page LIKE '/review-%'    OR
      source_page = '/cheapest'      OR
      source_page = '/best'          OR
      source_page = '/top'           OR
      source_page = '/review'
    )
),
intent_page_r_density_24h AS (
  SELECT
    COALESCE(avg(probes.r_link_count), 0::numeric) AS avg_density,
    count(*)                                       AS probe_count
  FROM monitoring.intent_page_r_link_probes probes
  WHERE probes.probed_at >= NOW() - INTERVAL '24 hours'
    AND probes.http_status = 200
),
redirect_success_24h AS (
  SELECT
    count(*) FILTER (WHERE redirect_status_code BETWEEN 200 AND 399) AS ok_redirects,
    count(*)                                                        AS total_redirects
  FROM affiliate_clicks
  WHERE clicked_at >= NOW() - INTERVAL '24 hours'
    AND (is_internal = false OR is_internal IS NULL)
    AND redirect_status_code IS NOT NULL
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
  ext_agent_24h.calls::bigint                   AS mcp_v2_external_agent_calls_24h,
  ext_agent_7d.calls::bigint                    AS mcp_v2_external_agent_calls_7d,
  ext_agent_30d.calls::bigint                   AS mcp_v2_external_agent_calls_30d,
  ext_agent_24h.calls_passed::bigint            AS mcp_v2_external_agent_calls_with_deliver_to_24h,
  ext_agent_7d.calls_passed::bigint             AS mcp_v2_external_agent_calls_with_deliver_to_7d,
  ext_agent_30d.calls_passed::bigint             AS mcp_v2_external_agent_calls_with_deliver_to_30d,
  -- BUY-77109 P6.1 acceptance-gate metrics
  affiliate_intent_clicks_24h.total_clicks::bigint
                                               AS affiliate_click_intent_page_total_24h,
  intent_page_r_density_24h.avg_density         AS intent_page_r_link_density_avg_24h,
  CASE
    WHEN redirect_success_24h.total_redirects = 0 THEN NULL
    ELSE round(redirect_success_24h.ok_redirects::numeric
              / redirect_success_24h.total_redirects::numeric, 6)
  END                                           AS affiliate_redirect_success_rate_24h
FROM seven_day, latest_sweep, empty_window, deliver_to_window,
     ext_agent_24h, ext_agent_7d, ext_agent_30d,
     affiliate_intent_clicks_24h, intent_page_r_density_24h, redirect_success_24h;

COMMIT;
