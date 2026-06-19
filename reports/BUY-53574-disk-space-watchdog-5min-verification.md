# BUY-53574 / BUY-48198 Disk Space Watchdog (5min) Verification

- Verified on: `2026-06-19`
- Routine/source issue: `BUY-48198`

## What I checked

- The canonical 5-minute cron entry is installed and points at the BUY-48198 cron wrapper:
  - `*/5 * * * * cd /paperclip/instances/default/workspaces/476c8023-3635-45bb-9f71-db6f4f5700e1/buywhere-api && WORKSPACES_ROOT=/paperclip/instances/default/workspaces LOG_FILE=/paperclip/instances/default/workspaces/476c8023-3635-45bb-9f71-db6f4f5700e1/buywhere-api/logs/buy48198_disk_watchdog_cron.log bash /paperclip/instances/default/workspaces/476c8023-3635-45bb-9f71-db6f4f5700e1/buywhere-api/scripts/run-buy-48198-disk-watchdog-cron.sh`
- The watchdog-only regression suite passes against the current workspace implementation.
- The canonical shell wrappers parse cleanly with `bash -n`.
- A fresh issue-scoped smoke run of the cron wrapper completed successfully.
- The stale reference to `scripts/setup-buy-48198-disk-watchdog.sh` was removed from the canonical cron wrapper comments so the repo matches the current installation path.

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
   - Command: `DISK_STATE_FILE=$PWD/data/buy-53574-disk-state.json DISK_SNAPSHOT_DIR=$PWD/data/buy-53574-disk-monitor-2026-06-19T130213Z DISK_EXECUTION_ISSUE=BUY-53574 LOG_FILE=$PWD/logs/buy53574_disk_watchdog_cron.log bash scripts/run-buy-48198-disk-watchdog-cron.sh`
   - Result: `rc=0`

## Runtime evidence

- Log: `logs/buy53574_disk_watchdog_cron.log`
  - `2026-06-19T13:02:13Z` start
  - `2026-06-19T13:02:13Z` complete `rc=0`
- Scheduled cron log: `logs/buy48198_disk_watchdog_cron.log`
  - latest observed scheduled success at `2026-06-19T13:00:01Z`
- Snapshot: `data/buy-53574-disk-monitor-2026-06-19T130213Z`
- Summary: `data/buy-53574-disk-monitor-2026-06-19T130213Z/summary.md`
- State file: `data/buy-53574-disk-state.json`
- Watchdog verdict: `PASS`
- Filesystem: `/dev/vda1`
- Mount path: `/`
- Free space: `33.2 GB` (`35666374656` bytes)
- Usage: `83%`
- Warning threshold: `20 GB`
- Critical threshold: `5 GB`
- Incident creation: none

The BUY-48198 5-minute disk watchdog is installed, running on schedule, and healthy in the current workspace, so BUY-53574 can be closed.
