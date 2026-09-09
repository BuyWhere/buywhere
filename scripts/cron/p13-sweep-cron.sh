#!/bin/bash
# P1.3-NM: nightly 315-cell sweep — BUY-71135 / BUY-71136
# Runs at 23:55Z, writes to data/sweep/zrr/YYYY-MM-DD.jsonl
# Used by catalog-fill at 00:30Z for daily and weekly top-10 analysis.

set -euo pipefail

cd /home/paperclip/buywhere

export BUYWHERE_API_KEY="$(python3 -c "import json;print(json.load(open('/home/paperclip/.secrets/fleet-secrets.json'))['BUYWHERE_API_KEY'])")"
export CATALOG_DATABASE_URL="$(cat /home/paperclip/buywhere-api/data/.catalog_db_url)"

exec /usr/bin/env node scripts/eval/p13-near-miss-sweep.mjs
