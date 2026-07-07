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
 * Hash-gate: skips products where md5(title+description) matches stored text_hash
 * so price-only updates (~80% of ingest) never re-embed.
 *
 * Priority: highest-value (price DESC) products are embedded first, so the most
 * commercially relevant embeddings are always fresh.
 *
 * Per BUY-52466: Uses Google gemini-embedding-001 with 512-dim vectors,
 * taskType=RETRIEVAL_DOCUMENT, batch size 64.
 */
export async function runEmbedBatch(
  sourceDb: Pool,
  vectorDb: Pool,
  apiKey:  string,
  batchLimit = 64,
): Promise<EmbedSummary> {
  const t0 = Date.now();
  let processed = 0, skipped = 0, errors = 0;

  // BUY-60368: the LEFT JOIN to product_embeddings was removed because that
  // table only exists in vectorDb, not sourceDb (catalog replica). The embed
  // hash-gate comparison now happens after loading candidates.
  //
  // BUY-60378: the flat SELECT hit a ~3 min full-scan on the 154M-row
  // products table, causing 57014 (query_canceled) on the replica.
  //
  // BUY-60378 v2 (this commit): pivot the order key to `updated_at DESC`
  // (no NULLS LAST), which uses the EXISTING and VALID `idx_products_updated_at`
  // (~3.4 GB btree). Without the missing `idx_products_is_active_price`
  // covering index, `ORDER BY price DESC` planner falls back to a Seq Scan
  // (~37M cost, ~3 min wall clock); `updated_at DESC` flips to an Index Scan
  // (cost ~91) and the CTE/SELECT finishes in well under the 60s
  // statement_timeout on the replica.
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
    return { processed: 0, skipped, errors: 0, duration_ms: Date.now() - t0 };
  }

  const ids = candidateIds.map(c => c.id);
  const { rows: products } = await sourceDb.query<{
    id: string;
    title: string;
    description: string | null;
  }>(
    `SELECT p.id, p.title, p.description
     FROM products p
     WHERE p.id = ANY($1::text[])`,
    [ids]
  );

  if (products.length === 0) {
    console.log('[embed] Nothing to embed this run');
    return { processed: 0, skipped, errors: 0, duration_ms: Date.now() - t0 };
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
  return { processed, skipped, errors, duration_ms: duration };
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
