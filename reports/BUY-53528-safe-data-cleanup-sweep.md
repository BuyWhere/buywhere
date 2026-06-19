# BUY-53528 safe-data-cleanup sweep

Timestamp: 2026-06-19T11:02:55Z
Date: 2026-06-19

## Summary

- No new issue-thread comment was included in the wake payload; the assignment itself triggered this sweep.
- The working tree still does not contain `scripts/buy-53125-safe-data-cleanup.sh`, so this heartbeat recovered the helper from commit `9640cc59db9b7780ed4c60f009e170fe905fa904` and reused its exact retention rules.
- Ran the recovered helper in dry-run mode first with `DATA_DIR` pinned to this checkout and an issue-local report path.
- The dry run found one retained Carousell snapshot already within policy and eight `data/buy-48198-disk-monitor-*` directories against a keep-two policy.
- Applied the same narrow sweep in place and removed the oldest six monitor directories.

## Verification

- Dry-run summary before apply: `removed=6 reclaimed_kb=120`
- Apply summary: `removed=6 reclaimed_kb=120`
- Removed monitor directories:
  - `data/buy-48198-disk-monitor-2026-06-19T102516Z`
  - `data/buy-48198-disk-monitor-2026-06-19T103016Z`
  - `data/buy-48198-disk-monitor-2026-06-19T103515Z`
  - `data/buy-48198-disk-monitor-2026-06-19T104017Z`
  - `data/buy-48198-disk-monitor-2026-06-19T104516Z`
  - `data/buy-48198-disk-monitor-2026-06-19T105015Z`
- Remaining retained monitor directories after apply:
  - `data/buy-48198-disk-monitor-2026-06-19T105515Z`
  - `data/buy-48198-disk-monitor-2026-06-19T110016Z`
- Retained Carousell snapshot:
  - `data/carousell-sg/products_20260516_022805.jsonl`
- Post-cleanup disk state:

```text
Filesystem      Size  Used Avail Use% Mounted on
/dev/vda1       193G  169G   25G  88% /
```

- Post-cleanup `data/` size:

```text
506M  data
```

## Notes

- The authoritative per-path deletion log for this issue is `reports/BUY-53528-safe-data-cleanup-report.txt`.
- No code changes were required for the sweep itself; the durable artifacts for this heartbeat are the issue-local reports plus the retained-on-disk state above.
