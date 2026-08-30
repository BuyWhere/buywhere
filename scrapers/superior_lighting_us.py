"""
Superior Lighting US scraper — BigCommerce Catalyst (Next.js), sitemap crawl + JSON-LD extraction.

Platform: BigCommerce Catalyst (Next.js on BigCommerce backend)
Extraction: JSON-LD Product schema from product pages
Sitemap: /xmlsitemap.php → 5 product sitemap pages, ~40K products

Usage:
    python -m scrapers.superior_lighting_us --api-key <key> --scrape-only --limit 10
    python -m scrapers.superior_lighting_us --api-key <key> --api-base http://localhost:8000
"""

import argparse
import asyncio
import json
import re
import sys
import time
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urljoin

import httpx

MERCHANT_ID = "superiorlighting_us"
SOURCE = "superiorlighting_us"
BASE_URL = "https://www.superiorlighting.com"
SITEMAP_INDEX_URL = f"{BASE_URL}/xmlsitemap.php"
OUTPUT_DIR = Path("/home/paperclip/buywhere-api/data/superiorlighting_us")

NS = {"sm": "http://www.sitemaps.org/schemas/sitemap/0.9"}
NS_ALT = "https://www.sitemaps.org/schemas/sitemap/0.9"

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}


def parse_price(value: Any) -> float:
    if value is None:
        return 0.0
    if isinstance(value, (int, float)):
        return float(value)
    cleaned = str(value).replace("$", "").replace(",", "").strip()
    match = re.search(r"[\d]+(?:\.\d+)?", cleaned)
    return float(match.group(0)) if match else 0.0


def extract_jsonld_blocks(html: str) -> list[dict]:
    results: list[dict] = []
    pattern = r'<script[^>]*type="application/ld\+json"[^>]*>(.*?)</script>'
    for match in re.finditer(pattern, html, re.DOTALL | re.IGNORECASE):
        try:
            data = json.loads(match.group(1).strip())
            if isinstance(data, list):
                results.extend(data)
            else:
                results.append(data)
        except json.JSONDecodeError:
            continue
    return results


def extract_breadcrumbs(jsonld_blocks: list[dict]) -> list[dict]:
    for block in jsonld_blocks:
        if block.get("@type") == "BreadcrumbList":
            items = block.get("itemListElement", [])
            return items
    return []


def extract_product(jsonld_blocks: list[dict]) -> dict | None:
    for block in jsonld_blocks:
        if block.get("@type") == "Product":
            return block
    if "@graph" in jsonld_blocks:
        for block in jsonld_blocks if isinstance(jsonld_blocks, list) else []:
            if isinstance(block, dict) and block.get("@type") == "Product":
                return block
    for block in jsonld_blocks:
        if isinstance(block, dict) and "@graph" in block:
            for item in block["@graph"]:
                if isinstance(item, dict) and item.get("@type") == "Product":
                    return item
    return None


def category_from_breadcrumbs(breadcrumbs: list[dict]) -> tuple[str, list[str]]:
    cats = []
    for item in breadcrumbs:
        if isinstance(item, dict):
            name = item.get("name", "").strip()
            if not name:
                item_data = item.get("item", {})
                if isinstance(item_data, dict):
                    name = item_data.get("name", "").strip()
            if name and name.lower() != "home":
                cats.append(name)
    if cats:
        return cats[-1], cats
    return "Lighting", ["Lighting"]


