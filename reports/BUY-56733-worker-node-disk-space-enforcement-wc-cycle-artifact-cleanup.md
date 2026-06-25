# BUY-56733: Worker node disk-space enforcement (WC cycle artifact cleanup)

**Date:** 2026-06-24T09:03:17Z
**Status:** Complete ✅

## Summary

Worker node disk-space enforcement via WC cycle artifact cleanup ran successfully. The cleanup script (`wc-cycle-cleanup.sh --apply --keep=48`) scanned all worker workspaces under `/paperclip/instances/default/workspaces`, moving 39 stale WC cycle ndjson files to the reversible trash directory. Disk usage is at 65%, well below the 90% alert threshold.

This is a recurring maintenance task preventing the root filesystem from hitting 100% (parent: BUY-30774).

## Run Results

| Metric | Value |
|--------|-------|
| Disk after cleanup | 65% |
| Disk used | ~125 GB |
| Disk free | ~68 GB |
| Alert threshold | 90% |
| Alert required | No |
| Workspaces scanned | 3 |
| Files scanned | 39 |
| Moved to trash | 39 |
| Purged from trash | 0 |
| Reclaimed | 0 KB (files were 0-byte empties) |

## Interpretation

39 stale cycle ndjson files (`cycle-*.ndjson`) older than 48 hours were found in the Oracle workspace (`3ec8f6dd`) under `buy30620-stock/` and moved to the reversible trash directory. The files were 0-byte (likely incomplete/aborted ingest cycles). Disk usage dropped from prior runs and sits at a healthy 65%. No alerting triggered.

## Implementation

- **Core cleanup:** `scripts/wc-cycle-cleanup.sh --apply --keep=48`
- **Alert threshold:** 90% disk usage
- **Keep window:** 48 hours
- **Mode:** apply (reversible trash moves)

Trash files are retained for 48 hours before permanent deletion on the next cleanup run.
