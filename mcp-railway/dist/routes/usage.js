"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const config_1 = require("../config");
const apiKey_1 = require("../middleware/apiKey");
const router = (0, express_1.Router)();
// GET /v1/usage/counters
// BUY-22733: source-of-truth usage rollup for CEO/board reporting.
// Reads from query_log (persisted, survives redeploys) so values match
// the PostHog `api_query` / `mcp_tool_call` event stream over time.
//
// Per-day totals for the last N days (default 30, max 90):
//   - queries: REST endpoint calls (anything not 'mcp')
//   - calls:   MCP tool calls (endpoint = 'mcp', tools/call only — initialize and tools/list bypass auth)
//   - agents:  distinct api_key_id observed that day
//
// Also returns today + month_to_date totals and a generated_at / source meta
// block so consumers can tell snapshot age + provenance.
router.get('/counters', apiKey_1.requireApiKey, async (req, res) => {
    const days = Math.min(Math.max(parseInt(req.query.days || '30', 10), 1), 90);
    const daily = await config_1.db.query(`SELECT
       date_trunc('day', created_at)::date AS day,
       COUNT(*) FILTER (WHERE endpoint <> 'mcp') AS queries,
       COUNT(*) FILTER (WHERE endpoint = 'mcp')  AS calls,
       COUNT(DISTINCT api_key_id)                AS agents
     FROM query_log
     WHERE created_at >= NOW() - ($1 || ' days')::interval
       AND api_key_id IS NOT NULL
     GROUP BY day
     ORDER BY day DESC`, [days]);
    const dailyRows = daily.rows.map((r) => ({
        day: r.day,
        queries: parseInt(r.queries, 10),
        calls: parseInt(r.calls, 10),
        agents: parseInt(r.agents, 10),
    }));
    const today = await config_1.db.query(`SELECT
       COUNT(*) FILTER (WHERE endpoint <> 'mcp') AS queries,
       COUNT(*) FILTER (WHERE endpoint = 'mcp')  AS calls,
       COUNT(DISTINCT api_key_id)                AS agents
     FROM query_log
     WHERE created_at >= date_trunc('day', NOW())
       AND api_key_id IS NOT NULL`);
    const mtd = await config_1.db.query(`SELECT
       COUNT(*) FILTER (WHERE endpoint <> 'mcp') AS queries,
       COUNT(*) FILTER (WHERE endpoint = 'mcp')  AS calls,
       COUNT(DISTINCT api_key_id)                AS agents
     FROM query_log
     WHERE created_at >= date_trunc('month', NOW())
       AND api_key_id IS NOT NULL`);
    const toCounters = (row) => ({
        queries: parseInt(row.queries, 10),
        calls: parseInt(row.calls, 10),
        agents: parseInt(row.agents, 10),
    });
    res.json({
        data: {
            today: toCounters(today.rows[0]),
            month_to_date: toCounters(mtd.rows[0]),
            daily: dailyRows,
        },
        meta: {
            days,
            generated_at: new Date().toISOString(),
            source: 'query_log',
        },
    });
});
exports.default = router;
