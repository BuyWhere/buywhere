#!/usr/bin/env python3
"""Validate and categorize discovered Shopify candidates.

Adds first-pass merchant profiling for discovery handoff:
- tranco rank-aware top-k selection,
- category/vertical guess,
- myshopify origin extraction,
- country hints,
- estimated product counts,
- junk-quality flags.
"""

from __future__ import annotations

import argparse
import asyncio
import csv
import json
import re
import time
from collections import Counter
from dataclasses import asdict
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

try:
    import aiohttp
except ImportError:
    raise SystemExit("ERROR: aiohttp is required. Install with: pip install aiohttp")

DEFAULT_CONCURRENCY = 12
DEFAULT_TIMEOUT = 18
DEFAULT_RATE_DELAY = 0.12
DEFAULT_USER_AGENT = "BuyWhere-ShopifyValidator/1.0 (+https://buywhere.ai)"
DEFAULT_OUTPUT_DIR = Path("data/shopify_candidate_validation")

SHOPIFY_HEADER_MARKERS = (
    "x-shopid",
    "x-shopify-stage",
    "x-sorting-hat-podid",
    "x-shardid",
)

SHOPIFY_BODY_MARKERS = (
    "cdn.shopify.com",
    "shopify-payment-button",
    "shopify-section",
    "myshopify.com",
    "/cdn/shop/",
    "shopify.theme",
)

HTTP_OK = {200}
HTTP_BLOCKED = {401, 402, 403, 429, 430}

COUNTRY_BY_TLD = {
    ".ca": "CA",
    ".co.uk": "GB",
    ".de": "DE",
    ".au": "AU",
    ".in": "IN",
    ".jp": "JP",
    ".sg": "SG",
    ".com.ph": "PH",
    ".ph": "PH",
    ".com.au": "AU",
    ".com.tr": "TR",
    ".br": "BR",
    ".mx": "MX",
    ".fr": "FR",
    ".es": "ES",
    ".it": "IT",
    ".ie": "IE",
    ".uk": "GB",
    ".co.za": "ZA",
}

VERTICAL_KEYWORDS = {
    "fashion": ("fashion", "apparel", "clothing", "shoes", "jewel", "beauty", "cosmetic"),
    "electronics": ("electronics", "tech", "gadget", "audio", "computer", "phone", "monitor", "headphone"),
    "home": ("home", "furniture", "kitchen", "decor", "living", "bedding"),
    "beauty": ("beauty", "skincare", "makeup", "cosmetics", "fragrance"),
    "sports": ("sport", "fitness", "gym", "workout", "outdoor", "cycling"),
    "health": ("health", "supplement", "wellness", "vitamin", "medical"),
    "automotive": ("automotive", "car", "motorcycle", "tool", "driving"),
}

JUNK_DOMAIN_HINTS = {
    "shopify.com",
    "myshopify.com",
    "shop.app",
}


@dataclass(frozen=True)
class CandidateRecord:
    domain: str
    tranco_rank: int | None = None
    platform: str | None = None
    discovery_method: str | None = None
    shopify_ip: str | None = None
    cname: str | None = None
    all_ips: list[str] | None = None


@dataclass
class ValidationResult:
    domain: str
    category: str
    tranco_rank: int | None = None
    platform: str | None = None
    discovery_method: str | None = None
    shopify_ip: str | None = None
    cname: str | None = None
    all_ips: list[str] | None = None
    products_status: int | None = None
    homepage_status: int | None = None
    is_shopify_signal: bool = False
    product_count: int = 0
    response_time_ms: float = 0.0
    signal: str | None = None
    error: str | None = None
    products_url: str | None = None
    homepage_url: str | None = None
    origin_domain: str | None = None
    vertical: str | None = None
    country_code: str | None = None
    country_reason: str | None = None
    estimated_product_count: int | None = None
    sample_vendor: str | None = None
    sample_product_type: str | None = None
    sample_handle: str | None = None
    is_junk: bool = False
    junk_reason: str | None = None
    validated_at: str = ""

    def __post_init__(self) -> None:
        if not self.validated_at:
            self.validated_at = datetime.now(timezone.utc).isoformat()


def normalize_domain(value: str) -> str | None:
    raw = (value or "").strip().lower()
    if not raw:
        return None
    if "://" in raw:
        raw = urlparse(raw).netloc or raw
    raw = raw.split("/")[0].split("?")[0].split("#")[0].split(":")[0]
    if raw.startswith("www."):
        raw = raw[4:]
    if "." not in raw or " " in raw:
        return None
    return raw


