"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// Standalone MCP server entry point — listens on MCP_PORT (default 8081)
// Exposes only the /mcp JSON-RPC endpoint and /health check.
// This runs as a separate container in staging (mcp.buywhere.io).
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const sentry_1 = require("./sentry");
const mcp_1 = __importDefault(require("./routes/mcp"));
const config_1 = require("./config");
const posthog_1 = require("./analytics/posthog");
// Initialize Sentry before anything else so all errors are captured
(0, sentry_1.initSentry)();
process.on('uncaughtException', (err) => {
    console.error('[fatal] MCP uncaught exception:', err);
    sentry_1.Sentry.captureException(err, { tags: { type: 'uncaught_exception' } });
    fatalShutdown(1);
});
process.on('unhandledRejection', (reason) => {
    console.error('[fatal] MCP unhandled rejection:', reason);
    const err = reason instanceof Error ? reason : new Error(String(reason));
    sentry_1.Sentry.captureException(err, { tags: { type: 'unhandled_rejection' } });
    fatalShutdown(1);
});
const MCP_PORT = parseInt(process.env.MCP_PORT || process.env.PORT || '8081');
const app = (0, express_1.default)();
app.use((0, cors_1.default)());
app.use(express_1.default.json());
// Knative liveness probe — lightweight, no DB dependency
app.get('/healthz', (_req, res) => {
    res.json({ status: 'ok' });
});
app.get('/health', async (_req, res) => {
    try {
        const result = await config_1.db.query('SELECT COUNT(*) FROM products');
        res.json({
            status: 'ok',
            server: 'mcp',
            ts: new Date().toISOString(),
            catalog: { total_products: parseInt(result.rows[0].count, 10) },
        });
    }
    catch (err) {
        res.status(500).json({ status: 'error', error: String(err) });
    }
});
// Pre-flight health endpoint — lightweight, no DB
app.get('/mcp/health', (_req, res) => {
    res.json({ status: 'ok', server: 'mcp' });
});
app.use('/mcp', mcp_1.default);
// JSON-RPC root alias — allow POST / as shorthand for POST /mcp
app.use('/', mcp_1.default);
// 404 fallback
app.use((_req, res) => {
    res.status(404).json({ error: 'not found' });
});
let server;
async function fatalShutdown(exitCode) {
    console.log(`[fatal] MCP shutting down with code ${exitCode}...`);
    await (0, posthog_1.shutdownPostHog)();
    try {
        await config_1.db.end();
    }
    catch { }
    if (server) {
        server.close(() => process.exit(exitCode));
    }
    else {
        process.exit(exitCode);
    }
    setTimeout(() => process.exit(exitCode), 5000).unref();
}
server = app.listen(MCP_PORT, () => {
    console.log(`BuyWhere MCP server listening on :${MCP_PORT}`);
    console.log(`  Health: http://localhost:${MCP_PORT}/health`);
    console.log(`  MCP:    http://localhost:${MCP_PORT}/mcp`);
});
const shutdown = async () => {
    console.log('MCP server shutting down...');
    await (0, posthog_1.shutdownPostHog)();
    server.close(() => process.exit(0));
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
