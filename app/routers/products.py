import csv
import io
import json
import logging
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import List, Optional, Dict

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import StreamingResponse, RedirectResponse, JSONResponse
from sqlalchemy import case, func, select, text
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.affiliate_links import get_affiliate_url, get_underlying_affiliate_url, is_valid_url
from app.auth import get_current_api_key
from app.database import get_db
from app.models.product import ApiKey, Click, Product, PriceHistory, ProductView, ProductMatch, ProductReview, ProductQuestion, ProductAnswer
from app.rate_limit import limiter, rate_limit_from_request

AVAILABILITY_CACHE_TTL = 3600
STALE_THRESHOLD_DAYS = 7

_availability_http_client: Optional[httpx.AsyncClient] = None

JSON_LD_CONTEXT = "https://schema.org"
JSON_LD_TYPE_PRODUCT = "Product"
JSON_LD_TYPE_OFFER = "Offer"


def _build_json_ld(p: Product, target_currency: Optional[str] = None) -> str:
    price_currency = target_currency or p.currency or "SGD"
    price_value = str(p.price)
    if target_currency and target_currency != p.currency:
        try:
            from app.services.currency import convert_price as _convert
            converted = _convert(p.price, p.currency, target_currency)
            price_value = str(converted)
            price_currency = target_currency
        except Exception:
            price_value = str(p.price)
            price_currency = p.currency or "SGD"

    availability = "https://schema.org/InStock" if (p.is_available or p.in_stock) else "https://schema.org/OutOfStock"

    offer = {
        "@type": "Offer",
        "priceCurrency": price_currency,
        "price": price_value,
        "availability": availability,
        "seller": {"@type": "Organization", "name": p.source or "Unknown"},
    }
    if p.url:
        offer["url"] = p.url

    product = {
        "@context": JSON_LD_CONTEXT,
        "@type": JSON_LD_TYPE_PRODUCT,
        "name": p.title,
        "description": p.description or "",
        "sku": p.sku,
        "brand": {"@type": "Brand", "name": p.brand} if p.brand else None,
        "image": p.image_url,
        "category": p.category,
        "offers": offer,
    }
    if p.barcode:
        product["productID"] = p.barcode
    if p.rating is not None:
        product["aggregateRating"] = {
            "@type": "AggregateRating",
            "ratingValue": str(float(p.rating)),
            "reviewCount": str(p.review_count) if p.review_count else None,
        }
    filtered = {k: v for k, v in product.items() if v is not None}
    return json.dumps(filtered, ensure_ascii=False)


async def get_availability_http_client() -> httpx.AsyncClient:
    global _availability_http_client
    if _availability_http_client is None:
        _availability_http_client = httpx.AsyncClient(
            timeout=10.0,
            headers={
                "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            },
            follow_redirects=True,
        )
    return _availability_http_client


async def close_availability_http_client() -> None:
    global _availability_http_client
    if _availability_http_client is not None:
        await _availability_http_client.aclose()
        _availability_http_client = None


async def _check_url_availability(url: str) -> bool:
    try:
        client = await get_availability_http_client()
        response = await client.head(url, allow_redirects=True)
        if response.status_code == 200:
            return True
        if response.status_code == 405:
            response = await client.get(url, allow_redirects=True)
            return response.status_code == 200
        return False
    except Exception:
        return False


def _is_stale(last_checked: Optional[datetime]) -> bool:
    if last_checked is None:
        return True
    threshold = datetime.now(timezone.utc) - timedelta(days=STALE_THRESHOLD_DAYS)
    return last_checked.replace(tzinfo=timezone.utc) < threshold
from app.schemas.product import (
    ProductListResponse, ProductResponse,
    CompareMatrixRequest, CompareMatrixResponse, CompareMatrixEntry,
    TrendingResponse, TrendingMatch,
    CompareDiffRequest, CompareDiffResponse, CompareDiffEntry, FieldDiff,
    PriceHistoryResponse, PriceHistoryEntry, PriceStats, PricePredictionResponse,
    RecommendationMatch, RecommendationsResponse,
    BundleResponse, BundleMatch,
    CompareSearchResponse, CompareSearchMatch,
    StockStatus, PlatformAvailability, ProductAvailabilityResponse,
    BulkAvailabilityRequest, BulkAvailabilityResponse,
    PriceComparisonResponse, PriceComparisonItem,
    PlatformDistribution, CategoryBreakdown,
    BulkLookupRequest, BulkLookupResponse, BulkLookupMatch, BulkLookupResultItem,
    BatchProductRequest, BatchProductResponse,
    BulkIdsRequest, BulkIdsResponse,
    ProductStockResponse, ProductURLAvailabilityResponse,
    FacetCounts, FacetBucket, RatingFacetBucket, PriceFacetBucket,
    ProductMatchesResponse, ProductReviewsResponse, ReviewSource, SampleReview,
    SimilarProductsResponse,
    RatingDistributionBucket,
    BulkImportRequest, BulkImportResponse, BulkImportError,
    CatalogStats,
    QuestionCreateRequest, AnswerCreateRequest,
    QuestionResponse, AnswerResponse, QuestionDetailResponse, QuestionListResponse,
    V1ProductSearchResponse, V1ProductSearchItem, V1ProductSearchMeta,
)
from app.schemas.product import CompareResponse
from app.schemas.product import CompareMatch
from app.schemas.product import CompareHighlights
from app import cache
from app.currency import convert_price, build_currency_headers, SUPPORTED_CURRENCIES, get_exchange_rate
from app.routers.deals import DealItem, DealsResponse as DealsResponseBase

logger = logging.getLogger("buywhere_api")

router = APIRouter(prefix="/products", tags=["products"])


@router.get("/", response_model=ProductListResponse, summary="List all products")
@limiter.limit(rate_limit_from_request)
async def list_products(
    request: Request,
    limit: int = Query(20, ge=1, le=100, description="Results per page (1-100)"),
    offset: int = Query(0, ge=0, le=10000, description="Pagination offset (0-10000)"),
    sort_by: Optional[str] = Query(None, description="Sort order: relevance, price_asc, price_desc, newest"),
    currency: Optional[str] = Query(None, description=f"Target currency for price conversion. Supported: {', '.join(SUPPORTED_CURRENCIES)}"),
    db: AsyncSession = Depends(get_db),
    api_key: ApiKey = Depends(get_current_api_key),
) -> ProductListResponse:
    request.state.api_key = api_key

    cache_key = cache.build_cache_key(
        "v1:products:list",
        limit=limit,
        offset=offset,
        sort_by=sort_by,
    )

    cached = await cache.cache_get(cache_key)
    if cached:
        return ProductListResponse.model_construct(**cached)

    base_query = select(Product).where(Product.is_active)

    if sort_by == "price_asc":
        base_query = base_query.order_by(Product.price.asc())
    elif sort_by == "price_desc":
        base_query = base_query.order_by(Product.price.desc())
    elif sort_by == "newest":
        base_query = base_query.order_by(Product.created_at.desc())
    else:
        base_query = base_query.order_by(Product.updated_at.desc())

    if offset == 0:
        count_query = select(func.count()).select_from(base_query.subquery())
        total_result = await db.execute(count_query)
        total = total_result.scalar_one()
    else:
        total = None

    results = await db.execute(base_query.limit(limit).offset(offset))
    products = results.scalars().all()

    items = [_map_product(p, target_currency=currency, confidence_score=None) for p in products]
    effective_total = total if total is not None else offset + len(items)
    has_more = len(items) == limit if total is None else (offset + limit) < total

    response = ProductListResponse(
        total=effective_total,
        limit=limit,
        offset=offset,
        items=items,
        has_more=has_more,
    )

    await cache.cache_set(cache_key, response.model_dump(mode="json"), ttl_seconds=600)

    return response


def _compute_price_trend(db: AsyncSession, product_id: int) -> Optional[str]:
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


def _map_product(p: Product, price_trend: Optional[str] = None, target_currency: Optional[str] = None, confidence_score: Optional[float] = None) -> ProductResponse:
    converted_price = None
    converted_currency = None
    if target_currency and target_currency != p.currency:
        converted_price = convert_price(p.price, p.currency, target_currency)
        converted_currency = target_currency

    return ProductResponse(
        id=p.id,
        sku=p.sku,
        source=p.source,
        merchant_id=p.merchant_id,
        name=p.title,
        description=p.description,
        price=p.price,
        currency=p.currency,
        price_sgd=p.price_sgd,
        converted_price=converted_price,
        converted_currency=converted_currency,
        buy_url=p.url,
        affiliate_url=get_affiliate_url(p.source, p.url) if p.url else None,
        image_url=p.image_url,
        barcode=p.barcode,
        brand=p.brand,
        category=p.category,
        category_path=p.category_path,
        rating=p.rating,
        review_count=p.review_count,
        avg_rating=p.avg_rating,
        rating_source=p.rating_source,
        is_available=p.is_available,
        in_stock=p.in_stock,
        stock_level=p.stock_level,
        last_checked=p.last_checked,
        data_updated_at=p.data_updated_at,
        metadata=p.metadata_,
        updated_at=p.updated_at,
        price_trend=price_trend,
        confidence_score=confidence_score,
        json_ld=_build_json_ld(p, target_currency),
    )


def _build_compare_match(p: Product, score: float) -> CompareMatch:
    return CompareMatch(
        id=p.id,
        sku=p.sku,
        source=p.source,
        merchant_id=p.merchant_id,
        name=p.title,
        description=p.description,
        price=p.price,
        currency=p.currency,
        buy_url=p.url,
        affiliate_url=get_affiliate_url(p.source, p.url) if p.url else None,
        image_url=p.image_url,
        brand=p.brand,
        category=p.category,
        category_path=p.category_path,
        rating=p.rating,
        is_available=p.is_available,
        in_stock=p.in_stock,
        stock_level=p.stock_level,
        last_checked=p.last_checked,
        metadata=p.metadata_,
        updated_at=p.updated_at,
        match_score=round(score, 3),
    )


def _similar_price_expression(source_product: Product):
    if source_product.price_sgd is not None or source_product.currency == "SGD":
        return func.coalesce(
            Product.price_sgd,
            case((Product.currency == "SGD", Product.price), else_=None),
            Product.price,
        )

    if source_product.price_usd is not None or source_product.currency == "USD":
        return func.coalesce(
            Product.price_usd,
            case((Product.currency == "USD", Product.price), else_=None),
            Product.price,
        )

    return Product.price


def _source_similar_price(source_product: Product) -> Decimal:
    if source_product.price_sgd is not None:
        return Decimal(str(source_product.price_sgd))
    if source_product.currency == "SGD":
        return Decimal(str(source_product.price))
    if source_product.price_usd is not None:
        return Decimal(str(source_product.price_usd))
    return Decimal(str(source_product.price))


def _get_highlights(matches: List[CompareMatch]) -> Optional[CompareHighlights]:
    if not matches:
        return None
    cheapest = min(matches, key=lambda m: m.price) if matches else None
    best_rated = max(
        (m for m in matches if m.rating is not None),
        key=lambda m: m.rating,
        default=None,
    )
    fastest_shipping = None
    for m in matches:
        if m.metadata and isinstance(m.metadata, dict):
            shipping = m.metadata.get("shipping_days") or m.metadata.get("shipping")
            if shipping is not None:
                if fastest_shipping is None:
                    fastest_shipping = m
                else:
                    prev_shipping = fastest_shipping.metadata.get("shipping_days") or fastest_shipping.metadata.get("shipping") if fastest_shipping.metadata else None
                    if shipping < prev_shipping:
                        fastest_shipping = m
    return CompareHighlights(
        cheapest=cheapest,
        best_rated=best_rated,
        fastest_shipping=fastest_shipping,
    )


@router.get("/search", response_model=ProductListResponse, summary="Search products (v1 API)")
@limiter.limit(rate_limit_from_request)
async def v1_product_search(
    request: Request,
    q: Optional[str] = Query(None, max_length=500, description="Full-text search query (max 500 chars)"),
    category: Optional[str] = Query(None, max_length=200, description="Filter by category"),
    price_min: Optional[Decimal] = Query(None, ge=0, description="Minimum price filter"),
    price_max: Optional[Decimal] = Query(None, ge=0, description="Maximum price filter"),
    platform: Optional[str] = Query(None, max_length=100, description="Filter by platform/source"),
    sort_by: Optional[str] = Query(None, description="Sort order: relevance, price_asc, price_desc, newest"),
    limit: int = Query(20, ge=1, le=100, description="Results per page (1-100)"),
    offset: int = Query(0, ge=0, le=10000, description="Pagination offset (0-10000)"),
    include_facets: bool = Query(False, description="Include facet counts in response"),
    currency: Optional[str] = Query(None, description=f"Target currency for price conversion. Supported: {', '.join(SUPPORTED_CURRENCIES)}"),
    db: AsyncSession = Depends(get_db),
    api_key: ApiKey = Depends(get_current_api_key),
) -> ProductListResponse:
    request.state.api_key = api_key

    if q and len(q) > 500:
        raise HTTPException(
            status_code=422,
            detail={
                "code": "QUERY_TOO_LONG",
                "field": "q",
                "message": f"Query exceeds maximum length of 500 characters (got {len(q)})",
                "max_length": 500,
                "actual_length": len(q),
                "suggested_query": q[:500],  # Suggest truncated query
                "retry_after": None,
            }
        )

    if price_min is not None and price_max is not None and price_min > price_max:
        raise HTTPException(
            status_code=422,
            detail={
                "code": "INVALID_PRICE_RANGE",
                "field": "price_min,price_max",
                "message": "price_min cannot be greater than price_max",
                "price_min": str(price_min),
                "price_max": str(price_max),
                "suggested_query": f"price_min={price_max}&price_max={price_max}",
                "retry_after": None,
            }
        )

    cache_key = cache.build_cache_key(
        "v1:products:search",
        q=q,
        category=category,
        price_min=str(price_min) if price_min is not None else None,
        price_max=str(price_max) if price_max is not None else None,
        platform=platform,
        sort_by=sort_by,
        limit=limit,
        offset=offset,
    )

    cached = await cache.cache_get(cache_key)
    if cached:
        return ProductListResponse.model_construct(**cached)

    base_query = select(Product).where(Product.is_active)
    highlight_query = None

    if q:
        base_query = base_query.where(
            text("search_vector @@ plainto_tsquery('english', :q)").bindparams(q=q)
        ).order_by(
            text("ts_rank(search_vector, plainto_tsquery('english', :q_rank), 32) DESC").bindparams(q_rank=q),
            Product.updated_at.desc()
        )
        highlight_query = text(
            "ts_headline('english', coalesce(title, '') || ' ' || coalesce(description, ''), "
            "plainto_tsquery('english', :q_hl), 'MaxWords=50, MinWords=20, MaxFragments=2')"
        ).bindparams(q_hl=q)
    else:
        base_query = base_query.order_by(Product.updated_at.desc())

    if category:
        base_query = base_query.where(Product.category.ilike(f"%{category}%"))
    if price_min is not None:
        base_query = base_query.where(Product.price >= price_min)
    if price_max is not None:
        base_query = base_query.where(Product.price <= price_max)
    if platform:
        base_query = base_query.where(Product.source == platform)

    if offset == 0:
        count_query = select(func.count()).select_from(base_query.subquery())
        total_result = await db.execute(count_query)
        total = total_result.scalar_one()
    else:
        total = None

    results = await db.execute(base_query.limit(limit).offset(offset))
    products = results.scalars().all()

    highlights = {}
    if q and highlight_query is not None and products:
        product_ids = [p.id for p in products]
        hl_query = select(
            Product.id,
            text(
                "ts_headline('english', coalesce(title, '') || ' ' || coalesce(description, ''), "
                "plainto_tsquery('english', :q_hl), 'MaxWords=50, MinWords=20, MaxFragments=2') as headline"
            )
        ).where(Product.id.in_(product_ids)).params(q_hl=q)
        hl_results = await db.execute(hl_query)
        for row in hl_results.fetchall():
            if row[1]:
                highlights[str(row[0])] = row[1]

    facets = None
    if include_facets:
        facet_base_query = select(Product).where(Product.is_active)
        if q:
            facet_base_query = facet_base_query.where(
                text("search_vector @@ plainto_tsquery('english', :fq)").bindparams(fq=q)
            )

        category_facet = select(Product.category, func.count(Product.id)).select_from(
            facet_base_query.subquery()
        ).group_by(Product.category).order_by(func.count(Product.id).desc()).limit(10)
        cat_result = await db.execute(category_facet)
        category_buckets = [FacetBucket(value=str(row[0]) or "Unknown", count=row[1]) for row in cat_result.fetchall()]

        platform_facet = select(Product.source, func.count(Product.id)).select_from(
            facet_base_query.subquery()
        ).group_by(Product.source).order_by(func.count(Product.id).desc()).limit(10)
        plat_result = await db.execute(platform_facet)
        platform_buckets = [FacetBucket(value=row[0], count=row[1]) for row in plat_result.fetchall()]

        brand_facet = select(Product.brand, func.count(Product.id)).select_from(
            facet_base_query.subquery()
        ).group_by(Product.brand).order_by(func.count(Product.id).desc()).limit(10)
        brand_result = await db.execute(brand_facet)
        brand_buckets = [FacetBucket(value=str(row[0]) or "Unknown", count=row[1]) for row in brand_result.fetchall()]

        rating_facet = select(
            func.floor(Product.rating / 1) * 1,
            func.count(Product.id)
        ).select_from(facet_base_query.subquery()).where(
            Product.rating.isnot(None)
        ).group_by(func.floor(Product.rating / 1) * 1).order_by(func.floor(Product.rating / 1).desc())
        rating_result = await db.execute(rating_facet)
        rating_ranges = []
        for row in rating_result.fetchall():
            rating_ranges.append(RatingFacetBucket(
                min_rating=float(row[0]),
                max_rating=float(row[0]) + 1,
                count=row[1]
            ))

        price_ranges = []
        price_bins = [(0, 10), (10, 50), (50, 100), (100, 200), (200, 500), (500, None)]
        price_bin_cases = " ".join([
            f"WHEN price >= {mn} {'AND price < ' + str(mx) if mx else ''} THEN '{mn}-{mx if mx else 'inf'}'"
            for mn, mx in price_bins
        ])
        price_combined_query = select(
            text(f"CASE {price_bin_cases} ELSE 'other' END").label("bin"),
            func.count(Product.id).label("count")
        ).select_from(facet_base_query.subquery()).group_by(text("bin"))
        price_result = await db.execute(price_combined_query)
        bin_counts = {row.bin: row.count for row in price_result.fetchall()}
        for mn, mx in price_bins:
            bin_key = f"{mn}-{mx if mx else 'inf'}"
            price_ranges.append(PriceFacetBucket(
                min_price=Decimal(str(mn)),
                max_price=Decimal(str(mx)) if mx else None,
                count=bin_counts.get(bin_key, 0)
            ))

        facets = FacetCounts(
            categories=category_buckets,
            platforms=platform_buckets,
            brands=brand_buckets,
            rating_ranges=rating_ranges,
            price_ranges=price_ranges,
        )

    items = [_map_product(p, target_currency=currency, confidence_score=None) for p in products]
    effective_total = total if total is not None else offset + len(items)
    has_more = len(items) == limit if total is None else (offset + limit) < total

    response = ProductListResponse(
        total=effective_total,
        limit=limit,
        offset=offset,
        items=items,
        has_more=has_more,
        facets=facets,
        highlights=highlights if highlights else None,
    )

    if currency:
        converted_items = [i for i in items if i.converted_price is not None]
        if converted_items:
            source_currency = converted_items[0].currency
            target_currency = converted_items[0].converted_currency
            if source_currency and target_currency:
                response.headers["X-Currency-Rate"] = f"1 {source_currency} = {get_exchange_rate(source_currency, target_currency)} {target_currency}"
                response.headers["X-Currency-Source"] = source_currency
                response.headers["X-Currency-Target"] = target_currency

    await cache.cache_set(cache_key, response.model_dump(mode="json"), ttl_seconds=600)

    return response


@router.get("/best-price", response_model=ProductResponse, summary="Find cheapest product across all platforms")
@limiter.limit(rate_limit_from_request)
async def best_price(
    request: Request,
    q: str = Query(..., min_length=1, description="Product name to search for"),
    category: Optional[str] = Query(None, description="Optional category filter"),
    currency: Optional[str] = Query(None, description=f"Target currency for price conversion. Supported: {', '.join(SUPPORTED_CURRENCIES)}"),
    db: AsyncSession = Depends(get_db),
    api_key: ApiKey = Depends(get_current_api_key),
) -> ProductResponse:
    """Return the single cheapest listing for a product across all platforms."""
    request.state.api_key = api_key

    cache_key = cache.build_cache_key(
        "products:best_price",
        q=q,
        category=category,
        currency=currency,
    )
    cached = await cache.cache_get(cache_key)
    if cached:
        return ProductResponse(**cached)

    base_query = (
        select(Product)
        .where(Product.is_active == True)
        .where(
            text("title_search_vector @@ plainto_tsquery('english', :q)").bindparams(q=q)
        )
    )
    if category:
        base_query = base_query.where(Product.category.ilike(f"%{category}%"))

    base_query = base_query.order_by(Product.price.asc()).limit(1)
    result = await db.execute(base_query)
    product = result.scalar_one_or_none()

    if not product:
        # Fallback: ILIKE search for broader matching
        fallback = (
            select(Product)
            .where(Product.is_active == True)
            .where(Product.title.ilike(f"%{q}%"))
        )
        if category:
            fallback = fallback.where(Product.category.ilike(f"%{category}%"))
        fallback = fallback.order_by(Product.price.asc()).limit(1)
        result2 = await db.execute(fallback)
        product = result2.scalar_one_or_none()

    if not product:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"No products found for: {q!r}")

    response = _map_product(product, target_currency=currency, confidence_score=None)
    await cache.cache_set(cache_key, response.model_dump(mode="json"), ttl_seconds=300)
    return response


