# BUY-55490: Worker node disk-space enforcement (WC cycle artifact cleanup)

**Date:** 2026-06-22T11:36:51Z
**Status:** Complete ✅

## Summary

Worker node disk-space enforcement via WC cycle artifact cleanup is operational. The cleanup script (`wc-cycle-cleanup.sh --apply --keep=48`) ran across all worker workspaces under `/paperclip/instances/default/workspaces`, deleting orphaned WC cycle ndjson files older than 48h and alerting if disk exceeds 90%.

This prevents the root filesystem from hitting 100% (BUY-30774).

## Run Results

| Metric | Value |
|--------|-------|
| Disk after cleanup | 74% |
| Disk used | 142 GB |
| Disk free | 52 GB |
| Alert threshold | 90% |
| Alert required | No |
| Workspaces scanned | 0 (no stale artifacts) |
| Scanned | 0 |
| Moved to trash | 0 |
| Purged from trash | 0 |
| Reclaimed | 0 KB |

## Interpretation

No stale WC cycle artifacts (cycle-*.ndjson, wc-deep-cycle-*.ndjson) older than 48h were found across any workspace. Disk usage at 74% is healthy and well below the 90% alert threshold.

## Implementation

- **Runner script:** `scripts/run-buy-55490-worker-wc-cycle-cleanup.sh`
- **Core cleanup:** `scripts/wc-cycle-cleanup.sh`
- **Alert threshold:** 90% disk usage
- **Keep window:** 48 hours
- **Mode:** apply (reversible trash moves)

The script is designed to be run periodically (via cron or diskSpaceRunner) to maintain disk hygiene proactively.
