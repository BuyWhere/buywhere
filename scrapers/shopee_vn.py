"""
Shopee Vietnam product scraper.

Scrapes products from Shopee VN (shopee.vn) using BrightData residential
proxy to bypass WAF/anti-bot protection. The WAF block (policy_20090) that
previously blocked BrightData IPs has cleared as of BUY-40882 (2026-06-16).

Usage:
    python -m scrapers.shopee_vn --api-key <key> [--batch-size 100] [--delay 1.0]
    python -m scrapers.shopee_vn --scrape-only  # save to data/shopee_vn/ without ingesting

Categories covered: Electronics, Home Appliances, Food & Beverages, Health, Pet
Target: 10,000+ products
"""
import argparse
import asyncio
import json
import os
import re
import time
from typing import Any

import httpx

from scrapers.scraper_logging import get_logger
from scrapers.proxy_config import proxy_url, Zone

MERCHANT_ID = "shopee_vn"
SOURCE = "shopee_vn"
log = get_logger(MERCHANT_ID)
BASE_URL = "https://www.shopee.vn"
OUTPUT_DIR = "/home/paperclip/buywhere-api/data/shopee_vn"

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7",
    "Referer": "https://www.shopee.vn/",
    "X-Shopee-Language": "vi",
}

CATEGORIES = [
    {"id": "electronics-phones", "name": "Electronics", "sub": "Phones", "url": "https://shopee.vn/Dien-thoai-Mobi-i.6069.6069"},
    {"id": "electronics-laptops", "name": "Electronics", "sub": "Laptops", "url": "https://shopee.vn/Laptop-i.1852.1852"},
    {"id": "electronics-audio", "name": "Electronics", "sub": "Audio", "url": "https://shopee.vn/Tai-nghe-i.11094.11094"},
    {"id": "electronics-cameras", "name": "Electronics", "sub": "Cameras", "url": "https://shopee.vn/May-anh-i.814.814"},
    {"id": "electronics-accessories", "name": "Electronics", "sub": "Accessories", "url": "https://shopee.vn/Phu-kien-di-dong-i.19766.19766"},
    {"id": "home-kitchen", "name": "Home Appliances", "sub": "Kitchen", "url": "https://shopee.vn/Dung-cu-nha-bep-i.7108.7108"},
    {"id": "home-cleaning", "name": "Home Appliances", "sub": "Cleaning", "url": "https://shopee.vn/Dung-cu-ve-sinh-i.19499.19499"},
    {"id": "home-aircon", "name": "Home Appliances", "sub": "Air Conditioners", "url": "https://shopee.vn/May-lanh-i.6046.6046"},
    {"id": "home-fans", "name": "Home Appliances", "sub": "Fans", "url": "https://shopee.vn/Quat-i.6051.6051"},
    {"id": "food-groceries", "name": "Food & Beverages", "sub": "Groceries", "url": "https://shopee.vn/Sua-tuoi-i.2266.2266"},
    {"id": "food-snacks", "name": "Food & Beverages", "sub": "Snacks", "url": "https://shopee.vn/Banh-keo-i.11087.11087"},
    {"id": "food-drinks", "name": "Food & Beverages", "sub": "Drinks", "url": "https://shopee.vn/Nuoc-giai-khat-i.18530.18530"},
    {"id": "health-supplements", "name": "Health", "sub": "Supplements", "url": "https://shopee.vn/Thuc-pham-chuc-nang-i.22222.22222"},
    {"id": "health-personal", "name": "Health", "sub": "Personal Care", "url": "https://shopee.vn/Cham-soc-ca-nhan-i.22528.22528"},
    {"id": "health-pharmacy", "name": "Health", "sub": "Pharmacy", "url": "https://shopee.vn/Thuc-pham-bo-xung-i.22525.22525"},
    {"id": "pet-food", "name": "Pet Supplies", "sub": "Pet Food", "url": "https://shopee.vn/Thuc-an-cho-cho-i.13877.13877"},
    {"id": "pet-accessories", "name": "Pet Supplies", "sub": "Pet Accessories", "url": "https://shopee.vn/Phu-kien-cho-thu-cung-i.13879.13879"},
    {"id": "pet-grooming", "name": "Pet Supplies", "sub": "Pet Grooming", "url": "https://shopee.vn/Cham-soc-long-vat-nuoi-i.13882.13882"},
]


def _build_proxy_url() -> str | None:
    """Build BrightData proxy URL for Shopee VN.

    Zone is determined by (in priority order):
    1. SHOPEE_VN_BRIGHTDATA_ZONE env var (zone name, e.g. 'shopee_vn_ul')
    2. BRIGHTDATA_ZONE env var (general fallback)

    If the zone name is not a known BrightData zone (or is "direct"/"none"),
    returns None to use a direct connection (httpx handles None as no-proxy).

    The zone's password is read from SHOPEE_VN_BRIGHTDATA_PASSWORD (if
    SHOPEE_VN_BRIGHTDATA_ZONE is set) or BRIGHTDATA_ZONE_PASSWORD (for
    the BRIGHTDATA_ZONE fallback).
    """
    # Priority 1: zone-specific env var
    zone_name = os.environ.get("SHOPEE_VN_BRIGHTDATA_ZONE")
    if not zone_name:
        # Priority 2: general zone env var
        zone_name = os.environ.get("BRIGHTDATA_ZONE", "")

    # Treat bare "direct"/"none"/"" as "no proxy"
    if zone_name.lower() in ("", "none", "direct"):
        return None

    try:
        zone = Zone(zone_name)
    except ValueError:
        # Unknown zone — fall back to direct connection
        return None
    return proxy_url(zone)


