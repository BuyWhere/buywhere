"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const sentry_1 = require("./sentry");
const server_1 = require("./server");
const config_1 = require("./config");
const posthog_1 = require("./analytics/posthog");
const migrate_1 = require("./migrate");
const affiliateWrapper_1 = require("./lib/affiliateWrapper");
const mcpWarmup_1 = require("./lib/mcpWarmup");
const products_1 = require("./routes/products");
const p95Runner_1 = require("./jobs/p95Runner");
const p95ProbeScheduler_1 = require("./jobs/p95ProbeScheduler");
const diskSpaceRunner_1 = require("./jobs/diskSpaceRunner");
const fxRefreshRunner_1 = require("./jobs/fxRefreshRunner");
// Initialize Sentry before anything else so all errors are captured
(0, sentry_1.initSentry)();
const app = (0, server_1.createApp)();
async function start() {
    // Run migrations before listening so DDL locks don't cancel first requests.
    // IF NOT EXISTS guards make this fast (< 1s) when already applied.
    try {
        await (0, migrate_1.runMigrations)();
    }
    catch (err) {
        console.error('Migration failed during startup (continuing):', err);
    }
    // Pre-warm caches after migrations
    (0, affiliateWrapper_1.loadAffiliateConfigs)().catch(() => { });
    (0, mcpWarmup_1.warmupMcpCaches)().catch((err) => console.warn('[mcp-warmup] failed:', err?.message));
    // BUY-31302: seed Redis with top search queries so cold cache is always <5ms
    (0, products_1.warmSearchCache)().catch((err) => console.warn('[cache-warm] failed:', err?.message));
    // BUY-32082: start P95 latency computation job (every 5 min)
    (0, p95Runner_1.startP95Runner)();
    (0, p95ProbeScheduler_1.startP95ProbeScheduler)();
    // BUY-48801: start disk space monitoring (every 5 min)
    (0, diskSpaceRunner_1.startDiskSpaceRunner)();
    // BUY-54078 / BUY-52476: refresh fx_rates every 6 hours (frankfurter + open.er-api fallback).
    (0, fxRefreshRunner_1.startFxRefreshScheduler)();
    // Refresh category materialized views + Redis caches every 5 min so counts stay
    // current as products are ingested, and the Redis TTL (600s) never expires cold.
    setInterval(() => {
        (0, mcpWarmup_1.refreshCategorySummaries)().catch((err) => console.warn('[category-refresh] failed:', err?.message));
    }, 5 * 60 * 1000);
    // Keep the search result cache hot so broad head terms never go cold -> 15s -> 504.
    // warmSearchCache was startup-ONLY; PG buffers on the search replica evict under load
    // between boots. Re-warm every 4 min (< Redis 600s TTL) so entries refresh before expiry.
    setInterval(() => {
        (0, products_1.warmSearchCache)().catch((err) => console.warn('[cache-warm] failed:', err?.message));
    }, 4 * 60 * 1000);
    return new Promise((resolve) => {
        const server = app.listen(config_1.PORT, () => {
            console.log(`BuyWhere API v1 listening on :${config_1.PORT}`);
            console.log(`  Health:   http://localhost:${config_1.PORT}/health`);
            console.log(`  Register: http://localhost:${config_1.PORT}/v1/auth/register`);
            console.log(`  Search:   http://localhost:${config_1.PORT}/v1/products/search`);
            console.log(`  MCP:      http://localhost:${config_1.PORT}/.well-known/ai-plugin.json`);
            resolve(server);
        });
    });
}
let server;
start().then((s) => {
    server = s;
}).catch((err) => {
    console.error('[FATAL] startup failed:', err);
    process.exit(1);
});
const shutdown = async () => {
    console.log('Shutting down...');
    await (0, posthog_1.shutdownPostHog)();
    (0, p95ProbeScheduler_1.stopP95ProbeScheduler)();
    if (server)
        server.close(() => process.exit(0));
    else
        process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
// BUY-33815: identify Postgres connection-loss errors that fire during a Postgres
// service restart (Railway maintenance, failover, etc.). On a restart, every
// in-flight pg socket is terminated and node-pg emits a 'Connection terminated'
// / ECONNRESET / SQLSTATE 08006 error. Without this, uncaughtException killed
// the process and Railway kept the container down — see BUY-33735 (49-min outage).
function isPgConnectionLoss(err) {
    if (!err || typeof err !== 'object')
        return false;
    const e = err;
    const codes = [e.code, ...(Array.isArray(e.errors) ? e.errors.map((x) => x.code) : [])].filter((c) => typeof c === 'string');
    if (codes.some((c) => c === 'ECONNRESET' || c === '08006' || c === '57P' || c === '57P01' || c === '57P02' || c === '57P03')) {
        return true;
    }
    const msg = String(e.message || '');
    return /Connection terminated/i.test(msg) || /connection terminated unexpectedly/i.test(msg);
}
process.on('uncaughtException', (err) => {
    if (isPgConnectionLoss(err)) {
        // Pool will recreate connections on next checkout. Stay up.
        console.warn('[pg-conn-loss] uncaughtException from pg client (process kept alive, pool will reconnect):', err.message);
        return;
    }
    console.error('[FATAL] uncaughtException:', err);
    if (server)
        server.close(() => process.exit(1));
    setTimeout(() => process.exit(1), 5000);
});
process.on('unhandledRejection', (reason) => {
    if (isPgConnectionLoss(reason)) {
        console.warn('[pg-conn-loss] unhandledRejection from pg client (process kept alive, pool will reconnect):', reason?.message || String(reason));
        return;
    }
    console.error('[WARN] unhandledRejection:', reason);
});
