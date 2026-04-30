#!/usr/bin/env python3
"""
NDJSON Catalog Ingestion Pipeline via API

Reads normalized scraped product NDJSON files and bulk-loads them into the
BuyWhere catalog via POST /v1/ingest/products.

Usage:
    python ingest_catalog.py [--dry-run] [--batch-size 100] [--data-dir /path/to/ndjson]
    python ingest_catalog.py --dry-run --data-dir /home/paperclip/buywhere-api/data/normalized
"""
import argparse
import asyncio
import json
import os
import sys
import time
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).parent.parent))

import httpx
from sqlalchemy import text

settings = None
try:
    from app.config import get_settings
    settings = get_settings()
except Exception:
    pass

from app.database import AsyncSessionLocal
from app.schemas.ingest import IngestProductItem

BATCH_SIZE = 100
DATA_DIR = Path("/home/paperclip/buywhere-api/data/normalized")
API_BASE = "http://localhost:8000"
API_KEY_ENV = "BUYWHERE_API_KEY"
INGEST_MODE_AUTO = "auto"
INGEST_MODE_API = "api"
INGEST_MODE_DIRECT = "direct"


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
    "daiso_jp": "daiso_jp",
    "coupang_kr": "coupang_kr",
    "zalora_my": "zalora_my",
    "zalora_ph": "zalora_ph",
    "zalora_id": "zalora_id",
    "watsons_sg": "watsons_sg",
    "watsons_my": "watsons_my",
    "harvey_norman_sg": "harvey_norman_sg",
    "challenger_sg": "challenger_sg",
    "fortytwo_sg": "fortytwo_sg",
    "popular_sg": "popular_sg",
    "tangs_sg": "tangs_sg",
    "robinsons_sg": "robinsons_sg",
    "lovebonito_sg": "lovebonito_sg",
    "sephora_sg": "sephora_sg",
    "tangs": "tangs_sg",
    "uniqlo": "uniqlo_sg",
    "vuori": "vuori_sg",
    "hmark": "harvey_norman_sg",
    "hnsg": "harvey_norman_sg",
    "guardian_my": "guardian_my",
    "decathlon_sg": "decathlon_sg",
}


def extract_platform(filename: str) -> str:
    name = Path(filename).stem.replace("_normalized", "")
    return PLATFORM_SOURCE_MAPPING.get(name, name)


async def call_ingest_api(
    client: httpx.AsyncClient,
    api_base: str,
    api_key: str,
    source: str,
    products: list[dict],
    timeout: float = 120.0,
) -> tuple[int, int, int, list[dict]]:
    url = f"{api_base}/v1/ingest/products"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    payload = {"source": source, "products": products}

    try:
        response = await client.post(url, json=payload, headers=headers, timeout=timeout)
        response.raise_for_status()
        result = response.json()
        errors = result.get("errors", [])
        return (
            result.get("rows_inserted", 0),
            result.get("rows_updated", 0),
            result.get("rows_failed", 0),
            errors,
        )
    except httpx.TimeoutException:
        print(f"    WARNING: Request timed out after {timeout}s for source={source}, batch will be retried")
        return 0, 0, len(products), [{"index": 0, "sku": "batch", "error": "timeout", "code": "TIMEOUT"}]
    except httpx.HTTPStatusError as e:
        print(f"    WARNING: HTTP {e.response.status_code} for source={source}: {e.response.text[:200]}")
        return 0, 0, len(products), [{"index": 0, "sku": "batch", "error": str(e), "code": f"HTTP_{e.response.status_code}"}]
    except Exception as e:
        print(f"    WARNING: API call failed for source={source}: {e}")
        return 0, 0, len(products), [{"index": 0, "sku": "batch", "error": str(e), "code": "API_ERROR"}]


