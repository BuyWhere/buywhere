#!/usr/bin/env python3
"""Write a sampled row into data_quality_metrics.

BUY-79344: persist_catalog_quality_snapshot() had zero callers and the
previous snapshot script was deleted, so DQM froze on 2026-05-06.

This runner MUST use TABLESAMPLE + LIMIT. A full-catalog SELECT on ~370M
active products will lock out ingest. total_products is INTEGER and cannot
store the live catalog size — live COUNT goes in per_platform_scores.

Schedule (Oracle / ops — Sigil must not provision Railway/systemd):
  python scripts/catalog_quality_snapshot.py

Env: DATABASE_URL / BUYWHERE_DATABASE_URL (sakura catalog only; never roundhouse).
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


FORBIDDEN_HOST_MARKERS = ("roundhouse", "paperclip")


def _dsn_ok(url: str) -> None:
    lowered = url.lower()
    for marker in FORBIDDEN_HOST_MARKERS:
        if marker in lowered:
            raise SystemExit(f"refusing DSN containing {marker!r} (control-plane)")


async def _run(sample_pct: float, max_rows: int, dry_run: bool) -> dict:
    from sqlalchemy import text

    from app.database import get_session_maker
    from app.services.catalog_quality import (
        build_catalog_quality_report,
        persist_catalog_quality_snapshot,
    )

    maker = get_session_maker()
    if maker is None:
        raise SystemExit("database session maker unavailable")

    async with maker() as db:
        await db.execute(text("SET statement_timeout = '120s'"))
        # Relatively cheap vs full COUNT(*); still may take tens of seconds.
        try:
            count_row = await db.execute(
                text("SELECT reltuples::bigint FROM pg_class WHERE relname = 'products'")
            )
            catalog_estimate = int(count_row.scalar() or 0)
        except Exception:
            catalog_estimate = None

        report = await build_catalog_quality_report(
            db, sample_pct=sample_pct, max_rows=max_rows
        )
        report["catalog_active_count"] = catalog_estimate
        report["sampling"] = {
            **(report.get("sampling") or {}),
            "method": "TABLESAMPLE BERNOULLI + LIMIT",
            "note": "percentages are sample-based; total_products column is sample size",
        }

        if dry_run:
            overview = report["overview"]
            return {
                "dry_run": True,
                "snapshot_date": str(report["snapshot_date"]),
                "sample_rows": overview["total_products"],
                "overall_quality_score": overview["overall_quality_score"],
                "catalog_reltuples": catalog_estimate,
            }

        snapshot = await persist_catalog_quality_snapshot(db, report)
        await db.commit()
        return {
            "dry_run": False,
            "snapshot_date": str(snapshot.snapshot_date),
            "total_products_column": int(snapshot.total_products),
            "overall_quality_score": str(snapshot.overall_quality_score),
            "catalog_reltuples": catalog_estimate,
            "written_at": datetime.now(timezone.utc).isoformat(),
        }


def main() -> None:
    parser = argparse.ArgumentParser(description="Persist sampled catalog quality snapshot")
    parser.add_argument("--sample-pct", type=float, default=0.05)
    parser.add_argument("--max-rows", type=int, default=25_000)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    url = os.environ.get("BUYWHERE_DATABASE_URL") or os.environ.get("DATABASE_URL") or ""
    if url:
        _dsn_ok(url)

    result = asyncio.run(_run(args.sample_pct, args.max_rows, args.dry_run))
    print(json.dumps(result, default=str))


if __name__ == "__main__":
    main()
