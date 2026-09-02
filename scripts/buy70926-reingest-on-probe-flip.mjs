#!/usr/bin/env node
/**
 * BUY-70926: Re-ingest handoff consumer for dead→ok probe flips.
 *
 * Parent spec: BUY-70776. The outbound-link probe (Cart) inserts a row into
 * `merchant_adapter_recheck_queue` whenever a product's `url_status` flips
 * from 'dead' (or 'transient') back to 'ok'. This script is the thin consumer
 * that:
 *
 *   1. Polls `merchant_adapter_recheck_queue` for unprocessed rows.
 *   2. Applies a 3+ flips/24h quarantine rule to flaky products.
 *   3. Surgically updates `products.url` from the queue row (this is the
 *      working URL the probe verified; "canonical URL rewrite" in the spec).
 *   4. Marks each queue row processed.
 *   5. BUY-70782 item 3: if a BUY-52807 adapter merchant has been marked
 *      'dead-merchant' (or scrape_error dead) for >7 days, quarantine its
 *      remaining `url_status='dead'` product rows so the probe worker does
 *      not retry them forever.
 *
 * BUY-52807 owns merchant-adapter mapping and full re-ingest. We do NOT
 * duplicate adapter dispatch here — once the URL is corrected, the next
 * scheduled scrape in the canonical ingest lane re-encounters the product
 * and refreshes price/title/image. This satisfies the "thin consumer" rule
 * in the BUY-70926 spec. BUY-70782 is the Oracle ownership wrapper around
 * this same consumer (adapter coverage + death-monitor).
 *
 * Usage:
 *   node scripts/buy70926-reingest-on-probe-flip.mjs [--dry-run] [--batch-size N]
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
const DEAD_MERCHANT_QUARANTINE_DAYS = 7;

// BUY-70782 item 2: BUY-52807-affected merchants that must stay on the
// adapter map so a dead→ok flip is attributed (URL rewrite still happens
// even when the key is missing; this map is for coverage + death-monitor).
const ADAPTER_MAP = {
  decathlon_sg: { platform: 'decathlon.sg', note: 'BUY-55661 / BUY-70776 repro' },
  'decathlon.sg': { platform: 'decathlon.sg', note: 'domain-id alias' },
  robinsons_com_sg: { platform: 'robinsons.com.sg', note: 'BUY-52807 / BUY-70776 repro' },
  'robinsons.com.sg': { platform: 'robinsons.com.sg', note: 'domain-id alias' },
  fairprice_sg: { platform: 'fairprice_sg' },
  giant_sg: { platform: 'giant_sg' },
  guardian_sg: { platform: 'guardian_sg' },
  harvey_norman_sg: { platform: 'harvey_norman_sg' },
};

function resolveAdapterKey(merchantId) {
  if (!merchantId) return null;
  if (ADAPTER_MAP[merchantId]) return merchantId;
  const slug = String(merchantId)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
  if (ADAPTER_MAP[slug]) return slug;
  const lower = String(merchantId).toLowerCase();
  if (lower.includes('robinsons.com.sg') || lower === 'robinsons_com_sg') {
    return 'robinsons.com.sg';
  }
  if (lower.includes('decathlon.sg') || lower === 'decathlon_sg') {
    return 'decathlon_sg';
  }
  return null;
}

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
 * Mark a queue row as quarantined (flaky product — too many flips).
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
 * Surgically update the product URL if the probe discovered a new canonical URL.
 * Returns 1 if the URL was updated, 0 otherwise.
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
 * BUY-70782 item 3: merchants marked dead for >7 days → quarantine remaining
 * dead product URLs so the outbound probe stops retrying them.
 *
 * Match on merchants.id OR merchants.domain against the adapter map (ids are
 * mixed slug/domain/uuid). scrape_error matching is ILIKE '%dead-merchant%'
 * OR ILIKE 'dead' — 0 rows currently use the exact token, but http-403 on
 * decathlon_sg is NOT treated as merchant-death (that's a scrape block, not
 * a closed store).
 */
