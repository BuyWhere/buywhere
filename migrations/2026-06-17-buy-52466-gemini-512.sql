-- BUY-52466: switch from Jina/Cohere to Google gemini-embedding-001 (512-dim)
--
-- The vector DB (vectordb) already has `product_embeddings` with `vector(512)`,
-- the same dim we want for Gemini. The dimension is unchanged — only the
-- model identifier needs to be updated. The previous Jina/Cohere path never
-- wrote any rows to prod (verified empty in BUY-52089 evidence 2026-06-15),
-- so this is a metadata-only migration:
--   1. Update the `model_ver` default to reflect the new producer
--   2. Backfill `model_ver` on any stale rows (e.g. from local dev / tests)
--   3. Refresh the schema timestamp in `embedding_pipeline_state` so the
--      embed-runner logs show post-migration.
--
-- Connection: acela.proxy.rlwy.net:32575 / vectordb
-- Apply with: psql "$VECTOR_DB_URL" -f migrations/2026-06-17-buy-52466-gemini-512.sql

BEGIN;

-- 1. New default for any future INSERTs
ALTER TABLE product_embeddings
  ALTER COLUMN model_ver SET DEFAULT 'gemini-embedding-001@512';

-- 2. Backfill existing rows (none expected in prod, but safe)
UPDATE product_embeddings
   SET model_ver = 'gemini-embedding-001@512',
       embedded_at = now()
 WHERE model_ver IS DISTINCT FROM 'gemini-embedding-001@512';

-- 3. Stamp migration so embed-runner / dashboards reflect the model switch
INSERT INTO embedding_pipeline_state (key, value, updated_at)
VALUES
  ('model', 'gemini-embedding-001@512', now()),
  ('dimensions', '512', now()),
  ('task_type_query', 'RETRIEVAL_QUERY', now()),
  ('task_type_index', 'RETRIEVAL_DOCUMENT', now()),
  ('migrated_from', 'jina-embeddings-v3+cohere-embed-multilingual-v3.0', now()),
  ('migrated_at', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), now())
ON CONFLICT (key) DO UPDATE
  SET value = EXCLUDED.value,
      updated_at = EXCLUDED.updated_at;

COMMIT;

-- Verify
SELECT model_ver, count(*), max(embedded_at) AS latest
  FROM product_embeddings
 GROUP BY model_ver;
