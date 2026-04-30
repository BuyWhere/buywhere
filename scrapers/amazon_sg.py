"""
Amazon Singapore product scraper.

Scrapes product search results from Amazon SG and outputs structured JSON
matching the BuyWhere catalog schema for ingestion via /v1/ingest/products.

Usage:
    python -m scrapers.amazon_sg --api-key <key> [--batch-size 100] [--delay 1.5]
    python -m scrapers.amazon_sg --scrape-only

Categories covered: Electronics, Home, Fashion
Target: 20,000 products
"""
import argparse
import asyncio
import json
import os
import re
import time
from typing import Any
from urllib.parse import quote_plus, urljoin

import httpx
from bs4 import BeautifulSoup

MERCHANT_ID = "amazon_sg"
SOURCE = "amazon_sg"
BASE_URL = "https://www.amazon.sg"
OUTPUT_DIR = "/home/paperclip/buywhere-api/data/amazon_sg"

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-SG,en;q=0.9",
    "Referer": "https://www.amazon.sg/",
}

CATEGORIES = [
    {
        "id": "electronics",
        "name": "Electronics",
        "keywords": [
            "laptop",
            "smartphone",
            "headphones",
            "monitor",
            "keyboard",
            "mouse",
            "power bank",
            "smart watch",
        ],
    },
    {
        "id": "home",
        "name": "Home",
        "keywords": [
            "air fryer",
            "vacuum cleaner",
            "bedding",
            "storage organizer",
            "desk lamp",
            "cookware",
            "office chair",
            "water bottle",
        ],
    },
    {
        "id": "fashion",
        "name": "Fashion",
        "keywords": [
            "women dress",
            "men shirt",
            "running shoes",
            "sneakers",
            "handbag",
            "wallet",
            "hoodie",
            "jacket",
        ],
    },
]


