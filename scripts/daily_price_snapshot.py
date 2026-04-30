#!/usr/bin/env python3
"""
Daily Price Snapshot Script

Creates daily price snapshots for all active products in the price_history table.
This ensures we have price data even for products that weren't scraped that day.

Usage:
    python scripts/daily_price_snapshot.py [--dry-run]

Cron example (daily at 1am):
    0 1 * * * cd /home/paperclip/buywhere-api && python scripts/daily_price_snapshot.py

"""

import argparse
import asyncio
import logging
import sys
from datetime import datetime, time, timezone, date
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

logging.basicConfig(level=logging.INFO, format='[%(asctime)s] %(levelname)s %(message)s')
logger = logging.getLogger("daily_price_snapshot")


async def create_daily_snapshot(dry_run: bool = True, batch_size: int = 1000) -> dict:
    """
    Create daily price snapshots for all active products.

    Only creates a snapshot if:
    1. The product has a price
    2. There isn't already a snapshot for this product today
    """
    async with AsyncSessionLocal() as db:
        today = date.today()
        snapshot_recorded_at = datetime.combine(today, time.min, tzinfo=timezone.utc)
        logger.info(f"Starting daily price snapshot for {today}")

        if dry_run:
            count_result = await db.execute(text("""
                SELECT COUNT(*)
                FROM products p
                WHERE p.price IS NOT NULL
                AND p.is_active = true
                AND NOT EXISTS (
                    SELECT 1 FROM price_history ph
                    WHERE ph.product_id = p.id
                    AND DATE(ph.recorded_at) = :today
                )
            """), {"today": today})
            pending_count = count_result.scalar()
            logger.info(f"[DRY RUN] Would create {pending_count} price snapshots")
            return {"status": "dry_run", "pending_snapshots": pending_count}

        offset = 0
        total_upserted = 0

        while True:
            result = await db.execute(text("""
                SELECT p.id, p.price, p.currency, p.source
                FROM products p
                WHERE p.price IS NOT NULL
                AND p.is_active = true
                ORDER BY p.id
                LIMIT :batch_size
                OFFSET :offset
            """), {"batch_size": batch_size, "offset": offset})

            rows = result.fetchall()
            if not rows:
                break

            price_history_records = [
                {
                    "product_id": row.id,
                    "price": row.price,
                    "currency": row.currency,
                    "source": row.source,
                    "recorded_at": snapshot_recorded_at,
                }
                for row in rows
            ]

            await db.execute(
                text("""
                    INSERT INTO price_history (product_id, price, currency, source, recorded_at)
                    VALUES (:product_id, :price, :currency, :source, :recorded_at)
                    ON CONFLICT (product_id, source, recorded_at) DO UPDATE
                    SET price = EXCLUDED.price,
                        currency = EXCLUDED.currency
                """),
                price_history_records
            )

            total_upserted += len(rows)
            offset += batch_size
            logger.info(f"  Upserted {len(rows)} records (total: {total_upserted})")

        await db.commit()

        final_result = await db.execute(text("SELECT COUNT(*) FROM price_history WHERE DATE(recorded_at) = :today"), {"today": today})
        total_today = final_result.scalar()

        return {
            "status": "completed",
            "date": str(today),
            "snapshots_upserted": total_upserted,
            "total_snapshots_today": total_today,
        }


async def main():
    parser = argparse.ArgumentParser(description="Daily price snapshot")
    parser.add_argument("--dry-run", action="store_true", default=True, help="Dry run mode (default)")
    parser.add_argument("--no-dry-run", action="store_true", help="Actually insert records")
    parser.add_argument("--batch-size", type=int, default=1000, help="Batch size for inserts")
    args = parser.parse_args()

    dry_run = not args.no_dry_run
    batch_size = args.batch_size

    logger.info("=" * 60)
    logger.info("DAILY PRICE SNAPSHOT")
    logger.info("=" * 60)
    logger.info(f"Dry run: {dry_run}")
    logger.info(f"Batch size: {batch_size}")

    result = await create_daily_snapshot(dry_run=dry_run, batch_size=batch_size)

    logger.info(f"Result: {result}")
    logger.info("=" * 60)


if __name__ == "__main__":
    asyncio.run(main())
