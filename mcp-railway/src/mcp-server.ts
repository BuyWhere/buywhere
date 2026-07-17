// Standalone MCP server entry point — listens on MCP_PORT (default 8081)
// Exposes only the /mcp JSON-RPC endpoint and /health check.
// This runs as a separate container in staging (mcp.buywhere.io).
import express from 'express';
import cors from 'cors';
import mcpRouter from './routes/mcp';
import wellknownRouter from './routes/wellknown';
import { db, redis } from './config';
import { shutdownPostHog } from './analytics/posthog';

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
    const result = await db.query('SELECT reltuples::bigint AS count FROM pg_class WHERE oid = \'public.products\'::regclass');
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

app.use('/.well-known', wellknownRouter);
app.use('/mcp', mcpRouter);

// JSON-RPC root alias — allow POST / as shorthand for POST /mcp
app.use('/', mcpRouter);

// 404 fallback
app.use((_req, res) => {
  res.status(404).json({ error: 'not found' });
});

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
    await client.query(`
      CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_products_deals_discount_pct
        ON products (currency, discount_pct DESC)
        WHERE discount_pct IS NOT NULL AND price > 0
    `).catch(e => console.warn('[mcp-warmup] deals index skipped:', e.message));
    console.log('[mcp-warmup] discount_pct column and index verified.');

    // BUY-21057: MATERIALIZED VIEW so pg_cron/pgAgent can refresh on a schedule,
    // eliminating the 68s GROUP BY on 14M rows that caused INTERNAL_ERROR timeouts.
    await client.query(`
      CREATE MATERIALIZED VIEW IF NOT EXISTS mcp_category_summary AS
        SELECT category_path[1] AS slug,
               category_path[1] AS name,
               COUNT(*)         AS product_count
        FROM products
        WHERE category_path[1] IS NOT NULL
        GROUP BY category_path[1]
        ORDER BY product_count DESC
    `);
    // Unique index required for REFRESH MATERIALIZED VIEW CONCURRENTLY (non-blocking reads during refresh)
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS mcp_category_summary_slug_idx
        ON mcp_category_summary (slug)
    `);

    await client.query(`
      CREATE MATERIALIZED VIEW IF NOT EXISTS mcp_category_summary_by_country AS
        SELECT country_code,
               category_path[1] AS slug,
               category_path[1] AS name,
               COUNT(*)         AS product_count
        FROM products
        WHERE category_path[1] IS NOT NULL
        GROUP BY country_code, category_path[1]
        ORDER BY country_code, product_count DESC
    `);
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS mcp_category_summary_by_country_pk_idx
        ON mcp_category_summary_by_country (country_code, slug)
    `);

    // BUY-60397: Use CONCURRENTLY so reads are never blocked during refresh.
    // Unique index must exist on each view for CONCURRENTLY to work.
    const summaryCount = await client.query(`SELECT COUNT(*) AS cnt FROM mcp_category_summary_by_country`);
    const summaryHasData = parseInt(summaryCount.rows[0].cnt, 10) > 0;
    if (summaryHasData) {
      await client.query(`REFRESH MATERIALIZED VIEW CONCURRENTLY mcp_category_summary`);
      await client.query(`REFRESH MATERIALIZED VIEW CONCURRENTLY mcp_category_summary_by_country`);
    }


    // BUY-63030: invalidate stale category-cache entries on every boot so the
    // corrected meta.unavailable logic (rows.every zero-count → true) takes effect
    // for callers instead of returning the cached unavailable:false payload.
    for (const country of ['SG', 'US', 'VN', 'TH', 'MY', 'GB', 'PH', 'ID', 'IN', 'AU']) {
      const cacheKey = `categories_mcp:top100:${country}`;
      await redis.del(cacheKey).catch((e) => console.warn(`[mcp-warmup] cache delete ${country} skipped:`, e.message));
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
        data: result.rows,
        meta: { total: result.rows.length, country_code: country, response_time_ms: Date.now() - t0, cached: false },
      };
      await redis.set(cacheKey, JSON.stringify(data), 'EX', 300).catch(() => {});
      console.log(`[mcp-warmup] list_categories ${country} cached (${result.rows.length} categories, ${Date.now() - t0}ms).`);
    }
  } finally {
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
  await shutdownPostHog();
  server.close(() => process.exit(0));
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
