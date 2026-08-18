#!/usr/bin/env python3
"""
P2.6 No-Data Catalog Fill Analyzer — BUY-71545

Reads a nightly sweep file, finds cells with emptiness_reason=no_data that are in the
canonical basket (225 cells defined by BUY-71131), and files catalog-fill tickets
scoped to that query/region.

This is the P2.6 sibling of the P1.3-NM catalog-fill (BUY-52807/71136).

Run after the 23:55Z sweep (e.g. via cron at 00:30Z):
    SWEEP_DATE=2026-08-18 python3 scripts/eval/p26-no-data-catalog-fill.py

Options:
    --date YYYY-MM-DD      Sweep date (default: yesterday)
    --sweep-dir PATH       Override sweep directory
    --output-dir PATH      Where to write output files (default: data/sweep/no-data-fill/)
    --file-issues          Actually file child issues via Paperclip API
    --dry-run              Validate and output but do not file
    --limit N              Max no_data rows to process (default: all)

Dependencies:
    - CATALOG_DB_URL or CATALOG_DATABASE_URL (fleet-secrets or env)
    - Paperclip API: PAPERCLIP_API_KEY, PAPERCLIP_COMPANY_ID, PAPERCLIP_API_URL

Output:
    data/sweep/no-data-fill/{date}/no-data-cells.json — filtered no_data cells
    data/sweep/no-data-fill/{date}/child-issues/       — ready-to-file issue bodies (MD)
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.request
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any

# ── Configuration ───────────────────────────────────────────────────────────────────

REPO_ROOT = Path(__file__).resolve().parents[2]

DEFAULTS = {
    "sweep_dir": os.environ.get("SWEEP_OUTPUT_DIR") or REPO_ROOT / "data" / "sweep" / "zrr",
    "output_dir": os.environ.get("NO_DATA_FILL_OUTPUT_DIR") or REPO_ROOT / "data" / "sweep" / "no-data-fill",
    "paperclip_api_url": os.environ.get("PAPERCLIP_API_URL") or "https://paperclip.richteo.com",
    "paperclip_api_key": os.environ.get("PAPERCLIP_API_KEY") or "",
    "paperclip_company_id": os.environ.get("PAPERCLIP_COMPANY_ID") or "177bc805-e3c8-4336-84cb-8e1e482d5a17",
    "parent_identifier": os.environ.get("PARENT_IDENTIFIER") or "BUY-71545",
}

# Canonical basket: 225 cells = 7 markets × 5 categories × 3 query lengths (per BUY-71131)
# This is the subset of the full sweep that Oracle must fill when empty.
CANONICAL_MARKETS = {"SG", "US", "MY", "TH", "VN", "ID", "PH"}
CANONICAL_CATEGORIES = {"electronics", "fashion", "home", "health", "sports"}
CANONICAL_QUERY_LENGTHS = {"short", "medium", "long"}

# Query templates (must match p13-near-miss-sweep.mjs)
QUERY_TEMPLATES = {
    "electronics": {"short": "laptop", "medium": "gaming laptop", "long": "gaming laptop 15 inch rgb"},
    "fashion": {"short": "shirt", "medium": "cotton t-shirt", "long": "mens cotton t-shirt slim fit"},
    "home": {"short": "lamp", "medium": "table lamp", "long": "led table lamp adjustable brightness"},
    "health": {"short": "vitamins", "medium": "vitamin d3", "long": "vitamin d3 1000 iu supplement"},
    "sports": {"short": "shoes", "medium": "running shoes", "long": "mens running shoes breathable lightweight"},
}

# Map cell back to canonical query for deduplication
def cell_to_canonical_key(cell: dict) -> str | None:
    """Generate canonical key for deduplication: market/category/query_length."""
    market = cell.get("market", "").upper()
    category = (cell.get("category") or "").lower()
    query_length = cell.get("query_length", "") or cell.get("queryLength", "") or ""

    if market not in CANONICAL_MARKETS:
        return None
    if category not in CANONICAL_CATEGORIES:
        return None
    if query_length not in CANONICAL_QUERY_LENGTHS:
        return None

    return f"{market}/{category}/{query_length}"


def is_canonical_cell(cell: dict) -> bool:
    """Check if cell is in the canonical 225-cell basket."""
    return cell_to_canonical_key(cell) is not None


# ── Logging ───────────────────────────────────────────────────────────────────────

SWEEP_DATE = ""


def log(msg: str, *args: Any) -> None:
    text = f"[p26-no-data:{SWEEP_DATE}] {msg}"
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


# ── Issue filing ─────────────────────────────────────────────────────────────────

def file_child_issue(cell: dict, sweep_date: str, dry_run: bool, cfg: dict) -> dict:
    """File a catalog-fill issue for a no_data cell."""
    market = cell.get("market", "")
    category = cell.get("category", "")
    query_length = cell.get("query_length") or cell.get("queryLength", "unknown")
    query = cell.get("query", "")

    # Extract emptiness_reason and confidence from the cell
    emptiness_reason = cell.get("emptiness_reason", "no_data")
    confidence = cell.get("confidence", 0.0)

    # Build unique slug
    slug = f"no-data-{market}-{category}-{query_length}".lower()
    slug = "".join(c if c.isalnum() or c == "-" else "-" for c in slug)[:80]
    title = f"[catalog-fill:P2.6] {market} / {category} / {query_length} — no_data ({query})"

    body = f"""## No-Data Catalog Fill — P2.6 — BUY-71545 child

