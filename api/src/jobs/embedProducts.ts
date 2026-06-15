import { Pool } from 'pg';
import { createHash } from 'crypto';

// Cohere API configuration per BUY-41133 spec
const COHERE_API_URL = 'https://api.cohere.ai/v1/embed';
const COHERE_MODEL   = 'embed-multilingual-v3.0';
const EMBED_DIM    = 1024;  // Cohere embed-multilingual-v3.0 outputs 1024-dim vectors
const BATCH_SIZE   = 64;   // BUY-41133 requirement: batch size 64 per API call
const MAX_TEXT_CHARS = 4000; // ~1000 tokens, safe for Cohere 2048-token input limit

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

async function fetchEmbeddings(texts: string[], cohereKey: string): Promise<number[][]> {
  const res = await fetch(COHERE_API_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${cohereKey}`,
      'Content-Type': 'application/json',
      'X-Client-Name': 'buywhere',
    },
    body: JSON.stringify({
      model: COHERE_MODEL,
      input_type: 'search_document', // BUY-41133 spec: use search_document for indexing
      embedding_types: ['float'],
      input: texts,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Cohere API ${res.status}: ${body}`);
  }
  const data = await res.json() as { embeddings: number[][] };
  return data.embeddings;
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
 * Per BUY-41133: Uses Cohere embed-multilingual-v3.0 with 1024-dim vectors,
 * batch size 64, and should read from replica only.
 */
export async function runEmbedBatch(
  sourceDb: Pool,
  vectorDb: Pool,
  cohereKey: string,
  batchLimit = 64, // BUY-41133 default: 64 products per run
): Promise<EmbedSummary> {
  const t0 = Date.now();
  let processed = 0, skipped = 0, errors = 0;

  // Pull products that need embedding: new or text-changed.
  // Note: sourceDb should be a replica connection (set up in embedRunner.ts)
  // to ensure replica-only reads per BUY-41133.
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

  console.log(`[embed] ${products.length} products to embed in batches of ${BATCH_SIZE}`);

  for (let i = 0; i < products.length; i += BATCH_SIZE) {
    const batch   = products.slice(i, i + BATCH_SIZE);
    const texts   = batch.map(p => truncate(`${p.title} ${p.description ?? ''}`));
    const hashes  = batch.map(p => textHash(p.title, p.description));

    let embeddings: number[][];
    try {
      embeddings = await fetchEmbeddings(texts, cohereKey);
    } catch (err) {
      console.error(`[embed] Cohere API error on batch ${Math.floor(i / BATCH_SIZE) + 1}:`, err);
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
          [batch[j].id, vectorStr, hashes[j], COHERE_MODEL]
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
 * Embed a single query text for search-time use.
 * Returns a vector string suitable for pgvector (<=> operator).
 */
export async function embedQuery(query: string, cohereKey: string): Promise<string> {
  const res = await fetch(COHERE_API_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${cohereKey}`,
      'Content-Type': 'application/json',
      'X-Client-Name': 'buywhere',
    },
    body: JSON.stringify({
      model: COHERE_MODEL,
      input_type: 'search_query', // Use search_query for query-time embedding
      embedding_types: ['float'],
      input: [truncate(query)],
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Cohere API ${res.status}: ${body}`);
  }
  const data = await res.json() as { embeddings: number[][] };
  return `[${data.embeddings[0].join(',')}]`;
}
