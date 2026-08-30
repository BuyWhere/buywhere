# Hourly Throughput Dispatcher Evidence — 2026-08-28T15Z

- Issue: BUY-76740
- Parent: BUY-29861
- Target hour: 2026-08-28 15:00:00 UTC
- Dispatcher run: 371d5530-e385-4c5c-ab7a-e4dd852f362f
- Catalog DSN host verified: sakura.proxy.rlwy.net:22987 (not roundhouse)
- Canonical table: canonical_throughput_hourly
- Upsert confirmation: row present for hour_start=2026-08-28 15:00:00+00

## Canonical Metrics

- n_tup_ins: 14,950,762
- prior n_tup_ins: 14,736,218
- delta_ins_from_stats: 214,544
- n_tup_upd: 23,299,085
- prior n_tup_upd: 22,994,663
- delta_upd_from_stats: 304,422
- n_live_tup: 363,959,720
- prior n_live_tup: 375,079,068
- n_live_tup_delta: -11,119,348
- live_count: unavailable / intentionally not used (count timed out on 363M+ row table)
- stat_reset_detected: false

## ingestion_runs Observability

- ing_run_count / ing_runs: 8
- ing_inserted: 25
- ing_updated: 72

## v6/v6.4 Decision

PASS. The primary authoritative metric is delta_ins_from_stats, and 214,544 >= 150,000. Per v6 rule 5a/5b, the hour passes regardless of secondary metrics. ingestion_runs remains observability-only and must not create a failure when delta_ins_from_stats is non-null and above target.

Stored row reports last_check_result=PASS and last_check_reason="delta_ins_from_stats=214544 >= 150000 target; primary metric authoritative".
