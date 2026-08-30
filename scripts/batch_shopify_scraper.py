#!/usr/bin/env python3
"""Batch Shopify scraper for US merchants.

Reads validated US Shopify merchants from data/us_shopify_merchants.json
and scrapes products from each store, then ingests into BuyWhere API.
"""
import argparse
import json
import ssl
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Iterable
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from datetime import datetime, timezone
from xml.etree import ElementTree as ET

ROOT_DIR = Path(__file__).resolve().parent.parent
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from scrapers.proxy_config import Zone, proxy_url

API_BASE = "https://api.buywhere.ai"
API_KEY = "shelf-ingest-key-buy8803"
BATCH_SIZE = 100
REQUEST_DELAY = 1.0
MERCHANTS_FILE = Path("data/us_shopify_merchants.json")
DEFAULT_OUTPUT_DIR = Path("data/scraped")
LOCK_RETRY_ATTEMPTS = 3
LOCK_RETRY_DELAY_SECONDS = 1.5
SUCCESS_STATUSES = {"success", "completed", "completed_with_errors"}
PRODUCT_JSON_WORKERS = 1
PRODUCT_JSON_RETRY_ATTEMPTS = 2
HTTP_OPENER = urllib.request.build_opener()
CURL_PROXY_ARGS: list[str] = []


def maybe_sleep_request_delay() -> None:
    if REQUEST_DELAY > 0:
        time.sleep(REQUEST_DELAY)


def fetch_shopify_products_via_curl(url: str) -> tuple[dict | None, int | None, str | None]:
    """Retry storefront fetches through curl when urllib is fingerprint-blocked."""
    marker = "__BUYWHERE_HTTP_STATUS__:"
    proxy_args = CURL_PROXY_ARGS[:] if CURL_PROXY_ARGS else []
    result = subprocess.run(
        [
            "curl",
            "-sS",
            "-L",
            "--max-time",
            "30",
            "-A",
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
            "-H",
            "Accept: application/json",
            "-w",
            f"\\n{marker}%{{http_code}}",
            *proxy_args,
            url,
        ],
        capture_output=True,
        check=False,
    )
    if result.returncode != 0:
        return None, None, (result.stderr.decode("utf-8", "replace") or "curl failed").strip()

    payload = result.stdout.decode("utf-8", "replace")
    body, _, status_text = payload.rpartition(f"\n{marker}")
    if not status_text:
        return None, None, "curl response missing HTTP status marker"
    try:
        return json.loads(body), int(status_text.strip()), None
    except json.JSONDecodeError as e:
        return None, int(status_text.strip()), f"curl JSON decode failed: {e}"


def fetch_text(url: str, accept: str = "*/*") -> tuple[str | None, int | None, str | None]:
    try:
        req = urllib.request.Request(url, headers={
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
            "Accept": accept,
        })
        with HTTP_OPENER.open(req, timeout=30) as resp:
            return resp.read().decode("utf-8", "replace"), getattr(resp, "status", None), None
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", "replace")
        error = f"HTTPError: {e}"
        if body:
            error = f"{error} body={body[:200]}"
        return None, e.code, error
    except Exception as e:
        return None, None, str(e)


