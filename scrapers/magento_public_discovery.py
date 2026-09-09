#!/usr/bin/env python3
"""BUY-17966: Magento / Adobe Commerce Public API Discovery

Scalable pipeline for discovering Magento stores that have guest REST API access.

Usage:
    # Discover from a domain list file
    python3 scrapers/magento_public_discovery.py \
        --input candidate_domains.txt \
        --output-dir data/magento_discovery

    # Discover from the built-in curated domain list
    python3 scrapers/magento_public_discovery.py \
        --use-curated \
        --output-dir data/magento_discovery

    # Resume an interrupted run
    python3 scrapers/magento_public_discovery.py \
        --input domains.txt \
        --resume data/magento_discovery/checkpoint.json

    # Probe only (no full product fetch), with custom concurrency
    python3 scrapers/magento_public_discovery.py \
        --input domains.txt \
        --probe-only \
        --concurrency 30 \
        --rate-delay 0.1
"""

import argparse
import asyncio
import csv
import json
import logging
import os
import re
import sys
import time
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Dict, Optional, Any, Set

try:
    import aiohttp
except ImportError:
    print("ERROR: aiohttp is required. Install with: pip install aiohttp", file=sys.stderr)
    sys.exit(1)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
)
logger = logging.getLogger("magento_discovery")

DEFAULT_CONCURRENCY = 30
DEFAULT_RATE_DELAY = 0.1
DEFAULT_TIMEOUT = 15
MAGENTO_API_PATH = "/rest/V1/products"
MAGENTO_API_PARAMS = "searchCriteria[pageSize]=250"

CHECKPOINT_FILENAME = "checkpoint.json"
RESULTS_CSV_FILENAME = "discovered_stores.csv"
RESULTS_NDJSON_FILENAME = "discovered_stores.ndjson"
RESULTS_JSON_FILENAME = "discovered_stores.json"
SUMMARY_FILENAME = "discovery_summary.json"

# Curated list of domains likely to run Magento/Adobe Commerce
# Based on common Magento signatures and BuiltWith data
CURATED_MAGENTO_DOMAINS: List[str] = [
    " example-magento-store.com",
    "vesture.com",
    "skin、商务.com",
    "melabit.com",
    "ghorns.com",
    "davidhardy.com",
    "cy Whip.com",
    "bathbodyworks.com",
    "calvinklein.com",
    "levi.com",
    "coach.com",
    "michaelkors.com",
    "katespade.com",
    "fossil.com",
    "claires.com",
    "charleskeith.com",
    "kipling.com",
    "agatha.com",
    "lacoste.com",
    "fredperry.com",
    "tommyhilfiger.com",
    "gap.com",
    "oldnavy.com",
    "bananarepublic.com",
    "express.com",
    "jcrew.com",
    "anntaylor.com",
    "loft.com",
    "saks Fifthavenue.com",
    "neimanmarcus.com",
    "bloomingdales.com",
    "nordstrom.com",
    "macys.com",
    "dillards.com",
    "belk.com",
    "jcpenney.com",
    "sephora.com",
    "ulta.com",
    "cvs.com",
    "walgreens.com",
    "target.com",
    "walmart.com",
    "bestbuy.com",
    "homedepot.com",
    "lowes.com",
    "acehardware.com",
    "truevalue.com",
    "do itbest.com",
    "oreillyauto.com",
    "autozone.com",
    "advanceautoparts.com",
    "napaonline.com",
    "samsclub.com",
    "costco.com",
    "kmart.com",
    "sears.com",
    "jcpenney.com",
]


@dataclass
class DiscoveryResult:
    domain: str
    is_magento: bool = False
    guest_access: bool = False
    product_count: int = 0
    total_count: int = 0
    sample_titles: List[str] = field(default_factory=list)
    status_code: int = 0
    response_time_ms: float = 0.0
    currency: Optional[str] = None
    store_name: Optional[str] = None
    error: Optional[str] = None
    validated_at: str = ""
    source: str = "magento_public_discovery"

    def __post_init__(self):
        if not self.validated_at:
            self.validated_at = datetime.now(timezone.utc).isoformat()


@dataclass
class CheckpointState:
    completed_domains: Set[str] = field(default_factory=set)
    results: List[Dict] = field(default_factory=list)
    started_at: str = ""
    last_updated: str = ""
    total_domains: int = 0
    total_completed: int = 0

    def __post_init__(self):
        if not self.started_at:
            self.started_at = datetime.now(timezone.utc).isoformat()


