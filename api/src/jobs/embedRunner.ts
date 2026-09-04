/**
 * embedRunner.ts — Recurring embedding pipeline scheduler (BUY-76503)
 *
 * BUY-76503: partition sweep replaces the old `ORDER BY updated_at DESC` scan.
 *
 * BUY-76567: switched from Gemini gemini-embedding-001 (512-dim) to
 * Flow AI flow-embed-1 (Qwen3-Embedding-4B, 1024-dim).
 *   - Env var: FLOWAI_EMBED_API_KEY (replaces GEMINI_API_KEY)
 *   - Writes to embedding_v2 column (never touches 512-dim embedding column)
 *   - Startup migration: adds embedding_v2 vector(1024) if missing
 *
 * Key properties:
 *   - Bounded per-tick work: scan is capped at batchLimit rows
 *   - Durable progress: watermark survives worker restarts
 *   - Backfill-capable: eventually reaches every product regardless of updated_at
 *   - Hash gate still applies: unchanged products are skipped per tick
 *
 * Env vars:
 *   FLOWAI_EMBED_API_KEY — required; Flow AI API key for flow-embed-1
 *   FLOWAI_API_BASE      — optional; Flow AI base URL (default: https://api.flowaiapi.com)
 *   VECTOR_DB_URL        — required; PostgreSQL connection for product_embeddings table
 *   REPLICA_DATABASE_URL — required; Replica connection for reading products_partitioned
 *   EMBED_BATCH_LIMIT    — products per tick (default: 100)
 *   EMBED_INTERVAL_MS    — tick interval in ms (default: 6h = 21600000)
 */

import { Pool, PoolClient } from 'pg';
import { db, replicaDb, vectorDb } from '../config';
import { runEmbedBatch } from './embedProducts';

// BUY-76567: Flow AI key replaces Gemini key
const FLOWAI_KEY = process.env.FLOWAI_EMBED_API_KEY ?? '';
const BATCH_LIMIT    = parseInt(process.env.EMBED_BATCH_LIMIT  ?? '100', 10);
const INTERVAL_MS    = parseInt(process.env.EMBED_INTERVAL_MS  ?? String(6 * 60 * 60 * 1000), 10);

// BUY-76503: partition priority order. High-value markets get scanned more
// frequently by appearing multiple times in the list (or could be separate config).
// All 26 active partitions from the catalog DB (2026-08-28).
const PARTITION_ORDER = [
  'US', 'US', 'US',        // 3x — largest catalog, highest SEO value
  'SG', 'SG',               // 2x — second largest
  'AU', 'GB', 'CA',         // 1x each — meaningful catalogs
  'ZA', 'FR', 'NL', 'IT',   // 1x each
  'IN', 'PL', 'SE', 'DE',   // 1x each
  'DK', 'NZ', 'JP', 'BR',   // 1x each
  'PH', 'PK', 'IE', 'UK',   // 1x each
  'MX', 'AE', 'MY', 'ES',   // 1x each
  'SA',                      // smallest
];

// How many consecutive zero-candidate ticks before we consider a partition
// "done" and stop offering it (it will be re-offered after all others cycle).
const STALE_SKIP_THRESHOLD = 3;

// BUY-76567: Flow AI key replaces Gemini key
if (!FLOWAI_KEY) {
  console.error('[embed-runner] FLOWAI_EMBED_API_KEY is not set — embedding is disabled');
  process.exit(0);
}
// A worker that cannot do its job must not exit success — a green deployment
// that embeds nothing is a refusal reporting success (the 09-04 incident: six
// days of SUCCESS status over zero work). exit(1) makes Railway show the
// deployment CRASHED/backing-off: an honest, visible, alarmed state.
if (!vectorDb) {
  console.error('[embed-runner] FATAL: VECTOR_DB_URL is not set — cannot embed');
  process.exit(1);
}
if (!replicaDb) {
  // Cutover (09-04): the read source is SOURCE_DATABASE_URL (catalog primary,
  // set only at cutover). REPLICA_DATABASE_URL is retired with the GCP replica
  // and must never be re-set — a second writer starts if it is.
  console.error('[embed-runner] FATAL: SOURCE_DATABASE_URL is not set — waiting for cutover config; refusing to report success');
  process.exit(1);
}

const liveVectorDb = vectorDb;
const liveReplicaDb = replicaDb;
// BUY-76503: watermark persistence must use the PRIMARY DB (db / DATABASE_URL),
// NOT the replica. REPLICA_DATABASE_URL points to a read-only streaming standby;
// INSERT/UPDATE on embed_watermark there fails with SQLSTATE 25006.
const liveDb = db;

let running = false;

// --- Watermark helpers ---

interface Watermark {
  partition_name: string;
  last_updated_at: Date | null;
  rows_embedded:   number;
  zero_ticks:      number;
}