class AmazonSGScraper:
    def __init__(
        self,
        api_key: str | None = None,
        api_base: str = "http://localhost:8000",
        batch_size: int = 100,
        delay: float = 1.5,
        scrape_only: bool = False,
        output_dir: str | None = None,
        max_pages_per_keyword: int = 25,
    ):
        self.api_key = api_key
        self.api_base = api_base.rstrip("/")
        self.batch_size = batch_size
        self.delay = delay
        self.scrape_only = scrape_only
        self.output_dir = output_dir or OUTPUT_DIR
        self.max_pages_per_keyword = max_pages_per_keyword
        self.client = httpx.AsyncClient(timeout=30.0, headers=HEADERS, follow_redirects=True)
        self.total_scraped = 0
        self.total_ingested = 0
        self.total_updated = 0
        self.total_failed = 0
        self.seen_asins: set[str] = set()
        self._ensure_output_dir()

    def _ensure_output_dir(self) -> None:
        os.makedirs(self.output_dir, exist_ok=True)
        ts = time.strftime("%Y%m%d_%H%M%S")
        self.products_outfile = os.path.join(self.output_dir, f"products_{ts}.jsonl")

    async def close(self) -> None:
        await self.client.aclose()

    async def _get_with_retry(
        self, url: str, params: dict[str, Any] | None = None, retries: int = 3
    ) -> str | None:
        for attempt in range(retries):
            try:
                resp = await self.client.get(url, params=params)
                resp.raise_for_status()
                return resp.text
            except Exception:
                if attempt < retries - 1:
                    await asyncio.sleep((2 ** attempt) * self.delay)
        return None

    def _write_products_to_file(self, products: list[dict[str, Any]]) -> None:
        if not products:
            return
        with open(self.products_outfile, "a", encoding="utf-8") as f:
            for product in products:
                f.write(json.dumps(product, ensure_ascii=False) + "\n")

    def _parse_price(self, value: str | None) -> float:
        if not value:
            return 0.0
        cleaned = (
            value.replace("S$", "")
            .replace("$", "")
            .replace(",", "")
            .strip()
        )
        match = re.search(r"\d+(?:\.\d+)?", cleaned)
        if not match:
            return 0.0
        try:
            return float(match.group(0))
        except ValueError:
            return 0.0

    def _parse_int(self, value: str | None) -> int:
        if not value:
            return 0
        digits = re.sub(r"[^\d]", "", value)
        return int(digits) if digits else 0

    def _extract_brand(self, title: str) -> str:
        if not title:
            return ""
        first_token = title.split()[0].strip("()[],:")
        if not first_token:
            return ""
        if any(char.isdigit() for char in first_token):
            return ""
        return first_token[:80]

    def transform_product(
        self, raw: dict[str, Any], category_name: str, keyword: str
    ) -> dict[str, Any] | None:
        try:
            asin = str(raw.get("asin", "") or raw.get("sku", "")).strip()
            if not asin:
                return None

            title = (raw.get("title") or "").strip()
            if not title:
                return None

            url = raw.get("url") or f"{BASE_URL}/dp/{asin}"
            if not url.startswith("http"):
                url = urljoin(BASE_URL, url)

            price = self._parse_price(raw.get("price"))
            original_price = self._parse_price(raw.get("original_price")) or price
            review_count = self._parse_int(raw.get("review_count"))

            rating = 0.0
            rating_text = raw.get("rating") or ""
            rating_match = re.search(r"(\d+(?:\.\d+)?)", rating_text)
            if rating_match:
                rating = float(rating_match.group(1))

            category_path = [category_name]
            if keyword and keyword.lower() != category_name.lower():
                category_path.append(keyword)

            return {
                "sku": asin,
                "merchant_id": MERCHANT_ID,
                "title": title,
                "description": raw.get("description") or "",
                "price": price,
                "currency": "SGD",
                "url": url,
                "image_url": raw.get("image_url") or "",
                "category": category_name,
                "category_path": category_path,
                "brand": raw.get("brand") or self._extract_brand(title),
                "is_active": True,
                "metadata": {
                    "keyword": keyword,
                    "original_price": original_price,
                    "rating": rating,
                    "review_count": review_count,
                    "is_sponsored": bool(raw.get("is_sponsored", False)),
                },
            }
        except Exception:
            return None

    def parse_search_results(
        self, html: str, category_name: str, keyword: str
    ) -> tuple[list[dict[str, Any]], bool]:
        soup = BeautifulSoup(html, "html.parser")
        products: list[dict[str, Any]] = []

        for card in soup.select('[data-component-type="s-search-result"][data-asin]'):
            asin = (card.get("data-asin") or "").strip()
            if not asin:
                continue

            title_el = card.select_one("h2 span")
            if not title_el:
                continue

            link_el = card.select_one("h2 a")
            price_el = card.select_one(".a-price .a-offscreen")
            original_price_el = card.select_one(".a-text-price .a-offscreen")
            image_el = card.select_one("img.s-image")
            rating_el = card.select_one(".a-icon-alt")
            review_el = card.select_one('a[href*="#customerReviews"] span')
            sponsored_el = card.select_one('[aria-label="Sponsored"], .puis-sponsored-label-text')

            raw_product = {
                "asin": asin,
                "title": title_el.get_text(" ", strip=True),
                "url": link_el.get("href", "") if link_el else "",
                "price": price_el.get_text(strip=True) if price_el else "",
                "original_price": (
                    original_price_el.get_text(strip=True) if original_price_el else ""
                ),
                "image_url": image_el.get("src", "") if image_el else "",
                "rating": rating_el.get_text(" ", strip=True) if rating_el else "",
                "review_count": review_el.get_text(" ", strip=True) if review_el else "",
                "is_sponsored": sponsored_el is not None,
            }

            transformed = self.transform_product(raw_product, category_name, keyword)
            if transformed:
                products.append(transformed)

        has_next_page = soup.select_one(".s-pagination-next:not(.s-pagination-disabled)") is not None
        return products, has_next_page

    async def fetch_search_page(
        self, keyword: str, page: int = 1
    ) -> tuple[list[dict[str, Any]], bool]:
        params = {
            "k": keyword,
            "page": page,
        }
        html = await self._get_with_retry(f"{BASE_URL}/s", params=params)
        if not html:
            return [], False
        return self.parse_search_results(html, "", keyword)

    async def ingest_batch(self, products: list[dict[str, Any]]) -> tuple[int, int, int]:
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

    async def scrape_keyword(
        self, category: dict[str, Any], keyword: str
    ) -> dict[str, int]:
        category_name = category["name"]
        print(f"\n[{category_name}] keyword='{keyword}'")
        counts = {"scraped": 0, "ingested": 0, "updated": 0, "failed": 0}
        batch: list[dict[str, Any]] = []

        for page in range(1, self.max_pages_per_keyword + 1):
            params = {"k": keyword, "page": page}
            html = await self._get_with_retry(f"{BASE_URL}/s", params=params)
            if not html:
                print(f"  Page {page}: request failed")
                break

            parsed_products, has_next_page = self.parse_search_results(html, category_name, keyword)

            fresh_products = []
            for product in parsed_products:
                if product["sku"] in self.seen_asins:
                    continue
                self.seen_asins.add(product["sku"])
                fresh_products.append(product)

            if not fresh_products:
                print(f"  Page {page}: no new products")
                if not has_next_page:
                    break
                await asyncio.sleep(self.delay)
                continue

            for product in fresh_products:
                batch.append(product)
                counts["scraped"] += 1

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

            print(
                f"  Page {page}: parsed={len(parsed_products)} new={len(fresh_products)} total={counts['scraped']}"
            )

            if not has_next_page:
                break

            await asyncio.sleep(self.delay)

        if batch:
            i, u, f = await self.ingest_batch(batch)
            counts["ingested"] += i
            counts["updated"] += u
            counts["failed"] += f
            self.total_ingested += i
            self.total_updated += u
            self.total_failed += f

        self.total_scraped += counts["scraped"]
        return counts

    async def run(self) -> dict[str, Any]:
        mode = "scrape only" if self.scrape_only else f"API: {self.api_base}"
        print("Amazon SG Scraper starting...")
        print(f"Mode: {mode}")
        print(f"Batch size: {self.batch_size}, Delay: {self.delay}s")
        print(f"Max pages per keyword: {self.max_pages_per_keyword}")
        print(f"Output: {self.products_outfile}")

        start = time.time()

        for category in CATEGORIES:
            for keyword in category["keywords"]:
                counts = await self.scrape_keyword(category, keyword)
                print(f"  [{category['name']} / {keyword}] Done: {counts}")
                await asyncio.sleep(self.delay)

        elapsed = time.time() - start
        summary = {
            "elapsed_seconds": round(elapsed, 1),
            "total_scraped": self.total_scraped,
            "total_ingested": self.total_ingested,
            "total_updated": self.total_updated,
            "total_failed": self.total_failed,
            "output_file": self.products_outfile,
            "unique_asins": len(self.seen_asins),
        }
        print(f"\nScraper complete: {summary}")
        return summary


async def main() -> None:
    parser = argparse.ArgumentParser(description="Amazon SG Scraper")
    parser.add_argument("--api-key", help="BuyWhere API key")
    parser.add_argument(
        "--api-base",
        default="http://localhost:8000",
        help="BuyWhere API base URL",
    )
    parser.add_argument("--batch-size", type=int, default=100)
    parser.add_argument(
        "--delay", type=float, default=1.5, help="Delay between requests/batches (seconds)"
    )
    parser.add_argument("--scrape-only", action="store_true", help="Save to JSONL without ingesting")
    parser.add_argument("--output-dir", help="Override output directory")
    parser.add_argument("--max-pages-per-keyword", type=int, default=25)
    args = parser.parse_args()

    if not args.scrape_only and not args.api_key:
        parser.error("--api-key is required unless --scrape-only is used")

    scraper = AmazonSGScraper(
        api_key=args.api_key,
        api_base=args.api_base,
        batch_size=args.batch_size,
        delay=args.delay,
        scrape_only=args.scrape_only,
        output_dir=args.output_dir,
        max_pages_per_keyword=args.max_pages_per_keyword,
    )

    try:
        await scraper.run()
    finally:
        await scraper.close()


if __name__ == "__main__":
    asyncio.run(main())
