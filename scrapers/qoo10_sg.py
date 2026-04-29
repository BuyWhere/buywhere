"""
Qoo10 Singapore product scraper — BUY-5011 comprehensive verticals.

Scrapes Qoo10 SG categories using cloudscraper + proxy chains to bypass anti-bot
measures and outputs structured NDJSON matching the BuyWhere catalog schema for
ingestion via POST /v1/ingest/products.

BUY-5011 Target: 100,000+ products across all major verticals.

Usage:
    SCRAPERAPI_KEY=... python -m scrapers.qoo10_sg --api-key <key> --scrape-only
    SCRAPERAPI_KEY=... python -m scrapers.qoo10_sg --api-key <key> --limit 100000
    python -m scrapers.qoo10_sg --scrape-only --use-scraperapi --limit 50000
"""

import argparse
import asyncio
import json
import os
import re
import time
import urllib.parse
from typing import Any

import cloudscraper
import httpx

from scrapers.base_scraper import BaseScraper
from scrapers.scraper_registry import register

SCRAPERAPI_KEY = os.environ.get("SCRAPERAPI_KEY", "")
BRIGHTDATA_API_KEY = os.environ.get("BRIGHTDATA_API_KEY", "")

MERCHANT_ID = "qoo10_sg"
SOURCE = "qoo10_sg"
BASE_URL = "https://www.qoo10.sg"

OUTPUT_DIR = "/home/paperclip/buywhere/data"

