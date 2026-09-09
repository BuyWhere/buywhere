#!/usr/bin/env python3
"""Shopify scraper for mastmarket.com — BUY-76377 (artisan chocolate, US).

Scrapes products.json endpoint, outputs NDJSON, uploads to R2.
"""
import json
import os
import sys
import time
import urllib.request
import urllib.error
import datetime
import re

DOMAIN = "mastmarket.com"
NICHE = "artisan_chocolate"
COUNTRY = "US"
REGION = "us"
CURRENCY = "USD"
MERCHANT_ID = "mastmarket_com"
BATCH_TAG = "buy76377"
TODAY = datetime.date.today().isoformat()
REQUEST_DELAY = 2.0
SCRATCH = "/home/paperclip/buywhere/data/scraped"
OUT_DIR = "/home/paperclip/buywhere/data"


def fetch_products(domain, max_pages=50):
    base = f"https://{domain}"
    all_products = []
    page = 1
    error = None
    while page <= max_pages:
        url = f"{base}/products.json?limit=250&page={page}"
        try:
            req = urllib.request.Request(url, headers={
                "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
                "Accept": "application/json",
            })
            with urllib.request.urlopen(req, timeout=30) as resp:
                data = json.loads(resp.read().decode())
        except urllib.error.HTTPError as e:
            error = f"HTTP {e.code}"
            break
        except Exception as e:
            error = str(e)[:120]
            break
        products = data.get("products", [])
        if not products:
            break
        all_products.extend(products)
        if len(products) < 250:
            break
        page += 1
        time.sleep(REQUEST_DELAY)
    return all_products, error


def transform(p):
    variant = (p.get("variants") or [{}])[0]
    images = p.get("images") or []
    handle = p.get("handle", "")
    price_str = variant.get("price", "0")
    try:
        price = float(price_str)
    except (ValueError, TypeError):
        price = 0.0
    compare_at_str = variant.get("compare_at_price")
    compare_at = None
    if compare_at_str:
        try:
            compare_at = float(compare_at_str)
        except (ValueError, TypeError):
            pass
    desc_html = p.get("body_html") or ""
    desc_clean = re.sub(r"<[^>]+>", "", desc_html).strip()
    if len(desc_clean) > 5000:
        desc_clean = desc_clean[:5000]
    tags = p.get("tags", [])
    if isinstance(tags, str):
        tags = [t.strip() for t in tags.split(",") if t.strip()]
    return {
        "sku": handle,
        "merchant_id": MERCHANT_ID,
        "title": p.get("title", ""),
        "description": desc_clean or None,
        "price": price,
        "currency": CURRENCY,
        "url": f"https://{DOMAIN}/products/{handle}",
        "image_url": images[0].get("src") if images else None,
        "category": NICHE,
        "brand": p.get("vendor") or None,
        "is_active": True,
        "is_available": variant.get("available", True),
        "in_stock": variant.get("available", True),
        "availability": "in_stock" if variant.get("available", True) else "out_of_stock",
        "country_code": COUNTRY,
        "region": REGION,
        "metadata": {
            "canonical_id": str(p.get("id", "")),
            "shopify_product_id": str(p.get("id", "")),
            "shopify_variant_id": str(variant.get("id", "")),
            "compare_at_price": compare_at,
            "tags": tags,
            "scraped_at": datetime.datetime.utcnow().isoformat() + "Z",
            "source_batch": BATCH_TAG,
        },
    }


def main():
    print(f"[{DOMAIN}] Scraping ({NICHE})...", flush=True)
    products, error = fetch_products(DOMAIN)
    if error:
        print(f"ERROR: {error}", flush=True)
        sys.exit(1)
    if not products:
        print("WARN: no products returned", flush=True)
        sys.exit(1)
    print(f"Fetched {len(products)} raw products", flush=True)

    transformed = []
    errs = 0
    for p in products:
        try:
            transformed.append(transform(p))
        except Exception as e:
            errs += 1
    if errs:
        print(f"Transform errors: {errs}", flush=True)

    out_dir = os.path.join(SCRATCH, BATCH_TAG)
    os.makedirs(out_dir, exist_ok=True)
    ndjson_file = os.path.join(out_dir, f"{DOMAIN}_{TODAY}.ndjson")
    with open(ndjson_file, "w") as f:
        for t in transformed:
            f.write(json.dumps(t) + "\n")

    print(f"Wrote {len(transformed)} records to {ndjson_file}", flush=True)
    print(f"READY_FOR_R2={ndjson_file}", flush=True)
    return ndjson_file, len(transformed)


if __name__ == "__main__":
    main()
