#!/usr/bin/env python3
"""Discover Shopify stores from Certificate Transparency and emit/optionally run INSERT batches.

BUY-76712 scope:
- Pull `*.myshopify.com` names from CT search APIs (crt.sh first; hooks for other APIs).
- Deduplicate against `merchants.domain` and `merchants.id` in the BuyWhere catalog DB.
- Verify candidates with `/products.json?limit=1` (HTTP 200 + JSON object with `products`).
- Write a SQL INSERT batch using source=`ct_shopify`, products_count=0, is_active=true.

Modes:
  --batch   One-shot: query crt.sh, verify, write INSERT SQL (default).
  --stream  Continuous: subscribe to CertStream CT log, emit verified domains to JSONL.

Default is safe handoff mode: write SQL only; pass --execute to insert directly.
"""

from __future__ import annotations

import argparse
import concurrent.futures
import hashlib
import json
import re
import socket
import ssl
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable
from urllib.parse import urlsplit

import psycopg2
import psycopg2.extras
import requests

REPO_ROOT = Path(__file__).resolve().parents[2]
CATALOG_DSN_FILE = REPO_ROOT / "data" / ".catalog_db_url"
OUT_DIR = REPO_ROOT / "data" / "ct_discovery"
REQUIRED_HOST = "sakura.proxy.rlwy.net"
SOURCE = "ct_shopify"
UA = "BuyWhere-CT-Shopify-Discovery/1.0 (+BUY-76712)"
MYSHOPIFY_RE = re.compile(r"(^|[.])([a-z0-9][a-z0-9-]{2,62}[.]myshopify[.]com)$", re.I)
DOMAIN_RE = re.compile(r"^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?[.])+[a-z]{2,63}$", re.I)
SHOPIFY_CNAME_HINTS = (
    "myshopify.com",
    "shops.myshopify.com",
)


@dataclass(frozen=True)
class VerifyResult:
    domain: str
    verified_domain: str
    ok: bool
    http_status: int | None
    product_count_seen: int
    error: str | None = None


def normalize_domain(raw: str) -> str | None:
    raw = (raw or "").strip().lower().strip("*. ")
    raw = raw.replace("\\n", "\n")
    if not raw or raw.startswith("*."):
        raw = raw[2:]
    raw = raw.strip(".")
    if not DOMAIN_RE.match(raw):
        return None
    return raw


def host_from_dsn(dsn: str) -> str:
    return urlsplit(dsn).hostname or ""


def load_catalog_dsn() -> str:
    # Intentionally ignore DATABASE_URL: heartbeat envs have historically pointed at
    # Paperclip roundhouse. The checked-in BuyWhere DSN file is the canonical catalog path.
    dsn = CATALOG_DSN_FILE.read_text().strip()
    if host_from_dsn(dsn) != REQUIRED_HOST:
        raise SystemExit(f"refusing catalog connection: {CATALOG_DSN_FILE} host is {host_from_dsn(dsn)!r}, expected {REQUIRED_HOST!r}")
    return dsn


def assert_catalog(cur) -> None:
    cur.execute("SELECT COALESCE(max(reltuples), 0) FROM pg_class WHERE relname='products' AND relkind IN ('r','p')")
    reltuples = float(cur.fetchone()[0] or 0)
    if reltuples < 100_000_000:
        raise SystemExit(f"refusing catalog connection: products reltuples sentinel too small ({reltuples:.0f})")


def fetch_crtsh_query(query: str, timeout: int, limit: int | None = None) -> set[str]:
    url = "https://crt.sh/"
    params = {"q": query, "output": "json", "exclude": "expired"}
    last_error: Exception | None = None
    for attempt in range(3):
        try:
            r = requests.get(url, params=params, headers={"User-Agent": UA}, timeout=timeout)
            r.raise_for_status()
            break
        except requests.RequestException as exc:
            last_error = exc
            if attempt < 2:
                time.sleep(2 + attempt * 3)
    else:
        raise RuntimeError(f"crt.sh fetch failed for {query!r} after retries: {last_error}")
    try:
        rows = r.json()
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"crt.sh returned non-JSON for {query!r} ({len(r.text)} bytes)") from exc
    out: set[str] = set()
    for row in rows:
        for field in ("name_value", "common_name"):
            for value in str(row.get(field) or "").splitlines():
                dom = normalize_domain(value)
                if dom and dom.endswith(".myshopify.com"):
                    out.add(dom)
                    if limit and len(out) >= limit:
                        return out
    return out