@router.get("/compare", response_model=CompareSearchResponse, summary="Search and compare the same product across all sources")
@limiter.limit(rate_limit_from_request)
async def compare_product_search(
    request: Request,
    q: str = Query(..., min_length=2, description="Product search query (e.g. iphone 15)"),
    limit: int = Query(10, ge=1, le=50, description="Max seed products from search to find matches for"),
    db: AsyncSession = Depends(get_db),
    api_key: ApiKey = Depends(get_current_api_key),
) -> CompareSearchResponse:
    request.state.api_key = api_key

    cache_key = cache.build_cache_key(
        "products:compare_search",
        q=q,
        limit=limit,
    )
    cached = await cache.cache_get(cache_key)
    if cached:
        return CompareSearchResponse(**cached)

    seed_query = (
        select(Product)
        .where(Product.is_active == True)
        .where(
            text("title_search_vector @@ plainto_tsquery('english', :q)").bindparams(q=q)
        )
        .order_by(
            text("ts_rank(title_search_vector, plainto_tsquery('english', :q_rank)) DESC").bindparams(q_rank=q)
        )
        .limit(limit)
    )
    seed_result = await db.execute(seed_query)
    seed_products = list(seed_result.scalars().all())

    if not seed_products:
        fallback_query = (
            select(Product)
            .where(Product.is_active == True)
            .where(Product.title.ilike(f"%{q}%"))
            .order_by(Product.updated_at.desc())
            .limit(limit)
        )
        fallback_result = await db.execute(fallback_query)
        seed_products = list(fallback_result.scalars().all())

    if not seed_products:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"No products found for query: {q!r}")

    from app.compare import ProductMatcher
    matcher = ProductMatcher(db)

    seen_ids: set[int] = set()
    all_matches: List[Tuple[Product, float]] = []

    for seed in seed_products:
        matches = await matcher.find_matches(seed)
        for matched_product, score in matches:
            if matched_product.id not in seen_ids:
                seen_ids.add(matched_product.id)
                all_matches.append((matched_product, score))

    all_matches.sort(key=lambda x: x[1], reverse=True)

    items = []
    cheapest_id: Optional[int] = None
    best_rated_id: Optional[int] = None
    fastest_shipping_id: Optional[int] = None
    cheapest_price: Optional[Decimal] = None
    best_rating: Optional[Decimal] = None
    fastest_shipping_days: Optional[int] = None

    for matched_product, score in all_matches:
        item = CompareSearchMatch(
            id=matched_product.id,
            sku=matched_product.sku,
            source=matched_product.source,
            merchant_id=matched_product.merchant_id,
            name=matched_product.title,
            description=matched_product.description,
            price=matched_product.price,
            currency=matched_product.currency,
            buy_url=matched_product.url,
            affiliate_url=get_affiliate_url(matched_product.source, matched_product.url) if matched_product.url else None,
            image_url=matched_product.image_url,
            brand=matched_product.brand,
            category=matched_product.category,
            category_path=matched_product.category_path,
            rating=matched_product.rating,
            is_available=matched_product.is_available,
            last_checked=matched_product.last_checked,
            metadata=matched_product.metadata_,
            updated_at=matched_product.updated_at,
            match_score=round(score, 3),
        )
        items.append(item)

        price_val = matched_product.price
        if cheapest_price is None or price_val < cheapest_price:
            cheapest_price = price_val
            cheapest_id = matched_product.id

        rating_val = matched_product.rating
        if rating_val is not None and (best_rating is None or rating_val > best_rating):
            best_rating = rating_val
            best_rated_id = matched_product.id

        if matched_product.metadata_ and isinstance(matched_product.metadata_, dict):
            shipping = matched_product.metadata_.get("shipping_days") or matched_product.metadata_.get("shipping")
            if shipping is not None:
                try:
                    shipping_int = int(shipping)
                    if fastest_shipping_days is None or shipping_int < fastest_shipping_days:
                        fastest_shipping_days = shipping_int
                        fastest_shipping_id = matched_product.id
                except (ValueError, TypeError):
                    pass

    response = CompareSearchResponse(
        query=q,
        items=items,
        total=len(items),
        cheapest_product_id=cheapest_id,
        best_rated_product_id=best_rated_id,
        fastest_shipping_product_id=fastest_shipping_id,
    )

    await cache.cache_set(cache_key, response.model_dump(mode="json"), ttl_seconds=300)

    return response