def collect_shopify_handles_from_sitemap(domain: str) -> tuple[list[str], dict]:
    sitemap_url = f"https://{domain}/sitemap.xml"
    fetch_meta: dict[str, object] = {
        "sitemap_url": sitemap_url,
        "product_sitemaps": 0,
        "sitemap_product_urls": 0,
        "sitemap_http_code": None,
        "error": None,
    }
    xml_text, http_code, error = fetch_text(sitemap_url, accept="application/xml,text/xml,*/*")
    fetch_meta["sitemap_http_code"] = http_code
    if not xml_text:
        fetch_meta["error"] = error or "empty sitemap response"
        return [], fetch_meta

    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError as e:
        fetch_meta["error"] = f"sitemap parse failed: {e}"
        return [], fetch_meta

    ns = {"sm": "http://www.sitemaps.org/schemas/sitemap/0.9"}
    product_sitemaps = []
    for loc_node in root.findall("sm:sitemap/sm:loc", ns):
        loc = (loc_node.text or "").strip()
        if "sitemap_products_" in loc:
            product_sitemaps.append(loc)
    fetch_meta["product_sitemaps"] = len(product_sitemaps)

    handles: list[str] = []
    seen_handles: set[str] = set()
    for product_sitemap_url in product_sitemaps:
        product_xml_text, product_http_code, product_error = fetch_text(
            product_sitemap_url,
            accept="application/xml,text/xml,*/*",
        )
        if not product_xml_text:
            fetch_meta["error"] = product_error or f"failed to load {product_sitemap_url}"
            continue
        try:
            product_root = ET.fromstring(product_xml_text)
        except ET.ParseError as e:
            fetch_meta["error"] = f"product sitemap parse failed: {e}"
            continue
        for loc_node in product_root.findall("sm:url/sm:loc", ns):
            loc = (loc_node.text or "").strip()
            parsed = urllib.parse.urlparse(loc)
            if parsed.netloc and parsed.netloc != domain:
                continue
            if not parsed.path.startswith("/products/"):
                continue
            handle = parsed.path.split("/products/", 1)[1].strip("/")
            if not handle or handle in seen_handles:
                continue
            seen_handles.add(handle)
            handles.append(handle)
        if product_http_code is not None:
            fetch_meta["last_product_sitemap_http_code"] = product_http_code

    fetch_meta["sitemap_product_urls"] = len(handles)
    return handles, fetch_meta


def fetch_shopify_product_by_handle(domain: str, handle: str) -> tuple[dict | None, int | None, str | None]:
    url = f"https://{domain}/products/{handle}.json"
    for attempt in range(PRODUCT_JSON_RETRY_ATTEMPTS + 1):
        try:
            req = urllib.request.Request(url, headers={
                "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
                "Accept": "application/json",
            })
            with HTTP_OPENER.open(req, timeout=30) as resp:
                data = json.loads(resp.read().decode())
                maybe_sleep_request_delay()
                return data.get("product"), getattr(resp, "status", None), None
        except urllib.error.HTTPError as e:
            if e.code in {403, 429} and attempt < PRODUCT_JSON_RETRY_ATTEMPTS:
                time.sleep(0.5 * (attempt + 1))
                continue
            if e.code == 403:
                curl_data, curl_status, curl_error = fetch_shopify_products_via_curl(url)
                if curl_data is not None and curl_status == 200:
                    maybe_sleep_request_delay()
                    return curl_data.get("product"), curl_status, None
                maybe_sleep_request_delay()
                return None, curl_status or e.code, curl_error or f"HTTPError: {e}"
            maybe_sleep_request_delay()
            return None, e.code, f"HTTPError: {e}"
        except Exception as e:
            if attempt < PRODUCT_JSON_RETRY_ATTEMPTS:
                time.sleep(0.5 * (attempt + 1))
                continue
            maybe_sleep_request_delay()
            return None, None, str(e)
    return None, None, "product fetch retries exhausted"


