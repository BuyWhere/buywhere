# BUY-57762: Worker node disk-space enforcement (WC cycle artifact cleanup)

**Date:** 2026-06-26T07:50:12Z
**Status:** Complete ✅

## Summary

Worker node disk-space enforcement via WC cycle artifact cleanup ran successfully across all worker workspaces. The cleanup script (`wc-cycle-cleanup.sh --apply --keep=48`) found and moved 660 stale WC cycle ndjson files to trash. Disk usage remains at 66%, well below the 90% alert threshold.

This is a recurring maintenance task preventing the root filesystem from hitting 100% (parent: BUY-30774).

## Run Results

| Metric | Value |
|--------|-------|
| Disk before cleanup | 66% |
| Disk after cleanup | 66% |
| Disk used | ~125.8 GB |
| Disk free | ~66.9 GB |
| Alert threshold | 90% |
| Alert required | No |
| Workspaces processed | 2 |
| Files scanned | 660 |
| Files trashed | 660 |
| Files skipped (open) | 0 |
| Trash purged | 0 |
| Reclaimed | ~0 GB (zero-byte ndjson files) |

## Interpretation

The WC cycle cleanup found 660 stale `cycle-*.ndjson` files older than 48 hours across 2 worker workspaces and moved them to trash. All files were zero-byte (no disk space reclaimed directly), but the operation keeps the workspace directories clean and prevents file count accumulation. Disk usage remains at a healthy 66%. No alerting triggered.

## Implementation

- **Setup script:** `scripts/setup-buy-57762-worker-node-artifact-cleanup.sh`
- **Runner script:** `scripts/run-buy-57762-worker-wc-cycle-cleanup.sh`
- **Core cleanup:** `scripts/wc-cycle-cleanup.sh --apply --keep=48`
- **Target workspaces:** All `/paperclip/instances/default/workspaces/*/data` directories
- **Alert threshold:** 90% disk usage
- **Keep window:** 48 hours
- **Mode:** apply (move to trash for orphaned files)
- **Recurrence:** Every 6 hours via cron

## Cron Entry

```
0 */6 * * * cd /paperclip/instances/default/workspaces/476c8023-3635-45bb-9f71-db6f4f5700e1/buywhere-api && bash /paperclip/instances/default/workspaces/476c8023-3635-45bb-9f71-db6f4f5700e1/buywhere-api/scripts/run-buy-57762-worker-wc-cycle-cleanup.sh >> /paperclip/instances/default/workspaces/476c8023-3635-45bb-9f71-db6f4f5700e1/buywhere-api/logs/buy-57762-worker-node-artifact-cleanup.log 2>&1 # BUY-57762: Worker node WC cycle artifact cleanup — every 6 hours
```

## Stale Entries Removed

All previous WC cycle cleanup cron entries from prior issues (BUY-55411, BUY-55437, BUY-55448, BUY-56090, BUY-56542, BUY-56941, BUY-57677, BUY-57740, etc.) have been consolidated into this single BUY-57762 entry.
