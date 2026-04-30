#!/usr/bin/env python3
"""
Bulk ingest pipeline for expansion scraper data.
Scans /home/paperclip/buywhere-api/data/ for JSONL/NDJSON files and upserts
into buywhere postgres. Dedup via (platform, sku) unique constraint.

Based on ingest_ndjson.py but configured for the buywhere-api data directory.
"""
import os
import sys
import json
import uuid
import gzip
import hashlib
from pathlib import Path
from datetime import datetime, timezone
from typing import Iterator, Dict, Any, Optional

import psycopg2
from psycopg2.extras import Json

DATA_DIRS = [
    "/home/paperclip/buywhere-api/data",
    "/home/paperclip/buywhere/data",
]
STATE_FILE = "/home/paperclip/buywhere-api/data/ingest_state.json"

# Map merchant_id / directory names to platform_enum values
PLATFORM_MAP = {
    # SG retailers
    "carousell_sg": "carousell",
    "amazon_sg": "amazon_sg",
    "lazada_sg": "lazada",
    "shopee_sg": "shopee",
    "qoo10_sg": "qoo10",
    "tangs_sg": "tangs",
    "courts_sg": "courts",
    "daiso_sg": "merchant_direct",
    "gain_city_sg": "gaincity",
    "pet_lovers_sg": "petloverscentre",
    "pet_lovers_centre_sg": "petloverscentre",
    "ikea_sg": "ikea",
    "uniqlo_sg": "uniqlo",
    "challenger_sg": "challenger",
    "decathlon_sg": "decathlon",
    "fairprice_sg": "fairprice",
    "coldstorage_sg": "coldstorage",
    "cold_storage_sg": "coldstorage",
    "guardian_sg": "guardian",
    "zalora_sg": "zalora",
    "castlery_sg": "castlery",
    "bestdenki_sg": "bestdenki",
    "metropolitan_sg": "metro",
    "giant_sg": "giant",
    "shengsiong_sg": "shengsiong",
    "mustafa_sg": "mustafa",
    "harvey_norman_sg": "harvey_norman",
    "harvey_norman": "harvey_norman",
    "fortytwo_sg": "fortytwo",
    "hipvan_sg": "hipvan",
    "sasa_sg": "sasa",
    "watsons_sg": "watsons",
    "sephora_sg": "sephora",
    "iherb_sg": "iherb",
    "nike_sg": "nike",
    "tokopedia_sg": "tokopedia",
    # Indonesia retailers
    "bukalapak_id": "bukalapak",
    # US retailers
    "nike_us": "nike_us",
    "zappos_us": "zappos_us",
    # Directory-name fallbacks
    "cold-storage": "coldstorage",
    "courts": "courts",
    "fortytwo": "fortytwo",
    "guardian": "guardian",
    "hipvan": "hipvan",
    "nike": "nike",
    "mustafa": "mustafa",
    "qoo10": "qoo10",
    "shein": "shein",
    "asos": "asos",
    "watsons": "watsons",
    "coupang": "coupang",
    "sephora": "sephora",
    "ikea": "ikea",
    "iherb": "iherb",
    "adidas": "merchant_direct",
    "hm": "merchant_direct",
    # International
    "amazon-us": "amazon_us",
    "amazon_us": "amazon_us",
    "tiki_vn": "tiki_vn",
}

BATCH_SIZE = 1000


def resolve_platform(merchant_id: str, filepath: str) -> Optional[str]:
    """Resolve merchant_id + filepath to a valid platform_enum value."""
    mid = (merchant_id or "").lower().strip()
    if mid in PLATFORM_MAP:
        return PLATFORM_MAP[mid]

    # Try directory name
    parts = filepath.replace("\\", "/").split("/")
    for part in reversed(parts):
        p = part.lower().strip()
        if p in PLATFORM_MAP:
            return PLATFORM_MAP[p]

    # Try stripping _sg suffix
    if mid.endswith("_sg"):
        base = mid[:-3]
        if base in PLATFORM_MAP:
            return PLATFORM_MAP[base]

    return mid if mid else None


def derive_sku(record: Dict[str, Any], platform: str) -> str:
    if record.get("sku"):
        return str(record["sku"])[:100]
    if record.get("product_id"):
        return f"{platform}:{record['product_id']}"
    url = record.get("url") or record.get("product_url") or ""
    if url:
        h = hashlib.md5(url.encode()).hexdigest()[:16]
        return f"{platform}:{h}"
    name = record.get("name") or record.get("title") or ""
    h = hashlib.md5(name.encode()).hexdigest()[:16]
    return f"{platform}:{h}"


