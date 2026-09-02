"""
eBay US product scraper — ScraperAPI with JS rendering.
"""

import argparse
import asyncio
import json
import os
import re
import time
from typing import Any

import httpx

MERCHANT_ID = "ebay_us"
SOURCE = "ebay_us"
BASE_URL = "https://www.ebay.com"
OUTPUT_DIR = "/home/paperclip/buywhere-api/data/ebay_us"
CURRENCY = "USD"
REGION = "us"
COUNTRY_CODE = "US"

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}

CATEGORIES = [
    {"id": "electronics_computers", "name": "Electronics", "keyword": "computers laptops", "max_pages": 200},
    {"id": "electronics_phones", "name": "Electronics", "keyword": "smartphone mobile phone", "max_pages": 200},
    {"id": "electronics_tablets", "name": "Electronics", "keyword": "tablets e-readers ipad", "max_pages": 200},
    {"id": "electronics_tv", "name": "Electronics", "keyword": "TV LED LCD television", "max_pages": 200},
    {"id": "electronics_cameras", "name": "Electronics", "keyword": "digital camera camera", "max_pages": 200},
    {"id": "electronics_gaming", "name": "Electronics", "keyword": "gaming console playstation xbox switch", "max_pages": 200},
    {"id": "electronics_headphones", "name": "Electronics", "keyword": "headphones earbuds wireless audio", "max_pages": 200},
    {"id": "electronics_watches", "name": "Electronics", "keyword": "smart watch fitness tracker", "max_pages": 200},
    {"id": "fashion_women", "name": "Fashion", "keyword": "women clothing dress tops", "max_pages": 200},
    {"id": "fashion_men", "name": "Fashion", "keyword": "men clothing shirts pants", "max_pages": 200},
    {"id": "fashion_shoes", "name": "Fashion", "keyword": "shoes sneakers footwear", "max_pages": 200},
    {"id": "fashion_bags", "name": "Fashion", "keyword": "handbags purses bags", "max_pages": 200},
    {"id": "fashion_jewelry", "name": "Fashion", "keyword": "jewelry rings necklaces bracelet", "max_pages": 200},
    {"id": "fashion_watches", "name": "Fashion", "keyword": "watches wristwatches", "max_pages": 200},
    {"id": "collectibles_coins", "name": "Collectibles", "keyword": "coins collectible money", "max_pages": 200},
    {"id": "collectibles_cards", "name": "Collectibles", "keyword": "trading cards Pokemon Magic", "max_pages": 200},
    {"id": "collectibles_figurines", "name": "Collectibles", "keyword": "figurines anime collectibles", "max_pages": 200},
    {"id": "collectibles_vintage", "name": "Collectibles", "keyword": "vintage collectibles antiques", "max_pages": 200},
    {"id": "home_furniture", "name": "Home & Garden", "keyword": "furniture home decor", "max_pages": 200},
    {"id": "home_kitchen", "name": "Home & Garden", "keyword": "kitchen appliances cookware", "max_pages": 200},
    {"id": "auto_parts", "name": "Auto", "keyword": "auto parts car accessories", "max_pages": 200},
]


def build_scraperapi_url(url: str, api_key: str, render: bool = True) -> str:
    encoded_url = url
    params = f"api_key={api_key}&url={encoded_url}&country_code=US"
    if render:
        params += "&render=true"
    return f"http://api.scraperapi.com/?{params}"


def extract_brand(title: str) -> str:
    known_brands = ["Apple", "Samsung", "Sony", "LG", "Dell", "HP", "Lenovo", "Nike", "Adidas", "Zara", "H&M", "Uniqlo", "Canon", "Nikon", "Bose", "JBL", "Dyson", "KitchenAid", "Cuisinart", "Asus", "Acer", "Microsoft", "Google", "OnePlus", "Panasonic", "Sharp", "Toshiba", "Huawei", "Xiaomi", "Oppo", "Vivo", "Motorola", "TCL", "Hisense", "Polaroid", "Fujifilm", "Olympus", "GoPro", "DJI", "Fitbit", "Garmin", "Fossil", "Timex", "Seiko", "Casio", "Omega", "Rolex", "Levi's", "Champion", "Under Armour", "North Face", "Patagonia"]
    title_lower = title.lower()
    for brand in known_brands:
        if title_lower.startswith(brand.lower()) or f" {brand.lower()} " in title_lower or f" {brand.lower()}-" in title_lower:
            return brand
    return ""


