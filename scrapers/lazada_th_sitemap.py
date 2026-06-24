"""
Lazada Thailand sitemap-based scraper.

Uses sitemap index from https://www.lazada.co.th/sitemap-pdp-basic.xml to get product URLs,
then fetches individual product pages via Playwright with BrightData residential proxy
to bypass Alibaba WAF.

Output: NDJSON to data/affiliate_ndjson/lazada_th.ndjson

Usage:
    python -m scrapers.lazada_th_sitemap --limit 10000
    python -m scrapers.lazada_th_sitemap --scrape-sitemaps-only
"""

import argparse
import asyncio
import gzip
import json
import os
import random
import re
import time
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

import httpx

from scrapers.proxy_config import Zone, proxy_config_for_playwright
from scrapers.scraper_logging import get_logger

MERCHANT_ID = "lazada_th"
SOURCE = "lazada_th"
LOG = get_logger(MERCHANT_ID)

BASE_URL = "https://www.lazada.co.th"
SITEMAP_INDEX_URL = f"{BASE_URL}/sitemap-pdp-basic.xml"
OUTPUT_FILE = "/home/paperclip/buywhere-api/data/affiliate_ndjson/lazada_th.ndjson"

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-TH,en;q=0.9",
}

SITEMAP_NS = {"sm": "http://www.sitemaps.org/schemas/sitemap/0.9"}


