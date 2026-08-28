import { Pool } from 'pg';
import { createHash } from 'crypto';

// BUY-76567: switch from Gemini gemini-embedding-001 (512-dim, $0.15/M) to
// Flow AI flow-embed-1 (Qwen3-Embedding-4B, 1024-dim, ~$0.02/M).
// Flow AI is OpenAI-compatible: POST /v1/embeddings with Bearer auth.
// The existing Gemini-512 vectors are incompatible and preserved in the
// old `embedding` column; new vectors go into `embedding_v2 vector(1024)`.
//
// BUY-60368: hash-gate approach unchanged — load existing hashes from
// vectorDb, filter stale candidates, embed only changed/new products.

const FLOWAI_EMBED_URL = (process.env.FLOWAI_API_BASE || 'https://api.flowaiapi.com') + '/v1/embeddings';
const MODEL_VER        = 'flow-embed-1@1024';
const EMBED_DIM        = 1024;
const BATCH_SIZE       = 100;   // Flow AI accepts up to 100 strings per call
const MAX_TEXT_CHARS    = 8000;

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
 * BUY-76567: Embed a batch of index-side texts via Flow AI.
 * Flow AI uses OpenAI-compatible API: POST /v1/embeddings with Bearer auth.
 * Supports up to 100 strings per call. Response is sorted by index.
 */
async function fetchDocumentEmbeddings(texts: string[], apiKey: string): Promise<number[][]> {
  const res = await fetch(FLOWAI_EMBED_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'flow-embed-1',
      input: texts.map(truncate),
      dimensions: EMBED_DIM,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Flow AI API ${res.status}: ${body}`);
  }
  const data = await res.json() as {
    data: Array<{ index: number; embedding: number[] }>;
    _flowaiapi?: { cost_usd: number; tokens: number; provider: string };
  };
  // Sort by index to guarantee order matches input
  const sorted = data.data.sort((a, b) => a.index - b.index);
  if (data._flowaiapi) {
    console.log(`[embed] Flow AI: ${data._flowaiapi.provider} cost=$${data._flowaiapi.cost_usd.toFixed(8)} tokens=${data._flowaiapi.tokens}`);
  }
  return sorted.map((e) => e.embedding);
}

/**
 * BUY-76567: Embed a single query text via Flow AI for search-time use.
 * Returns a vector string suitable for pgvector (<=> operator).
 */
async function fetchQueryEmbedding(text: string, apiKey: string): Promise<number[]> {
  const res = await fetch(FLOWAI_EMBED_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'flow-embed-1',
      input: [truncate(text)],
      dimensions: EMBED_DIM,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Flow AI API ${res.status}: ${body}`);
  }
  const data = await res.json() as {
    data: Array<{ embedding: number[] }>;
    _flowaiapi?: { cost_usd: number; tokens: number; provider: string };
  };
  if (data._flowaiapi) {
    console.log(`[embed] Flow AI query: ${data._flowaiapi.provider} cost=$${data._flowaiapi.cost_usd.toFixed(8)} tokens=${data._flowaiapi.tokens}`);
  }
  return data.data[0].embedding;
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
async function loadVectorHashes(vectorDb: Pool): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  try {
    // BUY-76567: check embedding_v2 first (new 1024-dim pipeline); fall back
    // to embedding (old 512-dim) for products not yet migrated.
    const { rows } = await vectorDb.query<{ product_id: string; text_hash: string }>(
      `SELECT product_id, COALESCE(
        (SELECT text_hash FROM product_embeddings pe2
         WHERE pe2.product_id = product_embeddings.product_id
         AND pe2.embedding_v2 IS NOT NULL
         LIMIT 1),
        text_hash
      ) AS text_hash FROM product_embeddings`
    );
    for (const r of rows) out.set(r.product_id, r.text_hash);
  } catch (err) {
    // embedding_v2 column may not exist yet; fall back to old column
    try {
      const { rows } = await vectorDb.query<{ product_id: string; text_hash: string }>(
        `SELECT product_id, text_hash FROM product_embeddings`
      );
      for (const r of rows) out.set(r.product_id, r.text_hash);
    } catch (err2) {
      console.warn('[embed] Could not pre-load vector hashes; treating all products as candidates:', err2);
    }
  }
  return out;
}

