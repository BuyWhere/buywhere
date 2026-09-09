#!/usr/bin/env python3
"""Magento/Adobe Commerce scraper for BuyWhere.

Usage:
    python3 magento_scraper.py https://your-magento-store.com \
        --source magento_yourstore \
        --merchant-id magento_yourstore \
        --country US --region us --currency USD \
        --access-token YOUR_ACCESS_TOKEN \
        --store-code default

Requires BuyWhere API running at localhost:8000.

Authentication:
    Magento/Adobe Commerce REST API supports multiple auth methods:
    1. Access Token (Bearer token) - most common for integrations
    2. Integration Token - for headless storefronts
    3. OAuth (consumer key/secret) - for third-party apps

Example with access token:
    python3 magento_scraper.py https://admin.adobe commerce-store.com \
        --source magento_mystore \
        --merchant-id magento_mystore \
        --country US --region us --currency USD \
        --access-token your_admin_access_token \
        --store-code default
"""

import argparse
import json
import re
import time
import urllib.error
import urllib.request

API_BASE = "http://localhost:8000"
BATCH_SIZE = 100
REQUEST_DELAY = 2.0


def fetch_all_products(base_url: str, access_token: str, store_code: str = "default") -> list[dict]:
    """Fetch all products from Magento/Adobe Commerce REST API.

    Uses the /rest/V1/products endpoint with searchCriteria for pagination.
    """
    all_products = []
    page = 1
    page_size = 100
    total_fetched = 0

    while True:
        url = f"{base_url}/rest/V1/products"
        params = f"searchCriteria[pageSize]={page_size}&searchCriteria[currentPage]={page}"
        full_url = f"{url}?{params}"

        print(f"  Fetching page {page}...", flush=True)

        headers = {
            "Authorization": f"Bearer {access_token}",
            "Content-Type": "application/json",
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
            "Accept": "application/json",
        }

        try:
            req = urllib.request.Request(full_url, headers=headers, method="GET")
            with urllib.request.urlopen(req, timeout=60) as resp:
                data = json.loads(resp.read().decode())
        except urllib.error.HTTPError as e:
            error_body = e.read().decode() if e.fp else ""
            print(f"  HTTP Error {e.code}: {error_body[:500]}", flush=True)
            break
        except Exception as e:
            print(f"  ERROR: {e}", flush=True)
            break

        items = data.get("items", [])
        if not items:
            break

        all_products.extend(items)
        total_fetched += len(items)

        search_criteria = data.get("search_criteria", {})
        total_pages = search_criteria.get("page_size", page_size)

        if page >= data.get("total_count", 0) // page_size + 1:
            break

        page += 1
        time.sleep(REQUEST_DELAY)

    return all_products


def transform_product(item: dict, merchant_id: str, base_url: str, country: str, region: str, currency: str) -> dict:
    """Transform Magento product to BuyWhere standard format.

    Magento product structure:
    - sku: Stock Keeping Unit
    - name: Product name
    - price: Product price (can be tier pricing, use minimal price)
    - status: 1=enabled, 2=disabled
    - visibility: 1=none, 2=catalog, 3=search, 4=catalog+search
    - type_id: simple, configurable, virtual, etc.
    - custom_attributes: key-value pairs with attribute_code and value
    - extension_attributes: stock_item, category_links, etc.
    """
    sku = item.get("sku", "")
    product_name = item.get("name", "")
    status = item.get("status", 1)
    visibility = item.get("visibility", 1)
    product_type = item.get("type_id", "simple")

    is_active = (status == 1) and (visibility in [2, 3, 4])

    custom_attrs = {attr["attribute_code"]: attr["value"]
                     for attr in item.get("custom_attributes", [])}

    extension_attrs = item.get("extension_attributes", {})
    stock_item = extension_attrs.get("stock_item", {})
    is_in_stock = stock_item.get("is_in_stock", True)

    price = 0.0
    price_val = item.get("price")
    if price_val is not None:
        try:
            price = float(price_val)
        except (ValueError, TypeError):
            price = 0.0

    description = custom_attrs.get("description", "")
    if description:
        description = re.sub(r"<[^>]+>", "", str(description)).strip()[:5000]
    else:
        description = None

    image_url = custom_attrs.get("image")
    if not image_url or image_url == "no_selection":
        image_url = None

    url_key = custom_attrs.get("url_key", "")
    product_url = f"{base_url}/{url_key}.html" if url_key else base_url

    category_ids = extension_attrs.get("category_links", [])
    category = None
    if category_ids and len(category_ids) > 0:
        category = category_ids[0].get("category_id")

    brand = custom_attrs.get("brand") or custom_attrs.get("manufacturer")

    return {
        "sku": sku,
        "merchant_id": merchant_id,
        "title": product_name,
        "description": description,
        "price": price,
        "currency": currency,
        "url": product_url,
        "image_url": image_url,
        "category": str(category) if category else None,
        "brand": brand,
        "is_active": is_active,
        "is_available": is_in_stock,
        "in_stock": is_in_stock,
        "availability": "in_stock" if is_in_stock else "out_of_stock",
        "country_code": country.upper(),
        "region": region.lower(),
        "metadata": {
            "magento_product_id": item.get("id"),
            "magento_sku": sku,
            "magento_store_code": item.get("store_code", "default"),
            "magento_product_type": product_type,
            "magento_visibility": visibility,
            "magento_status": status,
            "url_key": url_key,
        },
    }


