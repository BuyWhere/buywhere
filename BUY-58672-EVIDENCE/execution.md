# BUY-58672: Worker Node WC Cycle Artifact Cleanup Enforcement

**Issue:** BUY-58672 Worker node disk-space enforcement (WC cycle artifact cleanup)
**Agent:** Rex (8ca957f8-0911-4e81-a963-e2cf54c97d44)
**Execution Date:** 2026-06-28T00:18:31Z

## Summary

Executed WC cycle artifact cleanup enforcement across all worker workspaces.

## Execution Details

| Parameter | Value |
|-----------|-------|
| Script | `scripts/run-buy-58672-worker-wc-cycle-cleanup.sh` |
| Keep Hours | 48 |
| Alert Threshold | 90% |
| Apply Mode | Yes (--apply) |
| Workspaces Scanned | 2 |
| Disk Before | 76% |
| Disk After | 76% |

## Cleanup Results

| Metric | Value |
|--------|-------|
| Scanned Files | 0 |
| Moved to Trash | 0 |
| Purged from Trash | 0 |
| Skipped (open) | 0 |
| Reclaimed | 0 KB |
| Alert Required | No |

## Disk Status

- **Total:** 192,026,672 KB
- **Used:** 152,507,564 KB (76%)
- **Free:** 49,527,108 KB

## Exit Code

`0` — Clean / below alert threshold. No orphaned WC cycle artifacts older than 48 hours found.

## Evidence

- Report: `logs/buy-58672-wc-cycle-enforcement-report.json`
- Log: `/paperclip/instances/default/workspaces/logs/buy58672_wc_cycle_cleanup_log.jsonl`

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
