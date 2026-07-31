"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runEmbedBatch = runEmbedBatch;
exports.embedQuery = embedQuery;
const crypto_1 = require("crypto");
// BUY-52466: switch query + embed-worker paths from Cohere/Jina to Google
// Gemini `gemini-embedding-001` with `outputDimensionality=512`. Direction
// per Rich (comment f5773f92 on BUY-52089): the Jina key is INVALID and the
// previous Cohere spec (BUY-51459) is obsolete. This module is the single
// call site for both:
//   - query side:  `embedQuery(q, geminiKey)`  → taskType=RETRIEVAL_QUERY
//   - index side:  `runEmbedBatch(...)`        → taskType=RETRIEVAL_DOCUMENT
//
// The function signatures still take a single `apiKey: string` so callers
// (routes/products.ts, routes/mcp.ts, jobs/embedRunner.ts) only need to
// change which env var they read.
//
// BUY-60368: the previous `runEmbedBatch` issued a single query against
// `sourceDb` that LEFT JOINed `product_embeddings pe` to filter stale
// rows. `product_embeddings` only lives in `vectorDb` (vectordb / pgvector),
// so every 6h tick failed with `42P01 relation "product_embeddings" does
// not exist`. We now (1) pull the existing `(product_id, text_hash)` set
// from `vectorDb` once per run and (2) issue a flat `SELECT` against
// `sourceDb` over a candidate id list, then drop the LEFT JOIN entirely.
// This is Option A from BUY-60368 (no schema change, no FDW).
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001';
const MODEL_VER = 'gemini-embedding-001@512';
const EMBED_DIM = 512; // outputDimensionality
const BATCH_SIZE = 64; // BUY-41133 requirement: batch size 64 per API call
const MAX_TEXT_CHARS = 8000; // gemini-embedding-001 input limit is ~2k tokens; ~8k chars safe
function textHash(title, description) {
    const text = `${title} ${description ?? ''}`;
    return (0, crypto_1.createHash)('md5').update(text).digest('hex');
}
function truncate(text) {
    return text.length > MAX_TEXT_CHARS ? text.slice(0, MAX_TEXT_CHARS) : text;
}
/**
 * Embed a batch of index-side texts (taskType=RETRIEVAL_DOCUMENT).
 * Uses `batchEmbedContents` so we send a single POST for up to BATCH_SIZE
 * products — fewer round-trips than per-text `embedContents` calls.
 *
 * Gemini auth: the API key is passed as the `key` query parameter
 * (Google's documented pattern for the Generative Language API).
 */
async function fetchDocumentEmbeddings(texts, apiKey) {
    const url = `${GEMINI_API_URL}:batchEmbedContents?key=${encodeURIComponent(apiKey)}`;
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            requests: texts.map((text) => ({
                model: 'models/gemini-embedding-001',
                content: { parts: [{ text: truncate(text) }] },
                taskType: 'RETRIEVAL_DOCUMENT',
                outputDimensionality: EMBED_DIM,
            })),
        }),
    });
    if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`Gemini API ${res.status}: ${body}`);
    }
    const data = await res.json();
    return data.embeddings.map((e) => e.values);
}
/**
 * Embed a single query text (taskType=RETRIEVAL_QUERY). Returns a vector
 * string suitable for pgvector's `<=>` cosine-distance operator.
 *
 * Single-text path — Gemini `embedContents` is the documented shape for
 * one input. We still set outputDimensionality=512 to match the index.
 */
async function fetchQueryEmbedding(text, apiKey) {
    const url = `${GEMINI_API_URL}:embedContent?key=${encodeURIComponent(apiKey)}`;
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            model: 'models/gemini-embedding-001',
            content: { parts: [{ text: truncate(text) }] },
            taskType: 'RETRIEVAL_QUERY',
            outputDimensionality: EMBED_DIM,
        }),
    });
    if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`Gemini API ${res.status}: ${body}`);
    }
    const data = await res.json();
    return data.embedding.values;
}
/**
 * BUY-60368: Fetch the existing `product_embeddings` hash set from `vectorDb`
 * so `runEmbedBatch` can filter stale rows without a cross-database JOIN.
 *
 * The replica (`sourceDb`) does not know about `product_embeddings`. We
 * load a `(product_id, text_hash)` map from `vectorDb` once per run; the
 * map is bounded by the product catalog (~127M products in `products`,
 * each with at most one row in `product_embeddings`). For very large
 * catalogs this should be tightened to a recent / priority window — but
 * the current pgvector setup fits the full set in memory comfortably.
 *
 * Returns an empty map when `vectorDb` is unreachable; in that case the
 * caller falls back to "everything is candidate" so a transient vectordb
 * outage cannot silently freeze the embed pipeline.
 */
