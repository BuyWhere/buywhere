#!/usr/bin/env python3
"""Daily competitor intelligence digest for BuyWhere.

Monitors new entrants in the AI-agent commerce / product-search API space.
Pulls from:
  1. Product Hunt (daily launches via public API)
  2. Smithery MCP registry (new server listings)
  3. GitHub trending (agent-commerce repos)

Outputs a structured digest with threat levels: critical / high / medium / monitor.

Usage:
    python scripts/competitor_intelligence.py [--dry-run] [--output PATH]

Environment:
    PH_API_TOKEN      Product Hunt API token (optional — skips PH without it)
    GITHUB_TOKEN      GitHub PAT for higher rate limits (optional)
    OUTPUT_DIR        Directory for digest JSON files (default: /tmp/competitive-intel)
"""
from __future__ import annotations

import argparse
import json
import logging
import os
import re
import sys
import urllib.request
import urllib.error
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Any

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)-8s %(message)s")
log = logging.getLogger("competitor-intel")

DEFAULT_OUTPUT_DIR = Path(os.environ.get("OUTPUT_DIR", "/tmp/competitive-intel"))

# ---------------------------------------------------------------------------
# Threat classification keywords
# ---------------------------------------------------------------------------

CRITICAL_SIGNALS = [
    "product search api", "shopping api", "price comparison api",
    "ecommerce api", "merchant catalog", "buywhere", "mcp shopping",
]
HIGH_SIGNALS = [
    "ai shopping", "agent commerce", "purchase intent", "product catalog api",
    "shopify app", "woocommerce plugin", "price tracking", "deal finder ai",
]
MEDIUM_SIGNALS = [
    "ai agent", "mcp server", "langchain tool", "llm shopping",
    "product recommendation", "affiliate api", "product scraper",
]


def _classify_threat(name: str, description: str) -> str:
    text = f"{name} {description}".lower()
    if any(kw in text for kw in CRITICAL_SIGNALS):
        return "critical"
    if any(kw in text for kw in HIGH_SIGNALS):
        return "high"
    if any(kw in text for kw in MEDIUM_SIGNALS):
        return "medium"
    return "monitor"


# ---------------------------------------------------------------------------
# Data sources
# ---------------------------------------------------------------------------

def _fetch_url(url: str, headers: dict[str, str] | None = None) -> dict | list | None:
    try:
        req = urllib.request.Request(url, headers=headers or {})
        req.add_header("User-Agent", "BuyWhere-CompIntel/1.0")
        with urllib.request.urlopen(req, timeout=10) as resp:
            return json.loads(resp.read())
    except Exception as exc:
        log.warning("Fetch failed for %s: %s", url, exc)
        return None


def fetch_product_hunt(since_hours: int = 24) -> list[dict[str, Any]]:
    token = os.environ.get("PH_API_TOKEN")
    if not token:
        log.info("PH_API_TOKEN not set — skipping Product Hunt")
        return []

    since_dt = datetime.now(timezone.utc) - timedelta(hours=since_hours)
    query = """
    {
      posts(order: NEWEST, postedAfter: "%s") {
        edges {
          node {
            id name tagline url votesCount
            topics { edges { node { name } } }
          }
        }
      }
    }
    """ % since_dt.strftime("%Y-%m-%dT%H:%M:%SZ")

    try:
        import urllib.parse
        data = json.dumps({"query": query}).encode()
        req = urllib.request.Request(
            "https://api.producthunt.com/v2/api/graphql",
            data=data,
            method="POST",
        )
        req.add_header("Authorization", f"Bearer {token}")
        req.add_header("Content-Type", "application/json")
        req.add_header("User-Agent", "BuyWhere-CompIntel/1.0")
        with urllib.request.urlopen(req, timeout=15) as resp:
            result = json.loads(resp.read())
    except Exception as exc:
        log.warning("Product Hunt API error: %s", exc)
        return []

    entries = []
    for edge in (result.get("data", {}).get("posts", {}).get("edges") or []):
        node = edge.get("node", {})
        topics = [t["node"]["name"] for t in (node.get("topics", {}).get("edges") or [])]
        name = node.get("name", "")
        desc = node.get("tagline", "")
        threat = _classify_threat(name, desc)
        if threat in ("critical", "high", "medium"):
            entries.append({
                "source": "product_hunt",
                "name": name,
                "description": desc,
                "url": node.get("url", ""),
                "votes": node.get("votesCount", 0),
                "topics": topics,
                "threat_level": threat,
            })
    return entries


