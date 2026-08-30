#!/usr/bin/env python3
"""Reusable Shopify scraper for BuyWhere.

Usage:
    python3 scrapers/shopify_scraper.py storymfg.com \\
        --source shopify_storymfg \\
        --merchant-id shopify_storymfg \\
        --country US --region us --currency USD \\
        --api-key shelf-ingest-key-buy8803

Requires BuyWhere API running at localhost:8000.
"""
import argparse
import json
import time
import urllib.request
import urllib.error

API_BASE = "http://localhost:8000"
BATCH_SIZE = 100
REQUEST_DELAY = 2.0


def fetch_all(url: str) -> list[dict]:
    all_products = []
    page = 1
    while True:
        page_url = f"{url}/products.json?limit=250&page={page}"
        print(f"  Fetching page {page}...", flush=True)
        try:
            req = urllib.request.Request(page_url, headers={
                "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
                "Accept": "application/json",
            })
            with urllib.request.urlopen(req, timeout=30) as resp:
                data = json.loads(resp.read().decode())
        except Exception as e:
            print(f"  ERROR: {e}", flush=True)
            break
        products = data.get("products", [])
        if not products:
            break
        all_products.extend(products)
        if len(products) < 250:
            break
        page += 1
        time.sleep(REQUEST_DELAY)
    return all_products


def transform(p: dict, merchant_id: str, base_url: str, country: str, region: str, currency: str) -> dict:
    variant = p.get("variants", [{}])[0] if p.get("variants") else {}
    images = p.get("images", [])
    handle = p.get("handle", "")
    price_str = variant.get("price", "0")
    try:
        price = float(price_str)
    except (ValueError, TypeError):
        price = 0.0
    compare_at = variant.get("compare_at_price")
    if compare_at is not None:
        try:
            compare_at = float(compare_at)
        except (ValueError, TypeError):
            compare_at = None
    in_stock = variant.get("available", True)
    description = p.get("body_html") or ""
    import re
    description_clean = re.sub(r"<[^>]+>", "", description).strip()[:5000] if description else None
    tags = p.get("tags", [])
    if isinstance(tags, str):
        tags = [t.strip() for t in tags.split(",") if t.strip()]

    return {
        "sku": handle,
        "merchant_id": merchant_id,
        "title": p.get("title", ""),
        "description": description_clean or None,
        "price": price,
        "currency": currency,
        "url": f"{base_url}/products/{handle}",
        "image_url": images[0].get("src") if images else None,
        "category": p.get("product_type") or None,
        "brand": p.get("vendor") or None,
        "is_active": True,
        "is_available": in_stock,
        "in_stock": in_stock,
        "availability": "in_stock" if in_stock else "out_of_stock",
        "country_code": country.upper(),
        "region": region.lower(),
        "metadata": {
            "canonical_id": p.get("id"),
            "shopify_product_id": p.get("id"),
            "shopify_variant_id": variant.get("id"),
            "compare_at_price": compare_at,
            "tags": tags,
        },
    }


def ingest_batch(batch: list[dict], source: str, api_key: str) -> dict:
    url = f"{API_BASE}/v1/ingest/products"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    payload = json.dumps({"source": source, "products": batch}).encode()
    req = urllib.request.Request(url, data=payload, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        return {"status": "failed", "error": e.read().decode(), "http_code": e.code}
    except Exception as e:
        return {"status": "failed", "error": str(e)}


def main():
    parser = argparse.ArgumentParser(description="Shopify scraper for BuyWhere")
    parser.add_argument("domain", help="Shopify store domain (e.g. storymfg.com)")
    parser.add_argument("--source", required=True, help="BuyWhere source key")
    parser.add_argument("--merchant-id", required=True, help="BuyWhere merchant ID")
    parser.add_argument("--country", default="SG", help="Country code")
    parser.add_argument("--region", default="sea", help="Region")
    parser.add_argument("--currency", default="SGD", help="Currency")
    parser.add_argument("--api-key", default="shelf-ingest-key-buy8803", help="API key")
    parser.add_argument("--api-base", default="http://localhost:8000", help="API base URL")
    args = parser.parse_args()

    global API_BASE
    API_BASE = args.api_base.rstrip("/")

    base_url = f"https://{args.domain}"
    source = args.source
    merchant_id = args.merchant_id

    print(f"Shopify Scraper", flush=True)
    print(f"  Domain: {args.domain}", flush=True)
    print(f"  Source: {source}", flush=True)
    print(f"  Merchant: {merchant_id}", flush=True)
    print(f"  Country: {args.country}, Region: {args.region}, Currency: {args.currency}", flush=True)

    products = fetch_all(base_url)
    print(f"  Fetched: {len(products)} products", flush=True)

    if not products:
        print("ERROR: No products found", flush=True)
        return

    transformed = []
    for p in products:
        try:
            transformed.append(transform(p, merchant_id, base_url, args.country, args.region, args.currency))
        except Exception as e:
            print(f"  ERROR transforming {p.get('handle','?')}: {e}", flush=True)

    print(f"  Transformed: {len(transformed)}", flush=True)

    total_inserted = 0
    total_updated = 0
    total_failed = 0

    for i in range(0, len(transformed), BATCH_SIZE):
        batch = transformed[i:i + BATCH_SIZE]
        print(f"  Batch {i//BATCH_SIZE + 1}/{(len(transformed)-1)//BATCH_SIZE + 1} ({len(batch)})...", flush=True)
        result = ingest_batch(batch, source, args.api_key)
        status = result.get("status", "unknown")
        inserted = result.get("rows_inserted", 0)
        updated = result.get("rows_updated", 0)
        failed = result.get("rows_failed", 0)
        total_inserted += inserted
        total_updated += updated
        total_failed += failed
        if status == "failed":
            print(f"  FAILED: {result.get('error','?')}", flush=True)
        else:
            print(f"  OK: +{inserted} upd={updated} fail={failed}", flush=True)
        if i + BATCH_SIZE < len(transformed):
            time.sleep(REQUEST_DELAY)

    print(f"\n  TOTAL: +{total_inserted} upd={total_updated} fail={total_failed}", flush=True)


if __name__ == "__main__":
    main()