class ShopeeVNScraper:
    def __init__(
        self,
        api_key: str,
        api_base: str = "http://localhost:8000",
        batch_size: int = 100,
        delay: float = 1.0,
        scrape_only: bool = False,
        data_dir: str = "/home/paperclip/buywhere-api/data/shopee_vn",
        max_pages_per_category: int = 500,
        target_products: int = 10000,
    ):
        self.api_key = api_key
        self.api_base = api_base.rstrip("/")
        self.batch_size = batch_size
        self.delay = delay
        self.scrape_only = scrape_only
        self.data_dir = os.path.join(data_dir, "")
        os.makedirs(self.data_dir, exist_ok=True)
        self.max_pages_per_category = max_pages_per_category
        self.target_products = target_products

        # Build proxy config for BrightData
        proxy = _build_proxy_url()
        self.client = httpx.AsyncClient(
            timeout=30.0,
            headers=HEADERS,
            proxy=proxy,
        )
        self.total_scraped = 0
        self.total_ingested = 0
        self.total_updated = 0
        self.total_failed = 0
        self._ensure_output_dir()

    def _ensure_output_dir(self):
        os.makedirs(self.data_dir, exist_ok=True)
        ts = time.strftime("%Y%m%d_%H%M%S")
        self.products_outfile = os.path.join(self.data_dir, f"products_{ts}.jsonl")

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
            "page_size": 60,
            "offset": (page - 1) * 60,
        }
        try:
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
                image_url = f"https://cf.shopee.vn/file/{images[0]}"

            product_url = f"https://shopee.vn/product/{shopid}/{itemid}"

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
                "currency": "VND",
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
            for p in products:
                cat_id = p.get("metadata", {}).get("shopid", "unknown")
                cat_file = os.path.join(self.data_dir, f"{cat_id}.jsonl")
                with open(cat_file, "a", encoding="utf-8") as f:
                    f.write(json.dumps(p, ensure_ascii=False) + "\n")
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
            log.ingestion_error(None, str(e))
            return 0, 0, len(products)

    async def scrape_category(self, category: dict) -> dict[str, int]:
        cat_id = category["id"]
        cat_name = category["name"]
        sub_name = category["sub"]

        print(f"\n[{cat_name} / {sub_name}] Starting scrape...")
        counts = {"scraped": 0, "ingested": 0, "updated": 0, "failed": 0, "pages": 0}
        page = 1
        batch = []
        consecutive_empty = 0

        while page <= self.max_pages_per_category:
            if self.total_scraped >= self.target_products:
                print(f"  Target of {self.target_products} products reached!")
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
            counts["pages"] += 1

            for raw in products:
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

            print(f"scraped={counts['scraped']}, total={self.total_scraped}")

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
        print(f"  [{cat_name} / {sub_name}] Done: pages={counts['pages']}, scraped={counts['scraped']}, ingested={counts['ingested']}")
        return counts

    async def run(self) -> dict[str, Any]:
        proxy_info = "BrightData proxy" if _build_proxy_url() else "direct"
        mode = "scrape only" if self.scrape_only else f"API: {self.api_base}"
        print(f"Shopee VN Scraper starting — target: {self.target_products} products")
        print(f"Proxy: {proxy_info}")
        print(f"Mode: {mode}")
        print(f"Batch size: {self.batch_size}, Delay: {self.delay}s")
        print(f"Output: {self.products_outfile}")
        print(f"Categories: {len(CATEGORIES)} verticals")

        start = time.time()
        overall = {"scraped": 0, "ingested": 0, "updated": 0, "failed": 0, "pages": 0}

        for cat in CATEGORIES:
            if self.total_scraped >= self.target_products:
                break
            try:
                counts = await self.scrape_category(cat)
                for k in overall:
                    if k in counts:
                        overall[k] += counts[k]
            except Exception as e:
                log.parse_error(None, f"Category scrape failed: {e}")
            await asyncio.sleep(2)

        elapsed = time.time() - start

        print(f"\n=== Overall ===")
        print(f"Pages: {overall['pages']}")
        print(f"Scraped: {overall['scraped']}")
        print(f"Ingested: {overall['ingested']}")
        print(f"Updated: {overall['updated']}")
        print(f"Failed: {overall['failed']}")
        print(f"Total scraped: {self.total_scraped}")
        print(f"Elapsed: {elapsed:.1f}s")

        await self.close()


def main():
    parser = argparse.ArgumentParser(description="Shopee VN Scraper")
    parser.add_argument("--api-key", default=None, help="BuyWhere API key")
    parser.add_argument(
        "--api-base",
        default="http://localhost:8000",
        help="BuyWhere API base URL",
    )
    parser.add_argument("--batch-size", type=int, default=100)
    parser.add_argument("--delay", type=float, default=1.0, help="Delay between batches (seconds)")
    parser.add_argument("--scrape-only", action="store_true", help="Save to JSONL without ingesting")
    parser.add_argument("--data-dir", default="/home/paperclip/buywhere-api/data/shopee_vn", help="Output data directory")
    parser.add_argument("--max-pages", type=int, default=500, help="Max pages per category")
    parser.add_argument("--target", type=int, default=10000, help="Target number of products")
    args = parser.parse_args()

    if not args.scrape_only and not args.api_key:
        parser.error("--api-key is required unless --scrape-only is used")

    scraper = ShopeeVNScraper(
        api_key=args.api_key,
        api_base=args.api_base,
        batch_size=args.batch_size,
        delay=args.delay,
        scrape_only=args.scrape_only,
        data_dir=args.data_dir,
        max_pages_per_category=args.max_pages,
        target_products=args.target,
    )
    asyncio.run(scraper.run())


if __name__ == "__main__":
    main()