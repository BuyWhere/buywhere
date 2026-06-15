#!/usr/bin/env bash
# BUY-31142 Crew REST sub-lane keep-alive tick (BUY-38482).
#
# Run this on every heartbeat tick (interval must be < worker --duration-sec,
# i.e. sub-5-min, so a successfully spawned worker is still alive on the next
# tick). It:
#   1. Decides whether a live worker is running (pidfile + proc alive + cmdline
#      match + fresh heartbeat).
#   2. If alive -> reset the dead-tick streak and exit.
#   3. If dead  -> bump the streak, (re)spawn the worker with
#      --duration-sec=240, and append an escalation entry to
#      data/buy31142-keep-alive-escalation.json once 4+ consecutive ticks have
#      seen it dead. The escalation file always carries the current streak for
#      the next human/routine triage.
#
# Why the worker exits at 240s: the heartbeat cgroup kills the lane between
# heartbeats, so the worker runs 240s (< 5 min) and exits cleanly before the
# kill; this tick respawns it so the lane stays alive.
#
# Env overrides: DURATION_SEC, STALL_SEC, ESCALATE_THRESHOLD, NODE_BIN,
#   WC_LANE_STATE_DIR, WC_WORKER_LOG.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DATA_DIR="${WC_LANE_STATE_DIR:-$REPO_ROOT/data}"
ENV_FILE="${WC_LANE_STATE_DIR:-$REPO_ROOT/data}/.env.buy31015-lane"

WORKER="$SCRIPT_DIR/buy31142-crew-wc-rest.mjs"
PIDFILE="$DATA_DIR/buy31142-crew-wc-rest.pid"
HEARTBEATFILE="$DATA_DIR/buy31142-crew-wc-rest.heartbeat"
STATUSFILE="$DATA_DIR/buy31142-crew-wc-rest-status.json"
ESCALATIONFILE="$DATA_DIR/buy31142-keep-alive-escalation.json"
TICKLOG="$DATA_DIR/buy31142-crew-wc-rest-keep-alive.log"
WORKERLOG="${WC_WORKER_LOG:-$DATA_DIR/buy31142-crew-wc-rest-worker.log}"

DURATION_SEC="${DURATION_SEC:-240}"        # worker run window (must be < tick interval)
STALL_SEC="${STALL_SEC:-120}"             # heartbeat older than this => stalled => dead
ESCALATE_THRESHOLD="${ESCALATE_THRESHOLD:-4}"  # >= this many consecutive dead ticks => escalate
NODE_BIN="${NODE_BIN:-node}"
MARKER="buy31142-crew-wc-rest.mjs"

mkdir -p "$DATA_DIR"

ts() { date -u +"%Y-%m-%dT%H:%M:%SZ"; }

# Tee a line to both stdout and the tick log.
say() { local line="[$(ts)] $*"; echo "$line"; echo "$line" >> "$TICKLOG"; }

# ---------------------------------------------------------------------------
# Liveness decision + escalation bookkeeping (one node invocation).
# Prints key=value lines for easy shell parsing. Never exits non-zero: on any
# internal error it reports the worker as dead so we respawn safely.
# ---------------------------------------------------------------------------
read -r -d '' CHECK_JS <<'JS' || true
const fs = require('fs');
const PATHS = {
  pid: process.env.PIDFILE,
  hb: process.env.HEARTBEATFILE,
  status: process.env.STATUSFILE,
  esc: process.env.ESCALATIONFILE,
};
const STALL_SEC = Number(process.env.STALL_SEC || 120);
const THRESHOLD = Number(process.env.ESCALATE_THRESHOLD || 4);
const MARKER = process.env.MARKER || 'buy31142-crew-wc-rest.mjs';
const now = Date.now();
const out = {};

function emit(o) {
  for (const k of Object.keys(o)) process.stdout.write(`${k}=${o[k]}\n`);
}

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

// Snapshot heartbeat and pidfile ONCE before any evaluation, so a replacement
// worker overwriting them mid-check cannot flip state mid-evaluation.
let hbData = {};
let pidFromFile = 0;
let heartbeatMtimeMs = 0;
try {
  const hbStat = fs.statSync(PATHS.hb);
  heartbeatMtimeMs = hbStat.mtimeMs;
  hbData = readJson(PATHS.hb, {});
  pidFromFile = parseInt(String(fs.readFileSync(PATHS.pid, 'utf8')).trim(), 10) || 0;
} catch {}
out.hb_mtime_ms = heartbeatMtimeMs;
out.pid = pidFromFile;

