import { Router, Request, Response, NextFunction } from 'express';
import { db } from '../config';
import { requireApiKey } from '../middleware/apiKey';

const router = Router();

// Admin auth — mirrors the pattern in adminCompare.ts
const ADMIN_API_KEY = process.env.ADMIN_API_KEY;
function requireAdminKey(req: Request, res: Response, next: NextFunction): void {
  if (!ADMIN_API_KEY) {
    res.status(503).json({ error: 'Admin API not configured' });
    return;
  }
  const auth = req.headers['authorization'] || '';
  const key = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!key || key !== ADMIN_API_KEY) {
    res.status(401).json({ error: 'Admin API key required' });
    return;
  }
  next();
}

// All analytics endpoints require an API key (enterprise tier recommended for production,
// but accessible to all tiers for now during alpha).

// GET /v1/analytics/overview
// Daily query counts with agent vs human split over the last N days.
router.get('/overview', requireApiKey, async (req: Request, res: Response) => {
  const days = Math.min(parseInt((req.query.days as string) || '30'), 90);

  const result = await db.query(
    `SELECT
       date_trunc('day', created_at)::date AS day,
       COUNT(*) AS total_queries,
       COUNT(*) FILTER (WHERE is_agent = true) AS agent_queries,
       COUNT(*) FILTER (WHERE is_agent = false) AS human_queries,
       ROUND(AVG(response_time_ms)) AS avg_response_ms,
       ROUND(PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY response_time_ms)) AS p99_response_ms
     FROM query_log
     WHERE created_at >= NOW() - ($1 || ' days')::interval
     GROUP BY day
     ORDER BY day DESC`,
    [days]
  );

  const rows = result.rows.map((r) => ({
    day: r.day,
    total_queries: parseInt(r.total_queries),
    agent_queries: parseInt(r.agent_queries),
    human_queries: parseInt(r.human_queries),
    avg_response_ms: r.avg_response_ms ? parseInt(r.avg_response_ms) : null,
    p99_response_ms: r.p99_response_ms ? parseInt(r.p99_response_ms) : null,
  }));

  // Summary totals
  const totals = rows.reduce(
    (acc, r) => ({
      total_queries: acc.total_queries + r.total_queries,
      agent_queries: acc.agent_queries + r.agent_queries,
      human_queries: acc.human_queries + r.human_queries,
    }),
    { total_queries: 0, agent_queries: 0, human_queries: 0 }
  );

  res.json({ data: { daily: rows, totals }, meta: { days } });
});

// GET /v1/analytics/agents
// Top agents by query volume, with framework and last-seen info.
router.get('/agents', requireApiKey, async (req: Request, res: Response) => {
  const days = Math.min(parseInt((req.query.days as string) || '30'), 90);
  const limit = Math.min(parseInt((req.query.limit as string) || '20'), 100);

  const result = await db.query(
    `SELECT
       agent_name,
       agent_framework,
       sdk_language,
       COUNT(*) AS total_queries,
       COUNT(DISTINCT DATE(created_at)) AS active_days,
       ROUND(AVG(response_time_ms)) AS avg_response_ms,
       MAX(created_at) AS last_seen_at
     FROM query_log
     WHERE is_agent = true
       AND created_at >= NOW() - ($1 || ' days')::interval
     GROUP BY agent_name, agent_framework, sdk_language
     ORDER BY total_queries DESC
     LIMIT $2`,
    [days, limit]
  );

  const agents = result.rows.map((r) => ({
    agent_name: r.agent_name,
    framework: r.agent_framework,
    sdk_language: r.sdk_language,
    total_queries: parseInt(r.total_queries),
    active_days: parseInt(r.active_days),
    avg_response_ms: r.avg_response_ms ? parseInt(r.avg_response_ms) : null,
    last_seen_at: r.last_seen_at,
  }));

  res.json({ data: agents, meta: { days, limit } });
});

