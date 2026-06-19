# BUY-53367 safe-data-cleanup sweep

Timestamp: 2026-06-19T05:32:48Z to 2026-06-19T05:32:56Z

## Summary

- Ran the repo's existing safe cleanup workflow in dry-run mode via `scripts/buy-53125-safe-data-cleanup.sh`.
- Confirmed the workspace was again above the script's retention floor for `data/buy-48198-disk-monitor-*` directories, while the lone `data/carousell-sg/products_*.jsonl` snapshot remained in-policy.
- Applied the cleanup with the script's default retention policy, keeping the newest `2` disk-monitor directories and the only Carousell snapshot.
- Deleted `15` old disk-monitor directories and reclaimed `300 KB` according to the script's measured `du -sk` totals.

## Verification

- Post-apply remaining `buy-48198` monitor directories:

```text
data/buy-48198-disk-monitor-2026-06-19T052519Z
data/buy-48198-disk-monitor-2026-06-19T053018Z
```

- Post-apply `data/` size:

```text
495M  data
```

- Post-apply disk state:

```text
Filesystem      Size  Used Avail Use% Mounted on
/dev/vda1       193G  156G   38G  81% /

Filesystem     1K-blocks      Used Available Use% Mounted on
/dev/vda1      202051056 162600908  39433764  81% /
```

## Notes

- The durable per-file deletion log for this run is `reports/buy-53125-safe-data-cleanup-report.txt`.
- The worktree contained many unrelated tracked and untracked artifact changes before this heartbeat; this sweep only removed the script-selected stale disk-monitor directories in `data/`.