def extract_products_from_html(html: str, url: str) -> list[dict]:
    jsonld_blocks = extract_jsonld_blocks(html)
    if not jsonld_blocks:
        return []

    product = extract_product(jsonld_blocks)
    breadcrumbs = extract_breadcrumbs(jsonld_blocks)
    category, category_path = category_from_breadcrumbs(breadcrumbs)

    if not product:
        return []

    name = str(product.get("name", "")).strip()
    if not name:
        return []

    sku = str(product.get("sku", "")).strip()
    if not sku:
        slug = url.rstrip("/").rsplit("/", 1)[-1]
        sku = f"sl_{slug}"[:100]

    description = str(product.get("description", "")).strip()[:5000]

    price = 0.0
    currency = "USD"
    availability = "InStock"
    offers = product.get("offers")
    if isinstance(offers, dict):
        avail = str(offers.get("availability", "")).strip()
        if "OutOfStock" in avail:
            availability = "OutOfStock"

        price_spec = offers.get("priceSpecification")
        if isinstance(price_spec, dict):
            price = parse_price(price_spec.get("price"))
            currency = str(price_spec.get("priceCurrency", "USD")).strip() or "USD"
        else:
            price = parse_price(offers.get("price"))
            currency = str(offers.get("priceCurrency", "USD")).strip() or "USD"
    elif isinstance(offers, list) and offers:
        off = offers[0]
        if isinstance(off, dict):
            price_spec = off.get("priceSpecification")
            if isinstance(price_spec, dict):
                price = parse_price(price_spec.get("price"))
                currency = str(price_spec.get("priceCurrency", "USD")).strip() or "USD"
            else:
                price = parse_price(off.get("price"))
                currency = str(off.get("priceCurrency", "USD")).strip() or "USD"

    images = product.get("image", [])
    if isinstance(images, str):
        images = [images]
    image_url = images[0] if images else ""
    if isinstance(image_url, list):
        image_url = image_url[0] if image_url else ""
    if isinstance(image_url, dict):
        image_url = image_url.get("url", "")

    brand_data = product.get("brand", {})
    brand = ""
    if isinstance(brand_data, dict):
        brand = str(brand_data.get("name", "")).strip()
    elif isinstance(brand_data, str):
        brand = brand_data.strip()

    metadata = {
        "platform": "bigcommerce_catalyst",
        "source_domain": "superiorlighting.com",
        "extraction_method": "jsonld_product",
    }
    mpn = product.get("mpn")
    if mpn:
        metadata["mpn"] = str(mpn)
    gtin = product.get("gtin13") or product.get("gtin12") or product.get("gtin8")
    if gtin:
        metadata["gtin"] = str(gtin)

    return [{
        "sku": sku[:200],
        "merchant_id": MERCHANT_ID,
        "title": name[:1000],
        "description": description,
        "price": price,
        "currency": currency,
        "url": url,
        "image_url": image_url[:2000] if image_url else "",
        "category": category,
        "category_path": category_path[:10],
        "brand": brand[:200],
        "is_active": True,
        "in_stock": "OutOfStock" not in availability,
        "country_code": "US",
        "region": "us",
        "metadata": metadata,
    }]


def parse_sitemap_xml(xml_content: str) -> list[str]:
    """Parse sitemap XML and return URLs (both direct urls and sub-sitemap urls)."""
    urls: list[str] = []
    try:
        root = ET.fromstring(xml_content)
    except ET.ParseError:
        return urls

    for ns_uri in (NS["sm"], NS_ALT):
        for el in root.iter(f"{{{ns_uri}}}url"):
            loc = el.find(f"{{{ns_uri}}}loc")
            if loc is not None and loc.text:
                urls.append(loc.text.strip())
        for el in root.iter(f"{{{ns_uri}}}sitemap"):
            loc = el.find(f"{{{ns_uri}}}loc")
            if loc is not None and loc.text:
                urls.append(loc.text.strip())

    if not urls:
        for el in root.iter("url"):
            loc = el.find("loc")
            if loc is not None and loc.text:
                urls.append(loc.text.strip())
        for el in root.iter("sitemap"):
            loc = el.find("loc")
            if loc is not None and loc.text:
                urls.append(loc.text.strip())

    return list(dict.fromkeys(urls))


