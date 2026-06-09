import { db, redis } from '../config';

export async function warmupMcpCaches(): Promise<void> {
  const client = await db.connect();
  try {
    await client.query('SET statement_timeout = 360000'); // 6 minutes

    // BUY-22324: Ensure discount_pct is a GENERATED STORED column (not plain).
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
    }
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_products_deals_discount_pct
        ON products (currency, discount_pct DESC)
        WHERE discount_pct IS NOT NULL AND price > 0
    `);
    console.log('[mcp-warmup] discount_pct column and index verified.');

    // BUY-21057: Use MATERIALIZED VIEW so pg_cron/pgAgent can refresh it on a schedule,
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
    await client.query(`
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

    // Check if materialized view has data (REFRESH is fast; initial population may be slow)
    const summaryCount = await client.query(`SELECT COUNT(*) AS cnt FROM mcp_category_summary`);
    const summaryHasData = parseInt(summaryCount.rows[0].cnt, 10) > 0;
    const countrySummaryCount = await client.query(`SELECT COUNT(*) AS cnt FROM mcp_category_summary_by_country`);
    const countrySummaryHasData = parseInt(countrySummaryCount.rows[0].cnt, 10) > 0;

    if (summaryHasData) {
      await client.query(`REFRESH MATERIALIZED VIEW mcp_category_summary`);
    }
    if (countrySummaryHasData) {
      await client.query(`REFRESH MATERIALIZED VIEW mcp_category_summary_by_country`);
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
      await redis.set(cacheKey, JSON.stringify(data), 'EX', 86400).catch(() => {});
      console.log(`[mcp-warmup] list_categories ${country} cached (${result.rows.length} categories, ${Date.now() - t0}ms).`);
    }
  } finally {
    client.release();
  }
}
