#!/usr/bin/env python3
"""Ingest buy30620 lane cycle NDJSON outputs into the catalog and write
``.ingested.json`` markers per BUY-33177.

Background
----------
buy30620 lane scripts (Crate / Hunt 2 / Scout / Stock) produce cycle-N
NDJSON files under ``data/buy30620-<lane>/`` but do NOT call
``upsert_products()`` directly, and the R2 teardown helper in
``scripts/lib/lane_r2_teardown.mjs`` is failing because R2 credentials
are not present in the lane environment. As a result zero
``*.ingested.json`` markers exist, and the safe-data-cleanup.sh routine
falls back to Gate B3 (catalog sample, 30+ seconds per file on a 36M
catalog) — unusable.

This script closes the loop:

    1. Discover every ``cycle-*.ndjson`` under the configured buy30620
       data directories that does NOT yet have a sibling
       ``.ingested.json`` marker.
    2. Parse the NDJSON into canonical product records.
    3. Upsert into ``public.products`` (idempotent ON CONFLICT
       (sku, source) DO UPDATE) using ``data/.catalog_db_url``.
    4. Call ``finalize_marker()`` from ``scripts/ingested_marker`` so a
       v2 marker is written next to the file with the
       ``ingest.records/inserted/errors/partial`` block. This is the
       BUY-33096 / BUY-33127 shape that ``safe-data-cleanup.sh`` Gate B
       and Gate D both consume.

Usage
-----
::

    # dry-run: parse + validate, no DB writes, no marker writes
    python3 scripts/ingest_buy30620_lanes.py --dry-run

    # live: upsert + marker (require_r2 per default; pass
    # --no-require-r2 to allow marker when R2 creds are absent)
    python3 scripts/ingest_buy30620_lanes.py

    # one lane only
    python3 scripts/ingest_buy30620_lanes.py --lane crate

    # explicit files
    python3 scripts/ingest_buy30620_lanes.py --file data/buy30620-crate/cycle-1-...ndjson

Environment
-----------
``data/.catalog_db_url`` is the canonical catalog DB URL — the same
file the JS ``ingest.mjs`` reads. Override with ``--catalog-file``.

R2 credentials are read from the standard env vars consumed by
``scripts.ingested_marker.upload_to_r2``. If absent, ``finalize_marker``
skips the upload and, with ``require_r2=False``, still writes a v2
marker with ``r2Error`` set (legacy path per the marker module docs).
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
from pathlib import Path
from typing import Any, Iterable, Iterator

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from scripts.ingested_marker import finalize_marker, marker_path_for  # noqa: E402


DEFAULT_LANES: tuple[str, ...] = ("crate", "hunt2", "scout", "stock")
SOURCE_BY_LANE: dict[str, str] = {
    "crate": "shopify_buy30620_crate",
    "hunt2": "shopify_buy30620_crate",  # 2026-08-28: canonical label — hunt2 re-inserted 498/500 crate twins,
    "scout": "shopify_buy30620_crate",  # 2026-08-28: canonical label,
    "stock": "shopify_buy30620_crate",  # 2026-08-28: canonical label,
}

# BUY-42681: add WHERE clause to skip title update when unchanged.
# Before: title=EXCLUDED.title fired trg_products_search_vector on every
# conflict row (to_tsvector computation + lock), even when title was
# identical.  With IS DISTINCT FROM the trigger only fires on real changes.
# The GIN index idx_products_active_fts is indisready=false (per BUY-32878),
# so the trigger was doing wasted CPU work on every row.
UPSERT_SQL = """
INSERT INTO products
  (sku, source, merchant_id, title, price, currency, url,
   description, image_url, category, is_active, is_available,
   platform, region, country_code, in_stock, created_at, updated_at,
   metadata)
VALUES %s
ON CONFLICT (sku, source) DO UPDATE SET
  title = EXCLUDED.title,
  price = EXCLUDED.price,
  url = EXCLUDED.url,
  currency = EXCLUDED.currency,
  is_available = true,
  in_stock = COALESCE(EXCLUDED.in_stock, products.in_stock),
  updated_at = NOW(),
  metadata = COALESCE(products.metadata, '{}'::jsonb) || EXCLUDED.metadata