// GET /v1/analytics/products
// Top products searched by agents — what are AI agents looking for?
router.get('/products', requireApiKey, async (req: Request, res: Response) => {
  const days = Math.min(parseInt((req.query.days as string) || '30'), 90);
  const limit = Math.min(parseInt((req.query.limit as string) || '20'), 100);
  const agentOnly = req.query.agent_only !== 'false'; // default: agent queries only

  const agentFilter = agentOnly ? 'AND is_agent = true' : '';

  const result = await db.query(
    `SELECT
       query_text,
       COUNT(*) AS search_count,
       COUNT(DISTINCT agent_name) AS unique_agents,
       COUNT(DISTINCT api_key_id) AS unique_keys
     FROM query_log
     WHERE query_text IS NOT NULL AND query_text != ''
       AND endpoint = 'products.search'
       AND created_at >= NOW() - ($1 || ' days')::interval
       ${agentFilter}
     GROUP BY query_text
     ORDER BY search_count DESC
     LIMIT $2`,
    [days, limit]
  );

  const searches = result.rows.map((r) => ({
    query: r.query_text,
    search_count: parseInt(r.search_count),
    unique_agents: parseInt(r.unique_agents),
    unique_keys: parseInt(r.unique_keys),
  }));

  res.json({ data: searches, meta: { days, limit, agent_only: agentOnly } });
});

// GET /v1/analytics/conversions
// Affiliate click conversion rates — how many agent queries lead to clicks?
router.get('/conversions', requireApiKey, async (req: Request, res: Response) => {
  const days = Math.min(parseInt((req.query.days as string) || '30'), 90);

  const [queriesResult, clicksResult, topClicksResult] = await Promise.all([
    // Total queries per day (agent vs human)
    db.query(
      `SELECT
         date_trunc('day', created_at)::date AS day,
         COUNT(*) FILTER (WHERE is_agent = true) AS agent_queries,
         COUNT(*) FILTER (WHERE is_agent = false) AS human_queries
       FROM query_log
       WHERE created_at >= NOW() - ($1 || ' days')::interval
       GROUP BY day
       ORDER BY day DESC`,
      [days]
    ),
    // Total affiliate clicks per day
    db.query(
      `SELECT
         date_trunc('day', clicked_at)::date AS day,
         COUNT(*) AS clicks
       FROM affiliate_clicks
       WHERE clicked_at >= NOW() - ($1 || ' days')::interval
       GROUP BY day
       ORDER BY day DESC`,
      [days]
    ),
    // Top products by affiliate clicks
    db.query(
      `SELECT
         ac.product_id,
         p.name AS product_name,
         COUNT(*) AS click_count
       FROM affiliate_clicks ac
       LEFT JOIN products p ON p.id::text = ac.product_id
       WHERE ac.clicked_at >= NOW() - ($1 || ' days')::interval
       GROUP BY ac.product_id, p.name
       ORDER BY click_count DESC
       LIMIT 20`,
      [days]
    ),
  ]);

  // Build daily map
  const dailyMap: Record<string, { agent_queries: number; human_queries: number; clicks: number }> = {};
  for (const r of queriesResult.rows) {
    dailyMap[r.day] = {
      agent_queries: parseInt(r.agent_queries),
      human_queries: parseInt(r.human_queries),
      clicks: 0,
    };
  }
  for (const r of clicksResult.rows) {
    if (!dailyMap[r.day]) {
      dailyMap[r.day] = { agent_queries: 0, human_queries: 0, clicks: 0 };
    }
    dailyMap[r.day].clicks = parseInt(r.clicks);
  }

  const daily = Object.entries(dailyMap)
    .map(([day, data]) => ({
      day,
      ...data,
      conversion_rate: data.agent_queries > 0
        ? +(data.clicks / data.agent_queries * 100).toFixed(2)
        : 0,
    }))
    .sort((a, b) => b.day.localeCompare(a.day));

  const topProducts = topClicksResult.rows.map((r) => ({
    product_id: r.product_id,
    product_name: r.product_name,
    click_count: parseInt(r.click_count),
  }));

  res.json({ data: { daily, top_clicked_products: topProducts }, meta: { days } });
});

