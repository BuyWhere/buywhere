/**
 * Revenue Dashboard v0 — BUY-2517
 *
 * SQL-backed commission and affiliate coverage report.
 * Answers the weekly PM question: "Where is monetisation missing?"
 *
 * GET /v1/revenue/report
 *   ?days=90   lookback window (max 90, default 90)
 *   ?weeks=12  weekly-trend window (max 52, default 12)
 */
import { Router, Request, Response } from 'express';
import { db } from '../config';
import { requireApiKey } from '../middleware/apiKey';

const router = Router();

// ---------------------------------------------------------------------------
// GET /v1/revenue/report
// ---------------------------------------------------------------------------
router.get('/report', requireApiKey, async (req: Request, res: Response) => {
  const days = Math.min(parseInt((req.query.days as string) || '90'), 90);
  const weeks = Math.min(parseInt((req.query.weeks as string) || '12'), 52);

  try {
    const [kpiResult, coverageResult, weeklyResult, clicksResult, convResult] = await Promise.all([
      // 1. Day-N revenue KPI rollup (commission totals)
      db.query<{
        total_clicks: string;
        total_conversions: string;
        total_order_value_sgd: string;
        total_commission_sgd: string;
        approved_commission_sgd: string;
        pending_commission_sgd: string;
        avg_commission_rate: string;
      }>(
        `SELECT
           (SELECT COUNT(*)::text FROM affiliate_clicks
            WHERE clicked_at >= NOW() - ($1 || ' days')::interval)             AS total_clicks,
           (SELECT COUNT(*)::text FROM commission_decisions
            WHERE decided_at >= NOW() - ($1 || ' days')::interval)             AS total_conversions,
           (SELECT COALESCE(SUM(commissionable_amount), 0)::numeric(12,2)::text
            FROM commission_decisions
            WHERE decided_at >= NOW() - ($1 || ' days')::interval)             AS total_order_value_sgd,
           (SELECT COALESCE(SUM(commission_amount), 0)::numeric(12,2)::text
            FROM commission_decisions
            WHERE decided_at >= NOW() - ($1 || ' days')::interval)             AS total_commission_sgd,
           (SELECT COALESCE(SUM(commission_amount), 0)::numeric(12,2)::text
            FROM commission_decisions
            WHERE decided_at >= NOW() - ($1 || ' days')::interval
              AND status = 'approved')                                          AS approved_commission_sgd,
           (SELECT COALESCE(SUM(commission_amount), 0)::numeric(12,2)::text
            FROM commission_decisions
            WHERE decided_at >= NOW() - ($1 || ' days')::interval
              AND status = 'pending')                                           AS pending_commission_sgd,
           (SELECT COALESCE(AVG(commission_rate) * 100, 0)::numeric(5,2)::text
            FROM commission_decisions
            WHERE decided_at >= NOW() - ($1 || ' days')::interval)             AS avg_commission_rate
         FROM (SELECT 1) AS _dummy`,
        [days]
      ),

      // 2. Affiliate coverage per retailer
      //    Uses products.source as the retailer key (merchants table currently empty).
      //    affiliate_links.product_id is TEXT; products.id is bigint — no direct FK.
      //    We therefore count affiliate_links by merchant_id and match against
      //    products.merchant_id (both TEXT) to estimate per-source coverage.
      db.query<{
        retailer: string;
        total_products: string;
        products_with_links: string;
        coverage_pct: string;
        affiliate_link_count: string;
      }>(
        `WITH retailer_products AS (
           SELECT source AS retailer,
                  merchant_id,
                  COUNT(*) AS total_products
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
           rp.retailer,
           SUM(rp.total_products)::text                          AS total_products,
           COALESCE(SUM(lc.affiliate_link_count), 0)::text       AS affiliate_link_count,
           -- products_with_links: best-effort (link_count capped at product_count)
           LEAST(COALESCE(SUM(lc.affiliate_link_count), 0), SUM(rp.total_products))::text
                                                                 AS products_with_links,
           ROUND(
             LEAST(COALESCE(SUM(lc.affiliate_link_count), 0), SUM(rp.total_products))
               ::numeric / NULLIF(SUM(rp.total_products), 0) * 100
           , 1)::text                                             AS coverage_pct
         FROM retailer_products rp
         LEFT JOIN link_counts lc USING (merchant_id)
         GROUP BY rp.retailer
         ORDER BY SUM(rp.total_products) DESC`
      ),

      // 3. Weekly trends — clicks + commissions for the last N weeks
      db.query<{
        week_start: string;
        affiliate_clicks: string;
        redirect_clicks: string;
        conversions: string;
        commission_sgd: string;
        approved_commission_sgd: string;
      }>(
        `WITH weeks AS (
           SELECT generate_series(
             date_trunc('week', NOW() - ($1 || ' weeks')::interval),
             date_trunc('week', NOW()),
             '1 week'::interval
           ) AS week_start
         )
         SELECT
           w.week_start::date::text                                   AS week_start,
           COUNT(DISTINCT ac.id)::text                                AS affiliate_clicks,
           COUNT(DISTINCT c.id)::text                                 AS redirect_clicks,
           COUNT(DISTINCT cd.id)::text                                AS conversions,
           COALESCE(SUM(cd.commission_amount), 0)::numeric(12,2)::text
                                                                      AS commission_sgd,
           COALESCE(SUM(cd.commission_amount) FILTER (WHERE cd.status = 'approved'), 0)::numeric(12,2)::text
                                                                      AS approved_commission_sgd
         FROM weeks w
         LEFT JOIN affiliate_clicks ac
           ON date_trunc('week', ac.clicked_at) = w.week_start
         LEFT JOIN clicks c
           ON date_trunc('week', c.clicked_at) = w.week_start
         LEFT JOIN commission_decisions cd
           ON date_trunc('week', cd.decided_at) = w.week_start
         GROUP BY w.week_start
         ORDER BY w.week_start DESC`,
        [weeks]
      ),

      // 4. Outbound click summary (affiliate_clicks + clicks tables)
      db.query<{
        affiliate_clicks_total: string;
        redirect_clicks_total: string;
        unique_products_clicked: string;
        unique_merchants_clicked: string;
        top_clicked_merchant: string | null;
      }>(
        `SELECT
           (SELECT COUNT(*) FROM affiliate_clicks WHERE clicked_at >= NOW() - ($1 || ' days')::interval)::text
             AS affiliate_clicks_total,
           (SELECT COUNT(*) FROM clicks WHERE clicked_at >= NOW() - ($1 || ' days')::interval)::text
             AS redirect_clicks_total,
           (SELECT COUNT(DISTINCT product_id) FROM affiliate_clicks WHERE clicked_at >= NOW() - ($1 || ' days')::interval)::text
             AS unique_products_clicked,
           (SELECT COUNT(DISTINCT merchant_id) FROM affiliate_clicks WHERE clicked_at >= NOW() - ($1 || ' days')::interval)::text
             AS unique_merchants_clicked,
           (SELECT merchant_id FROM affiliate_clicks WHERE clicked_at >= NOW() - ($1 || ' days')::interval
            GROUP BY merchant_id ORDER BY COUNT(*) DESC LIMIT 1)
             AS top_clicked_merchant`,
        [days]
      ),

      // 5. Conversion pipeline (clicks → conversions → commissions funnel)
      db.query<{
        status: string;
        count: string;
        total_commission_sgd: string;
      }>(
        `SELECT
           status,
           COUNT(*)::text                                      AS count,
           SUM(commission_amount)::numeric(12,2)::text         AS total_commission_sgd
         FROM commission_decisions
         WHERE decided_at >= NOW() - ($1 || ' days')::interval
         GROUP BY status
         ORDER BY count DESC`,
        [days]
      ),
    ]);

    // -----------------------------------------------------------------------
    // Shape response
    // -----------------------------------------------------------------------
    const kpi = kpiResult.rows[0] ?? {
      total_clicks: '0',
      total_conversions: '0',
      total_order_value_sgd: '0.00',
      total_commission_sgd: '0.00',
      approved_commission_sgd: '0.00',
      pending_commission_sgd: '0.00',
      avg_commission_rate: '0.00',
    };

    const totalProducts = coverageResult.rows.reduce(
      (s, r) => s + parseInt(r.total_products), 0
    );
    const totalLinked = coverageResult.rows.reduce(
      (s, r) => s + parseInt(r.products_with_links), 0
    );

    // -----------------------------------------------------------------------
    // Instrumentation gaps — explicit list of missing data/fields
    // -----------------------------------------------------------------------
    const gaps: Array<{ field: string; table: string; impact: string; recommendation: string }> = [];

    if (parseInt(kpi.total_clicks) === 0) {
      gaps.push({
        field: 'affiliate_clicks',
        table: 'affiliate_clicks',
        impact: 'Cannot track outbound clicks or attribute revenue to API keys/agents.',
        recommendation:
          'Populate affiliate_links for at least one merchant and verify /r/:slug/:productId redirect route logs to affiliate_clicks.',
      });
    }
    if (parseInt(kpi.total_conversions) === 0) {
      gaps.push({
        field: 'commission_decisions',
        table: 'commission_decisions',
        impact:
          'Revenue is $0. No completed purchases have been attributed — either no affiliate network is posting postbacks, or no clicks have converted.',
        recommendation:
          'Integrate an affiliate network postback webhook (e.g. Commission Factory, Impact, ShareASale) that writes to conversions + commission_decisions tables.',
      });
    }
    if (totalLinked === 0) {
      gaps.push({
        field: 'affiliate_links.product_id / merchant_id',
        table: 'affiliate_links',
        impact: `0 of ${totalProducts.toLocaleString()} products have affiliate tracking links. Revenue from product clicks is impossible.`,
        recommendation:
          'For each merchant (amazon.sg, challenger.sg, fairprice.com.sg, …), obtain affiliate programme credentials and bulk-insert affiliate_links rows mapping product IDs to their affiliate tracking URLs.',
      });
    }

    res.json({
      meta: {
        generated_at: new Date().toISOString(),
        days,
        weeks,
        target_d90_revenue_sgd: 67750, // ~$50K USD at ~1.355 SGD/USD
      },
      kpi_rollup: {
        period_days: days,
        total_affiliate_clicks: parseInt(kpi.total_clicks),
        total_redirect_clicks: parseInt(clicksResult.rows[0]?.redirect_clicks_total ?? '0'),
        total_conversions: parseInt(kpi.total_conversions),
        total_order_value_sgd: parseFloat(kpi.total_order_value_sgd),
        total_commission_sgd: parseFloat(kpi.total_commission_sgd),
        approved_commission_sgd: parseFloat(kpi.approved_commission_sgd),
        pending_commission_sgd: parseFloat(kpi.pending_commission_sgd),
        avg_commission_rate_pct: parseFloat(kpi.avg_commission_rate),
        unique_products_clicked: parseInt(clicksResult.rows[0]?.unique_products_clicked ?? '0'),
        unique_merchants_clicked: parseInt(clicksResult.rows[0]?.unique_merchants_clicked ?? '0'),
        top_clicked_merchant: clicksResult.rows[0]?.top_clicked_merchant ?? null,
      },
      affiliate_coverage: {
        summary: {
          total_products: totalProducts,
          products_with_affiliate_links: totalLinked,
          coverage_pct:
            totalProducts > 0
              ? parseFloat(((totalLinked / totalProducts) * 100).toFixed(1))
              : 0,
        },
        by_retailer: coverageResult.rows.map((r) => ({
          retailer: r.retailer,
          total_products: parseInt(r.total_products),
          products_with_links: parseInt(r.products_with_links),
          coverage_pct: parseFloat(r.coverage_pct ?? '0'),
        })),
      },
      conversion_funnel: convResult.rows.map((r) => ({
        status: r.status,
        count: parseInt(r.count),
        total_commission_sgd: parseFloat(r.total_commission_sgd),
      })),
      weekly_trends: weeklyResult.rows.map((r) => ({
        week_start: r.week_start,
        affiliate_clicks: parseInt(r.affiliate_clicks),
        redirect_clicks: parseInt(r.redirect_clicks),
        conversions: parseInt(r.conversions),
        commission_sgd: parseFloat(r.commission_sgd),
        approved_commission_sgd: parseFloat(r.approved_commission_sgd),
      })),
      instrumentation_gaps: gaps,
    });
  } catch (err) {
    console.error('[revenue] report error:', err);
    res.status(500).json({ error: 'Revenue report query failed', detail: String(err) });
  }
});

export default router;
