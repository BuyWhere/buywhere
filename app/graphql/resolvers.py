import json
from pathlib import Path
from decimal import Decimal
from typing import Optional

from ariadne import QueryType, make_executable_schema
from sqlalchemy import func, select, text, Numeric
from sqlalchemy.orm import Session

from app.affiliate_links import get_affiliate_url
from app.models.product import Product, Click, PriceHistory
from app.graphql.types import type_defs

TAXONOMY_PATH = Path("taxonomy.json")
_cached_taxonomy = None

query = QueryType()


def _load_taxonomy():
    global _cached_taxonomy
    if _cached_taxonomy is None:
        if TAXONOMY_PATH.exists():
            with open(TAXONOMY_PATH) as f:
                _cached_taxonomy = json.load(f)
        else:
            _cached_taxonomy = {"top_categories": [], "mapping": {}}
    return _cached_taxonomy


def _compute_price_trend_sync(db: Session, product_id: int) -> Optional[str]:
    from datetime import datetime, timedelta, timezone
    thirty_days_ago = datetime.now(timezone.utc) - timedelta(days=30)
    result = db.execute(
        select(PriceHistory.price, PriceHistory.recorded_at)
        .where(PriceHistory.product_id == product_id)
        .where(PriceHistory.recorded_at >= thirty_days_ago)
        .order_by(PriceHistory.recorded_at.asc())
    )
    rows = result.scalars().all()
    if len(rows) < 2:
        return None
    first_price = float(rows[0].price)
    last_price = float(rows[-1].price)
    if last_price > first_price * 1.01:
        return "up"
    elif last_price < first_price * 0.99:
        return "down"
    return "stable"


def _product_to_dict(p: Product, price_trend: Optional[str] = None) -> dict:
    return {
        "id": p.id,
        "sku": p.sku,
        "source": p.source,
        "merchantId": p.merchant_id,
        "name": p.title,
        "description": p.description,
        "price": str(p.price),
        "currency": p.currency,
        "buyUrl": p.url,
        "affiliateUrl": get_affiliate_url(p.source, p.url) if p.url else None,
        "imageUrl": p.image_url,
        "brand": p.brand,
        "category": p.category,
        "categoryPath": p.category_path,
        "rating": str(p.rating) if p.rating else None,
        "isAvailable": p.is_available,
        "lastChecked": p.last_checked.isoformat() if p.last_checked else None,
        "metadata": json.dumps(p.metadata_) if p.metadata_ else None,
        "updatedAt": p.updated_at.isoformat() if p.updated_at else None,
        "priceTrend": price_trend,
    }


def _compute_deal_score(
    discount_pct: Optional[float],
    original_price: Optional[Decimal],
    current_price: Decimal,
    click_count: int,
) -> float:
    if discount_pct is None or original_price is None or original_price <= 0:
        return 0.0
    abs_savings = float(original_price - current_price)
    disc_norm = min(discount_pct / 100.0, 1.0)
    savings_norm = min(abs_savings / 100.0, 1.0)
    click_norm = min(click_count / 500.0, 1.0)
    return round(disc_norm * 0.4 + savings_norm * 0.3 + click_norm * 0.3, 3)


@query.field("products")
def resolve_products(_, info, query=None, category=None, min_price=None, max_price=None, source=None, limit=20, offset=0):
    db: Session = info.context["db"]

    base_query = db.query(Product).filter(Product.is_active)

    if query:
        base_query = base_query.filter(
            text("title_search_vector @@ plainto_tsquery('english', :q)").bindparams(q=query)
        ).order_by(
            text("ts_rank(title_search_vector, plainto_tsquery('english', :q_rank)) DESC").bindparams(q_rank=query)
        )
    else:
        base_query = base_query.order_by(Product.updated_at.desc())

    if category:
        base_query = base_query.filter(Product.category.ilike(f"%{category}%"))
    if min_price is not None:
        base_query = base_query.filter(Product.price >= Decimal(str(min_price)))
    if max_price is not None:
        base_query = base_query.filter(Product.price <= Decimal(str(max_price)))
    if source:
        base_query = base_query.filter(Product.source == source)

    total = base_query.count()

    products = base_query.limit(limit).offset(offset).all()

    items = [_product_to_dict(p) for p in products]

    return {
        "total": total,
        "limit": limit,
        "offset": offset,
        "items": items,
        "hasMore": offset + len(items) < total,
    }


