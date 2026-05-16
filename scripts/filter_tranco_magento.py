#!/usr/bin/env python3
"""BUY-17966: Filter Tranco / domain lists for Magento / Adobe Commerce stores.

Two-phase pipeline:
  Phase 1 — lightweight homepage HTML scan for Magento signatures
  Phase 2 — REST API probe (/rest/V1/products) for confirmed Magento stores

Outputs:
  --stores-out:  stores_magento.txt format for ingest_magento.py
  --summary-out: JSON summary of discovery results

Usage:
    # From a plain domain list (one per line)
    python3 scripts/filter_tranco_magento.py \
        --input domains.txt \
        --stores-out data/stores_magento_discovered.txt \
        --summary-out data/magento_discovery_run.json

    # From Tranco CSV (rank,domain)
    python3 scripts/filter_tranco_magento.py \
        --input top-1m.csv --tranco-csv \
        --max-domains 50000 \
        --stores-out data/stores_magento_discovered.txt

    # API probe only, skip HTML scan
    python3 scripts/filter_tranco_magento.py \
        --input magento_candidates.txt \
        --probe-only \
        --stores-out data/stores_magento_discovered.txt

    # Resume interrupted run
    python3 scripts/filter_tranco_magento.py \
        --input domains.txt \
        --resume data/filter_checkpoint.json
"""

import argparse
import asyncio
import csv
import json
import logging
import re
import sys
import time
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

try:
    import aiohttp
except ImportError:
    print("ERROR: aiohttp required. Install: pip install aiohttp", file=sys.stderr)
    sys.exit(1)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
)
logger = logging.getLogger("tranco_magento")

PHASE1_CONCURRENCY = 100
PHASE2_CONCURRENCY = 30
RATE_DELAY = 0.05
TIMEOUT = 15
MAGENTO_API_PATH = "/rest/V1/products"
MAGENTO_API_PARAMS = "searchCriteria[pageSize]=1"

MAGENTO_HTML_SIGNATURES = [
    r"/magento/",
    r"Magento_",
    r"Mage_Core",
    r"skin/frontend/",
    r"Adobe Commerce",
    r"Magento\s+Commerce",
    r"mage\/",
    r"requirejs\.org\/build\/",
    r"vnd\.magento",
    r"belvg",
    r"Magefan",
    r"Amasty",
    r"Mirasvit",
    r"magestore",
]

MAGENTO_EXCLUDE_DOMAINS = {
    "magento.com", "magento.org", "devdocs.magento.com",
    "github.com", "stackoverflow.com", "adobe.com",
}


@dataclass
class DomainResult:
    domain: str
    phase1_passed: bool = False
    phase2_passed: bool = False
    is_guest_accessible: bool = False
    store_code: str = "default"
    product_count: int = 0
    total_count: int = 0
    status_code: int = 0
    response_time_ms: float = 0.0
    error: Optional[str] = None
    checked_at: str = ""


@dataclass
class Checkpoint:
    completed: set = field(default_factory=set)
    results: list = field(default_factory=list)
    started_at: str = ""
    total_domains: int = 0