def ingest_batch(batch: list[dict], source: str, api_key: str) -> dict:
    """Send batch of products to BuyWhere ingestion API."""
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
    parser = argparse.ArgumentParser(description="Magento/Adobe Commerce scraper for BuyWhere")
    parser.add_argument("domain", help="Magento store base URL (e.g. https://your-store.com)")
    parser.add_argument("--source", required=True, help="BuyWhere source key")
    parser.add_argument("--merchant-id", required=True, help="BuyWhere merchant ID")
    parser.add_argument("--country", default="US", help="Country code")
    parser.add_argument("--region", default="us", help="Region")
    parser.add_argument("--currency", default="USD", help="Currency")
    parser.add_argument("--api-key", default="shelf-ingest-key-buy8803", help="API key")
    parser.add_argument("--api-base", default="http://localhost:8000", help="API base URL")
    parser.add_argument("--access-token", required=True, help="Magento access token")
    parser.add_argument("--store-code", default="default", help="Magento store code")
    parser.add_argument("--fetch-limit", type=int, default=0, help="Limit number of products (0=all)")

    args = parser.parse_args()

    global API_BASE
    API_BASE = args.api_base.rstrip("/")

    base_url = args.domain.rstrip("/")

    print(f"Magento/Adobe Commerce Scraper", flush=True)
    print(f"  Domain: {args.domain}", flush=True)
    print(f"  Store Code: {args.store_code}", flush=True)
    print(f"  Source: {args.source}", flush=True)
    print(f"  Merchant: {args.merchant_id}", flush=True)
    print(f"  Country: {args.country}, Region: {args.region}, Currency: {args.currency}", flush=True)

    products = fetch_all_products(base_url, args.access_token, args.store_code)
    print(f"  Fetched: {len(products)} products", flush=True)

    if not products:
        print("ERROR: No products found", flush=True)
        return

    if args.fetch_limit > 0:
        products = products[:args.fetch_limit]
        print(f"  Limited to: {len(products)} products", flush=True)

    transformed = []
    for p in products:
        try:
            transformed.append(transform_product(p, args.merchant_id, base_url,
                                                args.country, args.region, args.currency))
        except Exception as e:
            print(f"  ERROR transforming {p.get('sku', '?')}: {e}", flush=True)

    print(f"  Transformed: {len(transformed)}", flush=True)

    total_inserted = 0
    total_updated = 0
    total_failed = 0

    for i in range(0, len(transformed), BATCH_SIZE):
        batch = transformed[i:i + BATCH_SIZE]
        batch_num = i // BATCH_SIZE + 1
        total_batches = (len(transformed) - 1) // BATCH_SIZE + 1
        print(f"  Batch {batch_num}/{total_batches} ({len(batch)})...", flush=True)
        result = ingest_batch(batch, args.source, args.api_key)
        status = result.get("status", "unknown")
        inserted = result.get("rows_inserted", 0)
        updated = result.get("rows_updated", 0)
        failed = result.get("rows_failed", 0)
        total_inserted += inserted
        total_updated += updated
        total_failed += failed
        if status == "failed":
            print(f"  FAILED: {result.get('error', '?')}", flush=True)
        else:
            print(f"  OK: +{inserted} upd={updated} fail={failed}", flush=True)
        if i + BATCH_SIZE < len(transformed):
            time.sleep(REQUEST_DELAY)

    print(f"\n  TOTAL: +{total_inserted} upd={total_updated} fail={total_failed}", flush=True)


if __name__ == "__main__":
    main()