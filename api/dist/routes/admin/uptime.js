"use strict";
// BUY-22737 / BUY-35381 — GET /v1/admin/uptime?days=30&region=sg
//
// Combined endpoint: rollup from monitoring.uptime_daily (prober persistence)
// + in-memory histogram_30m from the latency middleware.
//
// On DB unavailable, returns 500 with degraded:true and a best-effort
// histogram-only payload. 401 on missing/invalid admin key (auth middleware).
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const config_1 = require("../../config");
const latency_1 = require("../../middleware/latency");
const auth_1 = require("./auth");
const router = (0, express_1.Router)();
const num = (v) => (v == null ? 0 : Number(v));
router.get('/v1/admin/uptime', auth_1.adminAuth, async (req, res) => {
    const daysRaw = parseInt(String(req.query.days ?? '30'), 10);
    const days = Number.isFinite(daysRaw) ? Math.max(1, Math.min(daysRaw, 365)) : 30;
    const region = typeof req.query.region === 'string' && req.query.region.length > 0
        ? req.query.region.toLowerCase()
        : null;
    const to = new Date();
    const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);
    // We make both queries independently so a single failure can be reported
    // via degraded:true without losing the histogram (which is in-process and
    // always available).
    let byRegion = [];
    let byEndpoint = [];
    let degradedReason = null;
    try {
        // by_region — rollup by region over the window
        const regionParams = [from.toISOString()];
        let regionFilter = '';
        if (region) {
            regionFilter = ' AND region = $2';
            regionParams.push(region);
        }
        const regionSql = `
      SELECT
        region,
        SUM(total)::text     AS total,
        SUM(ok_count)::text  AS ok_count,
        ROUND(AVG(p50_ms))::text AS p50_ms,
        ROUND(AVG(p95_ms))::text AS p95_ms,
        ROUND(AVG(p99_ms))::text AS p99_ms
      FROM monitoring.uptime_daily
      WHERE day >= $1::date ${regionFilter}
      GROUP BY region
      ORDER BY region`;
        const regionRes = await config_1.db.query(regionSql, regionParams);
        byRegion = regionRes.rows.map((r) => {
            const total = num(r.total);
            const ok = num(r.ok_count);
            return {
                region: r.region,
                uptime_pct: total > 0 ? round2((ok / total) * 100) : null,
                p50_ms: num(r.p50_ms),
                p95_ms: num(r.p95_ms),
                p99_ms: num(r.p99_ms),
                samples: total,
                sources: ['prober'],
            };
        });
        // by_endpoint — rollup by endpoint over the window
        const epParams = [from.toISOString()];
        let epFilter = '';
        if (region) {
            epFilter = ' AND region = $2';
            epParams.push(region);
        }
        const epSql = `
      SELECT
        endpoint,
        SUM(total)::text     AS total,
        SUM(ok_count)::text  AS ok_count,
        ROUND(AVG(p95_ms))::text AS p95_ms
      FROM monitoring.uptime_daily
      WHERE day >= $1::date ${epFilter}
      GROUP BY endpoint
      ORDER BY endpoint`;
        const epRes = await config_1.db.query(epSql, epParams);
        byEndpoint = epRes.rows.map((r) => {
            const total = num(r.total);
            const ok = num(r.ok_count);
            return {
                endpoint: r.endpoint,
                uptime_pct: total > 0 ? round2((ok / total) * 100) : null,
                p95_ms: num(r.p95_ms),
                samples: total,
            };
        });
    }
    catch (err) {
        console.error('[admin/uptime] DB query failed:', err.message);
        degradedReason = err.message || 'database unavailable';
    }
    const histSnap = (0, latency_1.snapshotHistograms)();
    const body = {
        window: { from: from.toISOString(), to: to.toISOString(), days, region },
        by_region: byRegion,
        by_endpoint: byEndpoint,
        histogram_30m: { routes: histSnap.routes },
        degraded: degradedReason !== null,
        generated_at: new Date().toISOString(),
    };
    if (degradedReason)
        body.degraded_reason = degradedReason;
    if (degradedReason) {
        res.status(500).json(body);
        return;
    }
    res.json(body);
});
function round2(n) {
    return Math.round(n * 100) / 100;
}
exports.default = router;
