"""
Decathlon Singapore product scraper.

Scrapes sports equipment, apparel, and footwear from Decathlon SG and outputs
structured JSON matching the BuyWhere catalog schema for ingestion via
POST /v1/ingest/products.

Usage:
    python -m scrapers.decathlon_sg --api-key <key> [--batch-size 100] [--delay 1.0]
    python -m scrapers.decathlon_sg --scrape-only
    python -m scrapers.decathlon_sg --url-refresh --product-ids-file <file> [--dry-run]

Verticals covered:
- Sports Equipment: Camping, cycling, fitness, team sports — target 10K
- Apparel: Sports clothing, shoes, accessories — target 10K
- Water Sports: Swimming, diving, surfing — target 5K
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

MERCHANT_ID = "decathlon_sg"
SOURCE = "decathlon_sg"
BASE_URL = "https://www.decathlon.sg"
OUTPUT_DIR = "/home/paperclip/buywhere-api/data/decathlon"

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-SG,en;q=0.9",
    "Referer": "https://www.decathlon.sg/",
}

CATEGORIES = [
    {"id": "camping", "name": "Sports Equipment", "sub": "Camping", "url": "https://www.decathlon.sg/camping"},
    {"id": "cycling", "name": "Sports Equipment", "sub": "Cycling", "url": "https://www.decathlon.sg/cycling"},
    {"id": "fitness", "name": "Sports Equipment", "sub": "Fitness", "url": "https://www.decathlon.sg/fitness"},
    {"id": "team-sports", "name": "Sports Equipment", "sub": "Team Sports", "url": "https://www.decathlon.sg/team-sports"},
    {"id": "running", "name": "Apparel", "sub": "Running", "url": "https://www.decathlon.sg/running"},
    {"id": "hiking", "name": "Apparel", "sub": "Hiking", "url": "https://www.decathlon.sg/hiking"},
    {"id": "sports-shoes", "name": "Apparel", "sub": "Sports Shoes", "url": "https://www.decathlon.sg/sports-shoes"},
    {"id": "swimming", "name": "Water Sports", "sub": "Swimming", "url": "https://www.decathlon.sg/swimming"},
    {"id": "diving", "name": "Water Sports", "sub": "Diving", "url": "https://www.decathlon.sg/diving"},
    {"id": "surfing", "name": "Water Sports", "sub": "Surfing", "url": "https://www.decathlon.sg/surfing"},
]


class DecathlonScraper:
    def __init__(
        self,
        api_key: str,
        api_base: str = "http://localhost:8000",
        batch_size: int = 100,
        delay: float = 1.0,
        scrape_only: bool = False,
        url_refresh_mode: bool = False,
        product_ids_file: str | None = None,
        dry_run: bool = False,
    ):
        self.api_key = api_key
        self.api_base = api_base.rstrip("/")
        self.batch_size = batch_size
        self.delay = delay
        self.scrape_only = scrape_only
        self.url_refresh_mode = url_refresh_mode
        self.product_ids_file = product_ids_file
        self.dry_run = dry_run
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
        if self.url_refresh_mode:
            ts += "_url_refresh"
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
        url = f"{BASE_URL}/search"
        params = {
            "q": "",
            "category": category["id"],
            "page": page,
            "page_size": 60,
        }
        try:
            resp = await self.client.get(url, params=params)
            resp.raise_for_status()
            data = resp.json()
            return data.get("products", []) or []
        except Exception:
            return []

    async def fetch_product_by_sku(self, sku: str) -> dict[str, Any] | None:
        """Fetch a single product by SKU for URL refresh mode."""
        url = f"{BASE_URL}/search"
        params = {
            "q": sku,
            "page_size": 1,
        }
        try:
            resp = await self.client.get(url, params=params)
            resp.raise_for_status()
            data = resp.json()
            products = data.get("products", []) or []
            for p in products:
                if str(p.get("sku", "")) == str(sku):
                    return p
            # If no exact match, return first result
            return products[0] if products else None
        except Exception as e:
            print(f"  Error fetching SKU {sku}: {e}")
            return None

    def _extract_price(self, price_str: str | float) -> float:
        if isinstance(price_str, (int, float)):
            return float(price_str)
        cleaned = str(price_str).replace("$", "").replace(",", "").strip()
        try:
            return float(cleaned)
        except ValueError:
            return 0.0

    def transform_product(self, raw: dict, category: dict | None = None) -> dict[str, Any] | None:
        try:
            sku = str(raw.get("sku", "") or raw.get("id", ""))
            if not sku:
                return None

            title = raw.get("name", "") or raw.get("title", "")
            if not title:
                return None

            price = self._extract_price(raw.get("price", 0))
            original_price = self._extract_price(raw.get("original_price", raw.get("price", price)))

            images = raw.get("images", []) or raw.get("image_urls", []) or []
            image_url = ""
            if images:
                image_url = images[0] if isinstance(images[0], str) else images[0].get("url", "")

            product_url = raw.get("url", "") or raw.get("link", "")
            if product_url and not product_url.startswith("http"):
                product_url = BASE_URL + product_url

            brand = raw.get("brand", "") or "Decathlon"

            rating = raw.get("rating", 0.0) or 0.0
            review_count = raw.get("review_count", 0) or raw.get("reviews", 0) or 0

            discount = 0
            if original_price > price:
                discount = int(((original_price - price) / original_price) * 100)

            # Determine category
            if category:
                cat_name = category["name"]
                sub_name = category["sub"]
            else:
                cat_name = "Sports"
                sub_name = "General"

            return {
                "sku": sku,
                "merchant_id": MERCHANT_ID,
                "title": title,
                "description": raw.get("description", "") or "",
                "price": price,
                "currency": "SGD",
                "url": product_url,
                "image_url": image_url,
                "category": cat_name,
                "category_path": [cat_name, sub_name],
                "brand": brand,
                "is_active": True,
                "metadata": {
                    "original_price": original_price,
                    "discount_pct": discount,
                    "rating": rating,
                    "review_count": review_count,
                    "subcategory": sub_name,
                    "url_refresh_mode": self.url_refresh_mode,
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

        if self.dry_run:
            print(f"  [DRY-RUN] Would send {len(products)} products to {url}")
            return len(products), 0, 0

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

    async def run_url_refresh(self, product_ids: list[str]) -> dict[str, Any]:
        """Run URL refresh mode - fetch only specific products by SKU/ID and update URL."""
        print(f"Decathlon SG URL Refresh Mode starting...")
        print(f"  Mode: {'DRY-RUN' if self.dry_run else 'LIVE'}")
        print(f"  Product IDs file: {self.product_ids_file}")
        print(f"  Products to refresh: {len(product_ids)}")
        print(f"  Output: {self.products_outfile}")

        start = time.time()
        batch = []
        refreshed_count = 0
        not_found_count = 0

        for i, product_id in enumerate(product_ids):
            print(f"  [{i+1}/{len(product_ids)}] Fetching SKU {product_id}...", end=" ", flush=True)

            product = await self.fetch_product_by_sku(product_id)

            if not product:
                print("NOT FOUND")
                not_found_count += 1
                continue

            transformed = self.transform_product(product, None)
            if transformed:
                batch.append(transformed)
                refreshed_count += 1
                print(f"OK -> {transformed.get('url', '')[:60]}...")
            else:
                not_found_count += 1
                print("TRANSFORM FAILED")
                continue

            if len(batch) >= self.batch_size:
                i_count, u_count, f_count = await self.ingest_batch(batch)
                self.total_ingested += i_count
                self.total_updated += u_count
                self.total_failed += f_count
                batch = []
                await asyncio.sleep(self.delay)

        # Ingest remaining
        if batch:
            i_count, u_count, f_count = await self.ingest_batch(batch)
            self.total_ingested += i_count
            self.total_updated += u_count
            self.total_failed += f_count

        elapsed = time.time() - start

        summary = {
            "elapsed_seconds": round(elapsed, 1),
            "total_scraped": refreshed_count,
            "total_ingested": self.total_ingested,
            "total_updated": self.total_updated,
            "total_failed": self.total_failed,
            "not_found_count": not_found_count,
            "output_file": self.products_outfile,
            "mode": "url_refresh",
        }

        print(f"\nURL Refresh complete: {summary}")
        return summary

    async def run(self) -> dict[str, Any]:
        if self.url_refresh_mode:
            # URL refresh mode - load product IDs from file
            if not self.product_ids_file:
                raise ValueError("--product-ids-file required for URL refresh mode")

            if not os.path.exists(self.product_ids_file):
                raise FileNotFoundError(f"Product IDs file not found: {self.product_ids_file}")

            with open(self.product_ids_file, "r") as f:
                product_ids = [line.strip() for line in f if line.strip()]

            return await self.run_url_refresh(product_ids)

        # Original full-category scrape mode
        mode = "scrape only" if self.scrape_only else f"API: {self.api_base}"
        print(f"Decathlon SG Scraper starting...")
        print(f"Mode: {mode}")
        print(f"Batch size: {self.batch_size}, Delay: {self.delay}s")
        print(f"Output: {self.products_outfile}")
        print(f"Categories: {len(CATEGORIES)} verticals")
        print(f"Verticals: Sports Equipment, Apparel, Water Sports")
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
    parser = argparse.ArgumentParser(description="Decathlon SG Scraper")
    parser.add_argument("--api-key", required=True, help="BuyWhere API key")
    parser.add_argument(
        "--api-base",
        default="http://localhost:8000",
        help="BuyWhere API base URL",
    )
    parser.add_argument("--batch-size", type=int, default=100)
    parser.add_argument("--delay", type=float, default=1.0, help="Delay between batches (seconds)")
    parser.add_argument("--scrape-only", action="store_true", help="Save to JSONL without ingesting")

    # URL refresh mode arguments
    parser.add_argument("--url-refresh", action="store_true", help="Enable URL refresh mode (surgical URL update)")
    parser.add_argument("--product-ids-file", type=str, help="File containing product IDs/SKUs to refresh (one per line)")
    parser.add_argument("--dry-run", action="store_true", help="Dry run - print what would be done without sending to API")

    args = parser.parse_args()

    scraper = DecathlonScraper(
        api_key=args.api_key,
        api_base=args.api_base,
        batch_size=args.batch_size,
        delay=args.delay,
        scrape_only=args.scrape_only,
        url_refresh_mode=args.url_refresh,
        product_ids_file=args.product_ids_file,
        dry_run=args.dry_run,
    )

    try:
        await scraper.run()
    finally:
        await scraper.close()


if __name__ == "__main__":
    asyncio.run(main())
