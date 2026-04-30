"""
Flipkart India product scraper.

Flipkart blocks the previous direct HTTP endpoint, so this scraper uses
Playwright to render search result pages and extract real product cards from the
DOM. Output is written as JSONL under /home/paperclip/buywhere-api/data/flipkart
for the existing ingestion pipeline.
"""

import argparse
import asyncio
import json
import os
import re
import time
from pathlib import Path
from typing import Any
from urllib.parse import quote_plus, urljoin

import httpx
from playwright.async_api import Browser, BrowserContext, Page, Playwright, async_playwright

MERCHANT_ID = "flipkart"
SOURCE = "flipkart"
BASE_URL = "https://www.flipkart.com"
CURRENCY = "INR"

USER_AGENT = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
)

CATEGORIES = [
    {"id": "electronics-smartphones", "name": "Electronics", "sub": "Mobile Phones", "query": "smartphone"},
    {"id": "electronics-laptops", "name": "Electronics", "sub": "Laptops", "query": "laptop"},
    {"id": "electronics-audio", "name": "Electronics", "sub": "Audio & Headphones", "query": "headphones"},
    {"id": "electronics-cameras", "name": "Electronics", "sub": "Cameras", "query": "camera"},
    {"id": "electronics-tablets", "name": "Electronics", "sub": "Tablets", "query": "tablet"},
    {"id": "electronics-wearables", "name": "Electronics", "sub": "Wearables", "query": "smartwatch"},
    {"id": "electronics-accessories", "name": "Electronics", "sub": "Accessories", "query": "power bank"},
    {"id": "fashion-womens-tops", "name": "Fashion", "sub": "Women's Tops", "query": "women tops"},
    {"id": "fashion-womens-dresses", "name": "Fashion", "sub": "Women's Dresses", "query": "women dress"},
    {"id": "fashion-womens-ethnic", "name": "Fashion", "sub": "Women's Ethnic Wear", "query": "women kurti"},
    {"id": "fashion-mens-tshirts", "name": "Fashion", "sub": "Men's T-Shirts", "query": "men tshirt"},
    {"id": "fashion-mens-jeans", "name": "Fashion", "sub": "Men's Jeans", "query": "men jeans"},
    {"id": "fashion-shoes-mens", "name": "Fashion", "sub": "Men's Shoes", "query": "men shoes"},
    {"id": "fashion-shoes-womens", "name": "Fashion", "sub": "Women's Shoes", "query": "women shoes"},
    {"id": "fashion-bags", "name": "Fashion", "sub": "Bags & Luggage", "query": "backpack"},
    {"id": "fashion-watches", "name": "Fashion", "sub": "Watches", "query": "watch"},
    {"id": "home-furniture", "name": "Home & Living", "sub": "Furniture", "query": "furniture"},
    {"id": "home-kitchenware", "name": "Home & Living", "sub": "Kitchen & Dining", "query": "cookware"},
    {"id": "home-decor", "name": "Home & Living", "sub": "Home Decor", "query": "home decor"},
    {"id": "home-bedding", "name": "Home & Living", "sub": "Bedding", "query": "bedsheet"},
    {"id": "beauty-skincare", "name": "Health & Beauty", "sub": "Skincare", "query": "face wash"},
    {"id": "beauty-makeup", "name": "Health & Beauty", "sub": "Makeup", "query": "lipstick"},
    {"id": "beauty-haircare", "name": "Health & Beauty", "sub": "Hair Care", "query": "shampoo"},
    {"id": "beauty-fragrances", "name": "Health & Beauty", "sub": "Fragrances", "query": "perfume"},
    {"id": "sports-fitness", "name": "Sports & Outdoors", "sub": "Fitness Equipment", "query": "dumbbell"},
    {"id": "sports-outdoor", "name": "Sports & Outdoors", "sub": "Outdoor Gear", "query": "camping tent"},
    {"id": "appliances-ac", "name": "Appliances", "sub": "Air Conditioners", "query": "air conditioner"},
    {"id": "appliances-refrigerator", "name": "Appliances", "sub": "Refrigerators", "query": "refrigerator"},
    {"id": "appliances-washing", "name": "Appliances", "sub": "Washing Machines", "query": "washing machine"},
]


