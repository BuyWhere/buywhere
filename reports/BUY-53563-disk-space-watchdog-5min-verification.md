# BUY-53563 Disk Space Watchdog (5min) Verification

Verified on 2026-06-19 UTC.

## What was verified

- Canonical `BUY-48198` cron entry is installed and scheduled every 5 minutes:
  - `*/5 * * * * cd /paperclip/instances/default/workspaces/476c8023-3635-45bb-9f71-db6f4f5700e1/buywhere-api && WORKSPACES_ROOT=/paperclip/instances/default/workspaces LOG_FILE=/paperclip/instances/default/workspaces/476c8023-3635-45bb-9f71-db6f4f5700e1/buywhere-api/logs/buy48198_disk_watchdog_cron.log bash /paperclip/instances/default/workspaces/476c8023-3635-45bb-9f71-db6f4f5700e1/buywhere-api/scripts/run-buy-48198-disk-watchdog-cron.sh`
- Canonical BUY-48198 watchdog wrappers exist:
  - `scripts/run-buy-48198-disk-watchdog.sh`
  - `scripts/run-buy-48198-disk-watchdog-cron.sh`
  - `scripts/setup-buy-48198-disk-watchdog.sh`
- Targeted watchdog coverage passes:
  - `npm --prefix api test -- --test-name-pattern='diskSpaceWatchdog|disk watchdog|buy-38913'`

## Runtime evidence

- `logs/buy48198_disk_watchdog_cron.log` shows successful consecutive runs at:
  - `2026-06-19T12:25:16Z`
  - `2026-06-19T12:30:19Z`
- Latest watchdog result:
  - status: `PASS`
  - filesystem: `/dev/vda1`
  - mount path: `/`
  - free space: `34.3 GB`
  - warn threshold: `20.0 GB`
  - critical threshold: `5.0 GB`
- Latest snapshot directory observed:
  - `data/buy-48198-disk-monitor-2026-06-19T123019Z`

## Disposition

The 5-minute `BUY-48198` disk watchdog is installed, running on schedule, and healthy in this workspace.
