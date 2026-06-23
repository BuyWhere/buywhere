# BUY-56350 / BUY-48198 — Disk Space Watchdog (5 min)

## Summary
Deployed a 5-minute cron-driven disk space watchdog that monitors `/` free space, warns at <20 GB, and creates a critical Paperclip incident at <5 GB. Reuses the canonical `disk_space_watchdog.py` already committed under BUY-48198.

## Files Created
- `scripts/run-buy-56350-disk-space-watchdog-cron.sh` — cron wrapper (sources `~/.paperclip_env`, runs the canonical Python script, captures stdout/stderr to log file)
- `BUY-56350-evidence/` — this evidence directory

## Files Reused (from BUY-48198)
- `disk_space_watchdog.py` — Python script that:
  - Reads free space via `os.statvfs("/")`
  - Logs OK / WARNING / CRITICAL status with UTC timestamp
  - Calls Paperclip `POST /api/companies/{id}/issues` with `severity=critical` when free space < 5 GB
  - Honors `PAPERCLIP_API_URL`, `PAPERCLIP_API_KEY`, `PAPERCLIP_COMPANY_ID`, `PAPERCLIP_RUN_ID` env vars
- `app/services/disk_watchdog.py` — FastAPI-integrated background watchdog
- `app/routers/status.py` — `/v1/status/disk` endpoint
- `tests/services/test_disk_watchdog.py` — unit tests

## Cron Schedule
- Pattern: `*/5 * * * *` (every 5 minutes, UTC)
- Entry: see `cron-entry.txt`
- Log file: `logs/buy-56350-disk-space-watchdog.log`

## Thresholds
- OK: ≥ 20 GB free
- WARNING: < 20 GB free (exit code 1)
- CRITICAL: < 5 GB free (exit code 2, creates Paperclip incident)

## Test Run
```
$ bash scripts/run-buy-56350-disk-space-watchdog-cron.sh
EXIT=0
[2026-06-23T20:15:45Z] Starting disk-space watchdog check (BUY-56350/BUY-48198)...
[2026-06-23T20:15:45Z] Disk free space: 61.82 GB
[2026-06-23T20:15:45Z] OK: Disk space healthy (61.82 GB free)
[2026-06-23T20:15:45Z] Watchdog exited with code 0
```

## Branch Coverage
- OK path (current state, 61.82 GB free): exit 0, "OK" logged
- WARNING path (simulated 10 GB): exit 1, "WARNING" logged, no incident
- CRITICAL path (<5 GB): exit 2, "CRITICAL" logged, creates Paperclip incident

## Current Status
Healthy — 61.82 GB free on `/dev/vda1` (193 GB total, 131 GB used, 68%).
