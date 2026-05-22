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

    // Pre-warm list_categories cache
    const cacheKey = 'categories_mcp:top100';
    const existingCache = await redis.get(cacheKey).catch(() => null);
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
      const data = {
        data: result.rows,
        meta: { total: result.rows.length, response_time_ms: Date.now() - t0, cached: false },
      };
      await redis.set(cacheKey, JSON.stringify(data), 'EX', 86400).catch(() => {});
      console.log(`[mcp-warmup] list_categories cached (${result.rows.length} categories, ${Date.now() - t0}ms).`);
    } else {
      console.log('[mcp-warmup] list_categories cache already warm.');
    }
  } finally {
    client.release();
  }
}
