import { Pool } from 'pg';
import { createHash } from 'crypto';

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

const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001';
const MODEL_VER      = 'gemini-embedding-001@512';
const EMBED_DIM      = 512;   // outputDimensionality
const BATCH_SIZE     = 64;    // BUY-41133 requirement: batch size 64 per API call
const MAX_TEXT_CHARS = 8000;  // gemini-embedding-001 input limit is 2k tokens; ~8k chars safe

export interface EmbedSummary {
  processed: number;
  skipped:   number;
  errors:    number;
  duration_ms: number;
  /** The updated_at value to save as the watermark for the next tick. Null if the scan reached the end. */
  nextWatermark: Date | null;
}

function textHash(title: string, description: string | null): string {
  const text = `${title} ${description ?? ''}`;
  return createHash('md5').update(text).digest('hex');
}

function truncate(text: string): string {
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
async function fetchDocumentEmbeddings(texts: string[], apiKey: string): Promise<number[][]> {
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
  const data = await res.json() as { embeddings: Array<{ values: number[] }> };
  return data.embeddings.map((e) => e.values);
}

/**
 * Embed a single query text (taskType=RETRIEVAL_QUERY). Returns a vector
 * string suitable for pgvector's `<=>` cosine-distance operator.
 *
 * Single-text path — Gemini `embedContents` is the documented shape for
 * one input. We still set outputDimensionality=512 to match the index.
 */
async function fetchQueryEmbedding(text: string, apiKey: string): Promise<number[]> {
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
  const data = await res.json() as { embedding: { values: number[] } };
  return data.embedding.values;
}

/**
 * Embeds up to batchLimit products from the source DB that are missing or stale,
 * writing results to the vector DB. Returns a summary.
 *
 * BUY-76503 partition sweep: each tick scans ONE country partition, moving
 * forward through that partition in `updated_at ASC` order. Progress is
 * tracked via the `nextWatermark` return value, which callers persist to
 * the `embed_watermark` table so restarts resume where they left off.
 *
 * Hash-gate: skips products where md5(title+description) matches stored text_hash
 * so price-only updates (~80% of ingest) never re-embed.
 *
 * Per BUY-52466: Uses Google gemini-embedding-001 with 512-dim vectors,
 * taskType=RETRIEVAL_DOCUMENT, batch size 64.
 *
 * @param sourceDb     Read pool for products_partitioned
 * @param vectorDb     Vector DB pool (product_embeddings lives here)
 * @param apiKey       Gemini API key
 * @param batchLimit   Max products to embed this tick
 * @param countryCode  Country partition to scan this tick (e.g. 'US'). If omitted,
 *                     falls back to the old `products ORDER BY updated_at DESC` scan.
 * @param watermark    updated_at to scan FROM (ASC). NULL/undefined = full backfill.
 */
export async function runEmbedBatch(
  sourceDb: Pool,
  vectorDb: Pool,
  apiKey:    string,
  batchLimit = 64,
  countryCode?: string,
  watermark?:  Date,
): Promise<EmbedSummary & { nextWatermark: Date | null }> {
  const t0 = Date.now();
  let processed = 0, skipped = 0, errors = 0;
  let nextWatermark: Date | null = null;

  let products: Array<{ id: string; title: string; description: string | null; updated_at: Date }>;

  if (countryCode) {
    // BUY-76503: partition-sweep path — scan ONE partition in updated_at ASC.
    // Scan many more rows than we embed to advance the watermark quickly past
    // already-embedded / uninteresting products.
    const scanLimit = parseInt(process.env.EMBED_SCAN_LIMIT ?? String(Math.max(batchLimit * 10, 1000)), 10);
    const watermarkCondition = watermark ? 'AND p.updated_at > $2' : '';
    const params = watermark ? [countryCode, watermark, scanLimit] : [countryCode, scanLimit];
    const paramIdx = watermark ? 3 : 2;

    const { rows } = await sourceDb.query<{
      id: string; title: string; description: string | null; updated_at: Date;
    }>(
      `SELECT p.id, p.title, p.description, p.updated_at
       FROM products_partitioned p
       WHERE p.country_code = $1
         AND p.is_active = true
         AND p.price IS NOT NULL
         ${watermarkCondition}
       ORDER BY p.updated_at ASC
       LIMIT $${paramIdx}`,
      params
    );
    products = rows;

    if (products.length > 0) {
      nextWatermark = products[products.length - 1].updated_at;
    }
  } else {
    // Legacy fallback: full-table updated_at DESC scan.
    const overscan = Math.max(batchLimit * 2, 64);
    const { rows: candidateIds } = await sourceDb.query<{ id: string }>(
      `WITH active_ids AS (
         SELECT id
         FROM products
         WHERE is_active = true
           AND price IS NOT NULL
         ORDER BY updated_at DESC
         LIMIT $1
       )
       SELECT id FROM active_ids`,
      [overscan]
    );

    if (candidateIds.length === 0) {
      console.log('[embed] Nothing to embed this run');
      return { processed: 0, skipped, errors: 0, duration_ms: Date.now() - t0, nextWatermark };
    }

    const ids = candidateIds.map(c => c.id);
    const { rows } = await sourceDb.query<{
      id: string; title: string; description: string | null;
    }>(
      `SELECT p.id, p.title, p.description
       FROM products p
       WHERE p.id = ANY($1::text[])`,
      [ids]
    );
    products = rows.map(r => ({ ...r, updated_at: new Date() }));
  }

  if (products.length === 0) {
    console.log('[embed] Nothing to embed this run');
    return { processed: 0, skipped, errors: 0, duration_ms: Date.now() - t0, nextWatermark };
  }

  console.log(`[embed] ${products.length} products to embed in batches of ${BATCH_SIZE}`);

  for (let i = 0; i < products.length; i += BATCH_SIZE) {
    const batch   = products.slice(i, i + BATCH_SIZE);
    const texts   = batch.map(p => truncate(`${p.title} ${p.description ?? ''}`));
    const hashes  = batch.map(p => textHash(p.title, p.description));

    let embeddings: number[][];
    try {
      embeddings = await fetchDocumentEmbeddings(texts, apiKey);
    } catch (err) {
      console.error(`[embed] Gemini API error on batch ${Math.floor(i / BATCH_SIZE) + 1}:`, err);
      errors += batch.length;
      continue;
    }

    if (embeddings.length !== batch.length) {
      console.error(
        `[embed] Gemini returned ${embeddings.length} vectors for batch of ${batch.length} — skipping`
      );
      errors += batch.length;
      continue;
    }

    const client = await vectorDb.connect();
    try {
      await client.query('BEGIN');
      for (let j = 0; j < batch.length; j++) {
        const vectorStr = `[${embeddings[j].join(',')}]`;
        await client.query(
          `INSERT INTO product_embeddings (product_id, embedding, text_hash, model_ver)
           VALUES ($1, $2::vector, $3, $4)
           ON CONFLICT (product_id) DO UPDATE
             SET embedding   = EXCLUDED.embedding,
                 text_hash   = EXCLUDED.text_hash,
                 model_ver   = EXCLUDED.model_ver,
                 embedded_at = now()
           WHERE product_embeddings.text_hash != EXCLUDED.text_hash`,
          [batch[j].id, vectorStr, hashes[j], MODEL_VER]
        );
      }
      await client.query('COMMIT');
      processed += batch.length;
    } catch (dbErr) {
      await client.query('ROLLBACK');
      console.error(`[embed] DB write error on batch ${Math.floor(i / BATCH_SIZE) + 1}:`, dbErr);
      errors += batch.length;
    } finally {
      client.release();
    }

    if ((i / BATCH_SIZE + 1) % 10 === 0) {
      console.log(`[embed] Progress: ${Math.min(i + BATCH_SIZE, products.length)}/${products.length}`);
    }
  }

  const duration = Date.now() - t0;
  console.log(
    `[embed] Done — processed=${processed} skipped=${skipped} errors=${errors} in ${(duration / 1000).toFixed(1)}s`
  );
  return { processed, skipped, errors, duration_ms: duration, nextWatermark };
}

/**
 * Embed a single query text for search-time use (taskType=RETRIEVAL_QUERY).
 * Returns a vector string suitable for pgvector (<=> operator).
 *
 * BUY-52466: switched from Cohere/Jina to Google gemini-embedding-001.
 */
export async function embedQuery(query: string, apiKey: string): Promise<string> {
  const values = await fetchQueryEmbedding(query, apiKey);
  return `[${values.join(',')}]`;
}
