"""
NTUC FairPrice Singapore product scraper.

Scrapes grocery products from FairPrice SG and outputs structured NDJSON matching
the BuyWhere catalog schema for ingestion via /v1/ingest/products.

FairPrice's legacy `/api/catalog/.../products` route no longer returns product
data. The current site uses:
- `GET /api/nav` for category discovery
- `GET /api/product/v2` for paginated category listings

Usage:
    python -m scrapers.fairprice_sg --api-key <key> [--batch-size 100] [--delay 0.5]
    python -m scrapers.fairprice_sg --scrape-only [--output-dir ./data/fairprice]

Target: 20,000 unique products
"""

import argparse
import asyncio
import json
import time
from pathlib import Path
from typing import Any

import httpx

from scrapers.logging import get_logger

MERCHANT_ID = "fairprice_sg"
SOURCE = "fairprice_sg"
BASE_URL = "https://www.fairprice.com.sg"
API_BASE_URL = "https://website-api.omni.fairprice.com.sg/api"
DEFAULT_STORE_ID = 165
PAGE_SIZE = 20

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept": "application/json",
    "Accept-Language": "en-SG,en;q=0.9",
}

log = get_logger(MERCHANT_ID)


class FairPriceScraper:
    def __init__(
        self,
        api_key: str | None = None,
        api_base: str = "http://localhost:8000",
        batch_size: int = 100,
        delay: float = 0.5,
        output_dir: str | None = None,
        scrape_only: bool = False,
        target_products: int = 20000,
        store_id: int = DEFAULT_STORE_ID,
    ):
        self.api_key = api_key
        self.api_base = api_base.rstrip("/")
        self.batch_size = batch_size
        self.delay = delay
        self.scrape_only = scrape_only
        self.target_products = target_products
        self.store_id = store_id
        self.output_dir = Path(output_dir) if output_dir else Path("/home/paperclip/buywhere-api/data") / MERCHANT_ID
        self.output_dir.mkdir(parents=True, exist_ok=True)
        self.outfile = self.output_dir / f"products_{time.strftime('%Y%m%d_%H%M%S')}.jsonl"
        self.client = httpx.AsyncClient(timeout=30.0, headers=HEADERS, follow_redirects=True)

        self.total_scraped = 0
        self.total_ingested = 0
        self.total_updated = 0
        self.total_failed = 0
        self.seen_skus: set[str] = set()

    async def close(self):
        await self.client.aclose()

    async def _get_json(self, url: str, params: dict[str, Any] | None = None, retries: int = 3) -> dict[str, Any] | None:
        for attempt in range(retries):
            try:
                resp = await self.client.get(url, params=params)
                resp.raise_for_status()
                return resp.json()
            except Exception as exc:
                if attempt < retries - 1:
                    await asyncio.sleep(2 ** attempt)
                else:
                    log.request_failed(str(resp.url) if "resp" in locals() else url, attempt, str(exc))
                    return None
        return None

    async def get_categories(self) -> list[dict[str, str]]:
        payload = await self._get_json(f"{API_BASE_URL}/nav", params={"storeId": self.store_id})
        items = payload.get("data", []) if payload else []
        categories: list[dict[str, str]] = []
        seen: set[str] = set()

        def walk(nodes: Any, parents: list[str]) -> None:
            if isinstance(nodes, list):
                for node in nodes:
                    walk(node, parents)
                return
            if not isinstance(nodes, dict):
                return

            name = str(nodes.get("name") or "").strip()
            url = str(nodes.get("url") or "")
            current_parents = parents + ([name] if name else [])

            if "/category/" in url:
                slug = url.split("/category/", 1)[1].strip("/")
                if slug and slug not in seen:
                    seen.add(slug)
                    categories.append(
                        {
                            "slug": slug,
                            "name": name or slug.replace("-", " ").title(),
                            "path": current_parents,
                        }
                    )

            for child in nodes.get("menu") or []:
                walk(child, current_parents)

        walk(items, [])
        return categories

    async def fetch_products_page(self, category_slug: str, page: int) -> dict[str, Any] | None:
        params = {
            "pageType": "category",
            "url": category_slug,
            "page": page,
            "storeId": self.store_id,
            "orderType": "DELIVERY",
            "includeTagDetails": "true",
        }
        payload = await self._get_json(f"{API_BASE_URL}/product/v2", params=params)
        return payload.get("data") if payload else None

    def _category_path_from_product(self, raw: dict[str, Any], nav_path: list[str]) -> list[str]:
        chain: list[str] = []
        category = raw.get("primaryCategory") or {}
        while isinstance(category, dict) and category:
            name = str(category.get("name") or "").strip()
            if name:
                chain.append(name)
            category = category.get("parentCategory")
        chain.reverse()
        return chain or nav_path

    def _product_price(self, raw: dict[str, Any]) -> float:
        final_price = raw.get("final_price")
        if isinstance(final_price, (int, float)) and final_price > 0:
            return float(final_price)

        store_data = (raw.get("storeSpecificData") or [{}])[0]
        try:
            mrp = float(store_data.get("mrp") or 0)
            discount = float(store_data.get("discount") or 0)
            discounted = mrp - discount if discount > 0 else mrp
            if discounted > 0:
                return discounted
        except (TypeError, ValueError):
            pass
        return 0.0

    def transform_product(self, raw: dict[str, Any], category: dict[str, str]) -> dict[str, Any] | None:
        sku = str(raw.get("clientItemId") or raw.get("id") or "").strip()
        if not sku or sku in self.seen_skus:
            return None

        title = str(raw.get("name") or "").strip()
        if not title:
            return None

        price = self._product_price(raw)
        if price <= 0:
            return None

        slug = str(raw.get("slug") or "").strip()
        if not slug:
            return None

        images = raw.get("images") or []
        image_url = images[0] if images else ""

        brand = ""
        if isinstance(raw.get("brand"), dict):
            brand = str(raw["brand"].get("name") or "").strip()

        store_data = (raw.get("storeSpecificData") or [{}])[0]
        category_path = self._category_path_from_product(raw, category["path"])
        category_name = category_path[-1] if category_path else category["name"]

        self.seen_skus.add(sku)
        return {
            "sku": sku,
            "merchant_id": MERCHANT_ID,
            "title": title,
            "description": str(raw.get("description") or ""),
            "price": price,
            "currency": "SGD",
            "url": f"{BASE_URL}/product/{slug}",
            "image_url": image_url,
            "category": category_name,
            "category_path": category_path,
            "brand": brand,
            "is_active": str(raw.get("status") or "").upper() == "ENABLED",
            "in_stock": bool(raw.get("has_stock")),
            "stock_level": store_data.get("stock"),
            "metadata": {
                "category_slug": category["slug"],
                "barcodes": raw.get("barcodes") or [],
                "display_unit": (raw.get("metaData") or {}).get("DisplayUnit"),
                "seller_name": (raw.get("metaData") or {}).get("Fp Seller Name"),
                "sap_material_number": (raw.get("metaData") or {}).get("SAPMaterialNumber"),
                "stock_scale": store_data.get("stockScale"),
            },
        }

    def save_products_ndjson(self, products: list[dict[str, Any]]) -> None:
        if not products:
            return
        with self.outfile.open("a", encoding="utf-8") as handle:
            for product in products:
                handle.write(json.dumps(product, ensure_ascii=False) + "\n")

    async def ingest_batch(self, products: list[dict[str, Any]]) -> tuple[int, int, int]:
        if not products:
            return 0, 0, 0

        self.save_products_ndjson(products)

        if self.scrape_only:
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
        except Exception as exc:
            log.ingestion_error(url, str(exc))
            return 0, 0, len(products)

    async def flush_batch(self, batch: list[dict[str, Any]]) -> list[dict[str, Any]]:
        inserted, updated, failed = await self.ingest_batch(batch)
        if self.scrape_only:
            self.total_scraped += inserted
        else:
            self.total_scraped += len(batch)
            self.total_ingested += inserted
            self.total_updated += updated
            self.total_failed += failed
        return []

    async def scrape_category(self, category: dict[str, str], batch: list[dict[str, Any]]) -> list[dict[str, Any]]:
        first_page = await self.fetch_products_page(category["slug"], 1)
        if not first_page:
            return batch

        total_count = int(first_page.get("count") or 0)
        if total_count <= 0:
            return batch

        pagination = first_page.get("pagination") or {}
        total_pages = int(pagination.get("total_pages") or 1)
        print(f"[{category['name']}] count={total_count} pages={total_pages}", flush=True)

        for page in range(1, total_pages + 1):
            data = first_page if page == 1 else await self.fetch_products_page(category["slug"], page)
            if not data:
                break

            raw_products = data.get("product") or []
            if not raw_products:
                break

            for raw in raw_products:
                transformed = self.transform_product(raw, category)
                if not transformed:
                    continue

                batch.append(transformed)

                reached_target = self.target_products > 0 and len(self.seen_skus) >= self.target_products
                if len(batch) >= self.batch_size or reached_target:
                    batch = await self.flush_batch(batch)
                    await asyncio.sleep(self.delay)

                if reached_target:
                    return batch

            await asyncio.sleep(self.delay)

        return batch

    async def run(self) -> dict[str, Any]:
        mode = "scrape-only" if self.scrape_only else "scrape + ingest"
        print(f"FairPrice SG Scraper starting... (mode: {mode})", flush=True)
        print(f"Store ID: {self.store_id}", flush=True)
        print(f"Target products: {self.target_products or 'all'}", flush=True)
        print(f"Output: {self.outfile}", flush=True)

        start = time.time()
        categories = await self.get_categories()
        print(f"Discovered {len(categories)} category slugs", flush=True)

        batch: list[dict[str, Any]] = []
        for idx, category in enumerate(categories, start=1):
            print(f"{idx}/{len(categories)} {category['slug']}", flush=True)
            batch = await self.scrape_category(category, batch)
            if self.target_products > 0 and len(self.seen_skus) >= self.target_products:
                print(f"Reached target of {self.target_products} unique products", flush=True)
                break

        if batch:
            await self.flush_batch(batch)

        elapsed = time.time() - start
        summary = {
            "elapsed_seconds": round(elapsed, 1),
            "total_scraped": self.total_scraped,
            "total_ingested": self.total_ingested,
            "total_updated": self.total_updated,
            "total_failed": self.total_failed,
            "unique_products": len(self.seen_skus),
            "output_file": str(self.outfile),
        }
        print(json.dumps(summary, indent=2), flush=True)
        return summary


