from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_api_key
from app.database import get_db
from app.models.product import ApiKey
from app.rate_limit import limiter
from app.services.monitoring import (
    compute_all_metrics,
    compute_platform_metrics,
    check_and_fire_alerts,
    FRESHNESS_THRESHOLD_HOURS,
    QUALITY_THRESHOLD_SCORE,
)

router = APIRouter(prefix="/v1/metrics", tags=["metrics"])


class PlatformTrend(BaseModel):
    current_count: int
    change_24h: int
    change_168h: int


class IngestionRunInfo(BaseModel):
    started_at: Optional[datetime] = None
    finished_at: Optional[datetime] = None
    status: Optional[str] = None
    rows_inserted: int = 0
    rows_updated: int = 0
    rows_failed: int = 0
    error_message: Optional[str] = None


class PlatformMetrics(BaseModel):
    source: str
    total_products: int
    active_products: int
    compliant_products: int
    products_with_image: int
    stale_products: int
    quality_score: float
    error_rate: float
    is_stale: bool
    is_low_quality: bool
    hours_since_last_run: Optional[float] = None
    last_run: Optional[IngestionRunInfo] = None
    trend: PlatformTrend


class AlertInfo(BaseModel):
    type: str
    severity: str
    source: str
    message: str
    hours_since_last_run: Optional[float] = None
    quality_score: Optional[float] = None


class MetricsResponse(BaseModel):
    generated_at: datetime
    freshness_threshold_hours: int
    quality_threshold_score: float
    total_products: int
    total_active: int
    total_stale: int
    overall_quality_score: float
    platform_count: int
    stale_platform_count: int
    low_quality_platform_count: int
    platforms: List[PlatformMetrics]
    alerts: List[AlertInfo]


@router.get("", response_model=MetricsResponse, summary="Get data freshness and quality metrics for all platforms")
@limiter.limit("60/minute")
async def get_metrics(
    request: Request,
    db: AsyncSession = Depends(get_db),
    api_key: ApiKey = Depends(get_current_api_key),
) -> MetricsResponse:
    request.state.api_key = api_key
    metrics = await compute_all_metrics(db)
    alerts = await check_and_fire_alerts(db, metrics)
    
    metrics["alerts"] = [
        AlertInfo(
            type=a["type"],
            severity=a["severity"],
            source=a["source"],
            message=a["message"],
            hours_since_last_run=a.get("hours_since_last_run"),
            quality_score=a.get("quality_score"),
        )
        for a in alerts
    ]
    
    return MetricsResponse(**metrics)


@router.get("/{source}", response_model=PlatformMetrics, summary="Get metrics for a specific platform")
@limiter.limit("120/minute")
async def get_platform_metrics(
    request: Request,
    source: str,
    db: AsyncSession = Depends(get_db),
    api_key: ApiKey = Depends(get_current_api_key),
) -> PlatformMetrics:
    request.state.api_key = api_key
    return await compute_platform_metrics(db, source)