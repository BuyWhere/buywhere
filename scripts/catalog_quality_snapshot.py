#!/usr/bin/env python3
"""Daily catalog quality snapshot runner.

Builds the catalog quality report and persists a snapshot row to
`data_quality_metrics`. Designed to run once per day via cron/Railway
scheduler.

Usage:
    python scripts/catalog_quality_snapshot.py [--once]

Environment:
    DATABASE_URL                PostgreSQL DSN (defaults to app config).
    QUALITY_SNAPSHOT_HOUR_UTC   Hour for daemon scheduling (default: 2).
    QUALITY_SNAPSHOT_MIN_UTC    Minute for daemon scheduling (default: 0).
"""
from __future__ import annotations

import argparse
import asyncio
import logging
import os
import sys
from datetime import datetime, timezone
from pathlib import Path


logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
)
log = logging.getLogger("catalog-quality-snapshot")

# ---------------------------------------------------------------------------
# Add project root to path so app packages resolve
# ---------------------------------------------------------------------------

_REPO_ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(_REPO_ROOT))

from app.database import get_async_session  # noqa: E402
from app.services.catalog_quality import (  # noqa: E402
    build_catalog_quality_report_fast,
    persist_catalog_quality_snapshot,
)


# ---------------------------------------------------------------------------
# Defaults
# ---------------------------------------------------------------------------

HOUR_UTC = int(os.environ.get("QUALITY_SNAPSHOT_HOUR_UTC", "2"))
MIN_UTC = int(os.environ.get("QUALITY_SNAPSHOT_MIN_UTC", "0"))


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _ms_until_next(hour_utc: int, min_utc: int) -> float:
    now = datetime.now(timezone.utc)
    next_run = now.replace(hour=hour_utc, minute=min_utc, second=0, microsecond=0)
    if next_run <= now:
        next_run = next_run.replace(day=next_run.day + 1)
    return (next_run - now).total_seconds() * 1000


async def _run_once() -> None:
    log.info("Building catalog quality report...")
    session = get_async_session()
    try:
        report = await build_catalog_quality_report_fast(session)
        snapshot = await persist_catalog_quality_snapshot(session, report)
        await session.commit()
        log.info(
            "Snapshot persisted for %s: total_products=%s overall_quality_score=%s",
            snapshot.snapshot_date,
            snapshot.total_products,
            snapshot.overall_quality_score,
        )
    except Exception:
        log.exception("Failed to build or persist catalog quality snapshot")
        await session.rollback()
        raise
    finally:
        await session.close()


async def _tick() -> None:
    try:
        await _run_once()
    except Exception:
        log.exception("Catalog quality snapshot failed")
    _schedule()


def _schedule() -> None:
    delay_ms = _ms_until_next(HOUR_UTC, MIN_UTC)
    delay_h = int(delay_ms // 3_600_000)
    delay_m = int((delay_ms % 3_600_000) // 60_000)
    log.info(
        "Next catalog quality snapshot at %02d:%02d UTC (in %dh %dm)",
        HOUR_UTC,
        MIN_UTC,
        delay_h,
        delay_m,
    )
    asyncio.get_event_loop().call_later(delay_ms / 1000, lambda: asyncio.create_task(_tick()))


async def main() -> int:
    parser = argparse.ArgumentParser(description="Catalog quality snapshot runner")
    parser.add_argument(
        "--once",
        action="store_true",
        help="Run a single snapshot and exit (default: daemon mode)",
    )
    args = parser.parse_args()

    if args.once:
        await _run_once()
        return 0

    log.info(
        "Starting catalog quality snapshot scheduler. Daily at %02d:%02d UTC.",
        HOUR_UTC,
        MIN_UTC,
    )
    await _tick()
    # Keep the event loop alive. Daemon mode runs forever.
    while True:
        await asyncio.sleep(3600)


if __name__ == "__main__":
    try:
        sys.exit(asyncio.run(main()))
    except KeyboardInterrupt:
        log.info("Interrupted by user")
        sys.exit(0)
