"""
IKEA Singapore product scraper using BrightData residential proxy.

IKEA Singapore is protected by Cloudflare, requiring residential proxy
to access product data.

Key approach:
1. Use BrightData residential proxy to bypass Cloudflare
2. Fetch category/product listing pages
3. Extract product URLs and details
4. Output products matching IngestProductItem schema

Target: IKEA Singapore full catalog
"""

import argparse
import asyncio
import json
import os
import re
import time
import urllib.parse
from typing import Any, Optional

import httpx

MERCHANT_ID = "ikea_sg"
SOURCE = "ikea_sg"
BASE_URL = "https://www.ikea.com/sg/en"
OUTPUT_DIR = "/home/paperclip/buywhere-api/data/ikea-sg"

BROWSER_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-SG,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
    "Connection": "keep-alive",
    "Upgrade-Insecure-Requests": "1",
}

CATEGORIES = [
    {"id": "living-room", "name": "Living Room", "url": "https://www.ikea.com/sg/en/cat/living-room/"},
    {"id": "bedroom", "name": "Bedroom", "url": "https://www.ikea.com/sg/en/cat/bedroom/"},
    {"id": "kitchen", "name": "Kitchen", "url": "https://www.ikea.com/sg/en/cat/kitchen/"},
    {"id": "dining", "name": "Dining", "url": "https://www.ikea.com/sg/en/cat/dining-room/"},
    {"id": "bathroom", "name": "Bathroom", "url": "https://www.ikea.com/sg/en/cat/bathroom/"},
    {"id": "home-office", "name": "Home Office", "url": "https://www.ikea.com/sg/en/cat/home-office/"},
    {"id": "outdoor", "name": "Outdoor", "url": "https://www.ikea.com/sg/en/cat/outdoor/"},
    {"id": "baby-children", "name": "Baby & Children", "url": "https://www.ikea.com/sg/en/cat/baby-children/"},
    {"id": "storage", "name": "Storage & Organization", "url": "https://www.ikea.com/sg/en/cat/storage/"},
    {"id": "rugs", "name": "Rugs & Mats", "url": "https://www.ikea.com/sg/en/cat/rugs-mats/"},
    {"id": "lighting", "name": "Lighting", "url": "https://www.ikea.com/sg/en/cat/lighting/"},
    {"id": "textiles", "name": "Textiles", "url": "https://www.ikea.com/sg/en/cat/textiles/"},
    {"id": "decor", "name": "Home Decor", "url": "https://www.ikea.com/sg/en/cat/home-decor/"},
    {"id": "tableware", "name": "Tableware", "url": "https://www.ikea.com/sg/en/cat/tableware/"},
    {"id": "tools-hardware", "name": "Tools & Hardware", "url": "https://www.ikea.com/sg/en/cat/tools-hardware/"},
]


def _build_brightdata_proxy_url() -> str:
    username = os.environ.get("BRIGHTDATA_USERNAME", "brd-customer-hl_3ab737be-zone-residential")
    password = os.environ.get("BRIGHTDATA_PASSWORD", "o3feuq72olm5")
    host = os.environ.get("BRIGHTDATA_PROXY_HOST", "brd.superproxy.io")
    port = os.environ.get("BRIGHTDATA_PROXY_PORT", "33335")
    encoded_user = urllib.parse.quote(username, safe="")
    encoded_pass = urllib.parse.quote(password, safe="")
    return f"http://{encoded_user}:{encoded_pass}@{host}:{port}"


def _extract_product_ids_from_page(html: str) -> list[str]:
    product_ids = re.findall(r'"productId":"(\d+)"', html)
    product_ids.extend(re.findall(r'/sg/en/cat/[^/]+/(\d+)/', html))
    product_ids.extend(re.findall(r'/product/[^/]+/(\d+)', html))
    return list(set(product_ids))


def _extract_product_data(html: str, url: str) -> Optional[dict[str, Any]]:
    try:
        title_match = re.search(r'<title>([^<]+)</title>', html)
        if not title_match:
            return None
        title = title_match.group(1).strip()
        title = re.sub(r'\s*\|\s*IKEA[^|]*$', '', title).strip()

        price_match = re.search(r'S\$\s*([\d,]+(?:\.\d{2})?)', html)
        if not price_match:
            price_match = re.search(r'"price":\s*(\d+(?:\.\d{2})?)', html)
        
        if price_match:
            price_str = price_match.group(1).replace(",", "")
            try:
                price = float(price_str)
            except ValueError:
                price = 0.0
        else:
            price = 0.0

        image_match = re.search(r'<meta[^>]+property="og:image"[^>]+content="([^"]+)"', html)
        if not image_match:
            image_match = re.search(r'"image":"([^"]+)"', html)
        image_url = image_match.group(1) if image_match else ""

        desc_match = re.search(r'<meta[^>]+name="description"[^>]+content="([^"]+)"', html)
        description = desc_match.group(1) if desc_match else ""

        product_id_match = re.search(r'/product/[^/]+/(\d+)', url)
        if not product_id_match:
            product_id_match = re.search(r'"productId":"(\d+)"', html)
        product_id = product_id_match.group(1) if product_id_match else ""

        sku = f"IKEA_SG_{product_id}" if product_id else ""

        return {
            "sku": sku,
            "merchant_id": MERCHANT_ID,
            "title": title,
            "description": description,
            "price": price,
            "currency": "SGD",
            "url": url,
            "image_url": image_url,
            "brand": "IKEA",
            "is_active": True,
            "is_available": True,
            "in_stock": True,
            "metadata": {
                "source": SOURCE,
                "product_id": product_id,
                "scrape_url": url,
            },
        }
    except Exception:
        return None


