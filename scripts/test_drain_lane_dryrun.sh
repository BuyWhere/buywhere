#!/usr/bin/env bash
# BUY-70996 — Drain lane dry-run test (no DB).
# Validates that the rotator works on synthetic recommendations.
set -euo pipefail

ROOT="${1:-$PWD}"
RECOMMENDATIONS="$ROOT/data/.drain_lane_recommendations.json"

cat > "$RECOMMENDATIONS" << JSON
{
  "analyzed_at": "2026-08-25T05:00:00Z",
  "overall_insert_share_pct": 32.5,
  "target_insert_share_pct": 70,
  "minimum_insert_share_pct": 40,
  "mode": "boost_discovery",
  "lanes": [
    {"lane_id":"woocommerce_deep","category":"re_crawl","priority":2,"source_filter":"woocommerce_deep","current_insert_share_pct":18,"recommended_budget_pct":10,"action":"SHRINK"},
    {"lane_id":"crew_wc_rest","category":"re_crawl","priority":3,"source_filter":"woocommerce_deep","current_insert_share_pct":21,"recommended_budget_pct":5,"action":"SHRINK"},
    {"lane_id":"shopify_discovery","category":"discovery","priority":1,"source_filter":"shopify_discovery","current_insert_share_pct":45,"recommended_budget_pct":35,"action":"BOOST"},
    {"lane_id":"bigcommerce_discovery","category":"discovery","priority":1,"source_filter":"bigcommerce","current_insert_share_pct":52,"recommended_budget_pct":20,"action":"BOOST"},
    {"lane_id":"magento_discovery","category":"discovery","priority":1,"source_filter":"magento","current_insert_share_pct":48,"recommended_budget_pct":20,"action":"BOOST"},
    {"lane_id":"scraper_sg","category":"discovery","priority":1,"source_filter":"scraper_sg","current_insert_share_pct":41,"recommended_budget_pct":20,"action":"BOOST"}
  ]
}
JSON

echo "=== Running rotator with synthetic recommendations ==="
node scripts/drain_lane_rotator.mjs 2>&1
echo "---"
echo "=== Rotator outputs ==="
ls -la data/.drain_lane_budgets.json data/.drain_lane_budget_*.json 2>&1 | head -10
