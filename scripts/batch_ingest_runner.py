#!/usr/bin/env python3
"""Batch ingest zero-product merchants directly into the catalog DB.

Claims a bounded set of merchants with products_count=0 by moving their
onboarding_stage, fetches public Shopify products.json storefront feeds, and
upserts products on (sku, source) while reporting inserts vs updates via xmax.
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
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any

import psycopg2
import psycopg2.extras

CATALOG_DSN_PATH = Path("data/.catalog_db_url")
DEFAULT_LIMIT = 25
DEFAULT_BATCH_SIZE = 500
DEFAULT_NDJSON_PATH = Path(f"data/buy75862_batch_{datetime.now(timezone.utc).strftime('%Y%m%d')}.ndjson")
CLAIM_STAGE = "batch_ingest_claimed"
DONE_STAGE = "ingested"
FAILED_STAGE = "scrape_failed"
ZERO_PRODUCTS_STAGE = "no_products"
USER_AGENT = "BuyWhereBatchIngest/1.0 (+https://buywhere.ai)"
SUCCESS_HTTP_CODES = {200}


def normalize_domain(domain: str) -> str:
    domain = (domain or "").strip().lower()
    domain = re.sub(r"^https?://", "", domain)
    return domain.split("/", 1)[0].strip()


def safe_source_for_domain(domain: str) -> str:
    cleaned = re.sub(r"[^a-z0-9]+", "_", domain.lower()).strip("_")
    return f"shopify_{cleaned}"[:120]


def load_catalog_dsn(path: Path) -> str:
    dsn = path.read_text().strip()
    if not dsn:
        raise RuntimeError(f"empty catalog DSN at {path}")
    if "roundhouse" in dsn.lower():
        raise RuntimeError("refusing control-plane roundhouse DSN")
    return dsn


def connect_catalog(dsn_path: Path):
    return psycopg2.connect(load_catalog_dsn(dsn_path), application_name="buy-75862-batch-ingest")


def claim_merchants(conn, limit: int) -> list[dict[str, Any]]:
    """Claim zero-product merchants without COUNT(*) or url ILIKE scans."""
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            """
            WITH candidates AS (
              SELECT id
              FROM merchants
              WHERE COALESCE(products_count, 0) = 0
                AND NULLIF(domain, '') IS NOT NULL
                AND source IN ('known_shopify_domains', 'cc-custom')
                AND COALESCE(onboarding_stage, '') NOT IN (%s, %s, %s, %s)
              ORDER BY
                CASE source WHEN 'known_shopify_domains' THEN 0 ELSE 1 END,
                updated_at NULLS FIRST,
                created_at NULLS FIRST,
                id
              LIMIT %s
              FOR UPDATE SKIP LOCKED
            )
            UPDATE merchants m
            SET onboarding_stage = %s,
                updated_at = NOW(),
                scrape_error = NULL
            FROM candidates
            WHERE m.id = candidates.id
            RETURNING m.id, m.name, m.domain, m.source, m.country, m.products_count, m.onboarding_stage
            """,
            (CLAIM_STAGE, DONE_STAGE, FAILED_STAGE, ZERO_PRODUCTS_STAGE, limit, CLAIM_STAGE),
        )
        merchants = [dict(row) for row in cur.fetchall()]
    conn.commit()
    return merchants


def fetch_json(url: str) -> tuple[Any | None, int | None, str | None]:
    req = urllib.request.Request(
        url,
        headers={
            "Accept": "application/json",
            "User-Agent": USER_AGENT,
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode("utf-8", "replace")), getattr(resp, "status", None), None
    except urllib.error.HTTPError as exc:
        return None, exc.code, f"HTTPError: {exc.code}"
    except Exception as exc:
        return None, None, f"{exc.__class__.__name__}: {exc}"


def fetch_shopify_products(domain: str, max_pages: int, delay: float) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    all_products: list[dict[str, Any]] = []
    last_http_code = None
    last_error = None
    for page in range(1, max_pages + 1):
        payload, last_http_code, last_error = fetch_json(f"https://{domain}/products.json?limit=250&page={page}")
        if payload is None:
            break

        products = payload.get("products") or []
        if not isinstance(products, list) or not products:
            break
        all_products.extend(products)
        if len(products) < 250:
            break
        if delay > 0:
            time.sleep(delay)

    return all_products, {
        "platform": "shopify_products_json",
        "http_code": last_http_code,
        "error": last_error,
        "pages_requested": page if max_pages else 0,
    }


def fetch_woocommerce_products(domain: str, max_pages: int, delay: float) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    all_products: list[dict[str, Any]] = []
    last_http_code = None
    last_error = None
    for page in range(1, max_pages + 1):
        url = f"https://{domain}/wp-json/wc/store/products?per_page=100&page={page}"
        payload, last_http_code, last_error = fetch_json(url)
        if payload is None:
            break
        products = payload if isinstance(payload, list) else payload.get("products", []) if isinstance(payload, dict) else []
        if not products:
            break
        all_products.extend(products)
        if len(products) < 100:
            break
        if delay > 0:
            time.sleep(delay)
    return all_products, {
        "platform": "woocommerce_store_api",
        "http_code": last_http_code,
        "error": last_error,
        "pages_requested": page if max_pages else 0,
    }


def fetch_store_products(domain: str, max_pages: int, delay: float) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    products, meta = fetch_shopify_products(domain, max_pages, delay)
    if products:
        return products, meta
    woo_products, woo_meta = fetch_woocommerce_products(domain, max_pages, delay)
    if woo_products:
        return woo_products, woo_meta
    meta["fallback"] = woo_meta
    return products, meta


def money(value: Any) -> Decimal | None:
    try:
        amount = Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError):
        return None
    return amount if amount > 0 else None


def strip_html(value: str | None) -> str | None:
    if not value:
        return None
    return re.sub(r"<[^>]+>", " ", value).strip()[:5000] or None


def transform_product(product: dict[str, Any], merchant: dict[str, Any]) -> dict[str, Any] | None:
    domain = normalize_domain(merchant.get("domain") or merchant.get("id") or "")
    variants = product.get("variants") or []
    variant = variants[0] if variants else {}
    handle = product.get("handle") or str(product.get("id") or "")
    price = money(variant.get("price"))
    if not domain or not handle or price is None:
        return None

    country = (merchant.get("country") or "SG").upper()
    currency = "SGD" if country == "SG" else "USD"
    images = product.get("images") or []
    tags = product.get("tags") or []
    if isinstance(tags, str):
        tags = [tag.strip() for tag in tags.split(",") if tag.strip()]

    source = safe_source_for_domain(domain)
    sku = f"{domain}:{handle}"[:255]
    in_stock = bool(variant.get("available", True))
    image_url = None
    if images and isinstance(images[0], dict):
        image_url = images[0].get("src")

    return {
        "sku": sku,
        "source": source,
        "merchant_id": domain,
        "title": product.get("title") or handle,
        "description": strip_html(product.get("body_html")),
        "price": price,
        "currency": currency,
        "url": f"https://{domain}/products/{handle}",
        "category": product.get("product_type") or None,
        "category_path": [],
        "image_url": image_url,
        "brand": product.get("vendor") or None,
        "is_active": True,
        "in_stock": in_stock,
        "is_available": in_stock,
        "metadata": {
            "canonical_id": product.get("id"),
            "shopify_product_id": product.get("id"),
            "shopify_variant_id": variant.get("id"),
            "merchant_source": merchant.get("source"),
            "tags": tags,
        },
        "region": "sea" if country in {"SG", "MY", "TH", "ID", "PH", "VN"} else "us",
        "country_code": country,
        "canonical_id": product.get("id") if isinstance(product.get("id"), int) else None,
        "scraped_via": "buy_75862_batch_ingest",
    }


def transform_woocommerce_product(product: dict[str, Any], merchant: dict[str, Any]) -> dict[str, Any] | None:
    domain = normalize_domain(merchant.get("domain") or merchant.get("id") or "")
    product_id = product.get("id")
    slug = product.get("slug") or str(product_id or "")
    prices = product.get("prices") or {}
    raw_price = prices.get("price") or product.get("price")
    decimal_places = int(prices.get("currency_minor_unit") or 2)
    price = money(Decimal(str(raw_price)) / (Decimal(10) ** decimal_places)) if raw_price is not None else None
    if not domain or not slug or price is None:
        return None
    country = (merchant.get("country") or "SG").upper()
    images = product.get("images") or []
    categories = product.get("categories") or []
    category_names = [c.get("name") for c in categories if isinstance(c, dict) and c.get("name")]
    source = safe_source_for_domain(domain)
    in_stock = (product.get("is_in_stock") is not False) and product.get("stock_status") != "outofstock"
    return {
        "sku": f"{domain}:{slug}"[:255],
        "source": source,
        "merchant_id": domain,
        "title": product.get("name") or slug,
        "description": strip_html(product.get("short_description") or product.get("description")),
        "price": price,
        "currency": prices.get("currency_code") or ("SGD" if country == "SG" else "USD"),
        "url": product.get("permalink") or f"https://{domain}/product/{slug}",
        "category": category_names[0] if category_names else None,
        "category_path": category_names,
        "image_url": images[0].get("src") if images and isinstance(images[0], dict) else None,
        "brand": None,
        "is_active": True,
        "in_stock": in_stock,
        "is_available": in_stock,
        "metadata": {
            "canonical_id": product_id,
            "woocommerce_product_id": product_id,
            "merchant_source": merchant.get("source"),
        },
        "region": "sea" if country in {"SG", "MY", "TH", "ID", "PH", "VN"} else "us",
        "country_code": country,
        "canonical_id": product_id if isinstance(product_id, int) else None,
        "scraped_via": "buy_75862_batch_ingest",
    }


def transform_store_product(product: dict[str, Any], merchant: dict[str, Any], platform: str) -> dict[str, Any] | None:
    if platform == "woocommerce_store_api":
        return transform_woocommerce_product(product, merchant)
    return transform_product(product, merchant)


def upsert_products(conn, products: list[dict[str, Any]], batch_size: int) -> tuple[int, int]:
    inserted = 0
    updated = 0
    sql = """
        INSERT INTO products (
          sku, source, merchant_id, title, description, price, currency, url,
          category, category_path, image_url, brand, is_active, in_stock,
          is_available, metadata, region, country_code, canonical_id, scraped_via,
          updated_at, data_updated_at, last_checked
        ) VALUES %s
        ON CONFLICT (sku, source) DO UPDATE SET
          merchant_id = EXCLUDED.merchant_id,
          title = EXCLUDED.title,
          description = EXCLUDED.description,
          price = EXCLUDED.price,
          currency = EXCLUDED.currency,
          url = EXCLUDED.url,
          category = EXCLUDED.category,
          category_path = EXCLUDED.category_path,
          image_url = EXCLUDED.image_url,
          brand = EXCLUDED.brand,
          is_active = EXCLUDED.is_active,
          in_stock = EXCLUDED.in_stock,
          is_available = EXCLUDED.is_available,
          metadata = EXCLUDED.metadata,
          region = EXCLUDED.region,
          country_code = EXCLUDED.country_code,
          canonical_id = EXCLUDED.canonical_id,
          scraped_via = EXCLUDED.scraped_via,
          updated_at = NOW(),
          data_updated_at = NOW(),
          last_checked = NOW()
        RETURNING (xmax = 0) AS inserted
    """
    template = "(%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb, %s, %s, %s, %s, NOW(), NOW(), NOW())"
    for start in range(0, len(products), batch_size):
        chunk = products[start:start + batch_size]
        rows = [
            (
                p["sku"], p["source"], p["merchant_id"], p["title"], p["description"], p["price"], p["currency"], p["url"],
                p["category"], p["category_path"], p["image_url"], p["brand"], p["is_active"], p["in_stock"],
                p["is_available"], json.dumps(p["metadata"]), p["region"], p["country_code"], p["canonical_id"], p["scraped_via"],
            )
            for p in chunk
        ]
        with conn.cursor() as cur:
            psycopg2.extras.execute_values(cur, sql, rows, template=template)
            flags = [row[0] for row in cur.fetchall()]
        inserted += sum(1 for flag in flags if flag)
        updated += sum(1 for flag in flags if not flag)
    conn.commit()
    return inserted, updated


def update_merchant(conn, merchant_id: str, stage: str, products_count: int, error: str | None = None) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            UPDATE merchants
            SET onboarding_stage = %s,
                products_count = %s,
                last_scraped_at = NOW(),
                updated_at = NOW(),
                scrape_error = %s
            WHERE id = %s
            """,
            (stage, products_count, error, merchant_id),
        )
    conn.commit()


