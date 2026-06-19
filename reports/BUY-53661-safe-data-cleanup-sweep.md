# BUY-53661 safe-data-cleanup sweep

Timestamp: 2026-06-19T15:52:49Z
Date: 2026-06-19

## Summary

- No new issue-thread comment was included in the wake payload; the assignment itself triggered this sweep.
- The working tree still does not contain `scripts/buy-53125-safe-data-cleanup.sh`, so this heartbeat reused the exact helper from commit `9640cc59db9b7780ed4c60f009e170fe905fa904`.
- Ran the recovered helper in dry-run mode first with `DATA_DIR` pinned to this checkout and an issue-local report path.
- The dry run found one retained Carousell snapshot already within policy and eight `data/buy-48198-disk-monitor-*` directories against a keep-two policy.
- Applied the same narrow sweep in place and removed the oldest six monitor directories.

## Verification

- Dry-run summary before apply: `removed=6 reclaimed_kb=120`
- Apply summary: `removed=6 reclaimed_kb=120`
- Removed monitor directories:
  - `data/buy-48198-disk-monitor-2026-06-19T151517Z`
  - `data/buy-48198-disk-monitor-2026-06-19T152016Z`
  - `data/buy-48198-disk-monitor-2026-06-19T152516Z`
  - `data/buy-48198-disk-monitor-2026-06-19T153016Z`
  - `data/buy-48198-disk-monitor-2026-06-19T153516Z`
  - `data/buy-48198-disk-monitor-2026-06-19T154018Z`
- Remaining retained monitor directories after apply:
  - `data/buy-48198-disk-monitor-2026-06-19T154516Z`
  - `data/buy-48198-disk-monitor-2026-06-19T155016Z`
- Retained Carousell snapshot:
  - `data/carousell-sg/products_20260516_022805.jsonl`
- Post-cleanup disk state:

```text
Filesystem      Size  Used Avail Use% Mounted on
/dev/vda1       193G  164G   30G  85% /
```

- Post-cleanup `data/` size:

```text
505M  data
```

## Notes

- The authoritative dry-run log for this issue is `reports/BUY-53661-safe-data-cleanup-report.dryrun.txt`.
- The authoritative apply log for this issue is `reports/BUY-53661-safe-data-cleanup-report.txt`.
- This heartbeat only removed script-selected stale `data/buy-48198-disk-monitor-*` directories and did not modify any of the other unrelated worktree changes already present in the workspace.
