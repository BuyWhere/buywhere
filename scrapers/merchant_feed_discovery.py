#!/usr/bin/env python3
"""BUY-76714: discover and validate merchant product feeds.

Finds merchants that already have products, probes common product feed
locations, validates XML/RSS/Atom/sitemap item entries, and records:
merchant_id, feed_url, item_count, validated_at.

DDL is intentionally not performed here. Apply the migration under
migrations/ with ops-ddl before scheduling DB writes.
"""

from __future__ import annotations

import argparse
import concurrent.futures
import csv
import gzip
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable, Optional

try:
    import psycopg2
    import psycopg2.extras
except ImportError:  # pragma: no cover - exercised by runtime environment
    psycopg2 = None

CATALOG_DSN_FILE = Path("/home/paperclip/buywhere-api/data/.catalog_db_url")
DEFAULT_OUTPUT_DIR = Path("/home/paperclip/buywhere-api/data/merchant_feeds")
USER_AGENT = "BuyWhere-FeedDiscovery/1.0 (+https://buywhere.ai)"
MAX_BYTES = 8 * 1024 * 1024
PRODUCT_NAMESPACES = {
    "g": "http://base.google.com/ns/1.0",
    "atom": "http://www.w3.org/2005/Atom",
}
FEED_PATHS = (
    "/products.xml",
    "/feed",
    "/feed.xml",
    "/rss.xml",
    "/collections/all.atom",
    "/sitemap_products_1.xml",
    "/sitemap_products_2.xml",
    "/sitemap_products_3.xml",
    "/sitemap_products.xml",
)


@dataclass
class Merchant:
    merchant_id: str
    domain: str


@dataclass
class FeedResult:
    merchant_id: str
    domain: str
    feed_url: str
    feed_type: str
    item_count: int
    validated_at: str
    last_http_status: Optional[int] = None
    sample_item_url: Optional[str] = None
    sample_item_title: Optional[str] = None
    validation_error: Optional[str] = None

    @property
    def valid(self) -> bool:
        return self.item_count > 0 and not self.validation_error


def utcnow() -> str:
    return datetime.now(timezone.utc).isoformat()


def load_dsn() -> str:
    if os.environ.get("CATALOG_DATABASE_URL"):
        return os.environ["CATALOG_DATABASE_URL"]
    if not CATALOG_DSN_FILE.exists():
        raise RuntimeError(f"Catalog DSN file not found: {CATALOG_DSN_FILE}")
    dsn = CATALOG_DSN_FILE.read_text().strip()
    if "roundhouse.proxy.rlwy.net" in dsn:
        raise RuntimeError("Refusing control-plane roundhouse DSN")
    if "sakura.proxy.rlwy.net" not in dsn and "postgres.railway.internal" not in dsn:
        raise RuntimeError("Refusing non-sakura catalog DSN")
    return dsn


def normalize_domain(value: str) -> Optional[str]:
    if not value:
        return None
    raw = value.strip().lower()
    raw = re.sub(r"^https?://", "", raw)
    raw = raw.split("/")[0].split(":")[0]
    raw = raw.strip(" .")
    if not raw or "." not in raw or raw in {"localhost", "example.com"}:
        return None
    return raw


