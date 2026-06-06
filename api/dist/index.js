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
