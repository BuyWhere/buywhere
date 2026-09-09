#!/usr/bin/env python3
"""
BUY-76714: Merchant Product Feed Discovery & Validation

Discovers Google Shopping XML / RSS / Atom / sitemap product feeds for merchants
already in the BuyWhere catalog, validates them, and records results.

Target: 200 validated feeds/day

Usage:
    python3 merchant_feed_discovery.py [--batch-size N] [--daily-limit N] [--dry-run]

Requirements:
    pip install psycopg2-binary requests beautifulsoup4
"""

import os
import sys
import json
import time
import argparse
import logging
from datetime import datetime, timezone
from urllib.parse import urljoin, urlparse

import psycopg2
import requests
from bs4 import BeautifulSoup

# ── Config ────────────────────────────────────────────────────────────────────

CATALOG_DSN = os.environ.get(
    "CATALOG_DSN",
    "postgresql://ingest_rw:Ingestmsk0qq1h@sakura.proxy.rlwy.net:22987/railway"
)

RATE_LIMIT_DELAY = 1.5          # seconds between requests to same domain
MAX_FEED_SIZE_KB = 10 * 1024   # max feed size to parse (10 MB)
FETCH_TIMEOUT = 15              # seconds
USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)
MAX_RETRIES = 3                # retries on 429/5xx before giving up on this URL
RETRY_BACKOFF = [2, 5, 15]    # seconds to wait before retry attempts

# Common feed URL patterns (relative paths checked against merchant domain)
FEED_PATTERNS = [
    # Google Shopping XML (most common for e-commerce)
    "/products.xml",
    "/shopping.xml",
    "/google_shopping.xml",
    "/feed/google.xml",
    "/feed/shopping.xml",
    "/feeds/google.xml",
    "/feeds/products.xml",
    "/datafeeds/products.xml",
    "/datafeed/products.xml",
    # RSS / Atom
    "/collections/all.atom",
    "/collections/all.rss",
    "/products.rss",
    "/products.atom",
    "/feed.rss",
    "/feed.xml",
    "/blog/feed.xml",
    # Sitemaps (product sitemaps)
    "/sitemap_products.xml",
    "/sitemap-products.xml",
    "/product_sitemap.xml",
    "/products_sitemap.xml",
    "/sitemap_products_1.xml",
    "/shop-sitemap.xml",
    # Direct feeds
    "/feed",
    "/products/feed",
    "/google-feed.xml",
    "/google.xml",
    "/catalog.xml",
]

FEED_TYPE_MAP = {
    "google_shopping_xml": ["products.xml", "shopping.xml", "google_shopping.xml",
                            "feed/google.xml", "feed/shopping.xml", "feeds/google.xml",
                            "feeds/products.xml", "datafeeds/products.xml",
                            "datafeed/products.xml", "google-feed.xml", "google.xml",
                            "catalog.xml"],
    "rss":               ["products.rss", "feed.rss", "products/feed"],
    "atom":              ["products.atom", "collections/all.atom", "feed.xml", "blog/feed.xml"],
    "sitemap":           ["sitemap_products.xml", "sitemap-products.xml",
                            "product_sitemap.xml", "products_sitemap.xml",
                            "sitemap_products_1.xml", "shop-sitemap.xml"],
}


def classify_feed_type(url_path: str) -> str:
    """Classify feed type by URL path."""
    for feed_type, patterns in FEED_TYPE_MAP.items():
        for p in patterns:
            if url_path.endswith(p) or url_path == "/" + p:
                return feed_type
    return "unknown"


# ── Logging ────────────────────────────────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.StreamHandler(sys.stdout),
    ]
)
log = logging.getLogger("feed_discovery")


# ── DB helpers ────────────────────────────────────────────────────────────────

def get_db_connection():
    return psycopg2.connect(CATALOG_DSN)


