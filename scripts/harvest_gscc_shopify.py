#!/usr/bin/env python3
"""GS CommonCrawl Shopify Harvest Lane — BUY-61779.

Bounded batch harvester for merchants from gs_commoncrawl_discovery source
with products_count = 0. Uses FOR UPDATE SKIP LOCKED for safe concurrency.

Usage:
    python3 scripts/harvest_gscc_shopify.py --limit 100 --start-after-id 12345
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

import psycopg2
import psycopg2.extras

ROOT_DIR = Path(__file__).resolve().parent.parent
CURSOR_FILE = Path("data/buy61779-cursors.json")
DSN_PATH = ROOT_DIR / "data" / ".catalog_db_url"
APP_NAME = "harvest-gscc-shopify-buy61779"

HTTP_OPENER = urllib.request.build_opener()
REQUEST_DELAY = 0.5  # seconds between requests


def load_dsn() -> str:
    dsn = DSN_PATH.read_text().strip()
    if not dsn:
        raise RuntimeError(f"empty DSN at {DSN_PATH}")
    if "roundhouse" in dsn.lower():
        raise RuntimeError("REFUSING roundhouse control-plane DSN")
    return dsn


def connect() -> psycopg2.extensions.connection:
    return psycopg2.connect(load_dsn(), application_name=APP_NAME)


def read_cursors() -> dict[str, int]:
    if CURSOR_FILE.exists():
        try:
            return json.loads(CURSOR_FILE.read_text())
        except (ValueError, OSError):
            pass
    return {}


def write_cursors(cursors: dict[str, int]) -> None:
    CURSOR_FILE.write_text(json.dumps(cursors, indent=2))


def write_cursor(cursor_id: int) -> None:
    CURSOR_FILE.write_text(str(cursor_id))
    print(f"  [cursor] saved after_id={cursor_id}", flush=True)


# Priority sources — ordered by quality:
# cashbackholic: 15K affiliate merchants (high live rate)
# cc-shopify-discover: 60 merchants, Shopify-specific, some live
# shopify: 8.5K direct Shopify merchants (lower live rate)
# gs_commoncrawl_discovery: 34K myshopify subdomains (mostly dead)
# NOTE: known_shopify_domains_2026_06_25 is exhausted of live stores (0% yield)
PRIORITY_SOURCES = [
    "cashbackholic",
    "cc-shopify-discover",
    "shopify",
    "gs_commoncrawl_discovery",
]


def claim_merchants(conn, limit: int, cursors: dict[str, int]) -> tuple[list[dict], dict[str, int]]:
    """Claim merchants cycling through priority sources, one source at a time.
    Returns (merchants, updated_cursors). Uses a fresh connection per source."""
    remaining = limit
    results = []
    new_cursors = dict(cursors)
    for source in PRIORITY_SOURCES:
        if remaining <= 0:
            break
        after_id = cursors.get(source)
        # Each source gets its own connection so timeouts don't poison the whole run
        try:
            src_conn = psycopg2.connect(load_dsn(), application_name=APP_NAME)
        except Exception:
            continue
        try:
            with src_conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute(
                    """
                    SET statement_timeout = '20s';
                    """
                )
                if after_id is not None:
                    cur.execute(
                        """
                        WITH candidates AS (
                            SELECT id, domain, source
                            FROM merchants
                            WHERE source = %s
                              AND COALESCE(products_count, 0) = 0
                              AND NULLIF(domain, '') IS NOT NULL
                              AND id > %s
                            ORDER BY id ASC
                            LIMIT %s
                            FOR UPDATE SKIP LOCKED
                        )
                        UPDATE merchants m
                        SET onboarding_stage = 'harvest_gscc_claimed'
                        FROM candidates c
                        WHERE m.id = c.id
                        RETURNING m.id, m.domain, m.source
                        """,
                        (source, after_id, remaining)
                    )
                else:
                    cur.execute(
                        """
                        WITH candidates AS (
                            SELECT id, domain, source
                            FROM merchants
                            WHERE source = %s
                              AND COALESCE(products_count, 0) = 0
                              AND NULLIF(domain, '') IS NOT NULL
                            ORDER BY id ASC
                            LIMIT %s
                            FOR UPDATE SKIP LOCKED
                        )
                        UPDATE merchants m
                        SET onboarding_stage = 'harvest_gscc_claimed'
                        FROM candidates c
                        WHERE m.id = c.id
                        RETURNING m.id, m.domain, m.source
                        """,
                        (source, remaining)
                    )
                batch = list(cur.fetchall())
                if batch:
                    results.extend(batch)
                    remaining -= len(batch)
                    new_cursors[source] = batch[-1]["id"]
        except psycopg2.errors.QueryCanceled:
            new_cursors.pop(source, None)
            print(f"  WARNING: claim timed out for source '{source}', will retry next run", flush=True)
        except psycopg2.errors.InFailedSQLTransaction:
            new_cursors.pop(source, None)
            print(f"  WARNING: claim failed for source '{source}' (aborted tx), will retry", flush=True)
        except Exception as e:
            new_cursors.pop(source, None)
            print(f"  WARNING: claim failed for source '{source}': {e}", flush=True)
        finally:
            src_conn.close()
    return results, new_cursors


def release_merchants(conn, ids: list[int]) -> None:
    """Release claimed merchants (reset stage)."""
    if not ids:
        return
    with conn.cursor() as cur:
        cur.execute(
            "UPDATE merchants SET onboarding_stage = NULL WHERE id = ANY(%s)",
            (ids,)
        )
        conn.commit()


def update_merchant_stats(conn, merchant_id: int, domain: str, product_count: int, stage: str) -> None:
    """Update merchant product count and stage."""
    source = f"shopify_{re.sub(r'[^a-z0-9]+', '_', domain.lower())[:100]}"
    with conn.cursor() as cur:
        cur.execute(
            """
            UPDATE merchants
            SET products_count = %s,
                onboarding_stage = %s,
                source = COALESCE(NULLIF(source, ''), %s),
                updated_at = NOW()
            WHERE id = %s
            """,
            (product_count, stage, source, merchant_id)
        )


def upsert_products(conn, products: list[dict], domain: str) -> tuple[int, int]:
    """Upsert products on (sku, source)."""
    if not products:
        return 0, 0
    source = f"shopify_{re.sub(r'[^a-z0-9]+', '_', domain.lower())[:100]}"
    with conn.cursor() as cur:
        for p in products:
            cur.execute(
                """
                INSERT INTO products (
                    sku, merchant_id, title, description, price, currency,
                    url, image_url, category, brand, is_active, is_available,
                    in_stock, availability, country_code, source, created_at, updated_at
                ) VALUES (
                    %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW(), NOW()
                )
                ON CONFLICT (sku, source) DO UPDATE SET
                    title = EXCLUDED.title,
                    description = EXCLUDED.description,
                    price = EXCLUDED.price,
                    currency = EXCLUDED.currency,
                    image_url = EXCLUDED.image_url,
                    category = EXCLUDED.category,
                    brand = EXCLUDED.brand,
                    is_active = EXCLUDED.is_active,
                    is_available = EXCLUDED.is_available,
                    in_stock = EXCLUDED.in_stock,
                    availability = EXCLUDED.availability,
                    updated_at = NOW()
                """,
                (
                    p.get("sku"), p.get("merchant_id"), p.get("title"),
                    p.get("description"), p.get("price"), p.get("currency"),
                    p.get("url"), p.get("image_url"), p.get("category"),
                    p.get("brand"), p.get("is_active", True),
                    p.get("is_available", True), p.get("in_stock", True),
                    p.get("availability", "in_stock"),
                    p.get("country_code", "US"),
                    source,
                )
            )
    conn.commit()
    return len(products), 0


def fetch_shopify_products(domain: str, max_pages: int = 8) -> tuple[list[dict], dict]:
    """Fetch products from Shopify products.json endpoint."""
    all_products = []
    meta = {"domain": domain, "http_code": None, "last_page": 0, "error": None}
    page = 1

    while page <= max_pages:
        url = f"https://{domain}/products.json?limit=250&page={page}"
        meta["last_page"] = page
        try:
            req = urllib.request.Request(
                url,
                headers={
                    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
                    "Accept": "application/json",
                }
            )
            with HTTP_OPENER.open(req, timeout=30) as resp:
                meta["http_code"] = getattr(resp, "status", None)
                data = json.loads(resp.read().decode())
                products = data.get("products", [])
                if not products:
                    break
                all_products.extend(products)
                if len(products) < 250:
                    break
                page += 1
                time.sleep(REQUEST_DELAY)
        except urllib.error.HTTPError as e:
            meta["http_code"] = e.code
            meta["error"] = f"HTTPError {e.code}: {e.reason}"
            break
        except Exception as e:
            meta["error"] = str(e)
            break

    return all_products, meta


def transform_product(p: dict, merchant_id: int, domain: str, country: str = "US", currency: str = "USD") -> dict | None:
    """Transform Shopify product to BuyWhere format."""
    variant = p.get("variants", [{}])[0] if p.get("variants") else {}
    images = p.get("images", [])
    handle = p.get("handle", "")
    try:
        price = float(variant.get("price", "0") or "0")
    except (ValueError, TypeError):
        price = 0.0
    in_stock = variant.get("available", True)
    desc_html = p.get("body_html") or ""
    desc_clean = re.sub(r"<[^>]+>", "", desc_html).strip()[:5000] if desc_html else None

    if price <= 0:
        return None

    return {
        "sku": handle,
        "merchant_id": merchant_id,
        "title": p.get("title", ""),
        "description": desc_clean,
        "price": price,
        "currency": currency,
        "url": f"https://{domain}/products/{handle}",
        "image_url": images[0].get("src") if images else None,
        "category": p.get("product_type") or None,
        "brand": p.get("vendor") or None,
        "is_active": True,
        "is_available": in_stock,
        "in_stock": in_stock,
        "availability": "in_stock" if in_stock else "out_of_stock",
        "country_code": country,
    }


def main():
    parser = argparse.ArgumentParser(description="GS CommonCrawl Shopify Harvest Lane")
    parser.add_argument("--limit", type=int, default=50, help="Max merchants to claim")
    parser.add_argument("--dry-run", action="store_true", help="Skip DB writes")
    args = parser.parse_args()

    # Resume from per-source cursors
    cursors = read_cursors()
    print(f"[BUY-61779] Starting harvest — limit={args.limit}, cursors={cursors}", flush=True)

    conn = connect()
    try:
        # Claim merchants
        merchants, cursors = claim_merchants(conn, args.limit, cursors)
        if not merchants:
            print("  No merchants to harvest.", flush=True)
            write_cursors(cursors)
            return

        print(f"  Claimed {len(merchants)} merchants", flush=True)

        total_products = 0
        total_merchants_success = 0
        total_merchants_failed = 0

        for m in merchants:
            domain = m["domain"]
            merchant_id = m["id"]
            source = m["source"]

            # Fetch products
            raw_products, fetch_meta = fetch_shopify_products(domain)
            if fetch_meta.get("http_code") == 403:
                # Try curl fallback
                import subprocess
                curl_result = subprocess.run(
                    ["curl", "-sS", "-L", "--max-time", "30",
                     "-A", "Mozilla/5.0", "-H", "Accept: application/json",
                     f"https://{domain}/products.json?limit=250"],
                    capture_output=True, check=False
                )
                if curl_result.returncode == 0:
                    try:
                        raw_products = json.loads(curl_result.stdout.decode()).get("products", [])
                    except json.JSONDecodeError:
                        raw_products = []

            if not raw_products:
                if not args.dry_run:
                    update_merchant_stats(conn, merchant_id, domain, 0, "no_products")
                print(f"  [{merchant_id}] {domain} ({source}): no products (http={fetch_meta.get('http_code')})", flush=True)
                total_merchants_failed += 1
                continue

            # Transform
            transformed = [
                transform_product(p, merchant_id, domain)
                for p in raw_products
            ]
            transformed = [t for t in transformed if t is not None]

            if transformed:
                if not args.dry_run:
                    inserted, updated = upsert_products(conn, transformed, domain)
                    update_merchant_stats(conn, merchant_id, domain, len(transformed), "ingested")
                else:
                    inserted, updated = len(transformed), 0
                total_products += inserted
                total_merchants_success += 1
                print(f"  [{merchant_id}] {domain} ({source}): +{len(transformed)} products", flush=True)
            else:
                if not args.dry_run:
                    update_merchant_stats(conn, merchant_id, domain, 0, "no_products")
                total_merchants_failed += 1

        # Save cursors
        if not args.dry_run:
            write_cursors(cursors)

        print(f"\n[BUY-61779] Done — +{total_products} products from {total_merchants_success}/{len(merchants)} merchants", flush=True)
    finally:
        conn.close()


if __name__ == "__main__":
    main()
