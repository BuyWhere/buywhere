#!/usr/bin/env python3
"""Shopify ingestion for findthelostkitchen.com — BUY-77419."""
import json, os, sys, time, urllib.request, urllib.error, datetime

DOMAIN = "findthelostkitchen.com"
MERCHANT_ID = "findthelostkitchen_com"
COUNTRY = "US"
CURRENCY = "USD"
BATCH = "buy77419"
TODAY = datetime.date.today().isoformat()
OUT_DIR = "/home/paperclip/buywhere/data"
SCRATCH = "/home/paperclip/buywhere/data/scraped"
os.makedirs(SCRATCH, exist_ok=True)

def fetch_products(domain):
    all_products, page = [], 1
    while page <= 50:
        url = f"https://{domain}/products.json?limit=250&page={page}"
        try:
            req = urllib.request.Request(url, headers={
                "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
                "Accept": "application/json",
            })
            with urllib.request.urlopen(req, timeout=30) as resp:
                data = json.loads(resp.read().decode())
        except Exception as e:
            print(f"Error page {page}: {e}"); break
        prods = data.get("products", [])
        if not prods: break
        all_products.extend(prods)
        if len(prods) < 250: break
        page += 1
        time.sleep(2.0)
    return all_products

def transform(p, domain):
    variant = (p.get("variants") or [{}])[0]
    images = p.get("images", [])
    img_url = images[0]["src"] if images else None
    product_type = p.get("product_type", "") or ""
    tags = p.get("tags", "") or ""
    description = p.get("body_html", "") or ""
    # Strip HTML tags from description
    import re
    desc_plain = re.sub(r'<[^>]+>', '', description)
    return {
        "merchant_id": MERCHANT_ID,
        "domain": domain,
        "source": "shopify",
        "country_code": COUNTRY,
        "currency_code": CURRENCY,
        "external_product_id": str(p.get("id", "")),
        "title": p.get("title", ""),
        "description": desc_plain[:2000],
        "product_type": product_type,
        "tags": tags,
        "price": variant.get("price", ""),
        "original_price": variant.get("compare_at_price") or "",
        "currency": variant.get("price") and "USD" or "",
        "image_url": img_url,
        "product_url": p.get("handle", ""),
        "is_available": variant.get("available", True),
        "sku": variant.get("sku", ""),
        "barcode": variant.get("barcode", ""),
        "vendor": p.get("vendor", ""),
        "batch": BATCH,
        "ingested_at": TODAY,
    }

products = fetch_products(DOMAIN)
print(f"Fetched {len(products)} products")

ndjson_path = f"{SCRATCH}/{BATCH}_{DOMAIN}.ndjson"
with open(ndjson_path, "w") as f:
    for p in products:
        t = transform(p, DOMAIN)
        f.write(json.dumps(t) + "\n")
print(f"Written {ndjson_path}")

# Upload to R2
import subprocess
R2_KEY = f"buywhere-data/shopify/{MERCHANT_ID}/{BATCH}_{TODAY}.ndjson"
r2_result = subprocess.run([
    "aws", "s3", "cp", ndjson_path, f"s3://buywhere-data/{R2_KEY}",
    "--endpoint-url", "https://abc123a44f4def2c9f3a2c9a3b3b3b3b3.r2.cloudflarestorage.com"
], capture_output=True, text=True)
print("R2 upload:", r2_result.returncode, r2_result.stdout[:200], r2_result.stderr[:200])

# Ingest into DB
from data.scripts.ingest_ndjson import ingest_ndjson
from data.db import get_catalog_db

db = get_catalog_db()
from pathlib import Path
count_before = db.query("SELECT COUNT(*) FROM products WHERE merchant_id = %s", (MERCHANT_ID,))[0][0]
print(f"DB count before: {count_before}")
result = ingest_ndjson(ndjson_path, merchant_id=MERCHANT_ID, domain=DOMAIN, country=COUNTRY, db=db)
count_after = db.query("SELECT COUNT(*) FROM products WHERE merchant_id = %s", (MERCHANT_ID,))[0][0]
print(f"DB count after: {count_after} (inserted {count_after - count_before})")
print(f"Result: {result}")
