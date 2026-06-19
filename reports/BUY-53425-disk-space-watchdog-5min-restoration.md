# BUY-53425 / BUY-48198 Disk Space Watchdog (5min) Restoration

## Summary

- Restored the missing BUY-48198 watchdog compatibility chain that `HEAD` had dropped:
  - `scripts/run-buy-48198-disk-watchdog.sh`
  - `scripts/run-buy-52997-disk-watchdog-cron.sh`
  - `scripts/setup-buy-48198-disk-watchdog.sh`
  - `scripts/buy-38913-disk-space-watchdog.cjs`
  - `scripts/buy-53114-worker-node-artifact-cleanup.sh`
  - `api/src/jobs/diskSpaceWatchdog.ts`
- Preserved the current API runtime on `api/src/jobs/diskSpaceRunner.ts`; the restored TS wrapper is a compatibility surface for the targeted regression test and any remaining direct imports.
- Reinstated the cron-path lock guard and verified the BUY-48198-specific wrapper now reaches the shared cleanup pipeline instead of failing on a missing script.

## Why This Was Needed

- `scripts/run-buy-48198-disk-watchdog-cron.sh` in `HEAD` still delegated to `scripts/run-buy-52997-disk-watchdog-cron.sh`, but that target file was gone.
- `api/tests/disk-watchdog.test.mjs` still required `api/dist/jobs/diskSpaceWatchdog.js`, but `api/src/jobs/diskSpaceWatchdog.ts` was also gone from `HEAD`.
- Earlier verification notes therefore no longer matched the actual checkout state.

## Verification

1. Shell syntax checks passed:
   - `bash -n scripts/run-buy-48198-disk-watchdog.sh`
   - `bash -n scripts/run-buy-52997-disk-watchdog-cron.sh`
   - `bash -n scripts/setup-buy-48198-disk-watchdog.sh`

2. Targeted regression test passed:
   - `node --test api/tests/disk-watchdog.test.mjs`
   - Result: `2/2` tests passed

3. Direct watchdog smoke run passed:
   - Command: `bash scripts/run-buy-48198-disk-watchdog.sh BUY-53425`
   - Result: `PASS`
   - Snapshot: `data/buy-48198-disk-monitor-2026-06-19T073209Z`
   - Free space: `38.9 GB`

4. Full cron-path smoke run passed:
   - Command:
     `LOG_FILE=/tmp/buy48198-cron-smoke.log WORKSPACES_ROOT=/paperclip/instances/default/workspaces DISK_EXECUTION_ISSUE=BUY-53425 bash scripts/run-buy-48198-disk-watchdog-cron.sh`
   - Result: `rc=0`
   - Snapshot: `data/buy-48198-disk-monitor-2026-06-19T073232Z`
   - Key log evidence:
     - `BUY-48198 watchdog start before_pct=80 free_gb=38.9`
     - `BUY-48198 wc cleanup complete rc=0`
     - `BUY-53114 worker cleanup complete rc=0`
     - `BUY-48198 watchdog complete rc=0`
   - Final free space: `38.1 GB`

## Notes

- `npm run build` in `api/` still reports pre-existing TypeScript typing failures across unrelated Express/CORS modules in this checkout. Despite that, `tsc` emitted the restored compatibility output at `api/dist/jobs/diskSpaceWatchdog.js`, and the targeted watchdog regression test passed against that emitted file.
- Cron-path execution deleted one stale local PID artifact during the worker cleanup stage:
  - `data/fairprice_scrape/scraper.pid`

## Outcome

The BUY-48198 5-minute watchdog path is runnable again in this workspace, the direct and cron wrappers both pass, and the targeted regression coverage is restored.