def fetch_shopify_products_via_sitemap(domain: str) -> tuple[list[dict], int, dict]:
    handles, sitemap_meta = collect_shopify_handles_from_sitemap(domain)
    fetch_meta: dict[str, object] = {
        "domain": domain,
        "http_code": sitemap_meta.get("sitemap_http_code"),
        "last_page": 0,
        "error": sitemap_meta.get("error"),
        "transport": "sitemap_product_json",
        "product_sitemaps": sitemap_meta.get("product_sitemaps"),
        "sitemap_product_urls": sitemap_meta.get("sitemap_product_urls"),
        "product_json_workers": PRODUCT_JSON_WORKERS,
        "product_json_failures": 0,
    }
    if not handles:
        fetch_meta["error"] = fetch_meta["error"] or "no product handles found in sitemap"
        return [], 0, fetch_meta

    products: list[dict] = []
    failures = 0
    with ThreadPoolExecutor(max_workers=PRODUCT_JSON_WORKERS) as executor:
        future_map = {
            executor.submit(fetch_shopify_product_by_handle, domain, handle): handle
            for handle in handles
        }
        for future in as_completed(future_map):
            handle = future_map[future]
            try:
                product, status_code, error = future.result()
            except Exception as e:
                failures += 1
                fetch_meta["error"] = f"product fetch crashed for {handle}: {e}"
                continue
            if product is None:
                failures += 1
                fetch_meta["http_code"] = status_code or fetch_meta.get("http_code")
                fetch_meta["error"] = error or f"missing product payload for {handle}"
                continue
            products.append(product)

    products.sort(key=lambda product: product.get("id") or 0, reverse=True)
    fetch_meta["product_json_failures"] = failures
    fetch_meta["fetched_via_sitemap"] = len(products)
    if failures and not fetch_meta.get("error"):
        fetch_meta["error"] = f"{failures} product JSON fetches failed"
    return products, len(products), fetch_meta


def fetch_shopify_products(domain: str, max_pages: int = 10) -> tuple[list[dict], int, dict]:
    """Fetch all products from a Shopify store's products.json endpoint."""
    all_products = []
    page = 1
    total_fetched = 0
    fetch_meta: dict[str, object] = {
        "domain": domain,
        "http_code": None,
        "last_page": 0,
        "error": None,
    }

    while page <= max_pages:
        url = f"https://{domain}/products.json?limit=250&page={page}"
        fetch_meta["last_page"] = page
        try:
            req = urllib.request.Request(url, headers={
                "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
                "Accept": "application/json",
            })
            with HTTP_OPENER.open(req, timeout=30) as resp:
                fetch_meta["http_code"] = getattr(resp, "status", None)
                data = json.loads(resp.read().decode())
                products = data.get("products", [])
                if not products:
                    break
                all_products.extend(products)
                total_fetched += len(products)
                if len(products) < 250:
                    break
                page += 1
                time.sleep(REQUEST_DELAY)
        except urllib.error.HTTPError as e:
            fetch_meta["http_code"] = e.code
            fetch_meta["error"] = f"HTTPError: {e}"
            print(f"  ERROR fetching page {page}: {e}", flush=True)
            if e.code == 403:
                curl_data, curl_status, curl_error = fetch_shopify_products_via_curl(url)
                if curl_status is not None:
                    fetch_meta["curl_http_code"] = curl_status
                if curl_error:
                    fetch_meta["curl_error"] = curl_error
                if curl_data is not None and curl_status == 200:
                    print(f"  Retrying page {page} via curl fallback", flush=True)
                    fetch_meta["http_code"] = curl_status
                    fetch_meta["transport"] = "curl_fallback"
                    fetch_meta["error"] = None
                    products = curl_data.get("products", [])
                    if not products:
                        break
                    all_products.extend(products)
                    total_fetched += len(products)
                    if len(products) < 250:
                        break
                    page += 1
                    time.sleep(REQUEST_DELAY)
                    continue
            if e.code >= 500 and all_products and page > 1:
                print(f"  Falling back to sitemap product fetch after page {page} server error", flush=True)
                sitemap_products, sitemap_count, sitemap_meta = fetch_shopify_products_via_sitemap(domain)
                if sitemap_products:
                    return sitemap_products, sitemap_count, sitemap_meta
            break
        except Exception as e:
            fetch_meta["error"] = str(e)
            print(f"  ERROR fetching page {page}: {e}", flush=True)
            break

    return all_products, total_fetched, fetch_meta


