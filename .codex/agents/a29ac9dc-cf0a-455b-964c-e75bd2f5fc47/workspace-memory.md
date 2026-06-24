# Workspace Memory - BUY-31015 WooCommerce Deep-page Lane Supervisor

## Issue Status
- Most recent: BUY-54957 WooCommerce deep-page lane supervisor (BUY-31015)
- Status: done (closed 2026-06-21T11:32Z)
- Previous: BUY-54940 (done 2026-06-21T10:53Z), BUY-54932 (done 2026-06-21T10:36Z), BUY-54907 (done 2026-06-21T09:34Z)

## Lane Components
- Supervisor: scripts/buy31015-deep-page-supervisor.mjs (BUY-52234 deps check soft-warned in BUY-54932)
- Worker: scripts/buy31015-woocommerce-deep-page.mjs
- Keepalive: scripts/buy31015-deep-page-keepalive.sh
- Keepalive cron: run-buy-51993-deep-page-keepalive.sh (every 2 min)
- State files: data/buy31015-deep-page-*.json
- Known merchants: data/buy31015-wc-known-merchants.json (1,518 merchants)

## Current Status (2026-06-21T11:32Z, end of BUY-54957 heartbeat)
- Cycle: 324
- Worker PID: 464081 (post-restart; setsid-detached, PPID=1)
- Rows updated: 108 (cycle 324 mid-tick, ~24s after restart)
- rowsPerHour: 16,281 (post-restart acceleration typical)
- Merchants visited: 12 (cycle 324 mid-tick)
- Supervisor: healthy, --check returns exit 0 with deps-warning soft-note
- Keep-alive state: RUNNING, consecutive_dead=0, last_action=noop

## This Heartbeat Action (BUY-54957)
- Detected dead worker pid=429805 via --check (worker exited cleanly after cycle 323 signal-end at 11:30:29Z)
- Verified dead: `ls /proc/429805` -> No such file or directory
- Restarted via `node scripts/buy31015-deep-page-supervisor.mjs --restart` -> pid=464081
- Confirmed new worker is setsid-detached (PPID=1, Ssl, --check returns alive=yes)
- Cycle 324 healthy at 16,281 rows/hr post-restart
- Posted comment + marked BUY-54957 done
- Wrote reports/BUY-54957-IMPLEMENTATION.md

## Cycle Progression Since BUY-54940
| Cycle | Closed/Active | merchants | rowsUpdated | rows/hr | Note |
|-------|---------------|-----------|-------------|---------|------|
| 319 | closed (BUY-54940) | 25 | 211 | 11,253 | post-restart healthy |
| 320 | closed | — | — | — | reaped mid-cycle |
| 321 | closed | 73 | 535 | 8,503 | reaped mid-cycle |
| 322 | closed | — | — | — | reaped mid-cycle |
| 323 | closed | 85 | 540 | 7,253 | reaped at ~11:30Z after harvesting 85 merchants (largest cycle) |
| 324 | active | 12 | 108 | 16,281 | post-restart healthy (acceleration) |

## Notes
- Lane is fully operational with supervisor + keepalive cron
- Worker deaths happen both: (a) clean cycle-end exit (wait for next cron tick to restart), (b) reaped by paperclip-orphan-reaper cron (root, every 5 min, RSS>10MB filter on PPID=1)
- Supervisor --restart recovers within ~10s of detection
- Permanent reaper fix still requires root cgroup move (out of Dash scope)
- BUY-52234 deps check is now scoped appropriately: warning for non-importers, hard-fail (in scripts/buy31015-node-modules-guard.mjs) for lanes that do import

## BUY-55238 Heartbeat (2026-06-22T02:04Z)
- Latest routine heartbeat: BUY-55238
- Status: done (closed 2026-06-22T02:04:20Z)
- Detected dead pid=2983890 via --check at 02:00:33Z (clean cycle-32 exit)
- Restarted via supervisor --restart -> pid=3033255 setsid-detached (PPID=1, Ssl)
- Cycle 33 mid-tick: 14 merchants, 108 rows, 7,916 rows/hr
- Keepalive RUNNING, consecutive_dead=0
- Worker deaths continue to be clean cycle-end timeouts (--duration-sec=720), not crashes
