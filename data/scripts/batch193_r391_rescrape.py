#!/usr/bin/env python3
"""BUY-76428 — batch193 wave302 r391 rescrape + R2 upload (all 17 domains).
Re-scrapes 10 succeeded + 7 failed domains from the prior run.
Uploads merged NDJSON to R2 and writes per-domain results to disk.
"""
import argparse
import json
import os
import re
import sys
import time
import ssl
import urllib.request
import urllib.error
import datetime
from decimal import Decimal

# --- Config ---
TODAY = datetime.date.today().isoformat()
BATCH_TAG = "batch193_r391"
MERCHANTS = [
    # (domain, niche)
    ("pickleseh.com",               "preserved_foods"),
    ("preservedgoods.com",          "preserved_foods"),
    ("karmacollars.com",            "dog_collars"),
    ("mypapergardenco.com",         "stationery"),
    ("lilyandroeco.com",            "apothecary"),
    ("hookandarrow.co",             "home_goods"),
    ("sauceworksco.com",            "hot_sauce"),
    ("puckerbuttpeppercompany.com", "hot_sauce"),
    ("thelittleherbalapothecary.com","apothecary"),
    ("arukahapothecary.com",        "apothecary"),
    ("troveontremont.com",          "home_goods"),
    ("wildwoodsoapco.com",          "soap"),
    ("threadandhoney.co",           "soap"),
    ("beccascoffee.com",            "coffee"),
    ("woodandfield.co",            "home_goods"),
    ("thefinishingtouch.co",        "jewelry_supplies"),
    ("westcoastsupply.com",         "supplies"),
]
SCRATCH_DIR = "/home/paperclip/buywhere/data"
OUT_DIR = "/home/paperclip/buywhere/data"
REQUEST_DELAY = 2.0
MAX_PAGES = 20

# --- R2 Config ---
SECRETS = json.load(open("/home/paperclip/.secrets/fleet-secrets.json"))
R2_ACCOUNT_ID = SECRETS["CLOUDFLARE_ACCOUNT_ID"]
R2_ACCESS_KEY = SECRETS["CLOUDFLARE_R2_ACCESS_KEY_ID"]
R2_SECRET_KEY = SECRETS["CLOUDFLARE_R2_SECRET_ACCESS_KEY"]
R2_BUCKET = "buywhere-data"


def fetch_products(domain: str, max_pages: int = MAX_PAGES) -> tuple[list[dict], str]:
    """Fetch all products from a Shopify store via products.json API."""
    base = f"https://{domain}"
    all_products = []
    page = 1
    error = None

    while page <= max_pages:
        url = f"{base}/products.json?limit=250&page={page}"
        try:
            req = urllib.request.Request(url, headers={
                "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
                "Accept": "application/json",
                "Accept-Language": "en-US,en;q=0.9",
            })
            with urllib.request.urlopen(req, timeout=30) as resp:
                data = json.loads(resp.read().decode())
        except urllib.error.HTTPError as e:
            if e.code in (403, 429):
                error = f"HTTP {e.code}"
            elif e.code == 404:
                error = "HTTP 404"
            else:
                error = f"HTTP {e.code}"
            break
        except Exception as e:
            error = str(e)[:120]
            break

        products = data.get("products", [])
        if not products:
            break
        all_products.extend(products)
        if len(products) < 250:
            break
        page += 1
        time.sleep(REQUEST_DELAY)

    return all_products, error


def transform(p: dict, merchant_id: str, domain: str, niche: str) -> dict:
    """Transform Shopify product to BuyWhere schema (lovethatglass.py variant)."""
    variants = p.get("variants") or []
    images = p.get("images") or []
    handle = p.get("handle", "")
    pid = p.get("id", "")

    raw_sku = (variants[0].get("sku", "") or "").strip() if variants else ""
    if not raw_sku:
        raw_sku = handle

    price_str = variants[0].get("price", "0") if variants else "0"
    try:
        price = str(Decimal(str(price_str)).quantize(Decimal("0.01")))
    except Exception:
        price = "0.00"

    compare_at = None
    if variants and variants[0].get("compare_at_price"):
        try:
            compare_at = str(Decimal(str(variants[0]["compare_at_price"])).quantize(Decimal("0.01")))
        except Exception:
            pass

    available = any(v.get("available", False) for v in variants)
    body_html = p.get("body_html") or ""
    body_text = re.sub(r"<[^>]+>", "", body_html).strip()[:500]

    tags = p.get("tags", [])
    if isinstance(tags, str):
        tags = [t.strip() for t in tags.split(",") if t.strip()]

    sku = f"shopify-{domain.replace('.', '-')}-{pid}"
    metadata = {
        "shopify_id": pid,
        "vendor": p.get("vendor") or "",
        "product_type": p.get("product_type") or "",
        "tags": ",".join(tags),
        "variants_count": len(variants),
        "images_count": len(images),
        "available": available,
        "published_at": p.get("published_at") or "",
        "updated_at": p.get("updated_at") or "",
        "compare_at_price": compare_at,
        "ingested_issue": "BUY-76428",
        "source_domain": domain,
        "source_batch": BATCH_TAG,
    }

    return {
        "sku": sku,
        "title": p.get("title", ""),
        "price": price,
        "brand": p.get("vendor") or None,
        "category": niche,
        "image_url": images[0].get("src") if images else "",
        "url": f"https://{domain}/products/{handle}",
        "description": body_text,
        "source": f"shopify_{merchant_id}",
        "merchant_id": merchant_id,
        "canonical_id": str(pid),
        "metadata": json.dumps(metadata),
    }