def make_uuid(platform: str, sku: str) -> str:
    src = f"{platform}:{sku}".encode()
    return str(uuid.UUID(bytes=hashlib.md5(src).digest()[:16]))


def normalize_record(record: Dict[str, Any], platform: str) -> Optional[Dict[str, Any]]:
    name = record.get("name") or record.get("title") or record.get("product_name") or ""
    if not name:
        return None

    sku = derive_sku(record, platform)
    pid = make_uuid(platform, sku)

    price = record.get("price")
    if isinstance(price, dict):
        price = price.get("amount", 0)
    try:
        price = float(price) if price is not None else 0
    except (ValueError, TypeError):
        price = 0

    currency = record.get("currency", "SGD")
    if isinstance(currency, dict):
        currency = currency.get("currency", "SGD")

    metadata = record.get("metadata") or {}
    if not isinstance(metadata, dict):
        metadata = {}

    raw_price = record.get("original_price") or record.get("list_price") or metadata.get("original_price")
    if raw_price:
        if isinstance(raw_price, dict):
            raw_price = raw_price.get("amount", raw_price)
        try:
            raw_price = float(raw_price)
        except (ValueError, TypeError):
            raw_price = None

    category = record.get("category_path") or record.get("category") or []
    if isinstance(category, str):
        category = [category]
    elif category and not isinstance(category, list):
        category = [str(category)]

    availability = "in_stock"
    if record.get("is_active") is False or record.get("in_stock") is False:
        availability = "out_of_stock"
    elif record.get("availability") in ("out_of_stock", "preorder", "discontinued"):
        availability = record["availability"]

    brand = record.get("brand") or ""
    if isinstance(brand, list):
        brand = brand[0] if brand else ""

    image_url = record.get("image_url") or record.get("main_image") or ""
    images = record.get("images") or metadata.get("images") or []
    if image_url and images and image_url not in images:
        images = [image_url] + list(images)
    elif image_url and not images:
        images = [image_url]

    product_url = record.get("url") or record.get("product_url") or ""
    if isinstance(product_url, list):
        product_url = product_url[0] if product_url else ""

    merchant_id = record.get("merchant_id") or platform
    merchant_name = record.get("merchant_name") or record.get("seller") or record.get("store") or ""

    scraped_str = record.get("scraped_at") or record.get("indexed_at") or record.get("created_at")
    if scraped_str:
        try:
            indexed_at = datetime.fromisoformat(str(scraped_str).replace("Z", "+00:00"))
        except Exception:
            indexed_at = datetime.now(timezone.utc)
    else:
        indexed_at = datetime.now(timezone.utc)

    # Determine locale from region/country_code
    region = record.get("region") or metadata.get("region") or ""
    country_code = record.get("country_code") or metadata.get("country_code") or ""
    if country_code.upper() == "US" or region.lower() == "us":
        locale = "en-US"
    elif country_code.upper() == "KR" or region.lower() == "kr":
        locale = "ko-KR"
    elif country_code.upper() == "SG" or region.lower() == "sg":
        locale = "en-SG"
    elif country_code.upper() == "VN" or region.lower() == "vn" or str(currency).upper() == "VND":
        locale = "vi-VN"
    else:
        locale = "en-SG"  # default

    attributes = {}
    for key in ("metadata", "specs", "specifications", "features", "properties"):
        if key in record and isinstance(record[key], dict):
            attributes.update(record[key])
    # Remove keys we already extracted
    for k in ("original_price", "images", "source", "region", "country_code"):
        attributes.pop(k, None)

    return {
        "id": pid,
        "sku": sku,
        "platform": platform,
        "platform_id": record.get("product_id") or record.get("id") or "",
        "name": str(name)[:500],
        "description": str(record.get("description") or "")[:5000],
        "brand": str(brand)[:200],
        "price": price,
        "currency": str(currency)[:3],
        "original_price": raw_price,
        "category_path": category[:20],
        "availability": availability,
        "condition": record.get("condition") or "new",
        "merchant_id": str(merchant_id)[:100],
        "merchant_name": str(merchant_name)[:200],
        "image_url": str(image_url)[:1000],
        "images": [str(i)[:1000] for i in images[:20]],
        "rating": record.get("rating"),
        "review_count": record.get("review_count") or record.get("reviews"),
        "tags": record.get("tags") or [],
        "attributes": Json(attributes) if attributes else None,
        "weight_kg": record.get("weight_kg") or record.get("weight"),
        "dimensions_cm": Json(record.get("dimensions_cm") or record.get("dimensions")) if record.get("dimensions_cm") or record.get("dimensions") else None,
        "shipping_info": Json(record.get("shipping_info") or record.get("shipping")) if record.get("shipping_info") or record.get("shipping") else None,
        "product_url": str(product_url)[:2000],
        "indexed_at": indexed_at,
        "updated_at": datetime.now(timezone.utc),
        "locale": locale,
        "display_name": record.get("display_name") or record.get("title") or "",
        "original_name": record.get("original_name") or "",
        "deal_score": record.get("deal_score"),
        "is_deal": bool(record.get("is_deal") or record.get("on_sale")),
        "deal_computed_at": None,
    }


