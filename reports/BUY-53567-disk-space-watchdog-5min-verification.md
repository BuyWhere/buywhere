# BUY-53567 Disk Space Watchdog (5min) Verification

- Verified on: `2026-06-19`
- Routine/source issue: `BUY-48198`

## What was broken

- `node --test api/tests/disk-watchdog.test.mjs` failed because `api/dist/jobs/diskSpaceWatchdog.js` was missing.
- `bash scripts/run-buy-48198-disk-watchdog-cron.sh` failed because the canonical BUY-48198 cron wrapper still `exec`'d the deleted legacy alias `scripts/run-buy-52997-disk-watchdog-cron.sh`.

## Fix applied

- Restored the missing watchdog bridge module in:
  - `api/src/jobs/diskSpaceWatchdog.ts`
  - `api/dist/jobs/diskSpaceWatchdog.js`
- Restored the direct BUY-48198 watchdog wrapper:
  - `scripts/run-buy-48198-disk-watchdog.sh`
- Recreated the shared watchdog implementation with the current expected interfaces:
  - `scripts/buy-38913-disk-space-watchdog.cjs`
- Updated `scripts/run-buy-48198-disk-watchdog-cron.sh` to call the canonical BUY-48198 wrapper directly and append start/completion lines to its log.

## Verification

1. Targeted regression suite
   - Command: `node --test api/tests/disk-watchdog.test.mjs`
   - Result: `7/7` passing

2. Live cron-wrapper smoke run
   - Command: `DISK_STATE_FILE=$PWD/data/buy-53567-disk-state.json DISK_SNAPSHOT_DIR=$PWD/data/buy-53567-disk-monitor-2026-06-19T124618Z DISK_EXECUTION_ISSUE=BUY-53567 LOG_FILE=$PWD/logs/buy53567_disk_watchdog_cron.log bash scripts/run-buy-48198-disk-watchdog-cron.sh`
   - Result: `rc=0`

## Runtime evidence

- Log: `logs/buy53567_disk_watchdog_cron.log`
  - `2026-06-19T12:46:18Z` start
  - `2026-06-19T12:46:18Z` complete `rc=0`
- Snapshot: `data/buy-53567-disk-monitor-2026-06-19T124618Z`
- Summary: `data/buy-53567-disk-monitor-2026-06-19T124618Z/summary.md`
- State file: `data/buy-53567-disk-state.json`
- Watchdog verdict: `PASS`
- Filesystem: `/dev/vda1`
- Mount path: `/`
- Free space: `32 GB` (`34358435840` bytes)
- Warning threshold: `20 GB`
- Critical threshold: `5 GB`
- Incident creation: none