@router.post("/compare", response_model=CompareMatrixResponse, summary="Compare multiple products across platforms")
@limiter.limit(rate_limit_from_request)
async def compare_products_matrix(
    request: Request,
    body: CompareMatrixRequest,
    db: AsyncSession = Depends(get_db),
    api_key: ApiKey = Depends(get_current_api_key),
) -> CompareMatrixResponse:
    request.state.api_key = api_key

    cache_key = cache.build_cache_key(
        "products:compare_matrix",
        product_ids=sorted(body.product_ids),
        min_price=str(body.min_price) if body.min_price is not None else None,
        max_price=str(body.max_price) if body.max_price is not None else None,
    )
    cached = await cache.cache_get(cache_key)
    if cached:
        return CompareMatrixResponse(**cached)

    from app.compare import ProductMatcher
    matcher = ProductMatcher(db)

    comparisons = []
    for product_id in body.product_ids:
        source_result = await db.execute(
            select(Product).where(Product.id == product_id, Product.is_active == True)
        )
        source_product = source_result.scalar_one_or_none()
        if not source_product:
            continue

        min_p = float(body.min_price) if body.min_price is not None else None
        max_p = float(body.max_price) if body.max_price is not None else None
        matches = await matcher.find_matches(source_product, min_p, max_p)

        match_responses = []
        for matched_product, score in matches:
            match_responses.append(_build_compare_match(matched_product, score))

        match_responses.sort(key=lambda x: x.price)

        comparisons.append(CompareMatrixEntry(
            source_product_id=source_product.id,
            source_product_name=source_product.title,
            matches=match_responses,
            total_matches=len(match_responses),
        ))

    all_matches: List[CompareMatch] = []
    for entry in comparisons:
        all_matches.extend(entry.matches)

    highlights = _get_highlights(all_matches) if all_matches else None

    response = CompareMatrixResponse(
        comparisons=comparisons,
        total_products=len(comparisons),
        highlights=highlights,
    )

    await cache.cache_set(cache_key, response.model_dump(mode="json"), ttl_seconds=300)

    return response


@router.post("/compare/diff", response_model=CompareDiffResponse, summary="Compare 2-5 products directly — returns structured diff")
@limiter.limit(rate_limit_from_request)
async def compare_products_diff(
    request: Request,
    body: CompareDiffRequest,
    db: AsyncSession = Depends(get_db),
    api_key: ApiKey = Depends(get_current_api_key),
) -> CompareDiffResponse:
    request.state.api_key = api_key

    cache_key = cache.build_cache_key(
        "products:compare_diff",
        product_ids=sorted(body.product_ids),
        include_image=body.include_image_similarity,
    )
    cached = await cache.cache_get(cache_key)
    if cached:
        return CompareDiffResponse(**cached)

    if len(body.product_ids) < 2 or len(body.product_ids) > 5:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="product_ids must contain between 2 and 5 IDs",
        )

    result = await db.execute(
        select(Product).where(
            Product.id.in_(body.product_ids),
            Product.is_active == True,
        )
    )
    products = result.scalars().all()

    if len(products) != len(body.product_ids):
        found_ids = {p.id for p in products}
        missing = [id for id in body.product_ids if id not in found_ids]
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Products not found: {missing}",
        )

    sorted_products = sorted(products, key=lambda p: p.price)
    price_ranks = {p.id: i + 1 for i, p in enumerate(sorted_products)}

    entries = []
    for p in products:
        entries.append(CompareDiffEntry(
            id=p.id,
            sku=p.sku,
            source=p.source,
            merchant_id=p.merchant_id,
            name=p.title,
            description=p.description,
            price=p.price,
            currency=p.currency,
            buy_url=p.url,
            affiliate_url=get_affiliate_url(p.source, p.url) if p.url else None,
            image_url=p.image_url,
            brand=p.brand,
            category=p.category,
            category_path=p.category_path,
            rating=p.rating,
            is_available=p.is_available,
            last_checked=p.last_checked,
            metadata=p.metadata_,
            updated_at=p.updated_at,
            price_rank=price_ranks[p.id],
        ))

    compared_fields = [
        ("price", lambda p: p.price),
        ("currency", lambda p: p.currency),
        ("brand", lambda p: p.brand),
        ("category", lambda p: p.category),
        ("source", lambda p: p.source),
        ("availability", lambda p: p.is_available),
    ]

    field_diffs = []
    identical_fields = []

    for field_name, accessor in compared_fields:
        values = [accessor(p) for p in products]
        all_identical = len(set(str(v) for v in values)) <= 1
        if all_identical:
            identical_fields.append(field_name)
        else:
            field_diffs.append(FieldDiff(
                field=field_name,
                values=values,
                all_identical=False,
            ))

    cheapest = sorted_products[0]
    most_expensive = sorted_products[-1]
    spread = most_expensive.price - cheapest.price
    spread_pct = float(spread / cheapest.price * 100) if cheapest.price > 0 else 0.0

    response = CompareDiffResponse(
        products=entries,
        field_diffs=field_diffs,
        identical_fields=identical_fields,
        cheapest_product_id=cheapest.id,
        most_expensive_product_id=most_expensive.id,
        price_spread=spread,
        price_spread_pct=round(spread_pct, 2),
    )

    await cache.cache_set(cache_key, response.model_dump(mode="json"), ttl_seconds=300)

    return response


@router.get("/trending", response_model=TrendingResponse, summary="Get trending products ranked by query volume and clicks")
@limiter.limit(rate_limit_from_request)
async def get_trending_products(
    request: Request,
    period: str = Query("7d", pattern="^(24h|7d|30d)$", description="Trending period: 24h, 7d, or 30d"),
    category: Optional[str] = Query(None, max_length=200, description="Filter by category name"),
    limit: int = Query(50, ge=1, le=100, description="Number of products to return (1-100)"),
    db: AsyncSession = Depends(get_db),
    api_key: ApiKey = Depends(get_current_api_key),
) -> TrendingResponse:
    request.state.api_key = api_key

    cache_key = cache.build_cache_key(
        "products:trending",
        period=period,
        category=category,
        limit=limit,
    )
    cached = await cache.cache_get(cache_key)
    if cached:
        return TrendingResponse(**cached)

    from datetime import datetime, timedelta, timezone

    period_hours = {"24h": 24, "7d": 24 * 7, "30d": 24 * 30}[period]
    window_start = datetime.now(timezone.utc) - timedelta(hours=period_hours)

    view_counts = {}
    click_counts = {}

    view_result = await db.execute(
        select(ProductView.product_id, func.count(ProductView.id))
        .where(ProductView.viewed_at >= window_start)
        .group_by(ProductView.product_id)
    )
    for row in view_result.all():
        view_counts[row[0]] = row[1]

    click_result = await db.execute(
        select(Click.product_id, func.count(Click.id))
        .where(Click.clicked_at >= window_start)
        .group_by(Click.product_id)
    )
    for row in click_result.all():
        click_counts[row[0]] = row[1]

    all_product_ids = set(view_counts.keys()) | set(click_counts.keys())

    if not all_product_ids:
        view_result_all = await db.execute(
            select(ProductView.product_id, func.count(ProductView.id))
            .group_by(ProductView.product_id)
        )
        for row in view_result_all.all():
            view_counts[row[0]] = view_counts.get(row[0], 0) + row[1]
        click_result_all = await db.execute(
            select(Click.product_id, func.count(Click.id))
            .group_by(Click.product_id)
        )
        for row in click_result_all.all():
            click_counts[row[0]] = click_counts.get(row[0], 0) + row[1]
        all_product_ids = set(view_counts.keys()) | set(click_counts.keys())

    combined_scores = {}
    for pid in all_product_ids:
        combined_scores[pid] = view_counts.get(pid, 0) + click_counts.get(pid, 0)

    sorted_product_ids = sorted(combined_scores.keys(), key=lambda x: combined_scores[x], reverse=True)

    if category:
        base_query = (
            select(Product)
            .where(Product.id.in_(sorted_product_ids))
            .where(Product.is_active == True)
            .where(Product.category.ilike(f"%{category}%"))
        )
    else:
        base_query = (
            select(Product)
            .where(Product.id.in_(sorted_product_ids))
            .where(Product.is_active == True)
        )

    results = await db.execute(base_query)
    products = results.scalars().all()

    product_map = {p.id: p for p in products}

    sorted_products = []
    for pid in sorted_product_ids:
        if pid in product_map:
            sorted_products.append(product_map[pid])

    platform_counts = {}
    category_counts = {}
    items = []
    for p in sorted_products[:limit]:
        v_count = view_counts.get(p.id, 0)
        c_count = click_counts.get(p.id, 0)
        t_score = combined_scores.get(p.id, 0)
        items.append(TrendingMatch(
            id=p.id,
            sku=p.sku,
            source=p.source,
            merchant_id=p.merchant_id,
            name=p.title,
            description=p.description,
            price=p.price,
            currency=p.currency,
            buy_url=p.url,
            affiliate_url=get_affiliate_url(p.source, p.url) if p.url else None,
            image_url=p.image_url,
            brand=p.brand,
            category=p.category,
            category_path=p.category_path,
            rating=p.rating,
            is_available=p.is_available,
            last_checked=p.last_checked,
            metadata=p.metadata_,
            updated_at=p.updated_at,
            view_count=v_count,
            click_count=c_count,
            trend_score=float(t_score),
        ))
        platform_counts[p.source] = platform_counts.get(p.source, 0) + 1
        if p.category:
            category_counts[p.category] = category_counts.get(p.category, 0) + 1

    total_items = len(items)
    platform_distribution = []
    for platform, count in sorted(platform_counts.items(), key=lambda x: x[1], reverse=True):
        platform_distribution.append(PlatformDistribution(
            platform=platform,
            count=count,
            percentage=round(count / total_items * 100, 1) if total_items > 0 else 0.0,
        ))

    category_breakdown = []
    for cat, count in sorted(category_counts.items(), key=lambda x: x[1], reverse=True)[:10]:
        category_breakdown.append(CategoryBreakdown(
            category=cat,
            count=count,
            percentage=round(count / total_items * 100, 1) if total_items > 0 else 0.0,
        ))

    response = TrendingResponse(
        period=period,
        category=category,
        items=items,
        total=len(items),
        platform_distribution=platform_distribution,
        category_breakdown=category_breakdown,
    )

    await cache.cache_set(cache_key, response.model_dump(mode="json"), ttl_seconds=300)

    return response


@router.get("/export", summary="Export products as CSV or JSON")
@limiter.limit(rate_limit_from_request)
async def export_products(
    request: Request,
    format: str = Query("json", pattern="^(csv|json)$", description="Export format: csv or json"),
    category: Optional[str] = Query(None, max_length=200, description="Filter by category"),
    source: Optional[str] = Query(None, max_length=100, description="Filter by source/platform"),
    min_price: Optional[Decimal] = Query(None, ge=0, description="Minimum price filter"),
    max_price: Optional[Decimal] = Query(None, ge=0, description="Maximum price filter"),
    limit: int = Query(1000, ge=1, le=10000, description="Max records to export (up to 10K)"),
    offset: int = Query(0, ge=0, le=10000, description="Pagination offset (0-10000)"),
    db: AsyncSession = Depends(get_db),
    api_key: ApiKey = Depends(get_current_api_key),
) -> StreamingResponse:
    request.state.api_key = api_key

    if min_price is not None and max_price is not None and min_price > max_price:
        raise HTTPException(
            status_code=422,
            detail={
                "code": "INVALID_PRICE_RANGE",
                "field": "min_price,max_price",
                "message": "min_price cannot be greater than max_price",
                "min_price": str(min_price),
                "max_price": str(max_price),
            }
        )

    base_query = select(Product).where(Product.is_active == True)

    if category:
        base_query = base_query.where(Product.category.ilike(f"%{category}%"))
    if source:
        base_query = base_query.where(Product.source == source)
    if min_price is not None:
        base_query = base_query.where(Product.price >= min_price)
    if max_price is not None:
        base_query = base_query.where(Product.price <= max_price)

    base_query = base_query.order_by(Product.id).limit(limit).offset(offset)

    results = await db.execute(base_query)
    products = results.scalars().all()

    if format == "csv":
        def _sanitize_csv_cell(value: str) -> str:
            if value and len(value) > 0:
                if value[0] in ('=', '+', '-', '@', '\t'):
                    value = "'" + value
            return value

        async def csv_stream():
            output = io.StringIO()
            writer = csv.writer(output, quoting=csv.QUOTE_ALL)
            fieldnames = [
                "id", "sku", "source", "merchant_id", "title", "description",
                "price", "currency", "url", "brand", "category", "image_url",
                "is_active", "rating", "updated_at"
            ]
            writer.writerow(fieldnames)

            for p in products:
                row = [
                    p.id,
                    _sanitize_csv_cell(p.sku or ""),
                    _sanitize_csv_cell(p.source or ""),
                    _sanitize_csv_cell(p.merchant_id or ""),
                    _sanitize_csv_cell((p.title or "").replace("\n", " ").replace("\r", "")),
                    _sanitize_csv_cell((p.description or "").replace("\n", " ").replace("\r", "")),
                    str(p.price) if p.price else "",
                    p.currency or "SGD",
                    _sanitize_csv_cell(p.url or ""),
                    _sanitize_csv_cell(p.brand or ""),
                    _sanitize_csv_cell(p.category or ""),
                    _sanitize_csv_cell(p.image_url or ""),
                    str(p.is_active) if p.is_active is not None else "",
                    str(p.rating) if p.rating else "",
                    p.updated_at.isoformat() if p.updated_at else "",
                ]
                writer.writerow(row)
                if output.tell() > 65536:
                    yield output.getvalue().encode("utf-8")
                    output.truncate(0)
                    output.seek(0)
            yield output.getvalue().encode("utf-8")

        return StreamingResponse(
            csv_stream(),
            media_type="text/csv",
            headers={
                "Content-Disposition": f"attachment; filename=products_export_{offset}-{offset + len(products)}.csv"
            }
        )
    else:
        async def json_stream():
            buffer = io.BytesIO()
            await buffer.write(b"[")
            first = True
            for p in products:
                if not first:
                    await buffer.write(b",")
                first = False
                obj = {
                    "id": p.id,
                    "sku": p.sku,
                    "source": p.source,
                    "merchant_id": p.merchant_id,
                    "name": p.title,
                    "description": p.description,
                    "price": str(p.price) if p.price else None,
                    "currency": p.currency or "SGD",
                    "buy_url": p.url,
                    "brand": p.brand,
                    "category": p.category,
                    "category_path": p.category_path,
                    "image_url": p.image_url,
                    "availability": p.is_active,
                    "rating": str(p.rating) if p.rating else None,
                    "updated_at": p.updated_at.isoformat() if p.updated_at else None,
                }
                await buffer.write(json.dumps(obj, ensure_ascii=False).encode("utf-8"))
                if buffer.tell() > 65536:
                    yield buffer.getvalue()
                    buffer.truncate(0)
                    buffer.seek(0)
            await buffer.write(b"]")
            yield buffer.getvalue()

        return StreamingResponse(
            json_stream(),
            media_type="application/json",
            headers={
                "Content-Disposition": f"attachment; filename=products_export_{offset}-{offset + len(products)}.json"
            }
        )


