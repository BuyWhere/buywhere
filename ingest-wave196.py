#!/usr/bin/env python3
"""
Wave 196 Shopify ingestion — 18 US stores.
Uses autocommit batches, 30s statement timeout, 25-row chunks.
"""
import json, sys, time, hashlib, os, re, urllib.request
from datetime import datetime, timezone

DATABASE_URL = os.environ.get("CATALOG_DATABASE_URL") or open(os.path.join(os.path.dirname(__file__), "data/.catalog_db_url")).read().strip()
EVIDENCE_DIR = "results/BUY-62921"
LOG_FILE = f"results/BUY-62921/wave196-run.log"
USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

STORES = [
    ("outdoorresearch.com", "Outdoor Research"),
    ("seatosummit.com", "Sea to Summit"),
    ("bioliteenergy.com", "BioLite"),
    ("goalzero.com", "Goal Zero"),
    ("klymit.com", "Klymit"),
    ("rumpl.com", "Rumpl"),
    ("cotopaxi.com", "Cotopaxi"),
    ("topodesigns.com", "Topo Designs"),
    ("hyperlitemountaingear.com", "Hyperlite Mountain Gear"),
    ("zpacks.com", "Zpacks"),
    ("gossamergear.com", "Gossamer Gear"),
    ("garagegrowngear.com", "Garage Grown Gear"),
    ("sixmoondesigns.com", "Six Moon Designs"),
    ("ursack.com", "Ursack"),
    ("duckcamp.com", "Duck Camp"),
    ("fishpondusa.com", "Fishpond"),
    ("tenkararodco.com", "Tenkara Rod Co."),
    ("theproscloset.com", "The Pros Closet"),
]

INSERT_SQL = """
    INSERT INTO products (source, sku, merchant_id, title, description,
        price, currency, url, category, brand, image_url,
        is_active, is_available, country_code, region, in_stock, metadata)
    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
    ON CONFLICT (sku, source, country_code) DO NOTHING
"""

def log(msg):
    ts = datetime.now(timezone.utc).isoformat()
    line = f"[{ts}] {msg}"
    print(line, flush=True)
    os.makedirs(EVIDENCE_DIR, exist_ok=True)
    with open(LOG_FILE, "a") as f:
        f.write(line + "\n")

def fetch_products(domain, limit=250, page=1, retries=3, backoff=5):
    url = f"https://{domain}/products.json?limit={limit}&page={page}"
    req = urllib.request.Request(url, headers={
        "User-Agent": USER_AGENT,
        "Accept": "application/json",
        "Accept-Language": "en-US,en;q=0.9",
    })
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(req, timeout=15) as resp:
                data = json.loads(resp.read().decode())
                return data.get("products", [])
        except urllib.error.HTTPError as e:
            if e.code in (503, 429):
                wait = backoff * (attempt + 1) * (2 if e.code == 429 else 1)
                log(f"  {e.code} attempt {attempt+1}, wait {wait}s")
                time.sleep(wait)
            else:
                log(f"  HTTP {e.code}: {e}")
                return None
        except Exception as e:
            log(f"  Error attempt {attempt+1}: {e}")
            time.sleep(backoff)
    return None

def make_row(domain, p):
    rows = []
    for v in p.get("variants", []):
        sku = str(v.get("sku") or "")
        if not sku:
            sku = hashlib.sha256(f"{p.get('title','')}|{domain}|{v.get('id','')}".encode()).hexdigest()[:12]
        price_str = v.get("price", "0")
        try:
            price = float(price_str) if price_str else 0.0
        except:
            price = 0.0
        images = p.get("images", [])
        image_url = None
        for img in images:
            src = img.get("src", "")
            if src and not src.startswith("data:"):
                image_url = src
                break
        handle = p.get("handle", "")
        product_url = f"https://{domain}/products/{handle}" if handle else ""
        brand = p.get("vendor", "")
        product_type = p.get("product_type", "")
        desc = re.sub(r"<[^>]+>", "", (p.get("body_html") or "")).strip()[:2000]
        tags = p.get("tags", [])
        if isinstance(tags, list):
            tags = ", ".join(tags)
        available = v.get("available", True)
        if isinstance(available, str):
            available = available.lower() not in ("false", "0", "no", "f", "")
        meta = json.dumps({"platform": "shopify", "original_price": v.get("compare_at_price", price), "tags": tags, "product_id": p.get("id"), "variant_id": v.get("id"), "handle": handle})
        rows.append((domain, sku, domain, p.get("title","Untitled")[:500], desc, price, "USD", product_url, product_type, brand, image_url, available, available, "US", "us", available, meta))
    return rows

def main():
    os.makedirs(EVIDENCE_DIR, exist_ok=True)
    open(LOG_FILE, "w").close()
    log(f"=== Wave 196: {len(STORES)} stores ===")
    
    import psycopg2
    conn = psycopg2.connect(DATABASE_URL, connect_timeout=30)
    cur = conn.cursor()
    cur.execute("SET statement_timeout = '30s'")
    conn.commit()
    
    summary = []
    
    for domain, name in STORES:
        log(f"--- {name} ---")
        page = 1
        total_variants = 0
        inserted = 0
        errors = 0
        
        while page <= 25:
            products = fetch_products(domain, limit=250, page=page)
            if products is None:
                errors += 1
                break
            if not products:
                break
            
            all_rows = []
            for p in products:
                try:
                    all_rows.extend(make_row(domain, p))
                except Exception as e:
                    errors += 1
            
            if all_rows:
                ndjson_path = os.path.join(EVIDENCE_DIR, f"{domain.replace('.','_')}.ndjson")
                with open(ndjson_path, "a") as f:
                    for r in all_rows:
                        f.write(json.dumps(r, default=str) + "\n")
                
                # Insert in small autocommit batches
                for i in range(0, len(all_rows), 25):
                    chunk = all_rows[i:i+25]
                    try:
                        cur.executemany(INSERT_SQL, chunk)
                        conn.commit()
                        inserted += cur.rowcount
                    except Exception as e:
                        log(f"  Insert err {i}: {e}")
                        try:
                            conn.rollback()
                        except:
                            pass
                        errors += len(chunk)
                    time.sleep(0.05)
            
            total_variants += len(all_rows)
            if len(products) < 250:
                break
            page += 1
            time.sleep(0.3)
        
        summary.append({
            "domain": domain, "name": name,
            "fetched": total_variants,
            "inserted": inserted, "errors": errors,
            "pages": page, "ok": inserted > 0
        })
        log(f"  fetched={total_variants} inserted={inserted} errors={errors}")
        time.sleep(0.8)
    
    # Final commit
    try:
        conn.commit()
    except:
        pass
    
    summary_path = os.path.join(EVIDENCE_DIR, "summary.json")
    with open(summary_path, "w") as f:
        json.dump(summary, f, indent=2)
    
    ti = sum(s["inserted"] for s in summary)
    tf = sum(s["fetched"] for s in summary)
    ok = sum(1 for s in summary if s["ok"])
    log(f"=== DONE: {ok}/{len(STORES)} stores, {ti} inserted, {tf} fetched ===")
    
    conn.close()
    print(json.dumps({"inserted": ti, "fetched": tf, "ok": ok, "total": len(STORES)}))

if __name__ == "__main__":
    main()
