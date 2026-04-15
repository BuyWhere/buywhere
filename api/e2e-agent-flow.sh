#!/usr/bin/env bash
# End-to-end test: agent discovers -> registers -> queries all v1 endpoints
# Usage: API_BASE=http://localhost:3000 ./e2e-agent-flow.sh

set -euo pipefail
API_BASE="${API_BASE:-http://localhost:3000}"
PASS=0; FAIL=0

pass() { echo "   ✓ $1"; PASS=$((PASS+1)); }
fail() { echo "   ✗ $1"; FAIL=$((FAIL+1)); }
check_field() { echo "$1" | grep -q "\"$2\"" && pass "$2 present" || fail "$2 missing"; }

echo "=== BuyWhere Agent E2E Test ==="
echo "Target: $API_BASE"
echo ""

# Step 1: Discovery
echo "1. Discovery"
PLUGIN=$(curl -sf "$API_BASE/.well-known/ai-plugin.json")
echo "$PLUGIN" | grep -q '"buywhere_catalog"' && pass "ai-plugin.json name_for_model" || fail "ai-plugin.json"

OPENAPI=$(curl -sf "$API_BASE/openapi.json")
for ep in '/auth/register' '/products/search' '/products/deals' '/products/compare' '/products/{id}' '/products/{id}/prices' '/categories' '/categories/{slug}'; do
  echo "$OPENAPI" | grep -q "$ep" && pass "OpenAPI documents $ep" || fail "OpenAPI missing $ep"
done

# Step 2: Register
echo ""
echo "2. Agent self-registration"
REGISTER=$(curl -sf -X POST "$API_BASE/v1/auth/register" \
  -H "Content-Type: application/json" \
  -d '{"agent_name":"e2e-test-agent","contact":"test@e2e.local","use_case":"automated e2e test"}')

API_KEY=$(echo "$REGISTER" | grep -o '"api_key":"[^"]*"' | cut -d'"' -f4)
[[ -n "$API_KEY" ]] && pass "api_key returned (${API_KEY:0:12}...)" || { fail "no api_key"; exit 1; }

TIER=$(echo "$REGISTER" | grep -o '"tier":"[^"]*"' | cut -d'"' -f4)
[[ "$TIER" == "free" ]] && pass "tier=free" || fail "tier=$TIER (expected free)"

RPM=$(echo "$REGISTER" | grep -o '"rpm":[0-9]*' | cut -d: -f2)
[[ "$RPM" == "60" ]] && pass "rpm=60" || fail "rpm=$RPM (expected 60)"

AUTH="Authorization: Bearer $API_KEY"

# Step 3: Product search
echo ""
echo "3. Product search"
SEARCH=$(curl -sf "$API_BASE/v1/products/search?q=laptop&limit=5" -H "$AUTH")
TOTAL=$(echo "$SEARCH" | grep -o '"total":[0-9]*' | cut -d: -f2)
[[ "${TOTAL:-0}" -gt 0 ]] && pass "search returned $TOTAL results" || fail "search returned 0 results"
echo "$SEARCH" | grep -q '"response_time_ms"' && pass "response_time_ms present" || fail "response_time_ms missing"

# Step 4: Get product by ID
echo ""
echo "4. Product lookup"
PROD_ID=$(echo "$SEARCH" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
if [[ -n "$PROD_ID" ]]; then
  PRODUCT=$(curl -sf "$API_BASE/v1/products/$PROD_ID" -H "$AUTH")
  echo "$PRODUCT" | grep -q '"title"' && pass "GET /products/:id returns title" || fail "GET /products/:id bad response"
else
  fail "no product ID from search to test lookup"
fi

# Step 5: Price history
echo ""
echo "5. Price history"
if [[ -n "$PROD_ID" ]]; then
  PRICES=$(curl -sf "$API_BASE/v1/products/$PROD_ID/prices?days=7" -H "$AUTH")
  echo "$PRICES" | grep -q '"current_price"' && pass "price history has current_price" || fail "price history bad response"
fi

# Step 6: Deals
echo ""
echo "6. Deals endpoint"
DEALS=$(curl -sf "$API_BASE/v1/products/deals?limit=5" -H "$AUTH")
DEAL_TOTAL=$(echo "$DEALS" | grep -o '"total":[0-9]*' | cut -d: -f2)
[[ "${DEAL_TOTAL:-0}" -gt 0 ]] && pass "deals returned $DEAL_TOTAL results" || fail "deals returned 0"
echo "$DEALS" | grep -q '"discount_pct"' && pass "discount_pct present" || fail "discount_pct missing"

# Step 7: Categories
echo ""
echo "7. Categories"
CATS=$(curl -sf "$API_BASE/v1/categories" -H "$AUTH")
CAT_TOTAL=$(echo "$CATS" | grep -o '"total":[0-9]*' | cut -d: -f2)
[[ "${CAT_TOTAL:-0}" -gt 0 ]] && pass "categories returned $CAT_TOTAL categories" || fail "categories empty"
FIRST_SLUG=$(echo "$CATS" | grep -o '"slug":"[^"]*"' | head -1 | cut -d'"' -f4)
if [[ -n "$FIRST_SLUG" ]]; then
  CAT_DETAIL=$(curl -sf "$API_BASE/v1/categories/$FIRST_SLUG" -H "$AUTH")
  echo "$CAT_DETAIL" | grep -q '"subcategories"' && pass "GET /categories/:slug returns subcategories" || fail "category detail bad response"
fi

# Step 8: Compare
echo ""
echo "8. Product compare"
IDS=$(echo "$SEARCH" | grep -o '"id":"[^"]*"' | head -2 | cut -d'"' -f4 | tr '\n' ',' | sed 's/,$//')
if [[ $(echo "$IDS" | tr ',' '\n' | wc -l) -ge 2 ]]; then
  COMPARE=$(curl -sf "$API_BASE/v1/products/compare?ids=$IDS" -H "$AUTH")
  echo "$COMPARE" | grep -q '"count"' && pass "compare returned results" || fail "compare bad response"
else
  fail "not enough IDs for compare test"
fi

# Summary
echo ""
echo "=== Results: $PASS passed, $FAIL failed ==="
[[ $FAIL -eq 0 ]] && echo "All tests passed ✓" || { echo "Some tests failed"; exit 1; }