def _is_url(identifier: str) -> bool:
    return identifier.startswith("http://") or identifier.startswith("https://")


def _is_upc(identifier: str) -> bool:
    return len(identifier) in (12, 13) and identifier.isdigit()


def _build_bulk_match(p: Product, score: float = 1.0) -> BulkLookupMatch:
    return BulkLookupMatch(
        id=p.id,
        sku=p.sku,
        source=p.source,
        merchant_id=p.merchant_id,
        name=p.title,
        description=p.description,
        price=p.price,
        currency=p.currency,
        buy_url=p.url,
        affiliate_url=get_affiliate_url(p.source, p.url) if p.url else None,
        image_url=p.image_url,
        brand=p.brand,
        category=p.category,
        category_path=p.category_path,
        rating=p.rating,
        is_available=p.is_available,
        last_checked=p.last_checked,
        metadata=p.metadata_,
        updated_at=p.updated_at,
        match_score=score,
    )


@router.post(
    "/bulk-lookup",
    response_model=BulkLookupResponse,
    status_code=status.HTTP_207_MULTI_STATUS,
    summary="Bulk product lookup by SKU, UPC, or product URL",
)
@limiter.limit(rate_limit_from_request)
async def bulk_lookup(
    request: Request,
    body: BulkLookupRequest,
    db: AsyncSession = Depends(get_db),
    api_key: ApiKey = Depends(get_current_api_key),
) -> JSONResponse:
    request.state.api_key = api_key

    if len(body.identifiers) > 100:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Maximum 100 identifiers per request",
        )

    results: List[BulkLookupResultItem] = []
    found = 0
    not_found = 0
    multiple = 0

    for identifier in body.identifiers:
        identifier = identifier.strip()
        if not identifier:
            results.append(BulkLookupResultItem(
                identifier=identifier,
                identifier_type="unknown",
                status="not_found",
                match=None,
                match_count=0,
            ))
            not_found += 1
            continue

        if _is_url(identifier):
            identifier_type = "url"
            result = await db.execute(
                select(Product).where(Product.url == identifier, Product.is_active == True)
            )
            products = result.scalars().all()
        elif _is_upc(identifier):
            identifier_type = "upc"
            result = await db.execute(
                select(Product).where(
                    Product.is_active == True,
                    Product.metadata_.has(upc=identifier),
                )
            )
            products = result.scalars().all()
        else:
            identifier_type = "sku"
            result = await db.execute(
                select(Product).where(Product.sku == identifier, Product.is_active == True)
            )
            products = result.scalars().all()

        if len(products) == 0:
            results.append(BulkLookupResultItem(
                identifier=identifier,
                identifier_type=identifier_type,
                status="not_found",
                match=None,
                match_count=0,
            ))
            not_found += 1
        elif len(products) == 1:
            results.append(BulkLookupResultItem(
                identifier=identifier,
                identifier_type=identifier_type,
                status="found",
                match=_build_bulk_match(products[0]),
                match_count=1,
            ))
            found += 1
        else:
            results.append(BulkLookupResultItem(
                identifier=identifier,
                identifier_type=identifier_type,
                status="multiple",
                match=_build_bulk_match(products[0]),
                match_count=len(products),
            ))
            multiple += 1

    response = BulkLookupResponse(
        results=results,
        total=len(results),
        found=found,
        not_found=not_found,
        multiple=multiple,
    )

    status_code = status.HTTP_200_OK
    if not_found > 0 and found == 0:
        status_code = status.HTTP_404_NOT_FOUND
    elif multiple > 0:
        status_code = status.HTTP_207_MULTI_STATUS

    return JSONResponse(
        status_code=status_code,
        content=response.model_dump(mode="json"),
    )


@router.get("/barcode/{code}", response_model=ProductResponse, summary="Find product by UPC/EAN barcode")
@limiter.limit(rate_limit_from_request)
async def get_product_by_barcode(
    request: Request,
    code: str,
    db: AsyncSession = Depends(get_db),
    api_key: ApiKey = Depends(get_current_api_key),
) -> ProductResponse:
    request.state.api_key = api_key

    cache_key = f"products:barcode:{code}"
    cached = await cache.cache_get(cache_key)
    if cached:
        return ProductResponse(**cached)

    result = await db.execute(
        select(Product).where(Product.barcode == code, Product.is_active == True)
    )
    product = result.scalar_one_or_none()

    if not product:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found for barcode")

    response = _map_product(product)
    await cache.cache_set(cache_key, response.model_dump(mode="json"), ttl_seconds=600)

    return response


@router.get("/random", response_model=ProductListResponse, summary="Get N random products for agent exploration and testing")
@limiter.limit(rate_limit_from_request)
async def get_random_products(
    request: Request,
    limit: int = Query(10, ge=1, le=50, description="Number of random products to return (1-50)"),
    db: AsyncSession = Depends(get_db),
    api_key: ApiKey = Depends(get_current_api_key),
) -> ProductListResponse:
    request.state.api_key = api_key

    cache_key = cache.build_cache_key(
        "products:random",
        limit=limit,
    )
    cached = await cache.cache_get(cache_key)
    if cached:
        return ProductListResponse(**cached)

    total_result = await db.execute(
        select(func.count(Product.id)).where(Product.is_active == True)
    )
    total = total_result.scalar_one()

    results = await db.execute(
        select(Product)
        .where(Product.is_active == True)
        .order_by(func.random())
        .limit(limit)
    )
    products = results.scalars().all()

    items = [_map_product(p) for p in products]

    response = ProductListResponse(
        total=total,
        limit=limit,
        offset=0,
        items=items,
        has_more=total > limit,
    )

    await cache.cache_set(cache_key, response.model_dump(mode="json"), ttl_seconds=600)

    return response


@router.get("/deals", response_model=DealsResponseBase, summary="Find discounted products")
@limiter.limit(rate_limit_from_request)
async def get_product_deals(
    request: Request,
    category: Optional[str] = Query(None, description="Filter by product category"),
    min_discount_pct: Optional[float] = Query(None, ge=0, le=100, description="Minimum discount % (alias: minDiscount)"),
    platform: Optional[str] = Query(None, description="Filter by platform/source (e.g., lazada_sg, shopee_sg)"),
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    db: AsyncSession = Depends(get_db),
    api_key: ApiKey = Depends(get_current_api_key),
) -> DealsResponseBase:
    """Return products currently priced below their original price by at least min_discount_pct%."""
    request.state.api_key = api_key

    discount_threshold = min_discount_pct if min_discount_pct is not None else 10.0
    threshold = 1.0 - (discount_threshold / 100.0)

    base_query = (
        select(Product)
        .where(Product.is_active == True)
        .where(text("metadata->>'original_price' IS NOT NULL"))
        .where(text("CAST(metadata->>'original_price' AS NUMERIC) > 0"))
        .where(
            text(
                "price < :threshold * CAST(metadata->>'original_price' AS NUMERIC)"
            ).bindparams(threshold=threshold)
        )
    )

    if category:
        base_query = base_query.where(Product.category.ilike(f"%{category}%"))

    if platform:
        base_query = base_query.where(Product.source == platform)

    base_query = base_query.order_by(
        text(
            "(CAST(metadata->>'original_price' AS NUMERIC) - price) "
            "/ NULLIF(CAST(metadata->>'original_price' AS NUMERIC), 0) DESC"
        )
    )

    count_q = select(func.count()).select_from(base_query.subquery())
    total = (await db.execute(count_q)).scalar_one()

    result = await db.execute(base_query.limit(limit).offset(offset))
    products = result.scalars().all()

    product_ids = [p.id for p in products]
    click_counts = {}
    if product_ids:
        click_result = await db.execute(
            select(Click.product_id, func.count(Click.id))
            .where(Click.product_id.in_(product_ids))
            .group_by(Click.product_id)
        )
        click_counts = {row[0]: row[1] for row in click_result.all()}

    from app.routers.deals import _to_deal_item
    return DealsResponseBase(
        total=total,
        limit=limit,
        offset=offset,
        items=[_to_deal_item(p, click_counts.get(p.id, 0)) for p in products],
    )


@router.get("/{product_id}", response_model=ProductResponse, summary="Get product by ID")
@limiter.limit(rate_limit_from_request)
async def get_product(
    request: Request,
    product_id: int,
    currency: Optional[str] = Query(None, description=f"Target currency for price conversion. Supported: {', '.join(SUPPORTED_CURRENCIES)}"),
    db: AsyncSession = Depends(get_db),
    api_key: ApiKey = Depends(get_current_api_key),
) -> ProductResponse:
    request.state.api_key = api_key

    cache_key = f"products:item:{product_id}:{currency or 'none'}"
    cached = await cache.cache_get(cache_key)
    if cached:
        return ProductResponse(**cached)

    result = await db.execute(
        select(Product).where(Product.id == product_id, Product.is_active == True)
    )
    product = result.scalar_one_or_none()

    if not product:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found")

    response = _map_product(product, target_currency=currency)
    await cache.cache_set(cache_key, response.model_dump(mode="json"), ttl_seconds=600)

    return response


@router.get(
    "/{product_id}/similar",
    response_model=SimilarProductsResponse,
    summary="Get similar products across merchants using category and price proximity",
)
@limiter.limit(rate_limit_from_request)
async def get_similar_products(
    request: Request,
    product_id: int,
    limit: int = Query(10, ge=1, le=50, description="Number of similar products to return (1-50)"),
    db: AsyncSession = Depends(get_db),
    api_key: ApiKey = Depends(get_current_api_key),
) -> SimilarProductsResponse:
    request.state.api_key = api_key

    cache_key = cache.build_cache_key(
        "products:similar",
        product_id=product_id,
        limit=limit,
    )
    cached = await cache.cache_get(cache_key)
    if cached:
        return SimilarProductsResponse(**cached)

    product_result = await db.execute(
        select(Product).where(Product.id == product_id, Product.is_active == True)
    )
    source_product = product_result.scalar_one_or_none()

    if not source_product:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found")

    if not source_product.category:
        response = SimilarProductsResponse(product_id=product_id, items=[], total=0)
        await cache.cache_set(cache_key, response.model_dump(mode="json"), ttl_seconds=300)
        return response

    source_price = _source_similar_price(source_product)
    min_price = source_price * Decimal("0.70")
    max_price = source_price * Decimal("1.30")
    similar_price = _similar_price_expression(source_product)

    query = (
        select(Product)
        .where(Product.is_active == True)
        .where(Product.id != product_id)
        .where(Product.category == source_product.category)
        .where(Product.merchant_id != source_product.merchant_id)
        .where(similar_price >= min_price)
        .where(similar_price <= max_price)
        .order_by(func.abs(similar_price - source_price).asc(), Product.updated_at.desc())
        .limit(limit)
    )
    result = await db.execute(query)
    candidates = result.scalars().all()

    response = SimilarProductsResponse(
        product_id=product_id,
        items=[_map_product(product) for product in candidates],
        total=len(candidates),
    )

    await cache.cache_set(cache_key, response.model_dump(mode="json"), ttl_seconds=300)

    return response


