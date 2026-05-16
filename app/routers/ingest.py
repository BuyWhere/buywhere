import asyncio
from decimal import Decimal
from typing import List, Optional

import httpx
from fastapi import APIRouter, Depends, Query, Request
from pydantic import ValidationError
from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_api_key
from app.database import get_db
from app.models.product import ApiKey, Product, IngestionRun, PriceHistory
from app.schemas.ingest import (
    IngestRequest,
    IngestResponse,
    IngestError,
    IngestErrorCode,
)
from app.rate_limit import limiter
from app import cache
from app.logging_centralized import get_logger

logger = get_logger("ingest-service")
router = APIRouter(prefix="/ingest", tags=["ingest"])

IMAGE_CHECK_TIMEOUT = 5.0
IMAGE_CHECK_MAX_SIZE = 5 * 1024 * 1024

SOURCE_NORMALIZATION = {
    "challenger": "challenger_sg",
    "challenger.sg": "challenger_sg",
    "challenger_sg": "challenger_sg",
    "amazon_sg_toys": "amazon_sg",
}


def normalize_source(source: str) -> str:
    return SOURCE_NORMALIZATION.get(source, source)


async def _dispatch_webhooks_for_product(
    db: AsyncSession,
    product_id: int,
    product_data: dict,
    is_new: bool,
    old_price: Optional[Decimal],
    was_available: Optional[bool],
) -> None:
    from app.services.webhook import (
        dispatch_new_product_webhooks,
        dispatch_price_change_webhooks,
        dispatch_stock_change_webhooks,
        dispatch_deal_found_webhooks,
    )

    try:
        if is_new:
            await dispatch_new_product_webhooks(db, product_data)

        if old_price is not None and old_price != product_data.get("price"):
            await dispatch_price_change_webhooks(
                db, product_data, old_price, product_data.get("price")
            )

        if was_available is not None and was_available != product_data.get("is_available"):
            await dispatch_stock_change_webhooks(
                db, product_data, was_available, product_data.get("is_available", True)
            )

        original_price = product_data.get("metadata", {}).get("original_price")
        if original_price:
            try:
                original = Decimal(str(original_price))
                current = product_data.get("price")
                if current and original > current:
                    await dispatch_deal_found_webhooks(db, product_data, original, current)
            except Exception:
                pass
    except Exception as e:
        logger.warning("Failed to dispatch webhooks", extra={"product_id": product_id, "error": str(e)})


async def _check_image_accessible(image_url: str) -> tuple[bool, str]:
    try:
        async with httpx.AsyncClient(timeout=IMAGE_CHECK_TIMEOUT, follow_redirects=True) as client:
            response = await client.head(image_url)
            if response.status_code >= 400:
                return False, f"HTTP {response.status_code}"
            content_length = response.headers.get("content-length")
            if content_length and int(content_length) > IMAGE_CHECK_MAX_SIZE:
                return False, f"File too large ({content_length} bytes)"
            return True, ""
    except httpx.TimeoutException:
        return False, "Timeout"
    except httpx.RequestError as exc:
        return False, str(exc)
    except Exception as exc:
        logger.warning("Unexpected image check error", extra={"url": image_url, "error": str(exc)})
        return False, str(exc)


def _map_validation_error_to_code(error: str) -> str:
    error_lower = error.lower()
    if "price" in error_lower and ("non-positive" in error_lower or "must be > 0" in error_lower or "greater than" in error_lower):
        return IngestErrorCode.VALIDATION_PRICE_NON_POSITIVE
    if "price" in error_lower and "outside valid range" in error_lower:
        return IngestErrorCode.VALIDATION_PRICE_OUT_OF_RANGE
    if "url" in error_lower and "invalid" in error_lower:
        return IngestErrorCode.VALIDATION_URL_INVALID
    if "image url" in error_lower and "invalid" in error_lower:
        return IngestErrorCode.VALIDATION_IMAGE_URL_INVALID
    if "currency" in error_lower:
        return IngestErrorCode.VALIDATION_CURRENCY_INVALID
    if "title" in error_lower:
        return IngestErrorCode.VALIDATION_TITLE_REQUIRED
    if "sku" in error_lower:
        return IngestErrorCode.VALIDATION_SKU_REQUIRED
    if "merchant_id" in error_lower:
        return IngestErrorCode.VALIDATION_MERCHANT_ID_REQUIRED
    if "active" in error_lower and "stock" in error_lower:
        return IngestErrorCode.VALIDATION_ACTIVE_STOCK_CONFLICT
    return IngestErrorCode.UNKNOWN_ERROR


async def _log_ingestion_rejection(
    db: AsyncSession,
    run_id: Optional[int],
    source: str,
    sku: Optional[str],
    error_code: str,
    error_message: str,
    raw_data: Optional[dict] = None,
) -> None:
    """Log a rejected product to the ingestion_rejections table."""
    pass


