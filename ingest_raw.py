#!/usr/bin/env python3
"""Ingest raw scraper JSONL files from data/scraped/ and data/amazon_sg/."""
import asyncio
import json
import sys
import uuid
import glob
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from pathlib import Path
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy import text

DB_URL = "postgresql+asyncpg://buywhere:buywhere@172.18.0.4:5432/buywhere"
BATCH_SIZE = 500

# Determine platform from filename
def get_platform(filename):
    fname = filename.lower()
    if 'challenger' in fname:
        return 'challenger'
    if 'courts' in fname:
        return 'courts'
    if 'harvey' in fname:
        return 'harvey_norman'
    if 'bestdenki' in fname or 'best_denki' in fname or 'best-denki' in fname:
        return 'bestdenki'
    if 'giant' in fname:
        return 'giant'
    if 'fairprice' in fname:
        return 'fairprice'
    if 'amazon' in fname or 'books' in fname or 'products' in fname:
        return 'amazon_sg'
    if 'shopee' in fname:
        return 'shopee'
    if 'shengsiong' in fname:
        return 'shengsiong'
    if 'decathlon' in fname:
        return 'decathlon'
    if 'sasa' in fname:
        return 'sasa'
    return 'amazon_sg'  # default for scraped data

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
    metadata = record.get("metadata") or {}
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
        "platform_id": str(metadata.get("product_id", sku))[:500],
        "name": title[:2000],
        "description": (record.get("description") or "")[:5000],
        "brand": brand or None,
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
        original_price = EXCLUDED.original_price,
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

    base = Path("/home/paperclip/buywhere-api")
    files = sorted(base.glob("data/scraped/*.jsonl")) + sorted(base.glob("data/amazon_sg/*.jsonl"))

    grand_total = 0
    grand_inserted = 0
    for filepath in files:
        platform = get_platform(filepath.name)
        print(f"Processing {filepath.name} -> {platform}...", flush=True)
        total, inserted, errors = await ingest_file(engine, filepath, platform)
        grand_total += total
        grand_inserted += inserted
        print(f"  {total} records, {inserted} inserted, {errors} errors", flush=True)

    print(f"\n=== RAW INGEST: {grand_total} records, {grand_inserted} inserted ===")
    async with engine.connect() as conn:
        r = await conn.execute(text("SELECT COUNT(*) FROM products"))
        print(f"Total products in DB: {r.scalar()}")
    await engine.dispose()

if __name__ == "__main__":
    asyncio.run(main())
