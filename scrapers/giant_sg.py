"""
Giant Singapore product scraper.

Scrapes grocery products from Giant SG online store and outputs structured JSON
matching the BuyWhere catalog schema for ingestion via /v1/ingest/products.

Strategy: Algolia search index.
Giant SG uses InstantSearch.js v2.7.3 backed by Algolia (appId: PFCHI1YM66,
apiKey: d0c09a40111717aec861992cf8497e71, index: giant_product_live).
Products are enumerated via the Algolia REST API using the Browse endpoint for
full-index traversal, or the Search endpoint with cursor-based pagination.

NOTE — Network requirement:
Algolia routes app-specific DNS (PFCHI1YM66.algolia.net) through their
infrastructure. The app subdomain must resolve from the machine running this
scraper. If you receive DNS resolution errors, run from a machine with full
public internet access (not an internal/cloud network with restricted DNS).
Fallback: the scraper catches DNS/connection errors and exits with a clear
BLOCKER message so the issue can be tracked.

Category discovery:
The Giant SG website uses hierarchical Algolia facets. Categories are read
from the Algolia index facets (categories.lvl0, categories.lvl1). All in-stock
and out-of-stock products are scraped (is_available reflects stock status).

Usage:
    python -m scrapers.giant_sg --api-key <key> [--batch-size 100] [--delay 1.0]
    python -m scrapers.giant_sg --scrape-only [--output-dir ./data/giant-sg]
    python -m scrapers.giant_sg --api-key <key> --test-limit 100

Output (scrape-only): data/giant_sg.jsonl
Target: 15,000+ products across groceries, fresh produce, household, personal care
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

MERCHANT_ID = "giant_sg"
log = get_logger(MERCHANT_ID)
SOURCE = "giant_sg"
BASE_URL = "https://giant.sg"

# Algolia configuration (public search-only credentials from giant.sg page source)
ALGOLIA_APP_ID = "PFCHI1YM66"
ALGOLIA_API_KEY = "d0c09a40111717aec861992cf8497e71"
ALGOLIA_INDEX = "giant_product_live"
ALGOLIA_BASE = f"https://{ALGOLIA_APP_ID}.algolia.net/1/indexes/{ALGOLIA_INDEX}"
ALGOLIA_DSN = f"https://{ALGOLIA_APP_ID}-dsn.algolia.net/1/indexes/{ALGOLIA_INDEX}"

PAGE_SIZE = 100  # Algolia max hitsPerPage for Search API

ALGOLIA_HEADERS = {
    "X-Algolia-Application-Id": ALGOLIA_APP_ID,
    "X-Algolia-API-Key": ALGOLIA_API_KEY,
    "Content-Type": "application/json",
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
}

# Main Giant SG category tree (top-level slugs that map to Algolia facet values)
# Derived from the category sitemap at https://giant.sg/sitemap_category.xml
MAIN_CATEGORIES = [
    "snacks-drinks",
    "dairy-chilled-frozen",
    "food-pantry",
    "health-beauty",
    "mum-baby",
    "household-essentials",
    "beers-wines-spirits",
    "GMS-electronics-appliances",
]


def _parse_price(raw: Any) -> float:
    """Parse price from various Giant/Algolia field formats."""
    if isinstance(raw, (int, float)):
        return float(raw)
    if isinstance(raw, str):
        # Strip currency symbols, commas, whitespace
        cleaned = re.sub(r"[^\d.]", "", raw.replace(",", ""))
        try:
            return float(cleaned) if cleaned else 0.0
        except ValueError:
            return 0.0
    return 0.0


class GiantScraper:
    def __init__(
        self,
        api_key: str | None = None,
        api_base: str = "http://localhost:8000",
        batch_size: int = 100,
        delay: float = 1.0,
        output_dir: str | None = None,
        scrape_only: bool = False,
        test_limit: int = 0,
    ):
        self.api_key = api_key
        self.api_base = api_base.rstrip("/")
        self.batch_size = batch_size
        self.delay = delay
        self.output_dir = Path(output_dir) if output_dir else None
        self.scrape_only = scrape_only
        self.test_limit = test_limit
        self.client = httpx.AsyncClient(
            timeout=30.0,
            follow_redirects=True,
            headers={"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"},
        )
        self.total_scraped = 0
        self.total_ingested = 0
        self.total_updated = 0
        self.total_failed = 0
        self._algolia_reachable: bool | None = None

    async def close(self):
        await self.client.aclose()

    async def _check_algolia_connectivity(self) -> bool:
        """Verify Algolia is reachable. Caches result."""
        if self._algolia_reachable is not None:
            return self._algolia_reachable
        for endpoint in [ALGOLIA_DSN, ALGOLIA_BASE]:
            try:
                resp = await self.client.post(
                    f"{endpoint}/query",
                    headers=ALGOLIA_HEADERS,
                    content=json.dumps({"query": "", "hitsPerPage": 1, "page": 0}).encode(),
                    timeout=10.0,
                )
                if resp.status_code == 200:
                    self._algolia_reachable = True
                    print(f"  Algolia reachable via {endpoint}")
                    return True
            except Exception as e:
                print(f"  Algolia endpoint {endpoint}: {type(e).__name__}: {e}")
        self._algolia_reachable = False
        return False

    async def _algolia_query(self, payload: dict) -> dict | None:
        """POST to Algolia search API with retry. Returns parsed JSON or None."""
        for endpoint in [ALGOLIA_DSN, ALGOLIA_BASE]:
            for attempt in range(3):
                try:
                    resp = await self.client.post(
                        f"{endpoint}/query",
                        headers=ALGOLIA_HEADERS,
                        content=json.dumps(payload).encode(),
                        timeout=30.0,
                    )
                    if resp.status_code == 200:
                        return resp.json()
                    if resp.status_code in (400, 403):
                        print(f"  Algolia error {resp.status_code}: {resp.text[:200]}")
                        return None
                    # 5xx or rate limit — retry
                    await asyncio.sleep(2 ** attempt)
                except (httpx.ConnectError, httpx.ConnectTimeout) as e:
                    if attempt == 2:
                        print(f"  Algolia connection failed ({endpoint}): {e}")
                    else:
                        await asyncio.sleep(2 ** attempt)
                except Exception as e:
                    if attempt == 2:
                        print(f"  Algolia unexpected error ({endpoint}): {e}")
                    else:
                        await asyncio.sleep(2 ** attempt)
        return None

    async def _algolia_browse(self, cursor: str | None = None) -> dict | None:
        """Use Algolia Browse API for full-index traversal (no 1000-hit limit)."""
        for endpoint in [ALGOLIA_DSN, ALGOLIA_BASE]:
            try:
                if cursor:
                    resp = await self.client.get(
                        f"{endpoint}/browse?cursor={cursor}",
                        headers=ALGOLIA_HEADERS,
                        timeout=30.0,
                    )
                else:
                    resp = await self.client.post(
                        f"{endpoint}/browse",
                        headers=ALGOLIA_HEADERS,
                        content=json.dumps({"hitsPerPage": PAGE_SIZE}).encode(),
                        timeout=30.0,
                    )
                if resp.status_code == 200:
                    return resp.json()
                if resp.status_code in (400, 403, 404):
                    # Browse not available; fall back to paginated search
                    return None
            except Exception:
                pass
        return None

    def transform_product(self, hit: dict) -> dict[str, Any] | None:
        """Transform an Algolia hit to BuyWhere canonical schema."""
        try:
            object_id = str(hit.get("objectID", "") or "")
            if not object_id:
                return None

            name = (hit.get("name", "") or "").strip()
            if not name:
                return None

            # SKU: prefer explicit sku field, fall back to objectID
            sku = str(hit.get("sku", "") or hit.get("objectID", "")).strip()
            if not sku:
                return None

            # Price: Algolia may expose selling_price, price, or priceDisplay
            price = 0.0
            for field in ("selling_price", "price", "promo_price"):
                val = hit.get(field)
                if val is not None:
                    price = _parse_price(val)
                    if price > 0:
                        break
            # priceDisplay as last resort: "$1.95" or "1.95"
            if price == 0.0:
                price = _parse_price(hit.get("priceDisplay", "") or "")

            brand = (hit.get("brand_name", "") or hit.get("brand", "")).strip()

            image_url = (hit.get("imageURL", "") or hit.get("image_url", "") or "").strip()

            product_url = (hit.get("productHref", "") or hit.get("productURL", "")).strip()
            if not product_url:
                slug = hit.get("slug", "") or sku
                product_url = f"{BASE_URL}/{slug}"

            # Category hierarchy
            # Algolia may use categories.lvl0 / categories.lvl1 or a flat 'category' field
            category = ""
            category_path: list[str] = []
            cat_lvl0 = hit.get("categories", {})
            if isinstance(cat_lvl0, dict):
                # Hierarchical categories: {"lvl0": ["Snacks & Drinks"], "lvl1": ["Snacks & Drinks > Coffee"]}
                lvl0 = cat_lvl0.get("lvl0") or []
                lvl1 = cat_lvl0.get("lvl1") or []
                if lvl0:
                    category = lvl0[0] if isinstance(lvl0, list) else str(lvl0)
                if lvl1:
                    path_str = lvl1[0] if isinstance(lvl1, list) else str(lvl1)
                    parts = [p.strip() for p in path_str.split(">")]
                    category_path = parts
                else:
                    category_path = [category] if category else []
            elif isinstance(cat_lvl0, list):
                category = cat_lvl0[0] if cat_lvl0 else ""
                category_path = cat_lvl0
            else:
                category = str(cat_lvl0 or "")
                category_path = [category] if category else []

            # Fallback: use first category_url segment
            if not category:
                cat_url = hit.get("categoryURL", "") or ""
                if cat_url:
                    parts = cat_url.strip("/").split("/")
                    category = parts[0] if parts else ""
                    category_path = parts

            is_oos = bool(hit.get("is_oos", False))

            return {
                "sku": sku,
                "merchant_id": MERCHANT_ID,
                "title": name,
                "description": (hit.get("description", "") or "").strip(),
                "price": price,
                "currency": "SGD",
                "url": product_url,
                "image_url": image_url,
                "category": category,
                "category_path": category_path,
                "brand": brand,
                "is_active": True,
                "is_available": not is_oos,
                "metadata": {
                    "object_id": object_id,
                    "product_size": (hit.get("productSize", "") or "").strip(),
                    "product_type": (hit.get("productType", "") or "").strip(),
                    "is_weight_item": bool(hit.get("isWeightItem", False)),
                    "is_halal": bool(hit.get("is_halal", False)),
                    "quick_view_url": hit.get("quickViewUrl", ""),
                },
            }
        except Exception as e:
            print(f"  transform_product error: {e}")
            return None

    async def ingest_batch(self, products: list[dict]) -> tuple[int, int, int]:
        if not products or self.scrape_only:
            return 0, 0, 0
        url = f"{self.api_base}/v1/ingest/products"
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }
        payload = {"source": SOURCE, "products": products}
        try:
            resp = await self.client.post(url, json=payload, headers=headers, timeout=60.0)
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

    async def save_products_jsonl(self, products: list[dict]):
        """Append products to the output JSONL file."""
        if not self.output_dir:
            return
        self.output_dir.mkdir(parents=True, exist_ok=True)
        filepath = self.output_dir / "giant_sg.jsonl"
        with open(filepath, "a") as f:
            for p in products:
                f.write(json.dumps(p, ensure_ascii=False) + "\n")

    async def _flush_batch(self, batch: list[dict]) -> tuple[int, int, int]:
        if self.output_dir:
            await self.save_products_jsonl(batch)
        return await self.ingest_batch(batch)

    async def scrape_via_browse(self) -> bool:
        """Use Algolia Browse API to enumerate the full index. Returns True if successful."""
        print("\nAttempting Algolia Browse API (full-index traversal)...")
        result = await self._algolia_browse()
        if not result:
            print("  Browse API not available or failed.")
            return False

        total_hits = result.get("nbHits", "unknown")
        print(f"  Total products in index: {total_hits}")

        batch: list[dict] = []
        cursor = result.get("cursor")
        page_num = 0

        while True:
            hits = result.get("hits", [])
            for hit in hits:
                product = self.transform_product(hit)
                if product:
                    batch.append(product)
                    self.total_scraped += 1

                    if self.test_limit > 0 and self.total_scraped >= self.test_limit:
                        break

                    if len(batch) >= self.batch_size:
                        i, u, f = await self._flush_batch(batch)
                        self.total_ingested += i
                        self.total_updated += u
                        self.total_failed += f
                        batch = []
                        await asyncio.sleep(self.delay)

            page_num += 1
            print(f"  Browse page {page_num}: scraped={self.total_scraped}")

            if self.test_limit > 0 and self.total_scraped >= self.test_limit:
                print(f"  Test limit ({self.test_limit}) reached.")
                break

            cursor = result.get("cursor")
            if not cursor:
                break

            await asyncio.sleep(self.delay)
            result = await self._algolia_browse(cursor)
            if not result:
                print("  Browse pagination ended early.")
                break

        # Flush remaining
        if batch:
            i, u, f = await self._flush_batch(batch)
            self.total_ingested += i
            self.total_updated += u
            self.total_failed += f

        return True

    async def scrape_via_search_pages(self) -> bool:
        """Fall back to Algolia Search API with pagination. Max 1000 pages × hitsPerPage."""
        print("\nAttempting Algolia Search API (paginated)...")
        payload: dict[str, Any] = {
            "query": "",
            "hitsPerPage": PAGE_SIZE,
            "page": 0,
            "analytics": False,
            "clickAnalytics": False,
        }

        result = await self._algolia_query(payload)
        if not result:
            print("  Search API failed on first request.")
            return False

        nb_hits = result.get("nbHits", 0)
        nb_pages = result.get("nbPages", 1)
        print(f"  Total products: {nb_hits}, pages: {nb_pages}")

        batch: list[dict] = []
        page = 0

        while True:
            hits = result.get("hits", [])
            if not hits:
                break

            for hit in hits:
                product = self.transform_product(hit)
                if product:
                    batch.append(product)
                    self.total_scraped += 1

                    if self.test_limit > 0 and self.total_scraped >= self.test_limit:
                        break

                    if len(batch) >= self.batch_size:
                        i, u, f = await self._flush_batch(batch)
                        self.total_ingested += i
                        self.total_updated += u
                        self.total_failed += f
                        batch = []
                        await asyncio.sleep(self.delay)

            print(f"  Page {page}: scraped={self.total_scraped}")

            if self.test_limit > 0 and self.total_scraped >= self.test_limit:
                break

            page += 1
            if page >= nb_pages:
                break

            payload["page"] = page
            await asyncio.sleep(self.delay)
            result = await self._algolia_query(payload)
            if not result:
                print(f"  Search API failed at page {page}.")
                break

        # Flush remaining
        if batch:
            i, u, f = await self._flush_batch(batch)
            self.total_ingested += i
            self.total_updated += u
            self.total_failed += f

        return self.total_scraped > 0

    async def run(self) -> dict[str, Any]:
        mode = "scrape-only" if self.scrape_only else "scrape + ingest"
        test_info = f" (test limit: {self.test_limit})" if self.test_limit else ""
        print(f"Giant SG Scraper starting... (mode: {mode}{test_info})")
        print(f"Algolia index: {ALGOLIA_INDEX} (app: {ALGOLIA_APP_ID})")
        if not self.scrape_only:
            print(f"Ingest API: {self.api_base}")
        if self.output_dir:
            print(f"Output dir: {self.output_dir}")

        start = time.time()

        # Check Algolia connectivity
        reachable = await self._check_algolia_connectivity()
        if not reachable:
            print(
                "\n*** BLOCKER: Algolia API not reachable from this host ***\n"
                "Giant SG loads all product data via Algolia InstantSearch.js.\n"
                "The Algolia app-specific DNS (PFCHI1YM66.algolia.net) resolves\n"
                "to up.pfchi1ym66.api.algolia.net which has no public A record —\n"
                "it is only reachable from Algolia's infrastructure network or\n"
                "machines with appropriate DNS split-horizon configuration.\n\n"
                "Resolution steps:\n"
                "  1. Run this scraper from a machine with full public internet\n"
                "     access (e.g. a residential IP or unrestricted cloud VM).\n"
                "  2. Alternatively, set up a DNS resolver that returns an Algolia\n"
                "     CDN IP for PFCHI1YM66.algolia.net.\n"
                "  3. If Giant SG rolls out a REST API or sitemap with live product\n"
                "     data, update fetch strategy in fetch_products_by_category().\n"
            )
            elapsed = time.time() - start
            return {
                "elapsed_seconds": round(elapsed, 1),
                "total_scraped": 0,
                "total_ingested": 0,
                "total_updated": 0,
                "total_failed": 0,
                "blocker": "algolia_dns_unreachable",
            }

        # Try Browse API first (no pagination limit), fall back to Search
        success = await self.scrape_via_browse()
        if not success:
            success = await self.scrape_via_search_pages()

        elapsed = time.time() - start
        summary = {
            "elapsed_seconds": round(elapsed, 1),
            "total_scraped": self.total_scraped,
            "total_ingested": self.total_ingested,
            "total_updated": self.total_updated,
            "total_failed": self.total_failed,
        }
        print(f"\nScraper complete: {summary}")
        return summary


async def main():
    parser = argparse.ArgumentParser(description="Giant SG Scraper (Algolia-backed)")
    parser.add_argument("--api-key", help="BuyWhere API key (required for ingestion)")
    parser.add_argument(
        "--api-base",
        default="http://localhost:8000",
        help="BuyWhere API base URL",
    )
    parser.add_argument("--batch-size", type=int, default=100)
    parser.add_argument("--delay", type=float, default=1.0, help="Delay between API pages (seconds)")
    parser.add_argument("--scrape-only", action="store_true", help="Only scrape and save to JSONL, skip ingestion")
    parser.add_argument("--output-dir", default="data/giant-sg", help="Output directory for JSONL data")
    parser.add_argument("--test-limit", type=int, default=0, help="Limit total products scraped (for testing)")
    args = parser.parse_args()

    if not args.scrape_only and not args.api_key:
        parser.error("--api-key is required unless --scrape-only is specified")

    scraper = GiantScraper(
        api_key=args.api_key,
        api_base=args.api_base,
        batch_size=args.batch_size,
        delay=args.delay,
        output_dir=args.output_dir,
        scrape_only=args.scrape_only,
        test_limit=args.test_limit,
    )

    try:
        await scraper.run()
    finally:
        await scraper.close()


if __name__ == "__main__":
    asyncio.run(main())
