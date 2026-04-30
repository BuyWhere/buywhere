"""
Lazada Indonesia comprehensive product scraper.

Covers major Lazada ID categories targeting 100K+ products.
Saves structured JSONL matching the BuyWhere catalog schema for
ingestion via POST /v1/ingest/products.

Usage:
    python -m scrapers.lazada_id --api-key <key> [--batch-size 200] [--delay 1.0]
    python -m scrapers.lazada_id --scrape-only  # save to JSONL without ingesting

Categories covered:
- Electronics: Phones, Laptops, TVs, Audio
- Fashion: Women, Men, Kids
- Home & Living: Furniture, Kitchen, Decor
- Beauty & Health: Skincare, Makeup
- Sports: Sports Equipment, Fitness

Target: 100,000+ products
"""
import argparse
import asyncio
import json
import re
import time
import unicodedata
from pathlib import Path
from typing import Any

import httpx

from scrapers.scraper_logging import get_logger

MERCHANT_ID = "lazada_id"
log = get_logger(MERCHANT_ID)
SOURCE = "lazada_id"
BASE_URL = "https://www.lazada.co.id"

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-ID,en;q=0.9,id;q=0.8",
    "Referer": "https://www.lazada.co.id/",
}

CATEGORIES = [
    {"id": "phones", "name": "Electronics", "sub": "Phones", "url": "https://www.lazada.co.id/phones/"},
    {"id": "laptops", "name": "Electronics", "sub": "Laptops", "url": "https://www.lazada.co.id/laptops/"},
    {"id": "tvs", "name": "Electronics", "sub": "TVs", "url": "https://www.lazada.co.id/tvs/"},
    {"id": "audio", "name": "Electronics", "sub": "Audio", "url": "https://www.lazada.co.id/audio-headphones/"},
    {"id": "tablets", "name": "Electronics", "sub": "Tablets", "url": "https://www.lazada.co.id/tablets/"},
    {"id": "wearables", "name": "Electronics", "sub": "Wearables", "url": "https://www.lazada.co.id/smart-wearables/"},
    {"id": "women-fashion", "name": "Fashion", "sub": "Women Fashion", "url": "https://www.lazada.co.id/women-fashion/"},
    {"id": "men-fashion", "name": "Fashion", "sub": "Men Fashion", "url": "https://www.lazada.co.id/men-fashion/"},
    {"id": "kids-fashion", "name": "Fashion", "sub": "Kids Fashion", "url": "https://www.lazada.co.id/kids-fashion/"},
    {"id": "bags-luggage", "name": "Fashion", "sub": "Bags & Luggage", "url": "https://www.lazada.co.id/bags-luggage/"},
    {"id": "watches-jewellery", "name": "Fashion", "sub": "Watches & Jewellery", "url": "https://www.lazada.co.id/watches-jewellery/"},
    {"id": "furniture", "name": "Home & Living", "sub": "Furniture", "url": "https://www.lazada.co.id/furniture/"},
    {"id": "kitchen", "name": "Home & Living", "sub": "Kitchen & Dining", "url": "https://www.lazada.co.id/kitchen-dining/"},
    {"id": "home-decor", "name": "Home & Living", "sub": "Home Decor", "url": "https://www.lazada.co.id/home-decor/"},
    {"id": "bedding", "name": "Home & Living", "sub": "Bedding & Bath", "url": "https://www.lazada.co.id/bedding-bath/"},
    {"id": "appliances", "name": "Home & Living", "sub": "Home Appliances", "url": "https://www.lazada.co.id/home-appliances/"},
    {"id": "beauty", "name": "Beauty & Health", "sub": "Beauty & Makeup", "url": "https://www.lazada.co.id/beauty-makeup/"},
    {"id": "skincare", "name": "Beauty & Health", "sub": "Skincare", "url": "https://www.lazada.co.id/skincare/"},
    {"id": "supplements", "name": "Beauty & Health", "sub": "Health Supplements", "url": "https://www.lazada.co.id/health-supplements/"},
    {"id": "sports", "name": "Sports & Outdoors", "sub": "Sports Equipment", "url": "https://www.lazada.co.id/sports-equipment/"},
    {"id": "fitness", "name": "Sports & Outdoors", "sub": "Fitness", "url": "https://www.lazada.co.id/fitness/"},
    {"id": "toys", "name": "Toys & Kids", "sub": "Toys & Games", "url": "https://www.lazada.co.id/toys-games/"},
    {"id": "baby-gear", "name": "Toys & Kids", "sub": "Baby Gear", "url": "https://www.lazada.co.id/baby-gear/"},
]