def run(args: argparse.Namespace) -> dict[str, Any]:
    conn = connect_catalog(args.catalog_dsn)
    report: dict[str, Any] = {
        "issue": "BUY-75862",
        "started_at": datetime.now(timezone.utc).isoformat(),
        "limit": args.limit,
        "claimed": 0,
        "merchants_processed": 0,
        "merchants_success": 0,
        "merchants_failed": 0,
        "merchants_zero_products": 0,
        "products_fetched": 0,
        "products_transformed": 0,
        "products_inserted": 0,
        "products_updated": 0,
        "merchants": [],
    }
    args.ndjson_path.parent.mkdir(parents=True, exist_ok=True)
    try:
        merchants = claim_merchants(conn, args.limit)
        report["claimed"] = len(merchants)
        with args.ndjson_path.open("a", encoding="utf-8") as ndjson_file:
            for index, merchant in enumerate(merchants, start=1):
                domain = normalize_domain(merchant.get("domain") or merchant.get("id") or "")
                merchant_row = {"id": merchant.get("id"), "domain": domain, "source": merchant.get("source")}
                print(f"[{index}/{len(merchants)}] {domain}", flush=True)
                try:
                    raw_products, fetch_meta = fetch_store_products(domain, args.max_pages, args.delay)
                    transformed = [p for p in (transform_store_product(raw, merchant, fetch_meta.get("platform", "")) for raw in raw_products) if p]
                    for product in transformed:
                        ndjson_file.write(json.dumps(product, default=str) + "\n")
                    ndjson_file.flush()
                    report["products_fetched"] += len(raw_products)
                    report["products_transformed"] += len(transformed)
                    if not transformed:
                        stage = ZERO_PRODUCTS_STAGE if fetch_meta.get("http_code") in SUCCESS_HTTP_CODES else FAILED_STAGE
                        error = fetch_meta.get("error")
                        update_merchant(conn, merchant["id"], stage, 0, error)
                        report["merchants_zero_products" if stage == ZERO_PRODUCTS_STAGE else "merchants_failed"] += 1
                        merchant_row.update({"status": stage, "fetched": len(raw_products), "transformed": 0, "inserted": 0, "updated": 0, "fetch_meta": fetch_meta})
                    else:
                        inserted, updated = upsert_products(conn, transformed, args.batch_size)
                        report["products_inserted"] += inserted
                        report["products_updated"] += updated
                        update_merchant(conn, merchant["id"], DONE_STAGE, inserted + updated, None)
                        report["merchants_success"] += 1
                        merchant_row.update({"status": DONE_STAGE, "fetched": len(raw_products), "transformed": len(transformed), "inserted": inserted, "updated": updated, "fetch_meta": fetch_meta})
                except Exception as exc:
                    conn.rollback()
                    error = f"{exc.__class__.__name__}: {exc}"[:500]
                    update_merchant(conn, merchant["id"], FAILED_STAGE, 0, error)
                    report["merchants_failed"] += 1
                    merchant_row.update({"status": FAILED_STAGE, "error": error})
                finally:
                    report["merchants_processed"] += 1
                    report["merchants"].append(merchant_row)
                    if args.delay > 0:
                        time.sleep(args.delay)
    finally:
        conn.close()
    report["ndjson_path"] = str(args.ndjson_path)
    report["completed_at"] = datetime.now(timezone.utc).isoformat()
    return report


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Batch ingest claimed zero-product Shopify merchants")
    parser.add_argument("--limit", type=int, default=DEFAULT_LIMIT, help="Number of merchants to claim; default 25")
    parser.add_argument("--batch-size", type=int, default=DEFAULT_BATCH_SIZE, help="DB upsert batch size")
    parser.add_argument("--max-pages", type=int, default=2, help="Max products.json pages per merchant")
    parser.add_argument("--delay", type=float, default=0.5, help="Delay between storefront requests")
    parser.add_argument("--catalog-dsn", type=Path, default=CATALOG_DSN_PATH, help="Path to catalog DB DSN")
    parser.add_argument("--report-path", type=Path, default=Path("data/buy75862_batch_ingest_report.json"), help="JSON report path")
    parser.add_argument("--ndjson-path", type=Path, default=DEFAULT_NDJSON_PATH, help="NDJSON archive output path")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv or sys.argv[1:])
    if args.limit < 25:
        raise SystemExit("--limit must be >=25 for BUY-75862 throughput runs")
    report = run(args)
    args.report_path.parent.mkdir(parents=True, exist_ok=True)
    args.report_path.write_text(json.dumps(report, indent=2, default=str))
    print(
        "BUY-75862 batch ingest: "
        f"claimed={report['claimed']} processed={report['merchants_processed']} "
        f"success={report['merchants_success']} zero={report['merchants_zero_products']} failed={report['merchants_failed']} "
        f"inserted={report['products_inserted']} updated={report['products_updated']} "
        f"report={args.report_path}",
        flush=True,
    )
    return 0 if report["claimed"] >= 25 else 2


if __name__ == "__main__":
    sys.exit(main())
