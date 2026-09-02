"""Fail-fast guard: bulk writers may only touch the BuyWhere catalog DB (maglev).

Added 2026-08-03 after the roundhouse incident: a git-tracked data/.catalog_db_url
pointing at the Paperclip control DB was materialized by a fresh clone, and
scrapers bulk-wrote the catalog into the control plane until its volume filled.

Two independent checks, both mandatory before any bulk write:
  1. The connection URL's host must be REQUIRED_HOST — no other host, no fallback.
  2. The connected database must pass the sentinel: a `products` table with
     reltuples >= 100M (only the real catalog is that large).

Any failure raises WrongDatabaseError (a SystemExit): abort, never write.
"""
import os
from pathlib import Path
from urllib.parse import urlsplit

REQUIRED_HOST = "sakura.proxy.rlwy.net"
MIN_PRODUCTS_RELTUPLES = 100_000_000
SENTINEL_SQL = (
    "SELECT COALESCE(max(reltuples), 0) FROM pg_class "
    "WHERE relname = 'products' AND relkind IN ('r', 'p')"
)
_REPO_ROOT = Path(__file__).resolve().parent


class WrongDatabaseError(SystemExit):
    pass


def _fail(msg: str):
    raise WrongDatabaseError(
        "CATALOG GUARD ABORT: %s — only %s is a valid bulk-write target; "
        "refusing to write." % (msg, REQUIRED_HOST)
    )


def assert_catalog_url(url: str, source: str = "") -> str:
    """Layer 1: the URL must point at the maglev proxy host."""
    try:
        host = urlsplit(url).hostname or ""
    except ValueError:
        host = ""
    if host != REQUIRED_HOST:
        _fail("DB URL from %s points at host %r" % (source or "caller", host))
    return url


def resolve_catalog_url(driver: str = "") -> str:
    """Resolve the catalog DB URL and host-assert it.

    Order: DATABASE_URL / CATALOG_DB_URL env (asserted, never silently replaced),
    else data/.catalog_db_url next to this file. No hardcoded fallback exists.
    driver: optional sqlalchemy driver suffix, e.g. "asyncpg".
    """
    url = os.environ.get("DATABASE_URL") or os.environ.get("CATALOG_DB_URL")
    source = "env DATABASE_URL/CATALOG_DB_URL"
    if not url:
        dsn_file = _REPO_ROOT / "data" / ".catalog_db_url"
        if not dsn_file.exists():
            _fail("no DATABASE_URL env and %s is missing" % dsn_file)
        url = dsn_file.read_text().strip()
        source = str(dsn_file)
    assert_catalog_url(url, source)
    if driver:
        if url.startswith("postgresql://"):
            url = url.replace("postgresql://", "postgresql+%s://" % driver, 1)
        if driver == "asyncpg":  # asyncpg rejects libpq's sslmode param
            url = url.replace("?sslmode=", "?ssl=").replace("&sslmode=", "&ssl=")
    return url


def assert_catalog_cursor(cur):
    """Layer 2 (psycopg2 et al.): sentinel check on an open cursor."""
    cur.execute(SENTINEL_SQL)
    n = float(cur.fetchone()[0] or 0)
    if n < MIN_PRODUCTS_RELTUPLES:
        _fail("sentinel failed: products reltuples=%.0f < %d — this is not the catalog DB"
              % (n, MIN_PRODUCTS_RELTUPLES))


async def assert_catalog_async_engine(engine):
    """Layer 2 (sqlalchemy async engine): sentinel check."""
    from sqlalchemy import text
    async with engine.connect() as conn:
        n = float((await conn.execute(text(SENTINEL_SQL))).scalar() or 0)
    if n < MIN_PRODUCTS_RELTUPLES:
        _fail("sentinel failed: products reltuples=%.0f < %d — this is not the catalog DB"
              % (n, MIN_PRODUCTS_RELTUPLES))


async def assert_catalog_asyncpg(conn):
    """Layer 2 (raw asyncpg connection): sentinel check."""
    n = float(await conn.fetchval(SENTINEL_SQL) or 0)
    if n < MIN_PRODUCTS_RELTUPLES:
        _fail("sentinel failed: products reltuples=%.0f < %d — this is not the catalog DB"
              % (n, MIN_PRODUCTS_RELTUPLES))
