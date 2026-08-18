#!/usr/bin/env python3
"""
Ingest NDJSON product entries into PostgreSQL for Amazon SG products.
This script retrieves a NDJSON file and upserts the entries accordingly.
Uses DATABASE_URL for database access.
"""
import os
import sys
import json
import psycopg2
from psycopg2 import sql

BATCH_SIZE = 500

UPSERT_SQL = """
INSERT INTO products (
  sku,
  source,
  merchant_id,
  title,
  description,
  price,
  currency,
  url,
  category,
  category_path,
  image_url,
  is_active,
  in_stock,
  brand,
  metadata,
  region,
  country_code,
  updated_at
) VALUES (
  %(sku)s, %(source)s, %(merchant_id)s, %(title)s, %(description)s, %(price)s, %(currency)s, %(url)s, %(category)s, %(category_path)s, %(image_url)s, %(is_active)s, %(in_stock)s, %(brand)s, %(metadata)s, %(region)s, %(country_code)s, NOW()
)
ON CONFLICT (sku, source, country_code) DO UPDATE SET
  title = EXCLUDED.title,
  price = EXCLUDED.price,
  url = EXCLUDED.url,
  image_url = EXCLUDED.image_url,
  updated_at = NOW()
"""

def safe_decimal(val):
    if val is None or val == '':
        return None
    try:
        return float(val)
    except (ValueError, TypeError):
        return None

def transform(record):
    title = (record.get('title') or '').strip()
    url = (record.get('url') or '').strip()
    sku = (record.get('sku') or '').strip()
    if not title or not url or not sku:
        return None

    price = safe_decimal(record.get('price'))
    return {
        'sku': sku,
        'source': 'amazon_sg',
        'merchant_id': record.get('merchant_id', 'amazon_sg'),
        'title': title,
        'description': record.get('description') or '',
        'price': price,
        'currency': record.get('currency', 'SGD'),
        'url': url,
        'category': record.get('category') or '',
        'category_path': '{' + ','.join('"' + c.replace('"', '\\"') + '"' for c in record.get('category_path', [])) + '}',
        'image_url': record.get('image_url') or '',
        'is_active': record.get('is_active', True),
        'in_stock': record.get('in_stock', True),
        'brand': record.get('brand') or '',
        'metadata': json.dumps(record.get('metadata', {})),
        'region': record.get('region') or 'SG',
        'country_code': record.get('country_code') or 'SG',
    }

def main():
    args = sys.argv[1:]
    if len(args) < 1:
        print('ERROR: Needs a file argument')
        sys.exit(1)
    filepath = args[0]
    if not os.path.exists(filepath):
        print(f'File {filepath} does not exist')
        sys.exit(1)

    import sys
    from pathlib import Path
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
    import catalog_guard  # fail-fast: bulk writes only ever target maglev
    conn = psycopg2.connect(catalog_guard.resolve_catalog_url())
    _gc = conn.cursor()
    catalog_guard.assert_catalog_cursor(_gc)
    _gc.close()
    cur = conn.cursor()
    total = 0
    with open(filepath) as file:
        batch = []
        for line in file:
            line = line.strip()
            if not line:
                continue
            record = json.loads(line)
            data_row = transform(record)
            if data_row is None:
                continue
            batch.append(data_row)
            total += 1
            if len(batch) >= BATCH_SIZE:
                cur.executemany(UPSERT_SQL, batch)
                conn.commit()
                batch = []
        if batch:
            cur.executemany(UPSERT_SQL, batch)
            conn.commit()

    cur.close()
    conn.close()
    print(f"Ingested {total} products from {filepath}")

if __name__ == '__main__':
    main()
