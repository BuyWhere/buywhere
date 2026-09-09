-- BUY-71135: v_ceo_kpis view with near_miss_rate
-- Creates or replaces the v_ceo_kpis view to include near_miss_rate
-- paired with zero_result_rate for side-by-side failure mode display.
--
-- Applied 2026-08-18T00:10Z against the catalog DB (sakura proxy).

-- Drop existing view if exists (for clean recreation)
DROP VIEW IF EXISTS monitoring.v_ceo_kpis;

-- Create v_ceo_kpis daily aggregated view
-- Combines zero_result_rate (existing) with near_miss_rate (new P1.3-NM)
CREATE VIEW monitoring.v_ceo_kpis AS
SELECT
  -- Date dimension
  CURRENT_DATE AS report_date,

  -- Zero-result rate (existing P1.3 metric)
  COALESCE(
    (SELECT COUNT(*)::NUMERIC / NULLIF(COUNT(*), 0)
     FROM monitoring.p95_latency
     WHERE result_count = 0
       AND window_start >= CURRENT_DATE - INTERVAL '1 day'),
    0
  ) AS zero_result_rate,

  -- Near-miss rate (new P1.3-NM metric)
  -- Derived from alert_history near_miss_rate column for 7-day rolling mean
  COALESCE(
    (SELECT AVG(near_miss_rate)
     FROM monitoring.alert_history
     WHERE kind = 'near_miss_breach'
       AND triggered_at >= CURRENT_DATE - INTERVAL '7 days'),
    0
  ) AS near_miss_rate,

  -- Rolling 7-day mean check (for acceptance criteria)
  COALESCE(
    (SELECT AVG(near_miss_rate)
     FROM monitoring.alert_history
     WHERE kind = 'near_miss_breach'
       AND triggered_at >= CURRENT_DATE - INTERVAL '7 days'),
    0
  ) < 0.03 AS near_miss_7day_mean_under_threshold,

  -- Individual sweep check (must be <4% per acceptance)
  COALESCE(
    (SELECT near_miss_rate
     FROM monitoring.alert_history
     WHERE kind = 'near_miss_breach'
     ORDER BY triggered_at DESC
     LIMIT 1),
    0
  ) < 0.04 AS near_miss_latest_sweep_under_threshold,

  -- Combined P1.3 health status
  CASE
    WHEN COALESCE(
      (SELECT AVG(near_miss_rate)
       FROM monitoring.alert_history
       WHERE kind = 'near_miss_breach'
         AND triggered_at >= CURRENT_DATE - INTERVAL '7 days'),
      0
    ) < 0.03
    AND COALESCE(
      (SELECT near_miss_rate
       FROM monitoring.alert_history
       WHERE kind = 'near_miss_breach'
       ORDER BY triggered_at DESC
       LIMIT 1),
      0
    ) < 0.04
    THEN 'healthy'
    WHEN COALESCE(
      (SELECT AVG(near_miss_rate)
       FROM monitoring.alert_history
       WHERE kind = 'near_miss_breach'
         AND triggered_at >= CURRENT_DATE - INTERVAL '7 days'),
      0
    ) < 0.05
    THEN 'warning'
    ELSE 'critical'
  END AS p1_3_nm_status,

  -- Timestamp
  NOW() AS computed_at;
