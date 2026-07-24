"""
Carousell Singapore product scraper.

Carousell (carousell.sg) is a Singapore marketplace. This scraper
fetches product listings via Carousell's search/category pages and
extracts product details using Brightdata residential proxy for Singapore.

Carousell actively blocks ScraperAPI IPs, so we use Brightdata residential
proxies instead. Set BRIGHTDATA_RESIDENTIAL_PROXY env var or use ScraperAPI
as fallback with SCRAPERAPI_KEY.

Usage:
    BRIGHTDATA_RESIDENTIAL_PROXY=... python -m scrapers.carousell_sg --test-limit 5
    SCRAPERAPI_KEY=... python -m scrapers.carousell_sg --api-key $BUYWHERE_API_KEY
    BRIGHTDATA_RESIDENTIAL_PROXY=... python -m scrapers.carousell_sg --scrape-only

Target: popular categories across Carousell SG (Electronics, Fashion,
Home & Garden, etc.) with product title, price, condition, seller,
and listing URL.
"""
import argparse
import asyncio
import json
import os
import re
import sys
import time
from html import unescape
from pathlib import Path
from typing import Any, Optional

import httpx

from scrapers.scraper_registry import register
from scrapers.proxy_config import Zone, proxy_url

MERCHANT_ID = "carousell_sg"
SOURCE = "carousell_sg"
BASE_URL = "https://www.carousell.sg"
OUTPUT_DIR = Path("/home/paperclip/buywhere-api/data/carousell-sg")
API_INGEST_URL = "https://api.buywhere.ai/v1/ingest"

# Brightdata residential proxy for Singapore (Carousell blocks ScraperAPI)
# Uses centralized proxy_config to ensure correct zone credentials
BRIGHTDATA_PROXY = os.environ.get("BRIGHTDATA_RESIDENTIAL_PROXY") or proxy_url(Zone.RESIDENTIAL_PROXY1)

# Proxy provider selection: "brightdata" (default tunnel proxy) or "scraperapi" (request router)
PROXY_PROVIDER = os.environ.get("PROXY_PROVIDER", "brightdata").lower()

# Carousell SG categories to scrape
CATEGORIES = [
    {"slug": "electronics-phones", "name": "Mobile Phones"},
    {"slug": "electronics-laptops", "name": "Laptops"},
    {"slug": "electronics-tablets", "name": "Tablets"},
    {"slug": "fashion-men", "name": "Fashion - Men"},
    {"slug": "fashion-women", "name": "Fashion - Women"},
    {"slug": "home-living", "name": "Home & Living"},
    {"slug": "sports-outdoors", "name": "Sports & Outdoors"},
    {"slug": "toys-games", "name": "Toys & Games"},
]

REQUEST_TIMEOUT_S = 60.0
DEFAULT_CONCURRENCY = 6
DEFAULT_BATCH_SIZE = 50
DEFAULT_PAGE_SIZE = 40
TARGET_PRODUCT_COUNT = 5000

USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/124.0.0.0 Safari/537.36"
)


def _log(message: str) -> None:
    print(f"[carousell_sg] {message}", flush=True)


def _decode_html(value: str) -> str:
    if not value:
        return ""
    return unescape(value).replace(" ", " ")


def _strip_tags(value: str) -> str:
    if not value:
        return ""
    text = re.sub(r"<script[\s\S]*?</script>", " ", value, flags=re.IGNORECASE)
    text = re.sub(r"<style[\s\S]*?</style>", " ", text, flags=re.IGNORECASE)
    text = re.sub(r"<[^>]+>", " ", text)
    text = re.sub(r"\s+", " ", text)
    return _decode_html(text).strip()


def _normalize_url(url: str) -> str:
    if not url:
        return ""
    if url.startswith("http://") or url.startswith("https://"):
        return url
    if url.startswith("//"):
        return f"https:{url}"
    if url.startswith("/"):
        return f"{BASE_URL}{url}"
    return url


