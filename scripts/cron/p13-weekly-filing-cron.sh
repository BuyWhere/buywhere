#!/bin/bash
# P1.3-NM: weekly top-10 filing — BUY-71136
# Runs Mon 07:00Z. Aggregates last 7 days of daily catalog-fill output.
# Files child issues for top-10 worst predicate+market+category combos.

set -euo pipefail

cd /home/paperclip/buywhere

export CATALOG_DB_URL="$(cat /home/paperclip/buywhere-api/data/.catalog_db_url)"
export PAPERCLIP_API_URL="${PAPERCLIP_API_URL:-https://paperclip.richteo.com}"
export PAPERCLIP_API_KEY="$(python3 -c "import json;print(json.load(open('/home/paperclip/.secrets/fleet-secrets.json'))['PAPERCLIP_API_KEY'])" 2>/dev/null || echo "$PAPERCLIP_API_KEY")"

exec /usr/bin/env python3 scripts/eval/p13-near-miss-catalog-fill.py --weekly
