# BUY-57133 / BUY-48198 — Disk Space Watchdog (5min) — Final Report

## Objective
Monitor `/dev/vda1` free space every 5 minutes. Warn at <20 GB, create critical Paperclip incident at <5 GB.

## Status: Healthy

| Metric | Value |
|---|---|
| Free space | 72 GB |
| Usage | 63% |
| Threshold (warning) | <20 GB |
| Threshold (critical) | <5 GB |
| Last check | 2026-06-25T08:09Z |

## Implementation layers

1. **Cron (BUY-57232)** — `run-buy-57232-disk-watchdog-cron.sh` → checks `/dev/vda1` via `df`, creates Paperclip incident via API, 30 min dedup. Replaces BUY-56899 as the canonical runner.
2. **Python background service** — `app/services/disk_watchdog.py` → async loop in the API process, Sentry + Paperclip alerts
3. **Python standalone runner** — `scripts/run_disk_watchdog.py` → standalone check that writes status to `data/disk_watchdog_status.json`
4. **TS API module** — `api/src/monitoring/diskSpace.ts` / `api/src/jobs/diskSpaceRunner.ts` → runs in the API process
5. **Standalone Node runner** — `scripts/buy-48198-disk-space-watchdog.js` → portable Node.js check

## Cleanup performed
- Removed duplicate `BUY-57151` cron entry (duplicated BUY-56899's job)
- BUY-57232 cron is now the canonical disk space watchdog cron entry (idempotent installer)
- Fixed `setup-buy-57232-disk-space-watchdog.sh` to reference the correct runner filename (`run-buy-57232-disk-watchdog-cron.sh`)
- Fixed marker in idempotent setup script to match actual cron comment for proper deduplication
- BUY-56899 runner and setup scripts preserved in repo for reference

## Cron entries (disk-related, deduplicated)
- `*/5 * * * *` — BUY-57232 disk space watchdog (BUY-48198)
- `0 * * * *` — BUY-56542 worker node disk-space enforcement
- `*/5 * * * *` — BUY-56110 Carousell SG disk cleanup
