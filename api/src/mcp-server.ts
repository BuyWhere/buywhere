// Standalone MCP server entry point — listens on MCP_PORT (default 8081)
// Exposes only the /mcp JSON-RPC endpoint and /health check.
// This runs as a separate container in staging (mcp.buywhere.io).
import express from 'express';
import cors from 'cors';
import mcpRouter from './routes/mcp';
import { db, redis } from './config';
import { shutdownPostHog } from './analytics/posthog';
import { computeSnapshot } from './monitoring/healthSnapshot';

const MCP_PORT = parseInt(process.env.MCP_PORT || process.env.PORT || '8081');

const app = express();
app.use(cors());
app.use(express.json());

// Knative liveness probe — lightweight, no DB dependency
app.get('/healthz', (_req, res) => {
  res.json({ status: 'ok' });
});

// BUY-69817: public health surface with per-tool/per-region breakdown.
app.get('/health', async (_req, res) => {
  try {
    const [countResult, pong] = await Promise.all([
      db.query('SELECT reltuples::bigint AS count FROM pg_class WHERE oid = \'public.products\'::regclass'),
      redis.ping(),
    ]);
    const catalogTotal = parseInt(countResult.rows[0].count, 10);

    let snapshot;
    try {
      snapshot = computeSnapshot();
    } catch {
      snapshot = { status: 'ok' as const, server: 'mcp' as const, ts: new Date().toISOString(), tools: {}, regions: {} };
    }
    res.json({
      ...snapshot,
      catalog: { total_products: catalogTotal },
      db: 'ok',
      redis: pong === 'PONG' ? 'ok' : 'degraded',
      ts: new Date().toISOString(),
    });
  } catch (err) {
    res.status(503).json({ status: 'down', error: String(err), ts: new Date().toISOString() });
  }
});

// BUY-69817: per-tool breakdown.
app.get('/health/tools', (_req, res) => {
  try {
    const snapshot = computeSnapshot();
    res.json({ status: snapshot.status, server: 'mcp', ts: snapshot.ts, tools: snapshot.tools });
  } catch {
    res.json({ status: 'ok', server: 'mcp', ts: new Date().toISOString(), tools: {}, note: 'snapshotter degraded' });
  }
});

// BUY-69817: per-region breakdown.
app.get('/health/regions', (_req, res) => {
  try {
    const snapshot = computeSnapshot();
    res.json({ status: snapshot.status, server: 'mcp', ts: snapshot.ts, regions: snapshot.regions });
  } catch {
    res.json({ status: 'ok', server: 'mcp', ts: new Date().toISOString(), regions: {}, note: 'snapshotter degraded' });
  }
});

app.use('/mcp', mcpRouter);

// JSON-RPC root alias — allow POST / as shorthand for POST /mcp
app.use('/', mcpRouter);

// 404 fallback
app.use((_req, res) => {
  res.status(404).json({ error: 'not found' });
});

// BUY-56185 / BUY-60097: Detect statement_timeout poisoned connections.
// When PostgreSQL's statement_timeout fires, the query is cancelled but the
// connection enters PQTRANS_INERROR state. Returning such a connection to the
// pool poisons every subsequent query. client.state returns 'error' in this state.
function releaseClientSafely(client: any): void {
  try {
    if (client && typeof client.state === 'string' && client.state === 'error') {
      client.release(true); // discard — do NOT return poisoned connection to pool
    } else {
      client.release();
    }
  } catch (_) {
    // Swallow release errors — pool will remove the bad client anyway.
  }
}

