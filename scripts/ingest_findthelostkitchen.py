#!/usr/bin/env python3
"""Shopify ingestion for findthelostkitchen.com — BUY-77419."""
import json, os, sys, time, urllib.request, urllib.error, re, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

DOMAIN = "findthelostkitchen.com"
MERCHANT_ID = "findthelostkitchen_com"
COUNTRY = "US"
CURRENCY = "USD"
BATCH = "buy77419"
TODAY = datetime.date.today().isoformat()
SCRATCH = ROOT / "data" / "scraped"
API_BASE = "https://api.buywhere.ai"
API_KEY = "shelf-ingest-key-buy8803"
SOURCE = "shopify_findthelostkitchen_com"

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


def transform_product(p, merchant_id, domain, country="US", currency="USD"):
    """Transform Shopify product to BuyWhere schema (matches batch_shopify_scraper.py)."""
    variant = (p.get("variants") or [{}])[0] if p.get("variants") else {}
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
        "merchant_id": merchant_id,
        "title": p.get("title", ""),
        "description": description_clean or None,
        "price": price,
        "currency": currency,
        "url": f"https://{domain}/products/{handle}",
        "image_url": images[0].get("src") if images else None,
        "category": p.get("product_type") or None,
        "brand": p.get("vendor") or None,
        "is_active": True,
        "is_available": in_stock,
        "in_stock": in_stock,
        "availability": "in_stock" if in_stock else "out_of_stock",
        "country_code": country.upper(),
        "region": "us",
        "metadata": {
            "canonical_id": p.get("id"),
            "shopify_product_id": p.get("id"),
            "shopify_variant_id": variant.get("id"),
            "compare_at_price": compare_at if compare_at else None,
            "tags": tags,
        },
    }


def ingest_batch(batch, source=SOURCE):
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


if __name__ == "__main__":
    products = fetch_products(DOMAIN)
    print(f"Fetched {len(products)} products from {DOMAIN}")
    if not products:
        print("No products fetched — exiting"); sys.exit(1)

    records = []
    for p in products:
        r = transform_product(p, MERCHANT_ID, DOMAIN)
        if r["price"] <= 0:
            continue
        records.append(r)
    print(f"Records to ingest: {len(records)}")

    # Write NDJSON to local scratch
    ndjson_path = SCRATCH / f"{BATCH}_{DOMAIN}.ndjson"
    with open(ndjson_path, "w") as f:
        for r in records:
            f.write(json.dumps(r) + "\n")
    print(f"Written NDJSON: {ndjson_path}")

    # R2 upload via rclone (non-fatal)
    try:
        import subprocess
        r2_key = f"shopify/{MERCHANT_ID}/{BATCH}_{TODAY}.ndjson"
        r = subprocess.run([
            "rclone", "copyto", str(ndjson_path), f"buywhere-r2:{r2_key}"
        ], capture_output=True, text=True)
        if r.returncode == 0:
            print(f"R2: buywhere-r2:{r2_key}")
        else:
            print(f"R2 skipped: {r.stderr[:100]}")
    except Exception as e:
        print(f"R2 skipped: {e}")

    # Ingest via API — single-record batches to avoid DB timeout on saturated catalog
    total_inserted = 0
    for i, rec in enumerate(records):
        result, status = ingest_batch([rec])
        inserted = result.get("rows_inserted", 0) + result.get("rows_updated", 0)
        total_inserted += inserted
        errors = result.get("errors", [])
        if errors:
            print(f"  [{i}] {rec['title'][:40]}: {errors[0].get('code')}")
        time.sleep(5.0)

    print(f"\n=== DONE: {total_inserted} rows ingested ===")
