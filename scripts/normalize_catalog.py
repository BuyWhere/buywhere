#!/usr/bin/env python3
"""
Unified Catalog Normalizer for BuyWhere.

Reads raw scraped NDJSON files from platform-specific directories (e.g.
data/shopee_sg/, data/lazada_sg/, data/cold_storage_sg/), validates each
product against the IngestProductItem schema, and writes normalized output
to data/normalized/ as NDJSON.

The output format matches POST /v1/ingest/products exactly so it can be
used directly by ingest_catalog.py or the API.

Usage:
    python normalize_catalog.py [--data-dir /path/to/data] [--output-dir /path/to/output]
    python normalize_catalog.py --dry-run
"""
import argparse
import json
import os
import sys
from collections import defaultdict
from datetime import datetime
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any, Optional

sys.path.insert(0, str(Path(__file__).parent.parent))

from app.schemas.ingest import IngestProductItem


VALID_CURRENCY_CODES = frozenset({
    "SGD", "USD", "MYR", "THB", "IDR", "PHP", "VND", "AUD", "NZD",
    "EUR", "GBP", "JPY", "CNY", "HKD", "TWD", "KRW", "INR", "PKR",
    "BDT", "LKR", "MMK", "KHR", "LAK", "BND", "FJD", "PGK",
})

MAX_PRICE = Decimal("9999999999.99")
MIN_PRICE = Decimal("0.01")

SOURCE_FIELD_MAPPINGS = {
    "product_id": "sku",
    "name": "title",
    "platform_id": "sku",
    "merchant_name": "brand",
}


def normalize_price(value: Any) -> tuple[Decimal, str]:
    if isinstance(value, dict):
        amount = float(value.get("amount", 0) or 0)
        currency = value.get("currency", "SGD")
    elif isinstance(value, (int, float)):
        amount = float(value)
        currency = "SGD"
    elif isinstance(value, str):
        currency = "SGD"
        cleaned = value.replace(",", "").replace("$", "").replace(" ", "").replace("USD", "").replace("SGD", "")
        try:
            amount = float(cleaned)
        except ValueError:
            amount = 0.0
    else:
        amount = 0.0
        currency = "SGD"
    return Decimal(str(round(amount, 2))), currency


def extract_platform_from_filename(filename: str) -> Optional[str]:
    name = Path(filename).stem
    if name.startswith("products_"):
        return Path(filename).parent.name
    if "_" in name:
        return name.split("_")[0]
    return name


def validate_record(record: dict, source: str) -> tuple[bool, Optional[dict], list[str]]:
    errors: list[str] = []

    if not record.get("sku"):
        if record.get("product_id"):
            record["sku"] = str(record["product_id"])
        elif record.get("platform_id"):
            record["sku"] = str(record["platform_id"])

    if not record.get("merchant_id"):
        record["merchant_id"] = source

    if not record.get("title"):
        if record.get("name"):
            record["title"] = record["name"]
        else:
            errors.append("missing_title")

    if not record.get("url"):
        if record.get("product_url"):
            record["url"] = record["product_url"]
        else:
            errors.append("missing_url")

    price = record.get("price")
    if price is None:
        errors.append("missing_price")
    else:
        try:
            if isinstance(price, (dict, str)):
                normalized_price, currency = normalize_price(price)
                record["price"] = normalized_price
                if record.get("currency") is None:
                    record["currency"] = currency
            elif isinstance(price, (int, float)):
                record["price"] = Decimal(str(round(float(price), 2)))
        except (ValueError, TypeError, InvalidOperation):
            errors.append("invalid_price")

    if record.get("currency") and record["currency"] not in VALID_CURRENCY_CODES:
        record["currency"] = "SGD"

    if record.get("brand") == "" and record.get("merchant_name"):
        record["brand"] = record["merchant_name"]

    if "category_path" not in record and record.get("category"):
        record["category_path"] = [record["category"]]

    if "metadata" not in record:
        record["metadata"] = {}

    if record.get("original_price") and "original_price" not in record["metadata"]:
        record["metadata"]["original_price"] = record.pop("original_price")

    is_valid = len(errors) == 0
    return is_valid, record if is_valid else None, errors


