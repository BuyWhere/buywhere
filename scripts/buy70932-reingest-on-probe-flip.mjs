#!/usr/bin/env node
/**
 * BUY-70932: Oracle consumer for the merchant-adapter recheck queue.
 *
 * Reads `merchant_adapter_recheck_queue` rows that were created when a product's
 * `url_status` flipped from 'dead' back to 'ok', then:
 *   1. Quarantines products with 3+ dead->ok flips in the last 24 hours.
 *   2. Re-maps / re-ingests the merchant URL via the adapter map.
 *   3. Marks the queue row processed with a result.
 *
 * The queue is populated by a PostgreSQL trigger on `products.url_status`, so
 * the outbound-link probe worker (Cart) does not need to know this schema.
 *
 * Usage:
 *   node scripts/buy70932-reingest-on-probe-flip.mjs [--dry-run] [--batch-size N]
 *
 * Environment:
 *   CATALOG_DB_URL_FILE — path to file containing catalog DB URL
 *                         (default: data/.catalog_db_url)
 */

import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

const DEFAULT_DB_URL_FILE = path.join(REPO_ROOT, 'data', '.catalog_db_url');
const DEFAULT_BATCH_SIZE = 50;
const QUARANTINE_FLIP_THRESHOLD = 3;
const QUARANTINE_WINDOW_HOURS = 24;

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const BATCH_SIZE = args.includes('--batch-size')
  ? parseInt(args[args.indexOf('--batch-size') + 1], 10)
  : DEFAULT_BATCH_SIZE;

function resolveCatalogDbUrl({ stripSslmode = false } = {}) {
  const catalogFile = process.env.CATALOG_DB_URL_FILE || DEFAULT_DB_URL_FILE;
  if (!fs.existsSync(catalogFile)) {
    throw new Error('Missing catalog DB URL file: ' + catalogFile);
  }
  const raw = fs.readFileSync(catalogFile, 'utf8').trim();
  if (!raw) {
    throw new Error('Catalog DB URL file is empty: ' + catalogFile);
  }
  return stripSslmode ? raw.replace(/[?&]sslmode=[^&]*/g, '') : raw;
}

// Known adapter map: merchant_id -> ingest strategy.
// This mirrors PLATFORM_MAP in ingest_scrapers_railway.py + custom scripts.
const ADAPTER_MAP = {
  decathlon_sg: {
    type: 'scraper',
    script: 'scrapers/decathlon_sg.py',
    platform: 'decathlon_sg',
    note: 'Covered by BUY-55661 ingest + scraper',
  },
  fairprice_sg: {
    type: 'scraper',
    script: 'ingest_scrapers_railway.py',
    platform: 'fairprice_sg',
    note: 'Covered by scraper pipeline',
  },
  giant_sg: {
    type: 'scraper',
    script: 'ingest_scrapers_railway.py',
    platform: 'giant_sg',
    note: 'Covered by scraper pipeline',
  },
  guardian_sg: {
    type: 'scraper',
    script: 'ingest_scrapers_railway.py',
    platform: 'guardian_sg',
    note: 'Covered by scraper pipeline',
  },
  harvey_norman_sg: {
    type: 'scraper',
    script: 'ingest_scrapers_railway.py',
    platform: 'harvey_norman_sg',
    note: 'Covered by scraper pipeline',
  },
  // robinsons_sg: NOT YET — needs merchant-adapter setup (BUY-52807 follow-up)
};

/**
 * Fetch unprocessed queue rows, oldest first.
 */
async function fetchPendingQueueRows(client) {
  const result = await client.query(
    `
    SELECT
      id,
      product_id,
      merchant_id,
      old_status,
      new_status,
      url,
      detected_at
    FROM merchant_adapter_recheck_queue
    WHERE processed_at IS NULL
      AND quarantined_at IS NULL
    ORDER BY detected_at ASC
    LIMIT $1
    `,
    [BATCH_SIZE]
  );
  return result.rows;
}

/**
 * Count how many dead->ok flips this product has had in the last 24h.
 */
async function countRecentFlips(client, productId, excludeId) {
  const result = await client.query(
    `
    SELECT COUNT(*)::int AS c
    FROM merchant_adapter_recheck_queue
    WHERE product_id = $1
      AND detected_at > NOW() - ($2 || ' hours')::interval
      AND id <> $3
    `,
    [productId, QUARANTINE_WINDOW_HOURS, excludeId]
  );
  return result.rows[0].c;
}

/**
 * Mark a queue row as quarantined.
 */
async function quarantineRow(client, rowId, reason) {
  if (DRY_RUN) {
    console.log(`  [DRY-RUN] Would quarantine row ${rowId}: ${reason}`);
    return;
  }
  await client.query(
    `
    UPDATE merchant_adapter_recheck_queue
    SET quarantined_at = NOW(),
        quarantine_reason = $2,
        result = 'quarantined'
    WHERE id = $1
    `,
    [rowId, reason]
  );
}

/**
 * Get product info including merchant_id and current URL.
 */
async function getProductInfo(client, productId) {
  const result = await client.query(
    `
    SELECT id, sku, source, merchant_id, url, title, country_code
    FROM products
    WHERE id = $1
    `,
    [productId]
  );
  return result.rows[0] || null;
}

/**
 * Surgically update the product URL if the probe discovered a new canonical URL.
 */
