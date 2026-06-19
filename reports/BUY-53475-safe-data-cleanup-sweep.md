# BUY-53475 safe-data-cleanup sweep

Timestamp: 2026-06-19T09:18:20Z
Date: 2026-06-19

## Summary

- No new issue-thread comment was included in the wake payload; the assignment itself triggered this sweep.
- The working tree still does not contain `scripts/buy-53125-safe-data-cleanup.sh`, so this heartbeat recovered the helper from commit `9640cc59db9b7780ed4c60f009e170fe905fa904` and reused its exact retention rules.
- Ran the helper in dry-run mode first with `DATA_DIR` pinned to this checkout and an issue-local report path: `REPORT_PATH=reports/BUY-53475-safe-data-cleanup-report.txt DATA_DIR="$PWD/data"`.
- The dry run found one retained Carousell snapshot already within the keep-one policy and five `data/buy-48198-disk-monitor-*` directories against a keep-two policy.
- Applied the same narrow sweep in place and removed the oldest three monitor directories.

## Verification

- Dry-run summary before apply: `removed=3 reclaimed_kb=60`
- Apply summary: `removed=3 reclaimed_kb=60`
- Removed monitor directories:
  - `data/buy-48198-disk-monitor-2026-06-19T085518Z`
  - `data/buy-48198-disk-monitor-2026-06-19T090016Z`
  - `data/buy-48198-disk-monitor-2026-06-19T090517Z`
- Remaining retained monitor directories after apply:
  - `data/buy-48198-disk-monitor-2026-06-19T091017Z`
  - `data/buy-48198-disk-monitor-2026-06-19T091517Z`
- Remaining retained monitor directory sizes:
  - `20 KB data/buy-48198-disk-monitor-2026-06-19T091017Z`
  - `20 KB data/buy-48198-disk-monitor-2026-06-19T091517Z`
- Retained Carousell snapshot:
  - `data/carousell-sg/products_20260516_022805.jsonl`
- Post-cleanup disk state:

```text
Filesystem      Size  Used Avail Use% Mounted on
/dev/vda1       193G  157G   37G  82% /
```

- Post-cleanup `data/` size:

```text
505M  data
```

## Notes

- The authoritative per-path deletion log for this issue is `reports/BUY-53475-safe-data-cleanup-report.txt`.
- `df` remained noisy at this scale, so the deletion log plus the retained-on-disk directory listing are the authoritative proof of reclaimed workspace data.
- No code changes were required for the sweep itself; the durable artifacts for this heartbeat are the issue-local report and the retained-on-disk state above.
