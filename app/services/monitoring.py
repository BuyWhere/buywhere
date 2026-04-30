import asyncio
import logging
from datetime import datetime, timedelta, timezone
from typing import Optional

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.product import IngestionRun, Product
from app.models.webhook import Webhook
from app.services.webhook import deliver_webhook

logger = logging.getLogger("buywhere_api")

FRESHNESS_THRESHOLD_HOURS = 24
QUALITY_THRESHOLD_SCORE = 0.8


def _compute_hours_since(dt: datetime) -> Optional[float]:
    if dt is None:
        return None
    delta = datetime.now(timezone.utc) - dt
    return delta.total_seconds() / 3600


def _compute_quality_score(
    total_products: int,
    compliant: int,
    products_with_image: int,
    stale_count: int,
) -> float:
    if total_products == 0:
        return 0.0
    
    compliance_weight = 0.4
    image_weight = 0.3
    freshness_weight = 0.3
    
    compliance_rate = compliant / total_products
    image_rate = products_with_image / total_products
    freshness_rate = max(0, 1 - (stale_count / total_products))
    
    score = (
        compliance_weight * compliance_rate +
        image_weight * image_rate +
        freshness_weight * freshness_rate
    )
    return round(score, 4)


async def _get_product_counts(db: AsyncSession) -> dict:
    result = await db.execute(
        select(
            Product.source,
            func.count(Product.id).label("total"),
            func.sum(
                func.cast(Product.is_active == True, int)
            ).label("active"),
        )
        .group_by(Product.source)
    )
    return {row.source: {"total": row.total, "active": row.active or 0} for row in result.all()}


async def _get_compliance_by_source(db: AsyncSession) -> dict:
    result = await db.execute(
        select(
            Product.source,
            func.count(Product.id).label("total"),
        )
        .where(
            Product.title.isnot(None),
            Product.title != "",
            Product.price.isnot(None),
            Product.source.isnot(None),
            Product.sku.isnot(None),
            Product.url.isnot(None),
            Product.url != "",
        )
        .group_by(Product.source)
    )
    return {row.source: row.total for row in result.all()}


async def _get_image_coverage_by_source(db: AsyncSession) -> dict:
    result = await db.execute(
        select(
            Product.source,
            func.count(Product.id).label("with_image"),
        )
        .where(
            Product.image_url.isnot(None),
            Product.image_url != "",
        )
        .group_by(Product.source)
    )
    return {row.source: row.with_image for row in result.all()}


async def _get_stale_count_by_source(db: AsyncSession, threshold_hours: int = FRESHNESS_THRESHOLD_HOURS) -> dict:
    threshold = datetime.now(timezone.utc) - timedelta(hours=threshold_hours)
    result = await db.execute(
        select(
            Product.source,
            func.count(Product.id).label("stale_count"),
        )
        .where(Product.updated_at < threshold)
        .group_by(Product.source)
    )
    return {row.source: row.stale_count for row in result.all()}


async def _get_error_rate(db: AsyncSession, source: str) -> float:
    threshold = datetime.now(timezone.utc) - timedelta(hours=FRESHNESS_THRESHOLD_HOURS)
    result = await db.execute(
        select(
            func.sum(IngestionRun.rows_failed).label("total_failed"),
            func.sum(
                IngestionRun.rows_inserted + IngestionRun.rows_updated + IngestionRun.rows_failed
            ).label("total_rows"),
        )
        .where(
            IngestionRun.source == source,
            IngestionRun.started_at >= threshold,
        )
    )
    row = result.one_or_none()
    if not row or row.total_rows is None or row.total_rows == 0:
        return 0.0
    return round((row.total_failed or 0) / row.total_rows, 4)


