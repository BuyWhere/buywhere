# BUY-53377 safe-data-cleanup sweep

Timestamp: 2026-06-19T05:46:31Z to 2026-06-19T05:46:39Z

## Summary

- Ran the repo's existing safe cleanup workflow in dry-run mode via `scripts/buy-53125-safe-data-cleanup.sh`.
- Confirmed the workspace was above the script's retention floor for `data/buy-48198-disk-monitor-*` directories, while the lone `data/carousell-sg/products_*.jsonl` snapshot remained in-policy.
- Applied the cleanup with the script's default retention policy, keeping the newest `2` disk-monitor directories and the only Carousell snapshot.
- Deleted `4` old disk-monitor directories and reclaimed `80 KB` according to the script's measured `du -sk` totals.

## Verification

- Dry-run candidates before apply:

```text
data/buy-48198-disk-monitor-2026-06-19T052519Z
data/buy-48198-disk-monitor-2026-06-19T053018Z
data/buy-48198-disk-monitor-2026-06-19T053520Z
data/buy-48198-disk-monitor-2026-06-19T053956Z
```

- Post-apply remaining `buy-48198` monitor directories:

```text
data/buy-48198-disk-monitor-2026-06-19T054020Z
data/buy-48198-disk-monitor-2026-06-19T054518Z
```

- Post-apply `data/` size:

```text
496M  data
```

- Post-apply disk state:

```text
Filesystem      Size  Used Avail Use% Mounted on
/dev/vda1       193G  156G   37G  81% /

Filesystem     1K-blocks      Used Available Use% Mounted on
/dev/vda1      202051056 163269520  38765152  81% /
```

## Notes

- The durable per-file deletion log for this run is `reports/BUY-53377-safe-data-cleanup-report.txt`.
- This heartbeat only removed script-selected stale disk-monitor directories in `data/` and did not modify the tracked `api/node_modules` deletions or other unrelated worktree changes already present in the workspace.
