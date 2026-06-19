# BUY-53344 Disk Space Watchdog (5min) Verification

Verified on 2026-06-19 UTC.

## What is installed

- Cron entry present in the current workspace user crontab:
  `*/5 * * * * cd /paperclip/instances/default/workspaces/476c8023-3635-45bb-9f71-db6f4f5700e1/buywhere-api && WORKSPACES_ROOT=/paperclip/instances/default/workspaces LOG_FILE=/paperclip/instances/default/workspaces/476c8023-3635-45bb-9f71-db6f4f5700e1/buywhere-api/logs/buy52997_disk_watchdog_cron.log bash /paperclip/instances/default/workspaces/476c8023-3635-45bb-9f71-db6f4f5700e1/buywhere-api/scripts/run-buy-52997-disk-watchdog-cron.sh`
- The cron wrapper runs:
  1. `scripts/wc-cycle-cleanup.sh`
  2. `scripts/buy-53114-worker-node-artifact-cleanup.sh`
  3. `scripts/run-buy-48198-disk-watchdog.sh`
- The watchdog implementation is in `scripts/buy-38913-disk-space-watchdog.cjs` and monitors `/dev/vda1` with:
  - warning threshold: 20 GB
  - critical threshold: 5 GB
  - Paperclip incident creation path when critical

## Verification

- Latest scheduled runs observed in `logs/buy52997_disk_watchdog_cron.log`:
  - `2026-06-19T04:20:19Z` complete `rc=0`
  - `2026-06-19T04:25:21Z` complete `rc=0`
- Manual watchdog run on `2026-06-19T04:27:00Z` returned:
  - status: `PASS`
  - filesystem: `/dev/vda1`
  - mount path: `/`
  - free bytes: `42080456704` (`39.2 GB`)
  - total bytes: `206900281344`
  - last incident: `null`

## Notes

- The watchdog is currently healthy because free space is above the warning threshold.
- Snapshot artifacts are being written under `data/buy-48198-disk-monitor-*` for each run.
