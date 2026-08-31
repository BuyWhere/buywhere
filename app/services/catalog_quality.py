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


def _json_safe(value: Any) -> Any:
    """Recursively convert datetime/Decimal values to JSON-serializable forms."""
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, dict):
        return {k: _json_safe(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_json_safe(v) for v in value]
    if isinstance(value, tuple):
        return [_json_safe(v) for v in value]
    return value


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
    snapshot.per_platform_scores = _json_safe(payload)

    await db.flush()
    return snapshot


async def build_catalog_quality_report_fast(db: AsyncSession) -> dict[str, Any]:
    """Build a catalog quality report using SQL aggregates.

    This is a scalable replacement for `build_catalog_quality_report` that
    keeps memory bounded by asking PostgreSQL to compute the metrics instead
    of loading every active product into the application. It returns a report
    dict with the same shape expected by `persist_catalog_quality_snapshot`.
    """
    now = datetime.now(timezone.utc)
    active_predicate = "is_active = TRUE"
    updated_expr = "COALESCE(data_updated_at, updated_at)"

    # Overall metrics
    overall_query = text(
        f"""
        SELECT
            COUNT(*) AS total_products,
            ROUND(AVG(freshness_score)::numeric, 4) AS avg_freshness_score,
            ROUND(AVG(completeness_score)::numeric, 4) AS avg_completeness_score,
            ROUND((SUM(CASE WHEN image_url IS NOT NULL AND image_url <> '' THEN 1 ELSE 0 END)::numeric
                / NULLIF(COUNT(*), 0)) * 100, 2) AS image_url_pct,
            ROUND((SUM(CASE WHEN description IS NOT NULL AND description <> '' THEN 1 ELSE 0 END)::numeric
                / NULLIF(COUNT(*), 0)) * 100, 2) AS description_pct,
            ROUND((SUM(CASE WHEN price IS NOT NULL THEN 1 ELSE 0 END)::numeric
                / NULLIF(COUNT(*), 0)) * 100, 2) AS price_pct,
            ROUND((SUM(CASE WHEN brand IS NOT NULL AND brand <> '' THEN 1 ELSE 0 END)::numeric
                / NULLIF(COUNT(*), 0)) * 100, 2) AS brand_pct,
            SUM(CASE WHEN is_stale THEN 1 ELSE 0 END) AS stale_products
        FROM (
            SELECT
                image_url,
                description,
                price,
                brand,
                CASE
                    WHEN {updated_expr} IS NULL THEN 0.0
                    WHEN EXTRACT(EPOCH FROM (NOW() AT TIME ZONE 'UTC' - {updated_expr})) / 86400 >= :stale_days THEN 0.0
                    ELSE 1.0 - (EXTRACT(EPOCH FROM (NOW() AT TIME ZONE 'UTC' - {updated_expr})) / 86400) / :stale_days
                END AS freshness_score,
                (
                    (CASE WHEN title IS NOT NULL AND title <> '' THEN 1 ELSE 0 END) +
                    (CASE WHEN description IS NOT NULL AND description <> '' THEN 1 ELSE 0 END) +
                    (CASE WHEN price IS NOT NULL THEN 1 ELSE 0 END) +
                    (CASE WHEN url IS NOT NULL AND url <> '' THEN 1 ELSE 0 END) +
                    (CASE WHEN image_url IS NOT NULL AND image_url <> '' THEN 1 ELSE 0 END) +
                    (CASE WHEN brand IS NOT NULL AND brand <> '' THEN 1 ELSE 0 END) +
                    (CASE WHEN category IS NOT NULL AND category <> '' THEN 1 ELSE 0 END) +
                    (CASE WHEN sku IS NOT NULL AND sku <> '' THEN 1 ELSE 0 END)
                ) / 8.0 AS completeness_score,
                CASE
                    WHEN {updated_expr} IS NULL THEN TRUE
                    WHEN EXTRACT(EPOCH FROM (NOW() AT TIME ZONE 'UTC' - {updated_expr})) / 86400 >= :stale_days THEN TRUE
                    ELSE FALSE
                END AS is_stale
            FROM products
            WHERE {active_predicate}
        ) subq
        """
    ).bindparams(stale_days=STALE_THRESHOLD_DAYS)

    overall_row = (await db.execute(overall_query)).mappings().one()
    total_products = int(overall_row["total_products"] or 0)
    avg_freshness = float(overall_row["avg_freshness_score"] or 0.0)
    avg_completeness = float(overall_row["avg_completeness_score"] or 0.0)
    # Price accuracy is expensive to compute across all history; use the same
    # fallback as the per-product function when no recent history exists.
    avg_price_accuracy = 0.6
    overall_quality = compute_overall_score(
        freshness_score=avg_freshness,
        completeness_score=avg_completeness,
        price_accuracy_score=avg_price_accuracy,
    )
    stale_products = int(overall_row["stale_products"] or 0)

    # Bucketed aggregates (source, region, category)
    def _bucket_query(group_col: str) -> text:
        coalesce_value = "'unknown'" if group_col != "category" else "'uncategorized'"
        return text(
            f"""
            SELECT
                COALESCE({group_col}, {coalesce_value}) AS name,
                COUNT(*) AS product_count,
                SUM(CASE WHEN is_stale THEN 1 ELSE 0 END) AS stale_products,
                ROUND(AVG(freshness_score)::numeric, 4) AS avg_freshness_score,
                ROUND(AVG(completeness_score)::numeric, 4) AS avg_completeness_score,
                ROUND(AVG(0.6)::numeric, 4) AS avg_price_accuracy_score,
                ROUND((AVG(freshness_score) * 0.4 + AVG(completeness_score) * 0.35 + 0.6 * 0.25)::numeric, 4) AS avg_overall_score
            FROM (
                SELECT
                    {group_col},
                    CASE
                        WHEN {updated_expr} IS NULL THEN 0.0
                        WHEN EXTRACT(EPOCH FROM (NOW() AT TIME ZONE 'UTC' - {updated_expr})) / 86400 >= :stale_days THEN 0.0
                        ELSE 1.0 - (EXTRACT(EPOCH FROM (NOW() AT TIME ZONE 'UTC' - {updated_expr})) / 86400) / :stale_days
                    END AS freshness_score,
                    (
                        (CASE WHEN title IS NOT NULL AND title <> '' THEN 1 ELSE 0 END) +
                        (CASE WHEN description IS NOT NULL AND description <> '' THEN 1 ELSE 0 END) +
                        (CASE WHEN price IS NOT NULL THEN 1 ELSE 0 END) +
                        (CASE WHEN url IS NOT NULL AND url <> '' THEN 1 ELSE 0 END) +
                        (CASE WHEN image_url IS NOT NULL AND image_url <> '' THEN 1 ELSE 0 END) +
                        (CASE WHEN brand IS NOT NULL AND brand <> '' THEN 1 ELSE 0 END) +
                        (CASE WHEN category IS NOT NULL AND category <> '' THEN 1 ELSE 0 END) +
                        (CASE WHEN sku IS NOT NULL AND sku <> '' THEN 1 ELSE 0 END)
                    ) / 8.0 AS completeness_score,
                    CASE
                        WHEN {updated_expr} IS NULL THEN TRUE
                        WHEN EXTRACT(EPOCH FROM (NOW() AT TIME ZONE 'UTC' - {updated_expr})) / 86400 >= :stale_days THEN TRUE
                        ELSE FALSE
                    END AS is_stale
                FROM products
                WHERE {active_predicate}
            ) subq
            GROUP BY {group_col}
            """
        ).bindparams(stale_days=STALE_THRESHOLD_DAYS)

    async def _load_buckets(group_col: str) -> list[dict[str, Any]]:
        rows = (await db.execute(_bucket_query(group_col))).mappings().all()
        buckets = []
        for row in rows:
            count = int(row["product_count"] or 0)
            stale = int(row["stale_products"] or 0)
            buckets.append({
                "name": row["name"],
                "product_count": count,
                "stale_products": stale,
                "stale_rate": round(stale / count, 4) if count else 0.0,
                "avg_freshness_score": float(row["avg_freshness_score"] or 0.0),
                "avg_completeness_score": float(row["avg_completeness_score"] or 0.0),
                "avg_price_accuracy_score": float(row["avg_price_accuracy_score"] or 0.0),
                "avg_overall_score": float(row["avg_overall_score"] or 0.0),
            })
        buckets.sort(key=lambda item: (-item["avg_overall_score"], -item["product_count"], item["name"]))
        return buckets

    by_source = await _load_buckets("source")
    by_region = await _load_buckets("region")
    by_category = await _load_buckets("category")

    # Stale product sample
    stale_sample_query = text(
        f"""
        SELECT
            id AS product_id,
            COALESCE(source, 'unknown') AS source,
            COALESCE(region, 'unknown') AS region,
            COALESCE(category, 'uncategorized') AS category,
            COALESCE(title, '') AS title,
            COALESCE(url, '') AS url,
            {updated_expr} AS updated_at,
            0.0 AS overall_score,
            ARRAY[]::text[] AS missing_fields
        FROM products
        WHERE {active_predicate}
          AND {updated_expr} IS NOT NULL
          AND EXTRACT(EPOCH FROM (NOW() AT TIME ZONE 'UTC' - {updated_expr})) / 86400 >= :stale_days
        ORDER BY {updated_expr} ASC
        LIMIT :sample_limit
        """
    ).bindparams(stale_days=STALE_THRESHOLD_DAYS, sample_limit=MAX_SAMPLE_PRODUCTS)

    stale_sample = [dict(row) for row in (await db.execute(stale_sample_query)).mappings().all()]

    rescrape_candidates = sorted(
        [source for source in by_source if source["stale_products"] > 0],
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
                "image_url_pct": float(overall_row["image_url_pct"] or 0.0),
                "description_pct": float(overall_row["description_pct"] or 0.0),
                "price_pct": float(overall_row["price_pct"] or 0.0),
                "brand_pct": float(overall_row["brand_pct"] or 0.0),
            },
        },
        "aggregates": {
            "by_source": by_source,
            "by_region": by_region,
            "by_category": by_category,
        },
        "re_scrape_recommendations": {
            "count": len(rescrape_candidates),
            "sources": rescrape_candidates,
        },
        "stale_products": {
            "count": stale_products,
            "sample": stale_sample,
        },
        "low_quality_products": [],
    }
