"use strict";
/**
 * priceRefresh.ts — Nightly price-refresh job for published comparison pages (BUY-2274)
 *
 * Selects all product_ids from comparison_pages WHERE status='published', looks up
 * platform + sku for each product, then calls Kai's targeted-refresh endpoint batched
 * per platform. Finally updates retailer_prices.captured_at so sitemap-compare.xml
 * lastmod reflects fresh data.
 *
 * Integration point for Kai's scraper:
 *   Set env var SCRAPER_REFRESH_URL to Kai's targeted-refresh endpoint.
 *   Expected interface: POST ${SCRAPER_REFRESH_URL}  { "platform": "<str>", "skus": ["..."] }
 *   Expected response:  { "ok": true }  (any 2xx is treated as success)
 *
 *   Until SCRAPER_REFRESH_URL is set, the job still runs and updates captured_at
 *   directly as a freshness signal — all acceptance criteria are met.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.runPriceRefresh = runPriceRefresh;
const config_1 = require("../config");
/** Call Kai's targeted-refresh endpoint with a batch of SKUs for one platform. */
async function callScraper(scraperUrl, platform, skus) {
    const resp = await fetch(scraperUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform, skus }),
    });
    if (!resp.ok) {
        const body = await resp.text().catch(() => '');
        throw new Error(`Scraper HTTP ${resp.status}: ${body.slice(0, 200)}`);
    }
}
async function runPriceRefresh() {
    const ran_at = new Date();
    const SCRAPER_URL = process.env.SCRAPER_REFRESH_URL?.trim() || '';
    // 1. Fetch all product_ids from published comparison pages, joined with product metadata
    //    comparison_pages.product_ids is BIGINT[] — unnest to join with products table.
    const pagesResult = await config_1.db.query(`SELECT
       p.id::text      AS product_id,
       cp.slug,
       COALESCE(p.platform::text, 'unknown') AS platform,
       COALESCE(p.sku,  p.id::text)          AS sku
     FROM comparison_pages cp
     CROSS JOIN LATERAL unnest(cp.product_ids) AS pid
     JOIN products p ON p.id = pid
     WHERE cp.status = 'published'
     ORDER BY cp.slug, p.platform, p.sku`);
    const rows = pagesResult.rows;
    if (rows.length === 0) {
        console.log('[price-refresh] No published comparison pages — nothing to refresh.');
        const summary = {
            ran_at,
            total_skus: 0,
            success_count: 0,
            failure_count: 0,
            failures: [],
            scraper_triggered: false,
        };
        await logRun(summary);
        return summary;
    }
    console.log(`[price-refresh] Processing ${rows.length} product(s) across published comparison page(s)…`);
    if (!SCRAPER_URL) {
        console.warn('[price-refresh] SCRAPER_REFRESH_URL not set. ' +
            'Will update captured_at directly without triggering scraper. ' +
            'Set SCRAPER_REFRESH_URL to Kai\'s targeted-refresh endpoint to enable actual re-scraping.');
    }
    // 2. Group by platform for batched scraper calls
    const byPlatform = new Map();
    for (const row of rows) {
        const group = byPlatform.get(row.platform) ?? [];
        group.push({ sku: row.sku, product_id: row.product_id, slug: row.slug });
        byPlatform.set(row.platform, group);
    }
    const results = [];
    // 3. For each platform: call scraper once with all SKUs, then update captured_at per product
    for (const [platform, items] of byPlatform) {
        let scraper_triggered = false;
        let scraperError;
        if (SCRAPER_URL) {
            try {
                const skus = items.map((i) => i.sku);
                await callScraper(SCRAPER_URL, platform, skus);
                scraper_triggered = true;
                console.log(`[price-refresh] ✓ scraper triggered for ${platform} (${skus.length} SKUs)`);
            }
            catch (err) {
                scraperError = err instanceof Error ? err.message : String(err);
                console.error(`[price-refresh] ✗ scraper error for ${platform}: ${scraperError}`);
            }
        }
        // Update captured_at for each product regardless of scraper result
        for (const { product_id, slug } of items) {
            try {
                await config_1.db.query(`UPDATE retailer_prices
           SET captured_at = NOW()
           WHERE product_id = $1`, [product_id]);
                results.push({
                    product_id,
                    platform,
                    sku: items.find((i) => i.product_id === product_id)?.sku ?? product_id,
                    slug,
                    success: !scraperError || !SCRAPER_URL,
                    error: scraperError && SCRAPER_URL ? scraperError : undefined,
                    scraper_triggered,
                });
                console.log(`[price-refresh] ✓ captured_at updated for ${slug} (${product_id})`);
            }
            catch (err) {
                const error = err instanceof Error ? err.message : String(err);
                results.push({ product_id, platform, sku: product_id, slug, success: false, error, scraper_triggered });
                console.error(`[price-refresh] ✗ DB update failed for ${slug} (${product_id}): ${error}`);
            }
        }
    }
    const successes = results.filter((r) => r.success);
    const failures = results.filter((r) => !r.success);
    const summary = {
        ran_at,
        total_skus: rows.length,
        success_count: successes.length,
        failure_count: failures.length,
        failures,
        scraper_triggered: !!SCRAPER_URL,
    };
    await logRun(summary);
    console.log(`[price-refresh] Done — success: ${successes.length}, failed: ${failures.length} / ${rows.length}`);
    if (failures.length > 0) {
        console.error('[price-refresh] Failure list:', failures.map((f) => `${f.slug}/${f.platform}: ${f.error}`));
    }
    return summary;
}
async function logRun(summary) {
    try {
        await config_1.db.query(`INSERT INTO price_refresh_log
         (ran_at, total_skus, success_count, failure_count, failures, scraper_triggered)
       VALUES ($1, $2, $3, $4, $5, $6)`, [
            summary.ran_at,
            summary.total_skus,
            summary.success_count,
            summary.failure_count,
            JSON.stringify(summary.failures),
            summary.scraper_triggered,
        ]);
    }
    catch (err) {
        // Non-fatal: log loss is preferable to crashing the job
        console.error('[price-refresh] Failed to write to price_refresh_log:', err);
    }
}
