-- =============================================================================
-- BuyWhere Revenue Dashboard v0  (BUY-2517)
-- SQL script for weekly PM review — reproducible, copy-paste into any psql session
--
-- Usage:
--   psql "$DATABASE_URL" -f scripts/revenue-report.sql
--
-- Variables (change at top of file or override via \set):
--   :days  — lookback window in days  (default 90)
--   :weeks — weekly-trend window      (default 12)
-- =============================================================================

\set days  90
\set weeks 12

-- Suppress row counts for clean output
\pset footer off
\pset border 2

-- =============================================================================
-- SECTION 1: KPI ROLLUP — Day-90 revenue headline numbers
-- =============================================================================

\echo '============================================================'
\echo 'SECTION 1: Day-90 Revenue KPI Rollup'
\echo '============================================================'

SELECT
  (SELECT COUNT(*) FROM affiliate_clicks
   WHERE clicked_at >= NOW() - (:days || ' days')::interval)                    AS "Affiliate Clicks",
  (SELECT COUNT(*) FROM clicks
   WHERE clicked_at >= NOW() - (:days || ' days')::interval)                    AS "Redirect Clicks",
  (SELECT COUNT(*) FROM commission_decisions
   WHERE decided_at >= NOW() - (:days || ' days')::interval)                    AS "Conversions",
  (SELECT COALESCE(SUM(commissionable_amount), 0)::numeric(12,2)
   FROM commission_decisions
   WHERE decided_at >= NOW() - (:days || ' days')::interval)                    AS "Total Order Value (SGD)",
  (SELECT COALESCE(SUM(commission_amount), 0)::numeric(12,2)
   FROM commission_decisions
   WHERE decided_at >= NOW() - (:days || ' days')::interval)                    AS "Total Commission (SGD)",
  (SELECT COALESCE(SUM(commission_amount), 0)::numeric(12,2)
   FROM commission_decisions
   WHERE decided_at >= NOW() - (:days || ' days')::interval
     AND status = 'approved')                                                   AS "Approved Commission (SGD)",
  (SELECT COALESCE(SUM(commission_amount), 0)::numeric(12,2)
   FROM commission_decisions
   WHERE decided_at >= NOW() - (:days || ' days')::interval
     AND status = 'pending')                                                    AS "Pending Commission (SGD)",
  (SELECT COALESCE(AVG(commission_rate) * 100, 0)::numeric(5,2)
   FROM commission_decisions
   WHERE decided_at >= NOW() - (:days || ' days')::interval)                    AS "Avg Commission Rate (%)"
FROM (SELECT 1) AS _dummy;

-- =============================================================================
-- SECTION 2: AFFILIATE COVERAGE — per retailer
-- =============================================================================

\echo ''
\echo '============================================================'
\echo 'SECTION 2: Affiliate Link Coverage by Retailer'
\echo '(0 coverage = no affiliate programme connected yet)'
\echo '============================================================'

WITH retailer_products AS (
  SELECT source                       AS retailer,
         merchant_id,
         COUNT(*)                     AS total_products
  FROM products
  WHERE is_active = true
  GROUP BY source, merchant_id
),
link_counts AS (
  SELECT merchant_id,
         COUNT(*) AS affiliate_link_count
  FROM affiliate_links
  GROUP BY merchant_id
)
SELECT
  rp.retailer                                                             AS "Retailer",
  SUM(rp.total_products)                                                  AS "Total Products",
  COALESCE(SUM(lc.affiliate_link_count), 0)                               AS "Affiliate Links",
  LEAST(COALESCE(SUM(lc.affiliate_link_count), 0), SUM(rp.total_products)) AS "Products Covered",
  ROUND(
    LEAST(COALESCE(SUM(lc.affiliate_link_count), 0), SUM(rp.total_products))
      ::numeric / NULLIF(SUM(rp.total_products), 0) * 100
  , 1)                                                                    AS "Coverage %"
FROM retailer_products rp
LEFT JOIN link_counts lc USING (merchant_id)
GROUP BY rp.retailer
ORDER BY SUM(rp.total_products) DESC;

-- =============================================================================
-- SECTION 3: CONVERSION FUNNEL — commission_decisions by status
-- =============================================================================

\echo ''
\echo '============================================================'
\echo 'SECTION 3: Commission Conversion Funnel'
\echo '============================================================'

