#!/usr/bin/env python3
"""Ingest scraper NDJSON output directly into Railway PostgreSQL.

Reads NDJSON files from scraper output dirs and upserts into products table.
Uses psycopg2 (available via /home/paperclip/buywhere-catalog-api/venv) and
DATABASE_URL env var so it always writes to the correct Railway DB.
"""
import json
import os
import sys
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from pathlib import Path

sys.path.insert(0, '/home/paperclip/buywhere-catalog-api/venv/lib/python3.12/site-packages')
import psycopg2
import psycopg2.extras

import catalog_guard  # fail-fast: bulk writes only ever target maglev
DB_URL = catalog_guard.resolve_catalog_url()

WORKSPACE = Path("/paperclip/instances/default/workspaces/8ca957f8-0911-4e81-a963-e2cf54c97d44/buywhere")

PLATFORM_MAP = {
    "guardian_sg": "guardian_sg",
    "fairprice_sg": "fairprice_sg",
    "giant_sg": "giant_sg",
    "harvey_norman_sg": "harvey_norman_sg",
    "decathlon_sg": "decathlon_sg",
}

BATCH_SIZE = 500

UPSERT_SQL = """
    INSERT INTO products (
        sku, source, merchant_id, title, description, price, currency, url,
        category, category_path, image_url, is_active, in_stock, brand, metadata,
        region, country_code, updated_at, data_updated_at
    ) VALUES (
        %(sku)s, %(source)s, %(merchant_id)s, %(title)s, %(description)s, %(price)s,
        %(currency)s, %(url)s, %(category)s, %(category_path)s, %(image_url)s,
        %(is_active)s, %(in_stock)s, %(brand)s, %(metadata)s,
        %(region)s, %(country_code)s, NOW(), NOW()
    )
    ON CONFLICT (sku, source) DO UPDATE SET
        title = EXCLUDED.title,
        price = EXCLUDED.price,
        currency = EXCLUDED.currency,
        url = EXCLUDED.url,
        image_url = EXCLUDED.image_url,
        category = EXCLUDED.category,
        brand = EXCLUDED.brand,
        is_active = EXCLUDED.is_active,
        in_stock = EXCLUDED.in_stock,
        metadata = EXCLUDED.metadata,
        updated_at = NOW(),
        data_updated_at = NOW()
    RETURNING (xmax = 0) AS inserted
"""


def safe_decimal(val):
    if val is None or val == "":
        return None
    try:
        d = Decimal(str(val))
        if d > 99999999:
            return None
        return float(d)
    except (InvalidOperation, ValueError, TypeError):
        return None


def transform(record: dict, platform: str) -> dict | None:
    title = (record.get("title") or "").strip()
    url = (record.get("url") or "").strip()
    sku = (record.get("sku") or url or "").strip()
    if not title or not url or not sku:
        return None

    price = safe_decimal(record.get("price"))
    merchant_id = record.get("merchant_id", platform)
    metadata = record.get("metadata") or {}
    category_path = record.get("category_path") or []
    if not category_path and record.get("category"):
        category_path = [record["category"]]

    return {
        "sku": sku[:500],
        "source": platform,
        "merchant_id": (merchant_id or platform)[:500],
        "title": title[:2000],
        "description": (record.get("description") or "")[:5000],
        "price": price,
        "currency": (record.get("currency", "SGD") or "SGD")[:3],
        "url": url[:2000],
        "category": (record.get("category") or "")[:500],
        "category_path": category_path,
        "image_url": record.get("image_url"),
        "is_active": record.get("is_active", True),
        "in_stock": record.get("in_stock", True),
        "brand": (record.get("brand") or "")[:500] or None,
        "metadata": json.dumps(metadata),
        "region": "SG",
        "country_code": "SG",
    }


def create_ingestion_run(cur, source: str) -> int | None:
    try:
        cur.execute(
            "INSERT INTO ingestion_runs (source, status, started_at) VALUES (%s, 'running', NOW()) RETURNING id",
            (source,)
        )
        row = cur.fetchone()
        run_id = row[0] if row else None
        if run_id:
            print(f"  Created ingestion_run id={run_id} for {source}")
        return run_id
    except Exception as e:
        print(f"  Warning: failed to create ingestion_run for {source}: {e}")
        return None