def fetch_merchants(limit: int, offset: int = 0) -> list[Merchant]:
    if psycopg2 is None:
        raise RuntimeError("psycopg2 is required for DB merchant fetch")
    sql = """
        SELECT DISTINCT p.merchant_id::text AS merchant_id, lower(m.domain) AS domain
        FROM public.products p
        JOIN public.merchants m ON m.id::text = p.merchant_id::text
        WHERE m.domain IS NOT NULL
          AND m.domain <> ''
          AND NOT EXISTS (
              SELECT 1 FROM information_schema.tables t
              WHERE t.table_schema = 'public'
                AND t.table_name = 'merchant_feeds'
          )
        ORDER BY p.merchant_id::text
        LIMIT %s OFFSET %s
    """
    # Use products first: it is huge, but merchant_id is indexed for the drain lane;
    # scanning merchants with EXISTS probes timed out on the live catalog.
    sql_existing_table = """
        SELECT DISTINCT p.merchant_id::text AS merchant_id, lower(m.domain) AS domain
        FROM public.products p
        JOIN public.merchants m ON m.id::text = p.merchant_id::text
        WHERE m.domain IS NOT NULL
          AND m.domain <> ''
          AND NOT EXISTS (
              SELECT 1 FROM public.merchant_feeds mf
              WHERE mf.merchant_id = p.merchant_id::text
          )
        ORDER BY p.merchant_id::text
        LIMIT %s OFFSET %s
    """
    dsn = load_dsn()
    with psycopg2.connect(dsn, connect_timeout=10) as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='merchant_feeds')"
            )
            has_table = cur.fetchone()[0]
        query = sql_existing_table if has_table else sql
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("SET LOCAL statement_timeout = '45s'")
            cur.execute(query, (limit, offset))
            rows = cur.fetchall()
    merchants: list[Merchant] = []
    seen: set[str] = set()
    for row in rows:
        domain = normalize_domain(row["domain"])
        if domain and domain not in seen:
            seen.add(domain)
            merchants.append(Merchant(row["merchant_id"], domain))
    return merchants


def load_merchants_file(path: Path, limit: int) -> list[Merchant]:
    merchants: list[Merchant] = []
    with path.open() as f:
        if path.suffix.lower() == ".csv":
            reader = csv.DictReader(f)
            for row in reader:
                merchant_id = row.get("merchant_id") or row.get("id") or row.get("source") or ""
                domain = normalize_domain(row.get("domain") or row.get("url") or "")
                if merchant_id and domain:
                    merchants.append(Merchant(merchant_id, domain))
                if len(merchants) >= limit:
                    break
        else:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#"):
                    continue
                if line.startswith("{"):
                    row = json.loads(line)
                    merchant_id = row.get("merchant_id") or row.get("id") or row.get("source") or ""
                    domain = normalize_domain(row.get("domain") or row.get("url") or "")
                else:
                    parts = [p.strip() for p in line.split(",")]
                    merchant_id = parts[0] if len(parts) > 1 else parts[0]
                    domain = normalize_domain(parts[1] if len(parts) > 1 else parts[0])
                if merchant_id and domain:
                    merchants.append(Merchant(merchant_id, domain))
                if len(merchants) >= limit:
                    break
    return merchants


def candidate_urls(domain: str) -> Iterable[str]:
    for scheme in ("https", "http"):
        for path in FEED_PATHS:
            yield f"{scheme}://{domain}{path}"


def fetch_url(url: str, timeout: int) -> tuple[int, bytes, str]:
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": USER_AGENT,
            "Accept": "application/xml,text/xml,application/rss+xml,application/atom+xml,*/*;q=0.2",
        },
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        status = getattr(resp, "status", 0) or resp.getcode()
        content_type = resp.headers.get("content-type", "")
        data = resp.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES:
        raise ValueError("response too large")
    if data[:2] == b"\x1f\x8b":
        data = gzip.decompress(data)
    return status, data, content_type


def xml_text(elem: ET.Element, selectors: list[str]) -> Optional[str]:
    for selector in selectors:
        found = elem.find(selector, PRODUCT_NAMESPACES)
        if found is not None and found.text:
            return found.text.strip()
    return None


