#!/home/paperclip/buywhere-api/venv/bin/python
"""
Automated ingestion cron job for BuyWhere catalog.

Watches multiple data directories for new NDJSON/JSONL files and ingests them
into the database with upsert deduplication on (platform, sku).

Run every 30 minutes via cron or systemd timer.

Cron example:
    */30 * * * * /home/paperclip/buywhere-api/venv/bin/python /home/paperclip/buywhere-api/scripts/auto_ingest.py >> /home/paperclip/buywhere-api/logs/auto_ingest.log 2>&1
"""

import argparse
import asyncio
import json
import logging
import os
import re
import subprocess
import sys
import time
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).parent.parent))

from app.config import get_settings
from app.schemas.ingest import IngestProductItem
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy import text

LOG_DIR = Path("/home/paperclip/buywhere-api/logs")
STATE_FILE = Path("/home/paperclip/buywhere-api/data/.auto_ingest_state.json")
LOCK_FILE = Path("/tmp/buywhere_auto_ingest.lock")

DATA_DIRS = [
    "/home/paperclip/buywhere-api/data/normalized",
    "/home/paperclip/buywhere-api/data/flipkart",
    "/home/paperclip/buywhere/data",
]

BATCH_SIZE = 200
TIMEOUT_SEC = 1800

LOG_DIR.mkdir(parents=True, exist_ok=True)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
    handlers=[
        logging.FileHandler(LOG_DIR / "auto_ingest.log"),
        logging.StreamHandler(sys.stdout),
    ],
)
logger = logging.getLogger(__name__)

TARGET_DATABASE_URL = "postgresql+asyncpg://buywhere:buywhere@172.18.0.4:5432/buywhere_new"


def resolve_catalog_database_url() -> str:
    configured = get_settings().database_url
    normalized = configured
    if normalized.startswith("postgres://"):
        normalized = normalized.replace("postgres://", "postgresql+asyncpg://", 1)
    elif normalized.startswith("postgresql://") and "+asyncpg" not in normalized:
        normalized = normalized.replace("postgresql://", "postgresql+asyncpg://", 1)

    # Paperclip's local agent DB is not the product catalog DB.
    if "127.0.0.1:54330/paperclip" in normalized or "/paperclip" in normalized or "@localhost:" in normalized:
        return TARGET_DATABASE_URL
    return normalized


ResolvedAsyncSessionLocal = async_sessionmaker(
    create_async_engine(resolve_catalog_database_url(), echo=False, pool_pre_ping=True),
    expire_on_commit=False,
)

