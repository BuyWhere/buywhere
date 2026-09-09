import logging
from decimal import Decimal
from typing import Optional, List
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import func, select, and_
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_api_key
from app.database import get_db
from app.models.product import ApiKey, Click
from app.rate_limit import limiter, rate_limit_from_request
from app.affiliate_links import get_affiliate_url, is_valid_url

logger = logging.getLogger("buywhere_api")

router = APIRouter(prefix="/v1/affiliate", tags=["affiliate"])

AFFILIATE_COMMISSION_RATES = {
    "shopee_sg": Decimal("0.02"),
    "lazada_sg": Decimal("0.015"),
    "qoo10_sg": Decimal("0.01"),
    "carousell_sg": Decimal("0.0"),
    "default": Decimal("0.01"),
}


class AffiliateLinkRequest(BaseModel):
    product_url: str = Field(..., description="Product URL to generate affiliate link for")
    platform: Optional[str] = Field(None, description="Platform override if URL is ambiguous")
    product_id: Optional[int] = Field(None, description="Product ID for click tracking")


class AffiliateLinkResponse(BaseModel):
    original_url: str
    affiliate_url: str
    platform: str
    tracking_id: Optional[str] = None
    is_tracked: bool = False


class EarningsEntry(BaseModel):
    platform: str
    click_count: int
    estimated_earnings: float
    currency: str = "SGD"


class EarningsResponse(BaseModel):
    api_key_id: str
    total_clicks: int
    total_estimated_earnings: float
    currency: str = "SGD"
    earnings_by_platform: List[EarningsEntry]
    period_start: datetime
    period_end: datetime


@router.post("/link", response_model=AffiliateLinkResponse, summary="Generate tracked affiliate link for a product URL")
@limiter.limit(rate_limit_from_request)
async def create_affiliate_link(
    request: Request,
    body: AffiliateLinkRequest,
    db: AsyncSession = Depends(get_db),
    api_key: ApiKey = Depends(get_current_api_key),
) -> AffiliateLinkResponse:
    """Generate a tracked affiliate link for a product URL.
    
    If TRACKING_BASE_URL is configured, the link will be wrapped for click tracking.
    Otherwise returns a direct affiliate link with UTM parameters.
    """
    request.state.api_key = api_key

    if not is_valid_url(body.product_url):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid product URL provided"
        )

    platform = body.platform or _detect_platform(body.product_url)
    
    affiliate_url = get_affiliate_url(platform, body.product_url, body.product_id)
    
    is_tracked = bool(body.product_id and body.product_id > 0)
    
    tracking_id = None
    if body.product_id and is_tracked:
        from app.affiliate_links import _generate_tracking_id
        tracking_id = _generate_tracking_id(body.product_id, platform)
        if hasattr(request.app.state, 'settings'):
            tracking_base = request.app.state.settings.tracking_base_url
        else:
            import os
            tracking_base = os.environ.get("TRACKING_BASE_URL", "")
        if tracking_base:
            affiliate_url = f"{tracking_base}/v1/track/{tracking_id}"

    return AffiliateLinkResponse(
        original_url=body.product_url,
        affiliate_url=affiliate_url,
        platform=platform,
        tracking_id=tracking_id,
        is_tracked=is_tracked,
    )


@router.get("/earnings", response_model=EarningsResponse, summary="Get estimated earnings per API key")
@limiter.limit(rate_limit_from_request)
async def get_affiliate_earnings(
    request: Request,
    days: int = Query(30, ge=1, le=365, description="Number of days to look back"),
    db: AsyncSession = Depends(get_db),
    api_key: ApiKey = Depends(get_current_api_key),
) -> EarningsResponse:
    """Get estimated affiliate earnings for this API key.
    
    Returns click counts and estimated earnings broken down by platform.
    Earnings are estimates based on known commission rates and may not reflect actual payouts.
    """
    request.state.api_key = api_key

    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    
    result = await db.execute(
        select(
            Click.platform,
            func.count(Click.id).label("click_count")
        )
        .where(
            and_(
                Click.api_key_id == str(api_key.id),
                Click.clicked_at >= cutoff
            )
        )
        .group_by(Click.platform)
    )
    
    rows = result.all()
    
    total_clicks = sum(r.click_count for r in rows)
    
    earnings_by_platform = []
    total_earnings = Decimal("0")
    
    for row in rows:
        commission_rate = AFFILIATE_COMMISSION_RATES.get(
            row.platform, 
            AFFILIATE_COMMISSION_RATES["default"]
        )
        avg_order_value = Decimal("50.00")
        estimated_earnings = Decimal(str(row.click_count)) * commission_rate * avg_order_value
        
        earnings_by_platform.append(EarningsEntry(
            platform=row.platform,
            click_count=row.click_count,
            estimated_earnings=float(estimated_earnings.quantize(Decimal("0.01"))),
        ))
        total_earnings += estimated_earnings
    
    return EarningsResponse(
        api_key_id=str(api_key.id),
        total_clicks=total_clicks,
        total_estimated_earnings=float(total_earnings.quantize(Decimal("0.01"))),
        currency="SGD",
        earnings_by_platform=earnings_by_platform,
        period_start=cutoff,
        period_end=datetime.now(timezone.utc),
    )


def _detect_platform(url: str) -> str:
    url_lower = url.lower()
    if "shopee" in url_lower:
        return "shopee_sg"
    elif "lazada" in url_lower:
        return "lazada_sg"
    elif "qoo10" in url_lower:
        return "qoo10_sg"
    elif "carousell" in url_lower:
        return "carousell_sg"
    elif "tiktok" in url_lower:
        return "tiktok_shop_sg"
    elif "amazon" in url_lower:
        return "amazon_sg"
    return "unknown"