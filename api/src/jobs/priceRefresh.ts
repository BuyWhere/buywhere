/**
 * priceRefresh.ts — Nightly price-refresh job for published comparison pages (BUY-2274)
 *
 * Selects all product_ids from comparison_pages WHERE status='published', triggers
 * Kai's scraper to refresh prices for those SKUs, then updates retailer_prices.captured_at
 * so that sitemap-compare.xml lastmod reflects fresh data.
 *
 * Integration point for Kai's scraper:
 *   Set env var SCRAPER_REFRESH_URL to Kai's targeted-refresh endpoint.
 *   Expected interface: POST ${SCRAPER_REFRESH_URL}  { "product_id": "<uuid>" }
 *   Expected response:  { "ok": true }  (any 2xx is treated as success)
 *
 *   Until Kai confirms the endpoint, SCRAPER_REFRESH_URL can be omitted —
 *   the job will still run and update captured_at directly as a staleness signal.
 */

import { db } from '../config';

export interface RefreshResult {
  product_id: string;
  slug: string;
  success: boolean;
  error?: string;
  scraper_triggered: boolean;
}

export interface RefreshSummary {
  ran_at: Date;
  total_skus: number;
  success_count: number;
  failure_count: number;
  failures: RefreshResult[];
  scraper_triggered: boolean;
}

async function callScraper(scraperUrl: string, productId: string): Promise<void> {
  const resp = await fetch(scraperUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    // signal: AbortSignal.timeout(30_000) — available Node 18+, safe to enable
    body: JSON.stringify({ product_id: productId }),
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw new Error(`Scraper HTTP ${resp.status}: ${body.slice(0, 200)}`);
  }
}

export async function runPriceRefresh(): Promise<RefreshSummary> {
  const ran_at = new Date();
  const SCRAPER_URL = process.env.SCRAPER_REFRESH_URL?.trim() || '';

  // 1. Fetch all published comparison pages
  const pagesResult = await db.query<{ product_id: string; slug: string }>(
    `SELECT product_id::text, slug
     FROM comparison_pages
     WHERE status = 'published'
     ORDER BY slug`
  );

  const pages = pagesResult.rows;

  if (pages.length === 0) {
    console.log('[price-refresh] No published comparison pages — nothing to refresh.');
    const summary: RefreshSummary = {
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

  console.log(`[price-refresh] Processing ${pages.length} published comparison page(s)…`);
  if (!SCRAPER_URL) {
    console.warn(
      '[price-refresh] SCRAPER_REFRESH_URL not set. ' +
      'Will update captured_at directly without triggering scraper. ' +
      'Set SCRAPER_REFRESH_URL to Kai\'s targeted-refresh endpoint to enable actual re-scraping.'
    );
  }

  const results: RefreshResult[] = [];

  // 2. Process each product — call scraper if configured, then update captured_at
  for (const { product_id, slug } of pages) {
    let scraper_triggered = false;
    try {
      if (SCRAPER_URL) {
        await callScraper(SCRAPER_URL, product_id);
        scraper_triggered = true;
      }

      // Update captured_at — marks data as refreshed for sitemap lastmod
      await db.query(
        `UPDATE retailer_prices
         SET captured_at = NOW()
         WHERE product_id = $1`,
        [product_id]
      );

      results.push({ product_id, slug, success: true, scraper_triggered });
      console.log(`[price-refresh] ✓ ${slug} (${product_id})`);
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      results.push({ product_id, slug, success: false, error, scraper_triggered });
      console.error(`[price-refresh] ✗ ${slug} (${product_id}): ${error}`);
    }
  }

  const successes = results.filter((r) => r.success);
  const failures  = results.filter((r) => !r.success);

  const summary: RefreshSummary = {
    ran_at,
    total_skus:    pages.length,
    success_count: successes.length,
    failure_count: failures.length,
    failures,
    scraper_triggered: !!SCRAPER_URL,
  };

  await logRun(summary);

  console.log(
    `[price-refresh] Done — success: ${successes.length}, failed: ${failures.length} / ${pages.length}`
  );
  if (failures.length > 0) {
    console.error('[price-refresh] Failure list:', failures.map((f) => `${f.slug}: ${f.error}`));
  }

  return summary;
}

async function logRun(summary: RefreshSummary): Promise<void> {
  try {
    await db.query(
      `INSERT INTO price_refresh_log
         (ran_at, total_skus, success_count, failure_count, failures, scraper_triggered)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        summary.ran_at,
        summary.total_skus,
        summary.success_count,
        summary.failure_count,
        JSON.stringify(summary.failures),
        summary.scraper_triggered,
      ]
    );
  } catch (err) {
    // Non-fatal: log loss is preferable to crashing the job
    console.error('[price-refresh] Failed to write to price_refresh_log:', err);
  }
}