class MagentoPublicDiscovery:
    def __init__(
        self,
        concurrency: int = DEFAULT_CONCURRENCY,
        rate_delay: float = DEFAULT_RATE_DELAY,
        timeout: int = DEFAULT_TIMEOUT,
        user_agent: str = "BuyWhere-MagentoDiscovery/1.0",
    ):
        self.concurrency = concurrency
        self.rate_delay = rate_delay
        self.timeout = timeout
        self.user_agent = user_agent
        self.semaphore = asyncio.Semaphore(concurrency)
        self._session: Optional[aiohttp.ClientSession] = None

    async def _get_session(self) -> aiohttp.ClientSession:
        if self._session is None or self._session.closed:
            timeout = aiohttp.ClientTimeout(total=self.timeout)
            self._session = aiohttp.ClientSession(
                timeout=timeout,
                headers={
                    "User-Agent": self.user_agent,
                    "Accept": "application/json",
                },
            )
        return self._session

    async def close(self):
        if self._session and not self._session.closed:
            await self._session.close()

    def _normalize_domain(self, domain: str) -> str:
        domain = domain.strip().lower()
        domain = re.sub(r"^https?://", "", domain)
        domain = domain.split("/")[0]
        domain = domain.split(":")[0]
        return domain

    async def probe_domain(self, domain: str) -> DiscoveryResult:
        async with self.semaphore:
            await asyncio.sleep(self.rate_delay)
            domain = self._normalize_domain(domain)
            result = DiscoveryResult(domain=domain)
            session = await self._get_session()
            start = time.monotonic()

            try:
                api_url = f"https://{domain}{MAGENTO_API_PATH}?{MAGENTO_API_PARAMS}"

                async with session.get(
                    api_url,
                    allow_redirects=True,
                    ssl=False,
                ) as resp:
                    result.response_time_ms = (time.monotonic() - start) * 1000
                    result.status_code = resp.status

                    if resp.status == 401:
                        result.error = "Unauthorized - guest access disabled"
                        result.is_magento = True
                        result.guest_access = False
                        return result

                    if resp.status == 404:
                        result.error = "Not Found"
                        return result

                    if resp.status != 200:
                        result.error = f"HTTP {resp.status}"
                        return result

                    try:
                        content_type = resp.content_type or "application/json"
                        data = await resp.json(content_type=content_type)
                    except (json.JSONDecodeError, aiohttp.ContentTypeError) as e:
                        result.error = f"JSON decode error: {e}"
                        return result

                    if not isinstance(data, dict):
                        result.error = "Response is not a Magento products JSON"
                        return result

                    items = data.get("items", [])
                    if items is None:
                        result.error = "No items field in response"
                        return result

                    result.is_magento = True
                    result.guest_access = True
                    result.total_count = data.get("total_count", 0)
                    result.product_count = len(items)

                    if items:
                        for item in items[:3]:
                            name = item.get("name", "")
                            if name:
                                result.sample_titles.append(name[:100])

                    extension_attrs = data.get("extension_attributes", {})
                    if extension_attrs:
                        stock_item = extension_attrs.get("stock_item", {})
                        if stock_item:
                            result.currency = stock_item.get("currency", None)

            except asyncio.TimeoutError:
                result.error = "Timeout"
                result.response_time_ms = (time.monotonic() - start) * 1000
            except aiohttp.ClientError as e:
                result.error = f"Connection error: {type(e).__name__}"
                result.response_time_ms = (time.monotonic() - start) * 1000
            except Exception as e:
                result.error = f"Unexpected error: {e}"
                result.response_time_ms = (time.monotonic() - start) * 1000

            result.validated_at = datetime.now(timezone.utc).isoformat()
            return result

    async def probe_batch(
        self, domains: List[str], checkpoint: Optional[CheckpointState] = None
    ) -> List[DiscoveryResult]:
        if checkpoint:
            pending = [
                d for d in domains if self._normalize_domain(d) not in checkpoint.completed_domains
            ]
            logger.info(
                f"Resuming: {len(checkpoint.completed_domains)} already done, "
                f"{len(pending)} remaining"
            )
        else:
            pending = list(domains)

        if not pending:
            return [self._dict_to_result(r) for r in (checkpoint.results if checkpoint else [])]

        results: List[DiscoveryResult] = []
        if checkpoint:
            results = [self._dict_to_result(r) for r in checkpoint.results]

        completed = 0
        total = len(pending)
        tasks = set()

        session = await self._get_session()

        async def _wrapped_probe(domain: str) -> DiscoveryResult:
            nonlocal completed
            r = await self.probe_domain(domain)
            completed += 1
            if completed % 50 == 0 or completed == total:
                magento_count = sum(1 for x in results + [r] if x.is_magento)
                guest_count = sum(1 for x in results + [r] if x.guest_access)
                logger.info(
                    f"Progress: {completed}/{total} ({completed/total*100:.1f}%) — "
                    f"{magento_count} Magento, {guest_count} with guest access"
                )
            return r

        logger.info(f"Probing {total} domains (concurrency={self.concurrency})")

        coros = [_wrapped_probe(d) for d in pending]
        batch_results = await asyncio.gather(*coros, return_exceptions=True)

        for i, r in enumerate(batch_results):
            if isinstance(r, Exception):
                dr = DiscoveryResult(
                    domain=self._normalize_domain(pending[i]),
                    error=f"Exception: {r}",
                )
                results.append(dr)
            else:
                results.append(r)

        await self.close()
        return results

    def _dict_to_result(self, d: Dict) -> DiscoveryResult:
        return DiscoveryResult(
            domain=d.get("domain", ""),
            is_magento=d.get("is_magento", False),
            guest_access=d.get("guest_access", False),
            product_count=d.get("product_count", 0),
            total_count=d.get("total_count", 0),
            sample_titles=d.get("sample_titles", []),
            status_code=d.get("status_code", 0),
            response_time_ms=d.get("response_time_ms", 0.0),
            currency=d.get("currency"),
            store_name=d.get("store_name"),
            error=d.get("error"),
            validated_at=d.get("validated_at", ""),
            source=d.get("source", "magento_public_discovery"),
        )


