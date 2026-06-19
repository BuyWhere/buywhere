# BUY-53588 / BUY-48198 Disk Space Watchdog (5min) Verification

- Verified on: `2026-06-19`
- Routine/source issue: `BUY-48198`

## What I checked

- The user crontab still contains the canonical BUY-48198 5-minute entry pointing at `scripts/run-buy-48198-disk-watchdog-cron.sh`.
- The targeted watchdog regression suite passes in the current workspace.
- The canonical shell wrappers parse cleanly with `bash -n`.
- A fresh issue-scoped smoke run of the BUY-48198 cron wrapper completed successfully.
- The scheduled watchdog log continues to show successful 5-minute runs after installation.

## Verification

1. Targeted watchdog regression suite
   - Command: `node --test api/tests/disk-watchdog.test.mjs`
   - Result: `7/7` passing

2. Shell syntax checks
   - Commands:
     - `bash -n scripts/run-buy-48198-disk-watchdog.sh`
     - `bash -n scripts/run-buy-48198-disk-watchdog-cron.sh`
   - Result: pass

3. Installed cron entry
   - Command: `crontab -l`
   - Matching entry:
     `*/5 * * * * cd /paperclip/instances/default/workspaces/476c8023-3635-45bb-9f71-db6f4f5700e1/buywhere-api && WORKSPACES_ROOT=/paperclip/instances/default/workspaces LOG_FILE=/paperclip/instances/default/workspaces/476c8023-3635-45bb-9f71-db6f4f5700e1/buywhere-api/logs/buy48198_disk_watchdog_cron.log bash /paperclip/instances/default/workspaces/476c8023-3635-45bb-9f71-db6f4f5700e1/buywhere-api/scripts/run-buy-48198-disk-watchdog-cron.sh`

4. Live cron-wrapper smoke run
   - Command:
     `DISK_STATE_FILE=$PWD/data/buy-53588-disk-state.json DISK_SNAPSHOT_DIR=$PWD/data/buy-53588-disk-monitor-2026-06-19T132720Z DISK_EXECUTION_ISSUE=BUY-53588 LOG_FILE=$PWD/logs/buy-53588_disk_watchdog_cron.log bash scripts/run-buy-48198-disk-watchdog-cron.sh`
   - Result: `rc=0`

## Runtime evidence

- Scheduled cron log: `logs/buy48198_disk_watchdog_cron.log`
  - observed scheduled success at `2026-06-19T13:25:01Z`
- Smoke log: `logs/buy-53588_disk_watchdog_cron.log`
  - `2026-06-19T13:27:20Z` start
  - `2026-06-19T13:27:20Z` complete `rc=0`
- Snapshot: `data/buy-53588-disk-monitor-2026-06-19T132720Z`
- Summary: `data/buy-53588-disk-monitor-2026-06-19T132720Z/summary.md`
- State file: `data/buy-53588-disk-state.json`
- Watchdog verdict: `PASS`
- Filesystem: `/dev/vda1`
- Mount path: `/`
- Free space: `32.7 GB` (`35154898944` bytes)
- Usage: `84%`
- Warning threshold: `20 GB`
- Critical threshold: `5 GB`
- Incident creation: none

The BUY-48198 5-minute disk watchdog remains installed, runs on schedule, and passes a fresh smoke check in this workspace, so BUY-53588 can be closed.
