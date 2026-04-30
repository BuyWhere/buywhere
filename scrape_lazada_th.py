"""
Lazada Thailand product scraper — BUY-2575 100K product target.

Scrapes electronics, fashion, home & living, beauty from Lazada Thailand.
Output: /home/paperclip/buywhere-api/data/lazada_th/lazada_th_<YYYYMMDD>.ndjson
Upload to R2 after run.

Usage:
    python scrape_lazada_th.py --scrape-only
    python scrape_lazada_th.py --ingest --api-key <key>
"""
import argparse
import asyncio
import json
import os
import re
import time
from pathlib import Path
from typing import Any

import cloudscraper

SOURCE = "lazada_th"
MERCHANT_ID = "lazada_th"
BASE_URL = "https://www.lazada.co.th"
OUTPUT_DIR = "/home/paperclip/buywhere-api/data/lazada_th"
TODAY = time.strftime("%Y%m%d")

CATEGORIES = [
    {"id": "phones", "name": "Electronics", "sub": "Phones", "url": "https://www.lazada.co.th/phones/"},
    {"id": "laptops", "name": "Electronics", "sub": "Laptops", "url": "https://www.lazada.co.th/laptops/"},
    {"id": "tvs", "name": "Electronics", "sub": "TVs", "url": "https://www.lazada.co.th/tvs/"},
    {"id": "audio", "name": "Electronics", "sub": "Audio & Headphones", "url": "https://www.lazada.co.th/audio-headphones/"},
    {"id": "cameras", "name": "Electronics", "sub": "Cameras", "url": "https://www.lazada.co.th/cameras/"},
    {"id": "tablets", "name": "Electronics", "sub": "Tablets", "url": "https://www.lazada.co.th/tablets/"},
    {"id": "wearables", "name": "Electronics", "sub": "Smart Wearables", "url": "https://www.lazada.co.th/smart-wearables/"},
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

MAX_RETRIES = 5
RETRY_BASE_DELAY = 2


class LazadaTHScraper:
    def __init__(
        self,
        api_key: str | None = None,
        api_base: str = "http://localhost:8000",
        batch_size: int = 200,
        delay: float = 1.5,
        scrape_only: bool = False,
        data_dir: str = OUTPUT_DIR,
        max_pages: int = 500,
        target: int = 100_000,
    ):
        self.api_key = api_key
        self.api_base = api_base.rstrip("/")
        self.batch_size = batch_size
        self.delay = delay
        self.scrape_only = scrape_only
        self.data_dir = Path(data_dir)
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.max_pages = max_pages
        self.target = target
        self._scraper = cloudscraper.create_scraper(
            browser={"browser": "chrome", "platform": "windows", "desktop": True},
            delay=10,
        )
        self._session_file = self.data_dir / f"session_{TODAY}.json"
        self._seen_skus: set[str] = set()
        self._load_session()
        self._outfile = self.data_dir / f"lazada_th_{TODAY}.ndjson"
        self._outfile_lock = asyncio.Lock()
        self.total_scraped = 0
        self.total_ingested = 0
        self.total_updated = 0
        self.total_failed = 0

    def _load_session(self) -> None:
        if self._session_file.exists():
            try:
                data = json.loads(self._session_file.read_text())
                self._seen_skus = set(data.get("seen_skus", []))
                print(f"Loaded session: {len(self._seen_skus)} previously scraped SKUs")
            except Exception:
                pass

    def _save_session(self) -> None:
        try:
            self._session_file.write_text(
                json.dumps({"seen_skus": list(self._seen_skus)}, ensure_ascii=False)
            )
        except Exception:
            pass

    def _get_with_retry(self, url: str, params: dict | None = None) -> str | None:
        for attempt in range(MAX_RETRIES):
            try:
                if params:
                    resp = self._scraper.get(url, params=params)
                else:
                    resp = self._scraper.get(url)
                if resp.status_code == 200:
                    return resp.text
                elif resp.status_code in (429, 503):
                    wait = RETRY_BASE_DELAY ** (attempt + 1) * 3
                    print(f"  Rate limited (HTTP {resp.status_code}), waiting {wait:.0f}s")
                    time.sleep(wait)
                else:
                    if attempt < MAX_RETRIES - 1:
                        wait = RETRY_BASE_DELAY ** (attempt + 1)
                        time.sleep(wait)
                    else:
                        return None
            except Exception as e:
                if attempt < MAX_RETRIES - 1:
                    wait = RETRY_BASE_DELAY ** (attempt + 1)
                    time.sleep(wait)
                else:
                    print(f"  Request failed: {e}")
                    return None
        return None

    def _extract_products(self, text: str, category: dict) -> list[dict]:
        products = []
        for pattern, products_path in [
            (r'window\.DS\.conf\s*=\s*(\{.*?\});', ("data", "products")),
            (r'"products":\s*\[(.*?)\]', None),
        ]:
            match = re.search(pattern, text, re.DOTALL)
            if match:
                try:
                    if products_path:
                        data = json.loads(match.group(1))
                        items = data
                        for key in products_path:
                            items = items.get(key, [])
                        for raw in items:
                            transformed = self._transform(raw, category)
                            if transformed:
                                products.append(transformed)
                    else:
                        raw_text = match.group(1)
                        if raw_text.startswith("["):
                            items = json.loads(raw_text)
                            for raw in items:
                                transformed = self._transform(raw, category)
                                if transformed:
                                    products.append(transformed)
                except (json.JSONDecodeError, KeyError, TypeError):
                    pass
        if not products:
            try:
                data = json.loads(text)
                for key_path in [
                    ("data", "products"), ("mods", "productItems"), ("products",),
                    ("items",), ("results",),
                ]:
                    items = data
                    for k in key_path:
                        if isinstance(items, dict):
                            items = items.get(k, [])
                        else:
                            break
                    if isinstance(items, list) and items:
                        for raw in items:
                            transformed = self._transform(raw, category)
                            if transformed:
                                products.append(transformed)
                        if products:
                            break
            except (json.JSONDecodeError, AttributeError):
                pass
        return products

    def _transform(self, raw: dict, category: dict) -> dict | None:
        try:
            sku = str(raw.get("productId", "") or raw.get("sku", "") or raw.get("itemId", ""))
            if not sku or sku in self._seen_skus:
                return None

            name = raw.get("name", "") or raw.get("title", "") or raw.get("productTitle", "")
            if not name:
                return None

            price_val = raw.get("price", 0)
            if isinstance(price_val, str):
                price_val = float(price_val.replace("$", "").replace(",", "").replace("฿", "").strip() or 0)
            elif isinstance(price_val, int) and price_val > 100000:
                price_val = float(price_val) / 100000.0
            price = float(price_val)

            original_price_val = raw.get("originalPrice", price_val)
            if isinstance(original_price_val, str):
                original_price_val = float(original_price_val.replace("$", "").replace(",", "").replace("฿", "").strip() or 0)
            elif isinstance(original_price_val, int) and original_price_val > 100000:
                original_price_val = float(original_price_val) / 100000.0
            original_price = float(original_price_val)

            discount_str = raw.get("discount", "0")
            if discount_str:
                discount = int(re.sub(r"[^0-9]", "", str(discount_str)) or 0)
            else:
                discount = 0

            images = raw.get("images", []) or []
            image_url = ""
            if isinstance(images, list) and images:
                image_url = images[0] if isinstance(images[0], str) else ""
            if not image_url:
                image_url = raw.get("imageUrl", "") or raw.get("image", "") or ""

            product_url = raw.get("productUrl", "") or raw.get("url", "") or ""
            if product_url and not product_url.startswith("http"):
                product_url = BASE_URL + product_url

            brand = raw.get("brand", "") or raw.get("brandName", "") or ""
            rating = float(raw.get("rating", 0.0) or 0)
            review_count = int(raw.get("review", 0) or raw.get("reviewCount", 0) or 0)

            seller = raw.get("seller", {}) or {}
            seller_name = seller.get("name", "") if isinstance(seller, dict) else ""

            location = raw.get("location", "") or ""

            return {
                "sku": sku,
                "merchant_id": MERCHANT_ID,
                "source": SOURCE,
                "title": name,
                "description": raw.get("description", "") or "",
                "price": price,
                "currency": "THB",
                "country": "TH",
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
                    "seller_name": seller_name,
                    "location": location,
                    "lazada_category_id": raw.get("categoryId", ""),
                },
            }
        except Exception as e:
            return None

    async def _write_batch(self, products: list[dict]) -> None:
        async with self._outfile_lock:
            with open(self._outfile, "a", encoding="utf-8") as f:
                for p in products:
                    f.write(json.dumps(p, ensure_ascii=False) + "\n")

    async def ingest_batch(self, products: list[dict]) -> tuple[int, int, int]:
        if not products:
            return 0, 0, 0
        if self.scrape_only:
            await self._write_batch(products)
            return len(products), 0, 0

        import httpx
        async with httpx.AsyncClient(timeout=30.0) as client:
            try:
                resp = await client.post(
                    f"{self.api_base}/v1/ingest/products",
                    json={"source": SOURCE, "products": products},
                    headers={"Authorization": f"Bearer {self.api_key}"},
                )
                resp.raise_for_status()
                result = resp.json()
                return (
                    result.get("rows_inserted", 0),
                    result.get("rows_updated", 0),
                    result.get("rows_failed", 0),
                )
            except Exception as e:
                print(f"  Ingest error: {e}")
                return 0, 0, len(products)

    def scrape_category(self, category: dict) -> dict[str, Any]:
        cat_id = category["id"]
        cat_name = category["name"]
        sub_name = category["sub"]

        print(f"\n[{cat_name} / {sub_name}] Starting...")
        counts = {"scraped": 0, "ingested": 0, "updated": 0, "failed": 0, "pages": 0, "skipped": 0}
        page = 1
        batch = []
        consecutive_empty = 0

        while page <= self.max_pages:
            if self.total_scraped >= self.target:
                print(f"  Target {self.target} reached!")
                break

            url = category["url"]
            params = {"page": page}
            text = self._get_with_retry(url, params)

            if not text:
                consecutive_empty += 1
                if consecutive_empty >= 3:
                    print(f"  No response for 3 pages, stopping.")
                    break
                page += 1
                time.sleep(self.delay)
                continue

            products = self._extract_products(text, category)

            if not products:
                consecutive_empty += 1
                if consecutive_empty >= 3:
                    print(f"  Empty for 3 pages, stopping.")
                    break
                page += 1
                time.sleep(self.delay)
                continue

            consecutive_empty = 0
            counts["pages"] += 1

            for raw in products:
                if self.total_scraped >= self.target:
                    break
                if raw["sku"] in self._seen_skus:
                    counts["skipped"] += 1
                    continue
                self._seen_skus.add(raw["sku"])
                batch.append(raw)
                counts["scraped"] += 1
                self.total_scraped += 1

                if len(batch) >= self.batch_size:
                    asyncio.run(self._do_ingest(batch, counts))
                    batch = []
                    time.sleep(self.delay)

            print(f"  page={page}, scraped={counts['scraped']}, total={self.total_scraped}")

            if len(products) < 40:
                break

            page += 1
            time.sleep(self.delay)

        if batch:
            asyncio.run(self._do_ingest(batch, counts))

        self._save_session()
        print(f"  [{cat_name} / {sub_name}] Done: {counts}")
        return counts

    async def _do_ingest(self, batch: list[dict], counts: dict) -> None:
        i, u, f = await self.ingest_batch(batch)
        counts["ingested"] += i
        counts["updated"] += u
        counts["failed"] += f
        self.total_ingested += i
        self.total_updated += u
        self.total_failed += f

    def run(self) -> dict[str, Any]:
        print(f"Lazada TH Scraper — BUY-2575")
        print(f"Output: {self._outfile}")
        print(f"Target: {self.target:,} products | Categories: {len(CATEGORIES)}")
        print(f"Scrape only: {self.scrape_only}")

        start = time.time()
        overall = {"scraped": 0, "ingested": 0, "updated": 0, "failed": 0, "skipped": 0, "pages": 0}

        for cat in CATEGORIES:
            if self.total_scraped >= self.target:
                print(f"\nTarget {self.target:,} reached!")
                break
            try:
                counts = self.scrape_category(cat)
                for k in overall:
                    overall[k] += counts.get(k, 0)
            except Exception as e:
                print(f"  Category error: {e}")

        elapsed = time.time() - start
        summary = {
            "elapsed_seconds": round(elapsed, 1),
            "total_scraped": self.total_scraped,
            "total_ingested": self.total_ingested,
            "total_updated": self.total_updated,
            "total_failed": self.total_failed,
            "target": self.target,
            "achievement_pct": round(self.total_scraped / self.target * 100, 1),
            "output_file": str(self._outfile),
        }
        print(f"\nScraper complete: {summary}")
        return summary


