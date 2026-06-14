import { initSentry } from './sentry';
import { createApp } from './server';
import { db, PORT } from './config';
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

// BUY-48789: fail fast at startup if the DB is unreachable. Without this,
// a misconfigured DATABASE_URL would let the server start, accept traffic,
// and only fail 6 min into the request burst when the first migration /
// statement timed out — by then Railway's restartPolicyMaxRetries: 3 is
// already burning. A 5s `SELECT 1` with an explicit abort is the cleanest
// way to surface "I can't reach the DB" with a single clear log line.
const DB_REACHABILITY_TIMEOUT_MS = 5000;
async function checkDbReachable(): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`DB reachability check timed out after ${DB_REACHABILITY_TIMEOUT_MS}ms`)),
        DB_REACHABILITY_TIMEOUT_MS
      );
    });
    await Promise.race([db.query('SELECT 1'), timeout]);
    return true;
  } catch (err) {
    console.error(`[startup] DB unreachable: ${(err as Error).message || err}`);
    return false;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function start() {
  // BUY-48789: 5s DB reachability probe before migrations or listen.
  // If the DB is down we log the cause immediately and continue — Railway
  // will see the uncaughtException (or the first failing request) and
  // restart. Better than letting the request burst time out 6 min in.
  const reachable = await checkDbReachable();
  if (!reachable) {
    console.error('[startup] continuing without verified DB; first request will surface the failure');
  }

  // Run migrations before listening so DDL locks don't cancel first requests.
  // IF NOT EXISTS guards make this fast (< 1s) when already applied.
  try {
    await runMigrations();
  } catch (err) {
    console.error('Migration failed during startup (continuing):', err);
  }

  // Pre-warm caches after migrations
  loadAffiliateConfigs().catch(() => {});
  warmupMcpCaches().catch((err) => console.warn('[mcp-warmup] failed:', err?.message));
  // BUY-31302: seed Redis with top search queries so cold cache is always <5ms
  warmSearchCache().catch((err) => console.warn('[cache-warm] failed:', err?.message));

  // BUY-32082: start P95 latency computation job (every 5 min)
  startP95Runner();
  startP95ProbeScheduler();

  // BUY-48801: start disk space monitoring (every 5 min, critical at 5GB, warn at 20GB)
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

process.on('uncaughtException', (err: NodeJS.ErrnoException) => {
  // BUY-48789: the pg client raises "Connection terminated unexpectedly" on
  // the next query after the server-side session is killed (autovacuum,
  // admin command, replica failover). The pg client auto-reconnects on the
  // next query, so crashing the whole process — and triggering
  // restartPolicyMaxRetries — turns a single PG blip into a 3-retry crash
  // loop. Log loudly and let pg recover. Any other uncaughtException is
  // still treated as fatal.
  const message = (err && (err as Error).message) || String(err);
  if (/Connection terminated|administrator command|Connection terminated unexpectedly/i.test(message)) {
    console.error(`[RECOVERED] pg connection blip (non-fatal): ${message}`);
    return;
  }
  console.error('[FATAL] uncaughtException:', err);
  if (server) server.close(() => process.exit(1));
  setTimeout(() => process.exit(1), 5000);
});

process.on('unhandledRejection', (reason) => {
  console.error('[WARN] unhandledRejection:', reason);
});
