#!/usr/bin/env bash
# BUY-31142 Crew WC REST keep-alive daemon + tick interface.
#
# Two modes of operation:
#
#   1. Daemon mode (standalone, no args):
#      Loops every 60 s, invoking the keep-alive script.
#      This is the primary guard that keeps the lane alive between heartbeats.
#
#   2. Tick mode (invoked by GitHub Actions workflow via --once):
#      Does a single keep-alive check and exits immediately.
#      The workflow passes WC_LANE_STATE_DIR to point at the daemon's own
#      data dir so the tick audits the real daemon state rather than a
#      split-brain copy in the repo workspace.
#
# Data dir: anchored to the daemon's script directory by default so that
# both the daemon and workflow invocations share the same pidfile/heartbeat/
# escalation files.  When invoked with WC_LANE_STATE_DIR set externally
# (e.g. by the GitHub Actions workflow override), that value is respected.

set -euo pipefail

SCRIPT_SOURCE="$(readlink -f "${BASH_SOURCE[0]}" 2>/dev/null || echo "${BASH_SOURCE[0]}")"
SCRIPT_DIR="$(cd "$(dirname "$SCRIPT_SOURCE")" && pwd)"
KEEP_ALIVE="$SCRIPT_DIR/buy31142-crew-wc-rest-keep-alive.sh"
DATA_DIR="${WC_LANE_STATE_DIR:-$SCRIPT_DIR/../data}"
LOG="$DATA_DIR/buy31142-crew-wc-rest-keep-alive-daemon.log"

mkdir -p "$(dirname "$LOG")"

ts() { date -u +"%Y-%m-%dT%H:%M:%SZ"; }

log() { echo "[$(ts)] $*" >> "$LOG"; }

# Parse flags
MODE="daemon"
for arg in "$@"; do
  case "$arg" in
    --once) MODE="tick" ;;
    --daemon) MODE="daemon" ;;
  esac
done

if [ "$MODE" = "tick" ]; then
  # Tick mode: one shot, exit immediately.
  # Respect an externally-set WC_LANE_STATE_DIR (e.g. from GitHub Actions
  # workflow override) so the tick operates on the caller's chosen data dir.
  # If not set, fall back to this daemon's own data dir.
  export WC_LANE_STATE_DIR="${WC_LANE_STATE_DIR:-$DATA_DIR}"
  exec "$KEEP_ALIVE" >> "$LOG" 2>&1
fi

# --- Daemon mode ---
log "daemon starting: tick every 60 s"

TICK_SEC=60

while true; do
  tick_start=$(date +%s)
  log "tick at $(ts)"
  # Daemon explicitly sets WC_LANE_STATE_DIR so workers spawn into the shared data dir.
  if WC_LANE_STATE_DIR="$DATA_DIR" "$KEEP_ALIVE" >> "$LOG" 2>&1; then
    log "tick OK"
  else
    log "tick returned non-zero"
  fi
  elapsed=$(($(date +%s) - tick_start))
  sleep_secs=$((TICK_SEC - elapsed))
  if [ "$sleep_secs" -gt 0 ]; then
    log "sleeping ${sleep_secs}s until next tick"
    sleep "$sleep_secs"
  else
    log "tick took ${elapsed}s (>${TICK_SEC}s window), immediate next tick"
  fi
done