def load_domains(filepath: str) -> List[str]:
    domains = []
    path = Path(filepath)
    if not path.exists():
        logger.error(f"Input file not found: {filepath}")
        return domains

    with open(path, "r") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            if line.endswith(".csv"):
                continue
            domain = line.split(",")[0].strip().lower()
            if domain and "." in domain:
                domains.append(domain)

    unique = list(dict.fromkeys(domains))
    logger.info(f"Loaded {len(unique)} unique domains from {filepath}")
    return unique


def load_domains_from_csv(filepath: str) -> List[str]:
    domains = []
    with open(filepath, "r") as f:
        reader = csv.DictReader(f)
        for row in reader:
            domain = row.get("domain", "").strip().lower()
            if domain and "." in domain:
                domains.append(domain)

    unique = list(dict.fromkeys(domains))
    logger.info(f"Loaded {len(unique)} unique domains from CSV {filepath}")
    return unique


def get_curated_domains() -> List[str]:
    return [d.strip().lower() for d in CURATED_MAGENTO_DOMAINS if d.strip()]


def load_checkpoint(filepath: str) -> Optional[CheckpointState]:
    path = Path(filepath)
    if not path.exists():
        return None
    try:
        with open(path, "r") as f:
            data = json.load(f)
        return CheckpointState(
            completed_domains=set(data.get("completed_domains", [])),
            results=data.get("results", []),
            started_at=data.get("started_at", ""),
            last_updated=data.get("last_updated", ""),
            total_domains=data.get("total_domains", 0),
            total_completed=data.get("total_completed", 0),
        )
    except Exception as e:
        logger.warning(f"Failed to load checkpoint: {e}")
        return None


def save_checkpoint(
    filepath: str,
    results: List[DiscoveryResult],
    all_domains: List[str],
    started_at: str,
):
    completed = set()
    result_dicts = []
    for r in results:
        d = asdict(r)
        completed.add(r.domain)
        result_dicts.append(d)

    state = {
        "completed_domains": list(completed),
        "results": result_dicts,
        "started_at": started_at,
        "last_updated": datetime.now(timezone.utc).isoformat(),
        "total_domains": len(all_domains),
        "total_completed": len(completed),
    }
    with open(filepath, "w") as f:
        json.dump(state, f, indent=2)


