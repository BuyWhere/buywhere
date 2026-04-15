#!/usr/bin/env python3
"""Ingest catalog_mapped.ndjson and catalog_sg_deduped.ndjson into products table."""
import asyncio
import json
import uuid
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from pathlib import Path
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy import text

DB_URL = "postgresql+asyncpg://buywhere:buywhere@172.18.0.4:5432/buywhere"
BATCH_SIZE = 500

# Map catalog platform names to DB enum values
PLATFORM_MAP = {
    "lazada_sg": "lazada",
    "carousell_sg": "carousell",
    "zalora_sg": "zalora",
    "mustafa_sg": "mustafa",
    "hipvan": "merchant_direct",
    "hipvan_sg": "merchant_direct",
    "fairprice_sg": "fairprice",
    "coldstorage_sg": "coldstorage",
    "qoo10_sg": "qoo10",
    "shopee_sg": "shopee",
    "amazon_sg": "amazon_sg",
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

def record_to_row(record):
    name = record.get("name", "").strip()
    if not name:
        return None

    price_obj = record.get("price", {})
    if isinstance(price_obj, dict):
        price = safe_decimal(price_obj.get("amount"))
        currency = price_obj.get("currency", "SGD")
    else:
        price = safe_decimal(price_obj)
        currency = "SGD"

    if price is None or price <= 0:
        return None

    product_id = record.get("product_id", "")
    if not product_id:
        return None

    url = record.get("url", "")
    if not url:
        return None

    platform_raw = record.get("platform", "")
    platform = PLATFORM_MAP.get(platform_raw)
    if not platform:
        return None

    merchant_id = record.get("merchant_id", platform) or platform
    merchant_name = record.get("merchant_name", merchant_id) or merchant_id

    category = record.get("category", "")
    category_path = [category] if category else ["Uncategorized"]

    availability = "in_stock" if record.get("in_stock", True) else "out_of_stock"
    now = datetime.now(timezone.utc)

    return {
        "id": str(uuid.uuid4()),
        "sku": product_id[:500],
        "platform": platform,
        "platform_id": product_id[:500],
        "name": name[:2000],
        "description": "",
        "brand": None,
        "price": price,
        "currency": str(currency)[:3],
        "original_price": None,
        "category_path": category_path,
        "availability": availability,
        "condition": "new",
        "merchant_id": merchant_id[:500],
        "merchant_name": merchant_name[:500],
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

async def ingest_file(engine, filepath):
    total = 0
    inserted = 0
    errors = 0
    batch = []
    with open(filepath) as f:
        for line in f:
            total += 1
            try:
                record = json.loads(line)
                row = record_to_row(record)
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

    for fname in ["catalog_mapped.ndjson", "catalog_sg_deduped.ndjson"]:
        path = base / fname
        if path.exists():
            print(f"Processing {fname}...", flush=True)
            total, inserted, errors = await ingest_file(engine, path)
            print(f"  {total} records, {inserted} inserted, {errors} errors", flush=True)

    async with engine.connect() as conn:
        r = await conn.execute(text("SELECT COUNT(*) FROM products"))
        print(f"\nTotal products in DB: {r.scalar()}")
    await engine.dispose()

if __name__ == "__main__":
    asyncio.run(main())
