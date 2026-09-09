#!/usr/bin/env python3
"""BUY-75483 — lovethatglass.com ingestion (stained glass supplies, batch189)"""

import json, os, sys, time, urllib.request, urllib.error
from decimal import Decimal
from datetime import date

# --- Config ---
DOMAIN = "lovethatglass.com"
SOURCE = f"shopify_{DOMAIN.replace('.', '_')}"
MERCHANT_ID = SOURCE
NICHE = "stained glass supplies"
ISSUE = "BUY-75483"
TODAY = date.today().isoformat()

# DSN from workspace file
DSN = open("/home/paperclip/buywhere/data/.catalog_db_url").read().strip()

# R2 creds from fleet secrets
SECRETS = json.load(open("/home/paperclip/.secrets/fleet-secrets.json"))
R2_ACCOUNT_ID = SECRETS["CLOUDFLARE_ACCOUNT_ID"]
R2_ACCESS_KEY = SECRETS["CLOUDFLARE_R2_ACCESS_KEY_ID"]
R2_SECRET_KEY = SECRETS["CLOUDFLARE_R2_SECRET_ACCESS_KEY"]
R2_BUCKET = "buywhere-data"

JSONL_DIR = "/home/paperclip/buywhere/data"
JSONL_FILE = f"{JSONL_DIR}/lovethatglass_{TODAY}.jsonl"


# --- Fetch all products ---
def fetch_products():
    all_products = []
    page = 1
    while True:
        url = f"https://{DOMAIN}/products.json?limit=250&page={page}"
        req = urllib.request.Request(url, headers={
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                          "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
        })
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                data = json.loads(resp.read())
        except urllib.error.HTTPError as e:
            if e.code == 429:
                print(f"  429 on page {page}, backing off 8s...")
                time.sleep(8)
                continue
            raise
        products = data.get("products", [])
        all_products.extend(products)
        print(f"  Page {page}: {len(products)} products (cumulative: {len(all_products)})")
        if len(products) < 250:
            break
        page += 1
        time.sleep(2)
    return all_products


# --- Transform to BuyWhere schema ---
def transform(products):
    rows = []
    seen_skus = set()
    for p in products:
        pid = p["id"]
        handle = p.get("handle", "")
        vendor = p.get("vendor", "")
        product_type = p.get("product_type", "")
        tags = ",".join(p.get("tags", []))
        published_at = p.get("published_at", "")
        updated_at = p.get("updated_at", "")
        variants = p.get("variants", [])
        images = p.get("images", [])

        raw_sku = variants[0].get("sku", "") if variants else ""
        if not raw_sku or raw_sku.strip() == "":
            # blank SKU → use handle
            raw_sku = handle
        # Dedup within merchant
        base_sku = raw_sku
        if base_sku in seen_skus:
            n = 2
            while f"{base_sku}::v{n}" in seen_skus:
                n += 1
            raw_sku = f"{base_sku}::v{n}"
        seen_skus.add(raw_sku)

        sku = f"shopify-{DOMAIN.replace('.', '-')}-{pid}"
        price_str = variants[0].get("price", "0") if variants else "0"
        try:
            price = str(Decimal(str(price_str)).quantize(Decimal("0.01")))
        except Exception:
            price = "0.00"

        compare_at = None
        if variants and variants[0].get("compare_at_price"):
            try:
                compare_at = str(Decimal(str(variants[0]["compare_at_price"])).quantize(Decimal("0.01")))
            except Exception:
                pass

        image_url = images[0]["src"] if images else ""
        available = any(v.get("available", False) for v in variants)
        product_url = f"https://{DOMAIN}/products/{handle}"

        body_html = p.get("body_html", "")
        import re
        body_text = re.sub(r"<[^>]+>", "", body_html).strip()[:500]

        metadata = {
            "shopify_id": pid,
            "vendor": vendor,
            "product_type": product_type,
            "tags": tags,
            "variants_count": len(variants),
            "images_count": len(images),
            "available": available,
            "published_at": published_at,
            "updated_at": updated_at,
            "compare_at_price": compare_at,
            "ingested_issue": ISSUE,
            "source_domain": DOMAIN,
        }

        row = {
            "sku": sku,
            "title": p.get("title", ""),
            "price": price,
            "brand": vendor,
            "category": product_type,
            "image_url": image_url,
            "url": product_url,
            "description": body_text,
            "source": SOURCE,
            "merchant_id": MERCHANT_ID,
            "canonical_id": str(pid),
            "metadata": json.dumps(metadata),
        }
        rows.append(row)
    return rows


# --- Write JSONL ---
def write_jsonl(rows):
    with open(JSONL_FILE, "w") as f:
        for r in rows:
            f.write(json.dumps(r) + "\n")
    print(f"  JSONL written: {len(rows)} rows → {JSONL_FILE}")


# --- Upload to R2 ---
def upload_r2():
    import boto3
    from botocore.config import Config

    s3 = boto3.client(
        "s3",
        endpoint_url=f"https://{R2_ACCOUNT_ID}.r2.cloudflarestorage.com",
        aws_access_key_id=R2_ACCESS_KEY,
        aws_secret_access_key=R2_SECRET_KEY,
        config=Config(signature_version="s3v4"),
        region_name="auto",
    )
    key = f"shopify/{DOMAIN}/{TODAY}.jsonl"
    s3.upload_file(JSONL_FILE, R2_BUCKET, key)
    print(f"  R2 uploaded: {key}")

    # HEAD to verify
    head = s3.head_object(Bucket=R2_BUCKET, Key=key)
    etag = head.get("ETag", "?")
    size = head.get("ContentLength", 0)
    print(f"  R2 HEAD: ETag={etag}, size={size}")
    return etag


