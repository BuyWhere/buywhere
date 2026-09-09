"""Unity Singapore product scraper.

Unity is a pharmacy brand under NTUC FairPrice Group. Products are sold
through the FairPrice online platform. This scraper discovers Unity products
by scraping the Unity website for FairPrice product references and by
filtering FairPrice products sold by Unity.

Usage:
    python -m scrapers.unity_sg --api-key <key> [--batch-size 100] [--delay 0.5]
    python -m scrapers.unity_sg --scrape-only [--output-dir ./data/unity_sg]

Target: 500+ products
"""

import argparse
import asyncio
import json
import os
import re
import time
from pathlib import Path
from typing import Any

import httpx
from bs4 import BeautifulSoup

from scrapers.scraper_logging import get_logger

MERCHANT_ID = "unity_sg"
SOURCE = "unity_sg"
UNITY_BASE_URL = "https://www.unity.com.sg"
FAIRPRICE_API_BASE = "https://website-api.omni.fairprice.com.sg/api"
FAIRPRICE_BASE = "https://www.fairprice.com.sg"
DEFAULT_STORE_ID = 165
PAGE_SIZE = 20

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept": "application/json",
    "Accept-Language": "en-SG,en;q=0.9",
}

HTML_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-SG,en;q=0.9",
}

log = get_logger(MERCHANT_ID)


