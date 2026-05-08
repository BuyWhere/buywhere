#!/usr/bin/env python3
"""
BUY-10333: Ingest gamestop.com products via sitemap discovery + JSON-LD extraction.

Platform: Salesforce Commerce Cloud (Demandware) — Custom, Cloudflare-protected
Method: Download product sitemaps → extract product URLs → fetch product detail pages
         (impersonating Safari 17 to bypass Cloudflare) → extract JSON-LD Product
         → normalize to BuyWhere schema → batch POST to /v1/ingest/products

Max 5000 products per run. Rate limit: 2s between requests.
"""
import argparse
import json
import os
import re
import sys
import time
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from pathlib import Path

import curl_cffi.requests as curl_requests

API_BASE = os.environ.get("BUYWHERE_API_URL", "http://localhost:3000")
API_KEY = os.environ.get("PAPERCLIP_API_KEY", "")
INGEST_URL = f"{API_BASE}/v1/ingest/products"

SOURCE = "gamestop_us"
MERCHANT_ID = "gamestop.com"
COUNTRY = "US"
REGION = "us"
CURRENCY = "USD"
CATEGORY_FALLBACK = "Gaming"

BATCH_SIZE = 20
MAX_PRODUCTS = 5000
REQUEST_DELAY = 1.5
REQUEST_TIMEOUT = 45
MAX_RETRIES = 3
IMPERSONATE = "safari17_0"

OUTPUT_DIR = Path("/home/paperclip/buywhere-api/gamestop_data")
SITEMAP_INDEX_URL = "https://www.gamestop.com/sitemap_index.xml"
SITEMAP_URLS_FILE = OUTPUT_DIR / "sitemap_urls.json"
PRODUCT_URLS_FILE = OUTPUT_DIR / "product_urls.json"
CHECKPOINT_FILE = OUTPUT_DIR / "checkpoint.json"


def log(msg: str):
    ts = datetime.now(timezone.utc).strftime("%H:%M:%S")
    print(f"[{ts}] {msg}", flush=True)


def safe_get(url: str, timeout: int = REQUEST_TIMEOUT) -> curl_requests.Response | None:
    for attempt in range(MAX_RETRIES):
        try:
            r = curl_requests.get(url, impersonate=IMPERSONATE, timeout=timeout)
            if r.status_code == 200:
                return r
            elif r.status_code == 429:
                wait = 10 * (attempt + 1)
                log(f"  Rate limited on {url[:80]}, waiting {wait}s...")
                time.sleep(wait)
            elif r.status_code in (403, 404, 410):
                return None
            else:
                time.sleep(1)
        except Exception as e:
            if attempt == MAX_RETRIES - 1:
                log(f"  Request error for {url[:80]}: {e}")
            time.sleep(2)
    return None


def load_checkpoint() -> dict:
    if CHECKPOINT_FILE.exists():
        with open(CHECKPOINT_FILE) as f:
            return json.load(f)
    return {"processed_urls": [], "total_scraped": 0, "total_ingested": 0,
            "total_failed": 0, "sitemaps_downloaded": [], "last_url_idx": 0}


def save_checkpoint(cp: dict, git_commit: bool = False):
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    with open(CHECKPOINT_FILE, "w") as f:
        json.dump(cp, f, indent=2)
    if git_commit:
        _git_commit_data()


def _git_commit_data():
    import subprocess
    try:
        subprocess.run(["git", "add", "gamestop_data/checkpoint.json", "gamestop_data/products_*.ndjson"],
                     cwd=Path(__file__).parent, check=False, capture_output=True)
        result = subprocess.run(["git", "commit", "-m", "feat(gamestop): checkpoint"],
                     cwd=Path(__file__).parent, check=False, capture_output=True,
                     env={**subprocess.os.environ, "GIT_AUTHOR_NAME": "Hunt Bot",
                          "GIT_AUTHOR_EMAIL": "noreply@paperclip.ing",
                          "GIT_COMMITTER_NAME": "Hunt Bot",
                          "GIT_COMMITTER_EMAIL": "noreply@paperclip.ing"})
        if result.returncode == 0:
            log("Committed checkpoint to git")
    except Exception:
        pass


