#!/usr/bin/env bash
# scripts/check-mcp-uptime.sh — Poll MCP health endpoint and log results (BUY-8992)
# Intended to run as a cron job every 60s.
# Usage: ./scripts/check-mcp-uptime.sh
#   MCP_URL — MCP server health URL (default: https://mcp.buywhere.ai/health)
#   LOG_DIR — directory for uptime log (default: /var/log/buywhere)
#   LOG_FILE — full path to log file (overrides LOG_DIR)
set -euo pipefail

MCP_URL="${MCP_URL:-https://mcp.buywhere.ai/health}"
LOG_FILE="${LOG_FILE:-${LOG_DIR:-/var/log/buywhere}/mcp-uptime.ndjson}"
TS=$(date -u +%Y-%m-%dT%H:%M:%SZ)

mkdir -p "$(dirname "$LOG_FILE")"

START_NS=$(date +%s%N)
HTTP_CODE=$(curl -s -o /tmp/mcp-health-response.json -w "%{http_code}" --max-time 10 "$MCP_URL" 2>/dev/null || echo "000")
END_NS=$(date +%s%N)
LATENCY_MS=$(( (END_NS - START_NS) / 1000000 ))

if [ "$HTTP_CODE" = "200" ]; then
  BODY_STATUS=$(python3 -c "import json; print(json.load(open('/tmp/mcp-health-response.json')).get('status','unknown'))" 2>/dev/null || echo "unknown")
  TOTAL_PRODUCTS=$(python3 -c "import json; print(json.load(open('/tmp/mcp-health-response.json')).get('catalog',{}).get('total_products',0))" 2>/dev/null || echo "0")
  if [ "$BODY_STATUS" = "ok" ]; then
    RESULT="up"
  else
    RESULT="degraded"
  fi
else
  RESULT="down"
  BODY_STATUS="error"
  TOTAL_PRODUCTS=0
fi

echo "{\"ts\":\"$TS\",\"result\":\"$RESULT\",\"http_code\":$HTTP_CODE,\"latency_ms\":$LATENCY_MS,\"body_status\":\"$BODY_STATUS\",\"total_products\":$TOTAL_PRODUCTS}" >> "$LOG_FILE"

# Keep only 90 days of data (129,600 entries at 1/min)
tail -n 129600 "$LOG_FILE" > "${LOG_FILE}.tmp" && mv "${LOG_FILE}.tmp" "$LOG_FILE"

echo "[$TS] MCP=$RESULT http=$HTTP_CODE latency=${LATENCY_MS}ms products=$TOTAL_PRODUCTS"
