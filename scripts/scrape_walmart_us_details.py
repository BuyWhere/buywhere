#!/usr/bin/env python3
"""
Walmart US product scraper using BrightData proxy.
Usage: python3 scripts/scrape_walmart_us_details.py --limit 18 --batch-size 18
"""
import argparse, asyncio, json, os, re, time
from typing import Any
import httpx

MERCHANT_ID = "walmart_us"
BASE_URL = "https://www.walmart.com"
PROXY = "http://brd-customer-hl_3ab737be-zone-residential:o3feuq72olm5@brd.superproxy.io:33335"
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
    "Connection": "keep-alive",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
    "Sec-Fetch-User": "?1",
    "Upgrade-Insecure-Requests": "1",
}
MAX_CONCURRENT = 1
MAX_RETRIES = 3
REQUEST_DELAY = 1.0

def extract_jsonld(html: str) -> list[dict]:
    products = []
    pattern = r'<script[^>]+type=["\x27]application/ld\+json["\x27][^>]*>(.*?)</script>'
    for s in re.findall(pattern, html, re.DOTALL | re.IGNORECASE):
        try:
            data = json.loads(s.strip())
            if isinstance(data, dict) and data.get("@type") == "Product":
                products.append(data)
            elif isinstance(data, list):
                for item in data:
                    if isinstance(item, dict) and item.get("@type") == "Product":
                        products.append(item)
        except Exception:
            continue
    return products

def parse_price(value: Any) -> float:
    if value is None: return 0.0
    if isinstance(value, (int, float)): return float(value)
    m = re.search(r"[\d,]+(?:\.\d+)?", str(value).replace("$", ""))
    return float(m.group().replace(",", "")) if m else 0.0

def transform_product(jsonld: dict, product_id: str, url: str, category: str = "Electronics") -> dict | None:
    try:
        name = jsonld.get("name", "").strip()
        if not name: return None
        offers = jsonld.get("offers", [{}])[0] if isinstance(jsonld.get("offers"), list) else jsonld.get("offers", {})
        price = parse_price(offers.get("price", 0))
        if price == 0: price = parse_price(jsonld.get("price", 0))
        currency = str(offers.get("priceCurrency", "USD"))
        img = jsonld.get("image", "")
        if isinstance(img, list): image_url = img[0].get("url", "") if isinstance(img[0], dict) else str(img[0] if img else "")
        elif isinstance(img, dict): image_url = img.get("url", "") or img.get("src", "")
        else: image_url = str(img) if img else ""
        brand_raw = jsonld.get("brand", {})
        brand = brand_raw.get("name", "") if isinstance(brand_raw, dict) else (brand_raw if isinstance(brand_raw, str) else "")
        description = jsonld.get("description", "")
        if isinstance(description, list): description = " ".join(str(d) for d in description)
        description = str(description)[:2000]
        availability = str(offers.get("availability", jsonld.get("availability", "")))
        is_active = "InStock" in availability
        rating_raw = jsonld.get("aggregateRating", {})
        rating = parse_price(rating_raw.get("ratingValue", 0)) if isinstance(rating_raw, dict) else 0.0
        review_count = 0
        if isinstance(rating_raw, dict):
            count_match = re.search(r"\d+", str(rating_raw.get("reviewCount", 0)))
            if count_match: review_count = int(count_match.group())
        return {
            "sku": product_id, "merchant_id": MERCHANT_ID, "title": name, "description": description,
            "price": price, "currency": currency, "url": url, "image_url": image_url,
            "category": category, "category_path": [category], "brand": brand,
            "is_active": is_active, "in_stock": is_active,
            "metadata": {"region": "us", "country_code": "US", "walmart_product_id": product_id,
                        "rating": rating, "review_count": review_count, "availability": availability,
                        "source_type": "brightdata_proxy", "scraped_at": int(time.time())},
        }
    except Exception: return None

