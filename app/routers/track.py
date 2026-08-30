from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import RedirectResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_api_key
from app.affiliate_links import (
    get_underlying_affiliate_url,
    parse_tracking_id,
    is_valid_url,
)
from app.database import get_db
from app.models.product import ApiKey, Click, Product
from app import cache
from app.services.analytics import post_hog

router = APIRouter(prefix="/track", tags=["tracking"])


@router.get("/{tracking_id}", summary="Track click and redirect to affiliate URL")
async def track_click(
    tracking_id: str,
    db: AsyncSession = Depends(get_db),
    api_key: ApiKey = Depends(get_current_api_key),
):
    parsed = parse_tracking_id(tracking_id)
    if not parsed:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid tracking ID format")

    product_id, _ = parsed

    product_result = await db.execute(
        select(Product).where(Product.id == product_id, Product.is_active)
    )
    product = product_result.scalar_one_or_none()
    if not product:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found")

    destination_url = get_underlying_affiliate_url(product.source, product.url)
    if not destination_url or not is_valid_url(destination_url):
        destination_url = product.url

    click_record = Click(
        tracking_id=tracking_id,
        product_id=product_id,
        platform=product.source,
        destination_url=destination_url,
        api_key_id=api_key.id if api_key else None,
    )
    db.add(click_record)
    await db.commit()

    cache_key = f"click_count:{product_id}"
    await cache.cache_delete(cache_key)

    post_hog.track_affiliate_click(
        distinct_id=api_key.developer_id if api_key else "anonymous",
        product_id=product_id,
        merchant=product.source,
        affiliate_link=destination_url,
    )

    return RedirectResponse(url=destination_url, status_code=status.HTTP_302_FOUND)


@router.get("/{tracking_id}/verify", summary="Verify tracking ID without recording click")
async def verify_tracking_id(
    tracking_id: str,
    db: AsyncSession = Depends(get_db),
    api_key: ApiKey = Depends(get_current_api_key),
):
    parsed = parse_tracking_id(tracking_id)
    if not parsed:
        return {"valid": False, "reason": "invalid_format"}

    product_id, _ = parsed

    product_result = await db.execute(
        select(Product).where(Product.id == product_id, Product.is_active)
    )
    product = product_result.scalar_one_or_none()
    if not product:
        return {"valid": False, "reason": "product_not_found"}

    destination_url = get_underlying_affiliate_url(product.source, product.url)
    if not destination_url or not is_valid_url(destination_url):
        destination_url = product.url

    return {
        "valid": True,
        "product_id": product_id,
        "platform": product.source,
        "destination_url": destination_url,
    }
