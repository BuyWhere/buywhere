#!/usr/bin/env python3
"""Ingest scraper NDJSON output directly into Railway PostgreSQL.

Reads NDJSON files from scraper output dirs and upserts into products table
using the Railway DB schema (title/url/source columns).
"""
import asyncio
import json
import sys
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from pathlib import Path

import asyncpg

DB_URL = "postgresql://postgres:uzxujl66t16mzzsr3unqcw8e0v54yutb@roundhouse.proxy.rlwy.net:27479/railway"

PLATFORM_MAP = {
    "guardian_sg": "guardian_sg",
    "fairprice_sg": "fairprice_sg",
    "giant_sg": "giant_sg",
    "harvey_norman_sg": "harveynorman.com.sg",
    "decathlon_sg": "decathlon_sg",
}

BATCH_SIZE = 500


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

    now = datetime.now(timezone.utc)

    return {
        "sku": sku[:500],
        "source": platform,
        "platform": platform,
        "merchant_id": merchant_id[:500],
        "title": title[:2000],
        "description": (record.get("description") or "")[:5000],
        "price": price,
        "price_sgd": price,
        "currency": record.get("currency", "SGD")[:3],
        "url": url[:2000],
        "category": (record.get("category") or "")[:500],
        "category_path": category_path,
        "image_url": record.get("image_url"),
        "is_active": record.get("is_active", True),
        "is_available": record.get("is_available", True),
        "in_stock": record.get("is_available", True),
        "brand": (record.get("brand") or "")[:500] or None,
        "metadata": json.dumps(metadata),
        "review_count": record.get("review_count"),
        "rating": record.get("rating"),
        "barcode": record.get("barcode") or record.get("gtin"),
        "region": "SG",
        "country_code": "SG",
        "created_at": now,
        "updated_at": now,
        "data_updated_at": now,
    }


UPSERT_SQL = """
    INSERT INTO products (
        sku, source, merchant_id, title, description, price, price_sgd,
        currency, url, category, category_path, image_url, is_active, is_available,
        in_stock, brand, metadata, review_count, rating, barcode, region, country_code,
        created_at, updated_at, data_updated_at
    ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
        $15, $16, $17::jsonb, $18, $19, $20, $21, $22, $23, $24, $25
    )
    ON CONFLICT (sku, source) DO UPDATE SET
        title = EXCLUDED.title,
        price = EXCLUDED.price,
        price_sgd = EXCLUDED.price_sgd,
        is_available = EXCLUDED.is_available,
        in_stock = EXCLUDED.in_stock,
        updated_at = EXCLUDED.updated_at,
        data_updated_at = EXCLUDED.data_updated_at
"""


async def ingest_file(conn, filepath: Path, platform: str):
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
                    ins, upd = await flush_batch(conn, batch)
                    inserted += ins
                    updated += upd
                    batch = []
            except Exception as e:
                errors += 1
                if errors <= 5:
                    print(f"  Error on line {total}: {e}")

    if batch:
        ins, upd = await flush_batch(conn, batch)
        inserted += ins
        updated += upd

    return total, inserted, updated, errors


async def flush_batch(conn, batch: list[dict]) -> tuple[int, int]:
    inserted = updated = 0
    for row in batch:
        try:
            result = await conn.execute(
                UPSERT_SQL,
                row["sku"], row["source"], row["merchant_id"],
                row["title"], row["description"], row["price"], row["price_sgd"],
                row["currency"], row["url"], row["category"], row["category_path"],
                row["image_url"], row["is_active"], row["is_available"],
                row["in_stock"], row["brand"], row["metadata"],
                row["review_count"], row["rating"], row["barcode"],
                row["region"], row["country_code"],
                row["created_at"], row["updated_at"], row["data_updated_at"],
            )
            if "INSERT" in result:
                inserted += 1
            else:
                updated += 1
        except Exception as e:
            pass
    return inserted, updated


async def create_ingestion_run(conn, source: str) -> int | None:
    try:
        row = await conn.fetchrow(
            "INSERT INTO ingestion_runs (source, status) VALUES ($1, 'running') RETURNING id",
            source,
        )
        run_id = row["id"] if row else None
        if run_id:
            print(f"  Created ingestion_run id={run_id} for {source}")
        return run_id
    except Exception as e:
        print(f"  Warning: failed to create ingestion_run for {source}: {e}")
        return None


async def finish_ingestion_run(conn, run_id: int, inserted: int, updated: int, failed: int) -> None:
    if not run_id:
        return
    status = "failed" if inserted + updated == 0 and failed > 0 else "done"
    try:
        await conn.execute(
            "UPDATE ingestion_runs SET status = $1, rows_inserted = $2, rows_updated = $3, rows_failed = $4, finished_at = NOW() WHERE id = $5",
            status, inserted, updated, failed, run_id,
        )
        print(f"  Updated ingestion_run id={run_id} status={status}")
    except Exception as e:
        print(f"  Warning: failed to update ingestion_run id={run_id}: {e}")


async def main(dirs: list[str] | None = None):
    conn = await asyncpg.connect(DB_URL)

    search_dirs = {
        "guardian_sg": Path("/home/paperclip/buywhere-api/data/guardian_sg"),
        "fairprice_sg": Path("/home/paperclip/buywhere-api/data/fairprice_sg"),
        "giant_sg": Path("/home/paperclip/buywhere-api/data/giant-sg"),
        "harvey_norman_sg": Path("/home/paperclip/buywhere-api/data/harvey-norman"),
        "decathlon_sg": Path("/home/paperclip/buywhere-api/data/decathlon"),
    }

    if dirs:
        search_dirs = {k: v for k, v in search_dirs.items() if k in dirs}

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
        print(f"\n[{merchant}] Ingesting {len(files)} file(s) into platform={platform}")
        run_id = await create_ingestion_run(conn, platform)
        total_t = total_i = total_u = total_e = 0
        for f in files:
            t, i, u, e = await ingest_file(conn, f, platform)
            total_t += t
            total_i += i
            total_u += u
            total_e += e
            print(f"  {f.name}: {t} records, {i} inserted, {u} updated, {e} errors")
        await finish_ingestion_run(conn, run_id, total_i, total_u, total_e)
        results[merchant] = {"total": total_t, "inserted": total_i, "updated": total_u, "errors": total_e}

    await conn.close()

    print("\n=== INGEST SUMMARY ===")
    grand_total = 0
    for merchant, r in results.items():
        print(f"  {merchant}: {r['inserted']} inserted, {r['updated']} updated, {r['errors']} errors")
        grand_total += r["inserted"] + r["updated"]
    print(f"  TOTAL processed: {grand_total}")

    # Final DB counts
    conn2 = await asyncpg.connect(DB_URL)
    rows = await conn2.fetch("""
        SELECT platform, COUNT(*) as cnt FROM products
        WHERE platform IN ('guardian_sg', 'fairprice_sg', 'giant_sg', 'harveynorman.com.sg', 'decathlon_sg',
                           'harvey_norman', 'decathlon', 'guardian', 'fairprice', 'giant')
        GROUP BY platform ORDER BY cnt DESC
    """)
    print("\n=== DB COUNTS (target merchants) ===")
    for r in rows:
        print(f"  {r['platform']}: {r['cnt']}")
    await conn2.close()


if __name__ == "__main__":
    merchants = sys.argv[1:] if len(sys.argv) > 1 else None
    asyncio.run(main(merchants))
