#!/usr/bin/env python3
"""
Batch Shopify /products.json ingestion for US Shopify candidates.
Reads from data/us_shopify_candidates.json, skips already processed domains,
processes remaining, saves checkpoint after each domain, inserts to maglev.
"""
import json, sys, time, hashlib, os, re
import signal
import psycopg2
from datetime import datetime, timezone

DATABASE_URL = os.environ.get("CATALOG_DATABASE_URL") or open(os.path.join(os.path.dirname(__file__), "data/.catalog_db_url")).read().strip()
BATCH_SIZE = 500
USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
CHECKPOINT_FILE = "data/shopify-batch-checkpoint-w3.json"
CANDIDATES_FILE = "data/us_shopify_batch_3.json"
LOG_FILE = f"data/shopify-batch-w3-{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')}.log"
DOMAIN_TIMEOUT = 90  # seconds per domain

class DomainTimeout(Exception):
    pass

def _timeout_handler(signum, frame):
    raise DomainTimeout("Domain processing exceeded time limit")

def log(msg):
    ts = datetime.now(timezone.utc).isoformat()
    line = f"[{ts}] {msg}"
    print(line, flush=True)
    with open(LOG_FILE, "a", encoding="utf-8") as f:
        f.write(line + "\n")

def load_checkpoint():
    if os.path.exists(CHECKPOINT_FILE):
        with open(CHECKPOINT_FILE, "r") as f:
            return json.load(f)
    return {"processed": [], "stats": {"valid": 0, "invalid": 0, "total_products": 0, "inserted": 0}}

def save_checkpoint(cp):
    with open(CHECKPOINT_FILE, "w") as f:
        json.dump(cp, f, indent=2)

def fetch_products_json(domain, limit=250, page=1):
    import urllib.request
    url = f"https://{domain}/products.json?limit={limit}&page={page}"
    req = urllib.request.Request(url, headers={
        "User-Agent": USER_AGENT,
        "Accept": "application/json",
        "Accept-Language": "en-US,en;q=0.9",
    })
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode())
            return data.get("products", [])
    except Exception as e:
        log(f"  Error fetching {url}: {e}")
        return None

def transform_product(domain, p):
    variants = p.get("variants", [])
    records = []
    for v in variants:
        sku = str(v.get("sku") or "")
        if not sku:
            sku_seed = f"{p.get('title','')}|{domain}|{datetime.now(timezone.utc).isoformat()}"
            sku = hashlib.sha256(sku_seed.encode()).hexdigest()[:10]
        price_str = v.get("price", "0")
        try:
            price = float(price_str) if price_str else 0.0
        except (ValueError, TypeError):
            price = 0.0
        images = p.get("images", [])
        image_url = None
        for img in images:
            src = img.get("src", "")
            if src and not src.startswith("data:"):
                image_url = src
                break
        handle = p.get("handle", "")
        product_url = f"https://{domain}/products/{handle}" if handle else f"https://{domain}/products/{p.get('id', '')}"
        brand = p.get("vendor", "")
        product_type = p.get("product_type", "")
        description = p.get("body_html", "") or ""
        if description:
            description = re.sub(r"<[^>]+>", "", description).strip()[:2000]
        tags = p.get("tags", [])
        if isinstance(tags, list):
            tags = ", ".join(tags)
        available = v.get("available", True)
        if isinstance(available, str):
            available = available.lower() not in ("false", "0", "no", "f", "")
        records.append({
            "source": domain,
            "sku": sku,
            "merchant_id": domain,
            "title": p.get("title", "Untitled")[:500],
            "description": description,
            "price": price,
            "currency": "USD",
            "url": product_url,
            "category": product_type,
            "brand": brand,
            "image_url": image_url,
            "is_active": available,
            "is_available": available,
            "country_code": "US",
            "region": "us",
            "in_stock": available,
            "metadata": json.dumps({
                "platform": "shopify",
                "original_price": v.get("compare_at_price", price),
                "tags": tags,
                "product_id": p.get("id"),
                "variant_id": v.get("id"),
                "handle": handle,
            }),
        })
    return records

