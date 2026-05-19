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
// Knative liveness probe — lightweight, no DB dependency
app.get('/healthz', (_req, res) => {
    res.json({ status: 'ok' });
});
app.get('/health', async (_req, res) => {
    try {
        const result = await config_1.db.query('SELECT reltuples::bigint AS count FROM pg_class WHERE oid = \'public.products\'::regclass');
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
// 404 fallback
app.use((_req, res) => {
    res.status(404).json({ error: 'not found' });
});
async function warmupMcpCaches() {
    // Ensure discount_pct generated column exists (needed by get_deals fast path).
    // This mirrors the migration in migrate.ts but scoped to MCP server startup.
    const client = await config_1.db.connect();
    try {
        await client.query('SET statement_timeout = 360000'); // 6 minutes for DDL on 14M rows
        const hasCol = await client.query(`SELECT 1 FROM information_schema.columns WHERE table_name='products' AND column_name='discount_pct' LIMIT 1`);
        if (hasCol.rows.length === 0) {
            console.log('[mcp-warmup] Adding discount_pct column (may take several minutes)...');
            await client.query(`
        ALTER TABLE products ADD COLUMN IF NOT EXISTS discount_pct NUMERIC
          GENERATED ALWAYS AS (
            ROUND((1 - price / NULLIF((metadata->>'original_price')::NUMERIC, 0)) * 100)
          ) STORED
      `);
            await client.query(`
        CREATE INDEX IF NOT EXISTS idx_products_deals ON products(currency, discount_pct DESC)
          WHERE discount_pct IS NOT NULL
      `);
            console.log('[mcp-warmup] discount_pct column and index created.');
        }
        else {
            console.log('[mcp-warmup] discount_pct column already exists.');
        }
        // Pre-warm list_categories cache so the first request is instant.
        const cacheKey = 'categories_mcp:top100';
        const existingCache = await config_1.redis.get(cacheKey).catch(() => null);
        if (!existingCache) {
            console.log('[mcp-warmup] Pre-warming list_categories cache...');
            const t0 = Date.now();
            const result = await client.query(`
        SELECT category_path[1] AS slug,
               category_path[1] AS name,
               COUNT(*) AS product_count
        FROM products
        WHERE category_path[1] IS NOT NULL
        GROUP BY category_path[1]
        ORDER BY product_count DESC
        LIMIT 100
      `);
            const data = { data: result.rows, meta: { total: result.rows.length, response_time_ms: Date.now() - t0, cached: false } };
            await config_1.redis.set(cacheKey, JSON.stringify(data), 'EX', 300).catch(() => { });
            console.log(`[mcp-warmup] list_categories cached (${result.rows.length} categories, ${Date.now() - t0}ms).`);
        }
        else {
            console.log('[mcp-warmup] list_categories cache already warm.');
        }
    }
    finally {
        client.release();
    }
}
const server = app.listen(MCP_PORT, () => {
    console.log(`BuyWhere MCP server listening on :${MCP_PORT}`);
    console.log(`  Health: http://localhost:${MCP_PORT}/health`);
    console.log(`  MCP:    http://localhost:${MCP_PORT}/mcp`);
    // Ensure discount_pct column exists and pre-warm list_categories cache after startup.
    warmupMcpCaches().catch(err => console.warn('[mcp-warmup] failed:', err.message));
});
const shutdown = async () => {
    console.log('MCP server shutting down...');
    await (0, posthog_1.shutdownPostHog)();
    server.close(() => process.exit(0));
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