CATEGORIES = [
    {"id": "005001", "name": "Fashion Women", "sub": "Women's Fashion", "url": "https://www.qoo10.sg/GMKT INC/Category/Category.aspx?classification=005001", "target": 10000},
    {"id": "005002", "name": "Fashion Men", "sub": "Men's Fashion", "url": "https://www.qoo10.sg/GMKT INC/Category/Category.aspx?classification=005002", "target": 8000},
    {"id": "005003", "name": "Fashion Kids", "sub": "Kids Fashion", "url": "https://www.qoo10.sg/GMKT INC/Category/Category.aspx?classification=005003", "target": 6000},
    {"id": "005004", "name": "Fashion Sports", "sub": "Sportswear", "url": "https://www.qoo10.sg/GMKT INC/Category/Category.aspx?classification=005004", "target": 5000},
    {"id": "005005", "name": "Fashion Bags", "sub": "Bags & Luggage", "url": "https://www.qoo10.sg/GMKT INC/Category/Category.aspx?classification=005005", "target": 5000},
    {"id": "005006", "name": "Fashion Shoes", "sub": "Shoes", "url": "https://www.qoo10.sg/GMKT INC/Category/Category.aspx?classification=005006", "target": 5000},
    {"id": "005007", "name": "Fashion Accessories", "sub": "Fashion Accessories", "url": "https://www.qoo10.sg/GMKT INC/Category/Category.aspx?classification=005007", "target": 4000},
    {"id": "004001", "name": "Beauty Skincare", "sub": "Skincare", "url": "https://www.qoo10.sg/GMKT INC/Category/Category.aspx?classification=004001", "target": 8000},
    {"id": "004002", "name": "Beauty Makeup", "sub": "Makeup", "url": "https://www.qoo10.sg/GMKT INC/Category/Category.aspx?classification=004002", "target": 8000},
    {"id": "004003", "name": "Beauty Fragrances", "sub": "Fragrances", "url": "https://www.qoo10.sg/GMKT INC/Category/Category.aspx?classification=004003", "target": 4000},
    {"id": "004004", "name": "Beauty Haircare", "sub": "Hair Care", "url": "https://www.qoo10.sg/GMKT INC/Category/Category.aspx?classification=004004", "target": 5000},
    {"id": "004005", "name": "Beauty Supplements", "sub": "Health Supplements", "url": "https://www.qoo10.sg/GMKT INC/Category/Category.aspx?classification=004005", "target": 6000},
    {"id": "001001", "name": "Electronics Audio", "sub": "Audio & Headphones", "url": "https://www.qoo10.sg/GMKT INC/Category/Category.aspx?classification=001001", "target": 6000},
    {"id": "001002", "name": "Electronics Computing", "sub": "Computers & Laptops", "url": "https://www.qoo10.sg/GMKT INC/Category/Category.aspx?classification=001002", "target": 7000},
    {"id": "001003", "name": "Electronics Gaming", "sub": "Gaming", "url": "https://www.qoo10.sg/GMKT INC/Category/Category.aspx?classification=001003", "target": 6000},
    {"id": "001004", "name": "Electronics Components", "sub": "Electronic Components", "url": "https://www.qoo10.sg/GMKT INC/Category/Category.aspx?classification=001004", "target": 5000},
    {"id": "001005", "name": "Electronics Accessories", "sub": "Mobile Accessories", "url": "https://www.qoo10.sg/GMKT INC/Category/Category.aspx?classification=001005", "target": 7000},
    {"id": "013001", "name": "Home Kitchen", "sub": "Kitchen", "url": "https://www.qoo10.sg/GMKT INC/Category/Category.aspx?classification=013001", "target": 6000},
    {"id": "013002", "name": "Home Decor", "sub": "Home Decor", "url": "https://www.qoo10.sg/GMKT INC/Category/Category.aspx?classification=013002", "target": 5000},
    {"id": "013003", "name": "Home Appliances", "sub": "Home Appliances", "url": "https://www.qoo10.sg/GMKT INC/Category/Category.aspx?classification=013003", "target": 5000},
    {"id": "002001", "name": "Food Beverages", "sub": "Food & Beverages", "url": "https://www.qoo10.sg/GMKT INC/Category/Category.aspx?classification=002001", "target": 7000},
    {"id": "002002", "name": "Grocery", "sub": "Grocery", "url": "https://www.qoo10.sg/GMKT INC/Category/Category.aspx?classification=002002", "target": 5000},
    {"id": "006001", "name": "Health Personal", "sub": "Personal Care", "url": "https://www.qoo10.sg/GMKT INC/Category/Category.aspx?classification=006001", "target": 5000},
    {"id": "006002", "name": "Health Medical", "sub": "Medical Supplies", "url": "https://www.qoo10.sg/GMKT INC/Category/Category.aspx?classification=006002", "target": 4000},
    {"id": "007001", "name": "Sports Outdoors", "sub": "Sports & Outdoors", "url": "https://www.qoo10.sg/GMKT INC/Category/Category.aspx?classification=007001", "target": 5000},
    {"id": "007002", "name": "Sports Equipment", "sub": "Sports Equipment", "url": "https://www.qoo10.sg/GMKT INC/Category/Category.aspx?classification=007002", "target": 4000},
    {"id": "010001", "name": "Toys Kids", "sub": "Toys & Kids", "url": "https://www.qoo10.sg/GMKT INC/Category/Category.aspx?classification=010001", "target": 5000},
    {"id": "010002", "name": "Baby Gear", "sub": "Baby Gear", "url": "https://www.qoo10.sg/GMKT INC/Category/Category.aspx?classification=010002", "target": 4000},
    {"id": "009001", "name": "Home Furniture", "sub": "Furniture", "url": "https://www.qoo10.sg/GMKT INC/Category/Category.aspx?classification=009001", "target": 4000},
    {"id": "014001", "name": "Pet Supplies", "sub": "Pet Supplies", "url": "https://www.qoo10.sg/GMKT INC/Category/Category.aspx?classification=014001", "target": 4000},
    {"id": "012001", "name": "Automotive", "sub": "Automotive", "url": "https://www.qoo10.sg/GMKT INC/Category/Category.aspx?classification=012001", "target": 4000},
    {"id": "003001", "name": "Books Stationery", "sub": "Books & Stationery", "url": "https://www.qoo10.sg/GMKT INC/Category/Category.aspx?classification=003001", "target": 4000},
    {"id": "011001", "name": "Gift Flowers", "sub": "Gifts & Flowers", "url": "https://www.qoo10.sg/GMKT INC/Category/Category.aspx?classification=011001", "target": 3000},
]

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "en-SG,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
    "Referer": "https://www.qoo10.sg/",
    "Upgrade-Insecure-Requests": "1",
}


def build_scraperapi_url(target_url: str, api_key: str) -> str:
    encoded_url = urllib.parse.quote(target_url, safe="")
    params = [
        f"api_key={api_key}",
        f"url={encoded_url}",
        "session=true",
        "ultra_premium=true",
    ]
    return f"http://api.scraperapi.com?{'&'.join(params)}"


