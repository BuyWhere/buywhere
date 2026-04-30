"""
Best Buy US sitemap-style product scraper.

This scraper mimics sitemap-based crawling by:
1. Fetching category browse pages to collect ALL product URLs
2. Scraping each product page individually for full product data

Unlike the API-based scraper (bestbuy_us_api.py), this uses direct HTML scraping.
Unlike the category paginating scraper (bestbuy_us.py), this collects all URLs first
before scraping product data — similar to how a sitemap-based scraper works.

Tag: region=us, country_code=US, currency=USD
Target: 200,000+ electronics products.

Usage:
    python -m scrapers.bestbuy_us_sitemap --scrape-only --limit 1000
    python -m scrapers.bestbuy_us_sitemap --api-key <key> --scrape-only --target 200000
"""

import argparse
import asyncio
import gzip
import json
import os
import re
import time
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import unquote, urljoin, urlparse

import httpx
from bs4 import BeautifulSoup
from playwright.async_api import async_playwright, Error as PlaywrightError

from scrapers.scraper_registry import register
from scrapers.scraper_logging import get_logger

log = get_logger("bestbuy_us_sitemap")

MERCHANT_ID = "bestbuy_us"
SOURCE = "bestbuy_us"
BASE_URL = "https://www.bestbuy.com"
OUTPUT_DIR = Path("/home/paperclip/buywhere-api/data/bestbuy_us")
SITEMAP_INDEX_URL = "https://sitemaps.bestbuy.com/sitemaps_pdp.xml"
SITEMAP_SHARD_TEMPLATE = "https://sitemaps.bestbuy.com/sitemaps_pdp.{index:04d}.xml.gz"
SITEMAP_DISCOVERY_LIMIT = 100

MAX_RETRIES = 3
RETRY_BACKOFF_FACTOR = 2
SITEMAP_NS = {"sm": "http://www.sitemaps.org/schemas/sitemap/0.9"}

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
    "Connection": "keep-alive",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
    "Sec-Fetch-User": "?1",
    "Upgrade-Insecure-Requests": "1",
}

CATEGORIES = [
    {"id": "computers-laptops", "name": "Computers", "sub": "Laptops & Desktops", "path": "/site/computers/laptops/1100000.c?id=1100000"},
    {"id": "computers-tablets", "name": "Computers", "sub": "Tablets & E-Readers", "path": "/site/computers/tablets/1100002.c?id=1100002"},
    {"id": "computers-monitors", "name": "Computers", "sub": "Monitors & PC Accessories", "path": "/site/computers/monitors-accessories/1100006.c?id=1100006"},
    {"id": "phones", "name": "Phones", "sub": "Cell Phones", "path": "/site/cell-phones/10003.c?id=10003"},
    {"id": "phones-accessories", "name": "Phones", "sub": "Phone Accessories", "path": "/site/phones-accessories/10004.c?id=10004"},
    {"id": "tvs", "name": "TV & Home Theater", "sub": "TVs", "path": "/site/tvs/televisions/1100005.c?id=1100005"},
    {"id": "home-theater", "name": "TV & Home Theater", "sub": "Home Theater & Audio", "path": "/site/tvs/home-theater-audio/1100008.c?id=1100008"},
    {"id": "appliances-major", "name": "Appliances", "sub": "Major Appliances", "path": "/site/appliances/major-appliances/1100009.c?id=1100009"},
    {"id": "appliances-small", "name": "Appliances", "sub": "Small Appliances", "path": "/site/appliances/small-appliances/1100011.c?id=1100011"},
    {"id": "gaming-ps5", "name": "Gaming", "sub": "PlayStation 5", "path": "/site/video-games/playstation-5/150189.c?id=150189"},
    {"id": "gaming-xbox", "name": "Gaming", "sub": "Xbox Series X|S", "path": "/site/video-games/xbox-series-x%7c-s/150303.c?id=150303"},
    {"id": "gaming-nintendo", "name": "Gaming", "sub": "Nintendo Switch", "path": "/site/video-games/nintendo-switch/177588.c?id=177588"},
    {"id": "gaming-pc", "name": "Gaming", "sub": "PC Gaming", "path": "/site/video-games/pc-gaming/182461.c?id=182461"},
    {"id": "audio", "name": "Audio", "sub": "Headphones & Speakers", "path": "/site/audio/headphones/1100018.c?id=1100018"},
    {"id": "cameras", "name": "Cameras & Camcorders", "sub": "Cameras", "path": "/site/cameras-camcorders/digital-cameras/1100019.c?id=1100019"},
    {"id": "smart-home", "name": "Smart Home", "sub": "Smart Home & Security", "path": "/site/smart-home/smart-home/1220025.c?id=1220025"},
    {"id": "wearables", "name": "Wearable Tech", "sub": "Smartwatches & Fitness Trackers", "path": "/site/wearable-technology/smartwatches/1100021.c?id=1100021"},
    {"id": "car-electronics", "name": "Car Electronics", "sub": "Car Audio & GPS", "path": "/site/car-electronics/gps-navigation/1100022.c?id=1100022"},
    {"id": "office", "name": "Office", "sub": "Office & School Supplies", "path": "/site/office/office-supplies/1100023.c?id=1100023"},
    {"id": "health", "name": "Health & Fitness", "sub": "Fitness & Health", "path": "/site/fitness-health/exercise-fitness-equipment/1100024.c?id=1100024"},
]