class LazadaTHSitemapScraper:
    def __init__(
        self,
        limit: int = 0,
        sitemap_batch: int = 5,
        product_batch: int = 10,
        delay: float = 2.0,
        output_file: str = OUTPUT_FILE,
        use_proxy: bool = True,
        max_pages_per_sitemap: int = 0,
    ):
        self.limit = limit
        self.sitemap_batch = sitemap_batch
        self.product_batch = product_batch
        self.delay = delay
        self.output_file = output_file
        self.use_proxy = use_proxy
        self.max_pages_per_sitemap = max_pages_per_sitemap
        
        self.http = httpx.AsyncClient(timeout=30.0, headers=HEADERS)
        self.playwright = None
        self.browser = None
        
        self.stats = {
            "sitemaps_discovered": 0,
            "sitemaps_processed": 0,
            "urls_discovered": 0,
            "urls_processed": 0,
            "products_scraped": 0,
            "products_written": 0,
            "errors": 0,
        }
        
        Path(output_file).parent.mkdir(parents=True, exist_ok=True)

    async def close(self):
        await self.http.aclose()
        if self.browser:
            await self.browser.close()
        if self.playwright:
            await self.playwright.stop()

    async def _init_playwright(self):
        if self.playwright is None:
            from playwright.async_api import async_playwright
            self.playwright = await async_playwright().start()
            
            launch_options = {"headless": True}
            if self.use_proxy:
                proxy_cfg = proxy_config_for_playwright(Zone.RESIDENTIAL_PROXY1)
                launch_options["proxy"] = proxy_cfg
            
            self.browser = await self.playwright.chromium.launch(**launch_options)

    async def fetch_sitemap_index(self) -> list[str]:
        LOG.progress(f"Fetching sitemap index: {SITEMAP_INDEX_URL}")
        resp = await self.http.get(SITEMAP_INDEX_URL)
        resp.raise_for_status()
        
        sitemap_urls = []
        root = ET.fromstring(resp.text)
        for sitemap in root.findall("sm:sitemap", SITEMAP_NS):
            loc = sitemap.find("sm:loc", SITEMAP_NS)
            if loc is not None and loc.text:
                sitemap_urls.append(loc.text)
        
        self.stats["sitemaps_discovered"] = len(sitemap_urls)
        LOG.progress(f"Found {len(sitemap_urls)} sitemap files")
        return sitemap_urls

    async def fetch_sitemap_urls(self, sitemap_url: str) -> list[str]:
        urls = []
        try:
            resp = await self.http.get(sitemap_url)
            resp.raise_for_status()
            raw = resp.content
            try:
                content = gzip.decompress(raw)
            except (gzip.BadGzipFile, OSError):
                content = raw
            if isinstance(content, bytes):
                content = content.decode("utf-8", errors="ignore")
            root = ET.fromstring(content)
            for url in root.findall("sm:url", SITEMAP_NS):
                loc = url.find("sm:loc", SITEMAP_NS)
                if loc is not None and loc.text:
                    urls.append(loc.text)
        except Exception as e:
            LOG.network_error(sitemap_url, f"Failed: {e}")
            self.stats["errors"] += 1
        return urls

    def _extract_product_from_html(self, html: str, url: str) -> Optional[dict[str, Any]]:
        product = {"source_url": url, "merchant_id": MERCHANT_ID}
        
        title_match = re.search(r'<h1[^>]*class="[^"]*pdp-mod-product-badge-title[^"]*"[^>]*>([^<]+)</h1>', html)
        if not title_match:
            title_match = re.search(r'<title>([^<]+)</title>', html)
        if title_match:
            product["title"] = title_match.group(1).strip()
        
        price_match = re.search(r'"price":"([^"]+)"|\'price\':\'([^\']+)\'|"salePrice":{"value":(\d+)}', html)
        if price_match:
            price_str = price_match.group(1) or price_match.group(2) or price_match.group(3)
            try:
                product["price"] = float(price_str)
            except ValueError:
                pass
        
        original_price_match = re.search(r'"originalPrice":"([^"]+)"|"priceBeforeDiscount":"([^"]+)"', html)
        if original_price_match:
            try:
                product["original_price"] = float(original_price_match.group(1) or original_price_match.group(2))
            except ValueError:
                pass
        
        discount_match = re.search(r'"discount":"([^"]+)"|(\d+)%\s*off', html)
        if discount_match:
            try:
                product["discount_percent"] = int(discount_match.group(1) or discount_match.group(2))
            except ValueError:
                pass
        
        image_match = re.search(r'"thumbnails":\["([^"]+)"|\'image\':\'([^\']+)\'|data-qcloudUid="[^"]*"\s+src="([^"]+)"', html)
        if image_match:
            product["image_url"] = (image_match.group(1) or image_match.group(2) or image_match.group(3) or "").split("?")[0]
        
        brand_match = re.search(r'"brand":"([^"]+)"|Brand[^>]*>\s*<[^>]*>([^<]+)</', html)
        if brand_match:
            product["brand"] = brand_match.group(1) or brand_match.group(2) or ""
        
        sku_match = re.search(r'"sku":"([^"]+)"|productId["\']?\s*[=:]\s*["\']?(\d+)', html)
        if sku_match:
            product["sku"] = sku_match.group(1) or sku_match.group(2) or ""
        
        seller_match = re.search(r'"seller":{"sellerId":\d+,"name":"([^"]+)"', html)
        if seller_match:
            product["seller"] = seller_match.group(1)
        
        category_match = re.search(r'"breadcrumbs":\[([^\]]+(?:\[[^\]]+\])?[^\]]*)\]', html)
        if category_match:
            try:
                cats = json.loads("[" + category_match.group(1) + "]")
                product["category_path"] = [c.get("name", "") for c in cats if isinstance(c, dict)]
            except json.JSONDecodeError:
                pass
        
        rating_match = re.search(r'"ratingScore":(\d+\.?\d*)|rating[^>]*>\s*(\d+\.?\d*)\s*</span>', html)
        if rating_match:
            try:
                product["rating"] = float(rating_match.group(1) or rating_match.group(2))
            except ValueError:
                pass
        
        review_match = re.search(r'"reviewCount":(\d+)|(\d+)\s*reviews', html)
        if review_match:
            try:
                product["review_count"] = int(review_match.group(1) or review_match.group(2))
            except ValueError:
                pass
        
        stock_match = re.search(r'"stock":(\d+)|In\s*Stock|Sold', html)
        if stock_match:
            product["in_stock"] = stock_match.group(0) != "0"
        
        return product if "title" in product else None

    async def fetch_product_page(self, url: str) -> Optional[dict[str, Any]]:
        await self._init_playwright()
        
        try:
            context = await self.browser.new_context(
                user_agent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                viewport={"width": 1920, "height": 1080},
                locale="en-TH",
                extra_http_headers={"Accept-Language": "en-TH,en;q=0.9"},
            )
            
            page = await context.new_page()
            
            await page.goto(url, wait_until="domcontentloaded", timeout=30000)
            await asyncio.sleep(random.uniform(1.0, 2.5))
            
            html = await page.content()
            product = self._extract_product_from_html(html, url)
            
            await context.close()
            
            if product:
                self.stats["products_scraped"] += 1
            return product
        except Exception as e:
            LOG.network_error(url, f"Failed: {e}")
            self.stats["errors"] += 1
            return None

    def _write_product(self, product: dict) -> bool:
        try:
            with open(self.output_file, "a", encoding="utf-8") as f:
                f.write(json.dumps(product, ensure_ascii=False) + "\n")
            self.stats["products_written"] += 1
            return True
        except Exception as e:
            LOG.network_error("product_write", f"Failed: {e}")
            return False

    async def process_sitemap(self, sitemap_url: str, semaphore: asyncio.Semaphore) -> list[str]:
        async with semaphore:
            LOG.progress(f"Processing sitemap: {sitemap_url}")
            urls = await self.fetch_sitemap_urls(sitemap_url)
            self.stats["sitemaps_processed"] += 1
            
            if self.max_pages_per_sitemap > 0:
                urls = urls[:self.max_pages_per_sitemap]
            
            LOG.progress(f"  Found {len(urls)} product URLs in sitemap")
            return urls

    async def process_product(self, url: str, semaphore: asyncio.Semaphore) -> bool:
        async with semaphore:
            if self.limit > 0 and self.stats["urls_processed"] >= self.limit:
                return False
            
            self.stats["urls_processed"] += 1
            
            product = await self.fetch_product_page(url)
            if product:
                self._write_product(product)
            
            await asyncio.sleep(random.uniform(self.delay * 0.5, self.delay * 1.5))
            return product is not None

    async def run(self) -> dict[str, Any]:
        LOG.progress(f"Starting Lazada TH Sitemap Scraper")
        LOG.progress(f"Output: {self.output_file}")
        LOG.progress(f"Limit: {self.limit or 'unlimited'}")
        
        start_time = time.time()
        
        sitemap_urls = await self.fetch_sitemap_index()
        
        sitemap_sem = asyncio.Semaphore(self.sitemap_batch)
        sitemap_tasks = [self.process_sitemap(url, sitemap_sem) for url in sitemap_urls]
        all_product_urls: list[str] = []
        
        results = await asyncio.gather(*sitemap_tasks)
        for urls in results:
            all_product_urls.extend(urls)
        
        LOG.progress(f"Total product URLs discovered: {len(all_product_urls)}")
        
        if self.limit > 0:
            all_product_urls = all_product_urls[:self.limit]
        
        product_sem = asyncio.Semaphore(self.product_batch)
        product_tasks = [self.process_product(url, product_sem) for url in all_product_urls]
        
        await asyncio.gather(*product_tasks, return_exceptions=True)
        
        elapsed = time.time() - start_time
        self.stats["elapsed_seconds"] = round(elapsed, 1)
        
        LOG.progress(f"Complete: {self.stats}")
        return self.stats


