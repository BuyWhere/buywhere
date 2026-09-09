"""
Sephora Singapore product scraper.

Scrapes beauty products from Sephora SG and outputs structured JSON
matching the BuyWhere catalog schema for ingestion via /v1/ingest/products.

Usage:
    python -m scrapers.sephora_sg --api-key <key> [--batch-size 100] [--delay 1.0]

Categories covered: Skincare, Makeup, Fragrance, Haircare, Body
Target: 15,000 products
"""
import argparse
import asyncio
import time
from typing import Any

import httpx

MERCHANT_ID = "sephora_sg"
SOURCE = "sephora_sg"
BASE_URL = "https://www.sephora.com"

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
    "Accept": "application/json",
    "Accept-Language": "en-SG,en;q=0.9",
}

CATEGORIES = [
    {"id": "skincare", "name": "Skincare"},
    {"id": "makeup", "name": "Makeup"},
    {"id": "fragrance", "name": "Fragrance"},
    {"id": "haircare", "name": "Haircare"},
    {"id": "body", "name": "Body"},
]


class SephoraScraper:
    def __init__(
        self,
        api_key: str,
        api_base: str = "http://localhost:8000",
        batch_size: int = 100,
        delay: float = 1.0,
    ):
        self.api_key = api_key
        self.api_base = api_base.rstrip("/")
        self.batch_size = batch_size
        self.delay = delay
        self.client = httpx.AsyncClient(timeout=30.0, headers=HEADERS)
        self.total_scraped = 0
        self.total_ingested = 0
        self.total_updated = 0
        self.total_failed = 0

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

    async def fetch_products_by_category(self, category_id: str, page: int = 1) -> list[dict]:
        url = f"{BASE_URL}/api/catalog/{category_id}/products"
        params = {"page": page, "pageSize": 100}
        try:
            data = await self._get_with_retry(url, params=params)
            if data:
                return data.get("products", [])
            return []
        except Exception:
            return []

    def transform_product(self, raw: dict, category: str) -> dict[str, Any] | None:
        try:
            sku = str(raw.get("id", ""))
            if not sku:
                return None

            brand = raw.get("brandName", "") or raw.get("brand", "")
            name = raw.get("displayName", "") or raw.get("name", "")
            if not name:
                return None

            price_str = str(raw.get("price", "0")).replace("$", "").replace(",", "")
            price = float(price_str) if price_str else 0.0

            images = raw.get("imageUrls", []) or raw.get("images", [])
            image_url = ""
            if images:
                image_url = images[0] if isinstance(images[0], str) else images[0].get("url", "")

            product_url = f"{BASE_URL}/product/{sku}"
            rating = float(raw.get("rating", 0.0))
            review_count = int(raw.get("reviewCount", 0))
            subcategory = raw.get("subcategory", "") or ""
            category_path = [category, subcategory] if subcategory else [category]

            return {
                "sku": sku,
                "merchant_id": MERCHANT_ID,
                "title": name,
                "description": raw.get("description", ""),
                "price": price,
                "currency": "SGD",
                "url": product_url,
                "image_url": image_url,
                "category": category,
                "category_path": category_path,
                "brand": brand,
                "is_active": True,
                "metadata": {
                    "rating": rating,
                    "review_count": review_count,
                    "subcategory": subcategory,
                },
            }
        except Exception:
            return None

    async def ingest_batch(self, products: list[dict]) -> tuple[int, int, int]:
        if not products:
            return 0, 0, 0

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

    async def scrape_category(self, category_id: str, category_name: str) -> dict[str, int]:
        print(f"\n[{category_name}] Starting scrape...")
        counts = {"scraped": 0, "ingested": 0, "updated": 0, "failed": 0}
        page = 1
        batch = []

        while True:
            print(f"  Page {page}...", end=" ", flush=True)
            products = await self.fetch_products_by_category(category_id, page)

            if not products:
                print("No products found, ending pagination.")
                break

            for raw in products:
                transformed = self.transform_product(raw, category_name)
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

            if batch:
                i, u, f = await self.ingest_batch(batch)
                counts["ingested"] += i
                counts["updated"] += u
                counts["failed"] += f
                self.total_ingested += i
                self.total_updated += u
                self.total_failed += f
                batch = []

            print(f"scraped={counts['scraped']}")

            if len(products) < 100:
                break

            page += 1
            await asyncio.sleep(self.delay)

        self.total_scraped += counts["scraped"]
        print(f"  [{category_name}] Done: {counts}")
        return counts

    async def run(self) -> dict[str, Any]:
        print(f"Sephora SG Scraper starting...")
        print(f"API: {self.api_base}")
        print(f"Batch size: {self.batch_size}, Delay: {self.delay}s")
        print(f"Categories: {[c['name'] for c in CATEGORIES]}")

        start = time.time()

        for cat in CATEGORIES:
            await self.scrape_category(cat["id"], cat["name"])
            await asyncio.sleep(2)

        elapsed = time.time() - start

        summary = {
            "elapsed_seconds": round(elapsed, 1),
            "total_scraped": self.total_scraped,
            "total_ingested": self.total_ingested,
            "total_updated": self.total_updated,
            "total_failed": self.total_failed,
        }

        print(f"\nScraper complete: {summary}")
        return summary


async def main():
    parser = argparse.ArgumentParser(description="Sephora SG Scraper")
    parser.add_argument("--api-key", required=True, help="BuyWhere API key")
    parser.add_argument(
        "--api-base",
        default="http://localhost:8000",
        help="BuyWhere API base URL",
    )
    parser.add_argument("--batch-size", type=int, default=100)
    parser.add_argument("--delay", type=float, default=1.0, help="Delay between batches (seconds)")
    args = parser.parse_args()

    scraper = SephoraScraper(
        api_key=args.api_key,
        api_base=args.api_base,
        batch_size=args.batch_size,
        delay=args.delay,
    )

    try:
        await scraper.run()
    finally:
        await scraper.close()


if __name__ == "__main__":
    asyncio.run(main())