#!/usr/bin/env python3
"""Scrape karmacollars.com (Shopify pet store) and write NDJSON."""
import json
import re
import time
import urllib.request
import urllib.error
from datetime import datetime

DOMAIN = "karmacollars.com"
BASE_URL = f"https://{DOMAIN}"
MERCHANT_ID = "shopify_karmacollars"
COUNTRY = "US"
REGION = "us"
CURRENCY = "USD"
TODAY = datetime.utcnow().strftime("%Y%m%d")
OUTPUT_FILE = f"/home/paperclip/buywhere/data/karmacollars_{TODAY}.ndjson"


def fetch_all_products():
    all_products = []
    page = 1
    while True:
        url = f"{BASE_URL}/products.json?limit=250&page={page}"
        print(f"  Fetching page {page}...", flush=True)
        req = urllib.request.Request(url, headers={
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Accept": "application/json",
        })
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                data = json.loads(resp.read().decode())
        except Exception as e:
            print(f"  ERROR on page {page}: {e}", flush=True)
            break
        products = data.get("products", [])
        if not products:
            break
        all_products.extend(products)
        print(f"  Got {len(products)} products (total: {len(all_products)})", flush=True)
        if len(products) < 250:
            break
        page += 1
        time.sleep(1.5)
    return all_products


def transform(p):
    variant = p.get("variants", [{}])[0] if p.get("variants") else {}
    images = p.get("images", [])
    handle = p.get("handle", "")
    price_str = variant.get("price", "0")
    try:
        price = float(price_str)
    except (ValueError, TypeError):
        price = 0.0
    compare_at = variant.get("compare_at_price")
    if compare_at is not None:
        try:
            compare_at = float(compare_at)
        except (ValueError, TypeError):
            compare_at = None
    in_stock = variant.get("available", True)
    description = p.get("body_html") or ""
    description_clean = re.sub(r"<[^>]+>", "", description).strip()[:5000] if description else None
    tags = p.get("tags", [])
    if isinstance(tags, str):
        tags = [t.strip() for t in tags.split(",") if t.strip()]

    return {
        "sku": handle,
        "merchant_id": MERCHANT_ID,
        "title": p.get("title", ""),
        "description": description_clean or None,
        "price": price,
        "currency": CURRENCY,
        "url": f"{BASE_URL}/products/{handle}",
        "image_url": images[0].get("src") if images else None,
        "category": p.get("product_type") or "Pet Supplies",
        "brand": p.get("vendor") or "Karma Collars",
        "is_active": True,
        "is_available": in_stock,
        "in_stock": in_stock,
        "availability": "in_stock" if in_stock else "out_of_stock",
        "country_code": COUNTRY,
        "region": REGION,
        "metadata": {
            "canonical_id": p.get("id"),
            "shopify_product_id": p.get("id"),
            "shopify_variant_id": variant.get("id"),
            "compare_at_price": compare_at,
            "tags": tags,
        },
    }


def main():
    print(f"=== Karma Collars Scraper ({DOMAIN}) ===", flush=True)
    print(f"Output: {OUTPUT_FILE}", flush=True)

    products = fetch_all_products()
    print(f"Fetched {len(products)} products total", flush=True)

    if not products:
        print("ERROR: No products found from products.json", flush=True)
        return

    count = 0
    with open(OUTPUT_FILE, "w") as f:
        for p in products:
            try:
                row = transform(p)
                f.write(json.dumps(row, ensure_ascii=False) + "\n")
                count += 1
            except Exception as e:
                print(f"  ERROR transforming {p.get('handle','?')}: {e}", flush=True)

    print(f"wrote {count} rows to {OUTPUT_FILE}", flush=True)


if __name__ == "__main__":
    main()
