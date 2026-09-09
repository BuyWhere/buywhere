#!/usr/bin/env bash
set -euo pipefail

# Governance rule #10: production surfaces must not synthesize catalog/price
# data when APIs are unavailable. This guard checks for:
#   1. generateMock* functions that produce invented product data
#   2. Hardcoded product fixtures (Sony, AirPods, Dyson, etc.) in fallback/mock paths
#   3. picsum.photos or via.placeholder.com used as product image sources
#   4. url: "#" patterns in deal/price arrays (invented non-clickable retailer URLs)
#
# Excludes:
#   - Test files (allow test fixtures)
#   - SEO landing pages (editorial content, not data surfaces)
#   - Markdown/content files (editorial)
#   - us-products.ts (utility types, no longer contains mock data)
#
# Usage: bash scripts/guard-production-mock-data.sh

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

FAILED=0

# Pattern 1: mock data generator functions
echo "--- Checking for mock data generators ---"
MOCK_GENERATOR_PATTERNS=(
  'generateMockUsProducts'
  'generateMockDeals'
  'generateMockProducts'
  'mockProducts\s*='
  'picsum\.photos/seed/us'
  'picsum\.photos/seed/sg'
)

EXCLUDES=(
  --glob '!**/*.test.*' --glob '!**/*.spec.*' --glob '!**/__tests__/**'
  --glob '!src/lib/seo-landing-pages.ts'
  --glob '!src/lib/us-products.ts'
  --glob '!content/**'
)

for pattern in "${MOCK_GENERATOR_PATTERNS[@]}"; do
  MATCHES=$(rg --line-number --color=never "${EXCLUDES[@]}" "$pattern" src/ 2>/dev/null || true)
  if [ -n "$MATCHES" ]; then
    echo "  ❌ MOCK GENERATOR PATTERN: ${pattern}"
    echo "$MATCHES" | sed 's/^/    /'
    FAILED=1
  fi
done

# Pattern 2: hardcoded invented product fallbacks in production components
echo "--- Checking for hardcoded product fallbacks ---"
HARDCODED_PATTERNS=(
  'Sony WH-1000XM5.*price.*329'
  'ASUS ROG Zephyrus G16.*price.*1699'
  'MacBook Air 13 M3.*price.*999'
  'Dell UltraSharp 27 4K.*price.*499'
)

for pattern in "${HARDCODED_PATTERNS[@]}"; do
  MATCHES=$(rg --line-number --color=never "${EXCLUDES[@]}" "$pattern" src/ 2>/dev/null || true)
  if [ -n "$MATCHES" ]; then
    echo "  ❌ HARDCODED PRODUCT FALLBACK: ${pattern}"
    echo "$MATCHES" | sed 's/^/    /'
    FAILED=1
  fi
done

# Pattern 3: invented product URLs in deals/components
echo "--- Checking for invented deal URLs ---"
MATCHES=$(rg --line-number --color=never "${EXCLUDES[@]}" 'url:\s*["'"'"']#[/"'"'"']' src/app/ src/components/ 2>/dev/null || true)
if [ -n "$MATCHES" ]; then
  echo "  ❌ INVENTED DEAL URL (url: '#')"
  echo "$MATCHES" | sed 's/^/    /'
  FAILED=1
fi

# Pattern 4: via.placeholder.com in product images
echo "--- Checking for placeholder product images ---"
MATCHES=$(rg --line-number --color=never "${EXCLUDES[@]}" 'via\.placeholder\.com' src/app/ src/components/ 2>/dev/null || true)
if [ -n "$MATCHES" ]; then
  echo "  ❌ PLACEHOLDER PRODUCT IMAGE"
  echo "$MATCHES" | sed 's/^/    /'
  FAILED=1
fi

echo ""
if [ "$FAILED" -ne 0 ]; then
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "❌ GOVERNANCE RULE #10 VIOLATION"
  echo "Production surfaces must render API data or an honest empty/error state,"
  echo "never invented catalog data."
  echo ""
  echo "Fix: remove the mock/fallback, render an empty state, and point users"
  echo "to the live search or comparison page instead."
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  exit 1
fi

echo "✅ OK: no production mock data patterns detected"
