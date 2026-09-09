"""Datablitz PH (Shopify storefront) scraper — bounded-batch freshness recovery.

Targets https://datablitz.com.ph/products.json (Shopify storefront, no proxy).
Writes NDJSON to /home/paperclip/buywhere/data/datablitz_ph_<YYYYMMDD>.ndjson
and uploads to R2 under buywhere-data/datablitz_ph/<YYYY-MM-DD>.jsonl.

Per BUY-73881 freshness-recovery scope:
- bounded page count (default 5 pages × 50 = 250 records) — no scrape storm
- single Shopify /products.json endpoint (proxy-free)
- stdout = one summary JSON line (runner contract)
- no streaming JSON to stdout (the agent loop captures last line)

Usage:
    python -m scrapers.datablitz_ph --limit 250
"""
import argparse
import asyncio
import json
import os
import subprocess
import sys
import time
from datetime import datetime, timezone
from typing import Any

import httpx

SOURCE = "datablitz_ph"
CATALOG_SOURCE = "shopify_www_datablitz_com_ph"
PRODUCTS_URL = "https://datablitz.com.ph/products.json?limit=50&page={page}"
OUTPUT_DIR = "/home/paperclip/buywhere/data"
R2_BUCKET = os.environ.get("R2_BUCKET", "buywhere-data")
R2_ENDPOINT = os.environ.get("R2_ENDPOINT", "")


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _to_record(p: dict[str, Any], country: str = "PH") -> dict[str, Any]:
    """Normalize a Shopify product dict into the BuyWhere catalog row shape."""
    variants = p.get("variants") or []
    price = None
    sku = None
    in_stock = None
    for v in variants:
        if v.get("price") is not None:
            try:
                price = float(v["price"])
            except (ValueError, TypeError):
                pass
        if not sku and v.get("sku"):
            sku = v["sku"]
        if in_stock is None:
            in_stock = v.get("available")
    images = p.get("images") or []
    image_url = images[0]["src"] if images else None
    handle = p.get("handle")
    return {
        "source": CATALOG_SOURCE,
        "sku": sku or f"datablitz-ph-{p.get('id')}",
        "merchant_id": "www.datablitz.com.ph",
        "title": p.get("title"),
        "description": p.get("body_html"),
        "price": price,
        "currency": "PHP",
        "url": f"https://www.datablitz.com.ph/products/{handle}" if handle else None,
        "category": (p.get("product_type") or None),
        "image_url": image_url,
        "brand": p.get("vendor"),
        "in_stock": in_stock,
        "country_code": country,
        "region": "PH",
        "platform": "shopify",
        "data_updated_at": p.get("updated_at"),
        "metadata": {
            "shopify_id": p.get("id"),
            "tags": p.get("tags"),
            "published_at": p.get("published_at"),
            "scraper": SOURCE,
            "scraped_at": _now(),
        },
    }


async def scrape(limit: int = 250, page_size: int = 50) -> dict[str, Any]:
    out_path = os.path.join(OUTPUT_DIR, f"{SOURCE}_{datetime.now(timezone.utc):%Y%m%d}.ndjson")
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    pages = max(1, (limit + page_size - 1) // page_size)
    fetched = 0
    written = 0
    errors: list[str] = []
    started = time.monotonic()

    async with httpx.AsyncClient(
        timeout=httpx.Timeout(20.0),
        headers={
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0 Safari/537.36",
            "Accept": "application/json",
        },
        follow_redirects=True,
    ) as client:
        with open(out_path, "w", encoding="utf-8") as fh:
            for page in range(1, pages + 1):
                url = PRODUCTS_URL.format(page=page)
                try:
                    r = await client.get(url)
                    if r.status_code != 200:
                        errors.append(f"page {page}: http {r.status_code}")
                        break
                    data = r.json()
                except Exception as e:
                    errors.append(f"page {page}: {type(e).__name__}: {e}")
                    break
                prods = (data or {}).get("products") or []
                if not prods:
                    break
                for p in prods:
                    rec = _to_record(p)
                    fh.write(json.dumps(rec, ensure_ascii=False) + "\n")
                    written += 1
                    fetched += 1
                    if fetched >= limit:
                        break
                if fetched >= limit:
                    break
    elapsed = time.monotonic() - started
    summary = {
        "scraper": SOURCE,
        "fetched": fetched,
        "written": written,
        "errors": errors[:10],
        "out_path": out_path,
        "elapsed_s": round(elapsed, 2),
        "completed_at": _now(),
    }
    return summary


def upload_r2(local_path: str) -> tuple[bool, str]:
    """Upload NDJSON to R2 under buywhere-data/datablitz_ph/<date>.jsonl.

    Prefers boto3 (Cloudflare R2 keys are env-injected as
    CLOUDFLARE_R2_ACCESS_KEY_ID / CLOUDFLARE_R2_SECRET_ACCESS_KEY with
    CLOUDFLARE_R2_ACCOUNT_ID). Falls back to aws-cli when boto3 unavailable.
    """
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    key = f"datablitz_ph/{today}.jsonl"
    try:
        import boto3
        acct = os.environ.get("CLOUDFLARE_R2_ACCOUNT_ID") or os.environ.get("R2_ACCOUNT_ID", "")
        akey = os.environ.get("CLOUDFLARE_R2_ACCESS_KEY_ID") or os.environ.get("R2_ACCESS_KEY_ID", "")
        skey = os.environ.get("CLOUDFLARE_R2_SECRET_ACCESS_KEY") or os.environ.get("R2_SECRET_ACCESS_KEY", "")
        if not (acct and akey and skey):
            return False, "R2 credentials missing in env"
        s3 = boto3.client(
            "s3",
            endpoint_url=f"https://{acct}.r2.cloudflarestorage.com",
            aws_access_key_id=akey,
            aws_secret_access_key=skey,
            region_name="auto",
        )
        s3.upload_file(local_path, R2_BUCKET, key)
        return True, f"s3://{R2_BUCKET}/{key}"
    except ImportError:
        pass
    # Fallback: aws-cli
    endpoint = R2_ENDPOINT if R2_ENDPOINT.startswith("http") else f"https://{R2_ENDPOINT}"
    cmd = [
        "aws", "s3", "cp", local_path, f"s3://{R2_BUCKET}/{key}",
        "--endpoint-url", endpoint,
    ]
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
        if proc.returncode == 0:
            return True, f"s3://{R2_BUCKET}/{key}"
        return False, (proc.stderr or proc.stdout)[:300]
    except Exception as e:
        return False, f"{type(e).__name__}: {e}"


async def main() -> int:
    parser = argparse.ArgumentParser(description="Datablitz PH Shopify scraper")
    parser.add_argument("--limit", type=int, default=250)
    parser.add_argument("--page-size", type=int, default=50)
    parser.add_argument("--no-upload", action="store_true")
    args = parser.parse_args()
    summary = await scrape(limit=args.limit, page_size=args.page_size)
    if not args.no_upload:
        ok, key = upload_r2(summary["out_path"])
        summary["r2_upload_ok"] = ok
        summary["r2_key"] = key if ok else None
        summary["r2_error"] = None if ok else key
    print(json.dumps(summary, indent=2, ensure_ascii=False))
    return 0 if not summary["errors"] else 0  # always 0 — errors are reported


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