def extract_candidate_records(payload: Any) -> list[CandidateRecord]:
    if isinstance(payload, str):
        domain = normalize_domain(payload)
        return [CandidateRecord(domain=domain)] if domain else []

    if isinstance(payload, list):
        results: list[CandidateRecord] = []
        for item in payload:
            results.extend(extract_candidate_records(item))
        return results

    if not isinstance(payload, dict):
        return []

    records: list[CandidateRecord] = []
    candidate_domain = None
    for key in ("domain", "url", "website", "host", "hostname", "name"):
        candidate_domain = payload.get(key)
        if isinstance(candidate_domain, str):
            candidate_domain = normalize_domain(candidate_domain)
            if candidate_domain:
                break
    if candidate_domain:
        rank_raw = payload.get("tranco_rank")
        try:
            tranco_rank = int(rank_raw) if rank_raw is not None else None
        except (TypeError, ValueError):
            tranco_rank = None
        all_ips = payload.get("all_ips")
        if isinstance(all_ips, list):
            all_ips = [str(item) for item in all_ips if isinstance(item, str)]
        records.append(
            CandidateRecord(
                domain=candidate_domain,
                tranco_rank=tranco_rank,
                platform=str(payload.get("platform")) if payload.get("platform") is not None else None,
                discovery_method=str(payload.get("discovery_method")) if payload.get("discovery_method") is not None else None,
                shopify_ip=str(payload.get("shopify_ip")) if payload.get("shopify_ip") is not None else None,
                cname=str(payload.get("cname")) if payload.get("cname") is not None else None,
                all_ips=all_ips,
            )
        )

    for key in ("domains", "stores", "merchants", "results", "items", "data"):
        nested = payload.get(key)
        if nested is not None:
            records.extend(extract_candidate_records(nested))
    return records


def load_candidates(path: Path) -> list[CandidateRecord]:
    suffix = path.suffix.lower()
    dedupe: dict[str, CandidateRecord] = {}
    with path.open("r", encoding="utf-8", errors="replace") as handle:
        if suffix in {".jsonl", ".ndjson"}:
            for line in handle:
                line = line.strip()
                if not line:
                    continue
                try:
                    payload = json.loads(line)
                except json.JSONDecodeError:
                    records = extract_candidate_records(line)
                else:
                    records = extract_candidate_records(payload)
                for record in records:
                    if record.domain not in dedupe:
                        dedupe[record.domain] = record
        elif suffix == ".json":
            payload = json.load(handle)
            for record in extract_candidate_records(payload):
                if record.domain not in dedupe:
                    dedupe[record.domain] = record
        else:
            for line in handle:
                candidate_domain = normalize_domain(line)
                if candidate_domain and candidate_domain not in dedupe:
                    dedupe[candidate_domain] = CandidateRecord(domain=candidate_domain)
    return list(dedupe.values())


def looks_like_shopify_headers(headers: aiohttp.typedefs.LooseHeaders) -> str | None:
    normalized = {str(key).lower(): str(value).lower() for key, value in headers.items()}
    for marker in SHOPIFY_HEADER_MARKERS:
        if marker in normalized:
            return f"header:{marker}"
    server = normalized.get("server", "")
    if "shopify" in server:
        return "header:server=shopify"
    return None


def looks_like_shopify_body(text: str) -> str | None:
    lower = text.lower()
    for marker in SHOPIFY_BODY_MARKERS:
        if marker in lower:
            return f"body:{marker}"
    return None


def classify_products_payload(payload: Any) -> tuple[bool, list[dict]]:
    if not isinstance(payload, dict):
        return False, []
    products = payload.get("products")
    if not isinstance(products, list):
        return False, []
    return True, products


def infer_country(domain: str, html: str | None) -> tuple[str, str]:
    d = domain.lower()
    for suffix, code in COUNTRY_BY_TLD.items():
        if d.endswith(suffix):
            return code, f"tld:{suffix}"
    if html:
        m = re.search(r'"addressCountry"\\s*:\\s*"([A-Z]{2})"', html)
        if m:
            return m.group(1), "html_addressCountry"
    if d.endswith(".us") or d.endswith(".com"):
        return "US", "heuristic_us"
    return "US", "default_us"