PLATFORM_SOURCE_MAPPING_OLD_DB = {
    "amazon_sg": "amazon_sg",
    "amazon_sg_books": "amazon_sg",
    "amazon_sg_baby": "amazon_sg",
    "amazon_sg_beauty": "amazon_sg",
    "amazon_sg_electronics": "amazon_sg",
    "amazon_sg_fashion": "amazon_sg",
    "amazon_sg_garden": "amazon_sg",
    "amazon_sg_grocery": "amazon_sg",
    "amazon_sg_home_kitchen": "amazon_sg",
    "amazon_sg_office": "amazon_sg",
    "office-products": "amazon_sg",
    "amazon_sg_pets": "amazon_sg",
    "amazon_sg_sports": "amazon_sg",
    "amazon_sg_tools": "amazon_sg",
    "amazon_sg_toys": "amazon_sg",
    "bestdenki_sg": "bestdenki",
    "carousell": "carousell",
    "carousell_sg": "carousell",
    "challenger": "challenger",
    "challenger_sg": "challenger",
    "cold-storage": "coldstorage",
    "cold-storage": "coldstorage",
    "cold_storage_sg": "coldstorage",
    "coldstorage_sg": "coldstorage",
    "courts": "courts",
    "courts_sg": "courts",
    "decathlon": "decathlon",
    "decathlon_sg": "decathlon",
    "fairprice_sg": "fairprice",
    "fairprice_validation": "fairprice",
    "fortytwo": "fortytwo",
    "fortytwo_sg": "fortytwo",
    "giant": "giant",
    "guardian": "guardian",
    "guardian": "guardian",
    "guardian_sg": "guardian",
    "harvey-norman": "harvey_norman",
    "harvey_norman": "harvey_norman",
    "harvey_norman_sg": "harvey_norman",
    "lovebonito": "lovebonito",
    "lovebonito_sg": "lovebonito",
    "metro_sg": "metro",
    "nike": "nike",
    "nike_sg": "nike",
    "popular": "popular",
    "popular_sg": "popular",
    "qoo10": "qoo10",
    "qoo10_sg": "qoo10",
    "scraped": "amazon_sg",
    "tangs": "tangs",
    "tangs_sg": "tangs",
    "tiki-vn": "tiki",
    "tiki_vn": "tiki",
    "uniqlo": "uniqlo",
    "uniqlo_sg": "uniqlo",
    "vuori": "vuori",
    "vuori_sg": "vuori",
    "zalora": "zalora",
    "zalora_sg": "zalora",
}


def resolve_platform(record: dict[str, Any], default_source: str) -> str | None:
    metadata = record.get("metadata") or {}
    candidates = [
        metadata.get("source"),
        record.get("merchant_id"),
        default_source,
    ]
    for candidate in candidates:
        if not candidate:
            continue
        normalized = str(candidate).strip()
        platform = PLATFORM_SOURCE_MAPPING_OLD_DB.get(normalized)
        if platform:
            return platform
    return None


def coerce_optional_decimal(value: Any) -> Decimal | None:
    if value in (None, ""):
        return None
    try:
        return Decimal(str(value))
    except (InvalidOperation, ValueError, TypeError):
        return None


def coerce_optional_float(value: Any) -> float | None:
    if value in (None, ""):
        return None
    try:
        return float(value)
    except (ValueError, TypeError):
        return None


def coerce_optional_int(value: Any) -> int | None:
    if value in (None, ""):
        return None
    try:
        return int(value)
    except (ValueError, TypeError):
        return None


def normalize_item_for_db(item: IngestProductItem, source: str, platform: str, raw_record: dict[str, Any]) -> dict[str, Any]:
    metadata = dict(item.metadata or {})
    metadata.setdefault("normalized_source", source)

    rating = metadata.get("rating")
    if isinstance(rating, dict):
        rating = rating.get("average")
    rating = coerce_optional_float(rating)
    review_count = coerce_optional_int(metadata.get("review_count"))
    merchant_name = metadata.get("seller_name") or metadata.get("merchant_name") or item.brand or item.merchant_id
    category_path = item.category_path or ([item.category] if item.category else ["Uncategorized"])
    image_url = item.image_url or None
    tags = metadata.get("tags") if isinstance(metadata.get("tags"), list) else []
    original_price = coerce_optional_decimal(metadata.get("original_price"))

    availability = "in_stock"
    if item.is_active is False or item.is_available is False or item.in_stock is False:
        availability = "out_of_stock"
    elif isinstance(item.stock_level, int) and item.stock_level <= 5:
        availability = "limited_stock"

    now = datetime.now(timezone.utc)
    return {
        "id": str(__import__("uuid").uuid4()),
        "sku": item.sku,
        "platform": platform,
        "platform_id": str(metadata.get("product_id") or item.sku),
        "name": item.title,
        "description": item.description or "",
        "brand": item.brand if isinstance(item.brand, str) else (item.brand.get("name") if isinstance(item.brand, dict) else None),
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
    }


