#!/usr/bin/env python3
"""BUY-17969: Social Commerce domain discovery, validation, and ingestion pipeline.

Orchestrates the full social commerce pipeline:
1. Run TikTok, Instagram, Pinterest scrapers to discover domains
2. Validate discovered domains via Shopify/WooCommerce detection
3. Ingest validated merchants into the catalog
"""

import argparse
import asyncio
import json
import os
import sys
import time
from pathlib import Path
from typing import Optional

import aiohttp

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from scrapers.proxy_config import Zone, proxy_url, proxy_config_for_httpx


SCRIPT_DIR = Path(__file__).resolve().parent
DATA_DIR = SCRIPT_DIR.parent / "data"
OUTPUT_DIR = DATA_DIR / "social_commerce"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

MERCHANT_VALIDATOR_SCRIPT = Path("/home/paperclip/merchant_validator.py")

USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/125.0.0.0 Safari/537.36"
)


# ─── Step 1: Collect domains from all sources ─────────────────────────────────

def collect_tiktok_domains() -> list[dict]:
    """Load TikTok-discovered domains from NDJSON file."""
    ndjson_path = DATA_DIR / "social_tiktok" / "tiktok_discovered.ndjson"
    results = []
    if ndjson_path.exists():
        with open(ndjson_path) as f:
            for line in f:
                line = line.strip()
                if line:
                    try:
                        results.append(json.loads(line))
                    except json.JSONDecodeError:
                        pass
    return results


def collect_instagram_domains() -> list[dict]:
    """Load Instagram-discovered domains from NDJSON file."""
    ndjson_path = DATA_DIR / "social_instagram" / "instagram_discovered.ndjson"
    results = []
    if ndjson_path.exists():
        with open(ndjson_path) as f:
            for line in f:
                line = line.strip()
                if line:
                    try:
                        results.append(json.loads(line))
                    except json.JSONDecodeError:
                        pass
    return results


def collect_pinterest_domains() -> list[dict]:
    """Load Pinterest-discovered domains from NDJSON file."""
    ndjson_path = DATA_DIR / "social_pinterest" / "pinterest_discovered.ndjson"
    results = []
    if ndjson_path.exists():
        with open(ndjson_path) as f:
            for line in f:
                line = line.strip()
                if line:
                    try:
                        results.append(json.loads(line))
                    except json.JSONDecodeError:
                        pass
    return results


# ─── Step 2: Domain validation (Shopify / WooCommerce detection) ──────────────

async def probe_shopify(
    session: aiohttp.ClientSession,
    domain: str,
    proxy: Optional[str] = None,
) -> tuple[bool, int]:
    """Check if domain is a Shopify store via /products.json."""
    url = f"https://{domain}/products.json"
    try:
        async with session.get(url, timeout=15, proxy=proxy) as resp:
            if resp.status == 200:
                try:
                    data = await resp.json()
                    if isinstance(data, dict) and "products" in data and isinstance(data["products"], list):
                        return True, len(data["products"])
                except Exception:
                    pass
            return False, 0
    except Exception:
        return False, 0


async def probe_woocommerce(
    session: aiohttp.ClientSession,
    domain: str,
    proxy: Optional[str] = None,
) -> tuple[bool, int]:
    """Check if domain is a WooCommerce store via /wp-json/wc/v3/products."""
    url = f"https://{domain}/wp-json/wc/v3/products"
    try:
        async with session.get(url, timeout=15, proxy=proxy) as resp:
            if resp.status == 200:
                try:
                    data = await resp.json()
                    if isinstance(data, list):
                        return True, len(data)
                except Exception:
                    pass
            elif resp.status == 401:
                # WooCommerce API exists but needs auth
                return True, 0
            return False, 0
    except Exception:
        return False, 0


async def probe_magento(
    session: aiohttp.ClientSession,
    domain: str,
    proxy: Optional[str] = None,
) -> bool:
    """Check if domain is a Magento store."""
    url = f"https://{domain}/rest/V1/store/storeConfigs"
    try:
        async with session.get(url, timeout=15, proxy=proxy) as resp:
            return resp.status in (200, 401)
    except Exception:
        return False


