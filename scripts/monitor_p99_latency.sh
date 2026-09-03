#!/usr/bin/env bash
# monitor_p99_latency.sh — Check Cloud Run p99 latency via analytics endpoint (BUY-3006)
# Usage: ADMIN_API_KEY=xxx ./scripts/monitor_p99_latency.sh [minutes] [threshold_ms]
# Defaults: 5-minute window, 1000ms threshold

set -euo pipefail

API_URL="${API_BASE_URL:-https://api.buywhere.ai}"
MINUTES="${1:-5}"
THRESHOLD="${2:-1000}"

if [ -z "${ADMIN_API_KEY:-}" ]; then
  echo "ERROR: ADMIN_API_KEY is required" >&2
  exit 1
fi

RESPONSE=$(curl -s --max-time 15 \
  -H "Authorization: Bearer $ADMIN_API_KEY" \
  "$API_URL/v1/analytics/latency?minutes=$MINUTES&threshold=$THRESHOLD")

STATUS=$(echo "$RESPONSE" | python3 -c "import sys,json; r=json.load(sys.stdin); print(r['data']['alert']['status'])" 2>/dev/null)
P99=$(echo "$RESPONSE" | python3 -c "import sys,json; r=json.load(sys.stdin); print(r['data']['overall']['p99'])" 2>/dev/null)
SAMPLES=$(echo "$RESPONSE" | python3 -c "import sys,json; r=json.load(sys.stdin); print(r['data']['overall']['sample_count'])" 2>/dev/null)

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] p99=${P99}ms samples=${SAMPLES} threshold=${THRESHOLD}ms status=${STATUS}"

if [ "$STATUS" = "ALERT" ]; then
  echo "ALERT: p99 latency ${P99}ms exceeds ${THRESHOLD}ms threshold (${SAMPLES} samples in ${MINUTES}m window)"
  # Per-endpoint breakdown
  echo "$RESPONSE" | python3 -c "
import sys, json
r = json.load(sys.stdin)
for ep in r['data']['by_endpoint']:
    print(f\"  {ep['endpoint']}: p99={ep['p99']}ms p95={ep['p95']}ms samples={ep['sample_count']}\")
"
  exit 2
fi

exit 0
