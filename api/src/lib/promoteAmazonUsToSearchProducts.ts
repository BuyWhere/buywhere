import type { Pool } from 'pg';

/**
 * BUY-79109 / BUY-80070: promote Keepa amazon_us products into search_products.
 *
 * Hash ids sit near 2^63 — never coerce through Number (precision loss).
 * GIN idx_sp_fts can stall; callers fire-and-forget. Batches of 1–5 with a
 * 25s statement_timeout; skip the chunk on timeout rather than stall ingest.
 *
 * Keepa writes products via /root/keepa_acquire.py (NOT POST /v1/ingest).
 * That path is covered by the DB trigger in
 * migrations/2026-09-02-buy-80070-keepa-search-products-sink.sql.
 * This helper is the /v1/ingest path so both share one INSERT shape.
 */
export const SEARCH_PRODUCTS_SINK_SOURCES = new Set(['amazon_us']);

export const SEARCH_PRODUCTS_SINK_BATCH = Math.max(
  1,
  Math.min(5, parseInt(process.env.SEARCH_PRODUCTS_SINK_BATCH || '5', 10) || 5),
);

export const SEARCH_PRODUCTS_SINK_SQL = `INSERT INTO search_products (
            id, sku, source, merchant_id, title, brand, category,
            description_short, price, currency, discount_pct, in_stock,
            image_url, url, country_code, region, gtin, mpn,
            canonical_id, avg_rating, review_count, updated_at, promoted_at
         )
         SELECT
            p.id, p.sku, p.source, p.merchant_id, p.title, p.brand, p.category,
            LEFT(p.description, 500), p.price, p.currency, p.discount_pct, p.in_stock,
            p.image_url, p.url, p.country_code, p.region, p.gtin, p.mpn,
            p.canonical_id, p.avg_rating, p.review_count, p.updated_at, now()
         FROM products p
         WHERE p.id = ANY($1::bigint[])
           AND p.source = 'amazon_us'
           AND p.is_active = true
           AND p.price IS NOT NULL AND p.price > 0
         ON CONFLICT (id) DO NOTHING`;

export async function promoteAmazonUsToSearchProducts(
  db: Pool,
  productIds: Array<number | string>,
): Promise<void> {
  const unique = [...new Set(
    productIds
      .map((id) => String(id))
      .filter((id) => /^\d+$/.test(id) && id !== '0'),
  )];
  if (unique.length === 0) return;
  for (let i = 0; i < unique.length; i += SEARCH_PRODUCTS_SINK_BATCH) {
    const chunk = unique.slice(i, i + SEARCH_PRODUCTS_SINK_BATCH);
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL application_name = 'crate-search-products-sink'");
      await client.query("SET LOCAL statement_timeout = '25s'");
      await client.query(SEARCH_PRODUCTS_SINK_SQL, [chunk]);
      await client.query('COMMIT');
    } catch (err) {
      try { await client.query('ROLLBACK'); } catch { /* ignore */ }
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[ingest] crate-search-products-sink skip ${chunk.length} ids: ${message}`);
    } finally {
      client.release();
    }
  }
}
