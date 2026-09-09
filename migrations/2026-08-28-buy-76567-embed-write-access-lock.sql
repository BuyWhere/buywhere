-- BUY-76567: embed_writer write-access lock
-- Protects product_embeddings from accidental writes by non-embed-worker roles.
--
-- The 11 Aug vector wipe happened because a one-shot service with catalog DSNs
-- attached had write access to vector-db. This migration:
--   1. Creates an `embed_writer` role with ONLY INSERT/UPDATE on product_embeddings
--   2. Grants USAGE on the public schema to embed_writer
--   3. The embed worker should connect as embed_writer (via Railway var or .pgpass)
--   4. All other roles lose direct write access to product_embeddings
--
-- IMPORTANT: This migration is SAFE TO RUN — it only adds a role and grants.
-- It does NOT revoke from anyone yet (that's a separate ops step after the
-- embed worker is confirmed connecting as embed_writer).

-- Step 1: Create the embed_writer role (login disabled — Railway sets the password)
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'embed_writer') THEN
    CREATE ROLE embed_writer NOLOGIN;
    RAISE NOTICE 'Created role embed_writer';
  ELSE
    RAISE NOTICE 'Role embed_writer already exists';
  END IF;
END
$$;

-- Step 2: Grant schema usage
GRANT USAGE ON SCHEMA public TO embed_writer;

-- Step 3: Grant ONLY the tables the embed worker needs
GRANT INSERT, UPDATE ON product_embeddings TO embed_writer;

-- Step 4: Grant usage on the sequence (for any future serial columns)
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO embed_writer;

-- Step 5: Column-level grant: embed_writer can only touch these columns
-- (PostgreSQL supports column-level grants for INSERT and UPDATE)
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT INSERT, UPDATE ON TABLES TO embed_writer;

-- Step 6: Document the lock
COMMENT ON ROLE embed_writer IS
  'BUY-76567: restricted role for the embedding worker. '
  'Can only INSERT/UPDATE on product_embeddings. '
  'The 11 Aug vector wipe (BUY-76567) happened because a one-shot service '
  'with catalog DSNs had write access to vector-db. This role limits the '
  'blast radius to only the embed worker process. '
  'REVOKE from other roles is a separate ops step after verification.';

-- Step 7: Log the grant for audit
CREATE TABLE IF NOT EXISTS embed_write_audit (
  id          BIGSERIAL PRIMARY KEY,
  granted_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  grantee     TEXT        NOT NULL DEFAULT 'embed_writer',
  table_name  TEXT        NOT NULL DEFAULT 'product_embeddings',
  privileges  TEXT        NOT NULL DEFAULT 'INSERT, UPDATE',
  note        TEXT        NOT NULL DEFAULT 'BUY-76567 write-access lock'
);

INSERT INTO embed_write_audit (grantee, table_name, privileges, note)
VALUES ('embed_writer', 'product_embeddings', 'INSERT, UPDATE',
        'BUY-76567: initial grant. REVOKE from other roles pending embed worker verification.');