class EbayUSScraperAPI:
    def __init__(self, api_key: str, api_base: str = "http://localhost:8000", batch_size: int = 100, delay: float = 1.5, scrape_only: bool = False, limit: int = 0, max_pages_per_keyword: int = 200):
        self.api_key = api_key
        self.api_base = api_base.rstrip("/")
        self.batch_size = batch_size
        self.delay = delay
        self.scrape_only = scrape_only
        self.limit = limit
        self.max_pages_per_keyword = max_pages_per_keyword
        self.client = httpx.AsyncClient(timeout=120.0, headers=HEADERS)
        self.total_scraped = 0
        self.total_ingested = 0
        self.total_updated = 0
        self.total_failed = 0
        self.seen_item_ids: set[str] = set()
        self._outfile = None
        self._ensure_output_dir()
        self._api_calls = 0
        self._consecutive_empty = 0

    def _ensure_output_dir(self):
        os.makedirs(OUTPUT_DIR, exist_ok=True)
        ts = time.strftime("%Y%m%d_%H%M%S")
        self._outfile = os.path.join(OUTPUT_DIR, f"products_{ts}.jsonl")

    async def close(self):
        await self.client.aclose()

    async def _fetch_page(self, url: str) -> str | None:
        self._api_calls += 1
        scraperapi_url = build_scraperapi_url(url, self.api_key, render=True)
        try:
            resp = await self.client.get(scraperapi_url, timeout=120.0)
            if resp.status_code == 200:
                return resp.text
            return None
        except Exception:
            return None

    def _extract_products_from_json(self, html: str, category_name: str) -> list[dict[str, Any]]:
        products = []
        try:
            item_ids = re.findall(r'"itemId":\s*(\d+)', html)
            for item_id in item_ids:
                products.append({"item_id": item_id, "title": f"eBay item {item_id}", "price": 0.0, "url": f"{BASE_URL}/itm/{item_id}", "image_url": "", "condition": "Unknown", "seller": "", "shipping_cost": 0.0, "location": "", "category_name": category_name, "_from_json": True})
        except Exception:
            pass
        return products

    def transform_product(self, raw: dict, category: dict) -> dict | None:
        try:
            item_id = str(raw.get("item_id", ""))
            if not item_id:
                return None
            if item_id in self.seen_item_ids:
                return None
            self.seen_item_ids.add(item_id)
            title = raw.get("title", "")
            if not title or title in ("None", ""):
                title = f"eBay item {item_id}"
            price = raw.get("price", 0.0)
            url = raw.get("url", f"{BASE_URL}/itm/{item_id}")
            image_url = raw.get("image_url", "")
            brand = extract_brand(title)
            seller = raw.get("seller", "")
            shipping_cost = raw.get("shipping_cost", 0.0)
            location = raw.get("location", "")
            condition_display = raw.get("condition", "Unknown")
            category_name = raw.get("category_name", category.get("name", ""))
            return {"sku": f"ebay_us_{item_id}", "merchant_id": MERCHANT_ID, "title": title, "description": f"Condition: {condition_display}", "price": price, "currency": CURRENCY, "url": url, "image_url": image_url, "category": category.get("name", ""), "category_path": [category.get("name", ""), category_name], "brand": brand, "is_active": True, "metadata": {"item_id": item_id, "condition": condition_display, "source_url": url, "seller": seller, "shipping_cost": shipping_cost, "location": location, "listing_type": "FixedPrice", "region": REGION, "country_code": COUNTRY_CODE}}
        except Exception:
            return None

    def _write_products_to_file(self, products: list[dict]):
        if not products or not self._outfile:
            return
        with open(self._outfile, "a", encoding="utf-8") as f:
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
            return (result.get("rows_inserted", 0), result.get("rows_updated", 0), result.get("rows_failed", 0))
        except Exception:
            self._write_products_to_file(products)
            return 0, 0, len(products)

    async def scrape_keyword(self, keyword: str, category_name: str, max_pages: int = 200) -> dict[str, int]:
        print(f"\n[{category_name}] Scraping keyword: '{keyword}'...")
        counts = {"scraped": 0, "ingested": 0, "updated": 0, "failed": 0}
        page = 1
        batch = []
        self._consecutive_empty = 0
        while self._consecutive_empty < 5 and page <= max_pages:
            if self.limit > 0 and self.total_scraped >= self.limit:
                break
            url = f"{BASE_URL}/sch/i.html?_nkw={keyword}&_pgn={page}&_ipg=60&LH_BIN=1&_sop=12"
            print(f"  Page {page}...", end=" ", flush=True)
            html = await self._fetch_page(url)
            if not html:
                self._consecutive_empty += 1
                print("Failed to fetch.")
                page += 1
                await asyncio.sleep(self.delay)
                continue
            products = self._extract_products_from_json(html, keyword)
            if not products:
                self._consecutive_empty += 1
                print("No products found.")
                if self._consecutive_empty >= 3:
                    break
                page += 1
                await asyncio.sleep(self.delay)
                continue
            self._consecutive_empty = 0
            for raw in products:
                if self.limit > 0 and self.total_scraped >= self.limit:
                    break
                transformed = self.transform_product(raw, {"name": category_name, "id": keyword})
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
            print(f"scraped={counts['scraped']} (total={self.total_scraped})")
            if len(products) < 30:
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
        print(f"  [{category_name}] Done: {counts}")
        return counts

    async def run(self, keyword: str | None = None) -> dict[str, Any]:
        print(f"eBay US ScraperAPI starting... Output: {self._outfile}")
        start = time.time()
        if keyword:
            matching = [c for c in CATEGORIES if c["keyword"] == keyword]
            if matching:
                cat = matching[0]
                await self.scrape_keyword(cat["keyword"], cat["name"], cat.get("max_pages", 200))
            else:
                for cat in CATEGORIES:
                    if self.limit > 0 and self.total_scraped >= self.limit:
                        break
                    await self.scrape_keyword(cat["keyword"], cat["name"], cat.get("max_pages", 200))
                    await asyncio.sleep(2)
        else:
            for cat in CATEGORIES:
                if self.limit > 0 and self.total_scraped >= self.limit:
                    print(f"\nLimit of {self.limit:,} reached!")
                    break
                await self.scrape_keyword(cat["keyword"], cat["name"], cat.get("max_pages", 200))
                await asyncio.sleep(2)
        elapsed = time.time() - start
        summary = {"elapsed_seconds": round(elapsed, 1), "total_scraped": self.total_scraped, "total_ingested": self.total_ingested, "total_updated": self.total_updated, "total_failed": self.total_failed, "api_calls": self._api_calls, "unique_items": len(self.seen_item_ids), "output_file": self._outfile}
        print(f"\nScraper complete: {summary}")
        return summary


async def main():
    parser = argparse.ArgumentParser(description="eBay US ScraperAPI")
    parser.add_argument("--api-key", required=True)
    parser.add_argument("--api-base", default="http://localhost:8000")
    parser.add_argument("--batch-size", type=int, default=100)
    parser.add_argument("--delay", type=float, default=1.5)
    parser.add_argument("--scrape-only", action="store_true")
    parser.add_argument("--limit", type=int, default=200000)
    parser.add_argument("--keyword", type=str, default=None)
    parser.add_argument("--max-pages", type=int, default=200)
    args = parser.parse_args()
    scraper = EbayUSScraperAPI(api_key=args.api_key, api_base=args.api_base, batch_size=args.batch_size, delay=args.delay, scrape_only=args.scrape_only, limit=args.limit, max_pages_per_keyword=args.max_pages)
    try:
        await scraper.run(keyword=args.keyword)
    finally:
        await scraper.close()


if __name__ == "__main__":
    asyncio.run(main())