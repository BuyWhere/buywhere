#!/usr/bin/env bash
# BUY-38726 / BUY-39010: 8-min cron supervisor for the BUY-31015 WooCommerce
# deep-page lane (scripts/buy31142-crew-wc-rest.mjs).
#
# Wired in crontab as `*/8 * * * *` (two entries: one with the per-tick log
# redirect, one bare). Each tick:
#   1. Decides liveness from pidfile + cmdline match + fresh heartbeat
#      (or active ingest cooldown).
#   2. If dead -> kill any stale proc, (re)spawn the worker detached with
#      --duration-sec=240 so a fresh worker is alive before the 5-min
#      heartbeat cgroup kill.
#   3. Updates data/buy31142-keep-alive-escalation.json (shared with
#      buy31142-crew-wc-rest-keep-alive.sh) so both the 8-min supervisor
#      and the sub-5-min keep-alive report the same streak.
#   4. Emits a structured tick summary to
#      data/buy31015-woocommerce-deep-page-supervisor-cron.log with cycle
#      count (worker sweeps), known-merchant total, in-cycle completion %,
#      last visited domain, and product yield — matching the format the
#      original supervisor produced (see tail of that log pre-10:00Z).
#
# Why a separate supervisor (vs delegating to the keep-alive): the cron
# needs the supervisor to be self-sufficient. The keep-alive is still
# useful as a faster sub-5-min safety net; both can coexist — the
# worker's acquirePidfile() idempotency check guarantees no double
# spawn.
#
# Env overrides: DURATION_SEC, STALL_SEC, ESCALATE_THRESHOLD, NODE_BIN,
#   WC_LANE_STATE_DIR, TICK_INTERVAL_SEC.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DATA_DIR="${WC_LANE_STATE_DIR:-$REPO_ROOT/data}"

