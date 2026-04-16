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
const mcp_1 = __importDefault(require("./routes/mcp"));
const config_1 = require("./config");
const posthog_1 = require("./analytics/posthog");
const MCP_PORT = parseInt(process.env.MCP_PORT || process.env.PORT || '8081');
const app = (0, express_1.default)();
app.use((0, cors_1.default)());
app.use(express_1.default.json());
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
app.use('/mcp', mcp_1.default);
// JSON-RPC root alias — allow POST / as shorthand for POST /mcp
app.use('/', mcp_1.default);
const server = app.listen(MCP_PORT, () => {
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