// GET /v1/analytics/endpoints
// Breakdown by endpoint — which API surfaces do agents use most?
router.get('/endpoints', requireApiKey, async (req: Request, res: Response) => {
  const days = Math.min(parseInt((req.query.days as string) || '30'), 90);

  const result = await db.query(
    `SELECT
       endpoint,
       COUNT(*) AS total,
       COUNT(*) FILTER (WHERE is_agent = true) AS agent_count,
       COUNT(*) FILTER (WHERE is_agent = false) AS human_count,
       ROUND(AVG(response_time_ms)) AS avg_response_ms
     FROM query_log
     WHERE created_at >= NOW() - ($1 || ' days')::interval
     GROUP BY endpoint
     ORDER BY total DESC`,
    [days]
  );

  const endpoints = result.rows.map((r) => ({
    endpoint: r.endpoint,
    total: parseInt(r.total),
    agent_count: parseInt(r.agent_count),
    human_count: parseInt(r.human_count),
    avg_response_ms: r.avg_response_ms ? parseInt(r.avg_response_ms) : null,
  }));

  res.json({ data: endpoints, meta: { days } });
});

// GET /v1/analytics/geo-scorecard
// Weekly GEO scorecard — agent citations, queries, and conversion metrics
// aggregated by week for the CEO weekly review.
router.get('/geo-scorecard', requireApiKey, async (req: Request, res: Response) => {
  const weeks = Math.min(parseInt((req.query.weeks as string) || '4'), 12);

  const [weeklyResult, frameworkResult, topAgentsResult] = await Promise.all([
    db.query(
      `SELECT
         date_trunc('week', created_at)::date AS week_start,
         COUNT(*) AS total_queries,
         COUNT(*) FILTER (WHERE is_agent = true) AS agent_queries,
         COUNT(DISTINCT api_key_id) FILTER (WHERE is_agent = true) AS unique_agent_keys,
         COUNT(DISTINCT agent_name) FILTER (WHERE is_agent = true) AS unique_agents,
         ROUND(AVG(response_time_ms)) AS avg_response_ms,
         ROUND(PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY response_time_ms)) AS p99_response_ms
       FROM query_log
       WHERE created_at >= NOW() - ($1 || ' weeks')::interval
       GROUP BY week_start
       ORDER BY week_start DESC`,
      [weeks]
    ),
    // Framework distribution
    db.query(
      `SELECT
         agent_framework,
         COUNT(*) AS count
       FROM query_log
       WHERE is_agent = true
         AND created_at >= NOW() - ($1 || ' weeks')::interval
       GROUP BY agent_framework
       ORDER BY count DESC`,
      [weeks]
    ),
    // Top agents this period
    db.query(
      `SELECT
         agent_name,
         COUNT(*) AS queries
       FROM query_log
       WHERE is_agent = true
         AND created_at >= NOW() - ($1 || ' weeks')::interval
       GROUP BY agent_name
       ORDER BY queries DESC
       LIMIT 10`,
      [weeks]
    ),
  ]);

  // Get affiliate click totals by week
  const clicksResult = await db.query(
    `SELECT
       date_trunc('week', clicked_at)::date AS week_start,
       COUNT(*) AS clicks
     FROM affiliate_clicks
     WHERE clicked_at >= NOW() - ($1 || ' weeks')::interval
     GROUP BY week_start
     ORDER BY week_start DESC`,
    [weeks]
  );

  const clicksByWeek: Record<string, number> = {};
  for (const r of clicksResult.rows) {
    clicksByWeek[r.week_start] = parseInt(r.clicks);
  }

  const weekly = weeklyResult.rows.map((r) => ({
    week_start: r.week_start,
    total_queries: parseInt(r.total_queries),
    agent_queries: parseInt(r.agent_queries),
    unique_agent_keys: parseInt(r.unique_agent_keys),
    unique_agents: parseInt(r.unique_agents),
    affiliate_clicks: clicksByWeek[r.week_start] || 0,
    avg_response_ms: r.avg_response_ms ? parseInt(r.avg_response_ms) : null,
    p99_response_ms: r.p99_response_ms ? parseInt(r.p99_response_ms) : null,
  }));

  const frameworks = frameworkResult.rows.map((r) => ({
    framework: r.agent_framework,
    count: parseInt(r.count),
  }));

  const topAgents = topAgentsResult.rows.map((r) => ({
    agent_name: r.agent_name,
    queries: parseInt(r.queries),
  }));

  res.json({
    data: { weekly, frameworks, top_agents: topAgents },
    meta: { weeks },
  });
});

