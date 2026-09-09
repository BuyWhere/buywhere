"""JIB Thailand (jib.co.th) product scraper — bounded-batch freshness recovery.

Targets product list pages and individual product pages (JSON-LD Product schema).
Writes NDJSON to /home/paperclip/buywhere/data/jib_th_<YYYYMMDD>.ndjson
and uploads to R2 under buywhere-data/jib_th/<YYYY-MM-DD>.jsonl.

Per BUY-73881 freshness-recovery scope:
- bounded page count (default 20 category pages × 6 items = 120 records)
- direct fetch of /web/product/product_list/{lvl}/{catid} (HTML; proxy-free)
- product detail via /web/product/readProduct/{id} HTML (JSON-LD Product)
- stdout = one summary JSON line (runner contract)

Usage:
    python -m scrapers.jib_th --limit 120
"""
import argparse
import asyncio
import json
import os
import re
import subprocess
import sys
import time
from datetime import datetime, timezone
from typing import Any
from urllib.parse import urljoin

import httpx

SOURCE = "jib_th"
LIST_URL = "https://www.jib.co.th/web/product/product_list/{lvl}/{catid}"
PRODUCT_URL = "https://www.jib.co.th/web/product/readProduct/{product_id}"
OUTPUT_DIR = "/home/paperclip/buywhere/data"
R2_BUCKET = os.environ.get("R2_BUCKET", "buywhere-data")
R2_ENDPOINT = os.environ.get("R2_ENDPOINT", "")

# Categories sampled from observed category navigation (id stable across re-scans)
# lvl=3 = sub-category listings, with 6 readProduct items per page
DEFAULT_CATEGORIES: list[tuple[int, int]] = [
    (3, 1419),  # computer parts
    (3, 1418),  # smart home / scales
    (3, 2449),
    (3, 3208),
    (3, 2451),
    (3, 1643),
    (3, 2536),
    (3, 2537),
    (3, 1657),
    (3, 2719),
    (3, 2949),
    (3, 3129),
    (3, 3130),
    (3, 3131),
    (3, 3132),
    (3, 3203),
    (3, 1659),
    (3, 2717),
    (3, 1614),
    (3, 1616),
]

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "th-TH,th;q=0.9,en-US;q=0.8,en;q=0.7",
}


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _to_record(ld: dict[str, Any], product_id: int) -> dict[str, Any]:
    """Normalize a JSON-LD Product dict into BuyWhere catalog row shape."""
    name = ld.get("name") or ""
    description = ld.get("description") or ""
    sku = ld.get("sku") or ld.get("mpn") or f"jib-th-{product_id}"
    images = ld.get("image") or []
    image_url = images[0] if isinstance(images, list) and images else (images if isinstance(images, str) else None)
    brand = None
    b = ld.get("brand")
    if isinstance(b, dict):
        brand = b.get("name")
    elif isinstance(b, str):
        brand = b
    offers = ld.get("offers") or {}
    price = None
    currency = "THB"
    in_stock = None
    if isinstance(offers, list) and offers:
        offers = offers[0]
    if isinstance(offers, dict):
        try:
            price = float(offers.get("price"))
        except (ValueError, TypeError):
            pass
        currency = offers.get("priceCurrency") or "THB"
        in_stock = offers.get("availability", "").endswith("InStock")
    return {
        "source": SOURCE,
        "sku": str(sku),
        "merchant_id": "jib_th",
        "title": name,
        "description": description,
        "price": price,
        "currency": currency,
        "url": PRODUCT_URL.format(product_id=product_id),
        "category": None,
        "image_url": image_url,
        "brand": brand,
        "in_stock": in_stock,
        "country_code": "TH",
        "region": "TH",
        "platform": "merchant_direct",
        "data_updated_at": _now(),
        "metadata": {
            "jib_product_id": product_id,
            "scraper": SOURCE,
            "scraped_at": _now(),
            "raw_jsonld": ld,
        },
    }


def _extract_jsonld(html: str) -> dict[str, Any] | None:
    """Extract first JSON-LD Product block from HTML."""
    for block in re.findall(r'<script[^>]*application/ld\+json[^>]*>(.*?)</script>', html, re.DOTALL):
        # Strip raw control characters that JSON spec disallows but HTML allows
        cleaned = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f]", "", block)
        try:
            data = json.loads(cleaned.strip())
        except json.JSONDecodeError:
            try:
                # Fallback: lenient parse
                data = json.loads(cleaned.strip(), strict=False)
            except json.JSONDecodeError:
                continue
        # JSON-LD can be a single object or a @graph list
        if isinstance(data, dict):
            if data.get("@type") in ("Product", ["Product"]):
                return data
            if "@graph" in data:
                for node in data["@graph"]:
                    if isinstance(node, dict) and node.get("@type") == "Product":
                        return node
        elif isinstance(data, list):
            for node in data:
                if isinstance(node, dict) and node.get("@type") == "Product":
                    return node
    return None


