# BUY-53746 Disk Space Watchdog 5-Minute Alignment

- Completed: `2026-06-19T18:17:14Z`
- Issue: `BUY-53746`
- Parent routine: `BUY-48198`

## What changed

- Aligned the watchdog warning threshold to `20 GB` in the direct watchdog script and the BUY-48198 wrapper.
- Aligned the checked-in API monitoring source and compiled artifacts to the same `20 GB` warning threshold while keeping the `5 GB` critical threshold unchanged.
- Added a test assertion that `buildWatchdogEnv()` defaults `DISK_WARN_BYTES` to `20 GB`.
- Updated the disk-space threshold tests to reflect the `20 GB` warning contract.

## Verification

- Ran: `node --test tests/disk-space-thresholds.test.mjs tests/disk-watchdog.test.mjs`
- Result: `13/13` tests passed.

## Notes

- The workspace already had unrelated modified and untracked files before this heartbeat. This change was limited to the watchdog threshold files listed above.
