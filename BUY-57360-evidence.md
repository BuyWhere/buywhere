# BUY-57360: Monitor Carousell SG Scraper Daemon — Implementation Evidence

## Summary

Implemented comprehensive monitoring for the Carousell SG scraper daemon stack, covering three layers: the running daemon script, the API service, and a live HTTP endpoint.

## Changes Made

### 1. `scripts/carousell_sg_monitor_daemon.py` — Alerting integration

- Added `_send_alert()` function using `urllib` to POST JSON payloads to a configured webhook (`ALERT_WEBHOOK_URL` env var)
- Added `alert_if_needed()` helper that evaluates restart rate and situation context before sending
- Integrated 3 alert triggers in `main_loop()`:
  - **Stale JSONL output** → `alert_if_needed(restarts, "stale")`
  - **High restart rate** (≥3/hour) → `alert_if_needed(restarts, "high_restart_rate_...")`
  - **Restart failed** → `alert_if_needed(restarts, "restart_failed")`

All alerts are silent if `ALERT_WEBHOOK_URL` is not set (no-op), so existing deployments are unaffected.

### 2. `app/routers/monitoring.py` — New live-monitoring API router

Two new endpoints:

| Endpoint | Description |
|---|---|
| `GET /monitoring/carousell-sg` | Returns live status: daemon PID health checks, latest monitor-status.json, scheduler state, restart counters, and file-existence checks |
| `GET /monitoring/carousell-sg/logs?tail=50` | Tail the monitor daemon's log file |

### 3. `app/main.py` — Router registration

- Added `monitoring` to the router imports
- Added `app.include_router(monitoring.router)` after the v2 router

## Existing monitoring infrastructure preserved

- `app/services/carousell_sg_monitor.py` — `CarousellSGDaemonMonitor` class with `check()`, `restart()`, and `to_dict()` methods (unchanged)
- Scheduler health checks, PID files, restart counters, and JSONL freshness checks remain in place
