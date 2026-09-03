#!/usr/bin/env python3
"""
Fast Myntra IN Scraper - extracts product data from window.__myx JSON
Uses ScraperAPI with category page pagination
Target: 100K+ products
"""

import os
import sys
import json
import time
import re
import argparse
from datetime import datetime

import aiohttp
import asyncio

SCRAPERAPI_KEY = os.environ.get("SCRAPERAPI_KEY", "")
OUTPUT_DIR = "/home/paperclip/buywhere-api/data/myntra"
MERCHANT_ID = "myntra_in"
SOURCE = "myntra_in"
BASE_URL = "https://www.myntra.com"

CATEGORIES = [
    {"id": "men-tshirts", "name": "Mens", "sub": "T-Shirts", "url": "https://www.myntra.com/men-tshirts"},
    {"id": "men-shirts", "name": "Mens", "sub": "Shirts", "url": "https://www.myntra.com/men-shirts"},
    {"id": "men-jeans", "name": "Mens", "sub": "Jeans", "url": "https://www.myntra.com/men-jeans"},
    {"id": "men-shoes", "name": "Mens", "sub": "Shoes", "url": "https://www.myntra.com/men-shoes"},
    {"id": "men-trousers", "name": "Mens", "sub": "Trousers", "url": "https://www.myntra.com/men-trousers"},
    {"id": "women-kurtas", "name": "Womens", "sub": "Kurtas", "url": "https://www.myntra.com/women-kurtas-kurtis-suits"},
    {"id": "women-dresses", "name": "Womens", "sub": "Dresses", "url": "https://www.myntra.com/women-dresses"},
    {"id": "women-tops", "name": "Womens", "sub": "Tops", "url": "https://www.myntra.com/women-tops"},
    {"id": "women-shoes", "name": "Womens", "sub": "Shoes", "url": "https://www.myntra.com/women-shoes"},
    {"id": "women-jeans", "name": "Womens", "sub": "Jeans", "url": "https://www.myntra.com/women-jeans"},
    {"id": "kids-boys", "name": "Kids", "sub": "Boys Fashion", "url": "https://www.myntra.com/kids-boys"},
    {"id": "kids-girls", "name": "Kids", "sub": "Girls Fashion", "url": "https://www.myntra.com/kids-girls"},
]

MAX_PAGES_PER_CATEGORY = 200
REQUEST_DELAY = 1.0


async def fetch_page(url: str, session: aiohttp.ClientSession) -> str:
    params = {"api_key": SCRAPERAPI_KEY, "url": url}
    try:
        async with session.get("http://api.scraperapi.com", params=params, timeout=aiohttp.ClientTimeout(total=30)) as resp:
            if resp.status == 200:
                return await resp.text()
            print(f"HTTP {resp.status} for {url}")
            return ""
    except Exception as e:
        print(f"Error fetching {url}: {e}")
        return ""


def parse_mynx_json(html: str) -> dict | None:
    match = re.search(r'window\.__myx\s*=\s*(\{.*?)\s*;?\s*(?:</script>|var\s|\n)', html, re.DOTALL)
    if match:
        try:
            return json.loads(match.group(1))
        except Exception as e:
            print(f"JSON parse error: {e}")
    return None