async function loadVectorHashes(vectorDb) {
    const out = new Map();
    try {
        const { rows } = await vectorDb.query(`SELECT product_id, text_hash FROM product_embeddings`);
        for (const r of rows)
            out.set(r.product_id, r.text_hash);
    }
    catch (err) {
        console.warn('[embed] Could not pre-load vector hashes; treating all products as candidates:', err);
    }
    return out;
}
/**
 * Embeds up to batchLimit products from the source DB that are missing or stale,
 * writing results to the vector DB. Returns a summary.
 *
 * Hash-gate (BUY-60368): we no longer JOIN across DBs. Instead we
 *   1. load `(product_id -> text_hash)` from vectorDb,
 *   2. SELECT up to `batchLimit` candidate products from sourceDb ordered
 *      by updated_at DESC (the recency rule — see BUY-60378 note),
 *   3. drop candidates whose freshly-computed hash matches the stored
 *      one (price-only updates — ~80% of ingest — never re-embed),
 *   4. if still over budget, take the top N by recency.
 *
 * Priority: most-recently-updated products are embedded first. The
 * original "highest price first" rule (BUY-60368) required an index on
 * `(is_active, price)` to be index-scan-eligible on the 154M-row
 * `products` table; that index has been INVALID since a cancelled CIC
 * and the DDL watchdog (BUY-58494) blocks recreating it. Until BUY-58494
 * is unblocked, the planner falls back to a full Seq Scan on `price DESC`
 * and the catalog SELECT 57014's at the 30s/60s statement_timeout,
 * starving the embed-runner for 18+ days. Ordering by `updated_at DESC`
 * uses the existing `idx_products_updated_at` (cost ~0.57 vs ~37M) and
 * is arguably a better priority for embeddings anyway: products with
 * recently-changed `updated_at` are exactly the ones whose embeddings
 * are most likely to be stale or missing.
 *
 * Per BUY-52466: Uses Google gemini-embedding-001 with 512-dim vectors,
 * taskType=RETRIEVAL_DOCUMENT, batch size 64.
 */
