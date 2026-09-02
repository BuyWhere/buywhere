#!/usr/bin/env python3
"""BUY-11037: Merge existing merchant catalog with new discoveries."""
import json, urllib.request, urllib.error, concurrent.futures, sys, time, ssl
from pathlib import Path

DATA = Path("data")
SHOPIFY_FILE = DATA / "us_shopify_merchants.json"
NON_SHOPIFY_FILE = DATA / "us_non_shopify_merchants.json"
RATE_LIMITED_FILE = DATA / "rate_limited_domains.json"

# ── Load existing catalog ──────────────────────────────────────────────────
def load_existing(path):
    if path.exists():
        with open(path) as f:
            data = json.load(f)
            return data.get("merchants", [])
    return []

existing_shopify = load_existing(SHOPIFY_FILE)
existing_non_shopify = load_existing(NON_SHOPIFY_FILE)

existing_domains = set(m["domain"].lower().strip() for m in existing_shopify + existing_non_shopify)
print(f"Existing catalog: {len(existing_shopify)} Shopify + {len(existing_non_shopify)} non-Shopify")
print(f"  Unique domains: {len(existing_domains)}")

# ── Candidate sources ──────────────────────────────────────────────────────
# Source 1: Compact curated brands
from discover_compact import BRANDS as COMPACT_BRANDS
compact_candidates = []
for cat, domains in COMPACT_BRANDS.items():
    for d in domains:
        d = d.strip().lower().replace(" ", "")
        if d not in existing_domains and "." in d:
            compact_candidates.append({"domain": d, "category": cat, "source": "curated_compact"})

# Source 2: v2 expanded brands
from discover_us_v2 import BRANDS as V2_BRANDS
v2_candidates = []
for cat, domains in V2_BRANDS.items():
    for d in domains:
        d = d.strip().lower().replace(" ", "")
        if d not in existing_domains and "." in d:
            v2_candidates.append({"domain": d, "category": cat, "source": "curated_v2"})

# Deduplicate across sources
seen = set()
all_candidates = []
for c in compact_candidates + v2_candidates:
    if c["domain"] not in seen:
        seen.add(c["domain"])
        all_candidates.append(c)

print(f"New candidates: {len(all_candidates)} ({len(compact_candidates)} compact + {len(v2_candidates)} v2)")

# ── Platform probes ────────────────────────────────────────────────────────
def probe_shopify(domain):
    try:
        ctx = ssl.create_default_context()
        req = urllib.request.Request(f"https://{domain}/products.json",
            headers={"User-Agent":"BW/1.0","Accept":"application/json"})
        with urllib.request.urlopen(req, timeout=10, context=ctx) as r:
            if r.status == 200:
                data = json.loads(r.read().decode())
                if isinstance(data, dict) and "products" in data:
                    return True, len(data["products"])
            return False, 0
    except urllib.error.HTTPError as e:
        if e.code == 429: return None, "rate_limited"
        return False, 0
    except: return False, 0

def probe_woocommerce(domain):
    try:
        ctx = ssl.create_default_context()
        req = urllib.request.Request(f"https://{domain}/wp-json/wc/v3",
            headers={"User-Agent":"BW/1.0","Accept":"application/json"})
        with urllib.request.urlopen(req, timeout=10, context=ctx) as r:
            ct = r.headers.get("Content-Type", "")
            if "application/json" not in ct:
                return False
            data = json.loads(r.read(16384).decode())
            if isinstance(data, dict) and "namespace" in data:
                return True
            return False
    except urllib.error.HTTPError as e:
        if e.code == 429: return None
        if e.code == 401:
            ct = e.headers.get("Content-Type", "")
            if "application/json" in ct:
                return True
        return False
    except json.JSONDecodeError:
        return False
    except: return False

