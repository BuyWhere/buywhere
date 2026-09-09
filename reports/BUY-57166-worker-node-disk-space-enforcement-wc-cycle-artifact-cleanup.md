# BUY-57166: Worker node disk-space enforcement (WC cycle artifact cleanup)

**Date:** 2026-06-25T08:41:00Z
**Status:** Complete ✅

## Summary

Worker node disk-space enforcement via WC cycle artifact cleanup has been deployed and ran successfully. The cleanup script (`wc-cycle-cleanup.sh --apply --keep=48`) scanned the Oracle workspace (`3ec8f6dd`), moving 12 stale WC cycle ndjson files to the reversible trash directory. Disk usage is at 63%, well below the 90% alert threshold.

An hourly cron entry has been installed to ensure this runs continuously (BUY-57166).

This is a recurring maintenance task preventing the root filesystem from hitting 100% (parent: BUY-30774).

## Run Results

| Metric | Value |
|--------|-------|
| Disk after cleanup | 63% |
| Disk used | ~118 GB |
| Disk free | ~72 GB |
| Alert threshold | 90% |
| Alert required | No |
| Files moved to trash | 12 |
| Trash purged | 0 |
| Reclaimed | ~0 KB (zero-byte files) |

## Delivered

| Artifact | Description |
|----------|-------------|
| `scripts/run-buy-57166-worker-wc-cycle-cleanup.sh` | Hourly runner wrapping `wc-cycle-cleanup.sh` for the Oracle workspace |
| `scripts/setup-buy-57166-worker-node-disk-space-enforcement.sh` | Idempotent cron installer |
| `logs/buy-57166-wc-cycle-enforcement-report.json` | JSON report from the initial run |
| `logs/buy-57166-disk-space-enforcement-cron.log` | Cron log (populated on each hourly run) |

## Verification

- Cron entry verified: `0 * * * *` hourly
- Script runs successfully with `inner_exit=0`
- Disk at 63% — no alert triggered
- Oracle workspace cycle files >48h cleaned

## Implementation

- **Core cleanup:** `scripts/wc-cycle-cleanup.sh --apply --keep=48`
- **Target workspace:** `/paperclip/instances/default/workspaces/3ec8f6dd-1735-4479-9825-a2c42edac34c`
- **Cron schedule:** Hourly (0 * * * *)
- **Alert threshold:** 90% disk usage
- **Keep window:** 48 hours
- **Mode:** apply (trash with 48h retention)
