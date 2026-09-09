# BUY-74584 throughput triage — 2026-08-28T08:28Z

## Scope

Read-only triage for the historical 2026-08-25 01:00–02:00 UTC hourly throughput failure.

## Evidence

- Catalog DSN source: `data/.catalog_db_url`; guard checked and refused any `roundhouse` DSN.
- Original failure window remains a true fail: 2026-08-25 01:00 UTC recorded `delta_ins_from_stats=42612`, `ing_runs=1`, `ing_inserted=148`, `ing_updated=35235`.
- Only ingestion source in that hour was `ingest:ops-drain-svc:stock`, with `148` inserts and `35235` updates, so the miss was not a false negative from app-layer run attribution.
- Latest canonical rows at check time covered only through 2026-08-28 04:00 UTC, recorded at 2026-08-28 05:00:03 UTC; dispatcher freshness is behind current time.
- Recent canonical results show partial recovery: 2026-08-28 02:00 UTC `PASS` with `1744495`, 03:00 UTC `PASS` with `1329911`, 04:00 UTC `PASS` with `265678` net products added.
- Last 24h ingestion_runs observability: `6102` runs, `11571` rows_inserted, `90767` rows_updated, latest finished_at 2026-08-28 08:23:19 UTC.
- Local `data/` drain check found no pending `.jsonl`/`.ndjson` product backlog; only the stale-kills report JSONL was present.

## Disposition

More work remains: restore/verify dispatcher freshness for the missing post-04:00 UTC hourly rows, then close historical failure once current hourly monitoring is fresh and stable.
