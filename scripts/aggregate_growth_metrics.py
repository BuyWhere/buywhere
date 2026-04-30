#!/usr/bin/env python3
"""
BuyWhere Growth KPI Baseline Script
Calls the BuyWhere analytics API endpoints and prints a weekly KPI snapshot.

Usage:
    # Full metrics (admin + user endpoints):
    ADMIN_API_KEY=<key> BUYWHERE_API_KEY=bw_live_xxx python scripts/aggregate_growth_metrics.py \
        --api-base https://api.buywhere.ai --weeks 4

    # Partial metrics (user endpoints only, no admin key):
    BUYWHERE_API_KEY=bw_live_xxx python scripts/aggregate_growth_metrics.py \
        --api-base https://api.buywhere.ai --weeks 4

Endpoints used:
    Admin (ADMIN_API_KEY required):
        GET /v1/analytics/query-count    — daily query totals, unique keys, agent/human split
        GET /v1/analytics/launch-window  — launch day telemetry (optional)

    User API key (BUYWHERE_API_KEY required):
        GET /v1/analytics/overview       — daily query counts + latency
        GET /v1/analytics/geo-scorecard  — weekly GEO scorecard (agents, frameworks)
        GET /v1/analytics/agents         — top agents by volume
        GET /v1/analytics/conversions    — affiliate click conversion rates

Note: analytics endpoints live in the Node.js Express app (Cloud Run), not the
FastAPI VM at api.buywhere.ai. If api.buywhere.ai returns 404 for these endpoints,
use the Cloud Run service URL (ask ops for CLOUD_RUN_API_URL).
"""

import argparse
import json
import os
import sys
from datetime import datetime, timezone

try:
    import urllib.request
    import urllib.error
except ImportError:
    print("ERROR: urllib not available", file=sys.stderr)
    sys.exit(1)


def call_api(base_url: str, path: str, auth_header: str, label: str) -> dict | None:
    url = f"{base_url.rstrip('/')}{path}"
    req = urllib.request.Request(url, headers={"Authorization": auth_header})
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        body = e.read().decode()[:200]
        if e.code == 401:
            print(f"  WARN [{label}]: 401 Unauthorized — check API key", file=sys.stderr)
        elif e.code == 503:
            print(f"  WARN [{label}]: 503 — ADMIN_API_KEY not configured on server", file=sys.stderr)
        elif e.code == 404:
            print(f"  WARN [{label}]: 404 — endpoint not found at {url}", file=sys.stderr)
            print(f"         If using api.buywhere.ai, analytics endpoints may only be", file=sys.stderr)
            print(f"         accessible via the Cloud Run URL (ask ops for CLOUD_RUN_API_URL).", file=sys.stderr)
        else:
            print(f"  WARN [{label}]: HTTP {e.code} — {body}", file=sys.stderr)
        return None
    except Exception as e:
        print(f"  WARN [{label}]: {e}", file=sys.stderr)
        return None


def print_section(title: str) -> None:
    print(f"\n{'=' * 60}")
    print(f"  {title}")
    print('=' * 60)


