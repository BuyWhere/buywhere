#!/usr/bin/env bash
# scripts/check-mcp-uptime.sh — Poll MCP tools/list and validate tool availability (BUY-10855)
# Intended to run as a cron job every 60s.
# Usage: ./scripts/check-mcp-uptime.sh
#   MCP_URL — MCP server URL (default: https://api.buywhere.ai/mcp)
#   EXPECTED_TOOLS — comma-separated list of expected tool names (default: search_products,get_product,compare_products,get_deals,list_categories,find_best_price)
#   EXPECTED_COUNT — expected number of tools (default: 6)
#   LOG_DIR — directory for uptime log (default: /var/log/buywhere)
#   LOG_FILE — full path to log file (overrides LOG_DIR)
set -euo pipefail

MCP_URL="${MCP_URL:-https://api.buywhere.ai/mcp}"
EXPECTED_TOOLS_STR="${EXPECTED_TOOLS:-search_products,get_product,compare_products,get_deals,list_categories,find_best_price}"
EXPECTED_COUNT="${EXPECTED_COUNT:-6}"
LOG_FILE="${LOG_FILE:-${LOG_DIR:-/var/log/buywhere}/mcp-uptime.ndjson}"
TS=$(date -u +%Y-%m-%dT%H:%M:%SZ)

mkdir -p "$(dirname "$LOG_FILE")"

IFS=',' read -ra EXPECTED_TOOLS <<< "$EXPECTED_TOOLS_STR"

START_NS=$(date +%s%N)
RESPONSE_FILE=$(mktemp)
HTTP_CODE=$(curl -s -o "$RESPONSE_FILE" -w "%{http_code}" --max-time 10 \
  -X POST "$MCP_URL" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}' 2>/dev/null || echo "000")
END_NS=$(date +%s%N)
LATENCY_MS=$(( (END_NS - START_NS) / 1000000 ))

ALERT=""
FOUND_TOOLS=""
MISSING_TOOLS=""
TOOL_COUNT=0

if [ "$HTTP_CODE" = "200" ]; then
  TOOL_NAMES=$(python3 -c "
import json, sys
try:
    data = json.load(open('$RESPONSE_FILE'))
    tools = data.get('result', {}).get('tools', [])
    names = [t['name'] for t in tools]
    print('TOOL_COUNT:' + str(len(names)))
    print('TOOLS:' + ','.join(names))
except Exception as e:
    print('ERROR:' + str(e))
" 2>/dev/null || echo "PARSE_ERROR")

  if echo "$TOOL_NAMES" | grep -q "^TOOL_COUNT:"; then
    TOOL_COUNT=$(echo "$TOOL_NAMES" | grep "^TOOL_COUNT:" | sed 's/^TOOL_COUNT://')
    FOUND_TOOLS=$(echo "$TOOL_NAMES" | grep "^TOOLS:" | sed 's/^TOOLS://')

    if [ "$TOOL_COUNT" -lt "$EXPECTED_COUNT" ]; then
      ALERT="tool_count_mismatch"
    fi

    MISSING=""
    for tool in "${EXPECTED_TOOLS[@]}"; do
      if ! echo ",$FOUND_TOOLS," | grep -q ",$tool,"; then
        MISSING="${MISSING},${tool}"
      fi
    done
    MISSING_TOOLS="${MISSING#,}"

    if [ -n "$MISSING_TOOLS" ]; then
      if [ -n "$ALERT" ]; then
        ALERT="${ALERT}+missing_tools"
      else
        ALERT="missing_tools"
      fi
    fi

    if [ -z "$ALERT" ]; then
      RESULT="up"
    else
      RESULT="degraded"
    fi
  else
    RESULT="degraded"
    ALERT="parse_error"
    FOUND_TOOLS=""
    TOOL_COUNT=0
  fi
else
  RESULT="down"
  ALERT="http_${HTTP_CODE}"
fi

rm -f "$RESPONSE_FILE"

echo "{\"ts\":\"$TS\",\"result\":\"$RESULT\",\"http_code\":$HTTP_CODE,\"latency_ms\":$LATENCY_MS,\"tool_count\":$TOOL_COUNT,\"expected_count\":$EXPECTED_COUNT,\"found_tools\":\"$FOUND_TOOLS\",\"missing_tools\":\"$MISSING_TOOLS\",\"alert\":\"$ALERT\"}" >> "$LOG_FILE"

tail -n 129600 "$LOG_FILE" > "${LOG_FILE}.tmp" && mv "${LOG_FILE}.tmp" "$LOG_FILE"

ALERT_MSG=""
if [ -n "$ALERT" ]; then
  ALERT_MSG=" alert=$ALERT"
fi
echo "[$TS] MCP=$RESULT http=$HTTP_CODE latency=${LATENCY_MS}ms tools=${TOOL_COUNT}/${EXPECTED_COUNT}${ALERT_MSG}"
