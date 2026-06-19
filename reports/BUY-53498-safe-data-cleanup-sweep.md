# BUY-53498 safe-data-cleanup sweep

Timestamp: 2026-06-19T10:03:07Z
Date: 2026-06-19

## Summary

- No new issue-thread comment was included in the wake payload; the assignment itself triggered this sweep.
- The working tree still does not contain `scripts/buy-53125-safe-data-cleanup.sh`, so this heartbeat recovered the helper from commit `9640cc59db9b7780ed4c60f009e170fe905fa904` and reused its exact retention rules.
- Ran the recovered helper in dry-run mode first with `DATA_DIR` pinned to this checkout and an issue-local report path.
- The dry run found one retained Carousell snapshot already within policy and five `data/buy-48198-disk-monitor-*` directories against a keep-two policy.
- Applied the same narrow sweep in place and removed the oldest three monitor directories.

## Verification

- Dry-run summary before apply: `removed=3 reclaimed_kb=60`
- Apply summary: `removed=3 reclaimed_kb=60`
- Removed monitor directories:
  - `data/buy-48198-disk-monitor-2026-06-19T094017Z`
  - `data/buy-48198-disk-monitor-2026-06-19T094516Z`
  - `data/buy-48198-disk-monitor-2026-06-19T095017Z`
- Remaining retained monitor directories after apply:
  - `data/buy-48198-disk-monitor-2026-06-19T095516Z`
  - `data/buy-48198-disk-monitor-2026-06-19T100017Z`
- Retained Carousell snapshot:
  - `data/carousell-sg/products_20260516_022805.jsonl`
- Post-cleanup disk state:

```text
Filesystem      Size  Used Avail Use% Mounted on
/dev/vda1       193G  161G   32G  84% /
```

- Post-cleanup `data/` size:

```text
505M  data
```

## Notes

- The authoritative per-path deletion log for this issue is `reports/BUY-53498-safe-data-cleanup-report.txt`.
- No code changes were required for the sweep itself; the durable artifacts for this heartbeat are the issue-local reports plus the retained-on-disk state above.