/**
 * Load the watermark for a partition. Returns null if the partition has not
 * started yet (first boot).
 */
async function loadWatermark(sourceDb: Pool, partitionName: string): Promise<Watermark | null> {
  const { rows } = await sourceDb.query<{
    partition_name: string;
    last_updated_at: Date | null;
    rows_embedded:   number;
    zero_ticks:      number;
  }>(
    `SELECT partition_name, last_updated_at, rows_embedded, zero_ticks
     FROM embed_watermark
     WHERE partition_name = $1`,
    [partitionName]
  );
  return rows[0] ?? null;
}

/**
 * Upsert watermark after a tick. Called within the tick transaction.
 */
async function upsertWatermark(
  client: PoolClient,
  partitionName: string,
  nextWatermark:  Date | null,
  rowsEmbedded:   number,
): Promise<void> {
  const zeroTicks = rowsEmbedded === 0 ? 1 : 0;

  await client.query(
    `INSERT INTO embed_watermark (partition_name, last_updated_at, rows_embedded, zero_ticks, updated_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (partition_name) DO UPDATE
       SET last_updated_at = EXCLUDED.last_updated_at,
           rows_embedded   = EXCLUDED.rows_embedded,
           zero_ticks     = CASE
             WHEN EXCLUDED.rows_embedded > 0 THEN 0
             ELSE embed_watermark.zero_ticks + 1
           END,
           updated_at = NOW()`,
    [partitionName, nextWatermark, rowsEmbedded, zeroTicks]
  );
}

/**
 * Pick the next partition to scan, using round-robin across PARTITION_ORDER.
 * Skip partitions that have been "stale-complete" (zero_ticks >= threshold).
 * Returns null if all partitions are stale-complete.
 *
 * Note: we pick deterministically from PARTITION_ORDER rather than randomly
 * to keep the sequence stable across restarts.
 */
async function pickNextPartition(sourceDb: Pool, roundRobinIdx: number): Promise<string | null> {
  const { rows } = await sourceDb.query<{ partition_name: string; zero_ticks: number }>(
    `SELECT partition_name, zero_ticks FROM embed_watermark`
  );
  const stateMap = new Map(rows.map(r => [r.partition_name, r.zero_ticks]));

  // How many times to cycle through PARTITION_ORDER before giving up
  const maxCycles = 3;
  for (let cycle = 0; cycle < maxCycles; cycle++) {
    for (let i = 0; i < PARTITION_ORDER.length; i++) {
      const idx = (roundRobinIdx + i) % PARTITION_ORDER.length;
      const partition = PARTITION_ORDER[idx];
      const zt = stateMap.get(partition) ?? 0;
      if (zt < STALE_SKIP_THRESHOLD) {
        return partition;
      }
    }
  }
  return null; // all partitions are stale-complete
}

// --- Main tick ---

let roundRobinIdx = 0;

async function tick(): Promise<void> {
  if (running) {
    console.log('[embed-runner] Previous run still in progress, skipping');
    schedule();
    return;
  }
  running = true;

  console.log(`[embed-runner] Starting embedding tick (batch_limit=${BATCH_LIMIT})`);

  try {
    // 1. Pick the next partition via round-robin, skipping stale-complete ones.
    //    Reads embed_watermark state — use PRIMARY (liveDb), not replica.
    const partition = await pickNextPartition(liveDb, roundRobinIdx);
    if (!partition) {
      console.log('[embed-runner] All partitions are stale-complete; nothing to sweep this tick');
      // Reset all stale partitions so they get re-scanned tomorrow
      await liveDb.query(
        `UPDATE embed_watermark SET zero_ticks = 0 WHERE zero_ticks >= $1`,
        [STALE_SKIP_THRESHOLD]
      );
    } else {
      // 2. Load watermark for this partition (PRIMARY, writable).
      const wm = await loadWatermark(liveDb, partition);

      // 3. Determine scan direction.
      //    - No watermark yet → start from NULL (full backfill, ASC from oldest)
      //    - Watermark is fresh (within 24h) → still ASC from watermark
      //    - Watermark is stale (>90 days old) → reset to NULL (catalog re-ingested)
      //    The actual ASC scan is handled inside runEmbedBatch.
      const watermark: Date | undefined = wm?.last_updated_at ?? undefined;

      // BUY-76503: if the watermark is older than 90 days, treat it as null.
      // This handles the case where the catalog was re-ingested and all
      // updated_at values are now newer than the old watermark.
      let effectiveWatermark: Date | undefined = watermark;
      if (watermark) {
        const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
        if (watermark < cutoff) {
          console.log(`[embed-runner] Watermark for ${partition} is ${Math.round((Date.now() - watermark.getTime()) / (24 * 60 * 60 * 1000))}d old (>90d); resetting to NULL`);
          effectiveWatermark = undefined;
        }
      }

      console.log(
        `[embed-runner] Sweeping partition=${partition} watermark=${effectiveWatermark ? effectiveWatermark.toISOString() : 'NULL'}`
      );

      // 4. Run the embed batch on this partition.
      const summary = await runEmbedBatch(
        liveReplicaDb,
        liveVectorDb,
        FLOWAI_KEY,
        BATCH_LIMIT,
        partition,
        effectiveWatermark,
      );

      console.log(
        `[embed-runner] ${partition} tick complete — ` +
        `processed=${summary.processed} skipped=${summary.skipped} ` +
        `errors=${summary.errors} next_watermark=${summary.nextWatermark?.toISOString() ?? 'END'} ` +
        `duration=${(summary.duration_ms / 1000).toFixed(1)}s`
      );

      // 5. Persist watermark. Done in a transaction on the PRIMARY (writable).
      // A crash between step 4 and 5 means we re-scan the same rows next tick
      // (hash gate prevents duplicate embeds).
      const client = await liveDb.connect();
      try {
        await client.query('BEGIN');
        await upsertWatermark(
          client,
          partition,
          summary.nextWatermark,
          summary.processed,
        );
        await client.query('COMMIT');
      } catch (wmErr) {
        await client.query('ROLLBACK');
        console.error('[embed-runner] Failed to persist watermark:', wmErr);
      } finally {
        client.release();
      }

      // 6. Advance round-robin pointer past this partition's slot.
      const slotIdx = PARTITION_ORDER.indexOf(partition);
      roundRobinIdx = (slotIdx + 1) % PARTITION_ORDER.length;
    }
  } catch (err) {
    console.error('[embed-runner] Tick failed:', err);
  } finally {
    running = false;
  }
  schedule();
}