class LazadaIDScraper:
    def __init__(
        self,
        api_key: str | None = None,
        api_base: str = "http://localhost:8000",
        batch_size: int = 200,
        delay: float = 1.0,
        data_dir: str = "/home/paperclip/buywhere-api/data/lazada-id",
        max_pages_per_category: int = 100,
        target_products: int = 100000,
        scrape_only: bool = False,
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
        self.client = httpx.AsyncClient(timeout=30.0, headers=HEADERS)
        self.total_scraped = 0
        self.total_ingested = 0
        self.total_updated = 0
        self.total_failed = 0
        self.skipped_pages = 0
        self._playwright_fallback = None

    async def close(self):
        if self._playwright_fallback is not None:
            await self._playwright_fallback._close_browser()
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
        url = f"{BASE_URL}/cat/geelhoed?ajax=true&page={page}"
        params = {
            "categoryId": category["id"],
            "page": page,
        }
        try:
            resp = await self.client.get(url, params=params)
            resp.raise_for_status()
            data = resp.json()
            products = self._extract_products_from_response(data, category)
            if products:
                return products
        except Exception:
            pass

        return await self._fetch_search_api_fallback(category, page)

    async def _fetch_search_api_fallback(self, category: dict, page: int = 1) -> list[dict]:
        url = f"{BASE_URL}/search"
        params = {
            "q": category["sub"],
            "page": page,
        }
        try:
            resp = await self.client.get(url, params=params)
            resp.raise_for_status()
            data = resp.json()
            products = self._extract_products_from_response(data, category)
            if products:
                return products
        except Exception:
            pass

        return await self._fetch_playwright_fallback(category)

    def _extract_products_from_response(self, data: dict, category: dict) -> list[dict]:
        products = []
        if isinstance(data, list):
            items = data
        else:
            items = (
                data.get("data", {}).get("products", [])
                or data.get("mods", {}).get("listItems", [])
                or data.get("products", [])
                or data.get("items", [])
                or data.get("results", [])
            )

        for raw in items:
            transformed = self._transform_lazada_product(raw, category)
            if transformed:
                products.append(transformed)
        return products

    @staticmethod
    def _parse_price(value: Any, default: float = 0.0) -> float:
        if value is None:
            return default
        if isinstance(value, (int, float)):
            return float(value)

        text = str(value).strip()
        if not text:
            return default

        cleaned = re.sub(r"[^0-9,.\-]", "", text)
        if cleaned.count(",") == 1 and cleaned.count(".") == 0:
            cleaned = cleaned.replace(",", ".")
        elif cleaned.count(".") > 1 or ("," in cleaned and "." in cleaned):
            cleaned = cleaned.replace(".", "").replace(",", ".")
        else:
            cleaned = cleaned.replace(",", "")

        try:
            return float(cleaned)
        except ValueError:
            return default

    @staticmethod
    def _normalize_url(url: str) -> str:
        if not url:
            return ""
        if url.startswith("//"):
            return f"https:{url}"
        if url.startswith("/"):
            return f"{BASE_URL}{url}"
        if url.startswith("http://") or url.startswith("https://"):
            return url
        return f"{BASE_URL}/{url.lstrip('/')}"

    @staticmethod
    def _ascii_slug(value: str) -> str:
        normalized = unicodedata.normalize("NFKD", value or "")
        ascii_text = normalized.encode("ascii", "ignore").decode("ascii").lower()
        ascii_text = re.sub(r"[^a-z0-9]+", "-", ascii_text).strip("-")
        return ascii_text

    @classmethod
    def _build_cross_listing_ids(cls, title: str, brand: str = "") -> dict[str, str]:
        brand_slug = cls._ascii_slug(brand)
        title_slug = cls._ascii_slug(title)
        if brand_slug and title_slug.startswith(f"{brand_slug}-"):
            core_slug = title_slug[len(brand_slug) + 1 :]
        else:
            core_slug = title_slug

        token = core_slug[:96] or title_slug[:96] or "unknown"
        prefix = brand_slug or "generic"
        return {
            "tokopedia_lookup": f"tpd:{prefix}:{token}",
            "catalog_dedupe": f"dedupe:{prefix}:{token}",
        }

    async def _get_playwright_fallback(self):
        if self._playwright_fallback is None:
            from scrapers.lazada_id_playwright import LazadaIDPlaywrightScraper

            self._playwright_fallback = LazadaIDPlaywrightScraper(
                api_key=self.api_key,
                api_base=self.api_base,
                batch_size=self.batch_size,
                delay=self.delay,
                output_dir=str(self.data_dir),
                scrape_only=True,
                limit=self.batch_size,
                headless=True,
                max_pages_per_category=max(1, min(self.max_pages_per_category, 3)),
                target_products=self.target_products,
            )
            await self._playwright_fallback._init_browser()
        return self._playwright_fallback

    async def _fetch_playwright_fallback(self, category: dict) -> list[dict]:
        try:
            scraper = await self._get_playwright_fallback()
            await scraper._page.goto(category["url"], wait_until="domcontentloaded")
            await asyncio.sleep(max(self.delay, 3.0))
            products = await scraper._extract_products_from_page(scraper._page)
            return [self._enrich_playwright_product(product, category) for product in products if product]
        except Exception:
            return []

    def _enrich_playwright_product(self, product: dict[str, Any], category: dict) -> dict[str, Any]:
        metadata = dict(product.get("metadata") or {})
        brand = product.get("brand") or ""
        title = product.get("title") or ""
        metadata.setdefault("subcategory", category["sub"])
        metadata.setdefault("country", "ID")
        metadata.setdefault("region", "id")
        metadata.setdefault("country_code", "ID")
        metadata["cross_listing_ids"] = self._build_cross_listing_ids(title, brand)
        product["category"] = category["name"]
        product["category_path"] = [category["name"], category["sub"]]
        product["region"] = "id"
        product["country_code"] = "ID"
        product["metadata"] = metadata
        return product

    def _transform_lazada_product(self, raw: dict, category: dict) -> dict[str, Any] | None:
        try:
            sku = str(raw.get("productId", "") or raw.get("itemId", "") or raw.get("sku", ""))
            if not sku:
                return None

            name = raw.get("name", "") or raw.get("title", "")
            if not name:
                return None

            price = self._parse_price(raw.get("price"), default=0.0)
            if price <= 0:
                price = self._parse_price(raw.get("priceShow"), default=0.0)
            if price <= 0:
                return None

            original_price = self._parse_price(raw.get("originalPrice"), default=0.0)
            if original_price <= 0:
                original_price = self._parse_price(raw.get("originalPriceShow"), default=0.0)
            if original_price <= 0:
                original_price = price

            discount = raw.get("discount", "0")
            if discount:
                discount = int(re.sub(r"[^0-9\-]", "", str(discount)) or 0)
            else:
                discount = 0

            images = raw.get("images", []) or []
            image_url = ""
            if images:
                image_url = images[0] if isinstance(images[0], str) else ""
            if not image_url and raw.get("imageUrl"):
                image_url = raw["imageUrl"]
            if not image_url and raw.get("image"):
                image_url = raw["image"]
            image_url = self._normalize_url(image_url)

            product_url = raw.get("productUrl", "") or raw.get("url", "")
            if not product_url and raw.get("itemUrl"):
                product_url = raw["itemUrl"]
            product_url = self._normalize_url(product_url)
            if not product_url:
                return None

            brand = raw.get("brand", "") or raw.get("brandName", "") or ""
            rating = raw.get("rating", 0.0) or 0.0
            review_count = raw.get("review", 0) or raw.get("reviewCount", 0) or 0

            category_path = [category["name"], category["sub"]]

            seller = raw.get("seller", {}) or {}
            seller_name = seller.get("name", "") if isinstance(seller, dict) else ""
            if not seller_name:
                seller_name = raw.get("sellerName", "") or raw.get("seller_name", "")

            location = raw.get("location", "")

            return {
                "sku": f"lazada_id_{sku}",
                "merchant_id": MERCHANT_ID,
                "source": SOURCE,
                "title": name,
                "description": raw.get("description", "") or "",
                "price": price,
                "currency": "IDR",
                "region": "id",
                "country_code": "ID",
                "url": product_url,
                "image_url": image_url,
                "category": category["name"],
                "category_path": category_path,
                "brand": brand,
                "is_active": True,
                "metadata": {
                    "original_price": original_price,
                    "discount_pct": discount,
                    "rating": rating,
                    "review_count": review_count,
                    "subcategory": category["sub"],
                    "seller_name": seller_name,
                    "location": location,
                    "lazada_category_id": raw.get("categoryId", ""),
                    "country": "ID",
                    "region": "id",
                    "country_code": "ID",
                    "cross_listing_ids": self._build_cross_listing_ids(name, brand),
                },
            }
        except Exception:
            return None

    async def ingest_batch(self, products: list[dict]) -> tuple[int, int, int]:
        if not products:
            return 0, 0, 0

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

            print(f"scraped={counts['scraped']}, total={self.total_scraped}")

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

        print(f"  [{cat_name} / {sub_name}] Done: pages={counts['pages']}, scraped={counts['scraped']}, ingested={counts['ingested']}, updated={counts['updated']}, failed={counts['failed']}")
        return counts

    async def run(self):
        print(f"Lazada Indonesia Scraper starting — target: {self.target_products} products")
        print(f"API: {self.api_base} | Batch: {self.batch_size} | Delay: {self.delay}s")
        print(f"Output dir: {self.data_dir}")

        overall = {"scraped": 0, "ingested": 0, "updated": 0, "failed": 0, "pages": 0}

        for category in CATEGORIES:
            if self.total_scraped >= self.target_products:
                break
            try:
                counts = await self.scrape_category(category)
                overall["scraped"] += counts["scraped"]
                overall["ingested"] += counts["ingested"]
                overall["updated"] += counts["updated"]
                overall["failed"] += counts["failed"]
                overall["pages"] += counts["pages"]
            except Exception as e:
                log.parse_error(None, f"Category scrape failed: {e}")

        print(f"\n=== Overall ===")
        print(f"Pages: {overall['pages']}")
        print(f"Scraped: {overall['scraped']}")
        print(f"Ingested: {overall['ingested']}")
        print(f"Updated: {overall['updated']}")
        print(f"Failed: {overall['failed']}")
        print(f"Total scraped (all batches): {self.total_scraped}")
        print(f"Total ingested (all batches): {self.total_ingested}")
        print(f"Total updated (all batches): {self.total_updated}")
        print(f"Total failed (all batches): {self.total_failed}")

        await self.close()


def main():
    parser = argparse.ArgumentParser(description="Lazada Indonesia product scraper")
    parser.add_argument("--api-key", default=None, help="BuyWhere API key")
    parser.add_argument("--api-base", default="http://localhost:8000", help="API base URL")
    parser.add_argument("--batch-size", type=int, default=200, help="Batch size for ingestion")
    parser.add_argument("--delay", type=float, default=1.0, help="Delay between requests (seconds)")
    parser.add_argument("--data-dir", default="/home/paperclip/buywhere-api/data/lazada-id", help="Output data directory")
    parser.add_argument("--max-pages", type=int, default=100, help="Max pages per category")
    parser.add_argument("--target", type=int, default=100000, help="Target number of products")
    parser.add_argument("--scrape-only", action="store_true", help="Save to JSONL without ingesting")
    args = parser.parse_args()

    if not args.scrape_only and not args.api_key:
        parser.error("--api-key is required unless --scrape-only is used")

    scraper = LazadaIDScraper(
        api_key=args.api_key,
        api_base=args.api_base,
        batch_size=args.batch_size,
        delay=args.delay,
        data_dir=args.data_dir,
        max_pages_per_category=args.max_pages,
        target_products=args.target,
        scrape_only=args.scrape_only,
    )
    asyncio.run(scraper.run())


if __name__ == "__main__":
    main()
