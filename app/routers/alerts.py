import uuid
from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_api_key
from app.database import get_db
from app.models.product import ApiKey, Product
from app.models.price_alert import PriceAlert
from app.schemas.price_alert import (
    AlertCreateRequest, AlertResponse,
    AlertListResponse,
)
from app.rate_limit import limiter

router = APIRouter(prefix="/v1/alerts", tags=["alerts"])

MAX_ALERTS_PER_KEY = 100


@router.post("", response_model=AlertResponse, status_code=status.HTTP_201_CREATED, summary="Create a price alert")
@limiter.limit("20/hour")
async def create_alert(
    request: Request,
    body: AlertCreateRequest,
    db: AsyncSession = Depends(get_db),
    api_key: ApiKey = Depends(get_current_api_key),
) -> AlertResponse:
    product_result = await db.execute(
        select(Product).where(
            Product.id == body.product_id,
            Product.is_active.is_(True),
        )
    )
    product = product_result.scalar_one_or_none()
    if not product:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Product not found",
        )

    count_result = await db.execute(
        select(func.count(PriceAlert.id)).where(
            PriceAlert.developer_id == api_key.developer_id,
            PriceAlert.is_active.is_(True),
        )
    )
    active_count = count_result.scalar() or 0
    
    if active_count >= MAX_ALERTS_PER_KEY:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Maximum of {MAX_ALERTS_PER_KEY} active alerts per API key. Delete existing alerts to create new ones.",
        )

    existing_result = await db.execute(
        select(PriceAlert).where(
            PriceAlert.developer_id == api_key.developer_id,
            PriceAlert.product_id == body.product_id,
            PriceAlert.target_price == body.target_price,
            PriceAlert.direction == body.direction,
            PriceAlert.currency == body.currency,
            PriceAlert.callback_url == str(body.callback_url),
            PriceAlert.is_active.is_(True),
        )
    )
    existing_alert = existing_result.scalar_one_or_none()
    if existing_alert:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="An active alert with the same product, target price, direction, and callback URL already exists",
        )

    alert_id = str(uuid.uuid4())
    
    alert = PriceAlert(
        id=alert_id,
        developer_id=api_key.developer_id,
        product_id=body.product_id,
        target_price=body.target_price,
        direction=body.direction,
        currency=body.currency,
        callback_url=str(body.callback_url),
        is_active=True,
    )
    db.add(alert)
    await db.flush()
    await db.refresh(alert)
    
    return AlertResponse.model_validate(alert)


@router.get("", response_model=AlertListResponse, summary="List price alerts")
@limiter.limit("60/minute")
async def list_alerts(
    request: Request,
    db: AsyncSession = Depends(get_db),
    api_key: ApiKey = Depends(get_current_api_key),
) -> AlertListResponse:
    result = await db.execute(
        select(PriceAlert)
        .where(PriceAlert.developer_id == api_key.developer_id)
        .order_by(PriceAlert.created_at.desc())
        .limit(MAX_ALERTS_PER_KEY)
    )
    alerts = result.scalars().all()
    
    return AlertListResponse(
        alerts=[AlertResponse.model_validate(a) for a in alerts],
        total=len(alerts),
        limit=MAX_ALERTS_PER_KEY,
    )


@router.delete("/{alert_id}", status_code=status.HTTP_204_NO_CONTENT, summary="Cancel a price alert")
@limiter.limit("20/hour")
async def delete_alert(
    request: Request,
    alert_id: str,
    db: AsyncSession = Depends(get_db),
    api_key: ApiKey = Depends(get_current_api_key),
) -> None:
    result = await db.execute(
        select(PriceAlert).where(
            PriceAlert.id == alert_id,
            PriceAlert.developer_id == api_key.developer_id,
        )
    )
    alert = result.scalar_one_or_none()
    
    if not alert:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Alert not found",
        )
    
    await db.delete(alert)
    await db.flush()
