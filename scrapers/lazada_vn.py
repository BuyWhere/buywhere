"""
Lazada Vietnam product scraper.

Scrapes products from Lazada VN (lazada.vn) using BrightData residential proxy
to bypass WAF blocking. Outputs structured JSON matching the BuyWhere catalog
schema for ingestion via POST /v1/ingest/products.

Usage:
    python -m scrapers.lazada_vn --api-key <key> [--batch-size 100] [--delay 1.0]
    python -m scrapers.lazada_vn --scrape-only  # save to JSONL without ingesting

Categories covered: Electronics, Fashion, Home & Living, Beauty, Sports
Target: 10,000+ products

Note: Lazada VN is accessible via BrightData residential proxy. The proxy
zone must be configured via environment variables (see proxy_config.py).
"""
import argparse
import asyncio
import json
import re
import time
import os
from pathlib import Path
from typing import Any

import httpx

from scrapers.scraper_logging import get_logger
from scrapers.proxy_config import proxy_url, Zone

MERCHANT_ID = "lazada_vn"
log = get_logger(MERCHANT_ID)
SOURCE = "lazada_vn"
BASE_URL = "https://www.lazada.vn"

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "vi-VN,vi;q=0.9,en;q=0.8",
    "Referer": "https://www.lazada.vn/",
}

# BrightData zone for Lazada VN — use residential proxy
BRIGHTDATA_ZONE = os.environ.get("LAZADA_VN_BRIGHTDATA_ZONE", "residential")

CATEGORIES = [
    {"id": "phones", "name": "Electronics", "sub": "Phones", "url": "https://www.lazada.vn/phones/"},
    {"id": "laptops", "name": "Electronics", "sub": "Laptops", "url": "https://www.lazada.vn/laptops/"},
    {"id": "tablets", "name": "Electronics", "sub": "Tablets", "url": "https://www.lazada.vn/tablets/"},
    {"id": "smart-watch", "name": "Electronics", "sub": "Smart Watches", "url": "https://www.lazada.vn/smart-watches/"},
    {"id": "headphones", "name": "Electronics", "sub": "Headphones & Audio", "url": "https://www.lazada.vn/headphones/"},
    {"id": "cameras", "name": "Electronics", "sub": "Cameras", "url": "https://www.lazada.vn/cameras/"},
    {"id": "kitchen-appliances", "name": "Home & Living", "sub": "Kitchen Appliances", "url": "https://www.lazada.vn/kitchen-appliances/"},
    {"id": "refrigerators", "name": "Home & Living", "sub": "Refrigerators", "url": "https://www.lazada.vn/refrigerators/"},
    {"id": "washing-machines", "name": "Home & Living", "sub": "Washing Machines", "url": "https://www.lazada.vn/washing-machines/"},
    {"id": "air-conditioners", "name": "Home & Living", "sub": "Air Conditioners", "url": "https://www.lazada.vn/air-conditioners/"},
    {"id": "fans", "name": "Home & Living", "sub": "Fans & Coolers", "url": "https://www.lazada.vn/fans-air-coolers/"},
    {"id": "women-fashion", "name": "Fashion", "sub": "Women Fashion", "url": "https://www.lazada.vn/women-fashion/"},
    {"id": "men-fashion", "name": "Fashion", "sub": "Men Fashion", "url": "https://www.lazada.vn/men-fashion/"},
    {"id": "bags-backpacks", "name": "Fashion", "sub": "Bags & Backpacks", "url": "https://www.lazada.vn/bags-backpacks/"},
    {"id": "watches", "name": "Fashion", "sub": "Watches", "url": "https://www.lazada.vn/watches/"},
    {"id": "beauty-skincare", "name": "Beauty & Health", "sub": "Skincare", "url": "https://www.lazada.vn/skincare/"},
    {"id": "beauty-makeup", "name": "Beauty & Health", "sub": "Makeup", "url": "https://www.lazada.vn/makeup/"},
    {"id": "beauty-health", "name": "Beauty & Health", "sub": "Health Supplements", "url": "https://www.lazada.vn/health-supplements/"},
    {"id": "sports-equipment", "name": "Sports & Outdoors", "sub": "Sports Equipment", "url": "https://www.lazada.vn/sports-equipment/"},
    {"id": "sports-fitness", "name": "Sports & Outdoors", "sub": "Fitness", "url": "https://www.lazada.vn/fitness/"},
    {"id": "toys-games", "name": "Toys & Kids", "sub": "Toys & Games", "url": "https://www.lazada.vn/toys-games/"},
    {"id": "baby-gear", "name": "Toys & Kids", "sub": "Baby Gear", "url": "https://www.lazada.vn/baby-gear/"},
    {"id": "pet-supplies", "name": "Pet Supplies", "sub": "Pet Supplies", "url": "https://www.lazada.vn/pet-supplies/"},
    {"id": "groceries", "name": "Food & Beverages", "sub": "Groceries", "url": "https://www.lazada.vn/groceries/"},
]


