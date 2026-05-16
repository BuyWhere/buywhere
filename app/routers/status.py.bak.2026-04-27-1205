from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_api_key
from app.database import get_db
from app.models.product import ApiKey, IngestionRun, Product
from app.schemas.status import CatalogStatus, IngestionRunInfo, PlatformProductCount, ScraperHealthReport, SystemHealthReport
from app.rate_limit import limiter
from app.services.scraper_health import get_scraper_health
from app.services.health import get_db_health

router = APIRouter(prefix="/v1/status", tags=["status"])


@router.get("", response_model=CatalogStatus, summary="Get catalog health and status")
@limiter.limit("100/minute")
async def get_catalog_status(
    request: Request,
    db: AsyncSession = Depends(get_db),
    api_key: ApiKey = Depends(get_current_api_key),
) -> CatalogStatus:
    request.state.api_key = api_key

    total_result = await db.execute(select(func.count(Product.id)).where(Product.is_active == True))
    total_unique_products = total_result.scalar_one() or 0

    platform_counts_result = await db.execute(
        select(
            Product.source,
            func.count(Product.id).label("product_count"),
            func.max(Product.updated_at).label("last_updated"),
        )
        .where(Product.is_active == True)
        .group_by(Product.source)
    )
    platform_rows = platform_counts_result.all()

    platforms = [
        PlatformProductCount(
            source=row.source,
            product_count=row.product_count,
            last_updated=row.last_updated,
        )
        for row in platform_rows
    ]

    last_runs_result = await db.execute(
        select(
            IngestionRun.source,
            func.max(IngestionRun.started_at).label("last_run_at"),
        )
        .group_by(IngestionRun.source)
    )
    last_runs = {row.source: row.last_run_at for row in last_runs_result.all()}

    last_run_details_result = await db.execute(
        select(
            IngestionRun.source,
            IngestionRun.status,
            IngestionRun.rows_inserted,
            IngestionRun.rows_updated,
        )
        .where(
            IngestionRun.id.in_(
                select(func.max(IngestionRun.id))
                .group_by(IngestionRun.source)
            )
        )
    )
    last_run_details = {
        row.source: (row.status, row.rows_inserted, row.rows_updated)
        for row in last_run_details_result.all()
    }

    ingestion_runs = [
        IngestionRunInfo(
            source=source,
            last_run_at=last_runs.get(source),
            last_run_status=last_run_details.get(source, (None, None, None))[0],
            last_rows_inserted=last_run_details.get(source, (None, None, None))[1],
            last_rows_updated=last_run_details.get(source, (None, None, None))[2],
        )
        for source in last_runs.keys()
    ]

    goal_million = 1.0
    progress_percent = min(100.0, (total_unique_products / (goal_million * 1_000_000)) * 100)

    return CatalogStatus(
        total_unique_products=total_unique_products,
        platforms=platforms,
        ingestion_runs=ingestion_runs,
        goal_million=goal_million,
        progress_percent=round(progress_percent, 4),
    )


@router.get("/scrapers", response_model=ScraperHealthReport, summary="Get scraper health status per platform")
@limiter.limit("100/minute")
async def get_scraper_health_status(
    request: Request,
    db: AsyncSession = Depends(get_db),
    api_key: ApiKey = Depends(get_current_api_key),
) -> ScraperHealthReport:
    request.state.api_key = api_key
    data = await get_scraper_health(db)
    return ScraperHealthReport(**data)


@router.get("/health", response_model=SystemHealthReport, summary="Get system health — DB latency, pool, and scraper status")
@limiter.limit("100/minute")
async def get_system_health(
    request: Request,
    db: AsyncSession = Depends(get_db),
    api_key: ApiKey = Depends(get_current_api_key),
) -> SystemHealthReport:
    request.state.api_key = api_key
    db_health = await get_db_health(db)
    scraper_data = await get_scraper_health(db)
    return SystemHealthReport(
        db=db_health,
        scrapers=ScraperHealthReport(**scraper_data),
    )