def probe_bigcommerce(domain):
    try:
        ctx = ssl.create_default_context()
        req = urllib.request.Request(f"https://{domain}/api/storefront",
            headers={"User-Agent":"BW/1.0","Accept":"application/json"})
        with urllib.request.urlopen(req, timeout=10, context=ctx) as r:
            ct = r.headers.get("Content-Type", "")
            if "application/json" not in ct:
                return False
            data = json.loads(r.read(16384).decode())
            if isinstance(data, dict):
                return True
            return False
    except urllib.error.HTTPError as e:
        if e.code == 429: return None
        return False
    except json.JSONDecodeError:
        return False
    except: return False

def probe_magento(domain):
    try:
        ctx = ssl.create_default_context()
        req = urllib.request.Request(f"https://{domain}/rest/V1/store/storeConfigs",
            headers={"User-Agent":"BW/1.0","Accept":"application/json"})
        with urllib.request.urlopen(req, timeout=10, context=ctx) as r:
            ct = r.headers.get("Content-Type", "")
            if "application/json" not in ct:
                return False
            data = json.loads(r.read(16384).decode())
            if isinstance(data, dict) and "id" in data:
                return True
            return False
    except urllib.error.HTTPError as e:
        if e.code == 429: return None
        return False
    except json.JSONDecodeError:
        return False
    except: return False

def probe_wix(domain):
    """Check if it's a Wix store via /_api/wixstores-graphql-server/graphql"""
    try:
        ctx = ssl.create_default_context()
        req = urllib.request.Request(f"https://{domain}/_api/wixstores-graphql-server/graphql",
            headers={"User-Agent":"BW/1.0"}, method="POST")
        with urllib.request.urlopen(req, timeout=8, context=ctx) as r:
            return True
    except urllib.error.HTTPError as e:
        if e.code == 429: return None
        return False
    except: return False

def validate_candidate(c):
    domain = c["domain"]
    result = {"domain": domain, "category": c["category"], "source": c["source"]}

    # Shopify
    is_s, info = probe_shopify(domain)
    if is_s is None:
        result["platform"] = None; result["status"] = "rate_limited"; return result
    if is_s:
        result["platform"] = "shopify"; result["status"] = "valid"
        result["product_count"] = info; return result

    # WooCommerce
    is_wc = probe_woocommerce(domain)
    if is_wc is None:
        result["platform"] = None; result["status"] = "rate_limited"; return result
    if is_wc:
        result["platform"] = "woocommerce"; result["status"] = "valid"; return result

    # BigCommerce
    is_bc = probe_bigcommerce(domain)
    if is_bc is None:
        result["platform"] = None; result["status"] = "rate_limited"; return result
    if is_bc:
        result["platform"] = "bigcommerce"; result["status"] = "valid"; return result

    # Magento
    is_mg = probe_magento(domain)
    if is_mg is None:
        result["platform"] = None; result["status"] = "rate_limited"; return result
    if is_mg:
        result["platform"] = "magento"; result["status"] = "valid"; return result

    result["platform"] = "unknown"; result["status"] = "failed"; return result

