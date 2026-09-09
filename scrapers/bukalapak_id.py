"""
Bukalapak Indonesia comprehensive product scraper.

Covers ALL major Bukalapak ID categories to target 30K+ products.
Saves structured NDJSON matching the BuyWhere catalog schema for
ingestion via POST /v1/ingest/products.

Output: /home/paperclip/buywhere/data/bukalapak_id.ndjson

Usage:
    python -m scrapers.bukalapak_id --api-key <key> [--batch-size 200] [--delay 0.5]
    python -m scrapers.bukalapak_id --scrape-only  # save to JSONL without ingesting

Categories covered:
- Electronics: Phones, Laptops, TVs, Audio, Cameras, Tablets
- Fashion: Women, Men, Kids, Bags, Watches, Jewellery, Muslim Fashion
- Home & Living: Furniture, Kitchen, Decor, Home Appliances
- Beauty & Health: Health, Cosmetics, Skincare, Supplements

Target: 30,000+ products
"""
import argparse
import asyncio
import json
import os
import re
import time
import urllib.parse
from pathlib import Path
from urllib.parse import urlparse
from typing import Any

import httpx

from scrapers.scraper_logging import get_logger

MERCHANT_ID = "bukalapak_id"
log = get_logger(MERCHANT_ID)
SOURCE = "bukalapak_id"
BASE_URL = "https://www.bukalapak.com"
API_KEY_ENV_VARS = ("BUYWHERE_API_KEY", "PRODUCT_API_KEY", "API_KEY")
SCRAPERAPI_KEY_ENV = "SCRAPERAPI_KEY"
SCRAPERAPI_PROXY_ENV = "SCRAPERAPI_PROXY_URL"

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "id-ID,id;q=0.9,en;q=0.8",
    "Referer": "https://www.bukalapak.com/",
}

CATEGORIES = [
    {"id": "hp-smartphone", "name": "Electronics", "sub": "Phones", "url": "https://www.bukalapak.com/products?search[category_id]=142"},
    {"id": "laptop", "name": "Electronics", "sub": "Laptops", "url": "https://www.bukalapak.com/products?search[category_id]=144"},
    {"id": "tv", "name": "Electronics", "sub": "TVs", "url": "https://www.bukalapak.com/products?search[category_id]=146"},
    {"id": "audio", "name": "Electronics", "sub": "Audio", "url": "https://www.bukalapak.com/products?search[category_id]=147"},
    {"id": "kamera", "name": "Electronics", "sub": "Cameras", "url": "https://www.bukalapak.com/products?search[category_id]=145"},
    {"id": "tablet", "name": "Electronics", "sub": "Tablets", "url": "https://www.bukalapak.com/products?search[category_id]=143"},
    {"id": "fashion-wanita", "name": "Fashion", "sub": "Women Fashion", "url": "https://www.bukalapak.com/products?search[category_id]=66"},
    {"id": "fashion-pria", "name": "Fashion", "sub": "Men Fashion", "url": "https://www.bukalapak.com/products?search[category_id]=67"},
    {"id": "fashion-anak", "name": "Fashion", "sub": "Kids Fashion", "url": "https://www.bukalapak.com/products?search[category_id]=68"},
    {"id": "tas", "name": "Fashion", "sub": "Bags", "url": "https://www.bukalapak.com/products?search[category_id]=76"},
    {"id": "jam-tangan", "name": "Fashion", "sub": "Watches", "url": "https://www.bukalapak.com/products?search[category_id]=75"},
    {"id": "perhiasan", "name": "Fashion", "sub": "Jewellery", "url": "https://www.bukalapak.com/products?search[category_id]=77"},
    {"id": "furniture", "name": "Home & Living", "sub": "Furniture", "url": "https://www.bukalapak.com/products?search[category_id]=89"},
    {"id": "dapur", "name": "Home & Living", "sub": "Kitchen", "url": "https://www.bukalapak.com/products?search[category_id]=91"},
    {"id": "dekorasi", "name": "Home & Living", "sub": "Home Decor", "url": "https://www.bukalapak.com/products?search[category_id]=90"},
    {"id": "elektronik-rumah", "name": "Home & Living", "sub": "Home Appliances", "url": "https://www.bukalapak.com/products?search[category_id]=92"},
    {"id": "kesehatan", "name": "Beauty & Health", "sub": "Health", "url": "https://www.bukalapak.com/products?search[category_id]=106"},
    {"id": "kosmetik", "name": "Beauty & Health", "sub": "Cosmetics", "url": "https://www.bukalapak.com/products?search[category_id]=107"},
    {"id": "skincare", "name": "Beauty & Health", "sub": "Skincare", "url": "https://www.bukalapak.com/products?search[category_id]=108"},
    {"id": "suplemen", "name": "Beauty & Health", "sub": "Supplements", "url": "https://www.bukalapak.com/products?search[category_id]=109"},
    {"id": "fashion-muslim", "name": "Fashion", "sub": "Muslim Fashion", "url": "https://www.bukalapak.com/products?search[category_id]=70"},
]