@router.post(
    "/batch",
    response_model=BatchProductResponse,
    summary="Batch product lookup by IDs",
)
@limiter.limit(rate_limit_from_request)
async def batch_lookup_products(
    request: Request,
    body: BatchProductRequest,
    db: AsyncSession = Depends(get_db),
    api_key: ApiKey = Depends(get_current_api_key),
) -> BatchProductResponse:
    request.state.api_key = api_key

    if len(body.product_ids) > 100:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Maximum 100 product IDs per request",
        )

    cache_keys = [f"products:item:{pid}" for pid in body.product_ids]
    cached_results = await cache.cache_get_many(cache_keys)
    cached_products = {pid: cached_results.get(f"products:item:{pid}") for pid in body.product_ids if f"products:item:{pid}" in cached_results}

    product_ids_to_fetch = [pid for pid in body.product_ids if f"products:item:{pid}" not in cached_results]

    products: List[ProductResponse] = []
    for pid, cached in cached_products.items():
        if cached:
            products.append(ProductResponse(**cached))

    if product_ids_to_fetch:
        result = await db.execute(
            select(Product).where(
                Product.id.in_(product_ids_to_fetch),
                Product.is_active == True,
            )
        )
        rows = result.scalars().all()
        for row in rows:
            product_response = _map_product(row)
            products.append(product_response)
            await cache.cache_set(f"products:item:{row.id}", product_response.model_dump(mode="json"), ttl_seconds=600)

    found_ids = {p.id for p in products}
    not_found = len(body.product_ids) - len(found_ids)

    return BatchProductResponse(
        products=products,
        total=len(products),
        found=len(products),
        not_found=not_found,
    )


@router.post(
    "/bulk-ids",
    response_model=BulkIdsResponse,
    summary="Bulk product lookup by IDs",
)
@limiter.limit(rate_limit_from_request)
async def bulk_lookup_by_ids(
    request: Request,
    body: BulkIdsRequest,
    db: AsyncSession = Depends(get_db),
    api_key: ApiKey = Depends(get_current_api_key),
) -> BulkIdsResponse:
    request.state.api_key = api_key

    if len(body.ids) > 100:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Maximum 100 IDs per request",
        )

    cache_keys = [f"products:item:{id_}" for id_ in body.ids]
    cached_results = await cache.cache_get_many(cache_keys)
    cached_products = {id_: cached_results.get(f"products:item:{id_}") for id_ in body.ids if f"products:item:{id_}" in cached_results}

    ids_to_fetch = [id_ for id_ in body.ids if f"products:item:{id_}" not in cached_results]

    products: List[ProductResponse] = []
    for id_, cached in cached_products.items():
        if cached:
            products.append(ProductResponse(**cached))

    if ids_to_fetch:
        result = await db.execute(
            select(Product).where(
                Product.id.in_(ids_to_fetch),
                Product.is_active == True,
            )
        )
        rows = result.scalars().all()
        for row in rows:
            product_response = _map_product(row)
            products.append(product_response)
            await cache.cache_set(f"products:item:{row.id}", product_response.model_dump(mode="json"), ttl_seconds=600)

    found_ids = {p.id for p in products}
    not_found = len(body.ids) - len(found_ids)

    return BulkIdsResponse(
        products=products,
        total=len(products),
        found=len(products),
        not_found=not_found,
    )


@router.get("/{product_id}/matches", response_model=ProductMatchesResponse, summary="Get product matches across platforms")
@limiter.limit(rate_limit_from_request)
async def get_product_matches(
    request: Request,
    product_id: int,
    min_confidence: float = Query(0.0, ge=0.0, le=1.0, description="Minimum confidence score filter"),
    limit: int = Query(50, ge=1, le=200, description="Max matches to return"),
    recompute: bool = Query(False, description="Force recompute matches instead of using cached"),
    db: AsyncSession = Depends(get_db),
    api_key: ApiKey = Depends(get_current_api_key),
) -> ProductMatchesResponse:
    request.state.api_key = api_key

    cache_key = cache.build_cache_key(
        "products:matches",
        product_id=product_id,
        min_confidence=min_confidence,
        limit=limit,
    )
    cached = await cache.cache_get(cache_key)
    if cached and not recompute:
        return ProductMatchesResponse(**cached)

    product_result = await db.execute(
        select(Product).where(Product.id == product_id, Product.is_active == True)
    )
    if not product_result.scalar_one_or_none():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found")

    from app.services.matches import MatchService
    match_service = MatchService(db)

    stored_matches = await match_service.get_or_compute_matches(
        product_id=product_id,
        min_confidence=min_confidence,
        limit=limit,
        recompute=recompute,
    )

    match_responses = []
    if stored_matches:
        matched_ids = [
            m.matched_product_id if m.source_product_id == product_id else m.source_product_id
            for m in stored_matches
        ]
        matched_products_result = await db.execute(
            select(Product).where(Product.id.in_(matched_ids), Product.is_active == True)
        )
        products_by_id = {p.id: p for p in matched_products_result.scalars().all()}

        for match in stored_matches:
            matched_id = match.matched_product_id if match.source_product_id == product_id else match.source_product_id
            matched_product = products_by_id.get(matched_id)
            if matched_product:
                compare_match = _build_compare_match(matched_product, float(match.confidence_score))
                match_responses.append(compare_match)

    response = ProductMatchesResponse(
        product_id=product_id,
        matches=match_responses,
        total_matches=len(match_responses),
    )

    await cache.cache_set(cache_key, response.model_dump(mode="json"), ttl_seconds=300)
    return response


@router.get("/{product_id}/price-history", response_model=PriceHistoryResponse, summary="Get price history for a product")
@limiter.limit(rate_limit_from_request)
async def get_price_history(
    request: Request,
    product_id: int,
    days: int = Query(30, ge=1, le=365, description="Number of days of history to return (default 30)"),
    platform: Optional[str] = Query(None, description="Filter by source platform (e.g. shopee_sg, lazada_sg)"),
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0, le=10000),
    db: AsyncSession = Depends(get_db),
    api_key: ApiKey = Depends(get_current_api_key),
) -> PriceHistoryResponse:
    request.state.api_key = api_key

    cache_key = cache.build_cache_key(
        "products:price_history",
        product_id=product_id,
        days=days,
        platform=platform,
        limit=limit,
        offset=offset,
    )
    cached = await cache.cache_get(cache_key)
    if cached:
        return PriceHistoryResponse(**cached)

    product_result = await db.execute(
        select(Product).where(Product.id == product_id, Product.is_active == True)
    )
    if not product_result.scalar_one_or_none():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found")

    from datetime import datetime, timedelta, timezone
    cutoff_date = datetime.now(timezone.utc) - timedelta(days=days)

    query = select(PriceHistory).where(PriceHistory.product_id == product_id)
    query = query.where(PriceHistory.recorded_at >= cutoff_date)

    if platform:
        query = query.where(PriceHistory.source == platform)

    count_query = select(func.count()).select_from(query.subquery())
    count_result = await db.execute(count_query)
    total = count_result.scalar_one() or 0

    query = query.order_by(PriceHistory.recorded_at.desc()).limit(limit).offset(offset)
    history_result = await db.execute(query)

    entries = [
        PriceHistoryEntry(
            price=h.price,
            currency=h.currency,
            platform=h.source,
            scraped_at=h.recorded_at,
        )
        for h in history_result.scalars().all()
    ]

    response = PriceHistoryResponse(
        product_id=product_id,
        entries=entries,
        total=total,
    )
    await cache.cache_set(cache_key, response.model_dump(mode="json"), ttl_seconds=300)
    return response


@router.get("/{product_id}/price-stats", response_model=PriceStats, summary="Get price statistics and 30-day trend for a product")
@limiter.limit(rate_limit_from_request)
async def get_price_stats(
    request: Request,
    product_id: int,
    db: AsyncSession = Depends(get_db),
    api_key: ApiKey = Depends(get_current_api_key),
) -> PriceStats:
    request.state.api_key = api_key

    cache_key = f"products:price_stats:{product_id}"
    cached = await cache.cache_get(cache_key)
    if cached:
        return PriceStats(**cached)

    product_result = await db.execute(
        select(Product).where(Product.id == product_id, Product.is_active == True)
    )
    product = product_result.scalar_one_or_none()
    if not product:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found")

    from datetime import datetime, timedelta, timezone
    thirty_days_ago = datetime.now(timezone.utc) - timedelta(days=30)

    stats_result = await db.execute(
        select(
            func.min(PriceHistory.price),
            func.max(PriceHistory.price),
            func.avg(PriceHistory.price),
            func.count(PriceHistory.id),
        )
        .where(PriceHistory.product_id == product_id)
        .where(PriceHistory.recorded_at >= thirty_days_ago)
    )
    row = stats_result.one_or_none()
    min_price = row[0] or product.price
    max_price = row[1] or product.price
    avg_price = row[2] or product.price
    record_count = row[3] or 0

    trend_result = await db.execute(
        select(PriceHistory.price, PriceHistory.recorded_at)
        .where(PriceHistory.product_id == product_id)
        .where(PriceHistory.recorded_at >= thirty_days_ago)
        .order_by(PriceHistory.recorded_at.asc())
    )
    trend_rows = trend_result.scalars().all()

    price_trend = "stable"
    price_trend_pct = None
    if len(trend_rows) >= 2:
        first_price = float(trend_rows[0].price)
        last_price = float(trend_rows[-1].price)
        if first_price > 0:
            price_trend_pct = round((last_price - first_price) / first_price * 100, 2)
        if last_price > first_price * 1.01:
            price_trend = "up"
        elif last_price < first_price * 0.99:
            price_trend = "down"

    response = PriceStats(
        current_price=product.price,
        currency=product.currency,
        min_price=min_price,
        max_price=max_price,
        avg_price=avg_price,
        price_trend=price_trend,
        price_trend_pct=price_trend_pct,
        record_count=record_count,
    )
    await cache.cache_set(cache_key, response.model_dump(mode="json"), ttl_seconds=300)
    return response


def _linear_regression(prices: List[float], times: List[float]) -> tuple[float, float, float]:
    n = len(prices)
    if n < 2:
        return 0.0, prices[0] if prices else 0.0, 0.0
    sum_x = sum(times)
    sum_y = sum(prices)
    sum_xy = sum(x * y for x, y in zip(times, prices))
    sum_x2 = sum(x * x for x in times)
    slope = (n * sum_xy - sum_x * sum_y) / (n * sum_x2 - sum_x * sum_x) if (n * sum_x2 - sum_x * sum_x) != 0 else 0.0
    intercept = (sum_y - slope * sum_x) / n
    mean_y = sum_y / n
    ss_tot = sum((y - mean_y) ** 2 for y in prices)
    ss_res = sum((y - (slope * x + intercept)) ** 2 for x, y in zip(times, prices))
    r_squared = 1.0 - (ss_res / ss_tot) if ss_tot != 0 else 0.0
    return slope, intercept, r_squared


@router.get("/{product_id}/price-prediction", response_model=PricePredictionResponse, summary="Predict future price trend using linear regression on price history")
@limiter.limit(rate_limit_from_request)
async def get_price_prediction(
    request: Request,
    product_id: int,
    db: AsyncSession = Depends(get_db),
    api_key: ApiKey = Depends(get_current_api_key),
) -> PricePredictionResponse:
    request.state.api_key = api_key

    cache_key = f"products:price_prediction:{product_id}"
    cached = await cache.cache_get(cache_key)
    if cached:
        return PricePredictionResponse(**cached)

    product_result = await db.execute(
        select(Product).where(Product.id == product_id, Product.is_active == True)
    )
    product = product_result.scalar_one_or_none()
    if not product:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found")

    from datetime import datetime, timedelta, timezone
    ninety_days_ago = datetime.now(timezone.utc) - timedelta(days=90)

    history_result = await db.execute(
        select(PriceHistory.price, PriceHistory.recorded_at)
        .where(PriceHistory.product_id == product_id)
        .where(PriceHistory.recorded_at >= ninety_days_ago)
        .order_by(PriceHistory.recorded_at.asc())
    )
    rows = list(history_result.scalars().all())

    if len(rows) < 2:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Insufficient price history data for prediction (minimum 2 data points required)",
        )

    prices = [float(r.price) for r in rows]
    ref_time = rows[0].recorded_at.replace(tzinfo=timezone.utc).timestamp()
    times = [r.recorded_at.replace(tzinfo=timezone.utc).timestamp() - ref_time for r in rows]
    times_in_days = [t / 86400.0 for t in times]

    slope, intercept, r_squared = _linear_regression(prices, times_in_days)

    last_recorded_at = rows[-1].recorded_at.replace(tzinfo=timezone.utc)
    now_ts = datetime.now(timezone.utc).timestamp()
    last_time_days = (last_recorded_at.timestamp() - ref_time) / 86400.0

    days_ahead_7 = 7.0
    days_ahead_30 = 30.0
    predicted_price_7d = slope * (last_time_days + days_ahead_7) + intercept
    predicted_price_30d = slope * (last_time_days + days_ahead_30) + intercept

    current_price = float(product.price)
    price_change_7d_pct = ((predicted_price_7d - current_price) / current_price * 100) if current_price > 0 else 0.0
    price_change_30d_pct = ((predicted_price_30d - current_price) / current_price * 100) if current_price > 0 else 0.0

    def _direction(pct: float) -> str:
        if pct > 1.0:
            return "up"
        elif pct < -1.0:
            return "down"
        return "stable"

    historical_trend_pct = None
    if len(prices) >= 2 and prices[0] > 0:
        historical_trend_pct = round((prices[-1] - prices[0]) / prices[0] * 100, 2)

    response = PricePredictionResponse(
        product_id=product_id,
        current_price=product.price,
        currency=product.currency,
        prediction_7d=_direction(price_change_7d_pct),
        prediction_30d=_direction(price_change_30d_pct),
        predicted_price_7d=Decimal(str(round(predicted_price_7d, 2))),
        predicted_price_30d=Decimal(str(round(predicted_price_30d, 2))),
        confidence_score=round(max(0.0, min(1.0, r_squared)), 3),
        trend=_direction(historical_trend_pct) if historical_trend_pct is not None else "stable",
        trend_pct=historical_trend_pct,
        data_points=len(rows),
    )
    await cache.cache_set(cache_key, response.model_dump(mode="json"), ttl_seconds=3600)
    return response


