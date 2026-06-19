# BUY-53467 safe-data-cleanup sweep

Timestamp: 2026-06-19T09:02:07Z
Date: 2026-06-19

## Summary

- No new issue-thread comment was included in the wake payload; the assignment itself triggered this sweep.
- The working tree still does not contain `scripts/buy-53125-safe-data-cleanup.sh`, so this heartbeat recovered the helper from commit `9640cc59db9b7780ed4c60f009e170fe905fa904` and reused its exact retention rules.
- A first probe from `/tmp` exposed a path-resolution trap: the helper's default `ROOT_DIR` resolved to `/`, so the dry run targeted `//data` and removed nothing. I reran immediately with `DATA_DIR` pinned to this checkout to keep behavior aligned with the original helper while acting on the real workspace.
- The corrected dry run found one retained Carousell snapshot already within policy and eleven `data/buy-48198-disk-monitor-*` directories against a keep-two policy.
- Applied the same narrow sweep in place and removed the oldest nine monitor directories.

## Verification

- Dry-run summary before apply: `removed=9 reclaimed_kb=180`
- Apply summary: `removed=9 reclaimed_kb=180`
- Removed monitor directories:
  - `data/buy-48198-disk-monitor-2026-06-19T082516Z`
  - `data/buy-48198-disk-monitor-2026-06-19T083016Z`
  - `data/buy-48198-disk-monitor-2026-06-19T083517Z`
  - `data/buy-48198-disk-monitor-2026-06-19T083826Z`
  - `data/buy-48198-disk-monitor-2026-06-19T084016Z`
  - `data/buy-48198-disk-monitor-2026-06-19T084228Z`
  - `data/buy-48198-disk-monitor-2026-06-19T084256Z`
  - `data/buy-48198-disk-monitor-2026-06-19T084517Z`
  - `data/buy-48198-disk-monitor-2026-06-19T085017Z`
- Remaining retained monitor directories after apply:
  - `data/buy-48198-disk-monitor-2026-06-19T085518Z`
  - `data/buy-48198-disk-monitor-2026-06-19T090016Z`
- Remaining retained monitor directory sizes:
  - `20 KB data/buy-48198-disk-monitor-2026-06-19T085518Z`
  - `20 KB data/buy-48198-disk-monitor-2026-06-19T090016Z`
- Retained Carousell snapshot:
  - `data/carousell-sg/products_20260516_022805.jsonl`
- Post-cleanup disk state:

```text
Filesystem      Size  Used Avail Use% Mounted on
/dev/vda1       193G  156G   37G  81% /
```

- Post-cleanup `data/` size:

```text
505M  data
```

## Notes

- The authoritative per-path deletion log for this issue is `reports/BUY-53467-safe-data-cleanup-report.txt`.
- No code changes were required for the sweep itself; the durable artifact for this heartbeat is the issue-local report plus the retained-on-disk state above.
