"""
Shopee Thailand product scraper.

Scrapes electronics, home appliances, food & beverages, health, and pet supplies
from Shopee TH and outputs structured JSON matching the BuyWhere catalog schema
for ingestion via POST /v1/ingest/products.

Uses ScraperAPI in HTTP proxy mode with ultra_premium and session support
to bypass Shopee TH anti-bot protection.

Usage:
    SCRAPERAPI_KEY=... python -m scrapers.shopee_th \\
        --use-scraperapi-proxy --scrape-only --limit 50000

    # Scrape-only to JSONL:
    SCRAPERAPI_KEY=... python -m scrapers.shopee_th \\
        --use-scraperapi-proxy --scrape-only --limit 50000

    # Ingest via bulk_ingest.py:
    python bulk_ingest.py /tmp/shopee_th_<ts>.jsonl --batch-size 200

Verticals covered:
- Electronics: Phones, laptops, audio, cameras, accessories — target 15K
- Home Appliances: Kitchen, cleaning, aircon, fans — target 10K
- Food & Beverages: Groceries, snacks, drinks — target 10K
- Health: Supplements, personal care, pharmacy — target 8K
- Beauty: Skincare, makeup, beauty tools — target 7K
- Total target: 50K products
"""
import argparse
import asyncio
import json
import os
import re
import time
import urllib.parse
from typing import Any

import httpx

SCRAPERAPI_KEY = os.environ.get("SCRAPERAPI_KEY", "")

SCRAPERAPI_PROXY = f"http://scraperapi:{SCRAPERAPI_KEY}:ultra_premium=true:session=true@proxy-server.scraperapi.com:8001"

MERCHANT_ID = "shopee_th"
SOURCE = "shopee_th"
BASE_URL = "https://www.shopee.co.th"
OUTPUT_DIR = "/tmp"

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-TH,en;q=0.9",
    "Referer": "https://www.shopee.co.th/",
    "X-Shopee-Language": "th",
}


def build_scraperapi_url(target_url: str) -> str:
    if not SCRAPERAPI_KEY:
        return target_url
    encoded_url = urllib.parse.quote(target_url, safe="")
    params = [f"api_key={SCRAPERAPI_KEY}", f"url={encoded_url}", "session=true", "ultra_premium=true"]
    return f"http://api.scraperapi.com?{'&'.join(params)}"

CATEGORIES = [
    {"id": "electronics-phones", "name": "Electronics", "sub": "Phones", "url": "https://shopee.co.th/Mobile-Phones-i.6069.6069"},
    {"id": "electronics-laptops", "name": "Electronics", "sub": "Laptops", "url": "https://shopee.co.th/Laptops-i.1852.1852"},
    {"id": "electronics-audio", "name": "Electronics", "sub": "Audio", "url": "https://shopee.co.th/Headphones-Earphones-i.11094.11094"},
    {"id": "electronics-cameras", "name": "Electronics", "sub": "Cameras", "url": "https://shopee.co.th/Cameras-DSLRs-i.814.814"},
    {"id": "electronics-accessories", "name": "Electronics", "sub": "Accessories", "url": "https://shopee.co.th/Mobile-Accessories-i.19766.19766"},
    {"id": "home-kitchen", "name": "Home Appliances", "sub": "Kitchen", "url": "https://shopee.co.th/Kitchen-Appliances-i.7108.7108"},
    {"id": "home-cleaning", "name": "Home Appliances", "sub": "Cleaning", "url": "https://shopee.co.th/Home-Cleaning-Tools-i.19499.19499"},
    {"id": "home-aircon", "name": "Home Appliances", "sub": "Air Conditioners", "url": "https://shopee.co.th/Air-Conditioners-i.6046.6046"},
    {"id": "home-fans", "name": "Home Appliances", "sub": "Fans", "url": "https://shopee.co.th/Fans-i.6051.6051"},
    {"id": "food-groceries", "name": "Food & Beverages", "sub": "Groceries", "url": "https://shopee.co.th/Groceries-Camp-Chocolate-i.2266.2266"},
    {"id": "food-snacks", "name": "Food & Beverages", "sub": "Snacks", "url": "https://shopee.co.th/Snacks-i.11087.11087"},
    {"id": "food-drinks", "name": "Food & Beverages", "sub": "Drinks", "url": "https://shopee.co.th/Beverages-i.18530.18530"},
    {"id": "health-supplements", "name": "Health", "sub": "Supplements", "url": "https://shopee.co.th/Health-Supplements-i.22222.22222"},
    {"id": "health-personal", "name": "Health", "sub": "Personal Care", "url": "https://shopee.co.th/Personal-Care-i.22528.22528"},
    {"id": "health-pharmacy", "name": "Health", "sub": "Pharmacy", "url": "https://shopee.co.th/Pharmacy-i.22525.22525"},
    {"id": "beauty-skincare", "name": "Beauty", "sub": "Skincare", "url": "https://shopee.co.th/Skincare-i.22216.22216"},
    {"id": "beauty-makeup", "name": "Beauty", "sub": "Makeup", "url": "https://shopee.co.th/Makeup-i.22204.22204"},
    {"id": "beauty-tools", "name": "Beauty", "sub": "Beauty Tools", "url": "https://shopee.co.th/Beauty-Tools-i.22205.22205"},
]