**Parent:** BUY-71545 [P2.6] Oracle catalog-fill trigger
**Sweep date:** {sweep_date}
**Trigger:** `emptiness_reason={emptiness_reason}` + canonical basket query
**Market:** {market}
**Category:** {category}
**Query length:** {query_length}
**Query:** {query}

## Diagnostic

- **emptiness_reason:** `{emptiness_reason}`
- **confidence:** {confidence}
- **Result count:** {cell.get('result_count', 0)}
- **Latency (ms):** {cell.get('latency_ms', 'N/A')}
- **Error:** {cell.get('error', 'none')}

## Why Oracle Owns This

P2.6 spec §5: When the 225-cell nightly sweep records `emptiness_reason=no_data`
AND the query is in the canonical basket (defined by BUY-71131), Oracle must
auto-file a catalog-fill ticket scoped to that query/region.

This ticket includes the `emptiness_reason` and `confidence` fields so the ingest
worker knows it's a P2.6 trigger, not a generic gap report.

## Suggested Action

1. Identify merchants in {market} for category: {category}
2. Check if current ingest pipeline covers these merchants
3. If gap exists, file merchant ingestion or scraping ticket
4. Verify coverage within 3 sweep cycles

## Owner

Oracle (CDO) — Catalog ingestion team

## Telemetry

Monitor via `monitoring.sweep_results` after each 23:55Z sweep.
Target: zero no_data cells in canonical basket by 2026-12-31.

