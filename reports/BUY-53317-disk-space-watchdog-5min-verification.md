# BUY-53317 Disk Space Watchdog (5min) Verification

Verified the existing `BUY-48198` 5-minute disk watchdog remains installed and healthy on this heartbeat.

## What I checked

- Active user crontab entry for the shared cleanup-plus-watchdog wrapper:
  - `# BUY-48198 / BUY-52997: Disk watchdog + cleanup pipeline — every 5 min`
  - `*/5 * * * * cd /paperclip/instances/default/workspaces/476c8023-3635-45bb-9f71-db6f4f5700e1/buywhere-api && WORKSPACES_ROOT=/paperclip/instances/default/workspaces LOG_FILE=/paperclip/instances/default/workspaces/476c8023-3635-45bb-9f71-db6f4f5700e1/buywhere-api/logs/buy52997_disk_watchdog_cron.log bash /paperclip/instances/default/workspaces/476c8023-3635-45bb-9f71-db6f4f5700e1/buywhere-api/scripts/run-buy-52997-disk-watchdog-cron.sh`
- Latest scheduled log activity from [logs/buy52997_disk_watchdog_cron.log](/paperclip/instances/default/workspaces/476c8023-3635-45bb-9f71-db6f4f5700e1/buywhere-api/logs/buy52997_disk_watchdog_cron.log):
  - `2026-06-19T03:15:01Z` watchdog start
  - `2026-06-19T03:15:02Z` WC cleanup complete with `rc=0`
  - `2026-06-19T03:15:15Z` worker cleanup complete with `rc=0`
  - `2026-06-19T03:15:15Z` watchdog complete with `rc=0`
- Direct watchdog smoke run:
  - Command: `bash scripts/run-buy-48198-disk-watchdog.sh BUY-53317`
  - Result: `status=PASS`
- Current filesystem state from `df -h / /paperclip/instances/default/workspaces`:
  - `/dev/vda1 193G size, 171G used, 23G avail, 89% used`

## Direct run output

```json
{
  "generated_at": "2026-06-19T03:15:51.930Z",
  "status": "PASS",
  "filesystem": "/dev/vda1",
  "mount_path": "/",
  "free_bytes": 23644127232,
  "warn_bytes": 21474836480,
  "critical_bytes": 5368709120,
  "execution_identifier": "BUY-53317",
  "notes": [
    "free=22.0 GB (23644127232 B) warn<20.0 GB critical<5.0 GB"
  ]
}
```

## Conclusion

The `BUY-48198` disk watchdog remains installed on the 5-minute cron cadence and is currently healthy. Free space is still above both the `20 GB` warning threshold and the `5 GB` critical threshold, so no Paperclip incident was created for this heartbeat.
