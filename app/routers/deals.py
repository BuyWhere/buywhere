"""
GET /v1/deals — products currently priced below their original/historical price (BUY-347).

Query parameters:
  category         — filter by category (optional)
  min_discount_pct — minimum discount percentage, default 10 (0–100)
  limit            — max results, 1–100 (default 20)
  offset           — pagination offset (default 0)

Products are identified as deals when:
  1. metadata contains an `original_price` field and current price is lower by
     at least min_discount_pct%, OR
  2. (future) a price_history table is available with 30-day averages.

Response shape:
  {
    "total": 5,
    "limit": 20,
    "offset": 0,
    "items": [
      {
        "id": 42,
        "name": "...",
        "price": 49.90,
        "original_price": 79.00,
        "discount_pct": 36.8,
        "currency": "SGD",
        "source": "shopee_sg",
        "affiliate_url": "...",
        "category": "...",
        ...
      }
    ]
  }
"""
from __future__ import annotations

from decimal import Decimal
from typing import Any, List, Optional

from fastapi import APIRouter, Depends, Query, Request
from pydantic import BaseModel
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.affiliate_links import get_affiliate_url
from app.auth import get_current_api_key
from app.database import get_db
from app.models.product import ApiKey, Product
from app.rate_limit import limiter

router = APIRouter(prefix="/v1/deals", tags=["deals"])


class DealItem(BaseModel):
    id: int
    name: str
    price: Decimal
    original_price: Optional[Decimal]
    discount_pct: Optional[float]
    currency: str
    source: str
    category: Optional[str]
    buy_url: str
    affiliate_url: Optional[str]
    image_url: Optional[str]
    metadata: Optional[Any]

    model_config = {"from_attributes": True}


class DealsResponse(BaseModel):
    total: int
    limit: int
    offset: int
    items: List[DealItem]


def _to_deal_item(p: Product) -> DealItem:
    meta = p.metadata_ or {}
    original_price: Optional[Decimal] = None
    discount_pct: Optional[float] = None

    raw_orig = meta.get("original_price") if isinstance(meta, dict) else None
    if raw_orig is not None:
        try:
            original_price = Decimal(str(raw_orig))
            if original_price > 0 and p.price < original_price:
                discount_pct = round(
                    float((original_price - p.price) / original_price * 100), 1
                )
        except Exception:
            pass

    return DealItem(
        id=p.id,
        name=p.title,
        price=p.price,
        original_price=original_price,
        discount_pct=discount_pct,
        currency=p.currency,
        source=p.source,
        category=p.category,
        buy_url=p.url,
        affiliate_url=get_affiliate_url(p.source, p.url) if p.url else None,
        image_url=p.image_url,
        metadata=p.metadata_,
    )


@router.get("", response_model=DealsResponse, summary="Find discounted products")
@limiter.limit("1000/minute")
async def get_deals(
    request: Request,
    category: Optional[str] = Query(None, description="Filter by product category"),
    min_discount_pct: float = Query(default=10.0, ge=0, le=100, description="Minimum discount % (default 10)"),
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    db: AsyncSession = Depends(get_db),
    api_key: ApiKey = Depends(get_current_api_key),
) -> DealsResponse:
    """Return products currently priced below their original price by at least min_discount_pct%."""
    request.state.api_key = api_key

    threshold = 1.0 - (min_discount_pct / 100.0)

    # Query products where metadata.original_price exists and discount qualifies.
    # Cast via JSONB: metadata->>'original_price' is text, convert to numeric.
    base_query = (
        select(Product)
        .where(Product.is_active == True)
        .where(text("metadata->>'original_price' IS NOT NULL"))
        .where(
            text(
                "price < :threshold * CAST(metadata->>'original_price' AS NUMERIC)"
            ).bindparams(threshold=threshold)
        )
    )

    if category:
        base_query = base_query.where(Product.category.ilike(f"%{category}%"))

    # Sort by discount depth (largest discount first) using SQL expression
    base_query = base_query.order_by(
        text(
            "(CAST(metadata->>'original_price' AS NUMERIC) - price) "
            "/ CAST(metadata->>'original_price' AS NUMERIC) DESC"
        )
    )

    # Total count (without pagination)
    from sqlalchemy import func
    count_q = select(func.count()).select_from(base_query.subquery())
    total = (await db.execute(count_q)).scalar_one()

    result = await db.execute(base_query.limit(limit).offset(offset))
    products = result.scalars().all()

    return DealsResponse(
        total=total,
        limit=limit,
        offset=offset,
        items=[_to_deal_item(p) for p in products],
    )
