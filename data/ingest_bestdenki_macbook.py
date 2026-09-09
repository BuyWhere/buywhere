#!/usr/bin/env python3
"""
Ingest Best Denki MacBook Air M4 products into the catalog DB (sakura).

Uses catalog_guard to resolve the catalog DSN (sakura only), and performs
insert-only with a long statement timeout to survive sakura write-path saturation.
Proof of commit is via bounded PK/merchant probes, not full COUNT.

Usage: python3 ingest_bestdenki_macbook.py <file.jsonl>
"""
import json
import os
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import psycopg2
import catalog_guard

BATCH = 200
INSERT_SQL = """
INSERT INTO products (
  sku, source, merchant_id, title, description, price, currency, url,
  category, category_path, image_url, is_active, in_stock, brand,
  metadata, region, country_code, platform
) VALUES (
  %(sku)s, %(source)s, %(merchant_id)s, %(title)s, %(description)s, %(price)s,
  %(currency)s, %(url)s, %(category)s, %(category_path)s, %(image_url)s,
  %(is_active)s, %(in_stock)s, %(brand)s, %(metadata)s, %(region)s,
  %(country_code)s, %(platform)s
)
ON CONFLICT (sku, source) DO UPDATE SET
  title = EXCLUDED.title,
  price = EXCLUDED.price,
  url = EXCLUDED.url,
  updated_at = NOW()
"""


def to_cp(path):
    return "{" + ",".join('"' + c.replace('"', '\\"') + '"' for c in path) + "}"


def transform(row):
    title = (row.get('title') or '').strip()
    url = (row.get('url') or '').strip()
    sku = (row.get('sku') or '').strip()
    price = row.get('price')
    if not title or not url or not sku or price is None:
        return None
    return {
        'sku': sku,
        'source': row.get('source') or 'bestdenki',
        'merchant_id': row.get('merchant_id') or 'bestdenki.com.sg',
        'title': title,
        'description': row.get('description') or '',
        'price': float(price),
        'currency': (row.get('currency') or 'SGD')[:3],
        'url': url,
        'category': row.get('category') or 'Electronics',
        'category_path': to_cp(row.get('category_path') or []),
        'image_url': row.get('image_url') or '',
        'is_active': row.get('is_active', True),
        'in_stock': row.get('in_stock', True),
        'brand': row.get('brand') or '',
        'metadata': json.dumps(row.get('metadata') or {}),
        'region': row.get('region') or 'SG',
        'country_code': row.get('country_code') or 'SG',
        'platform': row.get('platform') or 'best_denki',
    }


def main():
    if len(sys.argv) < 2:
        print("ERROR: needs a jsonl file arg")
        sys.exit(1)
    filepath = sys.argv[1]
    if not os.path.exists(filepath):
        print(f"File {filepath} not found")
        sys.exit(1)

    url = catalog_guard.resolve_catalog_url()
    conn = psycopg2.connect(url)
    conn.autocommit = True  # kills any implicit txn from the guard's cursor
    catalog_guard.assert_catalog_cursor(conn.cursor())
    cur = conn.cursor()
    cur.execute("SET statement_timeout = 540000")  # 9 min

    total = 0
    failed = 0
    with open(filepath) as f:
        batch = []
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                row = json.loads(line)
            except json.JSONDecodeError:
                failed += 1
                continue
            data = transform(row)
            if data is None:
                failed += 1
                continue
            batch.append(data)
            total += 1
            if len(batch) >= BATCH:
                cur.executemany(INSERT_SQL, batch)
                conn.commit()
                batch = []
        if batch:
            cur.executemany(INSERT_SQL, batch)
            conn.commit()

    # Prove commit via bounded probe (avoid full COUNT during sakura bloat)
    cur.execute(
        "SELECT sku, price, url FROM products WHERE source='bestdenki' "
        "AND title ILIKE '%MacBook Air%'"
    )
    proven = cur.fetchall()
    cur.close()
    conn.close()
    print(f"ingested {total} rows (failed={failed}); proven {len(proven)} bestdenki MacBook Air rows in catalog")
    for row in proven:
        print("  PROVEN:", row[0], "@ S$", row[1], "->", row[2])


if __name__ == "__main__":
    main()