def fetch_smithery_new(limit: int = 50) -> list[dict[str, Any]]:
    data = _fetch_url(f"https://smithery.ai/api/servers?limit={limit}&sort=newest")
    if not data:
        return []
    servers = data if isinstance(data, list) else data.get("servers", data.get("items", []))
    entries = []
    for s in servers[:limit]:
        name = s.get("name", s.get("qualifiedName", ""))
        desc = s.get("description", "")
        threat = _classify_threat(name, desc)
        if threat in ("critical", "high", "medium"):
            entries.append({
                "source": "smithery",
                "name": name,
                "description": desc,
                "url": f"https://smithery.ai/server/{s.get('qualifiedName', '')}",
                "threat_level": threat,
            })
    return entries


def fetch_github_trending(language: str = "python", since: str = "daily") -> list[dict[str, Any]]:
    gh_token = os.environ.get("GITHUB_TOKEN")
    headers: dict[str, str] = {}
    if gh_token:
        headers["Authorization"] = f"token {gh_token}"

    # Use GitHub search API for recently-created repos with relevant topics
    queries = [
        "mcp+ecommerce+in:name,description",
        "agent+shopping+api+in:name,description",
        "product+search+ai+in:name,description",
    ]
    entries = []
    seen: set[str] = set()
    since_dt = datetime.now(timezone.utc) - timedelta(days=7)
    pushed_after = since_dt.strftime("%Y-%m-%d")

    for q in queries:
        url = (
            f"https://api.github.com/search/repositories"
            f"?q={q}+pushed:>{pushed_after}+stars:>5&sort=updated&per_page=10"
        )
        data = _fetch_url(url, headers)
        if not data:
            continue
        for repo in (data.get("items") or []):
            full_name = repo.get("full_name", "")
            if full_name in seen:
                continue
            seen.add(full_name)
            name = repo.get("name", "")
            desc = repo.get("description", "") or ""
            threat = _classify_threat(name, desc)
            if threat in ("critical", "high", "medium"):
                entries.append({
                    "source": "github",
                    "name": full_name,
                    "description": desc,
                    "url": repo.get("html_url", ""),
                    "stars": repo.get("stargazers_count", 0),
                    "threat_level": threat,
                })
    return entries


# ---------------------------------------------------------------------------
# Report assembly
# ---------------------------------------------------------------------------

def build_digest(since_hours: int = 24) -> dict[str, Any]:
    now = datetime.now(timezone.utc)
    log.info("Fetching competitive intelligence (last %dh)…", since_hours)

    ph = fetch_product_hunt(since_hours)
    smithery = fetch_smithery_new()
    github = fetch_github_trending()

    all_entries = ph + smithery + github

    by_threat: dict[str, list[dict]] = {"critical": [], "high": [], "medium": [], "monitor": []}
    for e in all_entries:
        by_threat.setdefault(e["threat_level"], []).append(e)

    recommendations: list[str] = []
    if by_threat["critical"]:
        recommendations.append(
            f"URGENT: {len(by_threat['critical'])} critical-threat entrant(s) detected — "
            f"review immediately: {', '.join(e['name'] for e in by_threat['critical'][:3])}"
        )
    if by_threat["high"]:
        recommendations.append(
            f"Review {len(by_threat['high'])} high-threat entrant(s) this week"
        )
    if not by_threat["critical"] and not by_threat["high"]:
        recommendations.append("No critical/high threats detected in this period")

    return {
        "generated_at": now.isoformat(),
        "period_hours": since_hours,
        "total_entries": len(all_entries),
        "by_threat_level": {k: len(v) for k, v in by_threat.items()},
        "entries": {k: v for k, v in by_threat.items() if v},
        "sources": {
            "product_hunt": len(ph),
            "smithery": len(smithery),
            "github": len(github),
        },
        "recommendations": recommendations,
    }


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main() -> None:
    p = argparse.ArgumentParser(description="BuyWhere daily competitor intelligence digest")
    p.add_argument("--since-hours", type=int, default=24)
    p.add_argument("--output", type=Path, default=None)
    p.add_argument("--dry-run", action="store_true")
    args = p.parse_args()

    digest = build_digest(since_hours=args.since_hours)

    if args.dry_run:
        print(json.dumps(digest, indent=2, default=str))
        return

    out_dir = DEFAULT_OUTPUT_DIR
    out_dir.mkdir(parents=True, exist_ok=True)
    ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    out_path = args.output or (out_dir / f"digest_{ts}.json")
    out_path.write_text(json.dumps(digest, indent=2, default=str))
    log.info("Digest written to %s", out_path)

    # Print summary
    log.info(
        "Summary: %d entries — critical=%d high=%d medium=%d monitor=%d",
        digest["total_entries"],
        digest["by_threat_level"].get("critical", 0),
        digest["by_threat_level"].get("high", 0),
        digest["by_threat_level"].get("medium", 0),
        digest["by_threat_level"].get("monitor", 0),
    )
    for rec in digest["recommendations"]:
        log.info("RECOMMENDATION: %s", rec)


if __name__ == "__main__":
    main()
