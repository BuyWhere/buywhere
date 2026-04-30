#!/usr/bin/env python3
"""
Analytics Baseline Report — BUY-1355

Generates a report of what's measurable NOW using existing logs,
before PostHog Cloud is configured.

Run: python scripts/analytics_baseline_report.py
"""

import json
import os
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

LOG_DIR = Path(os.environ.get("LOG_DIR", "/home/paperclip/buywhere-api/logs"))


def parse_jsonl(path: Path) -> list[dict]:
    entries = []
    try:
        with open(path) as f:
            for line in f:
                line = line.strip()
                if line:
                    try:
                        entries.append(json.loads(line))
                    except json.JSONDecodeError:
                        pass
    except FileNotFoundError:
        pass
    return entries


def analyze_api_requests() -> dict[str, Any]:
    entries = parse_jsonl(LOG_DIR / "api_requests.log")
    if not entries:
        return {"total": 0, "error": "No api_requests.log found"}

    paths = Counter(e.get("path", "unknown") for e in entries)
    statuses = Counter(e.get("statusCode", 0) for e in entries)
    bots = Counter(e.get("botName") for e in entries if e.get("botName"))
    ai_models = Counter()

    for e in entries:
        ua = e.get("userAgent", "")
        if "claude" in ua.lower() or "anthropic" in ua.lower():
            ai_models["claude"] += 1
        elif "gpt" in ua.lower() or "openai" in ua.lower() or "chatgpt" in ua.lower():
            ai_models["gpt"] += 1
        elif "gemini" in ua.lower() or "google" in ua.lower():
            ai_models["gemini"] += 1
        elif "perplexity" in ua.lower():
            ai_models["perplexity"] += 1

    # Estimate date range
    timestamps = []
    for e in entries:
        try:
            ts = datetime.fromisoformat(e.get("timestamp", "").replace("Z", "+00:00"))
            timestamps.append(ts)
        except Exception:
            pass

    date_range = None
    if timestamps:
        date_range = {
            "earliest": min(timestamps).isoformat(),
            "latest": max(timestamps).isoformat(),
        }

    # Success rate
    success = sum(1 for s in statuses.keys() if 200 <= s < 300)
    total = sum(statuses.values())
    success_rate = (success / total * 100) if total > 0 else 0

    # Top endpoints
    top_endpoints = dict(paths.most_common(10))

    # Average response time
    durations = [e.get("durationMs", 0) for e in entries if isinstance(e.get("durationMs"), (int, float))]
    avg_duration = sum(durations) / len(durations) if durations else 0

    return {
        "total_requests": total,
        "date_range": date_range,
        "success_rate_pct": round(success_rate, 1),
        "avg_response_time_ms": round(avg_duration, 1),
        "status_codes": dict(statuses),
        "top_endpoints": top_endpoints,
        "ai_crawler_requests": dict(bots),
        "ai_model_queries": dict(ai_models),
        "log_source": str(LOG_DIR / "api_requests.log"),
    }


def analyze_scraper_logs() -> dict[str, Any]:
    scraper_files = list(LOG_DIR.glob("*continuous*.log")) + list(LOG_DIR.glob("*scrape*.log"))
    scraper_stats = {}

    for sf in scraper_files[:20]:  # Limit to first 20
        entries = parse_jsonl(sf)
        if not entries:
            continue

        statuses = Counter(e.get("status") for e in entries if isinstance(e, dict) and "status" in e)
        items_scraped = sum(
            e.get("items_scraped", 0)
            for e in entries
            if isinstance(e, dict) and "items_scraped" in e
        )

        scraper_stats[sf.name] = {
            "total_entries": len(entries),
            "statuses": dict(statuses),
            "total_items_scraped": items_scraped,
        }

    return scraper_stats


def analyze_bot_sessions() -> dict[str, Any]:
    entries = parse_jsonl(LOG_DIR / "bot_sessions.log")
    if not entries:
        return {"total": 0}

    bots = Counter(e.get("bot") for e in entries)
    paths = Counter(e.get("path") for e in entries)

    return {
        "total_bot_sessions": len(entries),
        "bot_breakdown": dict(bots),
        "top_paths_hit": dict(paths.most_common(10)),
    }


def analyze_catalog_stats() -> dict[str, Any]:
    stats_file = LOG_DIR.parent / "catalog_stats.json"
    if not stats_file.exists():
        return {"available": False}

    try:
        with open(stats_file) as f:
            data = json.load(f)
        return {"available": True, "data": data}
    except Exception:
        return {"available": False, "error": "Failed to parse"}