def _fetch_with_scraperapi_kwargs(target_url: str, *, session: int = 1) -> dict[str, Any]:
    api_key = os.environ.get("SCRAPERAPI_KEY", "")
    if not api_key:
        raise RuntimeError("SCRAPERAPI_KEY environment variable is required")
    params: dict[str, str] = {
        "api_key": api_key,
        "url": target_url,
        "country_code": "sg",
        "session_number": str(session),
    }
    return {
        "url": "https://api.scraperapi.com/",
        "params": params,
        "timeout": REQUEST_TIMEOUT_S,
    }


def _extract_regex(html: str, pattern: str, group: int = 1) -> str:
    m = re.search(pattern, html, re.IGNORECASE)
    return _decode_html(m.group(group)) if m else ""


def _extract_meta(html: str, attr_name: str, attr_value: str) -> str:
    pattern = (
        rf'<meta[^>]+{re.escape(attr_name)}=["\']{re.escape(attr_value)}["\'][^>]+'
        rf'content=["\']([^"\']*)["\'][^>]*>'
    )
    m = re.search(pattern, html, re.IGNORECASE)
    if m:
        return _decode_html(m.group(1))
    pattern2 = (
        rf'<meta[^>]+content=["\']([^"\']*)["\'][^>]+{re.escape(attr_name)}=["\']'
        rf'{re.escape(attr_value)}["\'][^>]*>'
    )
    m2 = re.search(pattern2, html, re.IGNORECASE)
    return _decode_html(m2.group(1)) if m2 else ""


def _parse_price(text: str) -> tuple[Optional[float], Optional[float]]:
    """Parse price string like 'S$149.00' or 'S$299.00 S$199.00'."""
    amounts = re.findall(r"S?\$[\s]*([0-9][0-9,.]*)", text)
    amounts = [float(a.replace(",", "")) for a in amounts if a]
    if not amounts:
        return None, None
    if len(amounts) >= 2:
        return min(amounts), max(amounts)
    return amounts[0], None


def _extract_condition(html: str) -> str:
    """Extract condition label from listing page."""
    cond = re.search(r'condition["\s:]+([^"<>]+)', html, re.IGNORECASE)
    if cond:
        return cond.group(1).strip().lower()
    labels = ["like_new", "very_good", "good", "acceptable"]
    for label in labels:
        if label.replace("_", " ") in html.lower() or label in html.lower():
            return label
    return "unknown"


def parse_listing_card(card_html: str, category: str, source_url: str) -> Optional[dict[str, Any]]:
    """Parse a Carousell listing card from search/category page listing HTML."""
    # Extract listing ID / URL
    url_match = re.search(r'href="(/p/[^"]+)"', card_html, re.IGNORECASE)
    if not url_match:
        return None
    detail_path = url_match.group(1).strip()
    listing_id = detail_path.split("/")[-1].rstrip("/")
    url = _normalize_url(detail_path)

    # Title
    title_match = re.search(r'<h2[^>]*class="[^"]*(?:title|listing-card)[^"]*"[^>]*>([\s\S]*?)</h2>', card_html, re.IGNORECASE)
    if not title_match:
        title_match = re.search(r'data-testid="listing-title"[^>]*>([\s\S]*?)</[^>]+>', card_html, re.IGNORECASE)
    title = _strip_tags(title_match.group(1) if title_match else "")
    if not title:
        return None

    # Price
    price_match = re.search(r'[\$€]\s*[\d,]+\.?\d*', card_html)
    current_price, original_price = _parse_price(price_match.group(0) if price_match else "")

    # Image
    img_match = re.search(r'<img[^>]+src="([^"]+)"[^>]*(?:alt|title)="([^"]*)"', card_html, re.IGNORECASE)
    if not img_match:
        img_match = re.search(r'<img[^>]+src="([^"]+)"', card_html, re.IGNORECASE)
    image_url = img_match.group(1).strip() if img_match else ""
    if image_url and not image_url.startswith("http"):
        image_url = _normalize_url(image_url)

    # Seller
    seller_match = re.search(r'(?:seller|username|profile-name)[^>]*>([\w\s]+)<', card_html, re.IGNORECASE)
    seller = seller_match.group(1).strip() if seller_match else "Unknown"

    # Condition
    cond_match = re.search(r'(?:condition|cond)[^>]*>([\w\s_-]+)<', card_html, re.IGNORECASE)
    condition = cond_match.group(1).strip().lower() if cond_match else "unknown"
    valid_conditions = ["like_new", "very_good", "good", "acceptable"]
    if condition not in valid_conditions:
        condition = "unknown"

    # Likes/favorites count (optional)
    likes_match = re.search(r'(\d+)\s*(?:like|fav)', card_html, re.IGNORECASE)
    likes = int(likes_match.group(1)) if likes_match else 0

    sku = f"carousell_sg_{listing_id}"

    return {
        "sku": sku,
        "gtin": "",
        "mpn": listing_id,
        "merchant_id": MERCHANT_ID,
        "title": title,
        "description": "",
        "price": current_price or 0.0,
        "currency": "SGD",
        "url": url,
        "image_url": image_url,
        "category": category,
        "category_path": [category],
        "brand": "",
        "condition": condition,
        "is_active": True,
        "metadata": {
            "original_price": original_price,
            "seller": seller,
            "source_url": source_url,
            "listing_id": listing_id,
            "likes": likes,
            "source": "scraperapi-search",
        },
    }