class ShopeeTHScraper:
    def __init__(
        self,
        api_key: str,
        api_base: str = "http://localhost:8000",
        batch_size: int = 100,
        delay: float = 1.0,
        scrape_only: bool = False,
        use_scraperapi: bool = False,
        use_scraperapi_proxy: bool = False,
    ):
        self.api_key = api_key
        self.api_base = api_base.rstrip("/")
        self.batch_size = batch_size
        self.delay = delay
        self.scrape_only = scrape_only
        self.use_scraperapi = use_scraperapi and bool(SCRAPERAPI_KEY)
        self.use_scraperapi_proxy = use_scraperapi_proxy and bool(SCRAPERAPI_KEY)
        kwargs = {"timeout": 60.0, "headers": HEADERS, "verify": False}
        if self.use_scraperapi_proxy:
            kwargs["proxy"] = SCRAPERAPI_PROXY
        self.client = httpx.AsyncClient(**kwargs)
        self.total_scraped = 0
        self.total_ingested = 0
        self.total_updated = 0
        self.total_failed = 0
        self.products_outfile = None
        self._ensure_output_dir()

    def _ensure_output_dir(self):
        os.makedirs(OUTPUT_DIR, exist_ok=True)
        ts = time.strftime("%Y%m%d_%H%M%S")
        self.products_outfile = os.path.join(OUTPUT_DIR, f"shopee_th_{ts}.jsonl")

    async def close(self):
        await self.client.aclose()

    async def _get_with_retry(
        self, url: str, params: dict | None = None, retries: int = 3
    ) -> dict[str, Any] | None:
        for attempt in range(retries):
            try:
                resp = await self.client.get(url, params=params)
                resp.raise_for_status()
                return resp.json()
            except Exception:
                if attempt < retries - 1:
                    await asyncio.sleep(2 ** attempt)
                else:
                    return None
        return None

    async def fetch_products_page(self, category: dict, page: int = 1) -> list[dict]:
        url = f"{BASE_URL}/api/v4/search/search_items"
        params = {
            "keyword": "",
            "order": "desc",
            "page_type": "search",
            "scenario": "PAGE_CATEGORY",
            "catid": self._extract_catid_from_url(category["url"]),
            "page_size": 80,
            "offset": (page - 1) * 80,
        }
        try:
            if self.use_scraperapi_proxy:
                resp = await self.client.get(url, params=params)
                resp.raise_for_status()
                data = resp.json()
            elif self.use_scraperapi:
                request_url = f"{url}?{urllib.parse.urlencode(params)}"
                scraperapi_url = build_scraperapi_url(request_url)
                resp = await self.client.get(scraperapi_url)
                resp.raise_for_status()
                data = resp.json()
            else:
                data = await self._get_with_retry(url, params=params)
            if data:
                return data.get("items", []) or []
            return []
        except Exception:
            return []

    def _extract_catid_from_url(self, url: str) -> str:
        match = re.search(r"\.i\.(\d+)", url)
        return match.group(1) if match else "0"

    def transform_product(self, raw: dict, category: dict) -> dict[str, Any] | None:
        try:
            item_basic = raw.get("item_basic", raw)

            shopid = str(item_basic.get("shopid", "") or "")
            itemid = str(item_basic.get("itemid", "") or "")
            if not shopid or not itemid:
                return None
            sku = f"{shopid}_{itemid}"

            name = item_basic.get("name", "") or item_basic.get("title", "")
            if not name:
                return None

            price = item_basic.get("price", 0)
            if isinstance(price, str):
                price = int(price)
            price = price / 100000.0

            original_price = item_basic.get("original_price", 0)
            if isinstance(original_price, str):
                original_price = int(original_price)
            if original_price:
                original_price = original_price / 100000.0
            else:
                original_price = price

            images = item_basic.get("images", []) or []
            image_url = ""
            if images:
                image_url = f"https://cf.shopee.co.th/file/{images[0]}"

            product_url = f"https://shopee.co.th/product/{shopid}/{itemid}"

            brand = item_basic.get("brand", "") or ""
            if not brand:
                brand = item_basic.get("brand_name", "") or ""

            rating = item_basic.get("rating_star", 0.0) or 0.0
            review_count = item_basic.get("cmt_count", 0) or item_basic.get("rating_count", 0) or 0

            discount = item_basic.get("discount", "") or "0"
            if discount and "%" in str(discount):
                discount = int(str(discount).replace("%", ""))
            else:
                discount = 0

            location = item_basic.get("location", "") or ""

            tier_variations = item_basic.get("tier_variations", []) or []
            has_variants = len(tier_variations) > 0

            return {
                "sku": sku,
                "merchant_id": MERCHANT_ID,
                "title": name,
                "description": "",
                "price": price,
                "currency": "THB",
                "country": "TH",
                "url": product_url,
                "image_url": image_url,
                "category": category["name"],
                "category_path": [category["name"], category["sub"]],
                "brand": brand,
                "is_active": True,
                "metadata": {
                    "original_price": original_price,
                    "discount_pct": discount,
                    "rating": rating,
                    "review_count": review_count,
                    "location": location,
                    "has_variants": has_variants,
                    "shopid": shopid,
                    "itemid": itemid,
                },
            }
        except Exception:
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

    async def scrape_category(self, category: dict, limit: int = 0) -> dict[str, int]:
        cat_id = category["id"]
        cat_name = category["name"]
        sub_name = category["sub"]

        print(f"\n[{cat_name} / {sub_name}] Starting scrape...")
        counts = {"scraped": 0, "ingested": 0, "updated": 0, "failed": 0}
        page = 1
        batch = []
        consecutive_empty = 0
        max_pages = 5000

        while consecutive_empty < 5 and page <= max_pages:
            if limit > 0 and self.total_scraped >= limit:
                print(f"  Limit of {limit} reached!")
                break
            print(f"  Page {page}...", end=" ", flush=True)
            products = await self.fetch_products_page(category, page)

            if not products:
                consecutive_empty += 1
                print("No products found.")
                if consecutive_empty >= 3:
                    break
                page += 1
                await asyncio.sleep(self.delay)
                continue

            consecutive_empty = 0

            for raw in products:
                transformed = self.transform_product(raw, category)
                if transformed:
                    batch.append(transformed)
                    counts["scraped"] += 1

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

            print(f"scraped={counts['scraped']}")

            if len(products) < 60:
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
            batch = []

        self.total_scraped += counts["scraped"]
        print(f"  [{cat_name} / {sub_name}] Done: {counts}")
        return counts

    async def run(self, limit: int = 0) -> dict[str, Any]:
        mode = "scrape only" if self.scrape_only else f"API: {self.api_base}"
        proxy_mode = "ScraperAPI (proxy)" if self.use_scraperapi_proxy else ("ScraperAPI (query)" if self.use_scraperapi else "direct")
        print(f"Shopee TH Scraper starting...")
        print(f"Mode: {mode}, Proxy: {proxy_mode}")
        print(f"Batch size: {self.batch_size}, Delay: {self.delay}s")
        print(f"Output: {self.products_outfile}")
        print(f"Categories: {len(CATEGORIES)} verticals")
        print(f"Verticals: Electronics, Home Appliances, Food & Beverages, Health, Beauty")
        print(f"Target: {'limit' if limit > 0 else '50K'} products")

        start = time.time()

        for cat in CATEGORIES:
            if limit > 0 and self.total_scraped >= limit:
                print(f"Limit of {limit} reached!")
                break
            await self.scrape_category(cat, limit=limit)
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

        print(f"\nScraper complete: {summary}")
        return summary