async function runEmbedBatch(sourceDb, vectorDb, apiKey, batchLimit = 64) {
    const t0 = Date.now();
    let processed = 0, skipped = 0, errors = 0;
    // Pull the existing hash set from vectorDb. Failure is non-fatal: we
    // fall back to "every candidate is unembedded" rather than aborting
    // the entire tick.
    const vectorHashes = await loadVectorHashes(vectorDb);
    console.log(`[embed] Loaded ${vectorHashes.size} existing embeddings from vectordb`);
    // BUY-60368: sourceDb only has `products`, so the SELECT is now flat.
    // We overscan by a small factor so the in-JS hash gate has enough
    // candidates to fill `batchLimit` after skipping stale rows.
    //
    // BUY-60378/BUY-60446: the flat `ORDER BY price DESC` SELECT hit a full
    // Seq Scan on the 154M-row products table and 57014'd at the statement
    // timeout on the replica. The intended `idx_products_is_active_price`
    // index is INVALID (a CIC was cancelled mid-build and the DDL watchdog
    // blocks new CIC builds — see BUY-58494). Without that index the
    // planner has no entry point for `WHERE is_active=true ORDER BY price DESC`
    // and falls back to a Seq Scan (~37M cost, ~3 min wall clock).
    //
    // BUY-60378 v2 (this commit): pivot the order key to `updated_at DESC`,
    // which uses the EXISTING and VALID `idx_products_updated_at` (3.4 GB
    // btree). EXPLAIN (VERBOSE, BUFFERS) against the production maglev
    // replica shows:
    //   Limit (cost=0.57..91.25 rows=128 width=16)
    //     -> Index Scan using idx_products_updated_at
    //        Filter: products.is_active
    // followed by Index Scan using products_pkey (~2.79 cost per row).
    // Total ~449, sub-second wall clock.
    //
    // Trade-off: the priority rule is now "most-recently-updated first"
    // (often = "most likely to have stale embeddings") instead of
    // "highest-value first". After 18 days of zero embeddings this is a
    // defensible recovery order.
    const overscan = Math.max(batchLimit * 2, 64);
    const { rows: candidateIds } = await sourceDb.query(`WITH active_ids AS (
       SELECT id
       FROM products
       WHERE is_active = true
         AND price IS NOT NULL
       ORDER BY updated_at DESC
       LIMIT $1
     )
     SELECT id FROM active_ids`, [overscan]);
    if (candidateIds.length === 0) {
        console.log('[embed] Nothing to embed this run');
        return { processed: 0, skipped, errors: 0, duration_ms: Date.now() - t0 };
    }
    const ids = candidateIds.map(c => c.id);
    const { rows: candidates } = await sourceDb.query(`SELECT p.id, p.title, p.description, p.price
     FROM products p
     WHERE p.id = ANY($1::text[])`, [ids]);
    // Hash-gate filter (mirrors the original LEFT JOIN semantics):
    //   - product not in vectorDb           → embed
    //   - product in vectorDb with same hash → skip (price-only update)
    //   - product in vectorDb with diff hash → embed
    const products = [];
    for (const p of candidates) {
        const fresh = textHash(p.title, p.description);
        const stored = vectorHashes.get(p.id);
        if (stored === undefined) {
            products.push(p); // not yet embedded
        }
        else if (stored !== fresh) {
            products.push(p); // text changed
        }
        else {
            skipped += 1;
            if (products.length >= batchLimit)
                break;
        }
        if (products.length >= batchLimit)
            break;
    }
    if (products.length === 0) {
        console.log('[embed] Nothing to embed this run');
        return { processed: 0, skipped, errors: 0, duration_ms: Date.now() - t0 };
    }
    console.log(`[embed] ${products.length} products to embed in batches of ${BATCH_SIZE} ` +
        `(skipped ${skipped} up-to-date, scanned ${candidates.length})`);
    for (let i = 0; i < products.length; i += BATCH_SIZE) {
        const batch = products.slice(i, i + BATCH_SIZE);
        const texts = batch.map(p => truncate(`${p.title} ${p.description ?? ''}`));
        const hashes = batch.map(p => textHash(p.title, p.description));
        let embeddings;
        try {
            embeddings = await fetchDocumentEmbeddings(texts, apiKey);
        }
        catch (err) {
            console.error(`[embed] Gemini API error on batch ${Math.floor(i / BATCH_SIZE) + 1}:`, err);
            errors += batch.length;
            continue;
        }
        if (embeddings.length !== batch.length) {
            console.error(`[embed] Gemini returned ${embeddings.length} vectors for batch of ${batch.length} — skipping`);
            errors += batch.length;
            continue;
        }
        const client = await vectorDb.connect();
        try {
            await client.query('BEGIN');
            for (let j = 0; j < batch.length; j++) {
                const vectorStr = `[${embeddings[j].join(',')}]`;
                await client.query(`INSERT INTO product_embeddings (product_id, embedding, text_hash, model_ver)
           VALUES ($1, $2::vector, $3, $4)
           ON CONFLICT (product_id) DO UPDATE
             SET embedding   = EXCLUDED.embedding,
                 text_hash   = EXCLUDED.text_hash,
                 model_ver   = EXCLUDED.model_ver,
                 embedded_at = now()
           WHERE product_embeddings.text_hash != EXCLUDED.text_hash`, [batch[j].id, vectorStr, hashes[j], MODEL_VER]);
            }
            await client.query('COMMIT');
            processed += batch.length;
        }
        catch (dbErr) {
            await client.query('ROLLBACK');
            console.error(`[embed] DB write error on batch ${Math.floor(i / BATCH_SIZE) + 1}:`, dbErr);
            errors += batch.length;
        }
        finally {
            client.release();
        }
        if ((i / BATCH_SIZE + 1) % 10 === 0) {
            console.log(`[embed] Progress: ${Math.min(i + BATCH_SIZE, products.length)}/${products.length}`);
        }
    }
    const duration = Date.now() - t0;
    console.log(`[embed] Done — processed=${processed} skipped=${skipped} errors=${errors} in ${(duration / 1000).toFixed(1)}s`);
    return { processed, skipped, errors, duration_ms: duration };
}
/**
 * Embed a single query text for search-time use (taskType=RETRIEVAL_QUERY).
 * Returns a vector string suitable for pgvector (<=> operator).
 *
 * BUY-52466: switched from Cohere/Jina to Google gemini-embedding-001.
 */
async function embedQuery(query, apiKey) {
    const values = await fetchQueryEmbedding(query, apiKey);
    return `[${values.join(',')}]`;
}