class BukalapakIDScraper:
    def __init__(
        self,
        api_key: str,
        api_base: str = "http://localhost:3000",
        batch_size: int = 200,
        delay: float = 0.5,
        data_dir: str = "/home/paperclip/buywhere-api/data/bukalapak",
        max_pages_per_category: int = 100,
        target_products: int = 100000,
        scrape_only: bool = False,
        scraperapi_key: str | None = None,
        proxy_url: str | None = None,
    ):
        self.api_key = api_key
        self.api_base = api_base.rstrip("/")
        self.batch_size = batch_size
        self.delay = delay
        self.data_dir = Path(data_dir)
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.max_pages_per_category = max_pages_per_category
        self.target_products = target_products
        self.scrape_only = scrape_only
        self.scraperapi_key = scraperapi_key or os.environ.get(SCRAPERAPI_KEY_ENV)
        self.proxy_url = proxy_url or os.environ.get(SCRAPERAPI_PROXY_ENV) or self._build_scraperapi_proxy_url()
        self.client = httpx.AsyncClient(
            timeout=30.0,
            headers=HEADERS,
            proxy=self.proxy_url,
            verify=False if self.proxy_url else True,
        )
        self.total_scraped = 0
        self.total_ingested = 0
        self.total_updated = 0
        self.total_failed = 0
        self.skipped_pages = 0
        self.catalog_surface_unavailable = False
        self.catalog_surface_reason = ""

    def _build_scraperapi_proxy_url(self) -> str | None:
        if not self.scraperapi_key:
            return None
        return (
            "http://scraperapi:"
            f"{urllib.parse.quote(self.scraperapi_key, safe='')}"
            "@proxy-server.scraperapi.com:8001"
        )

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
        url = f"{BASE_URL}/products"
        params = {
            "page": page,
            "search[category_id]": self._get_category_id(category["id"]),
        }
        try:
            resp = await self.client.get(url, params=params)
            if self._looks_like_not_found_shell(resp.text, resp.url, resp.status_code):
                self.catalog_surface_unavailable = True
                self.catalog_surface_reason = (
                    "Bukalapak listing routes are returning a 404 shell page instead of catalog data."
                )
                log.progress(
                    f"Bukalapak listing route no longer serves catalog data for category "
                    f"{category['id']} page {page}: {resp.url}"
                )
                return []
            if "json" in resp.headers.get("content-type", "").lower():
                resp.raise_for_status()
                data = resp.json()
                return self._extract_products_from_response(data, category)

            html = resp.text
            return self._extract_products_from_html(html, category)
        except httpx.TimeoutException:
            if self.proxy_url:
                self.catalog_surface_unavailable = True
                self.catalog_surface_reason = (
                    "Bukalapak listing route timed out through ScraperAPI proxy mode, "
                    "so public catalog pagination is not viable."
                )
                log.progress(
                    f"Bukalapak listing route timed out for category {category['id']} "
                    f"page {page} via proxy."
                )
            return []
        except Exception:
            return []

    def _looks_like_not_found_shell(self, html: str, url: str | Any, status_code: int | None = None) -> bool:
        text = html or ""
        url_text = str(url)
        path = urlparse(url_text).path
        not_found_markers = (
            'statusCode":404' in text
            or '"statusCode":404' in text
            or "Page not found" in text
        )
        is_catalog_route = path in {"/products", "/search"}

        # Bukalapak currently serves a fully bootstrapped app shell for missing
        # catalog routes, including through ScraperAPI proxy mode. Treat an
        # HTML 404 on catalog/search paths as a hard blocker instead of silently
        # continuing through empty pages.
        return is_catalog_route and (
            status_code == 404
            or not_found_markers
            or (
                "window.APP" in text
                and "<!DOCTYPE html>" in text
                and "data-capo" in text
            )
        )

    def _get_category_id(self, cat_id: str) -> str:
        category_map = {
            "hp-smartphone": "142",
            "laptop": "144",
            "tv": "146",
            "audio": "147",
            "kamera": "145",
            "tablet": "143",
            "fashion-wanita": "66",
            "fashion-pria": "67",
            "fashion-anak": "68",
            "tas": "76",
            "jam-tangan": "75",
            "perhiasan": "77",
            "furniture": "89",
            "dapur": "91",
            "dekorasi": "90",
            "elektronik-rumah": "92",
            "kesehatan": "106",
            "kosmetik": "107",
            "skincare": "108",
            "suplemen": "109",
            "fashion-muslim": "70",
        }
        return category_map.get(cat_id, cat_id)

    def _extract_products_from_response(self, data: dict, category: dict) -> list[dict]:
        products = []
        try:
            items = data.get("data", []) or data.get("products", []) or []
            for item in items:
                transformed = self._transform_bukalapak_product(item, category)
                if transformed:
                    products.append(transformed)
        except (KeyError, TypeError):
            pass
        if not products:
            try:
                items = data.get("data", {}).get("products", [])
                for item in items:
                    transformed = self._transform_bukalapak_product(item, category)
                    if transformed:
                        products.append(transformed)
            except (KeyError, TypeError):
                pass
        return products

    def _extract_products_from_html(self, html: str, category: dict) -> list[dict]:
        products = []
        json_pattern = r'"products":\s*\[(.*?)\]'
        matches = re.findall(json_pattern, html, re.DOTALL)
        for match in matches:
            try:
                items = json.loads(f"[{match}]")
                for item in items:
                    transformed = self._transform_bukalapak_product(item, category)
                    if transformed:
                        products.append(transformed)
            except json.JSONDecodeError:
                pass
        return products

    def _transform_bukalapak_product(self, raw: dict, category: dict) -> dict[str, Any] | None:
        try:
            sku = str(raw.get("id", "") or raw.get("product_id", "") or raw.get("sku", ""))
            if not sku:
                return None

            name = raw.get("name", "") or raw.get("title", "") or raw.get("product_name", "")
            if not name:
                return None

            price = raw.get("price", 0.0)
            if isinstance(price, str):
                price = float(price.replace("Rp", "").replace(".", "").replace(",", "") or 0)
            original_price = raw.get("original_price", price)
            if isinstance(original_price, str):
                original_price = float(original_price.replace("Rp", "").replace(".", "").replace(",", "") or 0)

            discount = raw.get("discount_percentage", 0) or raw.get("discount", 0) or 0
            if discount and isinstance(discount, str):
                discount = int(discount.replace("%", "") or 0)

            images = raw.get("images", []) or raw.get("image_url", []) or []
            image_url = ""
            if isinstance(images, list) and images:
                image_url = images[0] if isinstance(images[0], str) else ""
                if isinstance(image_url, dict):
                    image_url = image_url.get("url", "") or image_url.get("src", "")
            elif isinstance(images, str):
                image_url = images

            product_url = raw.get("url", "") or raw.get("product_url", "") or raw.get("link", "")
            if product_url and not product_url.startswith("http"):
                product_url = BASE_URL + product_url

            brand = raw.get("brand", "") or ""
            rating = raw.get("rating", 0.0) or 0.0
            review_count = raw.get("review_count", 0) or raw.get("reviews_count", 0) or raw.get("count_review", 0) or 0

            primary_category = category["name"]
            sub_category = category["sub"]
            category_path = [category["name"], category["sub"]]

            shop = raw.get("shop", {}) or raw.get("seller", {}) or raw.get("store", {})
            seller_name = shop.get("name", "") if isinstance(shop, dict) else ""
            seller_rating = 0.0
            if isinstance(shop, dict):
                seller_rating = (
                    shop.get("rating", 0.0)
                    or shop.get("seller_rating", 0.0)
                    or shop.get("average_rating", 0.0)
                    or 0.0
                )

            location = raw.get("location", "") or raw.get("city", "") or raw.get("region", "")
            condition = (
                raw.get("condition")
                or raw.get("item_condition")
                or raw.get("product_condition")
                or ""
            )
            if isinstance(condition, dict):
                condition = condition.get("name", "") or condition.get("label", "") or ""
            if not condition and isinstance(raw.get("specs"), dict):
                condition = raw["specs"].get("condition", "") or ""

            return {
                "sku": f"bukalapak_{sku}",
                "merchant_id": MERCHANT_ID,
                "source": SOURCE,
                "title": name,
                "description": raw.get("description", "") or raw.get("short_description", "") or "",
                "price": price,
                "currency": "IDR",
                "url": product_url,
                "image_url": image_url,
                "category": primary_category,
                "category_path": category_path,
                "brand": brand,
                "is_active": True,
                "metadata": {
                    "country": "ID",
                    "original_price": original_price,
                    "discount_pct": discount,
                    "rating": rating,
                    "review_count": review_count,
                    "subcategory": sub_category,
                    "seller_name": seller_name,
                    "seller_rating": seller_rating,
                    "location": location,
                    "condition": condition,
                    "bukalapak_category_id": self._get_category_id(category["id"]),
                },
            }
        except Exception:
            return None

    async def ingest_batch(self, products: list[dict]) -> tuple[int, int, int]:
        if not products:
            return 0, 0, 0

        if self.scrape_only:
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
        consecutive_empty_pages = 0
        category_file = self.data_dir / f"{cat_id}.jsonl"

        while page <= self.max_pages_per_category:
            if self.catalog_surface_unavailable:
                print(f"  {self.catalog_surface_reason}")
                break
            if self.total_scraped >= self.target_products:
                print(f"  Target of {self.target_products} products reached!")
                break

            print(f"  Page {page}...", end=" ", flush=True)
            products = await self.fetch_products_page(category, page)

            if not products:
                consecutive_empty_pages += 1
                if consecutive_empty_pages >= 3:
                    print("No products found for 3 consecutive pages, ending pagination.")
                    break
                print("Empty page, continuing...")
                page += 1
                await asyncio.sleep(self.delay)
                continue

            consecutive_empty_pages = 0
            counts["pages"] += 1

            for raw in products:
                if raw:
                    batch.append(raw)
                    counts["scraped"] += 1
                    self.total_scraped += 1
                    category_file.open("a").write(json.dumps(raw) + "\n")

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

            print(f"scraped={counts['scraped']}, total={self.total_scraped}")

            if counts["pages"] >= self.max_pages_per_category:
                print(f"  Reached max pages ({self.max_pages_per_category}) for this category.")
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

        print(f"  [{cat_name} / {sub_name}] Done: pages={counts['pages']}, scraped={counts['scraped']}")
        return counts

    async def run(self) -> dict[str, Any]:
        print(f"Bukalapak ID Comprehensive Scraper starting...")
        print(f"API: {self.api_base}")
        print(f"Batch size: {self.batch_size}, Delay: {self.delay}s")
        print(f"Data dir: {self.data_dir}")
        if self.proxy_url:
            print("Proxy: enabled")
        print(f"Categories: {len(CATEGORIES)}")
        print(f"Target: {self.target_products:,} products")

        start = time.time()

        for cat in CATEGORIES:
            if self.catalog_surface_unavailable:
                print(f"\nStopping early: {self.catalog_surface_reason}")
                break
            if self.total_scraped >= self.target_products:
                print(f"\nTarget of {self.target_products:,} products reached! Stopping.")
                break

            await self.scrape_category(cat)
            await asyncio.sleep(2)

        elapsed = time.time() - start

        summary = {
            "elapsed_seconds": round(elapsed, 1),
            "total_scraped": self.total_scraped,
            "total_ingested": self.total_ingested,
            "total_updated": self.total_updated,
            "total_failed": self.total_failed,
            "target": self.target_products,
            "achievement_pct": round(self.total_scraped / self.target_products * 100, 1),
            "catalog_surface_unavailable": self.catalog_surface_unavailable,
        }
        if self.catalog_surface_reason:
            summary["blocked_reason"] = self.catalog_surface_reason

        print(f"\nScraper complete: {summary}")
        return summary


