#!/usr/bin/env bash
# smoke-test-search.sh — BUY-31302 search smoke test
#
# Verifies the search endpoint returns HTTP 200 + ≥1 result in <1000ms.
# Must pass before deployment is unblocked.
#
# Usage:
#   BUYWHERE_API_KEY=bw_xxx ./smoke-test-search.sh
#   BUYWHERE_API_KEY=bw_xxx BASE_URL=https://staging.api.buywhere.ai ./smoke-test-search.sh
#
# Exit codes: 0 = pass, 1 = fail

set -euo pipefail

BASE_URL="${BASE_URL:-https://api.buywhere.ai}"
API_KEY="${BUYWHERE_API_KEY:-${BUYWHERE_SMOKE_KEY:-}}"
MAX_TIME="${SEARCH_SMOKE_MAX_TIME:-1}"

if [[ -z "$API_KEY" ]]; then
  echo "ERROR: BUYWHERE_API_KEY (or BUYWHERE_SMOKE_KEY) must be set"
  exit 1
fi

ENDPOINT="${BASE_URL}/v1/products/search?q=iPhone+15+Pro&country=SG&limit=5"
echo "=== Search smoke test ==="
echo "Endpoint: $ENDPOINT"
echo "Max time: ${MAX_TIME}s"
echo ""

RESPONSE=$(curl -s \
  -w '\n{"http_code":"%{http_code}","time_total":"%{time_total}"}' \
  -H "Authorization: Bearer $API_KEY" \
  --max-time "$MAX_TIME" \
  "$ENDPOINT" 2>&1) || {
  echo "FAIL: curl failed (timeout or connection error)"
  exit 1
}

# Last line has timing/status; rest is the response body
STATUS_LINE=$(echo "$RESPONSE" | tail -1)
BODY=$(echo "$RESPONSE" | head -n -1)

HTTP_CODE=$(echo "$STATUS_LINE" | python3 -c "import json,sys; d=json.loads(sys.stdin.read()); print(d['http_code'])" 2>/dev/null || echo "000")
TIME_TOTAL=$(echo "$STATUS_LINE" | python3 -c "import json,sys; d=json.loads(sys.stdin.read()); print(d['time_total'])" 2>/dev/null || echo "0")
RESULT_COUNT=$(echo "$BODY" | python3 -c "
import json, sys
try:
    d = json.loads(sys.stdin.read())
    results = d.get('results', d.get('items', []))
    print(len(results))
except:
    print(0)
" 2>/dev/null || echo "0")

TIME_MS=$(python3 -c "print(round(float('${TIME_TOTAL}') * 1000))" 2>/dev/null || echo "?")

echo "HTTP: $HTTP_CODE"
echo "Results: $RESULT_COUNT"
echo "Time: ${TIME_MS}ms"
echo ""

FAILED=0

if [[ "$HTTP_CODE" != "200" ]]; then
  echo "FAIL: Expected HTTP 200, got $HTTP_CODE"
  FAILED=1
fi

if [[ "$RESULT_COUNT" -lt 1 ]]; then
  echo "FAIL: Expected ≥1 result, got $RESULT_COUNT"
  FAILED=1
fi

if [[ "$FAILED" -eq 0 ]]; then
  echo "PASS: HTTP $HTTP_CODE, $RESULT_COUNT results in ${TIME_MS}ms"
  exit 0
else
  echo "Response body (first 500 chars):"
  echo "$BODY" | head -c 500
  exit 1
fi
