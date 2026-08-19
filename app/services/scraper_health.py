"""Scraper reliability monitoring service.

Queries IngestionRun history + Product counts to build a per-platform health
report used by GET /v1/status/scrapers and GET /v1/status/health.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.product import IngestionRun, Product

# A source is considered "healthy" if its most recent completed run was within
# this many hours and had zero failures.
HEALTHY_MAX_HOURS = 24


async def get_scraper_health(db: AsyncSession | None = None) -> dict[str, Any]:
    """Return a scraper health dict compatible with ScraperHealthReport schema.

    When *db* is None (e.g. in tests or lightweight checks), returns an empty
    report rather than crashing.
    """
    now = datetime.now(timezone.utc)

    if db is None:
        return {
            "generated_at": now,
            "scrapers": [],
            "total_scrapers": 0,
            "healthy_count": 0,
            "unhealthy_count": 0,
        }

    try:
        # per-source product counts
        count_result = await db.execute(
            select(
                Product.source,
                func.count(Product.id).label("product_count"),
            )
            .where(Product.is_active == True)
            .group_by(Product.source)
        )
        product_counts: dict[str, int] = {
            row.source: row.product_count for row in count_result.all()
        }

        # latest ingestion run per source
        latest_run_result = await db.execute(
            select(
                IngestionRun.source,
                IngestionRun.status,
                IngestionRun.started_at,
                IngestionRun.finished_at,
                IngestionRun.rows_inserted,
                IngestionRun.rows_updated,
                IngestionRun.rows_failed,
                IngestionRun.error_message,
            )
            .where(
                IngestionRun.id.in_(
                    select(func.max(IngestionRun.id)).group_by(IngestionRun.source)
                )
            )
        )
        latest_runs = {row.source: row for row in latest_run_result.all()}

        # 24h success rate per source
        cutoff_24h = now - timedelta(hours=24)
        rate_result = await db.execute(
            select(
                IngestionRun.source,
                func.count(IngestionRun.id).label("total"),
            )
            .where(IngestionRun.started_at >= cutoff_24h)
            .group_by(IngestionRun.source)
        )
        runs_24h: dict[str, int] = {row.source: row.total for row in rate_result.all()}

        completed_result = await db.execute(
            select(
                IngestionRun.source,
                func.count(IngestionRun.id).label("completed"),
            )
            .where(
                IngestionRun.started_at >= cutoff_24h,
                IngestionRun.status.in_(("completed", "completed_with_errors")),
            )
            .group_by(IngestionRun.source)
        )
        completed_24h: dict[str, int] = {row.source: row.completed for row in completed_result.all()}

        success_rates: dict[str, float] = {
            source: round(completed_24h.get(source, 0) / total, 4)
            for source, total in runs_24h.items()
            if total > 0
        }

        # assemble per-scraper health entries
        all_sources = set(product_counts.keys()) | set(latest_runs.keys())
        scrapers: list[dict[str, Any]] = []

        for source in sorted(all_sources):
            run = latest_runs.get(source)
            pcount = product_counts.get(source, 0)

            if run is None:
                scrapers.append({
                    "source": source,
                    "last_run_at": None,
                    "last_run_status": None,
                    "last_rows_inserted": None,
                    "last_rows_updated": None,
                    "last_rows_failed": None,
                    "product_count": pcount,
                    "is_healthy": False,
                    "hours_since_last_run": None,
                    "error_message": "No ingestion runs recorded",
                })
                continue

            run_at = run.started_at
            if run_at is not None and run_at.tzinfo is None:
                run_at = run_at.replace(tzinfo=timezone.utc)

            hours_since = (
                round((now - run_at).total_seconds() / 3600, 2) if run_at else None
            )

            is_healthy = (
                run.status in ("completed", "completed_with_errors")
                and hours_since is not None
                and hours_since <= HEALTHY_MAX_HOURS
                and (run.rows_failed or 0) == 0
            )

            scrapers.append({
                "source": source,
                "last_run_at": run_at,
                "last_run_status": run.status,
                "last_rows_inserted": run.rows_inserted,
                "last_rows_updated": run.rows_updated,
                "last_rows_failed": run.rows_failed,
                "product_count": pcount,
                "is_healthy": is_healthy,
                "hours_since_last_run": hours_since,
                "error_message": run.error_message if not is_healthy else None,
            })

        healthy_count = sum(1 for s in scrapers if s["is_healthy"])
        unhealthy_count = len(scrapers) - healthy_count

        return {
            "generated_at": now,
            "scrapers": scrapers,
            "total_scrapers": len(scrapers),
            "healthy_count": healthy_count,
            "unhealthy_count": unhealthy_count,
        }

    except Exception as exc:
        # Non-fatal: return a degraded report rather than crashing the status endpoint
        return {
            "generated_at": now,
            "scrapers": [],
            "total_scrapers": 0,
            "healthy_count": 0,
            "unhealthy_count": 0,
            "error": str(exc),
        }
