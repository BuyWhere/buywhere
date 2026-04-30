"""
Watsons Singapore product scraper using HTTPX with BrightData proxy.

Uses HTTPX with full browser headers via BrightData residential proxy
to bypass anti-bot measures and extract product data.

Key approach:
1. Visit homepage with full browser headers to establish session and get BP codes
2. Extract BP product codes from page content
3. Visit individual product pages at /p/{BP_code}
4. Parse product details from HTML

Target: 20,000+ products from Watsons Singapore
"""

import argparse
import asyncio
import json
import os
import re
import time
import urllib.parse
from typing import Any

import httpx

MERCHANT_ID = "watsons_sg"
SOURCE = "watsons_sg"
BASE_URL = "https://www.watsons.com.sg"
OUTPUT_DIR = "/home/paperclip/buywhere/data"

BROWSER_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "en-SG,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
    "Connection": "keep-alive",
    "Upgrade-Insecure-Requests": "1",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
    "Sec-Fetch-User": "?1",
}


def _build_proxy_url() -> str:
    username = os.environ.get("BRIGHTDATA_USERNAME", "brd-customer-hl_3ab737be-zone-residential")
    password = os.environ.get("BRIGHTDATA_PASSWORD", "o3feuq72olm5")
    host = os.environ.get("BRIGHTDATA_PROXY_HOST", "brd.superproxy.io")
    port = os.environ.get("BRIGHTDATA_PROXY_PORT", "33335")
    encoded_user = urllib.parse.quote(username, safe="")
    encoded_pass = urllib.parse.quote(password, safe="")
    return f"http://{encoded_user}:{encoded_pass}@{host}:{port}"


def _extract_bp_codes(text: str) -> list[str]:
    codes = re.findall(r"BP_\d+", text)
    return list(set(codes))


def _extract_product_info(html: str, sku: str) -> dict[str, Any] | None:
    try:
        # Extract title
        title_match = re.search(r"<title>([^<]+)</title>", html)
        if not title_match:
            return None
        full_title = title_match.group(1)
        
        # Clean title - remove site suffix
        title = re.sub(r"\s*\|\s*Watsons[^|]*$", "", full_title).strip()
        
        # Extract price
        price_match = re.search(r"S\$\s*([\d,]+(?:\.\d{2})?)", html)
        price_str = price_match.group(1).replace(",", "") if price_match else "0"
        try:
            price_val = float(price_str)
        except ValueError:
            price_val = 0.0
        
        # Extract brand from title (usually first word if known brand)
        brand = ""
        known_brands = ["LA ROCHE-POSAY", "NEUTROGENA", "SENKA", "NIVEA", "VASELINE", 
                       "DETTOL", "HEAD & SHOULDERS", "PANTENE", "OLAY", "AVEENO",
                       "BIODERMA", "CETAPHIL", "EUCERIN", "VICHY", "LANEIGE"]
        for b in known_brands:
            if b in title.upper():
                brand = b
                break
        
        # Extract image
        img_match = re.search(r'<meta[^>]+property="og:image"[^>]+content="([^"]+)"', html)
        if not img_match:
            img_match = re.search(r'<img[^>]+class="[^"]*product[^"]*"[^>]+src="([^"]+)"', html)
        image_url = img_match.group(1) if img_match else ""
        
        # Extract description
        desc_match = re.search(r'<meta[^>]+name="description"[^>]+content="([^"]+)"', html)
        description = desc_match.group(1) if desc_match else ""
        
        product_url = f"{BASE_URL}/p/{sku}"
        
        return {
            "sku": sku,
            "merchant_id": MERCHANT_ID,
            "title": title,
            "description": description,
            "price": price_val,
            "currency": "SGD",
            "url": product_url,
            "image_url": image_url,
            "category": "watsons",
            "category_path": ["Watsons"],
            "brand": brand,
            "is_active": True,
            "metadata": {"source": "watsons_sg"},
        }
    except Exception as e:
        return None