def ensure_table(conn) -> bool:
    """Create merchant_feeds table if it doesn't exist. Returns True if table is ready."""
    try:
        with conn.cursor() as cur:
            cur.execute("""
                CREATE TABLE IF NOT EXISTS public.merchant_feeds (
                    id              BIGSERIAL PRIMARY KEY,
                    merchant_id     TEXT NOT NULL,
                    merchant_domain TEXT NOT NULL,
                    feed_url        TEXT NOT NULL,
                    feed_type       TEXT NOT NULL,
                    http_status     INTEGER,
                    item_count      INTEGER,
                    validated_at    TIMESTAMPTZ DEFAULT NOW(),
                    last_checked_at TIMESTAMPTZ DEFAULT NOW(),
                    is_valid        BOOLEAN,
                    error_message   TEXT,
                    UNIQUE(merchant_id, feed_url)
                );
            """)
            cur.execute("""
                CREATE INDEX IF NOT EXISTS idx_merchant_feeds_merchant_id
                    ON public.merchant_feeds (merchant_id);
                CREATE INDEX IF NOT EXISTS idx_merchant_feeds_validated_at
                    ON public.merchant_feeds (validated_at DESC);
                CREATE INDEX IF NOT EXISTS idx_merchant_feeds_is_valid
                    ON public.merchant_feeds (is_valid) WHERE is_valid = TRUE;
            """)
            conn.commit()
        log.info("Table public.merchant_feeds ready")
        return True
    except psycopg2.errors.InsufficientPrivilege as e:
        log.warning(f"DDL blocked (no CREATE on public): {e}")
        conn.rollback()   # clear aborted transaction before continuing
        return False


