"use strict";
/**
 * embedRunner.ts — Recurring embedding pipeline scheduler
 *
 * Runs the Jina v3 embedding backfill on a configurable interval (default: every 6h).
 * Embeds products whose title+description has changed since last embedding (hash-gated),
 * priority-ordered by price DESC.
 *
 * Env vars:
 *   JINA_API_KEY       — required; Jina AI API key for embeddings
 *   VECTOR_DB_URL      — required; PostgreSQL connection for product_embeddings table
 *   DATABASE_URL       — used for reading products (standard pool)
 *   EMBED_BATCH_LIMIT  — products per run (default: 5000)
 *   EMBED_INTERVAL_MS  — run interval in ms (default: 6h = 21600000)
 */
Object.defineProperty(exports, "__esModule", { value: true });
const pg_1 = require("pg");
const config_1 = require("../config");
const embedProducts_1 = require("./embedProducts");
const JINA_API_KEY = process.env.JINA_API_KEY ?? '';
const VECTOR_DB_URL = process.env.VECTOR_DB_URL ?? '';
const BATCH_LIMIT = parseInt(process.env.EMBED_BATCH_LIMIT ?? '5000', 10);
const INTERVAL_MS = parseInt(process.env.EMBED_INTERVAL_MS ?? String(6 * 60 * 60 * 1000), 10);
if (!JINA_API_KEY) {
    console.error('[embed-runner] JINA_API_KEY is not set — embedding is disabled');
    process.exit(0);
}
if (!VECTOR_DB_URL) {
    console.error('[embed-runner] VECTOR_DB_URL is not set — embedding is disabled');
    process.exit(0);
}
const vectorDb = new pg_1.Pool({
    connectionString: VECTOR_DB_URL,
    max: 5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
});
let running = false;
async function tick() {
    if (running) {
        console.log('[embed-runner] Previous run still in progress, skipping');
        schedule();
        return;
    }
    running = true;
    console.log(`[embed-runner] Starting embedding run (limit=${BATCH_LIMIT})`);
    try {
        const summary = await (0, embedProducts_1.runEmbedBatch)(config_1.db, vectorDb, JINA_API_KEY, BATCH_LIMIT);
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
    const shutdown = async (sig) => {
        console.log(`[embed-runner] Received ${sig}, shutting down`);
        await config_1.db.end().catch(() => { });
        await vectorDb.end().catch(() => { });
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
