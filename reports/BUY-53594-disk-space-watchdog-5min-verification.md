# BUY-53594 / BUY-48198 Disk Space Watchdog (5min) Verification

- Restored the missing installer entrypoint `scripts/setup-buy-48198-disk-watchdog.sh` so the documented BUY-48198 install and verification flow matches the current canonical cron wrapper.
- Confirmed the active user crontab contains the canonical 5-minute BUY-48198 entry:
  - `*/5 * * * * cd /paperclip/instances/default/workspaces/476c8023-3635-45bb-9f71-db6f4f5700e1/buywhere-api && WORKSPACES_ROOT=/paperclip/instances/default/workspaces LOG_FILE=/paperclip/instances/default/workspaces/476c8023-3635-45bb-9f71-db6f4f5700e1/buywhere-api/logs/buy48198_disk_watchdog_cron.log bash /paperclip/instances/default/workspaces/476c8023-3635-45bb-9f71-db6f4f5700e1/buywhere-api/scripts/run-buy-48198-disk-watchdog-cron.sh`
- Ran the installer, which reinstalled the canonical crontab line and completed an immediate smoke pass successfully.
- Latest smoke result from `logs/buy48198_disk_watchdog_cron.log`:
  - `2026-06-19T13:42:42Z`
  - Status: `PASS`
  - Filesystem: `/dev/vda1`
  - Free space: `32.3 GB`
  - Used: `84%`
  - Incident created: `false`

## Verification

1. Targeted regression suite
   - Command: `node --test api/tests/disk-watchdog.test.mjs`
   - Result: `PASS` (`8` tests, `0` failures)
2. Script syntax validation
   - Commands:
     - `bash -n scripts/run-buy-48198-disk-watchdog.sh`
     - `bash -n scripts/run-buy-48198-disk-watchdog-cron.sh`
     - `bash -n scripts/setup-buy-48198-disk-watchdog.sh`
   - Result: all passed
3. Installed schedule check
   - Command: `crontab -l | rg -n "run-buy-48198-disk-watchdog-cron\\.sh|BUY-48198: Disk watchdog" -S`
   - Result: active `*/5` BUY-48198 cron label and command present
4. Immediate smoke pass
   - Command: `bash scripts/setup-buy-48198-disk-watchdog.sh`
   - Result: completed successfully; cron wrapper log ended with `BUY-48198 watchdog complete rc=0`

The BUY-48198 5-minute disk watchdog is installed, runnable, and healthy in the current workspace, so BUY-53594 can be closed.
