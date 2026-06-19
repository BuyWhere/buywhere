# BUY-53247 / BUY-48198 Disk Space Watchdog (5min) Verification

Verified on 2026-06-19 UTC in `/paperclip/instances/default/workspaces/476c8023-3635-45bb-9f71-db6f4f5700e1/buywhere-api`.

## What was verified

- `api/src/jobs/diskSpaceWatchdog.ts` is present and still wired from `api/src/index.ts`.
- `scripts/run-buy-48198-disk-watchdog.sh` remains runnable as the direct watchdog entrypoint.
- `scripts/run-buy-52997-disk-watchdog-cron.sh` now contains a shared non-blocking lock to suppress overlapping 5-minute pipeline runs.

## Heartbeat checks

1. Shell syntax checks passed:
   - `bash -n scripts/run-buy-48198-disk-watchdog.sh`
   - `bash -n scripts/run-buy-52997-disk-watchdog-cron.sh`
   - `bash -n scripts/setup-buy-48198-disk-watchdog.sh`

2. Direct watchdog smoke run passed:
   - Command: `DISK_EXECUTION_ISSUE=BUY-53247 DISK_SNAPSHOT_DIR="$PWD/data/buy-53247-disk-monitor-smoke" bash scripts/run-buy-48198-disk-watchdog.sh`
   - Generated at: `2026-06-19T01:12:32.390Z`
   - Result: `PASS`
   - Filesystem: `/dev/vda1`
   - Mount path: `/`
   - Free space: `23.0 GB` (`24665149440` bytes)
   - Warn threshold: `20.0 GB`
   - Critical threshold: `5.0 GB`
   - Snapshot: `data/buy-53247-disk-monitor-smoke`

3. Lock contention path passed:
   - Held `/tmp/buy-48198-disk-watchdog.lock` from a separate process, then ran `bash scripts/run-buy-52997-disk-watchdog-cron.sh`
   - Exit code: `0`
   - Log line appended: `2026-06-19T01:12:41Z BUY-52997 watchdog skip reason=lock-held lock=/tmp/buy-48198-disk-watchdog.lock`
   - Log line count changed from `2326` to `2327`, which confirms the overlap path skipped instead of running the cleanup + watchdog pipeline twice.

## Conclusion

The BUY-48198 5-minute disk watchdog is healthy on this heartbeat. Disk free space is still above the `20 GB` warning threshold, and the wrapper now rejects overlapping executions through the shared lock path instead of duplicating work.
