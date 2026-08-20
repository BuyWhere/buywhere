#!/bin/bash
#
# run-lazada-vn-cron.sh — BUY-40828 scrape + ingest Lazada Vietnam
#
# Runs scripts/lazada_vn_scraper.mjs in scrape-only mode, then ingests the
# resulting NDJSON via the BuyWhere API.
#
# Cron: BUY-40828 cron lane (every 12h recommended)
#
# Required env (inherited from workspace):
#   BUYWHERE_API_KEY
#   BUYWHERE_API_URL         (e.g. https://api.buywhere.ai)
#   SCRAPERAPI_KEY           (recommended: ultra_premium for Lazada VN)
#   BRIGHTDATA_RESIDENTIAL_HOST
#   BRIGHTDATA_RESIDENTIAL_USERNAME
#   BRIGHTDATA_RESIDENTIAL_PASSWORD

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
LOG_DIR="$REPO_ROOT/logs"
REPORT_DIR="$REPO_ROOT/data/reports"
NDJSON_OUT="$REPO_ROOT/data/affiliate_ndjson/lazada_vn.ndjson"

mkdir -p "$LOG_DIR" "$REPORT_DIR" "$(dirname "$NDJSON_OUT")"

TS=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
LOG_FILE="$LOG_DIR/lazada-vn-cron-${TS}.log"
REPORT_FILE="$REPORT_DIR/lazada-vn-cron-${TS}.json"

# API base (default to production)
API_BASE="${BUYWHERE_API_URL:-https://api.buywhere.ai}"

echo "[$TS] Starting Lazada VN scrape" | tee "$LOG_FILE"

# Step 1: scrape to NDJSON
set +e
node "$SCRIPT_DIR/lazada_vn_scraper.mjs" \
  --api-key "$BUYWHERE_API_KEY" \
  --api-base "$API_BASE" \
  --scrape-only \
  --output "$NDJSON_OUT" \
  --batch-size 200 \
  --delay 2000 \
  --fail-on-empty \
  2>&1 | tee -a "$LOG_FILE"
SCRAPE_RC=${PIPESTATUS[0]}
set -e

if [ "$SCRAPE_RC" -ne 0 ]; then
  echo "[$TS] Scrape failed (rc=$SCRAPE_RC); skipping ingest" | tee -a "$LOG_FILE"
  echo '{"status":"failed","stage":"scrape","rc":'"$SCRAPE_RC"'}' > "$REPORT_FILE"
  exit 1
fi

PRODUCT_COUNT=$(wc -l < "$NDJSON_OUT" 2>/dev/null || echo 0)
echo "[$TS] Scraped $PRODUCT_COUNT products to $NDJSON_OUT" | tee -a "$LOG_FILE"

if [ "$PRODUCT_COUNT" -eq 0 ]; then
  echo "[$TS] No products scraped; nothing to ingest" | tee -a "$LOG_FILE"
  echo '{"status":"skipped","reason":"no_products"}' > "$REPORT_FILE"
  exit 0
fi

# Step 2: ingest NDJSON via the BuyWhere ingest API
set +e
RESULT=$(node - <<'EOF'
const { createReadStream, existsSync } = require('fs');
const readline = require('readline');

const NDJSON_PATH = process.argv[2];
const API_BASE = process.argv[3];
const API_KEY = process.argv[4];

if (!existsSync(NDJSON_PATH)) {
  console.error('File not found:', NDJSON_PATH);
  process.exit(1);
}

async function main() {
  const rl = readline.createInterface({ input: createReadStream(NDJSON_PATH), crlfDelay: Infinity });
  const products = [];
  for await (const line of rl) {
    if (line.trim()) {
      try { products.push(JSON.parse(line)); } catch {}
    }
  }

  console.error(`Loaded ${products.length} products from NDJSON`);

  const batches = [];
  for (let i = 0; i < products.length; i += 200) {
    batches.push(products.slice(i, i + 200));
  }

  let totalInserted = 0, totalUpdated = 0, totalFailed = 0;
  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    const resp = await fetch(`${API_BASE}/v1/ingest/products`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: 'lazada_vn', products: batch }),
    });
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`Ingest HTTP ${resp.status}: ${text}`);
    }
    const r = await resp.json();
    totalInserted += r.rows_inserted || 0;
    totalUpdated += r.rows_updated || 0;
    totalFailed += r.rows_failed || 0;
    console.error(`Batch ${i+1}/${batches.length}: +${r.rows_inserted} ins, ~${r.rows_updated} upd, ${r.rows_failed} fail`);
  }

  console.log(JSON.stringify({ inserted: totalInserted, updated: totalUpdated, failed: totalFailed, total: products.length }));
}

main().catch(e => { console.error(e.message); process.exit(1); });
EOF
"$NDJSON_OUT" "$API_BASE" "$BUYWHERE_API_KEY" 2>&1)
INGEST_RC=$?
set -e

echo "$RESULT" >> "$LOG_FILE"

if [ "$INGEST_RC" -ne 0 ]; then
  echo "[$TS] Ingest failed (rc=$INGEST_RC)" | tee -a "$LOG_FILE"
  echo '{"status":"failed","stage":"ingest","rc":'"$INGEST_RC"'}' > "$REPORT_FILE"
  exit 1
fi

INSERTED=$(echo "$RESULT" | grep -v '^Loaded\|^Batch' | node -e "const d=require('fs').readFileSync('/dev/stdin','utf8'); try {console.log(JSON.parse(d).inserted)} catch {console.log(0)}" 2>/dev/null || echo 0)

echo "{\"status\":\"success\",\"scraped\":$PRODUCT_COUNT,\"ingested\":$INSERTED,\"log\":\"$LOG_FILE\"}" > "$REPORT_FILE"

echo "[$TS] Done. Scraped=$PRODUCT_COUNT ingested=$INSERTED" | tee -a "$LOG_FILE"
exit 0