def fetch_crtsh_myshopify(timeout: int, limit: int | None = None, prefixes: list[str] | None = None) -> tuple[set[str], list[str]]:
    errors: list[str] = []
    out: set[str] = set()
    queries = ["%.myshopify.com"]
    if prefixes:
        queries = [f"{p}%.myshopify.com" for p in prefixes]
    for q in queries:
        try:
            out.update(fetch_crtsh_query(q, timeout, None if not limit else max(1, limit - len(out))))
        except Exception as exc:
            errors.append(str(exc))
        if limit and len(out) >= limit:
            break
    return out, errors


def fetch_cloudflare_api_placeholder(timeout: int) -> set[str]:
    """Placeholder for Cloudflare/Google CT APIs.

    Those APIs expose append-only log ranges, not domain search. Running them at quota scale
    requires a persisted cursor owned by the production unit. This script keeps the interface
    explicit so Ops can wire range scanners without changing downstream verification/batching.
    """
    _ = timeout
    return set()


def resolve_cname(domain: str) -> str:
    try:
        answers = socket.getaddrinfo(domain, 443, type=socket.SOCK_STREAM)
        return "addr:" + str(len(answers))
    except Exception as exc:
        return f"dns_error:{type(exc).__name__}"


def tls_cert_names(domain: str, timeout: float = 5.0) -> list[str]:
    try:
        ctx = ssl.create_default_context()
        with socket.create_connection((domain, 443), timeout=timeout) as sock:
            with ctx.wrap_socket(sock, server_hostname=domain) as ssock:
                cert = ssock.getpeercert()
        names: list[str] = []
        for kind, value in cert.get("subjectAltName", []):
            if kind.lower() == "dns":
                n = normalize_domain(value)
                if n:
                    names.append(n)
        return names
    except Exception:
        return []


def looks_shopify_fronted_custom_domain(domain: str) -> bool:
    # Cheap signal for custom domains found by future CT range scanners: if the presented
    # cert also names a myshopify host, the domain is likely Shopify-fronted. Verification
    # still requires /products.json to be public.
    names = tls_cert_names(domain)
    return any(name.endswith(".myshopify.com") for name in names)


def get_existing(conn, domains: list[str]) -> set[str]:
    existing: set[str] = set()
    if not domains:
        return existing
    with conn.cursor() as cur:
        assert_catalog(cur)
        for i in range(0, len(domains), 5000):
            batch = domains[i:i + 5000]
            cur.execute(
                """
                SELECT lower(domain) FROM merchants WHERE lower(domain) = ANY(%s)
                UNION
                SELECT lower(id) FROM merchants WHERE lower(id) = ANY(%s)
                """,
                (batch, batch),
            )
            existing.update(row[0] for row in cur.fetchall() if row[0])
    return existing


def verify_products_json(domain: str, timeout: float) -> VerifyResult:
    session = requests.Session()
    session.headers.update({"User-Agent": UA, "Accept": "application/json,text/plain,*/*"})
    urls = [f"https://{domain}/products.json?limit=1", f"http://{domain}/products.json?limit=1"]
    last_error: str | None = None
    for url in urls:
        try:
            r = session.get(url, timeout=timeout, allow_redirects=True)
            status = r.status_code
            if status != 200:
                last_error = f"http_{status}"
                continue
            ctype = (r.headers.get("content-type") or "").lower()
            text = r.text[:4096]
            try:
                data = r.json()
            except Exception:
                last_error = "non_json_200"
                continue
            products = data.get("products") if isinstance(data, dict) else None
            if not isinstance(products, list):
                last_error = "json_without_products"
                continue
            final_host = normalize_domain(urlsplit(r.url).hostname or domain) or domain
            if products:
                return VerifyResult(domain, final_host, True, status, len(products))
            # A public Shopify JSON endpoint with an empty products array is real but lower
            # value. Keep it out of verified NEW stores for the quota because it proves no
            # public product exists at limit=1.
            last_error = "empty_products"
            if "application/json" not in ctype and not text.lstrip().startswith("{"):
                last_error = "bad_content_type"
        except Exception as exc:
            last_error = type(exc).__name__
    return VerifyResult(domain, domain, False, None, 0, last_error)


def merchant_id(domain: str) -> str:
    base = "ct_shopify_" + re.sub(r"[^a-z0-9]+", "_", domain.lower()).strip("_")
    if len(base) <= 240:
        return base
    digest = hashlib.sha1(domain.encode()).hexdigest()[:12]
    return base[:227] + "_" + digest


def merchant_name(domain: str) -> str:
    root = domain[:-len(".myshopify.com")] if domain.endswith(".myshopify.com") else domain.split(".")[0]
    return root.replace("-", " ").replace("_", " ").title()[:120]


