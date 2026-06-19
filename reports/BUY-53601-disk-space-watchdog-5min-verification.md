# BUY-53601 Disk Space Watchdog (5min) Verification

Date: 2026-06-19

## What I verified

- The BUY-48198 watchdog cron entry is installed on a 5-minute schedule:
  `*/5 * * * * cd /paperclip/instances/default/workspaces/476c8023-3635-45bb-9f71-db6f4f5700e1/buywhere-api && WORKSPACES_ROOT=/paperclip/instances/default/workspaces LOG_FILE=/paperclip/instances/default/workspaces/476c8023-3635-45bb-9f71-db6f4f5700e1/buywhere-api/logs/buy48198_disk_watchdog_cron.log bash /paperclip/instances/default/workspaces/476c8023-3635-45bb-9f71-db6f4f5700e1/buywhere-api/scripts/run-buy-48198-disk-watchdog-cron.sh`
- The watchdog-specific shell and Node tests pass:
  `node --test api/tests/disk-watchdog.test.mjs tests/worker-node-artifact-cleanup.test.mjs`
- A live cron-wrapper smoke run completed successfully through cleanup and watchdog stages:
  `bash scripts/run-buy-48198-disk-watchdog-cron.sh`

## Observed live result

- Latest smoke completion in `logs/buy48198_disk_watchdog_cron.log` finished with `rc=0`.
- The watchdog reported:
  - Filesystem: `/dev/vda1`
  - Mount path: `/`
  - Free space: `32.1 GB`
  - Warn threshold: `20 GB`
  - Critical threshold: `5 GB`
  - Verdict: `PASS`
- No Paperclip incident was created because free space remained above both thresholds.

## Notes

- The cron wrapper runs the cleanup stages before the watchdog and tolerates cleanup exit code `10` so threshold alerts in cleanup do not prevent the watchdog from executing.
- The worker artifact cleanup already covers both historical snapshot naming patterns: `buy-*-disk-monitor-*` and `buy-*-disk-watchdog-*`.