def infer_vertical(domain: str, html: str | None, first_product: dict[str, Any] | None) -> str:
    text = domain.lower()
    if html:
        text = f"{text} {html[:2000].lower()}"
    for category, words in VERTICAL_KEYWORDS.items():
        for word in words:
            if word in text:
                return category
    if first_product:
        for key in ("product_type", "tags", "vendor"):
            value = first_product.get(key)
            if isinstance(value, str):
                lower = value.lower()
                for category, words in VERTICAL_KEYWORDS.items():
                    if any(word in lower for word in words):
                        return category
    return "uncategorized"


def extract_shopify_origin(domain: str, headers: dict[str, str], products_text: str | None, home_text: str | None, final_url: str | None) -> str | None:
    candidates: list[str] = []
    if final_url and "myshopify.com" in final_url.lower():
        candidates.append(final_url.split("/")[2])
    for value in headers.values():
        if not isinstance(value, str):
            continue
        for hit in re.findall(r"([a-z0-9-]+\\.myshopify\\.com)", value.lower()):
            if hit:
                candidates.append(hit)
    for source in (products_text, home_text):
        if not source:
            continue
        for hit in re.findall(r"https?://([a-z0-9-]+\\.myshopify\\.com)", source.lower()):
            if hit:
                candidates.append(hit)
        for hit in re.findall(r"([a-z0-9-]+\\.myshopify\\.com)", source.lower()):
            if hit:
                candidates.append(hit)
    for candidate in candidates:
        if candidate.startswith("www."):
            candidate = candidate[4:]
        if candidate and candidate.endswith(".myshopify.com"):
            if candidate != domain:
                return candidate
    return None


def classify_junk(result: ValidationResult) -> tuple[bool, str | None]:
    if result.domain in JUNK_DOMAIN_HINTS:
        return True, "platform_infrastructure_domain"
    if result.category == "not_shopify" and result.tranco_rank is not None and result.tranco_rank > 20000:
        return True, "low_rank_non_shopify"
    if result.category in {"blocked_unknown", "shopify_blocked"} and (result.products_status in HTTP_BLOCKED):
        return True, "shopify_frontend_blocked"
    if result.is_shopify_signal is False and result.vertical == "uncategorized" and result.products_status == 200:
        return True, "non_shopify_payload"
    return False, None


