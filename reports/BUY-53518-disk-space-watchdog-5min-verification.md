# BUY-53518 / BUY-48198 Disk Space Watchdog (5min) Verification

Date: 2026-06-19

## Changes

- Updated the watchdog scheduler and BUY-48198 wrapper defaults to use the canonical state path `/tmp/buy-48198-disk-state.json` instead of the legacy BUY-38913 path.
- Fixed the shared watchdog script to build and dedupe incident titles from the active `DISK_FILESYSTEM_LABEL` rather than a hardcoded `/dev/vda1` prefix.
- Added targeted regression coverage for both the canonical state-file default and the incident-title helper behavior.

## Verification

- Targeted tests:
  - `node --test api/tests/disk-watchdog.test.mjs`
- Live watchdog smoke run:
  - `DISK_STATE_FILE=$PWD/data/buy-53518-disk-state.json DISK_SNAPSHOT_DIR=$PWD/data/buy-53518-disk-monitor-2026-06-19T103630Z DISK_EXECUTION_ISSUE=BUY-53518 bash scripts/run-buy-48198-disk-watchdog.sh BUY-53518`

## Results

- Test result: `7/7` passing
- Snapshot: `data/buy-53518-disk-monitor-2026-06-19T103630Z/result.json`
- Summary: `data/buy-53518-disk-monitor-2026-06-19T103630Z/summary.md`
- State file: `data/buy-53518-disk-state.json`
- Watchdog verdict: `PASS`
- Generated at: `2026-06-19T10:36:30.696Z`
- Free space: `29.9 GB` (`32096423936` bytes)
- Total filesystem size: `206900281344` bytes
- Warning threshold: `20.0 GB`
- Critical threshold: `5.0 GB`
- Incident creation: none triggered on this run

## Notes

- `api/dist/jobs/diskSpaceWatchdog.js` was updated alongside source because this workspace already contains unrelated API build failures and the checked-in runtime/tests load from `dist`.