def make_merchant_id(domain: str) -> str:
    return domain.replace(".", "_").replace("-", "_")


def upload_r2(filepath: str, r2_key: str) -> str:
    import boto3
    from botocore.config import Config

    s3 = boto3.client(
        "s3",
        endpoint_url=f"https://{R2_ACCOUNT_ID}.r2.cloudflarestorage.com",
        aws_access_key_id=R2_ACCESS_KEY,
        aws_secret_access_key=R2_SECRET_KEY,
        config=Config(signature_version="s3v4"),
        region_name="auto",
    )
    s3.upload_file(filepath, R2_BUCKET, r2_key)
    head = s3.head_object(Bucket=R2_BUCKET, Key=r2_key)
    etag = head.get("ETag", "?")
    size = head.get("ContentLength", 0)
    return etag, size


def main():
    batch_dir = os.path.join(SCRATCH_DIR, BATCH_TAG)
    os.makedirs(batch_dir, exist_ok=True)

    results = {}  # domain -> {count, error, filepath}
    total_products = 0
    domain_files = {}  # domain -> filepath

    for domain, niche in MERCHANTS:
        merchant_id = make_merchant_id(domain)
        print(f"\n[{domain}] Scraping ({niche})...", flush=True)

        products, error = fetch_products(domain)
        if error:
            print(f"  ERROR: {error}", flush=True)
            results[domain] = {"niche": niche, "count": 0, "error": error}
            continue

        if not products:
            print(f"  WARN: no products returned", flush=True)
            results[domain] = {"niche": niche, "count": 0, "error": "no_products"}
            continue

        print(f"  Fetched {len(products)} raw products", flush=True)

        transformed = []
        errors = 0
        for p in products:
            try:
                transformed.append(transform(p, merchant_id, domain, niche))
            except Exception as e:
                errors += 1
                if errors <= 3:
                    print(f"  ERR transforming {p.get('handle','?')}: {e}", flush=True)
        if errors:
            print(f"  Transform errors: {errors}", flush=True)

        # Write per-domain NDJSON
        domain_file = os.path.join(batch_dir, f"{domain}_{TODAY}.ndjson")
        with open(domain_file, "w") as f:
            for t in transformed:
                f.write(json.dumps(t) + "\n")

        domain_files[domain] = domain_file
        results[domain] = {"niche": niche, "count": len(transformed), "error": None}
        total_products += len(transformed)
        print(f"  Written {len(transformed)} records", flush=True)

        time.sleep(REQUEST_DELAY)

    # Summary
    succeeded = [d for d, r in results.items() if r["error"] is None and r["count"] > 0]
    failed = [d for d, r in results.items() if r["error"] is not None]
    empty = [d for d, r in results.items() if r["error"] is None and r["count"] == 0]

    print(f"\n{'='*60}")
    print(f"Scraping: {len(succeeded)} succeeded, {len(failed)} failed, {len(empty)} empty / {len(MERCHANTS)} total")
    print(f"Total products: {total_products}")

    # Merge all per-domain files
    merged_file = os.path.join(OUT_DIR, f"shopify_{BATCH_TAG}_{TODAY}.ndjson")
    seen_skus = set()
    dupes = 0
    unique_count = 0
    with open(merged_file, "w") as out:
        for domain in succeeded + empty:
            fp = domain_files.get(domain)
            if not fp or not os.path.exists(fp):
                continue
            with open(fp) as inp:
                for line in inp:
                    obj = json.loads(line)
                    sku_key = obj.get("merchant_id", "") + ":" + obj.get("sku", "")
                    if sku_key not in seen_skus:
                        seen_skus.add(sku_key)
                        out.write(line)
                        unique_count += 1
                    else:
                        dupes += 1

    print(f"Merged {unique_count} unique records ({dupes} dupes skipped) → {os.path.basename(merged_file)}")

    # Write results summary
    report_file = os.path.join(OUT_DIR, f"buy10627_{BATCH_TAG}_scrape_report_{TODAY}.json")
    with open(report_file, "w") as f:
        json.dump({
            "batch_tag": BATCH_TAG,
            "date": TODAY,
            "issue": "BUY-76428",
            "parent": "BUY-75577",
            "succeeded": [d for d, r in results.items() if r["count"] > 0],
            "failed": [(d, results[d]["error"]) for d in failed],
            "empty": empty,
            "total_products": total_products,
            "unique_records": unique_count,
            "dupes_skipped": dupes,
            "details": results,
            "merged_file": merged_file,
        }, f, indent=2)
    print(f"Report: {report_file}")

    # Upload merged file to R2
    if unique_count > 0:
        r2_key = f"shopify/{BATCH_TAG}/shopify_{BATCH_TAG}_{TODAY}.ndjson"
        print(f"\nUploading to R2: {r2_key}")
        etag, size = upload_r2(merged_file, r2_key)
        print(f"  R2 ETag={etag}, size={size} bytes")

        # Verify
        r2_key2 = f"shopify/{BATCH_TAG}/buy10627_{BATCH_TAG}_scrape_report_{TODAY}.json"
        report_etag, report_size = upload_r2(report_file, r2_key2)
        print(f"  R2 report ETag={report_etag}, size={report_size} bytes")

    print(f"\n=== DONE ===")
    print(f"Succeeded: {succeeded}")
    print(f"Failed: {failed}")
    print(f"Total unique: {unique_count}")
    return results, merged_file


if __name__ == "__main__":
    results, merged_file = main()
