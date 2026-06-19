# BUY-53224 safe-data-cleanup sweep

Timestamp: 2026-06-19T00:31:26Z to 2026-06-19T00:31:46Z

## Summary

- Ran the existing workspace-safe cleanup script with a dry-run first, then applied the same narrow retention sweep: `./scripts/buy-53125-safe-data-cleanup.sh --apply`.
- Deleted `15` old `data/buy-48198-disk-monitor-*` directories while keeping the newest `2`, exactly matching the script retention policy.
- Deleted `0` Carousell snapshot files because the workspace still had only `1` retained `products_*.jsonl` file.
- Script-reported reclaim was `300 KB`.

## Verification

- Pre-apply dry-run reported:
  - `carousell-snapshots total=1 keep=1`
  - `disk-monitor-dirs total=17 keep=2`
  - `summary removed=15 reclaimed_kb=300`
- Post-apply state:
  - remaining monitor dirs:
    - `data/buy-48198-disk-monitor-2026-06-19T002653Z`
    - `data/buy-48198-disk-monitor-2026-06-19T003017Z`
  - remaining Carousell snapshot:
    - `data/carousell-sg/products_20260516_022805.jsonl`
- Live filesystem snapshot after cleanup:

```text
Filesystem      Size  Used Avail Use% Mounted on
/dev/vda1       193G  165G   28G  86% /

Filesystem     1K-blocks      Used Available Use% Mounted on
/dev/vda1      202051056 172849680  29184992  86% /
```

## Notes

- The cleanup was limited to inert monitor artifact directories already covered by the existing safe cleanup script; no source files or active runtime artifacts were touched.
- `df` noise is larger than the reclaimed `300 KB`, so the authoritative proof is the deletion log in `reports/buy-53125-safe-data-cleanup-report.txt` plus the post-cleanup directory listing.