# --- DB upsert ---
def db_upsert(rows):
    import psycopg2

    conn = psycopg2.connect(DSN, connect_timeout=10)
    conn.autocommit = False
    cur = conn.cursor()

    # Timeout settings
    cur.execute("SET statement_timeout = '120s'")
    cur.execute("SET lock_timeout = '300s'")
    cur.execute("SET idle_in_transaction_session_timeout = '300s'")

    # Upsert merchant
    cur.execute("""
        INSERT INTO merchants (id, name, source, country, domain, is_active, onboarding_stage, products_count, last_scraped_at, updated_at)
        VALUES (%s, %s, %s, %s, %s, true, 'scraped', %s, now(), now())
        ON CONFLICT (id) DO UPDATE SET
            name = EXCLUDED.name,
            source = EXCLUDED.source,
            domain = EXCLUDED.domain,
            is_active = true,
            products_count = EXCLUDED.products_count,
            last_scraped_at = now(),
            updated_at = now()
    """, (MERCHANT_ID, "Love That Glass", SOURCE, "US", DOMAIN, len(rows)))
    conn.commit()
    print(f"  Merchant upserted: {MERCHANT_ID} ({len(rows)} products)")

    # Upsert products in chunks
    chunk_size = 200
    total_upserted = 0
    for i in range(0, len(rows), chunk_size):
        chunk = rows[i:i + chunk_size]
        try:
            args_str = ",".join(cur.mogrify(
                "(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
                (r["sku"], r["title"], r["price"], "USD", r["brand"], r["category"],
                 r["image_url"], r["url"], r["description"], r["source"], r["merchant_id"],
                 r["canonical_id"], r["metadata"], True, "ok", True)
            ).decode() for r in chunk)
            cur.execute(f"""
                INSERT INTO products (sku, title, price, currency, brand, category, image_url, url, description, source, merchant_id, canonical_id, metadata, is_active, url_status, is_available)
                VALUES {args_str}
                ON CONFLICT (sku, source) DO UPDATE SET
                    title = EXCLUDED.title,
                    price = EXCLUDED.price,
                    currency = EXCLUDED.currency,
                    brand = EXCLUDED.brand,
                    category = EXCLUDED.category,
                    image_url = EXCLUDED.image_url,
                    url = EXCLUDED.url,
                    description = EXCLUDED.description,
                    canonical_id = EXCLUDED.canonical_id,
                    metadata = EXCLUDED.metadata
            """)
            conn.commit()
            total_upserted += len(chunk)
            print(f"  Chunk {i // chunk_size + 1}: {len(chunk)} rows upserted (total: {total_upserted})")
        except Exception as e:
            print(f"  ERROR chunk {i // chunk_size + 1}: {e}")
            conn.rollback()
            # Retry once with smaller chunks
            sub_chunk_size = 25
            for j in range(0, len(chunk), sub_chunk_size):
                sub = chunk[j:j + sub_chunk_size]
                try:
                    args_str = ",".join(cur.mogrify(
                        "(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
                        (r["sku"], r["title"], r["price"], "USD", r["brand"], r["category"],
                         r["image_url"], r["url"], r["description"], r["source"], r["merchant_id"],
                         r["canonical_id"], r["metadata"], True, "ok", True)
                    ).decode() for r in sub)
                    cur.execute(f"""
                        INSERT INTO products (sku, title, price, currency, brand, category, image_url, url, description, source, merchant_id, canonical_id, metadata, is_active, url_status, is_available)
                        VALUES {args_str}
                        ON CONFLICT (sku, source) DO UPDATE SET
                            title = EXCLUDED.title,
                            price = EXCLUDED.price,
                            currency = EXCLUDED.currency,
                            brand = EXCLUDED.brand,
                            category = EXCLUDED.category,
                            image_url = EXCLUDED.image_url,
                            url = EXCLUDED.url,
                            description = EXCLUDED.description,
                            canonical_id = EXCLUDED.canonical_id,
                            metadata = EXCLUDED.metadata
                    """)
                    conn.commit()
                    total_upserted += len(sub)
                except Exception as e2:
                    print(f"    Sub-chunk retry ERROR: {e2}")
                    conn.rollback()

    cur.close()
    conn.close()
    return total_upserted


# --- Main ---
if __name__ == "__main__":
    print(f"=== {ISSUE}: {DOMAIN} ({NICHE}) ===")
    print(f"Fetching products...")
    products = fetch_products()
    print(f"Fetched {len(products)} products")

    print(f"Transforming...")
    rows = transform(products)
    print(f"Transformed {len(rows)} rows")

    print(f"Writing JSONL...")
    write_jsonl(rows)

    print(f"Uploading to R2...")
    etag = upload_r2()

    print(f"Upserting to DB...")
    upserted = db_upsert(rows)

    print(f"\n=== DONE ===")
    print(f"Products fetched: {len(products)}")
    print(f"Rows upserted: {upserted}")
    print(f"R2 ETag: {etag}")
    print(f"Issue: {ISSUE}")