class TrancoMagentoFilter:
    def __init__(
        self,
        phase1_concurrency: int = PHASE1_CONCURRENCY,
        phase2_concurrency: int = PHASE2_CONCURRENCY,
        rate_delay: float = RATE_DELAY,
        timeout: int = TIMEOUT,
    ):
        self.phase1_concurrency = phase1_concurrency
        self.phase2_concurrency = phase2_concurrency
        self.rate_delay = rate_delay
        self.timeout = timeout
        self.phase1_sem = asyncio.Semaphore(phase1_concurrency)
        self.phase2_sem = asyncio.Semaphore(phase2_concurrency)

    def _normalize(self, domain: str) -> str:
        d = domain.strip().lower()
        d = re.sub(r"^https?://", "", d)
        d = d.split("/")[0].split(":")[0]
        return d

    def _has_magento_html(self, html: str) -> bool:
        for pat in MAGENTO_HTML_SIGNATURES:
            if re.search(pat, html, re.IGNORECASE):
                return True
        return False

    async def phase1_check(
        self, session: aiohttp.ClientSession, domain: str
    ) -> bool:
        url = f"https://{domain}"
        try:
            async with session.get(url, timeout=aiohttp.ClientTimeout(total=self.timeout), allow_redirects=True, ssl=False) as resp:
                text = await resp.text()
                return self._has_magento_html(text)
        except Exception:
            try:
                url = f"http://{domain}"
                async with session.get(url, timeout=aiohttp.ClientTimeout(total=self.timeout), allow_redirects=True, ssl=False) as resp:
                    text = await resp.text()
                    return self._has_magento_html(text)
            except Exception:
                return False

    async def phase2_probe(
        self, session: aiohttp.ClientSession, domain: str
    ) -> DomainResult:
        r = DomainResult(domain=domain)
        start = time.monotonic()
        api_url = f"https://{domain}{MAGENTO_API_PATH}?{MAGENTO_API_PARAMS}"
        try:
            async with session.get(api_url, timeout=aiohttp.ClientTimeout(total=self.timeout), allow_redirects=True, ssl=False) as resp:
                r.response_time_ms = (time.monotonic() - start) * 1000
                r.status_code = resp.status

                if resp.status == 401:
                    r.is_guest_accessible = False
                    r.phase2_passed = True
                    return r

                if resp.status != 200:
                    r.error = f"HTTP {resp.status}"
                    return r

                try:
                    data = await resp.json(content_type=None)
                except (json.JSONDecodeError, aiohttp.ContentTypeError) as e:
                    r.error = f"JSON error: {e}"
                    return r

                if not isinstance(data, dict):
                    r.error = "Not Magento JSON"
                    return r

                items = data.get("items", [])
                if items is None:
                    r.error = "No items in response"
                    return r

                r.phase2_passed = True
                r.is_guest_accessible = True
                r.total_count = data.get("total_count", 0)
                r.product_count = len(items)

        except asyncio.TimeoutError:
            r.error = "Timeout"
            r.response_time_ms = (time.monotonic() - start) * 1000
        except aiohttp.ClientError as e:
            r.error = f"Connection error: {type(e).__name__}"
            r.response_time_ms = (time.monotonic() - start) * 1000
        except Exception as e:
            r.error = f"Error: {e}"
            r.response_time_ms = (time.monotonic() - start) * 1000

        r.checked_at = datetime.now(timezone.utc).isoformat()
        return r

    async def run(
        self,
        domains: list[str],
        checkpoint: Optional[Checkpoint] = None,
        probe_only: bool = False,
    ) -> list[DomainResult]:
        results: list[DomainResult] = []
        completed_set: set = set()

        if checkpoint:
            completed_set = checkpoint.completed
            results = [DomainResult(**r) if isinstance(r, dict) else r for r in checkpoint.results]
            pending = [d for d in domains if self._normalize(d) not in completed_set]
            logger.info(f"Resuming: {len(completed_set)} done, {len(pending)} remaining")
        else:
            pending = list(domains)

        if not pending:
            return results

        async with aiohttp.ClientSession(
            headers={"User-Agent": "BuyWhere-TrancoFilter/1.0", "Accept": "application/json"}
        ) as session:
            if not probe_only:
                logger.info(f"Phase 1: HTML scan of {len(pending)} domains")
                phase1_passed = []
                total = len(pending)
                for i, domain in enumerate(pending):
                    async with self.phase1_sem:
                        if await self.phase1_check(session, domain):
                            phase1_passed.append(domain)
                    if (i + 1) % 500 == 0 or i + 1 == total:
                        logger.info(f"  Phase 1 progress: {i + 1}/{total} — {len(phase1_passed)} candidates")
                    await asyncio.sleep(self.rate_delay)
                logger.info(f"Phase 1 done: {len(phase1_passed)}/{total} domains had Magento HTML signatures")
            else:
                phase1_passed = pending
                logger.info(f"Probe-only mode: skipping HTML scan, probing {len(pending)} domains")

            logger.info(f"Phase 2: API probe of {len(phase1_passed)} candidates")
            phase2_total = len(phase1_passed)
            for i, domain in enumerate(phase1_passed):
                async with self.phase2_sem:
                    norm = self._normalize(domain)
                    if norm in completed_set:
                        continue
                    r = await self.phase2_probe(session, norm)
                    results.append(r)
                    completed_set.add(norm)
                if (i + 1) % 50 == 0 or i + 1 == phase2_total:
                    confirmed = sum(1 for x in results if x.phase2_passed)
                    guest = sum(1 for x in results if x.is_guest_accessible)
                    logger.info(f"  Phase 2 progress: {i + 1}/{phase2_total} — {confirmed} confirmed, {guest} guest-accessible")
                await asyncio.sleep(self.rate_delay)

        return results


