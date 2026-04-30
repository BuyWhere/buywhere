#!/bin/bash
set -euo pipefail

CERT_DIR="/etc/letsencrypt/live/api.buywhere.ai"
METRICS_FILE="/var/lib/node_exporter/textfile_collector/ssl_cert.prom"

check_cert_expiry() {
    local cert_file="$1"
    local hostname="$2"

    if [[ ! -f "$cert_file" ]]; then
        echo "# HELP ssl_cert_expiry_seconds SSL certificate expiry time in seconds"
        echo "# TYPE ssl_cert_expiry_seconds gauge"
        echo "ssl_cert_expiry_seconds{instance=\"$hostname\"} 0"
        return
    fi

    local expiry_date
    expiry_date=$(openssl x509 -in "$cert_file" -noout -enddate 2>/dev/null | cut -d= -f2)
    if [[ -z "$expiry_date" ]]; then
        echo "ssl_cert_expiry_seconds{instance=\"$hostname\"} 0"
        return
    fi

    local expiry_epoch
    expiry_epoch=$(date -d "$expiry_date" +%s 2>/dev/null || date -j -f "%b %d %T %Y %Z" "$expiry_date" +%s 2>/dev/null)
    local now_epoch
    now_epoch=$(date +%s)
    local seconds_until_expiry=$(( expiry_epoch - now_epoch ))

    echo "# HELP ssl_cert_expiry_seconds SSL certificate expiry time in seconds"
    echo "# TYPE ssl_cert_expiry_seconds gauge"
    echo "ssl_cert_expiry_seconds{instance=\"$hostname\"} $seconds_until_expiry"
}

mkdir -p "$(dirname "$METRICS_FILE")" 2>/dev/null || true

if [[ ! -d "$(dirname "$METRICS_FILE")" ]]; then
    exit 0
fi

check_cert_expiry "$CERT_DIR/fullchain.pem" "api.buywhere.ai" > "$METRICS_FILE"