class UnitySGScraper:
    def __init__(
        self,
        api_key: str | None = None,
        api_base: str = "http://localhost:8000",
        batch_size: int = 100,
        delay: float = 0.5,
        output_dir: str | None = None,
        scrape_only: bool = False,
        target_products: int = 500,
    ):
        self.api_key = api_key
        self.api_base = api_base.rstrip("/")
        self.batch_size = batch_size
        self.delay = delay
        self.scrape_only = scrape_only
        self.target_products = target_products
        self.output_dir = Path(output_dir) if output_dir else Path("/home/paperclip/buywhere-api/data") / MERCHANT_ID
        self.output_dir.mkdir(parents=True, exist_ok=True)
        self.outfile = self.output_dir / f"products_{time.strftime('%Y%m%d_%H%M%S')}.jsonl"
        self.client = httpx.AsyncClient(timeout=30.0, headers=HEADERS, follow_redirects=True)
        self.html_client = httpx.AsyncClient(timeout=30.0, headers=HTML_HEADERS, follow_redirects=True)

        self.total_scraped = 0
        self.total_ingested = 0
        self.total_updated = 0
        self.total_failed = 0
        self.seen_skus: set[str] = set()

    async def close(self):
        await self.client.aclose()
        await self.html_client.aclose()

    async def _get_json(self, url: str, params: dict[str, Any] | None = None, retries: int = 3) -> dict[str, Any] | None:
        for attempt in range(retries):
            try:
                resp = await self.client.get(url, params=params)
                resp.raise_for_status()
                return resp.json()
            except Exception as exc:
                if attempt < retries - 1:
                    await asyncio.sleep(2 ** attempt)
                else:
                    log.request_failed(url, attempt, str(exc))
                    return None
        return None

    async def _get_html(self, url: str, retries: int = 3) -> str | None:
        for attempt in range(retries):
            try:
                resp = await self.html_client.get(url)
                resp.raise_for_status()
                return resp.text
            except Exception as exc:
                if attempt < retries - 1:
                    await asyncio.sleep(2 ** attempt)
                else:
                    log.request_failed(url, attempt, str(exc))
                    return None
        return None

    async def scrape_unity_website_urls(self) -> set[str]:
        product_slugs: set[str] = set()
        html = await self._get_html(UNITY_BASE_URL)
        if not html:
            log.progress("Could not fetch Unity homepage")
            return product_slugs

        fairprice_urls = re.findall(
            r'href=["\'](https?://(?:www\.)?fairprice\.com\.sg/product/([^"\']+))["\']',
            html
        )
        for _, slug in fairprice_urls:
            slug = slug.strip("/")
            if slug:
                product_slugs.add(slug)

        promos_html = await self._get_html(f"{UNITY_BASE_URL}/promotions/")
        if promos_html:
            promo_urls = re.findall(
                r'href=["\'](https?://(?:www\.)?fairprice\.com\.sg/product/([^"\']+))["\']',
                promos_html
            )
            for _, slug in promo_urls:
                slug = slug.strip("/")
                if slug:
                    product_slugs.add(slug)

        log.progress(f"Found {len(product_slugs)} product slugs from Unity website")
        return product_slugs

    async def scrape_fairprice_product_page(self, slug: str) -> dict[str, Any] | None:
        url = f"{FAIRPRICE_BASE}/product/{slug}"
        html = await self._get_html(url)
        if not html:
            return None

        try:
            soup = BeautifulSoup(html, "html.parser")

            jsonld = soup.find("script", type="application/ld+json")
            product_data = None
            if jsonld:
                try:
                    product_data = json.loads(jsonld.string)
                except (json.JSONDecodeError, AttributeError):
                    pass

            title = ""
            if product_data and isinstance(product_data, dict):
                title = product_data.get("name", "")
            if not title:
                og_title = soup.find("meta", property="og:title")
                if og_title:
                    title = og_title.get("content", "")
            if not title:
                h1_el = soup.find("h1")
                if h1_el:
                    title = h1_el.get_text(strip=True)

            if title:
                title = re.sub(r"\s*\|\s*NTUC\s+FairPrice\s*$", "", title).strip()
            if not title:
                return None

            price = 0.0
            if product_data and isinstance(product_data, dict):
                offers = product_data.get("offers", {})
                price_str = offers.get("price", "0")
                try:
                    price = float(price_str)
                except (ValueError, TypeError):
                    pass

            if price <= 0:
                price_matches = re.findall(r'"price"\s*:\s*([\d.]+)', html)
                for pm in price_matches:
                    val = float(pm)
                    if 0.1 < val < 99999:
                        price = val
                        break

            if price <= 0:
                price_el = soup.select_one('[class*="price"]')
                if price_el:
                    text = price_el.get_text(strip=True)
                    m = re.search(r'S?\$?([\d,]+(?:\.\d{2})?)', text)
                    if m:
                        try:
                            price = float(m.group(1).replace(",", ""))
                        except ValueError:
                            pass

            image_url = ""
            if product_data and isinstance(product_data, dict):
                img = product_data.get("image", "")
                if isinstance(img, list) and img:
                    image_url = img[0]
                elif isinstance(img, str):
                    image_url = img
            if not image_url:
                og_image = soup.find("meta", property="og:image")
                if og_image:
                    image_url = og_image.get("content", "")

            description = ""
            if product_data and isinstance(product_data, dict):
                description = product_data.get("description", "")
            if not description:
                meta_desc = soup.find("meta", attrs={"name": "description"})
                if meta_desc:
                    description = meta_desc.get("content", "")

            brand = ""
            if product_data and isinstance(product_data, dict):
                brand = product_data.get("brand", {}).get("name", "") if isinstance(product_data.get("brand"), dict) else ""

            sku = f"unity_{slug.split('-')[-1]}"

            self.seen_skus.add(sku)
            return {
                "sku": sku,
                "merchant_id": MERCHANT_ID,
                "title": title,
                "description": description,
                "price": price,
                "currency": "SGD",
                "url": url,
                "image_url": image_url,
                "category": "Unity",
                "category_path": ["Unity"],
                "brand": brand,
                "is_active": True,
                "in_stock": True,
                "metadata": {
                    "source": "unity_sg_website",
                    "fairprice_slug": slug,
                },
            }
        except Exception as e:
            log.transform_error(slug, str(e))
            return None

    async def get_all_categories(self) -> list[dict[str, str]]:
        payload = await self._get_json(f"{FAIRPRICE_API_BASE}/nav", params={"storeId": DEFAULT_STORE_ID})
        items = payload.get("data", []) if payload else []
        categories: list[dict[str, str]] = []
        seen: set[str] = set()

        def walk(nodes: Any, parents: list[str]) -> None:
            if isinstance(nodes, list):
                for node in nodes:
                    walk(node, parents)
                return
            if not isinstance(nodes, dict):
                return
            name = str(nodes.get("name") or "").strip()
            url = str(nodes.get("url") or "")
            current_parents = parents + ([name] if name else [])
            if "/category/" in url:
                slug = url.split("/category/", 1)[1].strip("/")
                if slug and slug not in seen:
                    seen.add(slug)
                    categories.append({"slug": slug, "name": name or slug.replace("-", " ").title(), "path": current_parents})
            for child in nodes.get("menu") or []:
                walk(child, current_parents)

        walk(items, [])
        return categories

    async def scan_fairprice_for_unity_products(self, categories: list[dict[str, str]]) -> list[dict[str, Any]]:
        unity_products: list[dict[str, Any]] = []
        health_categories = [c for c in categories if any(
            kw in c["slug"].lower() for kw in
            ["health", "vitamin", "immunity", "wellness", "beauty", "personal-care",
             "nutrition", "supplement", "baby", "pharmacy", "medical", "fitness",
             "skin", "hair", "oral", "body", "eye", "ear", "first-aid"]
        )]

        log.progress(f"Scanning {len(health_categories)} health-related categories for Unity products")

        for cat in health_categories:
            if len(self.seen_skus) >= self.target_products:
                break

            for page in range(1, 10):
                params = {
                    "pageType": "category",
                    "url": cat["slug"],
                    "page": page,
                    "storeId": DEFAULT_STORE_ID,
                    "orderType": "DELIVERY",
                    "includeTagDetails": "true",
                }
                payload = await self._get_json(f"{FAIRPRICE_API_BASE}/product/v2", params=params)
                if not payload:
                    break
                data = payload.get("data")
                if not data:
                    break
                products = data.get("product") or []
                if not products:
                    break

                for raw in products:
                    seller = ((raw.get("metaData") or {}).get("Fp Seller Name") or "").strip()
                    if "UNITY" not in seller.upper():
                        continue

                    transformed = self._transform_fairprice_product(raw, cat)
                    if transformed:
                        unity_products.append(transformed)

                total_count = int(data.get("count") or 0)
                if len(products) < PAGE_SIZE or (page * PAGE_SIZE) >= min(total_count, 200):
                    break
                await asyncio.sleep(self.delay)

        return unity_products

    def _transform_fairprice_product(self, raw: dict[str, Any], category: dict[str, str]) -> dict[str, Any] | None:
        sku = f"unity_{raw.get('clientItemId') or raw.get('id') or ''}"
        if not sku or sku in self.seen_skus:
            return None

        title = str(raw.get("name") or "").strip()
        if not title:
            return None

        slug = str(raw.get("slug") or "").strip()
        if not slug:
            return None

        price = 0.0
        final_price = raw.get("final_price")
        if isinstance(final_price, (int, float)) and final_price > 0:
            price = float(final_price)
        else:
            store_data = (raw.get("storeSpecificData") or [{}])[0]
            try:
                mrp = float(store_data.get("mrp") or 0)
                discount = float(store_data.get("discount") or 0)
                discounted = mrp - discount if discount > 0 else mrp
                if discounted > 0:
                    price = discounted
            except (TypeError, ValueError):
                pass

        if price <= 0:
            return None

        images = raw.get("images") or []
        image_url = images[0] if images else ""

        brand = ""
        if isinstance(raw.get("brand"), dict):
            brand = str(raw["brand"].get("name") or "").strip()

        seller = ((raw.get("metaData") or {}).get("Fp Seller Name") or "").strip()

        self.seen_skus.add(sku)
        return {
            "sku": sku,
            "merchant_id": MERCHANT_ID,
            "title": title,
            "description": str(raw.get("description") or ""),
            "price": price,
            "currency": "SGD",
            "url": f"{FAIRPRICE_BASE}/product/{slug}",
            "image_url": image_url,
            "category": category["name"],
            "category_path": [category["name"]],
            "brand": brand,
            "is_active": str(raw.get("status") or "").upper() == "ENABLED",
            "in_stock": bool(raw.get("has_stock")),
            "metadata": {
                "category_slug": category["slug"],
                "seller_name": seller,
                "source": "unity_sg",
                "fairprice_sku": raw.get("clientItemId") or raw.get("id"),
            },
        }

    def save_products_ndjson(self, products: list[dict[str, Any]]) -> None:
        if not products:
            return
        with self.outfile.open("a", encoding="utf-8") as handle:
            for product in products:
                handle.write(json.dumps(product, ensure_ascii=False) + "\n")

    async def ingest_batch(self, products: list[dict[str, Any]]) -> tuple[int, int, int]:
        if not products:
            return 0, 0, 0

        self.save_products_ndjson(products)

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
        except Exception as exc:
            log.ingestion_error(url, str(exc))
            return 0, 0, len(products)

    async def run(self) -> dict[str, Any]:
        mode = "scrape-only" if self.scrape_only else "scrape + ingest"
        print(f"Unity SG Scraper starting... (mode: {mode})", flush=True)
        print(f"Target products: {self.target_products or 'all'}", flush=True)
        print(f"Output: {self.outfile}", flush=True)

        start = time.time()

        print("\n[1/3] Scraping Unity website for product references...", flush=True)
        unity_slugs = await self.scrape_unity_website_urls()

        print(f"\n[2/3] Fetching details for {len(unity_slugs)} Unity website products...", flush=True)
        batch: list[dict[str, Any]] = []
        for slug in unity_slugs:
            if len(self.seen_skus) >= self.target_products:
                break
            product = await self.scrape_fairprice_product_page(slug)
            if product:
                batch.append(product)
                self.total_scraped += 1
                print(f"  Scraped: {product['title'][:60]}", flush=True)
                if len(batch) >= self.batch_size:
                    i, u, f = await self.ingest_batch(batch)
                    self.total_ingested += i
                    self.total_updated += u
                    self.total_failed += f
                    batch = []
                    await asyncio.sleep(self.delay)
            await asyncio.sleep(self.delay * 0.5)

        print(f"\n[3/3] Scanning FairPrice categories for Unity products...", flush=True)
        categories = await self.get_all_categories()
        unity_from_fp = await self.scan_fairprice_for_unity_products(categories)

        for product in unity_from_fp:
            if len(self.seen_skus) >= self.target_products:
                break
            batch.append(product)
            self.total_scraped += 1
            if len(batch) >= self.batch_size:
                i, u, f = await self.ingest_batch(batch)
                self.total_ingested += i
                self.total_updated += u
                self.total_failed += f
                batch = []
                await asyncio.sleep(self.delay)

        if batch:
            i, u, f = await self.ingest_batch(batch)
            self.total_ingested += i
            self.total_updated += u
            self.total_failed += f

        elapsed = time.time() - start
        summary = {
            "elapsed_seconds": round(elapsed, 1),
            "total_scraped": self.total_scraped,
            "total_ingested": self.total_ingested,
            "total_updated": self.total_updated,
            "total_failed": self.total_failed,
            "unique_products": len(self.seen_skus),
            "unity_website_slugs": len(unity_slugs),
            "fairprice_categories_scanned": len(categories),
            "output_file": str(self.outfile),
        }
        print(json.dumps(summary, indent=2), flush=True)
        return summary


async def main():
    parser = argparse.ArgumentParser(description="Unity SG Scraper")
    parser.add_argument("--api-key", help="BuyWhere API key (required for ingestion)")
    parser.add_argument("--api-base", default="http://localhost:8000", help="BuyWhere API base URL")
    parser.add_argument("--batch-size", type=int, default=100)
    parser.add_argument("--delay", type=float, default=0.5, help="Delay between requests in seconds")
    parser.add_argument("--scrape-only", action="store_true", help="Only scrape and save NDJSON, skip ingestion")
    parser.add_argument("--output-dir", default=None, help="Output directory for scraped data")
    parser.add_argument("--target-products", type=int, default=500, help="Stop after this many unique products; use 0 for all")
    args = parser.parse_args()

    if not args.scrape_only and not args.api_key:
        parser.error("--api-key is required unless --scrape-only is specified")

    scraper = UnitySGScraper(
        api_key=args.api_key,
        api_base=args.api_base,
        batch_size=args.batch_size,
        delay=args.delay,
        output_dir=args.output_dir,
        scrape_only=args.scrape_only,
        target_products=args.target_products,
    )

    try:
        await scraper.run()
    finally:
        await scraper.close()


if __name__ == "__main__":
    asyncio.run(main())
