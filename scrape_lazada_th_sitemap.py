"""
Lazada Thailand sitemap-based scraper — BUY-2575.

Uses the product sitemap to collect all product URLs, then fetches
each product page via ScrapingAPI (premium=true) to extract data.

Usage:
    python scrape_lazada_th_sitemap.py --scrape-only
    python scrape_lazada_th_sitemap.py --ingest --api-key <key>
"""
import argparse
import json
import re
import time
from pathlib import Path
from typing import Any

import cloudscraper

SOURCE = "lazada_th"
MERCHANT_ID = "lazada_th"
BASE_URL = "https://www.lazada.co.th"
OUTPUT_DIR = "/home/paperclip/buywhere-data"
TODAY = time.strftime("%Y%m%d")

MAX_RETRIES = 3
RETRY_DELAY = 5


class LazadaTHSitemapScraper:
    def __init__(
        self,
        api_key: str | None = None,
        api_base: str = "http://localhost:8000",
        batch_size: int = 100,
        delay: float = 1.0,
        scrape_only: bool = False,
        data_dir: str = OUTPUT_DIR,
        max_products: int = 100000,
    ):
        self.api_key = api_key
        self.api_base = api_base.rstrip("/")
        self.batch_size = batch_size
        self.delay = delay
        self.scrape_only = scrape_only
        self.data_dir = Path(data_dir)
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.max_products = max_products
        self._scraper = cloudscraper.create_scraper(
            browser={"browser": "chrome", "platform": "windows", "desktop": True},
            delay=10,
        )
        self.outfile = self.data_dir / f"lazada_th_{TODAY}.ndjson"
        self.total_scraped = 0
        self.total_failed = 0
        self.seen_ids: set[str] = set()

    def _build_proxy_url(self, url: str) -> str:
        import urllib.parse
        encoded = urllib.parse.quote(url, safe="")
        return (
            f"http://api.scraperapi.com"
            f"?api_key=0832602ba87752788b2cd9ab6cef34df"
            f"&url={encoded}"
            f"&premium=true"
        )

    def _fetch_with_retry(self, url: str) -> str | None:
        proxy_url = self._build_proxy_url(url)
        for attempt in range(MAX_RETRIES):
            try:
                resp = self._scraper.get(proxy_url, timeout=30)
                if resp.status_code == 200 and len(resp.text) > 5000:
                    return resp.text
                elif resp.status_code in (429, 503):
                    wait = RETRY_DELAY * (attempt + 1)
                    print(f"  Rate limited, waiting {wait}s")
                    time.sleep(wait)
                else:
                    if attempt < MAX_RETRIES - 1:
                        time.sleep(RETRY_DELAY)
                    else:
                        return None
            except Exception as e:
                if attempt < MAX_RETRIES - 1:
                    time.sleep(RETRY_DELAY)
                else:
                    print(f"  Request failed: {e}")
                    return None
        return None

    def _extract_product_data(self, text: str, url: str) -> dict[str, Any] | None:
        try:
            title_match = re.search(r"<title>([^<]+)</title>", text)
            if not title_match:
                return None
            title = title_match.group(1).split(" : ")[0].split(" | ")[0].strip()

            item_id_match = re.search(r"-i(\d+)\.html", url)
            if not item_id_match:
                return None
            item_id = item_id_match.group(1)
            if item_id in self.seen_ids:
                return None
            self.seen_ids.add(item_id)

            price_match = re.search(
                r'class="pdp-price.*?<span[^>]*>([\d,.]+)', text, re.DOTALL
            )
            price_str = price_match.group(1) if price_match else "0"
            price = float(price_str.replace(",", "") or 0)

            orig_price_match = re.search(
                r'class="pdp-old-price[^>]*>.*?<span[^>]*>([\d,.]+)', text, re.DOTALL
            )
            original_price = 0.0
            if orig_price_match:
                try:
                    original_price = float(
                        orig_price_match.group(1).replace(",", "") or 0
                    )
                except ValueError:
                    original_price = price

            discount_match = re.search(r'class="pdp-discount[^>]*>.*?(\d+)%', text, re.DOTALL)
            discount = 0
            if discount_match:
                try:
                    discount = int(discount_match.group(1))
                except ValueError:
                    discount = 0

            img_match = re.search(r'<img[^>]*class="pdp-img.*?src="([^"]+)"', text, re.DOTALL)
            image_url = img_match.group(1) if img_match else ""

            brand_match = re.search(r'class="pdp-product-brand[^>]*>.*?<a[^>]*>([^<]+)', text, re.DOTALL)
            brand = brand_match.group(1).strip() if brand_match else ""

            location_match = re.search(r'class="seller-address[^>]*>.*?<span[^>]*>([^<]+)', text, re.DOTALL)
            location = location_match.group(1).strip() if location_match else ""

            rating_match = re.search(r'class="pdp Rating[^>]*>.*?rating[^>]*>(\d+\.?\d*)', text, re.DOTALL)
            rating = 0.0
            if rating_match:
                try:
                    rating = float(rating_match.group(1))
                except ValueError:
                    rating = 0.0

            return {
                "sku": item_id,
                "merchant_id": MERCHANT_ID,
                "source": SOURCE,
                "title": title,
                "description": "",
                "price": price,
                "currency": "THB",
                "country": "TH",
                "url": url,
                "image_url": image_url,
                "category": "General",
                "category_path": ["General"],
                "brand": brand,
                "is_active": True,
                "metadata": {
                    "original_price": original_price,
                    "discount_pct": discount,
                    "rating": rating,
                    "review_count": 0,
                    "seller_location": location,
                    "lazada_item_id": item_id,
                },
            }
        except Exception as e:
            return None

    def _collect_sitemap_ids(self) -> list[str]:
        print("Collecting product IDs from sitemaps...")
        all_ids = []
        for page in range(1, 21):
            url = f"https://www.lazada.co.th/sitemap-products-order-last-30days-morethan0-{page}.xml.gz"
            try:
                proxy_url = self._build_proxy_url(url)
                resp = self._scraper.get(proxy_url, timeout=60)
                text = resp.text
                item_ids = re.findall(r"-i(\d+)\.html", text)
                all_ids.extend(item_ids)
                print(f"  Sitemap page {page}: {len(item_ids)} IDs")
                if len(all_ids) >= self.max_products:
                    break
            except Exception as e:
                print(f"  Sitemap page {page}: Error - {e}")
        unique_ids = list(dict.fromkeys(all_ids))
        print(f"Total IDs collected: {len(unique_ids)}")
        return unique_ids[: self.max_products]

    def run(self) -> dict[str, Any]:
        print(f"Lazada TH Sitemap Scraper — BUY-2575")
        print(f"Output: {self.outfile}")
        print(f"Max products: {self.max_products}")

        start = time.time()

        item_ids = self._collect_sitemap_ids()
        if not item_ids:
            print("No product IDs found. Exiting.")
            return {"total_scraped": 0, "total_failed": 0}

        products = []
        scraped = 0
        failed = 0

        for i, item_id in enumerate(item_ids):
            if scraped >= self.max_products:
                break

            url = f"https://www.lazada.co.th/products/test-i{item_id}.html"
            text = self._fetch_with_retry(url)

            if text:
                product = self._extract_product_data(text, url)
                if product:
                    products.append(product)
                    scraped += 1
                    self.total_scraped += 1

                    if len(products) >= self.batch_size:
                        self._save_batch(products)
                        products = []
                else:
                    failed += 1
                    self.total_failed += 1
            else:
                failed += 1
                self.total_failed += 1

            if (i + 1) % 100 == 0:
                print(f"  Progress: {scraped}/{self.max_products} scraped, {failed} failed")

            time.sleep(self.delay)

        if products:
            self._save_batch(products)

        elapsed = time.time() - start
        summary = {
            "elapsed_seconds": round(elapsed, 1),
            "total_scraped": self.total_scraped,
            "total_failed": self.total_failed,
            "max_products": self.max_products,
            "achievement_pct": round(self.total_scraped / self.max_products * 100, 1),
        }
        print(f"\nScraper complete: {summary}")
        return summary

    def _save_batch(self, products: list[dict]) -> None:
        with open(self.outfile, "a", encoding="utf-8") as f:
            for p in products:
                f.write(json.dumps(p, ensure_ascii=False) + "\n")


def main():
    parser = argparse.ArgumentParser(description="Lazada Thailand Sitemap Scraper")
    parser.add_argument("--api-key", default=None)
    parser.add_argument("--api-base", default="http://localhost:8000")
    parser.add_argument("--batch-size", type=int, default=100)
    parser.add_argument("--delay", type=float, default=1.0)
    parser.add_argument("--scrape-only", action="store_true")
    parser.add_argument("--data-dir", default=OUTPUT_DIR)
    parser.add_argument("--max-products", type=int, default=100000)
    args = parser.parse_args()

    if not args.scrape_only and not args.ingest:
        parser.error("Specify --scrape-only or --ingest")

    scraper = LazadaTHSitemapScraper(
        api_key=args.api_key,
        api_base=args.api_base,
        batch_size=args.batch_size,
        delay=args.delay,
        scrape_only=args.scrape_only,
        data_dir=args.data_dir,
        max_products=args.max_products,
    )
    summary = scraper.run()
    print(f"\nFinal: {summary}")


if __name__ == "__main__":
    main()