async def _get_trend(db: AsyncSession, source: str) -> dict:
    now = datetime.now(timezone.utc)
    day_ago = now - timedelta(hours=24)
    week_ago = now - timedelta(hours=168)
    
    current_count_result = await db.execute(
        select(func.count(Product.id))
        .where(Product.source == source, Product.is_active == True)
    )
    current_count = current_count_result.scalar_one() or 0
    
    day_ago_count_result = await db.execute(
        select(func.count(Product.id))
        .where(
            Product.source == source,
            Product.is_active == True,
            Product.updated_at < day_ago,
        )
    )
    day_ago_count = day_ago_count_result.scalar_one() or 0
    
    week_ago_count_result = await db.execute(
        select(func.count(Product.id))
        .where(
            Product.source == source,
            Product.is_active == True,
            Product.updated_at < week_ago,
        )
    )
    week_ago_count = week_ago_count_result.scalar_one() or 0
    
    day_change = current_count - day_ago_count
    week_change = current_count - week_ago_count
    
    return {
        "current_count": current_count,
        "change_24h": day_change,
        "change_168h": week_change,
    }


async def _get_latest_run(db: AsyncSession, source: str) -> Optional[dict]:
    result = await db.execute(
        select(IngestionRun)
        .where(IngestionRun.source == source)
        .order_by(IngestionRun.started_at.desc())
        .limit(1)
    )
    run = result.scalar_one_or_none()
    if not run:
        return None
    return {
        "started_at": run.started_at,
        "finished_at": run.finished_at,
        "status": run.status,
        "rows_inserted": run.rows_inserted or 0,
        "rows_updated": run.rows_updated or 0,
        "rows_failed": run.rows_failed or 0,
        "error_message": run.error_message,
    }


async def compute_platform_metrics(db: AsyncSession, source: str) -> dict:
    product_counts = await _get_product_counts(db)
    counts = product_counts.get(source, {"total": 0, "active": 0})
    total = counts["total"]
    active = counts["active"]
    
    compliance_by_source = await _get_compliance_by_source(db)
    compliant = compliance_by_source.get(source, 0)
    
    image_coverage = await _get_image_coverage_by_source(db)
    products_with_image = image_coverage.get(source, 0)
    
    stale_by_source = await _get_stale_count_by_source(db)
    stale_count = stale_by_source.get(source, 0)
    
    quality_score = _compute_quality_score(total, compliant, products_with_image, stale_count)
    error_rate = await _get_error_rate(db, source)
    trend = await _get_trend(db, source)
    latest_run = await _get_latest_run(db, source)
    
    hours_since_run = None
    if latest_run and latest_run.get("started_at"):
        hours_since_run = _compute_hours_since(latest_run["started_at"])
    
    is_stale = hours_since_run is not None and hours_since_run > FRESHNESS_THRESHOLD_HOURS
    is_low_quality = quality_score < QUALITY_THRESHOLD_SCORE
    
    return {
        "source": source,
        "total_products": total,
        "active_products": active,
        "compliant_products": compliant,
        "products_with_image": products_with_image,
        "stale_products": stale_count,
        "quality_score": quality_score,
        "error_rate": error_rate,
        "is_stale": is_stale,
        "is_low_quality": is_low_quality,
        "hours_since_last_run": hours_since_run,
        "last_run": latest_run,
        "trend": trend,
    }


