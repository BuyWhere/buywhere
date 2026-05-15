"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const sentry_1 = require("./sentry");
const server_1 = require("./server");
const config_1 = require("./config");
const posthog_1 = require("./analytics/posthog");
const migrate_1 = require("./migrate");
// Initialize Sentry before anything else so all errors are captured
(0, sentry_1.initSentry)();
const app = (0, server_1.createApp)();
(0, migrate_1.runMigrations)().catch(err => {
    console.error('Migration failed during startup:', err);
});
const server = app.listen(config_1.PORT, () => {
    console.log(`BuyWhere API v1 listening on :${config_1.PORT}`);
    console.log(`  Health:   http://localhost:${config_1.PORT}/health`);
    console.log(`  Register: http://localhost:${config_1.PORT}/v1/auth/register`);
    console.log(`  Search:   http://localhost:${config_1.PORT}/v1/products/search`);
    console.log(`  MCP:      http://localhost:${config_1.PORT}/.well-known/ai-plugin.json`);
});
const shutdown = async () => {
    console.log('Shutting down...');
    await (0, posthog_1.shutdownPostHog)();
    server.close(() => process.exit(0));
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
