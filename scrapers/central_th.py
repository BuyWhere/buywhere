"""
Central Thailand product scraper.

Scrapes products from Central Online TH (Thai department store).
Uses ScraperAPI with ultra_premium proxy for anti-bot bypass.

Usage:
    python -m scrapers.central_th --api-key <key> --scrape-only
    python -m scrapers.central_th --api-key <key> --limit 20000
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
import httpx

MERCHANT_ID = "central_th"
SOURCE = "central_th"
BASE_URL = "https://www.central.co.th"
OUTPUT_DIR = "/home/paperclip/buywhere-api/data/central_th"

CATEGORIES = [
    {"id": "beauty", "name": "Beauty", "url": "/en/beauty"},
    {"id": "fashion-accessories", "name": "Fashion Accessories", "url": "/en/fashion-accessories"},
    {"id": "electronics", "name": "Electronics", "url": "/en/home-appliances"},
    {"id": "home-living", "name": "Home & Living", "url": "/en/home-lifestyle"},
    {"id": "sports-outdoor", "name": "Sports & Outdoors", "url": "/en/sports-travel"},
    {"id": "kids-baby", "name": "Kids & Baby", "url": "/en/mom-kids"},
    {"id": "grocery", "name": "Grocery", "url": "/en/home-lifestyle/grocery"},
]

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-TH,en;q=0.9,th;q=0.8",
    "Accept-Encoding": "gzip, deflate, br",
}


def build_brightdata_proxy_url(country: str = "th") -> str:
    import urllib.parse
    username = os.environ.get("BRIGHTDATA_USERNAME", "brd-customer-hl_3ab737be-zone-residential")
    password = os.environ.get("BRIGHTDATA_PASSWORD", "o3feuq72olm5")
    host = os.environ.get("BRIGHTDATA_PROXY_HOST", "brd.superproxy.io")
    port = os.environ.get("BRIGHTDATA_PROXY_PORT", "33335")
    if f"-zone-" not in username:
        username = f"{username}-zone-{country}"
    encoded_user = urllib.parse.quote(username, safe="")
    encoded_pass = urllib.parse.quote(password, safe="")
    return f"http://{encoded_user}:{encoded_pass}@{host}:{port}"


def build_scraperapi_url(url: str, api_key: str, render: bool = True) -> str:
    params = f"api_key={api_key}&url={url}&country_code=TH&render=true"
    if render:
        params += "&ultra_premium=true"
    return f"http://api.scraperapi.com/?{params}"


def extract_product_skus_from_html(html: str) -> list[dict]:
    skus = []
    sku_pattern = r'"sku"\s*:\s*"([^"]+)"'
    for match in re.findall(sku_pattern, html):
        if match not in skus:
            skus.append(match)
    return skus


def extract_products_from_html(html: str) -> list[dict]:
    products = []
    
    script_match = re.search(r'<script[^>]*>([^<]*initialData[^<]*)</script>', html, re.DOTALL)
    if not script_match:
        return products
    
    script_content = script_match.group(1)
    init_pos = script_content.find('initialData')
    if init_pos < 0:
        return products
    
    json_start = script_content.find('{', init_pos)
    json_text = script_content[json_start:json_start + 500000]
    
    hits_pattern = re.search(r'\\"hits\\"\s*:\s*\[', json_text)
    if not hits_pattern:
        return products
    
    hits_match_start = hits_pattern.start()
    bracket_pos = json_text.find('[', hits_match_start)
    
    depth = 0
    in_string = False
    escape = False
    array_start = bracket_pos + 1
    end_pos = len(json_text)
    
    for i in range(bracket_pos + 1, len(json_text)):
        c = json_text[i]
        if escape:
            escape = False
            continue
        if c == '\\':
            escape = True
            continue
        if c == '"':
            in_string = not in_string
            continue
        if in_string:
            continue
        if c == '{':
            depth += 1
        elif c == '}':
            depth -= 1
        elif c == '[':
            depth += 1
        elif c == ']':
            depth -= 1
            if depth == 0:
                end_pos = i + 1
                break
    
    raw_array = json_text[array_start:end_pos]
    unescaped = raw_array.replace(chr(92) + chr(34), '"')
    
    decoder = json.JSONDecoder()
    idx = 0
    while idx < len(unescaped):
        while idx < len(unescaped) and unescaped[idx] in ' \t\n\r':
            idx += 1
        if idx >= len(unescaped):
            break
        if unescaped[idx] == ',':
            idx += 1
            continue
        try:
            obj, new_idx = decoder.raw_decode(unescaped, idx)
            if not isinstance(obj, dict):
                idx += 1
                continue
            products.append({
                "sku": obj.get("sku", ""),
                "name_th": obj.get("name_th", ""),
                "name_en": obj.get("name_en", ""),
                "price": obj.get("price", 0),
                "final_price": obj.get("final_price", obj.get("price", 0)),
                "discount_pct": obj.get("discount_percentage", 0),
                "image": obj.get("thumbnail_url", ""),
                "url": obj.get("url_key", ""),
                "brand_name": obj.get("brand_name", ""),
                "rating_count": obj.get("rating_count", 0),
                "rating_summary": obj.get("rating_summary", 0),
            })
            idx = new_idx
        except json.JSONDecodeError:
            idx += 1
            continue
    
    return products


class CentralTHScraper:
    def __init__(
        self,
        api_key: str,
        api_base: str = "http://localhost:8000",
        batch_size: int = 100,
        delay: float = 2.0,
        scrape_only: bool = False,
        data_dir: str | None = None,
        limit: int = 0,
        target_products: int = 20000,
        max_pages_per_cat: int = 500,
    ):
        self.api_key = api_key
        self.api_base = api_base.rstrip("/")
        self.batch_size = batch_size
        self.delay = delay
        self.scrape_only = scrape_only
        self.data_dir = Path(data_dir or OUTPUT_DIR)
        self.limit = limit
        self.target_products = target_products
        self.max_pages_per_cat = max_pages_per_cat
        self.client = httpx.AsyncClient(timeout=180.0, headers=HEADERS)
        self.total_scraped = 0
        self.total_ingested = 0
        self.total_updated = 0
        self.total_failed = 0
        self.seen_skus: set[str] = set()
        self._session_start = time.strftime("%Y%m%d")
        self._outfile = self.data_dir / f"central_th_{self._session_start}.ndjson"
        self._api_calls = 0
        self._ensure_output_dir()

    def _ensure_output_dir(self):
        self.data_dir.mkdir(parents=True, exist_ok=True)

    async def close(self):
        await self.client.aclose()

    async def _fetch_page(self, url: str) -> str | None:
        import cloudscraper
        self._api_calls += 1
        scraper = cloudscraper.create_scraper(
            browser={"browser": "chrome", "platform": "windows", "desktop": True},
            delay=10,
        )
        for attempt in range(5):
            try:
                resp = scraper.get(url, timeout=30.0)
                if resp.status_code == 200 and len(resp.text) > 1000:
                    return resp.text
                if resp.status_code >= 500:
                    if attempt < 4:
                        await asyncio.sleep(15 * (attempt + 1))
                        continue
                if attempt < 4:
                    await asyncio.sleep(5 * (attempt + 1))
            except Exception:
                if attempt < 4:
                    await asyncio.sleep(5 * (attempt + 1))
        return None

    def _dedup_skus(self, skus: list[dict]) -> list[dict]:
        result = []
        for s in skus:
            if s["sku"] and s["sku"] not in self.seen_skus:
                self.seen_skus.add(s["sku"])
                result.append(s)
        return result

    def transform_product(self, raw: dict, category: dict) -> dict | None:
        try:
            sku = str(raw.get("sku", ""))
            if not sku:
                return None

            name = raw.get("name_en", "") or raw.get("name_th", "")
            if not name:
                return None

            price = raw.get("final_price", 0)
            if isinstance(price, int):
                price = float(price)

            image_url = raw.get("image", "") or raw.get("thumbnail_url", "") or ""
            if image_url and not image_url.startswith("http"):
                image_url = f"https://www.central.co.th/{image_url}"

            product_url = raw.get("url", "") or raw.get("url_key", "") or ""
            if product_url and not product_url.startswith("http"):
                product_url = f"https://www.central.co.th/en/{product_url}"

            return {
                "sku": f"central_th_{sku}",
                "merchant_id": MERCHANT_ID,
                "title": name,
                "description": raw.get("name_th", "") or "",
                "price": price,
                "currency": "THB",
                "country": "TH",
                "url": product_url,
                "image_url": image_url,
                "category": category["name"],
                "category_path": [category["name"]],
                "brand": raw.get("brand_name", "") or "",
                "is_active": True,
                "metadata": {
                    "original_sku": sku,
                    "name_th": raw.get("name_th", ""),
                    "name_en": raw.get("name_en", ""),
                    "parent_sku": raw.get("parent_sku", ""),
                    "discount_pct": raw.get("discount_pct", 0),
                    "category_id": category["id"],
                    "rating_count": raw.get("rating_count", 0),
                    "rating_summary": raw.get("rating_summary", 0),
                },
            }
        except Exception:
            return None

    def _write_products_to_file(self, products: list[dict]):
        if not products:
            return
        with self._outfile.open("a", encoding="utf-8") as f:
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
        except Exception:
            self._write_products_to_file(products)
            return 0, 0, len(products)

    async def scrape_category(self, category: dict) -> dict[str, Any]:
        cat_id = category["id"]
        cat_name = category["name"]
        url = f"{BASE_URL}{category['url']}"

        print(f"\n[{cat_name}] Starting scrape...")
        counts = {"scraped": 0, "ingested": 0, "updated": 0, "failed": 0, "pages": 0}
        page = 1
        batch = []
        consecutive_empty = 0

        while page <= self.max_pages_per_cat:
            if self.limit > 0 and self.total_scraped >= self.limit:
                print(f"  Limit of {self.limit} reached!")
                break
            if self.total_scraped >= self.target_products:
                print(f"  Target of {self.target_products} reached!")
                break

            page_url = f"{url}?page={page}" if page > 1 else url
            print(f"  Page {page}...", end=" ", flush=True)

            html = await self._fetch_page(page_url)
            if not html:
                print("Fetch failed.")
                consecutive_empty += 1
                if consecutive_empty >= 3:
                    break
                page += 1
                await asyncio.sleep(self.delay)
                continue

            products_raw = extract_products_from_html(html)
            deduped = self._dedup_skus(products_raw)

            if not deduped:
                print("No products found.")
                consecutive_empty += 1
                if consecutive_empty >= 3:
                    break
                page += 1
                await asyncio.sleep(self.delay)
                continue

            consecutive_empty = 0
            counts["pages"] += 1

            for raw in deduped:
                transformed = self.transform_product(raw, category)
                if transformed:
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
                        await asyncio.sleep(self.delay)

            new_skus = len(deduped)
            print(f"page={counts['pages']}, scraped={counts['scraped']}, new_skus={new_skus}, total={self.total_scraped}")

            if new_skus < 20:
                print(f"  Low SKU count ({new_skus}), likely end of catalog.")
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

        print(f"  [{cat_name}] Done: pages={counts['pages']}, scraped={counts['scraped']}, total={self.total_scraped}")
        return counts

    async def run(self) -> dict[str, Any]:
        print(f"Central TH Scraper starting...")
        print(f"Output: {self._outfile}")
        print(f"Target: {self.target_products:,} products")
        print(f"Limit per run: {self.limit or 'unlimited'}")
        print(f"API calls so far: {self._api_calls}")

        start = time.time()

        for cat in CATEGORIES:
            if self.limit > 0 and self.total_scraped >= self.limit:
                print(f"\nLimit of {self.limit:,} reached!")
                break
            if self.total_scraped >= self.target_products:
                print(f"\nTarget of {self.target_products:,} reached!")
                break
            await self.scrape_category(cat)
            await asyncio.sleep(3)

        elapsed = time.time() - start

        summary = {
            "elapsed_seconds": round(elapsed, 1),
            "total_scraped": self.total_scraped,
            "total_ingested": self.total_ingested,
            "total_updated": self.total_updated,
            "total_failed": self.total_failed,
            "api_calls": self._api_calls,
            "unique_skus": len(self.seen_skus),
            "output_file": str(self._outfile),
            "target": self.target_products,
            "achievement_pct": round(self.total_scraped / self.target_products * 100, 1) if self.target_products else 0,
        }

        print(f"\nScraper complete: {summary}")
        return summary


async def main():
    parser = argparse.ArgumentParser(description="Central Thailand Product Scraper")
    parser.add_argument("--api-key", required=True, help="BuyWhere API key")
    parser.add_argument("--api-base", default="http://localhost:8000", help="BuyWhere API base URL")
    parser.add_argument("--batch-size", type=int, default=100, help="Batch size for ingestion")
    parser.add_argument("--delay", type=float, default=2.0, help="Delay between pages (seconds)")
    parser.add_argument("--scrape-only", action="store_true", help="Save to NDJSON without ingesting")
    parser.add_argument("--data-dir", default=None, help="Directory to save scraped NDJSON data")
    parser.add_argument("--limit", type=int, default=0, help="Max products to scrape (0 = unlimited)")
    parser.add_argument("--target", type=int, default=20000, help="Target number of products")
    parser.add_argument("--max-pages", type=int, default=500, help="Max pages per category")
    args = parser.parse_args()

    scraper = CentralTHScraper(
        api_key=args.api_key,
        api_base=args.api_base,
        batch_size=args.batch_size,
        delay=args.delay,
        scrape_only=args.scrape_only,
        data_dir=args.data_dir,
        limit=args.limit,
        target_products=args.target,
        max_pages_per_cat=args.max_pages,
    )

    try:
        await scraper.run()
    finally:
        await scraper.close()


if __name__ == "__main__":
    asyncio.run(main())