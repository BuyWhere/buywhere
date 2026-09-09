from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import List, Optional
import re

from sqlalchemy import func, select, and_, or_, Integer
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.product import Product
from app.services.product_freshness import build_catalog_freshness_monitor_report


FRESINESS_THRESHOLD_DAYS = 7

_IMAGE_URL_PATTERN = re.compile(
    r"^https?://"
    r"(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}"
    r"(?:[:/].*)?$",
    re.IGNORECASE,
)


def _is_valid_image_url(url: Optional[str]) -> bool:
    if not url:
        return False
    if not isinstance(url, str):
        return False
    url = url.strip()
    if url == "":
        return False
    if not url.startswith(("http://", "https://")):
        return False
    return bool(_IMAGE_URL_PATTERN.match(url))


async def compute_schema_compliance(db: AsyncSession) -> dict:
    total_result = await db.execute(select(func.count(Product.id)))
    total = total_result.scalar_one() or 0

    compliant_result = await db.execute(
        select(func.count(Product.id)).where(
            Product.title.isnot(None),
            Product.title != "",
            Product.price.isnot(None),
            Product.source.isnot(None),
            Product.sku.isnot(None),
            Product.url.isnot(None),
            Product.url != "",
        )
    )
    compliant = compliant_result.scalar_one() or 0

    missing_title_result = await db.execute(
        select(func.count(Product.id)).where(
            or_(Product.title.is_(None), Product.title == "")
        )
    )
    missing_title = missing_title_result.scalar_one() or 0

    missing_price_result = await db.execute(
        select(func.count(Product.id)).where(Product.price.is_(None))
    )
    missing_price = missing_price_result.scalar_one() or 0

    missing_source_result = await db.execute(
        select(func.count(Product.id)).where(
            or_(Product.source.is_(None), Product.source == "")
        )
    )
    missing_source = missing_source_result.scalar_one() or 0

    missing_sku_result = await db.execute(
        select(
            func.count(Product.id).where(
                or_(Product.sku.is_(None), Product.sku == "")
            )
        )
    )
    missing_sku = missing_sku_result.scalar_one() or 0

    missing_url_result = await db.execute(
        select(
            func.count(Product.id).where(
                or_(Product.url.is_(None), Product.url == "")
            )
        )
    )
    missing_url = missing_url_result.scalar_one() or 0

    incomplete_result = await db.execute(
        select(
            func.count(Product.id).where(
                or_(
                    Product.title.is_(None),
                    Product.title == "",
                    Product.price.is_(None),
                    Product.url.is_(None),
                    Product.url == "",
                )
            )
        )
    )
    incomplete = incomplete_result.scalar_one() or 0

    platform_breakdown_result = await db.execute(
        select(
            Product.source,
            func.count(Product.id).label("total"),
            func.sum(
                func.cast(
                    and_(
                        Product.title.isnot(None),
                        Product.title != "",
                        Product.price.isnot(None),
                        Product.source.isnot(None),
                        Product.sku.isnot(None),
                        Product.url.isnot(None),
                        Product.url != "",
                    ).cast(Integer),
                    Integer,
                )
            ).label("compliant"),
        ).group_by(Product.source)
    )

    by_platform = []
    for row in platform_breakdown_result.all():
        total_p = row.total or 0
        compliant_p = row.compliant or 0
        rate = (compliant_p / total_p * 100) if total_p > 0 else 0.0
        by_platform.append({
            "source": row.source,
            "total": total_p,
            "compliant": compliant_p,
            "compliance_rate": round(rate, 2),
        })

    return {
        "total_products": total,
        "compliant_products": compliant,
        "compliance_rate": round((compliant / total * 100) if total > 0 else 0.0, 2),
        "by_platform": by_platform,
        "missing_title": missing_title,
        "missing_price": missing_price,
        "missing_source": missing_source,
        "missing_source_id": missing_sku,
        "missing_url": missing_url,
        "incomplete_products": incomplete,
    }


async def compute_deduplication(db: AsyncSession) -> dict:
    total_result = await db.execute(select(func.count(Product.id)))
    total = total_result.scalar_one() or 0

    canonical_result = await db.execute(
        select(func.count(Product.id)).where(Product.canonical_id.isnot(None))
    )
    with_canonical = canonical_result.scalar_one() or 0

    dup_groups_result = await db.execute(
        select(
            Product.canonical_id,
            func.count(Product.id).label("cnt"),
            func.array_agg(Product.id).label("ids"),
            func.array_agg(Product.source).label("sources"),
            func.min(Product.title).label("sample_title"),
            func.min(Product.price).label("price_min"),
            func.max(Product.price).label("price_max"),
        )
        .where(Product.canonical_id.isnot(None))
        .group_by(Product.canonical_id)
        .having(func.count(Product.id) > 1)
    )

    sample_duplicates = []
    for row in dup_groups_result.limit(10):
        sources = row.sources or []
        unique_sources = list(dict.fromkeys(sources))
        sample_duplicates.append({
            "canonical_id": row.canonical_id,
            "product_ids": (row.ids or [])[:10],
            "source_count": len(unique_sources),
            "sources": unique_sources,
            "sample_title": row.sample_title or "",
            "price_min": row.price_min or Decimal("0"),
            "price_max": row.price_max or Decimal("0"),
        })

    dup_groups_count_result = await db.execute(
        select(func.count(func.distinct(Product.canonical_id))).where(
            Product.canonical_id.isnot(None)
        )
    )
    duplicate_groups = dup_groups_count_result.scalar_one() or 0

    return {
        "total_products": total,
        "products_with_canonical": with_canonical,
        "duplicate_rate": round((with_canonical / total * 100) if total > 0 else 0.0, 2),
        "duplicate_groups": duplicate_groups,
        "sample_duplicates": sample_duplicates,
    }