// GET /v1/analytics/query-count
// Lightweight PM-facing counter — daily + rolling totals for core product endpoints.
// Auth: ADMIN_API_KEY (no user API key required — safe for internal PM dashboards).
// This is the PostHog fallback described in BUY-2519: readable without any analytics
// dependency, covers all traffic including unauthenticated demand.
router.get('/query-count', requireAdminKey, async (req: Request, res: Response) => {
  const days = Math.min(parseInt((req.query.days as string) || '30'), 90);

  // Core product surfaces that map to Day-90 demand metrics
  const CORE_ENDPOINTS = ['products.search', 'products.get', 'products.compare', 'products.deals'];

  const [dailyResult, totalResult, endpointResult] = await Promise.all([
    // Daily breakdown for the rolling window
    db.query(
      `SELECT
         date_trunc('day', created_at)::date AS day,
         COUNT(*) AS total,
         COUNT(*) FILTER (WHERE is_agent = true) AS agent_count,
         COUNT(*) FILTER (WHERE api_key_id IS NULL) AS unauthenticated_count,
         COUNT(*) FILTER (WHERE status_code < 400) AS success_count,
         COUNT(*) FILTER (WHERE status_code >= 400) AS error_count
       FROM query_log
       WHERE created_at >= NOW() - ($1 || ' days')::interval
         AND endpoint = ANY($2)
       GROUP BY day
       ORDER BY day DESC`,
      [days, CORE_ENDPOINTS]
    ),
    // Rolling totals
    db.query(
      `SELECT
         COUNT(*) AS total,
         COUNT(*) FILTER (WHERE is_agent = true) AS agent_count,
         COUNT(*) FILTER (WHERE api_key_id IS NULL) AS unauthenticated_count,
         COUNT(DISTINCT api_key_id) FILTER (WHERE api_key_id IS NOT NULL) AS unique_keys,
         COUNT(*) FILTER (WHERE status_code < 400) AS success_count,
         COUNT(*) FILTER (WHERE status_code >= 400) AS error_count
       FROM query_log
       WHERE created_at >= NOW() - ($1 || ' days')::interval
         AND endpoint = ANY($2)`,
      [days, CORE_ENDPOINTS]
    ),
    // Per-endpoint breakdown
    db.query(
      `SELECT
         endpoint,
         COUNT(*) AS total,
         COUNT(*) FILTER (WHERE is_agent = true) AS agent_count
       FROM query_log
       WHERE created_at >= NOW() - ($1 || ' days')::interval
         AND endpoint = ANY($2)
       GROUP BY endpoint
       ORDER BY total DESC`,
      [days, CORE_ENDPOINTS]
    ),
  ]);

  const t = totalResult.rows[0];
  const totals = {
    total: parseInt(t.total),
    agent_count: parseInt(t.agent_count),
    unauthenticated_count: parseInt(t.unauthenticated_count),
    unique_keys: parseInt(t.unique_keys),
    success_count: parseInt(t.success_count),
    error_count: parseInt(t.error_count),
  };

  const daily = dailyResult.rows.map((r) => ({
    day: r.day,
    total: parseInt(r.total),
    agent_count: parseInt(r.agent_count),
    unauthenticated_count: parseInt(r.unauthenticated_count),
    success_count: parseInt(r.success_count),
    error_count: parseInt(r.error_count),
  }));

  const by_endpoint = endpointResult.rows.map((r) => ({
    endpoint: r.endpoint,
    total: parseInt(r.total),
    agent_count: parseInt(r.agent_count),
  }));

  res.json({
    data: { totals, daily, by_endpoint },
    meta: {
      days,
      core_endpoints: CORE_ENDPOINTS,
      note: 'PostHog fallback counter (BUY-2519). Includes unauthenticated demand. Limitations: no session stitching, no funnel analysis — those require PostHog (BUY-1362).',
    },
  });
});