# Source lane env so respawned workers can reach the ingest API.
LANE_ENV="$DATA_DIR/.env.buy31015-lane"
if [ -f "$LANE_ENV" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$LANE_ENV"
  set +a
fi

WORKER="$SCRIPT_DIR/buy31142-crew-wc-rest.mjs"
PIDFILE="$DATA_DIR/buy31142-crew-wc-rest.pid"
HEARTBEATFILE="$DATA_DIR/buy31142-crew-wc-rest.heartbeat"
STATUSFILE="$DATA_DIR/buy31142-crew-wc-rest-status.json"
ESCALATIONFILE="$DATA_DIR/buy31142-keep-alive-escalation.json"
KNOWN_MERCHANTS_FILE="$DATA_DIR/buy31015-wc-known-merchants.json"
TICKLOG="$DATA_DIR/buy31015-woocommerce-deep-page-supervisor-cron.log"
WORKERLOG="$DATA_DIR/buy31142-crew-wc-rest-worker.log"
TICKCOUNTER="$DATA_DIR/buy39010-supervisor-tick.counter"

DURATION_SEC="${DURATION_SEC:-240}"
STALL_SEC="${STALL_SEC:-120}"
ESCALATE_THRESHOLD="${ESCALATE_THRESHOLD:-4}"
TICK_INTERVAL_SEC="${TICK_INTERVAL_SEC:-480}"   # 8 min default
NODE_BIN="${NODE_BIN:-node}"
MARKER="buy31142-crew-wc-rest"

mkdir -p "$DATA_DIR"

ts() { date -u +"%Y-%m-%dT%H:%M:%S.%3NZ"; }
say() { local line="[$(ts)] $*"; echo "$line"; echo "$line" >> "$TICKLOG"; }

# Tick counter (monotonic; never resets on script edit). The original
# supervisor reported `TICK N` where N grew past 170 — this is the same
# counter, just persisted to disk so it survives restarts.
if [ -f "$TICKCOUNTER" ]; then
  TICK_N=$(($(cat "$TICKCOUNTER" 2>/dev/null | tr -dc '0-9') + 1))
else
  TICK_N=1
fi
printf '%s\n' "$TICK_N" > "$TICKCOUNTER"

# ---------------------------------------------------------------------------
# Liveness decision + escalation bookkeeping (one node invocation).
# Prints key=value lines for shell parsing. Never exits non-zero: on any
# internal error it reports the worker as dead so we respawn safely.
# Mirrors buy31142-crew-wc-rest-keep-alive.sh's logic exactly so the
# escalation file stays consistent between the two callers.
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
const MARKER = process.env.MARKER || 'buy31142-crew-wc-rest';
const now = Date.now();
const out = {};

function emit(o) {
  for (const k of Object.keys(o)) process.stdout.write(`${k}=${o[k]}\n`);
}

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

try {
  let pid = 0;
  try { pid = parseInt(String(fs.readFileSync(PATHS.pid, 'utf8')).trim(), 10) || 0; } catch {}
  out.pid = pid;

  let procAlive = false;
  if (pid) { try { process.kill(pid, 0); procAlive = true; } catch {} }
  out.proc_alive = procAlive ? 1 : 0;

  let cmdlineOk = false;
  if (procAlive) {
    try { cmdlineOk = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').includes(MARKER); }
    catch { cmdlineOk = true; }
  }
  out.cmdline_ok = cmdlineOk ? 1 : 0;

  let ageSec = -1;
  let hbPhase = '';
  let hbDomain = '';
  try {
    const hb = readJson(PATHS.hb, {});
    if (hb && typeof hb.tsMs === 'number') {
      ageSec = Math.max(0, Math.round((now - hb.tsMs) / 1000));
      hbPhase = (hb && typeof hb.phase === 'string') ? hb.phase : '';
      hbDomain = (hb && typeof hb.domain === 'string') ? hb.domain : '';
    }
  } catch {}
  out.heartbeat_age_sec = ageSec;
  out.heartbeat_phase = hbPhase;
  out.heartbeat_domain = hbDomain;

  const status = readJson(PATHS.status, null);
  let cooldownActive = false;
  let cooldownUntil = null;
  let cooldownReason = null;
  if (status && typeof status.pauseUntil === 'string') {
    const pauseTs = Date.parse(status.pauseUntil);
    if (!Number.isNaN(pauseTs) && pauseTs > now) {
      cooldownActive = true;
      cooldownUntil = status.pauseUntil;
      cooldownReason = status.pauseReason || 'ingest_rate_limit';
    }
  }
  out.cooldown_active = cooldownActive ? 1 : 0;
  out.cooldown_until = cooldownUntil || '';
  out.cooldown_reason = cooldownReason || '';

  let sweeps = 0;
  let rowsPerHour = 0;
  let meetsTarget = false;
  let lastRateLimit = null;
  if (status) {
    if (typeof status.sweeps === 'number') sweeps = status.sweeps;
    if (typeof status.rowsPerHour === 'number') rowsPerHour = status.rowsPerHour;
    if (typeof status.meetsTarget === 'boolean') meetsTarget = status.meetsTarget;
    if (typeof status.lastRateLimit === 'string') lastRateLimit = status.lastRateLimit;
  }
  out.sweeps = sweeps;
  out.rows_per_hour = rowsPerHour;
  out.meets_target = meetsTarget ? 1 : 0;
  out.last_rate_limit = lastRateLimit || '';

  const heartbeatFresh = ageSec >= 0 && ageSec <= STALL_SEC;
  const alive = cooldownActive || (procAlive && cmdlineOk && heartbeatFresh);
  out.alive = alive ? 1 : 0;

  const esc = readJson(PATHS.esc, null) || {
    lane: 'crew-wc-rest',
    issue: 'BUY-38482',
    worker: 'scripts/buy31142-crew-wc-rest.mjs',
    consecutive_dead_ticks: 0,
    last_alive_at: null,
    last_dead_at: null,
    last_pid: null,
    last_heartbeat_age_sec: null,
    escalations: [],
  };
  esc.last_tick_at = new Date(now).toISOString();
  esc.last_caller = 'buy39010-supervisor';

  if (alive) {
    esc.consecutive_dead_ticks = 0;
    esc.last_alive_at = new Date(now).toISOString();
    esc.cooldown_until = cooldownActive ? cooldownUntil : null;
    esc.cooldown_reason = cooldownActive ? cooldownReason : null;
  } else {
    esc.consecutive_dead_ticks = (Number(esc.consecutive_dead_ticks) || 0) + 1;
    esc.last_dead_at = new Date(now).toISOString();
    esc.last_pid = pid || null;
    esc.last_heartbeat_age_sec = ageSec;
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
        heartbeat_age_sec: ageSec,
        reason,
        caller: 'buy39010-supervisor',
      });
      if (esc.escalations.length > 50) esc.escalations = esc.escalations.slice(-50);
    }
  }

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
         heartbeat_phase: '', heartbeat_domain: '',
         cooldown_active: 0, cooldown_until: '', cooldown_reason: '',
         sweeps: 0, rows_per_hour: 0, meets_target: 0, last_rate_limit: '',
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
: "${streak:=0}"
: "${escalate:=0}"
: "${respawn:=1}"
: "${cooldown_active:=0}"
: "${cooldown_until:=}"
: "${cooldown_reason:=}"
: "${heartbeat_age_sec:=-1}"
: "${heartbeat_phase:=}"
: "${heartbeat_domain:=}"
: "${sweeps:=0}"
: "${rows_per_hour:=0}"
: "${meets_target:=0}"
: "${last_rate_limit:=}"

# --- tick header -------------------------------------------------------------
say "=== TICK START ==="
say "interval=${TICK_INTERVAL_SEC}s caller=buy39010-supervisor tick=${TICK_N}"

# --- liveness branch ---------------------------------------------------------
if [ "${cooldown_active}" = "1" ]; then
  say "Worker is paused (cooldown until ${cooldown_until}, reason=${cooldown_reason}) — skipping respawn"
elif [ "${alive}" = "1" ]; then
  say "Worker is alive - resetting dead streak (pid=${pid} heartbeat_age=${heartbeat_age_sec}s)"
