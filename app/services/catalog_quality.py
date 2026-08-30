from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from statistics import median
from typing import Any
from types import SimpleNamespace

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.product import DataQualityMetrics, PriceHistory, Product

STALE_THRESHOLD_DAYS = 7
PRICE_HISTORY_LOOKBACK_DAYS = 30
LOW_QUALITY_THRESHOLD = 0.6
MAX_SAMPLE_PRODUCTS = 25


@dataclass
class ProductQualityScore:
    product_id: int
    source: str
    region: str
    category: str
    title: str
    url: str
    updated_at: datetime | None
    freshness_score: float
    completeness_score: float
    price_accuracy_score: float
    overall_score: float
    is_stale: bool
    missing_fields: list[str]


def _normalize_datetime(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _round_score(value: float) -> float:
    return round(max(0.0, min(1.0, value)), 4)


def compute_freshness_score(updated_at: datetime | None, *, now: datetime | None = None) -> tuple[float, bool, int | None]:
    updated = _normalize_datetime(updated_at)
    current = now or datetime.now(timezone.utc)
    if updated is None:
        return 0.0, True, None

    age_days = max((current - updated).total_seconds() / 86400, 0.0)
    stale = age_days >= STALE_THRESHOLD_DAYS

    if stale:
        return 0.0, True, int(age_days)

    score = 1.0 - (age_days / STALE_THRESHOLD_DAYS)
    return _round_score(score), False, int(age_days)


def compute_completeness_score(product: Product) -> tuple[float, list[str]]:
    fields: list[tuple[str, Any]] = [
        ("title", product.title),
        ("description", product.description),
        ("price", product.price),
        ("url", product.url),
        ("image_url", product.image_url),
        ("brand", product.brand),
        ("category", product.category),
        ("sku", product.sku),
    ]

    missing: list[str] = []
    present = 0
    for field_name, value in fields:
        if value is None:
            missing.append(field_name)
            continue
        if isinstance(value, str) and value.strip() == "":
            missing.append(field_name)
            continue
        present += 1

    return _round_score(present / len(fields)), missing


def compute_price_accuracy_score(product: Product, history_prices: list[Decimal | float | int]) -> float:
    if product.price is None:
        return 0.0

    current_price = float(product.price)
    if current_price <= 0:
        return 0.0

    normalized_history = [float(price) for price in history_prices if price is not None and float(price) > 0]
    if not normalized_history:
        return 0.6

    reference_price = median(normalized_history)
    if reference_price <= 0:
        return 0.6

    diff_ratio = abs(current_price - reference_price) / reference_price
    score = 1.0 - min(diff_ratio, 1.0)
    return _round_score(score)


def compute_overall_score(*, freshness_score: float, completeness_score: float, price_accuracy_score: float) -> float:
    score = (
        freshness_score * 0.4
        + completeness_score * 0.35
        + price_accuracy_score * 0.25
    )
    return _round_score(score)


def _init_bucket(name: str) -> dict[str, Any]:
    return {
        "name": name,
        "product_count": 0,
        "stale_products": 0,
        "avg_freshness_score": 0.0,
        "avg_completeness_score": 0.0,
        "avg_price_accuracy_score": 0.0,
        "avg_overall_score": 0.0,
    }


def _update_bucket(bucket: dict[str, Any], score: ProductQualityScore) -> None:
    bucket["product_count"] += 1
    bucket["stale_products"] += int(score.is_stale)
    bucket["avg_freshness_score"] += score.freshness_score
    bucket["avg_completeness_score"] += score.completeness_score
    bucket["avg_price_accuracy_score"] += score.price_accuracy_score
    bucket["avg_overall_score"] += score.overall_score


def _finalize_buckets(buckets: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    finalized: list[dict[str, Any]] = []
    for bucket in buckets.values():
        count = bucket["product_count"] or 1
        finalized.append({
            "name": bucket["name"],
            "product_count": bucket["product_count"],
            "stale_products": bucket["stale_products"],
            "stale_rate": round(bucket["stale_products"] / count, 4),
            "avg_freshness_score": round(bucket["avg_freshness_score"] / count, 4),
            "avg_completeness_score": round(bucket["avg_completeness_score"] / count, 4),
            "avg_price_accuracy_score": round(bucket["avg_price_accuracy_score"] / count, 4),
            "avg_overall_score": round(bucket["avg_overall_score"] / count, 4),
        })
    finalized.sort(key=lambda item: (-item["avg_overall_score"], -item["product_count"], item["name"]))
    return finalized


async def _load_recent_price_history(
    db: AsyncSession,
    product_ids: list[int],
    *,
    now: datetime,
) -> dict[int, list[Decimal]]:
    if not product_ids:
        return {}

    cutoff = now - timedelta(days=PRICE_HISTORY_LOOKBACK_DAYS)
    result = await db.execute(
        text(
            """
            SELECT DISTINCT ON (product_id)
                product_id,
                price
            FROM price_history
            WHERE recorded_at >= :cutoff
            ORDER BY product_id, recorded_at DESC
            """
        )
        .bindparams(cutoff=cutoff)
    )

    history: dict[int, list[Decimal]] = {}
    valid_product_ids = set(product_ids)
    for product_id, price in result.all():
        if product_id not in valid_product_ids:
            continue
        history.setdefault(product_id, []).append(price)
    return history


async def _get_product_column_names(db: AsyncSession) -> set[str]:
    result = await db.execute(
        text(
            """
            SELECT column_name
            FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'products'
            """
        )
    )
    return {row[0] for row in result.all()}


async def _load_product_rows(db: AsyncSession) -> list[SimpleNamespace]:
    columns = await _get_product_column_names(db)

    region_expr = "'sg'"
    if "region" in columns:
        region_expr = "COALESCE(region, 'sg')"
    elif "country_code" in columns:
        region_expr = "LOWER(COALESCE(country_code, 'SG'))"

    updated_expr = "updated_at"
    if "data_updated_at" in columns:
        updated_expr = "COALESCE(data_updated_at, updated_at)"

    active_predicate = "TRUE"
    if "is_active" in columns:
        active_predicate = "COALESCE(is_active, TRUE) = TRUE"

    query = text(
        f"""
        SELECT
            id,
            COALESCE(source, 'unknown') AS source,
            {region_expr} AS region,
            COALESCE(category, 'uncategorized') AS category,
            COALESCE(title, '') AS title,
            description,
            price,
            COALESCE(url, '') AS url,
            image_url,
            brand,
            sku,
            {updated_expr} AS effective_updated_at
        FROM products
        WHERE {active_predicate}
        """
    )
    result = await db.execute(query)
    return [SimpleNamespace(**row) for row in result.mappings().all()]


async def build_catalog_quality_report(db: AsyncSession) -> dict[str, Any]:
    now = datetime.now(timezone.utc)
    products = await _load_product_rows(db)
    price_history = await _load_recent_price_history(db, [product.id for product in products], now=now)

    by_source: dict[str, dict[str, Any]] = {}
    by_region: dict[str, dict[str, Any]] = {}
    by_category: dict[str, dict[str, Any]] = {}
    scored_products: list[ProductQualityScore] = []
    field_presence = {
        "image_url": 0,
        "description": 0,
        "price": 0,
        "brand": 0,
    }

    for product in products:
        freshness_score, is_stale, _ = compute_freshness_score(
            product.effective_updated_at,
            now=now,
        )
        completeness_score, missing_fields = compute_completeness_score(product)
        price_accuracy_score = compute_price_accuracy_score(product, price_history.get(product.id, []))
        overall_score = compute_overall_score(
            freshness_score=freshness_score,
            completeness_score=completeness_score,
            price_accuracy_score=price_accuracy_score,
        )

        scored = ProductQualityScore(
            product_id=product.id,
            source=product.source or "unknown",
            region=product.region or "unknown",
            category=product.category or "uncategorized",
            title=product.title or "",
            url=product.url or "",
            updated_at=_normalize_datetime(product.effective_updated_at),
            freshness_score=freshness_score,
            completeness_score=completeness_score,
            price_accuracy_score=price_accuracy_score,
            overall_score=overall_score,
            is_stale=is_stale,
            missing_fields=missing_fields,
        )
        scored_products.append(scored)

        if product.image_url and str(product.image_url).strip():
            field_presence["image_url"] += 1
        if product.description and str(product.description).strip():
            field_presence["description"] += 1
        if product.price is not None:
            field_presence["price"] += 1
        if product.brand and str(product.brand).strip():
            field_presence["brand"] += 1

        for key, value, buckets in (
            ("source", scored.source, by_source),
            ("region", scored.region, by_region),
            ("category", scored.category, by_category),
        ):
            if value not in buckets:
                buckets[value] = _init_bucket(value)
            _update_bucket(buckets[value], scored)

    total_products = len(scored_products)
    stale_products = sum(1 for product in scored_products if product.is_stale)
    avg_freshness = round(sum(product.freshness_score for product in scored_products) / total_products, 4) if total_products else 0.0
    avg_completeness = round(sum(product.completeness_score for product in scored_products) / total_products, 4) if total_products else 0.0
    avg_price_accuracy = round(sum(product.price_accuracy_score for product in scored_products) / total_products, 4) if total_products else 0.0
    overall_quality = round(sum(product.overall_score for product in scored_products) / total_products, 4) if total_products else 0.0

    stale_sample = sorted(
        [product for product in scored_products if product.is_stale],
        key=lambda item: item.updated_at or datetime.fromtimestamp(0, tz=timezone.utc),
    )[:MAX_SAMPLE_PRODUCTS]
    low_quality_sample = sorted(scored_products, key=lambda item: (item.overall_score, item.updated_at or datetime.max.replace(tzinfo=timezone.utc)))[:MAX_SAMPLE_PRODUCTS]

    rescrape_candidates = sorted(
        [source for source in _finalize_buckets(by_source) if source["stale_products"] > 0],
        key=lambda item: (-item["stale_products"], item["avg_overall_score"], item["name"]),
    )

    return {
        "generated_at": now,
        "snapshot_date": now.date(),
        "thresholds": {
            "stale_after_days": STALE_THRESHOLD_DAYS,
            "low_quality_score": LOW_QUALITY_THRESHOLD,
            "price_history_lookback_days": PRICE_HISTORY_LOOKBACK_DAYS,
        },
        "overview": {
            "total_products": total_products,
            "overall_quality_score": overall_quality,
            "avg_freshness_score": avg_freshness,
            "avg_completeness_score": avg_completeness,
            "avg_price_accuracy_score": avg_price_accuracy,
            "stale_products": stale_products,
            "stale_rate": round(stale_products / total_products, 4) if total_products else 0.0,
            "field_completeness": {
                "image_url_pct": round((field_presence["image_url"] / total_products) * 100, 2) if total_products else 0.0,
                "description_pct": round((field_presence["description"] / total_products) * 100, 2) if total_products else 0.0,
                "price_pct": round((field_presence["price"] / total_products) * 100, 2) if total_products else 0.0,
                "brand_pct": round((field_presence["brand"] / total_products) * 100, 2) if total_products else 0.0,
            },
        },
        "aggregates": {
            "by_source": _finalize_buckets(by_source),
            "by_region": _finalize_buckets(by_region),
            "by_category": _finalize_buckets(by_category),
        },
        "re_scrape_recommendations": {
            "count": len(rescrape_candidates),
            "sources": rescrape_candidates,
        },
        "stale_products": {
            "count": stale_products,
            "sample": [
                {
                    "product_id": product.product_id,
                    "source": product.source,
                    "region": product.region,
                    "category": product.category,
                    "title": product.title,
                    "url": product.url,
                    "updated_at": product.updated_at,
                    "overall_score": product.overall_score,
                    "missing_fields": product.missing_fields,
                }
                for product in stale_sample
            ],
        },
        "low_quality_products": [
            {
                "product_id": product.product_id,
                "source": product.source,
                "region": product.region,
                "category": product.category,
                "title": product.title,
                "url": product.url,
                "updated_at": product.updated_at,
                "freshness_score": product.freshness_score,
                "completeness_score": product.completeness_score,
                "price_accuracy_score": product.price_accuracy_score,
                "overall_score": product.overall_score,
                "is_stale": product.is_stale,
                "missing_fields": product.missing_fields,
            }
            for product in low_quality_sample
            if product.overall_score <= LOW_QUALITY_THRESHOLD
        ],
    }


async def persist_catalog_quality_snapshot(db: AsyncSession, report: dict[str, Any]) -> DataQualityMetrics:
    snapshot_date = report["snapshot_date"]
    if isinstance(snapshot_date, datetime):
        snapshot_date = snapshot_date.date()
    assert isinstance(snapshot_date, date)

    overview = report["overview"]
    field_completeness = overview["field_completeness"]
    payload = {
        "by_source": report["aggregates"]["by_source"],
        "by_region": report["aggregates"]["by_region"],
        "by_category": report["aggregates"]["by_category"],
        "re_scrape_recommendations": report["re_scrape_recommendations"],
        "stale_products": report["stale_products"],
    }

    result = await db.execute(
        select(DataQualityMetrics).where(DataQualityMetrics.snapshot_date == snapshot_date)
    )
    snapshot = result.scalar_one_or_none()
    if snapshot is None:
        snapshot = DataQualityMetrics(snapshot_date=snapshot_date)
        db.add(snapshot)

    snapshot.total_products = overview["total_products"]
    snapshot.products_with_image_pct = Decimal(str(field_completeness["image_url_pct"]))
    snapshot.products_with_description_pct = Decimal(str(field_completeness["description_pct"]))
    snapshot.products_with_price_pct = Decimal(str(field_completeness["price_pct"]))
    snapshot.products_with_brand_pct = Decimal(str(field_completeness["brand_pct"]))
    snapshot.overall_quality_score = Decimal(str(round(overview["overall_quality_score"] * 100, 2)))
    snapshot.per_platform_scores = payload

    await db.flush()
    return snapshot