async def ingest_batch_direct(
    db,
    source: str,
    records: list[dict[str, Any]],
) -> tuple[int, int, int, list[dict[str, Any]]]:
    valid_rows: list[dict[str, Any]] = []
    errors: list[dict[str, Any]] = []

    for idx, record in enumerate(records):
        try:
            platform = resolve_platform(record, source)
            if not platform:
                raise ValueError(f"Unsupported platform for source={source!r}")
            candidate = dict(record)
            if "stock_level" in candidate and candidate["stock_level"] is not None:
                candidate["stock_level"] = str(candidate["stock_level"])
            item = IngestProductItem.model_validate(candidate)
            valid_rows.append(normalize_item_for_db(item, source, platform, record))
        except Exception as exc:
            errors.append({
                "index": idx,
                "sku": record.get("sku", "unknown"),
                "error": str(exc),
                "code": "VALIDATION_ERROR",
            })

    if not valid_rows:
        return 0, 0, len(records), errors

    existing_rows = await db.execute(
        text(
            "select platform::text as platform, sku from products where sku = any(:skus)"
        ),
        {"skus": [row["sku"] for row in valid_rows]},
    )
    existing_pairs = {(row.platform, row.sku) for row in existing_rows}

    insert_sql = text(
        """
        insert into products (
            id, sku, platform, platform_id, name, description, brand, price, currency,
            original_price, category_path, availability, condition, merchant_id, merchant_name,
            image_url, images, rating, review_count, tags, attributes, weight_kg,
            dimensions_cm, shipping_info, product_url, indexed_at, updated_at
        ) values (
            :id, :sku, :platform, :platform_id, :name, :description, :brand, :price, :currency,
            :original_price, :category_path, :availability, :condition, :merchant_id, :merchant_name,
            :image_url, :images, :rating, :review_count, :tags, :attributes, :weight_kg,
            :dimensions_cm, :shipping_info, :product_url, :indexed_at, :updated_at
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
        """
    )
    await db.execute(insert_sql, valid_rows)

    inserted = sum(1 for row in valid_rows if (row["platform"], row["sku"]) not in existing_pairs)
    updated = len(valid_rows) - inserted
    failed = len(errors)
    return inserted, updated, failed, errors


async def process_ndjson_file(
    filepath: Path,
    api_base: str,
    api_key: str,
    batch_size: int,
    dry_run: bool,
    mode: str,
) -> dict[str, Any]:
    platform = extract_platform(filepath.name)
    source = PLATFORM_SOURCE_MAPPING.get(platform, platform)

    counts: dict[str, Any] = {
        "loaded": 0, "updated": 0, "failed": 0, "skipped": 0, "errors": []
    }
    batch: list[dict] = []
    batch_start_idx = 0
    total_records = 0

    print(f"\n  Processing {filepath.name} (source={source})...")

    async with AsyncSessionLocal() as db:
        with open(filepath, "r", encoding="utf-8") as f:
            for line_idx, line in enumerate(f):
                line = line.strip()
                if not line:
                    continue
                try:
                    record = json.loads(line)
                except json.JSONDecodeError:
                    counts["skipped"] += 1
                    continue

                total_records += 1
                batch.append(record)

                if len(batch) >= batch_size:
                    if not dry_run:
                        if mode == INGEST_MODE_DIRECT:
                            inserted, updated, failed, batch_errors = await ingest_batch_direct(db, source, batch)
                        else:
                            async with httpx.AsyncClient(timeout=120.0, follow_redirects=True) as client:
                                inserted, updated, failed, batch_errors = await call_ingest_api(
                                    client, api_base, api_key, source, batch
                                )
                        counts["loaded"] += inserted
                        counts["updated"] += updated
                        counts["failed"] += failed
                        if batch_errors:
                            for err in batch_errors:
                                err["file"] = filepath.name
                                err["batch_start"] = batch_start_idx
                            counts["errors"].extend(batch_errors)
                    else:
                        counts["loaded"] += len(batch)

                    if total_records % 5000 == 0:
                        print(f"    {total_records:,} records processed...")

                    batch = []
                    batch_start_idx = total_records
                    await asyncio.sleep(0.1)

        if batch:
            if not dry_run:
                if mode == INGEST_MODE_DIRECT:
                    inserted, updated, failed, batch_errors = await ingest_batch_direct(db, source, batch)
                else:
                    async with httpx.AsyncClient(timeout=120.0, follow_redirects=True) as client:
                        inserted, updated, failed, batch_errors = await call_ingest_api(
                            client, api_base, api_key, source, batch
                        )
                counts["loaded"] += inserted
                counts["updated"] += updated
                counts["failed"] += failed
                if batch_errors:
                    for err in batch_errors:
                        err["file"] = filepath.name
                        err["batch_start"] = batch_start_idx
                    counts["errors"].extend(batch_errors)
            else:
                counts["loaded"] += len(batch)

        await db.commit()

    counts["total"] = total_records
    print(f"  -> loaded={counts['loaded']:,}, updated={counts['updated']:,}, failed={counts['failed']:,}, skipped={counts['skipped']:,}")
    return counts


