"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const config_1 = require("../config");
const readReplica_1 = require("../lib/readReplica");
// BUY-45692: heavy catalog aggregates read from the replica when one is
// configured (REPLICA_DATABASE_URL) and caught up; otherwise readDb() returns
// the primary `db`. Interactive /v1/products/search stays on the primary.
// `db` is still used for the cheap pg_class estimates so they're available even
// before a replica is provisioned, but the expensive scans route through readDb.
const router = (0, express_1.Router)();
// ─── Cache constants ───────────────────────────────────────────────────────
const CACHE_KEY = 'catalog:stats:exact';
const CACHE_TTL = 900; // 15 min — reduces pressure on exact counts
const REFRESH_LOCK_KEY = 'catalog:stats:refresh-lock';
const REFRESH_LOCK_TTL = 120; // 2 min lock to prevent thundering herd
const CATALOG_STATS_SOURCE_EXACT = 'catalog_stats';
const CATALOG_STATS_SOURCE_FALLBACK = 'pg_class_fallback';
// ─── Fast estimate using pg_class + TABLESAMPLE ────────────────────────────
// BUY-31222: Full COUNT(*) on 32M rows times out at 60s on Railway Postgres.
// Use pg_class.reltuples for totals, TABLESAMPLE for active ratio,
// and exact count on the much-smaller merchants table.
async function collectStats() {
    const now = new Date().toISOString();
    const reader = config_1.catalogDb;
    const [productsEst, merchantsExact, activeRatio,] = await Promise.all([
        // Total products: pg_class.reltuples (instant, no table scan)
        reader.query(`SELECT reltuples::bigint AS est FROM pg_class WHERE oid = 'public.products'::regclass`)
            .then(r => Math.max(Number(r.rows?.[0]?.est || 0), 0))
            .catch(() => 0),
        // Total merchants: exact count (smaller table, completes fast)
        reader.query(`SELECT count(*) AS cnt FROM merchants`)
            .then(r => Number(r.rows?.[0]?.cnt || 0))
            .catch(() => reader.query(`SELECT reltuples::bigint AS est FROM pg_class WHERE oid = 'public.merchants'::regclass`)
            .then(r => Math.max(Number(r.rows?.[0]?.est || 0), 0))
            .catch(() => 0)),
        // Active ratio: TABLESAMPLE BERNOULLI(0.1) — scans ~0.1% of rows
        reader.query(`
      SELECT
        count(*) AS sample_total,
        count(*) FILTER (WHERE is_active) AS sample_active
      FROM products TABLESAMPLE BERNOULLI (0.1)
    `).then(r => {
            const sampleTotal = Number(r.rows?.[0]?.sample_total || 0);
            const sampleActive = Number(r.rows?.[0]?.sample_active || 0);
            return sampleTotal > 0 ? sampleActive / sampleTotal : 0.99;
        }).catch(() => 0.99),
    ]);
    let activeProducts = Math.round(productsEst * activeRatio);
    if (activeProducts > productsEst)
        activeProducts = productsEst;
    if (activeProducts < 0)
        activeProducts = productsEst;
    return {
        total_products: productsEst,
        active_products: activeProducts,
        total_merchants: merchantsExact,
        approximate: true,
        source: CATALOG_STATS_SOURCE_FALLBACK,
        collected_at: now,
    };
}
// ─── Try exact count (background use, may time out on large tables) ─────
async function tryExactCount(timeoutMs = 45000) {
    // Heavy full-table count — route to the replica when available (BUY-45692).
    const client = await config_1.catalogDb.connect();
    try {
        await client.query('BEGIN');
        await client.query(`SET LOCAL statement_timeout = ${timeoutMs}`);
        const result = await client.query(`
      SELECT
        count(*) AS total_products,
        count(*) FILTER (WHERE is_active) AS active_products,
        count(DISTINCT merchant_id) AS total_merchants,
        now() AT TIME ZONE 'utc' AS collected_at
      FROM products
    `);
        await client.query('COMMIT');
        const row = result.rows[0];
        return {
            total_products: Number(row.total_products),
            active_products: Number(row.active_products),
            total_merchants: Number(row.total_merchants),
            approximate: false,
            source: CATALOG_STATS_SOURCE_EXACT,
            collected_at: row.collected_at.toISOString(),
        };
    }
    catch (err) {
        await client.query('ROLLBACK').catch(() => { });
        console.warn('[catalog/stats] exact count failed (timeout_ms=%d):', timeoutMs, err.message);
        return null;
    }
    finally {
        client.release();
    }
}
// ─── Background refresh ─────────────────────────────────────────────────
async function triggerBackgroundRefresh() {
    try {
        const lock = await config_1.redis.set(REFRESH_LOCK_KEY, '1', 'EX', REFRESH_LOCK_TTL, 'NX');
        if (lock !== 'OK')
            return;
        // 2026-08-26 (Richmond): the periodic exact count(*) over 365M rows ran every 10 min on every
        // mcp instance against the search replica (45 s full scans). Estimates by default;
        // set CATALOG_STATS_EXACT=1 to restore the background exact count.
        const exact = process.env.CATALOG_STATS_EXACT === '1' ? await tryExactCount(45000) : null;
        if (exact) {
            await config_1.redis.set(CACHE_KEY, JSON.stringify(exact), 'EX', CACHE_TTL);
            console.log('[catalog/stats] background exact refresh ok: %d products', exact.total_products);
            return;
        }
        const stats = await collectStats();
        await config_1.redis.set(CACHE_KEY, JSON.stringify(stats), 'EX', CACHE_TTL);
        console.log('[catalog/stats] background estimate refresh ok: %d products', stats.total_products);
    }
    catch (err) {
        console.warn('[catalog/stats] background refresh error:', err.message);
    }
}
// ─── Warm-up on server start ────────────────────────────────────────────
let warmupDone = false;
async function warmUpCache() {
    if (warmupDone)
        return;
    warmupDone = true;
    console.log('[catalog/stats] warming cache with fast estimates…');
    const stats = await collectStats();
    await config_1.redis.set(CACHE_KEY, JSON.stringify(stats), 'EX', CACHE_TTL);
    console.log('[catalog/stats] warm-up ok: %d products, %d merchants', stats.total_products, stats.total_merchants);
    triggerBackgroundRefresh().catch(() => { });
}
warmUpCache().catch(() => { });
// ─── Periodic refresh (every 10 min) ────────────────────────────────────
const PERIODIC_INTERVAL_MS = 10 * 60 * 1000;
const periodicTimer = setInterval(() => {
    triggerBackgroundRefresh().catch(() => { });
}, PERIODIC_INTERVAL_MS);
periodicTimer.unref();
// ─── GET /stats ─────────────────────────────────────────────────────────
router.get('/stats', async (_req, res) => {
    try {
        // 1. Try Redis cache first
        const cached = await config_1.redis.get(CACHE_KEY).catch(() => null);
        if (cached) {
            const stats = JSON.parse(cached);
            triggerBackgroundRefresh().catch(() => { });
            res.json({
                data: {
                    total_products: stats.total_products,
                    total_merchants: stats.total_merchants,
                    active_products: stats.active_products,
                },
                meta: {
                    approximate: stats.approximate,
                    source: stats.source,
                    ts: stats.collected_at,
                },
            });
            return;
        }
        // 2. No cache — collect fresh stats (fast estimate)
        const stats = await collectStats();
        await config_1.redis.set(CACHE_KEY, JSON.stringify(stats), 'EX', CACHE_TTL).catch(() => { });
        triggerBackgroundRefresh().catch(() => { });
        res.json({
            data: {
                total_products: stats.total_products,
                total_merchants: stats.total_merchants,
                active_products: stats.active_products,
            },
            meta: {
                approximate: stats.approximate,
                source: stats.source,
                ts: stats.collected_at,
            },
        });
    }
    catch (err) {
        console.error('[catalog/stats] error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// ─── POST /stats/refresh — force refresh ────────────────────────────────
router.post('/stats/refresh', async (_req, res) => {
    try {
        await config_1.redis.del(CACHE_KEY).catch(() => { });
        await config_1.redis.del(REFRESH_LOCK_KEY).catch(() => { });
        const exact = await tryExactCount(60000);
        if (exact) {
            await config_1.redis.set(CACHE_KEY, JSON.stringify(exact), 'EX', CACHE_TTL);
            res.json({
                data: {
                    total_products: exact.total_products,
                    total_merchants: exact.total_merchants,
                    active_products: exact.active_products,
                },
                meta: { approximate: false, source: CATALOG_STATS_SOURCE_EXACT, ts: exact.collected_at },
            });
            return;
        }
        const stats = await collectStats();
        await config_1.redis.set(CACHE_KEY, JSON.stringify(stats), 'EX', CACHE_TTL);
        res.json({
            data: {
                total_products: stats.total_products,
                total_merchants: stats.total_merchants,
                active_products: stats.active_products,
            },
            meta: { approximate: true, source: stats.source, ts: stats.collected_at },
        });
    }
    catch (err) {
        console.error('[catalog/stats/refresh] error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// ─── GET /stats/health — regression guard ───────────────────────────────
router.get('/stats/health', async (_req, res) => {
    try {
        const cached = await config_1.redis.get(CACHE_KEY).catch(() => null);
        if (!cached) {
            res.json({ status: 'no_cache' });
            return;
        }
        const stats = JSON.parse(cached);
        const ageMin = Math.round((Date.now() - new Date(stats.collected_at).getTime()) / 60000);
        let status = 'ok';
        if (stats.approximate && stats.active_products === stats.total_products && stats.total_products > 1000000) {
            status = 'regression';
        }
        else if (ageMin > 30) {
            status = 'stale';
        }
        res.json({
            status,
            total_products: stats.total_products,
            active_products: stats.active_products,
            total_merchants: stats.total_merchants,
            approximate: stats.approximate,
            source: stats.source,
            cached_at: stats.collected_at,
            cache_age_min: ageMin,
            active_ratio: stats.total_products > 0
                ? (stats.active_products / stats.total_products * 100).toFixed(2) + '%'
                : 'N/A',
            // BUY-45692: read-replica routing + lag visibility for ops.
            replica: (0, readReplica_1.replicaStatus)(),
        });
    }
    catch (err) {
        res.status(500).json({ status: 'error', error: err.message });
    }
});
// ─── GET /categories (unchanged) ─────────────────────────────────────────
router.get('/categories', async (_req, res) => {
    const start = Date.now();
    try {
        const result = await config_1.catalogDb.query(`SELECT slug, name, product_count FROM mcp_category_summary ORDER BY product_count DESC LIMIT 50`);
        const categories = result.rows.map((row) => ({
            slug: row.slug,
            name: row.name,
            product_count: parseInt(row.product_count, 10),
        }));
        res.json({
            data: categories,
            meta: { total: categories.length, source: 'mcp_category_summary', response_time_ms: Date.now() - start },
        });
    }
    catch (err) {
        console.error('[catalog/categories] error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});
exports.default = router;
