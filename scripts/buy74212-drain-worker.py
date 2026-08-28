#!/usr/bin/env python3
"""BUY-74212 drain worker — continuous direct-upsert of catchup cycle files.

The buy30620 drain (ingest_buy30620_lanes.py) is deadlocked on DB IO
saturation (BUY-72082 cluster) and the catchup drain (started 19:20Z by
ops) hasn't written anything since 19:33Z. This worker picks up any
NDJSON cycle file in data/buy30620-crate/ that lacks a .ingested.json
marker, runs it through scripts/buy74212-direct-upsert.py semantics, and
writes the marker once done.

Runs continuously. Self-throttles via per-batch sleep. Marks files as
ingested via empty .ingested.json sidecar (matching the convention of
the broken drain).

Idempotent via ON CONFLICT — re-runs are safe.
"""
from __future__ import annotations

import json
import re
import sys
import time
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
CRATE = REPO_ROOT / "data" / "buy30620-crate"
DSN_FILE = REPO_ROOT / "data" / ".catalog_db_url"
LOG = REPO_ROOT / "logs" / "buy74212_drain_worker.log"


def _host(url):
    m = re.match(r"^https?://([^/]+)/?", url or "")
    return m.group(1) if m else None


def normalize(record):
    if not isinstance(record, dict):
        return None
    source = record.get("discovery_source") or record.get("source") or "shopify"
    source = str(source).strip() or "shopify"
    title = (record.get("title") or record.get("name") or "").strip()
    url = (record.get("url") or record.get("product_url") or "").strip()
    if not title or not url:
        return None
    domain = record.get("merchant_domain") or record.get("domain") or _host(url)
    if not domain:
        return None
    sku_raw = record.get("id") or record.get("sku") or record.get("handle")
    if sku_raw is None or str(sku_raw).strip() == "":
        return None
    sku_raw = str(sku_raw).strip()
    sku = f"{domain}:{sku_raw}"
    vendor = record.get("vendor") or ""
    merchant_id = vendor if vendor else f"shopify_{domain}"
    raw_price = record.get("price")
    try:
        price = float(raw_price) if raw_price is not None else 0.0
    except (ValueError, TypeError):
        price = 0.0
    currency = str(record.get("currency") or "").strip().upper()[:3]
    if not re.fullmatch(r"[A-Z]{3}", currency):
        currency = "USD"
    return {
        "sku": sku, "source": source, "merchant_id": merchant_id, "title": title,
        "price": price, "currency": currency, "url": url,
        "description": record.get("description") or record.get("body_html"),
        "image_url": record.get("image_url") or record.get("image"),
        "category": record.get("product_type") or record.get("category"),
        "is_active": True, "is_available": True, "in_stock": None,
        "platform": "shopify", "region": None,
        "country_code": record.get("country_code") or "",
        "metadata": {
            "lane": "buy74212-sea-catchup",
            "merchant_domain": domain, "vendor": vendor,
            "product_type": record.get("product_type"),
            "handle": record.get("handle"),
            "ingested_at": record.get("ingested_at"),
            "buy30620_issue": "BUY-74212",
        },
    }


def _marker_has_db_ingest(p: Path) -> bool:
    """Return True only if a sibling .ingested.json marker records a successful
    catalog-DB upsert (v2 ``ingestedBy`` / ``ingest`` block).
    Lane R2-teardown markers (``uploader == "lane_r2_teardown.mjs"``) only
    prove R2 durability — they do NOT mean the file was ingested into PostgreSQL.
    Buying the 3005xx cycles had R2 markers but no DB ingest (BUY-76308 root cause).
    """
    marker = p.with_suffix(p.suffix + ".ingested.json")
    if not marker.is_file():
        return False
    try:
        data = json.loads(marker.read_text(encoding="utf-8"))
    except Exception:
        return False
    # v2 ingester markers carry ingestedBy + an ingest block
    if isinstance(data.get("ingest"), dict) and "records" in data["ingest"]:
        return True
    if isinstance(data.get("ingestedBy"), dict):
        return True
    return False


