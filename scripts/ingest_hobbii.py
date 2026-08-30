#!/usr/bin/env python3
"""Ingest hobbii.ca products directly to catalog DB - chunked approach"""
import json
import psycopg2
import psycopg2.extras
from datetime import datetime

DOMAIN = "hobbii.ca"
SOURCE = f"shopify_{DOMAIN}"
INPUT_FILE = "/tmp/hobbii.ca_2026-08-29.jsonl"
CATALOG_DSN = "postgresql://ingest_rw:Ingestmsk0qq1h@sakura.proxy.rlwy.net:22987/railway"

def transform_product(p):
    """Transform scraped product to BuyWhere schema"""
    variants = p.get("variants", [])
    price = variants[0].get("price") if variants else None
    if price:
        try:
            price = float(price)
        except (ValueError, TypeError):
            price = 0.0
    else:
        price = 0.0

    in_stock = any(v.get("inventory_quantity", 0) for v in variants if v.get("inventory_quantity"))
    category = p.get("product_type") or p.get("category")
    images = p.get("images", [])
    image_url = images[0].get("src") if images else None
    sku = f"{DOMAIN}:{p.get('handle')}"

    return {
        "sku": sku,
        "source": SOURCE,
        "merchant_id": DOMAIN,
        "title": p.get("title"),
        "description": None,
        "price": price,
        "currency": "USD",
        "url": f"https://{DOMAIN}/products/{p.get('handle')}",
        "category": category,
        "category_path": [category] if category else [],
        "image_url": image_url,
        "brand": p.get("vendor"),
        "is_active": True,
        "in_stock": in_stock,
        "is_available": in_stock,
        "metadata": {"canonical_id": p.get("canonical_id"), "handle": p.get("handle")},
        "region": "us",
        "country_code": "US",
        "canonical_id": p.get("canonical_id"),
    }

def main():
    print(f"Loading products from {INPUT_FILE}...")
    products = []
    with open(INPUT_FILE) as f:
        for line in f:
            p = json.loads(line)
            products.append(transform_product(p))
    print(f"Loaded {len(products)} products")

    print("Connecting to catalog DB...")
    conn = psycopg2.connect(CATALOG_DSN, application_name="shelf_hobbii_ingest")
    conn.autocommit = True  # Avoid long transaction

    # Chunk size - smaller to avoid trigger timeouts
    BATCH_SIZE = 25
    inserted = 0
    updated = 0

    sql = """
        INSERT INTO products (
            sku, source, merchant_id, title, description, price, currency, url,
            category, category_path, image_url, brand, is_active, in_stock,
            is_available, metadata, region, country_code, canonical_id,
            updated_at, data_updated_at, last_checked
        ) VALUES %s
        ON CONFLICT (sku, source) DO UPDATE SET
            merchant_id = EXCLUDED.merchant_id,
            title = EXCLUDED.title,
            price = EXCLUDED.price,
            category = EXCLUDED.category,
            image_url = EXCLUDED.image_url,
            brand = EXCLUDED.brand,
            is_active = EXCLUDED.is_active,
            in_stock = EXCLUDED.in_stock,
            is_available = EXCLUDED.is_available,
            metadata = EXCLUDED.metadata,
            updated_at = NOW(),
            data_updated_at = NOW()
        RETURNING (xmax = 0) AS inserted
    """

    template = """(%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb, %s, %s, %s, NOW(), NOW(), NOW())"""

    print("Inserting products in chunks...")
    for start in range(0, len(products), BATCH_SIZE):
        chunk = products[start:start + BATCH_SIZE]
        rows = [
            (p["sku"], p["source"], p["merchant_id"], p["title"], p["description"],
             p["price"], p["currency"], p["url"], p["category"], p["category_path"],
             p["image_url"], p["brand"], p["is_active"], p["in_stock"], p["is_available"],
             json.dumps(p["metadata"]), p["region"], p["country_code"], p["canonical_id"])
            for p in chunk
        ]
        try:
            with conn.cursor() as cur:
                psycopg2.extras.execute_values(cur, sql, rows, template=template)
                flags = [row[0] for row in cur.fetchall()]
            inserted += sum(1 for flag in flags if flag)
            updated += sum(1 for flag in flags if not flag)
            if (start // BATCH_SIZE) % 20 == 0:
                print(f"  Progress: {start + len(chunk)}/{len(products)} - inserted={inserted}, updated={updated}")
        except Exception as e:
            print(f"  Error at batch {start//BATCH_SIZE}: {e}")
            # Try one by one for failed batch
            for p in chunk:
                row = [(p["sku"], p["source"], p["merchant_id"], p["title"], p["description"],
                       p["price"], p["currency"], p["url"], p["category"], p["category_path"],
                       p["image_url"], p["brand"], p["is_active"], p["in_stock"], p["is_available"],
                       json.dumps(p["metadata"]), p["region"], p["country_code"], p["canonical_id"])]
                try:
                    with conn.cursor() as cur:
                        psycopg2.extras.execute_values(cur, sql, row, template=template)
                        if cur.fetchone()[0]:
                            inserted += 1
                        else:
                            updated += 1
                except Exception as e2:
                    print(f"    Single insert failed: {e2}")

    print(f"Done! Inserted: {inserted}, Updated: {updated}")
    conn.close()

if __name__ == "__main__":
    main()