async def main():
    parser = argparse.ArgumentParser(description="FairPrice SG Scraper")
    parser.add_argument("--api-key", help="BuyWhere API key (required for ingestion)")
    parser.add_argument("--api-base", default="http://localhost:8000", help="BuyWhere API base URL")
    parser.add_argument("--batch-size", type=int, default=100)
    parser.add_argument("--delay", type=float, default=0.5, help="Delay between requests in seconds")
    parser.add_argument("--scrape-only", action="store_true", help="Only scrape and save NDJSON, skip ingestion")
    parser.add_argument("--output-dir", default=None, help="Output directory for scraped data")
    parser.add_argument("--target-products", type=int, default=20000, help="Stop after this many unique products; use 0 for all")
    parser.add_argument("--store-id", type=int, default=DEFAULT_STORE_ID, help="FairPrice store id for product availability")
    args = parser.parse_args()

    if not args.scrape_only and not args.api_key:
        parser.error("--api-key is required unless --scrape-only is specified")

    scraper = FairPriceScraper(
        api_key=args.api_key,
        api_base=args.api_base,
        batch_size=args.batch_size,
        delay=args.delay,
        output_dir=args.output_dir,
        scrape_only=args.scrape_only,
        target_products=args.target_products,
        store_id=args.store_id,
    )

    try:
        await scraper.run()
    finally:
        await scraper.close()


if __name__ == "__main__":
    asyncio.run(main())
