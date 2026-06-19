# BUY-53311 safe-data-cleanup sweep

Timestamp: 2026-06-19T03:02:22Z to 2026-06-19T03:03:10Z

## Summary

- Ran the repo's existing safe cleanup workflow in dry-run mode via `scripts/buy-53125-safe-data-cleanup.sh`.
- Confirmed only one class of deletions was currently eligible in this workspace: old `data/buy-48198-disk-monitor-*` directories.
- Applied the cleanup with the script's default retention policy, keeping the newest 2 disk-monitor directories and the only Carousell snapshot.
- Deleted 16 old disk-monitor directories and reclaimed `320 KB` according to the script's measured `du -sk` totals.

## Verification

- Post-apply remaining `buy-48198` monitor directories:

```text
data/buy-48198-disk-monitor-2026-06-19T025648Z
data/buy-48198-disk-monitor-2026-06-19T030016Z
```

- Post-apply `data/` size:

```text
484M  data
```

- Post-apply disk state:

```text
Filesystem      Size  Used Avail Use% Mounted on
/dev/vda1       193G  170G   24G  88% /

Filesystem     1K-blocks      Used Available Use% Mounted on
/dev/vda1      202051056 177786228  24248444  88% /
```

## Notes

- The whole-volume free-space counter is noisy for this workspace because concurrent jobs continue to write fresh artifacts under `data/` during the sweep.
- For that reason, the reliable reclaim figure for this heartbeat is the cleanup script's own measured total: `320 KB`.
- Detailed deletion log: `reports/buy-53125-safe-data-cleanup-report.txt`.
