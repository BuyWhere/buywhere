# BUY-53726 Restore `/dev/vda1` above 25G safety margin

## Summary

- The regression was the default warning threshold in the disk watchdog path: both the API monitor and the standalone cron/script path still treated `20 GB` as healthy.
- Restored the warning threshold to `25 GB` while keeping the critical threshold at `5 GB`.
- Added a targeted threshold test so `23.4 GB` free now evaluates to `WARN` instead of `PASS`.

## Changes

- `api/src/monitoring/diskSpace.ts`
  - Changed `WARN_THRESHOLD_GB` from `20` to `25`.
- `api/src/jobs/diskSpaceRunner.ts`
  - Updated the runner docstring to match the restored threshold.
- `api/dist/monitoring/diskSpace.js`
  - Updated the checked-in compiled artifact to `25 GB` because full `tsc` is currently blocked by unrelated repo-wide typing errors.
- `api/dist/jobs/diskSpaceRunner.js`
  - Updated the stale compiled runner comment to match.
- `scripts/buy-38913-disk-space-watchdog.cjs`
  - Changed the script default `DISK_WARN_BYTES` from `20 GiB` to `25 GiB`.
- `scripts/run-buy-48198-disk-watchdog.sh`
  - Exported `DISK_WARN_BYTES=25 GiB` by default so the cron wrapper enforces the restored margin even if called from a minimal environment.
- `api/tests/disk-space-thresholds.test.mjs`
  - Added targeted coverage for `23.4 GB => warning`, `4.5 GB => critical`, and `26.1 GB => healthy`.

## Verification

1. Targeted tests
   - `node --test api/tests/disk-watchdog.test.mjs api/tests/disk-space-thresholds.test.mjs`
   - Result: `11` tests passed, `0` failed.

2. Direct watchdog smoke run
   - Command used an issue-local state file and snapshot dir with Paperclip API env cleared to avoid creating a duplicate incident during verification.
   - Result:
     - `status: WARN`
     - `free_gb: 23.4`
     - `warn_gb: 25`
     - `critical_gb: 5`
   - Snapshot:
     - `data/buy-53726-disk-watchdog-2026-06-19T174704Z/`

3. Build note
   - `npm --prefix api run build` is currently blocked by unrelated pre-existing TypeScript errors around missing Express/CORS/compression typings and implicit `any` usage in other API files.
   - This heartbeat did not widen scope into that repo-wide TS cleanup, so the relevant checked-in `dist` files were updated directly.
