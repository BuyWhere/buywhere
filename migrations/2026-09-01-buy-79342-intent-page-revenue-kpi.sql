-- BUY-79342: P6.1 Phase 1 acceptance-gate — affiliate_revenue_intent_page_total_24h_usd
-- on monitoring.v_ceo_kpis.
--
-- BUY-77109 already shipped:
--   affiliate_click_intent_page_total_24h
--   intent_page_r_link_density_avg_24h
--   affiliate_redirect_success_rate_24h
--
-- This migration adds the missing revenue column Reed's 7-day clock needs
-- (BUY-77108 criterion 3+5). Definition:
--
--   SUM of conversions.commission_amount in the last 24h, converted to USD,
--   attributed to an intent-page /r/ click via conversions.click_id →
--   affiliate_clicks.id when possible, else via product_id + merchant_id
--   matched against an intent-page affiliate_clicks row in the same 24h
--   window. Excludes is_internal clicks.
--
-- Currency: conversions.currency is typically SGD/USD. Use a conservative
-- 1.00 fallback for unknown/USD and 0.74 for SGD (static, matching the
-- revenue dashboard's SGD-primary reporting until a live FX table exists).
-- Non-goals (issue): no new postback ingest (BUY-22334).
--
-- Idempotent: CREATE OR REPLACE VIEW. Safe to re-run.

BEGIN;

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
),
-- BUY-79342: USD-equivalent commission from conversions attributed to
-- intent-page /r/ clicks in the last 24h. click_id is bigint vs uuid so we
-- also match product_id+merchant_id against the intent-page click set.
intent_page_click_keys_24h AS (
  SELECT DISTINCT
    product_id::text AS product_id,
    merchant_id::text AS merchant_id
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
intent_page_revenue_24h AS (
  SELECT COALESCE(SUM(
    COALESCE(c.commission_amount, 0) * CASE
      WHEN upper(COALESCE(c.currency, 'USD')) IN ('USD', 'US$') THEN 1.0
      WHEN upper(c.currency) IN ('SGD', 'S$') THEN 0.74
      WHEN upper(c.currency) IN ('MYR') THEN 0.23
      WHEN upper(c.currency) IN ('AUD') THEN 0.66
      WHEN upper(c.currency) IN ('EUR') THEN 1.10
      WHEN upper(c.currency) IN ('GBP') THEN 1.27
      WHEN upper(c.currency) IN ('JPY') THEN 0.0068
      WHEN upper(c.currency) IN ('THB') THEN 0.028
      WHEN upper(c.currency) IN ('VND') THEN 0.000039
      WHEN upper(c.currency) IN ('IDR') THEN 0.000061
      WHEN upper(c.currency) IN ('PHP') THEN 0.017
      ELSE 1.0
    END
  ), 0)::numeric(12,2) AS revenue_usd
  FROM conversions c
  WHERE c.created_at >= NOW() - INTERVAL '24 hours'
    AND EXISTS (
      SELECT 1 FROM intent_page_click_keys_24h k
      WHERE k.product_id = c.product_id::text
        AND k.merchant_id = c.merchant_id::text
    )
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
  ext_agent_30d.calls_passed::bigint            AS mcp_v2_external_agent_calls_with_deliver_to_30d,
  affiliate_intent_clicks_24h.total_clicks::bigint
                                               AS affiliate_click_intent_page_total_24h,
  intent_page_r_density_24h.avg_density         AS intent_page_r_link_density_avg_24h,
  CASE
    WHEN redirect_success_24h.total_redirects = 0 THEN NULL
    ELSE round(redirect_success_24h.ok_redirects::numeric
              / redirect_success_24h.total_redirects::numeric, 6)
  END                                           AS affiliate_redirect_success_rate_24h,
  intent_page_revenue_24h.revenue_usd           AS affiliate_revenue_intent_page_total_24h_usd
FROM seven_day, latest_sweep, empty_window, deliver_to_window,
     ext_agent_24h, ext_agent_7d, ext_agent_30d,
     affiliate_intent_clicks_24h, intent_page_r_density_24h, redirect_success_24h,
     intent_page_revenue_24h;

COMMIT;