PLATFORM_SOURCE_MAPPING = {
    "challenger": "challenger_sg",
    "cold-storage": "cold_storage_sg",
    "courts": "courts_sg",
    "decathlon": "decathlon_sg",
    "fairprice_validation": "fairprice_validation",
    "fortytwo": "fortytwo_sg",
    "giant": "giant_sg",
    "guardian": "guardian_sg",
    "harvey-norman": "harvey_norman_sg",
    "harvey_norman": "harvey_norman_sg",
    "lovebonito": "lovebonito_sg",
    "nike": "nike_sg",
    "popular": "popular_sg",
    "shopee_sg": "shopee_sg",
    "lazada_sg": "lazada_sg",
    "cold_storage_sg": "cold_storage_sg",
    "redmart_sg": "redmart_sg",
    "fairprice_sg": "fairprice_sg",
    "guardian_sg": "guardian_sg",
    "courts_sg": "courts_sg",
    "ikea_sg": "ikea_sg",
    "decathlon_sg": "decathlon_sg",
    "carousell_sg": "carousell_sg",
    "qoo10_sg": "qoo10_sg",
    "zalora_sg": "zalora_sg",
    "mustafa_sg": "mustafa_sg",
    "giant_sg": "giant_sg",
    "shein_sg": "shein_sg",
    "uniqlo_sg": "uniqlo_sg",
    "nike_sg": "nike_sg",
    "asos_sg": "asos_sg",
    "amazon_sg": "amazon_sg",
    "amazon_au": "amazon_au",
    "amazon_in": "amazon_in",
    "amazon_jp": "amazon_jp",
    "flipkart_in": "flipkart_in",
    "myntra_in": "myntra_in",
    "lazada_th": "lazada_th",
    "shopee_th": "shopee_th",
    "shopee_my": "shopee_my",
    "shopee_ph": "shopee_ph",
    "shopee_vn": "shopee_vn",
    "tiki_vn": "tiki_vn",
    "tokopedia_id": "tokopedia_id",
    "bukalapak_id": "bukalapak_id",
    "rakuten_jp": "rakuten_jp",
    "yodobashi_jp": "yodobashi_jp",
    "daiso_jp": "daiso_jp",
    "coupang_kr": "coupang_kr",
    "zalora_my": "zalora_my",
    "zalora_ph": "zalora_ph",
    "zalora_id": "zalora_id",
    "watsons_sg": "watsons_sg",
    "watsons_my": "watsons_my",
    "shengsiong_sg": "shengsiong_sg",
    "mothercare_sg": "mothercare_sg",
    "robinsons_sg": "robinsons_sg",
    "daiso_sg": "daiso_sg",
    "audiohouse_sg": "audiohouse_sg",
    "bestdenki_sg": "bestdenki_sg",
    "metro_sg": "metro_sg",
    "gaincity_sg": "gaincity_sg",
    "petloverscentre_sg": "petloverscentre_sg",
    "sasa_sg": "sasa_sg",
    "stereo_sg": "stereo_sg",
    "iherb_sg": "iherb_sg",
    "hm_sg": "hm_sg",
    "muji_sg": "muji_sg",
    "sephora_sg": "sephora_sg",
    "tangs_sg": "tangs_sg",
    "lovebonito_sg": "lovebonito_sg",
    "tiki_vn": "tiki_vn",
    "tokopedia_id": "tokopedia_id",
    "bukalapak_id": "bukalapak_id",
    "flipkart_in": "flipkart_in",
    "myntra_in": "myntra_in",
    "lazada_my": "lazada_my",
    "lazada_ph": "lazada_ph",
    "lazada_id": "lazada_id",
    "lazada_vn": "lazada_vn",
    "shopee_id": "shopee_id",
    "shopee_my": "shopee_my",
    "shopee_ph": "shopee_ph",
    "shopee_vn": "shopee_vn",
    "shopee_th": "shopee_th",
    "qoo10_sg": "qoo10_sg",
    "ezbuy_sg": "ezbuy_sg",
    "carousell": "carousell_sg",
    "carousell_sg": "carousell_sg",
}


def extract_platform(filename: str) -> str:
    stem = Path(filename).stem
    stem = re.sub(r"_(normalized|\d{8,}.*|normalized_\d+.*)$", "", stem)
    platform = PLATFORM_SOURCE_MAPPING.get(stem)
    if platform:
        return platform
    if "_" in stem:
        first = stem.split("_")[0]
        mapped = PLATFORM_SOURCE_MAPPING.get(first)
        if mapped:
            return mapped
    return stem


def detect_platform_from_file(filepath: Path) -> str:
    platform = extract_platform(filepath.name)
    if platform != "products":
        return platform

    try:
        with open(filepath, "r", encoding="utf-8") as handle:
            for line in handle:
                line = line.strip()
                if not line:
                    continue
                record = json.loads(line)
                candidate = (
                    record.get("source")
                    or record.get("merchant_id")
                    or record.get("platform")
                    or record.get("metadata", {}).get("source")
                )
                if not candidate:
                    break
                return PLATFORM_SOURCE_MAPPING.get(str(candidate), str(candidate))
    except Exception:
        pass

    return platform


def load_state() -> dict[str, Any]:
    if STATE_FILE.exists():
        try:
            return json.loads(STATE_FILE.read_text())
        except Exception:
            pass
    return {"processed_files": {}, "last_run": None}


def save_state(state: dict[str, Any]) -> None:
    state["last_run"] = datetime.now(timezone.utc).isoformat()
    STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    STATE_FILE.write_text(json.dumps(state, indent=2))