def write_insert_sql(path: Path, domains: list[str]) -> None:
    rows = []
    for domain in domains:
        rows.append({
            "id": merchant_id(domain),
            "name": merchant_name(domain),
            "source": SOURCE,
            "country": "US",
            "domain": domain,
        })
    with path.open("w") as f:
        f.write("-- BUY-76712 CT Shopify verified merchant insert batch\n")
        f.write("-- source=ct_shopify; products_count=0; is_active=true; safe upsert/no deletes\n")
        if not rows:
            f.write("-- no verified new stores in this batch\n")
            return
        f.write("INSERT INTO merchants (id, name, source, country, domain, products_count, is_active, onboarding_stage, created_at, updated_at) VALUES\n")
        values = []
        for row in rows:
            values.append(
                "  (" + ", ".join([
                    psycopg2.extensions.adapt(row["id"]).getquoted().decode(),
                    psycopg2.extensions.adapt(row["name"]).getquoted().decode(),
                    psycopg2.extensions.adapt(row["source"]).getquoted().decode(),
                    psycopg2.extensions.adapt(row["country"]).getquoted().decode(),
                    psycopg2.extensions.adapt(row["domain"]).getquoted().decode(),
                    "0", "true", "'discovered'", "NOW()", "NOW()",
                ]) + ")"
            )
        f.write(",\n".join(values))
        f.write("\nON CONFLICT (id) DO NOTHING;\n")


def execute_insert(conn, domains: list[str]) -> int:
    if not domains:
        return 0
    rows = [(merchant_id(d), merchant_name(d), SOURCE, "US", d) for d in domains]
    with conn.cursor() as cur:
        assert_catalog(cur)
        psycopg2.extras.execute_values(
            cur,
            """
            INSERT INTO merchants (id, name, source, country, domain, products_count, is_active, onboarding_stage, created_at, updated_at)
            VALUES %s
            ON CONFLICT (id) DO NOTHING
            """,
            rows,
            template="(%s,%s,%s,%s,%s,0,true,'discovered',NOW(),NOW())",
            page_size=1000,
        )
        inserted = cur.rowcount
    conn.commit()
    return max(inserted, 0)


def count_ct(conn) -> int:
    with conn.cursor() as cur:
        assert_catalog(cur)
        cur.execute("SELECT COUNT(*) FROM merchants WHERE source=%s", (SOURCE,))
        return int(cur.fetchone()[0])


