import { initSentry } from './sentry';
import { createApp } from './server';
import { PORT, db } from './config';
import { shutdownPostHog } from './analytics/posthog';
import { runMigrations } from './migrate';
import { loadAffiliateConfigs } from './lib/affiliateWrapper';
import { warmupMcpCaches, refreshCategorySummaries } from './lib/mcpWarmup';
import { warmSearchCache } from './routes/products';
import { startP95Runner } from './jobs/p95Runner';
import { startP95ProbeScheduler, stopP95ProbeScheduler } from './jobs/p95ProbeScheduler';

// BUY-48017: Warn loudly on startup if the deals index is missing.
// /v1/products/deals hits 504 on every call when the partial index on
// (currency, discount_pct DESC) is absent — the planner falls back to a
// seq scan over 85M rows and trips the 15s statement_timeout. The migration
// in runMigrations() and warmupMcpCaches() both create the index, but a
// failed start leaves it missing in prod. This probe runs after both, and
// logs an actionable warning rather than failing boot.
async function ensureDealsIndex(): Promise<void> {
  try {
    const r = await db.query(
      `SELECT 1 FROM pg_indexes
        WHERE tablename = 'products'
          AND indexname = 'idx_products_deals_discount_pct'`
    );
    if (r.rows.length === 0) {
      console.warn(
        '[startup] (BUY-48017) idx_products_deals_discount_pct is MISSING — ' +
        '/v1/products/deals will return 504 deals_upstream_timeout. ' +
        'Run: CREATE INDEX CONCURRENTLY idx_products_deals_discount_pct ' +
        "ON products (currency, discount_pct DESC) WHERE discount_pct IS NOT NULL AND price > 0;"
      );
    } else {
      console.log('[startup] (BUY-48017) idx_products_deals_discount_pct present');
    }
  } catch (err: any) {
    console.warn('[startup] (BUY-48017) deals-index probe failed:', err?.message?.slice(0, 200));
  }
}

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

  // Pre-warm caches after migrations
  loadAffiliateConfigs().catch(() => {});
  warmupMcpCaches().catch((err) => console.warn('[mcp-warmup] failed:', err?.message));
  // BUY-31302: seed Redis with top search queries so cold cache is always <5ms
  warmSearchCache().catch((err) => console.warn('[cache-warm] failed:', err?.message));
  // BUY-48017: deals-index probe (warn, don't fail) — see comment above.
  ensureDealsIndex();

  // BUY-32082: start P95 latency computation job (every 5 min)
  startP95Runner();
  startP95ProbeScheduler();

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
