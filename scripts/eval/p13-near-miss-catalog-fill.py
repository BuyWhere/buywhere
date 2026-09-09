#!/usr/bin/env python3
"""
P1.3-NM Catalog Fill Analyzer — BUY-71136

Reads a nightly near-miss sweep file, reproduces each near-miss query against the
catalog DB (FTS + country + merchant source), validates returned products against
catalog predicates (price|currency|availability|image_url|merchant_url),
aggregates the worst predicate×market×category combinations, and optionally files
child issues.

Run after the 23:55Z sweep (e.g. via cron at 00:30Z):
    SWEEP_DATE=2026-08-19 python3 scripts/eval/p13-near-miss-catalog-fill.py

Options:
    --date YYYY-MM-DD      Sweep date (default: yesterday)
    --sweep-dir PATH       Override sweep directory
    --output-dir PATH      Where to write output files (default: data/sweep/catalog-fill/)
    --file-issues          Actually file child issues via Paperclip API
    --dry-run              Validate and output but do not file
    --limit N              Max near-miss rows to re-query (default: all)
    --parent-id ID         Parent issue identifier (default: BUY-71136)

Dependencies:
    - CATALOG_DB_URL or CATALOG_DATABASE_URL (fleet-secrets or env)
    - Paperclip API: PAPERCLIP_API_KEY, PAPERCLIP_COMPANY_ID, PAPERCLIP_API_URL
    - Catalog DB: products table on sakura proxy (NOT roundhouse)

Output:
    data/sweep/catalog-fill/{date}/top-10-combos.json  — ranked combinations
    data/sweep/catalog-fill/{date}/child-issues/       — ready-to-file issue bodies (MD)
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import sys
import time
import urllib.request
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import psycopg2
from psycopg2 import sql

# ── Configuration ───────────────────────────────────────────────────────────────────

REPO_ROOT = Path(__file__).resolve().parents[2]

DEFAULTS = {
    "sweep_dir": os.environ.get("SWEEP_OUTPUT_DIR") or REPO_ROOT / "data" / "sweep" / "zrr",
    "output_dir": os.environ.get("CATALOG_FILL_OUTPUT_DIR") or REPO_ROOT / "data" / "sweep" / "catalog-fill",
    "mcp_url": os.environ.get("BUYWHERE_MCP_URL") or "https://mcp.buywhere.ai/mcp",
    "catalog_db_url": os.environ.get("CATALOG_DB_URL")
        or os.environ.get("CATALOG_DATABASE_URL")
        or os.environ.get("BUYWHERE_CATALOG_DATABASE_URL")
        or "",
    "paperclip_api_url": os.environ.get("PAPERCLIP_API_URL") or "https://paperclip.richteo.com",
    "paperclip_api_key": os.environ.get("PAPERCLIP_API_KEY") or "",
    "paperclip_company_id": os.environ.get("PAPERCLIP_COMPANY_ID") or "177bc805-e3c8-4336-84cb-8e1e482d5a17",
    "parent_identifier": os.environ.get("PARENT_IDENTIFIER") or "BUY-71136",
}

CONCURRENCY = 2
QUERY_TIMEOUT_MS = 5000  # statement_timeout per cell query
KNOWN_CURRENCIES = {
    "SGD", "USD", "MYR", "VND", "THB", "PHP", "IDR", "AUD", "GBP", "EUR", "JPY",
    "CNY", "HKD", "TWD", "KRW", "INR", "NZD", "SEK", "DKK", "NOK", "CHF", "PLN",
    "CZK", "HUF", "ILS", "AED", "SAR", "QAR", "KWD", "BHD", "OMR", "EGP", "ZAR",
    "NGN", "KES", "GHS", "MAD", "PKR", "BDT", "LKR", "MMK", "KHR", "LAK",
}

# ── Logging ───────────────────────────────────────────────────────────────────────

SWEEP_DATE = ""


def log(msg: str, *args: Any) -> None:
    text = f"[catalog-fill:{SWEEP_DATE}] {msg}"
    if args:
        text = text % args
    print(text, file=sys.stderr)


def now_utc() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def append_log(output_dir: Path, event: str, fields: dict | None = None) -> None:
    try:
        log_path = output_dir / "run.log"
        log_path.parent.mkdir(parents=True, exist_ok=True)
        entry = {"ts": now_utc(), "event": event}
        if fields:
            entry.update(fields)
        with log_path.open("a") as f:
            f.write(json.dumps(entry) + "\n")
    except Exception as e:
        print(f"WARN: failed to append log: {e}", file=sys.stderr)


# ── DB helpers ──────────────────────────────────────────────────────────────────

def get_db_conn(catalog_db_url: str):
    conn = psycopg2.connect(
        catalog_db_url,
        sslmode="require",
        connect_timeout=10,
        application_name="ops-p13-catalog-fill",
    )
    conn.autocommit = True
    with conn.cursor() as cur:
        cur.execute("SET statement_timeout = %s", (QUERY_TIMEOUT_MS,))
        cur.execute("SET lock_timeout = %s", (QUERY_TIMEOUT_MS,))
    return conn


def requery_cell_db(catalog_db_url: str, cell: dict) -> dict:
    """Fetch candidate product rows for one near-miss cell (one connection per call)."""
    market = cell["market"]
    query = cell.get("query", "")
    # Strip site: hint; the DB FTS path evaluates the keyword only.
    base_query = " ".join(part for part in query.split() if not part.lower().startswith("site:"))
    base_query = base_query.strip()

    conn = None
    try:
        conn = get_db_conn(catalog_db_url)
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, sku AS source, source AS domain, merchant_id, url, title,
                       price, currency, image_url, in_stock, is_available,
                       url_status, url_dead_at, country_code, region, is_active, updated_at
                  FROM products
                 WHERE is_active = true
                   AND country_code = %s
                   AND search_vector @@ plainto_tsquery('english', %s)
                 ORDER BY updated_at DESC
                 LIMIT 10
                """,
                (market, base_query),
            )
            rows = cur.fetchall()
            colnames = [desc[0] for desc in cur.description]
            products = [dict(zip(colnames, row)) for row in rows]
            return {
                "cell": cell,
                "products": products,
                "rex_predicate_fails": cell.get("near_miss_predicate_fails") or [],
                "error": None,
            }
    except psycopg2.extensions.QueryCanceledError:
        return {"cell": cell, "products": [], "rex_predicate_fails": cell.get("near_miss_predicate_fails") or [], "error": "query_timeout"}
    except Exception as e:
        return {"cell": cell, "products": [], "rex_predicate_fails": cell.get("near_miss_predicate_fails") or [], "error": str(e)}
    finally:
        if conn is not None:
            try:
                conn.close()
            except Exception:
                pass