// Find alive process: check pidfile PID first; if dead, scan for any node
// process running the worker marker (handles replacement-worker race: a newer
// worker may have overwritten the pidfile while we were preparing).
let alivePid = 0;
let procAlive = false;
let cmdlineOk = false;
let heartbeatAgeSec = -1;
let pidSource = 'none';

if (pidFromFile) {
  try { process.kill(pidFromFile, 0); procAlive = true; } catch {}
  if (procAlive) {
    try { cmdlineOk = fs.readFileSync(`/proc/${pidFromFile}/cmdline`, 'utf8').includes(MARKER); }
    catch { cmdlineOk = true; }
  }
}

if (procAlive && cmdlineOk) {
  // pidfile PID is alive and matches marker — use it.
  alivePid = pidFromFile;
  pidSource = 'pidfile';
} else {
  // pidfile PID is dead or mismatched — scan for any live node worker.
  // Require cmdline to contain the marker AND start with "node" to avoid matching
  // unrelated processes (bash, python, etc.) whose cmdline contains the marker.
  try {
    const tasks = fs.readdirSync('/proc').filter(d => /^\d+$/.test(d));
    for (const tid of tasks) {
      try {
        const cmdline = fs.readFileSync(`/proc/${tid}/cmdline`, 'utf8').replace(/\x00/g, ' ');
        if (cmdline.startsWith('node ') && cmdline.includes(MARKER)) {
          try { process.kill(Number(tid), 0); } catch { continue; }
          alivePid = Number(tid);
          pidSource = 'scan';
          procAlive = true;
          cmdlineOk = true;
          break;
        }
      } catch { continue; }
    }
  } catch {}
}

out.pid_source = pidSource;
out.proc_alive = procAlive ? 1 : 0;
out.cmdline_ok = cmdlineOk ? 1 : 0;
out.alive_pid = alivePid;

// Heartbeat age based on snapshot mtime (not subject to mid-check overwrites).
if (heartbeatMtimeMs > 0) {
  heartbeatAgeSec = Math.max(0, Math.round((now - heartbeatMtimeMs) / 1000));
}
out.heartbeat_age_sec = heartbeatAgeSec;

const status = readJson(PATHS.status, {});
let cooldownUntil = null;
let cooldownActive = false;
if (status && typeof status.pauseUntil === 'string') {
  const pauseTs = Date.parse(status.pauseUntil);
  if (!Number.isNaN(pauseTs) && pauseTs > now) {
    cooldownActive = true;
    cooldownUntil = status.pauseUntil;
  }
}
out.cooldown_active = cooldownActive ? 1 : 0;
out.cooldown_until = cooldownUntil || '';

const heartbeatFresh = heartbeatAgeSec >= 0 && heartbeatAgeSec <= STALL_SEC;
// alive = cooldown OR (found an alive pid AND heartbeat is fresh)
// If heartbeat is fresh but the alive pid differs from the pidfile pid,
// it means a replacement worker started and overwrote the pidfile — treat as alive.
const alive = cooldownActive || (procAlive && cmdlineOk && heartbeatFresh);
out.alive = alive ? 1 : 0;

try {
  const esc = readJson(PATHS.esc, null) || {
    lane: 'crew-wc-rest',
    issue: 'BUY-31142',
    worker: 'scripts/buy31142-crew-wc-rest.mjs',
    consecutive_dead_ticks: 0,
    last_alive_at: null,
    last_dead_at: null,
    last_pid: null,
    last_heartbeat_age_sec: null,
    escalations: [],
  };
  esc.last_tick_at = new Date(now).toISOString();

  if (alive) {
    esc.consecutive_dead_ticks = 0;
    esc.last_alive_at = new Date(now).toISOString();
    esc.cooldown_until = cooldownActive ? cooldownUntil : null;
    esc.cooldown_reason = cooldownActive ? (status.pauseReason || 'ingest_rate_limit') : null;
  } else {
    esc.consecutive_dead_ticks = (Number(esc.consecutive_dead_ticks) || 0) + 1;
    esc.last_dead_at = new Date(now).toISOString();
    esc.last_pid = pid || null;
    esc.last_heartbeat_age_sec = heartbeatAgeSec;
    if (esc.consecutive_dead_ticks >= THRESHOLD) {
      const reason = !pid ? 'no-pidfile'
        : !procAlive ? 'process-gone'
        : !cmdlineOk ? 'pid-recycled-non-worker'
        : !heartbeatFresh ? 'heartbeat-stale'
        : 'unknown';
      (esc.escalations = esc.escalations || []).push({
        at: new Date(now).toISOString(),
        streak: esc.consecutive_dead_ticks,
        pid: pid || null,
        heartbeat_age_sec: heartbeatAgeSec,
        reason,
      });
      // Cap the escalation history so the file stays bounded.
      if (esc.escalations.length > 50) esc.escalations = esc.escalations.slice(-50);
    }
  }

  // Atomic write.
  try {
    fs.writeFileSync(PATHS.esc + '.tmp', JSON.stringify(esc, null, 2) + '\n');
    fs.renameSync(PATHS.esc + '.tmp', PATHS.esc);
  } catch (e) {
    out.escalation_write_error = String(e && e.message || e);
  }

  out.streak = esc.consecutive_dead_ticks;
  out.escalate = esc.consecutive_dead_ticks >= THRESHOLD ? 1 : 0;
  out.respawn = alive ? 0 : 1;
  emit(out);
} catch (e) {
  emit({ alive: 0, proc_alive: 0, cmdline_ok: 0, heartbeat_age_sec: -1,
         streak: 1, escalate: 0, respawn: 1, pid: 0, error: String(e && e.message || e) });
}
JS

