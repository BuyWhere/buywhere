#!/usr/bin/env python3
"""BUY-17962: Shopify Public Feed Discovery

Scalable pipeline for discovering Shopify stores via their public
products.json endpoint, validating feeds, collecting metadata, and
producing Shelf-ready output for BuyWhere ingestion.

Usage examples:
    # Discover from a domain list file
    python3 scrapers/shopify_feed_discovery.py \
        --input candidate_domains.txt \
        --output-dir data/shopify_discovery

    # Discover from the built-in curated brand list
    python3 scrapers/shopify_feed_discovery.py \
        --use-curated \
        --output-dir data/shopify_discovery

    # Resume an interrupted run
    python3 scrapers/shopify_feed_discovery.py \
        --input big_list.txt \
        --resume data/shopify_discovery/checkpoint.json

    # Probe only (no full product fetch), with custom concurrency
    python3 scrapers/shopify_feed_discovery.py \
        --input domains.txt \
        --probe-only \
        --concurrency 50 \
        --rate-delay 0.05

    # Fetch sample products from discovered stores
    python3 scrapers/shopify_feed_discovery.py \
        --input discovered_stores.csv \
        --fetch-samples \
        --sample-count 5
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
import urllib.parse
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Dict, Optional, Tuple, Any, Set

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
logger = logging.getLogger("shopify_feed_discovery")

DEFAULT_CONCURRENCY = 40
DEFAULT_RATE_DELAY = 0.08
DEFAULT_TIMEOUT = 12
DEFAULT_SAMPLE_COUNT = 3
SHOPIFY_PRODUCTS_PATH = "/products.json"
SHOPIFY_PRODUCTS_LIMIT = 250
SHOPIFY_ATOM_PATH = "/collections/all.atom"
CHECKPOINT_FILENAME = "checkpoint.json"
RESULTS_CSV_FILENAME = "discovered_stores.csv"
RESULTS_NDJSON_FILENAME = "discovered_stores.ndjson"
RESULTS_JSON_FILENAME = "discovered_stores.json"
SUMMARY_FILENAME = "discovery_summary.json"


@dataclass
class DiscoveryResult:
    domain: str
    is_shopify: bool = False
    product_count: int = 0
    sample_title: Optional[str] = None
    feed_url: Optional[str] = None
    atom_feed_url: Optional[str] = None
    has_atom_feed: bool = False
    status_code: int = 0
    response_time_ms: float = 0.0
    currency: Optional[str] = None
    sample_handle: Optional[str] = None
    sample_price: Optional[float] = None
    vendor: Optional[str] = None
    product_type: Optional[str] = None
    tags: List[str] = field(default_factory=list)
    error: Optional[str] = None
    validated_at: str = ""
    source: str = "shopify_feed_discovery"

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


CURATED_BRANDS: Dict[str, List[str]] = {
    "apparel": [
        "allbirds.com", "rothys.com", "everlane.com", "bonobos.com",
        "untuckit.com", "mizzenandmain.com", "bombas.com", "meundies.com",
        "cutsclothing.com", "byltbasics.com", "vuoriclothing.com", "rhone.com",
        "bornprimitive.com", "gymshark.com", "aloyoga.com", "beyondyoga.com",
        "outdoorvoices.com", "fabletics.com", "skims.com", "goodamerican.com",
        "spanx.com", "reformation.com", "sezane.com", "kotn.com",
        "tentree.com", "outerknown.com", "pactorganic.com", "summersalt.com",
        "kith.com", "aimeleondore.com", "publicrec.com", "birddogs.com",
        "chubbies.com", "bearbottom.com", "buckmason.com", "taylorstitch.com",
        "trueclassictees.com", "freshcleantees.com", "glossier.com",
        "fashionnova.com", "revolve.com", "nastygal.com", "princesspolly.com",
        "whitefoxboutique.com", "lulus.com", "freepeople.com",
        "sweatybetty.com", "carbon38.com", "setactive.co", "talaactive.com",
    ],
    "beauty": [
        "glossier.com", "rarebeauty.com", "fentybeauty.com",
        "charlottetilbury.com", "dermalogica.com", "theordinary.com",
        "paulaschoice.com", "drunkenskincare.com", "biossance.com",
        "youthtothepeople.com", "glowrecipe.com", "supergoop.com",
        "soldejaneiro.com", "farmacybeauty.com", "herbivorebotanicals.com",
        "olaplex.com", "k18hair.com", "daehair.com", "crownaffair.com",
        "functionofbeauty.com", "ritual.com", "nativecos.com",
        "summerfridays.com", "kosas.com", "meritbeauty.com", "saiehello.com",
        "tower28beauty.com", "westmanatelier.com",
    ],
    "home": [
        "brooklinen.com", "parachutehome.com", "bollandbranch.com",
        "coyuchi.com", "ourplace.com", "madeincookware.com",
        "carawayhome.com", "greatjonesgoods.com", "misen.com",
        "yeti.com", "hydroflask.com", "ruggable.com",
    ],
    "food_beverage": [
        "deathwishcoffee.com", "foursigmatic.com", "artoftea.com",
        "primalkitchen.com", "liquid-iv.com", "tasteofnature.com",
        "truff.com", "dollarshaveclub.com", "magicspoon.com",
        "eatbobos.com", "hukitchen.com", "drinkpoppi.com",
        "drinkolipop.com", "bluebottlecoffee.com",
    ],
    "fitness": [
        "manduka.com", "onepeloton.com", "roguefitness.com",
        "theragun.com", "gnc.com", "onnit.com", "ghostlifestyle.com",
        "bodybuilding.com",
    ],
    "pets": [
        "wildone.com", "barkbox.com", "farmersdog.com", "ollie.com",
        "chewy.com",
    ],
    "jewelry_accessories": [
        "mejuri.com", "auratenewyork.com", "vrai.com",
        "brilliantearth.com", "catbirdnyc.com", "warbyparker.com",
        "awaytravel.com", "monos.com", "herschel.com",
    ],
    "outdoor": [
        "cotopaxi.com", "patagonia.com", "thenorthface.com",
        "arcteryx.com", "columbia.com", "eddiebauer.com",
    ],
}


class ShopifyFeedDiscovery:
    def __init__(
        self,
        concurrency: int = DEFAULT_CONCURRENCY,
        rate_delay: float = DEFAULT_RATE_DELAY,
        timeout: int = DEFAULT_TIMEOUT,
        user_agent: str = "BuyWhere-FeedDiscovery/1.0",
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
                feed_url = f"https://{domain}{SHOPIFY_PRODUCTS_PATH}"
                result.feed_url = feed_url

                async with session.get(
                    feed_url,
                    params={"limit": str(SHOPIFY_PRODUCTS_LIMIT)},
                    allow_redirects=True,
                    ssl=False,
                ) as resp:
                    result.response_time_ms = (time.monotonic() - start) * 1000
                    result.status_code = resp.status

                    if resp.status != 200:
                        result.error = f"HTTP {resp.status}"
                        return result

                    try:
                        data = await resp.json(
                            content_type=resp.content_type or "application/json"
                        )
                    except (json.JSONDecodeError, aiohttp.ContentTypeError) as e:
                        result.error = f"JSON decode error: {e}"
                        return result

                if not isinstance(data, dict) or "products" not in data:
                    result.error = "Response is not a Shopify products JSON"
                    return result

                products = data.get("products", [])
                if not isinstance(products, list):
                    result.error = "products field is not a list"
                    return result

                result.is_shopify = True
                result.product_count = len(products)

                if products:
                    sample = products[0]
                    result.sample_title = (sample.get("title") or "")[:200]
                    result.sample_handle = sample.get("handle")
                    result.vendor = sample.get("vendor")
                    result.product_type = sample.get("product_type") or None

                    variants = sample.get("variants", [])
                    if variants and isinstance(variants, list):
                        v = variants[0]
                        price_str = v.get("price", "0")
                        try:
                            result.sample_price = float(price_str)
                        except (ValueError, TypeError):
                            pass

                    tags = sample.get("tags", [])
                    if isinstance(tags, list):
                        result.tags = tags[:20]
                    elif isinstance(tags, str):
                        result.tags = [
                            t.strip() for t in tags.split(",") if t.strip()
                        ][:20]

                atom_url = f"https://{domain}{SHOPIFY_ATOM_PATH}"
                result.atom_feed_url = atom_url
                try:
                    async with session.get(
                        atom_url, allow_redirects=True, ssl=False
                    ) as atom_resp:
                        if atom_resp.status == 200:
                            result.has_atom_feed = True
                except Exception:
                    pass

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
                shopify_count = sum(
                    1 for x in results + [] if x.is_shopify
                )
                logger.info(
                    f"Progress: {completed}/{total} ({completed/total*100:.1f}%) — "
                    f"{shopify_count} Shopify stores found"
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

    async def fetch_sample_products(
        self,
        domain: str,
        count: int = DEFAULT_SAMPLE_COUNT,
    ) -> List[Dict[str, Any]]:
        session = await self._get_session()
        products = []
        page = 1

        while len(products) < count:
            url = f"https://{domain}{SHOPIFY_PRODUCTS_PATH}"
            async with session.get(
                url,
                params={"limit": str(count), "page": str(page)},
                allow_redirects=True,
                ssl=False,
            ) as resp:
                if resp.status != 200:
                    break
                data = await resp.json(
                    content_type=resp.content_type or "application/json"
                )
                page_products = data.get("products", [])
                if not page_products:
                    break
                products.extend(page_products)
                if len(page_products) < count:
                    break
                page += 1

        return products[:count]

    def _dict_to_result(self, d: Dict) -> DiscoveryResult:
        tags = d.get("tags", [])
        if isinstance(tags, str):
            tags = [t.strip() for t in tags.split(",") if t.strip()]
        return DiscoveryResult(
            domain=d.get("domain", ""),
            is_shopify=d.get("is_shopify", False),
            product_count=d.get("product_count", 0),
            sample_title=d.get("sample_title"),
            feed_url=d.get("feed_url"),
            atom_feed_url=d.get("atom_feed_url"),
            has_atom_feed=d.get("has_atom_feed", False),
            status_code=d.get("status_code", 0),
            response_time_ms=d.get("response_time_ms", 0.0),
            currency=d.get("currency"),
            sample_handle=d.get("sample_handle"),
            sample_price=d.get("sample_price"),
            vendor=d.get("vendor"),
            product_type=d.get("product_type"),
            tags=tags if isinstance(tags, list) else [],
            error=d.get("error"),
            validated_at=d.get("validated_at", ""),
            source=d.get("source", "shopify_feed_discovery"),
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


def get_curated_domains() -> List[Tuple[str, str]]:
    domains = []
    seen = set()
    for category, brands in CURATED_BRANDS.items():
        for brand in brands:
            b = brand.strip().lower().replace(" ", "")
            if b not in seen and "." in b:
                seen.add(b)
                domains.append((b, category))
    return domains


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
    shopify_results = [r for r in results if r.is_shopify]
    with open(filepath, "w", newline="") as f:
        writer = csv.writer(f)
        writer.writerow([
            "domain", "platform", "product_count", "title",
            "feed_url", "atom_feed_url", "has_atom_feed", "status_code",
            "response_time_ms", "vendor", "product_type", "sample_price",
            "tags", "validated_at",
        ])
        for r in shopify_results:
            writer.writerow([
                r.domain, "shopify", r.product_count, r.sample_title,
                r.feed_url, r.atom_feed_url, r.has_atom_feed, r.status_code,
                f"{r.response_time_ms:.0f}", r.vendor, r.product_type,
                r.sample_price, ";".join(r.tags), r.validated_at,
            ])
    logger.info(f"Wrote {len(shopify_results)} Shopify stores to {filepath}")


def write_results_ndjson(results: List[DiscoveryResult], filepath: str):
    shopify_results = [r for r in results if r.is_shopify]
    with open(filepath, "w") as f:
        for r in shopify_results:
            record = {
                "merchant_domain": r.domain,
                "platform": "shopify",
                "product_count": r.product_count,
                "title": r.sample_title,
                "feed_url": r.feed_url,
                "atom_feed_url": r.atom_feed_url,
                "has_atom_feed": r.has_atom_feed,
                "vendor": r.vendor,
                "product_type": r.product_type,
                "sample_price": r.sample_price,
                "tags": r.tags,
                "status_code": r.status_code,
                "response_time_ms": round(r.response_time_ms, 1),
                "validated_at": r.validated_at,
                "source": r.source,
            }
            f.write(json.dumps(record) + "\n")
    logger.info(f"Wrote {len(shopify_results)} records to {filepath}")


def write_results_json(results: List[DiscoveryResult], filepath: str):
    shopify_results = [r for r in results if r.is_shopify]
    merchants = []
    for r in shopify_results:
        slug = re.sub(r"[^a-z0-9]", "", r.domain)
        merchants.append({
            "domain": r.domain,
            "source": f"shopify_{slug}",
            "merchant_id": f"shopify_{slug}",
            "country": "US",
            "currency": "USD",
            "product_count": r.product_count,
            "feed_url": r.feed_url,
            "atom_feed_url": r.atom_feed_url,
            "has_atom_feed": r.has_atom_feed,
            "vendor": r.vendor,
            "product_type": r.product_type,
            "tags": r.tags,
            "validated_at": r.validated_at,
        })
    output = {
        "description": "Shopify Public Feed Discovery — BUY-17962",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "total_merchants": len(merchants),
        "merchants": merchants,
    }
    with open(filepath, "w") as f:
        json.dump(output, f, indent=2)
    logger.info(f"Wrote {len(merchants)} merchants to {filepath}")


def write_summary(
    results: List[DiscoveryResult],
    output_dir: str,
    started_at: str,
    total_input: int,
):
    shopify_found = [r for r in results if r.is_shopify]
    errors = [r for r in results if r.error and not r.is_shopify]
    total_products = sum(r.product_count for r in shopify_found)
    atom_feeds = sum(1 for r in shopify_found if r.has_atom_feed)

    vendors = {}
    for r in shopify_found:
        if r.vendor:
            vendors[r.vendor] = vendors.get(r.vendor, 0) + 1

    product_types = {}
    for r in shopify_found:
        if r.product_type:
            product_types[r.product_type] = product_types.get(r.product_type, 0) + 1

    avg_response = 0.0
    if shopify_found:
        avg_response = sum(r.response_time_ms for r in shopify_found) / len(shopify_found)

    summary = {
        "issue": "BUY-17962",
        "pipeline": "shopify_feed_discovery",
        "started_at": started_at,
        "completed_at": datetime.now(timezone.utc).isoformat(),
        "total_input_domains": total_input,
        "total_probed": len(results),
        "shopify_discovered": len(shopify_found),
        "hit_rate_pct": round(len(shopify_found) / max(len(results), 1) * 100, 1),
        "total_products_found": total_products,
        "stores_with_atom_feed": atom_feeds,
        "avg_response_time_ms": round(avg_response, 1),
        "errors": len(errors),
        "top_vendors": dict(sorted(vendors.items(), key=lambda x: -x[1])[:20]),
        "top_product_types": dict(sorted(product_types.items(), key=lambda x: -x[1])[:20]),
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
    print("  SHOPIFY FEED DISCOVERY RESULTS — BUY-17962")
    print("=" * 60)
    print(f"  Total domains probed:     {summary['total_probed']}")
    print(f"  Shopify stores found:     {summary['shopify_discovered']}")
    print(f"  Hit rate:                 {summary['hit_rate_pct']}%")
    print(f"  Total products discovered:{summary['total_products_found']}")
    print(f"  Stores with Atom feed:    {summary['stores_with_atom_feed']}")
    print(f"  Avg response time:        {summary['avg_response_time_ms']}ms")
    print(f"  Errors:                   {summary['errors']}")
    print()
    print("  Output files:")
    for fmt, path in summary.get("output_files", {}).items():
        print(f"    {fmt:8s}: {path}")
    if summary.get("top_vendors"):
        print("\n  Top vendors:")
        for vendor, count in list(summary["top_vendors"].items())[:10]:
            print(f"    {vendor:30s} {count:>3} stores")
    print("=" * 60)


async def run_discovery(args):
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    started_at = datetime.now(timezone.utc).isoformat()

    domains = []
    domain_categories: Dict[str, str] = {}

    if args.use_curated:
        curated = get_curated_domains()
        for domain, category in curated:
            domains.append(domain)
            domain_categories[domain] = category
        logger.info(f"Using curated brand list: {len(domains)} domains")
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

    discovery = ShopifyFeedDiscovery(
        concurrency=args.concurrency,
        rate_delay=args.rate_delay,
        timeout=args.timeout,
    )

    if args.fetch_samples and args.input:
        logger.info(f"Fetching {args.sample_count} sample products per store")
        sample_results = []
        for domain in domains:
            try:
                products = await discovery.fetch_sample_products(
                    domain, args.sample_count
                )
                sample_results.append({
                    "domain": domain,
                    "products": products[:args.sample_count],
                })
                logger.info(f"  {domain}: {len(products)} products fetched")
            except Exception as e:
                logger.warning(f"  {domain}: fetch failed — {e}")
        await discovery.close()

        samples_path = output_dir / "sample_products.json"
        with open(samples_path, "w") as f:
            json.dump(sample_results, f, indent=2)
        logger.info(f"Wrote sample products to {samples_path}")
        return

    results = await discovery.probe_batch(domains, checkpoint)

    for r in results:
        if r.domain in domain_categories:
            r.source = f"curated_{domain_categories[r.domain]}"

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
        description="BUY-17962: Shopify Public Feed Discovery",
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
        help="Use the built-in curated brand list",
    )

    parser.add_argument(
        "--output-dir", "-o",
        default="data/shopify_discovery",
        help="Directory for output files (default: data/shopify_discovery)",
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
        "--probe-only",
        action="store_true",
        help="Only probe feeds, don't fetch sample products",
    )
    parser.add_argument(
        "--fetch-samples",
        action="store_true",
        help="Fetch sample products from each store",
    )
    parser.add_argument(
        "--sample-count",
        type=int,
        default=DEFAULT_SAMPLE_COUNT,
        help=f"Number of sample products to fetch per store (default: {DEFAULT_SAMPLE_COUNT})",
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