async def fetch_product(client: httpx.AsyncClient, product_id: str, semaphore: asyncio.Semaphore) -> dict | None:
    url = f"{BASE_URL}/ip/-/{product_id}"
    async with semaphore:
        for attempt in range(MAX_RETRIES):
            try:
                resp = await client.get(url)
                if resp.status_code == 200 and len(resp.text) > 50000:
                    for jsonld in extract_jsonld(resp.text):
                        if jsonld.get("@type") == "Product": return transform_product(jsonld, product_id, url)
                    return None
                elif resp.status_code in (456, 502, 503, 504):
                    wait = min((2 ** attempt) * 3 + attempt, 15)
                    await asyncio.sleep(wait); continue
                elif resp.status_code == 403: await asyncio.sleep(5); continue
                else: return None
            except Exception:
                if attempt < MAX_RETRIES - 1: await asyncio.sleep(2 ** attempt)
                else: return None
        return None

def load_existing_product_ids(data_dir: str) -> list[str]:
    ids, seen = [], set()
    for fname in os.listdir(data_dir):
        if not fname.startswith("walmart_us") or not fname.endswith(".ndjson"): continue
        fpath = os.path.join(data_dir, fname)
        if not os.path.isfile(fpath): continue
        with open(fpath, "r", encoding="utf-8") as f:
            for line in f:
                try:
                    obj = json.loads(line.strip())
                    pid = obj.get("walmart_product_id", "") or obj.get("sku", "")
                    if not pid or "walmart_us_" in str(pid) or len(str(pid)) < 8: continue
                    if pid not in seen: seen.add(pid); ids.append(pid)
                except: pass
    return ids

async def run_scrape(product_ids: list[str], output_file: str, limit: int, max_concurrent: int, batch_size: int) -> int:
    semaphore = asyncio.Semaphore(max_concurrent)
    client = httpx.AsyncClient(proxy=PROXY, timeout=30.0, verify=False, follow_redirects=True, headers=HEADERS)
    scraped, batch, total = 0, [], min(len(product_ids), limit)
    try:
        for i in range(0, total, batch_size):
            chunk = product_ids[i:i + batch_size]
            results = await asyncio.gather(*[fetch_product(client, pid, semaphore) for pid in chunk], return_exceptions=True)
            for product in results:
                if isinstance(product, dict) and product is not None: batch.append(product); scraped += 1
            if batch:
                with open(output_file, "a", encoding="utf-8") as f:
                    for p in batch: f.write(json.dumps(p, ensure_ascii=False) + "\n")
                batch = []
            print(f"Progress: {scraped}/{total}")
            await asyncio.sleep(REQUEST_DELAY)
    finally: await client.aclose()
    return scraped

async def main():
    parser = argparse.ArgumentParser(description="Walmart US Product Scraper (BrightData)")
    parser.add_argument("--data-dir", default="/home/paperclip/buywhere/data")
    parser.add_argument("--limit", type=int, default=50000)
    parser.add_argument("--batch-size", type=int, default=30)
    parser.add_argument("--max-concurrent", type=int, default=1)
    args = parser.parse_args()
    os.makedirs(args.data_dir, exist_ok=True)
    date_str = time.strftime("%Y%m%d")
    output_file = os.path.join(args.data_dir, f"walmart_us_{date_str}.ndjson")
    existing_ids = load_existing_product_ids(args.data_dir)
    print(f"Found {len(existing_ids)} existing product IDs")
    if not existing_ids: print("No existing product IDs found. Exiting."); return
    ids_to_scrape = list(set(existing_ids))[:args.limit]
    print(f"Scraping up to {len(ids_to_scrape)} unique products")
    start = time.time()
    count = await run_scrape(ids_to_scrape, output_file, args.limit, args.max_concurrent, args.batch_size)
    print(f"\nDone: {count} products scraped in {time.time() - start:.1f}s")
    print(f"Output: {output_file}")

if __name__ == "__main__": asyncio.run(main())