async def compute_freshness(db: AsyncSession, threshold_days: int = FRESINESS_THRESHOLD_DAYS) -> dict:
    total_result = await db.execute(select(func.count(Product.id)))
    total = total_result.scalar_one() or 0

    threshold = datetime.now(timezone.utc) - timedelta(days=threshold_days)
    stale_result = await db.execute(
        select(func.count(Product.id)).where(Product.updated_at < threshold)
    )
    stale_count = stale_result.scalar_one() or 0

    stale_by_platform_result = await db.execute(
        select(
            Product.source,
            func.count(Product.id).label("stale_count"),
        )
        .where(Product.updated_at < threshold)
        .group_by(Product.source)
    )
    by_platform = {row.source: row.stale_count for row in stale_by_platform_result.all()}

    stale_sample_result = await db.execute(
        select(Product)
        .where(Product.updated_at < threshold)
        .order_by(Product.updated_at.asc())
        .limit(10)
    )
    stale_products = stale_sample_result.scalars().all()

    sample_stale = []
    now = datetime.now(timezone.utc)
    for p in stale_products:
        days_stale = (now - p.updated_at).days if p.updated_at else 0
        sample_stale.append({
            "product_id": p.id,
            "title": p.title or "",
            "source": p.source or "",
            "last_updated": p.updated_at,
            "days_stale": days_stale,
        })

    return {
        "total_products": total,
        "stale_products": stale_count,
        "stale_rate": round((stale_count / total * 100) if total > 0 else 0.0, 2),
        "re_scrape_count": stale_count,
        "by_platform": by_platform,
        "sample_stale": sample_stale,
    }


async def compute_image_health(db: AsyncSession) -> dict:
    total_result = await db.execute(select(func.count(Product.id)))
    total = total_result.scalar_one() or 0

    products_with_image_result = await db.execute(
        select(func.count(Product.id)).where(
            Product.image_url.isnot(None),
            Product.image_url != "",
        )
    )
    products_with_image = products_with_image_result.scalar_one() or 0

    products_missing_image_result = await db.execute(
        select(func.count(Product.id)).where(
            or_(Product.image_url.is_(None), Product.image_url == "")
        )
    )
    products_missing_image = products_missing_image_result.scalar_one() or 0

    broken_image_sample_result = await db.execute(
        select(Product)
        .where(
            or_(Product.image_url.is_(None), Product.image_url == "")
        )
        .order_by(Product.updated_at.desc())
        .limit(10)
    )
    broken_sample = []
    for p in broken_image_sample_result.scalars().all():
        broken_sample.append({
            "product_id": p.id,
            "title": p.title or "",
            "source": p.source or "",
            "image_url": p.image_url or "",
            "updated_at": p.updated_at,
        })

    image_health_by_platform_result = await db.execute(
        select(
            Product.source,
            func.count(Product.id).label("total"),
            func.sum(
                func.cast(
                    and_(
                        Product.image_url.isnot(None),
                        Product.image_url != "",
                    ).cast(Integer),
                    Integer,
                )
            ).label("with_image"),
        ).group_by(Product.source)
    )
    by_platform = []
    for row in image_health_by_platform_result.all():
        total_p = row.total or 0
        with_image_p = row.with_image or 0
        rate = (with_image_p / total_p * 100) if total_p > 0 else 0.0
        by_platform.append({
            "source": row.source,
            "total": total_p,
            "with_image": with_image_p,
            "missing_image": total_p - with_image_p,
            "image_coverage_rate": round(rate, 2),
        })

    return {
        "total_products": total,
        "products_with_image": products_with_image,
        "products_missing_image": products_missing_image,
        "image_coverage_rate": round((products_with_image / total * 100) if total > 0 else 0.0, 2),
        "by_platform": by_platform,
        "sample_missing_image": broken_sample,
    }


async def get_catalog_health(db: AsyncSession) -> dict:
    compliance = await compute_schema_compliance(db)
    deduplication = await compute_deduplication(db)
    freshness = await compute_freshness(db)
    image_health = await compute_image_health(db)
    freshness_monitor = await build_catalog_freshness_monitor_report()

    platform_totals_result = await db.execute(
        select(Product.source, func.count(Product.id))
        .group_by(Product.source)
    )
    by_platform = {row[0]: row[1] for row in platform_totals_result.all()}

    total_result = await db.execute(select(func.count(Product.id)))
    total = total_result.scalar_one() or 0

    return {
        "generated_at": datetime.now(timezone.utc),
        "total_indexed": total,
        "by_platform": by_platform,
        "compliance": compliance,
        "deduplication": deduplication,
        "freshness": freshness,
        "image_health": image_health,
        "freshness_monitor": freshness_monitor,
    }
