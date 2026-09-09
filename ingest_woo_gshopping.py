#!/usr/bin/env python3
"""
Unified WooCommerce + Google Shopping Feed ingestion pipeline for BUY-7268.

Usage:
    python3 ingest_woo_gshopping.py \\
        --woo-stores-file stores_woo.txt \\
        --gshopping-feeds-file feeds_gs.txt \\
        --api-key https://api.buywhere.ai \\
        --batch-size 200 \\
        --concurrency 4 \\
        --scrape-only

Output: per-merchant/feed log line with scraped/ingested/failed counts.
"""

import argparse
import asyncio
import csv
import inspect
import io
import json
import re
import sys
import time
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import httpx


def proxy_url_from_env() -> Optional[str]:
    """Try to load Brightdata proxy URL from environment."""
    try:
        from scrapers.proxy_config import proxy_url, Zone
        return proxy_url(Zone.RESIDENTIAL_PROXY1)
    except Exception:
        return None

BUYWHERE_API_URL = "https://api.buywhere.ai"
BUYWHERE_API_KEY = "bw_i-74qnb4qRXfF7pXixXeVyenHDz3KoDjTiL1EMZpt8s"

WOO_AUTH_HEADER_KEY = "X-WooCommerce-Store-API-Auth"


def build_woo_auth_url(base_url: str, consumer_key: str, consumer_secret: str) -> str:
    """Build URL with WooCommerce REST API auth query params (simple auth)."""
    separator = "&" if "?" in base_url else "?"
    return f"{base_url}{separator}consumer_key={consumer_key}&consumer_secret={consumer_secret}"


FEED_FIELDS = [
    "id", "title", "description", "link", "image_link", "price", "sale_price",
    "currency", "availability", "brand", "gtin", "mpn", "product_type",
    "google_product_category", "condition",
]


def parse_price(price_str: str) -> tuple[float, str]:
    if not price_str:
        return 0.0, "USD"
    currency = "USD"
    price_str = price_str.strip().upper()
    for curr in ["USD", "EUR", "GBP", "SGD", "MYR", "THB", "IDR", "PHP", "VND"]:
        if curr in price_str:
            currency = curr
            price_str = price_str.replace(curr, "").strip()
            break
    try:
        amount = float(re.sub(r"[^\d.]", "", price_str))
        return amount, currency
    except ValueError:
        return 0.0, currency


def parse_woo_price(price: str) -> tuple[float, str]:
    if not price:
        return 0.0, "USD"
    try:
        return float(price), "USD"
    except ValueError:
        return 0.0, "USD"


async def fetch_woocommerce(
    client: httpx.AsyncClient,
    store_url: str,
    consumer_key: str = "",
    consumer_secret: str = "",
) -> tuple[list[dict], int, str]:
    """Fetch products from a WooCommerce store. Tries Store API first (unauthenticated), then V3 admin API.
    If consumer_key/secret provided, uses authenticated REST API."""
    products = []
    page = 1
    per_page = 100
    clean_url = store_url.rstrip("/").replace("https://", "").replace("http://", "")

    has_auth = bool(consumer_key and consumer_secret)

    if has_auth:
        api_paths = ["/wp-json/wc/v3/products"]
    else:
        api_paths = ["/wp-json/wc/store/v1/products", "/wp-json/wc/v3/products"]

    for api_path in api_paths:
        products = []
        page = 1
        api_base = f"https://{clean_url}{api_path}"
        if has_auth:
            api_base = build_woo_auth_url(api_base, consumer_key, consumer_secret)
        while True:
            try:
                resp = await client.get(
                    api_base,
                    params={"page": page, "per_page": per_page} if not has_auth else {},
                    timeout=30.0,
                )
                if resp.status_code in (401, 403):
                    if has_auth:
                        return [], resp.status_code, api_path
                    continue
                if resp.status_code == 404:
                    break
                if resp.status_code != 200:
                    break
                data = resp.json()
                if not data or (isinstance(data, dict) and "code" in data):
                    break
                if isinstance(data, list):
                    products.extend(data)
                else:
                    products.append(data)
                if isinstance(data, list) and len(data) < per_page:
                    break
                page += 1
                await asyncio.sleep(2)
            except Exception:
                break
        if products:
            return products, 200, api_path

    return [], 404, "not_found"