class IKEAScraper:
    def __init__(
        self,
        api_key: str,
        api_base: str = "http://localhost:8000",
        batch_size: int = 100,
        delay: float = 1.0,
        scrape_only: bool = False,
        use_proxy: bool = True,
    ):
        self.api_key = api_key
        self.api_base = api_base.rstrip("/")
        self.batch_size = batch_size
        self.delay = delay
        self.scrape_only = scrape_only
        self.use_proxy = use_proxy
        self.total_scraped = 0
        self.total_ingested = 0
        self.total_updated = 0
        self.total_failed = 0
        self._products_outfile = None
        self._ensure_output_dir()

        proxy_url = _build_brightdata_proxy_url() if use_proxy else None
        self.client = httpx.AsyncClient(
            timeout=60.0,
            headers=BROWSER_HEADERS,
            proxy=proxy_url,
        )

    def _ensure_output_dir(self):
        os.makedirs(OUTPUT_DIR, exist_ok=True)
        ts = time.strftime("%Y%m%d_%H%M%S")
        self._products_outfile = os.path.join(OUTPUT_DIR, f"products_{ts}.jsonl")

    @property
    def products_outfile(self) -> str:
        return self._products_outfile

    async def close(self):
        await self.client.aclose()

    async def _fetch_page(self, url: str) -> Optional[str]:
        for attempt in range(3):
            try:
                resp = await self.client.get(url)
                if resp.status_code == 200:
                    return resp.text
                elif resp.status_code in (403, 429, 503):
                    wait = 2 ** attempt * 5
                    print(f"  HTTP {resp.status_code}, waiting {wait}s before retry...")
                    await asyncio.sleep(wait)
                else:
                    print(f"  HTTP {resp.status_code} for {url}")
                    if attempt < 2:
                        await asyncio.sleep(2 ** attempt)
                    else:
                        return None
            except Exception as e:
                print(f"  Error fetching {url}: {e}")
                if attempt < 2:
                    await asyncio.sleep(2 ** attempt)
                else:
                    return None
        return None

    async def _ingest_batch(self, products: list[dict]) -> tuple[int, int, int]:
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
            print(f"  Ingestion error: {e}")
            return 0, 0, len(products)

    def _write_products_to_file(self, products: list[dict]):
        if not products:
            return
        with open(self._products_outfile, "a", encoding="utf-8") as f:
            for p in products:
                f.write(json.dumps(p, ensure_ascii=False) + "\n")

    async def scrape_category(self, category: dict) -> dict[str, int]:
        cat_id = category["id"]
        cat_name = category["name"]
        
        print(f"\n[{cat_name}] Starting scrape...")
        counts = {"scraped": 0, "ingested": 0, "updated": 0, "failed": 0}
        batch = []

        html = await self._fetch_page(category["url"])
        if not html:
            print(f"  Failed to fetch category page")
            return counts

        product_ids = _extract_product_ids_from_page(html)
        print(f"  Found {len(product_ids)} product IDs")

        for product_id in product_ids[:500]:
            product_url = f"https://www.ikea.com/sg/en/product/{product_id}"
            
            product_html = await self._fetch_page(product_url)
            if not product_html:
                continue

            product_data = _extract_product_data(product_html, product_url)
            if not product_data:
                continue

            batch.append(product_data)
            counts["scraped"] += 1
            self.total_scraped += 1

            if len(batch) >= self.batch_size:
                i, u, f = await self._ingest_batch(batch)
                counts["ingested"] += i
                counts["updated"] += u
                counts["failed"] += f
                self.total_ingested += i
                self.total_updated += u
                self.total_failed += f
                batch = []
                await asyncio.sleep(self.delay)

            await asyncio.sleep(0.5)

        if batch:
            i, u, f = await self._ingest_batch(batch)
            counts["ingested"] += i
            counts["updated"] += u
            counts["failed"] += f
            self.total_ingested += i
            self.total_updated += u
            self.total_failed += f

        print(f"  [{cat_name}] Done: {counts}")
        return counts

    async def run(self) -> dict[str, Any]:
        mode = "scrape only" if self.scrape_only else f"API: {self.api_base}"
        proxy_info = "with BrightData proxy" if self.use_proxy else "direct"
        print(f"IKEA SG Scraper starting...")
        print(f"Mode: {mode}, Connection: {proxy_info}")
        print(f"Batch size: {self.batch_size}, Delay: {self.delay}s")
        print(f"Output: {self.products_outfile}")
        print(f"Categories: {len(CATEGORIES)}")

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
    parser = argparse.ArgumentParser(description="IKEA SG Scraper")
    parser.add_argument("--api-key", default=None, help="BuyWhere API key (or set PRODUCT_API_KEY env var)")
    parser.add_argument("--api-base", default="http://localhost:8000", help="BuyWhere API base URL")
    parser.add_argument("--batch-size", type=int, default=100, help="Batch size for ingestion")
    parser.add_argument("--delay", type=float, default=1.0, help="Delay between batches (seconds)")
    parser.add_argument("--scrape-only", action="store_true", help="Save to JSONL without ingesting")
    parser.add_argument("--no-proxy", action="store_true", help="Disable BrightData proxy")
    args = parser.parse_args()

    api_key = args.api_key or os.environ.get("PRODUCT_API_KEY", "")
    if not api_key:
        raise ValueError("API key required: set --api-key or PRODUCT_API_KEY env var")

    scraper = IKEAScraper(
        api_key=api_key,
        api_base=args.api_base,
        batch_size=args.batch_size,
        delay=args.delay,
        scrape_only=args.scrape_only,
        use_proxy=not args.no_proxy,
    )

    try:
        await scraper.run()
    finally:
        await scraper.close()


if __name__ == "__main__":
    asyncio.run(main())
