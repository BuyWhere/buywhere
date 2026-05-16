#!/usr/bin/env python3
"""Gather large merchant-domain candidate lists from external discovery sources.

This script normalizes candidate domains from:
- Common Crawl CDX index queries
- BuiltWith technology lists
- Store Leads domain search

It writes JSONL output that can be fed into downstream discovery validation.
"""

from __future__ import annotations

import argparse
import json
import csv
import io
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from typing import Any, Iterable


DEFAULT_OUTPUT_DIR = Path("data/domains")
USER_AGENT = "buywhere-domain-source-gatherer/1.0"
ALL_SOURCES = ("commoncrawl", "builtwith", "storeleads", "imports", "public_pages")

PUBLIC_PAGE_SEEDS = [
    {
        "label": "builtwith_shopify_trends",
        "url": "https://trends.builtwith.com/shop/Shopify",
        "platform_hint": "shopify",
    },
    {
        "label": "builtwith_woocommerce_trends",
        "url": "https://trends.builtwith.com/shop/WooCommerce",
        "platform_hint": "woocommerce",
    },
    {
        "label": "trustpilot_shopping_fashion",
        "url": "https://www.trustpilot.com/categories/shopping_and_fashion",
        "platform_hint": "unknown",
    },
    {
        "label": "retailmenot_stores",
        "url": "https://www.retailmenot.com/view/stores",
        "platform_hint": "unknown",
    },
]

EXCLUDED_PUBLIC_DOMAINS = {
    "amazon.com",
    "bit.ly",
    "builtwith.com",
    "facebook.com",
    "instagram.com",
    "linkedin.com",
    "pinterest.com",
    "retailmenot.com",
    "storeleads.app",
    "tiktok.com",
    "trustpilot.com",
    "twitter.com",
    "x.com",
    "youtube.com",
}


COMMONCRAWL_QUERIES = [
    {
        "label": "shopify_hosted",
        "platform_hint": "shopify",
        "patterns": ["*.myshopify.com/*"],
    },
    {
        "label": "woocommerce_plugin_path",
        "platform_hint": "woocommerce",
        "patterns": [
            "*/*/wp-content/plugins/woocommerce/*",
            "*/*/wp-json/wc/*",
        ],
    },
]

BUILTWITH_TECHS = [
    {"tech": "Shopify", "platform_hint": "shopify"},
    {"tech": "WooCommerce", "platform_hint": "woocommerce"},
]

STORELEADS_FILTERS = [
    {"platform": "shopify", "platform_hint": "shopify"},
    {"platform": "woocommerce", "platform_hint": "woocommerce"},
]


@dataclass(frozen=True)
class Candidate:
    domain: str
    source: str
    platform_hint: str
    source_detail: str
    evidence: str