# ── Catalog predicate classifier ───────────────────────────────────────────────

def classify_catalog_fails(row: dict) -> list[str]:
    fails = []

    # price: null, zero, negative, or outside BUY-60385 sanitized range (<5 or >10000)
    try:
        amount = float(row.get("price")) if row.get("price") is not None else None
    except (TypeError, ValueError):
        amount = None
    if amount is None or amount <= 0 or amount < 5 or amount > 10000:
        fails.append("price")

    # currency: missing or not in ISO-4217 set
    currency = (row.get("currency") or "").upper()
    if not currency or currency not in KNOWN_CURRENCIES:
        fails.append("currency")

    # availability: both unknown or explicitly false while still active
    in_stock = row.get("in_stock")
    is_available = row.get("is_available")
    if in_stock is None and is_available is None:
        fails.append("availability")
    elif in_stock is False or is_available is False:
        fails.append("availability")

    # image_url: missing or URL marked dead
    image_url = row.get("image_url") or ""
    url_dead_at = row.get("url_dead_at")
    url_status = row.get("url_status")
    if not image_url or url_dead_at or url_status == "dead":
        fails.append("image_url")

    # merchant_url: missing or dead
    merchant_url = row.get("url") or ""
    if not merchant_url or url_dead_at or url_status == "dead":
        fails.append("merchant_url")

    return fails


# ── Issue filing ─────────────────────────────────────────────────────────────────

