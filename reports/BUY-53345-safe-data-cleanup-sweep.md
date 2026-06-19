# BUY-53345 safe-data-cleanup sweep

Timestamp: 2026-06-19T04:31:53Z to 2026-06-19T04:32:04Z

## Summary

- Ran the repo's existing safe cleanup workflow in dry-run mode via `scripts/buy-53125-safe-data-cleanup.sh`.
- Confirmed the workspace was again above the script's retention floor for `data/buy-48198-disk-monitor-*` directories, while the lone `data/carousell-sg/products_*.jsonl` snapshot remained in-policy.
- Applied the cleanup with the script's default retention policy, keeping the newest `2` disk-monitor directories and the only Carousell snapshot.
- Deleted `9` old disk-monitor directories and reclaimed `180 KB` according to the script's measured `du -sk` totals.

## Verification

- Post-apply remaining `buy-48198` monitor directories:

```text
data/buy-48198-disk-monitor-2026-06-19T042700Z
data/buy-48198-disk-monitor-2026-06-19T043022Z
```

- Post-apply `data/` size:

```text
491M  data
```

- Post-apply disk state:

```text
Filesystem      Size  Used Avail Use% Mounted on
/dev/vda1       193G  155G   38G  81% /

Filesystem     1K-blocks      Used Available Use% Mounted on
/dev/vda1      202051056 162512024  39522648  81% /
```

## Notes

- The workspace had already accumulated a large number of unrelated tracked and untracked artifact changes before this heartbeat. I did not revert or widen that state.
- The durable per-file deletion log for this run is `reports/buy-53125-safe-data-cleanup-report.txt`.
