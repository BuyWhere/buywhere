"""
Walmart US product scraper — sitemap discovery + BrightData proxy scraping.

Strategy:
  1. Discover product URLs from Walmart's sitemap index
  2. Scrape each product page individually via BrightData residential proxy
  3. Extract structured data from JSON-LD, fall back to HTML parsing
  4. Normalise to the BuyWhere product schema and ingest

Tag: region=us, country_code=US, currency=USD
Target: 200,000+ products across core Walmart categories.

Proxy: BrightData residential (required — Walmart blocks direct/datacenter traffic).
Run without --api-key to do a scrape-only dry run.

Usage:
    python -m scrapers.walmart_us_scraper --scrape-only --limit 100
    python -m scrapers.walmart_us_scraper --api-key <key> --target 200000
"""

from __future__ import annotations

import argparse
import asyncio
import gzip
import json
import re
import time
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional
from urllib.parse import urljoin, urlparse, unquote

import httpx

from scrapers.scraper_logging import get_logger
from scrapers.proxy_config import Zone, proxy_config_for_httpx, proxy_config_for_requests

log = get_logger("walmart_us")

MERCHANT_ID = "walmart_us"
SOURCE = "walmart_us"
BASE_URL = "https://www.walmart.com"
OUTPUT_DIR = Path("/home/paperclip/buywhere-api/data/walmart_us")

SITEMAP_INDEX_URL = "https://www.walmart.com/sitemap_index.xml"
ROBOTS_TXT_URL = "https://www.walmart.com/robots.txt"

MAX_RETRIES = 3
RETRY_BACKOFF_FACTOR = 2
SITEMAP_NS = {"sm": "http://www.sitemaps.org/schemas/sitemap/0.9"}

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
    "DNT": "1",
    "Connection": "keep-alive",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
    "Sec-Fetch-User": "?1",
    "Upgrade-Insecure-Requests": "1",
}

CATEGORIES = [
    {"id": "electronics", "name": "Electronics", "sub": "TVs, Computers & Phones",
     "paths": [
         "/cp/electronics/3944",
         "/browse/electronics/tvs/3944_1060825",
         "/browse/electronics/laptop-computers/3944_3951_1089432",
     ]},
    {"id": "home", "name": "Home", "sub": "Furniture, Kitchen & Decor",
     "paths": [
         "/cp/home/4044",
         "/cp/home-improvement/1072864",
     ]},
    {"id": "appliances", "name": "Appliances", "sub": "Major & Small Appliances",
     "paths": [
         "/cp/appliances/90552",
     ]},
    {"id": "garden", "name": "Patio & Garden", "sub": "Outdoor Living & Tools",
     "paths": [
         "/cp/patio-garden/5428",
     ]},
    {"id": "toys", "name": "Toys", "sub": "Toys & Video Games",
     "paths": [
         "/cp/toys/4171",
         "/cp/video-games/2636",
     ]},
    {"id": "baby", "name": "Baby", "sub": "Baby Gear, Toys & Furniture",
     "paths": [
         "/cp/baby/5427",
     ]},
    {"id": "sports", "name": "Sports & Outdoors", "sub": "Exercise, Camping & Sports",
     "paths": [
         "/cp/sports-outdoors/4125",
     ]},
    {"id": "auto", "name": "Auto & Tires", "sub": "Car Care, Parts & Tires",
     "paths": [
         "/cp/auto-tires/91083",
     ]},
    {"id": "beauty", "name": "Beauty", "sub": "Makeup, Skincare & Hair",
     "paths": [
         "/cp/beauty/1085666",
     ]},
    {"id": "grocery", "name": "Grocery", "sub": "Food, Drinks & Household",
     "paths": [
         "/cp/food/976759",
         "/cp/household-essentials/1115193",
         "/cp/pet-supplies/5440",
     ]},
]

SEARCH_QUERIES = [
    "laptop", "tv", "iphone", "refrigerator", "sofa",
    "mattress", "treadmill", "lego", "diapers", "shampoo",
    "coffee maker", "drill", "basketball", "tent", "dog food",
]


