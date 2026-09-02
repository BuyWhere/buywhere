#!/usr/bin/env python3
"""Ingest karmacollars NDJSON into the BuyWhere catalog via API."""
import json
import time
import urllib.request
import urllib.error

API_BASE = "https://api.buywhere.ai"
API_KEY = "shelf-ingest-key-buy8803"
NDJSON_FILE = "/home/paperclip/buywhere/data/karmacollars_20260827.ndjson"
SOURCE = "shopify_karmacollars"
BATCH_SIZE = 100


def ingest_batch(products, source):
    payload = json.dumps({"source": source, "products": products}).encode()
    req = urllib.request.Request(
        f"{API_BASE}/ingest/products",
        data=payload,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {API_KEY}",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        body = e.read().decode()
        return {"status": "failed", "error": body, "http_code": e.code}
    except Exception as e:
        return {"status": "failed", "error": str(e)}


def main():
    products = []
    with open(NDJSON_FILE) as f:
        for line in f:
            line = line.strip()
            if line:
                products.append(json.loads(line))

    print(f"Loaded {len(products)} products from NDJSON", flush=True)

    total_inserted = 0
    total_updated = 0
    total_failed = 0
    total_errors = []

    for i in range(0, len(products), BATCH_SIZE):
        batch = products[i : i + BATCH_SIZE]
        batch_num = i // BATCH_SIZE + 1
        total_batches = (len(products) - 1) // BATCH_SIZE + 1
        print(f"Batch {batch_num}/{total_batches} ({len(batch)} products)...", flush=True)
        result = ingest_batch(batch, SOURCE)
        status = result.get("status", "unknown")
        inserted = result.get("rows_inserted", 0)
        updated = result.get("rows_updated", 0)
        failed = result.get("rows_failed", 0)
        total_inserted += inserted
        total_updated += updated
        total_failed += failed
        if status == "failed":
            err_msg = result.get("error", "?")[:200]
            print(f"  FAILED: {err_msg}", flush=True)
            total_errors.append(err_msg)
        else:
            print(f"  OK: +{inserted} upd={updated} fail={failed}", flush=True)
        time.sleep(0.5)

    print(f"\nTOTAL: +{total_inserted} upd={total_updated} fail={total_failed}", flush=True)
    if total_errors:
        print(f"ERRORS ({len(total_errors)}): {total_errors[:3]}", flush=True)


if __name__ == "__main__":
    main()
