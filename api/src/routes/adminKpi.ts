import { Router, Request, Response, NextFunction } from 'express';
import { db } from '../config';

// Read-only, aggregate KPI export for the external observer (BUSINESS-KPIS.md
// "Daily export contract"): per day / market / client harness / client version /
// query intent / endpoint counters, plus handoff and key-activity rows. No query
// text, no personal data, no API keys, no IP addresses leave this endpoint.
// Internal traffic (is_internal) is excluded. Attributed orders, GMV and net
// commission are reported as null: there is no affiliate-network reconciliation
// feed, and "no evidence" must read as unverified, not as zero revenue.

const METRIC_DEFINITION_VERSION = 'kpi-export-1';
const RETENTION_WINDOW_DAYS = 7;
const ADMIN_API_KEY = process.env.ADMIN_API_KEY;

function requireAdminKey(req: Request, res: Response, next: NextFunction): void {
  if (!ADMIN_API_KEY) {
    res.status(503).json({ error: 'Admin API not configured' });
    return;
  }
  const auth = req.headers.authorization || '';
  const key = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!key || key !== ADMIN_API_KEY) {
    res.status(401).json({ error: 'Admin API key required' });
    return;
  }
  next();
}

const router = Router();

// GET /admin/kpi/daily?days=7   (1..90, default 7)
router.get('/daily', requireAdminKey, async (req: Request, res: Response) => {
  const days = Math.min(Math.max(parseInt(String(req.query.days || '7'), 10) || 7, 1), 90);
  try {
    const usage = await db.query(
      `SELECT (created_at AT TIME ZONE 'UTC')::date AS date,
              coalesce(upper(country_code), '') AS market,
              coalesce(agent_framework, 'unknown') AS client_harness,
              coalesce(sdk_language, 'unknown') AS client_version,
              coalesce(query_intent, '') AS query_intent,
              endpoint,
              count(*)::int AS requests,
              count(*) FILTER (WHERE endpoint ILIKE '%search%')::int AS searches,
              count(*) FILTER (WHERE endpoint ILIKE '%search%' AND status_code < 400 AND coalesce(result_count, 0) > 0 AND degraded_kind IS NULL)::int AS successful_searches,
              count(*) FILTER (WHERE degraded_kind IS NOT NULL)::int AS degraded_searches,
              count(*) FILTER (WHERE endpoint ILIKE '%search%' AND status_code < 400 AND coalesce(result_count, 0) = 0 AND degraded_kind IS NULL)::int AS empty_results,
              count(*) FILTER (WHERE degraded_kind IN ('timeout', 'partial_timeout'))::int AS timeouts,
              count(*) FILTER (WHERE status_code >= 400)::int AS errors,
              count(*) FILTER (WHERE cache_hit)::int AS cache_hits,
              coalesce(sum(result_count), 0)::bigint AS returned_products,
              count(DISTINCT api_key_id)::int AS active_keys
         FROM query_log
        WHERE created_at >= (current_date - $1::int)
          AND coalesce(is_internal, false) = false
        GROUP BY 1, 2, 3, 4, 5, 6
        ORDER BY 1, 2, 3, 4, 5, 6`,
      [days],
    );
    const handoffs = await db.query(
      `SELECT (clicked_at AT TIME ZONE 'UTC')::date AS date,
              coalesce(agent_framework, 'unknown') AS client_harness,
              count(*)::int AS handoff_clicks,
              count(*) FILTER (WHERE coalesce(was_dead_at_click, false) = false)::int AS valid_handoffs,
              count(*) FILTER (WHERE redirect_status_code BETWEEN 300 AND 399)::int AS successful_redirects,
              count(*) FILTER (WHERE redirect_status_code = 410 OR coalesce(was_dead_at_click, false))::int AS dead_destination,
              count(DISTINCT merchant_id)::int AS merchants
         FROM affiliate_clicks
        WHERE clicked_at >= (current_date - $1::int)
          AND coalesce(is_internal, false) = false
        GROUP BY 1, 2
        ORDER BY 1, 2`,
      [days],
    );
    const keys = await db.query(
      `WITH daily AS (
         SELECT DISTINCT (created_at AT TIME ZONE 'UTC')::date AS date, api_key_id
           FROM query_log
          WHERE api_key_id IS NOT NULL AND coalesce(is_internal, false) = false
            AND created_at >= (current_date - ($1::int + $2::int))
       ), first_seen AS (
         SELECT api_key_id, min(date) AS first_date FROM daily GROUP BY 1
       )
       SELECT d.date,
              count(*)::int AS active_keys,
              count(*) FILTER (WHERE f.first_date = d.date)::int AS newly_activated_keys,
              count(*) FILTER (WHERE EXISTS (
                SELECT 1 FROM daily p WHERE p.api_key_id = d.api_key_id
                   AND p.date < d.date AND p.date >= d.date - $2::int))::int AS retained_keys
         FROM daily d JOIN first_seen f USING (api_key_id)
        WHERE d.date >= (current_date - $1::int)
        GROUP BY 1 ORDER BY 1`,
      [days, RETENTION_WINDOW_DAYS],
    );
    res.json({
      metric_definition_version: METRIC_DEFINITION_VERSION,
      generated_at: new Date().toISOString(),
      window_days: days,
      attribution_window: null,
      attribution_note: 'attributed_orders, attributed_gmv and net_commission are unverified: no affiliate-network reconciliation feed is connected. Absence of evidence is not zero revenue.',
      retention_window_days: RETENTION_WINDOW_DAYS,
      usage: usage.rows,
      handoffs: handoffs.rows,
      keys: keys.rows,
      attributed_orders: null,
      attributed_gmv: null,
      net_commission: null,
    });
  } catch (err: any) {
    console.error('[admin/kpi] daily export failed:', err?.message);
    res.status(500).json({ error: 'kpi export failed' });
  }
});

export default router;
