"""Senheng Malaysia (senheng.com.my) product scraper — bounded-batch freshness recovery.

Targets the WooCommerce product sitemap and individual product pages (JSON-LD Product).
Writes NDJSON to /home/paperclip/buywhere/data/senheng_my_<YYYYMMDD>.ndjson
and uploads to R2 under buywhere-data/senheng_my/<YYYY-MM-DD>.jsonl.

Per BUY-73881 freshness-recovery scope:
- fetches /product-sitemap.xml (≈914 product URLs)
- visits each product page and extracts JSON-LD Product
- bounded by --limit (default 100)
- stdout = one summary JSON line (runner contract)

Usage:
    python -m scrapers.senheng_my --limit 100
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

SOURCE = "senheng_my"
PRODUCT_SITEMAP = "https://www.senheng.com.my/product-sitemap.xml"
OUTPUT_DIR = "/home/paperclip/buywhere/data"
R2_BUCKET = os.environ.get("R2_BUCKET", "buywhere-data")
R2_ENDPOINT = os.environ.get("R2_ENDPOINT", "")

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-MY,en;q=0.9",
}


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _extract_jsonld(html: str) -> dict[str, Any] | None:
    """Extract first JSON-LD Product block (top-level or inside @graph)."""
    for block in re.findall(r'<script[^>]*application/ld\+json[^>]*>(.*?)</script>', html, re.DOTALL):
        cleaned = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f]", "", block)
        for parser in (lambda x: json.loads(x.strip()), lambda x: json.loads(x.strip(), strict=False)):
            try:
                data = parser(cleaned)
            except json.JSONDecodeError:
                continue
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
            break  # parsed successfully even if no Product found
    return None


def _to_record(ld: dict[str, Any], url: str) -> dict[str, Any] | None:
    name = ld.get("name")
    sku = ld.get("sku") or ld.get("mpn") or ld.get("@id", "").rsplit("/", 2)[-2] if ld.get("@id") else None
    if not name:
        return None
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
    currency = "MYR"
    in_stock = None
    if isinstance(offers, list) and offers:
        offers = offers[0]
    if isinstance(offers, dict):
        # Senheng uses priceSpecification[].price
        ps = offers.get("priceSpecification")
        if isinstance(ps, list) and ps:
            price_entry = ps[0]
            try:
                price = float(price_entry.get("price"))
            except (ValueError, TypeError):
                pass
            currency = price_entry.get("priceCurrency") or "MYR"
        else:
            try:
                price = float(offers.get("price"))
            except (ValueError, TypeError):
                pass
            currency = offers.get("priceCurrency") or "MYR"
        in_stock = offers.get("availability", "").endswith("InStock")
    return {
        "source": SOURCE,
        "sku": str(sku) if sku else f"senheng-my-{url.rsplit('/', 2)[-2]}",
        "merchant_id": "senheng_my",
        "title": name,
        "description": ld.get("description") or "",
        "price": price,
        "currency": currency,
        "url": url,
        "category": None,
        "image_url": image_url,
        "brand": brand,
        "in_stock": in_stock,
        "country_code": "MY",
        "region": "MY",
        "platform": "woocommerce",
        "data_updated_at": _now(),
        "metadata": {
            "scraper": SOURCE,
            "scraped_at": _now(),
        },
    }


def _sitemap_product_urls(xml: str) -> list[str]:
    urls: list[str] = []
    for m in re.finditer(r"<loc>(https?://[^<]+)</loc>", xml):
        loc = m.group(1)
        if "/product/" in loc and not loc.endswith("/shop/"):
            urls.append(loc)
    return urls


async def _fetch_product(client: httpx.AsyncClient, url: str, sem: asyncio.Semaphore) -> tuple[str, dict[str, Any] | None, str | None]:
    async with sem:
        try:
            r = await client.get(url, timeout=20.0)
            if r.status_code != 200:
                return url, None, f"http {r.status_code}"
            pd_html = r.text
        except Exception as e:
            return url, None, f"{type(e).__name__}: {e}"
        ld = _extract_jsonld(pd_html)
        if not ld:
            return url, None, "no JSON-LD Product"
        rec = _to_record(ld, url=url)
        if rec is None:
            return url, None, "record validation failed"
        return url, rec, None


async def scrape(limit: int = 100, concurrency: int = 8) -> dict[str, Any]:
    out_path = os.path.join(OUTPUT_DIR, f"{SOURCE}_{datetime.now(timezone.utc):%Y%m%d}.ndjson")
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    errors: list[str] = []
    started = time.monotonic()

    async with httpx.AsyncClient(
        timeout=httpx.Timeout(60.0),
        headers=HEADERS,
        follow_redirects=True,
    ) as client:
        try:
            rs = await client.get(PRODUCT_SITEMAP, timeout=30.0)
            if rs.status_code != 200:
                errors.append(f"sitemap: http {rs.status_code}")
                return _empty_summary(out_path, errors, started)
            product_urls = _sitemap_product_urls(rs.text)
        except Exception as e:
            errors.append(f"sitemap: {type(e).__name__}: {e}")
            return _empty_summary(out_path, errors, started)

        sem = asyncio.Semaphore(concurrency)
        target_urls = product_urls[:limit]
        tasks = [_fetch_product(client, url, sem) for url in target_urls]
        results = await asyncio.gather(*tasks, return_exceptions=False)

        written = 0
        with open(out_path, "w", encoding="utf-8") as fh:
            for url, rec, err in results:
                if err:
                    errors.append(f"page {url}: {err}")
                elif rec:
                    fh.write(json.dumps(rec, ensure_ascii=False) + "\n")
                    written += 1

    elapsed = time.monotonic() - started
    summary = {
        "scraper": SOURCE,
        "fetched": written,
        "written": written,
        "errors": errors[:10],
        "out_path": out_path,
        "elapsed_s": round(elapsed, 2),
        "completed_at": _now(),
    }
    return summary


def _empty_summary(out_path: str, errors: list[str], started: float) -> dict[str, Any]:
    elapsed = time.monotonic() - started
    return {
        "scraper": SOURCE,
        "fetched": 0,
        "written": 0,
        "errors": errors[:10],
        "out_path": out_path,
        "elapsed_s": round(elapsed, 2),
        "completed_at": _now(),
    }


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
    parser = argparse.ArgumentParser(description="Senheng Malaysia product scraper")
    parser.add_argument("--limit", type=int, default=100)
    parser.add_argument("--concurrency", type=int, default=8)
    parser.add_argument("--no-upload", action="store_true")
    args = parser.parse_args()
    summary = await scrape(limit=args.limit, concurrency=args.concurrency)
    if not args.no_upload:
        ok, key = upload_r2(summary["out_path"])
        summary["r2_upload_ok"] = ok
        summary["r2_key"] = key if ok else None
        summary["r2_error"] = None if ok else key
    print(json.dumps(summary, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))