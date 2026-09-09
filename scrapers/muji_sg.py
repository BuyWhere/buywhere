"""
Muji Singapore product scraper.

Scrapes lifestyle, stationery, clothing and home products from Muji SG
and outputs structured JSON matching the BuyWhere catalog schema.

Usage:
    python -m scrapers.muji_sg --scrape-only
    python -m scrapers.muji_sg --api-key <key> [--batch-size 100] [--delay 1.0]

Verticals covered:
- Men: Tops, Bottoms, Outerwear, Innerwear
- Women: Tops, Bottoms, Outerwear, Innerwear, Dresses
- Lifestyle: Stationery, Home, Kitchen
- Kids: Boys, Girls
"""
import argparse
import asyncio
import json
import os
import time
from typing import Any

import httpx

from scrapers.logging import get_logger

MERCHANT_ID = "muji_sg"
log = get_logger(MERCHANT_ID)
SOURCE = "muji_sg"
BASE_URL = "https://www.muji.com.sg"
OUTPUT_DIR = "/home/paperclip/buywhere-api/data/muji"

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-SG,en;q=0.9",
    "Referer": "https://www.muji.com.sg/",
}

CATEGORIES = [
    {"id": "men", "name": "Men", "sub": "All", "gender": "MEN"},
    {"id": "women", "name": "Women", "sub": "All", "gender": "WOMEN"},
    {"id": "lifestyle", "name": "Lifestyle", "sub": "All", "gender": "UNISEX"},
    {"id": "kids", "name": "Kids", "sub": "All", "gender": "KIDS"},
]

GENDER_MAP = {
    "MEN": "Men",
    "WOMEN": "Women",
    "KIDS": "Kids",
    "BABY": "Baby",
    "UNISEX": "Unisex",
}

API_URL = "https://www.muji.com.sg/api/commerce/v3/en/products"