def parse_feed(data: bytes) -> tuple[str, int, Optional[str], Optional[str]]:
    root = ET.fromstring(data)
    tag = root.tag.lower()

    if tag.endswith("rss") or root.find("channel") is not None:
        items = root.findall("./channel/item")
        if not items:
            return "rss", 0, None, None
        sample = items[0]
        return (
            "rss",
            len(items),
            xml_text(sample, ["link", "g:link"]),
            xml_text(sample, ["title", "g:title"]),
        )

    if tag.endswith("feed"):
        entries = root.findall("atom:entry", PRODUCT_NAMESPACES) or root.findall("entry")
        if not entries:
            return "atom", 0, None, None
        sample = entries[0]
        link = None
        link_elem = sample.find("atom:link", PRODUCT_NAMESPACES)
        if link_elem is None:
            link_elem = sample.find("link")
        if link_elem is not None:
            link = link_elem.attrib.get("href") or (link_elem.text.strip() if link_elem.text else None)
        return (
            "atom",
            len(entries),
            link,
            xml_text(sample, ["atom:title", "title"]),
        )

    if tag.endswith("urlset"):
        urls = root.findall("{*}url") or root.findall("url")
        product_urls = []
        for item in urls:
            loc = xml_text(item, ["{*}loc", "loc"])
            if loc and re.search(r"/(products|product|p)/", loc):
                product_urls.append(loc)
        sample_url = product_urls[0] if product_urls else xml_text(urls[0], ["{*}loc", "loc"]) if urls else None
        return "sitemap", len(product_urls or urls), sample_url, None

    if tag.endswith("item") or tag.endswith("product"):
        return "xml", 1, xml_text(root, ["link", "g:link", "url"]), xml_text(root, ["title", "g:title", "name"])

    return "xml", 0, None, None


def validate_one(merchant: Merchant, timeout: int) -> Optional[FeedResult]:
    last_error = None
    for url in candidate_urls(merchant.domain):
        try:
            status, data, content_type = fetch_url(url, timeout)
            if status != 200:
                last_error = f"HTTP {status}"
                continue
            if not data.lstrip().startswith(b"<"):
                last_error = f"non-XML content-type={content_type[:80]}"
                continue
            feed_type, count, sample_url, sample_title = parse_feed(data)
            if count > 0:
                return FeedResult(
                    merchant_id=merchant.merchant_id,
                    domain=merchant.domain,
                    feed_url=url,
                    feed_type=feed_type,
                    item_count=count,
                    validated_at=utcnow(),
                    last_http_status=status,
                    sample_item_url=sample_url,
                    sample_item_title=sample_title,
                )
            last_error = "XML parsed but no product entries"
        except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError, ET.ParseError, ValueError) as exc:
            last_error = type(exc).__name__
        except Exception as exc:  # keep batch resilient
            last_error = f"unexpected:{type(exc).__name__}"
    return FeedResult(
        merchant_id=merchant.merchant_id,
        domain=merchant.domain,
        feed_url=f"https://{merchant.domain}{FEED_PATHS[0]}",
        feed_type="unknown",
        item_count=0,
        validated_at=utcnow(),
        validation_error=last_error or "no feed found",
    )


def write_outputs(results: list[FeedResult], output_dir: Path) -> tuple[Path, Path]:
    output_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    ndjson = output_dir / f"merchant_feeds_{stamp}.ndjson"
    csv_path = output_dir / f"merchant_feeds_{stamp}.csv"
    valid = [r for r in results if r.valid]
    with ndjson.open("w") as f:
        for result in valid:
            f.write(json.dumps(asdict(result), sort_keys=True) + "\n")
    with csv_path.open("w", newline="") as f:
        writer = csv.DictWriter(
            f,
            fieldnames=[
                "merchant_id",
                "domain",
                "feed_url",
                "feed_type",
                "item_count",
                "validated_at",
                "last_http_status",
                "sample_item_url",
                "sample_item_title",
                "validation_error",
            ],
        )
        writer.writeheader()
        for result in valid:
            writer.writerow(asdict(result))
    return ndjson, csv_path