PATCH_HINTS = {
    "price": (
        "Re-fetch via ingest pipeline. Check the merchant for current price. "
        "If price is genuinely unavailable (out of stock with no price), mark `availability='out_of_stock'` instead.\n\n"
        "**Do not** mark as success if price is still null after re-fetch."
    ),
    "currency": (
        "Fix currency field in the merchant product feed. Expected: SGD/USD/MYR/VND/THB/PHP. "
        "Re-validate via `SELECT id, currency FROM products WHERE id = ANY($1)`."
    ),
    "availability": (
        "Mark `availability='out_of_stock'` for these products. "
        "Run: `UPDATE products SET is_available=false WHERE id = ANY($1);`"
    ),
    "image_url": (
        "Re-scrape image from the merchant. If upstream returns 4xx/5xx, replace with BUY-63954 deterministic SVG placeholder. "
        "**Do not** mark as success until BUY-63507 content probe returns usable.\n\n"
        "Fallback: `UPDATE products SET image_url = NULL WHERE id = ANY($1) AND image_url NOT LIKE 'https://%';`"
    ),
    "merchant_url": (
        "Re-validate product URLs for the merchant. If dead, mark `url_status='dead'`, `url_dead_at=NOW()`. "
        "If URL is stale (redirects), update via ingest re-fetch."
    ),
}


def file_child_issue(combo: dict, sweep_date: str, dry_run: bool, cfg: dict) -> dict:
    predicate = combo["predicate"]
    market = combo["market"]
    category = combo["category"]
    total_fails = combo["total_fails"]
    products = combo["products"]

    slug = f"{predicate}-{market}-{category}".lower()
    slug = "".join(c if c.isalnum() or c == "-" else "-" for c in slug)[:80]
    title = f"[catalog-fill:{predicate}] {market} / {category} — {total_fails} products with {predicate} fail"

    product_ids = [p["id"] for p in products[:50]]
    merchant_counts: dict[str, int] = defaultdict(int)
    for p in products:
        src = p.get("source") or p.get("domain") or "unknown"
        merchant_counts[src] += 1
    top_merchant = max(merchant_counts, key=merchant_counts.get) if merchant_counts else "unknown"
    patch_hint = PATCH_HINTS.get(predicate, f"Investigate {predicate} failure for {top_merchant} products.")

    body = f"""## Catalog Predicate Failure — BUY-71136 child

**Parent:** BUY-71136 [P1.3-NM/catalog-fill] Per-failure child issues
**Sweep date:** {sweep_date}
**Predicate:** `{predicate}`
**Market:** {market}
**Category:** {category}
**Total failing products:** {total_fails} (showing max 50)

## Failing Products

```
{"\n".join(product_ids)}
```

## Diagnosis

{combo['cell_count']} near-miss cell(s) triggered this combination. Top merchant: **{top_merchant}** ({merchant_counts.get(top_merchant, 0)} products).

## Suggested Patch

{patch_hint}

## Owner

Catalog ingestion team (BUY-71136 Oracle)

## Telemetry Round-Trip

Patch closes within 3 sweep cycles. Monitor via `monitoring.v_ceo_kpis.p1_3_nm_status` after each 23:55Z sweep.

---
*Auto-filed by p13-near-miss-catalog-fill.py (BUY-71136)*"""

    if dry_run:
        log("[DRY-RUN] Would file: %s", title)
        return {"identifier": f"DRY-RUN-{int(time.time()*1000)}", "title": title, "body": body, "product_ids": product_ids}

    payload = {
        "title": title,
        "description": body,
        "priority": "high" if total_fails >= 20 else "medium",
        "status": "todo",
        "parentIdentifier": cfg["parent_identifier"],
    }

    base = cfg["paperclip_api_url"].rstrip("/").removesuffix("/api")
    url = f"{base}/api/companies/{cfg['paperclip_company_id']}/issues"

    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {cfg['paperclip_api_key']}",
            "Content-Type": "application/json",
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        identifier = data.get("identifier") or data.get("id") or f"UNKNOWN-{int(time.time()*1000)}"
        log("Filed: %s — %s", identifier, title)
        return {"identifier": identifier, "title": title, "body": body, "product_ids": product_ids}
    except urllib.error.HTTPError as e:
        err = e.read().decode("utf-8")
        log("WARN: Failed to file issue %r: %s", title, err)
        return {"identifier": None, "title": title, "body": body, "product_ids": product_ids, "error": err}
    except Exception as e:
        log("WARN: Issue filing error for %r: %s", title, e)
        return {"identifier": None, "title": title, "body": body, "product_ids": product_ids, "error": str(e)}


# ── Weekly aggregation ─────────────────────────────────────────────────────────────────────

