"""
Guardian Singapore product scraper using Magento REST API via BrightData proxy.

Uses Guardian's Magento REST API directly to discover and scrape all products.
Much more efficient than HTML scraping — paginates through the product catalog
at 100 products per request.

Target: ~32,000 products from Guardian Singapore
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

from scrapers.scraper_logging import get_logger
from scrapers.scraper_registry import register

MERCHANT_ID = "guardian_sg"
SOURCE = "guardian_sg"
BASE_URL = "https://www.guardian.com.sg"
API_BASE = f"{BASE_URL}/rest/V1"
OUTPUT_DIR = "/home/paperclip/buywhere-api/data/guardian_sg"

PAGE_SIZE = 100

BROWSER_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
    "Accept": "application/json",
}


def _build_proxy_url() -> str:
    username = os.environ.get("BRIGHTDATA_USERNAME", "brd-customer-hl_3ab737be-zone-residential")
    password = os.environ.get("BRIGHTDATA_PASSWORD", "o3feuq72olm5")
    host = os.environ.get("BRIGHTDATA_PROXY_HOST", "brd.superproxy.io")
    port = os.environ.get("BRIGHTDATA_PROXY_PORT", "33335")
    encoded_user = urllib.parse.quote(username, safe="")
    encoded_pass = urllib.parse.quote(password, safe="")
    return f"http://{encoded_user}:{encoded_pass}@{host}:{port}"


def _get_custom_attr(custom_attributes: list[dict], code: str) -> str:
    for attr in custom_attributes:
        if attr.get("attribute_code") == code:
            val = attr.get("value", "")
            if isinstance(val, list):
                return val[0] if val else ""
            return str(val)
    return ""


def _extract_brand_id(custom_attributes: list[dict]) -> str:
    for attr in custom_attributes:
        if attr.get("attribute_code") == "brands":
            return str(attr.get("value", ""))
    return ""


def _extract_brand_by_title(name: str) -> str:
    known_brands = [
        "3M", "ACO", "ACTAL", "AMMELTZ", "AVENE", "AXE BRAND",
        "BANANA BOAT", "BAUSCH & LOMB", "BAYER", "BELLAMY'S",
        "BEROCCA", "BETADINE", "BIODERMA", "BIORE", "CETAPHIL",
        "CLEAR", "COLGATE", "COMFORT", "DARLIE", "DETTOL",
        "DOVE", "DULCOLAX", "DUREX", "ELGYDIUM", "ELMEX", "EUCERIN",
        "FISHERMAN'S FRIEND", "FLEXAMIN", "FOSTER GRANT",
        "GARNIER", "GATSBY", "GILLETTE", "GUARDIAN", "HADA LABO",
        "HEAD & SHOULDERS", "HEALTHY MATE", "HUGGIES", "ICM",
        "IROHA", "ISDIN", "JERGENS", "JOHNSON'S", "JOHNSON'S BABY",
        "KOTEX", "LA ROCHE-POSAY", "LACTACYD", "LANEIGE",
        "LAURIER", "LIFEBUOY", "LISTERINE", "L'OREAL", "LUX",
        "MAYBELLINE", "MENTHOLATUM", "MERIDOL", "MUSTELA",
        "NATURE'S WAY", "NEILMED", "NEUTROGENA", "NICORETTE",
        "NIN JIOM", "NIVEA", "NORIT", "NUROFEN", "OLAY",
        "ORAL-B", "PAMPERS", "PANADOL", "PANTENE", "PEDIALYTE",
        "PIGEON", "PRO-GUT", "REDOXON", "RENNIE", "SAMBUCAL",
        "SATO", "SENSODYNE", "SIMILAC", "SIMPLE", "SKINCEUTICALS",
        "SMITH & NEPHEW", "SOLPADEINE", "SOMA", "STREPSILS",
        "SUDOCREM", "TENA", "TENGA", "TIGER BALM", "VASELINE",
        "VICHY", "VICKS", "VOLTAREN", "WELLA",
    ]
    name_upper = name.upper()
    for b in known_brands:
        if b in name_upper:
            return b
    return ""


@register("guardian_sg")
class GuardianSGScraper:
    def __init__(
        self,
        api_key: str | None = None,
        api_base: str = "http://localhost:8000",
        batch_size: int = 100,
        delay: float = 0.5,
        limit: int = 0,
        scrape_only: bool = False,
        data_dir: str | None = None,
        target_products: int = 0,
    ):
        self.api_key = api_key
        self.api_base = api_base.rstrip("/")
        self.batch_size = batch_size
        self.delay = delay
        self.limit = limit
        self.scrape_only = scrape_only
        self.data_dir = data_dir or OUTPUT_DIR
        self.target_products = target_products
        self._proxy_url = _build_proxy_url()
        self._http_client: httpx.AsyncClient | None = None
        self._session_start = time.strftime("%Y%m%d_%H%M%S")
        self._products_outfile = f"{self.data_dir}/guardian_sg_{self._session_start}.ndjson"
        self.total_scraped = 0
        self.total_ingested = 0
        self.total_updated = 0
        self.total_failed = 0
        self.seen_skus: set[str] = set()
        self.log = get_logger(MERCHANT_ID)
        self._brand_cache: dict[str, str] = {}

    async def _get_client(self) -> httpx.AsyncClient:
        if self._http_client is None:
            self._http_client = httpx.AsyncClient(
                timeout=30.0,
                proxy=self._proxy_url,
                verify=False,
                follow_redirects=True,
            )
        return self._http_client

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

    def _transform_product(self, item: dict) -> dict[str, Any] | None:
        sku = item.get("sku", "")
        name = item.get("name", "")
        price = item.get("price", 0.0)
        visibility = item.get("visibility", 1)
        status = item.get("status", 1)

        if status != 1 or visibility <= 1:
            return None

        if not sku or not price or float(price) <= 0:
            return None
        if not name:
            return None

        custom_attributes = item.get("custom_attributes", [])

        # Extract description
        description = _get_custom_attr(custom_attributes, "description")
        description = re.sub(r"<[^>]+>", "", description).strip()
        if len(description) > 2000:
            description = description[:2000]

        # Extract URL key
        url_key = _get_custom_attr(custom_attributes, "url_key")
        product_url = f"{BASE_URL}/{url_key}.html" if url_key else f"{BASE_URL}/catalog/product/view/id/{sku}"

        # Extract image
        image_url = ""
        media_gallery = item.get("media_gallery_entries", [])
        if media_gallery:
            first = media_gallery[0]
            img_file = first.get("file", "")
            if img_file:
                image_url = f"{BASE_URL}/media/catalog/product{img_file}"
        if not image_url:
            img_attr = _get_custom_attr(custom_attributes, "image")
            if img_attr and img_attr != "no_selection":
                image_url = f"{BASE_URL}/media/catalog/product{img_attr}"

        # Extract brand
        brand_id = _extract_brand_id(custom_attributes)
        brand = self._brand_cache.get(brand_id, "")
        if not brand:
            brand = _extract_brand_by_title(name)

        # Extract category path
        category_path = ["Guardian"]

        category = category_path[-1].lower().replace(" ", "-") if len(category_path) > 1 else "guardian"

        return {
            "sku": sku,
            "merchant_id": MERCHANT_ID,
            "title": name,
            "description": description,
            "price": float(price),
            "currency": "SGD",
            "url": product_url,
            "image_url": image_url,
            "category": category,
            "category_path": category_path,
            "brand": brand,
            "is_active": True,
            "in_stock": True,
            "metadata": {"source": SOURCE},
        }

    async def _fetch_page(self, page: int) -> list[dict[str, Any]]:
        client = await self._get_client()
        url = f"{API_BASE}/products?searchCriteria[pageSize]={PAGE_SIZE}&searchCriteria[currentPage]={page}"
        try:
            resp = await client.get(url, headers=BROWSER_HEADERS)
            if resp.status_code == 200:
                data = resp.json()
                items = data.get("items", [])
                total = data.get("total_count", 0)
                return items, total
            else:
                print(f"  API page {page}: HTTP {resp.status_code}")
                return [], 0
        except Exception as e:
            print(f"  API page {page}: Error - {str(e)[:60]}")
            return [], 0

    async def _preload_brand_cache(self) -> None:
        client = httpx.AsyncClient(
            timeout=60.0,
            proxy=self._proxy_url,
            verify=False,
            follow_redirects=True,
        )
        try:
            url = f"{API_BASE}/categories?searchCriteria[pageSize]=5000"
            resp = await client.get(url, headers=BROWSER_HEADERS)
            if resp.status_code == 200:
                data = resp.json()
                def _walk(items: list[dict]) -> None:
                    for item in items:
                        cid = str(item.get("id", ""))
                        level = item.get("level", 0)
                        name = item.get("name", "")
                        if cid and level >= 2 and name:
                            self._brand_cache[cid] = name.upper()
                        children = item.get("children_data", [])
                        if children:
                            _walk(children)
                _walk(data.get("children_data", []))
                print(f"  Pre-loaded {len(self._brand_cache)} brand/category names")
        except Exception as e:
            print(f"  Brand cache preload error: {type(e).__name__}: {e}")
        finally:
            await client.aclose()

    @classmethod
    def add_cli_args(cls, parser: argparse.ArgumentParser) -> None:
        parser.add_argument("--api-key", required=False)
        parser.add_argument("--api-base", default="http://localhost:8000")
        parser.add_argument("--batch-size", type=int, default=100)
        parser.add_argument("--delay", type=float, default=0.5)
        parser.add_argument("--limit", type=int, default=0)
        parser.add_argument("--target", type=int, default=0)
        parser.add_argument("--scrape-only", action="store_true")
        parser.add_argument("--data-dir", default=None)

    @classmethod
    def from_args(cls, args: argparse.Namespace) -> "GuardianSGScraper":
        return cls(
            api_key=args.api_key,
            api_base=args.api_base,
            batch_size=args.batch_size,
            delay=args.delay,
            limit=args.limit,
            target_products=args.target,
            scrape_only=args.scrape_only,
            data_dir=args.data_dir,
        )

    async def run(self) -> dict[str, Any]:
        print("=" * 60)
        print("Guardian SG REST API Scraper")
        print("=" * 60)
        print(f"Mode: {'scrape-only' if self.scrape_only else 'scrape + ingest'}")
        print(f"Batch size: {self.batch_size}, Delay: {self.delay}s")
        print(f"Output file: {self._products_outfile}")
        print("=" * 60)

        os.makedirs(self.data_dir, exist_ok=True)

        start = time.time()

        # Step 1: Pre-load brand/category cache
        print("\n[1/4] Pre-loading brand name cache...")
        await self._preload_brand_cache()

        # Step 2: Fetch first page to get total count
        print("\n[2/4] Discovering product catalog size...")
        first_items, total_products = await self._fetch_page(1)
        if total_products == 0:
            print("ERROR: Could not fetch product catalog.")
            return {"error": "No products found via REST API"}

        total_pages = (total_products + PAGE_SIZE - 1) // PAGE_SIZE
        print(f"  Total products: {total_products:,} across {total_pages} pages")

        # Step 3: Scrape all pages
        print(f"\n[3/4] Scraping products...")
        batch: list[dict] = []
        counts = {"scraped": 0, "ingested": 0, "updated": 0, "failed": 0}

        def _should_stop() -> bool:
            if self.limit > 0 and self.total_scraped >= self.limit:
                return True
            if self.target_products > 0 and self.total_scraped >= self.target_products:
                return True
            return False

        # Process first page items already fetched
        for item in first_items:
            if _should_stop():
                break
            product = self._transform_product(item)
            if product:
                batch.append(product)
                counts["scraped"] += 1
                self.total_scraped += 1

        if batch:
            i_count, u_count, f_count = await self._ingest_batch(batch)
            counts["ingested"] += i_count
            counts["updated"] += u_count
            counts["failed"] += f_count
            self.total_ingested += i_count
            self.total_updated += u_count
            self.total_failed += f_count
            batch = []

        # Process remaining pages
        for page in range(2, total_pages + 1):
            if _should_stop():
                break

            if page % 10 == 0:
                print(f"  Page {page}/{total_pages}, scraped={self.total_scraped}")

            items, _ = await self._fetch_page(page)
            if not items:
                continue

            page_batch: list[dict] = []
            for item in items:
                if _should_stop():
                    break
                product = self._transform_product(item)
                if product:
                    page_batch.append(product)
                    counts["scraped"] += 1
                    self.total_scraped += 1

            if page_batch:
                i_count, u_count, f_count = await self._ingest_batch(page_batch)
                counts["ingested"] += i_count
                counts["updated"] += u_count
                counts["failed"] += f_count
                self.total_ingested += i_count
                self.total_updated += u_count
                self.total_failed += f_count

            await asyncio.sleep(self.delay)

        elapsed = time.time() - start

        summary: dict[str, Any] = {
            "elapsed_seconds": round(elapsed, 1),
            "total_products_in_catalog": total_products,
            "total_scraped": self.total_scraped,
            "total_ingested": self.total_ingested,
            "total_updated": self.total_updated,
            "total_failed": self.total_failed,
            "output_file": self._products_outfile,
        }

        print(f"\n[4/4] Complete")
        print("\n" + "=" * 60)
        print(f"Scraper complete: {json.dumps(summary, indent=2)}")
        print("=" * 60)
        return summary


async def main():
    parser = argparse.ArgumentParser(description="Guardian SG REST API Scraper")
    GuardianSGScraper.add_cli_args(parser)
    args = parser.parse_args()

    if not args.scrape_only and not args.api_key:
        parser.error("--api-key is required unless --scrape-only is specified")

    scraper = GuardianSGScraper.from_args(args)

    try:
        await scraper.run()
    except KeyboardInterrupt:
        print("Interrupted")
    finally:
        await scraper.close()


if __name__ == "__main__":
    asyncio.run(main())