else
  say "Worker is dead - incrementing dead streak"
  if [ "${proc_alive}" = "1" ] && [ "${pid}" != "0" ]; then
    say "stopping stale/stalled pid=${pid} before respawn"
    kill "${pid}" 2>/dev/null || true
    sleep 1
    kill -9 "${pid}" 2>/dev/null || true
  fi
  rm -f "$PIDFILE"

  setsid "$NODE_BIN" "$WORKER" --duration-sec="$DURATION_SEC" \
    >> "$WORKERLOG" 2>&1 < /dev/null &
  NEW_PID=$!
  disown 2>/dev/null || true
  say "Spawning worker with ${DURATION_SEC}s duration..."
  say "Worker spawned with PID ${NEW_PID}"
fi

# --- summary block (cycle count, known merchants, completion, last domain) ---
# Cycle count = worker.sweeps (one full pass through merchants == +1).
# Completion = position of last visited domain in the cycle, 1-indexed
#   against known merchants. If the heartbeat is in 'exit' phase or
#   carries no domain (worker just started), completion is unknown and we
#   report 0% with a "starting" note.
KNOWN_COUNT=0
LAST_DOMAIN=""
LAST_PRODUCTS=0
LAST_VIA=""

if [ -f "$KNOWN_MERCHANTS_FILE" ]; then
  KNOWN_COUNT=$(grep -c '"domain"' "$KNOWN_MERCHANTS_FILE" 2>/dev/null || echo 0)
fi

if [ -n "${heartbeat_domain}" ] && [ "${KNOWN_COUNT}" -gt 0 ] && [ -f "$KNOWN_MERCHANTS_FILE" ]; then
  # Find the 1-indexed position of the heartbeat domain in the merchants file.
  LAST_DOMAIN="${heartbeat_domain}"
  POS=$(grep -nE "\"domain\":[[:space:]]*\"${LAST_DOMAIN//./\\.}\"" "$KNOWN_MERCHANTS_FILE" 2>/dev/null \
    | head -1 | cut -d: -f1)
  if [ -n "${POS}" ]; then
    # Each merchant entry spans ~2 lines; convert line number to entry index.
    # Walk the file once and count '{' opens at the same depth as the first
    # merchant key — simpler: count the number of '"domain"' lines up to POS.
    COMPLETION=$(awk -v target="${POS}" 'NR<=target && /"domain"/ {n++} END {print n}' "$KNOWN_MERCHANTS_FILE")
    COMPLETION_PCT=$(( COMPLETION * 100 / KNOWN_COUNT ))
  else
    # Domain not in the known list (e.g. transient deep-page result) — report
    # 0% but still surface the domain in the summary.
    COMPLETION_PCT=0
  fi
elif [ "${heartbeat_phase}" = "exit" ] || [ "${heartbeat_phase}" = "start" ] || [ -z "${heartbeat_domain}" ]; then
  COMPLETION_PCT=0
else
  COMPLETION_PCT=0
fi

# Best-effort "products at last domain" — peek at the latest worker.log line
# that mentions this domain + "merchant harvested".
if [ -n "${LAST_DOMAIN}" ] && [ -f "$WORKERLOG" ]; then
  HIT=$(grep -E "merchant harvested.*${LAST_DOMAIN//./\\.}" "$WORKERLOG" 2>/dev/null | tail -1 || true)
  if [ -n "${HIT}" ]; then
    LAST_PRODUCTS=$(printf '%s' "$HIT" | grep -oE '"count":[0-9]+' | head -1 | grep -oE '[0-9]+' || echo 0)
    LAST_VIA=$(printf '%s' "$HIT" | grep -oE '"via":"[a-z0-9]+"' | head -1 | sed 's/.*"via":"\([a-z0-9]*\)".*/\1/')
  fi
fi

if [ "${escalate}" = "1" ]; then
  say "⚠️  ESCALATION: ${streak} consecutive dead ticks"
fi

say "=== TICK ${TICK_N} SUMMARY ==="
say "Worker alive: $([ "${alive}" = "1" ] && echo YES || echo NO)"
say "Dead streak: ${streak}/${ESCALATE_THRESHOLD}"
say "Cycle count: ${sweeps}"
say "Known merchants: ${KNOWN_COUNT}"
say "Completion: ${COMPLETION_PCT}%"
say "Last merchant: ${LAST_DOMAIN:-<none>}"
if [ -n "${LAST_DOMAIN}" ]; then
  if [ "${LAST_PRODUCTS}" != "0" ] && [ -n "${LAST_PRODUCTS}" ]; then
    say "  - Products: ${LAST_PRODUCTS} via ${LAST_VIA:-unknown}"
  else
    say "  - Products: 0 via ${LAST_VIA:-unknown}"
  fi
fi
if [ "${cooldown_active}" = "1" ]; then
  say "⏸️  Cooldown active until: ${cooldown_until} (reason=${cooldown_reason})"
fi
if [ "${rows_per_hour}" != "0" ]; then
  say "Throughput: ${rows_per_hour} rows/hr (target 5000, meets=$([ "${meets_target}" = "1" ] && echo YES || echo NO))"
fi
if [ -n "${last_rate_limit}" ]; then
  say "Last rate limit: ${last_rate_limit}"
fi
say "=== TICK END ==="

exit 0
