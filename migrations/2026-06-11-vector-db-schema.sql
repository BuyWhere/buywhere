-- Vector DB Schema (applies to vector-db Railway service, NOT the main catalog DB)
-- Connection: acela.proxy.rlwy.net:32575 / vectordb
-- Applied: 2026-06-11 by BUY-41135
--
-- This is the schema for the SEPARATE vector store (pgvector 0.8.2 on PG 17).
-- Do NOT apply to roundhouse or maglev.

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS product_embeddings (
  product_id   UUID PRIMARY KEY,
  embedding    vector(512) NOT NULL,
  text_hash    CHAR(32)    NOT NULL,   -- md5(title || ' ' || coalesce(description,''))
  model_ver    TEXT        NOT NULL DEFAULT 'jina-embeddings-v3',
  embedded_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- HNSW index for approximate nearest-neighbour cosine similarity
-- m=16 (edges per node), ef_construction=64 (build-time candidate pool)
-- Query: SELECT ... ORDER BY embedding <=> $query_vec LIMIT 10
CREATE INDEX IF NOT EXISTS idx_pe_hnsw
  ON product_embeddings
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- Pipeline state table for resumable backfill tracking (optional)
CREATE TABLE IF NOT EXISTS embedding_pipeline_state (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Scale note: at 100M products, migrate embedding column to halfvec(512)
-- to halve storage from ~200GB to ~100GB.
-- ALTER TABLE product_embeddings ALTER COLUMN embedding TYPE halfvec(512);
-- DROP INDEX idx_pe_hnsw;
-- CREATE INDEX idx_pe_hnsw ON product_embeddings USING hnsw (embedding halfvec_cosine_ops) WITH (m=16, ef_construction=64);
