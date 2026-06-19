# BUY-53423 safe-data-cleanup sweep

Timestamp: 2026-06-19T07:19:12Z
Date: 2026-06-19

## Summary

- No new issue-thread comment was included in the wake payload; the assignment itself triggered this sweep.
- The current checkout no longer had `scripts/buy-53125-safe-data-cleanup.sh` on disk, so I recovered its exact retention rules from commit `9640cc59db9b7780ed4c60f009e170fe905fa904` before acting.
- Ran an issue-local dry run using the recovered helper semantics and confirmed the workspace was far above retention on both eligible classes:
  - `data/carousell-sg/products_*.jsonl`: `37` snapshots with policy `keep=1`
  - `data/buy-48198-disk-monitor-*`: `7` directories with policy `keep=2`
- Applied that same narrow retention sweep in place.
- Removed `41` stale artifacts and reclaimed `2168680 KB` according to the issue-local deletion log.

## Verification

- Dry-run summary before apply: `removed=41 reclaimed_kb=2168680`
- Apply summary: `removed=41 reclaimed_kb=2168680`
- Remaining retained Carousell snapshot after apply:
  - `data/carousell-sg/products_20260516_022805.jsonl`
- Remaining retained disk-monitor directories after apply:
  - `data/buy-48198-disk-monitor-2026-06-19T071016Z`
  - `data/buy-48198-disk-monitor-2026-06-19T071516Z`
- Post-cleanup disk state:

```text
Filesystem      Size  Used Avail Use% Mounted on
/dev/vda1       193G  155G   38G  81% /
```

- Post-cleanup `data/` size:

```text
505M  data
```

## Notes

- The authoritative per-path deletion log for this issue is `reports/BUY-53423-safe-data-cleanup-report.txt`.
- Because the tracked helper script was absent from the working tree, this heartbeat matched its last committed behavior rather than inventing a new cleanup policy.