async def probe_bigcommerce(
    session: aiohttp.ClientSession,
    domain: str,
    proxy: Optional[str] = None,
) -> bool:
    """Check if domain is a BigCommerce store."""
    url = f"https://{domain}/api/storefront"
    try:
        async with session.get(url, timeout=15, proxy=proxy) as resp:
            return resp.status == 200
    except Exception:
        return False


async def validate_domain(
    session: aiohttp.ClientSession,
    sem: asyncio.Semaphore,
    domain_info: dict,
    proxy: Optional[str] = None,
) -> Optional[dict]:
    """Validate a single domain against known e-commerce platforms."""
    async with sem:
        domain = domain_info["domain"]

        # Try Shopify first (most common for DTC brands from social)
        is_shopify, product_count = await probe_shopify(session, domain, proxy)
        if is_shopify:
            domain_info["validated"] = True
            domain_info["platform"] = "shopify"
            domain_info["product_count"] = product_count
            return domain_info

        # Try WooCommerce
        is_wc, wc_count = await probe_woocommerce(session, domain, proxy)
        if is_wc:
            domain_info["validated"] = True
            domain_info["platform"] = "woocommerce"
            domain_info["product_count"] = wc_count
            return domain_info

        # Try BigCommerce
        is_bc = await probe_bigcommerce(session, domain, proxy)
        if is_bc:
            domain_info["validated"] = True
            domain_info["platform"] = "bigcommerce"
            domain_info["product_count"] = 0
            return domain_info

        # Try Magento
        is_mg = await probe_magento(session, domain, proxy)
        if is_mg:
            domain_info["validated"] = True
            domain_info["platform"] = "magento"
            domain_info["product_count"] = 0
            return domain_info

        domain_info["validated"] = False
        domain_info["platform"] = "unknown"
        domain_info["product_count"] = 0
        return domain_info


async def validate_all_domains(
    domains: list[dict],
    concurrency: int = 15,
    use_proxy: bool = True,
) -> list[dict]:
    """Validate all discovered domains against e-commerce platforms."""
    unique_domains: dict[str, dict] = {}

    # Deduplicate by domain, keeping first occurrence
    for d in domains:
        domain = d.get("domain", "").lower().strip()
        if domain and domain not in unique_domains:
            unique_domains[domain] = d

    domains_list = list(unique_domains.values())
    print(f"\nValidating {len(domains_list)} unique domains...")
    print(f"Concurrency: {concurrency}, Proxy: {use_proxy}")

    proxy = proxy_url(Zone.RESIDENTIAL_PROXY1) if use_proxy else None
    sem = asyncio.Semaphore(concurrency)

    connector = aiohttp.TCPConnector(limit=concurrency, limit_per_host=5)
    async with aiohttp.ClientSession(connector=connector) as session:
        tasks = [
            validate_domain(session, sem, domain, proxy)
            for domain in domains_list
        ]
        results = await asyncio.gather(*tasks)

    valid = [r for r in results if r and r.get("validated")]
    invalid = [r for r in results if r and not r.get("validated")]
    failed = [r for r in results if r is None]

    print(f"\nValidation complete:")
    print(f"  Total unique domains: {len(domains_list)}")
    print(f"  Validated (e-commerce): {len(valid)}")
    print(f"  Not e-commerce: {len(invalid)}")
    print(f"  Failed: {len(failed)}")

    if valid:
        platforms = {}
        for v in valid:
            p = v.get("platform", "unknown")
            platforms[p] = platforms.get(p, 0) + 1
        for p, count in sorted(platforms.items()):
            print(f"    {p}: {count}")

    return valid


# ─── Step 3: Generate merchant catalog entries ────────────────────────────────

