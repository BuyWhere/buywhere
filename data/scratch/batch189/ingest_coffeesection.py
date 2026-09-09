#!/usr/bin/env python3
"""Ingest coffeesection.com Shopify products into BuyWhere catalog."""
import json, os, sys, time, urllib.request, urllib.error, ssl, psycopg2
from datetime import datetime, timezone

DOMAIN = "coffeesection.com"
SOURCE = f"shopify_{DOMAIN}"
CREATED_AT = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
DSN = os.environ.get("CATALOG_DSN", "postgresql://ingest_rw:Ingestmsk0qq1h@sakura.proxy.rlwy.net:22987/railway")

ctx = ssl.create_default_context()
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"

def fetch_products_json(domain):
    """Fetch /products.json with pagination."""
    all_products = []
    page = 1
    while True:
        url = f"https://{domain}/products.json?limit=250&page={page}"
        req = urllib.request.Request(url, headers={"User-Agent": UA})
        try:
            resp = urllib.request.urlopen(req, context=ctx, timeout=30)
            data = json.loads(resp.read().decode())
            products = data.get("products", [])
            if not products:
                break
            all_products.extend(products)
            print(f"  Page {page}: {len(products)} products", flush=True)
            page += 1
            time.sleep(2)
        except Exception as e:
            print(f"  Error page {page}: {e}", flush=True)
            break
    return all_products

def normalize(product, domain):
    """Normalize a Shopify product to BuyWhere schema."""
    variants = product.get("variants", [])
    images = product.get("images", [])
    
    price = None
    if variants:
        try:
            price = float(variants[0].get("price", 0))
        except (ValueError, TypeError):
            price = 0.0
    
    raw_sku = variants[0].get("sku", "") if variants else ""
    handle = product.get("handle", "")
    sku = raw_sku.strip() if raw_sku and raw_sku.strip() else handle
    
    product_url = f"https://{domain}/products/{handle}"
    image_url = images[0].get("src", "") if images else ""
    
    return {
        "title": product.get("title", ""),
        "price": price,
        "brand": product.get("vendor", ""),
        "category": product.get("product_type", ""),
        "image_url": image_url,
        "sku": sku,
        "source": SOURCE,
        "merchant_id": DOMAIN,
        "canonical_id": str(product.get("id", "")),
        "url": product_url,
    }

def insert_products(products):
    """Insert products into catalog DB."""
    if not products:
        return 0
    
    conn = psycopg2.connect(DSN)
    cur = conn.cursor()
    
    inserted = 0
    chunk_size = 100
    for i in range(0, len(products), chunk_size):
        chunk = products[i:i+chunk_size]
        for p in chunk:
            try:
                cur.execute("""
                    INSERT INTO products (title, price, brand, category, image_url, sku, source, merchant_id, canonical_id, url, currency, is_active, created_at, updated_at, is_available, url_status)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 'SGD', true, %s, %s, true, 'ok')
                    ON CONFLICT (sku, source) DO NOTHING
                """, (
                    p["title"], p["price"], p["brand"], p["category"],
                    p["image_url"], p["sku"], p["source"], p["merchant_id"],
                    p["canonical_id"], p["url"], CREATED_AT, CREATED_AT
                ))
                inserted += cur.rowcount
            except Exception as e:
                conn.rollback()
                print(f"  INSERT error: {e}", flush=True)
                continue
        conn.commit()
        print(f"  Chunk {i//chunk_size + 1}: committed {inserted} total so far", flush=True)
    
    cur.close()
    conn.close()
    return inserted

# Main
print(f"=== Ingesting {DOMAIN} ===", flush=True)
print(f"Fetching products.json...", flush=True)
raw = fetch_products_json(DOMAIN)
print(f"Total raw products: {len(raw)}", flush=True)

# Deduplicate by canonical_id
seen = set()
deduped = []
for p in raw:
    cid = str(p.get("id", ""))
    if cid not in seen:
        seen.add(cid)
        deduped.append(p)
print(f"After dedup: {len(deduped)}", flush=True)

# Normalize
normalized = [normalize(p, DOMAIN) for p in deduped]

# Write JSONL
jsonl_path = f"/home/paperclip/buywhere/data/scratch/batch189/{DOMAIN}.jsonl"
with open(jsonl_path, "w") as f:
    for p in normalized:
        f.write(json.dumps(p) + "\n")
print(f"JSONL written: {jsonl_path}", flush=True)

# Insert into DB
print(f"Inserting into catalog DB...", flush=True)
inserted = insert_products(normalized)
print(f"Inserted: {inserted}/{len(normalized)}", flush=True)

print(f"=== Done: {DOMAIN} ===", flush=True)