def upsert_results(results: list[FeedResult]) -> int:
    valid = [r for r in results if r.valid]
    if not valid:
        return 0
    if psycopg2 is None:
        raise RuntimeError("psycopg2 missing")
    dsn = load_dsn()
    sql = """
        INSERT INTO public.merchant_feeds (
            merchant_id, feed_url, feed_type, item_count, validated_at,
            last_http_status, sample_item_url, sample_item_title, validation_error, updated_at
        ) VALUES %s
        ON CONFLICT (merchant_id, feed_url) DO UPDATE SET
            feed_type = EXCLUDED.feed_type,
            item_count = EXCLUDED.item_count,
            validated_at = EXCLUDED.validated_at,
            last_http_status = EXCLUDED.last_http_status,
            sample_item_url = EXCLUDED.sample_item_url,
            sample_item_title = EXCLUDED.sample_item_title,
            validation_error = EXCLUDED.validation_error,
            updated_at = now()
    """
    rows = [
        (
            r.merchant_id,
            r.feed_url,
            r.feed_type,
            r.item_count,
            r.validated_at,
            r.last_http_status,
            r.sample_item_url,
            r.sample_item_title,
            r.validation_error,
        )
        for r in valid
    ]
    with psycopg2.connect(dsn, connect_timeout=10) as conn:
        with conn.cursor() as cur:
            psycopg2.extras.execute_values(cur, sql, rows, page_size=500)
    return len(rows)


def run(args: argparse.Namespace) -> int:
    started = time.monotonic()
    if args.input:
        merchants = load_merchants_file(Path(args.input), args.limit)
    else:
        merchants = fetch_merchants(args.limit, args.offset)
    if not merchants:
        print("No merchants loaded", file=sys.stderr)
        return 2

    results: list[FeedResult] = []
    valid_count = 0
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.concurrency) as pool:
        futures = {pool.submit(validate_one, merchant, args.timeout): merchant for merchant in merchants}
        for i, future in enumerate(concurrent.futures.as_completed(futures), 1):
            result = future.result()
            if result is not None:
                results.append(result)
                if result.valid:
                    valid_count += 1
                    print(
                        f"VALID {valid_count}: {result.merchant_id} {result.feed_url} items={result.item_count}",
                        flush=True,
                    )
            if i % 25 == 0 or i == len(merchants):
                elapsed = max(time.monotonic() - started, 0.1)
                print(f"Progress {i}/{len(merchants)} valid={valid_count} rate={i/elapsed:.1f}/s", flush=True)

    ndjson, csv_path = write_outputs(results, args.output_dir)
    db_rows = 0
    db_error = None
    if not args.no_db:
        try:
            db_rows = upsert_results(results)
        except Exception as exc:
            db_error = f"{type(exc).__name__}: {exc}"

    summary = {
        "issue": "BUY-76714",
        "started_at": datetime.fromtimestamp(time.time() - (time.monotonic() - started), timezone.utc).isoformat(),
        "completed_at": utcnow(),
        "merchants_probed": len(merchants),
        "validated_feeds": valid_count,
        "db_rows_upserted": db_rows,
        "db_error": db_error,
        "ndjson": str(ndjson),
        "csv": str(csv_path),
    }
    summary_path = args.output_dir / "latest_summary.json"
    summary_path.write_text(json.dumps(summary, indent=2, sort_keys=True))
    print(json.dumps(summary, indent=2, sort_keys=True))
    return 0


def main() -> None:
    parser = argparse.ArgumentParser(description="BUY-76714 merchant product feed discovery")
    parser.add_argument("--input", help="Optional CSV/NDJSON/text merchant list; otherwise fetch from catalog DB")
    parser.add_argument("--limit", type=int, default=500, help="Merchants to probe")
    parser.add_argument("--offset", type=int, default=0, help="DB merchant offset")
    parser.add_argument("--concurrency", type=int, default=24, help="Concurrent merchant probes")
    parser.add_argument("--timeout", type=int, default=10, help="Per-feed request timeout seconds")
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR)
    parser.add_argument("--no-db", action="store_true", help="Do not upsert to public.merchant_feeds")
    args = parser.parse_args()
    raise SystemExit(run(args))


if __name__ == "__main__":
    main()
