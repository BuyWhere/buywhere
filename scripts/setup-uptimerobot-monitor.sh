#!/usr/bin/env bash
# setup-uptimerobot-monitor.sh
# Creates/updates UptimeRobot monitor for GET /mcp/health
#
# Usage:
#   export UPTIMEROBOT_KEY="your-api-key"
#   ./scripts/setup-uptimerobot-monitor.sh
#
# Requires: curl, jq
set -euo pipefail

UPTIMEROBOT_KEY="${UPTIMEROBOT_KEY:-}"
MONITOR_URL="${MONITOR_URL:-https://api.buywhere.ai/mcp/health}"
MONITOR_NAME="${MONITOR_NAME:-BuyWhere API - MCP Health}"
INTERVAL="${INTERVAL:-60}"
WEBHOOK_URL="${WEBHOOK_URL:-https://api.buywhere.ai/webhooks/uptime-robot}"
WEBHOOK_SECRET="${UPTIMEROBOT_WEBHOOK_SECRET:-uptime-robot-prod-2026}"

if [[ -z "$UPTIMEROBOT_KEY" ]]; then
  echo "ERROR: UPTIMEROBOT_KEY is not set"
  echo "Set it: export UPTIMEROBOT_KEY='your-key'"
  exit 1
fi

echo "=== Setting up UptimeRobot monitor ==="
echo "URL:      $MONITOR_URL"
echo "Name:     $MONITOR_NAME"
echo "Interval: ${INTERVAL}s"

# Find existing monitor with this URL
echo ""
echo "--- Checking existing monitors ---"
EXISTING=$(curl -s -X POST "https://api.uptimerobot.com/v2/getMonitors" \
  -d "api_key=$UPTIMEROBOT_KEY" \
  -d "format=json" \
  -d "search=$MONITOR_URL")

EXISTING_ID=$(echo "$EXISTING" | jq -r '.monitors[] | select(.url == "'"$MONITOR_URL"'") | .id // empty' 2>/dev/null || echo "")

if [[ -n "$EXISTING_ID" ]]; then
  echo "Monitor already exists with ID: $EXISTING_ID"
  echo "Updating existing monitor..."
  RESPONSE=$(curl -s -X POST "https://api.uptimerobot.com/v2/editMonitor" \
    -d "api_key=$UPTIMEROBOT_KEY" \
    -d "format=json" \
    -d "id=$EXISTING_ID" \
    -d "monitor_type=1" \
    -d "url=$MONITOR_URL" \
    -d "friendly_name=$MONITOR_NAME" \
    -d "interval=$INTERVAL")
else
  echo "Creating new monitor..."
  RESPONSE=$(curl -s -X POST "https://api.uptimerobot.com/v2/newMonitor" \
    -d "api_key=$UPTIMEROBOT_KEY" \
    -d "format=json" \
    -d "type=1" \
    -d "url=$MONITOR_URL" \
    -d "friendly_name=$MONITOR_NAME" \
    -d "interval=$INTERVAL")
fi

echo "Response:"
echo "$RESPONSE" | jq .

STATUS=$(echo "$RESPONSE" | jq -r '.stat')
if [[ "$STATUS" != "ok" ]]; then
  echo "ERROR: Failed to create/update monitor"
  echo "Raw response: $RESPONSE"
  exit 1
fi

MONITOR_ID=$(echo "$RESPONSE" | jq -r '.monitor.id // .monitor[0].id // empty')
echo ""
echo "=== Monitor $MONITOR_ID ready ==="
echo "URL: $MONITOR_URL"
echo "Interval: ${INTERVAL}s"
echo "Alert webhook: $WEBHOOK_URL"

echo ""
echo "=== Next steps ==="
echo "1. Verify in UptimeRobot dashboard"
echo "2. Confirm webhook alert is configured to POST to:"
echo "   $WEBHOOK_URL"
echo "   with header X-UptimeRobot-Secret: $WEBHOOK_SECRET"
echo "3. Test by stopping the MCP service temporarily"
