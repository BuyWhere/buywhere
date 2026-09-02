"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.adminAuth = void 0;
exports.probeAuth = probeAuth;
// BUY-75368 — A1/A2 weekly report blocker.
//
// Cart heartbeat 2026-08-26T04:20Z verified:
//   - /v1/admin/probes/status required BUYWHERE_ADMIN_API_KEYS, which the
//     fleet doesn't hold (only BUYWHERE_MONITORING_API_KEY / MONITORING_API_KEY).
//   - The 24h bucket was the only due-window — A1 dead-redirect calculation
//     needs a 7-day window.
//
// Fix:
//   1. Accept MONITORING_API_KEY in addition to admin keys via probeAuth().
//   2. Add 7-day buckets for both due-counters and probes_log so A1 has the
//      freshness distribution it needs over a weekly window.
//   3. Add url_last_checked_at / url_status counts over the 7-day window so
//      A1 dead-redirect rate is directly computable.
const express_1 = require("express");
const config_1 = require("../../config");
const outboundLinkHealth_1 = require("../../lib/outboundLinkHealth");
const auth_1 = require("./auth");
Object.defineProperty(exports, "adminAuth", { enumerable: true, get: function () { return auth_1.adminAuth; } });
const cacheStats_1 = require("../../monitoring/cacheStats");
const mcp_1 = require("../mcp");
const router = (0, express_1.Router)();
// BUY-75368: probes endpoint is a MONITORING concern (Cart / weekly A1/A2
// report) as well as an ADMIN concern. Accept either tier.
//
// Order:
//   1. If a valid admin key (BUYWHERE_ADMIN_API_KEYS) is presented → adminAuth.
//   2. Else if MONITORING_API_KEY matches → ok.
//   3. Else → 401 with diagnostic that lists acceptable env vars.
function timingSafeEqualStr(a, b) {
    if (a.length !== b.length)
        return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) {
        diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }
    return diff === 0;
}
function extractBearer(req) {
    const header = req.headers.authorization || '';
    const match = header.match(/^Bearer\s+(.+)$/i);
    return match ? match[1].trim() : null;
}
function probeAuth(req, res, next) {
    const presented = extractBearer(req);
    if (!presented) {
        res.status(401).json({
            error: 'UNAUTHORIZED',
            message: 'Missing Authorization: Bearer <admin or monitoring key>',
        });
        return;
    }
    // Try admin keys first (preserves existing adminAuth behaviour).
    const adminKeys = (process.env.BUYWHERE_ADMIN_API_KEYS || '')
        .split(',')
        .map((k) => k.trim())
        .filter((k) => k.length > 0);
    for (const k of adminKeys) {
        if (timingSafeEqualStr(presented, k)) {
            return next();
        }
    }
    // Fall back to monitoring tier.
    const monitoringKey = process.env.MONITORING_API_KEY || '';
    if (monitoringKey && timingSafeEqualStr(presented, monitoringKey)) {
        return next();
    }
    res.status(401).json({
        error: 'UNAUTHORIZED',
        message: 'Invalid key. Endpoint accepts BUYWHERE_ADMIN_API_KEYS or MONITORING_API_KEY.',
    });
}
router.get('/v1/admin/probes/status', probeAuth, async (_req, res) => {
    try {
        const [statusCounts, dueCounts, dueCounts7d, probes7d] = await Promise.all([
            config_1.db.query(`SELECT COALESCE(url_status, 'ok') AS status, COUNT(*)::bigint AS count
           FROM products
          WHERE url IS NOT NULL
          GROUP BY COALESCE(url_status, 'ok')
          ORDER BY status`),
            config_1.db.query(`SELECT
           COUNT(*) FILTER (WHERE url_last_checked_at IS NULL)::bigint AS never_checked,
           COUNT(*) FILTER (WHERE url_last_checked_at < NOW() - INTERVAL '24 hours')::bigint AS stale_24h,
           COUNT(*) FILTER (WHERE url_last_checked_at >= NOW() - INTERVAL '24 hours')::bigint AS fresh_24h
         FROM products
         WHERE is_active = true AND url IS NOT NULL`),
            config_1.db.query(`SELECT
           COUNT(*) FILTER (WHERE url_last_checked_at IS NULL)::bigint AS never_checked,
           COUNT(*) FILTER (WHERE url_last_checked_at < NOW() - INTERVAL '7 days')::bigint AS stale_7d,
           COUNT(*) FILTER (WHERE url_last_checked_at >= NOW() - INTERVAL '24 hours')::bigint AS fresh_24h,
           COUNT(*) FILTER (WHERE url_last_checked_at >= NOW() - INTERVAL '7 days')::bigint AS fresh_7d
         FROM products
         WHERE is_active = true AND url IS NOT NULL`),
            config_1.db.query(`SELECT status, COUNT(*)::bigint AS count
           FROM url_probe_log
          WHERE checked_at >= NOW() - INTERVAL '7 days'
          GROUP BY status
          ORDER BY status`).catch(() => ({ rows: [] })),
        ]);
        const toNumberMap = (rows) => rows.reduce((acc, row) => {
            acc[Object.keys(row)[0]] = Number(Object.values(row)[0]);
            return acc;
        }, {});
        res.json({
            probe_enabled: (0, outboundLinkHealth_1.outboundProbeEnabled)(),
            products_by_url_status: toNumberMap(statusCounts.rows),
            due: dueCounts.rows[0] || {
                never_checked: '0',
                stale_24h: '0',
                fresh_24h: '0',
            },
            due_7d: dueCounts7d.rows[0] || {
                never_checked: '0',
                stale_7d: '0',
                fresh_24h: '0',
                fresh_7d: '0',
            },
            probes_last_7d: toNumberMap(probes7d.rows),
            // Legacy key kept for back-compat with anything already reading it.
            probes_last_24h: toNumberMap(probes7d.rows),
        });
    }
    catch (err) {
        res.status(500).json({ error: 'probe_status_failed', message: err.message });
    }
});
// BUY-75411: MCP search_products cache-hit latency p95 probe.
// Auth via probeAuth so monitoring tier (MONITORING_API_KEY) can scrape it.
router.get('/v1/admin/probes/mcp_cache_hit_latency', probeAuth, async (req, res) => {
    const windowParam = Number(req.query.window ?? 3600);
    const windowSeconds = Number.isFinite(windowParam) && windowParam > 0 && windowParam <= 7 * 24 * 3600
        ? Math.floor(windowParam)
        : 3600;
    const ttlSeconds = mcp_1.MCP_FTS_CACHE_TTL_SECONDS;
    try {
        const latency = await (0, cacheStats_1.readCacheHitLatencyPercentiles)(config_1.redis, windowSeconds);
        const sample_count = latency.sample_count ?? 0;
        const p95 = latency.p95_ms ?? null;
        const passes = p95 !== null && p95 <= 200;
        res.json({
            window_seconds: latency.window_seconds ?? windowSeconds,
            sample_count,
            p50_ms: latency.p50_ms ?? null,
            p95_ms: p95,
            p99_ms: latency.p99_ms ?? null,
            max_ms: latency.max_ms ?? null,
            buckets_considered: latency.buckets_considered ?? 0,
            cache_ttl_seconds: ttlSeconds,
            available: latency.available === true,
            reason: latency.reason ?? null,
            threshold_ms: 200,
            passes_p95_under_200ms: passes,
            probe_note: 'wall-clock latency from recordQueryCacheLookup hit branch to response_time_ms stamp; sortable in Redis sorted set qembed:fts:cache_hit:60:<bucket>',
        });
    }
    catch (err) {
        res.status(500).json({ error: 'mcp_cache_hit_latency_failed', message: err.message });
    }
});
exports.default = router;
