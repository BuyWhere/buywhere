import { db, redis } from '../config';

// BUY-60170: Railway Postgres has ~127M product rows. The initial matview population
// (CREATE MATERIALIZED VIEW + full GROUP BY) takes ~10 minutes on this dataset.
// Set very high so first population completes. Subsequent refreshes (REFRESH MATERIALIZED
// VIEW CONCURRENTLY) only need 30s since they scan only the delta.
const MCP_WARMUP_STATEMENT_TIMEOUT_MS = parseInt(process.env.MCP_WARMUP_STATEMENT_TIMEOUT_MS || '600000', 10);
const MCP_WARMUP_LOCK_TIMEOUT_MS = parseInt(process.env.MCP_WARMUP_LOCK_TIMEOUT_MS || '5000', 10);
const MCP_REFRESH_STATEMENT_TIMEOUT_MS = parseInt(process.env.MCP_REFRESH_STATEMENT_TIMEOUT_MS || '30000', 10);
const MCP_REFRESH_LOCK_TIMEOUT_MS = parseInt(process.env.MCP_REFRESH_LOCK_TIMEOUT_MS || '1000', 10);
const MCP_ENABLE_STARTUP_DDL = process.env.MCP_ENABLE_STARTUP_DDL === 'true';

function isTimeoutError(err: unknown): boolean {
  const error = err as { code?: string; message?: string } | undefined;
  return error?.code === '57014' || /timeout|canceling statement/i.test(error?.message || '');
}

async function resetSessionTimeouts(client: any): Promise<void> {
  await client.query('RESET statement_timeout');
  await client.query('RESET lock_timeout');
}

async function queryWithWarmupBudget<T = any>(client: any, sql: string, params?: unknown[]): Promise<T | null> {
  try {
    return await client.query(sql, params);
  } catch (err) {
    if (isTimeoutError(err)) {
      console.warn('[mcp-warmup] skipped slow/locked warmup query:', (err as Error).message);
      return null;
    }
    throw err;
  }
}