class ShopifyCandidateValidator:
    def __init__(self, concurrency: int, timeout: int, rate_delay: float, user_agent: str, assume_shopify_candidates: bool) -> None:
        self.semaphore = asyncio.Semaphore(concurrency)
        self.timeout = timeout
        self.rate_delay = rate_delay
        self.user_agent = user_agent
        self.assume_shopify_candidates = assume_shopify_candidates
        self._session: aiohttp.ClientSession | None = None

    async def __aenter__(self) -> "ShopifyCandidateValidator":
        timeout = aiohttp.ClientTimeout(total=self.timeout)
        self._session = aiohttp.ClientSession(
            timeout=timeout,
            headers={"User-Agent": self.user_agent, "Accept": "application/json,text/html;q=0.9,*/*;q=0.8"},
        )
        return self

    async def __aexit__(self, exc_type, exc, tb) -> None:
        if self._session and not self._session.closed:
            await self._session.close()

    async def fetch(self, url: str, accept: str) -> tuple[int | None, dict[str, str], str | None, bytes | None, str | None]:
        assert self._session is not None
        try:
            async with self._session.get(url, allow_redirects=True, ssl=False, headers={"Accept": accept, "User-Agent": self.user_agent}) as response:
                body = await response.read()
                text = body.decode("utf-8", "ignore") if body else None
                return response.status, dict(response.headers), str(response.url), body, None
        except asyncio.TimeoutError:
            return None, {}, None, None, "timeout"
        except aiohttp.ClientError as exc:
            return None, {}, None, None, str(exc)
        except Exception as exc:  # pragma: no cover
            return None, {}, None, None, str(exc)

    async def fetch_json_count(self, domain: str) -> int | None:
        assert self._session is not None
        count_url = f"https://{domain}/products/count.json"
        try:
            async with self._session.get(count_url, headers={"Accept": "application/json", "User-Agent": self.user_agent}, allow_redirects=True, ssl=False) as response:
                if response.status != 200:
                    return None
                text = await response.text(errors="ignore")
                try:
                    payload = json.loads(text)
                except json.JSONDecodeError:
                    return None
                count = payload.get("count")
                if isinstance(count, int):
                    return count
        except Exception:
            return None
        return None

    async def validate_domain(self, candidate: CandidateRecord) -> ValidationResult:
        async with self.semaphore:
            await asyncio.sleep(self.rate_delay)
            started = time.monotonic()
            domain = candidate.domain
            products_url = f"https://{domain}/products.json?limit=1"
            result = ValidationResult(
                domain=domain,
                category="unclassified",
                tranco_rank=candidate.tranco_rank,
                platform=candidate.platform,
                discovery_method=candidate.discovery_method,
                shopify_ip=candidate.shopify_ip,
                cname=candidate.cname,
                all_ips=candidate.all_ips or [],
                products_url=products_url,
            )

            status, headers, final_url, body, text_or_error = await self.fetch(products_url, "application/json")
            result.response_time_ms = round((time.monotonic() - started) * 1000, 1)
            result.products_status = status
            if final_url:
                result.products_url = final_url
            products_text = body.decode("utf-8", "ignore") if body else None

            if status in HTTP_OK and products_text is not None:
                try:
                    payload = json.loads(products_text)
                except json.JSONDecodeError:
                    payload = None
                is_products_payload, products = classify_products_payload(payload)
                if is_products_payload:
                    result.category = "validated_public"
                    result.is_shopify_signal = True
                    result.signal = "products_json"
                    result.product_count = len(products)
                    result.estimated_product_count = await self.fetch_json_count(domain)
                    if products:
                        first = products[0]
                        if isinstance(first, dict):
                            vendor = first.get("vendor")
                            if isinstance(vendor, str):
                                result.sample_vendor = vendor
                            product_type = first.get("product_type")
                            if isinstance(product_type, str):
                                result.sample_product_type = product_type
                            handle = first.get("handle")
                            if isinstance(handle, str):
                                result.sample_handle = handle
                            result.vertical = infer_vertical(domain, None, first)
                    result.country_code, result.country_reason = infer_country(domain, products_text)
                    result.origin_domain = extract_shopify_origin(domain, headers, products_text, None, result.products_url)
                    result.is_junk, result.junk_reason = classify_junk(result)
                    return result

            header_signal = looks_like_shopify_headers(headers)
            if header_signal:
                result.is_shopify_signal = True
                result.signal = header_signal

            homepage_url = f"https://{domain}/"
            homepage_status, homepage_headers, homepage_final, _, home_text_or_error = await self.fetch(homepage_url, "text/html,application/xhtml+xml")
            result.homepage_status = homepage_status
            result.homepage_url = homepage_final or homepage_url

            if not result.signal:
                header_signal = looks_like_shopify_headers(homepage_headers)
                if header_signal:
                    result.is_shopify_signal = True
                    result.signal = header_signal

            home_text = home_text_or_error
            if homepage_status in HTTP_OK and home_text:
                body_signal = looks_like_shopify_body(home_text)
                if body_signal and not result.signal:
                    result.signal = body_signal
                    result.is_shopify_signal = True
                result.vertical = infer_vertical(domain, home_text, None)

            if status in HTTP_BLOCKED:
                result.category = "shopify_blocked" if (result.is_shopify_signal or self.assume_shopify_candidates) else "blocked_unknown"
                result.error = f"HTTP {status}"
            elif status == 404:
                result.category = "shopify_no_public_products" if (result.is_shopify_signal or self.assume_shopify_candidates) else "not_shopify"
                result.error = "HTTP 404"
            elif status is None:
                result.category = "unreachable"
                result.error = text_or_error
            elif result.is_shopify_signal or self.assume_shopify_candidates:
                result.category = "shopify_no_public_products"
                result.error = text_or_error if text_or_error == "timeout" else f"HTTP {status}"
            elif status in HTTP_OK:
                result.category = "not_shopify"
                result.error = "products.json not recognized as Shopify payload"
            else:
                result.category = "unknown_error"
                result.error = f"HTTP {status}"

            result.country_code, result.country_reason = infer_country(domain, home_text)
            result.origin_domain = extract_shopify_origin(
                domain,
                {**headers, **homepage_headers},
                products_text,
                home_text,
                result.homepage_url,
            )
            if status in HTTP_OK:
                result.estimated_product_count = await self.fetch_json_count(domain)
            result.vertical = result.vertical or infer_vertical(domain, home_text, None)
            result.is_junk, result.junk_reason = classify_junk(result)
            return result


