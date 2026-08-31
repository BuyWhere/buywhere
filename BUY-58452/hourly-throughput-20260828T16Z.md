# HOURLY THROUGHPUT REPORT — 20260828T16Z (v6.4)

- Verdict: **PASS**
- Target: 150,000 inserts/hour
- Decision source: delta_ins_from_stats
- Decision reason: delta_ins_from_stats 168,699 >= 150,000
- delta_ins_from_stats: 168,699 (112.5%)
- n_live_tup_delta: 164,137
- live_count_delta: NULL
- ingestion_runs.ing_inserted: 3,036 (observability only unless delta_ins_from_stats is NULL)
- stats_mismatch_detected: true — ingestion_runs.ing_inserted 3036 < target 150000 while delta_ins_from_stats 168699 >= target
- stat_reset_detected: false
- cycle_marker_inserted: 0 (0.0%)
- cycle_marker_cycles: 0