@router.get("/{product_id}/alternatives", response_model=RecommendationsResponse, summary="Find cheaper alternatives in the same category")
@limiter.limit(rate_limit_from_request)
async def get_alternative_products(
    request: Request,
    product_id: int,
    limit: int = Query(10, ge=1, le=20, description="Number of alternatives to return"),
    db: AsyncSession = Depends(get_db),
    api_key: ApiKey = Depends(get_current_api_key),
) -> RecommendationsResponse:
    request.state.api_key = api_key

    cache_key = cache.build_cache_key(
        "products:alternatives",
        product_id=product_id,
        limit=limit,
    )
    cached = await cache.cache_get(cache_key)
    if cached:
        return RecommendationsResponse(**cached)

    source_result = await db.execute(
        select(Product).where(Product.id == product_id, Product.is_active == True)
    )
    source_product = source_result.scalar_one_or_none()
    if not source_product:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found")

    from app.recommendations import RecommendationEngine
    engine = RecommendationEngine(db)
    alternatives = await engine.find_alternatives(source_product, limit=limit)

    items = []
    for product, score in alternatives:
        items.append(RecommendationMatch(
            id=product.id,
            sku=product.sku,
            source=product.source,
            merchant_id=product.merchant_id,
            name=product.title,
            description=product.description,
            price=product.price,
            currency=product.currency,
            buy_url=product.url,
            affiliate_url=get_affiliate_url(product.source, product.url) if product.url else None,
            image_url=product.image_url,
            brand=product.brand,
            category=product.category,
            category_path=product.category_path,
            rating=product.rating,
            is_available=product.is_available,
            last_checked=product.last_checked,
            metadata=product.metadata_,
            updated_at=product.updated_at,
            relevance_score=score,
        ))

    response = RecommendationsResponse(
        source_product_id=source_product.id,
        source_product_name=source_product.title,
        items=items,
        total=len(items),
    )
    await cache.cache_set(cache_key, response.model_dump(mode="json"), ttl_seconds=3600)
    return response


@router.get("/{product_id}/bundles", response_model=BundleResponse, summary="Suggest complementary products for bundling")
@limiter.limit(rate_limit_from_request)
async def get_bundle_suggestions(
    request: Request,
    product_id: int,
    limit: int = Query(10, ge=1, le=20, description="Number of bundle items to return"),
    db: AsyncSession = Depends(get_db),
    api_key: ApiKey = Depends(get_current_api_key),
) -> BundleResponse:
    request.state.api_key = api_key

    cache_key = cache.build_cache_key(
        "products:bundles",
        product_id=product_id,
        limit=limit,
    )
    cached = await cache.cache_get(cache_key)
    if cached:
        return BundleResponse(**cached)

    source_result = await db.execute(
        select(Product).where(Product.id == product_id, Product.is_active == True)
    )
    source_product = source_result.scalar_one_or_none()
    if not source_product:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found")

    from app.recommendations import RecommendationEngine
    engine = RecommendationEngine(db)
    bundles = await engine.find_bundles(source_product, limit=limit)

    items = []
    for product, score, reason in bundles:
        items.append(BundleMatch(
            id=product.id,
            sku=product.sku,
            source=product.source,
            merchant_id=product.merchant_id,
            name=product.title,
            description=product.description,
            price=product.price,
            currency=product.currency,
            buy_url=product.url,
            affiliate_url=get_affiliate_url(product.source, product.url) if product.url else None,
            image_url=product.image_url,
            brand=product.brand,
            category=product.category,
            category_path=product.category_path,
            rating=product.rating,
            is_available=product.is_available,
            last_checked=product.last_checked,
            metadata=product.metadata_,
            updated_at=product.updated_at,
            relevance_score=score,
            bundle_reason=reason,
        ))

    response = BundleResponse(
        source_product_id=source_product.id,
        source_product_name=source_product.title,
        items=items,
        total=len(items),
    )
    await cache.cache_set(cache_key, response.model_dump(mode="json"), ttl_seconds=3600)
    return response


@router.get("/{product_id}/also-searched", response_model=RecommendationsResponse, summary="Find products frequently searched together based on co-occurrence analysis")
@limiter.limit(rate_limit_from_request)
async def get_also_searched(
    request: Request,
    product_id: int,
    limit: int = Query(10, ge=1, le=20, description="Number of products to return"),
    db: AsyncSession = Depends(get_db),
    api_key: ApiKey = Depends(get_current_api_key),
) -> RecommendationsResponse:
    request.state.api_key = api_key

    cache_key = cache.build_cache_key(
        "products:also-searched",
        product_id=product_id,
        limit=limit,
    )
    cached = await cache.cache_get(cache_key)
    if cached:
        return RecommendationsResponse(**cached)

    source_result = await db.execute(
        select(Product).where(Product.id == product_id, Product.is_active == True)
    )
    source_product = source_result.scalar_one_or_none()
    if not source_product:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found")

    from app.recommendations_engine import CoOccurrenceEngine
    engine = CoOccurrenceEngine(db)
    also_searched = await engine.find_also_searched(source_product, limit=limit)

    items = []
    for product, score in also_searched:
        items.append(RecommendationMatch(
            id=product.id,
            sku=product.sku,
            source=product.source,
            merchant_id=product.merchant_id,
            name=product.title,
            description=product.description,
            price=product.price,
            currency=product.currency,
            buy_url=product.url,
            affiliate_url=get_affiliate_url(product.source, product.url) if product.url else None,
            image_url=product.image_url,
            brand=product.brand,
            category=product.category,
            category_path=product.category_path,
            rating=product.rating,
            is_available=product.is_available,
            last_checked=product.last_checked,
            metadata=product.metadata_,
            updated_at=product.updated_at,
            relevance_score=score,
        ))

    response = RecommendationsResponse(
        source_product_id=source_product.id,
        source_product_name=source_product.title,
        items=items,
        total=len(items),
    )
    await cache.cache_set(cache_key, response.model_dump(mode="json"), ttl_seconds=3600)
    return response


@router.post("/{product_id}/click", summary="Track product click and redirect to affiliate URL")
async def track_product_click(
    request: Request,
    product_id: int,
    db: AsyncSession = Depends(get_db),
    api_key: ApiKey = Depends(get_current_api_key),
):
    result = await db.execute(
        select(Product).where(Product.id == product_id, Product.is_active == True)
    )
    product = result.scalar_one_or_none()
    if not product:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found")

    affiliate_url = get_underlying_affiliate_url(product.source, product.url)
    if not affiliate_url or not is_valid_url(affiliate_url):
        affiliate_url = product.url

    import uuid
    tracking_id = f"{product_id}_{uuid.uuid4().hex[:12]}"

    click_record = Click(
        tracking_id=tracking_id,
        product_id=product_id,
        platform=product.source,
        destination_url=affiliate_url,
        api_key_id=api_key.id if api_key else None,
        user_agent=request.headers.get("user-agent"),
        referrer=request.headers.get("referer"),
    )
    db.add(click_record)
    await db.commit()

    cache_key = f"click_count:{product_id}"
    await cache.cache_delete(cache_key)

    return RedirectResponse(url=affiliate_url, status_code=status.HTTP_302_FOUND)


def _derive_stock_status(product: Product) -> StockStatus:
    if product.metadata_ and isinstance(product.metadata_, dict):
        status_str = product.metadata_.get("stock_status") or product.metadata_.get("stock_status")
        if status_str in ("in_stock", "low_stock", "out_of_stock", "pre_order"):
            return StockStatus(status_str)
    if not product.is_available:
        return StockStatus.OUT_OF_STOCK
    return StockStatus.IN_STOCK


def _build_platform_availability(product: Product) -> PlatformAvailability:
    return PlatformAvailability(
        platform=product.source,
        status=_derive_stock_status(product),
        last_checked_at=product.last_checked,
        raw_stock_info=product.metadata_.get("stock_info") if product.metadata_ and isinstance(product.metadata_, dict) else None,
    )


def _get_overall_status(platforms: List[PlatformAvailability]) -> StockStatus:
    if not platforms:
        return StockStatus.OUT_OF_STOCK
    status_priority = {
        StockStatus.OUT_OF_STOCK: 0,
        StockStatus.LOW_STOCK: 1,
        StockStatus.PRE_ORDER: 2,
        StockStatus.IN_STOCK: 3,
    }
    return min(platforms, key=lambda p: status_priority.get(p.status, 0)).status


@router.get("/{product_id}/reviews", response_model=ProductReviewsResponse, summary="Get product reviews aggregation across platforms")
@limiter.limit(rate_limit_from_request)
async def get_product_reviews(
    request: Request,
    product_id: int,
    db: AsyncSession = Depends(get_db),
    api_key: ApiKey = Depends(get_current_api_key),
) -> ProductReviewsResponse:
    request.state.api_key = api_key

    cache_key = f"products:reviews:{product_id}"
    cached = await cache.cache_get(cache_key)
    if cached:
        return ProductReviewsResponse(**cached)

    result = await db.execute(
        select(Product).where(Product.id == product_id, Product.is_active == True)
    )
    product = result.scalar_one_or_none()

    if not product:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found")

    products_list = [product]

    if product.canonical_id:
        canonical_result = await db.execute(
            select(Product).where(
                Product.canonical_id == product.canonical_id,
                Product.is_active == True,
                Product.id != product.id,
            )
        )
        products_list.extend(canonical_result.scalars().all())

    total_reviews = 0
    weighted_rating_sum = Decimal("0")
    sources = []
    all_ratings: List[Decimal] = []

    for p in products_list:
        if p.review_count and p.review_count > 0:
            total_reviews += p.review_count
            sources.append(ReviewSource(
                source=p.source,
                review_count=p.review_count,
                avg_rating=p.avg_rating,
                last_scraped=p.updated_at,
            ))
            if p.avg_rating:
                weighted_rating_sum += p.avg_rating * p.review_count
                all_ratings.extend([p.avg_rating] * p.review_count)

        if p.metadata_ and isinstance(p.metadata_, dict):
            rating_dist = p.metadata_.get("rating_distribution")
            if rating_dist and isinstance(rating_dist, dict):
                for stars_str, count in rating_dist.items():
                    try:
                        stars = int(stars_str)
                        count = int(count)
                        all_ratings.extend([Decimal(str(stars))] * count)
                    except (ValueError, TypeError):
                        pass

    avg_rating = None
    if total_reviews > 0:
        avg_rating = weighted_rating_sum / total_reviews

    sources.sort(key=lambda x: x.review_count or 0, reverse=True)

    rating_distribution: List[RatingDistributionBucket] = []
    if all_ratings:
        rating_counts: Dict[int, int] = {1: 0, 2: 0, 3: 0, 4: 0, 5: 0}
        for r in all_ratings:
            star = min(5, max(1, int(float(r))))
            rating_counts[star] = rating_counts.get(star, 0) + 1

        for stars in range(1, 6):
            count = rating_counts.get(stars, 0)
            percentage = (count / len(all_ratings) * 100) if all_ratings else 0.0
            rating_distribution.append(RatingDistributionBucket(
                stars=stars,
                count=count,
                percentage=round(percentage, 2),
            ))

    sentiment_score = None
    if avg_rating is not None:
        sentiment_score = float(avg_rating) / 5.0

    primary_source = product.rating_source or product.source

    product_ids_for_reviews = [p.id for p in products_list]
    reviews_result = await db.execute(
        select(ProductReview)
        .where(ProductReview.product_id.in_(product_ids_for_reviews))
        .order_by(ProductReview.helpfulness_votes.desc(), ProductReview.review_date.desc())
        .limit(10)
    )
    db_reviews = reviews_result.scalars().all()

    sample_reviews = [
        SampleReview(
            id=r.id,
            source=r.source,
            author_name=r.author_name,
            rating=r.rating,
            title=r.title,
            content=r.content,
            verified_purchase=r.verified_purchase,
            helpfulness_votes=r.helpfulness_votes,
            review_url=r.review_url,
            review_date=r.review_date,
            scraped_at=r.scraped_at,
        )
        for r in db_reviews
    ]

    response = ProductReviewsResponse(
        product_id=product_id,
        review_count=total_reviews or None,
        avg_rating=avg_rating,
        rating_source=primary_source,
        sentiment_score=sentiment_score,
        rating_distribution=rating_distribution,
        sources=sources,
        sample_reviews=sample_reviews,
    )

    await cache.cache_set(cache_key, response.model_dump(mode="json"), ttl_seconds=600)

    return response


