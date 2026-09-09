"""
ezbuy Singapore product scraper — Playwright-based.

Scrapes products from ezbuy.sg and outputs structured JSON
matching the BuyWhere catalog schema for ingestion via /v1/ingest/products.

Site: ezbuy.sg (cross-border e-commerce aggregator)
Strategy: Playwright for headless Chromium to:
- Render JavaScript and extract DOM-based product data
- Bypass Cloudflare bot protection
- Respectful crawling with delay between requests

Usage:
    python -m scrapers.ezbuy_sg --api-key <key> [--batch-size 100] [--delay 1.0]
    python -m scrapers.ezbuy_sg --scrape-only  # save JSONL without ingesting
    python -m scrapers.ezbuy_sg --scrape-only --limit 100  # test with 100 products

Categories covered: Fashion, Electronics, Home, Beauty, Sports
Target: 20,000+ products
"""

import argparse
import asyncio
import json
import re
import time
from pathlib import Path
from typing import Any

from playwright.async_api import async_playwright, Page

from scrapers.logging import get_logger
from scrapers.scraper_registry import register

MERCHANT_ID = "ezbuy_sg"
SOURCE = "ezbuy_sg"
BASE_URL = "https://www.ezbuy.sg"
OUTPUT_DIR = "/home/paperclip/buywhere-api/data/ezbuy"

log = get_logger(MERCHANT_ID)

CATEGORIES = [
    {"id": "fashion", "name": "Fashion", "url": "https://www.ezbuy.sg/category/5/women-s-fashion.html"},
    {"id": "electronics", "name": "Electronics", "url": "https://www.ezbuy.sg/category?keywords=electronics"},
    {"id": "home", "name": "Home", "url": "https://www.ezbuy.sg/category?keywords=home"},
    {"id": "beauty", "name": "Beauty", "url": "https://www.ezbuy.sg/category?keywords=beauty"},
    {"id": "sports", "name": "Sports", "url": "https://www.ezbuy.sg/category?keywords=sports"},
]