def main():
    parser = argparse.ArgumentParser(description="Lazada Thailand Scraper — BUY-2575")
    parser.add_argument("--api-key", default=None, help="BuyWhere API key")
    parser.add_argument("--api-base", default="http://localhost:8000", help="API base URL")
    parser.add_argument("--batch-size", type=int, default=200)
    parser.add_argument("--delay", type=float, default=1.5, help="Delay between pages (seconds)")
    parser.add_argument("--scrape-only", action="store_true", help="Save NDJSON only, no ingest")
    parser.add_argument("--ingest", action="store_true", help="Ingest to API after scraping")
    parser.add_argument("--data-dir", default=OUTPUT_DIR, help="Output directory")
    parser.add_argument("--max-pages", type=int, default=500, help="Max pages per category")
    parser.add_argument("--target", type=int, default=100_000, help="Target product count")
    args = parser.parse_args()

    if not args.scrape_only and not args.ingest:
        parser.error("Specify --scrape-only or --ingest")

    os.makedirs(OUTPUT_DIR, exist_ok=True)
    scraper = LazadaTHScraper(
        api_key=args.api_key,
        api_base=args.api_base,
        batch_size=args.batch_size,
        delay=args.delay,
        scrape_only=args.scrape_only,
        data_dir=args.data_dir,
        max_pages=args.max_pages,
        target=args.target,
    )
    summary = scraper.run()
    print(f"\nFinal: {summary}")


if __name__ == "__main__":
    main()