def extract_products(data: dict, category: dict) -> list[dict]:
    products = []
    try:
        items = data.get("searchData", {}).get("results", {}).get("products", [])
    except Exception:
        return []

    for item in items:
        try:
            pid = str(item.get("productId", ""))
            if not pid:
                continue

            price_info = item.get("price", {})
            price = price_info.get("basePrice", price_info.get("discountedPrice", 0)) if isinstance(price_info, dict) else price_info or 0

            original_price = item.get("mrp", 0)
            discount_pct = item.get("discountDisplayLabel", "")
            if isinstance(discount_pct, str):
                m = re.search(r"(\d+)", discount_pct.replace("%", ""))
                discount_pct = int(m.group(1)) if m else 0

            images = item.get("images", [])
            img_url = images[0].get("url", "") if images else ""

            gender = item.get("gender", "")
            master_cat = item.get("masterCategory", {}).get("name", "") if isinstance(item.get("masterCategory"), dict) else ""
            sub_cat = item.get("subCategory", {}).get("name", "") if isinstance(item.get("subCategory"), dict) else ""
            article_type = item.get("articleType", {}).get("name", "") if isinstance(item.get("articleType"), dict) else ""

            landing = item.get("landingPageUrl", "")
            if landing and not landing.startswith("http"):
                product_url = BASE_URL + "/" + landing
            else:
                product_url = landing

            rating = item.get("rating", 0)
            rating_count = item.get("ratingCount", 0)

            products.append({
                "sku": f"myntra_in_{pid}",
                "merchant_id": MERCHANT_ID,
                "title": item.get("productName", item.get("product", "")),
                "description": item.get("additionalInfo", ""),
                "price": float(price) if price else 0.0,
                "currency": "INR",
                "url": product_url,
                "image_url": img_url,
                "category": gender or category["name"],
                "category_path": [category["name"], category["sub"], sub_cat, article_type],
                "brand": item.get("brand", ""),
                "is_active": True,
                "metadata": {
                    "original_price": float(original_price) if original_price else 0.0,
                    "discount_pct": discount_pct,
                    "rating": float(rating) if rating else None,
                    "rating_count": int(rating_count) if rating_count else 0,
                    "myntra_product_id": pid,
                    "size_info": item.get("sizes", []),
                    "color_variants": len(item.get("colourVariants", [])),
                },
            })
        except Exception as e:
            continue

    return products


def write_products(products: list[dict], outfile: str) -> int:
    count = 0
    with open(outfile, "a", encoding="utf-8") as f:
        for p in products:
            f.write(json.dumps(p, ensure_ascii=False) + "\n")
            count += 1
    return count


async def scrape_category(category: dict, page: int, session: aiohttp.ClientSession, outfile: str) -> tuple[int, bool]:
    url = f"{category['url']}?p={page}"
    html = await fetch_page(url, session)
    if not html:
        return 0, False

    data = parse_mynx_json(html)
    if not data:
        return 0, False

    products = extract_products(data, category)
    count = write_products(products, outfile)

    has_next = data.get("searchData", {}).get("results", {}).get("hasNextPage", False)
    return count, has_next


async def run_category(category: dict, limit: int, session: aiohttp.ClientSession) -> int:
    cat_name = category["name"]
    sub_name = category["sub"]
    date_str = datetime.now().strftime("%Y%m%d")
    outfile = os.path.join(OUTPUT_DIR, f"{MERCHANT_ID}_{date_str}.ndjson")
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    total = 0
    page = 1
    consecutive_empty = 0

    while page <= MAX_PAGES_PER_CATEGORY and total < limit:
        count, has_next = await scrape_category(category, page, session, outfile)

        if count == 0:
            consecutive_empty += 1
            if consecutive_empty >= 3:
                print(f"[{cat_name}/{sub_name}] 3 empty pages, stopping at page {page}")
                break
        else:
            consecutive_empty = 0
            total += count
            print(f"[{cat_name}/{sub_name}] Page {page}: +{count} products (total: {total})")

        if not has_next and count > 0:
            print(f"[{cat_name}/{sub_name}] No more pages after {page}")
            break

        page += 1
        if page <= MAX_PAGES_PER_CATEGORY:
            await asyncio.sleep(REQUEST_DELAY)

    print(f"[{cat_name}/{sub_name}] Done: {total} products written to {outfile}")
    return total


async def main():
    parser = argparse.ArgumentParser(description="Fast Myntra IN Scraper")
    parser.add_argument("--limit", type=int, default=100000)
    parser.add_argument("--delay", type=float, default=1.0)
    args = parser.parse_args()

    global REQUEST_DELAY
    REQUEST_DELAY = args.delay

    date_str = datetime.now().strftime("%Y%m%d")
    print(f"Myntra IN Scraper starting - {date_str}, limit {args.limit}")

    timeout = aiohttp.ClientTimeout(total=30, connect=10)
    async with aiohttp.ClientSession(timeout=timeout) as session:
        for cat in CATEGORIES:
            print(f"\n=== Scraping {cat['name']}/{cat['sub']} ===")
            total = await run_category(cat, args.limit, session)
            print(f"Completed {cat['name']}/{cat['sub']}: {total} products")


if __name__ == "__main__":
    asyncio.run(main())