@register("ezbuy_sg")
class EzbuySGCraper:
    def __init__(
        self,
        api_key: str,
        api_base: str = "http://localhost:8000",
        batch_size: int = 100,
        delay: float = 1.0,
        data_dir: str = OUTPUT_DIR,
        limit: int = 0,
        scrape_only: bool = False,
        max_retries: int = 3,
        headless: bool = True,
    ):
        self.api_key = api_key
        self.api_base = api_base.rstrip("/")
        self.batch_size = batch_size
        self.delay = delay
        self.data_dir = Path(data_dir)
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.limit = limit
        self.scrape_only = scrape_only
        self.max_retries = max_retries
        self.headless = headless
        self._playwright = None
        self._browser = None
        self._page = None
        self._client = None
        self.total_scraped = 0
        self.total_saved = 0
        self.total_ingested = 0
        self.total_updated = 0
        self.total_failed = 0
        self._seen_ids = set()
        self._ensure_output_dir()

    def _ensure_output_dir(self):
        self.data_dir.mkdir(parents=True, exist_ok=True)

    @property
    def products_outfile(self) -> str:
        ts = time.strftime("%Y%m%d_%H%M%S")
        return str(self.data_dir / f"ezbuy_sg_{ts}.jsonl")

    @classmethod
    def add_cli_args(cls, parser: argparse.ArgumentParser) -> None:
        parser.add_argument("--api-key", default=None, help="BuyWhere API key")
        parser.add_argument("--api-base", default="http://localhost:8000", help="BuyWhere API base URL")
        parser.add_argument("--batch-size", type=int, default=100, help="Batch size for ingestion")
        parser.add_argument("--delay", type=float, default=1.0, help="Delay between requests (seconds)")
        parser.add_argument("--data-dir", default=OUTPUT_DIR, help="Directory to save scraped JSONL data")
        parser.add_argument("--limit", type=int, default=0, help="Maximum products to scrape (0=unlimited)")
        parser.add_argument("--scrape-only", action="store_true", help="Save to JSONL without ingesting")
        parser.add_argument("--no-headless", action="store_true", help="Run browser in visible mode")

    @classmethod
    def from_args(cls, args: argparse.Namespace) -> "EzbuySGCraper":
        return cls(
            api_key=args.api_key,
            api_base=args.api_base,
            batch_size=args.batch_size,
            delay=args.delay,
            data_dir=args.data_dir or OUTPUT_DIR,
            limit=args.limit,
            scrape_only=args.scrape_only,
            headless=not getattr(args, 'no_headless', False),
        )

    async def _ensure_browser(self):
        if self._browser is None:
            self._playwright = await async_playwright().start()
            self._browser = await self._playwright.chromium.launch(
                headless=self.headless,
                args=["--disable-blink-features=AutomationControlled"]
            )
            context = await self._browser.new_context(
                viewport={"width": 1920, "height": 1080},
                locale="en-SG",
                user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            )
            await context.add_init_script("""
                Object.defineProperty(navigator, 'webdriver', {get: () => undefined});
                window.navigator.chrome = {runtime: {}};
            """)
            self._page = await context.new_page()
            self._page.set_default_timeout(30000)
            self._client = await context.new_cdp_session(self._page)

    async def _scroll_and_wait(self, page: Page, max_scrolls: int = 10):
        for _ in range(max_scrolls):
            await page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
            await asyncio.sleep(1)

    async def _get_page_html(self, url: str) -> str | None:
        await self._ensure_browser()
        page = self._page
        if page is None:
            return None
        for attempt in range(self.max_retries):
            try:
                await page.goto(url, wait_until="domcontentloaded", timeout=30000)
                await asyncio.sleep(3)
                await self._scroll_and_wait(page, 5)
                await asyncio.sleep(2)
                return await page.content()
            except Exception as e:
                log.request_failed(url, attempt, str(e))
                if attempt < self.max_retries - 1:
                    await asyncio.sleep(2 ** attempt)
                else:
                    return None
        return None

    def _extract_products_from_html(self, html: str, category: dict) -> list[dict]:
        from bs4 import BeautifulSoup
        products = []
        soup = BeautifulSoup(html, 'html.parser')

        for link in soup.find_all('a', href=re.compile(r'/product/\d+\.html')):
            try:
                href = str(link.get('href', ''))
                gpid_match = re.search(r'/product/(\d+)', href)
                if not gpid_match:
                    continue
                
                gpid = gpid_match.group(1)
                if gpid in self._seen_ids:
                    continue
                self._seen_ids.add(gpid)

                title = ''
                img = link.find('img')
                if img:
                    title = str(img.get('alt', '') or img.get('title', '') or '')

                price = 0.0
                for price_el in link.find_all(['span', 'div'], class_=re.compile(r'price', re.I)):
                    price_text = price_el.get_text(strip=True)
                    price_match = re.search(r'[\d,]+\.?\d*', price_text.replace('$', ''))
                    if price_match:
                        try:
                            price = float(price_match.group().replace(',', ''))
                            break
                        except ValueError:
                            pass

                img_url = ''
                if img:
                    img_url = str(img.get('data-src', '') or img.get('src', '') or '')
                    if img_url and not img_url.startswith('http'):
                        if img_url.startswith('//'):
                            img_url = 'https:' + img_url
                        elif img_url.startswith('/'):
                            img_url = BASE_URL + img_url

                url = BASE_URL + href if href.startswith('/') else href

                products.append({
                    "gpid": gpid,
                    "title": title or f"Product {gpid}",
                    "price": price,
                    "image_url": img_url,
                    "url": url,
                    "category": category.get("name", ""),
                })
            except Exception:
                continue

        return products

    async def _fetch_product_details(self, gpid: str, category: dict) -> dict | None:
        product_url = f"{BASE_URL}/product/{gpid}.html"
        page = self._page
        if page is None:
            return None
        try:
            await page.goto(product_url, wait_until="domcontentloaded", timeout=15000)
            await asyncio.sleep(1)
            html = await page.content()
            
            from bs4 import BeautifulSoup
            soup = BeautifulSoup(html, 'html.parser')
            
            title = ''
            title_el = soup.find(['h1', 'span'], class_=re.compile(r'.*title.*|.*name.*', re.I))
            if title_el:
                title = title_el.get_text(strip=True)
            
            if not title:
                title_el = soup.find('title')
                if title_el:
                    title = title_el.get_text(strip=True)
            
            price = 0.0
            price_el = soup.find(['span', 'div'], class_=re.compile(r'.*price.*', re.I))
            if price_el:
                price_text = price_el.get_text(strip=True)
                price_match = re.search(r'[\d,]+\.?\d*', price_text.replace('$', ''))
                if price_match:
                    try:
                        price = float(price_match.group().replace(',', ''))
                    except ValueError:
                        pass
            
            img_url = ''
            img_el = soup.find('img', attrs={'id': re.compile(r'.*main.*|.*product.*', re.I)})
            if img_el:
                img_url = img_el.get('src', '') or img_el.get('data-src', '')
            
            description = ''
            desc_el = soup.find(['div', 'span'], class_=re.compile(r'.*desc.*|.*detail.*|.*spec.*', re.I))
            if desc_el:
                description = desc_el.get_text(strip=True)[:500]
            
            return {
                "gpid": gpid,
                "title": title,
                "price": price,
                "image_url": img_url,
                "url": product_url,
                "category": category.get("name", ""),
                "description": description,
            }
        except Exception as e:
            log.network_error(product_url, str(e))
            return None

    def transform_product(self, raw: dict, category: dict) -> dict | None:
        try:
            gpid = str(raw.get("gpid", ""))
            if not gpid:
                return None

            title = raw.get("title", "").strip()
            if not title:
                return None

            price = raw.get("price", 0.0)
            if isinstance(price, str):
                price = float(price.replace("$", "").replace(",", "") or 0)

            img = raw.get("image_url", "")
            if img and not img.startswith("http"):
                if img.startswith("//"):
                    img = "https:" + img
                elif img.startswith("/"):
                    img = BASE_URL + img

            product_url = raw.get("url", f"{BASE_URL}/product/{gpid}.html")

            return {
                "sku": f"ezbuy_{gpid}",
                "merchant_id": MERCHANT_ID,
                "title": title,
                "description": raw.get("description", ""),
                "price": price,
                "currency": "SGD",
                "url": product_url,
                "image_url": img,
                "category": category.get("name", ""),
                "category_path": [category.get("name", "")],
                "brand": "",
                "is_active": True,
                "in_stock": True,
                "stock_level": None,
                "metadata": {
                    "source_type": "playwright_scrape",
                    "ezbuy_gpid": gpid,
                },
            }
        except Exception as e:
            log.transform_error(None, str(e))
            return None

    def _write_products_to_file(self, products: list[dict]):
        if not products:
            return
        with open(self.products_outfile, "a", encoding="utf-8") as f:
            for p in products:
                f.write(json.dumps(p, ensure_ascii=False) + "\n")

    async def ingest_batch(self, products: list[dict]) -> tuple[int, int, int]:
        if not products:
            return 0, 0, 0

        if self.scrape_only:
            self._write_products_to_file(products)
            self.total_saved += len(products)
            return 0, 0, 0

        if self._client is None:
            await self._ensure_browser()
        
        page = self._page
        if page is None:
            return 0, 0, len(products)

        url = f"{self.api_base}/v1/ingest/products"
        payload = {"source": SOURCE, "products": products}

        try:
            resp = await page.evaluate(f"""async () => {{
                const response = await fetch('{url}', {{
                    method: 'POST',
                    headers: {{
                        'Authorization': 'Bearer {self.api_key}',
                        'Content-Type': 'application/json'
                    }},
                    body: JSON.stringify({json.dumps(payload)})
                }});
                return await response.json();
            }}""")
            if resp:
                return (
                    resp.get("rows_inserted", 0),
                    resp.get("rows_updated", 0),
                    resp.get("rows_failed", 0),
                )
            return 0, 0, len(products)
        except Exception as e:
            log.ingestion_error(None, str(e))
            return 0, 0, len(products)

    async def scrape_category(self, category: dict) -> dict[str, int]:
        cat_id = category.get("id", "")
        cat_name = category.get("name", "")

        log.progress(f"[{cat_name}] Starting scrape...")

        counts: dict[str, int] = {"scraped": 0, "pages": 0, "failed": 0}
        seen_gpids = set()
        page = 1
        max_pages = 50
        batch = []

        while page <= max_pages:
            if self.limit > 0 and self.total_scraped >= self.limit:
                log.progress(f"[{cat_name}] Product limit of {self.limit} reached!")
                break

            page_url = category.get("url", "")
            if page > 1:
                if "?" in page_url:
                    page_url = f"{page_url}&page={page}"
                else:
                    page_url = f"{page_url}?page={page}"

            log.progress(f"  [{cat_name}] page={page}...")
            html = await self._get_page_html(page_url)

            if not html:
                log.progress(f"  [{cat_name}] No HTML returned for page {page}")
                break

            from bs4 import BeautifulSoup
            soup = BeautifulSoup(html, 'html.parser')

            products_found = 0
            for link in soup.find_all('a', href=re.compile(r'/product/\d+\.html')):
                try:
                    href = link.get('href', '')
                    gpid_match = re.search(r'/product/(\d+)', href)
                    if not gpid_match:
                        continue
                    
                    gpid = gpid_match.group(1)
                    if gpid in seen_gpids:
                        continue
                    seen_gpids.add(gpid)

                    title = ''
                    img = link.find('img')
                    if img:
                        title = img.get('alt', '') or img.get('title', '')
                    
                    price = 0.0
                    for price_el in link.find_all(['span', 'div'], class_=re.compile(r'price', re.I)):
                        price_text = price_el.get_text(strip=True)
                        price_match = re.search(r'[\d,]+\.?\d*', price_text.replace('$', ''))
                        if price_match:
                            try:
                                price = float(price_match.group().replace(',', ''))
                                break
                            except ValueError:
                                pass

                    img_url = ''
                    if img:
                        img_url = img.get('data-src', '') or img.get('src', '')
                        if img_url and not img_url.startswith('http'):
                            if img_url.startswith('//'):
                                img_url = 'https:' + img_url
                            elif img_url.startswith('/'):
                                img_url = BASE_URL + img_url

                    raw_product = {
                        "gpid": gpid,
                        "title": title or f"Product {gpid}",
                        "price": price,
                        "image_url": img_url,
                        "url": BASE_URL + href if href.startswith('/') else href,
                        "category": cat_name,
                    }

                    transformed = self.transform_product(raw_product, category)
                    if transformed:
                        batch.append(transformed)
                        counts["scraped"] += 1
                        self.total_scraped += 1
                        products_found += 1

                        if len(batch) >= self.batch_size:
                            i, u, f = await self.ingest_batch(batch)
                            self.total_ingested += i
                            self.total_updated += u
                            self.total_failed += f
                            batch = []
                            await asyncio.sleep(self.delay)

                except Exception as e:
                    log.transform_error(None, str(e))
                    continue

            counts["pages"] += 1
            log.progress(f"  [{cat_name}] page={page}, found={products_found}, total={self.total_scraped}")

            if products_found < 10:
                log.progress(f"  [{cat_name}] Less than 10 products, ending pagination")
                break

            page += 1
            await asyncio.sleep(self.delay)

        if batch:
            i, u, f = await self.ingest_batch(batch)
            self.total_ingested += i
            self.total_updated += u
            self.total_failed += f

        log.progress(f"[{cat_name}] Done: {counts}")
        return counts

    async def close(self):
        if self._browser:
            await self._browser.close()
        if self._playwright:
            await self._playwright.stop()

    async def run(self) -> dict[str, Any]:
        log.progress(f"ezbuy SG Scraper starting...")
        log.progress(f"API: {self.api_base}")
        log.progress(f"Batch size: {self.batch_size}, Delay: {self.delay}s")
        log.progress(f"Limit: {self.limit or 'unlimited'}")
        log.progress(f"Output file: {self.products_outfile}")
        log.progress(f"Categories: {[c['name'] for c in CATEGORIES]}")

        start = time.time()

        for cat in CATEGORIES:
            if self.limit > 0 and self.total_scraped >= self.limit:
                break
            await self.scrape_category(cat)
            await asyncio.sleep(2)

        elapsed = time.time() - start

        summary = {
            "elapsed_seconds": round(elapsed, 1),
            "total_scraped": self.total_scraped,
            "total_ingested": self.total_ingested,
            "total_updated": self.total_updated,
            "total_failed": self.total_failed,
            "output_file": self.products_outfile,
        }

        log.progress(f"Scraper complete: {summary}")
        return summary


async def main():
    parser = argparse.ArgumentParser(description="ezbuy SG Scraper")
    EzbuySGCraper.add_cli_args(parser)
    args = parser.parse_args()

    scraper = EzbuySGCraper.from_args(args)

    try:
        await scraper.run()
    finally:
        await scraper.close()


if __name__ == "__main__":
    asyncio.run(main())