class MujiScraper:
    def __init__(
        self,
        api_key: str,
        api_base: str = "http://localhost:8000",
        batch_size: int = 100,
        delay: float = 1.0,
        scrape_only: bool = False,
    ):
        self.api_key = api_key
        self.api_base = api_base.rstrip("/")
        self.batch_size = batch_size
        self.delay = delay
        self.scrape_only = scrape_only
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

    async def fetch_products_page(self, offset: int = 0, limit: int = 60) -> tuple[list[dict], int]:
        params = {
            "offset": offset,
            "limit": limit,
        }
        try:
            data = await self._get_with_retry(API_URL, params=params)
            if data and data.get("status") == "ok":
                result = data.get("result", {})
                items = result.get("items", [])
                total = result.get("pagination", {}).get("total", 0)
                return items, total
            return [], 0
        except Exception:
            return [], 0

    def _extract_price(self, price_data: Any) -> float:
        if price_data is None:
            return 0.0
        if isinstance(price_data, (int, float)):
            return float(price_data)
        if isinstance(price_data, dict):
            promo = price_data.get("promo")
            if isinstance(promo, dict):
                value = promo.get("value")
                if value:
                    try:
                        return float(value)
                    except (ValueError, TypeError):
                        pass
            base = price_data.get("base")
            if isinstance(base, dict):
                value = base.get("value")
                if value:
                    try:
                        return float(value)
                    except (ValueError, TypeError):
                        pass
        return 0.0

    def transform_product(self, raw: dict) -> dict[str, Any] | None:
        try:
            product_id = str(raw.get("productId", ""))
            if not product_id:
                return None

            title = raw.get("name", "") or ""
            if not title:
                return None

            price = self._extract_price(raw.get("prices"))
            images_data = raw.get("images", {})
            if isinstance(images_data, dict):
                main_images = images_data.get("main", [])
                if main_images and isinstance(main_images[0], dict):
                    image_url = main_images[0].get("url", "")
                else:
                    image_url = ""
            elif isinstance(images_data, list):
                image_url = images_data[0] if images_data else ""
            else:
                image_url = ""

            product_url = f"{BASE_URL}/en/products/{product_id}"

            colors = raw.get("colors", [])
            color_names = [c.get("name", "") for c in colors if isinstance(c, dict)] if colors else []

            sizes = raw.get("sizes", [])
            size_names = [s.get("name", "") for s in sizes if isinstance(s, dict)] if sizes else []

            gender_name = raw.get("genderName", "")
            gender_display = GENDER_MAP.get(gender_name.upper(), gender_name if gender_name else "Unisex")

            category_path = raw.get("categories", []) or []
            if isinstance(category_path, list) and category_path:
                top_category = category_path[0] if len(category_path) > 0 else ""
            else:
                top_category = gender_display

            return {
                "sku": product_id,
                "merchant_id": MERCHANT_ID,
                "title": title,
                "description": raw.get("longDescription", "") or raw.get("shortDescription", "") or "",
                "price": price,
                "currency": "SGD",
                "url": product_url,
                "image_url": image_url,
                "category": top_category,
                "category_path": [top_category],
                "brand": "MUJI",
                "is_active": True,
                "metadata": {
                    "original_price": price,
                    "discount_pct": 0,
                    "rating": raw.get("rating", 0.0) or 0.0,
                    "review_count": raw.get("reviews", {}).get("total", 0) if isinstance(raw.get("reviews"), dict) else 0,
                    "gender": gender_display,
                    "colors": color_names,
                    "sizes": size_names,
                    "product_id": product_id,
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
            log.ingestion_error(None, str(e))
            return 0, 0, len(products)

    async def scrape_all(self, target_genders: list[str] | None = None) -> dict[str, int]:
        print(f"\nFetching all products from Muji SG...")
        counts = {"scraped": 0, "ingested": 0, "updated": 0, "failed": 0}
        offset = 0
        limit = 60
        batch = []
        seen_ids = set()
        max_offset = 10000

        while offset < max_offset:
            print(f"  Fetching offset {offset}...", end=" ", flush=True)
            products, total = await self.fetch_products_page(offset=offset, limit=limit)

            if not products:
                print("No more products.")
                break

            print(f"got {len(products)} products (total: {total})")

            for raw in products:
                product_id = str(raw.get("productId", ""))
                if product_id in seen_ids:
                    continue
                seen_ids.add(product_id)

                gender_name = raw.get("genderName", "")
                gender_display = GENDER_MAP.get(gender_name.upper(), gender_name if gender_name else "Unisex")

                if target_genders and gender_display not in target_genders:
                    continue

                transformed = self.transform_product(raw)
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

            offset += limit
            await asyncio.sleep(self.delay)

            if total > 0 and offset >= total:
                break

        if batch:
            i, u, f = await self.ingest_batch(batch)
            counts["ingested"] += i
            counts["updated"] += u
            counts["failed"] += f
            self.total_ingested += i
            self.total_updated += u
            self.total_failed += f

        self.total_scraped += counts["scraped"]
        print(f"  Scrape complete: {counts}")
        return counts

    async def run(self) -> dict[str, Any]:
        mode = "scrape only" if self.scrape_only else f"API: {self.api_base}"
        print(f"Muji SG Scraper starting...")
        print(f"Mode: {mode}")
        print(f"Batch size: {self.batch_size}, Delay: {self.delay}s")
        print(f"Output: {self.products_outfile}")

        start = time.time()

        await self.scrape_all()

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
    parser = argparse.ArgumentParser(description="Muji SG Scraper")
    parser.add_argument("--api-key", default=None, help="BuyWhere API key (required for ingestion)")
    parser.add_argument(
        "--api-base",
        default="http://localhost:8000",
        help="BuyWhere API base URL",
    )
    parser.add_argument("--batch-size", type=int, default=100)
    parser.add_argument("--delay", type=float, default=1.0, help="Delay between batches (seconds)")
    parser.add_argument("--scrape-only", action="store_true", help="Save to JSONL without ingesting")
    args = parser.parse_args()

    if not args.scrape_only and not args.api_key:
        parser.error("--api-key is required unless --scrape-only is specified")

    scraper = MujiScraper(
        api_key=args.api_key or "dummy",
        api_base=args.api_base,
        batch_size=args.batch_size,
        delay=args.delay,
        scrape_only=args.scrape_only,
    )

    try:
        await scraper.run()
    finally:
        await scraper.close()


if __name__ == "__main__":
    asyncio.run(main())
