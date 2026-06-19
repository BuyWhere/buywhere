# BUY-53604 / BUY-48198 Disk Space Watchdog (5min) Verification

- Verified on: `2026-06-19`
- Issue: `BUY-53604`
- Routine/source issue: `BUY-48198`

## What was validated

- The active user crontab contains the canonical 5-minute BUY-48198 watchdog entry:
  - `*/5 * * * * cd /paperclip/instances/default/workspaces/476c8023-3635-45bb-9f71-db6f4f5700e1/buywhere-api && WORKSPACES_ROOT=/paperclip/instances/default/workspaces LOG_FILE=/paperclip/instances/default/workspaces/476c8023-3635-45bb-9f71-db6f4f5700e1/buywhere-api/logs/buy48198_disk_watchdog_cron.log bash /paperclip/instances/default/workspaces/476c8023-3635-45bb-9f71-db6f4f5700e1/buywhere-api/scripts/run-buy-48198-disk-watchdog-cron.sh`
- The wrapper scripts parse cleanly:
  - `scripts/run-buy-48198-disk-watchdog.sh`
  - `scripts/run-buy-48198-disk-watchdog-cron.sh`
  - `scripts/setup-buy-48198-disk-watchdog.sh`
- The current checkout's regression coverage for the watchdog and worker-artifact cleanup passes.

## Test evidence

1. Script syntax checks
   - Command: `bash -n scripts/run-buy-48198-disk-watchdog.sh && bash -n scripts/run-buy-48198-disk-watchdog-cron.sh && bash -n scripts/setup-buy-48198-disk-watchdog.sh`
   - Result: passed

2. Targeted regression tests
   - Command: `node --test api/tests/disk-watchdog.test.mjs tests/worker-node-artifact-cleanup.test.mjs`
   - Result: `11` tests passed, `0` failed

3. Live cron-wrapper smoke run
   - Command: `DISK_STATE_FILE=/tmp/buy-53604-disk-state.json DISK_SNAPSHOT_DIR=$PWD/data/buy-53604-disk-monitor-2026-06-19T140023Z LOG_FILE=$PWD/logs/buy53604_disk_watchdog_cron.log DISK_EXECUTION_ISSUE=BUY-53604 bash scripts/run-buy-48198-disk-watchdog-cron.sh`
   - Result: passed at `2026-06-19T14:00:37.906Z`
   - Snapshot: `data/buy-53604-disk-monitor-2026-06-19T140023Z`
   - Log: `logs/buy53604_disk_watchdog_cron.log`
   - Free space: `32 GB`
   - Disk usage: `84%`
   - Incident created: `false`

## Outcome

The BUY-48198 5-minute disk watchdog is installed, scheduled, and healthy in the current workspace. The fresh BUY-53604 smoke run completed after both cleanup stages and the watchdog ended with `rc=0`, so BUY-53604 can be closed.
