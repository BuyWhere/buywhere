import { db, redis } from '../config';

export async function warmupMcpCaches(): Promise<void> {
  const client = await db.connect();
  try {
    await client.query('SET statement_timeout = 360000'); // 6 minutes

    // Ensure discount_pct generated column exists
    const hasCol = await client.query(
      `SELECT 1 FROM information_schema.columns WHERE table_name='products' AND column_name='discount_pct' LIMIT 1`
    );
    if (hasCol.rows.length === 0) {
      console.log('[mcp-warmup] Adding discount_pct column...');
      await client.query(`
        ALTER TABLE products ADD COLUMN IF NOT EXISTS discount_pct NUMERIC
          GENERATED ALWAYS AS (
            ROUND((1 - price / NULLIF((metadata->>'original_price')::NUMERIC, 0)) * 100)
          ) STORED
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_products_deals ON products(currency, discount_pct DESC)
          WHERE discount_pct IS NOT NULL
      `);
      console.log('[mcp-warmup] discount_pct column and index created.');
    }

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