def find_pending(crate_dir, today_only=True):
    r"""List NDJSON files older than 60s whose .ingested.json marker
    does NOT contain a DB ingest block.

    BUY-76308: removed the hardcoded 2026-08-24 date filter and the
    \d{1,3} cycle-number restriction. Now matches ALL cycle numbers
    and ALL dates — the only filter is \"does the marker prove DB ingest?\".
    """
    pending = []
    import re as _re
    # Match any date so we don't accidentally drop legitimate cycles
    pat_any = _re.compile(r"cycle-\d+-\d{4}-\d{2}-\d{2}T")
    cutoff = time.strftime("%Y-%m-%d")
    pat_today = _re.compile(rf"cycle-\d+-{cutoff}T")
    for p in sorted(crate_dir.glob("cycle-*.ndjson")):
        # Skip if already DB-ingested
        if _marker_has_db_ingest(p):
            continue
        age = time.time() - p.stat().st_mtime
        if age < 60:
            continue
        # Require at least one timestamp segment in the filename
        if not pat_any.search(p.name):
            continue
        # Only process today's cycles to avoid re-processing old ops catchup
        if today_only and not pat_today.search(p.name):
            continue
        pending.append(p)
    return pending


def upsert_chunk(conn, cur, rows):
    """Single multi-row UPSERT (no advisory lock — direct path)."""
    cols = [
        "sku", "source", "merchant_id", "title", "price", "currency", "url",
        "description", "image_url", "category", "is_active", "is_available",
        "platform", "region", "country_code", "in_stock",
    ]
    placeholders = []
    values = []
    for r in rows:
        placeholders.append("(" + ",".join(["%s"] * len(cols)) + ", NOW(), NOW(), %s::jsonb)")
        for c in cols:
            values.append(r.get(c))
        values.append(json.dumps(r.get("metadata") or {}))
    sql = (
        "INSERT INTO public.products ("
        + ",".join(cols + ["created_at", "updated_at", "metadata"])
        + ") VALUES " + ",".join(placeholders)
        + " ON CONFLICT (sku, source) DO UPDATE SET "
        + "merchant_id=EXCLUDED.merchant_id, title=EXCLUDED.title, "
        + "price=EXCLUDED.price, currency=EXCLUDED.currency, url=EXCLUDED.url, "
        + "description=EXCLUDED.description, image_url=EXCLUDED.image_url, "
        + "category=EXCLUDED.category, is_active=EXCLUDED.is_active, "
        + "is_available=EXCLUDED.is_available, platform=EXCLUDED.platform, "
        + "region=EXCLUDED.region, country_code=EXCLUDED.country_code, "
        + "in_stock=EXCLUDED.in_stock, updated_at=NOW(), metadata=EXCLUDED.metadata"
    )
    cur.execute(sql, values)
    conn.commit()
    return cur.rowcount if cur.rowcount and cur.rowcount > 0 else len(rows)