def _extract_product_ids(html: str) -> list[int]:
    return [int(m) for m in re.findall(r'/web/product/readProduct/(\d+)', html)]


def _extract_product_urls(html: str) -> list[tuple[int, str]]:
    """Extract (product_id, full_url) pairs preserving slug path component."""
    seen: set[int] = set()
    out: list[tuple[int, str]] = []
    for m in re.finditer(r'(?:href|src)="?((?:https?://www\.jib\.co\.th)?/web/product/readProduct/(\d+)(?:/[^"\'<>\s]*)?)', html):
        full = m.group(1)
        pid = int(m.group(2))
        if pid not in seen:
            seen.add(pid)
            if not full.startswith("http"):
                full = urljoin("https://www.jib.co.th", full)
            out.append((pid, full))
    return out


async def scrape(limit: int = 120, max_pages: int = 20) -> dict[str, Any]:
    out_path = os.path.join(OUTPUT_DIR, f"{SOURCE}_{datetime.now(timezone.utc):%Y%m%d}.ndjson")
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    fetched = 0
    written = 0
    errors: list[str] = []
    started = time.monotonic()

    async with httpx.AsyncClient(
        timeout=httpx.Timeout(20.0),
        headers=HEADERS,
        follow_redirects=True,
    ) as client:
        with open(out_path, "w", encoding="utf-8") as fh:
            for cat_idx, (lvl, catid) in enumerate(DEFAULT_CATEGORIES[:max_pages], start=1):
                if fetched >= limit:
                    break
                list_url = LIST_URL.format(lvl=lvl, catid=catid)
                try:
                    r = await client.get(list_url)
                    if r.status_code != 200:
                        errors.append(f"list cat={catid}: http {r.status_code}")
                        continue
                    list_html = r.text
                except Exception as e:
                    errors.append(f"list cat={catid}: {type(e).__name__}: {e}")
                    continue
                product_ids = _extract_product_ids(list_html)
                product_urls = _extract_product_urls(list_html)
                # Dedup while preserving order
                seen: set[int] = set()
                uniq_items: list[tuple[int, str]] = []
                for pid, url in product_urls:
                    if pid not in seen:
                        seen.add(pid)
                        uniq_items.append((pid, url))
                for pid, pd_url in uniq_items:
                    if fetched >= limit:
                        break
                    try:
                        rp = await client.get(pd_url)
                        if rp.status_code != 200:
                            errors.append(f"pd {pid}: http {rp.status_code}")
                            continue
                        pd_html = rp.text
                    except Exception as e:
                        errors.append(f"pd {pid}: {type(e).__name__}: {e}")
                        continue
                    ld = _extract_jsonld(pd_html)
                    if not ld:
                        errors.append(f"pd {pid}: no JSON-LD Product")
                        continue
                    rec = _to_record(ld, product_id=pid)
                    fh.write(json.dumps(rec, ensure_ascii=False) + "\n")
                    written += 1
                    fetched += 1
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
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    key = f"{SOURCE}/{today}.jsonl"
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
    endpoint = R2_ENDPOINT if R2_ENDPOINT.startswith("http") else f"https://{R2_ENDPOINT}"
    cmd = ["aws", "s3", "cp", local_path, f"s3://{R2_BUCKET}/{key}", "--endpoint-url", endpoint]
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
        if proc.returncode == 0:
            return True, f"s3://{R2_BUCKET}/{key}"
        return False, (proc.stderr or proc.stdout)[:300]
    except Exception as e:
        return False, f"{type(e).__name__}: {e}"


async def main() -> int:
    parser = argparse.ArgumentParser(description="JIB Thailand product scraper")
    parser.add_argument("--limit", type=int, default=120)
    parser.add_argument("--max-pages", type=int, default=20)
    parser.add_argument("--no-upload", action="store_true")
    args = parser.parse_args()
    summary = await scrape(limit=args.limit, max_pages=args.max_pages)
    if not args.no_upload:
        ok, key = upload_r2(summary["out_path"])
        summary["r2_upload_ok"] = ok
        summary["r2_key"] = key if ok else None
        summary["r2_error"] = None if ok else key
    print(json.dumps(summary, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))