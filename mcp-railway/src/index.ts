import { initSentry } from './sentry';
import { createApp } from './server';
import { PORT } from './config';
import { shutdownPostHog } from './analytics/posthog';
import { runMigrations } from './migrate';
import { loadAffiliateConfigs } from './lib/affiliateWrapper';
import { warmupMcpCaches, refreshCategorySummaries } from './lib/mcpWarmup';
import { warmSearchCache } from './routes/products';
import { startP95Runner } from './jobs/p95Runner';
import { startP95ProbeScheduler, stopP95ProbeScheduler } from './jobs/p95ProbeScheduler';
import { startDiskSpaceRunner } from './jobs/diskSpaceRunner';

// Initialize Sentry before anything else so all errors are captured
initSentry();

const app = createApp();

async function start() {
  // Run migrations before listening so DDL locks don't cancel first requests.
  // IF NOT EXISTS guards make this fast (< 1s) when already applied.
  try {
    await runMigrations();
  } catch (err) {
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
      warmupMcpCaches(),
      warmSearchCache(),
      loadAffiliateConfigs(),
    ]),
    new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), ADVISORY_WARMUP_TIMEOUT_MS)),
  ]).then((results) => {
    const failed = results === 'timeout'
      ? 0
      : results.filter((result) => result.status === 'rejected').length;
    const warmupMs = Date.now() - warmupStart;
    console.log(`[startup] advisory warmup settled in ${warmupMs}ms (failed=${failed})`);
  }).catch((err) => console.warn('[startup] advisory warmup failed:', err?.message));

  // BUY-32082: start P95 latency computation job (every 5 min)
  startP95Runner();
  startP95ProbeScheduler();

  // BUY-48801: start disk space monitoring (every 5 min)
  startDiskSpaceRunner();

  // Refresh category materialized views + Redis caches every 5 min so counts stay
  // current as products are ingested, and the Redis TTL (600s) never expires cold.
  setInterval(() => {
    refreshCategorySummaries().catch((err) => console.warn('[category-refresh] failed:', err?.message));
  }, 5 * 60 * 1000);

  return new Promise<ReturnType<typeof app.listen>>((resolve) => {
    const server = app.listen(PORT, () => {
      console.log(`BuyWhere API v1 listening on :${PORT}`);
      console.log(`  Health:   http://localhost:${PORT}/health`);
      console.log(`  Register: http://localhost:${PORT}/v1/auth/register`);
      console.log(`  Search:   http://localhost:${PORT}/v1/products/search`);
      console.log(`  MCP:      http://localhost:${PORT}/.well-known/ai-plugin.json`);
      resolve(server);
    });
  });
}

let server: ReturnType<typeof app.listen> | undefined;

start().then((s) => {
  server = s;
}).catch((err) => {
  console.error('[FATAL] startup failed:', err);
  process.exit(1);
});

const shutdown = async () => {
  console.log('Shutting down...');
  await shutdownPostHog();
  stopP95ProbeScheduler();
  if (server) server.close(() => process.exit(0));
  else process.exit(0);
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

process.on('uncaughtException', (err) => {
  console.error('[FATAL] uncaughtException:', err);
  if (server) server.close(() => process.exit(1));
  setTimeout(() => process.exit(1), 5000);
});

process.on('unhandledRejection', (reason) => {
  console.error('[WARN] unhandledRejection:', reason);
});
