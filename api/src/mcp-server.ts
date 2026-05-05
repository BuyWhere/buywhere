// Standalone MCP server entry point — listens on MCP_PORT (default 8081)
// Exposes only the /mcp JSON-RPC endpoint and /health check.
// This runs as a separate container in staging (mcp.buywhere.io).
import express from 'express';
import cors from 'cors';
import { initSentry, Sentry } from './sentry';
import mcpRouter from './routes/mcp';
import { db } from './config';
import { shutdownPostHog } from './analytics/posthog';

// Initialize Sentry before anything else so all errors are captured
initSentry();

process.on('uncaughtException', (err) => {
  console.error('[fatal] MCP uncaught exception:', err);
  Sentry.captureException(err, { tags: { type: 'uncaught_exception' } });
  fatalShutdown(1);
});

process.on('unhandledRejection', (reason) => {
  console.error('[fatal] MCP unhandled rejection:', reason);
  const err = reason instanceof Error ? reason : new Error(String(reason));
  Sentry.captureException(err, { tags: { type: 'unhandled_rejection' } });
  fatalShutdown(1);
});

const MCP_PORT = parseInt(process.env.MCP_PORT || process.env.PORT || '8081');

const app = express();
app.use(cors());
app.use(express.json());

// Knative liveness probe — lightweight, no DB dependency
app.get('/healthz', (_req, res) => {
  res.json({ status: 'ok' });
});

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

// Pre-flight health endpoint — lightweight, no DB
app.get('/mcp/health', (_req, res) => {
  res.json({ status: 'ok', server: 'mcp' });
});

app.use('/mcp', mcpRouter);

// JSON-RPC root alias — allow POST / as shorthand for POST /mcp
app.use('/', mcpRouter);

// 404 fallback
app.use((_req, res) => {
  res.status(404).json({ error: 'not found' });
});

let server: ReturnType<typeof app.listen>;

async function fatalShutdown(exitCode: number) {
  console.log(`[fatal] MCP shutting down with code ${exitCode}...`);
  await shutdownPostHog();
  try { await db.end(); } catch {}
  if (server) {
    server.close(() => process.exit(exitCode));
  } else {
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
  await shutdownPostHog();
  server.close(() => process.exit(0));
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
