#!/usr/bin/env python3
"""
Backfill Price History Script

Populates the price_history table with current product prices as initial snapshots.
This should be run once after the price_history tracking was added to the ingestion pipeline.

Usage:
    python scripts/backfill_price_history.py [--dry-run]
"""

import argparse
import asyncio
import sys
from pathlib import Path
from decimal import Decimal

sys.path.insert(0, str(Path(__file__).parent.parent))

from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from app.config import get_settings


settings = get_settings()
db_url = settings.database_url
if db_url.startswith("postgres://"):
    db_url = db_url.replace("postgres://", "postgresql+asyncpg://")
elif db_url.startswith("postgresql://") and "+asyncpg" not in db_url:
    db_url = db_url.replace("postgresql://", "postgresql+asyncpg://")
engine = create_async_engine(db_url, echo=False)
AsyncSessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


async def backfill_price_history(dry_run: bool = True) -> dict:
    async with AsyncSessionLocal() as db:
        result = await db.execute(text("SELECT COUNT(*) FROM products"))
        total_products = result.scalar()

        result = await db.execute(text("SELECT COUNT(*) FROM price_history"))
        existing_history = result.scalar()

        print(f"Total products: {total_products}")
        print(f"Existing price history records: {existing_history}")
        print(f"Dry run: {dry_run}")

        if dry_run:
            print("\nDry run - would insert price history for all products.")
            print("Run with --no-dry-run to actually insert records.")
            return {"status": "dry_run", "total_products": total_products}

        insert_sql = text("""
            INSERT INTO price_history (product_id, price, currency, source, recorded_at)
            SELECT id, price, currency, source, COALESCE(data_updated_at, updated_at, created_at, NOW())
            FROM products
            WHERE price IS NOT NULL
            ON CONFLICT (product_id, source, recorded_at) DO UPDATE
            SET price = EXCLUDED.price,
                currency = EXCLUDED.currency
        """)

        result = await db.execute(insert_sql)
        await db.commit()

        result = await db.execute(text("SELECT COUNT(*) FROM price_history"))
        new_count = result.scalar()

        return {
            "status": "completed",
            "total_products": total_products,
            "records_before": existing_history,
            "records_after": new_count,
        }


async def main():
    parser = argparse.ArgumentParser(description="Backfill price history table")
    parser.add_argument("--no-dry-run", action="store_true", help="Actually insert records (default is dry-run)")
    args = parser.parse_args()

    dry_run = not args.no_dry_run

    print("=" * 60)
    print("PRICE HISTORY BACKFILL")
    print("=" * 60)

    result = await backfill_price_history(dry_run=dry_run)

    print(f"\nResult: {result}")
    print("=" * 60)


if __name__ == "__main__":
    asyncio.run(main())