class FlipkartInScraper:
    def __init__(
        self,
        api_key: str,
        api_base: str = "http://localhost:8000",
        batch_size: int = 100,
        delay: float = 1.0,
        data_dir: str = "/home/paperclip/buywhere-api/data/flipkart",
        max_pages_per_category: int = 300,
        target_products: int = 100000,
        limit: int = 0,
        scrape_only: bool = False,
    ):
        self.api_key = api_key
        self.api_base = api_base.rstrip("/")
        self.batch_size = batch_size
        self.delay = delay
        self.data_dir = Path(data_dir)
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.max_pages_per_category = max_pages_per_category
        self.target_products = target_products
        self.limit = limit
        self.scrape_only = scrape_only
        self.client = httpx.AsyncClient(timeout=60.0)
        self.scraperapi_key = os.getenv("SCRAPERAPI_KEY", "").strip()
        self.total_scraped = 0
        self.total_ingested = 0
        self.total_updated = 0
        self.total_failed = 0
        self.seen_product_ids: set[str] = set()
        self._session_start = time.strftime("%Y%m%d_%H%M%S")
        self.products_outfile = str(self.data_dir / f"products_{self._session_start}.jsonl")
        self._playwright: Playwright | None = None
        self._browser: Browser | None = None
        self._context: BrowserContext | None = None
        self._page: Page | None = None

    async def _ensure_browser(self) -> Page:
        if self._page is not None:
            return self._page

        self._playwright = await async_playwright().start()
        self._browser = await self._playwright.chromium.launch(headless=True)
        self._context = await self._browser.new_context(
            user_agent=USER_AGENT,
            locale="en-IN",
            timezone_id="Asia/Kolkata",
            viewport={"width": 1440, "height": 2200},
        )
        await self._context.set_extra_http_headers(
            {
                "Accept-Language": "en-IN,en;q=0.9",
                "Referer": BASE_URL + "/",
            }
        )
        self._page = await self._context.new_page()
        return self._page

    async def close(self):
        await self.client.aclose()
        if self._page is not None:
            await self._page.close()
        if self._context is not None:
            await self._context.close()
        if self._browser is not None:
            await self._browser.close()
        if self._playwright is not None:
            await self._playwright.stop()

    @staticmethod
    def _build_search_url(query: str, page: int) -> str:
        return f"{BASE_URL}/search?q={quote_plus(query)}&page={page}"

    async def _load_page_via_scraperapi(self, url: str) -> bool:
        if not self.scraperapi_key:
            return False

        browser_page = await self._ensure_browser()
        try:
            resp = await self.client.get(
                "http://api.scraperapi.com",
                params={
                    "api_key": self.scraperapi_key,
                    "url": url,
                    "render": "true",
                    "country_code": "in",
                    "keep_headers": "true",
                },
            )
            resp.raise_for_status()
            html = resp.text
            if "Site is overloaded" in html or len(html) < 2000:
                return False
            await browser_page.set_content(html, wait_until="domcontentloaded")
            await browser_page.wait_for_timeout(1000)
            return True
        except Exception:
            return False

    async def _extract_cards_from_page(self) -> list[dict]:
        browser_page = await self._ensure_browser()
        cards = await browser_page.evaluate(
            r"""() => Array.from(document.querySelectorAll('div[data-id]')).map((card, index) => {
                const link = card.querySelector('a[href*="/p/"]');
                const img = card.querySelector('img[alt]');
                const titleEl = card.querySelector('div.RG5Slk, a[title], div.KzDlHZ, div.WKTcLC');
                const ratingEl = card.querySelector('span.CjyrHS, div.MKiFS6');
                const reviewEl = card.querySelector('span.PvbNMB');
                const priceEl = card.querySelector('div.hZ3P6w.DeU9vF, div.Nx9bqj._4b5DiR, div.Nx9bqj, div._30jeq3');
                const cardText = card.innerText || '';
                const priceCandidates = Array.from(card.querySelectorAll('*'))
                  .map((node) => (node.textContent || '').trim())
                  .filter((text) => /₹\s?[\d,]+/.test(text));
                const fallbackPrice = priceCandidates[0] || (cardText.match(/₹\s?[\d,]+/) || [''])[0];
                const fallbackReviews = (cardText.match(/\([\d,]+\)/) || [''])[0];
                const specs = Array.from(card.querySelectorAll('li')).map((node) => node.textContent.trim()).filter(Boolean);
                return {
                    product_id: card.getAttribute('data-id') || '',
                    title: (titleEl?.textContent || titleEl?.getAttribute('title') || img?.getAttribute('alt') || '').trim(),
                    product_url: link?.href || '',
                    image_url: img?.currentSrc || img?.src || '',
                    rating_text: (ratingEl?.textContent || '').trim(),
                    reviews_text: (reviewEl?.textContent || fallbackReviews || '').trim(),
                    price_text: (priceEl?.textContent || fallbackPrice || '').trim(),
                    specs,
                    rank: index + 1,
                };
            })"""
        )
        return [card for card in cards if card.get("product_id") and card.get("title")]

    @staticmethod
    def _parse_price(value: str | None) -> float:
        if not value:
            return 0.0
        rupee_match = re.search(r"₹\s*([\d,]+(?:\.\d+)?)", value)
        if rupee_match:
            return float(rupee_match.group(1).replace(",", ""))
        cleaned = value.replace(",", "").replace("₹", "").strip()
        match = re.search(r"\d+(?:\.\d+)?", cleaned)
        return float(match.group(0)) if match else 0.0

    @staticmethod
    def _parse_float(value: str | None) -> float | None:
        if not value:
            return None
        match = re.search(r"\d+(?:\.\d+)?", value.replace(",", ""))
        return float(match.group(0)) if match else None

    @staticmethod
    def _parse_int(value: str | None) -> int | None:
        if not value:
            return None
        digits = re.findall(r"\d+", value.replace(",", ""))
        return int("".join(digits)) if digits else None

    @staticmethod
    def _parse_review_count(value: str | None) -> int | None:
        if not value:
            return None
        match = re.search(r"\(([\d,]+)\)", value)
        if match:
            return int(match.group(1).replace(",", ""))
        match = re.search(r"([\d,]+)\s+Reviews", value, re.IGNORECASE)
        if match:
            return int(match.group(1).replace(",", ""))
        match = re.search(r"([\d,]+)\s+Ratings", value, re.IGNORECASE)
        if match:
            return int(match.group(1).replace(",", ""))
        return None

    async def fetch_search_page(self, category: dict, page: int = 1) -> list[dict]:
        browser_page = await self._ensure_browser()
        url = self._build_search_url(category["query"], page)

        for attempt in range(3):
            try:
                await browser_page.goto(url, wait_until="domcontentloaded", timeout=60000)
                await browser_page.wait_for_timeout(2000)
                body_text = await browser_page.locator("body").inner_text()
                if "Site is overloaded" in body_text:
                    raise RuntimeError("Flipkart returned overload page")
                cards = await self._extract_cards_from_page()
                if cards:
                    return cards
                raise RuntimeError("Flipkart DOM load returned no cards")
            except Exception:
                if await self._load_page_via_scraperapi(url):
                    cards = await self._extract_cards_from_page()
                    if cards:
                        return cards
                if attempt == 2:
                    return []
                await asyncio.sleep(2 ** attempt)
        return []

    def transform_product(self, raw: dict, category: dict, page: int) -> dict[str, Any] | None:
        try:
            product_id = str(raw.get("product_id") or "").strip()
            title = str(raw.get("title") or "").strip()
            if not product_id or not title:
                return None

            price = self._parse_price(raw.get("price_text"))
            if price <= 0:
                return None

            url = str(raw.get("product_url") or "").strip()
            if not url:
                return None
            if not url.startswith("http"):
                url = urljoin(BASE_URL, url)

            image_url = str(raw.get("image_url") or "").strip()
            if image_url.startswith("//"):
                image_url = "https:" + image_url

            brand = ""
            first_token = title.split()[0].strip("()[],:")
            if first_token and not any(char.isdigit() for char in first_token):
                brand = first_token[:80]

            rating = self._parse_float(raw.get("rating_text"))
            review_count = self._parse_review_count(raw.get("reviews_text"))
            specs = [spec for spec in (raw.get("specs") or []) if isinstance(spec, str) and spec]
            description = " | ".join(specs[:4])

            return {
                "sku": product_id,
                "merchant_id": MERCHANT_ID,
                "title": title,
                "description": description,
                "price": price,
                "currency": CURRENCY,
                "url": url,
                "image_url": image_url,
                "category": category["name"],
                "category_path": [category["name"], category["sub"]],
                "brand": brand,
                "is_active": True,
                "rating": rating,
                "review_count": review_count,
                "metadata": {
                    "product_id": product_id,
                    "source_query": category["query"],
                    "search_rank": raw.get("rank"),
                    "page": page,
                    "region": "in",
                    "country_code": "IN",
                    "specs": specs,
                },
            }
        except Exception:
            return None

    def _write_products_to_file(self, products: list[dict]) -> None:
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
            return len(products), 0, 0

        url = f"{self.api_base}/v1/ingest/products"
        headers = {"Authorization": f"Bearer {self.api_key}"}
        payload = {"source": SOURCE, "products": products}

        try:
            resp = await self.client.post(url, json=payload, headers=headers)
            resp.raise_for_status()
            result = resp.json()
            return (
                result.get("rows_inserted", 0),
                result.get("rows_updated", 0),
                result.get("rows_failed", 0),
            )
        except Exception as e:
            print(f"  Ingestion error: {e}")
            return 0, 0, len(products)

    async def scrape_category(self, category: dict) -> dict[str, int]:
        cat_name = category["name"]
        sub_name = category["sub"]
        query = category["query"]

        print(f"\n[{cat_name} / {sub_name}] Starting scrape for query={query!r}...")
        counts = {"scraped": 0, "ingested": 0, "updated": 0, "failed": 0}
        page = 1
        batch: list[dict[str, Any]] = []
        consecutive_empty = 0

        while consecutive_empty < 3 and page <= self.max_pages_per_category:
            if self.limit > 0 and self.total_scraped >= self.limit:
                print(f"  Limit of {self.limit} products reached!")
                break
            if self.target_products > 0 and self.total_scraped >= self.target_products:
                print(f"  Target total {self.target_products} reached!")
                break

            print(f"  Page {page}...", end=" ", flush=True)
            products_raw = await self.fetch_search_page(category, page)

            if not products_raw:
                consecutive_empty += 1
                print("No products found.")
                page += 1
                await asyncio.sleep(self.delay)
                continue

            unique_on_page = 0
            consecutive_empty = 0
            for raw in products_raw:
                if self.limit > 0 and self.total_scraped >= self.limit:
                    break

                transformed = self.transform_product(raw, category, page)
                if not transformed:
                    continue

                sku = transformed["sku"]
                if sku in self.seen_product_ids:
                    continue

                self.seen_product_ids.add(sku)
                batch.append(transformed)
                counts["scraped"] += 1
                self.total_scraped += 1
                unique_on_page += 1

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

            print(f"cards={len(products_raw)}, new={unique_on_page}, total={self.total_scraped}")

            if unique_on_page == 0 or len(products_raw) < 20:
                consecutive_empty += 1

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

        print(f"  [{cat_name} / {sub_name}] Done: {counts}")
        return counts

    async def run(self) -> dict[str, Any]:
        mode = "scrape only" if self.scrape_only else f"API: {self.api_base}"
        print("Flipkart India Scraper starting...")
        print(f"Mode: {mode}")
        print(f"Batch size: {self.batch_size}, Delay: {self.delay}s")
        print(f"Output: {self.products_outfile}")
        print(f"Categories: {len(CATEGORIES)}")
        print(f"Target: {self.target_products} products")

        start = time.time()

        for category in CATEGORIES:
            if self.limit > 0 and self.total_scraped >= self.limit:
                break
            if self.target_products > 0 and self.total_scraped >= self.target_products:
                break
            await self.scrape_category(category)
            await asyncio.sleep(1)

        elapsed = time.time() - start
        summary = {
            "elapsed_seconds": round(elapsed, 1),
            "total_scraped": self.total_scraped,
            "total_ingested": self.total_ingested,
            "total_updated": self.total_updated,
            "total_failed": self.total_failed,
            "output_file": self.products_outfile,
            "target": self.target_products,
        }

        print(f"\nScraper complete: {summary}")
        return summary


