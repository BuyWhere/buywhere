#!/usr/bin/env bash
set -euo pipefail

MCP_URL="${1:-https://mcp.buywhere.ai/health}"
SCRIPTS_DIR="$(cd "$(dirname "$0")" && pwd)"

# Determine if we can write to system directories (root or sudo NOPASSWD)
USE_SYSTEM=false
if [ "$(id -u)" = 0 ] 2>/dev/null; then
  USE_SYSTEM=true
elif command -v sudo &>/dev/null; then
  if sudo -n true 2>/dev/null || sudo true 2>/dev/null; then
    USE_SYSTEM=true
  fi
fi

if [ "$USE_SYSTEM" = true ]; then
  BIN_DIR="/usr/local/bin"
  LOG_DIR="/var/log/buywhere"
  WEB_ROOT="/var/www/mcp-uptime"
else
  BIN_DIR="${HOME:-/tmp}/.local/bin"
  LOG_DIR="${HOME:-/tmp}/mcp-uptime/logs"
  WEB_ROOT="${HOME:-/tmp}/mcp-uptime/www"
fi

echo "=== Installing MCP uptime monitoring ==="
echo "MCP URL:    $MCP_URL"
echo "Web root:   $WEB_ROOT"
echo "Log dir:    $LOG_DIR"
echo "Scripts:    $SCRIPTS_DIR"
echo "System mod: $USE_SYSTEM"

if [ "$USE_SYSTEM" = true ]; then
  [ "$(id -u)" = 0 ] && SUDO="" || SUDO="sudo"
  $SUDO mkdir -p "$LOG_DIR" "$WEB_ROOT"
  $SUDO cp "$SCRIPTS_DIR/check-mcp-uptime.sh" "$BIN_DIR/check-mcp-uptime.sh"
  $SUDO cp "$SCRIPTS_DIR/report-mcp-uptime.sh" "$BIN_DIR/report-mcp-uptime.sh"
  $SUDO cp "$SCRIPTS_DIR/mcp-uptime-dashboard.html" "$WEB_ROOT/index.html"
  $SUDO chmod +x "$BIN_DIR/check-mcp-uptime.sh" "$BIN_DIR/report-mcp-uptime.sh"

  CRON_FILE="/etc/cron.d/buywhere-mcp-uptime"
  printf '%s\n' \
    "# MCP uptime check (BUY-8992)" \
    "* * * * * root ${BIN_DIR}/check-mcp-uptime.sh >> ${LOG_DIR}/check.log 2>&1" \
    "" \
    "# Generate dashboard report" \
    "*/5 * * * * root ${BIN_DIR}/report-mcp-uptime.sh ${WEB_ROOT} >> ${LOG_DIR}/report.log 2>&1" \
    | $SUDO tee "$CRON_FILE" > /dev/null
  $SUDO chmod 644 "$CRON_FILE"

  if command -v systemctl &>/dev/null; then
    $SUDO systemctl restart cron 2>/dev/null || true
  fi

  NGINX_CONF="/etc/nginx/sites-enabled/mcp-uptime.conf"
  if [ ! -f "$NGINX_CONF" ]; then
    printf '%s\n' \
      "# MCP uptime dashboard (BUY-8992)" \
      "location /mcp-uptime {" \
      "    alias ${WEB_ROOT};" \
      "    index index.html;" \
      "    add_header Cache-Control \"no-cache, max-age=0\";" \
      "    add_header X-Frame-Options \"SAMEORIGIN\";" \
      "}" \
      | $SUDO tee "$NGINX_CONF" > /dev/null
    echo "nginx config written to $NGINX_CONF"
  else
    echo "nginx config already exists at $NGINX_CONF — skipping"
  fi
else
  mkdir -p "$LOG_DIR" "$WEB_ROOT" "$BIN_DIR"
  cp "$SCRIPTS_DIR/check-mcp-uptime.sh" "$BIN_DIR/check-mcp-uptime.sh"
  cp "$SCRIPTS_DIR/report-mcp-uptime.sh" "$BIN_DIR/report-mcp-uptime.sh"
  cp "$SCRIPTS_DIR/mcp-uptime-dashboard.html" "$WEB_ROOT/index.html"
  chmod +x "$BIN_DIR/check-mcp-uptime.sh" "$BIN_DIR/report-mcp-uptime.sh"

  (crontab -l 2>/dev/null || true; echo "LOG_DIR=${LOG_DIR} WEB_ROOT=${WEB_ROOT} * * * * * ${BIN_DIR}/check-mcp-uptime.sh >> ${LOG_DIR}/check.log 2>&1") | crontab -
  (crontab -l 2>/dev/null || true; echo "LOG_DIR=${LOG_DIR} * */5 * * * * ${BIN_DIR}/report-mcp-uptime.sh ${WEB_ROOT} >> ${LOG_DIR}/report.log 2>&1") | crontab -

  echo "NOTE: nginx config not installed — run manually as root:"
  echo "  cat > /etc/nginx/sites-enabled/mcp-uptime.conf <<'EOF'"
  echo "  location /mcp-uptime {"
  echo "      alias ${WEB_ROOT};"
  echo "      index index.html;"
  echo "      add_header Cache-Control \"no-cache, max-age=0\";"
  echo "      add_header X-Frame-Options \"SAMEORIGIN\";"
  echo "  }"
  echo "  EOF"
  echo "  nginx -t && nginx -s reload"
fi

if [ -f "$BIN_DIR/report-mcp-uptime.sh" ]; then
  if [ "$USE_SYSTEM" = true ]; then
    $SUDO "$BIN_DIR/report-mcp-uptime.sh" "$WEB_ROOT" || echo "WARNING: initial report failed"
  else
    "$BIN_DIR/report-mcp-uptime.sh" "$WEB_ROOT" || echo "WARNING: initial report failed"
  fi
fi

echo ""
echo "=== Installation complete ==="
echo "Dashboard:  ${WEB_ROOT}/index.html"
echo "Log file:   ${LOG_DIR}/mcp-uptime.ndjson"
echo "Report:     ${WEB_ROOT}/uptime.json"
echo "Bin dir:    $BIN_DIR"
echo "System mod: $USE_SYSTEM"
