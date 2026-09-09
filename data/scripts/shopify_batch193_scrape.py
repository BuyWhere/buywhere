#!/usr/bin/env python3
"""Batch Shopify scraper for batch193 wave302 r391 — 17 net-new US Shopify merchants.

Scrapes Shopify products.json endpoints, outputs NDJSON per domain + merged batch,
uploads to R2, cleans up local files.

Source: BUY-75577 / r391_batch193_wave302_netnew.json
"""
import argparse
import json
import os
import sys
import time
import ssl
import urllib.request
import urllib.error
import datetime
import uuid
import re

SCRATCH = "/home/paperclip/buywhere/data/scraped"
OUT_DIR = "/home/paperclip/buywhere/data"
TODAY = datetime.date.today().isoformat()  # 2026-08-27
BATCH_TAG = "batch193_r391"
REQUEST_DELAY = 2.0  # seconds between pages


def fetch_products(domain: str, max_pages: int = 20) -> tuple[list[dict], str]:
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


def transform(p: dict, merchant_id: str, domain: str, country: str, region: str, currency: str, niche: str, batch_tag: str) -> dict:
    """Transform a Shopify product dict into BuyWhere catalog format."""
    variant = (p.get("variants") or [{}])[0]
    images = p.get("images") or []
    handle = p.get("handle", "")
    price_str = variant.get("price", "0")
    try:
        price = float(price_str)
    except (ValueError, TypeError):
        price = 0.0
    compare_at_str = variant.get("compare_at_price")
    compare_at = None
    if compare_at_str:
        try:
            compare_at = float(compare_at_str)
        except (ValueError, TypeError):
            pass

    desc_html = p.get("body_html") or ""
    desc_clean = re.sub(r"<[^>]+>", "", desc_html).strip()
    if len(desc_clean) > 5000:
        desc_clean = desc_clean[:5000]

    tags = p.get("tags", [])
    if isinstance(tags, str):
        tags = [t.strip() for t in tags.split(",") if t.strip()]

    return {
        "sku": handle,
        "merchant_id": merchant_id,
        "title": p.get("title", ""),
        "description": desc_clean or None,
        "price": price,
        "currency": currency,
        "url": f"https://{domain}/products/{handle}",
        "image_url": images[0].get("src") if images else None,
        "category": niche,
        "brand": p.get("vendor") or None,
        "is_active": True,
        "is_available": variant.get("available", True),
        "in_stock": variant.get("available", True),
        "availability": "in_stock" if variant.get("available", True) else "out_of_stock",
        "country_code": country.upper(),
        "region": region.lower(),
        "metadata": {
            "canonical_id": str(p.get("id", "")),
            "shopify_product_id": str(p.get("id", "")),
            "shopify_variant_id": str(variant.get("id", "")),
            "compare_at_price": compare_at,
            "tags": tags,
            "scraped_at": datetime.datetime.utcnow().isoformat() + "Z",
            "source_batch": batch_tag,
        },
    }


def make_merchant_id(domain: str) -> str:
    """Convert domain to BuyWhere merchant_id."""
    return domain.replace(".", "_").replace("-", "_")


def main():
    merchants = [
        ("pickleseh.com",              "preserved_foods"),
        ("preservedgoods.com",         "preserved_foods"),
        ("karmacollars.com",           "dog_collars"),
        ("mypapergardenco.com",        "stationery"),
        ("lilyandroeco.com",           "apothecary"),
        ("hookandarrow.co",            "home_goods"),
        ("sauceworksco.com",           "hot_sauce"),
        ("puckerbuttpeppercompany.com","hot_sauce"),
        ("thelittleherbalapothecary.com","apothecary"),
        ("arukahapothecary.com",       "apothecary"),
        ("troveontremont.com",         "home_goods"),
        ("wildwoodsoapco.com",         "soap"),
        ("threadandhoney.co",          "soap"),
        ("beccascoffee.com",           "coffee"),
        ("woodandfield.co",            "home_goods"),
        ("thefinishingtouch.co",       "jewelry_supplies"),
        ("westcoastsupply.com",        "supplies"),
    ]

    out_dir = os.path.join(SCRATCH, BATCH_TAG)
    os.makedirs(out_dir, exist_ok=True)

    total_products = 0
    domain_files = {}

    for domain, niche in merchants:
        merchant_id = make_merchant_id(domain)
        source = f"shopify_{merchant_id}"

        print(f"\n[{domain}] Scraping ({niche})...", flush=True)

        products, error = fetch_products(domain)
        if error:
            print(f"  ERROR: {error}", flush=True)
            continue
        if not products:
            print(f"  WARN: no products returned", flush=True)
            continue

        print(f"  Fetched {len(products)} raw products", flush=True)

        transformed = []
        errors = 0
        for p in products:
            try:
                transformed.append(transform(
                    p, merchant_id, domain, "US", "us", "USD", niche, BATCH_TAG
                ))
            except Exception as e:
                errors += 1
                print(f"  ERR transforming {p.get('handle','?')}: {e}", flush=True)

        if errors:
            print(f"  Transform errors: {errors}", flush=True)

        # Write per-domain NDJSON
        domain_file = os.path.join(out_dir, f"{domain}_{TODAY}.ndjson")
        with open(domain_file, "w") as f:
            for t in transformed:
                f.write(json.dumps(t) + "\n")

        domain_files[domain] = (domain_file, len(transformed))
        total_products += len(transformed)
        print(f"  Written {len(transformed)} records to {os.path.basename(domain_file)}", flush=True)

        time.sleep(REQUEST_DELAY)

    print(f"\n{'='*60}")
    print(f"Scraping complete: {len(domain_files)}/{len(merchants)} domains, {total_products} products")

    if not domain_files:
        print("No data scraped — nothing to upload.")
        sys.exit(1)

    # Write merged batch file
    merged_file = os.path.join(OUT_DIR, f"shopify_{BATCH_TAG}_{TODAY}.ndjson")
    seen_skus = set()
    dupes = 0
    with open(merged_file, "w") as out:
        for domain, (filepath, count) in domain_files.items():
            with open(filepath) as inp:
                for line in inp:
                    obj = json.loads(line)
                    sku_key = f"{obj.get('merchant_id')}:{obj.get('sku')}"
                    if sku_key not in seen_skus:
                        seen_skus.add(sku_key)
                        out.write(line)
                    else:
                        dupes += 1

    print(f"Merged {merged_file} ({total_products - dupes} unique records, {dupes} dupes skipped)")
    print(f"\nNext: upload {merged_file} to R2")
    return merged_file, domain_files


if __name__ == "__main__":
    merged_file, domain_files = main()
