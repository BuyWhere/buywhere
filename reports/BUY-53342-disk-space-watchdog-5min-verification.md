# BUY-53342 / BUY-48198 Disk Space Watchdog (5min) Verification

Verified on 2026-06-19 UTC in `/paperclip/instances/default/workspaces/476c8023-3635-45bb-9f71-db6f4f5700e1/buywhere-api`.

## Scope checked on this heartbeat

- `api/src/jobs/diskSpaceWatchdog.ts` still resolves the direct `scripts/run-buy-48198-disk-watchdog.sh` wrapper by default.
- `api/src/index.ts` still starts the in-process disk watchdog scheduler at API boot.
- `scripts/run-buy-52997-disk-watchdog-cron.sh` still guards the wider cleanup pipeline with a shared non-blocking lock at `/tmp/buy-48198-disk-watchdog.lock`.

## Verification

1. Shell syntax checks passed:
   - `bash -n scripts/run-buy-48198-disk-watchdog.sh`
   - `bash -n scripts/run-buy-52997-disk-watchdog-cron.sh`
   - `bash -n scripts/setup-buy-48198-disk-watchdog.sh`

2. Direct watchdog smoke run passed:
   - Command:
     `DISK_STATE_FILE="$PWD/data/buy-53342-disk-state.json" DISK_SNAPSHOT_DIR="$PWD/data/buy-53342-disk-monitor-smoke" DISK_EXECUTION_ISSUE=BUY-53342 bash scripts/run-buy-48198-disk-watchdog.sh BUY-53342`
   - Generated at: `2026-06-19T04:22:30.060Z`
   - Result: `PASS`
   - Filesystem: `/dev/vda1`
   - Mount path: `/`
   - Free space: `38.2 GB` (`41054941184` bytes)
   - Warn threshold: `20.0 GB`
   - Critical threshold: `5.0 GB`
   - Snapshot: `data/buy-53342-disk-monitor-smoke`

3. Lock contention path passed:
   - Held `/tmp/buy-48198-disk-watchdog.lock` from a separate process, then ran `bash scripts/run-buy-52997-disk-watchdog-cron.sh`
   - Exit code: `0`
   - Log line appended: `2026-06-19T04:22:43Z BUY-52997 watchdog skip reason=lock-held lock=/tmp/buy-48198-disk-watchdog.lock`
   - Log line count changed from `3719` to `3720`, confirming the overlap path skipped instead of re-running the cleanup + watchdog pipeline.

## Conclusion

The BUY-48198 5-minute disk watchdog is healthy on this heartbeat. The source remains aligned to the direct watchdog wrapper, the API scheduler still starts it at runtime, and the cron wrapper still suppresses overlapping runs through the shared lock path.
