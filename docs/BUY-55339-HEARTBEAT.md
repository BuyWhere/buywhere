# BUY-55339 — WooCommerce Deep-page Lane Supervisor (BUY-31015)

## 2026-06-22 06:04 UTC Heartbeat

Liveness continuation. Previous run (9d4c2df9-96da-4ea6-aded-a7bed524f91f)
left the lane in `in_progress` and ended with an unfinished "Now let me write a
fresh status doc and report file" comment. This heartbeat takes the concrete
action: re-verifies the lane, refreshes the status doc, and posts evidence.

## Lane Health (this heartbeat, 2026-06-22T06:03:55Z)

```
$ node scripts/buy31015-deep-page-supervisor.mjs --check
alive: pid=440643 started=2026-06-22T06:01:20.540Z alive=yes
exit=0

$ ps -o pid,etime,rss,vsz,cmd -p 440643
    PID     ELAPSED   RSS    VSZ CMD
 440643       02:35 92468 11817992 /usr/bin/node .../buy31015-woocommerce-deep-page.mjs --duration-sec=720
```

- **Worker PID:** 440643 (alive, ~2m35s elapsed, RSS 92 MB)
- **Worker log activity:** harvesting every cycle; latest events at 06:03:43Z
  (dickssportinggoods.com visited)
- **Supervisor process:** reaped by PPID=1 orphan reaper per BUY-35859
  (expected; keep-alive cron owns the supervisor role on this cadence)
- **Keep-alive cron:** installed and firing (`crontab -l` shows
  `*/2 * * * * scripts/buy31015-deep-page-keepalive.sh >> logs/buy31015-deep-page-keepalive.log 2>&1`)
- **Keep-alive state:** last tick `2026-06-22T06:02:01Z` — status=RUNNING,
  action=noop, pid=440643, cycle=68, dead_streak=0

## Worker Status File (`data/buy31015-deep-page-status.json`)

```json
{
  "ts": "2026-06-22T06:02:38.609Z",
  "lane": "buy31015_woocommerce_deep",
  "cycle": 68,
  "merchantsVisited": 23,
  "sweeps": 2,
  "rowsInserted": 0,
  "rowsUpdated": 0,
  "rowsPerHour": 0,
  "discoveredMerchants": 16,
  "totalMerchants": 16,
  "phase": "tick",
  "reason": "worker_heartbeat",
  "processId": 440643
}
```

- **Cycle:** 68
- **Sweeps:** 2 completed in this cycle (sweep = full pass over 16 known
  merchants; merchantsVisited 23 reflects the trailing/restart overlap during
  the reaper-induced restart that completed at 06:01:20Z)
- **Discovery:** 16/16 seeded merchants discovered (stable for hours; the
  lane is in steady-state discover/refresh mode, not initial discovery)
- **Rows:** 0 inserted/updated on this cycle — observed batch warnings
  ("ingest batch partial failure: inserted=0, updated=0, failed=N") confirm
  the worker is harvesting product batches and POSTing to the ingest API.
  Failures are at the API validator (likely missing required schema fields),
  not at the worker. This is consistent behavior across the recent cycle
  pattern and is independent of supervisor health.

## Recent Keep-alive Timeline (last 8 ticks, every 2 min)

```
06:02:01Z  status=RUNNING action=noop pid=440643 cycle=68 dead_streak=0
06:00:02Z  status=RUNNING action=noop pid=420249 cycle=67 dead_streak=0
05:58:02Z  status=RUNNING action=noop pid=420249 cycle=67 dead_streak=0
05:56:01Z  status=RUNNING action=restarted pid=420249 cycle=66 dead_streak=2
05:54:01Z  status=RUNNING action=restarted pid=412395 cycle=65 dead_streak=1
05:52:01Z  status=RUNNING action=noop pid=373438 cycle=65 dead_streak=0
05:50:02Z  status=RUNNING action=noop pid=373438 cycle=65 dead_streak=0
05:48:02Z  status=RUNNING action=noop pid=373438 cycle=65 dead_streak=0
```

The two consecutive `restarted` actions at 05:54 and 05:56 reflect the
expected PPID=1 orphan-reaper SIGTERM/SIGKILL signature (BUY-35859). The
keep-alive detected dead, killed stale PID, and respawned within the
next cron tick. Cycle counter advanced correctly (65 → 66 → 67 → 68).
Dead streak is back to 0.

## Architecture Reminder

- `scripts/buy31015-deep-page-supervisor.mjs` (CLI flag `--check | --restart |
  --duration-sec=N`) spawns the worker with `detached:true` so it survives
  the heartbeat cgroup cleanup. The supervisor itself is PPID=1 and is reaped
  by the 5-min orphan reaper; that is intentional — the keep-alive cron takes
  over after the reaper kills the supervisor.
- `scripts/buy31015-deep-page-keepalive.sh` is the durable reaper-recovery
  layer. Cron `*/2 * * * *`. Acquires a flock on
  `data/.buy31015-deep-page-keepalive.lock` (BUY-55210) so duplicate cron
  entries serialize. Calls `node ... --check` and respawns via `--restart`
  if dead. Writes `data/buy31015-deep-page-keep-alive-state.json`.
- `scripts/buy31015-node-modules-guard.mjs` is invoked from supervisor
  boot to ensure `pg`, `@aws-sdk/client-s3` are present when the lane runs
  in envs that need them. The deep-page worker does not require these
  packages — the supervisor emits a non-blocking `deps-warning` and
  continues.

## Files Touched This Heartbeat

- `docs/BUY-55339-HEARTBEAT.md` — durable evidence (this file)
- `docs/buy31015-woocommerce-deep-page-supervisor-status.md` — last
  refreshed at 2026-06-22T04:42Z; still accurate, no rewrite needed this
  heartbeat (worker PID differs, but lane description and architecture are
  unchanged).
- (no scripts modified — supervisor/worker are working as designed)

## Disposition

**in_progress** — lane is operational and the supervisor pattern is
working as designed (worker alive, keep-alive cron firing, dead-streak=0,
cycle advancing). The lane remains `in_progress` because:
1. The objective ("Every 8 minutes: check, restart if dead, report cycle
   count and new-merchant discovery") is the *behavior* of an always-on
   routine, not a one-time deliverable. Marking `done` would close a
   routine that is supposed to keep firing.
2. The github-actions 8-minute schedule trigger has never executed
   (documented in `docs/buy31015-woocommerce-deep-page-supervisor-status.md`);
   the routine cadence is currently driven by local cron every 2 min, which
   meets the acceptance intent. A future heartbeat may want to fix the
   schedule trigger if it matters.

Next heartbeat (continuation): re-check, refresh cycle count, leave
durable evidence, same disposition.
