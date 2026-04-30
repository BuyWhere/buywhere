#!/usr/bin/env python3
"""
Automated Ingestion Cron - watches normalized data directory and auto-ingests new files.

Watches /home/paperclip/buywhere-api/data/normalized/ for new *_normalized.ndjson files and
automatically ingests them into the database using direct DB insertion (bypassing the API
to avoid network latency and API availability issues).

Designed to run as a cron job every 30 minutes or as a systemd timer.

Usage:
    python scripts/ingestion_cron.py              # Run once and exit
    python scripts/ingestion_cron.py --continuous  # Run continuously (for systemd service)
    python scripts/ingestion_cron.py --watch-dir /path/to/watch
"""

import argparse
import asyncio
import fcntl
import json
import logging
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).parent.parent))
sys.path.insert(0, "/app/src")

from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker

from app.config import get_settings
settings = get_settings()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
log = logging.getLogger("ingestion_cron")

LOCK_FILE = "/tmp/buywhere_ingestion_cron.lock"
STATE_FILE = "/tmp/ingestion_cron_state.json"
CHECK_INTERVAL = 1800  # 30 minutes

PLATFORM_SOURCE_MAPPING = {
    "carousell": "carousell",
    "carousell_sg": "carousell",
    "fairprice": "fairprice",
    "fairprice_sg": "fairprice",
    "guardian": "guardian",
    "guardian_sg": "guardian",
    "courts": "courts",
    "courts_sg": "courts",
    "harvey-norman": "harvey_norman",
    "harvey_norman": "harvey_norman",
    "shengsiong": "shengsiong",
    "shengsiong_sg": "shengsiong",
    "mothercare_sg": "mothercare",
    "qoo10": "qoo10",
    "qoo10_sg": "qoo10",
    "zalora_sg": "zalora",
    "robinsons": "robinsons",
    "robinsons_sg": "robinsons",
    "normalized": None,
    "scraped": None,
    "amazon_sg": "amazon_sg",
    "amazon": "amazon_sg",
    "amazon_sg_baby": "amazon_sg",
    "amazon_sg_beauty": "amazon_sg",
    "amazon_sg_books": "amazon_sg",
    "amazon_sg_electronics": "amazon_sg",
    "amazon_sg_fashion": "amazon_sg",
    "amazon_sg_garden": "amazon_sg",
    "amazon_sg_grocery": "amazon_sg",
    "amazon_sg_home_kitchen": "amazon_sg",
    "amazon_sg_office": "amazon_sg",
    "amazon_sg_pets": "amazon_sg",
    "amazon_sg_sports": "amazon_sg",
    "amazon_sg_tools": "amazon_sg",
    "amazon_sg_toys": "amazon_sg",
    "lazada": "lazada",
    "lazada_sg": "lazada",
    "shopee": "shopee",
    "shopee_sg": "shopee",
    "qoo10": "qoo10",
    "mustafa": "mustafa",
    "mustafa_sg": "mustafa",
    "coldstorage": "coldstorage",
    "coldstorage_sg": "coldstorage",
    "popular": "popular",
    "popular_sg": "popular",
    "metro": "metro",
    "metro_sg": "metro",
    "ishopchangi": "ishopchangi",
    "challenger": "challenger",
    "challenger_sg": "challenger",
    "decathlon": "decathlon",
    "decathlon_sg": "decathlon",
    "tiki": "tiki",
    "tangs": "tangs",
    "tangs_sg": "tangs",
    "fortytwo": "fortytwo",
    "fortytwo_sg": "fortytwo",
    "hipvan": "hipvan",
    "hipvan_sg": "hipvan",
    "uniqlo": "uniqlo",
    "uniqlo_sg": "uniqlo",
    "shein": "shein",
    "shein_sg": "shein",
    "nike": "nike",
    "nike_sg": "nike",
    "asos": "asos",
    "asos_sg": "asos",
    "ikea": "ikea",
    "ikea_sg": "ikea",
    "watsons": "watsons",
    "watsons_sg": "watsons",
    "bestdenki": "bestdenki",
    "bestdenki_sg": "bestdenki",
    "giant": "giant",
    "giant_sg": "giant",
    "redmart": "redmart",
    "redmart_sg": "redmart",
    "lovebonito": "lovebonito",
    "lovebonito_sg": "lovebonito",
    "hm": "hm",
    "hm_sg": "hm",
    "ebay": "ebay",
    "ebay_sg": "ebay",
    "flipkart": "flipkart",
    "flipkart_in": "flipkart",
    "tokopedia": "tokopedia",
    "tokopedia_id": "tokopedia",
    "bukalapak": "bukalapak",
    "bukalapak_id": "bukalapak",
    "jd": "jd",
    "jd_id": "jd",
    "lazada_my": "lazada",
    "lazada_ph": "lazada",
    "lazada_th": "lazada",
    "shopee_my": "shopee",
    "shopee_ph": "shopee",
    "shopee_th": "shopee",
    "shopee_vn": "shopee",
}

