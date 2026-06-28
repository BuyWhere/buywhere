# BUY-58681: Worker Node WC Cycle Artifact Cleanup Enforcement

**Issue:** BUY-58681 Worker node disk-space enforcement (WC cycle artifact cleanup)
**Agent:** Rex (8ca957f8-0911-4e81-a963-e2cf54c97d44)
**Execution Date:** 2026-06-28T00:33:16Z

## Summary

Executed WC cycle artifact cleanup enforcement across all worker workspaces.

## Execution Details

| Parameter | Value |
|-----------|-------|
| Script | `scripts/run-buy-58681-worker-wc-cycle-cleanup.sh` |
| Keep Hours | 48 |
| Alert Threshold | 90% |
| Apply Mode | Yes (--apply) |
| Workspaces Scanned | 2 |
| Disk Before | 72% |
| Disk After | 72% |

## Cleanup Results

| Metric | Value |
|--------|-------|
| Scanned Files | 14 |
| Moved to Trash | 14 |
| Purged from Trash | 0 |
| Skipped (open) | 0 |
| Reclaimed | 0 KB |
| Alert Required | No |

## Disk Status

- **Total:** 202,034,672 KB
- **Used:** 144,577,348 KB (72%)
- **Free:** 57,457,324 KB

## Exit Code

`0` — Clean / below alert threshold. 14 orphaned WC cycle ndjson files from workspace `19dcd635-1d2b-4e41-9950-5865876e12b2` were moved to trash (all from buy55703-nonshopify scraper, dated 2026-06-26).

## Evidence

- Report: `logs/buy-58681-wc-cycle-enforcement-report.json`
- Log: `/paperclip/instances/default/workspaces/logs/buy58681_wc_cycle_cleanup_log.jsonl`

## Implementation Notes

The disk-space enforcement is fully automated:

- **Railway env vars** in `railway.json` configure the runner:
  - `DISK_SPACE_CHECK_INTERVAL_MS=300000` (5 min check interval)
  - `ARTIFACT_CLEANUP_RETENTION_HOURS=48` (48h artifact retention)
  - `ARTIFACT_CLEANUP_AUTO_APPLY=1` (auto-apply at critical threshold)
  - `ARTIFACT_CLEANUP_REPORT_PATH=/tmp/artifact_cleanup_report.json`
- **diskSpaceRunner** (`api/src/jobs/diskSpaceRunner.ts`) runs every 5 min and:
  1. Checks `/dev/vda1` disk usage
  2. If below CRITICAL_THRESHOLD_GB (5GB), runs `wc-cycle-cleanup.sh --apply --keep=48` before creating incident
  3. If below WARN_THRESHOLD_GB (20GB), runs dry-run cleanup
  4. Creates Paperclip incident with disk info if still below threshold after cleanup attempt
- **wc-cycle-cleanup.sh** (`scripts/wc-cycle-cleanup.sh`) handles:
  - Stale `cycle-*.ndjson` / `wc-deep-cycle-*.ndjson` files (moved to `_trash/` with sidecar cleanup)
  - Trash retention purging (48h TTL)
  - Disk alert at 90% usage
