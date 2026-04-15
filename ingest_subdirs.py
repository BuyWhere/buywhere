#!/usr/bin/env python3
"""Ingest JSONL files from data subdirectories into products table."""
import asyncio
import json
import uuid
import os
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from pathlib import Path
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy import text

DB_URL = "postgresql+asyncpg://buywhere:buywhere@172.18.0.4:5432/buywhere"
BATCH_SIZE = 500

DIR_PLATFORM = {
    "metro": "metro",
    "courts": "courts",
    "cold-storage": "coldstorage",
    "raw/coldstorage_sg": "coldstorage",
    "challenger": "challenger",
    "harvey-norman": "harvey_norman",
    "nike": "nike",
    "fortytwo": "fortytwo",
    "decathlon": "decathlon",
    "guardian": "guardian",
    "popular": "popular",
    "uniqlo": "uniqlo",
    "tiki-vn": "merchant_direct",
    "vuori": "vuori",
    "giant": "giant",
    "fairprice_sg": "fairprice",
    "fairprice_validation": "fairprice",
    "hm": "merchant_direct",
    "ikea": "ikea",
    "iherb_sg": "iherb",
    "carousell": "carousell",
    "ebay_sg": "merchant_direct",
    "charleskeith": "merchant_direct",
    "amazon_sg_toys": "amazon_sg",
}

def safe_decimal(val):
    if val is None or val == "" or val == "None":
        return None
    try:
        d = Decimal(str(val))
        return d if 0 < d < 99999999 else None
    except (InvalidOperation, ValueError, TypeError):
        return None

def record_to_row(record, platform):
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
    merchant_id = record.get("merchant_id", platform) or platform
    category_path = record.get("category_path") or []
    if not category_path and record.get("category"):
        category_path = [record["category"]]
    if not category_path:
        category_path = ["Uncategorized"]
    availability = "in_stock"
    if record.get("is_active") is False:
        availability = "out_of_stock"
    brand = record.get("brand", "")
    if isinstance(brand, dict):
        brand = brand.get("name", "")
    now = datetime.now(timezone.utc)
    return {
        "id": str(uuid.uuid4()),
        "sku": sku[:500],
        "platform": platform,
        "platform_id": sku[:500],
        "name": title[:2000],
        "description": (record.get("description") or "")[:5000],
        "brand": brand or None,
        "price": price,
        "currency": record.get("currency", "SGD")[:3],
        "original_price": safe_decimal(record.get("original_price")),
        "category_path": category_path,
        "availability": availability,
        "condition": "new",
        "merchant_id": merchant_id[:500],
        "merchant_name": (record.get("merchant_name") or merchant_id)[:500],
        "image_url": record.get("image_url"),
        "images": [record.get("image_url")] if record.get("image_url") else [],
        "rating": None,
        "review_count": None,
        "tags": [],
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
        availability = EXCLUDED.availability,
        updated_at = EXCLUDED.updated_at
""")

async def ingest_file(engine, filepath, platform):
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
            except Exception:
                errors += 1
                continue
            if len(batch) >= BATCH_SIZE:
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
                batch = []
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
    base = Path("/home/paperclip/buywhere-api/data")
    grand_total = 0
    grand_inserted = 0

    for dir_key, platform in sorted(DIR_PLATFORM.items()):
        search_dir = base / dir_key
        files = list(search_dir.rglob("*.jsonl"))
        if not files:
            continue
        for filepath in sorted(files):
            print(f"Processing {filepath.relative_to(base)} -> {platform}...", flush=True)
            total, inserted, errors = await ingest_file(engine, filepath, platform)
            grand_total += total
            grand_inserted += inserted
            print(f"  {total} records, {inserted} inserted, {errors} errors", flush=True)

    print(f"\n=== SUBDIR INGEST: {grand_total} records, {grand_inserted} inserted ===")
    async with engine.connect() as conn:
        r = await conn.execute(text("SELECT COUNT(*) FROM products"))
        print(f"Total products in DB: {r.scalar()}")
    await engine.dispose()

if __name__ == "__main__":
    asyncio.run(main())