async_engine = None
AsyncSessionLocal = None


def get_async_engine():
    global async_engine, AsyncSessionLocal
    if async_engine is None:
        db_url = os.environ.get("DATABASE_URL") or settings.database_url
        if "paperclip" in db_url or "localhost" in db_url:
            db_url = "postgresql+asyncpg://buywhere:buywhere@172.18.0.4:5432/buywhere_new"
        if db_url.startswith("postgres://"):
            db_url = db_url.replace("postgres://", "postgresql+asyncpg://", 1)
        elif db_url.startswith("postgresql://"):
            db_url = db_url.replace("postgresql://", "postgresql+asyncpg://", 1)
        async_engine = create_async_engine(db_url, echo=False, pool_size=5, max_overflow=10)
        AsyncSessionLocal = sessionmaker(async_engine, class_=AsyncSession, expire_on_commit=False)
    return async_engine


def load_state() -> dict:
    if Path(STATE_FILE).exists():
        try:
            with open(STATE_FILE) as f:
                return json.load(f)
        except Exception:
            pass
    return {"last_ingested": {}, "ingestion_log": []}


def save_state(state: dict) -> None:
    with open(STATE_FILE, "w") as f:
        json.dump(state, f, indent=2)


def acquire_lock() -> bool:
    lock_path = Path(LOCK_FILE)
    try:
        with open(lock_path, "w") as f:
            fcntl.flock(f.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            f.write(f"{os.getpid()}\n{datetime.now(timezone.utc).isoformat()}\n")
            f.flush()
            return True
    except BlockingIOError:
        return False


def release_lock() -> None:
    try:
        Path(LOCK_FILE).unlink(missing_ok=True)
    except Exception:
        pass


def extract_platform(filename: str) -> str | None:
    stem = Path(filename).stem
    if "_normalized" not in stem:
        return None
    normalized_stem = stem.replace("_normalized", "")
    if normalized_stem not in PLATFORM_SOURCE_MAPPING:
        return normalized_stem
    platform = PLATFORM_SOURCE_MAPPING.get(normalized_stem)
    return platform


def normalize_item_for_db(record: dict, source: str, platform: str) -> dict:
    import uuid
    import json
    now = datetime.now(timezone.utc)
    is_active = record.get("is_active", True)
    availability = "in_stock" if is_active else "out_of_stock"

    def to_pg_array(val):
        if val is None:
            return None
        if isinstance(val, list):
            return [str(v) for v in val]
        return [str(val)]

    def to_jsonb(val):
        if val is None:
            return None
        if isinstance(val, (dict, list)):
            return json.dumps(val)
        return json.dumps(val)

    return {
        "id": record.get("id") or str(uuid.uuid4()),
        "sku": record["sku"],
        "platform": platform,
        "platform_id": record.get("platform_id"),
        "name": record.get("title", ""),
        "description": record.get("description", ""),
        "brand": record.get("brand"),
        "price": record.get("price"),
        "currency": record.get("currency", "SGD"),
        "original_price": record.get("original_price"),
        "category_path": to_pg_array(record.get("category_path")),
        "availability": availability,
        "condition": record.get("condition") or "new",
        "merchant_id": record.get("merchant_id", source),
        "merchant_name": record.get("merchant_name") or record.get("merchant_id") or source,
        "image_url": record.get("image_url"),
        "images": to_pg_array(record.get("images")),
        "rating": record.get("rating"),
        "review_count": record.get("review_count"),
        "tags": to_pg_array(record.get("tags")),
        "attributes": to_jsonb(record.get("attributes")),
        "weight_kg": record.get("weight_kg"),
        "dimensions_cm": to_jsonb(record.get("dimensions_cm")),
        "shipping_info": to_jsonb(record.get("shipping_info")),
        "product_url": record.get("url") or record.get("product_url"),
        "indexed_at": now,
        "updated_at": now,
        "is_deal": record.get("is_deal", False),
    }


async def ingest_batch_direct(db: AsyncSession, source: str, platform: str, records: list[dict]) -> tuple[int, int, int, list[dict]]:
    valid_rows = []
    errors = []

    for idx, record in enumerate(records):
        try:
            candidate = dict(record)
            if "stock_level" in candidate and candidate["stock_level"] is not None:
                candidate["stock_level"] = str(candidate["stock_level"])
            item = normalize_item_for_db(candidate, source, platform)
            valid_rows.append(item)
        except Exception as exc:
            errors.append({
                "index": idx,
                "sku": record.get("sku", "unknown"),
                "error": str(exc),
                "code": "VALIDATION_ERROR",
            })

    if not valid_rows:
        return 0, 0, len(records), errors

    insert_sql = text("""
        insert into products (
            id, sku, platform, platform_id, name, description, brand, price, currency,
            original_price, category_path, availability, condition, merchant_id, merchant_name,
            image_url, images, rating, review_count, tags, attributes, weight_kg,
            dimensions_cm, shipping_info, product_url, indexed_at, updated_at, is_deal
        ) values (
            :id, :sku, :platform, :platform_id, :name, :description, :brand, :price, :currency,
            :original_price, :category_path, :availability, :condition, :merchant_id, :merchant_name,
            :image_url, :images, :rating, :review_count, :tags, :attributes, :weight_kg,
            :dimensions_cm, :shipping_info, :product_url, :indexed_at, :updated_at, :is_deal
        )
        on conflict (platform, sku) do update set
            platform_id = excluded.platform_id,
            name = excluded.name,
            description = excluded.description,
            brand = excluded.brand,
            price = excluded.price,
            currency = excluded.currency,
            original_price = excluded.original_price,
            category_path = excluded.category_path,
            availability = excluded.availability,
            merchant_id = excluded.merchant_id,
            merchant_name = excluded.merchant_name,
            image_url = excluded.image_url,
            images = excluded.images,
            rating = excluded.rating,
            review_count = excluded.review_count,
            tags = excluded.tags,
            attributes = excluded.attributes,
            product_url = excluded.product_url,
            updated_at = excluded.updated_at
    """)

    await db.execute(insert_sql, valid_rows)

    inserted = len(valid_rows)
    updated = 0
    failed = len(errors)
    return inserted, updated, failed, errors


async def ingest_file(filepath: Path) -> dict:
    platform = extract_platform(filepath.name)
    if platform is None:
        return {"status": "skipped", "reason": "not a normalized file"}

    log.info(f"Ingesting {filepath.name} (platform={platform})")

    engine = get_async_engine()
    async with AsyncSessionLocal() as db:
        products = []
        try:
            with open(filepath) as f:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        products.append(json.loads(line))
                    except json.JSONDecodeError:
                        pass
        except Exception as e:
            log.error(f"Failed to read {filepath}: {e}")
            return {"status": "error", "reason": str(e)}

        if not products:
            await db.commit()
            return {"status": "empty", "reason": "no products"}

        total_inserted = 0
        total_updated = 0
        total_failed = 0
        batch_size = 500
        source = platform

        for i in range(0, len(products), batch_size):
            batch = products[i:i + batch_size]
            inserted, updated, failed, _ = await ingest_batch_direct(db, source, platform, batch)
            total_inserted += inserted
            total_updated += updated
            total_failed += failed
            await db.commit()

            if i > 0 and i % 5000 == 0:
                log.info(f"  {filepath.name}: processed {i:,} products...")

            await asyncio.sleep(0.1)

        log.info(f"  {filepath.name}: inserted={total_inserted}, updated={total_updated}, failed={total_failed}")

        return {
            "status": "success",
            "file": str(filepath),
            "platform": platform,
            "products": len(products),
            "inserted": total_inserted,
            "updated": total_updated,
            "failed": total_failed,
        }


async def scan_and_ingest(data_dirs: list[Path], state: dict) -> dict:
    results = {"ingested": 0, "skipped": 0, "errors": 0}

    for data_dir in data_dirs:
        normalized_dir = data_dir / "normalized"
        if not normalized_dir.exists():
            continue

        ndjson_files = sorted(normalized_dir.glob("*_normalized.ndjson")) + sorted(normalized_dir.glob("*.ndjson"))
        for filepath in ndjson_files:
            mtime = filepath.stat().st_mtime
            last_ingested = state["last_ingested"].get(str(filepath))

            if last_ingested and last_ingested.get("mtime") == mtime:
                results["skipped"] += 1
                continue

            result = await ingest_file(filepath)

            if result["status"] == "success":
                state["last_ingested"][str(filepath)] = {
                    "mtime": mtime,
                    "ingested_at": datetime.now(timezone.utc).isoformat(),
                    "products": result.get("products", 0),
                    "inserted": result.get("inserted", 0),
                    "updated": result.get("updated", 0),
                }
                results["ingested"] += 1
            elif result["status"] == "skipped":
                results["skipped"] += 1
            else:
                results["errors"] += 1

            await asyncio.sleep(0.5)

    return results


async def run_once(data_dirs: list[Path]) -> dict:
    if not acquire_lock():
        log.warning("Another instance is running, exiting")
        return {"status": "skipped", "reason": "already_running"}

    try:
        state = load_state()
        log.info("Starting ingestion scan...")
        results = await scan_and_ingest(data_dirs, state)
        save_state(state)
        log.info(f"Ingestion scan complete: {results}")
        return {"status": "success", **results}
    finally:
        release_lock()


async def run_continuous(check_interval: int = CHECK_INTERVAL):
    if not acquire_lock():
        log.warning("Another instance is running, exiting")
        return

    try:
        log.info(f"Starting continuous ingestion cron (interval={check_interval}s)")
        data_dirs = [
            Path("/home/paperclip/buywhere-api/data"),
            Path("/home/paperclip/buywhere/data"),
        ]

        while True:
            state = load_state()
            results = await scan_and_ingest(data_dirs, state)
            save_state(state)
            log.info(f"Cycle complete: {results}")
            await asyncio.sleep(check_interval)
    finally:
        release_lock()


async def main():
    parser = argparse.ArgumentParser(description="Automated Ingestion Cron")
    parser.add_argument("--continuous", action="store_true", help="Run continuously")
    parser.add_argument("--check-interval", type=int, default=CHECK_INTERVAL, help="Check interval in seconds")
    parser.add_argument("--watch-dir", action="append", help="Additional directories to watch")
    args = parser.parse_args()

    data_dirs = [Path("/home/paperclip/buywhere-api/data")]
    if args.watch_dir:
        data_dirs.extend([Path(d) for d in args.watch_dir])

    if args.continuous:
        await run_continuous(args.check_interval)
    else:
        result = await run_once(data_dirs)
        print(json.dumps(result, indent=2))


if __name__ == "__main__":
    asyncio.run(main())