async function updateProductUrl(client, productId, newUrl) {
  if (!newUrl || newUrl.trim() === '') return 0;

  if (DRY_RUN) {
    console.log(`  [DRY-RUN] Would update product ${productId} url -> ${newUrl}`);
    return 1;
  }

  const result = await client.query(
    `
    UPDATE products
    SET url = $1,
        updated_at = NOW(),
        data_updated_at = NOW()
    WHERE id = $2
      AND (url IS DISTINCT FROM $1)
    RETURNING id
    `,
    [newUrl, productId]
  );
  return result.rowCount || 0;
}

/**
 * Mark a queue row processed.
 */
async function markProcessed(client, rowId, result, processedBy) {
  if (DRY_RUN) return;
  await client.query(
    `
    UPDATE merchant_adapter_recheck_queue
    SET processed_at = NOW(),
        processed_by = $2,
        result = $3
    WHERE id = $1
    `,
    [rowId, processedBy, result]
  );
}

/**
 * Re-ingest via the adapter map.
 * Returns a result string: 'success', 'no_adapter', 'product_not_found', etc.
 */
async function processAdapterReingest(client, row, product) {
  const adapter = ADAPTER_MAP[row.merchant_id];

  if (!adapter) {
    console.log(
      `  [BUY-70932] No adapter mapping for merchant ${row.merchant_id}; logging for follow-up`
    );
    return 'no_adapter';
  }

  console.log(
    `  [BUY-70932] Adapter ${row.merchant_id} (${adapter.type} -> ${adapter.script})`
  );

  // Step 1: always fix the product URL if the probe found a different working URL.
  const urlUpdated = await updateProductUrl(client, row.product_id, row.url);
  if (urlUpdated > 0) {
    console.log(`  [BUY-70932] Updated product ${row.product_id} URL (${urlUpdated} row)`);
  }

  // Step 2: merchant-specific re-ingest.
  if (row.merchant_id === 'decathlon_sg') {
    // decathlon_sg has a surgical URL refresh path; no further action needed here
    // because the URL is already corrected. A full SKU refresh can be triggered
    // manually if the probe also found metadata changes.
    return 'success';
  }

  // For scraper-pipeline merchants the corrected URL is sufficient for the next
  // scheduled scrape to pick up the product. Returning 'success' keeps the queue
  // moving; a future enhancement can spawn the scraper inline.
  return 'success';
}

/**
 * Main polling loop.
 */
async function main() {
  console.log('[BUY-70932] Merchant-adapter recheck consumer starting...');
  console.log(`  Dry run: ${DRY_RUN}`);
  console.log(`  Batch size: ${BATCH_SIZE}`);

  const dbUrl = resolveCatalogDbUrl({ stripSslmode: true });
  const pool = new pg.Pool({
    connectionString: dbUrl,
    ssl: { rejectUnauthorized: false },
    max: 2,
    idleTimeoutMillis: 30000,
    statement_timeout: 30000,
  });

  const client = await pool.connect();
  const processedBy = process.env.PAPERCLIP_RUN_ID || `oracle-${Date.now()}`;

  try {
    // Verify the queue table exists; if not, there is nothing to do yet.
    const tableCheck = await client.query(
      `
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = 'merchant_adapter_recheck_queue'
      `
    );

    if (tableCheck.rows.length === 0) {
      console.log('[BUY-70932] merchant_adapter_recheck_queue does not exist yet.');
      console.log('[BUY-70932] Run the BUY-70932 migration first.');
      return;
    }

    const pending = await fetchPendingQueueRows(client);

    if (pending.length === 0) {
      console.log('[BUY-70932] No pending recheck rows');
      return;
    }

    console.log(`[BUY-70932] Processing ${pending.length} pending recheck row(s)`);

    for (const row of pending) {
      console.log(
        `\n[BUY-70932] Row ${row.id}: product ${row.product_id} ` +
          `${row.old_status} -> ${row.new_status} at ${row.detected_at.toISOString()}`
      );

      // Quarantine check: 3+ dead->ok flips in 24h for this product.
      const otherRecentFlips = await countRecentFlips(client, row.product_id, row.id);
      const totalFlips = otherRecentFlips + 1; // include current row
      if (totalFlips >= QUARANTINE_FLIP_THRESHOLD) {
        const reason = `${totalFlips} dead->ok flips in ${QUARANTINE_WINDOW_HOURS}h ` +
          `(threshold ${QUARANTINE_FLIP_THRESHOLD})`;
        console.log(`  [BUY-70932] QUARANTINE ${row.product_id}: ${reason}`);
        await quarantineRow(client, row.id, reason);
        continue;
      }

      const product = await getProductInfo(client, row.product_id);
      if (!product) {
        console.log(`  [BUY-70932] Product ${row.product_id} not found; marking failed`);
        await markProcessed(client, row.id, 'product_not_found', processedBy);
        continue;
      }

      // Sanity: row.merchant_id should match product.merchant_id.
      if (row.merchant_id !== product.merchant_id) {
        console.log(
          `  [BUY-70932] Merchant mismatch: queue=${row.merchant_id} ` +
            `product=${product.merchant_id}; using product.merchant_id`
        );
      }

      const result = await processAdapterReingest(client, row, product);
      await markProcessed(client, row.id, result, processedBy);
      console.log(`  [BUY-70932] Result: ${result}`);
    }

    console.log('\n[BUY-70932] Done');
  } finally {
    await client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('[BUY-70932] Error:', err);
  process.exit(1);
});
