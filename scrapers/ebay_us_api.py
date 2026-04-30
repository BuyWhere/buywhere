"""
eBay US product scraper — eBay Finding API.
No ScraperAPI or proxy required.
"""

import argparse
import asyncio
import hashlib
import json
import os
import time
from typing import Any

import httpx

MERCHANT_ID = "ebay_us"
SOURCE = "ebay_us"
BASE_URL = "https://www.ebay.com"
FINDING_API_URL = "https://svcs.ebay.com/services/search/FindingService/v1"
OUTPUT_DIR = "/home/paperclip/buywhere/data"
CURRENCY = "USD"
REGION = "us"
COUNTRY_CODE = "US"
GLOBAL_ID = "EBAY-US"

DEFAULT_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
    "Accept": "application/json",
    "Accept-Language": "en-US",
}

CATEGORIES = [
    {"id": "electronics_computers", "name": "Electronics", "keyword": "computers laptops", "max_pages": 100},
    {"id": "electronics_phones", "name": "Electronics", "keyword": "smartphone mobile phone", "max_pages": 100},
    {"id": "electronics_tablets", "name": "Electronics", "keyword": "tablets e-readers ipad", "max_pages": 100},
    {"id": "electronics_tv", "name": "Electronics", "keyword": "TV LED LCD television", "max_pages": 100},
    {"id": "electronics_cameras", "name": "Electronics", "keyword": "digital camera camera", "max_pages": 100},
    {"id": "electronics_gaming", "name": "Electronics", "keyword": "gaming console playstation xbox switch", "max_pages": 100},
    {"id": "electronics_headphones", "name": "Electronics", "keyword": "headphones earbuds wireless audio", "max_pages": 100},
    {"id": "electronics_watches", "name": "Electronics", "keyword": "smart watch fitness tracker", "max_pages": 100},
    {"id": "fashion_women", "name": "Fashion", "keyword": "women clothing dress tops", "max_pages": 100},
    {"id": "fashion_men", "name": "Fashion", "keyword": "men clothing shirts pants", "max_pages": 100},
    {"id": "fashion_shoes", "name": "Fashion", "keyword": "shoes sneakers footwear", "max_pages": 100},
    {"id": "fashion_bags", "name": "Fashion", "keyword": "handbags purses bags", "max_pages": 100},
    {"id": "fashion_jewelry", "name": "Fashion", "keyword": "jewelry rings necklaces bracelet", "max_pages": 100},
    {"id": "fashion_watches", "name": "Fashion", "keyword": "watches wristwatches", "max_pages": 100},
    {"id": "collectibles_coins", "name": "Collectibles", "keyword": "coins collectible money", "max_pages": 100},
    {"id": "collectibles_cards", "name": "Collectibles", "keyword": "trading cards Pokemon Magic", "max_pages": 100},
    {"id": "collectibles_figurines", "name": "Collectibles", "keyword": "figurines anime collectibles", "max_pages": 100},
    {"id": "collectibles_vintage", "name": "Collectibles", "keyword": "vintage collectibles antiques", "max_pages": 100},
    {"id": "home_furniture", "name": "Home & Garden", "keyword": "furniture home decor", "max_pages": 100},
    {"id": "home_kitchen", "name": "Home & Garden", "keyword": "kitchen appliances cookware", "max_pages": 100},
    {"id": "auto_parts", "name": "Auto", "keyword": "auto parts car accessories", "max_pages": 100},
]

CONSECUTIVE_EMPTY_LIMIT = 5
ITEMS_PER_PAGE = 100


def build_finding_api_url(app_id: str, keyword: str, page: int, entries_per_page: int = ITEMS_PER_PAGE) -> str:
    params = (
        f"?OPERATION-NAME=findItemsByKeywords"
        f"&SERVICE-NAME=FindingService"
        f"&SERVICE-VERSION=1.0.0"
        f"&SECURITY-APPNAME={app_id}"
        f"&GLOBAL-ID={GLOBAL_ID}"
        f"&RESPONSE-DATA-FORMAT=JSON"
        f"&REST-PAYLOAD"
        f"&keywords={keyword}"
        f"&paginationInput.pageNumber={page}"
        f"&paginationInput.entriesPerPage={entries_per_page}"
    )
    return f"{FINDING_API_URL}{params}"


