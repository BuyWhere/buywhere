#!/usr/bin/env python3
"""
Bulk re-index all products from Postgres into Typesense.

Usage:
    python scripts/reindex_typesense.py

Reads TYPESENSE_URL and TYPESENSE_API_KEY from environment (or .env file).
Connects to Postgres at DB_HOST (default 172.18.0.4).

Progress is logged to stdout. On completion, final counts are printed.
"""
import json
import logging
import os
import sys
import time
from datetime import datetime, timezone

import psycopg2
import psycopg2.extras
import requests

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
    stream=sys.stdout,
)
log = logging.getLogger(__name__)

# ── Config ────────────────────────────────────────────────────────────────────

# Load .env if present (simple key=value parsing, no external deps)
_env_path = os.path.join(os.path.dirname(__file__), "..", ".env")
if os.path.exists(_env_path):
    with open(_env_path) as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, _, v = line.partition("=")
                os.environ.setdefault(k.strip(), v.strip())

TYPESENSE_URL = os.getenv("TYPESENSE_URL", "http://localhost:8108")
TYPESENSE_API_KEY = os.getenv("TYPESENSE_API_KEY", "")
COLLECTION = "products"
BATCH_SIZE = 500  # documents per Typesense import call
DB_HOST = os.getenv("DB_HOST", "172.18.0.4")
DB_PORT = int(os.getenv("DB_PORT", "5432"))
DB_NAME = os.getenv("DB_NAME", "buywhere")
DB_USER = os.getenv("DB_USER", "buywhere")
DB_PASS = os.getenv("DB_PASS", "buywhere")

TS_HEADERS = {
    "X-TYPESENSE-API-KEY": TYPESENSE_API_KEY,
    "Content-Type": "text/plain",
}

# ── Helpers ───────────────────────────────────────────────────────────────────

def ts_get(path: str) -> dict:
    r = requests.get(f"{TYPESENSE_URL}{path}", headers=TS_HEADERS, timeout=10)
    r.raise_for_status()
    return r.json()


def ts_import_batch(docs: list[dict]) -> dict:
    """POST NDJSON batch to Typesense; returns summary dict."""
    ndjson = "\n".join(json.dumps(d) for d in docs)
    r = requests.post(
        f"{TYPESENSE_URL}/collections/{COLLECTION}/documents/import?action=upsert",
        headers=TS_HEADERS,
        data=ndjson.encode(),
        timeout=60,
    )
    r.raise_for_status()
    # Typesense returns one JSON line per document
    results = [json.loads(line) for line in r.text.strip().splitlines()]
    successes = sum(1 for res in results if res.get("success"))
    failures = [res for res in results if not res.get("success")]
    return {"success": successes, "failures": failures}


def to_unix(dt) -> int:
    """Convert datetime (with or without tzinfo) to unix timestamp int64."""
    if dt is None:
        return int(time.time())
    if hasattr(dt, "timestamp"):
        return int(dt.replace(tzinfo=timezone.utc).timestamp() if dt.tzinfo is None else dt.timestamp())
    return int(time.time())


def row_to_doc(row: dict) -> dict:
    """Map a Postgres row to a Typesense document."""
    doc: dict = {
        "id": str(row["id"]),
        "sku": row["sku"] or "",
        "platform": str(row["platform"]),
        "name": row["name"] or "",
        "price": float(row["price"] or 0),
        "currency": row["currency"] or "SGD",
        "category_path": list(row["category_path"]) if row["category_path"] else [],
        "availability": str(row["availability"]) if row["availability"] else "unknown",
        "merchant_id": str(row["merchant_id"]) or "",
        "merchant_name": row["merchant_name"] or "",
        "product_url": row["product_url"] or "",
        "indexed_at": to_unix(row.get("indexed_at")),
        "updated_at": to_unix(row.get("updated_at")),
    }
    # Optional fields — only include if not None/empty
    if row.get("description"):
        doc["description"] = str(row["description"])[:2000]  # cap length
    if row.get("brand"):
        doc["brand"] = str(row["brand"])
    if row.get("original_price") is not None:
        op = float(row["original_price"])
        if op > 0:
            doc["original_price"] = op
    if row.get("image_url"):
        doc["image_url"] = str(row["image_url"])
    if row.get("rating") is not None:
        doc["rating"] = float(row["rating"])
    if row.get("review_count") is not None:
        doc["review_count"] = int(row["review_count"])
    if row.get("tags"):
        doc["tags"] = list(row["tags"])
    return doc


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    if not TYPESENSE_API_KEY:
        log.error("TYPESENSE_API_KEY is not set")
        sys.exit(1)

    # Verify Typesense is reachable
    try:
        info = ts_get(f"/collections/{COLLECTION}")
        log.info("Typesense collection '%s' — current docs: %d", COLLECTION, info["num_documents"])
    except Exception as e:
        log.error("Cannot reach Typesense at %s: %s", TYPESENSE_URL, e)
        sys.exit(1)

    # Connect to Postgres
    log.info("Connecting to Postgres at %s:%d/%s", DB_HOST, DB_PORT, DB_NAME)
    try:
        conn = psycopg2.connect(
            host=DB_HOST, port=DB_PORT, dbname=DB_NAME,
            user=DB_USER, password=DB_PASS,
        )
    except Exception as e:
        log.error("Cannot connect to Postgres: %s", e)
        sys.exit(1)

    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    # Total count
    cur.execute("SELECT COUNT(*) AS n FROM products;")
    total = cur.fetchone()["n"]
    conn.commit()
    log.info("Total products in DB: %d", total)

    # Named server-side cursor for streaming (requires open transaction)
    cur2 = conn.cursor(
        name="reindex_cursor",
        cursor_factory=psycopg2.extras.RealDictCursor,
    )
    cur2.execute("""
        SELECT id, sku, platform, name, description, brand,
               price, currency, original_price,
               category_path, availability,
               merchant_id, merchant_name,
               image_url, rating, review_count,
               tags, product_url,
               indexed_at, updated_at
        FROM products
        ORDER BY updated_at ASC
    """)
    cur2.itersize = BATCH_SIZE

    indexed = 0
    failed_total = 0
    batch = []
    t0 = time.time()

    for row in cur2:
        try:
            doc = row_to_doc(row)
            batch.append(doc)
        except Exception as e:
            log.warning("Skipping row %s: %s", row.get("id"), e)
            failed_total += 1
            continue

        if len(batch) >= BATCH_SIZE:
            result = ts_import_batch(batch)
            indexed += result["success"]
            failed_total += len(result["failures"])
            if result["failures"]:
                for f in result["failures"][:3]:
                    log.warning("Import failure: %s", f)
            batch = []

            elapsed = time.time() - t0
            rate = indexed / elapsed if elapsed > 0 else 0
            pct = indexed / total * 100 if total > 0 else 0
            log.info("Progress: %d/%d (%.1f%%) — %.0f docs/s", indexed, total, pct, rate)

    # Final batch
    if batch:
        result = ts_import_batch(batch)
        indexed += result["success"]
        failed_total += len(result["failures"])

    cur2.close()
    cur.close()
    conn.close()

    elapsed = time.time() - t0
    log.info("=" * 60)
    log.info("Re-index complete in %.1fs", elapsed)
    log.info("  Indexed:  %d", indexed)
    log.info("  Failed:   %d", failed_total)
    log.info("  DB total: %d", total)

    # Verify final Typesense count
    try:
        info = ts_get(f"/collections/{COLLECTION}")
        log.info("Typesense now has: %d documents", info["num_documents"])
    except Exception as e:
        log.warning("Could not verify final count: %s", e)


if __name__ == "__main__":
    main()
