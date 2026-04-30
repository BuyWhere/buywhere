"""
Zalora SG sitemap crawler.

This is the catalog-scale path for BUY-1521:
- fetch product sitemap shards directly
- resume from the current daily NDJSON baseline
- only attempt proxy fetches after direct product-page failures
- emit shard-level coverage stats for the next scaling pass
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import os
import re
import shutil
import time
import xml.etree.ElementTree as ET
from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import datetime, timezone
from itertools import zip_longest
from pathlib import Path
from typing import Any, Optional
from urllib.parse import quote

import aiohttp

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
logger = logging.getLogger("zalora_sitemap")

DATA_DIR = Path("/home/paperclip/buywhere-api/data")
REPORT_DIR = DATA_DIR / "reports"
BASE_URL = "https://www.zalora.sg"
PRODUCT_BASE = f"{BASE_URL}/product/"
CANONICAL_BASE = f"{BASE_URL}/p/"

SITEMAP_URLS = [
    "https://www.zalora.sg/product-sitemap-1.xml",
    "https://www.zalora.sg/product-sitemap-2.xml",
    "https://www.zalora.sg/product-sitemap-3.xml",
    "https://www.zalora.sg/product-sitemap-4.xml",
]

NS = {
    "sm": "http://www.sitemaps.org/schemas/sitemap/0.9",
    "image": "http://www.google.com/schemas/sitemap-image/1.1",
}

DEFAULT_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-SG,en;q=0.9",
    "Referer": f"{BASE_URL}/",
}

_CATEGORY_SIGNALS: list[tuple[list[str], str]] = [
    (["heel_height", "toe_type", "shoe_width", "sole_material", "upper_material"], "Shoes"),
    (["bag_type", "bag_closure", "strap_length", "lining_material"], "Bags & Wallets"),
    (["neckline", "sleeve_length", "waist_size", "clothing_length", "fit_type"], "Clothing"),
    (["lens_material", "frame_shape", "frame_material"], "Sunglasses & Eyewear"),
    (["band_material", "case_diameter", "movement_type"], "Watches"),
    (["chain_length", "gemstone", "metal_type"], "Jewellery"),
    (["fragrance_concentration", "skin_type", "spf"], "Beauty"),
    (["sport_type", "sport"], "Sports & Outdoors"),
    (["cup_size", "bra_type"], "Lingerie & Swimwear"),
]


def utc_date_string() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%d")


def extract_product_id_from_slug(slug: str) -> str:
    match = re.search(r"-(\d+)$", slug)
    return match.group(1) if match else slug


def extract_product_id_from_url(url: str) -> str:
    match = re.search(r"/p/[\w-]+-(\d+)", url)
    return match.group(1) if match else url


def slug_to_name_hint(slug: str) -> str:
    parts = slug.rsplit("-", 1)
    base = parts[0] if len(parts) == 2 and parts[1].isdigit() else slug
    return base.replace("-", " ").title()


def extract_brand_from_slug(slug: str) -> str:
    return slug.split("-", 1)[0].title()


def infer_category_from_attributes(type_a1_set: set[str]) -> str:
    for signals, label in _CATEGORY_SIGNALS:
        if any(sig in type_a1_set for sig in signals):
            return label
    return "Fashion"


@dataclass(frozen=True)
class SitemapEntry:
    shard: str
    slug: str
    image_url: str

    @property
    def product_id(self) -> str:
        return extract_product_id_from_slug(self.slug)

    @property
    def url(self) -> str:
        return f"{CANONICAL_BASE}{self.slug}"


def interleave_entries_by_shard(entries: list[SitemapEntry]) -> list[SitemapEntry]:
    grouped: dict[str, list[SitemapEntry]] = defaultdict(list)
    shard_order: list[str] = []

    for entry in entries:
        if entry.shard not in grouped:
            shard_order.append(entry.shard)
        grouped[entry.shard].append(entry)

    interleaved: list[SitemapEntry] = []
    for row in zip_longest(*(grouped[shard] for shard in shard_order)):
        for entry in row:
            if entry is not None:
                interleaved.append(entry)
    return interleaved


def summarize_ndjson_file(path: Path) -> dict[str, Any]:
    summary: dict[str, Any] = {
        "path": str(path),
        "exists": path.exists(),
    }
    if not path.exists():
        return summary

    line_count = 0
    with path.open("r", encoding="utf-8", errors="ignore") as handle:
        for line in handle:
            if line.strip():
                line_count += 1

    summary["line_count"] = line_count
    summary["size_bytes"] = path.stat().st_size
    return summary


class ZaloraSitemapScraper:
    def __init__(
        self,
        rate_limit: float = 1.0,
        max_retries: int = 3,
        timeout: int = 30,
        output_dir: Optional[str] = None,
        output_file: Optional[str] = None,
        coverage_report: Optional[str] = None,
        max_products: int = 0,
        max_concurrency: int = 5,
        use_scraperapi: bool = False,
        scraperapi_key: str = "",
        resume_from: Optional[list[str]] = None,
    ):
        self.rate_limit = rate_limit
        self.max_retries = max_retries
        self.timeout = timeout
        self.max_products = max_products
        self.max_concurrency = max_concurrency
        self.use_scraperapi = use_scraperapi
        self.scraperapi_key = scraperapi_key or os.environ.get("SCRAPERAPI_KEY", "")

        self.output_dir = Path(output_dir) if output_dir else DATA_DIR
        self.output_dir.mkdir(parents=True, exist_ok=True)
        REPORT_DIR.mkdir(parents=True, exist_ok=True)

        self.output_file = Path(output_file) if output_file else self.output_dir / f"zalora_sg_{utc_date_string()}.ndjson"
        self.coverage_report = (
            Path(coverage_report)
            if coverage_report
            else REPORT_DIR / f"zalora_sg_coverage_{utc_date_string()}.json"
        )

        seen_resume_paths: set[Path] = set()
        resume_paths: list[Path] = []
        for raw_path in (resume_from or []):
            path = Path(raw_path)
            resolved = path.resolve(strict=False)
            if resolved in seen_resume_paths:
                continue
            seen_resume_paths.add(resolved)
            resume_paths.append(path)
        if self.output_file.exists():
            resolved_output = self.output_file.resolve(strict=False)
            if resolved_output not in seen_resume_paths:
                resume_paths.append(self.output_file)
        self.resume_paths = resume_paths

        self._session: Optional[aiohttp.ClientSession] = None
        self._queue: asyncio.Queue[SitemapEntry | None] = asyncio.Queue()
        self._semaphore = asyncio.Semaphore(max_concurrency)
        self._write_lock = asyncio.Lock()

        self.existing_product_ids: set[str] = set()
        self.written_product_ids: set[str] = set()

        self.total_scraped = 0
        self.total_failed = 0
        self.status_counts: Counter[str] = Counter()
        self.shard_stats: dict[str, Counter[str]] = defaultdict(Counter)
        self.shard_categories: dict[str, Counter[str]] = defaultdict(Counter)
        self.shard_failure_samples: dict[str, dict[str, list[str]]] = defaultdict(lambda: defaultdict(list))

    async def _ensure_session(self) -> None:
        if self._session is None or self._session.closed:
            timeout = aiohttp.ClientTimeout(total=self.timeout)
            self._session = aiohttp.ClientSession(timeout=timeout, headers=DEFAULT_HEADERS)

    async def close(self) -> None:
        if self._session and not self._session.closed:
            await self._session.close()
            self._session = None

    def load_existing_product_ids(self) -> int:
        before = len(self.existing_product_ids)
        for path in self.resume_paths:
            if not path.exists():
                continue
            logger.info("Loading existing Zalora baseline from %s", path)
            with path.open("r", encoding="utf-8", errors="ignore") as handle:
                for line in handle:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        record = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    product_id = (
                        record.get("product_id")
                        or record.get("sku")
                        or record.get("metadata", {}).get("product_id")
                    )
                    if not product_id:
                        continue
                    if product_id.startswith("zalora_sg_"):
                        product_id = product_id.removeprefix("zalora_sg_")
                    self.existing_product_ids.add(str(product_id))
        return len(self.existing_product_ids) - before

    def seed_output_from_resume_source(self) -> Optional[Path]:
        if self.output_file.exists():
            return None

        for path in self.resume_paths:
            if not path.exists():
                continue
            if path.resolve(strict=False) == self.output_file.resolve(strict=False):
                continue
            self.output_file.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(path, self.output_file)
            logger.info("Seeded canonical Zalora output %s from resume source %s", self.output_file, path)
            return path
        return None

    async def _fetch_text(
        self,
        url: str,
        *,
        allow_proxy_fallback: bool,
    ) -> tuple[Optional[str], int, str]:
        await self._ensure_session()
        if self._session is None:
            return None, 0, "session_unavailable"

        direct_result = await self._fetch_direct(url)
        if direct_result[0] is not None or not allow_proxy_fallback:
            return direct_result

        _content, status, _mode = direct_result
        if status == 403 and self.use_scraperapi and self.scraperapi_key:
            proxy_result = await self._fetch_via_scraperapi(url)
            if proxy_result[0] is not None:
                return proxy_result
        return direct_result

    async def _fetch_direct(self, url: str) -> tuple[Optional[str], int, str]:
        assert self._session is not None
        for attempt in range(self.max_retries):
            try:
                async with self._session.get(url) as response:
                    text = await response.text()
                    if response.status == 200:
                        return text, response.status, "direct"
                    if response.status == 429 and attempt < self.max_retries - 1:
                        await asyncio.sleep((2 ** attempt) * 5)
                        continue
                    return None, response.status, "direct"
            except Exception as exc:
                logger.warning("Direct fetch error for %s: %s", url, exc)
                if attempt < self.max_retries - 1:
                    await asyncio.sleep(2 ** attempt)
        return None, 0, "direct"

    async def _fetch_via_scraperapi(self, url: str) -> tuple[Optional[str], int, str]:
        assert self._session is not None
        encoded_url = quote(url, safe="")
        proxy_url = (
            f"http://api.scraperapi.com?api_key={self.scraperapi_key}"
            f"&url={encoded_url}&render=true"
        )
        for attempt in range(self.max_retries):
            try:
                async with self._session.get(
                    proxy_url,
                    timeout=aiohttp.ClientTimeout(total=max(self.timeout, 60)),
                ) as response:
                    text = await response.text()
                    if response.status == 200:
                        return text, response.status, "scraperapi"
                    if response.status == 429 and attempt < self.max_retries - 1:
                        await asyncio.sleep((2 ** attempt) * 5)
                        continue
                    return None, response.status, "scraperapi"
            except Exception as exc:
                logger.warning("ScraperAPI fetch error for %s: %s", url, exc)
                if attempt < self.max_retries - 1:
                    await asyncio.sleep(2 ** attempt)
        return None, 0, "scraperapi"

    async def fetch_sitemap_entries(self) -> list[SitemapEntry]:
        entries: list[SitemapEntry] = []
        seen_ids: set[str] = set()

        for sitemap_url in SITEMAP_URLS:
            shard = Path(sitemap_url).name
            logger.info("Fetching sitemap shard %s", shard)
            content, status, _mode = await self._fetch_text(
                sitemap_url,
                allow_proxy_fallback=False,
            )
            if content is None:
                logger.warning("Failed to fetch sitemap shard %s (status=%s)", shard, status)
                self.shard_stats[shard]["sitemap_fetch_failed"] += 1
                continue

            try:
                root = ET.fromstring(content)
            except ET.ParseError as exc:
                logger.warning("Failed to parse sitemap shard %s: %s", shard, exc)
                self.shard_stats[shard]["sitemap_parse_failed"] += 1
                continue

            for url_el in root.findall("sm:url", NS):
                loc_el = url_el.find("sm:loc", NS)
                image_el = url_el.find("image:image/image:loc", NS)
                if loc_el is None or not loc_el.text:
                    continue
                match = re.search(r"/p/(.+)$", loc_el.text.strip())
                if not match:
                    continue
                slug = match.group(1)
                product_id = extract_product_id_from_slug(slug)
                self.shard_stats[shard]["discovered"] += 1
                if product_id in seen_ids:
                    self.shard_stats[shard]["duplicate_product_id"] += 1
                    continue
                seen_ids.add(product_id)
                entries.append(
                    SitemapEntry(
                        shard=shard,
                        slug=slug,
                        image_url=image_el.text.strip() if image_el is not None and image_el.text else "",
                    )
                )

        return entries

    def _parse_product_page(self, html: str, entry: SitemapEntry) -> Optional[dict[str, Any]]:
        match = re.search(
            r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>',
            html,
            re.DOTALL,
        )
        if not match:
            return None

        try:
            data = json.loads(match.group(1))
        except json.JSONDecodeError:
            return None

        product_raw = (
            data.get("props", {})
            .get("pageProps", {})
            .get("preloadedState", {})
            .get("pdv", {})
            .get("product", {})
        )
        if not product_raw:
            return None

        product_id = extract_product_id_from_slug(entry.slug)
        name = str(product_raw.get("Name", "")).strip() or slug_to_name_hint(entry.slug)

        price_str = str(product_raw.get("Price", "0") or "0")
        for simple in product_raw.get("Simples", []):
            simple_price = simple.get("Price")
            if simple_price is None:
                continue
            try:
                if float(simple_price) > 0:
                    price_str = str(simple_price)
                    break
            except (TypeError, ValueError):
                continue

        try:
            price_amount = float(price_str)
        except ValueError:
            price_amount = 0.0

        if price_amount <= 0:
            return None

        attr_keys = {
            str(key).lower().replace(" ", "_")
            for key in (product_raw.get("Attributes") or {})
        }
        category = infer_category_from_attributes(attr_keys)

        seller_names = {
            simple.get("FulfillmentInformation", {}).get("SellerName")
            for simple in product_raw.get("Simples", [])
            if simple.get("FulfillmentInformation", {}).get("SellerName")
        }
        merchant_name = seller_names.pop() if len(seller_names) == 1 else "ZALORA"

        in_stock = any(
            simple.get("StockStatus") == 1
            for simple in product_raw.get("Simples", [])
        )

        canonical_url = product_raw.get("Url") or entry.url
        brand = str(product_raw.get("Brand", "")).strip() or extract_brand_from_slug(entry.slug)

        return {
            "product_id": f"zalora_sg_{product_id}",
            "name": name,
            "price": {
                "amount": price_amount,
                "currency": "SGD",
            },
            "url": canonical_url,
            "image_url": entry.image_url,
            "category": category,
            "category_slug": category.lower().replace(" & ", "_").replace(" ", "_"),
            "platform": "zalora_sg",
            "merchant_name": merchant_name,
            "merchant_id": "zalora",
            "brand": brand,
            "in_stock": in_stock,
            "scraped_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        }

    async def _write_product(self, product: dict[str, Any]) -> None:
        async with self._write_lock:
            with self.output_file.open("a", encoding="utf-8") as handle:
                handle.write(json.dumps(product, ensure_ascii=False) + "\n")

    def _record_failure_sample(self, entry: SitemapEntry, key: str, url: str, limit: int = 5) -> None:
        samples = self.shard_failure_samples[entry.shard][key]
        if url not in samples and len(samples) < limit:
            samples.append(url)

    def _record_failure(self, entry: SitemapEntry, status: int, mode: str) -> None:
        shard_counter = self.shard_stats[entry.shard]
        key = f"{mode}_status_{status}" if status else f"{mode}_request_failed"
        shard_counter[key] += 1
        self.status_counts[key] += 1
        self._record_failure_sample(entry, key, f"{PRODUCT_BASE}{entry.slug}")
        self.total_failed += 1

    async def _scrape_worker(self, worker_id: int) -> None:
        while True:
            entry = await self._queue.get()
            if entry is None:
                self._queue.task_done()
                break

            try:
                async with self._semaphore:
                    html, status, mode = await self._fetch_text(
                        f"{CANONICAL_BASE}{entry.slug}",
                        allow_proxy_fallback=True,
                    )

                if html is None:
                    self._record_failure(entry, status, mode)
                    continue

                product = self._parse_product_page(html, entry)
                if product is None:
                    self.shard_stats[entry.shard]["parse_failed"] += 1
                    self.status_counts["parse_failed"] += 1
                    self._record_failure_sample(entry, "parse_failed", f"{PRODUCT_BASE}{entry.slug}")
                    self.total_failed += 1
                    continue

                product_id = product["product_id"].removeprefix("zalora_sg_")
                if product_id in self.written_product_ids:
                    self.shard_stats[entry.shard]["duplicate_after_resume"] += 1
                    continue

                await self._write_product(product)
                self.written_product_ids.add(product_id)
                self.total_scraped += 1
                self.shard_stats[entry.shard]["scraped"] += 1
                self.shard_categories[entry.shard][product["category"]] += 1

                if self.total_scraped and self.total_scraped % 500 == 0:
                    logger.info(
                        "Worker %s: scraped %s priced products so far",
                        worker_id,
                        self.total_scraped,
                    )
            finally:
                await asyncio.sleep(self.rate_limit)
                self._queue.task_done()

    async def run(self) -> dict[str, Any]:
        start_time = time.time()
        await self._ensure_session()

        seeded_from = self.seed_output_from_resume_source()
        if seeded_from is not None and self.output_file not in self.resume_paths:
            self.resume_paths.append(self.output_file)

        loaded = self.load_existing_product_ids()
        logger.info("Loaded %s existing Zalora product ids from resume baseline", loaded)

        entries = interleave_entries_by_shard(await self.fetch_sitemap_entries())
        if not entries:
            await self.close()
            return {"error": "No sitemap entries found"}

        queued = 0
        for entry in entries:
            if entry.product_id in self.existing_product_ids:
                self.shard_stats[entry.shard]["skipped_existing"] += 1
                continue
            await self._queue.put(entry)
            self.shard_stats[entry.shard]["queued"] += 1
            queued += 1
            if self.max_products and queued >= self.max_products:
                break

        logger.info("Queued %s fresh Zalora URLs across %s sitemap shards", queued, len(self.shard_stats))

        worker_count = max(1, min(self.max_concurrency, 10))
        workers = [asyncio.create_task(self._scrape_worker(i + 1)) for i in range(worker_count)]

        await self._queue.join()

        for _ in workers:
            await self._queue.put(None)
        await asyncio.gather(*workers, return_exceptions=True)

        elapsed = time.time() - start_time
        summary = {
            "elapsed_seconds": round(elapsed, 1),
            "resume_baseline_count": len(self.existing_product_ids),
            "seeded_output_from": str(seeded_from) if seeded_from is not None else None,
            "resume_sources": [summarize_ndjson_file(path) for path in self.resume_paths],
            "total_scraped": self.total_scraped,
            "total_failed": self.total_failed,
            "total_output_count": len(self.existing_product_ids) + len(self.written_product_ids),
            "output_file": str(self.output_file),
            "coverage_report": str(self.coverage_report),
            "status_counts": dict(self.status_counts),
            "shards": {
                shard: {
                    **dict(counter),
                    "categories": dict(self.shard_categories.get(shard, Counter()).most_common(10)),
                    "failure_samples": self.shard_failure_samples.get(shard, {}),
                }
                for shard, counter in sorted(self.shard_stats.items())
            },
        }

        self.coverage_report.write_text(
            json.dumps(summary, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

        logger.info("Zalora sitemap scrape complete: %s", json.dumps(summary, ensure_ascii=False))
        await self.close()
        return summary


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Zalora SG sitemap crawler")
    parser.add_argument("--rate-limit", type=float, default=1.0)
    parser.add_argument("--max-retries", type=int, default=3)
    parser.add_argument("--timeout", type=int, default=30)
    parser.add_argument("--output-dir", default=None)
    parser.add_argument("--output-file", default=None)
    parser.add_argument("--coverage-report", default=None)
    parser.add_argument("--max-products", type=int, default=0)
    parser.add_argument("--max-concurrency", type=int, default=5)
    parser.add_argument("--use-scraperapi", action="store_true")
    parser.add_argument("--scraperapi-key", default="")
    parser.add_argument(
        "--resume-from",
        action="append",
        default=[],
        help="Additional NDJSON files to load for existing-product skipping",
    )
    return parser


async def main_async(args: argparse.Namespace) -> dict[str, Any]:
    scraper = ZaloraSitemapScraper(
        rate_limit=args.rate_limit,
        max_retries=args.max_retries,
        timeout=args.timeout,
        output_dir=args.output_dir,
        output_file=args.output_file,
        coverage_report=args.coverage_report,
        max_products=args.max_products,
        max_concurrency=args.max_concurrency,
        use_scraperapi=args.use_scraperapi or bool(os.environ.get("SCRAPERAPI_KEY")),
        scraperapi_key=args.scraperapi_key,
        resume_from=args.resume_from,
    )
    return await scraper.run()


def main() -> int:
    args = build_parser().parse_args()
    try:
        asyncio.run(main_async(args))
        return 0
    except KeyboardInterrupt:
        logger.info("Interrupted")
        return 130


if __name__ == "__main__":
    raise SystemExit(main())