@query.field("product")
def resolve_product(_, info, id):
    db: Session = info.context["db"]
    p = db.query(Product).filter(Product.id == id, Product.is_active).first()
    if not p:
        return None
    price_trend = _compute_price_trend_sync(db, id)
    return _product_to_dict(p, price_trend)


@query.field("categories")
def resolve_categories(_, info):
    db: Session = info.context["db"]
    result = db.query(
        Product.category, func.count(Product.id).label("count")
    ).filter(
        Product.is_active, Product.category.isnot(None)
    ).group_by(
        Product.category
    ).order_by(
        func.count(Product.id).desc()
    ).all()
    return [{"name": row.category, "count": row.count, "children": []} for row in result]


@query.field("taxonomy")
def resolve_taxonomy(_, info):
    db: Session = info.context["db"]
    taxonomy_data = _load_taxonomy()
    cats = taxonomy_data.get("top_categories", [])

    result = db.query(
        Product.category, func.count(Product.id).label("count")
    ).filter(
        Product.is_active, Product.category.isnot(None)
    ).group_by(Product.category).all()
    db_counts = {row.category: row.count for row in result}

    mapping = taxonomy_data.get("mapping", {})
    category_totals = {}
    for source_cat, cat_count in db_counts.items():
        mapped = mapping.get(source_cat, {})
        top = mapped.get("top_category", "Other")
        if top not in category_totals:
            category_totals[top] = 0
        category_totals[top] += cat_count

    version = taxonomy_data.get("version", "1.0")

    categories = [
        {
            "id": cat["id"],
            "name": cat["name"],
            "productCount": category_totals.get(cat["name"], 0),
            "subcategories": [
                {"id": sub["id"], "name": sub["name"], "productCount": 0}
                for sub in cat.get("subcategories", [])
            ],
        }
        for cat in cats
    ]

    return {
        "categories": categories,
        "total": len(cats),
        "version": version,
    }


@query.field("deals")
def resolve_deals(_, info, category=None, minDiscountPct=10.0, limit=20, offset=0):
    db: Session = info.context["db"]
    threshold = 1.0 - (minDiscountPct / 100.0)

    base_query = (
        db.query(Product)
        .filter(Product.is_active)
        .filter(text("metadata->>'original_price' IS NOT NULL"))
        .filter(text("CAST(metadata->>'original_price' AS NUMERIC) > 0"))
        .filter(
            text(
                "price < :threshold * CAST(metadata->>'original_price' AS NUMERIC)"
            ).bindparams(threshold=threshold)
        )
    )

    if category:
        base_query = base_query.filter(Product.category.ilike(f"%{category}%"))

    base_query = base_query.order_by(
        text(
            "(CAST(metadata->>'original_price' AS NUMERIC) - price) "
            "/ NULLIF(CAST(metadata->>'original_price' AS NUMERIC), 0) DESC"
        )
    )

    total = base_query.count()

    products = base_query.limit(limit).offset(offset).all()

    product_ids = [p.id for p in products]
    click_counts = {}
    if product_ids:
        click_result = db.query(
            Click.product_id, func.count(Click.id)
        ).filter(
            Click.product_id.in_(product_ids)
        ).group_by(Click.product_id).all()
        click_counts = {row[0]: row[1] for row in click_result}

    items = []
    for p in products:
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

        click_count = click_counts.get(p.id, 0)
        deal_score = _compute_deal_score(discount_pct, original_price, p.price, click_count)

        items.append({
            "id": p.id,
            "name": p.title,
            "price": str(p.price),
            "originalPrice": str(original_price) if original_price else None,
            "discountPct": discount_pct,
            "dealScore": deal_score,
            "currency": p.currency,
            "source": p.source,
            "category": p.category,
            "buyUrl": p.url,
            "affiliateUrl": get_affiliate_url(p.source, p.url) if p.url else None,
            "imageUrl": p.image_url,
            "metadata": json.dumps(p.metadata_) if p.metadata_ else None,
            "clickCount": click_count,
        })

    return {
        "total": total,
        "limit": limit,
        "offset": offset,
        "items": items,
    }