async def run_validation(candidates: list[CandidateRecord], args: argparse.Namespace) -> list[ValidationResult]:
    async with ShopifyCandidateValidator(
        concurrency=args.concurrency,
        timeout=args.timeout,
        rate_delay=args.rate_delay,
        user_agent=args.user_agent,
        assume_shopify_candidates=args.assume_shopify_candidates,
    ) as validator:
        tasks = [validator.validate_domain(record) for record in candidates]
        return await asyncio.gather(*tasks)


def ensure_dir(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True)


def write_outputs(results: list[ValidationResult], output_dir: Path, run_label: str) -> tuple[Path, Path, Path, Path]:
    ensure_dir(output_dir)
    ndjson_path = output_dir / f"{run_label}_validated.ndjson"
    csv_path = output_dir / f"{run_label}_validated.csv"
    json_path = output_dir / f"{run_label}_validated.json"
    report_path = output_dir / f"{run_label}_report.json"

    with ndjson_path.open("w", encoding="utf-8") as handle:
        for result in results:
            handle.write(json.dumps(asdict(result), ensure_ascii=True) + "\n")

    # Keep full field list stable for downstream ingestion tooling.
    fieldnames = list(asdict(results[0]).keys()) if results else list(ValidationResult(domain="", category="").__dict__.keys())
    with csv_path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        for result in results:
            writer.writerow(asdict(result))

    category_counts = Counter(item.category for item in results)
    vertical_counts = Counter(item.vertical for item in results if item.vertical)
    country_counts = Counter(item.country_code for item in results if item.country_code)
    report = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "total_candidates": len(results),
        "category_counts": dict(category_counts),
        "vertical_counts": dict(vertical_counts),
        "country_counts": dict(country_counts),
        "us_candidates_priority": len([r for r in results if (r.country_code == "US" and r.category in {"validated_public", "shopify_blocked", "shopify_no_public_products"})]),
        "junk_count": len([r for r in results if r.is_junk]),
        "output_files": {
            "ndjson": str(ndjson_path.resolve()),
            "csv": str(csv_path.resolve()),
            "json": str(json_path.resolve()),
        },
    }

    with json_path.open("w", encoding="utf-8") as handle:
        json.dump({"results": [asdict(result) for result in results]}, handle, indent=2)

    with report_path.open("w", encoding="utf-8") as handle:
        json.dump(report, handle, indent=2)

    return ndjson_path, csv_path, json_path, report_path


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True, type=Path, help="Candidate input file")
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR, help="Output directory")
    parser.add_argument("--limit", type=int, default=0, help="Limit result count for smoke runs")
    parser.add_argument("--top-k", type=int, default=0, help="Top-K by tranco_rank (and input order fallback)")
    parser.add_argument("--sort-by-rank", action="store_true", help="Sort candidates by tranco_rank if present")
    parser.add_argument("--concurrency", type=int, default=DEFAULT_CONCURRENCY)
    parser.add_argument("--timeout", type=int, default=DEFAULT_TIMEOUT)
    parser.add_argument("--rate-delay", type=float, default=DEFAULT_RATE_DELAY)
    parser.add_argument("--user-agent", default=DEFAULT_USER_AGENT)
    parser.add_argument("--label", default="", help="Output label prefix")
    parser.add_argument(
        "--assume-shopify-candidates",
        action="store_true",
        help="Treat blocked/inaccessible as Shopify-like when source already indicates Shopify discovery.",
    )
    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()

    candidates = load_candidates(args.input)
    if args.sort_by_rank:
        candidates.sort(key=lambda item: (item.tranco_rank if item.tranco_rank is not None else 1 << 30, item.domain))
    limit = args.top_k or args.limit
    if limit and limit > 0:
        candidates = candidates[:limit]
    if not candidates:
        raise SystemExit(f"No candidates found in {args.input}")

    results = asyncio.run(run_validation(candidates, args))
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    run_label = args.label or f"shopify_candidates_{stamp}"
    _, _, _, report_path = write_outputs(results, args.output_dir, run_label)

    summary = Counter(item.category for item in results)
    print(
        json.dumps(
            {
                "total_candidates": len(results),
                "category_counts": dict(summary),
                "report": str(report_path.resolve()),
            },
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
