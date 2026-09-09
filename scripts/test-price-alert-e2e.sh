#!/bin/bash
# scripts/test-price-alert-e2e.sh
# E2E smoke test for BUY-3130 — price alert flow
#
# Verifies: create alert → simulate price drop → check triggers → notification queued
#
# Usage:
#   bash scripts/test-price-alert-e2e.sh
#
# Runs inside the Docker API container where app code and DB are available.
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "=== BUY-3130 E2E: Price Alert Flow ==="
echo ""

# Run inside the API container via docker exec
docker exec buywhere-api-api-1 sh -c "cd /app && python scripts/test_price_alert_e2e.py"