def finish_ingestion_run(cur, run_id: int | None, inserted: int, updated: int, failed: int) -> None:
    if not run_id:
        return
    status = "failed" if inserted + updated == 0 and failed > 0 else "completed"
    try:
        cur.execute(
            "UPDATE ingestion_runs SET status=%s, rows_inserted=%s, rows_updated=%s, rows_failed=%s, finished_at=NOW() WHERE id=%s",
            (status, inserted, updated, failed, run_id)
        )
        print(f"  Updated ingestion_run id={run_id} status={status}")
    except Exception as e:
        print(f"  Warning: failed to update ingestion_run id={run_id}: {e}")


def ingest_batch(cur, batch: list[dict]) -> tuple[int, int]:
    if not batch:
        return 0, 0
    inserted = updated = 0
    for row in batch:
        cur.execute(UPSERT_SQL, row)
        result = cur.fetchone()
        if result and result[0]:
            inserted += 1
        else:
            updated += 1
    return inserted, updated


def ingest_file(cur, filepath: Path, platform: str) -> tuple[int, int, int, int]:
    total = inserted = updated = errors = 0
    batch = []

    with open(filepath) as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            total += 1
            try:
                record = json.loads(line)
                row = transform(record, platform)
                if row is None:
                    errors += 1
                    continue
                batch.append(row)
                if len(batch) >= BATCH_SIZE:
                    batch_inserted, batch_updated = ingest_batch(cur, batch)
                    inserted += batch_inserted
                    updated += batch_updated
                    batch = []
            except Exception as e:
                errors += 1
                if errors <= 5:
                    print(f"  Error on line {total}: {e}")

    if batch:
        batch_inserted, batch_updated = ingest_batch(cur, batch)
        inserted += batch_inserted
        updated += batch_updated

    return total, inserted, updated, errors


def main(sources: list[str] | None = None):
    search_dirs = {
        "guardian_sg": WORKSPACE / "data" / "guardian_sg",
        "fairprice_sg": WORKSPACE / "data" / "fairprice_scrape",
        "giant_sg": WORKSPACE / "data" / "giant_sg",
        "harvey_norman_sg": WORKSPACE / "data" / "harvey-norman",
        "decathlon_sg": WORKSPACE / "data" / "decathlon",
    }

    if sources:
        search_dirs = {k: v for k, v in search_dirs.items() if k in sources}

    conn = psycopg2.connect(DB_URL)
    cur = conn.cursor()
    catalog_guard.assert_catalog_cursor(cur)

    results = {}
    for merchant, data_dir in search_dirs.items():
        platform = PLATFORM_MAP[merchant]
        if not data_dir.exists():
            print(f"[{merchant}] No data dir at {data_dir}, skipping")
            continue

        files = sorted(data_dir.glob("*.jsonl")) + sorted(data_dir.glob("*.ndjson"))
        if not files:
            print(f"[{merchant}] No JSONL/NDJSON files in {data_dir}, skipping")
            continue

        print(f"\n[{merchant}] Ingesting {len(files)} file(s) from {data_dir}")
        run_id = create_ingestion_run(cur, platform)
        conn.commit()

        total_t = total_i = total_u = total_e = 0
        for fpath in files:
            t, i, u, e = ingest_file(cur, fpath, platform)
            conn.commit()
            total_t += t
            total_i += i
            total_u += u
            total_e += e
            print(f"  {fpath.name}: {t} records, {i} upserted, {e} errors")

        finish_ingestion_run(cur, run_id, total_i, total_u, total_e)
        conn.commit()
        results[merchant] = {"total": total_t, "inserted": total_i, "updated": total_u, "errors": total_e}

    conn.close()

    print("\n=== INGEST SUMMARY ===")
    grand_total = 0
    for merchant, r in results.items():
        print(f"  {merchant}: {r['inserted']} upserted, {r['errors']} errors")
        grand_total += r["inserted"]
    print(f"  TOTAL processed: {grand_total}")


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="Ingest NDJSON scraper output into Railway PostgreSQL")
    parser.add_argument("--sources", nargs="*", help="Limit to specific sources (e.g. guardian_sg fairprice_sg)")
    args = parser.parse_args()
    main(sources=args.sources)