def main():
    print("=" * 70)
    print("BUY-1355 ANALYTICS BASELINE REPORT")
    print(f"Generated: {datetime.now(timezone.utc).isoformat()}")
    print("=" * 70)

    print("\n## 1. API Request Analytics (from api_requests.log)")
    print("-" * 50)
    api_data = analyze_api_requests()
    if "error" in api_data:
        print(f"  ERROR: {api_data['error']}")
    else:
        print(f"  Total requests:     {api_data['total_requests']:,}")
        if api_data.get("date_range"):
            dr = api_data["date_range"]
            print(f"  Date range:         {dr['earliest'][:10]} to {dr['latest'][:10]}")
        print(f"  Success rate:       {api_data['success_rate_pct']}%")
        print(f"  Avg response time:  {api_data['avg_response_time_ms']}ms")
        print("\n  Status codes:")
        for code, count in sorted(api_data["status_codes"].items()):
            print(f"    {code}: {count:,}")
        print("\n  Top 10 endpoints:")
        for path, count in api_data["top_endpoints"].items():
            print(f"    {path}: {count:,}")
        if api_data.get("ai_crawler_requests"):
            print("\n  AI crawler hits:")
            for bot, count in api_data["ai_crawler_requests"].items():
                print(f"    {bot}: {count:,}")

    print("\n## 2. Bot Session Analytics (from bot_sessions.log)")
    print("-" * 50)
    bot_data = analyze_bot_sessions()
    if bot_data.get("total_bot_sessions", 0) == 0:
        print("  No bot_sessions.log data found")
    else:
        print(f"  Total bot sessions: {bot_data['total_bot_sessions']:,}")
        print(f"  Bot breakdown: {bot_data['bot_breakdown']}")

    print("\n## 3. Scraper Activity (from scraper logs)")
    print("-" * 50)
    scraper_data = analyze_scraper_logs()
    if not scraper_data:
        print("  No scraper logs found")
    else:
        active_scrapers = {k: v for k, v in scraper_data.items() if v["total_entries"] > 0}
        print(f"  Active scraper log files: {len(active_scrapers)}")
        for name, stats in list(active_scrapers.items())[:10]:
            print(f"    {name}: {stats['total_entries']} entries, {stats['total_items_scraped']} items scraped")

    print("\n## 4. Catalog Stats")
    print("-" * 50)
    catalog = analyze_catalog_stats()
    if catalog.get("available"):
        print("  Catalog data available")
    else:
        print("  No catalog_stats.json found")

    print("\n## 5. Existing Analytics Infrastructure")
    print("-" * 50)
    print("  ✅ RequestLoggingMiddleware: logs to logs/api_requests.log (JSONL)")
    print("  ✅ Bot detection: classify_bot() in request_logging.py")
    print("  ✅ AI model detection: _detect_ai_model() in request_logging.py")
    print("  ✅ Country detection from headers: CF-IPCountry, X-Vercel-IP-Country, etc.")
    print("  ✅ Analytics logger: logs/api_analytics.jsonl (per-request)")
    print("  ✅ Growth service: DeveloperActivation tracking in DB")
    print("  ✅ Signup tracking: growth.track_signup() + email drip scheduling")
    print("  ✅ PostHog service: app/services/analytics/post_hog.py (NEW - needs API key)")

    print("\n## 6. What's NOT Yet Measurable (needs PostHog Cloud)")
    print("-" * 50)
    print("  ❌ Page views on buywhere.ai (needs PostHog.js on frontend)")
    print("  ❌ User session funnels (needs PostHog session recording)")
    print("  ❌ Signup conversion rate (needs PostHog.js on signup page)")
    print("  ❌ UTM attribution (needs PostHog.js on marketing pages)")
    print("  ❌ API key activation rate (needs PostHog — tracking added this sprint)")
    print("  ❌ Product page engagement (needs PostHog.js on frontend)")

    print("\n## 7. Immediate Actions Needed")
    print("-" * 50)
    print("  1. Create free PostHog Cloud account at posthog.com")
    print("  2. Create new project for buywhere.ai")
    print("  3. Add to .env:")
    print("       POSTHOG_PROJECT_KEY=<your-project-api-key>")
    print("       POSTHOG_HOST=https://app.posthog.com")
    print("  4. Add PostHog.js snippet to buywhere.ai frontend (Reed's task BUY-1376)")
    print("  5. Track page_view events on marketing pages for UTM attribution")
    print("  6. Track developer_signup events on /v1/developers/signup page load")
    print("  7. Enable PostHog session recording for funnel analysis")

    print("\n" + "=" * 70)


if __name__ == "__main__":
    main()