# ── Run discovery ──────────────────────────────────────────────────────────
if all_candidates:
    valid = {"shopify": [], "woocommerce": [], "bigcommerce": [], "magento": [], "wix": []}
    rate_limited = []
    failed = []

    workers = 15  # lower concurrency to reduce rate limiting
    print(f"Probing {len(all_candidates)} new candidates with {workers} workers...")
    with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as ex:
        futures = {ex.submit(validate_candidate, c): c for c in all_candidates}
        for i, f in enumerate(concurrent.futures.as_completed(futures)):
            result = f.result()
            status = result["status"]
            platform = result.get("platform")

            if status == "rate_limited":
                rate_limited.append(result)
            elif status == "valid" and platform:
                valid[platform].append(result)
            else:
                failed.append(result)

            if (i + 1) % 200 == 0:
                tv = sum(len(v) for v in valid.values())
                print(f"  {i+1}/{len(all_candidates)} | v={tv} | rl={len(rate_limited)} | fail={len(failed)}")

    # Print summary
    total_new = sum(len(v) for v in valid.values())
    print(f"\nNew valid: {total_new} ({total_new/len(all_candidates)*100:.1f}%)")
    for p, lst in sorted(valid.items()):
        if lst: print(f"  {p:15} {len(lst):>4}")
    print(f"Rate limited: {len(rate_limited)}")
    print(f"Failed:      {len(failed)}")

    # ── Merge with existing ────────────────────────────────────────────────
    timestamp = time.strftime("%Y%m%d_%H%M%S")

    # Merge Shopify
    all_shopify = list(existing_shopify)
    existing_domains_set = set(m["domain"].lower() for m in existing_shopify)
    for v in valid["shopify"]:
        if v["domain"] not in existing_domains_set:
            all_shopify.append({
                "domain": v["domain"],
                "platform": "shopify",
                "country": "US",
                "currency": "USD",
                "category": v["category"],
                "product_count": v.get("product_count", 0),
                "source_attribution": v["source"],
                "discovered_at": timestamp
            })

    with open(SHOPIFY_FILE, "w") as f:
        json.dump({
            "description": "US Shopify merchant catalog — BUY-11037",
            "count": len(all_shopify),
            "merchants": all_shopify,
            "generated_at": timestamp
        }, f, indent=2)
    print(f"\nSaved: {SHOPIFY_FILE} ({len(all_shopify)} merchants, +{len(all_shopify)-len(existing_shopify)} new)")

    # Merge non-Shopify
    all_non_shopify = list(existing_non_shopify)
    for platform in ["woocommerce", "bigcommerce", "magento", "wix"]:
        for v in valid[platform]:
            if v["domain"] not in existing_domains_set:
                all_non_shopify.append({
                    "domain": v["domain"],
                    "platform": platform,
                    "country": "US",
                    "currency": "USD",
                    "category": v["category"],
                    "source_attribution": v["source"],
                    "discovered_at": timestamp
                })

    with open(NON_SHOPIFY_FILE, "w") as f:
        json.dump({
            "description": "US non-Shopify merchant catalog — BUY-11037",
            "count": len(all_non_shopify),
            "merchants": all_non_shopify,
            "generated_at": timestamp
        }, f, indent=2)
    print(f"Saved: {NON_SHOPIFY_FILE} ({len(all_non_shopify)} merchants, +{len(all_non_shopify)-len(existing_non_shopify)} new)")

    # Merge rate-limited
    all_rl = list(rate_limited)
    if RATE_LIMITED_FILE.exists():
        with open(RATE_LIMITED_FILE) as f:
            old_rl = json.load(f)
            old_domains = set(d["domain"] for d in old_rl.get("domains", []))
            for r in rate_limited:
                if r["domain"] not in old_domains:
                    all_rl.append(r)

    with open(RATE_LIMITED_FILE, "w") as f:
        json.dump({
            "description": "Rate-limited domains for retry",
            "count": len(all_rl),
            "domains": all_rl,
            "generated_at": timestamp
        }, f, indent=2)
    print(f"Saved: {RATE_LIMITED_FILE} ({len(all_rl)} rate-limited domains)")

    # Category distribution
    cats = {}
    for m in all_shopify:
        cats[m["category"]] = cats.get(m["category"], 0) + 1
    print(f"\nShopify category distribution (top 20):")
    for c, n in sorted(cats.items(), key=lambda x: -x[1])[:20]:
        print(f"  {c:30} {n:>4}")

    total_merchants = len(all_shopify) + len(all_non_shopify)
    print(f"\n{'='*60}")
    print(f"TOTAL MERCHANTS: {total_merchants} ({len(all_shopify)} Shopify + {len(all_non_shopify)} non-Shopify)")
    print(f"{'='*60}")
else:
    print("No new candidates to probe.")
    total_merchants = len(existing_shopify) + len(existing_non_shopify)
    print(f"TOTAL: {total_merchants} ({len(existing_shopify)} Shopify + {len(existing_non_shopify)} non-Shopify)")