def extract_brand(title: str) -> str:
    known_brands = [
        "Apple", "Samsung", "Sony", "LG", "Dell", "HP", "Lenovo", "Nike", "Adidas", "Zara",
        "H&M", "Uniqlo", "Canon", "Nikon", "Bose", "JBL", "Dyson", "KitchenAid", "Cuisinart",
        "Asus", "Acer", "Microsoft", "Google", "OnePlus", "Panasonic", "Sharp", "Toshiba",
        "Huawei", "Xiaomi", "Oppo", "Vivo", "Motorola", "TCL", "Hisense", "Polaroid",
        "Fujifilm", "Olympus", "GoPro", "DJI", "Fitbit", "Garmin", "Fossil", "Timex",
        "Seiko", "Casio", "Omega", "Rolex", "Levi's", "Champion", "Under Armour",
        "The North Face", "Patagonia", "Ralph Lauren", "Calvin Klein", "Tommy Hilfiger",
        "Michael Kors", "Coach", "kate spade", "Stuart Weitzman", "Vans", "Converse",
        "New Balance", "Puma", "Reebok", "ASICS", "Skechers", "Cole Haan", "Burberry",
    ]
    title_lower = title.lower()
    for brand in known_brands:
        if title_lower.startswith(brand.lower()) or f" {brand.lower()} " in title_lower or f" {brand.lower()}-" in title_lower:
            return brand
    return ""