@router.post("/products", response_model=IngestResponse, summary="Ingest product batch")
@limiter.limit("100/minute")
async def ingest_products(
    request: Request,
    db: AsyncSession = Depends(get_db),
    api_key: ApiKey = Depends(get_current_api_key),
) -> IngestResponse:
    request.state.api_key = api_key

    try:
        body = IngestRequest.model_validate(await request.json())
        body.source = normalize_source(body.source)
    except ValidationError as exc:
        raw_body = {}
        try:
            raw_body = await request.json()
        except Exception:
            pass
        errors: List[IngestError] = []
        source = raw_body.get("source", "unknown") if isinstance(raw_body, dict) else "unknown"
        for err in exc.errors():
            loc = err.get("loc", [])
            idx = loc[0] if loc and isinstance(loc[0], int) else 0
            sku = "unknown"
            raw_data = None
            if loc and isinstance(loc[0], int) and raw_body.get("products"):
                products_list = raw_body.get("products", [])
                if isinstance(products_list, list) and loc[0] < len(products_list):
                    sku = products_list[loc[0]].get("sku", "unknown")
                    raw_data = products_list[loc[0]]
            field = ".".join(str(l) for l in loc if l not in ("body",))
            error_code = _map_validation_error_to_code(err["msg"])
            error_msg = f"[{field}] {err['msg']}: {err.get('input')}"
            errors.append(IngestError(
                index=idx,
                sku=sku,
                error=error_msg,
                code=error_code,
            ))
            await _log_ingestion_rejection(
                db=db,
                run_id=None,
                source=source,
                sku=sku,
                error_code=error_code,
                error_message=error_msg,
                raw_data=raw_data,
            )
        await db.commit()
        return IngestResponse(
            run_id=None,
            status="failed",
            rows_inserted=0,
            rows_updated=0,
            rows_failed=len(errors),
            errors=errors,
        )
    except Exception as exc:
        return IngestResponse(
            run_id=None,
            status="failed",
            rows_inserted=0,
            rows_updated=0,
            rows_failed=1,
            errors=[IngestError(index=0, sku="request", error=str(exc), code=IngestErrorCode.UNKNOWN_ERROR)],
        )

    run = IngestionRun(
        source=body.source,
        status="running",
    )
    db.add(run)
    await db.flush()

    rows_inserted = 0
    rows_updated = 0
    rows_failed = 0
    errors: List[IngestError] = []
    webhook_events: List[dict] = []

    skus = [item.sku for item in body.products]
    existing_result = await db.execute(
        select(Product.id, Product.sku, Product.price, Product.is_available).where(
            Product.sku.in_(skus),
            Product.source == body.source
        )
    )
    existing_map = {row.sku: (row.id, row.price, row.is_available) for row in existing_result.all()}
    existing_ids = set(existing_map.keys())

    values_list = []
    for item in body.products:
        values_list.append({
            "sku": item.sku,
            "source": body.source,
            "merchant_id": item.merchant_id,
            "title": item.title,
            "description": item.description,
            "price": item.price,
            "currency": item.currency,
            "region": item.region,
            "country_code": item.country_code,
            "url": item.url,
            "image_url": item.image_url,
            "brand": item.brand,
            "category": item.category,
            "category_path": item.category_path,
            "is_active": item.is_active,
            "is_available": item.is_available,
            "in_stock": item.in_stock,
            "stock_level": item.stock_level,
            "last_checked": item.last_checked,
            "metadata": item.metadata,
        })

    if values_list:
        ins = insert(Product.__table__)
        stmt = (
            ins.values(values_list)
            .on_conflict_do_update(
                constraint="products_sku_source_unique",
                set_={
                    "title": ins.excluded.title,
                    "description": ins.excluded.description,
                    "price": ins.excluded.price,
                    "currency": ins.excluded.currency,
                    "region": ins.excluded.region,
                    "country_code": ins.excluded.country_code,
                    "url": ins.excluded.url,
                    "image_url": ins.excluded.image_url,
                    "brand": ins.excluded.brand,
                    "category": ins.excluded.category,
                    "category_path": ins.excluded.category_path,
                    "merchant_id": ins.excluded.merchant_id,
                    "metadata": ins.excluded.metadata,
                    "is_active": True,
                    "is_available": ins.excluded.is_available,
                    "in_stock": ins.excluded.in_stock,
                    "stock_level": ins.excluded.stock_level,
                    "last_checked": ins.excluded.last_checked,
                }
            )
        )
        await db.execute(stmt)

    final_result = await db.execute(
        select(Product.id, Product.sku, Product.price, Product.is_available).where(
            Product.sku.in_(skus),
            Product.source == body.source
        )
    )
    final_map = {row.sku: (row.id, row.price, row.is_available) for row in final_result.all()}

    price_history_records = []
    for idx, item in enumerate(body.products):
        try:
            if item.sku not in final_map:
                continue

            product_id, new_price, new_available = final_map[item.sku]
            is_update = item.sku in existing_ids
            old_price = existing_map[item.sku][1] if is_update else None
            old_available = existing_map[item.sku][2] if is_update else None

            if item.price is not None:
                price_history_records.append({
                    "product_id": product_id,
                    "price": item.price,
                    "currency": item.currency,
                    "source": body.source,
                })

            product_data = {
                "id": product_id,
                "sku": item.sku,
                "source": body.source,
                "title": item.title,
                "description": item.description,
                "price": item.price,
                "currency": item.currency,
                "url": item.url,
                "brand": item.brand,
                "category": item.category,
                "is_available": item.is_available,
                "metadata": item.metadata,
            }

            if is_update:
                rows_updated += 1
                webhook_events.append({
                    "is_new": False,
                    "product": product_data,
                    "old_price": old_price,
                    "was_available": old_available,
                })
            else:
                rows_inserted += 1
                webhook_events.append({
                    "is_new": True,
                    "product": product_data,
                    "old_price": None,
                    "was_available": None,
                })

        except Exception as e:
            rows_failed += 1
            error_str = str(e)
            code = IngestErrorCode.DATABASE_ERROR
            errors.append(IngestError(
                index=idx,
                sku=item.sku,
                error=error_str,
                code=code,
            ))
            await _log_ingestion_rejection(
                db=db,
                run_id=run.id,
                source=body.source,
                sku=item.sku,
                error_code=code,
                error_message=error_str,
                raw_data=item.model_dump() if hasattr(item, 'model_dump') else None,
            )

    if price_history_records:
        price_history_insert = insert(PriceHistory.__table__).values(price_history_records)
        await db.execute(
            price_history_insert.on_conflict_do_update(
                index_elements=["product_id", "source", "recorded_at"],
                set_={
                    "price": price_history_insert.excluded.price,
                    "currency": price_history_insert.excluded.currency,
                },
            )
        )

    run.rows_inserted = rows_inserted
    run.rows_updated = rows_updated
    run.rows_failed = rows_failed
    run.status = "completed" if rows_failed == 0 else "completed_with_errors"
    await db.commit()

    if rows_inserted > 0 or rows_updated > 0:
        await cache.cache_delete_pattern("products:*")
        await cache.cache_delete_pattern("search:*")

        for event in webhook_events:
            asyncio.create_task(
                _dispatch_webhooks_for_product(
                    db,
                    event["product"]["id"],
                    event["product"],
                    event["is_new"],
                    event["old_price"],
                    event["was_available"],
                )
            )

        for event in webhook_events:
            if event["old_price"] is not None or not event["is_new"]:
                from app.services.price_alert import check_and_trigger_price_alerts
                try:
                    product_price = event["product"]["price"]
                    asyncio.create_task(
                        check_and_trigger_price_alerts(
                            db,
                            event["product"]["id"],
                            Decimal(str(product_price)),
                            event["product"]["currency"],
                        )
                    )
                except Exception as e:
                    logger.warning("Failed to trigger price alerts", extra={"product_id": event["product"]["id"], "error": str(e)})

    return IngestResponse(
        run_id=run.id,
        status=run.status,
        rows_inserted=rows_inserted,
        rows_updated=rows_updated,
        rows_failed=rows_failed,
        errors=errors,
    )