def load_domains(filepath: str, tranco_csv: bool = False, max_domains: int = 0) -> list[str]:
    domains = []
    path = Path(filepath)
    if not path.exists():
        logger.error(f"File not found: {filepath}")
        return domains

    with open(path) as f:
        if tranco_csv:
            reader = csv.reader(f)
            for row in reader:
                if len(row) >= 2:
                    domain = row[1].strip().lower()
                    if domain and "." in domain:
                        domains.append(domain)
                        if max_domains and len(domains) >= max_domains:
                            break
        else:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#"):
                    continue
                domain = line.split(",")[0].strip().lower()
                if domain and "." in domain:
                    domains.append(domain)
                    if max_domains and len(domains) >= max_domains:
                        break

    unique = list(dict.fromkeys(domains))
    excluded = MAGENTO_EXCLUDE_DOMAINS
    filtered = [d for d in unique if d not in excluded]
    logger.info(f"Loaded {len(unique)} domains from {filepath} ({len(filtered)} after exclusion)")
    return filtered


def load_checkpoint(filepath: str) -> Optional[Checkpoint]:
    path = Path(filepath)
    if not path.exists():
        return None
    try:
        with open(path) as f:
            data = json.load(f)
        return Checkpoint(
            completed=set(data.get("completed", [])),
            results=data.get("results", []),
            started_at=data.get("started_at", ""),
            total_domains=data.get("total_domains", 0),
        )
    except Exception as e:
        logger.warning(f"Failed to load checkpoint: {e}")
        return None


def save_checkpoint(filepath: str, results: list[DomainResult], all_domains: list[str], started_at: str):
    completed = set()
    result_dicts = []
    for r in results:
        d = asdict(r)
        completed.add(r.domain)
        result_dicts.append(d)
    state = {
        "completed": list(completed),
        "results": result_dicts,
        "started_at": started_at,
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "total_domains": len(all_domains),
    }
    with open(filepath, "w") as f:
        json.dump(state, f, indent=2)
    logger.info(f"Checkpoint saved: {len(completed)}/{len(all_domains)} domains completed")


def write_stores_file(results: list[DomainResult], filepath: str):
    accessible = [r for r in results if r.is_guest_accessible]
    needs_auth = [r for r in results if r.phase2_passed and not r.is_guest_accessible]

    with open(filepath, "w") as f:
        f.write("# Magento stores discovered via Tranco filtering\n")
        f.write(f"# Generated: {datetime.now(timezone.utc).isoformat()}\n")
        f.write("# Format: store_url,store_code,access_token,country,region,currency\n\n")

        for r in accessible:
            f.write(f"https://{r.domain},default,,US,us,USD\n")

        f.write("\n# Stores requiring credentials (401 — needs credential onboarding)\n")
        for r in needs_auth:
            f.write(f"# 401: https://{r.domain},default,,US,us,USD\n")

    guest_count = len(accessible)
    auth_count = len(needs_auth)
    logger.info(f"Wrote {guest_count} accessible + {auth_count} needs-auth stores to {filepath}")