SELECT
  status                                AS "Status",
  COUNT(*)                              AS "Count",
  SUM(commission_amount)::numeric(12,2) AS "Commission Total (SGD)"
FROM commission_decisions
WHERE decided_at >= NOW() - (:days || ' days')::interval
GROUP BY status
ORDER BY COUNT(*) DESC;

-- =============================================================================
-- SECTION 4: WEEKLY TREND — last N weeks
-- =============================================================================

\echo ''
\echo '============================================================'
\echo 'SECTION 4: Weekly Trends (last :weeks weeks)'
\echo '============================================================'

WITH weeks AS (
  SELECT generate_series(
    date_trunc('week', NOW() - (:weeks || ' weeks')::interval),
    date_trunc('week', NOW()),
    '1 week'::interval
  ) AS week_start
)
SELECT
  w.week_start::date                                                       AS "Week",
  COUNT(DISTINCT ac.id)                                                    AS "Affiliate Clicks",
  COUNT(DISTINCT c.id)                                                     AS "Redirect Clicks",
  COUNT(DISTINCT cd.id)                                                    AS "Conversions",
  COALESCE(SUM(cd.commission_amount), 0)::numeric(12,2)                    AS "Commission (SGD)",
  COALESCE(SUM(cd.commission_amount) FILTER (WHERE cd.status = 'approved'), 0)::numeric(12,2)
                                                                           AS "Approved (SGD)"
FROM weeks w
LEFT JOIN affiliate_clicks ac
  ON date_trunc('week', ac.clicked_at) = w.week_start
LEFT JOIN clicks c
  ON date_trunc('week', c.clicked_at) = w.week_start
LEFT JOIN commission_decisions cd
  ON date_trunc('week', cd.decided_at) = w.week_start
GROUP BY w.week_start
ORDER BY w.week_start DESC;

-- =============================================================================
-- SECTION 5: INSTRUMENTATION GAPS — explicit list of missing data
-- =============================================================================

\echo ''
\echo '============================================================'
\echo 'SECTION 5: Instrumentation Gaps'
\echo '============================================================'

SELECT
  'affiliate_links' AS "Table",
  COUNT(*) AS "Row Count",
  CASE WHEN COUNT(*) = 0 THEN
    'CRITICAL: No affiliate links registered. Zero revenue possible.'
  ELSE
    'OK'
  END AS "Status"
FROM affiliate_links

UNION ALL

SELECT
  'affiliate_clicks',
  COUNT(*),
  CASE WHEN COUNT(*) = 0 THEN
    'WARNING: No clicks recorded. Redirect route may not be in use or no affiliate links exist.'
  ELSE 'OK' END
FROM affiliate_clicks

UNION ALL

SELECT
  'conversions',
  COUNT(*),
  CASE WHEN COUNT(*) = 0 THEN
    'CRITICAL: No conversions. Affiliate postback webhook not yet integrated.'
  ELSE 'OK' END
FROM conversions

UNION ALL

SELECT
  'commission_decisions',
  COUNT(*),
  CASE WHEN COUNT(*) = 0 THEN
    'CRITICAL: No commission decisions. Revenue = $0 SGD.'
  ELSE 'OK' END
FROM commission_decisions

UNION ALL

SELECT
  'merchants',
  COUNT(*),
  CASE WHEN COUNT(*) = 0 THEN
    'INFO: merchants table empty. Populate with merchant affiliate programme details.'
  ELSE 'OK' END
FROM merchants;

-- =============================================================================
-- SECTION 6: TOP CLICKED PRODUCTS (when data exists)
-- =============================================================================

\echo ''
\echo '============================================================'
\echo 'SECTION 6: Top Clicked Products (last :days days)'
\echo '============================================================'

SELECT
  ac.product_id                       AS "Product ID",
  ac.merchant_id                      AS "Merchant",
  COUNT(*)                            AS "Clicks",
  MAX(ac.clicked_at)                  AS "Last Click"
FROM affiliate_clicks ac
WHERE ac.clicked_at >= NOW() - (:days || ' days')::interval
GROUP BY ac.product_id, ac.merchant_id
ORDER BY COUNT(*) DESC
LIMIT 20;

\echo ''
\echo '============================================================'
\echo 'END OF REPORT'
\echo 'Run this weekly: psql $DATABASE_URL -f scripts/revenue-report.sql'
\echo '============================================================'