def normalize_record(raw: dict, source: str) -> Optional[dict]:
    record = {}

    field_map = {
        "sku": "sku",
        "merchant_id": "merchant_id",
        "title": "title",
        "description": "description",
        "price": "price",
        "currency": "currency",
        "url": "url",
        "image_url": "image_url",
        "category": "category",
        "category_path": "category_path",
        "brand": "brand",
        "is_active": "is_active",
        "is_available": "is_available",
        "in_stock": "in_stock",
        "stock_level": "stock_level",
        "availability": "availability",
        "metadata": "metadata",
    }

    for src_field, dst_field in field_map.items():
        if src_field in raw and raw[src_field] is not None:
            record[dst_field] = raw[src_field]

    for alt_src, dst in SOURCE_FIELD_MAPPINGS.items():
        if dst not in record and alt_src in raw:
            record[dst] = raw[alt_src]

    if not record.get("sku"):
        return None

    is_valid, normalized, errors = validate_record(record, source)
    if not is_valid:
        return None

    return normalized


def process_ndjson_file(filepath: Path, source: str) -> tuple[list[dict], dict[str, int], int, int, int]:
    records: list[dict] = []
    field_coverage = defaultdict(int)
    total = 0
    skipped = 0
    errors = 0

    with open(filepath, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                raw = json.loads(line)
            except json.JSONDecodeError:
                errors += 1
                continue

            total += 1
            normalized = normalize_record(raw, source)
            if normalized:
                records.append(normalized)
                for field in normalized:
                    if normalized.get(field) is not None and normalized.get(field) != "":
                        field_coverage[field] += 1
            else:
                skipped += 1

    return records, field_coverage, total, skipped, errors


def json_default(value: Any) -> Any:
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, datetime):
        return value.isoformat()
    raise TypeError(f"Object of type {type(value).__name__} is not JSON serializable")


def generate_report(
    files_processed: list[dict[str, Any]],
    overall_coverage: dict[str, int],
    total_records: int,
    total_skipped: int,
    total_errors: int,
) -> str:
    lines = []
    lines.append("=" * 70)
    lines.append("SCHEMA NORMALIZATION REPORT")
    lines.append(f"Generated: {datetime.now().isoformat()}")
    lines.append("=" * 70)
    lines.append("")
    lines.append(f"Files processed: {len(files_processed)}")
    lines.append(f"Total records:    {total_records:,}")
    lines.append(f"Normalized:      {total_records - total_skipped:,}")
    lines.append(f"Skipped:         {total_skipped:,}")
    lines.append(f"Parse errors:    {total_errors:,}")
    lines.append("")

    lines.append("-" * 70)
    lines.append("PER-FILE SUMMARY")
    lines.append("-" * 70)
    for fp in files_processed:
        lines.append(
            f"  {fp['source']}/{fp['file']}: normalized={fp['normalized']:,}, "
            f"skipped={fp['skipped']:,}, errors={fp['errors']:,}"
        )
    lines.append("")

    if overall_coverage:
        lines.append("-" * 70)
        lines.append("FIELD COVERAGE (normalized output)")
        lines.append("-" * 70)
        lines.append(f"{'Field':<20} {'Present':>10} {'Missing':>10} {'Coverage %':>12}")
        lines.append("-" * 70)
        normalized_count = total_records - total_skipped
        key_fields = ["sku", "title", "price", "currency", "url", "image_url", "category", "brand", "merchant_id"]
        for field in key_fields:
            present = overall_coverage.get(field, 0)
            missing = normalized_count - present
            coverage = (present / normalized_count * 100) if normalized_count > 0 else 0
            lines.append(f"{field:<20} {present:>10,} {missing:>10,} {coverage:>11.1f}%")
        lines.append("-" * 70)
        lines.append("")

    lines.append("=" * 70)
    return "\n".join(lines)


