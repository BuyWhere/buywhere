"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.warmupMcpCaches = warmupMcpCaches;
exports.refreshCategorySummaries = refreshCategorySummaries;
const config_1 = require("../config");
async function warmupMcpCaches() {
    const client = await config_1.db.connect();
    try {
        await client.query('SET statement_timeout = 360000'); // 6 minutes
        // BUY-22324: Ensure discount_pct is a GENERATED STORED column (not plain).
        const colInfo = await client.query(`SELECT is_generated FROM information_schema.columns WHERE table_name='products' AND column_name='discount_pct'`);
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
        }
        else if (colInfo.rows[0].is_generated === 'NEVER') {
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
        // BUY-58273: correct shape — must match the production index definition exactly.
        await client.query(`
      CREATE INDEX IF NOT EXISTS idx_products_deals_discount_pct
        ON products (discount_pct)
        WHERE discount_pct > 0
    `);
        // BUY-56635: country-aware deals index. The plain (currency, discount_pct DESC)
        // index is not used when the MCP deals query also filters by country_code;
        // the planner falls back to a seq scan on 14M rows and the 15s statement_timeout
        // fires, surfacing as -32603 to Tune. A partial index keyed on
        // (currency, country_code, discount_pct DESC) lets the planner satisfy all three
        // predicates from the index alone.
        await client.query(`
      CREATE INDEX IF NOT EXISTS idx_products_deals_country
        ON products (currency, country_code, discount_pct DESC)
        WHERE discount_pct IS NOT NULL AND price > 0 AND is_active = true
          AND country_code IS NOT NULL
    `);
        console.log('[mcp-warmup] discount_pct column and indexes verified.');
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
        WHERE country_code IS NOT NULL
          AND category_path[1] IS NOT NULL
        GROUP BY country_code, category_path[1]
        ORDER BY country_code, product_count DESC
    `);
        await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS mcp_category_summary_by_country_pk_idx
        ON mcp_category_summary_by_country (country_code, slug)
    `);
        // Check if materialized view has data (REFRESH is fast; initial population may be slow)
        const summaryCount = await client.query(`SELECT COUNT(*) AS cnt FROM mcp_category_summary`);
        const summaryHasData = parseInt(summaryCount.rows[0].cnt, 10) > 0;
        const countrySummaryCount = await client.query(`SELECT COUNT(*) AS cnt FROM mcp_category_summary_by_country`);
        const countrySummaryHasData = parseInt(countrySummaryCount.rows[0].cnt, 10) > 0;
        if (summaryHasData) {
            await client.query(`REFRESH MATERIALIZED VIEW CONCURRENTLY mcp_category_summary`);
        }
        if (countrySummaryHasData) {
            await client.query(`REFRESH MATERIALIZED VIEW CONCURRENTLY mcp_category_summary_by_country`);
        }
        for (const country of ['SG', 'US', 'VN', 'TH', 'MY']) {
            const cacheKey = `categories_mcp:top100:${country}`;
            const existingCache = await config_1.redis.get(cacheKey).catch(() => null);
            if (existingCache && countrySummaryHasData)
                continue;
            console.log(`[mcp-warmup] Pre-warming list_categories cache for ${country}...`);
            const t0 = Date.now();
            const result = await client.query(`SELECT slug, name, product_count
         FROM mcp_category_summary_by_country
         WHERE country_code = $1
         ORDER BY product_count DESC
         LIMIT 100`, [country]);
            const data = {
                data: result.rows,
                meta: { total: result.rows.length, country_code: country, response_time_ms: Date.now() - t0, cached: false },
            };
            await config_1.redis.set(cacheKey, JSON.stringify(data), 'EX', 600).catch(() => { }); // 10 min TTL
            console.log(`[mcp-warmup] list_categories ${country} cached (${result.rows.length} categories, ${Date.now() - t0}ms).`);
        }
        // BUY-57749: also warm deals cache for all partitions
        await warmupDealsCache();
    }
    finally {
        client.release();
    }
}
// BUY-57749: Pre-warm deals_mcp cache for all country partitions.
// Iterates each partition's top deals and caches them so the first real
// get_deals call for any country returns instantly from Redis instead of
// triggering a slow partition scan.
async function warmupDealsCache() {
    const client = await config_1.db.connect();
    try {
        await client.query('SET statement_timeout = 120000'); // 2 min per country
        // Iterate all partitions via pg_inherits to match BUY-57738's index-build approach.
        const partitions = await client.query(`SELECT inhrelid::regclass::text AS partition_name
       FROM pg_inherits
       WHERE inhparent = 'products'::regclass
       ORDER BY inhrelid::regclass`);
        for (const row of partitions.rows) {
            const partitionName = row.partition_name; // e.g. products_us, products_sg
            // Derive country code from partition name suffix: products_us -> US
            const countryCode = partitionName.replace('products_', '').toUpperCase();
            console.log(`[mcp-warmup] Pre-warming deals cache for ${countryCode} (${partitionName})...`);
            const t0 = Date.now();
            // For each currency in this partition, cache the top 20 deals.
            const currencies = ['SGD', 'USD', 'VND', 'THB', 'MYR', 'PHP', 'IDR', 'GBP'];
            for (const currency of currencies) {
                const cacheKey = `deals_mcp:${currency}:10::${countryCode}:20:0`;
                const existingCache = await config_1.redis.get(cacheKey).catch(() => null);
                if (existingCache)
                    continue; // already warm
                try {
                    const result = await client.query(`SELECT id, sku AS source, source AS domain, url, title,
                    price,
                    CASE WHEN metadata->>'original_price' ~ '^[0-9]+(\\.[0-9]+)?$'
                         THEN (metadata->>'original_price')::numeric ELSE NULL END AS original_price,
                    currency, image_url, metadata, updated_at, region, country_code,
                    discount_pct
             FROM ${partitionName}
             WHERE currency = $1
               AND discount_pct >= 10
               AND price > 0
               AND is_active = true
             ORDER BY discount_pct DESC
             LIMIT 20`, [currency]);
                    if (result.rows.length > 0) {
                        const total = result.rows.length;
                        const response = {
                            results: result.rows,
                            total,
                            limit: 20,
                            offset: 0,
                            response_time_ms: Date.now() - t0,
                        };
                        await config_1.redis.set(cacheKey, JSON.stringify(response), 'EX', 300).catch(() => { });
                    }
                }
                catch (err) {
                    console.warn(`[mcp-warmup] Failed to warm deals cache for ${currency}/${countryCode}:`, err);
                }
            }
            console.log(`[mcp-warmup] Deals cache for ${countryCode} warmed in ${Date.now() - t0}ms.`);
        }
    }
    finally {
        client.release();
    }
}
const CATEGORY_REFRESH_COUNTRIES = ['SG', 'US', 'VN', 'TH', 'MY'];
// Lightweight periodic refresh — called every 5 min from index.ts.
// Uses CONCURRENTLY so reads are never blocked during the refresh.
async function refreshCategorySummaries() {
    const client = await config_1.db.connect();
    try {
        const viewCheck = await client.query(`SELECT to_regclass('public.mcp_category_summary_by_country') AS tbl`);
        if (!viewCheck.rows[0]?.tbl)
            return; // view not yet created; warmup will handle it on next deploy
        await client.query(`REFRESH MATERIALIZED VIEW CONCURRENTLY mcp_category_summary`);
        await client.query(`REFRESH MATERIALIZED VIEW CONCURRENTLY mcp_category_summary_by_country`);
        for (const country of CATEGORY_REFRESH_COUNTRIES) {
            const t0 = Date.now();
            const result = await client.query(`SELECT slug, name, product_count
         FROM mcp_category_summary_by_country
         WHERE country_code = $1
         ORDER BY product_count DESC
         LIMIT 100`, [country]);
            const data = {
                data: result.rows,
                meta: { total: result.rows.length, country_code: country, response_time_ms: Date.now() - t0, cached: false },
            };
            await config_1.redis.set(`categories_mcp:top100:${country}`, JSON.stringify(data), 'EX', 600).catch(() => { });
        }
        console.log('[category-refresh] materialized views and Redis caches refreshed.');
    }
    finally {
        client.release();
    }
}