---
*Auto-filed by p26-no-data-catalog-fill.py (BUY-71545)*"""

    if dry_run:
        log("[DRY-RUN] Would file: %s", title)
        return {"identifier": f"DRY-RUN-{int(time.time()*1000)}", "title": title, "body": body}

    payload = {
        "title": title,
        "description": body,
        "priority": "high",
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
        return {"identifier": identifier, "title": title, "body": body}
    except urllib.error.HTTPError as e:
        err = e.read().decode("utf-8")
        log("WARN: Failed to file issue %r: %s", title, err)
        return {"identifier": None, "title": title, "body": body, "error": err}
    except Exception as e:
        log("WARN: Issue filing error for %r: %s", title, e)
        return {"identifier": None, "title": title, "body": body, "error": str(e)}


# ── Main ─────────────────────────────────────────────────────────────────────

def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="P2.6 no-data catalog-fill analyzer")
    parser.add_argument("--date", help="Sweep date YYYY-MM-DD (default: yesterday)")
    parser.add_argument("--sweep-dir", help="Override sweep directory")
    parser.add_argument("--output-dir", help="Override output directory")
    parser.add_argument("--file-issues", action="store_true", help="File child issues via Paperclip API")
    parser.add_argument("--dry-run", action="store_true", help="Do not actually file issues")
    parser.add_argument("--limit", type=int, help="Max no_data rows to process")
    parser.add_argument("--parent-id", help="Parent issue identifier")
    return parser.parse_args()


def main() -> int:
    global SWEEP_DATE
    args = parse_args()

    cfg = {
        "sweep_dir": Path(args.sweep_dir) if args.sweep_dir else Path(DEFAULTS["sweep_dir"]),
        "output_dir": Path(args.output_dir) if args.output_dir else Path(DEFAULTS["output_dir"]),
        "paperclip_api_url": DEFAULTS["paperclip_api_url"],
        "paperclip_api_key": DEFAULTS["paperclip_api_key"],
        "paperclip_company_id": DEFAULTS["paperclip_company_id"],
        "parent_identifier": args.parent_id or DEFAULTS["parent_identifier"],
    }

    if args.date:
        SWEEP_DATE = args.date
    else:
        SWEEP_DATE = (date.today() - timedelta(days=1)).isoformat()

    sweep_file = cfg["sweep_dir"] / f"{SWEEP_DATE}.jsonl"
    date_output_dir = cfg["output_dir"] / SWEEP_DATE
    date_output_dir.mkdir(parents=True, exist_ok=True)

    log("Starting P2.6 no-data catalog-fill analyzer for sweep %s", SWEEP_DATE)
    log("Output dir: %s", date_output_dir)

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

    log("Loaded %d sweep rows", len(rows))

    # Filter: zero-result cells with emptiness_reason=no_data
    no_data_cells = []
    for row in rows:
        result_count = row.get("result_count", 0)
        emptiness_reason = row.get("emptiness_reason")

        # Zero-result cell with no_data reason
        if result_count == 0 and emptiness_reason == "no_data":
            no_data_cells.append(row)

    log("Zero-result cells with emptiness_reason=no_data: %d", len(no_data_cells))

    # Filter: canonical basket only
    canonical_no_data = [c for c in no_data_cells if is_canonical_cell(c)]
    log("Canonical basket no_data cells: %d", len(canonical_no_data))

    # Deduplicate by canonical key (one issue per cell)
    seen_keys = set()
    unique_cells = []
    for cell in canonical_no_data:
        key = cell_to_canonical_key(cell)
        if key and key not in seen_keys:
            seen_keys.add(key)
            unique_cells.append(cell)

    log("Unique canonical no_data cells (deduplicated): %d", len(unique_cells))

    # Enforce ≤225 limit (acceptance gate)
    if len(unique_cells) > 225:
        log("WARN: %d cells exceeds 225 limit; truncating", len(unique_cells))
        unique_cells = unique_cells[:225]

    if not unique_cells:
        log("No canonical no_data cells to file.")
        append_log(date_output_dir, "no_canonical_no_data_cells")
        return 0

    # Write filtered cells
    cells_path = date_output_dir / "no-data-cells.json"
    with cells_path.open("w") as f:
        json.dump({
            "sweep_date": SWEEP_DATE,
            "generated_at": now_utc(),
            "total_no_data_cells": len(no_data_cells),
            "canonical_no_data_cells": len(canonical_no_data),
            "unique_cells": len(unique_cells),
            "cells": unique_cells,
        }, f, indent=2)

    # File child issues
    child_issues_dir = date_output_dir / "child-issues"
    child_issues_dir.mkdir(parents=True, exist_ok=True)

    filed_results = []
    cells_to_process = unique_cells[:args.limit] if args.limit else unique_cells

    should_file = args.file_issues or args.dry_run
    for cell in cells_to_process:
        result = file_child_issue(cell, SWEEP_DATE, args.dry_run, cfg)
        filed_results.append(result)

        slug = f"no-data-{cell.get('market','')}-{cell.get('category','')}-{cell.get('query_length','')}".lower()
        slug = "".join(c if c.isalnum() or c == "-" else "-" for c in slug)[:80]
        (child_issues_dir / f"{slug}.md").write_text(result.get("body") or "N/A")

    # Write summary
    summary = {
        "sweep_date": SWEEP_DATE,
        "generated_at": now_utc(),
        "total_no_data_cells": len(no_data_cells),
        "canonical_no_data_cells": len(canonical_no_data),
        "unique_cells": len(unique_cells),
        "cells_filed": len([r for r in filed_results if r.get("identifier") and not r["identifier"].startswith("DRY-RUN")]),
        "cells_dry_run": len([r for r in filed_results if r.get("identifier", "").startswith("DRY-RUN")]),
        "identifiers": [r["identifier"] for r in filed_results if r.get("identifier")],
    }
    (date_output_dir / "summary.json").write_text(json.dumps(summary, indent=2))

    append_log(date_output_dir, "completed", {
        "total_no_data_cells": len(no_data_cells),
        "canonical_no_data_cells": len(canonical_no_data),
        "cells_filed": summary["cells_filed"],
    })

    log("Done. Summary: %s", json.dumps(summary))
    return 0


if __name__ == "__main__":
    sys.exit(main())