def _build_proxy_url() -> str | None:
    """Build BrightData proxy URL for Lazada VN.

    Zone is determined by (in priority order):
    1. LAZADA_VN_BRIGHTDATA_ZONE env var (zone name, e.g. 'web_unlocker_vn')
    2. BRIGHTDATA_ZONE env var (general fallback)

    Returns None when zone is unknown/unset so the client uses direct connection.
    """
    zone_name = os.environ.get("LAZADA_VN_BRIGHTDATA_ZONE") or os.environ.get("BRIGHTDATA_ZONE", "")
    if zone_name.lower() in ("", "none", "direct"):
        return None
    try:
        zone = Zone(zone_name)
    except ValueError:
        return None
    return proxy_url(zone)


class LazadaVNScraper:
    def __init__(
        self,
        api_key: str | None = None,
        api_base: str = "http://localhost:8000",
        batch_size: int = 100,
        delay: float = 1.0,
        scrape_only: bool = False,
        data_dir: str = "/home/paperclip/buywhere-api/data/lazada-vn",
        max_pages_per_category: int = 200,
        target_products: int = 10000,
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

        # Build proxy config for BrightData
        proxy = _build_proxy_url()
        self.client = httpx.AsyncClient(
            timeout=30.0,
            headers=HEADERS,
            proxy=proxy,
        )
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
        # Try the category AJAX endpoint first
        url = f"{BASE_URL}/cat/geelhoed?ajax=true&page={page}"
        params = {"categoryId": category["id"], "page": page}
        try:
            resp = await self.client.get(url, params=params)
            resp.raise_for_status()
            data = resp.json()
            products = self._extract_products_from_response(data, category)
            if products:
                return products
        except Exception:
            pass

        return await self._fetch_search_api_fallback(category, page)

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

    def _extract_products_from_html(self, html: str, category: dict) -> list[dict]:
        products = []
        # Try to extract from window.DS.conf inline JSON
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
            # Fallback: regex find products JSON in page
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

    @staticmethod
    def _parse_price(value: Any, default: float = 0.0) -> float:
        """Parse Lazada VN price which may be in VND format."""
        if value is None:
            return default
        if isinstance(value, (int, float)):
            return float(value)
        text = str(value).strip()
        if not text:
            return default
        # Remove currency symbols and separators
        cleaned = re.sub(r"[^\d.,\-]", "", text)
        if not cleaned:
            return default
        # Handle VND format: 1.000.000 or 1,000,000
        if cleaned.count(".") > 1 or ("," in cleaned and "." in cleaned):
            cleaned = cleaned.replace(".", "").replace(",", ".")
        elif "," in cleaned and "." not in cleaned:
            cleaned = cleaned.replace(",", ".")
        else:
            cleaned = cleaned.replace(",", "")
        try:
            return float(cleaned)
        except ValueError:
            return default

    @staticmethod
    def _normalize_url(url: str) -> str:
        if not url:
            return ""
        if url.startswith("//"):
            return f"https:{url}"
        if url.startswith("/"):
            return f"{BASE_URL}{url}"
        if url.startswith("http://") or url.startswith("https://"):
            return url
        return f"{BASE_URL}/{url.lstrip('/')}"

    @staticmethod
    def _build_cross_listing_ids(title: str, brand: str = "") -> dict[str, str]:
        """Build cross-listing IDs for dedup against other Lazada markets."""
        import unicodedata
        def ascii_slug(val: str) -> str:
            normalized = unicodedata.normalize("NFKD", val or "")
            ascii_text = normalized.encode("ascii", "ignore").decode("ascii").lower()
            ascii_text = re.sub(r"[^a-z0-9]+", "-", ascii_text).strip("-")
            return ascii_text
        brand_slug = ascii_slug(brand)
        title_slug = ascii_slug(title)
        if brand_slug and title_slug.startswith(f"{brand_slug}-"):
            core_slug = title_slug[len(brand_slug) + 1:]
        else:
            core_slug = title_slug
        token = core_slug[:96] or title_slug[:96] or "unknown"
        prefix = brand_slug or "generic"
        return {
            "lazada_vn_lookup": f"lzdvn:{prefix}:{token}",
            "catalog_dedupe": f"dedupe:{prefix}:{token}",
        }

    def _transform_lazada_product(self, raw: dict, category: dict) -> dict[str, Any] | None:
        try:
            sku = str(raw.get("productId", "") or raw.get("itemId", "") or raw.get("sku", ""))
            if not sku:
                return None

            name = raw.get("name", "") or raw.get("title", "")
            if not name:
                return None

            price = self._parse_price(raw.get("price"))
            if price <= 0:
                price = self._parse_price(raw.get("priceShow"))
            if price <= 0:
                return None

            original_price = self._parse_price(raw.get("originalPrice"))
            if original_price <= 0:
                original_price = self._parse_price(raw.get("originalPriceShow"))
            if original_price <= 0:
                original_price = price

            discount = raw.get("discount", "0")
            if discount:
                discount = int(re.sub(r"[^\d\-]", "", str(discount)) or 0)
            else:
                discount = 0

            images = raw.get("images", []) or []
            image_url = ""
            if images:
                image_url = images[0] if isinstance(images[0], str) else ""
            if not image_url and raw.get("imageUrl"):
                image_url = raw["imageUrl"]
            if not image_url and raw.get("image"):
                image_url = raw["image"]
            image_url = self._normalize_url(image_url)

            product_url = raw.get("productUrl", "") or raw.get("url", "")
            if not product_url and raw.get("itemUrl"):
                product_url = raw["itemUrl"]
            product_url = self._normalize_url(product_url)
            if not product_url:
                return None

            brand = raw.get("brand", "") or raw.get("brandName", "") or ""

            rating = float(raw.get("rating", 0.0) or 0.0)
            review_count = int(raw.get("review", 0) or raw.get("reviewCount", 0) or 0)

            seller = raw.get("seller", {}) or {}
            seller_name = seller.get("name", "") if isinstance(seller, dict) else ""
            if not seller_name:
                seller_name = raw.get("sellerName", "") or raw.get("seller_name", "")

            location = raw.get("location", "") or ""

            return {
                "sku": f"lazada_vn_{sku}",
                "merchant_id": MERCHANT_ID,
                "source": SOURCE,
                "title": name,
                "description": raw.get("description", "") or "",
                "price": price,
                "currency": "VND",
                "region": "vn",
                "country_code": "VN",
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
                    "country": "VN",
                    "cross_listing_ids": self._build_cross_listing_ids(name, brand),
                },
            }
        except Exception:
            return None

    async def ingest_batch(self, products: list[dict]) -> tuple[int, int, int]:
        if not products:
            return 0, 0, 0

        if self.scrape_only:
            for p in products:
                cat_id = p.get("metadata", {}).get("lazada_category_id", "unknown")
                cat_file = self.data_dir / f"{cat_id}.jsonl"
                with cat_file.open("a", encoding="utf-8") as f:
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

        while page <= self.max_pages_per_category:
            if self.total_scraped >= self.target_products:
                print(f"  Target of {self.target_products} products reached!")
                break

            print(f"  Page {page}...", end=" ", flush=True)
            products = await self.fetch_products_page(category, page)

            if not products:
                consecutive_empty_pages += 1
                if consecutive_empty_pages >= 3:
                    print("No products for 3 consecutive pages, ending pagination.")
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

            print(f"scraped={counts['scraped']}, total={self.total_scraped}")
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

        print(f"  [{cat_name} / {sub_name}] Done: pages={counts['pages']}, scraped={counts['scraped']}, ingested={counts['ingested']}")
        return counts

    async def run(self):
        proxy_info = "BrightData proxy" if _build_proxy_url() else "direct"
        print(f"Lazada VN Scraper starting — target: {self.target_products} products")
        print(f"Proxy: {proxy_info}")
        print(f"API: {self.api_base} | Batch: {self.batch_size} | Delay: {self.delay}s")
        print(f"Output dir: {self.data_dir}")

        overall = {"scraped": 0, "ingested": 0, "updated": 0, "failed": 0, "pages": 0}

        for category in CATEGORIES:
            if self.total_scraped >= self.target_products:
                break
            try:
                counts = await self.scrape_category(category)
                for k in overall:
                    if k in counts:
                        overall[k] += counts[k]
            except Exception as e:
                log.parse_error(None, f"Category scrape failed: {e}")

        print(f"\n=== Overall ===")
        print(f"Pages: {overall['pages']}")
        print(f"Scraped: {overall['scraped']}")
        print(f"Ingested: {overall['ingested']}")
        print(f"Updated: {overall['updated']}")
        print(f"Failed: {overall['failed']}")
        print(f"Total scraped: {self.total_scraped}")

        await self.close()