export async function warmupMcpCaches(): Promise<void> {
  const client = await db.connect();
  try {
    await client.query(`SET statement_timeout = ${MCP_WARMUP_STATEMENT_TIMEOUT_MS}`);
    await client.query(`SET lock_timeout = ${MCP_WARMUP_LOCK_TIMEOUT_MS}`);

    if (!MCP_ENABLE_STARTUP_DDL) {
      const viewCheck = await client.query(
        `SELECT to_regclass('public.mcp_category_summary_by_country') AS tbl`
      );
      if (!viewCheck.rows[0]?.tbl) {
        console.warn('[mcp-warmup] category summary view missing; skipping advisory startup warmup');
        return;
      }

      for (const country of CATEGORY_REFRESH_COUNTRIES) {
        const cacheKey = `categories_mcp:top100:${country}`;
        const existingCache = await redis.get(cacheKey).catch(() => null);
        if (existingCache) continue;

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
        await redis.set(cacheKey, JSON.stringify(data), 'EX', 600).catch(() => {});
      }
      return;
    }

    // BUY-22324: Ensure discount_pct is a GENERATED STORED column (not plain).
    const colInfo = await client.query(
      `SELECT is_generated FROM information_schema.columns WHERE table_name='products' AND column_name='discount_pct'`
    );
    if (colInfo.rows.length === 0) {
      console.log('[mcp-warmup] Adding discount_pct GENERATED column...');
      await queryWithWarmupBudget(client, `
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
      console.warn('[mcp-warmup] plain discount_pct column detected; skipping destructive startup DDL. Run a migration off the request service.');
    }
    // BUY-64112: keep this shape aligned with api/src/migrate.ts so the strict
    // discount_pct deals query can use the same index after startup warmup.
    await queryWithWarmupBudget(client, `
      CREATE INDEX IF NOT EXISTS idx_products_deals_discount_pct
        ON products (currency, discount_pct DESC)
        WHERE discount_pct IS NOT NULL AND price > 0
    `);
    // BUY-56635: country-aware deals index. The plain (currency, discount_pct DESC)
    // index is not used when the MCP deals query also filters by country_code;
    // the planner falls back to a seq scan on 14M rows and the 15s statement_timeout
    // fires, surfacing as -32603 to Tune. A partial index keyed on
    // (currency, country_code, discount_pct DESC) lets the planner satisfy all three
    // predicates from the index alone.
    await queryWithWarmupBudget(client, `
      CREATE INDEX IF NOT EXISTS idx_products_deals_country
        ON products (currency, country_code, discount_pct DESC)
        WHERE discount_pct IS NOT NULL AND price > 0 AND is_active = true
          AND country_code IS NOT NULL
    `);
    console.log('[mcp-warmup] discount_pct column and indexes verified.');

    // BUY-60170: Railway Postgres uses small shared_buffers; HashAggregate would
    // try to build a hash table in memory for ~100 distinct categories, exceeding
    // available memory and causing spills. Sort-based aggregate is memory-frugal.
    await client.query(`SET enable_hashagg = off`);
    await client.query(`SET work_mem = '256MB'`);
    // BUY-21057: Use MATERIALIZED VIEW so pg_cron/pgAgent can refresh it on a schedule,
    // eliminating the 68s GROUP BY on 14M rows that caused INTERNAL_ERROR timeouts.
    await queryWithWarmupBudget(client, `
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
    await queryWithWarmupBudget(client, `
      CREATE UNIQUE INDEX IF NOT EXISTS mcp_category_summary_slug_idx
        ON mcp_category_summary (slug)
    `);
    await queryWithWarmupBudget(client, `
      CREATE MATERIALIZED VIEW IF NOT EXISTS mcp_category_summary_by_country AS
        SELECT country_code,
               category_path[1] AS slug,
               category_path[1] AS name,
               COUNT(*)         AS product_count
        FROM products
        WHERE country_code IS NOT NULL
          AND category_path[1] IS NOT NULL
        GROUP BY country_code, category_path[1]
        ORDER BY country_code, product_count DESC
    `);
    await queryWithWarmupBudget(client, `
      CREATE UNIQUE INDEX IF NOT EXISTS mcp_category_summary_by_country_pk_idx
        ON mcp_category_summary_by_country (country_code, slug)
    `);

    const viewCheck = await client.query(
      `SELECT to_regclass('public.mcp_category_summary') AS summary,
              to_regclass('public.mcp_category_summary_by_country') AS country_summary`
    );
    if (!viewCheck.rows[0]?.summary || !viewCheck.rows[0]?.country_summary) {
      console.warn('[mcp-warmup] category summary views are not ready; skipping cache refresh this startup.');
      return;
    }

    // Check if materialized view has data (REFRESH is fast; initial population may be slow)
    const summaryCount = await client.query(`SELECT COUNT(*) AS cnt FROM mcp_category_summary`);
    const summaryHasData = parseInt(summaryCount.rows[0].cnt, 10) > 0;
    const countrySummaryCount = await client.query(`SELECT COUNT(*) AS cnt FROM mcp_category_summary_by_country`);
    const countrySummaryHasData = parseInt(countrySummaryCount.rows[0].cnt, 10) > 0;

    if (summaryHasData) {
      await queryWithWarmupBudget(client, `REFRESH MATERIALIZED VIEW CONCURRENTLY mcp_category_summary`);
    }
    if (countrySummaryHasData) {
      await queryWithWarmupBudget(client, `REFRESH MATERIALIZED VIEW CONCURRENTLY mcp_category_summary_by_country`);
    }

    for (const country of ['SG', 'US', 'VN', 'TH', 'MY']) {
      const cacheKey = `categories_mcp:top100:${country}`;
      const existingCache = await redis.get(cacheKey).catch(() => null);
      if (existingCache && countrySummaryHasData) continue;

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
      await redis.set(cacheKey, JSON.stringify(data), 'EX', 600).catch(() => {}); // 10 min TTL
      console.log(`[mcp-warmup] list_categories ${country} cached (${result.rows.length} categories, ${Date.now() - t0}ms).`);
    }
  } finally {
    await resetSessionTimeouts(client).catch(() => {});
    client.release();
  }
}

const CATEGORY_REFRESH_COUNTRIES = ['SG', 'US', 'VN', 'TH', 'MY'];

// Lightweight periodic refresh — called every 5 min from index.ts.
// Uses CONCURRENTLY so reads are never blocked during the refresh.
export async function refreshCategorySummaries(): Promise<void> {
  const client = await db.connect();
  try {
    await client.query(`SET statement_timeout = ${MCP_REFRESH_STATEMENT_TIMEOUT_MS}`);
    await client.query(`SET lock_timeout = ${MCP_REFRESH_LOCK_TIMEOUT_MS}`);
    const viewCheck = await client.query(
      `SELECT to_regclass('public.mcp_category_summary_by_country') AS tbl`
    );
    if (!viewCheck.rows[0]?.tbl) return; // view not yet created; warmup will handle it on next deploy

    const summaryRefresh = await queryWithWarmupBudget(client, `REFRESH MATERIALIZED VIEW CONCURRENTLY mcp_category_summary`);
    const countrySummaryRefresh = await queryWithWarmupBudget(client, `REFRESH MATERIALIZED VIEW CONCURRENTLY mcp_category_summary_by_country`);
    if (!summaryRefresh || !countrySummaryRefresh) return;

    for (const country of CATEGORY_REFRESH_COUNTRIES) {
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
      await redis.set(`categories_mcp:top100:${country}`, JSON.stringify(data), 'EX', 600).catch(() => {});
    }
    console.log('[category-refresh] materialized views and Redis caches refreshed.');
  } finally {
    await resetSessionTimeouts(client).catch(() => {});
    client.release();
  }
}