@router.get("/{product_id}/availability", response_model=ProductAvailabilityResponse, summary="Get product availability and stock status across all platforms")
@limiter.limit(rate_limit_from_request)
async def get_product_availability(
    request: Request,
    product_id: int,
    force_refresh: bool = Query(False, description="Force URL check instead of using cache"),
    db: AsyncSession = Depends(get_db),
    api_key: ApiKey = Depends(get_current_api_key),
) -> ProductAvailabilityResponse:
    request.state.api_key = api_key

    cache_key = f"products:availability:{product_id}"
    if not force_refresh:
        cached = await cache.cache_get(cache_key)
        if cached:
            return ProductAvailabilityResponse(**cached)

    result = await db.execute(
        select(Product).where(Product.id == product_id, Product.is_active == True)
    )
    product = result.scalar_one_or_none()

    if not product:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found")

    now = datetime.now(timezone.utc)

    if product.canonical_id:
        related_result = await db.execute(
            select(Product).where(
                Product.canonical_id == product.canonical_id,
                Product.is_active == True,
            )
        )
        related_products = list(related_result.scalars().all())
    else:
        related_products = [product]

    products_to_check = []
    for rp in related_products:
        needs_check = force_refresh or _is_stale(rp.last_checked)
        if needs_check and rp.url:
            products_to_check.append(rp)

    if products_to_check:
        for rp in products_to_check:
            is_url_available = await _check_url_availability(rp.url)
            if is_url_available != rp.is_available:
                rp.is_available = is_url_available
            rp.last_checked = now
        await db.commit()
        for rp in products_to_check:
            await db.refresh(rp)

    platform_avail_list = [_build_platform_availability(rp) for rp in related_products]
    overall = _get_overall_status(platform_avail_list)

    latest_checked = max(
        (rp.last_checked for rp in related_products if rp.last_checked),
        default=None,
    )

    response = ProductAvailabilityResponse(
        product_id=product.id,
        canonical_id=product.canonical_id,
        platforms=platform_avail_list,
        overall_status=overall,
        last_checked_at=latest_checked,
        is_stale=any(_is_stale(rp.last_checked) for rp in related_products),
    )

    await cache.cache_set(cache_key, response.model_dump(mode="json"), ttl_seconds=AVAILABILITY_CACHE_TTL)

    return response


@router.get("/{product_id}/stock", response_model=ProductStockResponse, summary="Get product stock level")
@limiter.limit(rate_limit_from_request)
async def get_product_stock(
    request: Request,
    product_id: int,
    db: AsyncSession = Depends(get_db),
    api_key: ApiKey = Depends(get_current_api_key),
) -> ProductStockResponse:
    request.state.api_key = api_key

    cache_key = f"products:stock:{product_id}"
    cached = await cache.cache_get(cache_key)
    if cached:
        return ProductStockResponse(**cached)

    result = await db.execute(
        select(Product).where(Product.id == product_id, Product.is_active == True)
    )
    product = result.scalar_one_or_none()

    if not product:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found")

    response = ProductStockResponse(
        product_id=product.id,
        in_stock=product.in_stock,
        stock_level=product.stock_level,
        last_checked=product.last_checked,
    )

    await cache.cache_set(cache_key, response.model_dump(mode="json"), ttl_seconds=600)

    return response


@router.get(
    "/{product_id}/url-availability",
    response_model=ProductURLAvailabilityResponse,
    summary="Check if product source URL is live — lightweight availability check for agents",
)
@limiter.limit(rate_limit_from_request)
async def get_product_url_availability(
    request: Request,
    product_id: int,
    force_refresh: bool = Query(False, description="Force URL check instead of using cache"),
    db: AsyncSession = Depends(get_db),
    api_key: ApiKey = Depends(get_current_api_key),
) -> ProductURLAvailabilityResponse:
    request.state.api_key = api_key

    cache_key = f"products:url-availability:{product_id}"
    now = datetime.now(timezone.utc)
    cached_until = now + timedelta(seconds=AVAILABILITY_CACHE_TTL)

    if not force_refresh:
        cached = await cache.cache_get(cache_key)
        if cached:
            return ProductURLAvailabilityResponse(**cached)

    result = await db.execute(
        select(Product).where(Product.id == product_id, Product.is_active == True)
    )
    product = result.scalar_one_or_none()

    if not product:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found")

    if not product.url:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Product has no source URL",
        )

    is_stale = _is_stale(product.last_checked)
    if force_refresh or is_stale:
        is_available = await _check_url_availability(product.url)
        product.is_available = is_available
        product.last_checked = now
        await db.commit()
        await db.refresh(product)

    response = ProductURLAvailabilityResponse(
        available=product.is_available,
        last_checked=product.last_checked or now,
        source_url=product.url,
        cached_until=cached_until,
    )

    await cache.cache_set(cache_key, response.model_dump(mode="json"), ttl_seconds=AVAILABILITY_CACHE_TTL)

    return response


@router.post("/availability", response_model=BulkAvailabilityResponse, summary="Bulk check product availability for multiple products")
@limiter.limit(rate_limit_from_request)
async def bulk_check_availability(
    request: Request,
    body: BulkAvailabilityRequest,
    db: AsyncSession = Depends(get_db),
    api_key: ApiKey = Depends(get_current_api_key),
) -> BulkAvailabilityResponse:
    request.state.api_key = api_key

    if not body.product_ids:
        return BulkAvailabilityResponse(products=[], total=0)

    cache_keys = [f"products:availability:{pid}" for pid in body.product_ids]

    cached_results = []
    missing_ids = []
    for i, pid in enumerate(body.product_ids):
        cached = await cache.cache_get(f"products:availability:{pid}")
        if cached:
            cached_results.append((i, ProductAvailabilityResponse(**cached)))
        else:
            missing_ids.append((i, pid))

    result = await db.execute(
        select(Product).where(
            Product.id.in_([pid for _, pid in missing_ids]),
            Product.is_active == True,
        )
    )
    products = result.scalars().all()
    product_map = {p.id: p for p in products}

    results: List[Optional[ProductAvailabilityResponse]] = [None] * len(body.product_ids)

    for idx, cached_resp in cached_results:
        results[idx] = cached_resp

    for idx, pid in missing_ids:
        product = product_map.get(pid)
        if product:
            platform_avail = _build_platform_availability(product)
            overall = _get_overall_status([platform_avail])
            resp = ProductAvailabilityResponse(
                product_id=product.id,
                canonical_id=product.canonical_id,
                platforms=[platform_avail],
                overall_status=overall,
                last_checked_at=product.last_checked,
                is_stale=_is_stale(product.last_checked),
            )
            results[idx] = resp
            await cache.cache_set(f"products:availability:{pid}", resp.model_dump(mode="json"), ttl_seconds=AVAILABILITY_CACHE_TTL)
        else:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Product not found: {pid}",
            )

    final_products = [r for r in results if r is not None]

    return BulkAvailabilityResponse(products=final_products, total=len(final_products))


@router.post("/check-availability", response_model=BulkAvailabilityResponse, summary="Check if product URLs are still accessible and update availability status")
@limiter.limit(rate_limit_from_request)
async def check_availability(
    request: Request,
    body: BulkAvailabilityRequest,
    db: AsyncSession = Depends(get_db),
    api_key: ApiKey = Depends(get_current_api_key),
) -> BulkAvailabilityResponse:
    request.state.api_key = api_key

    if not body.product_ids:
        return BulkAvailabilityResponse(products=[], total=0)

    result = await db.execute(
        select(Product).where(
            Product.id.in_(body.product_ids),
            Product.is_active == True,
        )
    )
    products = result.scalars().all()
    product_map = {p.id: p for p in products}

    now = datetime.now(timezone.utc)
    updated_products = []

    for product in products:
        if product.url:
            is_url_available = await _check_url_availability(product.url)
            if is_url_available != product.is_available:
                product.is_available = is_url_available
            product.last_checked = now
            updated_products.append(product)

    if updated_products:
        await db.commit()
        for p in updated_products:
            await db.refresh(p)

    results: List[ProductAvailabilityResponse] = []
    for pid in body.product_ids:
        product = product_map.get(pid)
        if not product:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Product not found: {pid}",
            )
        platform_avail = _build_platform_availability(product)
        overall = _get_overall_status([platform_avail])
        resp = ProductAvailabilityResponse(
            product_id=product.id,
            canonical_id=product.canonical_id,
            platforms=[platform_avail],
            overall_status=overall,
            last_checked_at=product.last_checked,
            is_stale=_is_stale(product.last_checked),
        )
        results.append(resp)
        await cache.cache_set(f"products:availability:{pid}", resp.model_dump(mode="json"), ttl_seconds=AVAILABILITY_CACHE_TTL)

    return BulkAvailabilityResponse(products=results, total=len(results))


@router.get("/{product_id}/price-comparison", response_model=PriceComparisonResponse, summary="Compare prices across platforms for a product")
@limiter.limit(rate_limit_from_request)
async def get_price_comparison(
    request: Request,
    product_id: int,
    db: AsyncSession = Depends(get_db),
    api_key: ApiKey = Depends(get_current_api_key),
) -> PriceComparisonResponse:
    """Return all platform listings for the same product with price, shipping cost, total cost, seller rating, delivery estimate.

    Uses ProductMatcher to find matching products across platforms, then enriches with
    shipping/delivery data from metadata.
    """
    request.state.api_key = api_key

    cache_key = f"products:price_comparison:{product_id}"
    cached = await cache.cache_get(cache_key)
    if cached:
        return PriceComparisonResponse(**cached)

    source_result = await db.execute(
        select(Product).where(Product.id == product_id, Product.is_active == True)
    )
    source_product = source_result.scalar_one_or_none()
    if not source_product:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found")

    from app.compare import ProductMatcher
    matcher = ProductMatcher(db)
    matches = await matcher.find_matches(source_product)

    items: List[PriceComparisonItem] = []
    cheapest_id: Optional[int] = None
    fastest_delivery_id: Optional[int] = None
    best_rated_id: Optional[int] = None
    cheapest_total: Optional[Decimal] = None
    fastest_delivery_days: Optional[int] = None
    best_rating_val: Optional[Decimal] = None

    for matched_product, score in matches:
        meta = matched_product.metadata_ or {}
        shipping_cost = meta.get("shipping_cost") or meta.get("shipping")
        if shipping_cost is not None:
            try:
                shipping_cost = Decimal(str(shipping_cost))
            except Exception:
                shipping_cost = None
        else:
            shipping_cost = Decimal("0")

        total_cost = matched_product.price + (shipping_cost or Decimal("0"))

        delivery_estimate = meta.get("delivery_estimate") or meta.get("delivery") or meta.get("shipping_days")
        delivery_days: Optional[int] = None
        if delivery_estimate is not None:
            try:
                delivery_days = int(delivery_estimate)
            except (ValueError, TypeError):
                pass

        rating_val = matched_product.rating

        item = PriceComparisonItem(
            id=matched_product.id,
            source=matched_product.source,
            merchant_id=matched_product.merchant_id,
            name=matched_product.title,
            price=matched_product.price,
            currency=matched_product.currency,
            shipping_cost=shipping_cost,
            total_cost=total_cost,
            buy_url=matched_product.url,
            affiliate_url=get_affiliate_url(matched_product.source, matched_product.url) if matched_product.url else None,
            image_url=matched_product.image_url,
            rating=rating_val,
            delivery_estimate=str(delivery_estimate) if delivery_estimate else None,
            is_available=matched_product.is_available,
            last_checked=matched_product.last_checked,
        )
        items.append(item)

        if cheapest_total is None or total_cost < cheapest_total:
            cheapest_total = total_cost
            cheapest_id = matched_product.id

        if delivery_days is not None:
            if fastest_delivery_days is None or delivery_days < fastest_delivery_days:
                fastest_delivery_days = delivery_days
                fastest_delivery_id = matched_product.id
        elif fastest_delivery_id is None:
            fastest_delivery_id = matched_product.id

        if rating_val is not None:
            if best_rating_val is None or rating_val > best_rating_val:
                best_rating_val = rating_val
                best_rated_id = matched_product.id

    items.sort(key=lambda x: x.total_cost)

    response = PriceComparisonResponse(
        source_product_id=source_product.id,
        source_product_name=source_product.title,
        items=items,
        total=len(items),
        cheapest_product_id=cheapest_id,
        fastest_delivery_product_id=fastest_delivery_id,
        best_rated_product_id=best_rated_id,
    )

    await cache.cache_set(cache_key, response.model_dump(mode="json"), ttl_seconds=300)

    return response