/**
 * Embeds up to batchLimit products from the source DB that are missing or stale,
 * writing results to the vector DB. Returns a summary.
 *
 * BUY-76503 partition sweep: each tick scans ONE country partition, moving
 * forward through that partition in `updated_at ASC` order. The watermark
 * (last_updated_at to resume from) is managed by the caller (embedRunner).
 * This ensures every product is eventually embedded regardless of how stale
 * its `updated_at` is — the old `ORDER BY updated_at DESC` approach only ever
 * reached the ~10 products/day that had recently-changed updated_at.
 *
 * Hash-gate (BUY-60368): we no longer JOIN across DBs. Instead we
 *   1. load `(product_id -> text_hash)` from vectorDb,
 *   2. SELECT up to `batchLimit` candidate products from sourceDb ordered
 *      by updated_at ASC from the watermark,
 *   3. drop candidates whose freshly-computed hash matches the stored
 *      one (price-only updates — ~80% of ingest — never re-embed),
 *   4. if still over budget, take the top N by recency (within this tick).
 *
 * Per BUY-52466: Uses Google gemini-embedding-001 with 512-dim vectors,
 * taskType=RETRIEVAL_DOCUMENT, batch size 64.
 *
 * @param sourceDb     Read pool for products (partitioned by country_code)
 * @param vectorDb     Vector DB pool (product_embeddings lives here)
 * @param apiKey       Gemini API key
 * @param batchLimit   Max products to embed this tick
 * @param countryCode  Country partition to scan this tick (e.g. 'US'). If
 *                     omitted, falls back to the old updated_at DESC scan
 *                     (legacy non-sweep mode — only for the first sweep tick
 *                     before any watermark exists).
 * @param watermark    updated_at to scan FROM (ASC). NULL = start from the
 *                     oldest row in the partition (full backfill).
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

  // Pull the existing hash set from vectorDb. Failure is non-fatal: we
  // fall back to "every candidate is unembedded" rather than aborting
  // the entire tick.
  const vectorHashes = await loadVectorHashes(vectorDb);
  console.log(`[embed] Loaded ${vectorHashes.size} existing embeddings from vectordb`);

  let candidates: Array<{ id: string; title: string; description: string | null; price: number | null; updated_at: Date }>;

  if (countryCode) {
    // BUY-76503: partition-sweep path.
    // Scan ONE country partition in updated_at ASC order, starting from watermark.
    // watermark NULL → no lower bound (full backfill from oldest row).
    //
    // SCAN_LIMIT vs BATCH_LIMIT: we scan many more rows than we embed to advance
    // the watermark quickly past already-embedded / uninteresting products.
    // The hash-gate filters candidates after the scan; only the top
    // `batchLimit` by recency within the scan window get embedded.
    const scanLimit = parseInt(process.env.EMBED_SCAN_LIMIT ?? String(Math.max(batchLimit * 10, 1000)), 10);
    const watermarkCondition = watermark
      ? 'AND p.updated_at > $2'
      : '';
    const params = watermark
      ? [countryCode, watermark, scanLimit]
      : [countryCode, scanLimit];
    const paramIdx = watermark ? 3 : 2;

    const { rows } = await sourceDb.query<{
      id: string; title: string; description: string | null; price: number | null; updated_at: Date;
    }>(
      `SELECT p.id, p.title, p.description, p.price, p.updated_at
       FROM products_partitioned p
       WHERE p.country_code = $1
         AND p.is_active = true
         AND p.price IS NOT NULL
         ${watermarkCondition}
       ORDER BY p.updated_at ASC
       LIMIT $${paramIdx}`,
      params
    );
    candidates = rows;

    // Track the watermark to resume from: the updated_at of the last candidate.
    // If we got fewer rows than batchLimit, we've reached the end of this
    // partition — the next tick will get 0 rows and the runner will advance.
    if (candidates.length > 0) {
      nextWatermark = candidates[candidates.length - 1].updated_at;
    }
  } else {
    // Legacy fallback: full-table updated_at DESC scan (pre-BUY-76503 behavior).
    // Only used when no countryCode is provided.
    const { rows } = await sourceDb.query<{
      id: string; title: string; description: string | null; price: number | null;
    }>(
      `SELECT id, title, description, price
       FROM products
       WHERE is_active = true
         AND price IS NOT NULL
       ORDER BY updated_at DESC
       LIMIT $1`,
      [batchLimit]
    );
    candidates = rows.map(r => ({ ...r, updated_at: new Date() }));
  }

  if (candidates.length === 0) {
    console.log('[embed] Nothing to embed this run');
    return { processed: 0, skipped, errors: 0, duration_ms: Date.now() - t0, nextWatermark };
  }

  // Hash-gate filter (mirrors the original LEFT JOIN semantics):
  //   - product not in vectorDb           → embed
  //   - product in vectorDb with same hash → skip (price-only update)
  //   - product in vectorDb with diff hash → embed
  //
  // BUY-76503 sweep: scan ALL candidates before deciding which to embed.
  // The watermark must advance by the full scan window each tick — not stop
  // early when the first `batchLimit` candidates are hash-matches.
  // We embed the first `batchLimit` candidates that pass the gate; the rest
  // get scanned but deferred to next tick (hash gate will skip them then too).
  const toEmbed: typeof candidates = [];
  for (const p of candidates) {
    const fresh = textHash(p.title, p.description);
    const stored = vectorHashes.get(p.id);
    if (stored === undefined) {
      if (toEmbed.length < batchLimit) toEmbed.push(p); // not yet embedded
    } else if (stored !== fresh) {
      if (toEmbed.length < batchLimit) toEmbed.push(p); // text changed
    } else {
      skipped += 1;
    }
  }
  const products = toEmbed;

  if (products.length === 0) {
    console.log('[embed] Nothing to embed this run');
    return { processed: 0, skipped, errors: 0, duration_ms: Date.now() - t0, nextWatermark };
  }

  console.log(
    `[embed] ${products.length} products to embed in batches of ${BATCH_SIZE} ` +
    `(skipped ${skipped} up-to-date, scanned ${candidates.length})`
  );

  for (let i = 0; i < products.length; i += BATCH_SIZE) {
    const batch   = products.slice(i, i + BATCH_SIZE);
    const texts   = batch.map(p => truncate(`${p.title} ${p.description ?? ''}`));
    const hashes  = batch.map(p => textHash(p.title, p.description));

    let embeddings: number[][];
    try {
      embeddings = await fetchDocumentEmbeddings(texts, apiKey);
    } catch (err) {
      console.error(`[embed] Flow AI API error on batch ${Math.floor(i / BATCH_SIZE) + 1}:`, err);
      errors += batch.length;
      continue;
    }

    if (embeddings.length !== batch.length) {
      console.error(
        `[embed] Flow AI returned ${embeddings.length} vectors for batch of ${batch.length} — skipping`
      );
      errors += batch.length;
      continue;
    }

    const client = await vectorDb.connect();
    try {
      await client.query('BEGIN');
      for (let j = 0; j < batch.length; j++) {
        const vectorStr = `[${embeddings[j].join(',')}]`;
        // BUY-76567: write to embedding_v2 (1024-dim), never touch embedding (512-dim)
        // ON CONFLICT updates embedding_v2 + text_hash + model_ver + embedded_at.
        // The old 512-dim `embedding` column is preserved for rollback safety.
        await client.query(
          `INSERT INTO product_embeddings (product_id, embedding_v2, text_hash, model_ver, embedded_at)
           VALUES ($1, $2::vector, $3, $4, now())
           ON CONFLICT (product_id) DO UPDATE
             SET embedding_v2 = EXCLUDED.embedding_v2,
                 text_hash    = EXCLUDED.text_hash,
                 model_ver    = EXCLUDED.model_ver,
                 embedded_at  = now()
           WHERE product_embeddings.text_hash != EXCLUDED.text_hash
              OR product_embeddings.model_ver != EXCLUDED.model_ver`,
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
 * BUY-76567: Embed a single query text for search-time use via Flow AI.
 * Returns a vector string suitable for pgvector (<=> operator).
 */
export async function embedQuery(query: string, apiKey: string): Promise<string> {
  const values = await fetchQueryEmbedding(query, apiKey);
  return `[${values.join(',')}]`;
}
