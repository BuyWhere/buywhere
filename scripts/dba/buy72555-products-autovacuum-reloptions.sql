-- BUY-72555: owner/DBA handoff for catalog products autovacuum reloptions.
-- Run on the BuyWhere catalog DB only, with application_name='ops-ddl'.
\set ON_ERROR_STOP on
SET application_name = 'ops-ddl BUY-72555 products autovacuum reloptions';
SET statement_timeout = '15s';
SET lock_timeout = '5s';

ALTER TABLE public.products SET (
  autovacuum_vacuum_scale_factor = 0.02,
  autovacuum_vacuum_threshold = 5000,
  autovacuum_analyze_scale_factor = 0.05,
  autovacuum_vacuum_insert_scale_factor = 0.05,
  autovacuum_vacuum_cost_limit = 2000,
  autovacuum_vacuum_cost_delay = 2,
  autovacuum_enabled = true
);

SELECT n.nspname AS schema_name, c.relname AS table_name, c.reloptions
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relname = 'products';