async def main():
    parser = argparse.ArgumentParser(description="Shopee TH Scraper — Thailand Verticals")
    parser.add_argument("--api-key", required=True, help="BuyWhere API key")
    parser.add_argument(
        "--api-base",
        default="http://localhost:8000",
        help="BuyWhere API base URL",
    )
    parser.add_argument("--batch-size", type=int, default=100)
    parser.add_argument("--delay", type=float, default=1.0, help="Delay between batches (seconds)")
    parser.add_argument("--scrape-only", action="store_true", help="Save to JSONL without ingesting")
    parser.add_argument("--use-scraperapi", action="store_true", help="Route requests through ScraperAPI (query-param mode)")
    parser.add_argument("--use-scraperapi-proxy", action="store_true", help="Route requests through ScraperAPI HTTP proxy (ultra_premium)")
    parser.add_argument("--limit", type=int, default=0, help="Max products to scrape (0 = unlimited)")
    args = parser.parse_args()

    scraper = ShopeeTHScraper(
        api_key=args.api_key,
        api_base=args.api_base,
        batch_size=args.batch_size,
        delay=args.delay,
        scrape_only=args.scrape_only,
        use_scraperapi=args.use_scraperapi,
        use_scraperapi_proxy=args.use_scraperapi_proxy,
    )

    try:
        await scraper.run(limit=args.limit)
    finally:
        await scraper.close()


if __name__ == "__main__":
    asyncio.run(main())
