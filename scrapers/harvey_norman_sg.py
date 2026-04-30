"""
Harvey Norman Singapore product scraper.

Scrapes electronics products from Harvey Norman SG and outputs structured JSON
matching the BuyWhere catalog schema for ingestion via /v1/ingest/products.

Site: harveynorman.com.sg (CS-Cart platform)
Strategy: HTML scraping via sitemap product URLs + data-product-* attribute extraction.

Usage:
    python -m scrapers.harvey_norman_sg --api-key <key> [--batch-size 100] [--delay 1.0]
    python -m scrapers.harvey_norman_sg --scrape-only [--test-limit 100]

Categories: Computers, Tablets, Phones, Home Appliances, TV & Audio,
            Health & Personal Care, Gaming, Cameras
Target: 30,000+ products
"""
import argparse
import asyncio
import base64
import json
import re
import time
from pathlib import Path
from typing import Any

import httpx

from scrapers.logging import get_logger

MERCHANT_ID = "harvey_norman_sg"
SOURCE = "harvey_norman_sg"
BASE_URL = "https://www.harveynorman.com.sg"
SITEMAP_URL = f"{BASE_URL}/sitemap.xml"

log = get_logger(MERCHANT_ID)

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-SG,en;q=0.9",
    "Referer": BASE_URL,
}

CATEGORIES = [
    {"id": "computers", "name": "Computers", "path": "/computing/computers-en/"},
    {"id": "laptops", "name": "Laptops", "path": "/computing/computers-en/laptops-en/"},
    {"id": "tablets", "name": "Tablets", "path": "/computing/tablets/"},
    {"id": "phones", "name": "Phones & Phablets", "path": "/smart-tech-and-phones/phones-and-phablets/"},
    {"id": "cameras", "name": "Cameras", "path": "/smart-tech-and-phones/cameras-en/"},
    {"id": "home-appliances", "name": "Home Appliances", "path": "/home-appliances/"},
    {"id": "tv-audio", "name": "TV & Audio", "path": "/tv-and-audio/"},
    {"id": "gaming", "name": "Gaming", "path": "/computing/games-hub-en/"},
    {"id": "health-personal", "name": "Health & Personal Care", "path": "/health-and-personal-care/"},
]

OUTPUT_DIR = "/home/paperclip/buywhere-api/data/harvey-norman"


