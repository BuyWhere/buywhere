#!/usr/bin/env python3
"""Bulk Magento/Adobe Commerce ingestion pipeline for BUY-17966.

Usage:
    python3 ingest_magento.py \
        --magento-stores-file stores_magento.txt \
        --api-key bw_i-your-api-key \
        --batch-size 200 \
        --concurrency 4

Store file format (one store per line, comma-separated):
    https://store1.com,store_code1,access_token,US,us,USD
    https://store2.com,store_code2,,GB,uk,GBP

access_token is optional. If omitted/empty and the endpoint requires auth,
the store is queued for credential onboarding.

Output: per-merchant log line with scraped/ingested/failed counts.
"""

import argparse
import asyncio
import csv
import json
import re
import sys
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import httpx

BUYWHERE_API_URL = "https://api.buywhere.ai"
BUYWHERE_API_KEY = "bw_i-74qnb4qRXfF7pXixXeVyenHDz3KoDjTiL1EMZpt8s"

BATCH_SIZE = 100
REQUEST_DELAY = 2.0
MAGENTO_PAGE_SIZE = 250
DEFAULT_COUNTRY = "US"
DEFAULT_REGION = "us"
DEFAULT_CURRENCY = "USD"


@dataclass
class MagentoFetchOutcome:
    products: list[dict]
    total_count: int
    error: str
    needs_credentials: bool
    status_code: int


def parse_magento_price(price_str: str) -> tuple[float, str]:
    """Parse Magento price string which may include currency."""
    if not price_str:
        return 0.0, "USD"
    currency = "USD"
    price_str = price_str.strip().upper()
    for curr in ["USD", "EUR", "GBP", "SGD", "MYR", "THB", "IDR", "PHP", "VND", "AUD", "CAD"]:
        if curr in price_str:
            currency = curr
            price_str = price_str.replace(curr, "").strip()
            break
    try:
        amount = float(re.sub(r"[^\d.]", "", price_str))
        return amount, currency
    except ValueError:
        return 0.0, currency


async def fetch_magento_products(
    client: httpx.AsyncClient,
    store_url: str,
    access_token: str,
    store_code: str = "default",
) -> MagentoFetchOutcome:
    """Fetch all products from a Magento/Adobe Commerce store.

    Returns (products, total_count, error_message).
    """
    all_products = []
    page = 1
    page_size = MAGENTO_PAGE_SIZE
    total_count = 0

    clean_url = store_url.rstrip("/")

    headers = {
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        "Accept": "application/json",
    }
    if access_token:
        headers["Authorization"] = f"Bearer {access_token}"

    try:
        while True:
            url = f"{clean_url}/rest/V1/products"
            params = f"searchCriteria[pageSize]={page_size}&searchCriteria[currentPage]={page}"
            full_url = f"{url}?{params}"

            resp = await client.get(full_url, headers=headers, timeout=60.0)
            if resp.status_code != 200:
                needs_credentials = resp.status_code in (401, 403)
                return MagentoFetchOutcome(
                    products=[],
                    total_count=0,
                    error=f"HTTP {resp.status_code}: {resp.text[:200]}",
                    needs_credentials=needs_credentials,
                    status_code=resp.status_code,
                )

            data = resp.json()
            items = data.get("items", [])

            if page == 1:
                total_count = data.get("total_count", 0)

            if not items:
                break

            all_products.extend(items)

            if len(items) < page_size:
                break

            total_pages = total_count // page_size + (1 if total_count % page_size else 0)
            if page >= total_pages:
                break

            page += 1
            await asyncio.sleep(REQUEST_DELAY)

    except httpx.TimeoutException:
        return MagentoFetchOutcome(
            products=[],
            total_count=0,
            error="Request timeout",
            needs_credentials=False,
            status_code=0,
        )
    except Exception as e:
        return MagentoFetchOutcome(
            products=[],
            total_count=0,
            error=str(e),
            needs_credentials=False,
            status_code=0,
        )

    return MagentoFetchOutcome(
        products=all_products,
        total_count=total_count,
        error="",
        needs_credentials=False,
        status_code=200,
    )


