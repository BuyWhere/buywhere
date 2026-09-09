from datetime import datetime, timezone
from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import func, select, or_
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_api_key
from app.database import get_db
from app.models.product import ApiKey, IngestionRun, Product
from app.schemas.brand import SourceInfo, SourceListResponse
from app.schemas.status import CatalogHealthReport, CatalogQualityReport, CatalogStatsReport
from app.services.catalog_health import get_catalog_health
from app.services.catalog_quality import build_catalog_quality_report
from app import cache

router = APIRouter(prefix="/catalog", tags=["catalog"])

COUNTRY_NAMES = {
    "SG": "Singapore",
    "MY": "Malaysia",
    "PH": "Philippines",
    "TH": "Thailand",
    "VN": "Vietnam",
}


class CountryInfo(BaseModel):
    code: str
    name: str
    product_count: int


class CountryListResponse(BaseModel):
    total: int
    countries: list[CountryInfo]


@router.get("/health", response_model=CatalogHealthReport, summary="Get catalog health and quality report")
async def catalog_health(
    db: AsyncSession = Depends(get_db),
    api_key: ApiKey = Depends(get_current_api_key),
) -> CatalogHealthReport:
    cache_key = "catalog:health"
    cached = await cache.cache_get(cache_key)
    if cached:
        return CatalogHealthReport(**cached)
    data = await get_catalog_health(db)
    await cache.cache_set(cache_key, data, ttl_seconds=300)
    return CatalogHealthReport(**data)


@router.get("/incomplete", summary="List incomplete product records missing price/title/url")
async def list_incomplete_products(
    db: AsyncSession = Depends(get_db),
    api_key: ApiKey = Depends(get_current_api_key),
    source: str | None = Query(None, max_length=100, description="Filter by source platform"),
    limit: int = Query(20, ge=1, le=100, description="Results per page (1-100)"),
    offset: int = Query(0, ge=0, le=10000, description="Pagination offset (0-10000)"),
) -> dict:
    cache_key = cache.build_cache_key(
        "catalog:incomplete",
        source=source,
        limit=limit,
        offset=offset,
    )
    cached = await cache.cache_get(cache_key)
    if cached:
        return cached

    base_q = select(
        Product.id,
        Product.sku,
        Product.source,
        Product.title,
        Product.price,
        Product.url,
        Product.is_active,
        Product.updated_at,
    ).where(
        or_(
            Product.title.is_(None),
            Product.title == "",
            Product.price.is_(None),
            Product.url.is_(None),
            Product.url == "",
        )
    )
    if source:
        base_q = base_q.where(Product.source == source)

    count_q = select(func.count()).select_from(base_q.subquery())
    total = (await db.execute(count_q)).scalar_one()

    result = await db.execute(
        base_q.order_by(Product.updated_at.desc()).limit(limit).offset(offset)
    )
    rows = result.all()

    items = []
    for row in rows:
        missing = []
        if not row.title or row.title == "":
            missing.append("title")
        if row.price is None:
            missing.append("price")
        if not row.url or row.url == "":
            missing.append("url")
        items.append({
            "id": row.id,
            "sku": row.sku or "",
            "source": row.source or "",
            "title": row.title or "",
            "price": str(row.price) if row.price is not None else None,
            "url": row.url or "",
            "is_active": row.is_active,
            "updated_at": row.updated_at,
            "missing_fields": missing,
        })

    response = {
        "total": total,
        "limit": limit,
        "offset": offset,
        "has_more": (offset + limit) < total,
        "items": items,
    }
    await cache.cache_set(cache_key, response, ttl_seconds=120)
    return response


@router.get("/stats", response_model=CatalogStatsReport, summary="Get catalog statistics — total products by platform and category")
async def catalog_stats(
    db: AsyncSession = Depends(get_db),
    api_key: ApiKey = Depends(get_current_api_key),
) -> CatalogStatsReport:
    cache_key = "catalog:stats"
    cached = await cache.cache_get(cache_key)
    if cached:
        return CatalogStatsReport(**cached)

    total_result = await db.execute(select(func.count(Product.id)))
    total = total_result.scalar_one() or 0

    platform_result = await db.execute(
        select(Product.source, func.count(Product.id))
        .group_by(Product.source)
    )
    by_platform = {row[0]: row[1] for row in platform_result.all()}

    category_result = await db.execute(
        select(Product.category, func.count(Product.id))
        .where(Product.category.isnot(None))
        .group_by(Product.category)
    )
    by_category = {row[0]: row[1] for row in category_result.all()}

    response = CatalogStatsReport(
        generated_at=datetime.now(timezone.utc),
        total_products=total,
        by_platform=by_platform,
        by_category=by_category,
    )
    await cache.cache_set(cache_key, response.model_dump(mode="json"), ttl_seconds=300)
    return response


@router.get("/quality-report", response_model=CatalogQualityReport, summary="Get product data quality report with freshness, completeness, and price accuracy")
async def catalog_quality_report(
    db: AsyncSession = Depends(get_db),
    api_key: ApiKey = Depends(get_current_api_key),
) -> CatalogQualityReport:
    cache_key = "catalog:quality-report"
    cached = await cache.cache_get(cache_key)
    if cached:
        return CatalogQualityReport(**cached)

    report = await build_catalog_quality_report(db)
    await cache.cache_set(cache_key, report, ttl_seconds=300)
    return CatalogQualityReport(**report)
