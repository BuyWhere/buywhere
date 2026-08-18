#!/bin/bash
# BUY-71023: External FBP latency monitoring (US market, per-country p95 alerting)
# Runs find_best_price for US market, tracks rolling p95, alerts if p95 >5s.
# Intended for droplet cron: * * * * * cd /home/paperclip/buywhere && ./scripts/monitor-fbp-latency.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKDIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

# Configuration
MARKET="${1:-US}"
THRESHOLD_MS="${2:-5000}"
DATA_FILE="${WORKDIR}/data/fbp-${MARKET,,}-latencies.json"
MAX_SAMPLES=100
LOG_FILE="/tmp/fbp-${MARKET,,}-monitor.log"
RESPONSE_FILE="/tmp/fbp-probe-response-${MARKET,,}.json"
TMP_PAYLOAD="/tmp/fbp-payload-${MARKET,,}.json"

# Alert webhook (optional)
ALERT_WEBHOOK="${FBP_ALERT_WEBHOOK:-}"

log() {
    echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*" | tee -a "$LOG_FILE"
}

# Load API key from secrets
load_api_key() {
    python3 -c "
import json, os
secrets = json.load(open(os.path.expanduser('~/.secrets/fleet-secrets.json')))
key = secrets.get('BUYWHERE_MONITORING_API_KEY') or secrets.get('BUYWHERE_API_KEY','')
print(key)
" 2>/dev/null || echo ""
}

# Run FBP probe and return latency in ms, or -1 on failure
probe_fbp() {
    local market="$1"
    local api_key="$2"
    local url="https://mcp.buywhere.ai/mcp"

    # Build payload via Python to avoid shell quoting issues
    python3 -c "
import json, sys
payload = {
    'jsonrpc': '2.0',
    'id': 'fbp-latency-monitor',
    'method': 'tools/call',
    'params': {
        'name': 'find_best_price',
        'arguments': {
            'product_name': 'iphone 15',
            'country_code': sys.argv[1]
        }
    }
}
with open('${TMP_PAYLOAD}', 'w') as f:
    json.dump(payload, f)
" "$market"

    local start_ms end_ms latency
    start_ms=$(python3 -c "import time; print(int(time.time() * 1000))")

    local http_code=000
    http_code=$(curl -sS -X POST "$url" \
        -H "Content-Type: application/json" \
        -H "x-api-key: $api_key" \
        -H "User-Agent: buywhere-fbp-latency-monitor/1.0" \
        --max-time 30 \
        -w "%{http_code}" \
        -o "$RESPONSE_FILE" \
        --data-binary "@$TMP_PAYLOAD" \
        2>/dev/null) || http_code="000"

    end_ms=$(python3 -c "import time; print(int(time.time() * 1000))")
    latency=$((end_ms - start_ms))

    if [[ "$http_code" != "200" ]]; then
        log "WARN: $market FBP probe HTTP $http_code (${latency}ms)"
        echo "-1"
        return 1
    fi

    # Check for timed_out in response
    if grep -q '"timed_out":true' "$RESPONSE_FILE" 2>/dev/null; then
        log "WARN: $market FBP probe returned timed_out=true"
    fi

    echo "$latency"
}

# Compute p95 from newline-separated values
compute_p95() {
    local data_file="$1"
    local count
    count=$(wc -l < "$data_file" 2>/dev/null || echo 0)
    if [[ "$count" -eq 0 ]]; then
        echo "0"
        return
    fi
    local idx
    idx=$(echo "($count * 95 / 100)" | bc)
    idx=$((idx + 1))  # 1-indexed for sed
    sort -n "$data_file" | sed -n "${idx}p" 2>/dev/null || echo "0"
}

# Main
main() {
    log "Starting FBP latency monitor for $MARKET (threshold: ${THRESHOLD_MS}ms)"

    local api_key
    api_key=$(load_api_key)
    if [[ -z "$api_key" ]]; then
        log "ERROR: Could not load API key from fleet-secrets.json"
        exit 1
    fi

    local latency
    latency=$(probe_fbp "$MARKET" "$api_key") || true

    if [[ -z "$latency" || "$latency" == "-1" ]]; then
        log "ERROR: FBP probe failed for $MARKET"
        exit 1
    fi

    log "Probe completed: ${latency}ms"

    # Load existing latencies
    mkdir -p "$(dirname "$DATA_FILE")"
    touch "$DATA_FILE"

    # Append new latency, trim to MAX_SAMPLES
    echo "$latency" >> "$DATA_FILE"
    local total
    total=$(wc -l < "$DATA_FILE")
    if [[ "$total" -gt "$MAX_SAMPLES" ]]; then
        tail -n "$MAX_SAMPLES" "$DATA_FILE" > "${DATA_FILE}.tmp" && mv "${DATA_FILE}.tmp" "$DATA_FILE"
    fi

    # Compute p95
    local p95
    p95=$(compute_p95 "$DATA_FILE")
    local sample_count
    sample_count=$(wc -l < "$DATA_FILE")
    log "Samples: $sample_count, p95: ${p95}ms, threshold: ${THRESHOLD_MS}ms"

    # Alert if exceeded
    if [[ "$p95" -gt "$THRESHOLD_MS" ]]; then
        log "ALERT: ${MARKET} FBP p95 (${p95}ms) exceeds threshold (${THRESHOLD_MS}ms)"

        if [[ -n "$ALERT_WEBHOOK" ]]; then
            curl -sS -X POST -H "Content-Type: application/json" \
                -d "{\"text\":\"[BUY-71023] ${MARKET} find_best_price p95=${p95}ms > threshold ${THRESHOLD_MS}ms\"}" \
                "$ALERT_WEBHOOK" >/dev/null 2>&1 || true
        fi

        # Also write to alert log for external monitoring
        echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] ${MARKET} FBP p95 ${p95}ms > ${THRESHOLD_MS}ms threshold" >> /tmp/fbp-alerts.log
    fi
}

main "$@"
