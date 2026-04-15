// Standalone MCP server entry point — listens on MCP_PORT (default 8081)
// Exposes only the /mcp JSON-RPC endpoint and /health check.
// This runs as a separate container in staging (mcp.buywhere.io).
import express from 'express';
import cors from 'cors';
import mcpRouter from './routes/mcp';
import { db } from './config';
import { shutdownPostHog } from './analytics/posthog';

const MCP_PORT = parseInt(process.env.MCP_PORT || process.env.PORT || '8081');

const app = express();
app.use(cors());
app.use(express.json());

app.get('/health', async (_req, res) => {
  try {
    const result = await db.query('SELECT COUNT(*) FROM products');
    res.json({
      status: 'ok',
      server: 'mcp',
      ts: new Date().toISOString(),
      catalog: { total_products: parseInt(result.rows[0].count, 10) },
    });
  } catch (err) {
    res.status(500).json({ status: 'error', error: String(err) });
  }
});

app.use('/mcp', mcpRouter);

// JSON-RPC root alias — allow POST / as shorthand for POST /mcp
app.use('/', mcpRouter);

const server = app.listen(MCP_PORT, () => {
  console.log(`BuyWhere MCP server listening on :${MCP_PORT}`);
  console.log(`  Health: http://localhost:${MCP_PORT}/health`);
  console.log(`  MCP:    http://localhost:${MCP_PORT}/mcp`);
});

const shutdown = async () => {
  console.log('MCP server shutting down...');
  await shutdownPostHog();
  server.close(() => process.exit(0));
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
