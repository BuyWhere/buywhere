# BUY-57768: Worker node disk-space enforcement (WC cycle artifact cleanup)

**Date:** 2026-06-26T08:07:26Z  
**Status:** Complete ✅

## Summary

Worker node disk-space enforcement via WC cycle artifact cleanup ran successfully. 222 stale WC cycle ndjson files older than 48h were moved to trash across 2 worker workspaces. Additionally, the broader BUY-53114 artifact cleanup reclaimed ~443MB by compressing old trash directories and removing stale logs. Disk usage remains at a healthy 66%, well below the 90% alert threshold.

## Run Results

| Metric | Value |
|--------|-------|
| Disk before cleanup | 66% |
| Disk after cleanup | 66% |
| Disk used | ~126 GB |
| Disk free | ~68 GB |
| Alert threshold | 90% |
| Alert required | No |
| WC cycle scanned | 222 |
| WC cycle trashed | 222 |
| WC cycle skipped (open) | 0 |
| BUY-53114 scanned | 85 |
| BUY-53114 removed | 73 |
| BUY-53114 reclaimed | ~443 MB (trash compression) |
| Workspaces processed | 2 (WC) + all (BUY-53114) |

## Workspaces Cleaned

- **3ec8f6dd-1735-4479-9825-a2c42edac34c** (buy30620-stock) — 207 stale ndjson files trashed
- **19dcd635-1d2b-4e41-9950-5865876e12b2** (buy55703-nonshopify) — 15 stale ndjson files trashed

## Infrastructure Health

All cleanup cron entries are active:
- `0 */6 * * *` — BUY-57762 WC cycle artifact cleanup
- `*/5 * * * *` — BUY-57232/BUY-48198 Disk space watchdog
- `*/5 * * * *` — BUY-56110 Carousell SG disk cleanup

## Current State

| Metric | Value |
|--------|-------|
| Total active ndjson files | 20,983 |
| Total trashed ndjson files | 7,555 |
| Stale files remaining (>48h, not trashed) | 32 |
| Alerting status | No alerts triggered |

## Key Files

- **Apply report:** `BUY-57768-evidence/apply-report.json`
- **Apply log:** `BUY-57768-evidence/apply-log.jsonl`
- **Dry-run report:** `BUY-57768-evidence/dryrun-report.json`
- **Dry-run log:** `BUY-57768-evidence/dryrun-log.jsonl`
- **BUY-53114 report:** `BUY-57768-evidence/buy53114-apply-report.json`
- **Cleanup summary:** `BUY-57768-evidence/cleanup-report.json`
- **Core cleanup script:** `scripts/wc-cycle-cleanup.sh`
- **Worker artifact script:** `scripts/buy-53114-worker-node-artifact-cleanup.sh`
- **Runner script:** `scripts/run-buy-57762-worker-wc-cycle-cleanup.sh`
