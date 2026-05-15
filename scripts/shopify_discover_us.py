#!/usr/bin/env python3
"""High-volume US Shopify merchant discovery and validation.

Validates Shopify stores by probing /products.json endpoint.
Outputs validated merchants for the BuyWhere ingestion pipeline.

Usage:
    python3 scripts/shopify_discover_us.py --batch-size 500 --concurrency 50
"""
import asyncio
import json
import ssl
import sys
import time
from pathlib import Path
from urllib.parse import urlparse

DATA_DIR = Path(__file__).resolve().parent.parent / "data" / "discovery"
OUTPUT_DIR = Path(__file__).resolve().parent.parent / "data" / "discovery" / "validated"

ssl_ctx = ssl.create_default_context()
ssl_ctx.check_hostname = False
ssl_ctx.verify_mode = ssl.CERT_NONE

UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"


async def check_products_json(domain: str, session_sem: asyncio.Semaphore, timeout: float = 10.0) -> dict | None:
    async with session_sem:
        url = f"https://{domain}/products.json?limit=1"
        try:
            reader, writer = await asyncio.wait_for(
                asyncio.open_connection(domain, 443, ssl=ssl_ctx),
                timeout=timeout,
            )
            path = "/products.json?limit=1"
            request = (
                f"GET {path} HTTP/1.1\r\n"
                f"Host: {domain}\r\n"
                f"User-Agent: {UA}\r\n"
                f"Accept: application/json\r\n"
                f"Connection: close\r\n"
                f"\r\n"
            )
            writer.write(request.encode())
            await writer.drain()

            response = await asyncio.wait_for(reader.read(8192), timeout=timeout)
            writer.close()

            response_str = response.decode("utf-8", errors="replace")
            header_end = response_str.find("\r\n\r\n")
            if header_end < 0:
                return None

            status_line = response_str.split("\r\n")[0]
            status_code = int(status_line.split(" ")[1]) if len(status_line.split(" ")) > 1 else 0

            if status_code == 301 or status_code == 302:
                for line in response_str[:header_end].split("\r\n"):
                    if line.lower().startswith("location:"):
                        loc = line.split(":", 1)[1].strip()
                        if "myshopify.com" in loc or "/products.json" in loc:
                            return {"domain": domain, "status": "redirect_shopify", "code": status_code}
                return None

            if status_code != 200:
                return None

            body = response_str[header_end + 4:]
            if '"products"' in body:
                try:
                    data = json.loads(body.split("\r\n")[-1] if "\r\n" in body else body)
                    products = data.get("products", [])
                    return {
                        "domain": domain,
                        "status": "valid_shopify",
                        "product_count_sample": len(products),
                        "has_products": len(products) > 0,
                    }
                except json.JSONDecodeError:
                    if '"products":[' in body or '"products": [' in body:
                        return {"domain": domain, "status": "valid_shopify", "product_count_sample": -1, "has_products": True}
            return None
        except Exception:
            return None


async def validate_batch(domains: list[str], concurrency: int = 50) -> list[dict]:
    sem = asyncio.Semaphore(concurrency)
    tasks = [check_products_json(d, sem) for d in domains]
    results = await asyncio.gather(*tasks)
    return [r for r in results if r is not None]


def load_domains() -> dict:
    path = DATA_DIR / "consolidated_all.json"
    with open(path) as f:
        return json.load(f)


def main():
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--batch-size", type=int, default=500)
    parser.add_argument("--concurrency", type=int, default=50)
    parser.add_argument("--max-domains", type=int, default=0, help="Max domains to validate (0=all)")
    parser.add_argument("--us-only", action="store_true", help="Only validate US-confirmed domains")
    parser.add_argument("--skip-validated", action="store_true", default=True)
    args = parser.parse_args()

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    all_domains = load_domains()
    print(f"Loaded {len(all_domains)} total domains")

    already_validated = set()
    validated_file = OUTPUT_DIR / "validated_us_merchants.jsonl"
    if args.skip_validated and validated_file.exists():
        with open(validated_file) as f:
            for line in f:
                try:
                    rec = json.loads(line)
                    already_validated.add(rec["domain"])
                except Exception:
                    pass
        print(f"Already validated: {len(already_validated)}")

    if args.us_only:
        domains = [d for d, m in all_domains.items() if m.get("country") == "US" and d not in already_validated]
    else:
        us_first = [(d, m) for d, m in all_domains.items() if m.get("country") == "US" and d not in already_validated]
        unknown = [(d, m) for d, m in all_domains.items() if m.get("country") == "unknown" and d not in already_validated]
        domains = [d for d, _ in us_first] + [d for d, _ in unknown]

    if args.max_domains > 0:
        domains = domains[:args.max_domains]

    print(f"Domains to validate: {len(domains)}")

    total_valid = 0
    total_checked = 0
    start = time.time()

    with open(validated_file, "a") as out_f:
        for i in range(0, len(domains), args.batch_size):
            batch = domains[i : i + args.batch_size]
            results = asyncio.run(validate_batch(batch, args.concurrency))
            total_checked += len(batch)
            total_valid += len(results)

            for r in results:
                meta = all_domains.get(r["domain"], {})
                r["source"] = meta.get("source", "unknown")
                r["country"] = meta.get("country", "unknown")
                r["merchant_name"] = meta.get("merchant_name", "")
                r["categories"] = meta.get("categories", "")
                r["state"] = meta.get("state", "")
                out_f.write(json.dumps(r) + "\n")
            out_f.flush()

            elapsed = time.time() - start
            rate = total_checked / elapsed if elapsed > 0 else 0
            print(
                f"  Batch {i // args.batch_size + 1}: "
                f"checked={total_checked}, valid={total_valid}, "
                f"rate={rate:.0f}/s, elapsed={elapsed:.1f}s"
            )

    elapsed = time.time() - start
    print(f"\nDone: {total_valid} valid Shopify stores from {total_checked} checked in {elapsed:.1f}s")
    print(f"Output: {validated_file}")


if __name__ == "__main__":
    main()
