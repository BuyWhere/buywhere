/**
 * embedRunner.ts — Recurring embedding pipeline scheduler (BUY-76503)
 *
 * BUY-76503: partition sweep replaces the old `ORDER BY updated_at DESC` scan.
 *
 * The old approach: scan the full products table ordered by updated_at DESC,
 * picking the ~10 products/day that happen to have a recent updated_at. This
 * meant `product_embeddings` grew by ~10 rows/day even though the worker ran
 * every 6h — the same 10 candidates were re-offered every tick forever.
 *
 * The new approach: each tick scans ONE country partition, moving FORWARD
 * through that partition in `updated_at ASC` order. Progress is tracked in the
 * `embed_watermark` table so restarts resume where they left off. When a
 * partition's scan returns 0 candidates the runner advances to the next
 * partition in round-robin order.
 *
 * Key properties:
 *   - Bounded per-tick work: scan is capped at batchLimit rows
 *   - Durable progress: watermark survives worker restarts
 *   - Backfill-capable: eventually reaches every product regardless of updated_at
 *   - Hash gate still applies: unchanged products are skipped per tick
 *
 * Env vars:
 *   GEMINI_API_KEY       — required; Google API key for gemini-embedding-001
 *   VECTOR_DB_URL        — required; PostgreSQL connection for product_embeddings table
 *   REPLICA_DATABASE_URL — required; Replica connection for reading products_partitioned
 *   EMBED_BATCH_LIMIT    — products per tick (default: 64)
 *   EMBED_INTERVAL_MS    — tick interval in ms (default: 6h = 21600000)
 */

import { Pool, PoolClient } from 'pg';
import { db, replicaDb, vectorDb } from '../config';
import { runEmbedBatch } from './embedProducts';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY ?? '';
const BATCH_LIMIT    = parseInt(process.env.EMBED_BATCH_LIMIT  ?? '64', 10);
const INTERVAL_MS    = parseInt(process.env.EMBED_INTERVAL_MS  ?? String(6 * 60 * 60 * 1000), 10);

// BUY-76503: partition priority order. High-value markets get scanned more
// frequently by appearing multiple times in the list.
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

const STALE_SKIP_THRESHOLD = 3;

if (!GEMINI_API_KEY) {
  console.error('[embed-runner] GEMINI_API_KEY is not set — embedding is disabled');
  process.exit(0);
}
if (!vectorDb) {
  console.error('[embed-runner] VECTOR_DB_URL is not set — embedding is disabled');
  process.exit(0);
}
if (!replicaDb) {
  console.error('[embed-runner] REPLICA_DATABASE_URL is not set — replica-only embedding is disabled');
  process.exit(0);
}

const liveVectorDb = vectorDb;
const liveReplicaDb = replicaDb;

let running = false;

// --- Watermark helpers ---

interface Watermark {
  partition_name: string;
  last_updated_at: Date | null;
  rows_embedded:   number;
  zero_ticks:      number;
}

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

async function upsertWatermark(
  client: PoolClient,
  partitionName: string,
  nextWatermark:  Date | null,
  rowsEmbedded:   number,
): Promise<void> {
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

async function pickNextPartition(sourceDb: Pool, roundRobinIdx: number): Promise<string | null> {
  const { rows } = await sourceDb.query<{ partition_name: string; zero_ticks: number }>(
    `SELECT partition_name, zero_ticks FROM embed_watermark`
  );
  const stateMap = new Map(rows.map(r => [r.partition_name, r.zero_ticks]));

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
  return null;
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
    const partition = await pickNextPartition(liveReplicaDb, roundRobinIdx);
    if (!partition) {
      console.log('[embed-runner] All partitions are stale-complete; resetting and waiting for next tick');
      await liveReplicaDb.query(
        `UPDATE embed_watermark SET zero_ticks = 0 WHERE zero_ticks >= $1`,
        [STALE_SKIP_THRESHOLD]
      );
    } else {
      const wm = await loadWatermark(liveReplicaDb, partition);
      let watermark: Date | undefined = wm?.last_updated_at ?? undefined;

      if (watermark) {
        const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
        if (watermark < cutoff) {
          console.log(`[embed-runner] Watermark for ${partition} is ${Math.round((Date.now() - watermark.getTime()) / (24 * 60 * 60 * 1000))}d old (>90d); resetting to NULL`);
          watermark = undefined;
        }
      }

      console.log(
        `[embed-runner] Sweeping partition=${partition} watermark=${watermark ? watermark.toISOString() : 'NULL'}`
      );

      const summary = await runEmbedBatch(
        liveReplicaDb,
        liveVectorDb,
        GEMINI_API_KEY,
        BATCH_LIMIT,
        partition,
        watermark,
      );

      console.log(
        `[embed-runner] ${partition} tick complete — ` +
        `processed=${summary.processed} skipped=${summary.skipped} ` +
        `errors=${summary.errors} next_watermark=${summary.nextWatermark?.toISOString() ?? 'END'} ` +
        `duration=${(summary.duration_ms / 1000).toFixed(1)}s`
      );

      const client = await liveReplicaDb.connect();
      try {
        await client.query('BEGIN');
        await upsertWatermark(client, partition, summary.nextWatermark, summary.processed);
        await client.query('COMMIT');
      } catch (wmErr) {
        await client.query('ROLLBACK');
        console.error('[embed-runner] Failed to persist watermark:', wmErr);
      } finally {
        client.release();
      }

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
    `[embed-runner] Starting (BUY-76503 partition sweep) — ` +
    `interval=${Math.round(INTERVAL_MS / 60000)}m batch=${BATCH_LIMIT}`
  );
  console.log('[embed-runner] Using Google gemini-embedding-001 (512-dim, taskType=RETRIEVAL_DOCUMENT)');
  console.log(`[embed-runner] Partition order (${PARTITION_ORDER.length} slots): ${PARTITION_ORDER.join(', ')}`);

  const shutdown = async (sig: string) => {
    console.log(`[embed-runner] Received ${sig}, shutting down`);
    await db.end().catch(() => {});
    await liveVectorDb.end().catch(() => {});
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT',  () => void shutdown('SIGINT'));

  try {
    await liveReplicaDb.query(
      `INSERT INTO embed_watermark (partition_name, last_updated_at, rows_embedded, zero_ticks)
       SELECT p, NULL, 0, 0
       FROM unnest($1::text[]) AS p
       ON CONFLICT (partition_name) DO NOTHING`,
      [PARTITION_ORDER]
    );
    console.log('[embed-runner] Watermark table seeded for all partitions');
  } catch (err) {
    console.warn('[embed-runner] Could not seed embed_watermark (table may not exist yet):', err);
  }

  await tick();
}

main().catch((err) => {
  console.error('[embed-runner] Fatal startup error:', err);
  process.exit(1);
});
