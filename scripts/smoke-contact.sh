#!/usr/bin/env bash
# scripts/smoke-contact.sh — Smoke test for contact page paths and form submission
# Usage: FRONTEND_URL=https://buywhere.ai ./scripts/smoke-contact.sh
# Exit 0 = all checks passed. Exit 1 = one or more failures.
set -euo pipefail

FRONTEND_URL="${FRONTEND_URL:-https://buywhere.ai}"
BASE="${FRONTEND_URL%/}"
PASS=0
FAIL=0

check() {
  local label="$1"
  local result="$2"
  local expect="$3"
  if [ "$result" = "$expect" ]; then
    echo "  PASS  $label"
    PASS=$((PASS + 1))
  else
    echo "  FAIL  $label (got: $result, expected: $expect)"
    FAIL=$((FAIL + 1))
  fi
}

TMP=$(mktemp)
trap 'rm -f "$TMP"' EXIT

# 1. Contact page returns 200
echo "=== Contact page ==="
HTTP=$(curl -s -o "$TMP" -w "%{http_code}" --max-time 15 "$BASE/contact/")
check "GET /contact/ HTTP 200" "$HTTP" "200"

# 2. Contact page contains BuyWhere
grep -q "BuyWhere" "$TMP" 2>/dev/null && check "GET /contact/ contains BuyWhere" "200" "200" || check "GET /contact/ contains BuyWhere" "missing" "200"

# 3. No /cdn-cgi/l/email-protection links in SSR HTML
if grep -q "cdn-cgi/l/email-protection" "$TMP" 2>/dev/null; then
  check "No Cloudflare email-obfuscation in /contact/ SSR HTML" "found" "none"
else
  check "No Cloudflare email-obfuscation in /contact/ SSR HTML" "none" "none"
fi

# 4. Contact API rejects empty payload with 400
echo "=== Contact API ==="
API_EMPTY=$(curl -sL -o /dev/null -w "%{http_code}" -X POST "$BASE/api/v1/contact" \
  -H "Content-Type: application/json" -d '{}' --max-time 15)
check "POST /api/v1/contact empty body → 400" "$API_EMPTY" "400"

# 5. Contact API accepts valid payload with 200
API_OK=$(curl -sL -o "$TMP" -w "%{http_code}" -X POST "$BASE/api/v1/contact" \
  -H "Content-Type: application/json" \
  -d '{"companyName":"Smoke Test Corp","contactName":"Smoke Bot","email":"smoke@buywhere.ai","message":"Automated smoke test — ignore.","source":"smoke-test"}' \
  --max-time 15)
check "POST /api/v1/contact valid payload → 200" "$API_OK" "200"

# 6. Valid response contains success key
if grep -q '"success":true' "$TMP" 2>/dev/null; then
  check "POST /api/v1/contact response has success:true" "found" "found"
else
  check "POST /api/v1/contact response has success:true" "missing" "found"
fi

# 7. Homepage contains no Cloudflare email-obfuscation
echo "=== Homepage ==="
HTTP_HOME=$(curl -s -o "$TMP" -w "%{http_code}" --max-time 15 "$BASE/")
check "GET / HTTP 200" "$HTTP_HOME" "200"
if grep -q "cdn-cgi/l/email-protection" "$TMP" 2>/dev/null; then
  check "No Cloudflare email-obfuscation in / SSR HTML" "found" "none"
else
  check "No Cloudflare email-obfuscation in / SSR HTML" "none" "none"
fi

echo ""
echo "=== Results: $PASS passed, $FAIL failed ==="
[ "$FAIL" -eq 0 ]