def acquire_lock() -> bool:
    if LOCK_FILE.exists():
        try:
            pid = int(LOCK_FILE.read_text().strip())
            os.kill(pid, 0)
            logger.warning(f"Lock file exists for PID %d, another instance is running", pid)
            return False
        except (ValueError, ProcessLookupError, PermissionError):
            LOCK_FILE.unlink(missing_ok=True)
    LOCK_FILE.write_text(str(os.getpid()))
    return True


def release_lock() -> None:
    LOCK_FILE.unlink(missing_ok=True)


def find_ndjson_files() -> list[tuple[Path, str]]:
    files = []
    for data_dir in DATA_DIRS:
        dir_path = Path(data_dir)
        if not dir_path.exists():
            continue
        for pattern in ["*.ndjson", "*.jsonl"]:
            for f in dir_path.glob(pattern):
                files.append((f, detect_platform_from_file(f)))
    files.sort(key=lambda x: x[0].stat().st_mtime)
    return files


def coerce_decimal(value: Any) -> Decimal | None:
    if value in (None, ""):
        return None
    try:
        return Decimal(str(value))
    except (InvalidOperation, ValueError, TypeError):
        return None


def coerce_float(value: Any) -> float | None:
    if value in (None, ""):
        return None
    try:
        return float(value)
    except (ValueError, TypeError):
        return None


def coerce_int(value: Any) -> int | None:
    if value in (None, ""):
        return None
    try:
        return int(value)
    except (ValueError, TypeError):
        return None


def normalize_record(record: dict[str, Any], source: str) -> dict[str, Any] | None:
    try:
        item = IngestProductItem.model_validate(record)
    except Exception:
        return None

    metadata = dict(item.metadata or {})
    metadata.setdefault("normalized_source", source)

    rating = metadata.get("rating")
    if isinstance(rating, dict):
        rating = rating.get("average")
    rating = coerce_float(rating)
    review_count = coerce_int(metadata.get("review_count"))
    merchant_name = (
        metadata.get("seller_name")
        or metadata.get("merchant_name")
        or item.brand
        or item.merchant_id
    )
    category_path = item.category_path or ([item.category] if item.category else ["Uncategorized"])
    image_url = item.image_url or None
    tags = metadata.get("tags") if isinstance(metadata.get("tags"), list) else []
    original_price = coerce_decimal(metadata.get("original_price"))

    availability = "in_stock"
    if item.is_active is False or item.is_available is False or item.in_stock is False:
        availability = "out_of_stock"
    elif isinstance(item.stock_level, int) and item.stock_level <= 5:
        availability = "limited_stock"

    now = datetime.now(timezone.utc)
    return {
        "sku": item.sku,
        "platform": source,
        "platform_id": str(metadata.get("product_id") or item.sku),
        "name": item.title,
        "description": item.description or "",
        "brand": (
            item.brand.get("name") if isinstance(item.brand, dict) else (item.brand if isinstance(item.brand, str) else None)
        ),
        "price": item.price,
        "currency": item.currency,
        "original_price": original_price,
        "category_path": category_path,
        "availability": availability,
        "condition": "new",
        "merchant_id": item.merchant_id,
        "merchant_name": str(merchant_name),
        "image_url": image_url,
        "images": [image_url] if image_url else [],
        "rating": rating,
        "review_count": review_count,
        "tags": tags,
        "attributes": json.dumps(metadata, ensure_ascii=False),
        "weight_kg": None,
        "dimensions_cm": None,
        "shipping_info": None,
        "product_url": item.url,
        "indexed_at": now,
        "updated_at": now,
        "is_deal": False,
    }


