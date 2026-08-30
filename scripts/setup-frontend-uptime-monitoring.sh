#!/usr/bin/env bash
set -euo pipefail

SCRIPTS_DIR="$(cd "$(dirname "$0")" && pwd)"
FRONTEND_URL="${FRONTEND_URL:-https://buywhere.ai}"
FRONTEND_HEALTH_PATH="${FRONTEND_HEALTH_PATH:-/health-check}"

if [ "$(id -u)" = 0 ] 2>/dev/null; then
  USE_SYSTEM=true
elif command -v sudo &>/dev/null; then
  if sudo -n true 2>/dev/null || sudo true 2>/dev/null; then
    USE_SYSTEM=true
  else
    USE_SYSTEM=false
  fi
else
  USE_SYSTEM=false
fi

if [ "$USE_SYSTEM" = true ]; then
  SUDO=""
  if [ "$(id -u)" != 0 ] 2>/dev/null; then
    SUDO="sudo"
  fi
  BIN_DIR="/usr/local/bin"
  LOG_DIR="/var/log/buywhere"
  CHECK_SCRIPT="$BIN_DIR/check-frontend-health.sh"
else
  BIN_DIR="${HOME:-/tmp}/.local/bin"
  LOG_DIR="${HOME:-/tmp}/buywhere-frontend-health/logs"
  CHECK_SCRIPT="${BIN_DIR}/check-frontend-health.sh"
fi

mkdir -p "$BIN_DIR" "$LOG_DIR"
cp "$SCRIPTS_DIR/check-frontend-health.sh" "$CHECK_SCRIPT"
chmod +x "$CHECK_SCRIPT"

echo "=== Installing frontend UI health monitoring (BUY-17936) ==="
echo "Frontend URL: $FRONTEND_URL"
echo "Health path: $FRONTEND_HEALTH_PATH"
echo "Log dir: $LOG_DIR"

if [ "$USE_SYSTEM" = true ]; then
  CRON_FILE="/etc/cron.d/buywhere-frontend-health"
  printf '%s\n' \
    "# Frontend UI health check (BUY-17936)" \
    "*/5 * * * * root FRONTEND_URL=$FRONTEND_URL FRONTEND_HEALTH_PATH=$FRONTEND_HEALTH_PATH LOG_DIR=$LOG_DIR $CHECK_SCRIPT >> ${LOG_DIR}/frontend-health-check.log 2>&1" \
    | $SUDO tee "$CRON_FILE" > /dev/null
  $SUDO chmod 644 "$CRON_FILE"

  if command -v systemctl &>/dev/null; then
    $SUDO systemctl restart cron 2>/dev/null || true
  fi
else
  CRON_ENTRY="LOG_DIR=$LOG_DIR FRONTEND_URL=$FRONTEND_URL FRONTEND_HEALTH_PATH=$FRONTEND_HEALTH_PATH $CHECK_SCRIPT >> ${LOG_DIR}/frontend-health-check.log 2>&1"
  (crontab -l 2>/dev/null || true; echo "*/5 * * * * $CRON_ENTRY") | crontab -
  echo "User-level cron entry added for $(whoami)"
fi

echo "Installation complete. Logs: ${LOG_DIR}/frontend-health-check.log and ${LOG_DIR}/frontend-ui-health.ndjson"
echo "Routine name: Frontend UI health check — buywhere.ai (BUY-17936)"
