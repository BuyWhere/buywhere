# BUY-53278 / BUY-48198 Disk Space Watchdog (5min) Verification

Verified on 2026-06-19 UTC in `/paperclip/instances/default/workspaces/476c8023-3635-45bb-9f71-db6f4f5700e1/buywhere-api`.

## Cron registration

User crontab contains the 5-minute watchdog pipeline entry:

```cron
# BUY-48198 / BUY-52997: Disk watchdog + cleanup pipeline — every 5 min
*/5 * * * * cd /paperclip/instances/default/workspaces/476c8023-3635-45bb-9f71-db6f4f5700e1/buywhere-api && WORKSPACES_ROOT=/paperclip/instances/default/workspaces LOG_FILE=/paperclip/instances/default/workspaces/476c8023-3635-45bb-9f71-db6f4f5700e1/buywhere-api/logs/buy52997_disk_watchdog_cron.log bash /paperclip/instances/default/workspaces/476c8023-3635-45bb-9f71-db6f4f5700e1/buywhere-api/scripts/run-buy-52997-disk-watchdog-cron.sh
```

## Verification

1. Latest observed scheduled wrapper completion from `logs/buy52997_disk_watchdog_cron.log`:
   - Completion: `2026-06-19T01:50:18Z`
   - Result: `BUY-52997 watchdog complete rc=0`

2. Latest observed scheduled watchdog snapshot from the same run:
   - Generated at: `2026-06-19T01:50:18.506Z`
   - Result: `PASS`
   - Free space: `22.4 GB` (`24031039488` bytes)
   - Warn threshold: `20.0 GB`
   - Critical threshold: `5.0 GB`

3. Direct watchdog smoke run for this heartbeat passed:
   - Command: `DISK_EXECUTION_ISSUE=BUY-53278 DISK_SNAPSHOT_DIR="$PWD/data/buy-53278-disk-monitor-smoke" bash scripts/run-buy-48198-disk-watchdog.sh`
   - Generated at: `2026-06-19T01:50:36.185Z`
   - Result: `PASS`
   - Filesystem: `/dev/vda1`
   - Mount path: `/`
   - Free space: `22.4 GB` (`24057774080` bytes)
   - Warn threshold: `20.0 GB`
   - Critical threshold: `5.0 GB`
   - Consecutive critical count: `0`
   - Snapshot: `data/buy-53278-disk-monitor-smoke`

## Conclusion

The BUY-48198 disk watchdog remains installed on a 5-minute schedule through `scripts/run-buy-52997-disk-watchdog-cron.sh`. The latest scheduled pipeline run and the fresh `BUY-53278` smoke run both passed, and current free space remains above the warning and critical thresholds, so no Paperclip incident was created on this heartbeat.