def weekly_mode(args: argparse.Namespace, cfg: dict) -> int:
    """Aggregate the last 7 days of daily top-10 files and file weekly children."""
    global SWEEP_DATE
    today = date.today()
    SWEEP_DATE = today.isoformat()
    date_output_dir = cfg["output_dir"] / SWEEP_DATE
    date_output_dir.mkdir(parents=True, exist_ok=True)

    log("Starting weekly aggregation for window ending %s", SWEEP_DATE)

    combo_map: dict[tuple[str, str, str], dict] = {}
    days_loaded = 0
    for offset in range(7):
        day = today - timedelta(days=offset)
        top10_path = cfg["output_dir"] / day.isoformat() / "top-10-combos.json"
        if not top10_path.exists():
            log("No daily file for %s", day.isoformat())
            continue
        try:
            with top10_path.open() as f:
                data = json.load(f)
        except Exception as e:
            log("WARN: failed to read %s: %s", top10_path, e)
            continue
        days_loaded += 1
        for combo in data.get("combinations", []):
            key = (combo["predicate"], combo["market"], combo["category"])
            agg = combo_map.setdefault(key, {
                "predicate": combo["predicate"],
                "market": combo["market"],
                "category": combo["category"],
                "total_fails": 0,
                "cell_count": 0,
                "products": [],
                "product_ids": set(),
                "rex_predicate_fails": set(),
            })
            agg["total_fails"] += combo.get("total_fails", 0)
            agg["cell_count"] += combo.get("cell_count", 0)
            for p in combo.get("products", []):
                pid = p["id"]
                if pid not in agg["product_ids"]:
                    agg["product_ids"].add(pid)
                    agg["products"].append(p)
            for f in combo.get("rex_predicate_fails", []):
                agg["rex_predicate_fails"].add(f)

    log("Loaded daily files for %d days; aggregated combinations: %d", days_loaded, len(combo_map))

    if not combo_map:
        log("No combinations to file.")
        append_log(date_output_dir, "weekly_no_combinations")
        return 0

    sorted_combos = sorted(combo_map.values(), key=lambda c: c["total_fails"], reverse=True)[:10]
    serializable_combos = []
    for combo in sorted_combos:
        serializable_combos.append({
            "predicate": combo["predicate"],
            "market": combo["market"],
            "category": combo["category"],
            "total_fails": combo["total_fails"],
            "cell_count": combo["cell_count"],
            "products": combo["products"],
            "rex_predicate_fails": sorted(combo["rex_predicate_fails"]),
        })

    log("Weekly top combinations (%d):", len(serializable_combos))
    for combo in serializable_combos:
        log("  %s | %s | %s | %d fails", combo["predicate"], combo["market"], combo["category"], combo["total_fails"])

    top10_path = date_output_dir / "weekly-top-10-combos.json"
    with top10_path.open("w") as f:
        json.dump({
            "sweep_window_end": SWEEP_DATE,
            "generated_at": now_utc(),
            "days_loaded": days_loaded,
            "combinations": serializable_combos,
        }, f, indent=2)

    child_issues_dir = date_output_dir / "weekly-child-issues"
    child_issues_dir.mkdir(parents=True, exist_ok=True)
    filed_results = []
    for combo in serializable_combos:
        result = file_child_issue(combo, f"weekly-{SWEEP_DATE}", args.dry_run, cfg)
        filed_results.append(result)
        slug = f"{combo['predicate']}-{combo['market']}-{combo['category']}".lower()
        slug = "".join(c if c.isalnum() or c == "-" else "-" for c in slug)[:80]
        (child_issues_dir / f"{slug}.md").write_text(result.get("body") or "N/A")

    summary = {
        "sweep_window_end": SWEEP_DATE,
        "generated_at": now_utc(),
        "days_loaded": days_loaded,
        "combinations_filed": len([r for r in filed_results if r.get("identifier") and not r["identifier"].startswith("DRY-RUN")]),
        "combinations_dry_run": len([r for r in filed_results if r.get("identifier", "").startswith("DRY-RUN")]),
        "identifiers": [r["identifier"] for r in filed_results if r.get("identifier")],
    }
    (date_output_dir / "weekly-summary.json").write_text(json.dumps(summary, indent=2))
    append_log(date_output_dir, "weekly_completed", summary)
    log("Done. Summary: %s", json.dumps(summary))
    return 0


# ── Main ─────────────────────────────────────────────────────────────────────