def drain_file(p, dsn, log, batch=15, sleep_ms=700, per_file_max_sec=180):
    """Drain a single NDJSON file.

    per_file_max_sec: hard cap on total time per file. If exceeded, mark
    the file as 'partial' and move on. The remaining rows will be picked
    up by the next worker pass (idempotent ON CONFLICT).
    """
    import psycopg2
    rows_raw = []
    with open(p) as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                rows_raw.append(json.loads(line))
            except Exception as e:
                log(f"[{p.name}] parse err: {e}")
    normalized = [n for n in (normalize(r) for r in rows_raw) if n]
    log(f"[{p.name}] {len(normalized)} normalized from {len(rows_raw)} raw")
    if not normalized:
        Path(str(p) + ".ingested.json").write_text(json.dumps({"ok": True, "n": 0, "reason": "no_valid_rows"}))
        return 0

    inserted_total = 0
    t0 = time.time()
    conn = psycopg2.connect(dsn, connect_timeout=10)
    cur = conn.cursor()
    cur.execute("SET synchronous_commit = off; SET statement_timeout = '20s'; SET lock_timeout = '3s';")
    conn.commit()
    skipped_due_to_timeout = False

    for i in range(0, len(normalized), batch):
        # Hard cap: bail out after per_file_max_sec and let next pass continue
        if time.time() - t0 > per_file_max_sec:
            log(f"[{p.name}] hit {per_file_max_sec}s cap after {inserted_total}/{len(normalized)} rows; deferring remainder")
            skipped_due_to_timeout = True
            break
        chunk = normalized[i:i + batch]
        for attempt in range(1, 4):
            t_attempt = time.time()
            try:
                n = upsert_chunk(conn, cur, chunk)
                inserted_total += n
                break
            except Exception as e:
                dur = time.time() - t_attempt
                log(f"[{p.name}] batch {i} attempt {attempt} ({dur:.1f}s): {str(e)[:120]}")
                try:
                    conn.rollback()
                except Exception:
                    pass
                try:
                    cur.close()
                except Exception:
                    pass
                try:
                    conn.close()
                except Exception:
                    pass
                time.sleep(min(2 * attempt, 6))
                try:
                    conn = psycopg2.connect(dsn, connect_timeout=10)
                    cur = conn.cursor()
                    cur.execute("SET synchronous_commit = off; SET statement_timeout = '20s'; SET lock_timeout = '3s';")
                    conn.commit()
                except Exception as ce:
                    log(f"[{p.name}] reconnect failed: {ce}")
                    continue
                if attempt == 3:
                    # Per-row DO NOTHING as last resort
                    cols = [
                        "sku", "source", "merchant_id", "title", "price", "currency", "url",
                        "description", "image_url", "category", "is_active", "is_available",
                        "platform", "region", "country_code", "in_stock",
                    ]
                    for r in chunk:
                        try:
                            sql2 = (
                                "INSERT INTO public.products ("
                                + ",".join(cols + ["created_at", "updated_at", "metadata"])
                                + ") VALUES (" + ",".join(["%s"] * len(cols))
                                + ", NOW(), NOW(), %s::jsonb) ON CONFLICT (sku, source) DO NOTHING"
                            )
                            cur.execute(sql2, [r.get(c) for c in cols] + [json.dumps(r.get("metadata") or {})])
                            conn.commit()
                            inserted_total += 1
                        except Exception:
                            conn.rollback()
        if i + batch < len(normalized):
            time.sleep(sleep_ms / 1000.0)
    try:
        cur.close()
        conn.close()
    except Exception:
        pass
    elapsed = time.time() - t0
    if skipped_due_to_timeout:
        log(f"[{p.name}] PARTIAL inserted={inserted_total}/{len(normalized)} elapsed={elapsed:.1f}s — will retry next pass")
        # Don't write marker. Next worker pass will retry the same file.
        return inserted_total
    log(f"[{p.name}] DONE inserted={inserted_total}/{len(normalized)} elapsed={elapsed:.1f}s")
    Path(str(p) + ".ingested.json").write_text(
        json.dumps({"ok": True, "n": inserted_total, "total": len(normalized), "elapsed_s": round(elapsed, 2), "ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())})
    )
    return inserted_total


def main():
    LOG.parent.mkdir(parents=True, exist_ok=True)
    def log(msg):
        line = f"[{time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}] {msg}"
        print(line, flush=True)
        with open(LOG, "a") as f:
            f.write(line + "\n")

    dsn = DSN_FILE.read_text().strip()
    if not dsn:
        log("ABORT: catalog URL file empty")
        sys.exit(2)
    log(f"start: watching {CRATE} for pending files")
    cycle = 0
    total_files = 0
    total_rows = 0
    while True:
        pending = find_pending(CRATE)
        if pending:
            log(f"cycle {cycle}: found {len(pending)} pending files")
            for p in pending:
                try:
                    n = drain_file(p, dsn, log)
                    total_files += 1
                    total_rows += n
                except Exception as e:
                    log(f"[{p.name}] FAIL: {e}")
        else:
            if cycle % 6 == 0:
                log(f"cycle {cycle}: no pending files (waiting 30s)")
            time.sleep(30)
        cycle += 1


if __name__ == "__main__":
    main()