class LinkExtractor(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.links: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag != "a":
            return
        for key, value in attrs:
            if key == "href" and value:
                self.links.append(value)


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def normalize_domain(value: str) -> str | None:
    raw = (value or "").strip().lower()
    if not raw:
        return None

    if "://" in raw:
        raw = urllib.parse.urlparse(raw).netloc or raw

    raw = raw.split("/")[0].split("?")[0].split("#")[0]
    raw = raw.split(":")[0]
    raw = raw.lstrip(".")
    if raw.startswith("www."):
        raw = raw[4:]
    if "." not in raw or " " in raw:
        return None
    return raw


def extract_domain(payload: Any) -> str | None:
    if isinstance(payload, str):
        return normalize_domain(payload)

    if not isinstance(payload, dict):
        return None

    for key in (
        "domain",
        "name",
        "host",
        "hostname",
        "website",
        "url",
        "Domain",
        "Name",
    ):
        value = payload.get(key)
        domain = normalize_domain(value) if isinstance(value, str) else None
        if domain:
            return domain

    return None


def ensure_dir(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True)


def http_json(
    url: str,
    *,
    method: str = "GET",
    headers: dict[str, str] | None = None,
    body: dict[str, Any] | None = None,
    timeout: int = 60,
) -> Any:
    encoded = None
    request_headers = {"User-Agent": USER_AGENT}
    if headers:
        request_headers.update(headers)
    if body is not None:
        encoded = json.dumps(body).encode("utf-8")
        request_headers.setdefault("Content-Type", "application/json")
    req = urllib.request.Request(url, data=encoded, headers=request_headers, method=method)
    with urllib.request.urlopen(req, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def http_lines(
    url: str,
    *,
    headers: dict[str, str] | None = None,
    timeout: int = 60,
) -> list[str]:
    request_headers = {"User-Agent": USER_AGENT}
    if headers:
        request_headers.update(headers)
    req = urllib.request.Request(url, headers=request_headers, method="GET")
    with urllib.request.urlopen(req, timeout=timeout) as response:
        text = response.read().decode("utf-8")
    return [line for line in text.splitlines() if line.strip()]


def parse_cdx_lines(lines: Iterable[str]) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    for line in lines:
        try:
            records.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    return records


def is_excluded_public_domain(domain: str) -> bool:
    return any(
        domain == excluded or domain.endswith(f".{excluded}")
        for excluded in EXCLUDED_PUBLIC_DOMAINS
    )


def extract_links_from_html(html_text: str) -> list[str]:
    parser = LinkExtractor()
    parser.feed(html_text)
    return parser.links


def parse_offline_records(lines: Iterable[str]) -> list[str]:
    domains: list[str] = []
    for raw in lines:
        domain = normalize_domain(raw)
        if domain:
            domains.append(domain)
    return domains


def parse_offline_file(path: Path) -> list[str]:
    if not path.exists():
        return []

    with path.open("r", encoding="utf-8", errors="replace") as handle:
        content = handle.read()
    suffix = path.suffix.lower()

    if suffix == ".jsonl":
        lines = content.splitlines()
        domains: list[str] = []
        for line in lines:
            line = line.strip()
            if not line:
                continue
            try:
                payload = json.loads(line)
                domain = extract_domain(payload)
                if domain:
                    domains.append(domain)
            except json.JSONDecodeError:
                domains.extend(parse_offline_records([line]))
        return domains

    if suffix == ".csv":
        domains: list[str] = []
        reader = csv.DictReader(io.StringIO(content))
        if reader.fieldnames:
            for row in reader:
                for key in (
                    "domain",
                    "name",
                    "host",
                    "hostname",
                    "website",
                    "url",
                ):
                    value = row.get(key)
                    if value:
                        domain = normalize_domain(value)
                        if domain:
                            domains.append(domain)
                            break
            return domains

        # Fallback to first column for headerless CSV-like payload.
        for row in csv.reader(io.StringIO(content)):
            if not row:
                continue
            domain = normalize_domain(row[0])
            if domain:
                domains.append(domain)
        return domains

    if suffix in {".html", ".htm"}:
        domains: list[str] = []
        for href in extract_links_from_html(content):
            if href.startswith("/"):
                continue
            domain = normalize_domain(href)
            if domain and not is_excluded_public_domain(domain):
                domains.append(domain)
        return domains

    if suffix in {".json", ".js"}:
        try:
            payload = json.loads(content)
        except json.JSONDecodeError:
            return parse_offline_records(content.splitlines())
        items = payload.get("domains") if isinstance(payload, dict) else payload
        if isinstance(items, list):
            return [
                domain
                for item in items
                if (domain := extract_domain(item))
            ]
        domain = extract_domain(payload)
        return [domain] if domain else []

    # default text file (one domain per line)
    return parse_offline_records(content.splitlines())


def gather_imports(args: argparse.Namespace) -> tuple[list[Candidate], dict[str, Any]]:
    details: dict[str, Any] = {
        "enabled": True,
        "files": args.import_paths,
        "errors": [],
    }

    paths = [Path(p.strip()) for p in args.import_paths.split(",") if p.strip()]
    if not paths:
        details["enabled"] = False
        details["reason"] = "no_import_paths"
        return [], details

    if args.dry_run:
        details["dry_run"] = True
        details["candidate_count"] = 0
        return [], details

    candidates: list[Candidate] = []
    for path in paths:
        domains = parse_offline_file(path)
        for domain in domains:
            candidates.append(
                Candidate(
                    domain=domain,
                    source="imports",
                    platform_hint=args.import_platform,
                    source_detail=str(path),
                    evidence=path.name,
                )
            )
    return candidates, details


def gather_public_pages(args: argparse.Namespace) -> tuple[list[Candidate], dict[str, Any]]:
    details: dict[str, Any] = {
        "enabled": True,
        "seed_count": len(PUBLIC_PAGE_SEEDS),
        "errors": [],
    }

    if args.dry_run:
        details["dry_run"] = True
        return [], details

    candidates: list[Candidate] = []
    for seed in PUBLIC_PAGE_SEEDS:
        try:
            req = urllib.request.Request(
                seed["url"],
                headers={"User-Agent": USER_AGENT},
                method="GET",
            )
            with urllib.request.urlopen(req, timeout=30) as response:
                html_text = response.read().decode("utf-8", errors="replace")
        except Exception as exc:  # pragma: no cover - network-dependent
            details["errors"].append(f"{seed['label']}: {exc}")
            continue

        seed_count = 0
        for href in extract_links_from_html(html_text):
            if href.startswith("/"):
                href = urllib.parse.urljoin(seed["url"], href)
            domain = normalize_domain(href)
            if not domain or is_excluded_public_domain(domain):
                continue
            candidates.append(
                Candidate(
                    domain=domain,
                    source="public_pages",
                    platform_hint=seed["platform_hint"],
                    source_detail=seed["label"],
                    evidence=seed["url"],
                )
            )
            seed_count += 1
        details[seed["label"]] = {"candidate_count": seed_count, "url": seed["url"]}

    return candidates, details


def gather_commoncrawl(args: argparse.Namespace) -> tuple[list[Candidate], dict[str, Any]]:
    details: dict[str, Any] = {
        "enabled": True,
        "collections_considered": args.commoncrawl_collections,
        "query_count": len(COMMONCRAWL_QUERIES),
        "records_seen": 0,
        "errors": [],
    }

    if args.dry_run:
        details["dry_run"] = True
        return [], details

    try:
        collections = http_json("https://index.commoncrawl.org/collinfo.json")
    except Exception as exc:  # pragma: no cover - network-dependent
        details["errors"].append(f"collection_fetch_failed: {exc}")
        return [], details

    collection_ids = [
        item["id"]
        for item in collections
        if isinstance(item, dict) and isinstance(item.get("id"), str)
    ][-args.commoncrawl_collections :]

    details["collections"] = collection_ids
    candidates: list[Candidate] = []

    for collection_id in collection_ids:
        for query in COMMONCRAWL_QUERIES:
            for pattern in query["patterns"]:
                for page in range(args.commoncrawl_pages):
                    params = urllib.parse.urlencode({"url": pattern, "output": "json", "page": page})
                    url = f"https://index.commoncrawl.org/{collection_id}-index?{params}"
                    try:
                        lines = http_lines(url)
                    except urllib.error.HTTPError as exc:  # pragma: no cover - network-dependent
                        if exc.code in (404, 429, 503):
                            details["errors"].append(
                                f"{collection_id}:{query['label']}:page{page}:{exc.code}"
                            )
                            break
                        raise
                    except Exception as exc:  # pragma: no cover - network-dependent
                        details["errors"].append(
                            f"{collection_id}:{query['label']}:page{page}:{exc}"
                        )
                        break

                    records = parse_cdx_lines(lines)
                    if not records:
                        break

                    details["records_seen"] += len(records)
                    for record in records:
                        domain = extract_domain(record.get("url"))
                        if not domain:
                            continue
                        candidates.append(
                            Candidate(
                                domain=domain,
                                source="commoncrawl",
                                platform_hint=query["platform_hint"],
                                source_detail=f"{collection_id}:{query['label']}",
                                evidence=record.get("url", ""),
                            )
                        )
                    time.sleep(args.commoncrawl_sleep_seconds)

    return candidates, details


def gather_builtwith(args: argparse.Namespace) -> tuple[list[Candidate], dict[str, Any]]:
    details: dict[str, Any] = {
        "enabled": True,
        "techs": [item["tech"] for item in BUILTWITH_TECHS],
        "errors": [],
    }
    api_key = os.getenv("BUILTWITH_API_KEY")
    if not api_key:
        details["enabled"] = False
        details["reason"] = "missing BUILTWITH_API_KEY"
        return [], details

    if args.dry_run:
        details["dry_run"] = True
        return [], details

    candidates: list[Candidate] = []
    for tech in BUILTWITH_TECHS:
        params = urllib.parse.urlencode(
            {
                "KEY": api_key,
                "TECH": tech["tech"],
                "FORMAT": "JSON",
            }
        )
        url = f"https://api.builtwith.com/lists12/api.json?{params}"
        try:
            payload = http_json(url)
        except Exception as exc:  # pragma: no cover - network-dependent
            details["errors"].append(f"{tech['tech']}: {exc}")
            continue

        results = []
        for key in ("Results", "results", "domains", "Domains"):
            value = payload.get(key) if isinstance(payload, dict) else None
            if isinstance(value, list):
                results = value
                break

        details.setdefault("records_seen", 0)
        details["records_seen"] += len(results)

        for result in results[: args.builtwith_limit]:
            domain = extract_domain(result)
            if not domain:
                continue
            candidates.append(
                Candidate(
                    domain=domain,
                    source="builtwith",
                    platform_hint=tech["platform_hint"],
                    source_detail=tech["tech"],
                    evidence=tech["tech"],
                )
            )

    return candidates, details


def gather_storeleads(args: argparse.Namespace) -> tuple[list[Candidate], dict[str, Any]]:
    details: dict[str, Any] = {
        "enabled": True,
        "platforms": [item["platform"] for item in STORELEADS_FILTERS],
        "errors": [],
    }
    api_key = os.getenv("STORELEADS_API_KEY")
    if not api_key:
        details["enabled"] = False
        details["reason"] = "missing STORELEADS_API_KEY"
        return [], details

    if args.dry_run:
        details["dry_run"] = True
        return [], details

    candidates: list[Candidate] = []
    headers = {"Authorization": f"Bearer {api_key}"}

    for platform in STORELEADS_FILTERS:
        cursor: str | None = None
        pages = 0
        while pages < args.storeleads_pages:
            body: dict[str, Any] = {
                "page_size": args.storeleads_page_size,
                "f:p": platform["platform"],
            }
            if args.storeleads_country:
                body["f:cc"] = args.storeleads_country
            if cursor:
                body["cursor"] = cursor
            try:
                payload = http_json(
                    "https://storeleads.app/json/api/v1/all/domain",
                    method="POST",
                    headers=headers,
                    body=body,
                )
            except Exception as exc:  # pragma: no cover - network-dependent
                details["errors"].append(f"{platform['platform']}: {exc}")
                break

            records = []
            if isinstance(payload, dict):
                for key in ("domains", "results", "Domains"):
                    value = payload.get(key)
                    if isinstance(value, list):
                        records = value
                        break
            details.setdefault("records_seen", 0)
            details["records_seen"] += len(records)

            for record in records:
                domain = extract_domain(record)
                if not domain:
                    continue
                candidates.append(
                    Candidate(
                        domain=domain,
                        source="storeleads",
                        platform_hint=platform["platform_hint"],
                        source_detail=platform["platform"],
                        evidence=platform["platform"],
                    )
                )

            cursor = payload.get("next_cursor") if isinstance(payload, dict) else None
            pages += 1
            if not cursor:
                break

    return candidates, details


def dedupe_candidates(candidates: Iterable[Candidate]) -> list[Candidate]:
    deduped: dict[str, Candidate] = {}
    for candidate in candidates:
        if candidate.domain not in deduped:
            deduped[candidate.domain] = candidate
    return sorted(deduped.values(), key=lambda item: item.domain)


def write_output(
    output_dir: Path,
    manifest: dict[str, Any],
    candidates: list[Candidate],
) -> tuple[Path, Path]:
    ensure_dir(output_dir)
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    jsonl_path = output_dir / f"combined_candidates_{timestamp}.jsonl"
    latest_path = output_dir / "combined_candidates_latest.jsonl"
    manifest_path = output_dir / "source_manifest.json"

    with jsonl_path.open("w", encoding="utf-8") as handle:
        for candidate in candidates:
            handle.write(json.dumps(asdict(candidate), sort_keys=True) + "\n")

    latest_path.write_text(jsonl_path.read_text(encoding="utf-8"), encoding="utf-8")
    manifest_path.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return latest_path, manifest_path


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", default=str(DEFAULT_OUTPUT_DIR))
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument(
        "--sources",
        default=",".join(ALL_SOURCES),
        help="Comma-separated subset of sources: commoncrawl,builtwith,storeleads",
    )
    parser.add_argument(
        "--import-paths",
        default="",
        help="Comma-separated file paths for offline candidate imports (TXT/JSON/JSONL/CSV)",
    )
    parser.add_argument(
        "--import-platform",
        default="unknown",
        help="platform_hint for import source (shopify|woocommerce|unknown)",
    )
    parser.add_argument(
        "--public-page-regex",
        default="",
        help="Optional regex to keep only matching extracted public-page domains",
    )
    parser.add_argument("--commoncrawl-collections", type=int, default=2)
    parser.add_argument("--commoncrawl-pages", type=int, default=3)
    parser.add_argument("--commoncrawl-sleep-seconds", type=float, default=1.0)
    parser.add_argument("--builtwith-limit", type=int, default=25000)
    parser.add_argument("--storeleads-pages", type=int, default=5)
    parser.add_argument("--storeleads-page-size", type=int, default=1000)
    parser.add_argument("--storeleads-country", default="US")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    output_dir = Path(args.output_dir)
    requested_sources = {
        source.strip().lower() for source in args.sources.split(",") if source.strip()
    }
    unknown_sources = sorted(requested_sources.difference(ALL_SOURCES))
    if unknown_sources:
        print(
            json.dumps(
                {"error": "unknown_sources", "sources": unknown_sources, "valid": list(ALL_SOURCES)}
            ),
            file=sys.stderr,
        )
        return 1

    source_results = {}
    combined: list[Candidate] = []

    for source_name, gatherer in (
        ("commoncrawl", gather_commoncrawl),
        ("builtwith", gather_builtwith),
        ("storeleads", gather_storeleads),
        ("imports", gather_imports),
        ("public_pages", gather_public_pages),
    ):
        if source_name not in requested_sources:
            source_results[source_name] = {
                "enabled": False,
                "reason": "skipped_by_cli",
                "candidate_count": 0,
            }
            continue
        source_candidates, source_manifest = gatherer(args)
        source_results[source_name] = {
            **source_manifest,
            "candidate_count": len(source_candidates),
        }
        if source_name == "public_pages" and args.public_page_regex:
            pattern = re.compile(args.public_page_regex)
            source_candidates = [
                candidate for candidate in source_candidates if pattern.search(candidate.domain)
            ]
            source_results[source_name]["candidate_count"] = len(source_candidates)
            source_results[source_name]["domain_filter"] = args.public_page_regex
        combined.extend(source_candidates)

    deduped = dedupe_candidates(combined)
    manifest = {
        "generated_at": utc_now(),
        "dry_run": args.dry_run,
        "candidate_count": len(combined),
        "unique_domain_count": len(deduped),
        "sources": source_results,
    }

    latest_path, manifest_path = write_output(output_dir, manifest, deduped)
    print(json.dumps({"manifest": str(manifest_path), "candidates": str(latest_path), **manifest}, indent=2))

    if not deduped and not args.dry_run:
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