INSERT_SQL = """
INSERT INTO products (
    id, sku, platform, platform_id, name, description, brand,
    price, currency, original_price, category_path, availability,
    condition, merchant_id, merchant_name, image_url, images,
    rating, review_count, tags, attributes, weight_kg, dimensions_cm,
    shipping_info, product_url, indexed_at, updated_at, locale,
    display_name, original_name, deal_score, is_deal, deal_computed_at
) VALUES (
    %(id)s, %(sku)s, %(platform)s, %(platform_id)s, %(name)s, %(description)s, %(brand)s,
    %(price)s, %(currency)s, %(original_price)s, %(category_path)s, %(availability)s,
    %(condition)s, %(merchant_id)s, %(merchant_name)s, %(image_url)s, %(images)s,
    %(rating)s, %(review_count)s, %(tags)s, %(attributes)s, %(weight_kg)s, %(dimensions_cm)s,
    %(shipping_info)s, %(product_url)s, %(indexed_at)s, %(updated_at)s, %(locale)s,
    %(display_name)s, %(original_name)s, %(deal_score)s, %(is_deal)s, %(deal_computed_at)s
) ON CONFLICT (platform, sku) DO UPDATE SET
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    brand = EXCLUDED.brand,
    price = EXCLUDED.price,
    currency = EXCLUDED.currency,
    original_price = EXCLUDED.original_price,
    category_path = EXCLUDED.category_path,
    availability = EXCLUDED.availability,
    condition = EXCLUDED.condition,
    merchant_id = EXCLUDED.merchant_id,
    merchant_name = EXCLUDED.merchant_name,
    image_url = EXCLUDED.image_url,
    images = EXCLUDED.images,
    rating = EXCLUDED.rating,
    review_count = EXCLUDED.review_count,
    tags = EXCLUDED.tags,
    attributes = EXCLUDED.attributes,
    weight_kg = EXCLUDED.weight_kg,
    dimensions_cm = EXCLUDED.dimensions_cm,
    shipping_info = EXCLUDED.shipping_info,
    product_url = EXCLUDED.product_url,
    updated_at = EXCLUDED.updated_at,
    locale = EXCLUDED.locale,
    display_name = EXCLUDED.display_name,
    original_name = EXCLUDED.original_name,
    deal_score = EXCLUDED.deal_score,
    is_deal = EXCLUDED.is_deal,
    deal_computed_at = EXCLUDED.deal_computed_at
"""


def load_state() -> Dict[str, Any]:
    merged = {}
    # Load both state files to avoid re-processing
    for sf in [STATE_FILE, "/home/paperclip/buywhere/.ingest_state.json"]:
        try:
            with open(sf, "r") as f:
                data = json.load(f)
                entries = data.get("processed", data)
                merged.update(entries)
        except (FileNotFoundError, json.JSONDecodeError):
            pass
    return merged


def save_state(state: Dict[str, Any]):
    with open(STATE_FILE, "w") as f:
        json.dump({"processed": state}, f, indent=2)


def file_fingerprint(fpath: str) -> Dict[str, Any]:
    stat = os.stat(fpath)
    return {"size": stat.st_size, "mtime": stat.st_mtime}


def find_files(force: bool = False) -> list:
    state = load_state() if not force else {}
    files = []
    for data_dir in DATA_DIRS:
        if not os.path.exists(data_dir):
            continue
        for root, _, filenames in os.walk(data_dir):
            for fname in filenames:
                if not fname.endswith((".jsonl", ".ndjson")):
                    continue
                fpath = os.path.join(root, fname)
                try:
                    if os.path.getsize(fpath) == 0:
                        continue
                    if not force and fpath in state:
                        prev = state[fpath]
                        if isinstance(prev, dict):
                            fp = file_fingerprint(fpath)
                            if fp["size"] == prev.get("size") and fp["mtime"] == prev.get("mtime"):
                                continue
                        else:
                            continue
                    files.append(fpath)
                except FileNotFoundError:
                    continue
    return sorted(files)