def transform_product(p: dict, merchant_id: str, domain: str, country: str, currency: str) -> dict | None:
    """Transform a Shopify product to BuyWhere format."""
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

    if price <= 0:
        return None

    return {
        "sku": handle,
        "merchant_id": merchant_id,
        "title": p.get("title", ""),
        "description": description_clean or None,
        "price": price,
        "currency": currency,
        "url": f"https://{domain}/products/{handle}",
        "image_url": images[0].get("src") if images else None,
        "category": p.get("product_type") or None,
        "brand": p.get("vendor") or None,
        "is_active": True,
        "is_available": in_stock,
        "in_stock": in_stock,
        "availability": "in_stock" if in_stock else "out_of_stock",
        "country_code": country.upper(),
        "region": "us" if country.upper() == "US" else "sea",
        "metadata": {
            "canonical_id": p.get("id"),
            "shopify_product_id": p.get("id"),
            "shopify_variant_id": variant.get("id"),
            "compare_at_price": compare_at,
            "tags": tags,
        },
    }


def ingest_batch(batch: list[dict], source: str) -> dict:
    """Ingest a batch of products into BuyWhere."""
    url = f"{API_BASE}/v1/ingest/products"
    headers = {
        "Authorization": f"Bearer {API_KEY}",
        "Content-Type": "application/json",
    }
    payload = json.dumps({"source": source, "products": batch}).encode()
    req = urllib.request.Request(url, data=payload, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        err_text = e.read().decode()
        return {"status": "failed", "error": err_text, "http_code": e.code}
    except Exception as e:
        error_text = str(e).strip()
        if not error_text:
            error_text = repr(e)
        return {
            "status": "failed",
            "error": error_text,
            "error_type": e.__class__.__name__,
        }


def is_retryable_ingest_error(result: dict) -> bool:
    error_text = (result.get("error") or "").lower()
    status = (result.get("status") or "").lower()
    return status not in SUCCESS_STATUSES and (
        "database is locked" in error_text
        or "database is busy" in error_text
        or "database schema has changed" in error_text
        or result.get("http_code") in {503, 429, 500}
    )


def upsert_merchant_stats(merchant_id: str, domain: str, source: str, country: str, products_count: int) -> None:
    """Persist merchant product count after a successful ingest."""
    url = f"{API_BASE}/v1/merchants/upsert"
    headers = {
        "Authorization": f"Bearer {API_KEY}",
        "Content-Type": "application/json",
    }
    payload = json.dumps({
        "id": merchant_id,
        "name": domain,
        "source": source,
        "country": country,
        "domain": domain,
        "is_active": True,
        "onboarding_stage": "active",
        "products_count": products_count,
    }).encode()
    req = urllib.request.Request(url, data=payload, headers=headers, method="POST")
    for attempt in range(LOCK_RETRY_ATTEMPTS + 1):
        try:
            with urllib.request.urlopen(req, timeout=45) as resp:
                resp.read().decode()
                return
        except Exception as e:
            error_payload = {"error": str(e)}
            if isinstance(e, urllib.error.HTTPError):
                error_payload["error"] = e.read().decode()
                error_payload["http_code"] = e.code
            if attempt >= LOCK_RETRY_ATTEMPTS or not is_retryable_ingest_error(error_payload):
                return
            time.sleep(LOCK_RETRY_DELAY_SECONDS * (2 ** attempt))


def load_merchants(merchants_file: Path) -> list[dict]:
    """Load validated US merchants from the merchants file."""
    with open(merchants_file) as f:
        data = json.load(f)
    return data.get("merchants", [])


def filter_merchants(
    merchants: Iterable[dict],
    include_source_attributions: set[str] | None,
    exclude_source_attributions: set[str] | None,
    include_domains: set[str] | None,
    exclude_domains: set[str] | None,
) -> list[dict]:
    filtered = []
    for merchant in merchants:
        attribution = merchant.get("source_attribution")
        domain = (merchant.get("domain") or "").lower()
        if include_source_attributions and attribution not in include_source_attributions:
            continue
        if exclude_source_attributions and attribution in exclude_source_attributions:
            continue
        if include_domains and domain not in include_domains:
            continue
        if exclude_domains and domain in exclude_domains:
            continue
        filtered.append(merchant)
    return filtered


def configure_http_proxy(use_brightdata_proxy: bool, proxy_zone_name: str) -> str | None:
    global HTTP_OPENER, CURL_PROXY_ARGS

    if not use_brightdata_proxy:
        HTTP_OPENER = urllib.request.build_opener()
        CURL_PROXY_ARGS = []
        return None

    zone = Zone(proxy_zone_name)
    url = proxy_url(zone)
    parsed = urllib.parse.urlparse(url)
    if not parsed.password:
        raise RuntimeError(
            f"BrightData proxy zone '{proxy_zone_name}' is missing credentials in the environment"
        )

    HTTP_OPENER = urllib.request.build_opener(
        urllib.request.ProxyHandler({
            "http": url,
            "https": url,
        }),
        urllib.request.HTTPSHandler(context=ssl._create_unverified_context()),
    )
    CURL_PROXY_ARGS = ["-k", "-x", url]
    return zone.value


def main():
    global API_KEY, REQUEST_DELAY

    parser = argparse.ArgumentParser(description="Batch Shopify scraper for US merchants")
    parser.add_argument("--start", type=int, default=0, help="Start index in merchant list")
    parser.add_argument("--limit", type=int, default=None, help="Limit number of merchants to process")
    parser.add_argument("--delay", type=float, default=REQUEST_DELAY, help="Delay between API calls")
    parser.add_argument("--api-key", default=API_KEY, help="BuyWhere API key")
    parser.add_argument(
        "--merchants-file",
        type=Path,
        default=MERCHANTS_FILE,
        help="Merchant catalog JSON file",
    )
    parser.add_argument(
        "--include-source-attribution",
        action="append",
        default=[],
        help="Only process merchants with these source_attribution values (repeatable)",
    )
    parser.add_argument(
        "--exclude-source-attribution",
        action="append",
        default=[],
        help="Skip merchants with these source_attribution values (repeatable)",
    )
    parser.add_argument(
        "--report-path",
        type=Path,
        default=Path("data/batch_scraping_report.json"),
        help="Output path for the run report JSON",
    )
    parser.add_argument(
        "--include-domain",
        action="append",
        default=[],
        help="Only process these domains (repeatable)",
    )
    parser.add_argument(
        "--exclude-domain",
        action="append",
        default=[],
        help="Skip these domains (repeatable)",
    )
    parser.add_argument(
        "--use-brightdata-proxy",
        action="store_true",
        help="Route Shopify storefront requests through BrightData",
    )
    parser.add_argument(
        "--proxy-zone",
        default=Zone.RESIDENTIAL_PROXY1.value,
        choices=[zone.value for zone in Zone],
        help="BrightData proxy zone to use when --use-brightdata-proxy is enabled",
    )
    args = parser.parse_args()

    API_KEY = args.api_key
    REQUEST_DELAY = args.delay
    active_proxy_zone = configure_http_proxy(args.use_brightdata_proxy, args.proxy_zone)

    merchants = load_merchants(args.merchants_file)
    merchants = filter_merchants(
        merchants,
        set(args.include_source_attribution) or None,
        set(args.exclude_source_attribution) or None,
        {d.lower() for d in args.include_domain} or None,
        {d.lower() for d in args.exclude_domain} or None,
    )
    total_merchants = len(merchants)
    print(f"Loaded {total_merchants} merchants", flush=True)

    limit = args.limit if args.limit else total_merchants
    end = min(args.start + limit, total_merchants)

    stats = {
        "merchants_processed": 0,
        "merchants_success": 0,
        "merchants_failed": 0,
        "total_products_fetched": 0,
        "total_products_ingested": 0,
        "total_products_failed": 0,
    }

    report = {
        "started_at": datetime.now(timezone.utc).isoformat(),
        "merchant_start": args.start,
        "merchant_end": end,
        "use_brightdata_proxy": args.use_brightdata_proxy,
        "proxy_zone": active_proxy_zone,
        "merchants": []
    }

    for i in range(args.start, end):
        merchant = merchants[i]
        domain = merchant["domain"]
        source = merchant["source"]
        merchant_id = merchant.get("merchant_id", source)
        country = merchant.get("country", "US")
        currency = merchant.get("currency", "USD")

        print(f"[{i+1}/{end}] Processing {domain}...", flush=True)

        try:
            products, fetched, fetch_meta = fetch_shopify_products(domain)
            stats["total_products_fetched"] += fetched
            print(f"  Fetched {fetched} raw products", flush=True)

            if not products:
                print(f"  No products found", flush=True)
                stats["merchants_failed"] += 1
                report_status = "no_products"
                if fetch_meta.get("http_code") == 403:
                    report_status = "storefront_forbidden"
                elif fetch_meta.get("error"):
                    report_status = "fetch_failed"
                report["merchants"].append({
                    "domain": domain,
                    "status": report_status,
                    "fetched": fetched,
                    "ingested": 0,
                    "fetch_meta": fetch_meta,
                })
                continue

            transformed = []
            for p in products:
                t = transform_product(p, merchant_id, domain, country, currency)
                if t:
                    transformed.append(t)

            print(f"  Transformed {len(transformed)} products", flush=True)

            ingested = 0
            failed = 0
            last_error = None
            for batch_start in range(0, len(transformed), BATCH_SIZE):
                batch = transformed[batch_start:batch_start + BATCH_SIZE]
                attempt = 0
                while True:
                    result = ingest_batch(batch, source)
                    if not is_retryable_ingest_error(result) or attempt >= LOCK_RETRY_ATTEMPTS:
                        break
                    attempt += 1
                    print(f"  Retry {attempt}/{LOCK_RETRY_ATTEMPTS} after lock: {result.get('error')}", flush=True)
                    time.sleep(LOCK_RETRY_DELAY_SECONDS * (2 ** (attempt - 1)))
                if (result.get("status") or "").lower() in SUCCESS_STATUSES:
                    ingested += result.get("rows_inserted", 0) + result.get("rows_updated", 0)
                else:
                    failed += len(batch)
                    raw_error = (result.get("error") or "")
                    if not raw_error and result.get("errors"):
                        raw_error = result["errors"][0].get("error", "")
                    last_error = {
                        "http_code": result.get("http_code"),
                        "status": result.get("status"),
                        "error": (raw_error or "")[:500],
                    }
                time.sleep(REQUEST_DELAY)

            stats["total_products_ingested"] += ingested
            stats["total_products_failed"] += failed
            stats["merchants_success"] += 1
            upsert_merchant_stats(
                merchant_id=merchant_id,
                domain=domain,
                source=source,
                country=country,
                products_count=ingested,
            )
            print(f"  Ingested {ingested}, failed {failed}", flush=True)
            if last_error:
                print(
                    f"  Last ingest error: status={last_error['status']} "
                    f"http={last_error['http_code']} error={last_error['error']}",
                    flush=True,
                )

            report["merchants"].append({
                "domain": domain,
                "status": "success",
                "fetched": fetched,
                "transformed": len(transformed),
                "ingested": ingested,
                "failed": failed,
                "last_error": last_error,
                "fetch_meta": fetch_meta,
            })

        except Exception as e:
            stats["merchants_failed"] += 1
            print(f"  ERROR: {e}", flush=True)
            report["merchants"].append({
                "domain": domain,
                "status": "error",
                "error": str(e)
            })
        finally:
            stats["merchants_processed"] += 1
            time.sleep(REQUEST_DELAY)

    report["completed_at"] = datetime.now(timezone.utc).isoformat()
    report["stats"] = stats

    print(f"\n=== SUMMARY ===", flush=True)
    print(f"Merchants processed: {stats['merchants_processed']}", flush=True)
    print(f"Merchants success: {stats['merchants_success']}", flush=True)
    print(f"Merchants failed: {stats['merchants_failed']}", flush=True)
    print(f"Total products fetched: {stats['total_products_fetched']}", flush=True)
    print(f"Total products ingested: {stats['total_products_ingested']}", flush=True)
    print(f"Total products failed: {stats['total_products_failed']}", flush=True)

    output_path = args.report_path
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, "w") as f:
        json.dump(report, f, indent=2)
    print(f"\nReport saved to {output_path}", flush=True)

    return 0


if __name__ == "__main__":
    sys.exit(main())
