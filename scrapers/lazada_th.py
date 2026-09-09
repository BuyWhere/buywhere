"""
Lazada Thailand product scraper.

Scrapes electronics, fashion, and household from Lazada Thailand
and outputs structured JSON matching the BuyWhere catalog schema
for ingestion via POST /v1/ingest/products.

Usage:
    python -m scrapers.lazada_th --api-key <key> [--batch-size 100] [--delay 1.0]
    python -m scrapers.lazada_th --scrape-only

Electronics verticals:
- Mobile phones, laptops, audio, cameras, accessories - target 100K
Fashion verticals:
- Women/men/kids fashion, bags, shoes - target 75K
Home & Living verticals:
- Home appliances, furniture, kitchenware - target 50K
- Total target: 100K products
"""
import argparse
import asyncio
import json
import re
import time
from pathlib import Path
from typing import Any

import httpx

from scrapers.logging import get_logger

MERCHANT_ID = "lazada_th"
log = get_logger(MERCHANT_ID)
SOURCE = "lazada_th"
BASE_URL = "https://www.lazada.co.th"

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-TH,en;q=0.9",
    "Referer": "https://www.lazada.co.th/",
}

CATEGORIES = [
    {"id": "phones", "name": "Electronics", "sub": "Phones", "url": "https://www.lazada.co.th/phones/"},
    {"id": "laptops", "name": "Electronics", "sub": "Laptops", "url": "https://www.lazada.co.th/laptops/"},
    {"id": "tvs", "name": "Electronics", "sub": "TVs", "url": "https://www.lazada.co.th/tvs/"},
    {"id": "cameras", "name": "Electronics", "sub": "Cameras", "url": "https://www.lazada.co.th/cameras/"},
    {"id": "audio", "name": "Electronics", "sub": "Audio & Headphones", "url": "https://www.lazada.co.th/audio-headphones/"},
    {"id": "tablets", "name": "Electronics", "sub": "Tablets", "url": "https://www.lazada.co.th/tablets/"},
    {"id": "wearables", "name": "Electronics", "sub": "Wearables", "url": "https://www.lazada.co.th/smart-wearables/"},
    {"id": "women-fashion", "name": "Fashion", "sub": "Women Fashion", "url": "https://www.lazada.co.th/women-fashion/"},
    {"id": "men-fashion", "name": "Fashion", "sub": "Men Fashion", "url": "https://www.lazada.co.th/men-fashion/"},
    {"id": "kids-fashion", "name": "Fashion", "sub": "Kids Fashion", "url": "https://www.lazada.co.th/kids-fashion/"},
    {"id": "bags-luggage", "name": "Fashion", "sub": "Bags & Luggage", "url": "https://www.lazada.co.th/bags-luggage/"},
    {"id": "shoes", "name": "Fashion", "sub": "Shoes", "url": "https://www.lazada.co.th/shoes/"},
    {"id": "furniture", "name": "Home & Living", "sub": "Furniture", "url": "https://www.lazada.co.th/furniture/"},
    {"id": "kitchen", "name": "Home & Living", "sub": "Kitchen & Dining", "url": "https://www.lazada.co.th/kitchen-dining/"},
    {"id": "home-appliances", "name": "Home & Living", "sub": "Home Appliances", "url": "https://www.lazada.co.th/home-appliances/"},
    {"id": "beauty", "name": "Beauty & Health", "sub": "Beauty & Makeup", "url": "https://www.lazada.co.th/beauty-makeup/"},
    {"id": "skincare", "name": "Beauty & Health", "sub": "Skincare", "url": "https://www.lazada.co.th/skincare/"},
    {"id": "sports", "name": "Sports & Outdoors", "sub": "Sports Equipment", "url": "https://www.lazada.co.th/sports-equipment/"},
]


