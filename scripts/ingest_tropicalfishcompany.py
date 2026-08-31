#!/usr/bin/env python3
"""Shopify ingestion for tropicalfishcompany.com — BUY-77421."""
import json, os, sys, time, urllib.request, urllib.error, re, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

DOMAIN = "tropicalfishcompany.com"
MERCHANT_ID = "tropicalfishcompany_com"
COUNTRY = "US"
CURRENCY = "USD"
BATCH = "buy77421"
TODAY = datetime.date.today().isoformat()
SCRATCH = ROOT / "data" / "scraped"
API_BASE = "https://api.buywhere.ai"
API_KEY = "shelf-ingest-key-buy8803"

SCRATCH.mkdir(parents=True, exist_ok=True)

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
    desc_plain = re.sub(r'<[^>]+>', '', description)
    handle = p.get("handle", "")
    price_str = variant.get("price", "")
    compare_at = variant.get("compare_at_price", "")
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
        "price": float(price_str) if price_str else 0.0,
        "original_price": float(compare_at) if compare_at and float(compare_at) > 0 else None,
        "image_url": img_url,
        "url": f"https://{domain}/products/{handle}",
        "is_available": variant.get("available", True),
        "sku": variant.get("sku", ""),
        "barcode": variant.get("barcode", "") or None,
        "vendor": p.get("vendor", ""),
        "batch": BATCH,
    }

def ingest_batch(batch, source="shopify"):
    url = f"{API_BASE}/v1/ingest/products"
    payload = json.dumps({"source": source, "products": batch}).encode()
    headers = {
        "Authorization": f"Bearer {API_KEY}",
        "Content-Type": "application/json",
    }
    req = urllib.request.Request(url, data=payload, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            return json.loads(resp.read().decode()), resp.status
    except urllib.error.HTTPError as e:
        return json.loads(e.read().decode()), e.code
    except Exception as e:
        return {"error": str(e)}, 0

def upload_to_r2(ndjson_path, r2_key):
    import subprocess
    result = subprocess.run([
        "rclone", "copyto", str(ndjson_path),
        f"buywhere-r2:{r2_key}"
    ], capture_output=True, text=True)
    if result.returncode != 0:
        print(f"R2 upload failed: {result.stderr}")
    else:
        print(f"R2 upload done: buywhere-r2:{r2_key}")

products = fetch_products(DOMAIN)
print(f"Fetched {len(products)} products from {DOMAIN}")
if not products:
    print("No products fetched — exiting"); sys.exit(1)

records = [transform(p, DOMAIN) for p in products]
ndjson_path = SCRATCH / f"{BATCH}_{DOMAIN}.ndjson"
with open(ndjson_path, "w") as f:
    for r in records:
        f.write(json.dumps(r) + "\n")
print(f"Written NDJSON: {ndjson_path}")

# R2 upload
r2_key = f"shopify/{MERCHANT_ID}/{BATCH}_{TODAY}.ndjson"
try:
    upload_to_r2(ndjson_path, r2_key)
except Exception as e:
    print(f"R2 upload skipped (non-fatal): {e}")

# Ingest via API
BATCH_SIZE = 100
total_inserted = 0
for i in range(0, len(records), BATCH_SIZE):
    batch = records[i:i+BATCH_SIZE]
    result, status = ingest_batch(batch, source=f"shopify_{MERCHANT_ID}")
    inserted = result.get("rows_inserted", 0) + result.get("rows_updated", 0)
    total_inserted += inserted
    print(f"  Batch {i//BATCH_SIZE+1}: status={status} inserted={inserted} total={total_inserted}")

print(f"\n=== DONE: {total_inserted} rows ingested ===")