def read_jsonl(filepath: str) -> Iterator[Dict[str, Any]]:
    opener = gzip.open if filepath.endswith(".gz") else open
    mode = "rt" if filepath.endswith(".gz") else "r"
    with opener(filepath, mode, encoding="utf-8", errors="replace") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                yield json.loads(line)
            except json.JSONDecodeError:
                continue


def ingest_file(conn, cur, filepath: str) -> tuple:
    """Returns (seen, ingested, skipped, errors)."""
    fname = os.path.basename(filepath)
    batch = []
    seen = 0
    errors = 0
    skipped = 0

    for record in read_jsonl(filepath):
        seen += 1
        try:
            merchant_id = record.get("merchant_id") or ""
            platform = resolve_platform(merchant_id, filepath)
            if not platform:
                skipped += 1
                continue

            name = record.get("name") or record.get("title") or ""
            if not name:
                skipped += 1
                continue

            normalized = normalize_record(record, platform)
            if not normalized:
                skipped += 1
                continue

            batch.append(normalized)

            if len(batch) >= BATCH_SIZE:
                cur.executemany(INSERT_SQL, batch)
                conn.commit()
                print(f"  {fname}: {seen} seen, batch of {len(batch)} upserted", flush=True)
                batch = []
        except Exception as e:
            errors += 1
            if errors <= 3:
                print(f"  ERROR [{fname}]: {e}", flush=True)

    ingested = seen - skipped - errors
    if batch:
        try:
            cur.executemany(INSERT_SQL, batch)
            conn.commit()
        except Exception as e:
            conn.rollback()
            print(f"  BATCH ERROR [{fname}]: {e}", flush=True)
            errors += len(batch)
            ingested -= len(batch)

    return seen, max(ingested, 0), skipped, errors


def main():
    pg_host = os.environ.get("PGHOST", "172.18.0.4")
    conn = psycopg2.connect(
        host=pg_host,
        dbname=os.environ.get("PGDATABASE", "buywhere_new"),
        user="buywhere",
        password="buywhere",
        port=5432,
    )
    conn.autocommit = False

    force = "--force" in sys.argv

    # Get initial count
    cur = conn.cursor()
    cur.execute("SELECT COUNT(*) FROM products")
    initial_count = cur.fetchone()[0]
    print(f"Initial product count: {initial_count:,}", flush=True)

    files = find_files(force=force)
    print(f"\nFound {len(files)} files to process", flush=True)
    for f in files[:15]:
        print(f"  {f}", flush=True)
    if len(files) > 15:
        print(f"  ... and {len(files) - 15} more", flush=True)

    if not files:
        print("\nNothing new to ingest. Use --force to re-process all.", flush=True)
        conn.close()
        return

    state = load_state()
    total_seen = 0
    total_ingested = 0
    total_skipped = 0
    total_errors = 0

    for filepath in files:
        print(f"\nProcessing: {filepath}", flush=True)
        fp = file_fingerprint(filepath)

        seen, ingested, skipped, errors = ingest_file(conn, cur, filepath)
        total_seen += seen
        total_ingested += ingested
        total_skipped += skipped
        total_errors += errors

        print(f"  Done: {seen} seen, {ingested} ingested, {skipped} skipped, {errors} errors", flush=True)

        state[filepath] = {
            **fp,
            "ingested": ingested,
            "at": datetime.now(timezone.utc).isoformat(),
        }
        save_state(state)

    # Final count
    cur.execute("SELECT COUNT(*) FROM products")
    final_count = cur.fetchone()[0]

    print(f"\n{'=' * 60}")
    print(f"BULK INGESTION COMPLETE")
    print(f"{'=' * 60}")
    print(f"Files processed:     {len(files)}")
    print(f"Records seen:        {total_seen:,}")
    print(f"Records ingested:    {total_ingested:,}")
    print(f"Records skipped:     {total_skipped:,}")
    print(f"Errors:              {total_errors:,}")
    print(f"DB before:           {initial_count:,}")
    print(f"DB after:            {final_count:,}")
    print(f"Net new products:    {final_count - initial_count:,}")
    print(f"{'=' * 60}")

    cur.close()
    conn.close()


if __name__ == "__main__":
    main()