async def ingest_batch(
    db,
    records: list[dict[str, Any]],
) -> tuple[int, int, int, list[dict[str, Any]]]:
    if not records:
        return 0, 0, 0, []

    errors: list[dict[str, Any]] = []
    valid_rows: list[dict[str, Any]] = []

    for idx, record in enumerate(records):
        normalized = normalize_record(record, record.get("source", "unknown"))
        if normalized is None:
            errors.append({"index": idx, "sku": record.get("sku", "unknown"), "error": "validation_failed", "code": "VALIDATION_ERROR"})
            continue
        valid_rows.append(normalized)

    if not valid_rows:
        return 0, 0, len(records), errors

    skus = [row["sku"] for row in valid_rows]
    platforms = list({row["platform"] for row in valid_rows})

    existing_rows = await db.execute(
        text("SELECT platform, sku FROM products WHERE platform = any(:platforms) AND sku = any(:skus)"),
        {"platforms": platforms, "skus": skus},
    )
    existing_pairs = {(row.platform, row.sku) for row in existing_rows}

    insert_sql = text(
        """
        INSERT INTO products (
            sku, platform, platform_id, name, description, brand, price, currency,
            original_price, category_path, availability, condition, merchant_id, merchant_name,
            image_url, images, rating, review_count, tags, attributes, weight_kg,
            dimensions_cm, shipping_info, product_url, indexed_at, updated_at, is_deal
        ) VALUES (
            :sku, :platform, :platform_id, :name, :description, :brand, :price, :currency,
            :original_price, :category_path, :availability, :condition, :merchant_id, :merchant_name,
            :image_url, :images, :rating, :review_count, :tags, :attributes, :weight_kg,
            :dimensions_cm, :shipping_info, :product_url, :indexed_at, :updated_at, :is_deal
        )
        ON CONFLICT (platform, sku) DO UPDATE SET
            platform_id = EXCLUDED.platform_id,
            name = EXCLUDED.name,
            description = EXCLUDED.description,
            brand = EXCLUDED.brand,
            price = EXCLUDED.price,
            currency = EXCLUDED.currency,
            original_price = EXCLUDED.original_price,
            category_path = EXCLUDED.category_path,
            availability = EXCLUDED.availability,
            merchant_id = EXCLUDED.merchant_id,
            merchant_name = EXCLUDED.merchant_name,
            image_url = EXCLUDED.image_url,
            images = EXCLUDED.images,
            rating = EXCLUDED.rating,
            review_count = EXCLUDED.review_count,
            tags = EXCLUDED.tags,
            attributes = EXCLUDED.attributes,
            product_url = EXCLUDED.product_url,
            updated_at = EXCLUDED.updated_at
        """
    )

    await db.execute(insert_sql, valid_rows)

    inserted = sum(1 for row in valid_rows if (row["platform"], row["sku"]) not in existing_pairs)
    updated = len(valid_rows) - inserted
    failed = len(errors)
    return inserted, updated, failed, errors


async def process_file(filepath: Path, platform: str, dry_run: bool) -> dict[str, Any]:
    counts: dict[str, Any] = {"loaded": 0, "updated": 0, "failed": 0, "skipped": 0, "errors": [], "file": str(filepath)}
    batch: list[dict] = []
    total_records = 0

    logger.info("Processing %s (platform=%s)", filepath.name, platform)

    async with ResolvedAsyncSessionLocal() as db:
        with open(filepath, "r", encoding="utf-8") as f:
            for line_idx, line in enumerate(f):
                line = line.strip()
                if not line:
                    counts["skipped"] += 1
                    continue
                try:
                    record = json.loads(line)
                    record["source"] = platform
                except json.JSONDecodeError:
                    counts["skipped"] += 1
                    continue

                total_records += 1
                batch.append(record)

                if len(batch) >= BATCH_SIZE:
                    if not dry_run:
                        inserted, updated, failed, batch_errors = await ingest_batch(db, batch)
                        counts["loaded"] += inserted
                        counts["updated"] += updated
                        counts["failed"] += failed
                        counts["errors"].extend(batch_errors)
                    else:
                        counts["loaded"] += len(batch)

                    if total_records % 5000 == 0:
                        logger.info("  %d records processed...", total_records)

                    batch = []
                    await asyncio.sleep(0.05)

        if batch:
            if not dry_run:
                inserted, updated, failed, batch_errors = await ingest_batch(db, batch)
                counts["loaded"] += inserted
                counts["updated"] += updated
                counts["failed"] += failed
                counts["errors"].extend(batch_errors)
            else:
                counts["loaded"] += len(batch)

        await db.commit()

    counts["total"] = total_records
    logger.info(
        "  -> %s: loaded=%d, updated=%d, failed=%d, skipped=%d",
        filepath.name, counts["loaded"], counts["updated"], counts["failed"], counts["skipped"],
    )
    return counts


