import asyncio
import cloudscraper
import re
import json
import time
from pathlib import Path

MERCHANT_ID = "central_th"
SOURCE = "central_th"
BASE_URL = "https://www.central.co.th"
OUTPUT_DIR = "/home/paperclip/buywhere/data"

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
        scrape_only: bool = False,
        limit: int = 0,
        target_products: int = 20000,
        max_pages_per_cat: int = 500,
    ):
        self.api_key = api_key
        self.scrape_only = scrape_only
        self.limit = limit
        self.target_products = target_products
        self.max_pages_per_cat = max_pages_per_cat
        self.scraper = cloudscraper.create_scraper(
            browser={"browser": "chrome", "platform": "windows", "desktop": True},
            delay=10,
        )
        self.total_scraped = 0
        self.seen_skus: set[str] = set()
        self._session_start = time.strftime("%Y%m%d")
        self._outfile = Path(OUTPUT_DIR) / f"central_th_{self._session_start}.ndjson"
        self._ensure_output_dir()
        self.client = None  # Not needed for direct cloudscraper

    def _ensure_output_dir(self):
        Path(OUTPUT_DIR).mkdir(parents=True, exist_ok=True)

    def _get_page(self, url: str) -> str | None:
        try:
            resp = self.scraper.get(url, timeout=30.0)
            if resp.status_code == 200 and len(resp.text) > 1000:
                return resp.text
        except Exception as e:
            print(f"Fetch error: {e}")
        return None

    def _write_products(self, products: list[dict]):
        if not products:
            return
        with self._outfile.open("a", encoding="utf-8") as f:
            for p in products:
                f.write(json.dumps(p, ensure_ascii=False) + "\n")

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

    async def scrape_category(self, category: dict) -> dict:
        cat_name = category["name"]
        base_url = f"{BASE_URL}{category['url']}"

        print(f"\n[{cat_name}] Starting scrape...")
        counts = {"scraped": 0, "pages": 0}
        page = 1
        batch = []

        while page <= self.max_pages_per_cat:
            if self.limit > 0 and self.total_scraped >= self.limit:
                print(f"  Limit of {self.limit} reached!")
                break
            if self.total_scraped >= self.target_products:
                print(f"  Target of {self.target_products} reached!")
                break

            page_url = f"{base_url}?page={page}" if page > 1 else base_url
            print(f"  Page {page}...", end=" ", flush=True)

            html = self._get_page(page_url)
            if not html:
                print("Fetch failed.")
                page += 1
                import asyncio
                await asyncio.sleep(2)
                continue

            products_raw = extract_products_from_html(html)
            if not products_raw:
                print("No products found.")
                page += 1
                await asyncio.sleep(2)
                continue

            counts["pages"] += 1

            for raw in products_raw:
                if raw["sku"] in self.seen_skus:
                    continue
                self.seen_skus.add(raw["sku"])
                transformed = self.transform_product(raw, category)
                if transformed:
                    batch.append(transformed)
                    counts["scraped"] += 1
                    self.total_scraped += 1

            print(f"scraped={counts['scraped']}, total={self.total_scraped}")

            page += 1
            import asyncio
            await asyncio.sleep(2)

        if batch:
            self._write_products(batch)

        print(f"  [{cat_name}] Done: pages={counts['pages']}, scraped={counts['scraped']}")
        return counts

    async def run(self) -> dict:
        print(f"Central TH Scraper starting...")
        print(f"Output: {self._outfile}")
        print(f"Target: {self.target_products:,} products")

        start = time.time()

        for cat in CATEGORIES:
            if self.limit > 0 and self.total_scraped >= self.limit:
                break
            if self.total_scraped >= self.target_products:
                break
            await self.scrape_category(cat)
            import asyncio
            await asyncio.sleep(3)

        elapsed = time.time() - start

        summary = {
            "elapsed_seconds": round(elapsed, 1),
            "total_scraped": self.total_scraped,
            "unique_skus": len(self.seen_skus),
            "output_file": str(self._outfile),
        }

        print(f"\nScraper complete: {summary}")
        return summary

async def main():
    scraper = CentralTHScraper(
        api_key="",
        scrape_only=True,
        limit=20000,
        target_products=20000,
    )

    await scraper.run()

asyncio.run(main())