def transform_woocommerce(product: dict, store_domain: str, api_path: str = "") -> Optional[dict]:
    product_id = str(product.get("id", ""))
    if not product_id:
        return None

    # Store API format (unauthenticated)
    if "store/v1" in api_path:
        name = product.get("name", "")
        if not name:
            return None
        prices = product.get("prices", {}) or {}
        price_str = prices.get("price", "0")
        try:
            price_amount = float(price_str) / 100
        except (ValueError, TypeError):
            price_amount = 0.0
        if price_amount <= 0:
            return None
        currency = prices.get("currency_code", "SGD")
        images = product.get("images", [])
        image_url = ""
        if images and isinstance(images, list) and len(images) > 0:
            image_url = images[0].get("src", "") if isinstance(images[0], dict) else str(images[0])
        categories = product.get("categories", [])
        category = ""
        if categories and isinstance(categories, list) and len(categories) > 0:
            cat = categories[0]
            category = cat.get("name", "") if isinstance(cat, dict) else str(cat)
        sku = product.get("sku") or f"wc_{product_id}"
        url = product.get("permalink", "")
        description = product.get("description", "")[:5000] if product.get("description") else ""
        return {
            "sku": sku[:500],
            "source": f"woocommerce_{store_domain.replace('.', '_')}",
            "title": name[:1000],
            "price": {"amount": price_amount, "currency": currency},
            "currency": currency,
            "url": url[:2000],
            "image_url": image_url,
            "category": category[:200],
            "category_path": [category] if category else [],
            "brand": "",
            "is_active": True,
            "is_available": True,
            "in_stock": True,
            "merchant_id": store_domain,
            "metadata": {
                "platform": "woocommerce",
                "store_url": store_domain,
                "woocommerce_id": product_id,
                "api": "store_api",
            },
        }

    # V3 admin API format
    name = product.get("name", "")
    if not name:
        return None
    price_str = product.get("price", "0") or "0"
    sale_price_str = product.get("sale_price", "") or ""
    regular_price_str = product.get("regular_price", "") or ""
    use_price = sale_price_str or regular_price_str or price_str
    price_amount, currency = parse_woo_price(use_price)
    if price_amount <= 0:
        return None
    images = product.get("images", [])
    image_url = ""
    if images and isinstance(images, list) and len(images) > 0:
        image_url = images[0].get("src", "") if isinstance(images[0], dict) else str(images[0])
    categories = product.get("categories", [])
    category = ""
    if categories and isinstance(categories, list) and len(categories) > 0:
        cat = categories[0]
        category = cat.get("name", "") if isinstance(cat, dict) else str(cat)
    brand_name = ""
    brand_data = product.get("brands", [])
    if isinstance(brand_data, list) and brand_data:
        brand_name = brand_data[0].get("name", "") if isinstance(brand_data[0], dict) else str(brand_data[0])
    sku = product.get("sku", f"wc_{product_id}")
    url = product.get("permalink", "")
    description = product.get("description", "")[:5000] if product.get("description") else ""
    return {
        "sku": sku[:500],
        "source": f"woocommerce_{store_domain.replace('.', '_')}",
        "title": name[:1000],
        "price": {"amount": price_amount, "currency": currency},
        "currency": currency,
        "url": url[:2000],
        "image_url": image_url,
        "category": category[:200],
        "category_path": [category] if category else [],
        "brand": brand_name[:200],
        "is_active": product.get("status") == "publish",
        "is_available": product.get("stock_status") == "instock",
        "in_stock": product.get("stock_status") == "instock",
        "merchant_id": store_domain,
        "metadata": {
            "platform": "woocommerce",
            "store_url": store_domain,
            "woocommerce_id": product_id,
        },
    }