async def main():
    parser = argparse.ArgumentParser(description="Flipkart India Scraper")
    parser.add_argument("--api-key", default="", help="BuyWhere API key (not required with --scrape-only)")
    parser.add_argument("--api-base", default="http://localhost:8000", help="BuyWhere API base URL")
    parser.add_argument("--batch-size", type=int, default=100)
    parser.add_argument("--delay", type=float, default=1.0, help="Delay between batches (seconds)")
    parser.add_argument("--data-dir", default="/home/paperclip/buywhere-api/data/flipkart")
    parser.add_argument("--max-pages", type=int, default=300, help="Max pages per search query")
    parser.add_argument("--target-products", type=int, default=100000, help="Target total products")
    parser.add_argument("--limit", type=int, default=0, help="Maximum products to scrape (0 = unlimited)")
    parser.add_argument("--scrape-only", action="store_true", help="Save to JSONL without ingesting")
    args = parser.parse_args()

    if not args.api_key and not args.scrape_only:
        parser.error("--api-key is required unless --scrape-only is specified")

    scraper = FlipkartInScraper(
        api_key=args.api_key,
        api_base=args.api_base,
        batch_size=args.batch_size,
        delay=args.delay,
        data_dir=args.data_dir,
        max_pages_per_category=args.max_pages,
        target_products=args.target_products,
        limit=args.limit,
        scrape_only=args.scrape_only,
    )

    try:
        await scraper.run()
    finally:
        await scraper.close()


if __name__ == "__main__":
    asyncio.run(main())
