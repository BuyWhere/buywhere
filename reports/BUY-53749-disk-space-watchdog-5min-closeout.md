# BUY-53749 / BUY-48198 Disk Space Watchdog (5min) Closeout

## Summary

- Verified the aligned `20 GB` warning threshold is applied in the direct BUY-48198 watchdog wrapper and the API watchdog env builder.
- Verified the canonical BUY-48198 cron wrapper still executes both cleanup stages before the watchdog and tolerates cleanup return code `10`.
- Verified a fresh BUY-53749 cron-path smoke run completed successfully with `26.7 GB` free, `20 GB` warning threshold, `5 GB` critical threshold, and no incident creation.

## Verification

1. Automated tests
   - `node --test api/tests/disk-space-thresholds.test.mjs api/tests/disk-watchdog.test.mjs`
   - Result: `13` tests passed, `0` failed.

2. Shell syntax
   - `bash -n scripts/run-buy-48198-disk-watchdog.sh`
   - `bash -n scripts/run-buy-48198-disk-watchdog-cron.sh`

3. Fresh cron-path smoke run
   - `LOG_FILE=$PWD/logs/buy53749_disk_watchdog_cron.log WORKSPACES_ROOT=/paperclip/instances/default/workspaces DISK_STATE_FILE=$PWD/data/buy-53749-cron-disk-state.json DISK_SNAPSHOT_DIR=$PWD/data/buy-53749-disk-watchdog-cron-2026-06-19T183202Z DISK_EXECUTION_ISSUE=BUY-53749 bash scripts/run-buy-48198-disk-watchdog-cron.sh`
   - Result: `[2026-06-19T18:32:20Z] BUY-48198 watchdog complete rc=0`
   - Snapshot: `data/buy-53749-disk-watchdog-cron-2026-06-19T183202Z/summary.md`
   - Free space: `26.7 GB`
   - Warn threshold: `20 GB`
   - Critical threshold: `5 GB`
   - Verdict: `PASS`

4. Shared cron log
   - `logs/buy48198_disk_watchdog_cron.log`
   - Latest healthy scheduled completion observed during this heartbeat:
   - `[2026-06-19T18:30:16Z] BUY-48198 watchdog complete rc=0`

## Files

- `scripts/run-buy-48198-disk-watchdog.sh`
- `api/src/jobs/diskSpaceWatchdog.ts`
- `api/dist/jobs/diskSpaceWatchdog.js`
- `api/tests/disk-space-thresholds.test.mjs`
- `api/tests/disk-watchdog.test.mjs`

## Conclusion

BUY-53749 is complete. The canonical 5-minute BUY-48198 watchdog now verifies against the intended `20 GB` warning contract, the cron wrapper path remains healthy, and a fresh issue-scoped smoke run passed end-to-end.