WHERE products.title IS DISTINCT FROM EXCLUDED.title
   OR products.price IS DISTINCT FROM EXCLUDED.price
   OR products.url IS DISTINCT FROM EXCLUDED.url
   OR products.currency IS DISTINCT FROM EXCLUDED.currency
   OR products.in_stock IS DISTINCT FROM EXCLUDED.in_stock
   OR products.is_available IS NOT TRUE
   -- churn fix (BUY storage): metadata carries a per-scrape ingested_at timestamp,
   -- so comparing it defeated the no-op skip and re-wrote every row every scrape
   -- (~1M dead tuples/hr -> bloat -> volume fills). Only update on real field changes.
"""


def _num(v: Any) -> float | None:
    if v is None or v == "":
        return None
    try:
        n = float(str(v).replace(",", ""))
    except (TypeError, ValueError):
        return None
    if n is None or n != n or abs(n) == float("inf"):
        return None
    # Clamp to numeric(12,2) range: -9999999999.99 to 9999999999.99
    MAX_PRICE = 9999999999.99
    if abs(n) > MAX_PRICE:
        n = MAX_PRICE if n > 0 else -MAX_PRICE
    return n


def _sanitize(v: Any) -> Any:
    """Strip NUL characters from text fields - PostgreSQL does not accept NUL in strings."""
    if v is None:
        return None
    if isinstance(v, str):
        return v.replace("\x00", "")
    return v


def _host(u: str | None) -> str | None:
    if not u:
        return None
    try:
        from urllib.parse import urlparse
        h = urlparse(u).hostname or ""
        return h.lower().lstrip("www.") or None
    except Exception:
        return None


def _slug(s: str | None) -> str:
    s = s or ""
    return re.sub(r"[^a-z0-9]+", "_", s.lower()).strip("_")


def normalize(record: dict[str, Any], lane: str) -> dict[str, Any] | None:
    """Map a buy30620 lane NDJSON record to a products row dict.

    Returns None when the record lacks the minimum required fields
    (sku, source, merchant_id, title, url). The lane's
    ``discovery_source`` (e.g. ``shopify_buy30620_crate``) is the
    authoritative ``source`` value used for the (sku, source) conflict
    key — keeping it stable lets re-ingests hit ON CONFLICT and merge
    in place.
    """
    if not isinstance(record, dict):
        return None
    source = (
        record.get("discovery_source")
        or record.get("source")
        or SOURCE_BY_LANE.get(lane)
        or "shopify"
    )
    source = str(source).strip() or "shopify"
    # 2026-08-28 (Richmond): every Shopify lane label is the SAME store listing under a different name; the unique
    # key is (sku, source), so a non-canonical label re-inserts the row. 27-28 Aug: 961K twins of crate rows.
    if source in ("shopify_buy30620_hunt2", "shopify_buy30620_stock", "shopify_buy30620_scout", "shopify_buy30620_crate"):
        source = "shopify_buy30620_crate"  # CANONICAL_LANE_SOURCE
    title = (record.get("title") or record.get("name") or "").strip()
    url = (record.get("url") or record.get("product_url") or "").strip()
    if not title or not url:
        return None
    domain = record.get("merchant_domain") or record.get("domain") or _host(url)
    sku_raw = record.get("id") or record.get("sku") or record.get("handle")
    if sku_raw is None or str(sku_raw).strip() == "":
        return None
    sku_raw = str(sku_raw).strip()
    sku = f"{domain}:{sku_raw}" if domain else sku_raw
    merchant_id = (
        record.get("merchant_id")
        or record.get("vendor")
        or (f"{_slug(source)}_{_slug(domain)}" if domain else None)
    )
    if not merchant_id:
        return None
    price = _num(record.get("price"))
    currency = str(record.get("currency") or "").strip().upper()[:3]
    if not re.fullmatch(r"[A-Z]{3}", currency):
        return None
    description = record.get("description") or record.get("body_html")
    image_url = record.get("image_url") or record.get("image")
    category = record.get("product_type") or record.get("category")
    in_stock = record.get("in_stock")
    if isinstance(in_stock, str):
        in_stock = in_stock.lower() in ("true", "1", "yes", "in_stock")
    metadata = {
        k: v for k, v in {
            "lane": lane,
            "merchant_domain": domain,
            "vendor": record.get("vendor"),
            "product_type": record.get("product_type"),
            "handle": record.get("handle"),
            "ingested_at": record.get("ingested_at"),
            "buy30620_issue": "BUY-33177",
        }.items() if v is not None
    }
    return {
        "sku": sku,
        "source": source,
        "merchant_id": merchant_id,
        "title": title,
        "price": price if price is not None else 0,
        "currency": currency,
        "url": url,
        "description": description,
        "image_url": image_url,
        "category": category,
        "is_active": True,
        "is_available": True,
        "in_stock": in_stock if isinstance(in_stock, bool) else None,
        "platform": "shopify",
        "region": None,
        "country_code": None,
        "metadata": metadata,
    }


def load_ndjson(path: Path) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    with path.open("r", encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            try:
                out.append(json.loads(line))
            except json.JSONDecodeError:
                continue
    return out


def iter_cycle_files(roots: dict[str, Path], only: Iterable[Path] | None = None) -> Iterator[tuple[str, Path]]:
    if only is not None:
        for p in only:
            if not p.is_file():
                continue
            lane = _lane_for(p, roots)
            if lane:
                yield lane, p
        return
    pat = re.compile(r"^cycle-.*\.ndjson$")
    for lane, root in roots.items():
        if not root.is_dir():
            continue
        # Only match .ndjson files (not .ndjson.ingested.json markers),
        # skip empty files, and sort oldest first by mtime.
        for child in sorted(
            (c for c in root.iterdir()
             if c.is_file()
             and pat.match(c.name)
             and c.stat().st_size > 0),
            key=lambda p: p.stat().st_mtime
        ):
                yield lane, child


def marker_has_ingest(path: Path) -> bool:
    marker = marker_path_for(path)
    if not marker.is_file():
        return False
    try:
        data = json.loads(marker.read_text(encoding="utf-8"))
    except Exception:
        return False
    ingest = data.get("ingest")
    return isinstance(ingest, dict) and "records" in ingest and "inserted" in ingest


def _lane_for(p: Path, roots: dict[str, Path]) -> str | None:
    parts = p.parts
    for lane, root in roots.items():
        if str(root) in str(p) or root.name in parts:
            return lane
    return None


def _lane_roots(repo_root: Path, lanes: Iterable[str]) -> dict[str, Path]:
    return {lane: repo_root / "data" / f"buy30620-{lane}" for lane in lanes}


# BUY-43546: drain-friendly GUCs (mirrors 7fb55262/ingest_buy30620_lanes.py)
# without these, the upstream script that buy30620-catchup.sh shells out to
# pays full GIN pending-list flush + WAL fsync cost on every batch, which is
# why the catchup drainers were deadlocking the 7fb55262/ops-drain-svc drainers
# on the same GIN index pages.
_DRAIN_PERF_SQL = (
    "SET synchronous_commit = off; "
    "SET gin_pending_list_limit = '64MB'; "
    "SET statement_timeout = 0; "
    # BUY-43546: lock_timeout = 0 (cluster default; see Hex script for
    # rationale — the 5s I had pre-advisory-lock was a deadlock escape
    # that now just causes spurious failures against the still-running
    # OLD catchup drainers).
    "SET lock_timeout = 0; "
    "SET idle_in_transaction_session_timeout = '5min'; "
)

# BUY-76730: replaced global lock with per-source locks. The global lock
# serialized ALL product inserts across all merchants, creating a convoy
# bottleneck. Now we derive a lock ID from the source name hash, allowing
# concurrent inserts from different sources while still serializing per-source
# (to avoid GIN pending-list contention within a single source).
# The hash maps source strings to lock IDs in range [81000, 81999].
def _source_to_lock_id(source: str) -> int:
    """Derive advisory lock ID from source name for per-source serialization."""
    import hashlib
    h = int(hashlib.md5(source.encode()).hexdigest()[:8], 16)
    return 81000 + (h % 1000)


def _get_lock_sql(source: str) -> str:
    """Generate per-source advisory lock SQL."""
    lock_id = _source_to_lock_id(source)
    return f"SELECT pg_advisory_xact_lock({lock_id})"


def upsert_rows(rows: list[dict[str, Any]], db_url: str) -> int:
    """Idempotent INSERT ... ON CONFLICT (sku, source) DO UPDATE.

    Builds an explicit multi-row VALUES list with positional ``%s``
    placeholders (one row's worth per tuple) and passes a flat
    parameter list to ``cursor.execute``. Batch size 1000 matches the
    7fb55262 drain variant; BATCH 500 was the pre-BUY-43399 default.
    """
    if not rows:
        return 0
    import psycopg2
    # BUY-57499: dedupe within batch by (sku, source, country_code) to avoid
    # "ON CONFLICT DO UPDATE cannot affect row a second time" errors when the
    # same SKU+source appears multiple times with different country_code values.
    seen = set()
    deduped = []
    for r in rows:
        key = (r.get("sku"), r.get("source"), r.get("country_code"))
        if key not in seen:
            seen.add(key)
            deduped.append(r)
    rows = deduped
    inserted_total = 0
    BATCH = 1000
    head, tail = UPSERT_SQL.split("VALUES %s", 1)

    def connect():
        # keepalives give us a faster failure signal if the proxy reaps the
        # socket, instead of waiting for the next UPSERT to surface the SSL
        # error.
        conn = psycopg2.connect(
            db_url,
            keepalives=1,
            keepalives_idle=30,
            keepalives_interval=10,
            keepalives_count=3,
        )
        cur = conn.cursor()
        # BUY-43546: per-connection drain GUCs (synchronous_commit=off is the
        # single biggest win — every UPSERT no longer waits for WAL fsync).
        cur.execute(_DRAIN_PERF_SQL)
        conn.commit()
        return conn, cur

    conn, cur = connect()
    # Extract source from first row for per-source locking (BUY-76730)
    source = rows[0].get("source", "default") if rows else "default"
    try:
        for i in range(0, len(rows), BATCH):
            chunk = rows[i : i + BATCH]
            values: list[Any] = []
            row_placeholders: list[str] = []
            for r in chunk:
                row_placeholders.append(
                    "(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,NOW(),NOW(),%s::jsonb)"
                )
                values.extend([
                    _sanitize(r["sku"]),
                    _sanitize(r["source"]),
                    _sanitize(r["merchant_id"]),
                    _sanitize(r["title"]),
                    r["price"],
                    r["currency"],
                    r["url"],
                    _sanitize(r.get("description")),
                    r.get("image_url"),
                    _sanitize(r.get("category")),
                    r.get("is_active", True),
                    r.get("is_available", True),
                    r.get("platform"),
                    r.get("region"),
                    r.get("country_code"),
                    r.get("in_stock"),
                    json.dumps(r.get("metadata") or {}),
                ])
            sql = head + "VALUES " + ",".join(row_placeholders) + tail
            # BUY-57862/BUY-58381: Railway proxy can cut long-lived PG sessions
            # during very large file drains. Commit after each 1000-row batch so
            # a SIGTERM/retry preserves completed batches, and reacquire the
            # xact-scoped advisory lock for each batch.
            max_retries = 5
            for attempt in range(1, max_retries + 1):
                try:
                    # BUY-76730: per-source advisory lock instead of global 81520
                    cur.execute(_get_lock_sql(source))
                    cur.execute(sql, values)
                    inserted_total += cur.rowcount if cur.rowcount and cur.rowcount > 0 else len(chunk)
                    conn.commit()
                    break  # success
                except Exception as exc:  # noqa: BLE001
                    batch_index = (i // BATCH) + 1
                    try:
                        conn.rollback()
                    except Exception:
                        pass
                    if attempt == max_retries:
                        print(f"  upsert batch error (offset {i}, size {len(chunk)}, after {max_retries} attempts): {exc}", file=sys.stderr)
                        raise
                    # Connection was likely dropped by the Railway proxy
                    # mid-batch. Reconnect and retry the same batch. ON CONFLICT
                    # DO UPDATE is idempotent so the re-run lands safely.
                    print(f"[retry] reconnect after batch {batch_index} (offset={i}, size={len(chunk)}): {exc}", file=sys.stderr)
                    try:
                        cur.close()
                    except Exception:
                        pass
                    try:
                        conn.close()
                    except Exception:
                        pass
                    import time
                    time.sleep(min(2 ** attempt, 15))
                    conn, cur = connect()
    finally:
        try:
            cur.close()
        except Exception:
            pass
        try:
            conn.close()
        except Exception:
            pass
    return inserted_total


def _connectable(db_url: str) -> bool:
    import psycopg2
    try:
        with psycopg2.connect(db_url, connect_timeout=8) as c:
            with c.cursor() as cur:
                cur.execute("SELECT 1")
                cur.fetchone()
        return True
    except Exception as exc:  # noqa: BLE001
        print(f"  catalog not reachable: {exc}", file=sys.stderr)
        return False


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true",
                    help="Parse + count; do not upsert, do not write markers.")
    ap.add_argument("--no-require-r2", action="store_true",
                    help="Pass require_r2=False to finalize_marker (write marker even without R2 evidence).")
    ap.add_argument("--catalog-file", type=Path,
                    default=REPO_ROOT / "data" / ".catalog_db_url",
                    help="Path to the catalog DB URL file (default: data/.catalog_db_url).")
    ap.add_argument("--data-root", type=Path, default=REPO_ROOT,
                    help="Workspace root (default: <repo>). buy30620 data lives under <data-root>/data/buy30620-<lane>.")
    ap.add_argument("--lane", action="append", choices=DEFAULT_LANES, default=None,
                    help="Restrict to one or more lanes (default: all four).")
    ap.add_argument("--file", action="append", type=Path, default=None,
                    help="Explicit NDJSON file(s) to ingest (overrides lane discovery).")
    ap.add_argument("--max-files", type=int, default=0,
                    help="Optional cap on files processed (0 = no cap).")
    ap.add_argument("--skip-existing-marker", action="store_true", default=True,
                    help="Skip files that already have a sibling .ingested.json marker (default: True).")
    ap.add_argument("--no-skip-existing-marker", dest="skip_existing_marker", action="store_false")
    ap.add_argument("--limit", type=int, default=0,
                    help="Optional cap on records per file (0 = no cap; useful for smoke tests).")
    ap.add_argument("--min-age-sec", type=int, default=0,
                    help="Skip files whose mtime is within this many seconds of now (avoids racing a live writer).")
    ap.add_argument("--writer", default="ingest_buy30620_lanes.py:BUY-33177",
                    help="Writer tag recorded in the marker.")
    ap.add_argument("--report-file", type=str, default=None,
                    help="(compat) unused - kept so drain-supervisor stays green")
    args = ap.parse_args()

    if not args.catalog_file.is_file():
        print(f"ABORT: catalog URL file missing: {args.catalog_file}", file=sys.stderr)
        return 2
    db_url = args.catalog_file.read_text().strip()
    if not db_url:
        print(f"ABORT: catalog URL file is empty: {args.catalog_file}", file=sys.stderr)
        return 2

    lanes = tuple(args.lane) if args.lane else DEFAULT_LANES
    roots = _lane_roots(args.data_root, lanes)

    explicit = [Path(p).resolve() for p in (args.file or [])] or None

    files = list(iter_cycle_files(roots, only=explicit))
    if not files:
        print("No cycle-*.ndjson files found under:", file=sys.stderr)
        for lane, root in roots.items():
            print(f"  {lane}: {root}", file=sys.stderr)
        return 0

    if args.skip_existing_marker:
        before = len(files)
        files = [(lane, p) for lane, p in files if not marker_has_ingest(p)]
        skipped = before - len(files)
        if skipped:
            print(f"Skipping {skipped} files that already have DB ingest markers.")

    if args.min_age_sec > 0:
        cutoff = time.time() - args.min_age_sec
        before = len(files)
        files = [(lane, p) for lane, p in files if p.stat().st_mtime < cutoff]
        skipped = before - len(files)
        if skipped:
            print(f"Skipping {skipped} files with mtime within {args.min_age_sec}s (live writer race guard).")

    if not files:
        print("Nothing to ingest (all files already have markers or all are too fresh).")
        return 0

    if args.max_files:
        files = files[: args.max_files]

    if not args.dry_run and not _connectable(db_url):
        print("ABORT: catalog DB unreachable; refusing to ingest.", file=sys.stderr)
        return 3

    summary = {
        "files_seen": len(files),
        "files_ingested": 0,
        "files_partial": 0,
        "files_skipped_empty": 0,
        "records_parsed": 0,
        "records_inserted": 0,
        "markers_written": 0,
        "markers_suppressed": 0,
        "by_lane": {lane: {"files": 0, "records": 0, "inserted": 0, "markers": 0} for lane in lanes},
        "started_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "writer": args.writer,
        "dry_run": bool(args.dry_run),
        "require_r2": not args.no_require_r2,
    }

    require_r2 = not args.no_require_r2
    print(f"ingest_buy30620_lanes: {len(files)} files, dry_run={args.dry_run}, require_r2={require_r2}")
    for idx, (lane, ndjson_path) in enumerate(files, 1):
        records_raw = load_ndjson(ndjson_path)
        if args.limit:
            records_raw = records_raw[: args.limit]
        if not records_raw:
            summary["files_skipped_empty"] += 1
            continue
        normalized = []
        skipped_in_file = 0
        for rec in records_raw:
            row = normalize(rec, lane)
            if row is None:
                skipped_in_file += 1
                continue
            normalized.append(row)
        if not normalized:
            summary["files_skipped_empty"] += 1
            print(f"  [{idx}/{len(files)}] {lane} {ndjson_path.name}: 0 valid records of {len(records_raw)}")
            continue
        summary["records_parsed"] += len(records_raw)
        if args.dry_run:
            print(f"  [{idx}/{len(files)}] {lane} {ndjson_path.name}: dry-run, {len(normalized)}/{len(records_raw)} rows would upsert")
            summary["files_ingested"] += 1
            summary["by_lane"][lane]["files"] += 1
            summary["by_lane"][lane]["records"] += len(normalized)
            continue
        try:
            inserted = upsert_rows(normalized, db_url)
        except Exception as exc:  # noqa: BLE001
            print(f"  [{idx}/{len(files)}] {lane} {ndjson_path.name}: UPSERT FAILED: {exc}", file=sys.stderr)
            continue
        error_count = max(0, len(records_raw) - inserted)
        marker_summary = finalize_marker(
            ndjson_path,
            record_count=len(records_raw),
            inserted=inserted,
            errors=error_count,
            writer=f"{args.writer}:{lane}",
            require_r2=require_r2,
        )
        summary["files_ingested"] += 1
        summary["records_inserted"] += inserted
        if marker_summary.get("markerWritten"):
            summary["markers_written"] += 1
            summary["by_lane"][lane]["markers"] += 1
        else:
            summary["markers_suppressed"] += 1
        if marker_summary.get("partial"):
            summary["files_partial"] += 1
        summary["by_lane"][lane]["files"] += 1
        summary["by_lane"][lane]["records"] += len(records_raw)
        summary["by_lane"][lane]["inserted"] += inserted
        size_mb = ndjson_path.stat().st_size / (1024 * 1024)
        print(
            f"  [{idx}/{len(files)}] {lane} {ndjson_path.name}: "
            f"{len(records_raw)} records → {inserted} inserted, "
            f"marker={'written' if marker_summary.get('markerWritten') else 'suppressed'} "
            f"({marker_summary.get('error') or 'ok'}) [{size_mb:.1f} MB]"
        )

    summary["finished_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    print("\n=== ingest_buy30620_lanes summary ===")
    print(json.dumps(summary, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
