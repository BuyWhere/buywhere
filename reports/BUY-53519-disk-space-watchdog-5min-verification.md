# BUY-53519 / BUY-48198 Disk Space Watchdog (5min) Verification

Date: 2026-06-19

## What I verified

- Fixed the watchdog snapshot summary so each execution artifact titles itself with the current execution issue instead of always using the routine id.
- The targeted Node watchdog regression suite passed:
  - `node --test api/tests/disk-watchdog.test.mjs`
- The installed crontab still contains the canonical 5-minute BUY-48198 watchdog entry:
  - `*/5 * * * * cd /paperclip/instances/default/workspaces/476c8023-3635-45bb-9f71-db6f4f5700e1/buywhere-api && WORKSPACES_ROOT=/paperclip/instances/default/workspaces LOG_FILE=/paperclip/instances/default/workspaces/476c8023-3635-45bb-9f71-db6f4f5700e1/buywhere-api/logs/buy48198_disk_watchdog_cron.log bash /paperclip/instances/default/workspaces/476c8023-3635-45bb-9f71-db6f4f5700e1/buywhere-api/scripts/run-buy-48198-disk-watchdog-cron.sh`
- The full issue-scoped BUY-48198 cron wrapper completed successfully in a live smoke run for this issue:
  - `DISK_STATE_FILE=$PWD/data/buy-53519-disk-state.json DISK_SNAPSHOT_DIR=$PWD/data/buy-53519-disk-monitor-2026-06-19T104418Z DISK_EXECUTION_ISSUE=BUY-53519 bash scripts/run-buy-48198-disk-watchdog-cron.sh`

## Results

- Snapshot: `data/buy-53519-disk-monitor-2026-06-19T104418Z/result.json`
- Summary: `data/buy-53519-disk-monitor-2026-06-19T104418Z/summary.md`
- State file: `data/buy-53519-disk-state.json`
- Watchdog verdict: `PASS`
- Generated at: `2026-06-19T10:44:32.749Z`
- Free space after cleanup pipeline: `28.0 GB` (`30065672192` bytes)
- Total filesystem size: `206900281344` bytes
- Warning threshold: `20.0 GB`
- Critical threshold: `5.0 GB`
- Incident creation: none triggered on this run

## Notes

- The first direct smoke run in this heartbeat surfaced the artifact-title mismatch; the follow-up patch corrected the summary heading and preserved the routine id separately in the body.
- The final live smoke run exercised the canonical cron wrapper path and produced a summary headed `BUY-53519`, matching the execution issue for this heartbeat.
