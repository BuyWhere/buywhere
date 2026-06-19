# BUY-53580 / BUY-48198 Disk Space Watchdog (5min) Verification

- Verified on: `2026-06-19`
- Routine/source issue: `BUY-48198`

## What I checked

- The canonical 5-minute cron entry is installed and points at the BUY-48198 cron wrapper:
  - `*/5 * * * * cd /paperclip/instances/default/workspaces/476c8023-3635-45bb-9f71-db6f4f5700e1/buywhere-api && WORKSPACES_ROOT=/paperclip/instances/default/workspaces LOG_FILE=/paperclip/instances/default/workspaces/476c8023-3635-45bb-9f71-db6f4f5700e1/buywhere-api/logs/buy48198_disk_watchdog_cron.log bash /paperclip/instances/default/workspaces/476c8023-3635-45bb-9f71-db6f4f5700e1/buywhere-api/scripts/run-buy-48198-disk-watchdog-cron.sh`
- The targeted watchdog regression suite passes in the current workspace.
- The canonical shell wrappers parse cleanly with `bash -n`.
- A fresh issue-scoped smoke run of the cron wrapper completed successfully.
- The scheduled watchdog log shows the routine continuing to complete cleanly on the 5-minute cadence.

## Verification

1. Targeted watchdog regression suite
   - Command: `node --test api/tests/disk-watchdog.test.mjs`
   - Result: `7/7` passing

2. Shell syntax checks
   - Commands:
     - `bash -n scripts/run-buy-48198-disk-watchdog.sh`
     - `bash -n scripts/run-buy-48198-disk-watchdog-cron.sh`
   - Result: pass

3. Live cron-wrapper smoke run
   - Command: `DISK_STATE_FILE=$PWD/data/buy-53580-disk-state.json DISK_SNAPSHOT_DIR=$PWD/data/buy-53580-disk-monitor-2026-06-19T131620Z DISK_EXECUTION_ISSUE=BUY-53580 LOG_FILE=$PWD/logs/buy53580_disk_watchdog_cron.log bash scripts/run-buy-48198-disk-watchdog-cron.sh`
   - Result: `rc=0`

## Runtime evidence

- Log: `logs/buy53580_disk_watchdog_cron.log`
  - `2026-06-19T13:13:48Z` start
  - `2026-06-19T13:13:48Z` complete `rc=0`
- Scheduled cron log: `logs/buy48198_disk_watchdog_cron.log`
  - latest observed scheduled success at `2026-06-19T13:10:01Z`
- Snapshot: `data/buy-53580-disk-monitor-2026-06-19T131620Z`
- Summary: `data/buy-53580-disk-monitor-2026-06-19T131620Z/summary.md`
- State file: `data/buy-53580-disk-state.json`
- Watchdog verdict: `PASS`
- Filesystem: `/dev/vda1`
- Mount path: `/`
- Free space: `33 GB` (`35481522176` bytes)
- Usage: `83%`
- Warning threshold: `20 GB`
- Critical threshold: `5 GB`
- Incident creation: none

The BUY-48198 5-minute disk watchdog is installed, running on schedule, and healthy in the current workspace, so BUY-53580 can be closed.
