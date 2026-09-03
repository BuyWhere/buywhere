#!/usr/bin/env bash
# seed_comparison_pages_staging.sh — Seed 3 confirmed comparison pages in staging
#
# Usage:
#   ADMIN_KEY=<buywhere-admin-api-key> ./scripts/seed_comparison_pages_staging.sh
#
# The admin key is in GCP Secret Manager:
#   gcloud secrets versions access latest \
#     --secret=buywhere-admin-api-key \
#     --project=gaia-calendar-488606

set -euo pipefail

STAGING="${STAGING:-https://buywhere-api-3cjo6zft4q-as.a.run.app}"
ADMIN_KEY="${ADMIN_KEY:?Set ADMIN_KEY to the buywhere-admin-api-key value}"

echo "=== BUY-2270: Seed comparison pages in staging ==="
echo "Endpoint: $STAGING"
echo ""

# ── Helper ─────────────────────────────────────────────────────────────────────
search_products() {
  local q="$1"
  local limit="${2:-8}"
  curl -sS "$STAGING/v1/products/search?q=$(python3 -c "import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1]))" "$q")&limit=$limit&region=SG" \
    -H "Authorization: Bearer $ADMIN_KEY" \
    | python3 -c "
import sys, json
data = json.load(sys.stdin)
products = data.get('products', data.get('data', []))
for p in products:
    print(p.get('id',''), p.get('name','')[:60], p.get('price',''), sep=' | ')
"
}

create_page() {
  local slug="$1"
  local category="$2"
  local product_ids_json="$3"
  local expert_summary="$4"

  echo "▶ Creating: $slug"
  RESP=$(curl -sS -X POST "$STAGING/admin/comparison-pages" \
    -H "Authorization: Bearer $ADMIN_KEY" \
    -H "Content-Type: application/json" \
    -d "$(jq -nc \
      --arg slug "$slug" \
      --arg category "$category" \
      --argjson product_ids "$product_ids_json" \
      --arg expert_summary "$expert_summary" \
      '{slug: $slug, category: $category, product_ids: $product_ids,
        status: "published", expert_summary: $expert_summary}')")

  STATUS=$(echo "$RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('slug','ERROR: '+str(d)))" 2>/dev/null || echo "PARSE_ERROR")
  if [[ "$STATUS" == "$slug" ]]; then
    echo "  ✓ Created: $STAGING/v1/compare/$slug"
  else
    echo "  ✗ Failed: $RESP"
    return 1
  fi
}

verify_page() {
  local slug="$1"
  HTTP=$(curl -sS -o /dev/null -w "%{http_code}" "$STAGING/v1/compare/$slug")
  if [[ "$HTTP" == "200" ]]; then
    RETAILERS=$(curl -sS "$STAGING/v1/compare/$slug" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d.get('retailers',[])), 'retailers')" 2>/dev/null)
    echo "  ✓ $slug → $HTTP ($RETAILERS)"
  else
    echo "  ✗ $slug → HTTP $HTTP"
  fi
}

# ── Step 1: Look up product UUIDs ──────────────────────────────────────────────
echo "=== Step 1: Searching for product UUIDs ==="
echo ""

echo "Nintendo Switch 2 candidates:"
NS2_RESULTS=$(search_products "Nintendo Switch 2")
echo "$NS2_RESULTS"
NS2_IDS=$(echo "$NS2_RESULTS" | head -4 | awk -F'|' '{print $1}' | tr -d ' ' | grep -v '^$' | python3 -c "import sys,json; print(json.dumps([l.strip() for l in sys.stdin.readlines() if l.strip()]))")
echo "  → IDs: $NS2_IDS"
echo ""

echo "Dyson V12 Detect Slim candidates:"
DV12_RESULTS=$(search_products "Dyson V12 Detect Slim")
echo "$DV12_RESULTS"
DV12_IDS=$(echo "$DV12_RESULTS" | head -4 | awk -F'|' '{print $1}' | tr -d ' ' | grep -v '^$' | python3 -c "import sys,json; print(json.dumps([l.strip() for l in sys.stdin.readlines() if l.strip()]))")
echo "  → IDs: $DV12_IDS"
echo ""

echo "Xiaomi Robot Vacuum S10 Plus candidates:"
XR_RESULTS=$(search_products "Xiaomi Robot Vacuum S10 Plus")
echo "$XR_RESULTS"
XR_IDS=$(echo "$XR_RESULTS" | head -4 | awk -F'|' '{print $1}' | tr -d ' ' | grep -v '^$' | python3 -c "import sys,json; print(json.dumps([l.strip() for l in sys.stdin.readlines() if l.strip()]))")
echo "  → IDs: $XR_IDS"
echo ""

# ── Validate we got IDs ────────────────────────────────────────────────────────
NS2_COUNT=$(echo "$NS2_IDS" | python3 -c "import sys,json; print(len(json.load(sys.stdin)))")
DV12_COUNT=$(echo "$DV12_IDS" | python3 -c "import sys,json; print(len(json.load(sys.stdin)))")
XR_COUNT=$(echo "$XR_IDS" | python3 -c "import sys,json; print(len(json.load(sys.stdin)))")

if [[ "$NS2_COUNT" -eq 0 || "$DV12_COUNT" -eq 0 || "$XR_COUNT" -eq 0 ]]; then
  echo "ERROR: One or more SKUs returned 0 products. Check catalog coverage."
  echo "  nintendo-switch-2:      $NS2_COUNT products"
  echo "  dyson-v12-detect-slim:  $DV12_COUNT products"
  echo "  xiaomi-s10-plus:        $XR_COUNT products"
  echo ""
  echo "If counts are 0, check that staging is running commit >= fde50bf and catalog has SG data."
  exit 1
fi

echo "=== Step 2: Creating comparison pages ==="
echo ""

create_page "nintendo-switch-2" "electronics" "$NS2_IDS" \
  "The Nintendo Switch 2 is Nintendo's next-generation hybrid console, featuring a larger 8-inch display, improved Joy-Con with magnetic attachment, and enhanced performance. Compare prices across Singapore retailers to find the best deal before the June 2025 launch."

create_page "dyson-v12-detect-slim" "home" "$DV12_IDS" \
  "The Dyson V12 Detect Slim is Dyson's most advanced lightweight cordless vacuum, featuring laser dust detection, HEPA filtration, and up to 60 minutes runtime. Compare prices across Singapore retailers."

create_page "xiaomi-robot-vacuum-s10-plus" "home" "$XR_IDS" \
  "The Xiaomi Robot Vacuum S10 Plus combines powerful suction with an auto-empty base station and advanced AI obstacle avoidance. Compare prices across Singapore retailers."

echo ""
echo "=== Step 3: Verifying pages ==="
echo ""

verify_page "nintendo-switch-2"
verify_page "dyson-v12-detect-slim"
verify_page "xiaomi-robot-vacuum-s10-plus"

echo ""
echo "=== Done ==="
echo "Post result on BUY-2270 — Atlas QA can begin once all 3 show ✓"
