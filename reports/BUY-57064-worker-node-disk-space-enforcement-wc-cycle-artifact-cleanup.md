# BUY-57064: Worker node disk-space enforcement (WC cycle artifact cleanup)

**Date:** 2026-06-24T21:16:00Z
**Status:** Complete ✅

## Summary

Worker node disk-space enforcement via WC cycle artifact cleanup ran successfully across all worker workspaces. The cleanup script (`wc-cycle-cleanup.sh --apply --keep=48`) scanned all worker workspaces under `/paperclip/instances/default/workspaces`, deleting 270 stale WC cycle ndjson files from the Oracle workspace (3ec8f6dd). Disk usage is at 62%, well below the 90% alert threshold.

This is a recurring maintenance task preventing the root filesystem from hitting 100% (parent: BUY-30774).

## Run Results

| Metric | Value |
|--------|-------|
| Disk after cleanup | 62% |
| Disk used | ~119 GB |
| Disk free | ~74 GB |
| Alert threshold | 90% |
| Alert required | No |
| Workspaces scanned | 25 |
| Files deleted | 270 |
| Files skipped (ingested) | 8 |
| Sidecars deleted | 0 |
| Trash purged | 0 |
| Reclaimed | 0 GB (files were 0-byte empties) |

## Interpretation

270 stale cycle ndjson files (`cycle-*.ndjson`) older than 48 hours were found in the Oracle workspace (`3ec8f6dd`) under `buy30620-stock/` and deleted. The files were 0-byte (incomplete/aborted ingest cycles). 8 files were skipped because they had valid `.ingested.json` sidecar markers. 4 files >48h old with markers are correctly retained (active ingestion tracked). Disk usage at a healthy 62%. No alerting triggered.

## Implementation

- **Core cleanup:** `scripts/wc-cycle-cleanup.sh --apply --keep=48`
- **Target workspaces:** All `/paperclip/instances/default/workspaces/*/data` directories
- **Alert threshold:** 90% disk usage
- **Keep window:** 48 hours
- **Mode:** apply (direct delete for orphaned files)
