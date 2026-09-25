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
    // BUY-60170: increased advisory timeout from 15s to 15min so the initial
    // matview population (CREATE MATERIALIZED VIEW on ~127M rows, ~10min) completes
    // before the advisory promise settles. The server still starts listening immediately;
    // warmup is intentionally non-blocking. After the initial population, the periodic
    // 5-min refresh completes in seconds via REFRESH CONCURRENTLY + delta scan.
    const warmupStart = Date.now();
    const ADVISORY_WARMUP_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes
    void Promise.race([
        Promise.allSettled([
            (0, mcpWarmup_1.warmupMcpCaches)(),
            (0, products_1.warmSearchCache)(),
            (0, affiliateWrapper_1.loadAffiliateConfigs)(),
        ]),
        new Promise((resolve) => setTimeout(() => resolve('timeout'), ADVISORY_WARMUP_TIMEOUT_MS)),
    ]).then((results) => {
        const failed = results === 'timeout'
            ? 0
            : results.filter((result) => result.status === 'rejected').length;
        const warmupMs = Date.now() - warmupStart;
        console.log(`[startup] advisory warmup settled in ${warmupMs}ms (failed=${failed})`);
    }).catch((err) => console.warn('[startup] advisory warmup failed:', err?.message));
    // BUY-32082: start P95 latency computation job (every 5 min)
    (0, p95Runner_1.startP95Runner)();
    (0, p95ProbeScheduler_1.startP95ProbeScheduler)();
    // BUY-48801: start disk space monitoring (every 5 min)
    (0, diskSpaceRunner_1.startDiskSpaceRunner)();
    // Refresh category materialized views + Redis caches every 5 min so counts stay
    // current as products are ingested, and the Redis TTL (600s) never expires cold.
    setInterval(() => {
        (0, mcpWarmup_1.refreshCategorySummaries)().catch((err) => console.warn('[category-refresh] failed:', err?.message));
    }, 5 * 60 * 1000);
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
process.on('uncaughtException', (err) => {
    console.error('[FATAL] uncaughtException:', err);
    if (server)
        server.close(() => process.exit(1));
    setTimeout(() => process.exit(1), 5000);
});
process.on('unhandledRejection', (reason) => {
    console.error('[WARN] unhandledRejection:', reason);
});
