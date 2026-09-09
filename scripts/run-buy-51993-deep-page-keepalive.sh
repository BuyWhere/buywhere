#!/usr/bin/env bash
# BUY-51993 / BUY-31015 deep-page keep-alive cron entrypoint.
# Keeps lane alive by running scripts/buy31015-deep-page-keepalive.sh.

set -euo pipefail

SCRIPT_SOURCE="$(readlink -f "${BASH_SOURCE[0]}" 2>/dev/null || echo "${BASH_SOURCE[0]}")"
SCRIPT_DIR="$(cd "$(dirname "$SCRIPT_SOURCE")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
KEEPALIVE_SCRIPT="$SCRIPT_DIR/buy31015-deep-page-keepalive.sh"
CRON_LOG="$REPO_ROOT/logs/buy31015_deep_page_keepalive_cron.log"

mkdir -p "$REPO_ROOT/logs"

ts() { date -u +"%Y-%m-%dT%H:%M:%SZ"; }
log() { echo "[$(ts)] cron-wrapper: $*" >> "$CRON_LOG"; }

if pgrep -f "buy31015-deep-page-keepalive.sh" >/dev/null 2>&1; then
  log "keepalive already running; skipping tick"
  exit 0
fi

cd "$REPO_ROOT"
log "starting keepalive tick"

bash "$KEEPALIVE_SCRIPT" >> "$CRON_LOG" 2>&1
log "keepalive tick complete"
