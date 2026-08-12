"use strict";
/**
 * embedRunner.ts — Recurring embedding pipeline scheduler
 *
 * Runs the embedding backfill on a configurable interval (default: every 6h).
 * Embeds products whose title+description has changed since last embedding (hash-gated),
 * priority-ordered by price DESC.
 *
 * BUY-52466: switched from Cohere embed-multilingual-v3.0 (1024-dim) to Google
 * `gemini-embedding-001` with `outputDimensionality=1024` and
 * `taskType=RETRIEVAL_DOCUMENT`. The Cohere spec (BUY-51459) is obsolete —
 * the live Cohere key was producing 401/403 (same Jina-key bug pattern),
 * and Rich's 2026-06-16 direction supersedes it.
 *
 * Env vars:
 *   GEMINI_API_KEY       — required; Google API key for gemini-embedding-001
 *   VECTOR_DB_URL        — required; PostgreSQL connection for product_embeddings table
 *   REPLICA_DATABASE_URL — required; Replica connection for reading products
 *   EMBED_BATCH_LIMIT    — products per run (default: 64)
 *   EMBED_INTERVAL_MS    — run interval in ms (default: 6h = 21600000)
 */
Object.defineProperty(exports, "__esModule", { value: true });
const config_1 = require("../config");
const embedProducts_1 = require("./embedProducts");
const GEMINI_API_KEY = process.env.GEMINI_API_KEY ?? '';
const BATCH_LIMIT = parseInt(process.env.EMBED_BATCH_LIMIT ?? '64', 10);
const INTERVAL_MS = parseInt(process.env.EMBED_INTERVAL_MS ?? String(6 * 60 * 60 * 1000), 10);
if (!GEMINI_API_KEY) {
    console.error('[embed-runner] GEMINI_API_KEY is not set — embedding is disabled');
    process.exit(0);
}
if (!config_1.vectorDb) {
    console.error('[embed-runner] VECTOR_DB_URL is not set — embedding is disabled');
    process.exit(0);
}
if (!config_1.replicaDb) {
    console.error('[embed-runner] REPLICA_DATABASE_URL is not set — replica-only embedding is disabled');
    process.exit(0);
}
const liveVectorDb = config_1.vectorDb;
const liveReplicaDb = config_1.replicaDb;
let running = false;
async function tick() {
    if (running) {
        console.log('[embed-runner] Previous run still in progress, skipping');
        schedule();
        return;
    }
    running = true;
    console.log(`[embed-runner] Starting embedding run (limit=${BATCH_LIMIT})`);
    console.log('[embed-runner] Reading from replica only (REPLICA_DATABASE_URL)');
    try {
        const summary = await (0, embedProducts_1.runEmbedBatch)(liveReplicaDb, liveVectorDb, GEMINI_API_KEY, BATCH_LIMIT);
        console.log(`[embed-runner] Run complete — ` +
            `processed=${summary.processed} errors=${summary.errors} ` +
            `duration=${(summary.duration_ms / 1000).toFixed(1)}s`);
    }
    catch (err) {
        console.error('[embed-runner] Run failed:', err);
    }
    finally {
        running = false;
    }
    schedule();
}
function schedule() {
    const nextMs = INTERVAL_MS;
    const nextMin = Math.round(nextMs / 60000);
    console.log(`[embed-runner] Next run in ${nextMin} minutes`);
    setTimeout(tick, nextMs);
}
async function main() {
    console.log(`[embed-runner] Starting — interval=${Math.round(INTERVAL_MS / 60000)}m batch=${BATCH_LIMIT}`);
    console.log('[embed-runner] Using Google gemini-embedding-001 (1024-dim, taskType=RETRIEVAL_DOCUMENT)');
    const shutdown = async (sig) => {
        console.log(`[embed-runner] Received ${sig}, shutting down`);
        await config_1.db.end().catch(() => { });
        await liveVectorDb.end().catch(() => { });
        process.exit(0);
    };
    process.on('SIGTERM', () => void shutdown('SIGTERM'));
    process.on('SIGINT', () => void shutdown('SIGINT'));
    // Run immediately on start, then on schedule
    await tick();
}
main().catch((err) => {
    console.error('[embed-runner] Fatal startup error:', err);
    process.exit(1);
});