eval "$(
  PIDFILE="$PIDFILE" HEARTBEATFILE="$HEARTBEATFILE" STATUSFILE="$STATUSFILE" ESCALATIONFILE="$ESCALATIONFILE" \
  STALL_SEC="$STALL_SEC" ESCALATE_THRESHOLD="$ESCALATE_THRESHOLD" MARKER="$MARKER" \
  "$NODE_BIN" --input-type=commonjs -e "$CHECK_JS" \
  | while IFS='=' read -r k v; do [ -n "$k" ] && printf '%s=%q\n' "$k" "$v"; done
)"

: "${alive:=0}"
: "${proc_alive:=0}"
: "${pid:=0}"
: "${alive_pid:=0}"
: "${pid_source:=none}"
: "${streak:=0}"
: "${escalate:=0}"
: "${respawn:=1}"
: "${cooldown_active:=0}"
: "${cooldown_until:=}"
: "${heartbeat_age_sec:=-1}"

if [ "${cooldown_active}" = "1" ]; then
  say "paused: cooldown active until ${cooldown_until}; worker respawn suppressed"
  exit 0
fi

if [ "${alive}" = "1" ]; then
  say "alive: pid=${alive_pid} heartbeat_age=${heartbeat_age_sec}s streak=0 (reset) [pid_source=${pid_source}]"
  exit 0
fi

# --- dead branch: bump already recorded; now (re)spawn -------------------
# If a stalled worker process is still alive (proc up but heartbeat stale), or
# a recycled PID holds the pidfile, stop it so the new worker can reclaim.
# Safety: if pid_source=scan, a replacement worker is already running (it
# overwrote the pidfile).  In that case the pidfile PID is the OLD worker
# (already dead/missing) — skip killing alive_pid which is the new worker.
if [ "${proc_alive}" = "1" ] && [ "${pid}" != "0" ]; then
  if [ "${pid_source}" = "scan" ]; then
    say "replacement-worker race: pidfile stale (pid=${pid} dead, alive_pid=${alive_pid} alive via scan); suppressing kill of alive_pid"
  else
    say "stopping stale/stalled pid=${pid} before respawn"
    kill "${pid}" 2>/dev/null || true
    sleep 1
    kill -9 "${pid}" 2>/dev/null || true
  fi
fi
rm -f "$PIDFILE"

# Spawn detached so it survives this tick's exit.
# Source env before spawning so worker has BUYWHERE_API_KEY and other vars.
# The setsid --ctty detaches from the terminal, so we embed the env export
# in a subshell that sets vars before exec-ing node.
setsid bash -c '
  set -a
  [ -f "$1" ] && . "$1"
  set +a
  exec "$2" "$3" --duration-sec="$4"
' _ "$ENV_FILE" "$NODE_BIN" "$WORKER" "$DURATION_SEC" \
  >> "$WORKERLOG" 2>&1 < /dev/null &
NEW_PID=$!
disown 2>/dev/null || true

if [ "${escalate}" = "1" ]; then
  say "DEAD: respawned worker (newpid=${NEW_PID}, duration=${DURATION_SEC}s) streak=${streak} -> ESCALATION recorded (>=${ESCALATE_THRESHOLD}) in ${ESCALATIONFILE}"
else
  say "dead: respawned worker (newpid=${NEW_PID}, duration=${DURATION_SEC}s) streak=${streak}/${ESCALATE_THRESHOLD}"
fi
exit 0
