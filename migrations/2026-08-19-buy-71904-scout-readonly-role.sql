-- BUY-71904: Scout dedup read path
-- Target: catalog DB (sakura proxy)
-- Applied: 2026-08-19 (Oracle)
-- Surface: parent BUY-71902, child BUY-71904

-- 1. New dedicated read-only role (no membership in buywhere_ingest or any other role)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'scout_readonly') THEN
    CREATE ROLE scout_readonly LOGIN PASSWORD 'ScoutRO-72kf9xV3pLqB8mQ4';
  END IF;
END
$$;

-- 2. Schema usage + minimal column grant (column-level grant does not require table-level SELECT)
GRANT USAGE ON SCHEMA public TO scout_readonly;
GRANT SELECT (domain) ON TABLE public.merchants TO scout_readonly;

-- Verification (run separately)
--   SELECT rolname, rolcanlogin, rolsuper FROM pg_roles WHERE rolname = 'scout_readonly';
--   SELECT grantee, column_name, privilege_type
--     FROM information_schema.column_privileges
--    WHERE grantee = 'scout_readonly' AND table_name = 'merchants';