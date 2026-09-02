#!/usr/bin/env python3
"""Direct DB ingestion for karmacollars.com products."""
import json
from pathlib import Path

DSN_FILE = Path("data/.catalog_db_url")
DB_URL = DSN_FILE.read_text().strip()
assert "sakura.proxy.rlwy.net" in DB_URL
print(f"Catalog DB: {DB_URL.split('@')[1].split('/')[0]}", flush=True)

import psycopg2

NDJSON_FILE = "data/karmacollars_20260827.ndjson"
SOURCE = "shopify_karmacollars"
MERCHANT_DOMAIN = "karmacollars.com"
MERCHANT_NAME = "Karma Collars"
MERCHANT_COUNTRY = "US"
MERCHANT_REGION = "us"


def main():
    conn = psycopg2.connect(DB_URL)
    conn.autocommit = False
    cur = conn.cursor()

    cur.execute("SELECT id FROM merchants WHERE domain = %s", (MERCHANT_DOMAIN,))
    row = cur.fetchone()
    if row:
        merchant_id = row[0]
        print(f"Merchant exists: id={merchant_id}", flush=True)
    else:
        cur.execute(
            "INSERT INTO merchants (domain, name, country, region, active) "
            "VALUES (%s, %s, %s, %s, true) RETURNING id",
            (MERCHANT_DOMAIN, MERCHANT_NAME, MERCHANT_COUNTRY, MERCHANT_REGION),
        )
        merchant_id = cur.fetchone()[0]
        conn.commit()
        print(f"Created merchant: id={merchant_id}", flush=True)

    products = []
    with open(NDJSON_FILE) as f:
        for line in f:
            line = line.strip()
            if line:
                products.append(json.loads(line))
    print(f"Loaded {len(products)} products", flush=True)

    inserted = 0
    updated = 0
    failed = 0

    cur.execute("SET statement_timeout = '10s'")

    for i, p in enumerate(products):
        sku = p.get("sku", "")
        try:
            cur.execute(
                "SELECT id FROM products WHERE sku = %s AND merchant_id = %s",
                (sku, merchant_id),
            )
            existing = cur.fetchone()

            metadata = json.dumps(p.get("metadata", {}))

            if existing:
                cur.execute(
                    """UPDATE products SET
                       title = %s, description = %s, price = %s, currency = %s,
                       url = %s, image_url = %s, category = %s, brand = %s,
                       in_stock = %s, is_available = %s,
                       country_code = %s, region = %s, source = %s,
                       metadata = %s::jsonb, updated_at = now()
                       WHERE sku = %s AND merchant_id = %s""",
                    (p.get("title", ""), p.get("description"), p.get("price", 0),
                     p.get("currency", "USD"), p.get("url", ""), p.get("image_url"),
                     p.get("category"), p.get("brand"),
                     p.get("in_stock", True), p.get("is_available", True),
                     p.get("country_code", "US"), p.get("region", "us"),
                     SOURCE, metadata, sku, merchant_id),
                )
                updated += 1
            else:
                cur.execute(
                    """INSERT INTO products
                       (merchant_id, sku, title, description, price, currency,
                        url, image_url, category, brand, in_stock, is_available,
                        country_code, region, source, metadata,
                        created_at, updated_at)
                       VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
                               %s, %s, %s, %s::jsonb, now(), now())""",
                    (merchant_id, sku, p.get("title", ""), p.get("description"),
                     p.get("price", 0), p.get("currency", "USD"),
                     p.get("url", ""), p.get("image_url"),
                     p.get("category"), p.get("brand"),
                     p.get("in_stock", True), p.get("is_available", True),
                     p.get("country_code", "US"), p.get("region", "us"),
                     SOURCE, metadata),
                )
                inserted += 1

            if (i + 1) % 50 == 0:
                conn.commit()
                print(f"  Progress: {i+1}/{len(products)} ins={inserted} upd={updated}", flush=True)

        except Exception as e:
            failed += 1
            if failed <= 5:
                print(f"  ERROR [{sku}]: {e}", flush=True)
            conn.rollback()

    conn.commit()

    cur.execute("SELECT COALESCE(products_count, 0) FROM merchants WHERE id = %s", (merchant_id,))
    total = cur.fetchone()[0]

    cur.close()
    conn.close()

    print(f"\nDone: inserted={inserted}, updated={updated}, failed={failed}", flush=True)
    print(f"karmacollars.com merchant products_count: {total}", flush=True)


if __name__ == "__main__":
    main()
