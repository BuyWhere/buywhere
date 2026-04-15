#!/usr/bin/env python3
"""Bulk ingest normalized NDJSON files into the BuyWhere products table.

Reads from /home/paperclip/buywhere-api/data/normalized/*.ndjson
Inserts directly into PostgreSQL using the Docker API's schema.
"""
import asyncio
import json
import sys
import uuid
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from pathlib import Path

from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy import text

DB_URL = "postgresql+asyncpg://buywhere:buywhere@172.18.0.4:5432/buywhere"
DATA_DIR = Path("/home/paperclip/buywhere-api/data/normalized")
BATCH_SIZE = 500

# Map normalized file stems to platform enum values
PLATFORM_MAP = {
    "amazon_sg": "amazon_sg",
    "courts": "courts",
    "challenger": "challenger",
    "cold-storage": "coldstorage",
    "cold_storage": "coldstorage",
    "decathlon": "decathlon",
    "fairprice_sg": "fairprice",
    "fairprice_validation": "fairprice",
    "fortytwo": "fortytwo",
    "giant": "giant",
    "guardian": "guardian",
    "harvey-norman": "harvey_norman",
    "harvey_norman": "harvey_norman",
    "lovebonito": "lovebonito",
    "metro": "metro",
    "nike": "nike",
    "popular": "popular",
    "scraped": "amazon_sg",  # scraped folder is Amazon SG data
    "tangs": "merchant_direct",
    "uniqlo": "uniqlo",
    "vuori": "vuori",
    "sephora": "merchant_direct",
    "tiki-vn": "merchant_direct",
    "normalized_sg": "amazon_sg",  # large aggregate of Amazon SG products
    "robinsons": "merchant_direct",
    "iherb": "iherb",
}


def safe_decimal(val):
    if val is None or val == "" or val == "None":
        return None
    try:
        d = Decimal(str(val))
        if d > 99999999:
            return None
        return d
    except (InvalidOperation, ValueError, TypeError):
        return None


def safe_float(val):
    if val is None or val == "":
        return None
    try:
        f = float(val)
        if f > 5.0 or f < 0:
            return None
        return f
    except (ValueError, TypeError):
        return None


def safe_int(val):
    if val is None or val == "":
        return None
    try:
        return int(val)
    except (ValueError, TypeError):
        return None


def record_to_row(record: dict, platform: str) -> dict | None:
    """Convert a normalized NDJSON record to a products table row."""
    title = record.get("title", "").strip()
    if not title:
        return None

    price = safe_decimal(record.get("price"))
    if price is None or price <= 0:
        return None

    sku = record.get("sku", "")
    if not sku:
        return None

    url = record.get("url", "")
    if not url:
        return None

    merchant_id = record.get("merchant_id", platform)
    if not merchant_id:
        merchant_id = platform

    metadata = record.get("metadata") or {}
    category_path = record.get("category_path") or []
    if not category_path and record.get("category"):
        category_path = [record["category"]]
    if not category_path:
        category_path = ["Uncategorized"]

    availability = "in_stock"
    if record.get("is_active") is False or record.get("is_available") is False or record.get("in_stock") is False:
        availability = "out_of_stock"

    rating = safe_float(metadata.get("rating") if isinstance(metadata.get("rating"), (int, float)) else
                        (metadata.get("rating", {}).get("average") if isinstance(metadata.get("rating"), dict) else None))
    if rating is None:
        rating = safe_float(record.get("rating"))

    now = datetime.now(timezone.utc)

    brand = record.get("brand", "")
    if isinstance(brand, dict):
        brand = brand.get("name", "")

    return {
        "id": str(uuid.uuid4()),
        "sku": sku[:500],
        "platform": platform,
        "platform_id": str(metadata.get("product_id", sku))[:500],
        "name": title[:2000],
        "description": (record.get("description") or "")[:5000],
        "brand": (brand or None),
        "price": price,
        "currency": record.get("currency", "SGD")[:3],
        "original_price": safe_decimal(metadata.get("original_price") or record.get("original_price")),
        "category_path": category_path,
        "availability": availability,
        "condition": "new",
        "merchant_id": merchant_id[:500],
        "merchant_name": str(metadata.get("seller_name") or metadata.get("merchant_name") or merchant_id)[:500],
        "image_url": record.get("image_url"),
        "images": [record.get("image_url")] if record.get("image_url") else [],
        "rating": rating,
        "review_count": safe_int(metadata.get("review_count") or record.get("review_count")),
        "tags": metadata.get("tags", []) if isinstance(metadata.get("tags"), list) else [],
        "product_url": url[:2000],
        "indexed_at": now,
        "updated_at": now,
        "is_deal": False,
    }