def parse_listing_page(html: str, url: str, listing_id: str) -> Optional[dict[str, Any]]:
    """Parse a Carousell individual listing page for richer data."""
    title = (
        _extract_regex(html, r'<h1[^>]*class="[^"]*(?:title|product)[^"]*"[^>]*>([\s\S]*?)</h1>')
        or _extract_meta(html, "property", "og:title")
        or _strip_tags(_extract_regex(html, r"<title>([\s\S]*?)</title>"))
    )
    title = re.sub(r"\s*\|\s*Carousell\s*$", "", title, flags=re.IGNORECASE).strip()
    if not title:
        return None

    price_text = _extract_regex(html, r'price["\s:]+([^"<]{3,30})')
    current_price, original_price = _parse_price(price_text)

    description = _strip_tags(_extract_regex(html, r'description["\s:]+([^"<]{10,2000})'))

    image_url = _normalize_url(_extract_meta(html, "property", "og:image"))

    seller = _strip_tags(_extract_regex(html, r'(?:seller|profile)[^>]*class="[^"]*(?:username|name)[^"]*"[^>]*>([\w\s@.+-]+)<', re.IGNORECASE))
    if not seller:
        seller = "Unknown"

    condition = _extract_condition(html)
    if condition == "unknown":
        condition_labels = re.findall(r'condition["\s:-]*([\w_]+)', html, re.IGNORECASE)
        for c in condition_labels:
            if c.lower() in ["like_new", "very_good", "good", "acceptable"]:
                condition = c.lower()
                break

    brand = _strip_tags(_extract_regex(html, r'brand["\s:]+([\w\s-]{2,50})'))

    # Category from breadcrumb
    category_path = re.findall(r'breadcrumb[^>]*>([\w\s&-]+)<', html, re.IGNORECASE)
    category = category_path[-1].strip() if category_path else "General"

    is_active = "OutOfStock" not in html and "sold" not in html.lower()

    sku = f"carousell_sg_{listing_id}"

    return {
        "sku": sku,
        "gtin": "",
        "mpn": listing_id,
        "merchant_id": MERCHANT_ID,
        "title": title,
        "description": description[:2000] if description else "",
        "price": current_price or 0.0,
        "currency": "SGD",
        "url": url,
        "image_url": image_url,
        "category": category,
        "category_path": [c.strip() for c in category_path[-3:] if c.strip()] or ["General"],
        "brand": brand,
        "condition": condition,
        "is_active": is_active,
        "metadata": {
            "original_price": original_price,
            "seller": seller,
            "listing_id": listing_id,
            "source_url": url,
            "source": "scraperapi-detail",
        },
    }


