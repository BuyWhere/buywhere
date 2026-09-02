# HOURLY THROUGHPUT REPORT — 20260829T10Z (v6.4)

- Verdict: **FAIL**
- Target: 150,000 inserts/hour
- Decision source: delta_ins_from_stats
- Decision reason: delta_ins_from_stats 47,821 < 150,000 and no v6 guard met target
- delta_ins_from_stats: 47,821 (31.9%)
- n_live_tup_delta: 30,129
- live_count_delta: NULL
- ingestion_runs.ing_inserted: 5,039 (observability only unless delta_ins_from_stats is NULL)
- ingestion_runs.ing_updated: 117,630
- ingestion_runs runs: 120
- stats_mismatch_detected: false
- stat_reset_detected: false
- cycle_marker_inserted: 0 (0.0%)
- cycle_marker_cycles: 0

## Raw canonical_throughput_hourly row (sakura.proxy.rlwy.net:22987)

| hour_start | n_tup_ins | n_tup_upd | n_live_tup | ing_inserted | ing_updated | stat_reset |
|---|---|---|---|---|---|---|
| 2026-08-29 10:00:00+00 | 16,677,403 | 26,234,400 | 365,571,333 | 5,039 | 117,630 | false |
| 2026-08-29 09:00:00+00 | 16,629,582 | 25,962,753 | 365,541,204 | 31,290 | 805,219 | true  |

delta_ins_from_stats = 16,677,403 − 16,629,582 = **47,821**.

## Notes

- Cron run at 2026-08-29T11:11:00Z (`0 * * * *` /etc/cron.d/buywhere-dispatcher-hourly,
  BUY-76769) executed dispatcher_v6_hourly.js successfully: canonical_throughput_hourly
  upsert confirmed, verdict FAIL, child issue **BUY-77142** filed against parent
  BUY-29861 and assigned to MRfjkCUzuFyLTtKHcVLDaJxoAAWxM7b6, and
  `failure_issue_id=8096b6d2-8952-457e-b4f2-e735deeb56f0` was backfilled on the
  canonical row.
- This is a **GENUINE FAIL** — non-null `delta_ins_from_stats=47,821` (31.9% of target)
  with corroborating `n_live_tup_delta=30,129`, so the v6 forbidden-pattern guards
  (5b/6.4) do not fire; the verdict is authoritative.
- Preceded by 09Z which was FAIL on a true stat reset (delta_ins NULL,
  ing_inserted 31,290 < target) → BUY-77122. The 09Z stat reset is unrelated to
  the 10Z decision (10Z has a valid consecutive-hour delta).
- The 10Z hour is 18:00–19:00 SGT — within APAC working hours, so this is not a
  timezone trough. Dedup/validation losses (ing_inserted 5,039 vs delta_ins 47,821
  is closer than the 02Z hour; here the gap is the opposite direction: stats grew
  more than the application layer reported). Most of the catalog growth is being
  driven by drain / catchup writers that don't write `ingestion_runs` — exactly
  what the v6 spec was built to capture.
- The child ticket BUY-77142 carries the same report inline; no further dispatcher
  action is needed. PASS condition (>= 150,000) was not met, so no comment is
  posted on BUY-29861 per spec step 7.

## Recovery context (this heartbeat)

- Wake reason `finish_successful_run_handoff` for BUY-77143 (this issue, the
  dispatcher itself). The cron already produced the verdict, upsert, and child
  ticket before this heartbeat started; the recovery step is to post a
  disposition comment + set BUY-77143 to `done`.
- API access: Paperclip `/api/issues/{id}` reachable at the time of this comment.
