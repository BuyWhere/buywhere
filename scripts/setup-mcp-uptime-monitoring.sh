#!/usr/bin/env bash
# scripts/setup-mcp-uptime-monitoring.sh — Install MCP uptime monitoring on VM (BUY-8992)
# Run on the production VM as root or with sudo.
# Usage: sudo ./scripts/setup-mcp-uptime-monitoring.sh [mcp_url] [web_root]
set -euo pipefail

MCP_URL="${1:-https://mcp.buywhere.ai/health}"
WEB_ROOT="${2:-/var/www/mcp-uptime}"
SCRIPTS_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "$SCRIPTS_DIR/.." && pwd)"
LOG_DIR="/var/log/buywhere"

echo "=== Installing MCP uptime monitoring ==="
echo "MCP URL:    $MCP_URL"
echo "Web root:   $WEB_ROOT"
echo "Log dir:    $LOG_DIR"
echo "Scripts:    $SCRIPTS_DIR"

# Create directories
sudo mkdir -p "$LOG_DIR"
sudo mkdir -p "$WEB_ROOT"

# Copy scripts
sudo cp "$SCRIPTS_DIR/check-mcp-uptime.sh" /usr/local/bin/check-mcp-uptime.sh
sudo cp "$SCRIPTS_DIR/report-mcp-uptime.sh" /usr/local/bin/report-mcp-uptime.sh
sudo cp "$SCRIPTS_DIR/mcp-uptime-dashboard.html" "$WEB_ROOT/index.html"
sudo chmod +x /usr/local/bin/check-mcp-uptime.sh /usr/local/bin/report-mcp-uptime.sh

# Install cron job (check every 60s)
CRON_FILE="/etc/cron.d/buywhere-mcp-uptime"
printf '%s\n' \
  "# MCP uptime check — every 60 seconds (BUY-8992)" \
  "* * * * * root /usr/local/bin/check-mcp-uptime.sh >> ${LOG_DIR}/check.log 2>&1" \
  "" \
  "# Generate dashboard report — every 5 minutes" \
  "*/5 * * * * root /usr/local/bin/report-mcp-uptime.sh ${WEB_ROOT} >> ${LOG_DIR}/report.log 2>&1" \
  | sudo tee "$CRON_FILE" > /dev/null
sudo chmod 644 "$CRON_FILE"

# Reload cron
if command -v systemctl &>/dev/null; then
  sudo systemctl restart cron 2>/dev/null || true
fi

# Generate initial report
sudo /usr/local/bin/report-mcp-uptime.sh "$WEB_ROOT" || true

# Add nginx config for dashboard
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
    | sudo tee "$NGINX_CONF" > /dev/null
  echo "nginx config written to $NGINX_CONF"
  echo "Run 'nginx -s reload' to activate (or use the snippet in your main config)"
else
  echo "nginx config already exists at $NGINX_CONF — skipping"
fi

echo ""
echo "=== Installation complete ==="
echo "Dashboard URL: https://api.buywhere.ai/mcp-uptime"
echo "Log file:      ${LOG_DIR}/mcp-uptime.ndjson"
echo "Report file:   ${WEB_ROOT}/uptime.json"
echo ""
echo "To verify: curl -s https://api.buywhere.ai/mcp-uptime/uptime.json | head"