def _write_jsonl(path: Path, products: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as f:
        for p in products:
            f.write(json.dumps(p, ensure_ascii=False) + "\n")


def _write_summary(path: Path, summary: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        json.dump(summary, f, indent=2, ensure_ascii=False)


@register("carousell_sg")
class CarousellSGScraper:
    def __init__(
        self,
        api_key: Optional[str],
        api_base: str = "https://api.buywhere.ai",
        scrape_only: bool = False,
        test_limit: int = 0,
        concurrency: int = DEFAULT_CONCURRENCY,
        batch_size: int = DEFAULT_BATCH_SIZE,
        output_dir: Path = OUTPUT_DIR,
        categories: Optional[list[str]] = None,
        page_limit: int = 5,
        proxy: Optional[str] = None,
        proxy_provider: Optional[str] = None,
    ) -> None:
        self.api_key = api_key
        self.api_base = api_base.rstrip("/")
        self.scrape_only = scrape_only
        self.test_limit = test_limit
        self.concurrency = max(1, concurrency)
        self.batch_size = max(1, batch_size)
        self.output_dir = output_dir
        self.categories = categories or [c["slug"] for c in CATEGORIES]
        self.page_limit = max(1, page_limit)
        self.proxy_provider = (proxy_provider or PROXY_PROVIDER).lower()
        self.proxy = proxy or BRIGHTDATA_PROXY
        self.seen_skus: set[str] = set()
        self.seen_listing_ids: set[str] = set()
        self.total_scraped = 0
        self.total_ingested = 0
        self.total_updated = 0
        self.total_failed = 0
        self.client: Optional[httpx.AsyncClient] = None
        self.timestamp = int(time.time() * 1000)
        self.output_file = self.output_dir / f"products_{self.timestamp}.jsonl"
        self.summary_file = self.output_dir / f"summary_{self.timestamp}.json"
        self.category_stats: dict[str, dict[str, int]] = {}

    async def __aenter__(self) -> "CarousellSGScraper":
        limits = httpx.Limits(
            max_connections=self.concurrency * 2,
            max_keepalive_connections=self.concurrency,
        )
        # ScraperAPI is a request router, not a tunnel proxy
        proxy_url = None if self.proxy_provider == "scraperapi" else (self.proxy if self.proxy.lower() != "none" else None)
        self.client = httpx.AsyncClient(
            http2=False, limits=limits, follow_redirects=True, proxies=proxy_url,
            headers={"User-Agent": USER_AGENT}, verify=False
        )
        _log(f"proxy provider: {self.proxy_provider}")
        return self

    async def __aexit__(self, exc_type, exc, tb) -> None:
        if self.client:
            await self.client.aclose()

    def _get_category_name(self, slug: str) -> str:
        for c in CATEGORIES:
            if c["slug"] == slug:
                return c["name"]
        return slug.replace("-", " ").title()

    async def _fetch_page_brightdata(self, url: str) -> Optional[str]:
        """Fetch via BrightData tunnel proxy (already configured on httpx client)."""
        assert self.client is not None
        for attempt in range(3):
            try:
                resp = await self.client.get(url, timeout=REQUEST_TIMEOUT_S)
                if resp.status_code == 200 and len(resp.text) > 500:
                    return resp.text
                _log(f"  fetch attempt {attempt + 1} status={resp.status_code} for {url}")
            except Exception as e:
                _log(f"  fetch error {attempt + 1} for {url}: {e}")
            await asyncio.sleep(2 + attempt * 2)
        return None

    async def _fetch_page_scraperapi(self, url: str) -> Optional[str]:
        """Fetch via ScraperAPI request router."""
        assert self.client is not None
        api_key = os.environ.get("SCRAPERAPI_KEY", "")
        if not api_key:
            _log("  SCRAPERAPI_KEY not set; cannot use scraperapi provider")
            return None
        try:
            kwargs = _fetch_with_scraperapi_kwargs(url, session=1)
            kwargs["params"]["api_key"] = api_key
            resp = await self.client.get(**kwargs)
            if resp.status_code == 200 and len(resp.text) > 500:
                return resp.text
            _log(f"  scraperapi fetch status={resp.status_code} for {url}: {resp.text[:200]}")
        except Exception as e:
            _log(f"  scraperapi fetch error for {url}: {e}")
        return None

    async def _fetch_page(self, url: str, attempt: int = 1) -> Optional[str]:
        if self.proxy_provider == "scraperapi":
            return await self._fetch_page_scraperapi(url)
        return await self._fetch_page_brightdata(url)

    async def _collect_listing_urls_from_page(self, html: str) -> list[str]:
        """Extract detail page paths from a listing card page."""
        urls: list[str] = []
        for m in re.finditer(r'href="(/p/[^"]+)"', html, re.IGNORECASE):
            path = m.group(1).strip()
            listing_id = path.split("/")[-1].rstrip("/")
            if listing_id and listing_id not in self.seen_listing_ids:
                self.seen_listing_ids.add(listing_id)
                urls.append(_normalize_url(path))
        return urls

    async def _scrape_category_page(self, category_slug: str, page: int) -> tuple[list[dict[str, Any]], list[str]]:
        """Scrape one category page, return (products, detail_urls)."""
        cat_name = self._get_category_name(category_slug)
        source_url = f"{BASE_URL}/categories/{category_slug}/?sort_by=date_desc"
        if page > 1:
            source_url = f"{BASE_URL}/categories/{category_slug}/?page={page}&sort_by=date_desc"

        html = await self._fetch_page(source_url)
        if not html:
            return [], []

        # Try JSON-LD first (Carousell sometimes embeds listings as JSON)
        products: list[dict[str, Any]] = []
        json_urls = await self._collect_listing_urls_from_page(html)

        # Also try card-based parsing
        # Look for listing cards in the HTML
        card_blocks = re.finditer(
            r'<a[^>]+href="/p/([^"]+)"[^>]*>([\s\S]*?)</a>',
            html, re.IGNORECASE
        )
        for block in card_blocks:
            listing_id = block.group(1).strip().rstrip("/")
            if not listing_id or listing_id in self.seen_listing_ids:
                continue
            self.seen_listing_ids.add(listing_id)
            card_html = block.group(2)
            product = parse_listing_card(card_html, cat_name, source_url)
            if product:
                products.append(product)

        return products, json_urls

    async def _scrape_listing_detail(self, url: str, listing_id: str, category: str) -> Optional[dict[str, Any]]:
        """Fetch and parse a single listing detail page."""
        html = await self._fetch_page(url)
        if not html:
            return None
        return parse_listing_page(html, url, listing_id)

    async def _ingest_batch(self, products: list[dict[str, Any]]) -> tuple[int, int, int]:
        if not products:
            return 0, 0, 0
        self.output_dir.mkdir(parents=True, exist_ok=True)
        _write_jsonl(self.output_file, products)
        if self.scrape_only or not self.api_key:
            return len(products), 0, 0
        assert self.client is not None
        url = f"{self.api_base}/v1/ingest"
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }
        payload = {"source": SOURCE, "products": products}
        try:
            resp = await self.client.post(url, json=payload, headers=headers, timeout=60.0)
            resp.raise_for_status()
            data = resp.json()
            return (
                int(data.get("rows_inserted", 0) or 0),
                int(data.get("rows_updated", 0) or 0),
                int(data.get("rows_failed", 0) or 0),
            )
        except Exception as e:
            _log(f"  ingest error: {e}")
            return 0, 0, len(products)

    async def run(self) -> dict[str, Any]:
        # SCRAPERAPI_KEY no longer required - using Brightdata residential proxy by default
        start = time.time()
        all_products: list[dict[str, Any]] = []
        pending_batch: list[dict[str, Any]] = []

        for cat_slug in self.categories:
            if self.test_limit and self.total_scraped >= self.test_limit:
                break
            cat_name = self._get_category_name(cat_slug)
            _log(f"Scraping category: {cat_slug} ({cat_name})")
            cat_products = 0
            cat_seen = 0

            for page in range(1, self.page_limit + 1):
                if self.test_limit and self.total_scraped >= self.test_limit:
                    break
                _log(f"  page {page}...")
                products, _ = await self._scrape_category_page(cat_slug, page)
                new_products = [p for p in products if p["sku"] not in self.seen_skus]
                for p in new_products:
                    self.seen_skus.add(p["sku"])
                cat_products += len(new_products)
                self.total_scraped += len(new_products)
                all_products.extend(new_products)
                pending_batch.extend(new_products)
                cat_seen = len(new_products)

                if len(pending_batch) >= self.batch_size:
                    ins, upd, flg = await self._ingest_batch(pending_batch)
                    self.total_ingested += ins
                    self.total_updated += upd
                    self.total_failed += flg
                    _log(f"  ingested batch: +{ins} ins / +{upd} upd / {flg} fail")
                    pending_batch = []

                if cat_seen == 0:
                    _log(f"  no more listings on page {page}, stopping")
                    break

                await asyncio.sleep(1.5)

            self.category_stats[cat_slug] = {
                "category_name": cat_name,
                "products_scraped": cat_products,
            }
            _log(f"  category {cat_slug}: {cat_products} products")

        if pending_batch:
            ins, upd, flg = await self._ingest_batch(pending_batch)
            self.total_ingested += ins
            self.total_updated += upd
            self.total_failed += flg

        elapsed = time.time() - start
        _log(
            f"Scraping complete: {len(all_products)} products in {elapsed:.1f}s "
            f"(ingested: {self.total_ingested}, updated: {self.total_updated}, "
            f"failed: {self.total_failed})"
        )

        summary = {
            "merchant_id": MERCHANT_ID,
            "started_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(start)),
            "completed_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "duration_seconds": round(elapsed, 1),
            "categories_attempted": self.categories,
            "category_stats": self.category_stats,
            "products_scraped": len(all_products),
            "unique_skus": len(self.seen_skus),
            "rows_inserted": self.total_ingested,
            "rows_updated": self.total_updated,
            "rows_failed": self.total_failed,
            "mode": "test" if self.test_limit else "full",
            "scrape_only": self.scrape_only,
            "concurrency": self.concurrency,
            "batch_size": self.batch_size,
            "page_limit": self.page_limit,
            "proxy_provider": self.proxy_provider,
            "output_file": str(self.output_file),
        }
        _write_summary(self.summary_file, summary)
        _log(f"Summary written to {self.summary_file}")
        return summary


async def main() -> None:
    parser = argparse.ArgumentParser(description="Carousell Singapore product scraper")
    parser.add_argument("--api-key", help="BuyWhere API key (defaults to $BUYWHERE_API_KEY)")
    parser.add_argument("--api-base", default="https://api.buywhere.ai")
    parser.add_argument("--scrape-only", action="store_true")
    parser.add_argument("--test-limit", type=int, default=0)
    parser.add_argument("--concurrency", type=int, default=DEFAULT_CONCURRENCY)
    parser.add_argument("--batch-size", type=int, default=DEFAULT_BATCH_SIZE)
    parser.add_argument("--output-dir", default=str(OUTPUT_DIR))
    parser.add_argument("--page-limit", type=int, default=5, help="Max pages per category")
    parser.add_argument("--categories", nargs="+", default=None, help="Category slugs to crawl")
    parser.add_argument("--proxy", default=None, help="Proxy URL (defaults to BRIGHTDATA_RESIDENTIAL_PROXY env var)")
    parser.add_argument(
        "--proxy-provider",
        choices=["brightdata", "scraperapi"],
        default=os.environ.get("PROXY_PROVIDER", "brightdata"),
        help="Proxy provider to use (default: brightdata)",
    )
    args = parser.parse_args()

    api_key = args.api_key or os.environ.get("BUYWHERE_API_KEY")
    if not args.scrape_only and not api_key:
        parser.error("--api-key or $BUYWHERE_API_KEY is required unless --scrape-only is used")

    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    async with CarousellSGScraper(
        api_key=api_key,
        api_base=args.api_base,
        scrape_only=args.scrape_only,
        test_limit=args.test_limit,
        concurrency=args.concurrency,
        batch_size=args.batch_size,
        output_dir=output_dir,
        categories=args.categories,
        page_limit=args.page_limit,
        proxy=args.proxy,
        proxy_provider=args.proxy_provider,
    ) as scraper:
        summary = await scraper.run()
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    asyncio.run(main())
