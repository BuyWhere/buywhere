# BUY-53534 safe-data-cleanup sweep

Timestamp: 2026-06-19T11:34:24Z
Date: 2026-06-19

## Summary

- No new issue-thread comment was included in the wake payload; the assignment itself triggered this sweep.
- The working tree still does not contain `scripts/buy-53125-safe-data-cleanup.sh`, so this heartbeat recovered the helper from commit `9640cc59db9b7780ed4c60f009e170fe905fa904` and reused its exact retention rules.
- Ran the recovered helper in dry-run mode first with `DATA_DIR` pinned to this checkout and an issue-local report path.
- The dry run found one retained Carousell snapshot already within policy and seven `data/buy-48198-disk-monitor-*` directories against a keep-two policy.
- Applied the same narrow sweep in place and removed the oldest five monitor directories.

## Verification

- Dry-run summary before apply: `removed=5 reclaimed_kb=100`
- Apply summary: `removed=5 reclaimed_kb=100`
- Removed monitor directories:
  - `data/buy-48198-disk-monitor-2026-06-19T105515Z`
  - `data/buy-48198-disk-monitor-2026-06-19T110016Z`
  - `data/buy-48198-disk-monitor-2026-06-19T110516Z`
  - `data/buy-48198-disk-monitor-2026-06-19T111515Z`
  - `data/buy-48198-disk-monitor-2026-06-19T112016Z`
- Remaining retained monitor directories after apply:
  - `data/buy-48198-disk-monitor-2026-06-19T112515Z`
  - `data/buy-48198-disk-monitor-2026-06-19T113015Z`
- Retained Carousell snapshot:
  - `data/carousell-sg/products_20260516_022805.jsonl`
- Post-cleanup disk state:

```text
Filesystem      Size  Used Avail Use% Mounted on
/dev/vda1       193G  158G   35G  82% /
```

- Post-cleanup `data/` size:

```text
506M  data
```

## Notes

- The authoritative per-path deletion log for this issue is `reports/BUY-53534-safe-data-cleanup-report.txt`.
- No code changes were required for the sweep itself; the durable artifacts for this heartbeat are the issue-local reports plus the retained-on-disk state above.