class WatsonsSGScraper:
    def __init__(
        self,
        api_key: str | None = None,
        api_base: str = "http://localhost:8000",
        batch_size: int = 100,
        delay: float = 1.0,
        limit: int = 0,
        scrape_only: bool = False,
        data_dir: str | None = None,
        headless: bool = True,
        target_products: int = 20000,
    ):
        self.api_key = api_key
        self.api_base = api_base.rstrip("/")
        self.batch_size = batch_size
        self.delay = delay
        self.limit = limit
        self.scrape_only = scrape_only
        self.data_dir = data_dir or OUTPUT_DIR
        self.headless = headless
        self.target_products = target_products
        self._proxy_url = _build_proxy_url()
        self._http_client: httpx.AsyncClient | None = None
        self._session_start = time.strftime("%Y%m%d_%H%M%S")
        self._products_outfile = f"{self.data_dir}/watsons_sg_{self._session_start}.ndjson"
        self.total_scraped = 0
        self.total_ingested = 0
        self.total_updated = 0
        self.total_failed = 0
        self.seen_skus: set[str] = set()

    async def _get_client(self) -> httpx.AsyncClient:
        if self._http_client is None:
            self._http_client = httpx.AsyncClient(
                timeout=30.0,
                proxy=self._proxy_url,
                verify=False,
                follow_redirects=True,
            )
        return self._http_client

    async def _ensure_session(self) -> None:
        client = await self._get_client()
        resp = await client.get(BASE_URL, headers=BROWSER_HEADERS)
        if resp.status_code != 200:
            print(f"  Session establishment failed: {resp.status_code}")

    async def close(self) -> None:
        if self._http_client:
            await self._http_client.aclose()

    def _write_ndjson(self, products: list[dict]) -> None:
        if not products:
            return
        os.makedirs(self.data_dir, exist_ok=True)
        with open(self._products_outfile, "a", encoding="utf-8") as f:
            for p in products:
                f.write(json.dumps(p, ensure_ascii=False) + "\n")

    async def _ingest_batch(self, products: list[dict]) -> tuple[int, int, int]:
        if not products:
            return 0, 0, 0
        if self.scrape_only:
            self._write_ndjson(products)
            return len(products), 0, 0

        client = await self._get_client()
        url = f"{self.api_base}/v1/ingest/products"
        headers = {"Authorization": f"Bearer {self.api_key}"}
        payload = {"source": SOURCE, "products": products}
        try:
            resp = await client.post(url, json=payload, headers=headers)
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

    async def _fetch_bp_codes_from_homepage(self) -> list[str]:
        client = await self._get_client()
        resp = await client.get(BASE_URL, headers=BROWSER_HEADERS)
        if resp.status_code != 200:
            print(f"  Homepage fetch failed: {resp.status_code}")
            return []
        codes = _extract_bp_codes(resp.text)
        print(f"  Found {len(codes)} BP codes from homepage")
        return codes

    async def _fetch_bp_codes_from_categories(self) -> list[str]:
        client = await self._get_client()
        all_codes: list[str] = []
        
        category_paths = [
            "/skincare", "/hair-care", "/personal-care",
            "/vitamins-supplements", "/baby-care", "/makeup",
            "/fragrances", "/bath-body", "/mens-grooming", "/health-care",
        ]
        
        for cat_path in category_paths:
            url = f"{BASE_URL}{cat_path}"
            try:
                resp = await client.get(url, headers=BROWSER_HEADERS)
                if resp.status_code == 200:
                    codes = _extract_bp_codes(resp.text)
                    all_codes.extend(codes)
                    print(f"  {cat_path}: {len(codes)} BP codes (total: {len(all_codes)})")
                else:
                    print(f"  {cat_path}: HTTP {resp.status_code}")
                await asyncio.sleep(1)
            except Exception as e:
                print(f"  {cat_path}: Error - {str(e)[:40]}")
        
        return list(set(all_codes))

    async def scrape_product(self, sku: str) -> dict[str, Any] | None:
        client = await self._get_client()
        url = f"{BASE_URL}/p/{sku}"
        try:
            resp = await client.get(url, headers=BROWSER_HEADERS)
            if resp.status_code != 200:
                return None
            return _extract_product_info(resp.text, sku)
        except Exception:
            return None

    async def run(self) -> dict[str, Any]:
        print("=" * 60)
        print("Watsons SG HTTPX Scraper")
        print("=" * 60)
        print(f"Mode: {'scrape-only' if self.scrape_only else 'scrape + ingest'}")
        print(f"Batch size: {self.batch_size}, Delay: {self.delay}s")
        print(f"Target: {self.target_products:,} products")
        print(f"Output file: {self._products_outfile}")
        print("=" * 60)

        os.makedirs(self.data_dir, exist_ok=True)

        start = time.time()

        # Step 1: Establish session and get BP codes
        print("\n[1/3] Establishing session and discovering product codes...")
        await self._ensure_session()
        
        all_codes: list[str] = []
        
        # Get codes from homepage
        homepage_codes = await self._fetch_bp_codes_from_homepage()
        all_codes.extend(homepage_codes)
        
        # Get codes from category pages
        category_codes = await self._fetch_bp_codes_from_categories()
        all_codes.extend(category_codes)
        
        # Dedupe
        all_codes = list(set(all_codes))
        print(f"\nTotal unique BP codes discovered: {len(all_codes)}")

        if not all_codes:
            print("ERROR: No product codes found. Cannot proceed.")
            return {"error": "No BP codes found"}

        # Step 2: Scrape products
        print(f"\n[2/3] Scraping {min(len(all_codes), self.target_products)} products...")
        batch: list[dict] = []
        counts = {"scraped": 0, "ingested": 0, "updated": 0, "failed": 0}

        for i, sku in enumerate(all_codes):
            if self.limit > 0 and self.total_scraped >= self.limit:
                break
            if self.target_products > 0 and self.total_scraped >= self.target_products:
                break

            if i % 50 == 0:
                print(f"  Progress: {i}/{len(all_codes)}, scraped={self.total_scraped}")

            if sku in self.seen_skus:
                continue

            product = await self.scrape_product(sku)
            if product:
                self.seen_skus.add(sku)
                batch.append(product)
                counts["scraped"] += 1
                self.total_scraped += 1

                if len(batch) >= self.batch_size:
                    i_count, u_count, f_count = await self._ingest_batch(batch)
                    counts["ingested"] += i_count
                    counts["updated"] += u_count
                    counts["failed"] += f_count
                    self.total_ingested += i_count
                    self.total_updated += u_count
                    self.total_failed += f_count
                    batch = []
                    await asyncio.sleep(self.delay)

        # Flush remaining batch
        if batch:
            i_count, u_count, f_count = await self._ingest_batch(batch)
            counts["ingested"] += i_count
            counts["updated"] += u_count
            counts["failed"] += f_count
            self.total_ingested += i_count
            self.total_updated += u_count
            self.total_failed += f_count

        elapsed = time.time() - start

        summary: dict[str, Any] = {
            "elapsed_seconds": round(elapsed, 1),
            "total_scraped": self.total_scraped,
            "total_ingested": self.total_ingested,
            "total_updated": self.total_updated,
            "total_failed": self.total_failed,
            "unique_skus": len(self.seen_skus),
            "codes_discovered": len(all_codes),
            "output_file": self._products_outfile,
        }

        print("\n" + "=" * 60)
        print(f"Scraper complete: {json.dumps(summary, indent=2)}")
        print("=" * 60)
        return summary


async def main():
    parser = argparse.ArgumentParser(description="Watsons SG HTTPX Scraper")
    parser.add_argument("--api-key", required=False)
    parser.add_argument("--api-base", default="http://localhost:8000")
    parser.add_argument("--batch-size", type=int, default=100)
    parser.add_argument("--delay", type=float, default=1.0)
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--target", type=int, default=20000)
    parser.add_argument("--scrape-only", action="store_true")
    parser.add_argument("--data-dir", default=None)
    args = parser.parse_args()

    if not args.scrape_only and not args.api_key:
        parser.error("--api-key is required unless --scrape-only is specified")

    scraper = WatsonsSGScraper(
        api_key=args.api_key,
        api_base=args.api_base,
        batch_size=args.batch_size,
        delay=args.delay,
        limit=args.limit,
        target_products=args.target,
        scrape_only=args.scrape_only,
        data_dir=args.data_dir,
    )

    try:
        await scraper.run()
    except KeyboardInterrupt:
        print("Interrupted")
    finally:
        await scraper.close()


if __name__ == "__main__":
    asyncio.run(main())
