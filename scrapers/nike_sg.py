"""
Nike Singapore product scraper.

Scrapes sports apparel, footwear, and equipment from Nike SG and outputs
structured JSON matching the BuyWhere catalog schema for ingestion via
POST /v1/ingest/products.

Usage:
    python -m scrapers.nike_sg --api-key <key> [--batch-size 100] [--delay 1.0]
    python -m scrapers.nike_sg --scrape-only

Verticals covered:
- Men: Running, Training, Basketball, Soccer — target 8K
- Women: Running, Training, Yoga, Sports Bras — target 8K
- Kids: Boys, Girls, Kids Shoes — target 5K
- Equipment: Bags, Balls, Accessories — target 4K
- Total target: 25K products
"""
import argparse
import asyncio
import json
import os
import re
import time
from typing import Any

import httpx

from scrapers.jsonld_utils import enrich_batch_with_identifiers

MERCHANT_ID = "nike_sg"
SOURCE = "nike_sg"
BASE_URL = "https://www.nike.com/sg"
OUTPUT_DIR = "/home/paperclip/buywhere-api/data/nike"

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-SG,en;q=0.9",
    "Referer": "https://www.nike.com/sg/",
}

CATEGORIES = [
    {"id": "men-running", "name": "Men", "sub": "Running", "url": "https://www.nike.com/sg/men/shoes?path=men-running-shoes"},
    {"id": "men-training", "name": "Men", "sub": "Training", "url": "https://www.nike.com/sg/men/shoes?path=men-training-shoes"},
    {"id": "men-basketball", "name": "Men", "sub": "Basketball", "url": "https://www.nike.com/sg/men/shoes?path=men-basketball-shoes"},
    {"id": "men-soccer", "name": "Men", "sub": "Soccer", "url": "https://www.nike.com/sg/men/shoes?path=men-soccer-cleats"},
    {"id": "women-running", "name": "Women", "sub": "Running", "url": "https://www.nike.com/sg/women/shoes?path=women-running-shoes"},
    {"id": "women-training", "name": "Women", "sub": "Training", "url": "https://www.nike.com/sg/women/shoes?path=women-training-shoes"},
    {"id": "women-yoga", "name": "Women", "sub": "Yoga", "url": "https://www.nike.com/sg/women/apparel?path=women-yoga"},
    {"id": "women-sports-bras", "name": "Women", "sub": "Sports Bras", "url": "https://www.nike.com/sg/women/apparel?path=women-sports-bras"},
    {"id": "kids-boys", "name": "Kids", "sub": "Boys", "url": "https://www.nike.com/sg/kids/boys"},
    {"id": "kids-girls", "name": "Kids", "sub": "Girls", "url": "https://www.nike.com/sg/kids/girls"},
    {"id": "kids-shoes", "name": "Kids", "sub": "Kids Shoes", "url": "https://www.nike.com/sg/kids/kids-shoes"},
    {"id": "equipment-bags", "name": "Equipment", "sub": "Bags", "url": "https://www.nike.com/sg/equipment/bags"},
    {"id": "equipment-balls", "name": "Equipment", "sub": "Balls", "url": "https://www.nike.com/sg/equipment/balls"},
    {"id": "equipment-accessories", "name": "Equipment", "sub": "Accessories", "url": "https://www.nike.com/sg/equipment/accessories"},
]