function schedule(): void {
  const nextMin = Math.round(INTERVAL_MS / 60000);
  console.log(`[embed-runner] Next tick in ${nextMin} minutes`);
  setTimeout(tick, INTERVAL_MS);
}

async function main(): Promise<void> {
  console.log(
    `[embed-runner] Starting (BUY-76503 partition sweep, BUY-76567 Flow AI) — ` +
    `interval=${Math.round(INTERVAL_MS / 60000)}m batch=${BATCH_LIMIT}`
  );
  console.log('[embed-runner] Using Flow AI flow-embed-1 (Qwen3-Embedding-4B, 1024-dim)');
  console.log(`[embed-runner] Partition order (${PARTITION_ORDER.length} slots): ${PARTITION_ORDER.join(', ')}`);

  const shutdown = async (sig: string) => {
    console.log(`[embed-runner] Received ${sig}, shutting down`);
    await db.end().catch(() => {});
    await liveReplicaDb.end().catch(() => {});
    await liveVectorDb.end().catch(() => {});
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT',  () => void shutdown('SIGINT'));

  // BUY-76567: Ensure embedding_v2 vector(1024) column exists (idempotent).
  // The old 512-dim `embedding` column is NEVER touched or dropped.
  try {
    await liveVectorDb.query(
      `ALTER TABLE product_embeddings ADD COLUMN IF NOT EXISTS embedding_v2 vector(1024)`
    );
    console.log('[embed-runner] embedding_v2 column ensured (vector(1024))');
  } catch (err) {
    console.warn('[embed-runner] Could not ensure embedding_v2 column (may not exist yet):', err);
  }

  // BUY-76567: Ensure embed_writer role exists with INSERT + UPDATE only.
  try {
    await liveVectorDb.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'embed_writer') THEN
          CREATE ROLE embed_writer LOGIN;
        END IF;
      END $$;
    `);
    await liveVectorDb.query(
      `GRANT INSERT, UPDATE ON product_embeddings TO embed_writer`
    );
    console.log('[embed-runner] embed_writer role ensured (INSERT + UPDATE on product_embeddings)');
  } catch (err) {
    console.warn('[embed-runner] Could not ensure embed_writer role:', err);
  }

  // Ensure embed_watermark rows exist for all partitions (idempotent insert).
  // This creates the rows if they don't exist yet (e.g. first boot).
  try {
    await liveDb.query(
      `INSERT INTO embed_watermark (partition_name, last_updated_at, rows_embedded, zero_ticks)
       SELECT p, NULL, 0, 0
       FROM unnest($1::text[]) AS p
       ON CONFLICT (partition_name) DO NOTHING`,
      [PARTITION_ORDER]
    );
    console.log('[embed-runner] Watermark table seeded for all partitions');
  } catch (err) {
    // embed_watermark may not exist yet (migration not applied). Log and continue —
    // the worker will retry on the next tick after the migration is applied.
    console.warn('[embed-runner] Could not seed embed_watermark (table may not exist yet):', err);
  }

  // Run immediately on start, then on schedule
  await tick();
}

main().catch((err) => {
  console.error('[embed-runner] Fatal startup error:', err);
  process.exit(1);
});