async def main():
    parser = argparse.ArgumentParser(description="Bukalapak ID Comprehensive Scraper")
    parser.add_argument("--api-key", default=None, help="BuyWhere API key")
    parser.add_argument(
        "--api-base",
        default="http://localhost:3000",
        help="BuyWhere API base URL",
    )
    parser.add_argument("--batch-size", type=int, default=200)
    parser.add_argument("--delay", type=float, default=0.5, help="Delay between pages (seconds)")
    parser.add_argument(
        "--data-dir",
        default="/home/paperclip/buywhere-api/data/bukalapak",
        help="Directory to save scraped JSONL data",
    )
    parser.add_argument("--max-pages", type=int, default=100, help="Max pages per category")
    parser.add_argument("--target", type=int, default=100000, help="Target number of products")
    parser.add_argument("--scrape-only", action="store_true", help="Save to JSONL only, skip API ingestion")
    parser.add_argument(
        "--scraperapi-key",
        default=None,
        help=f"ScraperAPI key (or set {SCRAPERAPI_KEY_ENV})",
    )
    parser.add_argument(
        "--proxy-url",
        default=None,
        help=f"Explicit proxy URL (or set {SCRAPERAPI_PROXY_ENV})",
    )
    args = parser.parse_args()
    api_key = args.api_key
    if not api_key:
        for env_var in API_KEY_ENV_VARS:
            api_key = os.environ.get(env_var)
            if api_key:
                break
    if not args.scrape_only and not api_key:
        parser.error(
            "--api-key is required unless --scrape-only is used "
            f"(or set one of: {', '.join(API_KEY_ENV_VARS)})"
        )

    scraper = BukalapakIDScraper(
        api_key=api_key,
        api_base=args.api_base,
        batch_size=args.batch_size,
        delay=args.delay,
        data_dir=args.data_dir,
        max_pages_per_category=args.max_pages,
        target_products=args.target,
        scrape_only=args.scrape_only,
        scraperapi_key=args.scraperapi_key,
        proxy_url=args.proxy_url,
    )

    try:
        await scraper.run()
    finally:
        await scraper.close()


if __name__ == "__main__":
    asyncio.run(main())