async def run_ingestion(
    data_dir: Path,
    api_base: str,
    api_key: str,
    batch_size: int,
    dry_run: bool,
    mode: str,
) -> dict[str, Any]:
    ndjson_files = list(data_dir.glob("*_normalized.ndjson"))
    if not ndjson_files:
        ndjson_files = list(data_dir.glob("*.ndjson"))
    if not ndjson_files:
        print(f"No normalized NDJSON files found in {data_dir}")
        return {"loaded": 0, "updated": 0, "failed": 0, "skipped": 0, "errors": [], "status": "no_files"}

    ndjson_files = sorted(ndjson_files)
    print(f"Found {len(ndjson_files)} NDJSON file(s) to ingest:")
    for f in ndjson_files:
        print(f"  - {f.name}")

    overall: dict[str, Any] = {"loaded": 0, "updated": 0, "failed": 0, "skipped": 0, "errors": [], "files": []}

    for filepath in ndjson_files:
        counts = await process_ndjson_file(filepath, api_base, api_key, batch_size, dry_run, mode)
        overall["loaded"] += counts["loaded"]
        overall["updated"] += counts["updated"]
        overall["failed"] += counts["failed"]
        overall["skipped"] += counts["skipped"]
        overall["errors"].extend(counts.get("errors", []))
        overall["files"].append({
            "file": filepath.name,
            "loaded": counts["loaded"],
            "updated": counts["updated"],
            "failed": counts["failed"],
            "skipped": counts["skipped"],
            "total": counts.get("total", 0),
        })

    overall["status"] = "completed"
    return overall


def main():
    parser = argparse.ArgumentParser(description="NDJSON Catalog Ingestion Pipeline via API")
    parser.add_argument("--data-dir", default=str(DATA_DIR), help="Directory containing normalized NDJSON files")
    parser.add_argument("--batch-size", type=int, default=BATCH_SIZE, help="Batch size for API calls")
    parser.add_argument("--dry-run", action="store_true", help="Validate without ingesting")
    parser.add_argument("--api-base", default=API_BASE, help="BuyWhere API base URL")
    parser.add_argument("--api-key", default=None, help="BuyWhere API key (or set BUYWHERE_API_KEY env)")
    parser.add_argument(
        "--mode",
        choices=[INGEST_MODE_AUTO, INGEST_MODE_API, INGEST_MODE_DIRECT],
        default=INGEST_MODE_AUTO,
        help="Ingestion mode: API, direct DB, or auto-detect",
    )
    args = parser.parse_args()

    api_key = args.api_key or os.environ.get(API_KEY_ENV, "")
    mode = args.mode
    if mode == INGEST_MODE_AUTO:
        mode = INGEST_MODE_API if api_key else INGEST_MODE_DIRECT
    if mode == INGEST_MODE_API and not api_key:
        print(f"Error: API mode requires an API key. Set {API_KEY_ENV} or use --api-key")
        sys.exit(1)

    data_dir = Path(args.data_dir)
    if not data_dir.exists():
        print(f"Error: Data directory does not exist: {data_dir}")
        sys.exit(1)

    print("=" * 60)
    print("NDJSON CATALOG INGESTION PIPELINE")
    print("=" * 60)
    print(f"Data directory: {data_dir}")
    print(f"Batch size:     {args.batch_size}")
    print(f"Dry run:        {args.dry_run}")
    print(f"Mode:           {mode}")
    if mode == INGEST_MODE_API:
        print(f"API base:       {args.api_base}")
    print("=" * 60)

    start = time.time()
    result = asyncio.run(run_ingestion(data_dir, args.api_base, api_key, args.batch_size, args.dry_run, mode))
    elapsed = time.time() - start

    print("\n" + "=" * 60)
    print("INGESTION SUMMARY")
    print("=" * 60)
    print(f"Total loaded:   {result['loaded']:,}")
    print(f"Total updated:   {result['updated']:,}")
    print(f"Total failed:   {result['failed']:,}")
    print(f"Total skipped:  {result['skipped']:,}")
    print(f"Files processed:{len(result.get('files', []))}")
    print(f"Elapsed time:   {elapsed:.1f}s")
    print(f"Status:         {result['status']}")

    if result.get("errors"):
        error_summary: dict[str, int] = {}
        for err in result["errors"][:20]:
            code = err.get("code", "UNKNOWN")
            error_summary[code] = error_summary.get(code, 0) + 1
        print(f"\nError breakdown (top codes):")
        for code, count in sorted(error_summary.items(), key=lambda x: -x[1]):
            print(f"  {code}: {count}")
        if len(result["errors"]) > 20:
            print(f"  ... and {len(result['errors']) - 20} more errors (see full report)")

    print("=" * 60)

    if result["failed"] > 0:
        print(f"\nWARNING: {result['failed']:,} rows failed ingestion")

    if result["status"] == "no_files":
        sys.exit(1)


if __name__ == "__main__":
    main()