// GET /v1/analytics/launch-window
// Launch-day telemetry for arbitrary UTC time windows.
// Returns query counts, first-query timestamps, registration count, and error rate.
// Auth: ADMIN_API_KEY — safe for Sage/Reed without shell access (BUY-3866).
router.get('/launch-window', requireAdminKey, async (req: Request, res: Response) => {
  const startParam = req.query.start as string | undefined;
  const endParam = req.query.end as string | undefined;

  let startDate: Date;
  let endDate: Date;

  if (startParam && endParam) {
    startDate = new Date(startParam);
    endDate = new Date(endParam);
    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      res.status(400).json({ error: 'Invalid ISO 8601 date in start or end parameter' });
      return;
    }
    if (startDate >= endDate) {
      res.status(400).json({ error: 'start must be before end' });
      return;
    }
  } else {
    // Default: last 4 hours (typical launch checkpoint window)
    const hours = Math.min(parseInt((req.query.hours as string) || '4'), 168);
    endDate = new Date();
    startDate = new Date(endDate.getTime() - hours * 60 * 60 * 1000);
  }

  const CORE_ENDPOINTS = ['products.search', 'products.get', 'products.compare', 'products.deals'];

  const [totalsResult, firstQueryResult, registrationsResult, endpointResult] = await Promise.all([
    // Aggregate counts for the window
    db.query(
      `SELECT
         COUNT(*) AS total,
         COUNT(*) FILTER (WHERE is_agent = true) AS agent_count,
         COUNT(*) FILTER (WHERE api_key_id IS NULL) AS unauthenticated_count,
         COUNT(DISTINCT api_key_id) FILTER (WHERE api_key_id IS NOT NULL) AS unique_keys,
         COUNT(*) FILTER (WHERE status_code < 400) AS success_count,
         COUNT(*) FILTER (WHERE status_code >= 400) AS error_count
       FROM query_log
       WHERE created_at >= $1 AND created_at < $2
         AND endpoint = ANY($3)`,
      [startDate.toISOString(), endDate.toISOString(), CORE_ENDPOINTS]
    ),
    // First-query timestamps
    db.query(
      `SELECT
         MIN(created_at) FILTER (WHERE status_code < 400) AS first_query_at,
         MIN(created_at) FILTER (WHERE status_code < 400 AND api_key_id IS NOT NULL) AS first_external_query_at
       FROM query_log
       WHERE created_at >= $1 AND created_at < $2
         AND endpoint = ANY($3)`,
      [startDate.toISOString(), endDate.toISOString(), CORE_ENDPOINTS]
    ),
    // Registration count in window
    db.query(
      `SELECT COUNT(*) AS count FROM api_keys
       WHERE created_at >= $1 AND created_at < $2`,
      [startDate.toISOString(), endDate.toISOString()]
    ),
    // Per-endpoint breakdown
    db.query(
      `SELECT
         endpoint,
         COUNT(*) AS total,
         COUNT(*) FILTER (WHERE is_agent = true) AS agent_count,
         COUNT(*) FILTER (WHERE status_code >= 400) AS error_count
       FROM query_log
       WHERE created_at >= $1 AND created_at < $2
         AND endpoint = ANY($3)
       GROUP BY endpoint
       ORDER BY total DESC`,
      [startDate.toISOString(), endDate.toISOString(), CORE_ENDPOINTS]
    ),
  ]);

  const t = totalsResult.rows[0];
  const total = parseInt(t.total);
  const successCount = parseInt(t.success_count);
  const errorCount = parseInt(t.error_count);

  const fq = firstQueryResult.rows[0];

  const totals = {
    total,
    agent_count: parseInt(t.agent_count),
    unauthenticated_count: parseInt(t.unauthenticated_count),
    unique_keys: parseInt(t.unique_keys),
    success_count: successCount,
    error_count: errorCount,
    error_rate: total > 0 ? +(errorCount / total * 100).toFixed(2) : 0,
    first_query_at: fq.first_query_at || null,
    first_external_query_at: fq.first_external_query_at || null,
    registrations: parseInt(registrationsResult.rows[0].count),
  };

  const by_endpoint = endpointResult.rows.map((r) => ({
    endpoint: r.endpoint,
    total: parseInt(r.total),
    agent_count: parseInt(r.agent_count),
    error_count: parseInt(r.error_count),
  }));

  res.json({
    data: { totals, by_endpoint },
    meta: {
      window: { start: startDate.toISOString(), end: endDate.toISOString() },
      core_endpoints: CORE_ENDPOINTS,
      note: 'Launch-window telemetry (BUY-3866). Use ?start=&end= for arbitrary UTC ranges, or ?hours=N for rolling window.',
    },
  });
});

