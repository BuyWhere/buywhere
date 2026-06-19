# BUY-53389 / BUY-48198 Disk Space Watchdog (5min) Verification

## Summary

- Verified the active 5-minute cron still points at the shared cleanup + watchdog pipeline wrapper `scripts/run-buy-52997-disk-watchdog-cron.sh`.
- Confirmed the BUY-48198 installer and watchdog entrypoints all pass shell syntax checks.
- Ran a fresh issue-scoped watchdog smoke test for `BUY-53389` at `2026-06-19T06:24:01Z`; it completed in `PASS` with no incident created.
- Current free space is `36.7 GB`, which remains above the `20 GB` warning threshold and `5 GB` critical threshold.

## Verification

1. Syntax checks
   - `bash -n scripts/setup-buy-48198-disk-watchdog.sh`
   - `bash -n scripts/run-buy-48198-disk-watchdog-cron.sh`
   - `bash -n scripts/run-buy-52997-disk-watchdog-cron.sh`
   - `bash -n scripts/run-buy-48198-disk-watchdog.sh`

2. Active cron entry
   - `crontab -l | rg -n "run-buy-(48198|52997)-disk-watchdog-cron\\.sh|BUY-48198: Disk watchdog" -S`

```cron
*/5 * * * * cd /paperclip/instances/default/workspaces/476c8023-3635-45bb-9f71-db6f4f5700e1/buywhere-api && WORKSPACES_ROOT=/paperclip/instances/default/workspaces LOG_FILE=/paperclip/instances/default/workspaces/476c8023-3635-45bb-9f71-db6f4f5700e1/buywhere-api/logs/buy52997_disk_watchdog_cron.log bash /paperclip/instances/default/workspaces/476c8023-3635-45bb-9f71-db6f4f5700e1/buywhere-api/scripts/run-buy-52997-disk-watchdog-cron.sh
```

3. Latest scheduled run evidence
   - `tail -n 40 logs/buy48198_disk_watchdog_cron.log`
   - Latest scheduled completion observed: `2026-06-19T05:24:39Z`
   - Result: `status=PASS`, `free=37.0 GB`, `rc=0`

4. Fresh issue-scoped smoke run
   - Command:

```bash
DISK_STATE_FILE="$PWD/data/buy-53389-disk-state.json" \
DISK_SNAPSHOT_DIR="$PWD/data/buy-53389-disk-monitor-20260619T062401Z" \
bash scripts/run-buy-48198-disk-watchdog.sh BUY-53389
```

   - Result:

```json
{
  "generated_at": "2026-06-19T06:24:01.650Z",
  "status": "PASS",
  "filesystem": "/dev/vda1",
  "mount_path": "/",
  "free_bytes": 39429472256,
  "warn_bytes": 21474836480,
  "critical_bytes": 5368709120,
  "snapshot_dir": "/paperclip/instances/default/workspaces/476c8023-3635-45bb-9f71-db6f4f5700e1/buywhere-api/data/buy-53389-disk-monitor-20260619T062401Z",
  "source_identifier": "BUY-48198",
  "execution_identifier": "BUY-53389",
  "alert_issue_identifier": "BUY-30808",
  "notes": [
    "free=36.7 GB (39429472256 B) warn<20.0 GB critical<5.0 GB"
  ]
}
```

5. Smoke-run artifacts
   - `data/buy-53389-disk-monitor-20260619T062401Z/result.json`
   - `data/buy-53389-disk-monitor-20260619T062401Z/state.json`
   - `data/buy-53389-disk-monitor-20260619T062401Z/status.txt`
   - `data/buy-53389-disk-monitor-20260619T062401Z/summary.md`

## Conclusion

- The installed 5-minute cron remains present and wired to the shared cleanup pipeline wrapper, which executes the BUY-48198 watchdog wrapper.
- The latest scheduled run and the fresh manual verification both stayed in `PASS`, so no follow-up incident or code change was required for `BUY-53389`.