async def main():
    parser = argparse.ArgumentParser(description="Lazada Thailand Sitemap Scraper")
    parser.add_argument("--limit", type=int, default=10000, help="Max URLs to process")
    parser.add_argument("--sitemap-batch", type=int, default=3, help="Concurrent sitemap fetches")
    parser.add_argument("--product-batch", type=int, default=5, help="Concurrent product fetches")
    parser.add_argument("--delay", type=float, default=2.0, help="Delay between requests (seconds)")
    parser.add_argument("--output", default=OUTPUT_FILE, help="Output NDJSON file")
    parser.add_argument("--no-proxy", action="store_true", help="Disable BrightData proxy")
    parser.add_argument("--max-per-sitemap", type=int, default=0, help="Max URLs per sitemap (0=unlimited)")
    args = parser.parse_args()

    scraper = LazadaTHSitemapScraper(
        limit=args.limit,
        sitemap_batch=args.sitemap_batch,
        product_batch=args.product_batch,
        delay=args.delay,
        output_file=args.output,
        use_proxy=not args.no_proxy,
        max_pages_per_sitemap=args.max_per_sitemap,
    )

    try:
        stats = await scraper.run()
        print(json.dumps(stats, indent=2))
    finally:
        await scraper.close()


if __name__ == "__main__":
    asyncio.run(main())
