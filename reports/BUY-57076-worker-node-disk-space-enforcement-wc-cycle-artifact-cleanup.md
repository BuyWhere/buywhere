# BUY-57076: Worker node disk-space enforcement (WC cycle artifact cleanup)

**Date:** 2026-06-24T21:46:00Z
**Status:** Complete ✅

## Summary

Worker node disk-space enforcement via WC cycle artifact cleanup ran successfully across all worker workspaces. The cleanup script (`wc-cycle-cleanup.sh --apply --keep=48`) found no stale WC cycle ndjson files to delete. Disk usage is at 62%, well below the 90% alert threshold.

This is a recurring maintenance task preventing the root filesystem from hitting 100% (parent: BUY-30774).

## Run Results

| Metric | Value |
|--------|-------|
| Disk after cleanup | 62% |
| Disk used | ~119 GB |
| Disk free | ~74 GB |
| Alert threshold | 90% |
| Alert required | No |
| Files deleted | 0 |
| Files skipped (ingested) | 0 |
| Sidecars deleted | 0 |
| Trash purged | 0 |
| Reclaimed | 0.00 GB |

## Interpretation

No stale cycle ndjson files (`cycle-*.ndjson`) older than 48 hours were found across any worker workspace. The prior cleanup run (BUY-57064) already cleared 270 stale files. Disk usage remains at a healthy 62%. No alerting triggered.

## Implementation

- **Core cleanup:** `scripts/wc-cycle-cleanup.sh --apply --keep=48`
- **Target workspaces:** All `/paperclip/instances/default/workspaces/*/data` directories
- **Alert threshold:** 90% disk usage
- **Keep window:** 48 hours
- **Mode:** apply (direct delete for orphaned files)