class NikeScraper:
    def __init__(
        self,
        api_key: str,
        api_base: str = "http://localhost:8000",
        batch_size: int = 100,
        delay: float = 1.0,
        scrape_only: bool = False,
        extract_gtin: bool = False,
    ):
        self.api_key = api_key
        self.api_base = api_base.rstrip("/")
        self.batch_size = batch_size
        self.delay = delay
        self.scrape_only = scrape_only
        self.extract_gtin = extract_gtin
        self.client = httpx.AsyncClient(timeout=30.0, headers=HEADERS)
        self.total_scraped = 0
        self.total_ingested = 0
        self.total_updated = 0
        self.total_failed = 0
        self.products_outfile = None
        self._ensure_output_dir()

    def _ensure_output_dir(self):
        os.makedirs(OUTPUT_DIR, exist_ok=True)
        ts = time.strftime("%Y%m%d_%H%M%S")
        self.products_outfile = os.path.join(OUTPUT_DIR, f"products_{ts}.jsonl")

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
        url = f"{BASE_URL}/pl诱导m/v2/search/product"
        params = {
            "query": "",
            "page": page,
            "pageSize": 60,
            "country": "sg",
            "language": "en",
        }
        try:
            data = await self._get_with_retry(url, params=params)
            if data:
                return data.get("objects", []) or data.get("products", []) or []
            return []
        except Exception:
            return []

    def _extract_price(self, price_str: str | float | int) -> float:
        if isinstance(price_str, (int, float)):
            return float(price_str)
        cleaned = str(price_str).replace("$", "").replace(",", "").replace("SGD", "").strip()
        try:
            return float(cleaned)
        except ValueError:
            return 0.0

    def transform_product(self, raw: dict, category: dict) -> dict[str, Any] | None:
        try:
            sku = str(raw.get("sku", "") or raw.get("productId", "") or raw.get("id", ""))
            if not sku:
                return None

            title = raw.get("title", "") or raw.get("name", "") or raw.get("productName", "")
            if not title:
                return None

            price = self._extract_price(raw.get("price", raw.get("priceRange", {}).get("minPrice", 0)))
            original_price = self._extract_price(
                raw.get("originalPrice", raw.get("priceRange", {}).get("maxPrice", price))
            )

            images = raw.get("images", []) or raw.get("imageURLs", []) or []
            image_url = ""
            if images:
                if isinstance(images[0], str):
                    image_url = images[0]
                elif isinstance(images[0], dict):
                    image_url = images[0].get("url", "")

            product_url = raw.get("url", "") or raw.get("productUrl", "")
            if product_url and not product_url.startswith("http"):
                product_url = BASE_URL + product_url

            brand = raw.get("brand", "") or "Nike"

            rating = raw.get("rating", 0.0) or raw.get("starRating", 0.0) or 0.0
            review_count = raw.get("reviewCount", 0) or raw.get("reviews", 0) or 0

            discount = 0
            if original_price > price > 0:
                discount = int(((original_price - price) / original_price) * 100)

            color = raw.get("color", "") or raw.get("colorDescription", "")
            size = raw.get("sizes", []) or raw.get("availableSizes", [])

            return {
                "sku": sku,
                "gtin": raw.get("gtin13") or raw.get("gtin") or "",
                "mpn": raw.get("mpn") or "",
                "merchant_id": MERCHANT_ID,
                "title": title,
                "description": raw.get("description", "") or "",
                "price": price,
                "currency": "SGD",
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
                    "subcategory": category["sub"],
                    "color": color,
                    "sizes": size,
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

    async def scrape_category(self, category: dict) -> dict[str, int]:
        cat_id = category["id"]
        cat_name = category["name"]
        sub_name = category["sub"]

        print(f"\n[{cat_name} / {sub_name}] Starting scrape...")
        counts = {"scraped": 0, "ingested": 0, "updated": 0, "failed": 0}
        page = 1
        batch = []
        consecutive_empty = 0
        max_pages = 500

        while consecutive_empty < 5 and page <= max_pages:
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
                        if self.extract_gtin:
                            await enrich_batch_with_identifiers(batch, "url", self.client, max_concurrent=5)
                        i, u, f = await self.ingest_batch(batch)
                        counts["ingested"] += i
                        counts["updated"] += u
                        counts["failed"] += f
                        self.total_ingested += i
                        self.total_updated += u
                        self.total_failed += f
                        batch = []
                        await asyncio.sleep(self.delay)

            print(f"Page {page}: scraped={counts['scraped']}{', gtin=enabled' if self.extract_gtin else ''}")

            if len(products) < 60:
                break

            page += 1
            await asyncio.sleep(self.delay)

        if batch:
            if self.extract_gtin:
                await enrich_batch_with_identifiers(batch, "url", self.client, max_concurrent=5)
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

    async def run(self) -> dict[str, Any]:
        mode = "scrape only" if self.scrape_only else f"API: {self.api_base}"
        print(f"Nike SG Scraper starting...")
        print(f"Mode: {mode}")
        print(f"Batch size: {self.batch_size}, Delay: {self.delay}s")
        print(f"Output: {self.products_outfile}")
        print(f"Categories: {len(CATEGORIES)} verticals")
        print(f"Verticals: Men, Women, Kids, Equipment")
        print(f"Target: 25K products")

        start = time.time()

        for cat in CATEGORIES:
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

        print(f"\nScraper complete: {summary}")
        return summary


async def main():
    parser = argparse.ArgumentParser(description="Nike SG Scraper")
    parser.add_argument("--api-key", required=True, help="BuyWhere API key")
    parser.add_argument(
        "--api-base",
        default="http://localhost:8000",
        help="BuyWhere API base URL",
    )
    parser.add_argument("--batch-size", type=int, default=100)
    parser.add_argument("--delay", type=float, default=1.0, help="Delay between batches (seconds)")
    parser.add_argument("--scrape-only", action="store_true", help="Save to JSONL without ingesting")
    parser.add_argument("--extract-gtin", action="store_true", help="Fetch product pages to extract GTIN/EAN/UPC from JSON-LD")
    args = parser.parse_args()

    scraper = NikeScraper(
        api_key=args.api_key,
        api_base=args.api_base,
        batch_size=args.batch_size,
        delay=args.delay,
        scrape_only=args.scrape_only,
        extract_gtin=args.extract_gtin,
    )

    try:
        await scraper.run()
    finally:
        await scraper.close()


if __name__ == "__main__":
    asyncio.run(main())