def write_summary(results: list[DomainResult], filepath: str, started_at: str, total_input: int):
    confirmed = [r for r in results if r.phase2_passed]
    accessible = [r for r in confirmed if r.is_guest_accessible]
    needs_auth = [r for r in confirmed if not r.is_guest_accessible]

    summary = {
        "issue": "BUY-17966",
        "pipeline": "tranco_magento_filter",
        "started_at": started_at,
        "completed_at": datetime.now(timezone.utc).isoformat(),
        "total_input_domains": total_input,
        "total_probed": len(results),
        "magento_confirmed": len(confirmed),
        "guest_accessible": len(accessible),
        "needs_credentials": len(needs_auth),
        "hit_rate_pct": round(len(confirmed) / max(len(results), 1) * 100, 2),
        "accessible_domains": [r.domain for r in accessible],
        "needs_auth_domains": [r.domain for r in needs_auth],
    }

    with open(filepath, "w") as f:
        json.dump(summary, f, indent=2)
    logger.info(f"Summary written to {filepath}")

    print(f"\n{'=' * 60}")
    print(f"  TRANCO MAGENTO FILTER RESULTS — BUY-17966")
    print(f"{'=' * 60}")
    print(f"  Total domains scanned:  {total_input}")
    print(f"  Magento confirmed:       {len(confirmed)}")
    print(f"  Guest accessible:        {len(accessible)}")
    print(f"  Needs credentials:       {len(needs_auth)}")
    print(f"  Hit rate:                {summary['hit_rate_pct']}%")
    if accessible:
        print(f"\n  Accessible stores:")
        for r in accessible:
            print(f"    https://{r.domain} ({r.total_count} products)")
    if needs_auth:
        print(f"\n  Needs credential onboarding:")
        for r in needs_auth:
            print(f"    https://{r.domain}")
    print(f"{'=' * 60}")


async def run_pipeline(args):
    started_at = datetime.now(timezone.utc).isoformat()

    domains = load_domains(args.input, args.tranco_csv, args.max_domains)
    if not domains:
        logger.error("No domains to process")
        sys.exit(1)

    checkpoint = None
    if args.resume:
        checkpoint = load_checkpoint(args.resume)
        if checkpoint:
            logger.info(f"Resuming: {checkpoint.total_domains} total, {len(checkpoint.completed)} completed")

    filter_ = TrancoMagentoFilter(
        phase1_concurrency=args.phase1_concurrency,
        phase2_concurrency=args.phase2_concurrency,
        rate_delay=args.rate_delay,
        timeout=args.timeout,
    )

    results = await filter_.run(domains, checkpoint, probe_only=args.probe_only)

    checkpoint_path = args.checkpoint or "data/tranco_magento_checkpoint.json"
    save_checkpoint(checkpoint_path, results, domains, started_at)

    if args.stores_out:
        write_stores_file(results, args.stores_out)

    if args.summary_out:
        write_summary(results, args.summary_out, started_at, len(domains))
    else:
        write_summary(results, "data/tranco_magento_summary.json", started_at, len(domains))


def main():
    parser = argparse.ArgumentParser(
        description="BUY-17966: Filter Tranco / domain lists for Magento / Adobe Commerce stores",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument("--input", "-i", required=True, help="Input domain list file")
    parser.add_argument("--tranco-csv", action="store_true", help="Input is Tranco CSV (rank,domain)")
    parser.add_argument("--max-domains", type=int, default=0, help="Max domains to process (0 = all)")
    parser.add_argument("--stores-out", "-s", default="", help="Output stores_magento.txt path")
    parser.add_argument("--summary-out", default="", help="Output summary JSON path")
    parser.add_argument("--checkpoint", default="", help="Checkpoint path (default: data/tranco_magento_checkpoint.json)")
    parser.add_argument("--resume", help="Resume from checkpoint file")
    parser.add_argument("--probe-only", action="store_true", help="Skip HTML scan, probe API directly")
    parser.add_argument("--phase1-concurrency", type=int, default=PHASE1_CONCURRENCY)
    parser.add_argument("--phase2-concurrency", type=int, default=PHASE2_CONCURRENCY)
    parser.add_argument("--rate-delay", type=float, default=RATE_DELAY)
    parser.add_argument("--timeout", type=int, default=TIMEOUT)
    parser.add_argument("--verbose", "-v", action="store_true")

    args = parser.parse_args()

    if args.verbose:
        logging.getLogger().setLevel(logging.DEBUG)

    asyncio.run(run_pipeline(args))


if __name__ == "__main__":
    main()