def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="P1.3-NM catalog-fill analyzer")
    parser.add_argument("--date", help="Sweep date YYYY-MM-DD (default: yesterday)")
    parser.add_argument("--sweep-dir", help="Override sweep directory")
    parser.add_argument("--output-dir", help="Override output directory")
    parser.add_argument("--file-issues", action="store_true", help="File child issues via Paperclip API")
    parser.add_argument("--dry-run", action="store_true", help="Do not actually file issues")
    parser.add_argument("--collect-only", action="store_true", help="Collect daily top-10 but do not file")
    parser.add_argument("--weekly", action="store_true", help="Aggregate last 7 days and file weekly top-10")
    parser.add_argument("--limit", type=int, help="Max near-miss rows to process")
    parser.add_argument("--parent-id", help="Parent issue identifier")
    return parser.parse_args()


def main() -> int:
    global SWEEP_DATE
    args = parse_args()

    cfg = {
        "sweep_dir": Path(args.sweep_dir) if args.sweep_dir else Path(DEFAULTS["sweep_dir"]),
        "output_dir": Path(args.output_dir) if args.output_dir else Path(DEFAULTS["output_dir"]),
        "catalog_db_url": DEFAULTS["catalog_db_url"],
        "paperclip_api_url": DEFAULTS["paperclip_api_url"],
        "paperclip_api_key": DEFAULTS["paperclip_api_key"],
        "paperclip_company_id": DEFAULTS["paperclip_company_id"],
        "parent_identifier": args.parent_id or DEFAULTS["parent_identifier"],
    }

    if args.weekly:
        return weekly_mode(args, cfg)

    if args.date:
        SWEEP_DATE = args.date
    else:
        SWEEP_DATE = (date.today() - timedelta(days=1)).isoformat()

    sweep_file = cfg["sweep_dir"] / f"{SWEEP_DATE}.jsonl"
    date_output_dir = cfg["output_dir"] / SWEEP_DATE
    date_output_dir.mkdir(parents=True, exist_ok=True)

    log("Starting catalog-fill analyzer for sweep %s", SWEEP_DATE)
    log("Output dir: %s", date_output_dir)

    if not cfg["catalog_db_url"]:
        log("ERROR: CATALOG_DB_URL / CATALOG_DATABASE_URL not set")
        append_log(date_output_dir, "missing_catalog_db_url")
        return 1

    if not sweep_file.exists():
        log("ERROR: Sweep file not found: %s", sweep_file)
        append_log(date_output_dir, "missing_sweep_file", {"path": str(sweep_file)})
        return 1

    # Read sweep rows
    rows = []
    with sweep_file.open() as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                rows.append(json.loads(line))
            except json.JSONDecodeError:
                continue

    near_miss_rows = [r for r in rows if r.get("near_miss") is True]
    log("Loaded %d sweep rows; near-miss rows: %d", len(rows), len(near_miss_rows))

    if not near_miss_rows:
        log("No near-miss rows to process — nothing to file.")
        append_log(date_output_dir, "no_near_miss_rows")
        return 0

    rows_to_process = near_miss_rows[: args.limit] if args.limit else near_miss_rows

    # Re-query cells via DB with bounded concurrency (one connection per cell)
    log("Starting DB re-query for %d near-miss cells...", len(rows_to_process))
    requery_results: list[dict] = []
    errors = 0
    timeouts = 0
    with ThreadPoolExecutor(max_workers=CONCURRENCY) as executor:
        futures = {executor.submit(requery_cell_db, cfg["catalog_db_url"], cell): cell for cell in rows_to_process}
        for future in as_completed(futures):
            result = future.result()
            requery_results.append(result)
            if result.get("error"):
                errors += 1
                if result["error"] == "query_timeout":
                    timeouts += 1
            if len(requery_results) % 30 == 0 or len(requery_results) == len(rows_to_process):
                log("Re-queried %d/%d near-miss cells (%d errors, %d timeouts)",
                    len(requery_results), len(rows_to_process), errors, timeouts)

    # Classify products
    classified: list[dict] = []
    for result in requery_results:
        cell = result["cell"]
        rex_fails = result.get("rex_predicate_fails") or []
        for product in result.get("products") or []:
            fails = classify_catalog_fails(product)
            if fails:
                classified.append({
                    "product": product,
                    "cell": cell,
                    "rex_predicate_fails": rex_fails,
                    "catalog_fails": fails,
                })

    log("Products with catalog predicate failures: %d", len(classified))

    # Aggregate by predicate × market × category
    combo_map: dict[tuple[str, str, str], dict] = {}
    for item in classified:
        cell = item["cell"]
        product = item["product"]
        for predicate in item["catalog_fails"]:
            key = (predicate, cell["market"], cell["category"])
            combo = combo_map.setdefault(key, {
                "predicate": predicate,
                "market": cell["market"],
                "category": cell["category"],
                "cells": set(),
                "products": [],
                "product_ids": set(),
                "total_fails": 0,
                "rex_predicate_fails": set(),
            })
            combo["cells"].add(f"{cell['market']}/{cell['category']}/{cell.get('merchant_domain', '')}")
            pid = product["id"]
            if pid not in combo["product_ids"]:
                combo["product_ids"].add(pid)
                combo["products"].append(product)
                combo["total_fails"] += 1
            for f in item["rex_predicate_fails"]:
                combo["rex_predicate_fails"].add(f)

    # Sort and take top 10
    sorted_combos = sorted(combo_map.values(), key=lambda c: c["total_fails"], reverse=True)[:10]

    # Serialize for JSON
    serializable_combos = []
    for combo in sorted_combos:
        serializable_combos.append({
            "predicate": combo["predicate"],
            "market": combo["market"],
            "category": combo["category"],
            "total_fails": combo["total_fails"],
            "cell_count": len(combo["cells"]),
            "products": [{"id": p["id"], "source": p.get("source"), "domain": p.get("domain")} for p in combo["products"]],
            "rex_predicate_fails": sorted(combo["rex_predicate_fails"]),
        })

    log("Top combinations (%d):", len(serializable_combos))
    for combo in serializable_combos:
        log("  %s | %s | %s | %d fails | rex: %s",
            combo["predicate"], combo["market"], combo["category"],
            combo["total_fails"], ", ".join(combo["rex_predicate_fails"]) or "n/a")

    # Write top-10 JSON
    top10_path = date_output_dir / "top-10-combos.json"
    with top10_path.open("w") as f:
        json.dump({
            "sweep_date": SWEEP_DATE,
            "generated_at": now_utc(),
            "total_near_miss_cells": len(near_miss_rows),
            "total_products_classified": len(classified),
            "combinations": serializable_combos,
        }, f, indent=2)

    # File child issues only when explicitly requested (daily default = collect-only)
    child_issues_dir = date_output_dir / "child-issues"
    child_issues_dir.mkdir(parents=True, exist_ok=True)
    filed_results = []
    should_file = args.file_issues or args.dry_run
    for combo in sorted_combos:
        serial_combo = next(c for c in serializable_combos
                            if c["predicate"] == combo["predicate"]
                            and c["market"] == combo["market"]
                            and c["category"] == combo["category"])
        if should_file:
            result = file_child_issue(serial_combo, SWEEP_DATE, args.dry_run, cfg)
            filed_results.append(result)
            slug = f"{combo['predicate']}-{combo['market']}-{combo['category']}".lower()
            slug = "".join(c if c.isalnum() or c == "-" else "-" for c in slug)[:80]
            (child_issues_dir / f"{slug}.md").write_text(result.get("body") or "N/A")
        else:
            # Write a stub body for inspection even in collect-only mode
            slug = f"{combo['predicate']}-{combo['market']}-{combo['category']}".lower()
            slug = "".join(c if c.isalnum() or c == "-" else "-" for c in slug)[:80]
            stub = file_child_issue(serial_combo, SWEEP_DATE, True, cfg)
            (child_issues_dir / f"{slug}.md").write_text(stub.get("body") or "N/A")

    # Write summary
    summary = {
        "sweep_date": SWEEP_DATE,
        "generated_at": now_utc(),
        "near_miss_cells": len(near_miss_rows),
        "classified_failures": len(classified),
        "db_errors": errors,
        "db_timeouts": timeouts,
        "combinations_filed": len([r for r in filed_results if r.get("identifier") and not r["identifier"].startswith("DRY-RUN")]),
        "combinations_dry_run": len([r for r in filed_results if r.get("identifier", "").startswith("DRY-RUN")]),
        "identifiers": [r["identifier"] for r in filed_results if r.get("identifier")],
    }
    (date_output_dir / "summary.json").write_text(json.dumps(summary, indent=2))

    append_log(date_output_dir, "completed", {
        "near_miss_cells": len(near_miss_rows),
        "classified_failures": len(classified),
        "combinations_filed": summary["combinations_filed"],
        "db_timeouts": timeouts,
    })

    log("Done. Summary: %s", json.dumps(summary))
    return 0


if __name__ == "__main__":
    sys.exit(main())
