import { Pool } from 'pg';
import { createHash } from 'crypto';

// BUY-52328: switch query + embed-worker paths from Cohere (which 401s on
// the route-supplied Jina key) to Jina v3 at 1024-dim. Single call site for
// both code paths:
//
//   - query side:  `embedQuery(q, jinaKey)`     -> task=retrieval.query
//   - index side:  `runEmbedBatch(...)`         -> task=retrieval.passage
//
// Function signatures are unchanged so callers (routes/products.ts,
// routes/mcp.ts, jobs/embedRunner.ts) only need to read JINA_API_KEY
// instead of COHERE_API_KEY. The vector.product_embeddings schema is
// already `vector(1024)` with HNSW (m=16, ef_construction=64) and
// model_ver default `jina-embeddings-v3-1024` (verified 2026-06-17),
// so no schema migration is bundled with this fix — the dim matches.

const JINA_API_URL     = 'https://api.jina.ai/v1/embeddings';
const JINA_MODEL       = 'jina-embeddings-v3';
const MODEL_VER        = 'jina-embeddings-v3-1024';
const EMBED_DIM        = 1024;
const BATCH_SIZE       = 32;   // Jina v3 free/Pro batch max per API call
const MAX_TEXT_CHARS   = 8000; // Jina v3 input limit ~8k tokens; 32k char cap

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
 * Embed a batch of index-side texts (task=retrieval.passage). One POST per
 * up-to-BATCH_SIZE products. Jina auth uses `Authorization: Bearer <key>`.
 */
async function fetchDocumentEmbeddings(texts: string[], jinaKey: string): Promise<number[][]> {
  const res = await fetch(JINA_API_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${jinaKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: JINA_MODEL,
      task: 'retrieval.passage',
      input: texts,
      embedding_type: 'float',
      dimensions: EMBED_DIM,
      normalized: false,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Jina API ${res.status}: ${body}`);
  }
  const data = await res.json() as { data: Array<{ embedding: number[] }> };
  return data.data.map((d) => d.embedding);
}

/**
 * Embed a single query text (task=retrieval.query). Returns a vector string
 * suitable for pgvector's `<=>` cosine-distance operator.
 */
async function fetchQueryEmbedding(text: string, jinaKey: string): Promise<number[]> {
  const res = await fetch(JINA_API_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${jinaKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: JINA_MODEL,
      task: 'retrieval.query',
      input: [text],
      embedding_type: 'float',
      dimensions: EMBED_DIM,
      normalized: false,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Jina API ${res.status}: ${body}`);
  }
  const data = await res.json() as { data: Array<{ embedding: number[] }> };
  return data.data[0].embedding;
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
 * Per BUY-52328: Uses Jina v3 with dimensions=1024 and task=retrieval.passage,
 * batch size 32 (Jina v3 cap). The vector DB column is already `vector(1024)`.
 */
export async function runEmbedBatch(
  sourceDb: Pool,
  vectorDb: Pool,
  jinaKey:  string,
  batchLimit = 64,
): Promise<EmbedSummary> {
  const t0 = Date.now();
  let processed = 0, skipped = 0, errors = 0;

  const { rows: products } = await sourceDb.query<{
    id: string;
    title: string;
    description: string | null;
  }>(
    `SELECT p.id, p.title, p.description
     FROM products p
     LEFT JOIN product_embeddings pe ON pe.product_id = p.id
     WHERE p.is_active = true
       AND (
         pe.product_id IS NULL
         OR pe.text_hash != md5(p.title || ' ' || coalesce(p.description, ''))
       )
     ORDER BY p.price DESC NULLS LAST
     LIMIT $1`,
    [batchLimit]
  );

  if (products.length === 0) {
    console.log('[embed] Nothing to embed this run');
    return { processed: 0, skipped: 0, errors: 0, duration_ms: Date.now() - t0 };
  }

  console.log(`[embed] ${products.length} products to embed in batches of ${BATCH_SIZE} (Jina v3 / 1024-dim)`);

  for (let i = 0; i < products.length; i += BATCH_SIZE) {
    const batch   = products.slice(i, i + BATCH_SIZE);
    const texts   = batch.map(p => truncate(`${p.title} ${p.description ?? ''}`));
    const hashes  = batch.map(p => textHash(p.title, p.description));

    let embeddings: number[][];
    try {
      embeddings = await fetchDocumentEmbeddings(texts, jinaKey);
    } catch (err) {
      console.error(`[embed] Jina API error on batch ${Math.floor(i / BATCH_SIZE) + 1}:`, err);
      errors += batch.length;
      continue;
    }

    if (embeddings.length !== batch.length) {
      console.error(
        `[embed] Jina returned ${embeddings.length} vectors for batch of ${batch.length} — skipping`
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
  return { processed, skipped, errors, duration_ms: duration };
}

/**
 * Embed a single query text for search-time use (task=retrieval.query).
 * Returns a vector string suitable for pgvector (<=> operator).
 *
 * BUY-52328: switched from Cohere to Jina v3 at 1024-dim to match the
 * vector.product_embeddings schema and the JINA_API_KEY that routes
 * (products.ts, mcp.ts) already pass in.
 */
export async function embedQuery(query: string, jinaKey: string): Promise<string> {
  const values = await fetchQueryEmbedding(query, jinaKey);
  return `[${values.join(',')}]`;
}
