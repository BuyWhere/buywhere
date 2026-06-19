# BUY-53571 / BUY-48198 Disk Space Watchdog (5min) Verification

- Verified on: `2026-06-19`
- Routine/source issue: `BUY-48198`

## What I checked

- The canonical 5-minute crontab entry is installed and points to the BUY-48198 cron wrapper:
  - `*/5 * * * * cd /paperclip/instances/default/workspaces/476c8023-3635-45bb-9f71-db6f4f5700e1/buywhere-api && WORKSPACES_ROOT=/paperclip/instances/default/workspaces LOG_FILE=/paperclip/instances/default/workspaces/476c8023-3635-45bb-9f71-db6f4f5700e1/buywhere-api/logs/buy48198_disk_watchdog_cron.log bash /paperclip/instances/default/workspaces/476c8023-3635-45bb-9f71-db6f4f5700e1/buywhere-api/scripts/run-buy-48198-disk-watchdog-cron.sh`
- The watchdog-only regression suite passes against the current workspace implementation.
- The shell wrappers parse cleanly with `bash -n`.
- A fresh issue-scoped smoke run of the cron wrapper completed successfully.

## Verification

1. Targeted watchdog regression suite
   - Command: `node --test api/tests/disk-watchdog.test.mjs`
   - Result: `7/7` passing

2. Shell syntax checks
   - Commands:
     - `bash -n scripts/run-buy-48198-disk-watchdog.sh`
     - `bash -n scripts/run-buy-48198-disk-watchdog-cron.sh`
     - `bash -n scripts/setup-buy-48198-disk-watchdog.sh`
   - Result: pass

3. Live cron-wrapper smoke run
   - Command: `DISK_STATE_FILE=$PWD/data/buy-53571-disk-state.json DISK_SNAPSHOT_DIR=$PWD/data/buy-53571-disk-monitor-2026-06-19T125438Z DISK_EXECUTION_ISSUE=BUY-53571 LOG_FILE=$PWD/logs/buy53571_disk_watchdog_cron.log bash scripts/run-buy-48198-disk-watchdog-cron.sh`
   - Result: `rc=0`

## Runtime evidence

- Log: `logs/buy53571_disk_watchdog_cron.log`
  - `2026-06-19T12:54:38Z` start
  - `2026-06-19T12:54:38Z` complete `rc=0`
- Snapshot: `data/buy-53571-disk-monitor-2026-06-19T125438Z`
- Summary: `data/buy-53571-disk-monitor-2026-06-19T125438Z/summary.md`
- State file: `data/buy-53571-disk-state.json`
- Watchdog verdict: `PASS`
- Filesystem: `/dev/vda1`
- Mount path: `/`
- Free space: `33.4 GB` (`35889094656` bytes)
- Usage: `83%`
- Warning threshold: `20 GB`
- Critical threshold: `5 GB`
- Incident creation: none

## Notes

- `npm --prefix api test -- --testPathPattern=disk-watchdog.test.mjs` is not a reliable issue-scoped command in this repo because the package test script ignores that filter and still executes broader unrelated suites. The direct `node --test api/tests/disk-watchdog.test.mjs` invocation is the smallest accurate verification path for this watchdog issue.

The BUY-48198 5-minute disk watchdog is installed, running on schedule, and healthy in the current workspace, so BUY-53571 can be closed.
