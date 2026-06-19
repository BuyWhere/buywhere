# BUY-53347 Disk Space Watchdog (5min) Verification

Verified on 2026-06-19 UTC.

## What is installed

- Cron entry present in the current workspace user crontab:
  `*/5 * * * * cd /paperclip/instances/default/workspaces/476c8023-3635-45bb-9f71-db6f4f5700e1/buywhere-api && WORKSPACES_ROOT=/paperclip/instances/default/workspaces LOG_FILE=/paperclip/instances/default/workspaces/476c8023-3635-45bb-9f71-db6f4f5700e1/buywhere-api/logs/buy52997_disk_watchdog_cron.log bash /paperclip/instances/default/workspaces/476c8023-3635-45bb-9f71-db6f4f5700e1/buywhere-api/scripts/run-buy-52997-disk-watchdog-cron.sh`
- The cron wrapper runs:
  1. `scripts/wc-cycle-cleanup.sh`
  2. `scripts/buy-53114-worker-node-artifact-cleanup.sh`
  3. `scripts/run-buy-48198-disk-watchdog.sh`
- The watchdog implementation is `scripts/buy-38913-disk-space-watchdog.cjs` and monitors `/dev/vda1` on `/` with:
  - warning threshold: 20 GB
  - critical threshold: 5 GB
  - Paperclip incident creation path when critical

## Verification

- Syntax checks passed:
  - `bash -n scripts/run-buy-48198-disk-watchdog.sh`
  - `bash -n scripts/setup-buy-48198-disk-watchdog.sh`
  - `bash -n scripts/run-buy-52997-disk-watchdog-cron.sh`
- Latest scheduled runs observed in `logs/buy52997_disk_watchdog_cron.log`:
  - `2026-06-19T04:30:22Z` complete `rc=0`
  - `2026-06-19T04:35:23Z` complete `rc=0`
- Manual watchdog run on `2026-06-19T04:37:18Z` returned:
  - status: `PASS`
  - filesystem: `/dev/vda1`
  - mount path: `/`
  - free bytes: `41401114624` (`38.6 GB`)
  - total bytes: `206900281344`
  - last incident: `null`

## Artifacts

- Snapshot: `data/buy-53347-disk-monitor-20260619T043718Z`
- Summary: `data/buy-53347-disk-monitor-20260619T043718Z/summary.md`
- Result JSON: `data/buy-53347-disk-monitor-20260619T043718Z/result.json`

## Notes

- The watchdog is currently healthy because free space is above the warning threshold.
- The 5-minute cron path is still active and completing successfully in this workspace.
