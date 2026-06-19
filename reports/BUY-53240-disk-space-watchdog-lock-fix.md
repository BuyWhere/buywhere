# BUY-53240 / BUY-48198 Disk Space Watchdog 5-Minute Lock Fix

Verified on 2026-06-19 UTC in `/paperclip/instances/default/workspaces/476c8023-3635-45bb-9f71-db6f4f5700e1/buywhere-api`.

## Problem

`logs/buy52997_disk_watchdog_cron.log` showed overlapping watchdog starts within the same minute, which meant the 5-minute pipeline could run concurrently when cron and another scheduler path overlapped.

## Change

- Added a shared non-blocking `flock` guard in `scripts/run-buy-52997-disk-watchdog-cron.sh`.
- The full cleanup + watchdog pipeline now exits early with a logged `skip reason=lock-held` line when another run already owns the lock.

## Verification

1. Shell syntax check passed:
   - `bash -n scripts/run-buy-52997-disk-watchdog-cron.sh`
2. Direct watchdog smoke run passed:
   - Command: `DISK_EXECUTION_ISSUE=BUY-53240 DISK_SNAPSHOT_DIR="$PWD/data/buy-53240-disk-monitor-smoke" bash scripts/run-buy-48198-disk-watchdog.sh`
   - Result: `PASS`
   - Generated at: `2026-06-19T00:57:24.118Z`
   - Free space: `23.1 GB` (`24778874880` bytes)
3. Lock contention test passed:
   - Held `/tmp/buy-48198-disk-watchdog.lock` from a separate process, then ran `bash scripts/run-buy-52997-disk-watchdog-cron.sh`
   - Log result: `2026-06-19T00:57:25Z BUY-52997 watchdog skip reason=lock-held lock=/tmp/buy-48198-disk-watchdog.lock`
   - Log line count increased by exactly one (`before=2216 after=2217`), confirming the overlap path skipped instead of running the pipeline.

## Conclusion

The BUY-48198 5-minute disk watchdog remains healthy, and overlapping executions are now suppressed by a shared lock instead of performing duplicate cleanup/watchdog work.