// GET /v1/analytics/latency
// p50/p95/p99 latency percentiles from query_log over a configurable window.
// Returns per-endpoint and overall percentiles, plus alert status when p99 > threshold.
// Auth: ADMIN_API_KEY (BUY-3006).
router.get('/latency', requireAdminKey, async (req: Request, res: Response) => {
  const minutes = Math.min(Math.max(parseInt((req.query.minutes as string) || '5'), 1), 1440);
  const threshold = parseInt((req.query.threshold as string) || '1000');

  const cutoff = new Date(Date.now() - minutes * 60 * 1000).toISOString();

  const CORE_ENDPOINTS = ['products.search', 'products.get', 'products.compare', 'products.deals'];

  const [overallResult, endpointResult] = await Promise.all([
    db.query(
      `SELECT
         COUNT(*) AS sample_count,
         ROUND(PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY response_time_ms))::int AS p50,
         ROUND(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY response_time_ms))::int AS p95,
         ROUND(PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY response_time_ms))::int AS p99,
         ROUND(AVG(response_time_ms))::int AS avg_ms,
         MAX(response_time_ms)::int AS max_ms
       FROM query_log
       WHERE created_at >= $1
         AND endpoint = ANY($2)
         AND response_time_ms IS NOT NULL`,
      [cutoff, CORE_ENDPOINTS]
    ),
    db.query(
      `SELECT
         endpoint,
         COUNT(*) AS sample_count,
         ROUND(PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY response_time_ms))::int AS p50,
         ROUND(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY response_time_ms))::int AS p95,
         ROUND(PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY response_time_ms))::int AS p99,
         ROUND(AVG(response_time_ms))::int AS avg_ms,
         MAX(response_time_ms)::int AS max_ms
       FROM query_log
       WHERE created_at >= $1
         AND endpoint = ANY($2)
         AND response_time_ms IS NOT NULL
       GROUP BY endpoint
       ORDER BY p99 DESC`,
      [cutoff, CORE_ENDPOINTS]
    ),
  ]);

  const overall = overallResult.rows[0];
  const p99 = parseInt(overall.p99) || 0;
  const sampleCount = parseInt(overall.sample_count) || 0;
  const alert = sampleCount >= 10 && p99 > threshold;

  res.json({
    data: {
      overall: {
        sample_count: sampleCount,
        p50: parseInt(overall.p50) || 0,
        p95: parseInt(overall.p95) || 0,
        p99,
        avg_ms: parseInt(overall.avg_ms) || 0,
        max_ms: parseInt(overall.max_ms) || 0,
      },
      by_endpoint: endpointResult.rows.map((r) => ({
        endpoint: r.endpoint,
        sample_count: parseInt(r.sample_count),
        p50: parseInt(r.p50),
        p95: parseInt(r.p95),
        p99: parseInt(r.p99),
        avg_ms: parseInt(r.avg_ms),
        max_ms: parseInt(r.max_ms),
      })),
      alert: {
        threshold_ms: threshold,
        p99_exceeds_threshold: alert,
        status: alert ? 'ALERT' : 'OK',
      },
    },
    meta: {
      window_minutes: minutes,
      cutoff: cutoff,
      core_endpoints: CORE_ENDPOINTS,
      note: 'p99 latency monitoring (BUY-3006). Alert fires when p99 > threshold with ≥10 samples.',
    },
  });
});

export default router;