class HarveyNormanScraper:
    def __init__(
        self,
        api_key: str,
        api_base: str = "http://localhost:8000",
        batch_size: int = 100,
        delay: float = 1.0,
        data_dir: str = OUTPUT_DIR,
        test_limit: int = 0,
        scrape_only: bool = False,
    ):
        self.api_key = api_key
        self.api_base = api_base.rstrip("/")
        self.batch_size = batch_size
        self.delay = delay
        self.data_dir = Path(data_dir)
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.test_limit = test_limit
        self.scrape_only = scrape_only
        self.sitemap_client = httpx.AsyncClient(timeout=30.0, headers=HEADERS, follow_redirects=True)
        self.client = httpx.AsyncClient(timeout=30.0, headers=HEADERS, follow_redirects=True)
        self.total_scraped = 0
        self.total_ingested = 0
        self.total_updated = 0
        self.total_failed = 0
        self._ensure_output_dir()

    def _ensure_output_dir(self):
        import os
        os.makedirs(self.data_dir, exist_ok=True)

    async def close(self):
        await self.client.aclose()
        await self.sitemap_client.aclose()

    async def _get_html(self, url: str, retries: int = 3, client=None) -> str | None:
        if client is None:
            client = self.client
        for attempt in range(retries):
            try:
                resp = await client.get(url)
                resp.raise_for_status()
                return resp.text
            except Exception:
                if attempt < retries - 1:
                    await asyncio.sleep(2 ** attempt)
                log.request_failed(url, attempt, "HTTP request failed")
        return None

    async def fetch_sitemap_product_urls(self) -> list[str]:
        html = await self._get_html(SITEMAP_URL, client=self.sitemap_client)
        await self.sitemap_client.aclose()
        self.sitemap_client = httpx.AsyncClient(timeout=30.0, headers=HEADERS, follow_redirects=True)
        if not html:
            return []
        urls = re.findall(r'https://www\.harveynorman\.com\.sg/[^\s<>"\']*product-\d+\.html', html)
        seen = set()
        unique_urls = []
        for url in urls:
            if url not in seen:
                seen.add(url)
                unique_urls.append(url)
        return unique_urls

    def _extract_product_data(self, html: str, url: str) -> dict[str, Any] | None:
        product_data = {}

        product_id_match = re.search(r'data-product-id=(\d+)', html)
        if product_id_match:
            product_data['id'] = product_id_match.group(1)

        product_code_match = re.search(r'data-product-code=([^\s&"]+)', html)
        if product_code_match:
            product_data['code'] = product_code_match.group(1)

        name_match = re.search(r'data-product-name=([^\s&"]+)', html)
        if name_match:
            try:
                product_data['name'] = base64.b64decode(name_match.group(1)).decode('utf-8')
            except Exception:
                product_data['name'] = name_match.group(1)

        brand_match = re.search(r'data-product-brand=([^\s&"]+)', html)
        if brand_match:
            brand_val = brand_match.group(1)
            try:
                product_data['brand'] = base64.b64decode(brand_val).decode('utf-8')
            except Exception:
                product_data['brand'] = brand_val

        category_match = re.search(r'data-product-category=([^\s&"]+)', html)
        if category_match:
            try:
                product_data['category'] = base64.b64decode(category_match.group(1)).decode('utf-8')
            except Exception:
                pass

        price_match = re.search(r'data-product-price=([^\s&"]+)', html)
        if price_match:
            try:
                product_data['price'] = float(price_match.group(1))
            except ValueError:
                product_data['price'] = 0.0

        quantity_match = re.search(r'data-product-quantity=([^\s&"]+)', html)
        if quantity_match:
            try:
                product_data['quantity'] = int(quantity_match.group(1))
            except ValueError:
                pass

        discount_match = re.search(r'data-product-discount=([^\s&"]+)', html)
        if discount_match:
            try:
                product_data['discount'] = int(discount_match.group(1))
            except ValueError:
                pass

        img_match = re.search(r'<img[^>]+class="ty-pict ca-image"[^>]+src="([^"]+)"', html)
        if not img_match:
            img_match = re.search(r'<img[^>]+id="product-img-\d+"[^>]+src="([^"]+)"', html)
        if not img_match:
            img_match = re.search(r'"image":"([^"]+)"', html)
        if img_match:
            product_data['image_url'] = img_match.group(1)

        desc_match = re.search(r'<meta name="description" content="([^"]+)"', html)
        if desc_match:
            product_data['description'] = desc_match.group(1)

        return product_data if product_data.get('id') else None

    def transform_product(self, raw: dict, url: str) -> dict[str, Any] | None:
        try:
            product_id = str(raw.get("id", ""))
            if not product_id:
                return None

            sku = f"hn_{product_id}"

            name = raw.get("name", "").strip()
            if not name:
                return None

            price = raw.get("price", 0.0)
            if isinstance(price, str):
                price = float(price.replace("$", "").replace(",", "") or 0)

            quantity = raw.get("quantity", 0)
            is_active = quantity is not None and quantity > 0

            image_url = raw.get("image_url", "")
            if image_url and not image_url.startswith("http"):
                image_url = f"{BASE_URL}{image_url}" if image_url.startswith("/") else f"{BASE_URL}/{image_url}"

            brand = raw.get("brand", "") or ""
            description = raw.get("description", "") or ""

            return {
                "sku": sku,
                "merchant_id": MERCHANT_ID,
                "title": name,
                "description": description,
                "price": price,
                "currency": "SGD",
                "url": url,
                "image_url": image_url,
                "category": raw.get("category", ""),
                "category_path": [raw.get("category", "")] if raw.get("category") else [],
                "brand": brand,
                "is_active": is_active,
                "metadata": {
                    "source_type": "html_scrape",
                    "product_code": raw.get("code", ""),
                    "quantity": quantity,
                    "discount": raw.get("discount", 0),
                },
            }
        except Exception:
            return None

    def _write_products_to_file(self, products: list[dict]):
        if not products:
            return
        ts = time.strftime("%Y%m%d_%H%M%S")
        outfile = self.data_dir / f"products_{ts}.jsonl"
        with open(outfile, "a", encoding="utf-8") as f:
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

    async def scrape_product(self, url: str) -> dict[str, Any] | None:
        html = await self._get_html(url)
        if not html:
            return None
        return self._extract_product_data(html, url)

    async def run(self) -> dict[str, Any]:
        print(f"Harvey Norman SG Scraper starting...")
        print(f"Mode: {'scrape only' if self.scrape_only else f'API: {self.api_base}'}")
        print(f"Batch size: {self.batch_size}, Delay: {self.delay}s")
        print(f"Data dir: {self.data_dir}")
        print(f"Test limit: {self.test_limit if self.test_limit else 'none'}")

        start = time.time()

        print("\nFetching product URLs from sitemap...")
        product_urls = await self.fetch_sitemap_product_urls()
        print(f"Found {len(product_urls)} product URLs in sitemap")

        if not product_urls:
            print("No product URLs found. Site may be blocking or requiring JavaScript.")
            log.network_error(SITEMAP_URL, "No product URLs found in sitemap")
            return {
                "elapsed_seconds": round(time.time() - start, 1),
                "total_scraped": 0,
                "error": "No product URLs found - site may use bot protection or require JavaScript",
            }

        print(f"\nScraping {len(product_urls)} products...")
        if self.test_limit:
            product_urls = product_urls[:self.test_limit]
            print(f"Test mode: limited to {self.test_limit} products")

        batch = []
        counts = {"scraped": 0, "ingested": 0, "updated": 0, "failed": 0}

        for i, url in enumerate(product_urls):
            if self.test_limit and counts["scraped"] >= self.test_limit:
                break

            if i % 50 == 0 and i > 0:
                print(f"  Progress: {i}/{len(product_urls)}...", end=" ", flush=True)

            raw = await self.scrape_product(url)
            if not raw:
                continue

            transformed = self.transform_product(raw, url)
            if not transformed:
                continue

            batch.append(transformed)
            counts["scraped"] += 1

            if len(batch) >= self.batch_size:
                i_count, u_count, f_count = await self.ingest_batch(batch)
                counts["ingested"] += i_count
                counts["updated"] += u_count
                counts["failed"] += f_count
                self.total_ingested += i_count
                self.total_updated += u_count
                self.total_failed += f_count
                batch = []
                await asyncio.sleep(self.delay)

            await asyncio.sleep(0.5)

        if batch:
            i_count, u_count, f_count = await self.ingest_batch(batch)
            counts["ingested"] += i_count
            counts["updated"] += u_count
            counts["failed"] += f_count
            self.total_ingested += i_count
            self.total_updated += u_count
            self.total_failed += f_count

        self.total_scraped = counts["scraped"]
        elapsed = time.time() - start

        summary = {
            "elapsed_seconds": round(elapsed, 1),
            "total_scraped": self.total_scraped,
            "total_ingested": self.total_ingested,
            "total_updated": self.total_updated,
            "total_failed": self.total_failed,
            "products_in_sitemap": len(product_urls),
        }

        print(f"\nScraper complete: {summary}")
        return summary


