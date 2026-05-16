#!/usr/bin/env bash
set -euo pipefail

SCRIPTS_DIR="$(cd "$(dirname "$0")" && pwd)"
WORKTREE_ROOT="$(git -C "${SCRIPTS_DIR}/.." rev-parse --show-toplevel 2>/dev/null || echo "${SCRIPTS_DIR}/..")"
MONITOR_SCRIPT="${SCRIPTS_DIR}/monitor_carousell_sg.sh"

echo "=== Installing Carousell SG scraper monitoring ==="
echo "Worktree:  $WORKTREE_ROOT"
echo "Scripts:   $SCRIPTS_DIR"

USE_SYSTEM=false
if [ "$(id -u)" = 0 ] 2>/dev/null; then
  USE_SYSTEM=true
elif command -v sudo &>/dev/null; then
  if sudo -n true 2>/dev/null || sudo true 2>/dev/null; then
    USE_SYSTEM=true
  fi
fi

mkdir -p "${WORKTREE_ROOT}/data/carousell-sg"

if [ "$USE_SYSTEM" = true ]; then
  [ "$(id -u)" = 0 ] && SUDO="" || SUDO="sudo"
  LOG_DIR="/var/log/buywhere"

  $SUDO mkdir -p "$LOG_DIR"

  CRON_FILE="/etc/cron.d/buywhere-carousell-sg-monitor"
  printf '%s\n' \
    "# Carousell SG scraper daemon monitor (BUY-17572)" \
    "*/5 * * * * paperclip cd ${WORKTREE_ROOT} && ${MONITOR_SCRIPT} >> ${LOG_DIR}/carousell-sg-monitor.log 2>&1" \
    "" \
    | $SUDO tee "$CRON_FILE" > /dev/null
  $SUDO chmod 644 "$CRON_FILE"

  if command -v systemctl &>/dev/null; then
    $SUDO systemctl restart cron 2>/dev/null || true
  fi

  echo "Monitor script: $MONITOR_SCRIPT"
  echo "Cron job installed at $CRON_FILE (runs every 5 minutes)"
  echo "Logs at $LOG_DIR/carousell-sg-monitor.log"

else
  LOG_DIR="${HOME:-/tmp}/buywhere-logs"
  mkdir -p "$LOG_DIR"

  echo "NOTE: Cannot install system cron job without root/sudo."
  echo "To install user-level cron, add this line to your crontab:"
  echo ""
  echo "*/5 * * * * cd ${WORKTREE_ROOT} && ${MONITOR_SCRIPT} >> ${LOG_DIR}/carousell-sg-monitor.log 2>&1"
  echo ""
fi

echo ""
echo "=== Verifying initial state ==="
cd "$WORKTREE_ROOT"
bash "$MONITOR_SCRIPT" || echo "Initial monitor run completed with warnings"

echo ""
echo "=== Installation complete ==="