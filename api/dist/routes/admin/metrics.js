"use strict";
// BUY-22737 / BUY-35381 — GET /v1/admin/metrics?window=30m
// BUY-76710 — GET /v1/admin/metrics/truth — throughput counters for fleet quota
//
// In-memory histogram only for /metrics. The /truth endpoint reads from
// the catalog DB (replica-only) for throughput counters.
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const latency_1 = require("../../middleware/latency");
const auth_1 = require("./auth");
const config_1 = require("../../config");
const router = (0, express_1.Router)();
router.use(auth_1.adminAuth);
// Parse "30m", "5m", "1h" into seconds. Default 30m.
function parseWindowToSeconds(raw) {
    if (typeof raw !== 'string' || raw.length === 0)
        return 30 * 60;
    const m = raw.trim().match(/^(\d+)\s*([smhd])?$/i);
    if (!m)
        return 30 * 60;
    const n = parseInt(m[1], 10);
    const unit = (m[2] || 's').toLowerCase();
    const mult = unit === 'd' ? 86400 : unit === 'h' ? 3600 : unit === 'm' ? 60 : 1;
    return Math.max(1, Math.min(n * mult, 24 * 60 * 60));
}
router.get('/v1/admin/metrics', (_req, res) => {
    const snap = (0, latency_1.snapshotHistograms)();
    res.json({
        window_seconds: snap.window_seconds,
        buckets_ms: latency_1.LATENCY_BUCKETS_MS,
        routes: snap.routes,
        generated_at: snap.generated_at,
    });
});
router.get('/v1/admin/metrics/window', (req, res) => {
    // Convenience endpoint — same shape as /v1/admin/metrics but lets the caller
    // request a (shorter) window. The ring buffer always holds 30m of data, so
    // the response is just a filtered subset of the same samples.
    const winSec = parseWindowToSeconds(req.query.window);
    const snap = (0, latency_1.snapshotHistograms)();
    // The middleware always returns 30m of data; we don't keep per-second windows
    // in memory, so "window=" is informational here. We surface the parsed value
    // in the response so callers can see what was honored.
    res.json({
        requested_window_seconds: winSec,
        actual_window_seconds: snap.window_seconds,
        buckets_ms: latency_1.LATENCY_BUCKETS_MS,
        routes: snap.routes,
        generated_at: snap.generated_at,
    });
});
// BUY-76710: Fleet quota throughput counters
router.get('/v1/admin/metrics/truth', async (_req, res) => {
    try {
        // All queries are replica-only (read from replica or same instance)
        // NO count(*) on products - use pg_stat instead per fleet quota rules
        // inserts_24h: pg_stat_all_tables for insert/update/delete counts
        const insertStats = await config_1.db.query(`
      SELECT schemaname, relname, n_tup_ins, n_tup_upd, n_tup_del, last_vacuum, last_autovacuum, last_analyze
      FROM pg_stat_all_tables
      WHERE relname IN ('products', 'merchants', 'categories', 'ingestion_runs')
      AND schemaname = 'public'
      ORDER BY relname
    `);
        // total_products_approx: approximate via pg_class (no count on products)
        const totalProducts = await config_1.db.query(`
      SELECT reltuples::bigint as approx_count
      FROM pg_class
      WHERE oid = 'public.products'::regclass
    `);
        // ingestion_runs_24h: products_created by source/status
        const ingestionSummary = await config_1.db.query(`
      SELECT source, status,
             COUNT(*) as run_count,
             SUM(products_created) as products_created,
             MAX(completed_at) as last_completed
      FROM ingestion_runs
      WHERE completed_at > NOW() - INTERVAL '24 hours'
      GROUP BY source, status
      ORDER BY source, status
    `);
        // merchants_scraped_by_pool_24h: from merchants table (allowed)
        const merchantPools = await config_1.db.query(`
      SELECT pool, COUNT(*) as merchant_count
      FROM merchants
      WHERE created_at > NOW() - INTERVAL '24 hours'
      GROUP BY pool
      ORDER BY merchant_count DESC
    `);
        // keepa_runs_done_24h: completed Keepa scrapes
        const keepaRuns = await config_1.db.query(`
      SELECT COUNT(*) as keepa_runs_24h
      FROM ingestion_runs
      WHERE source = 'keepa'
        AND status = 'done'
        AND completed_at > NOW() - INTERVAL '24 hours'
    `);
        // rows_by_source_24h: products_created by source (derived from ingestion_runs)
        const rowsBySource = {};
        for (const row of ingestionSummary.rows) {
            if (row.source && row.products_created) {
                rowsBySource[row.source] = (rowsBySource[row.source] || 0) + parseInt(String(row.products_created), 10);
            }
        }
        // dedupe_done_total: from ingestion_runs where source = 'dedupe'
        const dedupeResult = await config_1.db.query(`
      SELECT COALESCE(SUM(products_created), 0) as dedupe_count
      FROM ingestion_runs
      WHERE source = 'dedupe' AND status = 'done'
    `);
        const dedupeTotal = parseInt(String(dedupeResult.rows[0]?.dedupe_count || 0), 10);
        // embeddings_24h: from vector DB (product_embeddings in same instance)
        const embedStats = await config_1.db.query(`
      SELECT COUNT(*) as embeddings_24h
      FROM product_embeddings
      WHERE created_at > NOW() - INTERVAL '24 hours'
    `);
        res.json({
            generated_at: new Date().toISOString(),
            inserts_24h: insertStats.rows,
            total_products_approx: totalProducts.rows[0]?.approx_count || 0,
            rows_by_source_24h: rowsBySource,
            ingestion_runs_24h: ingestionSummary.rows,
            merchants_scraped_by_pool_24h: merchantPools.rows,
            keepa_runs_done_24h: keepaRuns.rows[0]?.keepa_runs_24h || 0,
            dedupe_done_total: dedupeTotal,
            embeddings_24h: embedStats.rows[0]?.embeddings_24h || 0,
        });
    }
    catch (err) {
        console.error('[metrics/truth] DB query error:', err);
        res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Failed to fetch throughput counters' });
    }
});
exports.default = router;
