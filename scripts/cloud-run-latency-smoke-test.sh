#!/usr/bin/env bash
# scripts/cloud-run-latency-smoke-test.sh
# Lightweight bash smoke test for Cloud Run deployment health.
# Used by deploy-cloud-run-staging.yml and deploy-cloud-run-production.yml.
#
# When SMOKE_TEST_API_KEY or K6_API_KEY is set, also verifies authenticated
# v1 endpoints (product search, categories).

set -e

API_BASE_URL="${1:-${API_BASE_URL:-}}"

if [ -z "$API_BASE_URL" ]; then
  echo "ERROR: API_BASE_URL not provided as argument or env var"
  exit 1
fi

# Accept SMOKE_TEST_API_KEY or fall back to K6_API_KEY (set by CI)
API_KEY="${SMOKE_TEST_API_KEY:-${K6_API_KEY:-}}"

echo "=== Cloud Run Latency Smoke Test ==="
echo "Target: $API_BASE_URL"
if [ -n "$API_KEY" ]; then
  echo "Auth:   API key configured (${#API_KEY} chars)"
else
  echo "Auth:   No API key — unauthenticated endpoints only"
fi
echo "Running at: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo ""

PASSED=0
FAILED=0

test_endpoint() {
  local method="$1"
  local path="$2"
  local expected_status="${3:-200}"
  local label="${4:-$method $path}"

  echo -n "$label ... "

  start_ns=$(date +%s%N)

  local curl_args=(-s -o /dev/null -w "%{http_code}" --max-time 15)
  if [ -n "$API_KEY" ]; then
    curl_args+=(-H "Authorization: Bearer ${API_KEY}")
  fi

  http_code=$(curl "${curl_args[@]}" "${API_BASE_URL}${path}")
  end_ns=$(date +%s%N)
  latency_ms=$(( (end_ns - start_ns) / 1000000 ))

  if [ "$http_code" = "$expected_status" ]; then
    echo "OK (${latency_ms}ms, status=$http_code)"
    PASSED=$((PASSED + 1))
  else
    echo "FAIL (expected=$expected_status got=$http_code, latency=${latency_ms}ms)"
    FAILED=$((FAILED + 1))
  fi
}

# ── Unauthenticated endpoints ──────────────────────────────────────────
test_endpoint "GET" "/health" 200

# ── Authenticated endpoints (only if API key is available) ─────────────
if [ -n "$API_KEY" ]; then
  test_endpoint "GET" "/v1/products/search?q=headphones&limit=1&country_code=US" 200 \
    "GET /v1/products/search"

  test_endpoint "GET" "/v1/products/search?q=laptop&limit=3&country_code=SG" 200 \
    "GET /v1/products/search (SG)"

  test_endpoint "GET" "/v1/categories" 200

  # Invalid API key test — ensure auth rejects bad keys
  echo -n "Auth:   invalid key rejected ... "
  reject_code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 \
    -H "Authorization: Bearer bw_fake_invalid_key_00000000" \
    "${API_BASE_URL}/v1/products/search?q=test&limit=1")
  if [ "$reject_code" = "401" ]; then
    echo "OK (status=$reject_code)"
    PASSED=$((PASSED + 1))
  else
    echo "FAIL (expected=401 got=$reject_code)"
    FAILED=$((FAILED + 1))
  fi
fi

echo ""
echo "Results: $PASSED passed, $FAILED failed"
echo ""

# ── Latency samples (n=5, health endpoint) ────────────────────────────
echo "=== Latency samples (n=5) ==="
total_latency=0
max_latency=0
latencies=()

health_url="${API_BASE_URL}/health"
for i in {1..5}; do
  start_ns=$(date +%s%N)
  curl -s -o /dev/null --max-time 10 "$health_url" > /dev/null 2>&1 || true
  end_ns=$(date +%s%N)
  lat_ms=$(( (end_ns - start_ns) / 1000000 ))
  latencies+=($lat_ms)
  total_latency=$((total_latency + lat_ms))
  if [ $lat_ms -gt $max_latency ]; then
    max_latency=$lat_ms
  fi
  echo "  sample $i: ${lat_ms}ms"
done

avg_latency=$((total_latency / 5))
echo ""
echo "Average latency: ${avg_latency}ms"
echo "Max latency: ${max_latency}ms"

# Calculate P95 manually from 5 samples (approximate, small sample)
sorted=($(for l in "${latencies[@]}"; do echo "$l"; done | sort -n))
p95_idx=$(( (5 * 95 / 100) - 1 ))
p95_latency=${sorted[$p95_idx]}
echo "P95 latency: ${p95_latency}ms"
echo ""

echo "=== Smoke Test Summary ==="
echo "Average latency: ${avg_latency}ms"
echo "P95 latency: ${p95_latency}ms"
echo "Max latency: ${max_latency}ms"
echo "Endpoints tested: $((PASSED + FAILED))"
echo "Passed: $PASSED"
echo "Failed: $FAILED"

if [ $FAILED -gt 0 ]; then
  echo "STATUS: FAILED"
  exit 1
fi

if [ $avg_latency -gt 2000 ]; then
  echo "WARNING: Average latency exceeds 2000ms"
fi

echo "STATUS: PASSED"
exit 0