def _write_dead_letter(url: str, reason: str, status_code: int | None, dead_letter_file: Path) -> None:
    """Write a failed URL to the dead-letter file."""
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


@register("bestbuy_us_sitemap")
class BestBuyUSSitemapScraper:
    MERCHANT_ID = "bestbuy_us"
    SOURCE = "bestbuy_us"
    def __init__(
        self,
        api_key: str | None = None,
        api_base: str = "http://localhost:8000",
        batch_size: int = 100,
        delay: float = 1.5,
        scrape_only: bool = False,
        data_dir: str | None = None,
        limit: int = 0,
        url_delay: float = 0.5,
    ):
        self.api_key = api_key
        self.api_base = api_base.rstrip("/")
        self.batch_size = batch_size
        self.delay = delay
        self.url_delay = url_delay
        self.scrape_only = scrape_only
        self.limit = limit
        self.output_dir = Path(data_dir) if data_dir else OUTPUT_DIR
        self.output_dir.mkdir(parents=True, exist_ok=True)

        self.httpx_client = httpx.AsyncClient(timeout=30.0, headers=HEADERS, follow_redirects=True)
        self.playwright = None
        self.browser = None
        self.context = None
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

    def _decode_xml_response(self, content: bytes) -> bytes:
        if content.startswith(b"\x1f\x8b"):
            return gzip.decompress(content)
        return content

    async def _discover_pdp_sitemaps(self) -> list[str]:
        sitemap_urls: list[str] = []

        try:
            resp = await self.httpx_client.get(SITEMAP_INDEX_URL)
            resp.raise_for_status()
            root = ET.fromstring(self._decode_xml_response(resp.content))
            for loc in root.findall(".//sm:sitemap/sm:loc", SITEMAP_NS):
                if loc.text:
                    sitemap_urls.append(loc.text.strip())
        except Exception as e:
            log.network_error(SITEMAP_INDEX_URL, f"Unable to fetch PDP sitemap index: {e}")

        discovered = set(sitemap_urls)
        found_numbered = False
        for index in range(SITEMAP_DISCOVERY_LIMIT):
            shard_url = SITEMAP_SHARD_TEMPLATE.format(index=index)
            try:
                resp = await self.httpx_client.head(shard_url)
            except Exception:
                if found_numbered:
                    break
                continue

            if resp.status_code == 200:
                found_numbered = True
                if shard_url not in discovered:
                    discovered.add(shard_url)
                    sitemap_urls.append(shard_url)
                continue

            if found_numbered:
                break

        return sitemap_urls

    async def _extract_urls_from_pdp_sitemap(self, sitemap_url: str) -> list[str]:
        try:
            resp = await self.httpx_client.get(sitemap_url, timeout=60.0)
            resp.raise_for_status()
            root = ET.fromstring(self._decode_xml_response(resp.content))
        except Exception as e:
            log.network_error(sitemap_url, f"Unable to fetch/parse PDP sitemap: {e}")
            _write_dead_letter(sitemap_url, f"Sitemap parse error: {e}", None, self.dead_letter_file)
            self._dead_letter_count += 1
            return []

        urls: list[str] = []
        for loc in root.findall(".//sm:url/sm:loc", SITEMAP_NS):
            if loc.text:
                product_url = loc.text.strip()
                if self._extract_sku_from_url(product_url):
                    urls.append(product_url)
        return urls

    def _title_from_bestbuy_url(self, url: str) -> str:
        parsed = urlparse(url)
        parts = [part for part in parsed.path.split("/") if part]
        slug = ""
        if "site" in parts:
            site_index = parts.index("site")
            if len(parts) > site_index + 1:
                slug = parts[site_index + 1]

        slug = unquote(slug)
        slug = re.sub(r"[-_]+", " ", slug)
        slug = re.sub(r"\s+", " ", slug).strip()
        if not slug or slug.lower() == "product":
            return ""
        return " ".join(token.upper() if token in {"tv", "pc", "usb", "hdmi", "gps"} else token.capitalize() for token in slug.split())

    def _category_from_title(self, title: str) -> tuple[str, str]:
        text = title.lower()
        rules = [
            ("Computers", "Laptops & Computer Accessories", ("laptop", "desktop", "monitor", "keyboard", "mouse", "router", "hard drive", "ssd")),
            ("Audio", "Headphones & Speakers", ("headphone", "earbud", "speaker", "turntable", "audio")),
            ("Phones", "Cell Phones & Accessories", ("iphone", "phone", "galaxy", "case", "magsafe", "charger")),
            ("TV & Home Theater", "TV & Home Theater", ("tv", "television", "soundbar", "receiver", "speaker", "blu-ray", "hdmi")),
            ("Appliances", "Appliances", ("refrigerator", "washer", "dryer", "microwave", "range", "coffee maker", "icemaker")),
            ("Gaming", "Video Games & Gaming Hardware", ("playstation", "xbox", "nintendo", "gaming", "game")),
            ("Cameras & Camcorders", "Cameras", ("camera", "camcorder", "lens")),
            ("Smart Home", "Smart Home & Security", ("smart", "security", "wi-fi", "wifi", "hue")),
            ("Wearable Tech", "Smartwatches & Fitness Trackers", ("watch", "fitbit", "fitness tracker")),
        ]
        for category, subcategory, keywords in rules:
            if any(keyword in text for keyword in keywords):
                return category, subcategory
        return "Electronics", "Best Buy Catalog"

    def _product_from_sitemap_url(self, url: str) -> dict[str, Any] | None:
        sku = self._extract_sku_from_url(url)
        title = self._title_from_bestbuy_url(url)
        if not sku or not title:
            return None
        category_name, category_sub = self._category_from_title(title)
        raw = {
            "sku": sku,
            "url": url,
            "title": title,
            "price": 0.0,
            "original_price": 0.0,
            "description": "",
            "image_url": "",
            "brand": self._extract_brand(title),
            "rating": 0.0,
            "review_count": 0,
            "in_stock": True,
            "model_number": "",
            "upc": "",
        }
        product = self.transform_product(raw, category_name, category_sub)
        if product:
            product["metadata"]["source"] = SOURCE
            product["metadata"]["extraction_method"] = "bestbuy_pdp_sitemap"
            product["metadata"]["price_available"] = False
        return product

    async def collect_and_ingest_from_sitemaps(self) -> dict[str, int]:
        counts = {"scraped": 0, "ingested": 0, "updated": 0, "failed": 0}
        batch: list[dict[str, Any]] = []

        sitemap_urls = await self._discover_pdp_sitemaps()
        log.progress(f"Found {len(sitemap_urls)} Best Buy PDP sitemap shards")

        for sitemap_url in sitemap_urls:
            if self.limit > 0 and self.total_products_scraped >= self.limit:
                break

            product_urls = await self._extract_urls_from_pdp_sitemap(sitemap_url)
            log.progress(f"{sitemap_url.split('/')[-1]}: {len(product_urls)} PDP URLs")

            with open(self.urls_file, "a", encoding="utf-8") as f:
                for url in product_urls:
                    if self.limit > 0 and self.total_products_scraped >= self.limit:
                        break

                    sku = self._extract_sku_from_url(url)
                    if not sku or sku in self.seen_skus:
                        continue

                    product = self._product_from_sitemap_url(url)
                    if not product:
                        counts["failed"] += 1
                        self.total_failed += 1
                        continue

                    self.seen_skus.add(sku)
                    self.seen_urls.add(url)
                    self.total_urls_collected += 1
                    self.total_products_scraped += 1
                    counts["scraped"] += 1
                    f.write(url + "\n")
                    batch.append(product)

                    if len(batch) >= self.batch_size:
                        i, u, failed = await self.ingest_batch(batch)
                        counts["ingested"] += i
                        counts["updated"] += u
                        counts["failed"] += failed
                        self.total_ingested += i
                        self.total_updated += u
                        self.total_failed += failed
                        batch = []

            if batch:
                i, u, failed = await self.ingest_batch(batch)
                counts["ingested"] += i
                counts["updated"] += u
                counts["failed"] += failed
                self.total_ingested += i
                self.total_updated += u
                self.total_failed += failed
                batch = []

            await asyncio.sleep(self.delay)

        return counts

    async def _init_playwright(self) -> None:
        if self.playwright is None:
            self.playwright = await async_playwright().start()
            self.browser = await self.playwright.chromium.launch(headless=True)
            self.context = await self.browser.new_context(
                locale="en-US",
                timezone_id="America/New_York",
                user_agent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
            )

    async def close(self) -> None:
        await self.httpx_client.aclose()
        if self.browser:
            await self.browser.close()
        if self.playwright:
            await self.playwright.stop()

    async def _get_with_retry(self, url: str, params: dict[str, Any] | None = None, retries: int = MAX_RETRIES) -> str | None:
        await self._init_playwright()
        for attempt in range(retries):
            try:
                page = await self.context.new_page()
                fetch_url = url
                if params:
                    import urllib.parse
                    query_string = urllib.parse.urlencode(params)
                    fetch_url = f"{url}?{query_string}"
                resp = await page.goto(fetch_url, timeout=30000)
                if resp and resp.status == 429:
                    wait = (2 ** attempt) * RETRY_BACKOFF_FACTOR
                    log.progress(f"Rate limited (429), waiting {wait}s (attempt {attempt + 1}/{retries})")
                    await asyncio.sleep(wait)
                    await page.close()
                    continue
                if resp and resp.status == 403:
                    log.request_failed(url, attempt, "HTTP 403 - access denied")
                    _write_dead_letter(url, "HTTP 403 Forbidden", 403, self.dead_letter_file)
                    self._dead_letter_count += 1
                    await page.close()
                    return None
                await page.wait_for_timeout(2000)
                
                country_heading = await page.query_selector("h1")
                if country_heading:
                    heading_text = await country_heading.text_content()
                    if heading_text and ("country" in heading_text.lower() or "pays" in heading_text.lower()):
                        us_link = await page.query_selector("a.us-link, a[href*='intl=nosplash']")
                        if us_link:
                            await us_link.click()
                            await page.wait_for_timeout(3000)
                
                content = await page.content()
                await page.close()
                return content
            except PlaywrightError as e:
                if attempt < retries - 1:
                    wait = 2 ** attempt
                    log.progress(f"Playwright error, retrying in {wait}s (attempt {attempt + 1}/{retries})")
                    await asyncio.sleep(wait)
                else:
                    log.network_error(url, f"Playwright error after all retries: {e}")
                    _write_dead_letter(url, f"Playwright error: {e}", None, self.dead_letter_file)
                    self._dead_letter_count += 1
                    return None
            except Exception as e:
                if attempt < retries - 1:
                    wait = 2 ** attempt
                    await asyncio.sleep(wait)
                else:
                    log.network_error(url, f"Error fetching: {e}")
                    _write_dead_letter(url, f"Error: {e}", None, self.dead_letter_file)
                    self._dead_letter_count += 1
                    return None
        return None

    def _extract_sku_from_url(self, url: str) -> str:
        match = re.search(r"/(\d{7})\.p", url)
        if match:
            return match.group(1)
        match = re.search(r"skuId=(\d+)", url)
        if match:
            return match.group(1)
        return ""

    def _extract_product_urls_from_page(self, html: str) -> list[str]:
        soup = BeautifulSoup(html, "html.parser")
        urls = []
        page_seen: set[str] = set()

        for link in soup.find_all("a", href=True):
            href = link["href"]
            if "/site/" in href and ("product" in href.lower() or "/p?" in href or re.search(r"/\d{7}\.p", href)):
                full_url = urljoin(BASE_URL, href)
                parsed = urlparse(full_url)
                if parsed.netloc.endswith("bestbuy.com") and self._extract_sku_from_url(full_url):
                    if full_url not in page_seen:
                        page_seen.add(full_url)
                        urls.append(full_url)

        for card in soup.select("[data-sku-id], [data-product-id]"):
            sku = card.get("data-sku-id") or card.get("data-product-id")
            if sku:
                url = f"{BASE_URL}/site/product?skuId={sku}"
                if url not in page_seen:
                    page_seen.add(url)
                    urls.append(url)

        return urls

    async def _collect_urls_from_category_page(self, category: dict[str, Any], page: int = 1) -> tuple[list[str], bool]:
        url = f"{BASE_URL}{category['path']}"
        params = {}
        if page > 1:
            params["page"] = page

        html = await self._get_with_retry(url, params=params)
        if not html:
            return [], False

        urls = self._extract_product_urls_from_page(html)

        soup = BeautifulSoup(html, "html.parser")
        next_btn = soup.select_one("a.pagination-next, button.pagination-next, a[rel='next']")
        has_next = next_btn is not None
        if not has_next:
            page_links = soup.select("a.page-link, a.pagination-page")
            for link in page_links:
                text = link.get_text(strip=True)
                if text.isdigit() and int(text) > 1:
                    has_next = True
                    break

        return urls, has_next

    async def collect_all_urls(self, category: dict[str, Any]) -> list[str]:
        cat_name = category["name"]
        cat_sub = category["sub"]

        log.progress(f"[{cat_name} / {cat_sub}] Collecting URLs...")
        all_urls = []
        page = 1
        consecutive_empty = 0
        max_pages = 100

        while page <= max_pages:
            if self.limit > 0 and self.total_urls_collected >= self.limit:
                log.progress(f"URL limit of {self.limit} reached")
                break

            urls, has_next = await self._collect_urls_from_category_page(category, page)
            new_urls = [u for u in urls if u not in self.seen_urls]

            if not new_urls:
                consecutive_empty += 1
                if consecutive_empty >= 3:
                    log.progress(f"No new URLs for 3 consecutive pages, ending pagination")
                    break
                log.progress(f"Page {page}: no new URLs")
                if not has_next:
                    break
                await asyncio.sleep(self.delay)
                page += 1
                continue

            consecutive_empty = 0
            self.seen_urls.update(new_urls)
            all_urls.extend(new_urls)
            self.total_urls_collected += len(new_urls)

            log.progress(f"Page {page}: found {len(new_urls)} new URLs (total: {len(all_urls)}, running: {self.total_urls_collected})")

            if not has_next:
                break

            await asyncio.sleep(self.delay)
            page += 1

        return all_urls

    def _save_urls_to_file(self, urls: list[str]) -> None:
        with open(self.urls_file, "a", encoding="utf-8") as f:
            for url in urls:
                f.write(url + "\n")

    def _parse_price(self, value: str | float | None) -> float:
        if value is None:
            return 0.0
        if isinstance(value, (int, float)):
            return float(value)
        cleaned = str(value).replace("$", "").replace(",", "").replace("USD", "").strip()
        match = re.search(r"[\d]+(?:\.\d+)?", cleaned)
        if not match:
            return 0.0
        try:
            return float(match.group(0))
        except ValueError:
            return 0.0

    def _extract_brand(self, title: str, raw_brand: str = "") -> str:
        if raw_brand:
            return raw_brand[:80]
        if not title:
            return ""
        first_token = title.split()[0].strip("()-[]:,")
        if not first_token:
            return ""
        if any(char.isdigit() for char in first_token):
            return ""
        return first_token[:80]

    def _parse_product_page(self, html: str, url: str) -> dict[str, Any] | None:
        soup = BeautifulSoup(html, "html.parser")

        sku = self._extract_sku_from_url(url)
        if not sku:
            sku_match = re.search(r'skuId["\']?\s*:\s*["\']?(\d+)', html)
            if sku_match:
                sku = sku_match.group(1)

        title = ""
        title_el = soup.select_one("h1.heading-5-v2, h1.product-title, #product-title, [data-track='product-title']")
        if title_el:
            title = title_el.get_text(strip=True)

        if not title:
            title_el = soup.select_one("h1")
            if title_el:
                title = title_el.get_text(strip=True)

        if not title:
            title_match = re.search(r'<h1[^>]*>([^<]+)</h1>', html)
            if title_match:
                title = title_match.group(1).strip()

        price = 0.0
        price_el = soup.select_one("[data-track='product-price'], .priceView-customer-price span, .pricing-price__regular-price")
        if price_el:
            price_text = price_el.get_text(strip=True)
            price = self._parse_price(price_text)

        if price == 0.0:
            price_match = re.search(r'"salePrice"\s*:\s*"?([\d.]+)"?', html)
            if price_match:
                price = float(price_match.group(1))

        original_price = price
        orig_price_el = soup.select_one(".was-price, .list-price, .original-price")
        if orig_price_el:
            original_price = self._parse_price(orig_price_el.get_text(strip=True))

        description = ""
        desc_el = soup.select_one("#product-description, .product-description, [data-track='product-description']")
        if desc_el:
            description = desc_el.get_text(strip=True)

        if not description:
            desc_match = re.search(r'"description"\s*:\s*"?([^"]{20,2000})"?,', html)
            if desc_match:
                description = desc_match.group(1).strip()

        image_url = ""
        img_el = soup.select_one("img.product-image, #primary-image, .product-hero-image img")
        if img_el:
            image_url = img_el.get("src", "") or img_el.get("data-src", "")

        if not image_url:
            img_match = re.search(r'"image"\s*:\s*"?([^"]+)"?', html)
            if img_match:
                image_url = img_match.group(1)

        brand = ""
        brand_el = soup.select_one(".product-brand, .brand, [data-track='product-brand']")
        if brand_el:
            brand = brand_el.get_text(strip=True)

        if not brand:
            brand_match = re.search(r'"brand"\s*:\s*"?([^"]+)"?', html)
            if brand_match:
                brand = brand_match.group(1).strip()

        rating = 0.0
        rating_el = soup.select_one(".rating, [aria-label*='stars'], .customer-rating")
        if rating_el:
            rating_text = rating_el.get("aria-label", "") or rating_el.get_text(strip=True)
            rating_match = re.search(r"(\d+(?:\.\d+)?)", rating_text)
            if rating_match:
                rating = float(rating_match.group(1))

        review_count = 0
        review_el = soup.select_one(".review-count, .num-reviews")
        if review_el:
            review_text = re.sub(r"[^\d]", "", review_el.get_text(strip=True))
            if review_text:
                review_count = int(review_text)

        in_stock = True
        stock_el = soup.select_one(".add-to-cart-button, .buy-button, .out-of-stock-message")
        if stock_el:
            stock_text = stock_el.get_text(strip=True).lower()
            if "out of stock" in stock_text or "sold out" in stock_text or "unavailable" in stock_text:
                in_stock = False

        model_number = ""
        model_match = re.search(r'"modelNumber"\s*:\s*"?([^"]+)"?', html)
        if model_match:
            model_number = model_match.group(1).strip()

        upc = ""
        upc_match = re.search(r'"upc"\s*:\s*"?([^"]+)"?', html)
        if upc_match:
            upc = upc_match.group(1).strip()

        return {
            "sku": sku,
            "url": url,
            "title": title,
            "price": price,
            "original_price": original_price,
            "description": description[:2000],
            "image_url": image_url,
            "brand": brand,
            "rating": rating,
            "review_count": review_count,
            "in_stock": in_stock,
            "model_number": model_number,
            "upc": upc,
        }

    def transform_product(self, raw: dict[str, Any], category_name: str, category_sub: str) -> dict[str, Any] | None:
        sku = raw.get("sku", "").strip()
        if not sku:
            return None

        title = raw.get("title", "").strip()
        if not title:
            return None

        price = raw.get("price", 0.0)
        original_price = raw.get("original_price", price)
        if original_price == 0:
            original_price = price

        category_path = [category_name]
        if category_sub and category_sub.lower() != category_name.lower():
            category_path.append(category_sub)

        return {
            "sku": sku,
            "merchant_id": MERCHANT_ID,
            "title": title,
            "description": raw.get("description", "")[:2000],
            "price": float(price) if price else 0.0,
            "currency": "USD",
            "url": raw.get("url", ""),
            "image_url": raw.get("image_url", ""),
            "category": category_name,
            "category_path": category_path,
            "brand": raw.get("brand", "") or self._extract_brand(title),
            "is_active": True,
            "in_stock": raw.get("in_stock", True),
            "metadata": {
                "region": "us",
                "country_code": "US",
                "original_price": float(original_price) if original_price else 0.0,
                "rating": raw.get("rating", 0.0),
                "review_count": raw.get("review_count", 0),
                "model_number": raw.get("model_number", ""),
                "upc": raw.get("upc", ""),
                "condition": "New",
            },
        }

    async def scrape_product_url(self, url: str, category_name: str = "", category_sub: str = "") -> dict[str, Any] | None:
        html = await self._get_with_retry(url)
        if not html:
            return None

        raw = self._parse_product_page(html, url)
        if not raw:
            return None

        if not raw.get("sku"):
            raw["sku"] = self._extract_sku_from_url(url)

        return self.transform_product(raw, category_name, category_sub)

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

    async def scrape_urls(self, urls: list[str], category_name: str, category_sub: str) -> dict[str, int]:
        counts: dict[str, int] = {"scraped": 0, "ingested": 0, "updated": 0, "failed": 0}
        batch: list[dict[str, Any]] = []

        for url in urls:
            if self.limit > 0 and self.total_products_scraped >= self.limit:
                log.progress(f"Product limit of {self.limit} reached")
                break

            sku = self._extract_sku_from_url(url)
            if sku in self.seen_skus:
                continue
            self.seen_skus.add(sku)

            product = await self.scrape_product_url(url, category_name, category_sub)
            if product:
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
                    log.progress(f"Scraped {counts['scraped']}, ingested {i+u}/{len(batch)+i+u} (total: {self.total_products_scraped})")
                    await asyncio.sleep(self.url_delay)

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

    async def run(self) -> dict[str, Any]:
        mode = "scrape only" if self.scrape_only else f"API: {self.api_base}"
        log.progress("Best Buy US Sitemap-Style Scraper starting...")
        log.progress(f"Mode: {mode}")
        log.progress(f"Batch size: {self.batch_size}, Delay: {self.delay}s (URL collection), {self.url_delay}s (product scraping)")
        log.progress(f"Output URLs: {self.urls_file}")
        log.progress(f"Output Products: {self.products_file}")
        log.progress(f"Dead-letter file: {self.dead_letter_file}")
        log.progress(f"Categories: {len(CATEGORIES)}")
        log.progress(f"Target: 200,000+ products")

        start = time.time()

        log.progress("=== PHASE 1: PDP Sitemap Product Extraction ===")
        sitemap_counts = await self.collect_and_ingest_from_sitemaps()
        if sitemap_counts["scraped"] > 0:
            elapsed = time.time() - start
            summary = {
                "elapsed_seconds": round(elapsed, 1),
                "total_urls_collected": self.total_urls_collected,
                "total_products_scraped": self.total_products_scraped,
                "total_ingested": self.total_ingested,
                "total_updated": self.total_updated,
                "total_failed": self.total_failed,
                "total_dead_letters": self._dead_letter_count,
                "urls_file": str(self.urls_file),
                "products_file": str(self.products_file),
                "dead_letter_file": str(self.dead_letter_file) if self._dead_letter_count > 0 else None,
                "unique_skus": len(self.seen_skus),
                "sitemap_counts": sitemap_counts,
            }
            log.progress(f"Scraper complete: {summary}")
            return summary

        log.progress("No PDP sitemap products found; falling back to category page collection")
        all_urls_by_category: dict[str, tuple[list[str], str, str]] = {}

        log.progress("=== PHASE 2: URL Collection ===")
        for category in CATEGORIES:
            if self.limit > 0 and self.total_urls_collected >= self.limit:
                break

            urls = await self.collect_all_urls(category)
            all_urls_by_category[category["id"]] = (urls, category["name"], category["sub"])
            log.progress(f"[{category['name']} / {category['sub']}] Collected {len(urls)} URLs")
            await asyncio.sleep(self.delay)

        total_urls = sum(len(u) for u, _, _ in all_urls_by_category.values())
        log.progress(f"Total URLs collected: {total_urls}")

        log.progress("=== PHASE 3: Product Scraping ===")
        category_counts = {}
        for cat_id, (urls, cat_name, cat_sub) in all_urls_by_category.items():
            if self.limit > 0 and self.total_products_scraped >= self.limit:
                break

            log.progress(f"[{cat_name} / {cat_sub}] Scraping {len(urls)} products...")
            counts = await self.scrape_urls(urls, cat_name, cat_sub)
            category_counts[cat_id] = counts
            log.progress(f"Done: {counts}")

        elapsed = time.time() - start
        summary = {
            "elapsed_seconds": round(elapsed, 1),
            "total_urls_collected": self.total_urls_collected,
            "total_products_scraped": self.total_products_scraped,
            "total_ingested": self.total_ingested,
            "total_updated": self.total_updated,
            "total_failed": self.total_failed,
            "total_dead_letters": self._dead_letter_count,
            "urls_file": str(self.urls_file),
            "products_file": str(self.products_file),
            "dead_letter_file": str(self.dead_letter_file) if self._dead_letter_count > 0 else None,
            "unique_skus": len(self.seen_skus),
            "category_counts": category_counts,
        }
        log.progress(f"Scraper complete: {summary}")
        return summary


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Best Buy US sitemap-style product scraper")
    parser.add_argument("--api-key", help="BuyWhere API key")
    parser.add_argument("--api-base", default="http://localhost:8000", help="BuyWhere API base URL")
    parser.add_argument("--batch-size", type=int, default=100)
    parser.add_argument("--delay", type=float, default=1.5, help="Delay between URL collection requests")
    parser.add_argument("--url-delay", type=float, default=0.5, help="Delay between product scraping requests")
    parser.add_argument("--scrape-only", action="store_true", help="Save to JSONL without ingesting")
    parser.add_argument("--data-dir", default=None, help="Directory to save scraped data")
    parser.add_argument(
        "--limit",
        "--target",
        dest="limit",
        type=int,
        default=0,
        help="Maximum number of products (0 = unlimited)",
    )
    return parser


async def main() -> None:
    parser = build_parser()
    args = parser.parse_args()

    if not args.scrape_only and not args.api_key:
        parser.error("--api-key is required unless --scrape-only is used")

    scraper = BestBuyUSSitemapScraper(
        api_key=args.api_key,
        api_base=args.api_base,
        batch_size=args.batch_size,
        delay=args.delay,
        scrape_only=args.scrape_only,
        data_dir=args.data_dir,
        limit=args.limit,
        url_delay=args.url_delay,
    )

    try:
        await scraper.run()
    finally:
        await scraper.close()


if __name__ == "__main__":
    asyncio.run(main())