def find_scraped_files(data_dir: Path) -> list[tuple[Path, str]]:
    files: list[tuple[Path, str]] = []
    for subdir in data_dir.iterdir():
        if subdir.is_dir() and not subdir.name.startswith(".") and subdir.name != "normalized" and subdir.name != "raw":
            for jsonl_file in subdir.glob("*.jsonl"):
                files.append((jsonl_file, subdir.name))
            for ndjson_file in subdir.glob("*.ndjson"):
                files.append((ndjson_file, subdir.name))
    return sorted(files)


def main():
    parser = argparse.ArgumentParser(description="Unified Catalog Normalizer for BuyWhere")
    parser.add_argument(
        "--data-dir",
        default="/home/paperclip/buywhere-api/data",
        help="Directory containing platform subdirectories with scraped NDJSON files",
    )
    parser.add_argument(
        "--output-dir",
        default="/home/paperclip/buywhere-api/data/normalized",
        help="Directory for normalized output",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Validate without writing output files",
    )
    args = parser.parse_args()

    data_dir = Path(args.data_dir)
    output_dir = Path(args.output_dir)

    if not data_dir.exists():
        print(f"Error: Data directory does not exist: {data_dir}")
        sys.exit(1)

    files = find_scraped_files(data_dir)
    if not files:
        print(f"No scraped NDJSON/JSONL files found in {data_dir} subdirectories")
        sys.exit(1)

    if not args.dry_run:
        output_dir.mkdir(parents=True, exist_ok=True)

    print("=" * 60)
    print("UNIFIED CATALOG NORMALIZER")
    print("=" * 60)
    print(f"Source directory:  {data_dir}")
    print(f"Output directory:  {output_dir}")
    print(f"Files found:       {len(files)}")
    print(f"Dry run:           {args.dry_run}")
    print("=" * 60)

    files_processed: list[dict[str, Any]] = []
    overall_coverage: dict[str, int] = defaultdict(int)
    total_records = 0
    total_skipped = 0
    total_errors = 0

    by_platform: dict[str, list[tuple[Path, str]]] = defaultdict(list)
    for filepath, platform in files:
        by_platform[platform].append((filepath, platform))

    for platform, platform_files in by_platform.items():
        print(f"\n[{platform}] Processing {len(platform_files)} file(s)...")

        platform_records: list[dict] = []
        platform_total = 0
        platform_skipped = 0
        platform_errors = 0
        platform_coverage = defaultdict(int)

        for filepath, _ in platform_files:
            records, field_coverage, count, skipped, errs = process_ndjson_file(filepath, platform)
            platform_records.extend(records)
            platform_total += count
            platform_skipped += skipped
            platform_errors += errs
            for field, cnt in field_coverage.items():
                platform_coverage[field] += cnt
            for field, cnt in field_coverage.items():
                overall_coverage[field] += cnt

        total_records += platform_total
        total_skipped += platform_skipped
        total_errors += platform_errors

        print(
            f"  -> {len(platform_records):,} normalized, "
            f"{platform_skipped:,} skipped, {platform_errors:,} parse errors"
        )

        if platform_records and not args.dry_run:
            output_path = output_dir / f"{platform}_normalized.ndjson"
            with open(output_path, "w", encoding="utf-8") as f:
                for rec in platform_records:
                    f.write(json.dumps(rec, ensure_ascii=False, default=json_default) + "\n")
            print(f"  Wrote {len(platform_records):,} records to {output_path.name}")

        files_processed.append({
            "source": platform,
            "file": ",".join(f.name for f, _ in platform_files),
            "normalized": len(platform_records),
            "skipped": platform_skipped,
            "errors": platform_errors,
        })

    report = generate_report(
        files_processed,
        dict(overall_coverage),
        total_records,
        total_skipped,
        total_errors,
    )
    print("\n" + report)

    if not args.dry_run:
        report_path = output_dir / "normalization_report.txt"
        with open(report_path, "w") as f:
            f.write(report)
        print(f"Report saved to: {report_path}")

    normalized_count = total_records - total_skipped
    print(f"\nNormalized {normalized_count:,} records across {len(by_platform)} platforms")
    if total_errors > 0 or total_skipped > normalized_count * 0.5:
        sys.exit(1)


if __name__ == "__main__":
    main()
