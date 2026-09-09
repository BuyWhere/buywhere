#!/usr/bin/env python3
"""BUY-17963: BigCommerce public feed discovery.

This utility validates candidate domains for public BigCommerce catalog endpoints.
It is designed to run independently from other discovery sources.

Detection strategy:
1) robots.txt contains a BigCommerce catalog path (/v3/catalog/products)
2) DNS includes a BigCommerce managed hostname reference
3) Public endpoint probe against:
   - /api/storefront/products
   - /v3/catalog/products

Stores requiring authentication (e.g., 401 + X-Auth-Token) are skipped.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import shutil
import socket
import ssl
import subprocess
from collections import Counter
from dataclasses import dataclass
from dataclasses import field
from pathlib import Path
from typing import Any

import aiohttp


SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parent
OUTPUT_BASE = PROJECT_ROOT / "data" / "bigcommerce_public_discovery"
OUTPUT_BASE.mkdir(parents=True, exist_ok=True)

DEFAULT_CANDIDATE_FILE = PROJECT_ROOT / "data" / "domains" / "combined_candidates_latest.jsonl"
DEFAULT_USER_AGENT = "BuyWhere Discovery/1.0 (+https://buywhere.ai)"


@dataclass
class DiscoveryResult:
    domain: str
    source: str
    signal: str
    endpoint: str
    product_count: int = 0
    status: str = "validated"
    details: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class CandidateSeed:
    domain: str
    signal: str = ""


def _is_bigcommerce_dns_hint(domain: str) -> tuple[bool, str]:
    """Return (is_match, evidence)."""
    domain = domain.strip().lower()
    if not domain:
        return False, ""

    if domain.endswith(".mybigcommerce.com"):
        return True, "domain_suffix:mybigcommerce"

    # Best effort CNAME lookup via dig/nslookup when available.
    for cmd in (("dig", "+short", "CNAME", domain), ("nslookup", "-query=type=cname", domain)):
        if shutil.which(cmd[0]) is None:
            continue
        try:
            result = subprocess.run(
                cmd,
                check=False,
                capture_output=True,
                text=True,
                timeout=8,
            )
            output = (result.stdout or "") + (result.stderr or "")
            output_l = output.lower()
            if "bigcommerce.com" in output_l:
                return True, f"dns_cname_contains_bigcommerce:{cmd[0]}"
        except Exception:
            continue

    # Fallback: DNS library unavailable in this environment, so use resolver fallback only.
    try:
        socket.getaddrinfo(domain, 443)
        return False, ""
    except Exception:
        return False, "dns_lookup_failed"


async def _fetch_text(session: aiohttp.ClientSession, url: str) -> tuple[int, str, dict[str, str]]:
    async with session.get(url, timeout=20) as response:
        body = await response.text(errors="ignore")
        headers = dict(response.headers)
        return response.status, body, headers


def _is_auth_required(status: int, headers: dict[str, str], body: str) -> bool:
    if status == 401:
        return True

    auth_header = (
        headers.get("www-authenticate", "")
        + " "
        + headers.get("x-auth-token", "")
        + " "
        + headers.get("authorization", "")
    ).lower()

    if "x-auth-token" in auth_header:
        return True

    marker = body.lower()
    return any(token in marker for token in ("x-auth-token", "authorization", "unauthorized", "auth required"))


def _extract_total(body: str) -> int:
    try:
        payload = json.loads(body)
    except json.JSONDecodeError:
        return 0

    # Common BigCommerce /api/storefront/products payload.
    for path in (
        ("data", "meta", "pagination", "total"),
        ("data", "pagination", "total"),
        ("data", "meta", "total"),
        ("meta", "pagination", "total"),
        ("meta", "total"),
    ):
        current: Any = payload
        ok = True
        for key in path:
            if not isinstance(current, dict) or key not in current:
                ok = False
                break
            current = current[key]
        if ok:
            try:
                value = int(current)
                if value >= 0:
                    return value
            except (TypeError, ValueError):
                pass

    # /v3/catalog/products payload variations.
    for path in (("data",), ("response", "data")):
        current = payload
        ok = True
        for key in path:
            if not isinstance(current, dict) or key not in current:
                ok = False
                break
            current = current[key]
        if ok and isinstance(current, dict):
            for key in ("meta", "pagination"):  # pragma: no branch
                if isinstance(current.get(key), dict) and isinstance(current[key].get("total"), int):
                    return int(current[key]["total"])

    # Last resort: infer from list sizes.
    for key in ("data", "products", "data", "catalog"):
        pass

    for container in ("data", "products", "items"):
        value = payload.get(container) if isinstance(payload, dict) else None
        if isinstance(value, list):
            return len(value)

    return 0


def _looks_like_storefront_payload(body: str) -> bool:
    try:
        payload = json.loads(body)
    except json.JSONDecodeError:
        return False

    if isinstance(payload, list):
        return len(payload) > 0 and isinstance(payload[0], dict)

    if not isinstance(payload, dict):
        return False

    # Reject common error envelopes that still return HTTP 200.
    if payload.get("data") == {} and any(key in payload for key in ("code", "message", "msg", "status")):
        return False

    data_value = payload.get("data")
    if isinstance(data_value, list):
        return True
    if isinstance(data_value, dict):
        if any(key in data_value for key in ("meta", "pagination", "products", "items")):
            return True
        return False

    if any(k in payload for k in ("products", "catalog", "response", "meta")):
        return True

    return False


def _signature_match(
    domain: str,
    robots_body: str,
    dns_hit: tuple[bool, str],
    candidate_signal: str = "",
) -> tuple[bool, str]:
    if candidate_signal:
        return True, candidate_signal
    if "/v3/catalog/products" in robots_body:
        return True, "robots_catalog_path"
    if dns_hit[0]:
        return True, dns_hit[1]
    return False, ""


async def _probe_domain(
    session: aiohttp.ClientSession,
    domain: str,
    candidate_signal: str,
    user_agent: str,
    timeout: int,
) -> DiscoveryResult | None:
    domain = domain.strip().lower()
    if not domain:
        return None

    robots_ok = False
    robots_evidence = ""
    robots_text = ""
    try:
        robots_url = f"https://{domain}/robots.txt"
        async with session.get(robots_url, headers={"User-Agent": user_agent}, timeout=timeout) as robots_resp:
            if robots_resp.status == 200:
                robots_text = (await robots_resp.text(errors="ignore")).lower()
                robots_ok = "/v3/catalog/products" in robots_text
                if robots_ok:
                    robots_evidence = "robots.txt"
    except Exception:
        robots_text = ""

    dns_hit = _is_bigcommerce_dns_hint(domain)
    signature_ok, signature_source = _signature_match(domain, robots_text, dns_hit, candidate_signal)

    if not signature_ok:
        return DiscoveryResult(
            domain=domain,
            source="bigcommerce",
            signal="none",
            endpoint="",
            status="skipped_signal",
        )

    for endpoint in (
        f"https://{domain}/api/storefront/products?limit=1",
        f"https://{domain}/api/storefront/storefront/products?limit=1",
        f"https://{domain}/v3/catalog/products?limit=1",
        f"https://{domain}/v3/catalog/products?limit=1&include=videos",
    ):
        try:
            async with session.get(
                endpoint,
                headers={"User-Agent": user_agent, "Accept": "application/json"},
                timeout=timeout,
            ) as resp:
                body = await resp.text(errors="ignore")
                headers = dict(resp.headers)

                if _is_auth_required(resp.status, headers, body):
                    return DiscoveryResult(
                        domain=domain,
                        source="bigcommerce",
                        signal=signature_source or robots_evidence or (dns_hit[1] if dns_hit[0] else "signal"),
                        endpoint="",
                        status="skipped_auth_required",
                        details={
                            "http_status": resp.status,
                            "reason": "x-auth-token_required_or_unauthorized",
                        },
                    )

                if resp.status != 200:
                    continue

                if _looks_like_storefront_payload(body):
                    product_count = _extract_total(body)
                    evidence = ""
                    if robots_text and "/v3/catalog/products" in robots_text:
                        evidence = "robots.txt"
                    elif dns_hit[0]:
                        evidence = dns_hit[1]
                    else:
                        evidence = signature_source
                    return DiscoveryResult(
                        domain=domain,
                        source="bigcommerce",
                        signal=evidence,
                        endpoint=endpoint,
                        product_count=product_count,
                        details={"http_status": resp.status},
                    )
        except aiohttp.ClientError:
            continue
        except asyncio.TimeoutError:
            continue
        except Exception:
            continue

    return DiscoveryResult(
        domain=domain,
        source="bigcommerce",
        signal=signature_source or robots_evidence or "",
        endpoint="",
        status="failed",
        details={"reason": "no_public_feed"},
    )


def _load_candidate_domains(path: Path) -> list[CandidateSeed]:
    if not path.exists():
        return []

    domains: list[CandidateSeed] = []
    seen = set()

    with path.open("r", encoding="utf-8", errors="replace") as handle:
        for raw in handle:
            line = raw.strip()
            if not line:
                continue

            domain = ""
            signal = ""
            if line.startswith("{"):
                try:
                    payload = json.loads(line)
                    domain = (
                        payload.get("domain")
                        or payload.get("name")
                        or payload.get("host")
                        or payload.get("hostname")
                        or payload.get("website")
                    )
                    platform = str(payload.get("platform") or payload.get("platform_hint") or "").lower()
                    source = str(payload.get("source") or payload.get("source_attribution") or "").lower()
                    evidence = str(payload.get("evidence") or "").lower()
                    if "bigcommerce" in platform:
                        signal = "input_platform:bigcommerce"
                    elif "bigcommerce" in source:
                        signal = "input_source:bigcommerce"
                    elif "bigcommerce" in evidence:
                        signal = "input_evidence:bigcommerce"
                except json.JSONDecodeError:
                    domain = line
            else:
                domain = line

            if not domain:
                continue

            domain = domain.strip().lower()
            if domain.startswith("www."):
                domain = domain[4:]
            if domain and "." in domain and domain not in seen:
                seen.add(domain)
                domains.append(CandidateSeed(domain=domain, signal=signal))

    return domains


async def run_discovery(
    candidate_file: Path,
    concurrency: int,
    timeout: int,
    output_prefix: str,
    user_agent: str,
) -> dict[str, Any]:
    seeds = _load_candidate_domains(candidate_file)
    if not seeds:
        return {
            "status": "no_candidates",
            "total_candidates": 0,
            "validated": 0,
            "skipped_signal": 0,
            "skipped_auth_required": 0,
            "failed": 0,
            "average_products_per_validated_store": 0,
            "total_products": 0,
            "valid_stores": [],
            "invalid_stores": [],
        }

    connector = aiohttp.TCPConnector(limit=concurrency, limit_per_host=5, ssl=ssl.create_default_context())
    sem = asyncio.Semaphore(concurrency)

    async with aiohttp.ClientSession(connector=connector) as session:
        async def run_one(seed: CandidateSeed) -> DiscoveryResult:
            async with sem:
                try:
                    result = await _probe_domain(session, seed.domain, seed.signal, user_agent, timeout)
                    if result is not None:
                        return result
                except Exception as exc:
                    return DiscoveryResult(
                        domain=seed.domain,
                        source="bigcommerce",
                        signal="",
                        endpoint="",
                        status="failed",
                        details={"reason": f"probe_exception:{type(exc).__name__}"},
                    )

                return DiscoveryResult(
                    domain=seed.domain,
                    source="bigcommerce",
                    signal="",
                    endpoint="",
                    status="failed",
                    details={"reason": "probe_returned_none"},
                )

        tasks = [asyncio.create_task(run_one(seed)) for seed in seeds]
        results = [r for r in await asyncio.gather(*tasks) if r]

    validated = [r for r in results if r.status == "validated"]
    skipped_signal = [r for r in results if r.status == "skipped_signal"]
    skipped_auth = [r for r in results if r.status == "skipped_auth_required"]
    failed = [r for r in results if r.status not in {"validated", "skipped_signal", "skipped_auth_required"}]

    total_products = sum(v.product_count for v in validated)
    average_products = int(total_products / len(validated)) if validated else 0

    status_counts = Counter(r.status for r in results)

    report = {
        "issue": "BUY-17963",
        "status": "completed",
        "candidate_file": str(candidate_file),
        "generated_at": __import__("datetime").datetime.utcnow().isoformat() + "Z",
        "targets": {
            "total_candidates": len(seeds),
            "validated_count": len(validated),
            "validation_rate": f"{(len(validated) / len(seeds) * 100):.2f}%",
            "skipped_signal": len(skipped_signal),
            "skipped_auth_required": len(skipped_auth),
            "failed": len(failed),
        },
        "status_counts": dict(status_counts),
        "total_validated_products": total_products,
        "average_products_per_validated_store": average_products,
    }

    output_file = OUTPUT_BASE / f"{output_prefix}_report.json"
    with output_file.open("w", encoding="utf-8") as f:
        json.dump(report, f, indent=2)

    valid_path = OUTPUT_BASE / f"{output_prefix}_validated.ndjson"
    with valid_path.open("w", encoding="utf-8") as f:
        for item in validated:
            f.write(json.dumps(item.__dict__) + "\n")

    invalid_path = OUTPUT_BASE / f"{output_prefix}_invalid.ndjson"
    with invalid_path.open("w", encoding="utf-8") as f:
        for item in results:
            if item.status != "validated":
                f.write(json.dumps(item.__dict__) + "\n")

    for k, v in report["targets"].items():
        print(f"{k}: {v}")
    print(f"Output: {output_file}")
    print(f"Validated: {valid_path}")
    print(f"Invalid: {invalid_path}")

    return report


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="BigCommerce public feed discovery (BUY-17963)")
    parser.add_argument(
        "--candidate-file",
        default=str(DEFAULT_CANDIDATE_FILE),
        help="Input candidate domains (JSONL or newline-separated)",
    )
    parser.add_argument("--concurrency", type=int, default=12, help="Concurrent probes")
    parser.add_argument("--timeout", type=int, default=15, help="Per-request timeout in seconds")
    parser.add_argument(
        "--output-prefix",
        default="bigcommerce_public",
        help="Prefix for output files under data/bigcommerce_public_discovery",
    )
    parser.add_argument(
        "--user-agent",
        default=DEFAULT_USER_AGENT,
        help="User-Agent string for probing",
    )
    return parser


async def main() -> None:
    parser = build_parser()
    args = parser.parse_args()
    candidate_file = Path(args.candidate_file)

    report = await run_discovery(
        candidate_file=candidate_file,
        concurrency=args.concurrency,
        timeout=args.timeout,
        output_prefix=args.output_prefix,
        user_agent=args.user_agent,
    )
    print(json.dumps({k: report[k] for k in ("issue", "targets", "total_validated_products", "average_products_per_validated_store")}, indent=2))


if __name__ == "__main__":
    asyncio.run(main())