async function applyDeadMerchantQuarantine(client) {
  const adapterKeys = Object.keys(ADAPTER_MAP);
  const adapterPlatforms = [
    ...new Set(
      Object.values(ADAPTER_MAP)
        .map((a) => a.platform)
        .filter(Boolean)
    ),
  ];

  const candidatesSql = `
    SELECT id, scrape_error, updated_at
      FROM merchants
     WHERE (id = ANY($2::text[]) OR domain = ANY($3::text[]))
       AND scrape_error ILIKE '%dead-merchant%'
       AND updated_at < NOW() - ($1 || ' days')::interval
  `;

  if (DRY_RUN) {
    const r = await client.query(candidatesSql, [
      DEAD_MERCHANT_QUARANTINE_DAYS,
      adapterKeys,
      adapterPlatforms,
    ]);
    console.log(
      `  [DRY-RUN] Would scan ${r.rows.length} adapter dead-merchant(s) (>${DEAD_MERCHANT_QUARANTINE_DAYS}d)`
    );
    return { scanned: r.rows.length, quarantined: 0 };
  }

  const candidates = await client.query(candidatesSql, [
    DEAD_MERCHANT_QUARANTINE_DAYS,
    adapterKeys,
    adapterPlatforms,
  ]);

  let quarantined = 0;
  for (const row of candidates.rows) {
    const r = await client.query(
      `UPDATE products
          SET url_status = 'quarantined',
              updated_at = NOW()
        WHERE merchant_id = $1
          AND url_status = 'dead'
        RETURNING id`,
      [row.id]
    );
    if (r.rowCount > 0) {
      quarantined += r.rowCount;
      console.log(
        `  [BUY-70782] Quarantined ${r.rowCount} dead products for merchant ${row.id} (>${DEAD_MERCHANT_QUARANTINE_DAYS}d dead)`
      );
    }
  }

  return { scanned: candidates.rows.length, quarantined };
}

/**
 * Main polling loop.
 */
async function main() {
  console.log('[BUY-70926/BUY-70782] Re-ingest handoff consumer starting...');
  console.log(`  Dry run: ${DRY_RUN}`);
  console.log(`  Batch size: ${BATCH_SIZE}`);
  console.log(`  Adapter map size: ${Object.keys(ADAPTER_MAP).length}`);

  const dbUrl = resolveCatalogDbUrl({ stripSslmode: true });
  const pool = new pg.Pool({
    connectionString: dbUrl,
    ssl: { rejectUnauthorized: false },
    max: 2,
    idleTimeoutMillis: 30000,
    statement_timeout: 30000,
  });

  const client = await pool.connect();
  const processedBy = process.env.PAPERCLIP_RUN_ID || `oracle-buy70926-${Date.now()}`;

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
      console.log('[BUY-70926] merchant_adapter_recheck_queue does not exist yet.');
      console.log('[BUY-70926] BUY-70932 must ship the queue trigger first.');
      return;
    }

    const pending = await fetchPendingQueueRows(client);

    if (pending.length === 0) {
      console.log('[BUY-70926] No pending recheck rows');
    } else {
    console.log(`[BUY-70926] Processing ${pending.length} pending recheck row(s)`);
    let urlUpdatedCount = 0;
    let quarantinedCount = 0;

    for (const row of pending) {
      console.log(
        `\n[BUY-70926] Row ${row.id}: product ${row.product_id} ` +
          `${row.old_status} -> ${row.new_status} at ${row.detected_at.toISOString()}`
      );

      // Quarantine check: 3+ dead->ok flips in 24h for this product.
      const otherRecentFlips = await countRecentFlips(client, row.product_id, row.id);
      const totalFlips = otherRecentFlips + 1; // include current row
      if (totalFlips >= QUARANTINE_FLIP_THRESHOLD) {
        const reason = `${totalFlips} dead->ok flips in ${QUARANTINE_WINDOW_HOURS}h ` +
          `(threshold ${QUARANTINE_FLIP_THRESHOLD})`;
        console.log(`  [BUY-70926] QUARANTINE ${row.product_id}: ${reason}`);
        await quarantineRow(client, row.id, reason);
        quarantinedCount++;
        continue;
      }

      // Surgically update the product URL. BUY-52807 ingest pipeline will pick
      // up the corrected URL on the next scheduled scrape of this merchant.
      const urlUpdated = await updateProductUrl(client, row.product_id, row.url);
      if (urlUpdated > 0) {
        console.log(`  [BUY-70926] Updated product ${row.product_id} URL (${urlUpdated} row)`);
        urlUpdatedCount++;
      } else {
        console.log(`  [BUY-70926] Product ${row.product_id} URL unchanged`);
      }

      const adapterKey = resolveAdapterKey(row.merchant_id);
      if (adapterKey) {
        console.log(`  [BUY-70782] Adapter coverage: ${row.merchant_id} -> ${adapterKey}`);
      } else {
        console.log(`  [BUY-70782] No adapter mapping for merchant ${row.merchant_id}; URL rewrite still applied`);
      }

      await markProcessed(client, row.id, adapterKey ? 'success' : 'no_adapter', processedBy);
    }

    console.log('\n[BUY-70926] Queue pass done');
    console.log(`  Processed: ${pending.length}`);
    console.log(`  URL updates: ${urlUpdatedCount}`);
    console.log(`  Quarantined: ${quarantinedCount}`);
    } // end pending.length > 0

    console.log('\n[BUY-70782] Running dead-merchant quarantine sweep (>7d)...');
    const summary = await applyDeadMerchantQuarantine(client);
    console.log(
      `[BUY-70782] Dead-merchant sweep: scanned=${summary.scanned}, quarantined=${summary.quarantined}`
    );
    console.log('\n[BUY-70926/BUY-70782] Done');
  } finally {
    await client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('[BUY-70926] Error:', err);
  process.exit(1);
});