def generate_merchant_entries(validated: list[dict]) -> list[dict]:
    """Convert validated domains to merchant catalog entries."""
    timestamp = time.strftime("%Y%m%d_%H%M%S")
    merchants = []

    for v in validated:
        domain = v["domain"]
        source = v.get("source", "social")
        slug = domain.replace(".", "").replace("-", "").replace("_", "")

        merchants.append({
            "domain": domain,
            "source": f"{source}_{slug}",
            "platform": v.get("platform", "unknown"),
            "country": v.get("country", "US"),
            "currency": v.get("currency", "USD"),
            "category": v.get("category", "social_commerce"),
            "product_count": v.get("product_count", 0),
            "source_attribution": f"social_{source}",
            "original_username": v.get("username", ""),
            "discovered_at": timestamp,
            "extraction_method": v.get("extraction_method", ""),
        })

    return merchants


def save_merchants(merchants: list[dict], filename: str) -> str:
    """Save merchant catalog to JSON file."""
    filepath = OUTPUT_DIR / filename
    with open(filepath, "w") as f:
        json.dump({
            "description": "Social commerce validated merchants — BUY-17969",
            "count": len(merchants),
            "merchants": merchants,
            "generated_at": time.strftime("%Y%m%d_%H%M%S"),
        }, f, indent=2)
    print(f"Saved {len(merchants)} merchants to {filepath}")
    return str(filepath)


def save_merchants_ndjson(merchants: list[dict], filename: str) -> str:
    """Save merchant catalog to NDJSON for ingestion pipeline."""
    filepath = OUTPUT_DIR / filename
    with open(filepath, "w", encoding="utf-8") as f:
        for m in merchants:
            f.write(json.dumps(m, ensure_ascii=False) + "\n")
    print(f"Saved {len(merchants)} merchants to {filepath}")
    return str(filepath)


# ─── Main pipeline ────────────────────────────────────────────────────────────