class LazadaTHScraper:
    def __init__(
        self,
        api_key: str,
        api_base: str = "http://localhost:8000",
        batch_size: int = 100,
        delay: float = 1.0,
        scrape_only: bool = False,
        data_dir: str = "/home/paperclip/buywhere-api/data/lazada-th",
        max_pages_per_category: int = 500,
        target_products: int = 100000,
    ):
        self.api_key = api_key
        self.api_base = api_base.rstrip("/")
        self.batch_size = batch_size
        self.delay = delay
        self.scrape_only = scrape_only
        self.data_dir = Path(data_dir)
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.max_pages_per_category = max_pages_per_category
        self.target_products = target_products
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

    async def fetch_products_page(self, category: dict, page: int = 1) -> list[dict]:
        url = category["url"]
        params = {"ajax": "true", "page": page, "categoryId": category["id"]}
        try:
            resp = await self.client.get(url, params=params)
            resp.raise_for_status()
            data = resp.json()
            return self._extract_products_from_response(data, category)
        except Exception:
            return await self._fetch_search_api_fallback(category, page)

    def _extract_products_from_response(self, data: dict, category: dict) -> list[dict]:
        products = []
        try:
            items = data.get("data", {}).get("products", [])
            for item in items:
                transformed = self._transform_lazada_product(item, category)
                if transformed:
                    products.append(transformed)
        except (KeyError, TypeError):
            pass
        if not products:
            try:
                items = data.get("products", [])
                for item in items:
                    transformed = self._transform_lazada_product(item, category)
                    if transformed:
                        products.append(transformed)
            except (KeyError, TypeError):
                pass
        return products

    async def _fetch_search_api_fallback(self, category: dict, page: int = 1) -> list[dict]:
        url = f"{BASE_URL}/search"
        params = {"q": category["sub"], "page": page}
        try:
            resp = await self.client.get(url, params=params)
            resp.raise_for_status()
            html = resp.text
            return self._extract_products_from_html(html, category)
        except Exception:
            return []

    def _extract_products_from_html(self, html: str, category: dict) -> list[dict]:
        products = []
        script_pattern = r'window\.DS\.conf\s*=\s*(\{.*?\});'
        match = re.search(script_pattern, html, re.DOTALL)
        if match:
            try:
                data = json.loads(match.group(1))
                items = data.get("data", {}).get("products", [])
                for item in items:
                    transformed = self._transform_lazada_product(item, category)
                    if transformed:
                        products.append(transformed)
            except (json.JSONDecodeError, KeyError):
                pass
        if not products:
            json_pattern = r'"products":\s*\[(.*?)\]'
            matches = re.findall(json_pattern, html, re.DOTALL)
            for match in matches:
                try:
                    items = json.loads(f"[{match}]")
                    for item in items:
                        transformed = self._transform_lazada_product(item, category)
                        if transformed:
                            products.append(transformed)
                except json.JSONDecodeError:
                    pass
        return products

    def _transform_lazada_product(self, raw: dict, category: dict) -> dict[str, Any] | None:
        try:
            sku = str(raw.get("productId", "") or raw.get("sku", ""))
            if not sku:
                return None

            name = raw.get("name", "") or raw.get("title", "")
            if not name:
                return None

            price = raw.get("price", 0.0)
            if isinstance(price, str):
                price = float(price.replace("$", "").replace(",", "") or 0)
            original_price = raw.get("originalPrice", price)
            if isinstance(original_price, str):
                original_price = float(original_price.replace("$", "").replace(",", "") or 0)

            discount = raw.get("discount", "0")
            if discount:
                discount = int(discount.replace("%", "") or 0)
            else:
                discount = 0

            images = raw.get("images", []) or []
            image_url = ""
            if images:
                image_url = images[0] if isinstance(images[0], str) else ""
            if not image_url and raw.get("imageUrl"):
                image_url = raw["imageUrl"]

            product_url = raw.get("productUrl", "") or raw.get("url", "")
            if product_url and not product_url.startswith("http"):
                product_url = BASE_URL + product_url

            brand = raw.get("brand", "") or raw.get("brandName", "")
            rating = raw.get("rating", 0.0) or 0.0
            review_count = raw.get("review", 0) or raw.get("reviewCount", 0) or 0

            primary_category = category["name"]
            sub_category = category["sub"]
            category_path = [category["name"], category["sub"]]

            seller = raw.get("seller", {}) or {}
            seller_name = seller.get("name", "") if isinstance(seller, dict) else ""

            location = raw.get("location", "")

            return {
                "sku": sku,
                "merchant_id": MERCHANT_ID,
                "title": name,
                "description": raw.get("description", "") or "",
                "price": price,
                "currency": "THB",
                "country": "TH",
                "url": product_url,
                "image_url": image_url,
                "category": primary_category,
                "category_path": category_path,
                "brand": brand,
                "is_active": True,
                "metadata": {
                    "original_price": original_price,
                    "discount_pct": discount,
                    "rating": rating,
                    "review_count": review_count,
                    "subcategory": sub_category,
                    "seller_name": seller_name,
                    "location": location,
                    "lazada_category_id": raw.get("categoryId", ""),
                },
            }
        except Exception:
            return None

    async def ingest_batch(self, products: list[dict]) -> tuple[int, int, int]:
        if not products:
            return 0, 0, 0

        if self.scrape_only:
            cat_id = products[0].get("metadata", {}).get("lazada_category_id", "unknown") if products else "unknown"
            cat_file = self.data_dir / f"{cat_id}.jsonl"
            with cat_file.open("a", encoding="utf-8") as f:
                for p in products:
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
        print(f"Lazada TH Scraper starting...")
        print(f"API: {self.api_base}")
        print(f"Batch size: {self.batch_size}, Delay: {self.delay}s")
        print(f"Data dir: {self.data_dir}")
        print(f"Categories: {len(CATEGORIES)}")
        print(f"Target: {self.target_products:,} products")

        start = time.time()

        for cat in CATEGORIES:
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
        }

        print(f"\nScraper complete: {summary}")
        return summary


async def main():
    parser = argparse.ArgumentParser(description="Lazada Thailand Product Scraper")
    parser.add_argument("--api-key", required=True, help="BuyWhere API key")
    parser.add_argument("--api-base", default="http://localhost:8000", help="BuyWhere API base URL")
    parser.add_argument("--batch-size", type=int, default=100)
    parser.add_argument("--delay", type=float, default=1.0, help="Delay between pages (seconds)")
    parser.add_argument("--scrape-only", action="store_true", help="Save to JSONL without ingesting")
    parser.add_argument("--data-dir", default="/home/paperclip/buywhere-api/data/lazada-th", help="Directory to save scraped JSONL data")
    parser.add_argument("--max-pages", type=int, default=500, help="Max pages per category")
    parser.add_argument("--target", type=int, default=100000, help="Target number of products")
    args = parser.parse_args()

    scraper = LazadaTHScraper(
        api_key=args.api_key,
        api_base=args.api_base,
        batch_size=args.batch_size,
        delay=args.delay,
        scrape_only=args.scrape_only,
        data_dir=args.data_dir,
        max_pages_per_category=args.max_pages,
        target_products=args.target,
    )

    try:
        await scraper.run()
    finally:
        await scraper.close()


if __name__ == "__main__":
    asyncio.run(main())