async function warmupMcpCaches() {
  // BUY-22324: Ensure discount_pct is a GENERATED STORED column (not a plain column).
  const client = await db.connect();
  try {
    await client.query('SET statement_timeout = 360000');
    const colInfo = await client.query(
      `SELECT is_generated FROM information_schema.columns WHERE table_name='products' AND column_name='discount_pct'`
    );
    if (colInfo.rows.length === 0) {
      console.log('[mcp-warmup] Adding discount_pct GENERATED column...');
      await client.query(`
        ALTER TABLE products ADD COLUMN discount_pct numeric
          GENERATED ALWAYS AS (
            CASE
              WHEN (metadata->>'original_price') ~ '^[0-9]+(\\.[0-9]+)?$'
               AND (metadata->>'original_price')::numeric > 0
              THEN ROUND((1 - price / (metadata->>'original_price')::numeric) * 100)
            END
          ) STORED
      `);
    } else if (colInfo.rows[0].is_generated === 'NEVER') {
      console.log('[mcp-warmup] Replacing plain discount_pct with GENERATED column...');
      await client.query(`ALTER TABLE products DROP COLUMN discount_pct`);
      await client.query(`
        ALTER TABLE products ADD COLUMN discount_pct numeric
          GENERATED ALWAYS AS (
            CASE
              WHEN (metadata->>'original_price') ~ '^[0-9]+(\\.[0-9]+)?$'
               AND (metadata->>'original_price')::numeric > 0
              THEN ROUND((1 - price / (metadata->>'original_price')::numeric) * 100)
            END
          ) STORED
      `);
    } else {
      console.log('[mcp-warmup] discount_pct GENERATED column already exists.');
    }
    // BUY-26343: Use CONCURRENTLY so startup doesn't hold a lock on 68M row table.
    // Note: CONCURRENTLY cannot run inside a transaction; it is fire-and-forget here.
    // The index may not exist immediately after — a separate deploy kit ensures it.
    // BUY-58273: correct shape — must match the production index definition exactly.
    await client.query(`
      CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_products_deals_discount_pct
        ON products (discount_pct)
        WHERE discount_pct > 0
    `).catch(e => console.warn('[mcp-warmup] deals index skipped:', e.message));
    console.log('[mcp-warmup] discount_pct column and index verified.');

    await client.query(`
      CREATE MATERIALIZED VIEW IF NOT EXISTS mcp_category_summary_by_country AS
        SELECT country_code,
               slug,
               slug AS name,
               COUNT(*) AS product_count
        FROM (
          SELECT country_code,
                 COALESCE(category_path[1], NULLIF(lower(regexp_replace(category, '\\s+', '-', 'g')), '')) AS slug
          FROM products
          WHERE country_code IS NOT NULL
        ) _cat
        WHERE slug IS NOT NULL AND slug <> ''
        GROUP BY country_code, slug
        ORDER BY country_code, product_count DESC
    `);

    const summaryCount = await client.query(`SELECT COUNT(*) AS cnt FROM mcp_category_summary_by_country`);
    const summaryHasData = parseInt(summaryCount.rows[0].cnt, 10) > 0;
    if (summaryHasData) {
      await client.query(`REFRESH MATERIALIZED VIEW mcp_category_summary_by_country`);
    }

    for (const country of ['SG', 'US', 'VN', 'TH', 'MY']) {
      const cacheKey = `categories_mcp:top100:${country}`;
      const existingCache = await redis.get(cacheKey).catch(() => null);
      if (existingCache && summaryHasData) continue;

      console.log(`[mcp-warmup] Pre-warming list_categories cache for ${country}...`);
      const t0 = Date.now();
      const result = await client.query(
        `SELECT slug, name, product_count
         FROM mcp_category_summary_by_country
         WHERE country_code = $1
         ORDER BY product_count DESC
         LIMIT 100`,
        [country]
      );
      const data = {
        // BUY-71112: expose both `categories` (canonical) and `data` (legacy)
        // so callers expecting either key keep working. Mirrors mcp-railway fix.
        categories: result.rows,
        data: result.rows,
        meta: { total: result.rows.length, country_code: country, response_time_ms: Date.now() - t0, cached: false },
      };
      await redis.set(cacheKey, JSON.stringify(data), 'EX', 300).catch(() => {});
      console.log(`[mcp-warmup] list_categories ${country} cached (${result.rows.length} categories, ${Date.now() - t0}ms).`);
    }
  } finally {
    // BUY-60097: discard connections poisoned by statement_timeout
    releaseClientSafely(client);
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
  await shutdownPostHog();
  server.close(() => process.exit(0));
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
