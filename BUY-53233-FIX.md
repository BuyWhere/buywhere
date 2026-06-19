# BUY-53233 WooCommerce deep-page lane supervisor — supervisor PID race + throttle fix

## Problem

The keepalive script (`buy31015-deep-page-keepalive.sh`) spawned a new supervisor
run-mode process on **every tick** (~30s–2min intervals). The `launch_supervisor()`
function used `rm -f` then `echo` to write the PID file, leaving a window where
concurrent ticks saw no PID file and also spawned. Evidence: **13 overlapping
supervisors** spawned in 13 minutes (keepalive log), all monitoring the same
worker (PID 2100057).

## Changes to `scripts/buy31015-deep-page-keepalive.sh`

- **Atomic PID file write** — `launch_supervisor()` writes to `.tmp` then
  `mv -f` renames, eliminating the race window.
- **Throttle gate** — `SUPERVISOR_THROTTLE` file records the Unix timestamp
  of the last spawn. Both alive and dead branches check `check_supervisor_alive()`
  AND a 600s throttle before calling `launch_supervisor()`. Caps supervisor
  spawning to once per 10 minutes regardless of tick cadence.
- **Refactored fallback spawn** — Extracted inline `setsid bash -c` into
  `spawn_fallback_worker()` for reuse.
- **Lane env sourcing** — Added `LANE_ENV` sourcing at the top so the keepalive
  inherits `BUYWHERE_API_URL` for supervisor and child worker.

## Current worker health

- PID 2100057, 19 cycles complete, 2,014 products seen
- 7,400+ rows/hr, no ingest errors
- Cycling through 16 merchants, no issues

## Verification

- `bash -n scripts/buy31015-deep-page-keepalive.sh` — syntax OK