INSERT_SQL = text("""
    INSERT INTO products (
        id, sku, platform, platform_id, name, description, brand, price,
        currency, original_price, category_path, availability, condition,
        merchant_id, merchant_name, image_url, images, rating, review_count,
        tags, product_url, indexed_at, updated_at, is_deal
    ) VALUES (
        :id, :sku, :platform, :platform_id, :name, :description, :brand, :price,
        :currency, :original_price, :category_path, :availability, :condition,
        :merchant_id, :merchant_name, :image_url, :images, :rating, :review_count,
        :tags, :product_url, :indexed_at, :updated_at, :is_deal
    )
    ON CONFLICT (platform, sku) DO UPDATE SET
        name = EXCLUDED.name,
        price = EXCLUDED.price,
        original_price = EXCLUDED.original_price,
        availability = EXCLUDED.availability,
        updated_at = EXCLUDED.updated_at
""")


async def ingest_file(engine, filepath: Path, platform: str):
    """Ingest a single normalized NDJSON file."""
    total = 0
    inserted = 0
    errors = 0
    batch = []

    with open(filepath) as f:
        for line in f:
            total += 1
            try:
                record = json.loads(line)
                row = record_to_row(record, platform)
                if row is None:
                    errors += 1
                    continue
                batch.append(row)
            except (json.JSONDecodeError, Exception):
                errors += 1
                continue

            if len(batch) >= BATCH_SIZE:
                async with engine.begin() as conn:
                    try:
                        await conn.execute(INSERT_SQL, batch)
                        inserted += len(batch)
                    except Exception as e:
                        # Try one-by-one fallback
                        for row in batch:
                            try:
                                await conn.execute(INSERT_SQL, [row])
                                inserted += 1
                            except Exception:
                                errors += 1
                batch = []

    # Final batch
    if batch:
        async with engine.begin() as conn:
            try:
                await conn.execute(INSERT_SQL, batch)
                inserted += len(batch)
            except Exception:
                for row in batch:
                    try:
                        await conn.execute(INSERT_SQL, [row])
                        inserted += 1
                    except Exception:
                        errors += 1

    return total, inserted, errors


async def main():
    engine = create_async_engine(DB_URL, pool_size=5, max_overflow=5)

    # Get list of files to process
    files = sorted(DATA_DIR.glob("*_normalized.ndjson"))

    grand_total = 0
    grand_inserted = 0
    grand_errors = 0

    for filepath in files:
        stem = filepath.stem.replace("_normalized", "")
        platform = PLATFORM_MAP.get(stem)

        if platform is None:
            print(f"SKIP {filepath.name} (no platform mapping or aggregate)")
            continue

        print(f"Processing {filepath.name} -> platform={platform}...", flush=True)
        total, inserted, errors = await ingest_file(engine, filepath, platform)
        grand_total += total
        grand_inserted += inserted
        grand_errors += errors
        print(f"  {total} records, {inserted} inserted, {errors} errors", flush=True)

    print(f"\n=== TOTAL: {grand_total} records, {grand_inserted} inserted, {grand_errors} errors ===")

    # Final count
    async with engine.connect() as conn:
        r = await conn.execute(text("SELECT COUNT(*) FROM products"))
        print(f"Products in DB: {r.scalar()}")

    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
