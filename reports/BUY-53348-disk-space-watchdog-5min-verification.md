# BUY-53348 Disk Space Watchdog (5min) Verification

Verified on 2026-06-19 UTC.

## What is installed

- User crontab contains one BUY-48198 / BUY-52997 disk watchdog pipeline entry:
  `*/5 * * * * cd /paperclip/instances/default/workspaces/476c8023-3635-45bb-9f71-db6f4f5700e1/buywhere-api && WORKSPACES_ROOT=/paperclip/instances/default/workspaces LOG_FILE=/paperclip/instances/default/workspaces/476c8023-3635-45bb-9f71-db6f4f5700e1/buywhere-api/logs/buy52997_disk_watchdog_cron.log bash /paperclip/instances/default/workspaces/476c8023-3635-45bb-9f71-db6f4f5700e1/buywhere-api/scripts/run-buy-52997-disk-watchdog-cron.sh`
- The cron wrapper runs:
  1. `scripts/wc-cycle-cleanup.sh`
  2. `scripts/buy-53114-worker-node-artifact-cleanup.sh`
  3. `scripts/run-buy-48198-disk-watchdog.sh`
- The watchdog implementation is `scripts/buy-38913-disk-space-watchdog.cjs` and monitors `/dev/vda1` mounted on `/`.

## Verification

- Syntax checks passed:
  - `bash -n scripts/run-buy-48198-disk-watchdog.sh`
  - `bash -n scripts/setup-buy-48198-disk-watchdog.sh`
  - `bash -n scripts/run-buy-52997-disk-watchdog-cron.sh`
- Latest scheduled completion observed in `logs/buy52997_disk_watchdog_cron.log`:
  - `2026-06-19T04:40:22Z` complete `rc=0`
- Manual watchdog run at `2026-06-19T04:42:10.231Z` returned:
  - status: `PASS`
  - filesystem: `/dev/vda1`
  - mount path: `/`
  - free bytes: `41376141312` (`38.5 GB`)
  - total bytes: `206900281344`
  - last incident: `null`

## Artifacts

- Snapshot: `data/buy-53348-disk-monitor-20260619T044210Z`
- Summary: `data/buy-53348-disk-monitor-20260619T044210Z/summary.md`
- Result JSON: `data/buy-53348-disk-monitor-20260619T044210Z/result.json`

## Notes

- The watchdog is healthy because free space remains above the 20 GB warning threshold and the 5 GB critical threshold.
- The cron entry is installed once; earlier duplicated terminal output came from the grep filter, not from duplicate crontab entries.