class EbayUSFindingAPI:
    def __init__(
        self,
        app_id: str,
        api_key: str = "",
        api_base: str = "http://localhost:8000",
        batch_size: int = 100,
        delay: float = 0.2,
        scrape_only: bool = False,
        limit: int = 200000,
        max_pages_per_keyword: int = 100,
    ):
        self.app_id = app_id
        self.api_key = api_key
        self.api_base = api_base.rstrip("/")
        self.batch_size = batch_size
        self.delay = delay
        self.scrape_only = scrape_only
        self.limit = limit
        self.max_pages_per_keyword = max_pages_per_keyword
        self.client = httpx.AsyncClient(timeout=30.0, headers=DEFAULT_HEADERS)
        self.total_scraped = 0
        self.total_ingested = 0
        self.total_updated = 0
        self.total_failed = 0
        self.seen_item_ids: set[str] = set()
        self._outfile: str | None = None
        self._ensure_output_dir()
        self._api_calls = 0
        self._consecutive_empty = 0

    def _ensure_output_dir(self) -> None:
        os.makedirs(OUTPUT_DIR, exist_ok=True)
        today = time.strftime("%Y%m%d")
        self._outfile = os.path.join(OUTPUT_DIR, f"ebay_us_{today}.ndjson")

    @property
    def products_outfile(self) -> str:
        if self._outfile is None:
            today = time.strftime("%Y%m%d")
            self._outfile = os.path.join(OUTPUT_DIR, f"ebay_us_{today}.ndjson")
        return self._outfile

    async def close(self) -> None:
        await self.client.aclose()

    async def _fetch_page(self, keyword: str, page: int) -> dict | None:
        self._api_calls += 1
        url = build_finding_api_url(self.app_id, keyword, page)
        try:
            resp = await self.client.get(url, timeout=30.0)
            if resp.status_code == 200:
                return resp.json()
            return None
        except Exception:
            return None

    def _parse_findItemsByKeywordsResponse(self, data: dict) -> list[dict]:
        try:
            resp = data.get("findItemsByKeywordsResponse", [])
            if not resp:
                return []
            items = resp[0].get("searchResult", [{}])[0].get("item", [])
            return items
        except Exception:
            return []

    def transform_product(self, raw: dict, category: dict) -> dict | None:
        try:
            item_id = str(raw.get("itemId", [""])[0] if isinstance(raw.get("itemId"), list) else raw.get("itemId", ""))
            if not item_id:
                return None
            if item_id in self.seen_item_ids:
                return None
            self.seen_item_ids.add(item_id)

            title_arr = raw.get("title", [])
            title = title_arr[0] if isinstance(title_arr, list) else (title_arr or f"eBay item {item_id}")

            price_arr = raw.get("sellingStatus", [{}])[0].get("currentPrice", [{}])
            if isinstance(price_arr, list):
                price_arr = price_arr[0]
            price_value = price_arr.get("value", "0") if isinstance(price_arr, dict) else "0"
            price = float(price_value)

            currency_arr = price_arr.get("@currencyId", "USD") if isinstance(price_arr, dict) else "USD"

            condition_arr = raw.get("condition", [{}])
            condition_display = condition_arr[0].get("conditionDisplayName", ["Unknown"])[0] if condition_arr and isinstance(condition_arr, list) else "Unknown"

            category_arr = raw.get("primaryCategory", [{}])
            category_id = category_arr[0].get("categoryId", [""])[0] if category_arr and isinstance(category_arr, list) else ""
            category_name = category_arr[0].get("categoryName", [""])[0] if category_arr and isinstance(category_arr, list) else ""

            gallery_url_arr = raw.get("galleryURL", [])
            image_url = gallery_url_arr[0] if gallery_url_arr and isinstance(gallery_url_arr, list) else ""

            view_url_arr = raw.get("viewItemURL", [])
            url = view_url_arr[0] if view_url_arr and isinstance(view_url_arr, list) else f"{BASE_URL}/itm/{item_id}"

            location_arr = raw.get("location", [])
            location = location_arr[0] if location_arr and isinstance(location_arr, list) else ""

            seller_arr = raw.get("sellerInfo", [{}])
            seller = seller_arr[0].get("sellerUserName", [""])[0] if seller_arr and isinstance(seller_arr, list) else ""

            shipping_arr = raw.get("shippingInfo", [{}])
            shipping_cost = 0.0
            if shipping_arr and isinstance(shipping_arr, list):
                shipping_service_cost_arr = shipping_arr[0].get("shippingServiceCost", [{}])
                if shipping_service_cost_arr and isinstance(shipping_service_cost_arr, list):
                    sc = shipping_service_cost_arr[0].get("value", "0")
                    shipping_cost = float(sc) if sc else 0.0

            brand = extract_brand(title)

            return {
                "sku": f"ebay_us_{item_id}",
                "merchant_id": MERCHANT_ID,
                "title": title,
                "description": f"Condition: {condition_display}",
                "price": price,
                "currency": currency_arr if isinstance(currency_arr, str) else "USD",
                "url": url,
                "image_url": image_url,
                "category": category.get("name", ""),
                "category_path": [category.get("name", ""), category_name],
                "brand": brand,
                "is_active": True,
                "metadata": {
                    "item_id": item_id,
                    "condition": condition_display,
                    "source_url": url,
                    "seller": seller,
                    "shipping_cost": shipping_cost,
                    "location": location,
                    "listing_type": "FixedPrice",
                    "region": REGION,
                    "country_code": COUNTRY_CODE,
                },
            }
        except Exception:
            return None

    async def _save_batch(self, batch: list[dict]) -> tuple[int, int, int]:
        ingested = 0
        failed = 0
        with open(self.products_outfile, "a", encoding="utf-8") as f:
            for item in batch:
                try:
                    f.write(json.dumps(item, ensure_ascii=False) + "\n")
                    ingested += 1
                except Exception:
                    failed += 1
        return ingested, 0, failed

    async def _ingest_batch_api(self, batch: list[dict]) -> tuple[int, int, int]:
        if not batch:
            return 0, 0, 0
        for attempt in range(3):
            try:
                resp = await self.client.post(
                    f"{self.api_base}/v1/ingest/products",
                    json=batch,
                    headers={"X-API-Key": self.api_key, "Content-Type": "application/json"},
                    timeout=60.0,
                )
                if resp.status_code == 200:
                    result = resp.json()
                    return result.get("ingested", len(batch)), result.get("updated", 0), result.get("failed", 0)
                elif resp.status_code in (429, 503):
                    wait = 2 ** attempt * 5
                    print(f"Rate limited, waiting {wait}s")
                    await asyncio.sleep(wait)
                else:
                    if attempt < 2:
                        await asyncio.sleep(2 ** attempt)
                    else:
                        return 0, 0, len(batch)
            except Exception:
                if attempt < 2:
                    await asyncio.sleep(2 ** attempt)
                else:
                    return 0, 0, len(batch)
        return 0, 0, len(batch)

    async def ingest_batch(self, batch: list[dict]) -> tuple[int, int, int]:
        if not batch:
            return 0, 0, 0
        if self.scrape_only:
            return await self._save_batch(batch)
        return await self._ingest_batch_api(batch)

    async def scrape_keyword(self, keyword: str, category: dict) -> dict[str, int]:
        cat_name = category.get("name", "")
        print(f"\n[{cat_name}] Scraping keyword: '{keyword}'...")
        counts: dict[str, int] = {"scraped": 0, "ingested": 0, "updated": 0, "failed": 0}
        page = 1
        batch: list[dict] = []
        self._consecutive_empty = 0

        while self._consecutive_empty < CONSECUTIVE_EMPTY_LIMIT and page <= self.max_pages_per_keyword:
            if self.limit > 0 and self.total_scraped >= self.limit:
                break

            print(f"  Page {page}...", end=" ", flush=True)
            data = await self._fetch_page(keyword, page)

            if not data:
                self._consecutive_empty += 1
                print("Failed to fetch.")
                page += 1
                await asyncio.sleep(self.delay)
                continue

            items = self._parse_findItemsByKeywordsResponse(data)

            if not items:
                self._consecutive_empty += 1
                print("No items found.")
                if self._consecutive_empty >= CONSECUTIVE_EMPTY_LIMIT:
                    break
                page += 1
                await asyncio.sleep(self.delay)
                continue

            self._consecutive_empty = 0

            for raw in items:
                if self.limit > 0 and self.total_scraped >= self.limit:
                    break

                transformed = self.transform_product(raw, category)
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

            if len(items) < ITEMS_PER_PAGE:
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

        print(f"  [{cat_name}] Done: {counts}")
        return counts

    async def run(self, keyword: str | None = None) -> dict[str, Any]:
        print(f"eBay US Finding API scraper starting... Output: {self.products_outfile}")
        print(f"AppID: {self.app_id[:10]}... (truncated)")
        start = time.time()

        if keyword:
            matching = [c for c in CATEGORIES if c["keyword"] == keyword]
            if matching:
                cat = matching[0]
                await self.scrape_keyword(cat["keyword"], cat)
            else:
                for cat in CATEGORIES:
                    if self.limit > 0 and self.total_scraped >= self.limit:
                        break
                    await self.scrape_keyword(cat["keyword"], cat)
                    await asyncio.sleep(1)
        else:
            for cat in CATEGORIES:
                if self.limit > 0 and self.total_scraped >= self.limit:
                    print(f"\nLimit of {self.limit:,} reached!")
                    break
                await self.scrape_keyword(cat["keyword"], cat)
                await asyncio.sleep(1)

        elapsed = time.time() - start
        summary = {
            "elapsed_seconds": round(elapsed, 1),
            "total_scraped": self.total_scraped,
            "total_ingested": self.total_ingested,
            "total_updated": self.total_updated,
            "total_failed": self.total_failed,
            "api_calls": self._api_calls,
            "unique_items": len(self.seen_item_ids),
            "output_file": self.products_outfile,
        }
        print(f"\nScraper complete: {summary}")
        return summary


async def main():
    parser = argparse.ArgumentParser(description="eBay US Finding API Scraper")
    parser.add_argument("--app-id", required=True, help="eBay AppID (SECURITY-APPNAME)")
    parser.add_argument("--api-key", default="")
    parser.add_argument("--api-base", default="http://localhost:8000")
    parser.add_argument("--batch-size", type=int, default=100)
    parser.add_argument("--delay", type=float, default=0.2)
    parser.add_argument("--scrape-only", action="store_true")
    parser.add_argument("--limit", type=int, default=200000)
    parser.add_argument("--keyword", type=str, default=None)
    parser.add_argument("--max-pages", type=int, default=100)
    args = parser.parse_args()

    scraper = EbayUSFindingAPI(
        app_id=args.app_id,
        api_key=args.api_key,
        api_base=args.api_base,
        batch_size=args.batch_size,
        delay=args.delay,
        scrape_only=args.scrape_only,
        limit=args.limit,
        max_pages_per_keyword=args.max_pages,
    )
    try:
        await scraper.run(keyword=args.keyword)
    finally:
        await scraper.close()


if __name__ == "__main__":
    asyncio.run(main())
