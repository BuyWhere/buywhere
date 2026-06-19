# BUY-53438 / BUY-48198 Disk Space Watchdog (5min) Canonical Cron Migration

## Summary

- Migrated the installer and active user crontab from the legacy `BUY-52997` cron wrapper alias to the canonical `BUY-48198` wrapper.
- Verified the direct watchdog wrapper and the full cleanup + watchdog cron path both completed successfully on June 19, 2026.
- Confirmed the installed `*/5` cron entry now writes to `logs/buy48198_disk_watchdog_cron.log` and executes `scripts/run-buy-48198-disk-watchdog-cron.sh`.

## Changes

- Updated `scripts/setup-buy-48198-disk-watchdog.sh` to install:
  - `scripts/run-buy-48198-disk-watchdog-cron.sh`
  - `logs/buy48198_disk_watchdog_cron.log`
  - cron comment `BUY-48198: Disk watchdog + cleanup pipeline — every 5 min`
- Expanded installer dedupe filters so reruns replace both legacy and canonical disk-watchdog cron entries cleanly.

## Verification

1. Direct watchdog smoke run
   - Command: `bash scripts/run-buy-48198-disk-watchdog.sh BUY-53438`
   - Time: `2026-06-19T07:58:09Z`
   - Result: `PASS`
   - Snapshot: `data/buy-48198-disk-monitor-2026-06-19T075809Z`
   - Free space: `37.4 GB`

2. Full cron-path smoke run
   - Command: `LOG_FILE=/tmp/buy53438-disk-watchdog-cron.log WORKSPACES_ROOT=/paperclip/instances/default/workspaces DISK_EXECUTION_ISSUE=BUY-53438 bash scripts/run-buy-48198-disk-watchdog-cron.sh`
   - Time: `2026-06-19T07:58:25Z`
   - Result: `rc=0`
   - Snapshot: `data/buy-48198-disk-monitor-2026-06-19T075825Z`
   - Final free space: `37.9 GB`

3. Installer migration run
   - Command: `bash scripts/setup-buy-48198-disk-watchdog.sh`
   - Time: `2026-06-19T07:59:27Z`
   - Result: `Installation complete`
   - Post-install log: `logs/buy48198_disk_watchdog_cron.log`
   - Snapshot: `data/buy-48198-disk-monitor-2026-06-19T075927Z`
   - Final free space: `37.4 GB`

4. Active crontab after migration

```cron
# BUY-48198: Disk watchdog + cleanup pipeline — every 5 min
*/5 * * * * cd /paperclip/instances/default/workspaces/476c8023-3635-45bb-9f71-db6f4f5700e1/buywhere-api && WORKSPACES_ROOT=/paperclip/instances/default/workspaces LOG_FILE=/paperclip/instances/default/workspaces/476c8023-3635-45bb-9f71-db6f4f5700e1/buywhere-api/logs/buy48198_disk_watchdog_cron.log bash /paperclip/instances/default/workspaces/476c8023-3635-45bb-9f71-db6f4f5700e1/buywhere-api/scripts/run-buy-48198-disk-watchdog-cron.sh
```

## Outcome

The 5-minute disk watchdog remains healthy, no incident was created, and future installs now converge on the canonical BUY-48198 cron wrapper instead of the legacy BUY-52997 alias.