def discover_sitemaps() -> list[str]:
    if SITEMAP_URLS_FILE.exists():
        with open(SITEMAP_URLS_FILE) as f:
            existing = json.load(f)
        log(f"Loaded {len(existing)} sitemap URLs from cache")
        return existing
    log("Downloading sitemap index...")
    r = safe_get(SITEMAP_INDEX_URL)
    if not r:
        log("ERROR: Could not fetch sitemap index")
        sys.exit(1)
    root = ET.fromstring(r.text)
    ns = {"s": "http://www.sitemaps.org/schemas/sitemap/0.9"}
    sitemap_urls = []
    for sm in root.findall("s:sitemap/s:loc", ns):
        url = sm.text.strip()
        if "product" in url:
            sitemap_urls.append(url)
    with open(SITEMAP_URLS_FILE, "w") as f:
        json.dump(sitemap_urls, f, indent=2)
    log(f"Found {len(sitemap_urls)} product sitemaps")
    return sitemap_urls


def extract_product_urls_from_sitemaps(sitemap_urls: list[str], cp: dict) -> list[str]:
    if PRODUCT_URLS_FILE.exists():
        with open(PRODUCT_URLS_FILE) as f:
            existing = json.load(f)
        log(f"Loaded {len(existing)} product URLs from cache")
        return existing
    all_urls = []
    downloaded = set(cp.get("sitemaps_downloaded", []))
    for sm_url in sitemap_urls:
        if sm_url in downloaded:
            log(f"  Skipping already-downloaded: {sm_url}")
            continue
        log(f"  Downloading: {sm_url}")
        r = safe_get(sm_url, timeout=120)
        if not r:
            log(f"  WARN: Failed to download {sm_url}")
            continue
        try:
            root = ET.fromstring(r.text)
            ns = {"s": "http://www.sitemaps.org/schemas/sitemap/0.9"}
            for url_el in root.findall("s:url/s:loc", ns):
                all_urls.append(url_el.text.strip())
        except ET.ParseError as e:
            log(f"  XML parse error in {sm_url}: {e}")
            continue
        downloaded.add(sm_url)
        cp["sitemaps_downloaded"] = list(downloaded)
        save_checkpoint(cp)
        log(f"  Extracted {len(all_urls)} URLs so far")
        time.sleep(1)
    all_urls = list(dict.fromkeys(all_urls))
    with open(PRODUCT_URLS_FILE, "w") as f:
        json.dump(all_urls, f, indent=2)
    log(f"Total unique product URLs: {len(all_urls)}")
    import subprocess
    try:
        subprocess.run(["git", "add", "gamestop_data/sitemap_urls.json", "gamestop_data/product_urls.json"],
                     cwd=Path(__file__).parent, check=True, capture_output=True)
        subprocess.run(["git", "commit", "-m", "feat(gamestop): persist sitemap discovery results"],
                     cwd=Path(__file__).parent, check=True, capture_output=True,
                     env={**subprocess.os.environ, "GIT_AUTHOR_NAME": "Hunt Bot",
                          "GIT_AUTHOR_EMAIL": "noreply@paperclip.ing",
                          "GIT_COMMITTER_NAME": "Hunt Bot",
                          "GIT_COMMITTER_EMAIL": "noreply@paperclip.ing"})
        log("Committed sitemap data to git for persistence")
    except Exception as e:
        log(f"WARN: Could not commit to git: {e}")
    return all_urls


def extract_product_id_from_url(url: str) -> str | None:
    m = re.search(r'/(\d+)\.html$', url)
    if m:
        return m.group(1)
    return None


def extract_ld_product(html: str) -> dict | None:
    ld_scripts = re.findall(
        r'<script[^>]+type="application/ld\+json"[^>]*>(.*?)</script>',
        html, re.DOTALL)
    for script in ld_scripts:
        try:
            data = json.loads(script.strip())
            if isinstance(data, dict) and data.get("@type") == "Product":
                return data
            if isinstance(data, dict) and "@graph" in data:
                for item in data["@graph"]:
                    if isinstance(item, dict) and item.get("@type") == "Product":
                        return item
            if isinstance(data, list):
                for item in data:
                    if isinstance(item, dict) and item.get("@type") == "Product":
                        return item
        except json.JSONDecodeError:
            continue
    return None