async def run_ingestion(dry_run: bool) -> dict[str, Any]:
    state = load_state()
    processed_files = state.get("processed_files", {})

    ndjson_files = find_ndjson_files()
    if not ndjson_files:
        logger.info("No new NDJSON/JSONL files found")
        return {"status": "no_files", "files": []}

    overall: dict[str, Any] = {"loaded": 0, "updated": 0, "failed": 0, "skipped": 0, "errors": [], "files": []}
    new_files = []

    for filepath, platform in ndjson_files:
        file_key = str(filepath)
        mtime = filepath.stat().st_mtime
        prev_mtime = processed_files.get(file_key, {}).get("mtime")

        if prev_mtime is not None and prev_mtime >= mtime:
            continue

        new_files.append((filepath, platform))
        processed_files[file_key] = {
            "mtime": mtime,
            "size": filepath.stat().st_size,
            "last_processed": datetime.now(timezone.utc).isoformat(),
        }

    if not new_files:
        logger.info("No new files to ingest")
        return {"status": "up_to_date", "files": []}

    logger.info("Found %d new file(s) to ingest", len(new_files))

    for filepath, platform in new_files:
        try:
            counts = await process_file(filepath, platform, dry_run)
            overall["loaded"] += counts["loaded"]
            overall["updated"] += counts["updated"]
            overall["failed"] += counts["failed"]
            overall["skipped"] += counts["skipped"]
            overall["errors"].extend(counts.get("errors", []))
            overall["files"].append({
                "file": str(filepath),
                "loaded": counts["loaded"],
                "updated": counts["updated"],
                "failed": counts["failed"],
                "skipped": counts["skipped"],
                "total": counts.get("total", 0),
            })
        except Exception as e:
            logger.error("Error processing %s: %s", filepath.name, e)
            overall["errors"].append({"file": str(filepath), "error": str(e), "code": "PROCESS_ERROR"})

    state["processed_files"] = processed_files
    save_state(state)
    overall["status"] = "completed"
    return overall


def main():
    parser = argparse.ArgumentParser(description="Automated catalog ingestion cron")
    parser.add_argument("--dry-run", action="store_true", help="Validate without ingesting")
    parser.add_argument("--force", action="store_true", help="Force re-ingest all files")
    args = parser.parse_args()

    if args.force:
        state = load_state()
        state["processed_files"] = {}
        save_state(state)
        logger.info("Force flag: cleared processed files state")

    if not acquire_lock():
        logger.warning("Another instance is running, exiting")
        sys.exit(0)

    try:
        start_time = time.time()
        logger.info("Auto-ingestion cron job started")

        result = asyncio.run(run_ingestion(args.dry_run))

        elapsed = time.time() - start_time
        logger.info(
            "Ingestion complete: loaded=%d, updated=%d, failed=%d, skipped=%d, status=%s, elapsed=%.1fs",
            result.get("loaded", 0), result.get("updated", 0), result.get("failed", 0),
            result.get("skipped", 0), result.get("status"), elapsed,
        )

        if result.get("files"):
            for f in result["files"]:
                logger.info("  File: %s - loaded=%d, updated=%d, failed=%d", f["file"], f["loaded"], f["updated"], f["failed"])

        if result.get("errors") and len(result["errors"]) <= 20:
            for err in result["errors"]:
                logger.error("  Error: %s", err)

        sys.exit(0 if result["status"] in ("completed", "up_to_date", "no_files") else 1)
    finally:
        release_lock()


if __name__ == "__main__":
    main()