@router.get("/feed", summary="Stream all products as NDJSON for bulk data consumers")
async def products_feed(
    request: Request,
    updatedSince: Optional[str] = Query(
        None,
        alias="updatedSince",
        description="ISO8601 timestamp — return only products updated at or after this time",
    ),
    limit: int = Query(1000, ge=1, le=5000, description="Chunk size per iteration (products per yield)"),
    db: AsyncSession = Depends(get_db),
    api_key: ApiKey = Depends(get_current_api_key),
):
    request.state.api_key = api_key

    from datetime import datetime, timezone
    from hashlib import md5

    filter_updated_since: Optional[datetime] = None
    if updatedSince:
        try:
            filter_updated_since = datetime.fromisoformat(updatedSince.replace("Z", "+00:00"))
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="updatedSince must be a valid ISO8601 datetime (e.g. 2024-01-15T00:00:00Z)",
            )

    base_query = select(Product).where(Product.is_active == True)

    if filter_updated_since:
        base_query = base_query.where(Product.updated_at >= filter_updated_since)

    base_query = base_query.order_by(Product.updated_at.asc(), Product.id.asc())

    max_updated_result = await db.execute(
        select(func.max(Product.updated_at)).select_from(Product).where(Product.is_active == True)
    )
    max_updated_at: Optional[datetime] = max_updated_result.scalar_one_or_none()
    if max_updated_at is None:
        max_updated_at = datetime.now(timezone.utc)

    etag_input = f"{max_updated_at.isoformat()}"
    if filter_updated_since:
        etag_input += f":{filter_updated_since.isoformat()}"
    etag = f'"{md5(etag_input.encode()).hexdigest()}"'

    if_none_match = request.headers.get("If-None-Match")
    if if_none_match and if_none_match == etag:
        return JSONResponse(status_code=status.HTTP_304_NOT_MODIFIED)

    async def ndjson_stream():
        offset = 0
        total_yielded = 0

        while True:
            chunk_query = base_query.limit(limit).offset(offset)
            result = await db.execute(chunk_query)
            products = result.scalars().all()

            if not products:
                break

            for p in products:
                obj = {
                    "id": p.id,
                    "sku": p.sku,
                    "source": p.source,
                    "merchant_id": p.merchant_id,
                    "name": p.title,
                    "description": p.description,
                    "price": str(p.price) if p.price else None,
                    "currency": p.currency or "SGD",
                    "buy_url": p.url,
                    "brand": p.brand,
                    "category": p.category,
                    "category_path": p.category_path,
                    "image_url": p.image_url,
                    "is_available": p.is_available,
                    "rating": str(p.rating) if p.rating else None,
                    "metadata": p.metadata_,
                    "updated_at": p.updated_at.isoformat() if p.updated_at else None,
                }
                yield (json.dumps(obj, ensure_ascii=False) + "\n").encode("utf-8")
                total_yielded += 1

            offset += limit

            if len(products) < limit:
                break

        logger.debug(f"Feed stream completed: {total_yielded} products yielded")

    return StreamingResponse(
        ndjson_stream(),
        media_type="application/x-ndjson",
        headers={
            "ETag": etag,
            "Cache-Control": "no-cache",
            "Transfer-Encoding": "chunked",
            "X-Products-Feed": "true",
        },
    )


async def get_merchant_api_key(
    api_key: ApiKey = Depends(get_current_api_key),
) -> ApiKey:
    if api_key.role != "merchant":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This endpoint requires an API key with merchant role",
        )
    return api_key


@router.post(
    "/bulk",
    response_model=BulkImportResponse,
    summary="Bulk import products for merchant self-serve",
)
@limiter.limit(rate_limit_from_request)
async def bulk_import_products(
    request: Request,
    body: BulkImportRequest,
    db: AsyncSession = Depends(get_db),
    api_key: ApiKey = Depends(get_merchant_api_key),
) -> BulkImportResponse:
    rows_inserted = 0
    rows_updated = 0
    rows_failed = 0
    errors: List[BulkImportError] = []

    for idx, item in enumerate(body.products):
        try:
            await db.execute(text("SAVEPOINT sp_bulk_product"))

            existing_result = await db.execute(
                select(Product.id, Product.price, Product.is_available).where(
                    Product.sku == item.sku,
                    Product.source == body.source
                )
            )
            existing_row = existing_result.one_or_none()
            is_update = existing_row is not None
            old_price = existing_row.price if existing_row else None

            values = {
                "sku": item.sku,
                "source": body.source,
                "merchant_id": api_key.developer_id,
                "title": item.title,
                "description": item.description,
                "price": item.price,
                "currency": item.currency,
                "url": item.url,
                "image_url": item.image_url,
                "brand": item.brand,
                "category": item.category,
                "category_path": item.category_path,
                "is_active": item.is_active,
                "is_available": item.is_available if item.is_available is not None else True,
                "metadata_": item.metadata,
            }

            stmt = (
                insert(Product.__table__)
                .values(**values)
                .on_conflict_do_update(
                    constraint="products_sku_source_unique",
                    set_={
                        "title": values["title"],
                        "description": values["description"],
                        "price": values["price"],
                        "currency": values["currency"],
                        "url": values["url"],
                        "image_url": values["image_url"],
                        "brand": values["brand"],
                        "category": values["category"],
                        "category_path": values["category_path"],
                        "merchant_id": values["merchant_id"],
                        "metadata_": values["metadata_"],
                        "is_active": values["is_active"],
                        "is_available": values["is_available"],
                    }
                )
            )
            await db.execute(stmt)

            if is_update:
                rows_updated += 1
            else:
                rows_inserted += 1

            await db.execute(text("RELEASE SAVEPOINT sp_bulk_product"))

        except Exception as e:
            await db.execute(text("ROLLBACK TO SAVEPOINT sp_bulk_product"))
            rows_failed += 1
            errors.append(BulkImportError(
                index=idx,
                sku=item.sku,
                error=str(e),
                code="DATABASE_ERROR",
            ))

    await db.commit()

    if rows_inserted > 0 or rows_updated > 0:
        await cache.cache_delete_pattern("products:*")
        await cache.cache_delete_pattern("search:*")

    status_str = "completed"
    if rows_failed > 0:
        status_str = "completed_with_errors" if (rows_inserted > 0 or rows_updated > 0) else "failed"

    return BulkImportResponse(
        status=status_str,
        rows_inserted=rows_inserted,
        rows_updated=rows_updated,
        rows_failed=rows_failed,
        errors=errors,
    )


@router.get("/stats", response_model=CatalogStats, summary="Get catalog statistics")
@limiter.limit(rate_limit_from_request)
async def get_catalog_stats(
    request: Request,
    db: AsyncSession = Depends(get_db),
    api_key: ApiKey = Depends(get_current_api_key),
) -> CatalogStats:
    request.state.api_key = api_key

    cache_key = "products:stats"
    cached = await cache.cache_get(cache_key)
    if cached:
        return CatalogStats(**cached)

    total_result = await db.execute(
        select(func.count(Product.id)).where(Product.is_active == True)
    )
    total = total_result.scalar_one()

    source_result = await db.execute(
        select(Product.source, func.count(Product.id))
        .where(Product.is_active == True)
        .group_by(Product.source)
    )
    by_source = {row[0]: row[1] for row in source_result.fetchall()}

    category_result = await db.execute(
        select(Product.category, func.count(Product.id))
        .where(Product.is_active == True)
        .group_by(Product.category)
        .order_by(func.count(Product.id).desc())
        .limit(100)
    )
    by_category = {str(row[0]) or "Unknown": row[1] for row in category_result.fetchall()}

    price_result = await db.execute(
        select(
            func.avg(Product.price_sgd),
            func.min(Product.price_sgd),
            func.max(Product.price_sgd),
        ).where(Product.is_active == True, Product.price_sgd.isnot(None))
    )
    price_row = price_result.fetchone()
    avg_price = float(price_row[0]) if price_row and price_row[0] is not None else None
    min_price = float(price_row[1]) if price_row and price_row[1] is not None else None
    max_price = float(price_row[2]) if price_row and price_row[2] is not None else None

    response = CatalogStats(
        total_products=total,
        by_source=by_source,
        by_category=by_category,
        avg_price=avg_price,
        min_price=min_price,
        max_price=max_price,
    )

    await cache.cache_set(cache_key, response.model_dump(mode="json"), ttl_seconds=300)
    return response


@router.post(
    "/{product_id}/questions",
    response_model=QuestionResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Submit a product question",
)
@limiter.limit(rate_limit_from_request)
async def create_question(
    request: Request,
    product_id: int,
    body: QuestionCreateRequest,
    db: AsyncSession = Depends(get_db),
    api_key: ApiKey = Depends(get_current_api_key),
) -> QuestionResponse:
    request.state.api_key = api_key

    product_result = await db.execute(
        select(Product).where(Product.id == product_id, Product.is_active == True)
    )
    product = product_result.scalar_one_or_none()
    if not product:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Product not found: {product_id}")

    author_id = body.author_id or api_key.developer_id
    author_type = "developer"

    question = ProductQuestion(
        product_id=product_id,
        author_id=author_id,
        author_type=author_type,
        question=body.question,
        answer_count=0,
    )
    db.add(question)
    await db.flush()

    return QuestionResponse(
        id=question.id,
        product_id=question.product_id,
        author_id=question.author_id,
        author_type=question.author_type,
        question=question.question,
        answer_count=question.answer_count,
        created_at=question.created_at,
        updated_at=question.updated_at,
    )


@router.get(
    "/{product_id}/questions",
    response_model=QuestionListResponse,
    summary="List product questions",
)
@limiter.limit(rate_limit_from_request)
async def list_questions(
    request: Request,
    product_id: int,
    page: int = Query(1, ge=1, description="Page number"),
    page_size: int = Query(20, ge=1, le=100, description="Items per page"),
    db: AsyncSession = Depends(get_db),
    api_key: ApiKey = Depends(get_current_api_key),
) -> QuestionListResponse:
    request.state.api_key = api_key

    product_result = await db.execute(
        select(Product).where(Product.id == product_id, Product.is_active == True)
    )
    product = product_result.scalar_one_or_none()
    if not product:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Product not found: {product_id}")

    count_result = await db.execute(
        select(func.count(ProductQuestion.id)).where(ProductQuestion.product_id == product_id)
    )
    total = count_result.scalar_one()

    offset = (page - 1) * page_size
    questions_result = await db.execute(
        select(ProductQuestion)
        .where(ProductQuestion.product_id == product_id)
        .order_by(ProductQuestion.created_at.desc())
        .offset(offset)
        .limit(page_size)
    )
    questions = questions_result.scalars().all()

    return QuestionListResponse(
        questions=[
            QuestionResponse(
                id=q.id,
                product_id=q.product_id,
                author_id=q.author_id,
                author_type=q.author_type,
                question=q.question,
                answer_count=q.answer_count,
                created_at=q.created_at,
                updated_at=q.updated_at,
            )
            for q in questions
        ],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.get(
    "/{product_id}/questions/{question_id}",
    response_model=QuestionDetailResponse,
    summary="Get question with answers",
)
@limiter.limit(rate_limit_from_request)
async def get_question(
    request: Request,
    product_id: int,
    question_id: int,
    db: AsyncSession = Depends(get_db),
    api_key: ApiKey = Depends(get_current_api_key),
) -> QuestionDetailResponse:
    request.state.api_key = api_key

    question_result = await db.execute(
        select(ProductQuestion).where(
            ProductQuestion.id == question_id,
            ProductQuestion.product_id == product_id,
        )
    )
    question = question_result.scalar_one_or_none()
    if not question:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Question not found: {question_id}")

    answers_result = await db.execute(
        select(ProductAnswer)
        .where(ProductAnswer.question_id == question_id)
        .order_by(ProductAnswer.is_accepted.desc(), ProductAnswer.helpfulness_votes.desc(), ProductAnswer.created_at.asc())
    )
    answers = answers_result.scalars().all()

    return QuestionDetailResponse(
        id=question.id,
        product_id=question.product_id,
        author_id=question.author_id,
        author_type=question.author_type,
        question=question.question,
        answer_count=question.answer_count,
        answers=[
            AnswerResponse(
                id=a.id,
                question_id=a.question_id,
                product_id=a.product_id,
                author_id=a.author_id,
                author_type=a.author_type,
                answer=a.answer,
                is_accepted=a.is_accepted,
                helpfulness_votes=a.helpfulness_votes,
                created_at=a.created_at,
                updated_at=a.updated_at,
            )
            for a in answers
        ],
        created_at=question.created_at,
        updated_at=question.updated_at,
    )


@router.post(
    "/{product_id}/questions/{question_id}/answers",
    response_model=AnswerResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Submit an answer to a question",
)
@limiter.limit(rate_limit_from_request)
async def create_answer(
    request: Request,
    product_id: int,
    question_id: int,
    body: AnswerCreateRequest,
    db: AsyncSession = Depends(get_db),
    api_key: ApiKey = Depends(get_current_api_key),
) -> AnswerResponse:
    request.state.api_key = api_key

    question_result = await db.execute(
        select(ProductQuestion).where(
            ProductQuestion.id == question_id,
            ProductQuestion.product_id == product_id,
        )
    )
    question = question_result.scalar_one_or_none()
    if not question:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Question not found: {question_id}")

    author_id = body.author_id or api_key.developer_id
    author_type = "developer"

    answer = ProductAnswer(
        question_id=question_id,
        product_id=product_id,
        author_id=author_id,
        author_type=author_type,
        answer=body.answer,
        is_accepted=False,
        helpfulness_votes=0,
    )
    db.add(answer)

    question.answer_count = question.answer_count + 1
    await db.flush()

    return AnswerResponse(
        id=answer.id,
        question_id=answer.question_id,
        product_id=answer.product_id,
        author_id=answer.author_id,
        author_type=answer.author_type,
        answer=answer.answer,
        is_accepted=answer.is_accepted,
        helpfulness_votes=answer.helpfulness_votes,
        created_at=answer.created_at,
        updated_at=answer.updated_at,
    )