def main():
    parser = argparse.ArgumentParser(description="BuyWhere Growth KPI Baseline")
    parser.add_argument("--api-base", default=os.environ.get("BUYWHERE_API_BASE", "https://api.buywhere.ai"),
                        help="API base URL (default: https://api.buywhere.ai)")
    parser.add_argument("--weeks", type=int, default=4, help="Lookback window in weeks (default: 4)")
    parser.add_argument("--json", action="store_true", help="Output raw JSON instead of formatted report")
    args = parser.parse_args()

    admin_key = os.environ.get("ADMIN_API_KEY", "")
    user_key = os.environ.get("BUYWHERE_API_KEY", "")

    if not admin_key and not user_key:
        print("ERROR: Set ADMIN_API_KEY and/or BUYWHERE_API_KEY environment variables.", file=sys.stderr)
        sys.exit(1)

    print(f"\nBuyWhere Growth KPI Baseline — {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}")
    print(f"API base: {args.api_base}")
    print(f"Lookback: {args.weeks} weeks ({args.weeks * 7} days)")
    print(f"Keys present: {'ADMIN_API_KEY' if admin_key else ''} {'BUYWHERE_API_KEY' if user_key else ''}".strip())

    results = {}

    # --- Admin endpoints ---
    if admin_key:
        admin_auth = f"Bearer {admin_key}"

        print_section("Query Volume (Admin — query_log)")
        qc = call_api(args.api_base, f"/v1/analytics/query-count?days={args.weeks * 7}", admin_auth, "query-count")
        if qc and "data" in qc:
            t = qc["data"]["totals"]
            print(f"  Period total queries:  {t.get('total', 'N/A'):,}")
            print(f"  Unique API keys:       {t.get('unique_keys', 'N/A'):,}")
            print(f"  Agent queries:         {t.get('agent_count', 'N/A'):,}")
            print(f"  Unauthenticated:       {t.get('unauthenticated_count', 'N/A'):,}")
            print(f"  Success rate:          {round(t.get('success_count', 0) / max(t.get('total', 1), 1) * 100, 1)}%")
            print()
            print(f"  {'Date':<12} {'Queries':>8} {'Agents':>8} {'Unauth':>8} {'Success%':>9}")
            print(f"  {'-'*12} {'-'*8} {'-'*8} {'-'*8} {'-'*9}")
            for day in qc["data"].get("daily", [])[:14]:
                pct = round(day.get('success_count', 0) / max(day.get('total', 1), 1) * 100, 1)
                print(f"  {str(day['day']):<12} {day.get('total', 0):>8,} {day.get('agent_count', 0):>8,} "
                      f"{day.get('unauthenticated_count', 0):>8,} {pct:>8.1f}%")
            results["query_count"] = qc["data"]
        else:
            print("  No data (admin key missing or endpoint unreachable)")

    # --- User API key endpoints ---
    if user_key:
        user_auth = f"Bearer {user_key}"
        days = args.weeks * 7

        print_section("Daily Query Overview (User API Key)")
        ov = call_api(args.api_base, f"/v1/analytics/overview?days={days}", user_auth, "overview")
        if ov and "data" in ov:
            totals = ov["data"].get("totals", {})
            print(f"  Total queries ({days}d): {totals.get('total_queries', 0):,}")
            print(f"  Agent queries:          {totals.get('agent_queries', 0):,}")
            print(f"  Human queries:          {totals.get('human_queries', 0):,}")
            print()
            for day in ov["data"].get("daily", [])[:14]:
                print(f"  {str(day['day']):<12} total={day.get('total_queries', 0):>6,} "
                      f"agent={day.get('agent_queries', 0):>5,} "
                      f"p99={day.get('p99_response_ms', 'N/A')}ms")
            results["overview"] = ov["data"]
        else:
            print("  No data")

        print_section("GEO Scorecard — Weekly (User API Key)")
        geo = call_api(args.api_base, f"/v1/analytics/geo-scorecard?weeks={args.weeks}", user_auth, "geo-scorecard")
        if geo and "data" in geo:
            weekly = geo["data"].get("weekly", [])
            frameworks = geo["data"].get("by_framework", [])
            print(f"  {'Week':<12} {'Queries':>8} {'Agents':>8} {'Uniq Keys':>10} {'p99ms':>7}")
            print(f"  {'-'*12} {'-'*8} {'-'*8} {'-'*10} {'-'*7}")
            for w in weekly:
                print(f"  {str(w.get('week_start', '?')):<12} {w.get('total_queries', 0):>8,} "
                      f"{w.get('agent_queries', 0):>8,} {w.get('unique_agent_keys', 0):>10,} "
                      f"{str(w.get('p99_response_ms', 'N/A')):>7}")
            if frameworks:
                print(f"\n  Frameworks: " + ", ".join(f"{f['framework'] or 'unknown'} ({f['count']})" for f in frameworks[:5]))
            results["geo_scorecard"] = geo["data"]
        else:
            print("  No data")

        print_section("Top Active Agents (User API Key)")
        agents = call_api(args.api_base, f"/v1/analytics/agents?days={days}&limit=10", user_auth, "agents")
        if agents and "data" in agents:
            print(f"  {'Agent':<30} {'Queries':>8} {'Days':>5} {'Framework':<20}")
            print(f"  {'-'*30} {'-'*8} {'-'*5} {'-'*20}")
            for a in agents["data"][:10]:
                print(f"  {str(a.get('agent_name', '?'))[:30]:<30} {a.get('total_queries', 0):>8,} "
                      f"{a.get('active_days', 0):>5} {str(a.get('framework', 'N/A'))[:20]:<20}")
            results["agents"] = agents["data"]
        else:
            print("  No data")

        print_section("Conversion Funnel (User API Key)")
        conv = call_api(args.api_base, f"/v1/analytics/conversions?days={days}", user_auth, "conversions")
        if conv and "data" in conv:
            summary = conv["data"].get("summary", {})
            if summary:
                print(f"  Total agent queries:     {summary.get('total_agent_queries', 0):,}")
                print(f"  Total affiliate clicks:  {summary.get('total_clicks', 0):,}")
                print(f"  Conversion rate:         {summary.get('conversion_rate_pct', 0):.2f}%")
                results["conversions"] = conv["data"]
            else:
                print("  Summary not available in response")
        else:
            print("  No data")

    # --- first_query_latency (activation funnel) ---
    # This endpoint was planned in BUY-3902 (/v1/growth/metrics/activation-funnel)
    # but was not committed to the repo. Placeholder for when it ships.
    print_section("Activation Funnel — first_query_latency_seconds")
    key_for_funnel = admin_key or user_key
    auth_for_funnel = f"Bearer {key_for_funnel}"
    funnel = call_api(args.api_base, "/v1/growth/metrics/activation-funnel", auth_for_funnel, "activation-funnel")
    if funnel and "data" in funnel:
        d = funnel["data"]
        print(f"  Median time to first query:  {d.get('median_seconds', 'N/A')}s")
        print(f"  p25:                         {d.get('p25_seconds', 'N/A')}s")
        print(f"  p75:                         {d.get('p75_seconds', 'N/A')}s")
        print(f"  Activated keys:              {d.get('activated_count', 'N/A')}")
        print(f"  Never-activated keys:        {d.get('never_activated_count', 'N/A')}")
        results["activation_funnel"] = d
    else:
        print("  MISSING — /v1/growth/metrics/activation-funnel not yet deployed.")
        print("  See BUY-3902: this endpoint needs to be added to the Node.js Express app")
        print("  and deployed to Cloud Run before first_query_latency_seconds is available.")

    print_section("Instrumentation Gaps")
    print("  1. /v1/analytics/* endpoints NOT accessible at api.buywhere.ai (FastAPI VM).")
    print("     They exist in Cloud Run (Node.js Express). Use CLOUD_RUN_API_URL for this script.")
    print("  2. /v1/growth/metrics/activation-funnel — not yet in repo (BUY-3902 incomplete).")
    print("  3. PostHog: funnel/session analytics require PostHog Cloud (BUY-1362).")
    print("  4. Weekly signups count: not in analytics API — requires query against api_keys table.")

    print(f"\n{'=' * 60}")
    print(f"  Run command (weekly):")
    print(f"  ADMIN_API_KEY=<key> BUYWHERE_API_KEY=<bw_key> \\")
    print(f"    python scripts/aggregate_growth_metrics.py --api-base <CLOUD_RUN_URL> --weeks 4")
    print(f"{'=' * 60}\n")

    if args.json:
        print(json.dumps(results, indent=2, default=str))


if __name__ == "__main__":
    main()