def transform_feed_product(item: dict, feed_source: str) -> Optional[dict]:
    product_id = str(item.get("id", ""))
    if not product_id:
        return None
    title = item.get("title", "").strip()
    if not title:
        return None
    price_amount, currency = parse_price(item.get("price", ""))
    if price_amount <= 0:
        return None
    image_url = item.get("image_link", item.get("additional_image_link", ""))
    availability = item.get("availability", "in_stock")
    availability_map = {
        "in_stock": True, "out_of_stock": False, "preorder": True,
        "backorder": True, "available_for_order": True,
    }
    is_available = availability_map.get(availability, True)
    brand = item.get("brand", "")
    category = item.get("google_product_category", item.get("product_type", ""))
    if isinstance(category, str) and "," in category:
        category = category.split(",")[0].strip()
    gtin = item.get("gtin", "")
    mpn = item.get("mpn", "")
    sku = gtin or mpn or product_id
    if not sku:
        return None
    description = item.get("description", "")
    if description and len(description) > 5000:
        description = description[:5000]
    return {
        "sku": f"gshopping_{sku}"[:500],
        "source": f"gshopping_{feed_source}",
        "title": title[:1000],
        "price": {"amount": price_amount, "currency": currency},
        "currency": currency,
        "url": item.get("link", "")[:2000],
        "image_url": image_url,
        "category": category[:200] if category else "",
        "category_path": [category] if category else [],
        "brand": brand[:200] if brand else "",
        "description": description,
        "is_active": True,
        "is_available": is_available,
        "in_stock": is_available,
        "merchant_id": feed_source,
        "metadata": {
            "platform": "google_shopping_feed",
            "feed_source": feed_source,
            "gtin": gtin,
            "mpn": mpn,
            "scraped_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        },
    }


async def fetch_feed(client: httpx.AsyncClient, url: str) -> tuple[str, int]:
    try:
        resp = await client.get(url, timeout=60.0, follow_redirects=True)
        return resp.text, resp.status_code
    except Exception:
        return "", 0


def parse_xml_feed(content: str) -> list[dict]:
    products = []
    try:
        root = ET.fromstring(content)
    except ET.ParseError:
        return products
    channel = root.find("channel")
    if channel is None:
        for item in root.findall(".//item"):
            products.append(_parse_xml_item(item))
        return products
    for item in channel.findall("item"):
        p = _parse_xml_item(item)
        if p:
            products.append(p)
    return products


def _parse_xml_item(item) -> dict:
    result = {}
    for child in item:
        tag = child.tag.split("}")[-1] if "}" in child.tag else child.tag
        if tag in FEED_FIELDS and child.text:
            result[tag] = child.text.strip()
    return result


def parse_csv_feed(content: str) -> list[dict]:
    products = []
    reader = csv.DictReader(io.StringIO(content))
    for row in reader:
        if not row:
            continue
        cleaned = {k.strip().lower(): v.strip() for k, v in row.items() if k and v}
        if cleaned.get("id"):
            products.append(cleaned)
    return products


def flatten_price(p: dict) -> dict:
    """Convert nested price object to flat price field for BuyWhere API."""
    p = dict(p)
    price_val = p.pop("price", None)
    if isinstance(price_val, dict):
        p["price"] = float(price_val.get("amount", 0))
    elif price_val is not None:
        p["price"] = float(price_val)
    else:
        p["price"] = 0.0
    return p


async def post_batch(client: httpx.AsyncClient, api_key: str, api_url: str, batch: list) -> tuple[int, int]:
    if not batch:
        return 0, 0
    flat_batch = [flatten_price(p) for p in batch]
    source = flat_batch[0].get("source", "woocommerce") if flat_batch else "unknown"
    payload = {"source": source, "products": flat_batch}
    try:
        target = f"{api_url}/v1/ingest/products"
        resp = await client.post(
            target,
            json=payload,
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            timeout=60.0,
        )
        if resp.status_code == 200:
            data = resp.json()
            inserted = int(data.get("rows_inserted", 0) or 0)
            updated = int(data.get("rows_updated", 0) or 0)
            failed = int(data.get("rows_failed", 0) or 0)
            return inserted + updated, failed
        return 0, len(batch)
    except Exception as e:
        return 0, len(batch)


async def process_woo_store(
    client: httpx.AsyncClient,
    store_domain: str,
    api_key: str,
    api_url: str,
    scrape_only: bool,
    batch_size: int,
    consumer_key: str = "",
    consumer_secret: str = "",
) -> dict:
    result = {
        "type": "woocommerce",
        "domain": store_domain,
        "api": "not_found",
        "scraped": 0,
        "ingested": 0,
        "failed": 0,
        "errors": [],
    }
    products, status, api_path = await fetch_woocommerce(client, store_domain, consumer_key, consumer_secret)
    result["api"] = api_path
    if status in (401, 403):
        result["errors"].append(f"auth_required ({status})")
        return result
    if not products:
        result["errors"].append("No products found")
        return result
    result["scraped"] = len(products)
    if scrape_only:
        return result
    normalized = [transform_woocommerce(p, store_domain, api_path) for p in products]
    normalized = [p for p in normalized if p]
    if not normalized:
        result["errors"].append("Normalization produced no valid products")
        return result
    total_ingested = 0
    total_failed = 0
    for i in range(0, len(normalized), batch_size):
        batch = normalized[i : i + batch_size]
        ingested, failed = await post_batch(client, api_key, api_url, batch)
        total_ingested += ingested
        total_failed += failed
        await asyncio.sleep(2)
    result["ingested"] = total_ingested
    result["failed"] = total_failed
    return result


async def process_gshopping_feed(
    client: httpx.AsyncClient,
    feed_url: str,
    api_key: str,
    api_url: str,
    scrape_only: bool,
    batch_size: int,
) -> dict:
    result = {
        "type": "google_shopping_feed",
        "url": feed_url,
        "scraped": 0,
        "ingested": 0,
        "failed": 0,
        "errors": [],
    }
    source = Path(feed_url).stem or feed_url.split("/")[-1]
    source = re.sub(r"[^\w\-]", "_", source)[:50]
    content, status = await fetch_feed(client, feed_url)
    if status != 200 or not content:
        result["errors"].append(f"HTTP {status}")
        return result
    if content.strip().startswith("<?xml") or content.strip().startswith("<"):
        items = parse_xml_feed(content)
    else:
        items = parse_csv_feed(content)
    if not items:
        result["errors"].append("No products parsed")
        return result
    result["scraped"] = len(items)
    if scrape_only:
        return result
    normalized = [transform_feed_product(item, source) for item in items]
    normalized = [p for p in normalized if p]
    if not normalized:
        result["errors"].append("Normalization produced no valid products")
        return result
    total_ingested = 0
    total_failed = 0
    for i in range(0, len(normalized), batch_size):
        batch = normalized[i : i + batch_size]
        ingested, failed = await post_batch(client, api_key, api_url, batch)
        total_ingested += ingested
        total_failed += failed
        await asyncio.sleep(2)
    result["ingested"] = total_ingested
    result["failed"] = total_failed
    return result


async def run_pipeline(
    woo_stores: list[tuple[str, str, str]],
    gshopping_feeds: list[str],
    api_key: str,
    api_url: str,
    batch_size: int,
    concurrency: int,
    scrape_only: bool,
    proxy: Optional[str] = None,
) -> list[dict]:
    client_kwargs = {
        "headers": {
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
            "Accept": "application/json",
        },
        "timeout": httpx.Timeout(60.0, connect=10.0),
        "verify": False,
    }
    if proxy:
        async_client_params = inspect.signature(httpx.AsyncClient).parameters
        if "proxy" in async_client_params:
            client_kwargs["proxy"] = proxy
        elif "proxies" in async_client_params:
            client_kwargs["proxies"] = proxy

    async with httpx.AsyncClient(**client_kwargs) as client:
        tasks = []
        for store_domain, consumer_key, consumer_secret in woo_stores:
            tasks.append(process_woo_store(client, store_domain, api_key, api_url, scrape_only, batch_size, consumer_key, consumer_secret))
        for feed in gshopping_feeds:
            tasks.append(process_gshopping_feed(client, feed, api_key, api_url, scrape_only, batch_size))
        results = await asyncio.gather(*tasks)
    return results


def parse_woo_store_line(line: str) -> tuple[str, str, str]:
    """Parse a line from the stores file. Format: domain.com or domain.com:consumer_key:consumer_secret"""
    line = line.strip()
    if not line or line.startswith("#"):
        return ("", "", "")
    parts = line.split(":")
    if len(parts) == 1:
        return (parts[0].strip(), "", "")
    elif len(parts) >= 3:
        return (parts[0].strip(), parts[1].strip(), parts[2].strip())
    return (line, "", "")


def main() -> int:
    parser = argparse.ArgumentParser(description="WooCommerce + Google Shopping Feed ingestion pipeline")
    parser.add_argument("--woo-stores-file", help="File with WooCommerce store domains (one per line, optionally :consumer_key:consumer_secret for auth)")
    parser.add_argument("--woo-stores", nargs="+", help="WooCommerce store domains (optionally :consumer_key:consumer_secret)")
    parser.add_argument("--gshopping-feeds-file", help="File with Google Shopping feed URLs (one per line)")
    parser.add_argument("--gshopping-feeds", nargs="+", help="Google Shopping feed URLs")
    parser.add_argument("--api-key", default=BUYWHERE_API_KEY)
    parser.add_argument("--batch-size", type=int, default=200)
    parser.add_argument("--concurrency", type=int, default=4)
    parser.add_argument("--scrape-only", action="store_true")
    parser.add_argument("--log-file", help="Append results to log file")
    parser.add_argument("--use-proxy", action="store_true", help="Use Brightdata residential proxy for blocked sites")
    args = parser.parse_args()

    woo_stores = []
    if args.woo_stores_file:
        with open(args.woo_stores_file) as f:
            for line in f:
                domain, key, secret = parse_woo_store_line(line)
                if domain:
                    woo_stores.append((domain, key, secret))
    if args.woo_stores:
        for store in args.woo_stores:
            domain, key, secret = parse_woo_store_line(store)
            if domain:
                woo_stores.append((domain, key, secret))

    gshopping_feeds = []
    if args.gshopping_feeds_file:
        with open(args.gshopping_feeds_file) as f:
            gshopping_feeds = [line.strip() for line in f if line.strip() and not line.startswith("#")]
    gshopping_feeds.extend(args.gshopping_feeds or [])

    if not woo_stores and not gshopping_feeds:
        print("No stores or feeds to process.")
        return 1

    print(f"Pipeline: {len(woo_stores)} WooCommerce, {len(gshopping_feeds)} Google Shopping feeds")
    print(f"Batch: {args.batch_size}, Concurrency: {args.concurrency}, Scrape-only: {args.scrape_only}")

    proxy = None
    if args.use_proxy:
        proxy = proxy_url_from_env()
        if proxy:
            print(f"Using proxy: {proxy[:50]}...")
        else:
            print("WARNING: --use-proxy specified but no proxy available")

    start = time.time()
    results = asyncio.run(
        run_pipeline(woo_stores, gshopping_feeds, args.api_key, BUYWHERE_API_URL, args.batch_size, args.concurrency, args.scrape_only, proxy)
    )
    elapsed = time.time() - start

    total_scraped = sum(r["scraped"] for r in results)
    total_ingested = sum(r["ingested"] for r in results)
    total_failed = sum(r["failed"] for r in results)

    print(f"\n=== PIPELINE COMPLETE ({elapsed:.1f}s) ===")
    print(f"Scraped: {total_scraped} | Ingested: {total_ingested} | Failed: {total_failed}")

    log_lines = []
    for r in results:
        if r["type"] == "woocommerce":
            api = r.get("api", "")
            line = f"woo|{r['domain']}|api={api}|scraped={r['scraped']}|ingested={r['ingested']}|failed={r['failed']}|errors={','.join(r['errors'][:3]) if r['errors'] else 'none'}"
        else:
            line = f"gs|{r['url']}|scraped={r['scraped']}|ingested={r['ingested']}|failed={r['failed']}|errors={','.join(r['errors'][:3]) if r['errors'] else 'none'}"
        print(f"  {line}")
        log_lines.append(line)

    if args.log_file:
        with open(args.log_file, "a") as f:
            ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
            f.write(f"{ts}|{total_scraped}|{total_ingested}|{total_failed}\n")
            for line in log_lines:
                f.write(f"{ts}|{line}\n")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