def run_stream(args) -> int:
    """Subscribe to CertStream and continuously discover/verify myshopify.com domains."""
    import certstream as cs

    stream_domains_path = OUT_DIR / "stream_discovered.jsonl"
    stream_verified_path = OUT_DIR / "stream_verified.jsonl"
    seen_path = OUT_DIR / "stream_seen_domains.json"
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    # Load previously seen domains to avoid re-verification
    seen: set[str] = set()
    if seen_path.exists():
        try:
            seen = set(json.loads(seen_path.read_text()))
        except Exception:
            seen = set()

    dsn = load_catalog_dsn()
    conn = psycopg2.connect(dsn)
    existing_db = set()
    with conn.cursor() as cur:
        assert_catalog(cur)
        cur.execute("SELECT lower(domain) FROM merchants WHERE domain IS NOT NULL")
        existing_db = {row[0] for row in cur.fetchall() if row[0]}
    conn.close()

    pending: list[str] = []
    batch_size = args.stream_batch_size
    last_flush = time.time()

    def callback(message, context):
        nonlocal last_flush
        if message.get("message_type") != "certificate_update":
            return
        leaf = message.get("data", {}).get("leaf_cert", {})
        for domain in leaf.get("all_domains", []):
            dom = normalize_domain(domain)
            if not dom or not dom.endswith(".myshopify.com"):
                continue
            if dom in seen or dom in existing_db:
                continue
            seen.add(dom)
            pending.append(dom)

            # Flush periodically
            if len(pending) >= batch_size or (time.time() - last_flush > 30 and pending):
                flush_pending()

    def flush_pending():
        nonlocal last_flush
        if not pending:
            return
        batch = list(pending)
        pending.clear()
        last_flush = time.time()

        # Write raw discovered
        with stream_domains_path.open("a") as f:
            for d in batch:
                f.write(json.dumps({"ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "domain": d}) + "\n")

        # Verify in parallel
        verified_this_batch = []
        with concurrent.futures.ThreadPoolExecutor(max_workers=min(args.workers, 32)) as ex:
            futs = {ex.submit(verify_products_json, d, args.timeout): d for d in batch}
            for fut in concurrent.futures.as_completed(futs):
                res = fut.result()
                if res.ok:
                    verified_this_batch.append(res.verified_domain)

        # Write verified
        if verified_this_batch:
            with stream_verified_path.open("a") as f:
                for d in verified_this_batch:
                    f.write(json.dumps({"ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "domain": d}) + "\n")

        # Periodically persist seen set
        seen_path.write_text(json.dumps(sorted(seen)))

        print(json.dumps({
            "event": "flush",
            "domains_in_batch": len(batch),
            "verified_in_batch": len(verified_this_batch),
            "total_seen": len(seen),
        }), flush=True)

    print(json.dumps({
        "event": "stream_start",
        "certstream_url": "wss://certstream.califnode.com",
        "stream_domains_path": str(stream_domains_path),
        "stream_verified_path": str(stream_verified_path),
        "batch_size": batch_size,
    }), flush=True)

    try:
        cs.listen_for_events(callback, url="wss://certstream.califnode.com")
    except KeyboardInterrupt:
        pass
    except Exception as exc:
        print(json.dumps({"event": "stream_error", "error": str(exc)}), flush=True)
    finally:
        flush_pending()
        seen_path.write_text(json.dumps(sorted(seen)))

    return 0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--max-candidates", type=int, default=0, help="cap unique CT candidates before DB dedupe; 0 means no cap")
    ap.add_argument("--max-verify", type=int, default=0, help="cap post-dedupe verification count; 0 means no cap")
    ap.add_argument("--workers", type=int, default=32)
    ap.add_argument("--timeout", type=float, default=8.0)
    ap.add_argument("--execute", action="store_true", help="execute INSERT against catalog DB instead of handoff-only SQL")
    ap.add_argument("--crt-prefix", action="append", default=[], help="shard crt.sh search, e.g. --crt-prefix ab queries ab%%.myshopify.com")
    ap.add_argument("--include-cloudflare-placeholder", action="store_true")
    ap.add_argument("--stream", action="store_true", help="continuous mode: subscribe to CertStream CT log")
    ap.add_argument("--stream-batch-size", type=int, default=500, help="domains per verification flush in stream mode")
    args = ap.parse_args()

    if args.stream:
        return run_stream(args)

    started = time.strftime("%Y%m%dT%H%M%SZ", time.gmtime())
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    candidates_path = OUT_DIR / f"ct_candidates_{started}.json"
    verified_path = OUT_DIR / f"ct_verified_{started}.json"
    insert_path = OUT_DIR / f"ct_shopify_insert_{started}.sql"

    crt_domains, crt_errors = fetch_crtsh_myshopify(int(args.timeout * 3), args.max_candidates or None, args.crt_prefix or None)
    sources = {"crtsh_myshopify": sorted(crt_domains)}
    if args.include_cloudflare_placeholder:
        sources["cloudflare_placeholder"] = sorted(fetch_cloudflare_api_placeholder(int(args.timeout)))
    candidates = sorted(set().union(*(set(v) for v in sources.values())))
    if args.max_candidates:
        candidates = candidates[:args.max_candidates]

    dsn = load_catalog_dsn()
    conn = psycopg2.connect(dsn)
    existing = get_existing(conn, candidates)
    new_candidates = [d for d in candidates if d not in existing]
    if args.max_verify:
        new_candidates = new_candidates[:args.max_verify]

    candidates_path.write_text(json.dumps({
        "started": started,
        "source_counts": {k: len(v) for k, v in sources.items()},
        "source_errors": {"crtsh_myshopify": crt_errors},
        "candidate_count": len(candidates),
        "existing_count": len(existing),
        "new_candidate_count": len(new_candidates),
        "new_candidates_sample": new_candidates[:100],
    }, indent=2))

    verified: list[VerifyResult] = []
    workers = max(1, min(args.workers, 128))
    with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as ex:
        futs = [ex.submit(verify_products_json, d, args.timeout) for d in new_candidates]
        for fut in concurrent.futures.as_completed(futs):
            res = fut.result()
            if res.ok:
                verified.append(res)

    verified_domains = sorted({r.verified_domain for r in verified})
    # Dedup again after redirects to custom domains.
    redirect_existing = get_existing(conn, verified_domains)
    verified_domains = [d for d in verified_domains if d not in redirect_existing]

    verified_path.write_text(json.dumps({
        "started": started,
        "verified_count": len(verified_domains),
        "verified_domains": verified_domains,
        "raw_verified": [r.__dict__ for r in verified],
    }, indent=2))
    write_insert_sql(insert_path, verified_domains)

    inserted = 0
    if args.execute:
        inserted = execute_insert(conn, verified_domains)
    counter = count_ct(conn)
    conn.close()

    print(json.dumps({
        "candidate_count": len(candidates),
        "existing_count": len(existing),
        "source_errors": {"crtsh_myshopify": crt_errors},
        "verified_new_count": len(verified_domains),
        "inserted": inserted,
        "ct_shopify_counter": counter,
        "candidates_path": str(candidates_path),
        "verified_path": str(verified_path),
        "insert_sql_path": str(insert_path),
        "execute": args.execute,
    }, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
