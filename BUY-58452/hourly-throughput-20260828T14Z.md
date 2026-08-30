# HOURLY THROUGHPUT REPORT — 20260828T14Z (v6.4)

- Verdict: **PASS**
- Target: 150,000 inserts/hour
- Decision source: delta_ins_from_stats
- delta_ins_from_stats: 251,719 (167.8%)
- n_tup_ins: 14,484,499 → 14,736,218
- n_tup_upd: 22,994,663
- n_live_tup: 375,079,068 (n_live_tup_delta: 241,264)
- live_count / live_count_delta: NULL
- ingestion_runs: 8 runs; ing_inserted: 125 (observability only); ing_updated: 243
- stats_mismatch_detected: true — ingestion_runs.ing_inserted 125 < target 150000 while delta_ins_from_stats 251719 >= target (non-blocking; rule 5a/5b primary signal authoritative)
- stat_reset_detected: false
- canonical_throughput_hourly: upsert confirmed for 2026-08-28 14:00:00+00
- DB: sakura.proxy.rlwy.net:22987/railway