def _write_dead_letter(url: str, reason: str, status_code: int | None, dead_letter_file: Path) -> None:
    entry = {
        "url": url,
        "reason": reason,
        "status_code": status_code,
        "merchant_id": MERCHANT_ID,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
    try:
        with open(dead_letter_file, "a", encoding="utf-8") as f:
            f.write(json.dumps(entry, ensure_ascii=False) + "\n")
    except Exception:
        pass


def _extract_jsonld(html: str) -> list[dict[str, Any]]:
    """Extract JSON-LD structured data blocks from HTML."""
    items: list[dict[str, Any]] = []
    for match in re.finditer(
        r'<script[^>]*type="application/ld\+json"[^>]*>(.*?)</script>',
        html,
        re.DOTALL,
    ):
        try:
            data = json.loads(match.group(1).strip())
            if isinstance(data, list):
                items.extend(data)
            elif isinstance(data, dict):
                items.append(data)
        except (json.JSONDecodeError, TypeError):
            continue
    return items


def _find_product_jsonld(items: list[dict[str, Any]]) -> dict[str, Any] | None:
    """Find the Product-typed JSON-LD block from a list."""
    for item in items:
        if item.get("@type") == "Product":
            return item
        graph = item.get("@graph", [])
        if isinstance(graph, list):
            for node in graph:
                if node.get("@type") == "Product":
                    return node
    return None


class WalmartUSScraper:
    MERCHANT_ID = "walmart_us"
    SOURCE = "walmart_us"

    def __init__(
        self,
        api_key: str | None = None,
        api_base: str = "http://localhost:8000",
        batch_size: int = 100,
        delay: float = 2.0,
        scrape_only: bool = False,
        data_dir: str | None = None,
        limit: int = 0,
        url_delay: float = 1.0,
        use_proxy: bool = True,
    ):
        self.api_key = api_key
        self.api_base = api_base.rstrip("/")
        self.batch_size = batch_size
        self.delay = delay
        self.url_delay = url_delay
        self.scrape_only = scrape_only
        self.limit = limit
        self.use_proxy = use_proxy
        self.output_dir = Path(data_dir) if data_dir else OUTPUT_DIR
        self.output_dir.mkdir(parents=True, exist_ok=True)

        proxy_url = (
            proxy_config_for_httpx(Zone.RESIDENTIAL_PROXY1) if use_proxy else None
        )
        self.httpx_client = httpx.AsyncClient(
            timeout=60.0,
            headers=HEADERS,
            follow_redirects=True,
            proxy=proxy_url,
            verify=not use_proxy,
        )

        self.total_urls_collected = 0
        self.total_products_scraped = 0
        self.total_ingested = 0
        self.total_updated = 0
        self.total_failed = 0
        self.seen_skus: set[str] = set()
        self.seen_urls: set[str] = set()
        self.session_start = time.strftime("%Y%m%d_%H%M%S")
        self.urls_file = self.output_dir / f"urls_{self.session_start}.txt"
        self.products_file = self.output_dir / f"products_{self.session_start}.jsonl"
        self.dead_letter_file = self.output_dir / f"dead_letters_{self.session_start}.jsonl"
        self._dead_letter_count = 0

    # ------------------------------------------------------------------ #
    #  SKU extraction
    # ------------------------------------------------------------------ #

    @staticmethod
    def _extract_sku_from_url(url: str) -> str:
        """Extract a Walmart SKU / item ID from a product URL.

        Walmart product URLs look like:
          /ip/<title>/<numeric-id>
          /ip/<numeric-id>
        """
        # Pattern: /ip/.../123456789 or /ip/123456789
        match = re.search(r"/ip(?:/[^/]+)?/(\d{5,15})(?:\?|#|$)", url)
        if match:
            return match.group(1)
        # Fallback: ?id=... or &id=... query param
        match = re.search(r"[?&]id=(\d{5,15})(?:&|#|$)", url)
        if match:
            return match.group(1)
        return ""

    # ------------------------------------------------------------------ #
    #  Sitemap discovery
    # ------------------------------------------------------------------ #

    @staticmethod
    def _decode_xml_response(content: bytes) -> bytes:
        if content.startswith(b"\x1f\x8b"):
            return gzip.decompress(content)
        return content

    async def _discover_sitemap_urls(self) -> list[str]:
        """Fetch Walmart's sitemap index and return all sub-sitemap URLs."""
        sitemap_urls: list[str] = []

        for source_url in (SITEMAP_INDEX_URL, ROBOTS_TXT_URL):
            try:
                resp = await self.httpx_client.get(source_url)
                resp.raise_for_status()
                text = resp.text

                # Parse XML
                try:
                    root = ET.fromstring(
                        self._decode_xml_response(resp.content)
                    )
                    for loc in root.findall(".//sm:sitemap/sm:loc", SITEMAP_NS):
                        if loc.text and "sitemap" in loc.text.lower():
                            sitemap_urls.append(loc.text.strip())
                    if sitemap_urls:
                        break
                except ET.ParseError:
                    pass

                # Fallback: text scan for sitemap URLs (robots.txt style)
                for line in text.splitlines():
                    line = line.strip()
                    if line.lower().startswith("sitemap:"):
                        url = line.split(":", 1)[1].strip()
                        if url.startswith("http"):
                            sitemap_urls.append(url)

            except Exception as e:
                log.network_error(source_url, f"Sitemap discovery failed: {e}")
                continue

        return list(dict.fromkeys(sitemap_urls))  # dedup, preserve order

    async def _extract_urls_from_sitemap(self, sitemap_url: str) -> list[str]:
        """Fetch a single sitemap and return product URLs (those containing /ip/)."""
        try:
            resp = await self.httpx_client.get(sitemap_url, timeout=120.0)
            resp.raise_for_status()
            # Sitemaps are blocked by Walmart; detect bot page early
            if self._is_bot_page(resp.text):
                log.request_failed(sitemap_url, 0, "Bot-detection on sitemap")
                return []
            root = ET.fromstring(self._decode_xml_response(resp.content))
        except ET.ParseError:
            # Sitemap returned HTML instead of XML (bot page)
            return []
        except Exception as e:
            log.network_error(sitemap_url, f"Sitemap fetch/parse error: {e}")
            _write_dead_letter(sitemap_url, f"Sitemap error: {e}", None, self.dead_letter_file)
            self._dead_letter_count += 1
            return []

        urls: list[str] = []
        for loc in root.findall(".//sm:url/sm:loc", SITEMAP_NS):
            if loc.text:
                url = loc.text.strip()
                if "/ip/" in url and self._extract_sku_from_url(url):
                    urls.append(url)
        return urls

    # ------------------------------------------------------------------ #
    #  Product page scraping
    # ------------------------------------------------------------------ #

    @staticmethod
    def _is_bot_page(html: str) -> bool:
        """Detect Walmart anti-bot challenge page."""
        if len(html) < 2000 and ("Robot or human?" in html or "verify you are human" in html.lower()):
            return True
        return "Robot or human?" in html[:1000]

    async def _fetch_page(self, url: str) -> str | None:
        """Fetch a URL with retry logic."""
        for attempt in range(MAX_RETRIES):
            try:
                resp = await self.httpx_client.get(url)
                if resp.status_code == 429:
                    wait = (2 ** attempt) * RETRY_BACKOFF_FACTOR
                    log.request_failed(url, attempt, f"Rate limited (429); waiting {wait}s")
                    await asyncio.sleep(wait)
                    continue
                if resp.status_code in (403, 502, 503):
                    wait = (2 ** attempt) * RETRY_BACKOFF_FACTOR
                    log.request_failed(url, attempt, f"HTTP {resp.status_code}")
                    if attempt < MAX_RETRIES - 1:
                        await asyncio.sleep(wait)
                        continue
                    else:
                        _write_dead_letter(url, f"HTTP {resp.status_code}", resp.status_code, self.dead_letter_file)
                        self._dead_letter_count += 1
                        return None
                if resp.status_code != 200:
                    log.request_failed(url, attempt, f"HTTP {resp.status_code}")
                    if attempt < MAX_RETRIES - 1:
                        await asyncio.sleep(1)
                        continue
                    return None

                # Check for bot-detection page even on HTTP 200
                text = resp.text
                if self._is_bot_page(text):
                    log.request_failed(url, attempt, "Bot-detection page received")
                    if attempt < MAX_RETRIES - 1:
                        await asyncio.sleep((2 ** attempt) * RETRY_BACKOFF_FACTOR)
                        continue
                    _write_dead_letter(url, "Bot-detection page", 200, self.dead_letter_file)
                    self._dead_letter_count += 1
                    return None

                return text
            except Exception as e:
                log.network_error(url, f"Fetch error (attempt {attempt + 1}): {e}")
                if attempt < MAX_RETRIES - 1:
                    await asyncio.sleep(2 ** attempt)
                else:
                    _write_dead_letter(url, str(e), None, self.dead_letter_file)
                    self._dead_letter_count += 1
                    return None
        return None

    def _parse_product_page(self, html: str, url: str) -> dict[str, Any] | None:
        """Parse a Walmart product page, preferring JSON-LD, falling back to regex."""
        if self._is_bot_page(html):
            return None

        sku = self._extract_sku_from_url(url)

        # --- JSON-LD extraction (most reliable) ---
        jsonld_items = _extract_jsonld(html)
        product_ld = _find_product_jsonld(jsonld_items)

        if product_ld:
            title = product_ld.get("name", "")
            description = product_ld.get("description", "") or ""

            # Price from offers
            price = 0.0
            currency = "USD"
            offers = product_ld.get("offers")
            if isinstance(offers, dict):
                price = float(offers.get("price", 0) or 0)
                currency = offers.get("priceCurrency", "USD")
            elif isinstance(offers, list) and offers:
                price = float(offers[0].get("price", 0) or 0)
                currency = offers[0].get("priceCurrency", "USD")

            image_url = ""
            images = product_ld.get("image")
            if isinstance(images, list) and images:
                image_url = str(images[0])
            elif isinstance(images, str):
                image_url = images

            brand = ""
            brand_obj = product_ld.get("brand")
            if isinstance(brand_obj, dict):
                brand = brand_obj.get("name", "")
            elif isinstance(brand_obj, str):
                brand = brand_obj

            rating = 0.0
            agg = product_ld.get("aggregateRating")
            if isinstance(agg, dict):
                rating = float(agg.get("ratingValue", 0) or 0)

            review_count = 0
            if isinstance(agg, dict):
                review_count = int(agg.get("reviewCount", 0) or 0)

            in_stock = True
            if isinstance(offers, dict):
                availability = offers.get("availability", "")
                if availability and "outofstock" in availability.lower().replace("_", "").replace(" ", ""):
                    in_stock = False

            gtin = product_ld.get("gtin13") or product_ld.get("gtin12") or product_ld.get("gtin8") or ""
            if not gtin:
                gtin = product_ld.get("sku", "")

            category = ""
            cat_obj = product_ld.get("category")
            if isinstance(cat_obj, dict):
                category = cat_obj.get("name", "")
            elif isinstance(cat_obj, str):
                category = cat_obj

            return {
                "sku": sku,
                "url": url,
                "title": title,
                "price": price,
                "original_price": price,
                "currency": currency,
                "description": str(description)[:2000],
                "image_url": image_url,
                "brand": brand,
                "rating": rating,
                "review_count": review_count,
                "in_stock": in_stock,
                "gtin": str(gtin),
                "category": category,
            }

        # --- HTML fallback extraction ---
        title = ""
        title_match = re.search(r"<title>(.*?)</title>", html, re.IGNORECASE)
        if title_match:
            title = title_match.group(1).strip()
            # Strip " - Walmart.com" suffix
            title = re.sub(r"\s*[-|]\s*Walmart\.com\s*$", "", title, flags=re.IGNORECASE)

        price_match = re.search(
            r'"price"\s*:\s*(\d+\.?\d*)', html
        )
        price = float(price_match.group(1)) if price_match else 0.0

        image_url = ""
        img_match = re.search(
            r'<img[^>]*src="(https://i5\.walmartimages\.com/[^"]+)"', html
        )
        if img_match:
            image_url = img_match.group(1)

        brand = ""
        brand_match = re.search(r'"brand"\s*:\s*"([^"]+)"', html)
        if brand_match:
            brand = brand_match.group(1)

        return {
            "sku": sku,
            "url": url,
            "title": title,
            "price": price,
            "original_price": price,
            "currency": "USD",
            "description": "",
            "image_url": image_url,
            "brand": brand,
            "rating": 0.0,
            "review_count": 0,
            "in_stock": True,
            "gtin": "",
            "category": "",
        }

    # ------------------------------------------------------------------ #
    #  Search-based URL collection
    # ------------------------------------------------------------------ #

    async def _collect_urls_from_search(self, query: str, max_pages: int = 5) -> list[str]:
        """Search Walmart and collect product URLs from results pages."""
        urls: list[str] = []
        for page in range(1, max_pages + 1):
            if self.limit > 0 and self.total_urls_collected >= self.limit:
                break
            search_url = f"{BASE_URL}/search?q={query}&page={page}"
            html = await self._fetch_page(search_url)
            if not html:
                break
            found = 0
            for match in re.finditer(r'href="(/ip/[^"]+)"', html):
                product_url = urljoin(BASE_URL, match.group(1))
                sku = self._extract_sku_from_url(product_url)
                if sku and product_url not in self.seen_urls:
                    self.seen_urls.add(product_url)
                    urls.append(product_url)
                    found += 1
                    self.total_urls_collected += 1
            if found == 0:
                break
            log.progress(f"  search '{query}' page {page}: {found} URLs")
            await asyncio.sleep(self.delay)
        return urls

    async def _collect_urls_from_category(self, category: dict[str, Any]) -> list[str]:
        urls: list[str] = []
        for path in category.get("paths", []):
            page = 1
            while page <= 50:
                if self.limit > 0 and self.total_urls_collected >= self.limit:
                    break

                cat_url = f"{BASE_URL}{path}"
                if page > 1:
                    cat_url = f"{cat_url}?page={page}"

                html = await self._fetch_page(cat_url)
                if not html:
                    break

                # Extract product links from category page
                found = 0
                for match in re.finditer(
                    r'href="(/ip/[^"]+)"',
                    html,
                ):
                    product_url = urljoin(BASE_URL, match.group(1))
                    sku = self._extract_sku_from_url(product_url)
                    if sku and product_url not in self.seen_urls:
                        self.seen_urls.add(product_url)
                        urls.append(product_url)
                        found += 1

                if found == 0:
                    break

                log.progress(
                    f"  [{category['sub']}] {path} page {page}: {found} URLs"
                )
                await asyncio.sleep(self.delay)
                page += 1

        return urls

    # ------------------------------------------------------------------ #
    #  Product normalisation
    # ------------------------------------------------------------------ #

    def transform_product(
        self, raw: dict[str, Any], category_name: str = "", category_sub: str = ""
    ) -> dict[str, Any] | None:
        sku = raw.get("sku", "").strip()
        if not sku:
            return None

        title = raw.get("title", "").strip()
        if not title:
            return None

        price = raw.get("price", 0.0) or 0.0
        original_price = raw.get("original_price", price) or price

        currency = raw.get("currency", "USD")

        resolved_category = category_name or raw.get("category", "Walmart Catalog")
        category_path = [resolved_category]
        if category_sub and category_sub.lower() != resolved_category.lower():
            category_path.append(category_sub)

        brand = raw.get("brand", "") or ""
        if not brand and title:
            first_token = title.split()[0].strip("()-[]:,")
            if first_token and not any(ch.isdigit() for ch in first_token):
                brand = first_token[:80]

        return {
            "sku": sku,
            "merchant_id": MERCHANT_ID,
            "title": title,
            "description": (raw.get("description") or "")[:2000],
            "price": float(price),
            "currency": currency,
            "url": raw.get("url", ""),
            "image_url": raw.get("image_url", ""),
            "category": resolved_category,
            "category_path": category_path,
            "brand": brand[:80],
            "is_active": True,
            "in_stock": raw.get("in_stock", True),
            "metadata": {
                "region": "us",
                "country_code": "US",
                "original_price": float(original_price),
                "rating": float(raw.get("rating", 0.0) or 0.0),
                "review_count": int(raw.get("review_count", 0) or 0),
                "gtin": str(raw.get("gtin", "")),
                "source_url": raw.get("url", ""),
            },
        }

    # ------------------------------------------------------------------ #
    #  Ingest
    # ------------------------------------------------------------------ #

    async def ingest_batch(self, products: list[dict[str, Any]]) -> tuple[int, int, int]:
        if not products:
            return 0, 0, 0

        if self.scrape_only:
            with open(self.products_file, "a", encoding="utf-8") as f:
                for product in products:
                    f.write(json.dumps(product, ensure_ascii=False) + "\n")
            return len(products), 0, 0

        url = f"{self.api_base}/v1/ingest/products"
        headers = {"Authorization": f"Bearer {self.api_key}"}
        payload = {"source": SOURCE, "products": products}

        try:
            resp = await self.httpx_client.post(url, json=payload, headers=headers)
            resp.raise_for_status()
            result = resp.json()
            return (
                result.get("rows_inserted", 0),
                result.get("rows_updated", 0),
                result.get("rows_failed", 0),
            )
        except Exception as e:
            log.ingestion_error(None, f"Ingestion error: {e}")
            return 0, 0, len(products)

    # ------------------------------------------------------------------ #
    #  Scrape product URLs
    # ------------------------------------------------------------------ #

    async def scrape_product_urls(
        self, urls: list[str], category_name: str = "", category_sub: str = ""
    ) -> dict[str, int]:
        counts = {"scraped": 0, "ingested": 0, "updated": 0, "failed": 0}
        batch: list[dict[str, Any]] = []

        for url in urls:
            if self.limit > 0 and self.total_products_scraped >= self.limit:
                break

            sku = self._extract_sku_from_url(url)
            if sku in self.seen_skus:
                continue
            self.seen_skus.add(sku)

            html = await self._fetch_page(url)
            if not html:
                counts["failed"] += 1
                self.total_failed += 1
                await asyncio.sleep(self.url_delay)
                continue

            raw = self._parse_product_page(html, url)
            product = self.transform_product(raw, category_name, category_sub)
            if not product:
                counts["failed"] += 1
                self.total_failed += 1
                await asyncio.sleep(self.url_delay)
                continue

            batch.append(product)
            counts["scraped"] += 1
            self.total_products_scraped += 1

            if len(batch) >= self.batch_size:
                i, u, f = await self.ingest_batch(batch)
                counts["ingested"] += i
                counts["updated"] += u
                counts["failed"] += f
                self.total_ingested += i
                self.total_updated += u
                self.total_failed += f
                batch = []

            await asyncio.sleep(self.url_delay)

        if batch:
            i, u, f = await self.ingest_batch(batch)
            counts["ingested"] += i
            counts["updated"] += u
            counts["failed"] += f
            self.total_ingested += i
            self.total_updated += u
            self.total_failed += f

        return counts

    # ------------------------------------------------------------------ #
    #  Orchestration
    # ------------------------------------------------------------------ #

    async def run(self) -> dict[str, Any]:
        mode = "scrape only" if self.scrape_only else f"API: {self.api_base}"
        proxy_note = "BrightData residential" if self.use_proxy else "direct (no proxy)"
        log.progress("=== Walmart US Scraper ===")
        log.progress(f"Mode: {mode}  |  Proxy: {proxy_note}")
        log.progress(f"Batch size: {self.batch_size}  |  Delay: {self.delay}s (search/cat) / {self.url_delay}s (PDP)")
        log.progress(f"Limit: {self.limit or 'unlimited'}  |  Output: {self.output_dir}")

        start = time.time()

        # --- Phase 1: Search-based URL discovery ---
        log.progress("--- Phase 1: Search-Based URL Discovery ---")
        for query in SEARCH_QUERIES:
            if self.limit > 0 and self.total_products_scraped >= self.limit:
                break
            log.progress(f"Searching: '{query}'")
            search_urls = await self._collect_urls_from_search(query)
            if search_urls:
                counts = await self.scrape_product_urls(search_urls, "Walmart Catalog", "")
                log.progress(f"  Scraped {counts['scraped']} products from search '{query}'")

        # --- Phase 2: Category crawl ---
        if not (self.limit > 0 and self.total_products_scraped >= self.limit):
            log.progress("--- Phase 2: Category Crawl ---")
            for category in CATEGORIES:
                if self.limit > 0 and self.total_products_scraped >= self.limit:
                    break
                log.progress(f"[{category['name']} / {category['sub']}]")
                cat_urls = await self._collect_urls_from_category(category)
                log.progress(f"  Collected {len(cat_urls)} URLs")
                if cat_urls:
                    counts = await self.scrape_product_urls(
                        cat_urls, category["name"], category["sub"]
                    )
                    log.progress(f"  Scraped {counts['scraped']} / failed {counts['failed']}")

        elapsed = time.time() - start
        summary = {
            "elapsed_seconds": round(elapsed, 1),
            "total_urls_collected": self.total_urls_collected,
            "total_products_scraped": self.total_products_scraped,
            "total_ingested": self.total_ingested,
            "total_updated": self.total_updated,
            "total_failed": self.total_failed,
            "total_dead_letters": self._dead_letter_count,
            "unique_skus": len(self.seen_skus),
            "proxy_used": self.use_proxy,
        }
        log.progress(f"=== Complete ===\n{json.dumps(summary, indent=2)}")
        return summary

    async def close(self) -> None:
        await self.httpx_client.aclose()


# ------------------------------------------------------------------ #
#  CLI
# ------------------------------------------------------------------ #

def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Walmart US product scraper — sitemap + BrightData proxy"
    )
    parser.add_argument("--api-key", help="BuyWhere API key")
    parser.add_argument("--api-base", default="http://localhost:8000")
    parser.add_argument("--batch-size", type=int, default=100)
    parser.add_argument("--delay", type=float, default=2.0,
                        help="Delay between category page requests")
    parser.add_argument("--url-delay", type=float, default=1.0,
                        help="Delay between product page requests")
    parser.add_argument("--scrape-only", action="store_true",
                        help="Save to JSONL without ingesting to API")
    parser.add_argument("--data-dir", default=None,
                        help="Directory to save scraped data")
    parser.add_argument("--limit", "--target", dest="limit", type=int, default=0,
                        help="Maximum number of products (0 = unlimited)")
    parser.add_argument("--no-proxy", action="store_true",
                        help="Disable BrightData proxy (not recommended)")
    return parser


async def main() -> None:
    parser = build_parser()
    args = parser.parse_args()

    if not args.scrape_only and not args.api_key:
        parser.error("--api-key is required unless --scrape-only is used")

    scraper = WalmartUSScraper(
        api_key=args.api_key,
        api_base=args.api_base,
        batch_size=args.batch_size,
        delay=args.delay,
        scrape_only=args.scrape_only,
        data_dir=args.data_dir,
        limit=args.limit,
        url_delay=args.url_delay,
        use_proxy=not args.no_proxy,
    )

    try:
        await scraper.run()
    finally:
        await scraper.close()


if __name__ == "__main__":
    asyncio.run(main())
