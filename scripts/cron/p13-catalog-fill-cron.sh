#!/bin/bash
# P1.3-NM: daily catalog-fill post-sweep — BUY-71136
# Runs at 00:30Z, reads sweep from data/sweep/zrr/{yesterday}.jsonl
# Classifies failures, files children when near-miss > 0.

set -euo pipefail

cd /home/paperclip/buywhere

export CATALOG_DB_URL="$(cat /home/paperclip/buywhere-api/data/.catalog_db_url)"
export PAPERCLIP_API_URL="${PAPERCLIP_API_URL:-https://paperclip.richteo.com}"
export PAPERCLIP_API_KEY="$(python3 -c "import json;print(json.load(open('/home/paperclip/.secrets/fleet-secrets.json'))['PAPERCLIP_API_KEY'])" 2>/dev/null || echo "$PAPERCLIP_API_KEY")"

exec /usr/bin/env python3 scripts/eval/p13-near-miss-catalog-fill.py --date yesterday
