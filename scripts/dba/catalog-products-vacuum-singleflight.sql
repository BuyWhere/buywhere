-- BUY-72555: emergency manual VACUUM wrapper for catalog.products.
-- Prefer autovacuum. Use this only outside Tune cycle windows and only when
-- the operator has first verified the online alternative (pg_repack) is not available.
\set ON_ERROR_STOP on
SET application_name = 'buy72555-products-vacuum-singleflight';
SET statement_timeout = '20min';
SET lock_timeout = '5s';

WITH lock_attempt AS (
  SELECT pg_try_advisory_lock(hashtextextended('catalog.vacuum.products', 0)) AS acquired
)
SELECT acquired, CASE
  WHEN acquired THEN 'acquired catalog.vacuum.products advisory lock'
  ELSE 'another catalog.products vacuum already holds catalog.vacuum.products'
END AS status
FROM lock_attempt
\gset

\if :acquired
  VACUUM (ANALYZE, VERBOSE) catalog.products;
  SELECT pg_advisory_unlock(hashtextextended('catalog.vacuum.products', 0)) AS released;
\else
  \echo 'Skipping VACUUM; single-flight guard rejected this run.'
  \quit 3
\endif
