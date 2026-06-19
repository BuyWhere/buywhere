# BUY-53569 safe-data-cleanup sweep

Timestamp: 2026-06-19T12:50:48Z
Date: 2026-06-19

## Summary

- No new issue-thread comment was included in the wake payload; the assignment itself triggered this sweep.
- The working tree still does not contain `scripts/buy-53125-safe-data-cleanup.sh`, so this heartbeat recovered the helper from commit `9640cc59db9b7780ed4c60f009e170fe905fa904` and reused its exact retention rules.
- Ran the recovered helper in dry-run mode first with `DATA_DIR` pinned to this checkout and an issue-local report path.
- The dry run found thirty-seven stale artifacts that matched the helper's retention policy: thirty-six old `data/carousell-sg/products_*.jsonl` snapshots and one excess `data/buy-48198-disk-monitor-*` directory.
- Applied the same narrow sweep in place and removed the exact same thirty-seven paths.

## Verification

- Dry-run summary before apply: `removed=37 reclaimed_kb=2168620`
- Apply summary: `removed=37 reclaimed_kb=2168620`
- Removed disk-monitor directory:
  - `data/buy-48198-disk-monitor-2026-06-19T123019Z`
- Remaining retained monitor directories after apply:
  - `data/buy-48198-disk-monitor-2026-06-19T123515Z`
  - `data/buy-48198-disk-monitor-2026-06-19T125001Z`
- Retained Carousell snapshot:
  - `data/carousell-sg/products_20260516_022805.jsonl`
- Post-cleanup disk state:

```text
Filesystem      Size  Used Avail Use% Mounted on
/dev/vda1       193G  159G   35G  83% /
```

- Post-cleanup `data/` size:

```text
506M  data
```

## Notes

- The authoritative per-path deletion log for this issue is `reports/BUY-53569-safe-data-cleanup-report.txt`.
- No code changes were required for the sweep itself; the durable artifacts for this heartbeat are the issue-local reports plus the retained-on-disk state above.