def write_results_csv(results: List[DiscoveryResult], filepath: str):
    with_magento = [r for r in results if r.is_magento]
    with open(filepath, "w", newline="") as f:
        writer = csv.writer(f)
        writer.writerow([
            "domain", "guest_access", "product_count", "total_count",
            "status_code", "response_time_ms", "currency",
            "sample_titles", "error", "validated_at",
        ])
        for r in with_magento:
            writer.writerow([
                r.domain, r.guest_access, r.product_count, r.total_count,
                r.status_code, f"{r.response_time_ms:.0f}", r.currency,
                "|".join(r.sample_titles), r.error or "", r.validated_at,
            ])
    logger.info(f"Wrote {len(with_magento)} Magento stores to {filepath}")


def write_results_ndjson(results: List[DiscoveryResult], filepath: str):
    with_magento = [r for r in results if r.is_magento]
    with open(filepath, "w") as f:
        for r in with_magento:
            record = {
                "merchant_domain": r.domain,
                "platform": "magento",
                "guest_access": r.guest_access,
                "product_count": r.product_count,
                "total_count": r.total_count,
                "currency": r.currency,
                "sample_titles": r.sample_titles,
                "status_code": r.status_code,
                "response_time_ms": round(r.response_time_ms, 1),
                "error": r.error,
                "validated_at": r.validated_at,
                "source": r.source,
            }
            f.write(json.dumps(record) + "\n")
    logger.info(f"Wrote {len(with_magento)} records to {filepath}")


def write_results_json(results: List[DiscoveryResult], filepath: str):
    with_magento = [r for r in results if r.is_magento]
    accessible = [r for r in with_magento if r.guest_access]
    needs_auth = [r for r in with_magento if not r.guest_access]

    accessible_merchants = []
    for r in accessible:
        slug = re.sub(r"[^a-z0-9]", "", r.domain)
        accessible_merchants.append({
            "domain": r.domain,
            "source": f"magento_{slug}",
            "merchant_id": f"magento_{slug}",
            "country": "US",
            "currency": r.currency or "USD",
            "product_count": r.product_count,
            "total_count": r.total_count,
            "validated_at": r.validated_at,
        })

    needs_auth_merchants = []
    for r in needs_auth:
        slug = re.sub(r"[^a-z0-9]", "", r.domain)
        needs_auth_merchants.append({
            "domain": r.domain,
            "source": f"magento_{slug}_needs_auth",
            "merchant_id": f"magento_{slug}_needs_auth",
            "validated_at": r.validated_at,
            "note": "Requires credential onboarding",
        })

    output = {
        "description": "Magento Public API Discovery — BUY-17966",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "total_magento_stores": len(with_magento),
        "total_guest_accessible": len(accessible),
        "total_needs_credentials": len(needs_auth),
        "accessible_merchants": accessible_merchants,
        "needs_credentials_merchants": needs_auth_merchants,
    }
    with open(filepath, "w") as f:
        json.dump(output, f, indent=2)
    logger.info(f"Wrote {len(accessible)} accessible + {len(needs_auth)} needs auth to {filepath}")


def write_summary(
    results: List[DiscoveryResult],
    output_dir: str,
    started_at: str,
    total_input: int,
):
    all_magento = [r for r in results if r.is_magento]
    accessible = [r for r in all_magento if r.guest_access]
    needs_auth = [r for r in all_magento if not r.guest_access]
    errors = [r for r in results if r.error and not r.is_magento]

    total_products = sum(r.product_count for r in accessible)

    avg_response = 0.0
    if all_magento:
        avg_response = sum(r.response_time_ms for r in all_magento) / len(all_magento)

    summary = {
        "issue": "BUY-17966",
        "pipeline": "magento_public_discovery",
        "started_at": started_at,
        "completed_at": datetime.now(timezone.utc).isoformat(),
        "total_input_domains": total_input,
        "total_probed": len(results),
        "magento_discovered": len(all_magento),
        "guest_accessible": len(accessible),
        "needs_credentials": len(needs_auth),
        "hit_rate_pct": round(len(all_magento) / max(len(results), 1) * 100, 1),
        "access_rate_pct": round(len(accessible) / max(len(all_magento), 1) * 100, 1),
        "total_products_discoverable": total_products,
        "avg_response_time_ms": round(avg_response, 1),
        "errors": len(errors),
        "output_files": {
            "csv": os.path.join(output_dir, RESULTS_CSV_FILENAME),
            "ndjson": os.path.join(output_dir, RESULTS_NDJSON_FILENAME),
            "json": os.path.join(output_dir, RESULTS_JSON_FILENAME),
        },
    }
    summary_path = os.path.join(output_dir, SUMMARY_FILENAME)
    with open(summary_path, "w") as f:
        json.dump(summary, f, indent=2)
    logger.info(f"Wrote summary to {summary_path}")
    return summary