async def run_pipeline(
    platforms: list[str] | None = None,
    concurrency: int = 15,
    use_proxy: bool = True,
    run_scrapers: bool = False,
    output_prefix: str = "social_commerce",
):
    """Run the full social commerce pipeline."""
    print(f"{'='*60}")
    print(f"SOCIAL COMMERCE DISCOVERY PIPELINE — BUY-17969")
    print(f"{'='*60}")
    print(f"Platforms: {platforms or 'all'}")
    print(f"Proxy: {use_proxy}")
    print(f"Run scrapers: {run_scrapers}")
    print(f"{'='*60}")

    # Step 0: Run scrapers if requested
    if run_scrapers:
        print("\n\n### PHASE 0: RUNNING SOCIAL SCRAPERS ###\n")
        scraper_scripts = {
            "tiktok": "social_tiktok.py",
            "instagram": "social_instagram.py",
            "pinterest": "social_pinterest.py",
        }

        targets = platforms or list(scraper_scripts.keys())
        for platform in targets:
            script = scraper_scripts.get(platform)
            if not script:
                print(f"Unknown platform: {platform}, skipping")
                continue
            script_path = SCRIPT_DIR / script
            if not script_path.exists():
                print(f"Scraper script not found: {script_path}, skipping")
                continue

            print(f"\n--- Running {platform} scraper ---")
            cmd = f"python3 {script_path} --seeds"
            if not use_proxy:
                cmd += " --no-proxy"
            print(f"  $ {cmd}")
            exit_code = os.system(cmd)
            if exit_code != 0:
                print(f"  Warning: {platform} scraper exited with code {exit_code}")
            await asyncio.sleep(1)

    # Step 1: Collect all discovered domains
    print("\n\n### PHASE 1: COLLECTING DISCOVERED DOMAINS ###\n")
    all_domains: list[dict] = []

    if not platforms or "tiktok" in platforms:
        tiktok = collect_tiktok_domains()
        print(f"TikTok: {len(tiktok)} domains")
        all_domains.extend(tiktok)

    if not platforms or "instagram" in platforms:
        instagram = collect_instagram_domains()
        print(f"Instagram: {len(instagram)} domains")
        all_domains.extend(instagram)

    if not platforms or "pinterest" in platforms:
        pinterest = collect_pinterest_domains()
        print(f"Pinterest: {len(pinterest)} domains")
        all_domains.extend(pinterest)

    print(f"\nTotal domains collected: {len(all_domains)}")

    if not all_domains:
        print("No domains collected! Run scrapers first with --run-scrapers")
        return

    # Step 2: Validate domains
    print("\n\n### PHASE 2: VALIDATING DOMAINS ###\n")
    validated = await validate_all_domains(all_domains, concurrency, use_proxy)

    # Step 3: Save validated merchants
    print("\n\n### PHASE 3: SAVING VALIDATED MERCHANTS ###\n")

    if validated:
        merchants = generate_merchant_entries(validated)

        # Save as JSON for Shelf/discovery
        json_path = save_merchants(merchants, f"{output_prefix}_merchants.json")

        # Save as NDJSON for ingestion pipeline
        ndjson_path = save_merchants_ndjson(merchants, f"{output_prefix}_merchants.ndjson")

        # Save simple domain list
        domains_list_path = OUTPUT_DIR / f"{output_prefix}_domains.txt"
        unique_domains = sorted(set(m["domain"] for m in merchants))
        with open(domains_list_path, "w") as f:
            for d in unique_domains:
                f.write(f"{d}\n")
        print(f"Saved {len(unique_domains)} unique domains to {domains_list_path}")

        # Generate summary report
        report = {
            "pipeline": "social_commerce",
            "issue": "BUY-17969",
            "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "summary": {
                "total_discovered": len(all_domains),
                "total_validated": len(validated),
                "validation_rate": f"{len(validated)/len(all_domains)*100:.1f}%" if all_domains else "N/A",
            },
            "sources": {
                "tiktok": sum(1 for v in validated if v.get("source") == "tiktok"),
                "instagram": sum(1 for v in validated if v.get("source") == "instagram"),
                "pinterest": sum(1 for v in validated if v.get("source") == "pinterest"),
            },
            "platforms": {},
            "merchants": merchants,
        }

        for m in merchants:
            p = m["platform"]
            if p not in report["platforms"]:
                report["platforms"][p] = 0
            report["platforms"][p] += 1

        report_path = OUTPUT_DIR / f"{output_prefix}_report.json"
        with open(report_path, "w") as f:
            json.dump(report, f, indent=2)
        print(f"Saved report to {report_path}")

        # Final summary
        print(f"\n{'='*60}")
        print(f"PIPELINE COMPLETE")
        print(f"{'='*60}")
        print(f"Discovered domains:  {len(all_domains)}")
        print(f"Validated merchants: {len(validated)}")
        print(f"Validation rate:     {len(validated)/len(all_domains)*100:.1f}%" if all_domains else "N/A")
        for source, count in report["sources"].items():
            print(f"  {source}: {count}")
        for platform, count in report["platforms"].items():
            print(f"  Platform {platform}: {count}")
        print(f"{'='*60}")
    else:
        print("No validated merchants found!")


def main():
    parser = argparse.ArgumentParser(
        description="Social commerce domain discovery, validation, and ingestion pipeline (BUY-17969)"
    )
    parser.add_argument(
        "--platforms", nargs="*",
        choices=["tiktok", "instagram", "pinterest"],
        help="Platforms to process (default: all)"
    )
    parser.add_argument(
        "--run-scrapers", action="store_true",
        help="Run the scrapers before collecting domains"
    )
    parser.add_argument(
        "--no-proxy", action="store_true",
        help="Disable proxy for validation"
    )
    parser.add_argument(
        "--concurrency", type=int, default=15,
        help="Concurrent domain validations (default: 15)"
    )
    parser.add_argument(
        "--output-prefix", default="social_commerce",
        help="Prefix for output files"
    )
    args = parser.parse_args()

    asyncio.run(run_pipeline(
        platforms=args.platforms,
        concurrency=args.concurrency,
        use_proxy=not args.no_proxy,
        run_scrapers=args.run_scrapers,
        output_prefix=args.output_prefix,
    ))


if __name__ == "__main__":
    main()
