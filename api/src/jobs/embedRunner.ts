/**
 * embedRunner.ts — Recurring embedding pipeline scheduler
 *
 * Runs the Jina v3 embedding backfill on a configurable interval (default: every 6h).
 * Embeds products whose title+description has changed since last embedding (hash-gated),
 * priority-ordered by price DESC.
 *
 * BUY-52328: switched from Cohere embed-multilingual-v3.0 to Jina v3 (1024-dim)
 * with task=retrieval.passage. The Cohere spec (BUY-41133 / BUY-51459) was
 * producing 401/403 because routes/products.ts and routes/mcp.ts pass the
 * JINA_API_KEY value, which Cohere rejects.
 *
 * Env vars:
 *   JINA_API_KEY         — required; Jina API key for jina-embeddings-v3
 *   VECTOR_DB_URL        — required; PostgreSQL connection for product_embeddings table
 *   REPLICA_DATABASE_URL — required; Replica connection for reading products
 *   EMBED_BATCH_LIMIT    — products per run (default: 64)
 *   EMBED_INTERVAL_MS    — run interval in ms (default: 6h = 21600000)
 */

import { Pool } from 'pg';
import { db, replicaDb, vectorDb } from '../config';
import { runEmbedBatch } from './embedProducts';

const JINA_API_KEY = process.env.JINA_API_KEY ?? '';
const BATCH_LIMIT  = parseInt(process.env.EMBED_BATCH_LIMIT  ?? '64', 10);
const INTERVAL_MS  = parseInt(process.env.EMBED_INTERVAL_MS  ?? String(6 * 60 * 60 * 1000), 10);

if (!JINA_API_KEY) {
  console.error('[embed-runner] JINA_API_KEY is not set — embedding is disabled');
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

async function tick(): Promise<void> {
  if (running) {
    console.log('[embed-runner] Previous run still in progress, skipping');
    schedule();
    return;
  }
  running = true;
  console.log(`[embed-runner] Starting embedding run (limit=${BATCH_LIMIT})`);
  console.log('[embed-runner] Reading from replica only (REPLICA_DATABASE_URL)');
  try {
    const summary = await runEmbedBatch(liveReplicaDb, liveVectorDb, JINA_API_KEY, BATCH_LIMIT);
    console.log(
      `[embed-runner] Run complete — ` +
      `processed=${summary.processed} errors=${summary.errors} ` +
      `duration=${(summary.duration_ms / 1000).toFixed(1)}s`
    );
  } catch (err) {
    console.error('[embed-runner] Run failed:', err);
  } finally {
    running = false;
  }
  schedule();
}

function schedule(): void {
  const nextMs = INTERVAL_MS;
  const nextMin = Math.round(nextMs / 60000);
  console.log(`[embed-runner] Next run in ${nextMin} minutes`);
  setTimeout(tick, nextMs);
}

async function main(): Promise<void> {
  console.log(
    `[embed-runner] Starting — interval=${Math.round(INTERVAL_MS / 60000)}m batch=${BATCH_LIMIT}`
  );
  console.log('[embed-runner] Using Jina v3 (jina-embeddings-v3-1024, retrieval.passage)');

  const shutdown = async (sig: string) => {
    console.log(`[embed-runner] Received ${sig}, shutting down`);
    await db.end().catch(() => {});
    await liveVectorDb.end().catch(() => {});
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT',  () => void shutdown('SIGINT'));

  // Run immediately on start, then on schedule
  await tick();
}

main().catch((err) => {
  console.error('[embed-runner] Fatal startup error:', err);
  process.exit(1);
});
