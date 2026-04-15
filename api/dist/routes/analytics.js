"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const config_1 = require("../config");
const apiKey_1 = require("../middleware/apiKey");
const router = (0, express_1.Router)();
// All analytics endpoints require an API key (enterprise tier recommended for production,
// but accessible to all tiers for now during alpha).
// GET /v1/analytics/overview
// Daily query counts with agent vs human split over the last N days.
router.get('/overview', apiKey_1.requireApiKey, async (req, res) => {
    const days = Math.min(parseInt(req.query.days || '30'), 90);
    const result = await config_1.db.query(`SELECT
       date_trunc('day', created_at)::date AS day,
       COUNT(*) AS total_queries,
       COUNT(*) FILTER (WHERE is_agent = true) AS agent_queries,
       COUNT(*) FILTER (WHERE is_agent = false) AS human_queries,
       ROUND(AVG(response_time_ms)) AS avg_response_ms,
       ROUND(PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY response_time_ms)) AS p99_response_ms
     FROM query_log
     WHERE created_at >= NOW() - ($1 || ' days')::interval
     GROUP BY day
     ORDER BY day DESC`, [days]);
    const rows = result.rows.map((r) => ({
        day: r.day,
        total_queries: parseInt(r.total_queries),
        agent_queries: parseInt(r.agent_queries),
        human_queries: parseInt(r.human_queries),
        avg_response_ms: r.avg_response_ms ? parseInt(r.avg_response_ms) : null,
        p99_response_ms: r.p99_response_ms ? parseInt(r.p99_response_ms) : null,
    }));
    // Summary totals
    const totals = rows.reduce((acc, r) => ({
        total_queries: acc.total_queries + r.total_queries,
        agent_queries: acc.agent_queries + r.agent_queries,
        human_queries: acc.human_queries + r.human_queries,
    }), { total_queries: 0, agent_queries: 0, human_queries: 0 });
    res.json({ data: { daily: rows, totals }, meta: { days } });
});
// GET /v1/analytics/agents
// Top agents by query volume, with framework and last-seen info.
router.get('/agents', apiKey_1.requireApiKey, async (req, res) => {
    const days = Math.min(parseInt(req.query.days || '30'), 90);
    const limit = Math.min(parseInt(req.query.limit || '20'), 100);
    const result = await config_1.db.query(`SELECT
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
     LIMIT $2`, [days, limit]);
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
router.get('/products', apiKey_1.requireApiKey, async (req, res) => {
    const days = Math.min(parseInt(req.query.days || '30'), 90);
    const limit = Math.min(parseInt(req.query.limit || '20'), 100);
    const agentOnly = req.query.agent_only !== 'false'; // default: agent queries only
    const agentFilter = agentOnly ? 'AND is_agent = true' : '';
    const result = await config_1.db.query(`SELECT
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
     LIMIT $2`, [days, limit]);
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
router.get('/conversions', apiKey_1.requireApiKey, async (req, res) => {
    const days = Math.min(parseInt(req.query.days || '30'), 90);
    const [queriesResult, clicksResult, topClicksResult] = await Promise.all([
        // Total queries per day (agent vs human)
        config_1.db.query(`SELECT
         date_trunc('day', created_at)::date AS day,
         COUNT(*) FILTER (WHERE is_agent = true) AS agent_queries,
         COUNT(*) FILTER (WHERE is_agent = false) AS human_queries
       FROM query_log
       WHERE created_at >= NOW() - ($1 || ' days')::interval
       GROUP BY day
       ORDER BY day DESC`, [days]),
        // Total affiliate clicks per day
        config_1.db.query(`SELECT
         date_trunc('day', clicked_at)::date AS day,
         COUNT(*) AS clicks
       FROM affiliate_clicks
       WHERE clicked_at >= NOW() - ($1 || ' days')::interval
       GROUP BY day
       ORDER BY day DESC`, [days]),
        // Top products by affiliate clicks
        config_1.db.query(`SELECT
         ac.product_id,
         p.name AS product_name,
         COUNT(*) AS click_count
       FROM affiliate_clicks ac
       LEFT JOIN products p ON p.id::text = ac.product_id
       WHERE ac.clicked_at >= NOW() - ($1 || ' days')::interval
       GROUP BY ac.product_id, p.name
       ORDER BY click_count DESC
       LIMIT 20`, [days]),
    ]);
    // Build daily map
    const dailyMap = {};
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
router.get('/endpoints', apiKey_1.requireApiKey, async (req, res) => {
    const days = Math.min(parseInt(req.query.days || '30'), 90);
    const result = await config_1.db.query(`SELECT
       endpoint,
       COUNT(*) AS total,
       COUNT(*) FILTER (WHERE is_agent = true) AS agent_count,
       COUNT(*) FILTER (WHERE is_agent = false) AS human_count,
       ROUND(AVG(response_time_ms)) AS avg_response_ms
     FROM query_log
     WHERE created_at >= NOW() - ($1 || ' days')::interval
     GROUP BY endpoint
     ORDER BY total DESC`, [days]);
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
router.get('/geo-scorecard', apiKey_1.requireApiKey, async (req, res) => {
    const weeks = Math.min(parseInt(req.query.weeks || '4'), 12);
    const [weeklyResult, frameworkResult, topAgentsResult] = await Promise.all([
        config_1.db.query(`SELECT
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
       ORDER BY week_start DESC`, [weeks]),
        // Framework distribution
        config_1.db.query(`SELECT
         agent_framework,
         COUNT(*) AS count
       FROM query_log
       WHERE is_agent = true
         AND created_at >= NOW() - ($1 || ' weeks')::interval
       GROUP BY agent_framework
       ORDER BY count DESC`, [weeks]),
        // Top agents this period
        config_1.db.query(`SELECT
         agent_name,
         COUNT(*) AS queries
       FROM query_log
       WHERE is_agent = true
         AND created_at >= NOW() - ($1 || ' weeks')::interval
       GROUP BY agent_name
       ORDER BY queries DESC
       LIMIT 10`, [weeks]),
    ]);
    // Get affiliate click totals by week
    const clicksResult = await config_1.db.query(`SELECT
       date_trunc('week', clicked_at)::date AS week_start,
       COUNT(*) AS clicks
     FROM affiliate_clicks
     WHERE clicked_at >= NOW() - ($1 || ' weeks')::interval
     GROUP BY week_start
     ORDER BY week_start DESC`, [weeks]);
    const clicksByWeek = {};
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
exports.default = router;