def main():
    parser = argparse.ArgumentParser(description="Lazada Vietnam product scraper")
    parser.add_argument("--api-key", default=None, help="BuyWhere API key")
    parser.add_argument("--api-base", default="http://localhost:8000", help="API base URL")
    parser.add_argument("--batch-size", type=int, default=100, help="Batch size for ingestion")
    parser.add_argument("--delay", type=float, default=1.0, help="Delay between requests (seconds)")
    parser.add_argument("--data-dir", default="/home/paperclip/buywhere-api/data/lazada-vn", help="Output data directory")
    parser.add_argument("--max-pages", type=int, default=200, help="Max pages per category")
    parser.add_argument("--target", type=int, default=10000, help="Target number of products")
    parser.add_argument("--scrape-only", action="store_true", help="Save to JSONL without ingesting")
    args = parser.parse_args()

    if not args.scrape_only and not args.api_key:
        parser.error("--api-key is required unless --scrape-only is used")

    scraper = LazadaVNScraper(
        api_key=args.api_key,
        api_base=args.api_base,
        batch_size=args.batch_size,
        delay=args.delay,
        data_dir=args.data_dir,
        max_pages_per_category=args.max_pages,
        target_products=args.target,
        scrape_only=args.scrape_only,
    )
    asyncio.run(scraper.run())


if __name__ == "__main__":
    main()
