# BUY-53556 Disk Space Watchdog (5min) Verification

Verified on 2026-06-19 UTC.

## What was verified

- Canonical cron entry is installed for `BUY-48198` and runs every 5 minutes:
  - `*/5 * * * * cd /paperclip/instances/default/workspaces/476c8023-3635-45bb-9f71-db6f4f5700e1/buywhere-api && WORKSPACES_ROOT=/paperclip/instances/default/workspaces LOG_FILE=/paperclip/instances/default/workspaces/476c8023-3635-45bb-9f71-db6f4f5700e1/buywhere-api/logs/buy48198_disk_watchdog_cron.log bash /paperclip/instances/default/workspaces/476c8023-3635-45bb-9f71-db6f4f5700e1/buywhere-api/scripts/run-buy-48198-disk-watchdog-cron.sh`
- API runtime wiring includes the watchdog scheduler via `api/src/index.ts`.
- Canonical BUY-48198 wrappers exist:
  - `scripts/run-buy-48198-disk-watchdog.sh`
  - `scripts/run-buy-48198-disk-watchdog-cron.sh`
  - `scripts/setup-buy-48198-disk-watchdog.sh`
- Targeted watchdog tests pass:
  - `npm --prefix api test -- --test-name-pattern='diskSpaceWatchdog|disk watchdog|buy-38913'`

## Runtime evidence

- `logs/buy48198_disk_watchdog_cron.log` shows recent successful runs at:
  - `2026-06-19T12:10:16Z`
  - `2026-06-19T12:15:15Z`
- Latest watchdog results reported:
  - status: `PASS`
  - filesystem: `/dev/vda1`
  - mount path: `/`
  - free space: `34.5 GB`
  - warn threshold: `20.0 GB`
  - critical threshold: `5.0 GB`
- Latest snapshot directory observed:
  - `data/buy-48198-disk-monitor-2026-06-19T121515Z`

## Disposition

The 5-minute `BUY-48198` disk watchdog is installed, running, and healthy in this workspace.