def transform_magento_product(
    item: dict,
    merchant_id: str,
    base_url: str,
    store_code: str,
    country: str,
    region: str,
    currency: str,
) -> Optional[dict]:
    """Transform Magento product to BuyWhere standard format."""
    try:
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
                "magento_store_code": store_code,
                "magento_product_type": product_type,
                "source": "magento",
            },
        }
    except Exception as e:
        return None


async def ingest_batch(
    client: httpx.AsyncClient,
    products: list[dict],
    source: str,
    api_key: str,
) -> dict:
    """Send batch of products to BuyWhere ingestion API."""
    url = f"{BUYWHERE_API_URL}/v1/ingest/products"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    payload = {"source": source, "products": products}
    try:
        resp = await client.post(url, json=payload, headers=headers, timeout=60.0)
        if resp.status_code != 200:
            return {"status": "failed", "error": f"HTTP {resp.status_code}: {resp.text[:200]}"}
        return resp.json()
    except Exception as e:
        return {"status": "failed", "error": str(e)}


async def process_store(
    client: httpx.AsyncClient,
    store_url: str,
    store_code: str,
    access_token: str,
    source: str,
    country: str,
    region: str,
    currency: str,
    batch_size: int,
    api_key: str,
    dry_run: bool = False,
) -> dict:
    """Process a single Magento store."""
    result = {
        "store": store_url,
        "source": source,
        "fetched": 0,
        "transformed": 0,
        "inserted": 0,
        "updated": 0,
        "failed": 0,
        "error": None,
        "needs_credentials": False,
        "status_code": 0,
    }

    print(f"[{source}] Fetching from {store_url}...", flush=True)
    outcome = await fetch_magento_products(
        client, store_url, access_token, store_code
    )

    if outcome.needs_credentials:
        result["needs_credentials"] = True
        result["status_code"] = outcome.status_code
        result["error"] = f"Needs credentials (HTTP {outcome.status_code})"
        print(f"[{source}] SKIP: requires credentials", flush=True)
        return result

    if outcome.error:
        result["status_code"] = outcome.status_code
        result["error"] = outcome.error
        print(f"[{source}] ERROR fetching: {outcome.error}", flush=True)
        return result

    products = outcome.products
    total = outcome.total_count
    result["status_code"] = outcome.status_code
    result["fetched"] = len(products)
    print(f"[{source}] Fetched {len(products)} products (total: {total})", flush=True)

    if not products:
        return result

    transformed = []
    for p in products:
        t = transform_magento_product(
            p,
            source,
            store_url,
            store_code,
            country,
            region,
            currency,
        )
        if t:
            transformed.append(t)

    result["transformed"] = len(transformed)
    print(f"[{source}] Transformed {len(transformed)} products", flush=True)

    if dry_run:
        return result

    for i in range(0, len(transformed), batch_size):
        batch = transformed[i:i + batch_size]
        batch_result = await ingest_batch(client, batch, source, api_key)
        status = batch_result.get("status", "unknown")
        result["inserted"] += batch_result.get("rows_inserted", 0)
        result["updated"] += batch_result.get("rows_updated", 0)
        result["failed"] += batch_result.get("rows_failed", 0)
        if status == "failed":
            print(f"[{source}] Batch failed: {batch_result.get('error', '?')}", flush=True)
        await asyncio.sleep(REQUEST_DELAY)

    print(
        f"[{source}] Ingested: +{result['inserted']} upd={result['updated']} fail={result['failed']}",
        flush=True
    )
    return result