def normalize_product(raw: dict, page_url: str) -> dict:
    title = raw.get("name", "Unknown Product").strip()[:1000]
    sku = extract_product_id_from_url(page_url) or ""
    offers = raw.get("offers")
    if isinstance(offers, list) and offers:
        first_offer = offers[0]
    elif isinstance(offers, dict):
        first_offer = offers
    else:
        first_offer = {}
    price_str = first_offer.get("price", "0")
    try:
        price = float(str(price_str).replace("$", "").replace(",", "").strip())
    except (ValueError, TypeError):
        price = 0.0
    currency = first_offer.get("priceCurrency", CURRENCY)
    brand = ""
    brand_obj = raw.get("brand")
    if isinstance(brand_obj, dict):
        brand = brand_obj.get("name", "")
    elif isinstance(brand_obj, str):
        brand = brand_obj
    image_url = ""
    images = raw.get("image", "")
    if isinstance(images, list) and images:
        if isinstance(images[0], dict):
            image_url = images[0].get("url", "")
        elif isinstance(images[0], str):
            image_url = images[0]
    elif isinstance(images, str):
        image_url = images
    if not image_url:
        thumb = raw.get("thumbnailUrl", "")
        if isinstance(thumb, str) and thumb:
            image_url = thumb
    description = raw.get("description", "")
    if description:
        description = re.sub(r"<[^>]+>", " ", description)
        description = re.sub(r"\s+", " ", description).strip()[:5000]
    category = raw.get("category", "")
    if not category:
        cat = raw.get("applicationCategory", "")
        if cat:
            category = cat
    if "/" in category:
        parts = [p.strip() for p in category.split("/")]
        category = " > ".join(parts)
    if not category:
        category = CATEGORY_FALLBACK
    in_stock = True
    if isinstance(first_offer, dict):
        avail = first_offer.get("availability", "")
        if "OutOfStock" in str(avail) or "PreOrder" in str(avail):
            in_stock = False
    seller = ""
    if isinstance(first_offer, dict):
        seller = first_offer.get("seller", "")
        if isinstance(seller, dict):
            seller = seller.get("name", "")
    platform = raw.get("gamePlatform", "")
    condition = ""
    if isinstance(first_offer, dict):
        ic = first_offer.get("itemCondition", "")
        if "NewCondition" in str(ic):
            condition = "New"
        elif "RefurbishedCondition" in str(ic):
            condition = "Pre-Owned"
    return {
        "sku": sku, "merchant_id": MERCHANT_ID, "title": title,
        "price": price, "currency": currency,
        "url": raw.get("url", page_url), "image_url": image_url,
        "brand": brand[:200], "category": category,
        "description": description, "country_code": COUNTRY, "region": REGION,
        "is_active": True, "in_stock": in_stock,
        "last_checked": datetime.now(timezone.utc).isoformat(),
        "extra": {"seller": seller, "platform": platform, "condition": condition}
        if (seller or platform or condition) else None,
    }


def deduplicate_products(products: list[dict]) -> list[dict]:
    seen = set()
    unique = []
    for p in products:
        sku = p.get("sku", "")
        url = p.get("url", "")
        key = sku or url
        if key and key not in seen:
            seen.add(key)
            unique.append(p)
    return unique


def ingest_batch(products: list[dict]) -> dict:
    products = deduplicate_products(products)
    payload = {"source": SOURCE, "products": products}
    for attempt in range(MAX_RETRIES):
        try:
            r = curl_requests.post(INGEST_URL, json=payload,
                headers={"Authorization": f"Bearer {API_KEY}", "Content-Type": "application/json"},
                timeout=120)
            if r.status_code in (200, 207):
                return r.json()
            elif r.status_code == 429:
                wait = 10 * (attempt + 1)
                log(f"  Rate limited on ingest, waiting {wait}s...")
                time.sleep(wait)
            else:
                log(f"  Ingest error: HTTP {r.status_code} {r.text[:200]}")
                time.sleep(2)
        except Exception as e:
            log(f"  Ingest request error: {e}")
            time.sleep(2)
    return {"rows_inserted": 0, "rows_updated": 0, "rows_failed": len(products),
            "errors": ["all_retries_exhausted"]}


