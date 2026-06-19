# BUY-53329 safe-data-cleanup sweep

Timestamp: 2026-06-19T03:51:05Z to 2026-06-19T03:51:30Z

## Summary

- Ran the repo's existing safe cleanup workflow in dry-run mode via `scripts/buy-53125-safe-data-cleanup.sh`.
- Confirmed only one class of deletions was currently eligible in this workspace: old `data/buy-48198-disk-monitor-*` directories.
- Applied the cleanup with the script's default retention policy, keeping the newest 2 disk-monitor directories and the only Carousell snapshot.
- Deleted 12 old disk-monitor directories and reclaimed `240 KB` according to the script's measured `du -sk` totals.

## Verification

- Post-apply remaining `buy-48198` monitor directories:

```text
data/buy-48198-disk-monitor-2026-06-19T034537Z
data/buy-48198-disk-monitor-2026-06-19T035016Z
```

- Post-apply `data/` size:

```text
487M  data
```

- Post-apply disk state:

```text
Filesystem      Size  Used Avail Use% Mounted on
/dev/vda1       193G  170G   24G  89% /

Filesystem     1K-blocks      Used Available Use% Mounted on
/dev/vda1      202051056 177856640  24178032  89% /
```

## Notes

- The whole-volume free-space counter remains noisy because concurrent jobs continue to write fresh artifacts under `data/` during the sweep.
- For that reason, the reliable reclaim figure for this heartbeat is the cleanup script's own measured total: `240 KB`.
- Detailed deletion log: `reports/buy-53125-safe-data-cleanup-report.txt`.