@router.get("/runs", summary="List recent ingestion runs")
@limiter.limit("100/minute")
async def list_ingestion_runs(
    request: Request,
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    db: AsyncSession = Depends(get_db),
    api_key: ApiKey = Depends(get_current_api_key),
):
    request.state.api_key = api_key
    result = await db.execute(
        select(IngestionRun)
        .order_by(IngestionRun.started_at.desc())
        .limit(limit)
        .offset(offset)
    )
    runs = result.scalars().all()

    count_result = await db.execute(select(func.count(IngestionRun.id)))
    total = count_result.scalar_one()

    return {
        "total": total,
        "limit": limit,
        "offset": offset,
        "items": [
            {
                "id": r.id,
                "source": r.source,
                "status": r.status,
                "rows_inserted": r.rows_inserted,
                "rows_updated": r.rows_updated,
                "rows_failed": r.rows_failed,
                "started_at": r.started_at,
                "finished_at": r.finished_at,
            }
            for r in runs
        ]
    }


@router.get("/runs/{run_id}", summary="Get ingestion run by ID")
@limiter.limit("100/minute")
async def get_ingestion_run(
    request: Request,
    run_id: int,
    db: AsyncSession = Depends(get_db),
    api_key: ApiKey = Depends(get_current_api_key),
):
    request.state.api_key = api_key
    result = await db.execute(
        select(IngestionRun).where(IngestionRun.id == run_id)
    )
    run = result.scalar_one_or_none()

    if not run:
        from fastapi import HTTPException, status
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Ingestion run not found")

    return {
        "id": run.id,
        "source": run.source,
        "status": run.status,
        "rows_inserted": run.rows_inserted,
        "rows_updated": run.rows_updated,
        "rows_failed": run.rows_failed,
        "error_message": run.error_message,
        "started_at": run.started_at,
        "finished_at": run.finished_at,
    }