async def compute_all_metrics(db: AsyncSession) -> dict:
    product_counts = await _get_product_counts(db)
    all_sources = sorted(product_counts.keys())
    
    platforms = []
    stale_count = 0
    low_quality_count = 0
    
    compliance_by_source = await _get_compliance_by_source(db)
    image_coverage = await _get_image_coverage_by_source(db)
    stale_by_source = await _get_stale_count_by_source(db)
    
    for source in all_sources:
        counts = product_counts[source]
        total = counts["total"]
        active = counts["active"]
        compliant = compliance_by_source.get(source, 0)
        products_with_image = image_coverage.get(source, 0)
        stale = stale_by_source.get(source, 0)
        stale_count += stale
        
        quality_score = _compute_quality_score(total, compliant, products_with_image, stale)
        error_rate = await _get_error_rate(db, source)
        trend = await _get_trend(db, source)
        latest_run = await _get_latest_run(db, source)
        
        hours_since_run = None
        if latest_run and latest_run.get("started_at"):
            hours_since_run = _compute_hours_since(latest_run["started_at"])
        
        is_stale = hours_since_run is not None and hours_since_run > FRESHNESS_THRESHOLD_HOURS
        is_low_quality = quality_score < QUALITY_THRESHOLD_SCORE
        
        if is_low_quality:
            low_quality_count += 1
        
        platforms.append({
            "source": source,
            "total_products": total,
            "active_products": active,
            "compliant_products": compliant,
            "products_with_image": products_with_image,
            "stale_products": stale,
            "quality_score": quality_score,
            "error_rate": error_rate,
            "is_stale": is_stale,
            "is_low_quality": is_low_quality,
            "hours_since_last_run": hours_since_run,
            "last_run": latest_run,
            "trend": trend,
        })
    
    total_products = sum(p["total_products"] for p in platforms)
    total_active = sum(p["active_products"] for p in platforms)
    total_compliant = sum(p["compliant_products"] for p in platforms)
    total_with_image = sum(p["products_with_image"] for p in platforms)
    
    overall_quality = _compute_quality_score(
        total_products, total_compliant, total_with_image, stale_count
    )
    
    return {
        "generated_at": datetime.now(timezone.utc),
        "freshness_threshold_hours": FRESHNESS_THRESHOLD_HOURS,
        "quality_threshold_score": QUALITY_THRESHOLD_SCORE,
        "total_products": total_products,
        "total_active": total_active,
        "total_stale": stale_count,
        "overall_quality_score": overall_quality,
        "platform_count": len(platforms),
        "stale_platform_count": sum(1 for p in platforms if p["is_stale"]),
        "low_quality_platform_count": low_quality_count,
        "platforms": platforms,
    }


async def check_and_fire_alerts(db: AsyncSession, metrics: dict) -> list[dict]:
    alerts_fired = []
    
    for platform in metrics["platforms"]:
        source = platform["source"]
        
        if platform["is_stale"]:
            alert = {
                "type": "data_stale",
                "severity": "warning",
                "source": source,
                "message": f"Data from {source} is stale (last run {platform['hours_since_last_run']:.1f} hours ago)",
                "hours_since_last_run": platform["hours_since_last_run"],
            }
            alerts_fired.append(alert)
            logger.warning(f"ALERT: {alert['message']}")
        
        if platform["is_low_quality"]:
            alert = {
                "type": "low_quality",
                "severity": "warning",
                "source": source,
                "message": f"Quality score for {source} is below threshold ({platform['quality_score']:.2f} < {QUALITY_THRESHOLD_SCORE})",
                "quality_score": platform["quality_score"],
            }
            alerts_fired.append(alert)
            logger.warning(f"ALERT: {alert['message']}")
        
        if platform.get("last_run") and platform["last_run"].get("status") == "failed":
            alert = {
                "type": "run_failed",
                "severity": "error",
                "source": source,
                "message": f"Ingestion run failed for {source}: {platform['last_run'].get('error_message', 'Unknown error')}",
            }
            alerts_fired.append(alert)
            logger.error(f"ALERT: {alert['message']}")
    
    if alerts_fired:
        await _trigger_alert_webhooks(db, alerts_fired)
    
    return alerts_fired


async def _trigger_alert_webhooks(db: AsyncSession, alerts: list[dict]):
    result = await db.execute(
        select(Webhook).where(
            Webhook.active == True,
            Webhook.events.contains(["alert"]),
        )
    )
    webhooks = result.scalars().all()
    
    if not webhooks:
        logger.info("No alert webhooks configured")
        return
    
    payload = {
        "event": "metrics.alert",
        "alerts": alerts,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
    
    for webhook in webhooks:
        asyncio.create_task(
            deliver_webhook(db, webhook.id, "metrics.alert", payload)
        )
        logger.info(f"Triggered alert webhook {webhook.id} for {len(alerts)} alerts")