@register("qoo10_sg")
class Qoo10SGScraper(BaseScraper):
    MERCHANT_ID = MERCHANT_ID
    SOURCE = SOURCE
    BASE_URL = BASE_URL
    DEFAULT_HEADERS = HEADERS

    def __init__(
        self,
        api_key: str,
        api_base: str = "http://localhost:8000",
        batch_size: int = 100,
        delay: float = 1.0,
        limit: int = 0,
        scrape_only: bool = False,
        max_concurrent: int = 4,
        target_products: int = 100000,
        max_pages_per_category: int = 200,
        scraperapi_key: str | None = None,
        use_scraperapi: bool = False,
    ):
        self.max_concurrent = max_concurrent
        self.target_products = target_products
        self.max_pages_per_category = max_pages_per_category
        self.use_scraperapi = use_scraperapi
        self.scraperapi_key = scraperapi_key or SCRAPERAPI_KEY
        self._semaphore: asyncio.Semaphore | None = None
        self._products_outfile: str | None = None
        self._ensure_output_dir()
        self._scraper = cloudscraper.create_scraper(
            browser={"browser": "chrome", "platform": "windows", "desktop": True},
            delay=10,
        )
        self._http_client = httpx.AsyncClient(timeout=30.0, headers=self.DEFAULT_HEADERS)
        super().__init__(
            api_key=api_key,
            api_base=api_base,
            batch_size=batch_size,
            delay=delay,
            data_dir=OUTPUT_DIR,
            limit=limit,
            scrape_only=scrape_only,
        )

    def _ensure_output_dir(self):
        os.makedirs(OUTPUT_DIR, exist_ok=True)
        ts = time.strftime("%Y%m%d_%H%M%S")
        self._products_outfile = os.path.join(OUTPUT_DIR, f"products_{ts}.ndjson")

    @property
    def products_outfile(self) -> str:
        if self._products_outfile is None:
            ts = time.strftime("%Y%m%d_%H%M%S")
            self._products_outfile = os.path.join(OUTPUT_DIR, f"products_{ts}.ndjson")
        return self._products_outfile

    def get_categories(self) -> list[dict]:
        return CATEGORIES

    def _build_category_url(self, category: dict, page: int) -> str:
        base = category["url"]
        separator = "&" if "?" in base else "?"
        return f"{base}{separator}display_count=100&page={page}&sort=popular"

    async def _fetch_via_scraperapi(self, url: str) -> str | None:
        if not self.scraperapi_key:
            return None
        proxy_url = build_scraperapi_url(url, self.scraperapi_key)
        for attempt in range(self.max_retries):
            try:
                resp = await self._http_client.get(proxy_url, timeout=60.0)
                if resp.status_code == 200:
                    return resp.text
                elif resp.status_code in (429, 503):
                    wait = 2 ** attempt * 5
                    self.log.progress(f"ScraperAPI rate limited ({resp.status_code}), waiting {wait}s")
                    await asyncio.sleep(wait)
                else:
                    self.log.request_failed(proxy_url, attempt, f"HTTP {resp.status_code}")
                    if attempt < self.max_retries - 1:
                        await asyncio.sleep(2 ** attempt)
                    else:
                        return None
            except Exception as e:
                if attempt < self.max_retries - 1:
                    await asyncio.sleep(2 ** attempt)
                else:
                    self.log.network_error(proxy_url, str(e))
                    return None
        return None

    async def fetch_page(self, category: dict, page: int) -> list[dict]:
        url = self._build_category_url(category, page)

        text = await self._fetch_via_scraperapi(url)
        if text:
            products = self._extract_products_from_html(text, category)
            if products:
                return products

        direct_failed = False
        for attempt in range(self.max_retries):
            try:
                resp = self._scraper.get(url)
                if resp.status_code == 200:
                    text = resp.text
                    products = self._extract_products_from_html(text, category)
                    if products:
                        return products
                elif resp.status_code in (429, 503):
                    wait = 2 ** attempt * 5
                    self.log.progress(f"Rate limited ({resp.status_code}), waiting {wait}s")
                    time.sleep(wait)
                else:
                    self.log.request_failed(url, attempt, f"HTTP {resp.status_code}")
                    if attempt < self.max_retries - 1:
                        time.sleep(2 ** attempt)
            except Exception as e:
                direct_failed = True
                if attempt < self.max_retries - 1:
                    time.sleep(2 ** attempt)
                else:
                    self.log.network_error(url, str(e))

        if direct_failed and self.scraperapi_key:
            self.log.progress("Direct connection failed, falling back to ScraperAPI")
            text = await self._fetch_via_scraperapi(url)
            if text:
                products = self._extract_products_from_html(text, category)
                if products:
                    return products

        return []

    def _extract_products_from_html(self, html: str, category: dict) -> list[dict]:
        products = []

        script_patterns = [
            r'var\s+goodsList\s*=\s*(\[{.*?}\]);',
            r'"goodsList"\s*:\s*(\[.*?\])',
            r'goods_list\s*:\s*(\[.*?\])',
        ]
        for pattern in script_patterns:
            match = re.search(pattern, html, re.DOTALL)
            if match:
                try:
                    items = json.loads(match.group(1))
                    for item in items:
                        products.append(item)
                    if products:
                        return products
                except (json.JSONDecodeError, KeyError, TypeError):
                    pass

        item_blocks = re.findall(
            r'<div[^>]*class="[^"]*item[^"]*"[^>]*>.*?<div[^>]*class="[^"]*price[^"]*"[^>]*>(.*?)</div>',
            html,
            re.DOTALL,
        )

        title_pattern = re.compile(r'<a[^>]*class="[^"]*title[^"]*"[^>]*title="([^"]+)"')
        price_pattern = re.compile(r'S\$\s*([\d,]+\.?\d*)')
        img_pattern = re.compile(r'<img[^>]*src="([^"]+)"[^>]*>')
        link_pattern = re.compile(r'<a[^>]*href="(/g/\d+)"')
        pid_pattern = re.compile(r'/g/(\d+)')

        for block in item_blocks[:100]:
            try:
                title_match = title_pattern.search(block)
                price_match = price_pattern.search(block)
                img_match = img_pattern.search(block)
                link_match = link_pattern.search(block)
                pid_match = pid_pattern.search(block)

                if title_match and pid_match:
                    pid = pid_match.group(1)
                    price_str = price_match.group(1).replace(",", "") if price_match else "0"
                    try:
                        price = float(price_str)
                    except ValueError:
                        price = 0.0

                    img_url = ""
                    if img_match:
                        raw_img = img_match.group(1)
                        if raw_img.startswith("//"):
                            raw_img = "https:" + raw_img
                        elif raw_img.startswith("/"):
                            raw_img = BASE_URL + raw_img
                        img_url = raw_img

                    product_url = BASE_URL + f"/g/{pid}" if pid_match else ""

                    products.append({
                        "product_id": pid,
                        "goods_name": title_match.group(1).strip(),
                        "goods_no": pid,
                        "goods_price": price,
                        "image_jan": img_url,
                        "product_url": product_url,
                    })
            except (KeyError, TypeError, AttributeError):
                continue

        if not products:
            row_pattern = re.compile(
                r'<td[^>]*class="[^"]*goods[^"]*"[^>]*>.*?<a[^>]*href="([^"]+)"[^>]*>(.*?)</a>',
                re.DOTALL,
            )
            rows = re.findall(row_pattern, html)
            for link, title_block in rows[:100]:
                pid_match = re.search(r'/g/(\d+)', link)
                if pid_match and title_block:
                    pid = pid_match.group(1)
                    title = re.sub(r'<[^>]+>', '', title_block).strip()
                    if title:
                        products.append({
                            "product_id": pid,
                            "goods_name": title,
                            "goods_no": pid,
                            "goods_price": 0.0,
                            "image_jan": "",
                            "product_url": BASE_URL + link,
                        })

        return products

    def transform(self, raw: dict, category: dict) -> dict[str, Any] | None:
        try:
            pid = str(
                raw.get("product_id", "")
                or raw.get("goods_no", "")
                or raw.get("goods_no", "")
                or raw.get("itemId", "")
                or ""
            )
            if not pid:
                return None

            name = (
                raw.get("goods_name", "")
                or raw.get("name", "")
                or raw.get("title", "")
                or raw.get("productTitle", "")
                or ""
            )
            if not name:
                return None

            price = raw.get("goods_price", 0.0)
            if isinstance(price, str):
                price = float(price.replace("$", "").replace(",", "").replace("S$", "") or 0)
            elif isinstance(price, int):
                price = float(price)
            elif not isinstance(price, float):
                try:
                    price = float(price)
                except (ValueError, TypeError):
                    price = 0.0

            image_url = (
                raw.get("image_jan", "")
                or raw.get("image_url", "")
                or raw.get("goods_image", "")
                or ""
            )
            if image_url and not image_url.startswith("http"):
                if image_url.startswith("//"):
                    image_url = "https:" + image_url
                elif image_url.startswith("/"):
                    image_url = BASE_URL + image_url

            product_url = (
                raw.get("product_url", "")
                or raw.get("url", "")
                or raw.get("productUrl", "")
                or f"{BASE_URL}/g/{pid}"
            )
            if product_url and not product_url.startswith("http"):
                product_url = BASE_URL + product_url if product_url.startswith("/") else product_url

            brand = raw.get("brand", "") or raw.get("brand_name", "") or ""
            if not brand:
                words = name.split()
                brand = words[0] if len(words) > 1 and len(words[0]) > 2 and words[0][0].isupper() else ""

            original_price = raw.get("original_price", raw.get("goods_price", price))
            if isinstance(original_price, str):
                original_price = float(original_price.replace("$", "").replace(",", "") or 0)

            discount = raw.get("discount", "0")
            if discount:
                discount = int(str(discount).replace("%", "") or 0)
            else:
                discount = 0

            primary_category = category["name"]
            sub_category = category["sub"]

            return {
                "product_id": f"{SOURCE}_{pid}",
                "name": name,
                "price": {"amount": price, "currency": "SGD"},
                "url": product_url,
                "image_url": image_url,
                "category": primary_category,
                "category_slug": sub_category.lower().replace(" & ", "-").replace(" ", "-"),
                "platform": SOURCE,
                "merchant_name": "Qoo10 SG",
                "merchant_id": MERCHANT_ID,
                "in_stock": True,
                "metadata": {
                    "brand": brand,
                    "original_price": original_price,
                    "discount_pct": discount,
                    "subcategory": sub_category,
                    "vertical": primary_category,
                    "source": SOURCE,
                    "qoo10_goods_no": pid,
                },
            }
        except Exception:
            return None

    async def scrape_category(self, category: dict) -> dict[str, int]:
        async with self._semaphore:
            cat_id = category["id"]
            cat_name = category.get("name", "")
            sub_name = category.get("sub", "")
            target = category.get("target", 2000)

            self.log.progress(f"[{cat_name} / {sub_name}] Starting scrape... (target: {target})")
            counts: dict[str, int] = {"scraped": 0, "ingested": 0, "updated": 0, "failed": 0, "pages": 0}
            page = 1
            batch: list[dict] = []
            consecutive_empty = 0

            while consecutive_empty < 5 and page <= self.max_pages_per_category:
                if self.limit > 0 and self.total_scraped >= self.limit:
                    self.log.progress(f"Product limit {self.limit} reached!")
                    break
                if self.total_scraped >= self.target_products:
                    self.log.progress(f"Target total {self.target_products} reached!")
                    break

                products_raw = await self.fetch_page(category, page)

                if not products_raw:
                    consecutive_empty += 1
                    if consecutive_empty >= 3:
                        self.log.progress(f"No products for 3 consecutive pages, ending pagination for {cat_id}")
                        break
                    page += 1
                    await asyncio.sleep(self.delay)
                    continue

                consecutive_empty = 0
                counts["pages"] += 1

                for raw in products_raw:
                    if self.limit > 0 and self.total_scraped >= self.limit:
                        break
                    if self.total_scraped >= self.target_products:
                        break
                    try:
                        transformed = self.transform(raw, category)
                    except Exception as e:
                        self.log.transform_error(None, f"{type(e).__name__}: {e}")
                        continue

                    if transformed:
                        batch.append(transformed)
                        counts["scraped"] += 1
                        self.total_scraped += 1

                        if len(batch) >= self.batch_size:
                            i, u, f = await self.ingest_batch(batch)
                            counts["ingested"] += i
                            counts["updated"] += u
                            counts["failed"] += f
                            self.total_ingested += i
                            self.total_updated += u
                            self.total_failed += f
                            batch = []
                            await asyncio.sleep(self.delay)

                self.log.progress(f"  page={page}, scraped={counts['scraped']}, total={self.total_scraped}")

                if len(products_raw) < 20:
                    break

                page += 1
                await asyncio.sleep(self.delay)

            if batch:
                i, u, f = await self.ingest_batch(batch)
                counts["ingested"] += i
                counts["updated"] += u
                counts["failed"] += f
                self.total_ingested += i
                self.total_updated += u
                self.total_failed += f

            self.log.progress(f"[{cat_name} / {sub_name}] Done: {counts}")
            return counts

    async def run(self) -> dict[str, Any]:
        self._semaphore = asyncio.Semaphore(self.max_concurrent)
        mode = "scrape only" if self.scrape_only else f"API: {self.api_base}"
        self.log.progress(f"Qoo10 SG Scraper starting...")
        self.log.progress(f"Mode: {mode}")
        self.log.progress(f"Batch size: {self.batch_size}, Delay: {self.delay}s, Max concurrent: {self.max_concurrent}")
        self.log.progress(f"Output: {self.products_outfile}")
        self.log.progress(f"Categories: {len(CATEGORIES)} subcategories")
        self.log.progress(f"Target: {self.target_products} products")
        self.log.progress(f"ScraperAPI: {'enabled' if self.scraperapi_key else 'disabled'}")

        start = time.time()

        tasks = [self.scrape_category(cat) for cat in CATEGORIES]
        await asyncio.gather(*tasks)

        elapsed = time.time() - start

        summary = {
            "elapsed_seconds": round(elapsed, 1),
            "total_scraped": self.total_scraped,
            "total_ingested": self.total_ingested,
            "total_updated": self.total_updated,
            "total_failed": self.total_failed,
            "output_file": self.products_outfile,
            "target": self.target_products,
            "categories_covered": len(CATEGORIES),
        }

        self.log.progress(f"Scraper complete: {summary}")
        return summary

    async def close(self) -> None:
        await self._http_client.aclose()
        await super().close()

    @classmethod
    def add_cli_args(cls, parser: argparse.ArgumentParser) -> None:
        parser.add_argument("--api-key", required=True, help="BuyWhere API key")
        parser.add_argument("--api-base", default="http://localhost:8000", help="BuyWhere API base URL")
        parser.add_argument("--batch-size", type=int, default=100, help="Batch size for ingestion")
        parser.add_argument("--delay", type=float, default=1.0, help="Delay between pages (seconds)")
        parser.add_argument("--limit", type=int, default=0, help="Maximum number of products to scrape (0 = unlimited)")
        parser.add_argument("--scrape-only", action="store_true", help="Save to NDJSON without ingesting")
        parser.add_argument("--max-concurrent", type=int, default=4, help="Max concurrent category scrapes")
        parser.add_argument("--target", type=int, default=100000, help="Target number of products")
        parser.add_argument("--max-pages", type=int, default=200, help="Max pages per category")
        parser.add_argument("--scraperapi-key", default=None, help="ScraperAPI key (or set SCRAPERAPI_KEY env var)")
        parser.add_argument("--use-scraperapi", action="store_true", help="Force ScraperAPI for all requests")

    @classmethod
    def from_args(cls, args: argparse.Namespace) -> "Qoo10SGScraper":
        return cls(
            api_key=args.api_key,
            api_base=args.api_base,
            batch_size=args.batch_size,
            delay=args.delay,
            limit=args.limit,
            scrape_only=args.scrape_only,
            max_concurrent=args.max_concurrent,
            target_products=args.target,
            max_pages_per_category=args.max_pages,
            scraperapi_key=args.scraperapi_key,
            use_scraperapi=args.use_scraperapi,
        )


async def main():
    parser = argparse.ArgumentParser(description="Qoo10 SG Scraper")
    Qoo10SGScraper.add_cli_args(parser)
    args = parser.parse_args()
    scraper = Qoo10SGScraper.from_args(args)
    try:
        await scraper.run()
    finally:
        await scraper.close()


if __name__ == "__main__":
    asyncio.run(main())