class SuperiorLightingScraper:
    def __init__(
        self,
        api_key: str | None = None,
        api_base: str = "http://localhost:8000",
        batch_size: int = 100,
        delay: float = 0.0,
        scrape_only: bool = False,
        limit: int = 0,
        max_concurrency: int = 12,
    ):
        self.api_key = api_key
        self.api_base = api_base.rstrip("/")
        self.batch_size = batch_size
        self.delay = delay
        self.scrape_only = scrape_only
        self.limit = limit
        self.max_concurrency = max_concurrency

        self.output_dir = OUTPUT_DIR
        self.output_dir.mkdir(parents=True, exist_ok=True)

        session_start = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
        self.products_file = self.output_dir / f"products_{session_start}.jsonl"
        self.dead_letter_file = self.output_dir / f"dead_letters_{session_start}.jsonl"
        self.checkpoint_file = self.output_dir / "checkpoint.json"

        self.semaphore = asyncio.Semaphore(max_concurrency)
        self.write_lock = asyncio.Lock()

        self.total_scraped = 0
        self.total_ingested = 0
        self.total_failed = 0
        self.seen_skus: set[str] = set()
        self.checkpoint_interval = 500
        self._load_checkpoint()

    def _load_checkpoint(self) -> None:
        try:
            if self.checkpoint_file.exists():
                data = json.loads(self.checkpoint_file.read_text())
                self.seen_skus = set(data.get("seen_skus", []))
                self.total_scraped = data.get("total_scraped", 0)
                self.total_ingested = data.get("total_ingested", 0)
                self.total_failed = data.get("total_failed", 0)
                print(f"Loaded checkpoint: {len(self.seen_skus)} seen SKUs, {self.total_scraped} scraped")
        except Exception as e:
            print(f"WARN: Failed to load checkpoint: {e}")

    def _save_checkpoint(self) -> None:
        try:
            data = {
                "seen_skus": list(self.seen_skus),
                "total_scraped": self.total_scraped,
                "total_ingested": self.total_ingested,
                "total_failed": self.total_failed,
            }
            self.checkpoint_file.write_text(json.dumps(data))
        except Exception as e:
            print(f"WARN: Failed to save checkpoint: {e}")

    async def fetch_product_sitemaps(self) -> list[str]:
        """Fetch /xmlsitemap.php index and extract product sitemap URLs."""
        sitemaps: list[str] = []
        try:
            async with httpx.AsyncClient(timeout=30.0, headers=HEADERS, follow_redirects=True) as client:
                resp = await client.get(SITEMAP_INDEX_URL)
                resp.raise_for_status()
                entries = parse_sitemap_xml(resp.text)
                for entry in entries:
                    if "sitemap" in entry.lower() and "products" in entry.lower():
                        sitemaps.append(entry)
        except Exception as e:
            print(f"ERROR: Failed to fetch sitemap index: {e}", file=sys.stderr)
        return sitemaps

    async def extract_urls_from_sitemap(self, sitemap_url: str, client: httpx.AsyncClient) -> list[str]:
        """Extract product URLs from a single sitemap page."""
        urls: list[str] = []
        try:
            resp = await client.get(sitemap_url, timeout=60.0)
            resp.raise_for_status()
            entries = parse_sitemap_xml(resp.text)
            for entry in entries:
                if "sitemap" not in entry.lower() and entry.startswith("https://www.superiorlighting.com/"):
                    urls.append(entry)
        except Exception as e:
            print(f"WARN: Failed to parse sitemap {sitemap_url}: {e}", file=sys.stderr)
        return urls

    async def scrape_product_page(self, url: str, client: httpx.AsyncClient) -> list[dict]:
        async with self.semaphore:
            for attempt in range(3):
                try:
                    resp = await client.get(url, timeout=30.0)
                    if resp.status_code == 200:
                        return extract_products_from_html(resp.text, url)
                    elif resp.status_code == 429:
                        wait = 5 * (2 ** attempt)
                        print(f"  429 on {url}, waiting {wait}s...", file=sys.stderr)
                        await asyncio.sleep(wait)
                        continue
                    else:
                        return []
                except Exception as e:
                    if attempt < 2:
                        await asyncio.sleep(2 ** attempt)
                    else:
                        self._write_dead_letter(url, f"Request failed after 3 attempts: {e}")
            return []

    def _write_dead_letter(self, url: str, reason: str) -> None:
        entry = {
            "url": url,
            "reason": reason,
            "merchant": MERCHANT_ID,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
        try:
            with open(self.dead_letter_file, "a") as f:
                f.write(json.dumps(entry) + "\n")
        except Exception:
            pass

    async def ingest_batch(self, products: list[dict]) -> tuple[int, int, int]:
        if not products:
            return 0, 0, 0

        if self.scrape_only:
            async with self.write_lock:
                with open(self.products_file, "a") as f:
                    for p in products:
                        f.write(json.dumps(p, ensure_ascii=False) + "\n")
            return len(products), 0, 0

        url = f"{self.api_base}/v1/ingest/products"
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }
        payload = {"source": SOURCE, "products": products}

        for attempt in range(3):
            try:
                async with httpx.AsyncClient(timeout=120.0) as client:
                    resp = await client.post(url, json=payload, headers=headers)
                    if resp.status_code == 200:
                        result = resp.json()
                        inserted = result.get("rows_inserted", 0)
                        updated = result.get("rows_updated", 0)
                        failed = result.get("rows_failed", 0)
                        return inserted, updated, failed
                    elif resp.status_code == 429:
                        await asyncio.sleep(2 ** attempt * 5)
                    else:
                        if attempt < 2:
                            await asyncio.sleep(2)
            except Exception as e:
                if attempt < 2:
                    await asyncio.sleep(2)
                else:
                    print(f"ERROR: Ingestion failed after 3 attempts: {e}", file=sys.stderr)
        return 0, 0, len(products)

    async def run(self) -> dict[str, Any]:
        start = time.time()

        print("=== Superior Lighting US Sitemap Scraper ===")
        print(f"Mode: {'scrape only' if self.scrape_only else 'ingest to API'}")
        print(f"Batch size: {self.batch_size}, Delay: {self.delay}s, Concurrency: {self.max_concurrency}")

        async with httpx.AsyncClient(timeout=30.0, headers=HEADERS, follow_redirects=True) as client:
            print("Phase 1: Fetching sitemap index...")
            product_sitemaps = await self.fetch_product_sitemaps()
            print(f"Found {len(product_sitemaps)} product sitemaps")

            if not product_sitemaps:
                return {"error": "No product sitemaps found"}

            print("Phase 2: Extracting product URLs from sitemaps...")
            all_urls: list[str] = []
            for sm_url in sorted(product_sitemaps):
                urls = await self.extract_urls_from_sitemap(sm_url, client)
                print(f"  {sm_url}: {len(urls)} product URLs")
                all_urls.extend(urls)

            if self.limit > 0:
                all_urls = all_urls[:self.limit]

            print(f"Total product URLs: {len(all_urls)}")

            print(f"Phase 3: Scraping {len(all_urls)} product pages...")
            batch: list[dict] = []

            async def process_url(url: str) -> tuple[list[dict], int]:
                idx = all_urls.index(url)
                products = await self.scrape_product_page(url, client)
                return products, idx

            tasks = [process_url(url) for url in all_urls]
            for i, coro in enumerate(asyncio.as_completed(tasks)):
                products, idx = await coro
                for product in products:
                    sku = product["sku"]
                    if sku and sku not in self.seen_skus:
                        self.seen_skus.add(sku)
                        batch.append(product)
                        self.total_scraped += 1

                        if len(batch) >= self.batch_size:
                            inserted, updated, failed = await self.ingest_batch(batch)
                            self.total_ingested += inserted + updated
                            self.total_failed += failed
                            batch = []
                            self._save_checkpoint()

                if (i + 1) % 500 == 0:
                    elapsed = time.time() - start
                    rate = (i + 1) / elapsed if elapsed > 0 else 0
                    print(f"  Progress: {i+1}/{len(all_urls)} ({(i+1)*100/len(all_urls):.1f}%) — "
                          f"{self.total_scraped} scraped, {self.total_ingested} ingested, {rate:.1f} req/s")
                    self._save_checkpoint()

        if batch:
            inserted, updated, failed = await self.ingest_batch(batch)
            self.total_ingested += inserted + updated
            self.total_failed += failed

        self._save_checkpoint()

        elapsed = time.time() - start
        summary = {
            "merchant": "Superior Lighting",
            "domain": "superiorlighting.com",
            "platform": "bigcommerce_catalyst",
            "extraction_method": "jsonld_product",
            "sitemaps_found": len(product_sitemaps),
            "urls_collected": len(all_urls),
            "products_scraped": self.total_scraped,
            "products_ingested": self.total_ingested,
            "products_failed": self.total_failed,
            "unique_skus": len(self.seen_skus),
            "elapsed_seconds": round(elapsed, 1),
            "products_file": str(self.products_file) if self.scrape_only else None,
            "dead_letter_file": str(self.dead_letter_file),
        }

        print(f"\n=== Scraper Complete ===")
        print(json.dumps(summary, indent=2, ensure_ascii=False))
        return summary


def main():
    parser = argparse.ArgumentParser(description="Superior Lighting US sitemap scraper")
    parser.add_argument("--api-key", help="BuyWhere API key")
    parser.add_argument("--api-base", default="http://localhost:8000")
    parser.add_argument("--batch-size", type=int, default=100)
    parser.add_argument("--delay", type=float, default=0.0)
    parser.add_argument("--scrape-only", action="store_true")
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--max-concurrency", type=int, default=12)
    args = parser.parse_args()

    if not args.scrape_only and not args.api_key:
        parser.error("--api-key is required unless --scrape-only is used")

    scraper = SuperiorLightingScraper(
        api_key=args.api_key,
        api_base=args.api_base,
        batch_size=args.batch_size,
        delay=args.delay,
        scrape_only=args.scrape_only,
        limit=args.limit,
        max_concurrency=args.max_concurrency,
    )

    asyncio.run(scraper.run())


if __name__ == "__main__":
    main()