def ingest_store(conn, cur, domain):
    log(f"Starting: {domain}")
    page = 1
    total = 0
    inserted = 0
    errors = 0
    MAX_PAGES = 20
    page_budget = DOMAIN_TIMEOUT
    while page <= MAX_PAGES:
        try:
            signal.alarm(min(30, max(10, page_budget - 5)))
            products = fetch_products_json(domain, limit=250, page=page)
            signal.alarm(0)
        except DomainTimeout:
            log(f"  {domain} page {page} timed out, skipping rest of domain")
            return total, inserted, errors, False
        except Exception as e:
            signal.alarm(0)
            log(f"  {domain} page {page} exception: {e}")
            return total, inserted, errors, False
        if products is None:
            log(f"  {domain}: fetch error, marking invalid")
            return 0, 0, 0, False
        if not products:
            break
        batch = []
        for p in products:
            try:
                records = transform_product(domain, p)
                batch.extend(records)
            except Exception as e:
                errors += 1
        if batch:
            try:
                vals = [(r["source"], r["sku"], r["merchant_id"], r["title"], r["description"],
                         r["price"], r["currency"], r["url"], r["category"], r["brand"],
                         r["image_url"], r["is_active"], r["is_available"], r["country_code"], r["region"], r["in_stock"], r["metadata"]) for r in batch]
                cur.executemany("""
                    INSERT INTO products (source, sku, merchant_id, title, description,
                        price, currency, url, category, brand,
                        image_url, is_active, is_available, country_code, region, in_stock, metadata)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (sku, source, country_code) DO NOTHING
                """, vals)
                inserted += cur.rowcount
            except Exception as e:
                log(f"  Batch error on page {page}: {e}")
                errors += len(batch)
        total += len(batch)
        page += 1
        if len(products) < 250:
            break
        time.sleep(1.5)
    log(f"  Done: {domain} — total_variants={total}, inserted={inserted}, errors={errors}")
    return total, inserted, errors, True

def main():
    with open(CANDIDATES_FILE, "r") as f:
        candidates = json.load(f)
    log(f"Loaded {len(candidates)} candidates from {CANDIDATES_FILE}")
    
    cp = load_checkpoint()
    processed = set(cp.get("processed", []))
    log(f"Checkpoint: {len(processed)} already processed")
    
    remaining = [d for d in candidates if d not in processed]
    log(f"Remaining to process: {len(remaining)}")
    if not remaining:
        log("All candidates already processed — nothing to do.")
        return
    
    log(f"Connecting to DB...")
    conn = psycopg2.connect(DATABASE_URL, connect_timeout=30)
    conn.autocommit = False
    cur = conn.cursor()
    
    grand_total = cp.get("stats", {}).get("total_products", 0)
    grand_inserted = cp.get("stats", {}).get("inserted", 0)
    grand_valid = cp.get("stats", {}).get("valid", 0)
    grand_invalid = cp.get("stats", {}).get("invalid", 0)
    
    for idx, domain in enumerate(remaining, 1):
        try:
            signal.signal(signal.SIGALRM, _timeout_handler)
            signal.alarm(DOMAIN_TIMEOUT)
            try:
                t, i, e, ok = ingest_store(conn, cur, domain)
                signal.alarm(0)
            except DomainTimeout:
                log(f"  TIMEOUT: {domain} exceeded {DOMAIN_TIMEOUT}s, skipping")
                conn.rollback()
                t, i, ok = 0, 0, False
            except Exception as e:
                log(f"  ERROR: {domain}: {e}")
                conn.rollback()
                t, i, ok = 0, 0, False
            signal.alarm(0)
            if ok:
                grand_total += t
                grand_inserted += i
                grand_valid += 1
                cp["processed"].append(domain)
                cp["stats"] = {
                    "valid": grand_valid,
                    "invalid": grand_invalid,
                    "total_products": grand_total,
                    "inserted": grand_inserted
                }
                save_checkpoint(cp)
                conn.commit()
            else:
                grand_invalid += 1
                cp["stats"]["invalid"] = grand_invalid
                cp["processed"].append(domain)
                save_checkpoint(cp)
                conn.commit()
            log(f"Progress: {idx}/{len(remaining)} ({domain}) — valid={grand_valid}, invalid={grand_invalid}, total_variants={grand_total}, inserted={grand_inserted}")
        except Exception as e:
            log(f"  CRITICAL: {domain} failed: {e}")
            conn.rollback()
            grand_invalid += 1
            cp["stats"]["invalid"] = grand_invalid
            cp["processed"].append(domain)
            save_checkpoint(cp)
        if idx % 20 == 0:
            log(f"--- 20-domain checkpoint ---")
    
    log(f"GRAND TOTAL: valid_stores={grand_valid}, invalid_stores={grand_invalid}, total_variants={grand_total}, inserted={grand_inserted}")
    cur.close()
    conn.close()

if __name__ == "__main__":
    main()