async def main():
    parser = argparse.ArgumentParser(description="Harvey Norman SG Scraper")
    parser.add_argument("--api-key", required=True, help="BuyWhere API key")
    parser.add_argument(
        "--api-base",
        default="http://localhost:8000",
        help="BuyWhere API base URL",
    )
    parser.add_argument("--batch-size", type=int, default=100)
    parser.add_argument("--delay", type=float, default=1.0, help="Delay between batches (seconds)")
    parser.add_argument(
        "--data-dir",
        default=OUTPUT_DIR,
        help="Directory to save scraped JSONL data",
    )
    parser.add_argument(
        "--test-limit",
        type=int,
        default=0,
        help="Limit number of products to scrape for testing (0=no limit)",
    )
    parser.add_argument(
        "--scrape-only",
        action="store_true",
        help="Save to JSONL without ingesting to API",
    )
    args = parser.parse_args()

    scraper = HarveyNormanScraper(
        api_key=args.api_key,
        api_base=args.api_base,
        batch_size=args.batch_size,
        delay=args.delay,
        data_dir=args.data_dir,
        test_limit=args.test_limit,
        scrape_only=args.scrape_only,
    )

    try:
        await scraper.run()
    finally:
        await scraper.close()


if __name__ == "__main__":
    asyncio.run(main())