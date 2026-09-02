#!/usr/bin/env python3
"""Batch ingest Dash scraper outputs into BuyWhere ingestion endpoint.

Expected input shape: line-delimited JSON or JSON array with product objects.
The script is tolerant of multiple equivalent schemas produced by Dash jobs:
- name/title
- sku/product_id
- price as number or {"amount": ..., "currency": ...}
- in_stock / is_active / is_available / availability
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import re
from collections.abc import Callable
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any

import httpx


DEFAULT_BATCH_SIZE = 500
DEFAULT_CURRENCY = "SGD"
DEFAULT_SOURCE = "dash"
API_BASE_ENV = "BUYWHERE_API_URL"
API_KEY_ENV = "PAPERCLIP_API_KEY"


def safe_decimal(value: Any) -> float | None:
    if value is None or value == "" or value == "None":
        return None
    try:
        amt = Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError):
        return None

    if amt < 0 or amt > Decimal("99999999"):
        return None
    return float(amt)


def pick_first(*values: Any) -> Any:
    for value in values:
        if value is not None and value != "":
            return value
    return None


def parse_price(raw_price: Any) -> tuple[float | None, str]:
    if isinstance(raw_price, dict):
        amount = safe_decimal(raw_price.get("amount"))
        currency = pick_first(raw_price.get("currency"), raw_price.get("currency_code"), raw_price.get("currency_code_iso")) or DEFAULT_CURRENCY
        return amount, str(currency)

    if isinstance(raw_price, str):
        normalized = re.sub(r"[^0-9.]", "", raw_price)
        return safe_decimal(normalized), DEFAULT_CURRENCY

    amount = safe_decimal(raw_price)
    return amount, DEFAULT_CURRENCY


def normalize_row(row: dict[str, Any], source: str, default_category: str | None = None) -> dict[str, Any] | None:
    title = row.get("title") or row.get("name") or ""
    if not isinstance(title, str):
        title = str(title or "")
    title = title.strip()
    if not title:
        return None

    sku = str(pick_first(row.get("sku"), row.get("product_id"), row.get("id"), "")).strip()
    if not sku:
        return None

    merchant_id = str(pick_first(row.get("merchant_id"), row.get("merchant"), source, source, "")).strip() or source
    url = pick_first(row.get("url"), row.get("link"), row.get("product_url"), "")
    if not isinstance(url, str):
        url = str(url)
    url = url.strip()
    if not url:
        return None

    price_obj = row.get("price", 0)
    price, currency = parse_price(price_obj)
    if price is None or price <= 0:
        return None

    currency = str(currency).strip().upper() if currency else DEFAULT_CURRENCY
    if len(currency) != 3:
        currency = DEFAULT_CURRENCY

    description = row.get("description", "")
    if not isinstance(description, str):
        description = str(description or "")
    description = description.strip()[:5000]

    image_url = pick_first(row.get("image_url"), row.get("image"), row.get("thumbnail"), "")
    if image_url is not None and not isinstance(image_url, str):
        image_url = str(image_url)

    category_path = row.get("category_path")
    if not isinstance(category_path, list):
        category_path = []
    category = row.get("category")
    if not category:
        category = row.get("department") or row.get("group") or row.get("collection")
    if category and isinstance(category, str) and category_path == []:
        category_path = [category.strip()]
    if default_category and not category and not category_path:
        category_path = [default_category]

    brand = row.get("brand", "")
    if isinstance(brand, dict):
        brand = brand.get("name", "")
    if not isinstance(brand, str):
        brand = str(brand or "")

    availability = row.get("availability", "")
    in_stock = row.get("in_stock")
    if isinstance(in_stock, str):
        in_stock = in_stock.strip().lower() in {"true", "1", "yes", "in_stock"}
    if in_stock is None:
        is_available = row.get("is_available")
        if isinstance(is_available, str):
            is_available = is_available.strip().lower() in {"true", "1", "yes", "in_stock"}
        if is_available is not None:
            in_stock = bool(is_available)
    if isinstance(in_stock, str) and in_stock.lower() in {"true", "false", "1", "0"}:
        in_stock = in_stock.lower() in {"true", "1"}
    if in_stock is None:
        if isinstance(availability, str):
            in_stock = availability.strip().lower() not in {"out_of_stock", "oos", "not_available", "unavailable"}
        else:
            in_stock = True

    is_active = row.get("is_active", True)
    if isinstance(is_active, str):
        is_active = is_active.strip().lower() in {"true", "1", "yes"}

    metadata = row.get("metadata")
    if not isinstance(metadata, dict):
        metadata = {}
    metadata = dict(metadata)
    metadata.setdefault("source", source)
    metadata.setdefault("merchant_id", merchant_id)
    metadata.setdefault("ingested_at", datetime.now(timezone.utc).isoformat())

    return {
        "sku": sku[:500],
        "merchant_id": merchant_id[:500],
        "title": title[:1000],
        "description": description,
        "price": price,
        "currency": currency[:3],
        "url": url[:2000],
        "image_url": image_url,
        "category_path": category_path[:10],
        "brand": brand[:200] if brand else None,
        "is_active": bool(is_active),
        "in_stock": bool(in_stock),
        "category": category[:200] if isinstance(category, str) else None,
        "metadata": metadata,
        "is_available": bool(in_stock),
    }


def load_rows(path: Path) -> list[dict[str, Any]]:
    raw = path.read_text(encoding="utf-8")
    raw = raw.strip()
    if not raw:
        return []

    if raw.startswith("["):
        payload = json.loads(raw)
        if isinstance(payload, list):
            return [r for r in payload if isinstance(r, dict)]
        return []

    rows: list[dict[str, Any]] = []
    for line in raw.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            row = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(row, dict):
            rows.append(row)
    return rows


async def post_batch(
    client: httpx.AsyncClient,
    api_base: str,
    api_key: str,
    source: str,
    products: list[dict[str, Any]],
) -> tuple[int, int, int]:
    if not products:
        return 0, 0, 0

    endpoint = f"{api_base.rstrip('/')}/v1/ingest/products"
    payload = {
        "source": source,
        "products": products,
    }
    resp = await client.post(
        endpoint,
        json=payload,
        headers={"Authorization": f"Bearer {api_key}"},
        timeout=120.0,
    )
    resp.raise_for_status()
    result = resp.json()
    return int(result.get("rows_inserted", 0)), int(result.get("rows_updated", 0)), int(result.get("rows_failed", 0))


async def ingest_file(
    client: httpx.AsyncClient,
    path: Path,
    api_base: str,
    api_key: str,
    source: str,
    batch_size: int,
    default_category: str | None = None,
) -> tuple[int, int, int]:
    rows = load_rows(path)
    normalized: list[dict[str, Any]] = []
    rows_seen = 0
    for row in rows:
        rows_seen += 1
        normalized_row = normalize_row(row, source=source, default_category=default_category)
        if normalized_row:
            normalized.append(normalized_row)

    if not normalized:
        return 0, 0, rows_seen

    inserted = updated = failed = 0
    for start in range(0, len(normalized), batch_size):
        chunk = normalized[start:start + batch_size]
        try:
            i, u, f = await post_batch(client, api_base, api_key, source, chunk)
            inserted += i
            updated += u
            failed += f
        except Exception as exc:
            print(f"  ERROR posting {path.name} chunk {start // batch_size + 1}: {exc}", flush=True)
            failed += len(chunk)

    return inserted, updated, failed


def parse_sources(items: list[str]) -> dict[str, str]:
    parsed = {}
    for item in items:
        if ":" not in item:
            raise ValueError("Invalid --source-map entry; expected source:glob")
        source, pattern = item.split(":", 1)
        if not source or not pattern:
            raise ValueError("Invalid --source-map entry; expected source:glob")
        parsed[pattern] = source
    return parsed


def infer_source(path: Path, source_hint: str | None, source_map: dict[str, str]) -> str:
    if source_hint:
        return source_hint

    stem = path.name.lower()
    for pattern, source in source_map.items():
        if pattern and pattern in stem:
            return source

    return DEFAULT_SOURCE


async def run(paths: list[Path], api_base: str, api_key: str, source_hint: str | None, default_category: str | None,
              batch_size: int, source_map: dict[str, str]) -> tuple[int, int, int]:
    inserted = updated = failed = 0
    async with httpx.AsyncClient(timeout=120.0) as client:
        for path in paths:
            source = infer_source(path, source_hint, source_map)
            print(f"[{path.name}] source={source}", flush=True)
            file_inserted, file_updated, file_failed = await ingest_file(
                client=client,
                path=path,
                api_base=api_base,
                api_key=api_key,
                source=source,
                batch_size=batch_size,
                default_category=default_category,
            )
            print(f"  inserted={file_inserted} updated={file_updated} failed={file_failed}", flush=True)
            inserted += file_inserted
            updated += file_updated
            failed += file_failed

    return inserted, updated, failed


def discover_input_files(input_path: Path, glob_patterns: list[str]) -> list[Path]:
    files: list[Path] = []
    if input_path.is_file():
        return [input_path]

    for pattern in glob_patterns:
        files.extend(sorted(input_path.glob(pattern)))
    return files


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="Import Dash scraper outputs into BuyWhere")
    p.add_argument("paths", nargs="*", default=["data"], help="Input file(s) or directory containing JSON/JSONL outputs")
    p.add_argument("--api-base", default=os.environ.get("BUYWHERE_API_BASE", "http://localhost:3000"), help="BuyWhere API base URL")
    p.add_argument("--api-key", default=os.environ.get(API_KEY_ENV), help=f"API key (defaults to env {API_KEY_ENV})")
    p.add_argument("--source", help="Override ingest source for all files")
    p.add_argument("--source-map", action="append", default=[], help="Map filename contains pattern to source, e.g. --source-map carousell_sg:carousell")
    p.add_argument("--batch-size", type=int, default=DEFAULT_BATCH_SIZE, help="Products per ingest request")
    p.add_argument("--default-category", help="Fallback category when missing in input row")
    p.add_argument("--glob", action="append", default=["*.jsonl", "*.ndjson", "*.json"], help="Input glob patterns when directories are provided")
    return p


def main() -> int:
    args = build_parser().parse_args()
    api_key = args.api_key
    if not api_key:
        print(f"ERROR: API key is required (set --api-key or env {API_KEY_ENV})")
        return 2

    try:
        source_map = parse_sources(args.source_map)
    except ValueError as exc:
        print(f"ERROR: {exc}")
        return 2

    all_paths: list[Path] = []
    for raw_path in args.paths:
        path = Path(raw_path)
        if not path.exists():
            print(f"WARNING: Path not found: {path}")
            continue
        all_paths.extend(discover_input_files(path, args.glob))

    if not all_paths:
        print("No matching input files found.")
        return 0

    inserted, updated, failed = asyncio.run(
        run(all_paths, args.api_base, api_key, args.source, args.default_category, args.batch_size, source_map)
    )
    print(f"Total inserted={inserted} updated={updated} failed={failed}")
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