def main():
    parser = argparse.ArgumentParser(description="Ingest gamestop.com products")
    parser.add_argument("--scrape-only", action="store_true")
    parser.add_argument("--max-products", type=int, default=MAX_PRODUCTS)
    parser.add_argument("--resume", action="store_true")
    parser.add_argument("--download-sitemaps-only", action="store_true")
    args = parser.parse_args()

    cp = load_checkpoint()
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    sitemap_urls = discover_sitemaps()
    product_urls = extract_product_urls_from_sitemaps(sitemap_urls, cp)

    if args.download_sitemaps_only:
        log(f"Done. {len(sitemap_urls)} sitemaps, {len(product_urls)} product URLs")
        return

    processed_urls = set(cp["processed_urls"])
    if args.resume and processed_urls:
        remaining = [u for u in product_urls if u not in processed_urls]
        log(f"Resuming: {len(remaining)} remaining (skipping {len(processed_urls)} processed)")
        product_urls = remaining

    seen_ids = set()
    deduped = []
    for u in product_urls:
        pid = extract_product_id_from_url(u)
        key = pid or u
        if key not in seen_ids:
            seen_ids.add(key)
            deduped.append(u)
    log(f"Deduped: {len(product_urls)} → {len(deduped)} unique products")
    product_urls = deduped

    max_prods = min(args.max_products, MAX_PRODUCTS)
    if not args.resume:
        product_urls = product_urls[cp.get("last_url_idx", 0):]
    product_urls = product_urls[:max_prods]
    log(f"Processing up to {len(product_urls)} products")

    products = []
    scraped = 0
    failed = 0
    last_request = 0.0
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    output_ndjson = OUTPUT_DIR / f"products_{timestamp}.ndjson"
    CHECKPOINT_EVERY = 10

    with open(output_ndjson, "a") as ndjson_f:
        for idx, url in enumerate(product_urls):
            elapsed = time.time() - last_request
            if elapsed < REQUEST_DELAY:
                time.sleep(REQUEST_DELAY - elapsed)
            log(f"[{idx+1}/{len(product_urls)}] {url}")
            last_request = time.time()
            r = safe_get(url)
            if not r:
                log("  ERROR: Failed to fetch page")
                failed += 1
                cp["processed_urls"].append(url)
                continue
            raw_product = extract_ld_product(r.text)
            if not raw_product:
                log("  WARN: No JSON-LD Product found")
                failed += 1
                cp["processed_urls"].append(url)
                continue
            normalized = normalize_product(raw_product, url)
            if normalized.get("extra") is None:
                del normalized["extra"]
            products.append(normalized)
            scraped += 1
            cp["processed_urls"].append(url)
            if scraped % CHECKPOINT_EVERY == 0:
                save_checkpoint(cp)
            ndjson_f.write(json.dumps(normalized) + "\n")
            log(f"  OK: {normalized['title'][:80]} | ${normalized['price']} | {normalized.get('brand','')}")
            if len(products) >= BATCH_SIZE:
                save_checkpoint(cp)
                if not args.scrape_only:
                    log(f"  Ingesting batch of {len(products)}...")
                    result = ingest_batch(products)
                    log(f"  Ingest: inserted={result.get('rows_inserted',0)} updated={result.get('rows_updated',0)} failed={result.get('rows_failed',0)}")
                    cp["total_ingested"] += result.get("rows_inserted", 0) + result.get("rows_updated", 0)
                    cp["total_failed"] += result.get("rows_failed", 0)
                products = []
                save_checkpoint(cp, git_commit=True)
        if products:
            if not args.scrape_only:
                log(f"  Ingesting final batch of {len(products)}...")
                result = ingest_batch(products)
                log(f"  Ingest: inserted={result.get('rows_inserted',0)} updated={result.get('rows_updated',0)} failed={result.get('rows_failed',0)}")
                cp["total_ingested"] += result.get("rows_inserted", 0) + result.get("rows_updated", 0)
                cp["total_failed"] += result.get("rows_failed", 0)
            products = []
    cp["total_scraped"] += scraped
    cp["last_url_idx"] = cp.get("last_url_idx", 0) + len(product_urls)
    save_checkpoint(cp, git_commit=True)
    log(f"\n=== Run Summary ===")
    log(f"Total scraped: {scraped}")
    log(f"Total failed: {failed}")
    log(f"Total ingested: {cp['total_ingested']}")
    log(f"Total ingest failures: {cp['total_failed']}")
    log(f"NDJSON: {output_ndjson}")
    log(f"Platform: Salesforce Commerce Cloud (Demandware) — Custom, Cloudflare-protected")


if __name__ == "__main__":
    main()