@query.field("priceDrops")
def resolve_price_drops(_, info, category=None, days=7, min_drop_pct=5.0, limit=20, offset=0):
    db: Session = info.context["db"]
    from datetime import datetime, timedelta, timezone

    cutoff = datetime.now(timezone.utc) - timedelta(days=days)

    price_drop_subq = (
        db.query(
            PriceHistory.product_id,
            func.max(PriceHistory.recorded_at).label("latest_recorded"),
        )
        .filter(PriceHistory.recorded_at >= cutoff)
        .group_by(PriceHistory.product_id)
        .subquery()
    )

    earlier_cutoff = datetime.now(timezone.utc) - timedelta(days=days * 2)
    earlier_prices = (
        db.query(
            PriceHistory.product_id,
            PriceHistory.price.label("earlier_price"),
            PriceHistory.recorded_at.label("earlier_recorded"),
        )
        .filter(PriceHistory.recorded_at <= earlier_cutoff)
        .filter(PriceHistory.product_id.in_(select(price_drop_subq.c.product_id)))
        .subquery()
    )

    base_query = (
        db.query(
            Product,
            func.coalesce(earlier_prices.c.earlier_price, Product.price).label("previous_price"),
            func.coalesce(
                earlier_prices.c.earlier_price - Product.price,
                func.cast(func.text('0'), Numeric)
            ).label("price_drop"),
            (
                func.coalesce(
                    earlier_prices.c.earlier_price - Product.price,
                    func.cast(func.text('0'), Numeric)
                )
                / func.nullif(func.coalesce(earlier_prices.c.earlier_price, Product.price), 0)
                * 100
            ).label("price_drop_pct"),
            func.extract('day', func.now() - func.coalesce(earlier_prices.c.earlier_recorded, Product.updated_at)).label("price_drop_days"),
        )
        .select_from(Product)
        .outerjoin(earlier_prices, Product.id == earlier_prices.c.product_id)
        .filter(Product.is_active)
        .filter(earlier_prices.c.earlier_price is not None)
        .filter(text("COALESCE(earlier_prices.earlier_price, 0) > 0"))
        .filter(text("Product.price < COALESCE(earlier_prices.earlier_price, Product.price)"))
        .filter(
            text(
                "(COALESCE(earlier_prices.earlier_price, Product.price) - Product.price) "
                "/ NULLIF(COALESCE(earlier_prices.earlier_price, Product.price), 0) * 100 >= :min_drop_pct"
            ).bindparams(min_drop_pct=min_drop_pct)
        )
    )

    if category:
        base_query = base_query.filter(Product.category.ilike(f"%{category}%"))

    base_query = base_query.order_by(
        text(
            "(COALESCE(earlier_prices.earlier_price, Product.price) - Product.price) "
            "/ NULLIF(COALESCE(earlier_prices.earlier_price, Product.price), 0) * 100 DESC"
        )
    )

    total = base_query.count()

    result = base_query.limit(limit).offset(offset).all()

    product_ids = [row[0].id for row in result]
    click_counts = {}
    if product_ids:
        click_result = db.query(
            Click.product_id, func.count(Click.id)
        ).filter(
            Click.product_id.in_(product_ids)
        ).group_by(Click.product_id).all()
        click_counts = {row[0]: row[1] for row in click_result}

    items = []
    for row in result:
        product = row[0]
        previous_price = row[1]
        price_drop = row[2]
        price_drop_pct_val = float(row[3]) if row[3] is not None else 0.0
        price_drop_days = int(row[4]) if row[4] is not None else 0
        click_count = click_counts.get(product.id, 0)

        deal_score = _compute_deal_score(
            price_drop_pct_val,
            previous_price,
            product.price,
            click_count,
        )

        items.append({
            "id": product.id,
            "name": product.title,
            "price": str(product.price),
            "previousPrice": str(previous_price),
            "priceDrop": str(price_drop),
            "priceDropPct": round(price_drop_pct_val, 1),
            "dealScore": deal_score,
            "currency": product.currency,
            "source": product.source,
            "category": product.category,
            "buyUrl": product.url,
            "affiliateUrl": get_affiliate_url(product.source, product.url) if product.url else None,
            "imageUrl": product.image_url,
            "metadata": json.dumps(product.metadata_) if product.metadata_ else None,
            "clickCount": click_count,
            "priceDropDays": price_drop_days,
        })

    return {
        "total": total,
        "limit": limit,
        "offset": offset,
        "items": items,
    }


schema = make_executable_schema(type_defs, query)
