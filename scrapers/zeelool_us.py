"""
Zeelool.com (BigCommerce) product catalog scraper for BuyWhere.

Zeelool is a BigCommerce store. Product data is available via their internal
BigCommerce API at https://api.zeelool.com/api/products/search without auth.

Usage:
    python -m scrapers.zeelool_us --scrape-only
    python -m scrapers.zeelool_us --api-key <key>
"""

import argparse
import asyncio
import json
import os
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import httpx

from scrapers.scraper_registry import register
from scrapers.scraper_logging import get_logger

log = get_logger("zeelool_us")

MERCHANT_ID = "zeelool_us"
SOURCE = "zeelool_us"
BASE_URL = "https://www.zeelool.com"
API_BASE_URL = "https://api.zeelool.com"
OUTPUT_DIR = Path("/home/paperclip/buywhere-api/data/zeelool_us")

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
    "Accept": "application/json",
}

PAGE_LIMIT = 500
CATEGORY_ID = "70"  # Eyeglasses (main target)

# Minimum product fields required for a valid record
REQUIRED_FIELDS = ["shop_sku", "name"]


@register("zeelool_us")
class ZeeloolUSScraper:
    MERCHANT_ID = MERCHANT_ID
    SOURCE = SOURCE

    def __init__(
        self,
        api_key: str | None = None,
        api_base: str = "http://localhost:8000",
        batch_size: int = 100,
        delay: float = 0.5,
        scrape_only: bool = False,
        data_dir: str | None = None,
        limit: int = 0,
    ):
        self.api_key = api_key
        self.api_base = api_base.rstrip("/")
        self.batch_size = batch_size
        self.delay = delay
        self.scrape_only = scrape_only
        self.limit = limit
        self.output_dir = Path(data_dir) if data_dir else OUTPUT_DIR
        self.output_dir.mkdir(parents=True, exist_ok=True)

        self.httpx_client = httpx.AsyncClient(timeout=30.0, headers=HEADERS, follow_redirects=True)
        self.total_scraped = 0
        self.total_ingested = 0
        self.total_updated = 0
        self.total_failed = 0
        self.seen_skus: set[str] = set()
        self.session_start = time.strftime("%Y%m%d_%H%M%S")
        self.products_file = self.output_dir / f"products_{self.session_start}.jsonl"

    async def close(self) -> None:
        await self.httpx_client.aclose()

    async def _fetch_products_page(self, page: int) -> dict[str, Any] | None:
        url = f"{API_BASE_URL}/api/products/search?groupId={CATEGORY_ID}&page={page}&limit={PAGE_LIMIT}"
        try:
            resp = await self.httpx_client.get(url)
            if resp.status_code == 200:
                return resp.json()
            log.request_failed(url, page, f"HTTP {resp.status_code}")
            return None
        except Exception as e:
            log.network_error(url, str(e))
            return None

    async def _fetch_total_count(self) -> int:
        data = await self._fetch_products_page(1)
        if data and data.get("data", {}).get("total"):
            return data["data"]["total"]
        return 0

    def transform_product(self, raw: dict[str, Any]) -> dict[str, Any] | None:
        sku = raw.get("shop_sku", "").strip()
        name = raw.get("name", "").strip()
        if not sku or not name:
            return None

        if sku in self.seen_skus:
            return None

        price_info = raw.get("price_info", [])
        usd_price = None
        for pi in price_info:
            if pi.get("currency") == "USD":
                try:
                    usd_price = float(pi.get("sell_price", 0))
                except (ValueError, TypeError):
                    usd_price = 0.0
                break

        images = raw.get("image", {})
        product_images = images.get("product", [])
        image_url = product_images[0] if product_images else None

        categories = raw.get("product_group", [])
        category_names = sorted(set(g.get("name", "") for g in categories if g.get("name")))

        frame_type = raw.get("frame_type", "")
        frame_shape = raw.get("product_frame_shape", "")
        frame_material = raw.get("product_frame_material", "")
        frame_color = raw.get("product_frame_color_name", "") or raw.get("frame_color", "")
        product_size = raw.get("product_size", "")

        try:
            rating = float(raw.get("spu_review_stars", 0) or 0)
        except (ValueError, TypeError):
            rating = 0.0
        try:
            review_count = int(raw.get("spu_review_count", 0) or 0)
        except (ValueError, TypeError):
            review_count = 0

        is_eyewear = raw.get("is_glass") == 1 or raw.get("is_optical_frame") == 1
        is_sunglasses = raw.get("is_sunglasses") == 1

        description = raw.get("description", "") or ""
        if not description:
            description = raw.get("intro", "") or ""

        return {
            "sku": sku,
            "merchant_id": MERCHANT_ID,
            "title": name,
            "description": description[:5000] if description else None,
            "price": usd_price or 0.0,
            "currency": "USD",
            "url": f"{BASE_URL}/goods-detail/{sku}",
            "image_url": image_url,
            "category": "Eyewear" if is_eyewear else ("Sunglasses" if is_sunglasses else "Eyewear"),
            "category_path": category_names,
            "brand": "Zeelool",
            "is_active": True,
            "in_stock": True,
            "country_code": "US",
            "region": "us",
            "metadata": {
                "canonical_id": raw.get("id"),
                "business_sku": raw.get("business_sku"),
                "frame_type": frame_type,
                "frame_shape": frame_shape,
                "frame_material": frame_material,
                "frame_color": frame_color,
                "product_size": product_size,
                "glass_width": raw.get("glass_width"),
                "glass_height": raw.get("glass_height"),
                "frame_bridge": raw.get("frame_bridge"),
                "frame_leg_length": raw.get("frame_leg_length"),
                "weight": raw.get("weight"),
                "rating": rating,
                "review_count": review_count,
                "discount_percent": raw.get("discount_percent", 0),
                "category_ids": [g.get("id") for g in categories if g.get("id")],
                "category_names": category_names,
                "is_eyewear": is_eyewear,
                "is_sunglasses": is_sunglasses,
                "lens_type": raw.get("lens_type"),
                "prescription_type": raw.get("prescription_type"),
                "source": SOURCE,
                "scraped_at": datetime.now(timezone.utc).isoformat(),
            },
        }

    async def scrape_all(self) -> dict[str, int]:
        counts = {"scraped": 0, "ingested": 0, "updated": 0, "failed": 0}
        batch: list[dict[str, Any]] = []

        total = await self._fetch_total_count()
        if not total:
            log.progress("No products found")
            return counts

        total_pages = (total + PAGE_LIMIT - 1) // PAGE_LIMIT
        log.progress(f"Total products: {total}, pages: {total_pages}")

        for page in range(1, total_pages + 1):
            if self.limit > 0 and self.total_scraped >= self.limit:
                break

            data = await self._fetch_products_page(page)
            if not data:
                log.progress(f"Page {page}: no data, stopping")
                break

            products = data.get("data", {}).get("list", [])
            if not products:
                log.progress(f"Page {page}: empty list, stopping")
                break

            for raw in products:
                if self.limit > 0 and self.total_scraped >= self.limit:
                    break

                transformed = self.transform_product(raw)
                if not transformed:
                    continue

                self.seen_skus.add(transformed["sku"])
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

            log.progress(f"Page {page}/{total_pages}: scraped={counts['scraped']}, total={self.total_scraped}")

            await asyncio.sleep(self.delay)

        if batch:
            i, u, f = await self.ingest_batch(batch)
            counts["ingested"] += i
            counts["updated"] += u
            counts["failed"] += f
            self.total_ingested += i
            self.total_updated += u
            self.total_failed += f

        return counts

    async def ingest_batch(self, products: list[dict[str, Any]]) -> tuple[int, int, int]:
        if not products:
            return 0, 0, 0

        if self.scrape_only:
            with open(self.products_file, "a", encoding="utf-8") as f:
                for product in products:
                    f.write(json.dumps(product, ensure_ascii=False) + "\n")
            return len(products), 0, 0

        url = f"{self.api_base}/v1/ingest/products"
        headers = {"Authorization": f"Bearer {self.api_key}"}
        payload = {"source": SOURCE, "products": products}

        try:
            resp = await self.httpx_client.post(url, json=payload, headers=headers)
            resp.raise_for_status()
            result = resp.json()
            return (
                result.get("rows_inserted", 0),
                result.get("rows_updated", 0),
                result.get("rows_failed", 0),
            )
        except Exception as e:
            log.ingestion_error(None, f"Ingestion error: {e}")
            return 0, 0, len(products)

    async def run(self) -> dict[str, Any]:
        mode = "scrape only" if self.scrape_only else f"API: {self.api_base}"
        log.progress("Zeelool US (BigCommerce) Scraper starting...")
        log.progress(f"Mode: {mode}")
        log.progress(f"Category: {CATEGORY_ID} (Eyeglasses)")
        log.progress(f"Output: {self.products_file}")

        start = time.time()
        counts = await self.scrape_all()
        elapsed = time.time() - start

        summary = {
            "elapsed_seconds": round(elapsed, 1),
            "total_scraped": self.total_scraped,
            "total_ingested": self.total_ingested,
            "total_updated": self.total_updated,
            "total_failed": self.total_failed,
            "unique_skus": len(self.seen_skus),
            "products_file": str(self.products_file),
            "counts": counts,
        }

        log.progress(f"Scraper complete: {summary}")
        return summary


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Zeelool US (BigCommerce) product scraper")
    parser.add_argument("--api-key", help="BuyWhere API key")
    parser.add_argument("--api-base", default="http://localhost:8000", help="BuyWhere API base URL")
    parser.add_argument("--batch-size", type=int, default=100)
    parser.add_argument("--delay", type=float, default=0.5, help="Delay between page requests")
    parser.add_argument("--scrape-only", action="store_true", help="Save to JSONL without ingesting")
    parser.add_argument("--data-dir", default=None, help="Directory to save scraped data")
    parser.add_argument(
        "--limit",
        type=int,
        default=0,
        help="Maximum number of products (0 = unlimited)",
    )
    return parser


async def main() -> None:
    parser = build_parser()
    args = parser.parse_args()

    if not args.scrape_only and not args.api_key:
        parser.error("--api-key is required unless --scrape-only is used")

    scraper = ZeeloolUSScraper(
        api_key=args.api_key,
        api_base=args.api_base,
        batch_size=args.batch_size,
        delay=args.delay,
        scrape_only=args.scrape_only,
        data_dir=args.data_dir,
        limit=args.limit,
    )

    try:
        await scraper.run()
    finally:
        await scraper.close()


if __name__ == "__main__":
    asyncio.run(main())
