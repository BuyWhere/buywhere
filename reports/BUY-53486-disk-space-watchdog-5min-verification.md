# BUY-53486 / BUY-48198 Disk Space Watchdog (5min) Verification

Date: 2026-06-19

## Summary

- Tightened `api/src/jobs/diskSpaceWatchdog.ts` so entrypoint fallback resolution includes the canonical `scripts/run-buy-48198-disk-watchdog-cron.sh` before the legacy `BUY-52997` alias.
- Added regression coverage in `api/tests/disk-watchdog.test.mjs` for the canonical cron-wrapper fallback case.
- Re-ran the targeted watchdog test suite and a fresh live `BUY-48198` cron-wrapper smoke run for `BUY-53486`.

## Source Change

- `api/src/jobs/diskSpaceWatchdog.ts`
  - Added canonical `run-buy-48198-disk-watchdog-cron.sh` fallback candidates alongside the existing direct watchdog wrapper and legacy alias.
  - Exported `resolveWatchdogEntrypointPathForTests()` so the fallback chain can be asserted directly in regression coverage.
- `api/tests/disk-watchdog.test.mjs`
  - Added a temp-workspace probe that verifies the resolver chooses the canonical `BUY-48198` cron wrapper when only that fallback exists.

## Verification

1. Targeted test suite
   - Command: `node --test api/tests/disk-watchdog.test.mjs`
   - Result: `pass`

2. Live cron-wrapper smoke run
   - Command: `DISK_STATE_FILE=/tmp/buy-53486-disk-state.json DISK_SNAPSHOT_DIR=data/buy-53486-disk-monitor-2026-06-19T094316Z LOG_FILE=logs/buy53486_disk_watchdog_cron.log DISK_EXECUTION_ISSUE=BUY-53486 bash scripts/run-buy-48198-disk-watchdog-cron.sh`
   - Result: `rc=0`
   - Snapshot: `data/buy-53486-disk-monitor-2026-06-19T094316Z/result.json`
   - State file: `/tmp/buy-53486-disk-state.json`
   - Log: `logs/buy53486_disk_watchdog_cron.log`

## Runtime Outcome

- Watchdog verdict: `PASS`
- Checked at: `2026-06-19T09:43:30.430Z`
- Free space after cleanup pipeline: `31.9 GB` (`34214170624` bytes)
- Total filesystem size: `206900281344` bytes
- Warning threshold: `20.0 GB`
- Critical threshold: `5.0 GB`
- Incident creation: none

## Outcome

The 5-minute watchdog remains healthy, the source now prefers the canonical `BUY-48198` cron wrapper in fallback scenarios, and the regression test would catch future drift back to the legacy alias.