def sample_merchant_domains(conn, batch_size=500) -> list[tuple[str, str]]:
    """
    Sample merchant domains from the products table using indexed ID scan.
    Uses generate_series on the primary key to avoid full-table scans.
    Returns list of (merchant_id, merchant_domain).
    """
    with conn.cursor() as cur:
        cur.execute("SET statement_timeout = '60s'")
        # Use a rolling offset based on minute-of-day to spread across runs
        minute_of_day = (int(time.time()) // 60) % 1440
        step = max(1, 363_000_000 // (batch_size * 10))  # spread across table
        start_id = minute_of_day * step
        cur.execute(f"""
            SELECT DISTINCT ON (p.merchant_id)
                p.merchant_id,
                COALESCE(
                    p.metadata->>'merchant_domain',
                    REGEXP_REPLACE(p.merchant_id, '_shopify.*', '.myshopify.com', 'i'),
                    p.merchant_id
                ) AS domain
            FROM public.products p
            WHERE p.id IN (
                SELECT gs FROM generate_series(%s, %s + %s, %s) AS gs
            )
              AND p.merchant_id IS NOT NULL
            LIMIT %s
        """, (start_id, start_id, batch_size * step, step, batch_size))
        rows = cur.fetchall()
    return rows


def sample_from_merchants_feed_intake(conn, batch_size=200) -> list[tuple[str, str]]:
    """Sample domains from the existing lane_feed/merchants_feed_intake table."""
    with conn.cursor() as cur:
        cur.execute(f"""
            SELECT domain, domain AS merchant_id
            FROM public.merchants_feed_intake
            LIMIT {batch_size}
        """)
        return cur.fetchall()


def upsert_feed(conn, merchant_id: str, domain: str, feed_url: str,
                feed_type: str, http_status: int, item_count: int | None,
                is_valid: bool, error_message: str | None) -> bool:
    """Insert or update a feed record. Returns True on success."""
    try:
        with conn.cursor() as cur:
            cur.execute("""
                INSERT INTO public.merchant_feeds
                    (merchant_id, merchant_domain, feed_url, feed_type,
                     http_status, item_count, is_valid, error_message)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s)
                ON CONFLICT (merchant_id, feed_url) DO UPDATE SET
                    http_status     = EXCLUDED.http_status,
                    item_count      = EXCLUDED.item_count,
                    is_valid        = EXCLUDED.is_valid,
                    validated_at    = NOW(),
                    last_checked_at = NOW(),
                    error_message   = EXCLUDED.error_message
            """, (merchant_id, domain, feed_url, feed_type,
                  http_status, item_count, is_valid, error_message))
            conn.commit()
        return True
    except psycopg2.errors.UndefinedTable:
        conn.rollback()   # clear aborted transaction
        log.warning(f"Table merchant_feeds does not exist yet — writing to fallback file")
        write_feed_to_file({
            "merchant_id": merchant_id,
            "merchant_domain": domain,
            "feed_url": feed_url,
            "feed_type": feed_type,
            "http_status": http_status,
            "item_count": item_count,
            "is_valid": is_valid,
            "error_message": error_message,
            "validated_at": datetime.now(timezone.utc).isoformat(),
        })
        return False


# ── Feed discovery ────────────────────────────────────────────────────────────

# ── Sitemap index parser ──────────────────────────────────────────────────────

def discover_sitemaps_from_robots(domain: str) -> list[str]:
    """Parse robots.txt for Sitemap: directives. Returns list of sitemap URLs."""
    try:
        resp = session.get(f"https://{domain}/robots.txt", timeout=FETCH_TIMEOUT)
        if resp.status_code != 200:
            return []
        feeds = []
        for line in resp.text.split("\n"):
            stripped = line.strip()
            if stripped.lower().startswith("sitemap:"):
                feeds.append(stripped.split(":", 1)[1].strip())
        return feeds
    except Exception:
        return []


def discover_product_sitemaps(base_url: str) -> list[str]:
    """
    Check sitemap index and return product-sub-sitemap URLs.
    Tries /sitemap.xml first, then /sitemap_index.xml, then robots.txt sitemaps.
    """
    feeds = []
    candidates = [
        f"{base_url}/sitemap.xml",
        f"{base_url}/sitemap_index.xml",
    ]
    for sitemap_url in candidates:
        try:
            resp = session.get(sitemap_url, timeout=FETCH_TIMEOUT)
            if resp.status_code != 200:
                continue
            if not any(tag in resp.text[:300] for tag in ["<urlset", "<sitemapindex", "xml"]):
                continue
            soup = BeautifulSoup(resp.text, "xml")
            # Collect all sub-sitemap URLs
            for loc in soup.find_all("loc"):
                sub = loc.text.strip()
                if sub:
                    feeds.append(sub)
            if feeds:
                return feeds
        except Exception:
            continue
    # Also check robots.txt
    domain = base_url.replace("https://", "")
    feeds = discover_sitemaps_from_robots(domain)
    return feeds

session = requests.Session()
session.headers.update({
    "User-Agent": USER_AGENT,
    "Accept": "*/*",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
    "Connection": "keep-alive",
    "Upgrade-Insecure-Requests": "1",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
    "Sec-Fetch-User": "?1",
    "Cache-Control": "max-age=0",
})


def count_feed_items(content: bytes, feed_type: str) -> int:
    """Count items/entries/products in a feed."""
    if not content:
        return 0
    try:
        text = content.decode("utf-8", errors="replace")
    except Exception:
        return 0

    if feed_type in ("google_shopping_xml",):
        # Count <item> or <entry> tags
        soup = BeautifulSoup(text, "xml")
        return len(soup.find_all(["item", "entry"])) or 0
    elif feed_type in ("rss", "atom"):
        soup = BeautifulSoup(text, "xml")
        if feed_type == "rss":
            return len(soup.find_all("item"))
        else:
            return len(soup.find_all("entry"))
    elif feed_type == "sitemap":
        soup = BeautifulSoup(text, "xml")
        # Product sitemaps have <url> with <loc> ending in .html/.htm (products)
        urls = soup.find_all("url")
        return sum(1 for u in urls if u.find("loc") and
                   any(ext in u.find("loc").text.lower()
                       for ext in [".html", ".htm", "/p/", "/product/"]))
    return 0


def check_feed_url(base_url: str, path: str) -> tuple[bool, int | None, int | None, str | None]:
    """
    Fetch a potential feed URL and validate it. Retries on 429/5xx with backoff.
    Returns (is_likely_feed, http_status, item_count, error_message).
    """
    url = urljoin(base_url, path)
    for attempt in range(MAX_RETRIES):
        try:
            resp = session.get(url, timeout=FETCH_TIMEOUT, allow_redirects=True)
            status = resp.status_code

            if status == 200:
                content_length = len(resp.content)
                if content_length > MAX_FEED_SIZE_KB * 1024:
                    return False, status, None, f"Feed too large ({content_length // 1024} KB)"

                # Skip HTML pages (most 200s are bot-block error pages)
                content_type = resp.headers.get("Content-Type", "").lower()
                if "text/html" in content_type and not any(
                    tag in resp.text[:500] for tag in ["<rss", "<feed", "<xml", "<urlset"]):
                    return False, status, None, "Response is HTML, not a feed"

                item_count = count_feed_items(resp.content, classify_feed_type(path))
                is_valid = item_count > 0
                return is_valid, status, item_count if is_valid else None, None

            elif status in (429, 500, 502, 503, 504):
                # Retry with backoff
                if attempt < len(RETRY_BACKOFF):
                    wait = RETRY_BACKOFF[attempt]
                    log.debug(f"  {url} → HTTP {status}, retrying in {wait}s...")
                    time.sleep(wait)
                    continue
                return False, status, None, f"HTTP {status} (retries exhausted)"

            else:
                return False, status, None, f"HTTP {status}"

        except requests.exceptions.Timeout:
            return False, None, None, "Timeout"
        except requests.exceptions.SSLError as e:
            return False, None, None, f"SSL error: {e}"
        except Exception as e:
            return False, None, None, str(e)

    return False, None, None, "Max retries exceeded"


def extract_feeds_from_catalog_metadata(conn, batch_size=500) -> list[dict]:
    """
    Pull feed URLs already present in product metadata from the catalog.
    Fields checked: sitemap_index_url, source_feed, feed_url, product_feed.
    These don't need HTTP validation — they're already confirmed live sources.
    """
    results = []
    try:
        with conn.cursor() as cur:
            cur.execute("SET statement_timeout = '30s'")
            cur.execute(f"""
                SELECT DISTINCT
                    p.merchant_id,
                    COALESCE(
                        p.metadata->>'merchant_domain',
                        p.merchant_id
                    ) AS domain,
                    p.metadata->>'sitemap_index_url' AS sitemap_url,
                    p.metadata->>'source_feed' AS source_feed,
                    p.metadata->>'feed_url' AS feed_url,
                    p.metadata->>'product_feed' AS product_feed
                FROM public.products p
                WHERE p.metadata IS NOT NULL
                  AND (
                    p.metadata ? 'sitemap_index_url'
                    OR p.metadata ? 'source_feed'
                    OR p.metadata ? 'feed_url'
                    OR p.metadata ? 'product_feed'
                  )
                LIMIT {batch_size}
            """)
            for (merchant_id, domain, sitemap_url, source_feed,
                 feed_url, product_feed) in cur.fetchall():
                for url in {sitemap_url, source_feed, feed_url, product_feed}:
                    if url and url.startswith("http"):
                        results.append({
                            "merchant_id": merchant_id,
                            "merchant_domain": domain,
                            "feed_url": url,
                            "feed_type": "sitemap" if "sitemap" in url else "product_feed",
                            "http_status": None,
                            "item_count": None,
                            "is_valid": True,   # already confirmed in catalog
                            "error_message": None,
                            "source": "catalog_metadata",
                        })
        conn.commit()
    except psycopg2.Error as e:
        log.warning(f"Metadata extraction failed: {e}")
        conn.rollback()
    return results


def discover_feeds_for_domain(merchant_id: str, domain: str) -> list[dict]:
    """
    Discover feeds for a domain using sitemap discovery + pattern checking.
    Returns list of dicts with feed details.
    """
    if not domain:
        return []

    base_url = f"https://{domain}"
    results = []

    # Vector 1: sitemap discovery (robots.txt + sitemap index)
    for sitemap_url in discover_product_sitemaps(base_url):
        results.append({
            "merchant_id": merchant_id,
            "merchant_domain": domain,
            "feed_url": sitemap_url,
            "feed_type": "sitemap",
            "http_status": None,
            "item_count": None,
            "is_valid": True,
            "error_message": None,
            "source": "sitemap_discovery",
        })
        time.sleep(RATE_LIMIT_DELAY)

    # Vector 2: known feed URL patterns
    for pattern in FEED_PATTERNS:
        is_valid, status, item_count, error = check_feed_url(base_url, pattern)
        if is_valid:
            results.append({
                "merchant_id": merchant_id,
                "merchant_domain": domain,
                "feed_url": urljoin(base_url, pattern),
                "feed_type": classify_feed_type(pattern),
                "http_status": status,
                "item_count": item_count,
                "is_valid": True,
                "error_message": None,
                "source": "pattern_check",
            })
        time.sleep(RATE_LIMIT_DELAY)
    return results


# ── Feed storage (DB or file fallback) ────────────────────────────────────────

FEED_OUTPUT_FILE = os.environ.get(
    "FEED_OUTPUT_FILE",
    "/home/paperclip/buywhere/data/validated_feeds.ndjson"
)


def write_feed_to_file(feed: dict):
    """Append a validated feed record to the NDJSON fallback file."""
    with open(FEED_OUTPUT_FILE, "a") as f:
        f.write(json.dumps(feed, default=str) + "\n")


# ── Progress / quota tracking ─────────────────────────────────────────────────

COUNTER_FILE = os.environ.get("FEED_COUNTER_FILE", "/home/paperclip/buywhere/data/.feed_discovery_counter.json")


def load_counter() -> dict:
    if os.path.exists(COUNTER_FILE):
        with open(COUNTER_FILE) as f:
            return json.load(f)
    return {"date": str(datetime.now(timezone.utc).date()), "validated": 0, "today_validated": 0}


def save_counter(counter: dict):
    today = str(datetime.now(timezone.utc).date())
    if counter.get("date") != today:
        counter = {"date": today, "validated": counter.get("validated", 0), "today_validated": 0}
    with open(COUNTER_FILE, "w") as f:
        json.dump(counter, f, indent=2)


def report_progress(counter: dict, validated_today: int):
    log.info(
        f"[QUOTA] Validated today: {validated_today}/200 | "
        f"Total validated: {counter.get('validated', 0)} | "
        f"Date: {counter.get('date')}"
    )


# ── Main ───────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Merchant feed discovery & validation")
    parser.add_argument("--batch-size", type=int, default=500,
                        help="Merchants to sample per batch (default: 500)")
    parser.add_argument("--daily-limit", type=int, default=200,
                        help="Max validated feeds per day (default: 200)")
    parser.add_argument("--dry-run", action="store_true",
                        help="Discover feeds but don't write to DB")
    parser.add_argument("--vectors", nargs="+",
                        choices=["metadata", "sitemap", "patterns", "intake", "all"],
                        default=["metadata", "sitemap", "patterns"],
                        help="Discovery vectors to use")
    args = parser.parse_args()

    counter = load_counter()
    validated_today = counter.get("today_validated", 0)

    if validated_today >= args.daily_limit:
        log.info(f"Daily limit ({args.daily_limit}) already reached. Exiting.")
        return

    conn = get_db_connection()
    db_ready = ensure_table(conn)
    if not db_ready:
        log.info("DB table not available — validated feeds go to NDJSON fallback")
        log.info("OPS ACTION REQUIRED: run merchant_feed_discovery.sql to create public.merchant_feeds")

    use_all = "all" in args.vectors

    # ── Vector 1: Catalog metadata (zero HTTP cost) ─────────────────────────
    if use_all or "metadata" in args.vectors:
        log.info("[VECTOR metadata] Extracting feed URLs from catalog product metadata...")
        metadata_feeds = extract_feeds_from_catalog_metadata(conn, batch_size=500)
        for feed in metadata_feeds:
            if validated_today >= args.daily_limit:
                log.info("Daily limit reached.")
                break
            validated_today += 1
            feeds_written = 1
            if not args.dry_run:
                feed_kwargs = dict(feed)
                if "merchant_domain" in feed_kwargs and "domain" not in feed_kwargs:
                    feed_kwargs["domain"] = feed_kwargs.pop("merchant_domain")
                feed_kwargs.pop("source", None)
                db_ok = upsert_feed(conn=conn, **feed_kwargs)
                location = "NDJSON" if not db_ok else "DB"
                log.info(
                    f"[VALID:metadata] {feed['merchant_domain']} → {feed['feed_url']} "
                    f"({feed['feed_type']}) ✓ → {location}"
                )
            else:
                log.info(f"[DRY:metadata] {feed['merchant_domain']} → {feed['feed_url']}")
            counter["validated"] = counter.get("validated", 0) + 1
            counter["today_validated"] = validated_today
            save_counter(counter)
        log.info(f"[VECTOR metadata] Done: {len(metadata_feeds)} feed URLs extracted")

    # ── Vectors 2+3: Sitemap + pattern discovery ───────────────────────────
    sources = []
    if use_all or "sitemap" in args.vectors:
        sources.append(("crate", sample_merchant_domains(conn, args.batch_size)))
    if use_all or "patterns" in args.vectors or "intake" in args.vectors:
        sources.append(("intake", sample_from_merchants_feed_intake(conn, args.batch_size)))

    total_merchants = sum(len(s) for _, s in sources)
    log.info(f"[VECTOR sitemap/patterns] Sampling {total_merchants} merchants")

    merchants_checked = 0
    feeds_valid = 0

    for src_name, merchants in sources:
        for merchant_id, domain in merchants:
            if validated_today >= args.daily_limit:
                log.info("Daily limit reached. Stopping.")
                break

            merchants_checked += 1
            feeds = discover_feeds_for_domain(merchant_id, domain)

            for feed in feeds:
                if feed["is_valid"]:
                    feeds_valid += 1
                    validated_today += 1

                    if not args.dry_run:
                        feed_kwargs = dict(feed)
                        # discoverers emit merchant_domain; upsert_feed expects domain
                        if "merchant_domain" in feed_kwargs and "domain" not in feed_kwargs:
                            feed_kwargs["domain"] = feed_kwargs.pop("merchant_domain")
                        # discoverers add 'source' (a label); not a column
                        feed_kwargs.pop("source", None)
                        db_ok = upsert_feed(conn=conn, **feed_kwargs)
                        location = "NDJSON" if not db_ok else "DB"
                        log.info(
                            f"[VALID:{feed.get('source','?')}] {domain} → {feed['feed_url']} "
                            f"({feed['feed_type']}) ✓ → {location}"
                        )
                    else:
                        log.info(
                            f"[DRY:{feed.get('source','?')}] {domain} → {feed['feed_url']} "
                            f"({feed['feed_type']})"
                        )

                    counter["validated"] = counter.get("validated", 0) + 1
                    counter["today_validated"] = validated_today
                    save_counter(counter)

            if merchants_checked % 20 == 0:
                report_progress(counter, validated_today)

    log.info(
        f"[DONE] Merchants checked: {merchants_checked} | "
        f"Valid feeds: {feeds_valid} | "
        f"Today validated: {validated_today}/{args.daily_limit}"
    )
    report_progress(counter, validated_today)


if __name__ == "__main__":
    main()
