# BUY-53615 safe-data-cleanup sweep

Timestamp: 2026-06-19T14:21:30Z
Date: 2026-06-19

## Summary

- No new issue-thread comment was included in the wake payload; the assignment itself triggered this sweep.
- The working tree still does not contain `scripts/buy-53125-safe-data-cleanup.sh`, so this heartbeat recovered the helper from commit `9640cc59db9b7780ed4c60f009e170fe905fa904` and reused its exact retention rules.
- Ran the recovered helper in dry-run mode first with `DATA_DIR` pinned to this checkout and an issue-local report path.
- The dry run found one retained Carousell snapshot already within policy and twenty `data/buy-48198-disk-monitor-*` directories against a keep-two policy.
- Applied the same narrow sweep in place and removed the oldest eighteen monitor directories.

## Verification

- Dry-run summary before apply: `removed=18 reclaimed_kb=360`
- Apply summary: `removed=18 reclaimed_kb=360`
- Removed monitor directories:
  - `data/buy-48198-disk-monitor-2026-06-19T123515Z`
  - `data/buy-48198-disk-monitor-2026-06-19T125001Z`
  - `data/buy-48198-disk-monitor-2026-06-19T125501Z`
  - `data/buy-48198-disk-monitor-2026-06-19T130001Z`
  - `data/buy-48198-disk-monitor-2026-06-19T130501Z`
  - `data/buy-48198-disk-monitor-2026-06-19T131001Z`
  - `data/buy-48198-disk-monitor-2026-06-19T131501Z`
  - `data/buy-48198-disk-monitor-2026-06-19T132001Z`
  - `data/buy-48198-disk-monitor-2026-06-19T132501Z`
  - `data/buy-48198-disk-monitor-2026-06-19T133001Z`
  - `data/buy-48198-disk-monitor-2026-06-19T133501Z`
  - `data/buy-48198-disk-monitor-2026-06-19T134018Z`
  - `data/buy-48198-disk-monitor-2026-06-19T134518Z`
  - `data/buy-48198-disk-monitor-2026-06-19T135017Z`
  - `data/buy-48198-disk-monitor-2026-06-19T135518Z`
  - `data/buy-48198-disk-monitor-2026-06-19T140018Z`
  - `data/buy-48198-disk-monitor-2026-06-19T140517Z`
  - `data/buy-48198-disk-monitor-2026-06-19T141017Z`
- Remaining retained monitor directories after apply:
  - `data/buy-48198-disk-monitor-2026-06-19T141517Z`
  - `data/buy-48198-disk-monitor-2026-06-19T142016Z`
- Retained Carousell snapshot:
  - `data/carousell-sg/products_20260516_022805.jsonl`
- Post-cleanup disk state:

```text
Filesystem      Size  Used Avail Use% Mounted on
/dev/vda1       193G  162G   32G  84% /
```

- Post-cleanup `data/` size:

```text
505M  data
```

## Notes

- The authoritative dry-run log for this issue is `reports/BUY-53615-safe-data-cleanup-report.dryrun.txt`.
- The authoritative apply log for this issue is `reports/BUY-53615-safe-data-cleanup-report.txt`.
- This heartbeat only removed script-selected stale `data/buy-48198-disk-monitor-*` directories and did not modify any of the other unrelated worktree changes already present in the workspace.