async def process_stores(
    stores_file: str,
    concurrency: int,
    batch_size: int,
    api_key: str,
    dry_run: bool,
    needs_credentials_queue_file: Optional[str] = None,
):
    """Process multiple Magento stores with concurrency."""
    stores = []
    with open(stores_file, "r") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            parts = line.split(",")
            if len(parts) >= 1:
                store_url = parts[0].strip()
                if not store_url:
                    continue
                store_code = parts[1].strip() if len(parts) > 1 and parts[1].strip() else "default"
                access_token = parts[2].strip() if len(parts) > 2 else ""
                country = parts[3].strip() if len(parts) > 3 and parts[3].strip() else DEFAULT_COUNTRY
                region = parts[4].strip() if len(parts) > 4 and parts[4].strip() else DEFAULT_REGION
                currency = parts[5].strip() if len(parts) > 5 and parts[5].strip() else DEFAULT_CURRENCY
                source = f"magento_{store_code}"
                stores.append((store_url, store_code, access_token, source, country, region, currency))

    print(f"Loaded {len(stores)} stores from {stores_file}", flush=True)

    limiter = asyncio.Semaphore(concurrency)
    async with httpx.AsyncClient() as client:
        async def limited_process(store_tuple):
            async with limiter:
                return await process_store(
                    client, *store_tuple, batch_size, api_key, dry_run
                )

        results = await asyncio.gather(*[limited_process(s) for s in stores])

    needs_credentials = [r for r in results if r.get("needs_credentials")]
    if needs_credentials_queue_file:
        now = datetime.now(timezone.utc).isoformat()
        with open(needs_credentials_queue_file, "w", encoding="utf-8") as f:
            for record in needs_credentials:
                queue_record = {
                    "merchant_domain": record["store"].replace("https://", "").replace("http://", ""),
                    "source": record["source"],
                    "store_url": record["store"],
                    "status_code": record.get("status_code", 0),
                    "error": record.get("error"),
                    "queued_at": now,
                    "workflow": "needs_magento_credentials",
                    "note": "Guest access disabled; requires credential onboarding",
                }
                f.write(json.dumps(queue_record) + "\n")

    total_inserted = sum(r["inserted"] for r in results)
    total_updated = sum(r["updated"] for r in results)
    total_failed = sum(r["failed"] for r in results)
    total_fetched = sum(r["fetched"] for r in results)
    total_transformed = sum(r["transformed"] for r in results)
    total_needs_credentials = len(needs_credentials)

    print("\n" + "=" * 60, flush=True)
    print("OVERALL SUMMARY", flush=True)
    print(f"  Stores processed: {len(results)}", flush=True)
    print(f"  Total fetched: {total_fetched}", flush=True)
    print(f"  Total transformed: {total_transformed}", flush=True)
    print(f"  Total inserted: {total_inserted}", flush=True)
    print(f"  Total updated: {total_updated}", flush=True)
    print(f"  Total failed: {total_failed}", flush=True)
    print(f"  Needs credentials: {total_needs_credentials}", flush=True)

    return results


def main():
    parser = argparse.ArgumentParser(description="Magento/Adobe Commerce bulk ingestion")
    parser.add_argument(
        "--magento-stores-file",
        required=True,
        help="File containing Magento store configs (format: url,store_code,token,country,region,currency)",
    )
    parser.add_argument(
        "--api-key",
        default=BUYWHERE_API_KEY,
        help="BuyWhere API authentication key",
    )
    parser.add_argument(
        "--batch-size",
        type=int,
        default=100,
        help="Batch size for ingestion",
    )
    parser.add_argument(
        "--concurrency",
        type=int,
        default=4,
        help="Number of concurrent store processing",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Fetch and transform but don't ingest",
    )
    parser.add_argument(
        "--needs-credential-queue",
        default="magento_needs_credentials.ndjson",
        help="Output NDJSON file with stores requiring credentials",
    )
    args = parser.parse_args()

    batch_size = args.batch_size

    if not Path(args.magento_stores_file).exists():
        print(f"ERROR: Stores file not found: {args.magento_stores_file}", flush=True)
        sys.exit(1)

    print(f"MAGENTO BULK INGESTION - {datetime.now(timezone.utc).isoformat()}", flush=True)
    print(f"  Stores file: {args.magento_stores_file}", flush=True)
    print(f"  Concurrency: {args.concurrency}", flush=True)
    print(f"  Dry run: {args.dry_run}", flush=True)
    print(f"  Credential queue: {args.needs_credential_queue}", flush=True)

    asyncio.run(process_stores(
        args.magento_stores_file,
        args.concurrency,
        batch_size,
        args.api_key,
        args.dry_run,
        args.needs_credential_queue,
    ))


if __name__ == "__main__":
    main()