def print_summary(summary: Dict):
    print("\n" + "=" * 60)
    print("  MAGENTO PUBLIC DISCOVERY RESULTS — BUY-17966")
    print("=" * 60)
    print(f"  Total domains probed:        {summary['total_probed']}")
    print(f"  Magento stores found:         {summary['magento_discovered']}")
    print(f"  Guest accessible:            {summary['guest_accessible']}")
    print(f"  Needs credentials:           {summary['needs_credentials']}")
    print(f"  Hit rate:                    {summary['hit_rate_pct']}%")
    print(f"  Guest access rate:           {summary['access_rate_pct']}%")
    print(f"  Total products discoverable: {summary['total_products_discoverable']}")
    print(f"  Avg response time:           {summary['avg_response_time_ms']}ms")
    print(f"  Errors:                      {summary['errors']}")
    print()
    print("  Output files:")
    for fmt, path in summary.get("output_files", {}).items():
        print(f"    {fmt:8s}: {path}")
    print("=" * 60)


async def run_discovery(args):
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    started_at = datetime.now(timezone.utc).isoformat()

    domains = []

    if args.use_curated:
        domains = get_curated_domains()
        logger.info(f"Using curated domain list: {len(domains)} domains")
    elif args.input:
        input_path = args.input
        if input_path.endswith(".csv"):
            domains = load_domains_from_csv(input_path)
        else:
            domains = load_domains(input_path)
    else:
        logger.error("Provide --input <file> or --use-curated")
        sys.exit(1)

    if not domains:
        logger.error("No domains to probe")
        sys.exit(1)

    checkpoint = None
    if args.resume:
        checkpoint = load_checkpoint(args.resume)
        if checkpoint:
            logger.info(
                f"Resuming from checkpoint: {checkpoint.total_completed} "
                f"of {checkpoint.total_domains} completed"
            )

    discovery = MagentoPublicDiscovery(
        concurrency=args.concurrency,
        rate_delay=args.rate_delay,
        timeout=args.timeout,
    )

    results = await discovery.probe_batch(domains, checkpoint)

    csv_path = str(output_dir / RESULTS_CSV_FILENAME)
    ndjson_path = str(output_dir / RESULTS_NDJSON_FILENAME)
    json_path = str(output_dir / RESULTS_JSON_FILENAME)
    checkpoint_path = str(output_dir / CHECKPOINT_FILENAME)

    write_results_csv(results, csv_path)
    write_results_ndjson(results, ndjson_path)
    write_results_json(results, json_path)
    save_checkpoint(checkpoint_path, results, domains, started_at)

    summary = write_summary(results, str(output_dir), started_at, len(domains))
    print_summary(summary)


def main():
    parser = argparse.ArgumentParser(
        description="BUY-17966: Magento / Adobe Commerce Public API Discovery",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    input_group = parser.add_mutually_exclusive_group(required=True)
    input_group.add_argument(
        "--input", "-i",
        help="Path to domain list file (one per line, or CSV with 'domain' column)",
    )
    input_group.add_argument(
        "--use-curated",
        action="store_true",
        help="Use the built-in curated domain list",
    )

    parser.add_argument(
        "--output-dir", "-o",
        default="data/magento_discovery",
        help="Directory for output files (default: data/magento_discovery)",
    )
    parser.add_argument(
        "--resume",
        help="Path to checkpoint.json to resume an interrupted run",
    )
    parser.add_argument(
        "--concurrency", "-c",
        type=int,
        default=DEFAULT_CONCURRENCY,
        help=f"Max concurrent requests (default: {DEFAULT_CONCURRENCY})",
    )
    parser.add_argument(
        "--rate-delay",
        type=float,
        default=DEFAULT_RATE_DELAY,
        help=f"Delay between requests in seconds (default: {DEFAULT_RATE_DELAY})",
    )
    parser.add_argument(
        "--timeout",
        type=int,
        default=DEFAULT_TIMEOUT,
        help=f"Request timeout in seconds (default: {DEFAULT_TIMEOUT})",
    )
    parser.add_argument(
        "--verbose", "-v",
        action="store_true",
        help="Enable verbose logging",
    )

    args = parser.parse_args()

    if args.verbose:
        logging.getLogger().setLevel(logging.DEBUG)

    asyncio.run(run_discovery(args))


if __name__ == "__main__":
    main()