"""Daily batch job for catalog data quality scoring.

Computes freshness, completeness, and price-accuracy metrics, persists a
snapshot to the database, and writes a JSON report for downstream dashboards
or re-scrape workflows.
"""

from __future__ import annotations

import argparse
import asyncio
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.database import AsyncSessionLocal
from app.services.catalog_quality import build_catalog_quality_report, persist_catalog_quality_snapshot

DEFAULT_REPORT_PATH = Path("/home/paperclip/buywhere-api/data/reports/catalog_quality_report_latest.json")


async def run_batch(output_path: Path) -> dict:
    async with AsyncSessionLocal() as db:
        report = await build_catalog_quality_report(db)
        await persist_catalog_quality_snapshot(db, report)
        await db.commit()

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(report, default=str, indent=2))
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the catalog data quality batch job")
    parser.add_argument(
        "--output",
        type=Path,
        default=DEFAULT_REPORT_PATH,
        help=f"Path to write the latest quality report JSON (default: {DEFAULT_REPORT_PATH})",
    )
    args = parser.parse_args()

    report = asyncio.run(run_batch(args.output))
    print(
        json.dumps(
            {
                "snapshot_date": str(report["snapshot_date"]),
                "total_products": report["overview"]["total_products"],
                "overall_quality_score": report["overview"]["overall_quality_score"],
                "stale_products": report["overview"]["stale_products"],
                "rescrape_sources": report["re_scrape_recommendations"]["count"],
                "output": str(args.output),
            }
        )
    )


if __name__ == "__main__":
    main()
