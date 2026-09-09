# BUY-72555 catalog.products zombie-VACUUM guard

`catalog.products` must be maintained by PostgreSQL autovacuum. Manual `VACUUM` on this table caused the Tune #692 cold-arm pattern: long-running `VACUUM ANALYZE` on the primary waited on `AioIoCompletion` while product reads piled up on `DataFileRead`.

## Durable guard

- Hourly monitor: `scripts/run-buy72555-zombie-vacuum-guard-cron.sh`
- Installer: `scripts/setup-buy72555-zombie-vacuum-guard-cron.sh`
- State: `data/buy72555-zombie-vacuum-guard-state.json`
- Latest report: `data/reports/buy72555-zombie-vacuum-guard-latest.json`
- Alert condition: `n_mod_since_analyze > 1000000` and `autovacuum_count` delta is `0` for more than 30 minutes.
- Config sanity gate: effective `autovacuum_vacuum_scale_factor <= 0.05` and `autovacuum_vacuum_threshold <= 5000`.
- Owner/DBA reloption handoff: `scripts/dba/buy72555-products-autovacuum-reloptions.sql`.

The script reads the catalog DSN from `CATALOG_DATABASE_URL`, `DATABASE_URL`, or `data/.catalog_db_url`. Never point it at `roundhouse`; that is the Paperclip control-plane database.

## Manual-VACUUM escape

Do not run manual `VACUUM` or `VACUUM FULL` on `catalog.products` during Tune cycle windows. Tune cycles run every 70 minutes from 06:20Z onward, so unsafe starts include 06:20Z, 07:30Z, 08:40Z, 09:50Z, 11:00Z, 12:10Z, 13:20Z, 14:30Z, 15:40Z, 16:50Z, 18:00Z, 19:10Z, 20:20Z, 21:30Z, 22:40Z, and 23:50Z.

If maintenance is unavoidable:

1. Prefer online `pg_repack` over `VACUUM FULL`.
2. Verify no Tune cycle window is active or about to start.
3. Use `scripts/dba/catalog-products-vacuum-singleflight.sql`, which takes the `catalog.vacuum.products` advisory lock before running `VACUUM (ANALYZE)`.
4. Stop if the lock is already held; stacked manual vacuums recreate the incident pattern.

Example:

```bash
psql "$(cat data/.catalog_db_url)" -f scripts/dba/catalog-products-vacuum-singleflight.sql
```

## Operator checks

Use bounded queries only:

```sql
SELECT n_mod_since_analyze, last_autovacuum, autovacuum_count, reloptions
FROM pg_stat_all_tables s
JOIN pg_class c ON c.relname = s.relname
JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = s.schemaname
WHERE s.schemaname = 'catalog' AND s.relname = 'products';

SELECT name, setting, unit
FROM pg_settings
WHERE name IN ('autovacuum', 'autovacuum_naptime', 'autovacuum_vacuum_scale_factor', 'autovacuum_vacuum_threshold');
```

Healthy starting point: autovacuum enabled, naptime around 60 seconds, table or cluster vacuum scale factor no higher than `0.05`, and vacuum threshold no higher than `5000`.
