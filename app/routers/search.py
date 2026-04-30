import asyncio
import time
from decimal import Decimal
from typing import Optional, List, Tuple
from urllib.parse import urlparse

import httpx
import imagehash
from PIL import Image
from io import BytesIO
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import StringConstraints, BaseModel, Field
from sqlalchemy import and_, case, func, or_, select, text
import typing
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_api_key
from app.database import get_db, AsyncSessionLocal
from app.models.product import ApiKey, Product, ImageHash
from app.models.search_history import SearchHistory
from app.models.search_query import SearchQuery
from app.rate_limit import limiter, rate_limit_from_request
from app.schemas.product import ProductListResponse, ProductResponse, SearchSuggestionResponse, SearchSuggestion, AutocompleteResponse, AutocompleteSuggestion, FacetBucket, PriceFacetBucket, RatingFacetBucket, SearchFiltersResponse, FacetCounts
from app.schemas.search_history import SearchHistoryListResponse, SearchHistoryEntry
from app.affiliate_links import get_affiliate_url
from app.services.currency import SUPPORTED_CURRENCIES, convert_price, get_rate_for_header
from app import cache
from app.routers.search_i18n import translate_query
from app.services.semantic_search import semantic_search_service
from app.logging_centralized import get_logger

SUPPORTED_SEARCH_LANGS = ("ms", "th", "vi", "id", "en")

logger = get_logger("search-service")

router = APIRouter(prefix="/search", tags=["search"])


def _normalize_scalar(value: Optional[str]) -> Optional[str]:
    """Normalize a scalar value: strip whitespace and handle None."""
    if value is None:
        return None
    if isinstance(value, str):
        return value.strip()
    return str(value).strip() if value else None


async def _log_search_query_async(query: str, region: str, result_count: int, response_ms: int) -> None:
    try:
        async with AsyncSessionLocal() as session:
            search_query = SearchQuery(
                query=query,
                region=region,
                result_count=result_count,
                response_ms=response_ms,
            )
            session.add(search_query)
            await session.commit()
    except Exception as e:
        logger.warning(f"Failed to log search query: {e}")

SOURCE_TO_COUNTRY = {
    "shopee_sg": "SG",
    "lazada_sg": "SG",
    "carousell_sg": "SG",
    "qoo10_sg": "SG",
    "shopee_my": "MY",
    "lazada_my": "MY",
    "shopee_ph": "PH",
    "lazada_ph": "PH",
    "shopee_th": "TH",
    "lazada_th": "TH",
    "shopee_vn": "VN",
    "lazada_vn": "VN",
    "amazon_us": "US",
    "amazon_us_sports": "US",
    "amazon_us_books": "US",
    "amazon_us_toys": "US",
    "amazon_us_health": "US",
    "amazon_us_home_kitchen": "US",
    "chewy_us": "US",
    "chewy_us_sitemap": "US",
    "chewy_us_playwright": "US",
    "chewy_us_undetected": "US",
    "costco_us": "US",
    "costco_us_sitemap": "US",
    "costco_us_v2": "US",
    "costco_us_playwright": "US",
    "homedepot_us": "US",
    "homedepot_us_sitemap": "US",
    "homedepot_us_playwright": "US",
    "homedepot_us_undetected": "US",
    "homedepot_us_tools": "US",
    "target_us": "US",
    "target_us_sitemap": "US",
    "target_us_playwright": "US",
    "target_us_playwright_v2": "US",
    "target_us_scraperapi": "US",
    "walmart_us": "US",
    "walmart_us_apparel": "US",
    "walmart_us_grocery": "US",
    "bestbuy_us": "US",
    "bestbuy_us_api": "US",
    "bestbuy_us_sitemap": "US",
    "bestbuy_us_playwright": "US",
    "nordstrom_us": "US",
    "nordstrom_us_premium": "US",
    "nordstrom_us_scraperapi": "US",
    "macys_us": "US",
    "macys_us_scraperapi": "US",
    "sephora_us_scraperapi": "US",
    "lowes_us": "US",
    "kroger_us": "US",
    "kroger_us_playwright": "US",
    "cvs_us": "US",
    "cvs_us_playwright": "US",
    "cvs_us_undetected": "US",
    "walgreens_us": "US",
    "kohls_us": "US",
    "adidas_us": "US",
    "etsy_us": "US",
    "bhphoto_us": "US",
    "bhphoto_us_playwright": "US",
    "zappos_us": "US",
    "zappos_us_sitemap": "US",
    "wayfair_us": "US",
    "wayfair_us_sitemap": "US",
    "newegg_us": "US",
    "ikea_us": "US",
    "ikea_us_playwright": "US",
    "ulta_us": "US",
    "ulta_us_sitemap": "US",
    "ulta_us_undetected": "US",
    "ulta_us_sitemap_fixed": "US",
    "ebay_us_finding_api": "US",
    "ebay_us_playwright": "US",
    "iherb_global": "US",
}

COUNTRY_NAMES = {
    "SG": "Singapore",
    "MY": "Malaysia",
    "PH": "Philippines",
    "TH": "Thailand",
    "VN": "Vietnam",
    "US": "United States",
}

REGION_NAMES = {
    "SG": "Singapore",
    "US": "United States",
    "VN": "Vietnam",
    "TH": "Thailand",
    "MY": "Malaysia",
}

BENCHMARK_QUERIES = [
    "nike shoes",
    "iphone 15 case",
    "samsung tv 55 inch",
    "adidas shorts",
    "wireless earbuds",
    "laptop stand",
    "coffee maker",
    "running shoes men",
    "bluetooth speaker",
    "desk lamp",
]

US_RETAILER_SOURCE_PREFIXES = {
    "amazon": ("amazon_us",),
    "walmart": ("walmart_us",),
    "target": ("target_us",),
    "best_buy": ("bestbuy_us",),
    "bestbuy": ("bestbuy_us",),
}

US_RETAILER_LABELS = {
    "amazon": "Amazon",
    "walmart": "Walmart",
    "target": "Target",
    "best_buy": "Best Buy",
    "bestbuy": "Best Buy",
}

USD_PRICE_RANGES = [
    ("under_25", "Under $25", Decimal("0"), Decimal("25")),
    ("25_50", "$25-$50", Decimal("25"), Decimal("50")),
    ("50_100", "$50-$100", Decimal("50"), Decimal("100")),
    ("100_250", "$100-$250", Decimal("100"), Decimal("250")),
    ("250_plus", "$250+", Decimal("250"), None),
]


def _csv_tokens(value: Optional[str]) -> List[str]:
    if not value:
        return []
    return [token.strip() for token in value.split(",") if token.strip()]


def _normalize_retailer_token(value: str) -> str:
    return value.strip().lower().replace("-", "_").replace(" ", "_")


def _retailer_conditions(retailer: Optional[str]):
    conditions = []
    for token in _csv_tokens(retailer):
        normalized = _normalize_retailer_token(token)
        prefixes = US_RETAILER_SOURCE_PREFIXES.get(normalized)
        if not prefixes:
            continue
        for prefix in prefixes:
            conditions.append(or_(Product.source == prefix, Product.source.like(f"{prefix}_%")))
    return conditions


def _apply_retailer_filter(query, retailer: Optional[str]):
    conditions = _retailer_conditions(retailer)
    if conditions:
        return query.where(or_(*conditions))
    return query


def _price_range_conditions(price_range: Optional[str]):
    conditions = []
    labels = {key: (mn, mx) for key, _label, mn, mx in USD_PRICE_RANGES}
    label_aliases = {
        "under_$25": "under_25",
        "$25_$50": "25_50",
        "$50_$100": "50_100",
        "$100_$250": "100_250",
        "$250+": "250_plus",
    }
    for token in _csv_tokens(price_range):
        normalized = token.strip().lower().replace("-", "_").replace(" ", "_")
        normalized = label_aliases.get(normalized, normalized)
        bounds = labels.get(normalized)
        if not bounds:
            continue
        mn, mx = bounds
        if mx is None:
            conditions.append(Product.price >= mn)
        else:
            conditions.append(and_(Product.price >= mn, Product.price < mx))
    return conditions


def _apply_price_range_filter(query, price_range: Optional[str]):
    conditions = _price_range_conditions(price_range)
    if conditions:
        return query.where(Product.currency == "USD").where(or_(*conditions))
    return query


def _retailer_case(source_column):
    return case(
        (source_column.like("amazon_us%"), "Amazon"),
        (source_column.like("walmart_us%"), "Walmart"),
        (source_column.like("target_us%"), "Target"),
        (source_column.like("bestbuy_us%"), "Best Buy"),
        else_=None,
    )


def _us_price_bins_enabled(region: Optional[str], country: Optional[str], currency: Optional[str]) -> bool:
    if currency == "USD":
        return True
    if country and "US" in [c.strip().upper() for c in country.split(",")]:
        return True
    if region and "US" in [r.strip().upper() for r in region.split(",")]:
        return True
    return False


def _map_product(p: Product, target_currency: Optional[str] = None, confidence_score: Optional[float] = None) -> ProductResponse:
    price = float(p.price) if p.price is not None else 0.0
    currency = str(p.currency) if p.currency is not None else "SGD"
    converted_price = None
    converted_currency = None
    if target_currency and target_currency != currency:
        converted = convert_price(Decimal(str(price)), currency, target_currency)
        if converted is not None:
            price = float(converted)
            currency = target_currency
            converted_price = Decimal(str(converted))
            converted_currency = target_currency
    return ProductResponse(
        id=int(p.id) if p.id is not None else 0,
        sku=str(p.sku) if p.sku is not None else "",
        source=str(p.source) if p.source is not None else "",
        merchant_id=str(p.merchant_id) if p.merchant_id is not None else "",
        name=str(p.title) if p.title is not None else "",
        description=str(p.description) if p.description is not None else None,
        price=Decimal(str(price)),
        currency=currency,
        price_sgd=Decimal(str(p.price_sgd)) if p.price_sgd is not None else None,
        converted_price=converted_price,
        converted_currency=converted_currency,
        buy_url=str(p.url) if p.url is not None else "",
        affiliate_url=get_affiliate_url(str(p.source) if p.source else "", str(p.url) if p.url else "", int(p.id) if p.id else 0) if p.url else None,
        image_url=str(p.image_url) if p.image_url is not None else None,
        barcode=str(p.barcode) if p.barcode is not None else None,
        brand=str(p.brand) if p.brand is not None else None,
        category=str(p.category) if p.category is not None else None,
        category_path=list(p.category_path) if p.category_path is not None else None,
        rating=Decimal(str(p.rating)) if p.rating is not None else None,
        review_count=int(p.review_count) if p.review_count is not None else None,
        avg_rating=Decimal(str(p.avg_rating)) if p.avg_rating is not None else None,
        rating_source=str(p.rating_source) if p.rating_source is not None else None,
        is_available=bool(p.is_active) if p.is_active is not None else False,
        in_stock=bool(p.in_stock) if p.in_stock is not None else None,
        stock_level=str(p.stock_level) if p.stock_level is not None else None,
        last_checked=p.last_checked,
        data_updated_at=p.data_updated_at,
        availability_prediction=None,  # Would need to be computed from historical stock patterns
        competitor_count=None,  # Would need to be computed by counting matching products across sources
        metadata=p.metadata_,
        updated_at=p.updated_at,
        price_trend=None,  # Would need to be computed from price history
        confidence_score=confidence_score,
    )


@router.get("", response_model=ProductListResponse, summary="Search products")
@limiter.limit(rate_limit_from_request)
async def search_products(
    request: Request,
    q: Optional[str] = Query(None, max_length=500, description="Full-text search query (max 500 chars)"),
    lang: Optional[str] = Query(None, description="Query language for translation: ms (Malay), th (Thai), vi (Vietnamese), id (Indonesian). Translated to English for matching."),
    category: Optional[str] = Query(None, max_length=200, description="Filter by category"),
    min_price: Optional[Decimal] = Query(None, ge=0, description="Minimum price filter"),
    max_price: Optional[Decimal] = Query(None, ge=0, description="Maximum price filter"),
    price_min: Optional[Decimal] = Query(None, ge=0, description="Minimum price filter (alias for min_price)"),
    price_max: Optional[Decimal] = Query(None, ge=0, description="Maximum price filter (alias for max_price)"),
    platform: Optional[str] = Query(None, max_length=100, description="Filter by platform (source)"),
    source: Optional[str] = Query(None, max_length=100, description="Filter by source/platform (alias for platform)"),
    retailer: Optional[str] = Query(None, max_length=200, description="US retailer facet filter: amazon,walmart,target,best_buy"),
    price_range: Optional[str] = Query(None, max_length=100, description="USD price range filter: under_25,25_50,50_100,100_250,250_plus"),
    region: Optional[str] = Query(None, description="Filter by region code(s), comma-separated (e.g., US,SG)"),
    country: Optional[str] = Query(None, description="Filter by country code(s), comma-separated (e.g., SG,MY)"),
    in_stock: Optional[bool] = Query(None, description="Filter by availability"),
    currency: Optional[str] = Query(None, description=f"Target currency for price conversion. Supported: {', '.join(SUPPORTED_CURRENCIES)}"),
    limit: int = Query(20, ge=1, le=100, description="Results per page (1-100)"),
    offset: int = Query(0, ge=0, le=10000, description="Pagination offset (0-10000)"),
    include_facets: bool = Query(False, description="Include facet counts in response"),
    db: AsyncSession = Depends(get_db),
    api_key: ApiKey = Depends(get_current_api_key),
) -> ProductListResponse:
    request.state.api_key = api_key

    if price_min is not None:
        min_price = price_min
    if price_max is not None:
        max_price = price_max
    if source is not None:
        platform = source

    if q and len(q) > 500:
        suggested_query = q[:500]
        raise HTTPException(
            status_code=422,
            detail={
                "code": "QUERY_TOO_LONG",
                "field": "q",
                "message": f"Query exceeds maximum length of 500 characters (got {len(q)})",
                "max_length": 500,
                "actual_length": len(q),
                "suggested_query": suggested_query,
            }
        )

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

    if currency is not None and currency not in SUPPORTED_CURRENCIES:
        raise HTTPException(
            status_code=422,
            detail={
                "code": "UNSUPPORTED_CURRENCY",
                "field": "currency",
                "message": f"Unsupported currency: {currency}. Supported: {', '.join(SUPPORTED_CURRENCIES)}",
                "provided": currency,
                "supported": list(SUPPORTED_CURRENCIES),
            }
        )

    if lang is not None and lang.lower() not in SUPPORTED_SEARCH_LANGS:
        raise HTTPException(
            status_code=422,
            detail={
                "code": "UNSUPPORTED_LANGUAGE",
                "field": "lang",
                "message": f"Unsupported lang: {lang}. Supported: {', '.join(SUPPORTED_SEARCH_LANGS)}",
                "provided": lang,
                "supported": list(SUPPORTED_SEARCH_LANGS),
            }
        )

    if lang and q:
        q = translate_query(q, lang)

    if country is not None:
        country_codes = [c.strip().upper() for c in country.split(",")]
        invalid = [c for c in country_codes if c not in COUNTRY_NAMES]
        if invalid:
            raise HTTPException(status_code=422, detail=f"Invalid country code(s): {', '.join(invalid)}. Supported: {', '.join(COUNTRY_NAMES.keys())}")

    if region is not None:
        region_codes = [r.strip().upper() for r in region.split(",")]
        invalid = [r for r in region_codes if r not in REGION_NAMES]
        if invalid:
            raise HTTPException(status_code=422, detail=f"Invalid region code(s): {', '.join(invalid)}. Supported: {', '.join(REGION_NAMES.keys())}")
    else:
        region = "US"

    default_currency = "SGD"
    cache_key = cache.build_cache_key(
        "search:query",
        q=q,
        lang=lang,
        category=category,
        min_price=str(min_price) if min_price is not None else None,
        max_price=str(max_price) if max_price is not None else None,
        platform=platform,
        retailer=retailer,
        price_range=price_range,
        region=region,
        country=country,
        in_stock=str(in_stock) if in_stock is not None else None,
        currency=currency,
        limit=limit,
        offset=offset,
    )

    cached = await cache.cache_get(cache_key)
    if cached:
        response = ProductListResponse.model_construct(**cached)
        if currency and currency != default_currency:
            rate_header = get_rate_for_header(default_currency, currency)
            if rate_header:
                request.state.response_headers = {"X-Currency-Rate": f"{default_currency}->{currency}:{rate_header}"}
        return response

    start_time = time.perf_counter()

    base_query = select(Product).where(Product.is_active == True)

    if q:
        base_query = base_query.where(
            text("search_vector @@ websearch_to_tsquery('english', :q)").bindparams(q=q)
        )
        base_query = base_query.order_by(
            text(
                """
                (
                    ts_rank_cd(search_vector, websearch_to_tsquery('english', :q_rank), 32) * 2.0
                    + ts_rank_cd(title_search_vector, websearch_to_tsquery('english', :q_rank), 32) * 3.0
                    + CASE WHEN lower(title) = lower(:q_exact) THEN 2.0 ELSE 0 END
                    + CASE WHEN lower(title) LIKE lower(:q_prefix) THEN 1.0 ELSE 0 END
                    + CASE WHEN brand IS NOT NULL AND lower(brand) = lower(:q_exact) THEN 0.75 ELSE 0 END
                    + CASE WHEN source ~ '^(amazon_us|walmart_us|target_us|bestbuy_us)' THEN 0.25 ELSE 0 END
                ) DESC
                """
            ).bindparams(q_rank=q, q_exact=q, q_prefix=f"{q}%"),
            Product.updated_at.desc()
        )
    else:
        base_query = base_query.order_by(Product.updated_at.desc())

    if category:
        base_query = base_query.where(Product.category.ilike(f"%{category}%"))
    if min_price is not None:
        base_query = base_query.where(Product.price >= min_price)
    if max_price is not None:
        base_query = base_query.where(Product.price <= max_price)
    if platform is not None:
        base_query = base_query.where(Product.source == platform)
    base_query = _apply_retailer_filter(base_query, retailer)
    base_query = _apply_price_range_filter(base_query, price_range)
    if in_stock is not None:
        base_query = base_query.where(Product.in_stock == in_stock)
    if country is not None:
        country_codes = [c.strip().upper() for c in country.split(",")]
        invalid = [c for c in country_codes if c not in COUNTRY_NAMES]
        if invalid:
            raise HTTPException(status_code=422, detail=f"Invalid country code(s): {', '.join(invalid)}. Supported: {', '.join(COUNTRY_NAMES.keys())}")
        base_query = base_query.where(Product.country_code.in_(country_codes))
    if region is not None:
        region_codes = [r.strip().lower() for r in region.split(",")]
        invalid = [r for r in region_codes if r not in REGION_NAMES]
        if invalid:
            raise HTTPException(status_code=422, detail=f"Invalid region code(s): {', '.join(invalid)}. Supported: {', '.join(REGION_NAMES.keys())}")
        base_query = base_query.where(Product.region.in_(region_codes))

    if offset == 0:
        count_query = select(func.count()).select_from(base_query.subquery())
        total_result = await db.execute(count_query)
        total = total_result.scalar_one()
    else:
        total = None

    results = await db.execute(base_query.limit(limit).offset(offset))
    if q:
        products = results.scalars().all()
        confidences = [None] * len(products)
    else:
        products = results.scalars().all()
        confidences = [None] * len(products)

    elapsed_ms = (time.perf_counter() - start_time) * 1000

    if q:
        log_data = {
            "query": q,
            "category": category,
            "platform": platform,
            "elapsed_ms": round(elapsed_ms, 2),
            "results_count": total,
        }
        if elapsed_ms > 500:
            logger.warning("Search query executed (slow)", extra=log_data)
        else:
            logger.info("Search query executed", extra=log_data)

    target_currency = currency if currency else default_currency
    items = [_map_product(p, target_currency, confidence) for p, confidence in zip(products, confidences)]
    has_more = len(items) == limit if total is None else (offset + limit) < total
    effective_total = total if total is not None else offset + len(items)

    facets = None
    if include_facets and offset == 0:
        facet_base_query = select(Product).where(Product.is_active == True)
        if q:
            facet_base_query = facet_base_query.where(
                text("search_vector @@ websearch_to_tsquery('english', :fq)").bindparams(fq=q)
            )
        if category:
            facet_base_query = facet_base_query.where(Product.category.ilike(f"%{category}%"))
        if min_price is not None:
            facet_base_query = facet_base_query.where(Product.price >= min_price)
        if max_price is not None:
            facet_base_query = facet_base_query.where(Product.price <= max_price)
        if platform is not None:
            facet_base_query = facet_base_query.where(Product.source == platform)
        facet_base_query = _apply_retailer_filter(facet_base_query, retailer)
        facet_base_query = _apply_price_range_filter(facet_base_query, price_range)
        if in_stock is not None:
            facet_base_query = facet_base_query.where(Product.in_stock == in_stock)
        if country is not None:
            country_codes = [c.strip().upper() for c in country.split(",")]
            invalid = [c for c in country_codes if c not in COUNTRY_NAMES]
            if invalid:
                raise HTTPException(status_code=422, detail=f"Invalid country code(s): {', '.join(invalid)}. Supported: {', '.join(COUNTRY_NAMES.keys())}")
            facet_base_query = facet_base_query.where(Product.country_code.in_(country_codes))
        if region is not None:
            region_codes = [r.strip().lower() for r in region.split(",")]
            facet_base_query = facet_base_query.where(Product.region.in_(region_codes))

        facet_products = facet_base_query.subquery()
        f = facet_products.c

        category_facet = select(f.category, func.count(f.id)).select_from(
            facet_products
        ).group_by(f.category).order_by(func.count(f.id).desc()).limit(10)
        cat_result = await db.execute(category_facet)
        category_buckets = [FacetBucket(value=str(row[0]) or "Unknown", count=row[1]) for row in cat_result.fetchall()]

        platform_facet = select(f.source, func.count(f.id)).select_from(
            facet_products
        ).group_by(f.source).order_by(func.count(f.id).desc()).limit(10)
        plat_result = await db.execute(platform_facet)
        platform_buckets = [FacetBucket(value=row[0], count=row[1]) for row in plat_result.fetchall()]

        retailer_label = _retailer_case(f.source).label("retailer")
        retailer_facet = select(retailer_label, func.count(f.id)).select_from(
            facet_products
        ).where(retailer_label.isnot(None)).group_by(retailer_label).order_by(func.count(f.id).desc()).limit(10)
        retailer_result = await db.execute(retailer_facet)
        retailer_buckets = [FacetBucket(value=row[0], count=row[1]) for row in retailer_result.fetchall()]

        brand_facet = select(f.brand, func.count(f.id)).select_from(
            facet_products
        ).where(f.brand.isnot(None)).group_by(f.brand).order_by(func.count(f.id).desc()).limit(10)
        brand_result = await db.execute(brand_facet)
        brand_buckets = [FacetBucket(value=str(row[0]) or "Unknown", count=row[1]) for row in brand_result.fetchall()]

        rating_facet = select(
            func.floor(f.rating / 1) * 1,
            func.count(f.id)
        ).select_from(facet_products).where(
            f.rating.isnot(None)
        ).group_by(func.floor(f.rating / 1) * 1).order_by(func.floor(f.rating / 1).desc())
        rating_result = await db.execute(rating_facet)
        rating_ranges = []
        for row in rating_result.fetchall():
            rating_ranges.append(RatingFacetBucket(
                range=f"{float(row[0])}-{float(row[0]) + 1}",
                count=row[1]
            ))

        price_ranges = []
        use_us_bins = _us_price_bins_enabled(region, country, currency)
        price_bins = USD_PRICE_RANGES if use_us_bins else [
            ("0_10", "0-10", Decimal("0"), Decimal("10")),
            ("10_50", "10-50", Decimal("10"), Decimal("50")),
            ("50_100", "50-100", Decimal("50"), Decimal("100")),
            ("100_200", "100-200", Decimal("100"), Decimal("200")),
            ("200_500", "200-500", Decimal("200"), Decimal("500")),
            ("500_plus", "500+", Decimal("500"), None),
        ]
        price_bin_case = case(
            *[
                (
                    f.price >= mn if mx is None else and_(f.price >= mn, f.price < mx),
                    key,
                )
                for key, _label, mn, mx in price_bins
            ],
            else_="other",
        ).label("bin")
        price_combined_query = select(
            price_bin_case,
            func.count(f.id).label("count")
        ).select_from(facet_products).group_by(price_bin_case)
        price_result = await db.execute(price_combined_query)
        bin_counts = {row.bin: row.count for row in price_result.fetchall()}
        for key, label, _mn, _mx in price_bins:
            price_ranges.append(PriceFacetBucket(
                range=label,
                count=bin_counts.get(key, 0)
            ))

        facets = FacetCounts(
            categories=category_buckets,
            platforms=platform_buckets,
            retailers=retailer_buckets,
            brands=brand_buckets,
            rating_ranges=rating_ranges,
            price_ranges=price_ranges,
        )

    response_data = {
        "total": effective_total,
        "limit": limit,
        "offset": offset,
        "items": items,
        "has_more": has_more,
        "facets": facets,
    }

    await cache.cache_set(cache_key, response_data, ttl_seconds=cache.TTL_SEARCH)

    if target_currency != default_currency:
        rate_header = get_rate_for_header(default_currency, target_currency)
        if rate_header:
            request.state.response_headers = {"X-Currency-Rate": f"{default_currency}->{target_currency}:{rate_header}"}

    search_history_entry = SearchHistory(
        developer_id=api_key.developer_id,
        api_key_id=api_key.id,
        query=q,
        filters={
            "category": category,
            "min_price": str(min_price) if min_price is not None else None,
            "max_price": str(max_price) if max_price is not None else None,
            "platform": platform,
            "region": region,
            "country": country,
            "in_stock": in_stock,
        },
        result_count=effective_total,
    )
    db.add(search_history_entry)
    await db.flush()

    if q:
        asyncio.create_task(
            _log_search_query_async(q, region, effective_total, int(elapsed_ms))
        )

    return ProductListResponse.model_construct(**response_data)


@router.get("/semantic", response_model=ProductListResponse, summary="Semantic search products")
@limiter.limit(rate_limit_from_request)
async def semantic_search_products(
    request: Request,
    q: str = Query(..., min_length=1, description="Semantic search query"),
    category: Optional[str] = Query(None, description="Filter by category"),
    min_price: Optional[Decimal] = Query(None, ge=0),
    max_price: Optional[Decimal] = Query(None, ge=0),
    platform: Optional[str] = Query(None, description="Filter by platform (source)"),
    currency: Optional[str] = Query(
        None,
        description=f"Target currency for price conversion. Supported: {', '.join(SUPPORTED_CURRENCIES)}",
    ),
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0, le=10000),
    db: AsyncSession = Depends(get_db),
    api_key: ApiKey = Depends(get_current_api_key),
) -> ProductListResponse:
    request.state.api_key = api_key

    if min_price is not None and max_price is not None and min_price > max_price:
        raise HTTPException(status_code=422, detail="min_price cannot be greater than max_price")

    if currency is not None and currency not in SUPPORTED_CURRENCIES:
        raise HTTPException(
            status_code=422,
            detail=f"Unsupported currency: {currency}. Supported: {', '.join(SUPPORTED_CURRENCIES)}",
        )

    cache_key = cache.build_cache_key(
        "search:semantic",
        q=q,
        category=category,
        min_price=str(min_price) if min_price is not None else None,
        max_price=str(max_price) if max_price is not None else None,
        platform=platform,
        currency=currency,
        limit=limit,
        offset=offset,
    )
    cached = await cache.cache_get(cache_key)
    if cached:
        response = ProductListResponse(**cached)
        if currency and currency != "SGD":
            rate_header = get_rate_for_header("SGD", currency)
            if rate_header:
                request.state.response_headers = {
                    "X-Currency-Rate": f"SGD->{currency}:{rate_header}"
                }
        return response

    result = await semantic_search_service.search(
        db,
        q=q,
        category=category,
        min_price=min_price,
        max_price=max_price,
        platform=platform,
        limit=limit,
        offset=offset,
    )

    target_currency = currency or "SGD"
    response = ProductListResponse(
        total=result.total,
        limit=limit,
        offset=offset,
        items=[_map_product(product, target_currency) for product in result.products],
        has_more=(offset + limit) < result.total,
    )

    await cache.cache_set(cache_key, response.model_dump(mode="json"), ttl_seconds=600)

    if target_currency != "SGD":
        rate_header = get_rate_for_header("SGD", target_currency)
        if rate_header:
            request.state.response_headers = {
                "X-Currency-Rate": f"SGD->{target_currency}:{rate_header}"
            }

    if result.fallback_used:
        request.state.response_headers = {
            **getattr(request.state, "response_headers", {}),
            "X-Semantic-Search": "fallback",
        }
    else:
        request.state.response_headers = {
            **getattr(request.state, "response_headers", {}),
            "X-Semantic-Search": "embeddings",
        }

    return response


class USAutocompleteResponse(BaseModel):
    query: str
    titles: List[str]
    total: int


@router.get("/autocomplete", response_model=USAutocompleteResponse, summary="US product title autocomplete with FTS prefix queries")
@limiter.limit(rate_limit_from_request)
async def us_autocomplete(
    request: Request,
    q: str = Query(..., min_length=1, description="Search query prefix"),
    region: str = Query("us", description="Region code (only us supported for this endpoint)"),
    limit: int = Query(8, ge=1, le=20, description="Max titles to return"),
    db: AsyncSession = Depends(get_db),
    api_key: ApiKey = Depends(get_current_api_key),
) -> USAutocompleteResponse:
    request.state.api_key = api_key

    if region.lower() != "us":
        raise HTTPException(
            status_code=422,
            detail="Only 'us' region is supported for this endpoint",
        )

    cache_key = cache.build_cache_key(
        "search:us:autocomplete",
        q=q.lower(),
        limit=limit,
    )

    cached = await cache.cache_get(cache_key)
    if cached:
        return USAutocompleteResponse(**cached)

    start_time = time.perf_counter()

    prefix = q.lower().strip()
    fts_query = text("title_search_vector @@ to_tsquery('english', :prefix_q || ':*')").bindparams(prefix_q=prefix)

    title_query = (
        select(Product.title, func.count(Product.id).label("product_count"))
        .where(Product.is_active == True)
        .where(Product.currency == "USD")
        .where(fts_query)
        .group_by(Product.title)
        .order_by(func.count(Product.id).desc())
        .distinct()
        .limit(limit)
    )

    title_result = await db.execute(title_query)
    titles = [row[0] for row in title_result.fetchall() if row[0]]

    elapsed_ms = (time.perf_counter() - start_time) * 1000

    log_data = {
        "query": q,
        "region": region,
        "elapsed_ms": round(elapsed_ms, 2),
        "titles_count": len(titles),
    }
    if elapsed_ms > 500:
        logger.warning("US autocomplete query executed (slow)", extra=log_data)
    else:
        logger.info("US autocomplete query executed", extra=log_data)

    response = USAutocompleteResponse(
        query=q,
        titles=titles,
        total=len(titles),
    )

    await cache.cache_set(cache_key, response.model_dump(mode="json"), ttl_seconds=600)

    return response


@router.get("/suggest", response_model=AutocompleteResponse, summary="Search autocomplete with FTS prefix queries")
@limiter.limit(rate_limit_from_request)
async def search_suggestions(
    request: Request,
    q: str = Query(..., min_length=1, description="Search query prefix"),
    limit: int = Query(10, ge=1, le=20, description="Max suggestions to return"),
    country: Optional[str] = Query(None, description="Filter by country code(s), comma-separated (e.g., US,SG)"),
    db: AsyncSession = Depends(get_db),
    api_key: ApiKey = Depends(get_current_api_key),
) -> AutocompleteResponse:
    request.state.api_key = api_key

    if country is not None:
        country_codes = [c.strip().upper() for c in country.split(",")]
        invalid = [c for c in country_codes if c not in COUNTRY_NAMES]
        if invalid:
            raise HTTPException(status_code=422, detail=f"Invalid country code(s): {', '.join(invalid)}. Supported: {', '.join(COUNTRY_NAMES.keys())}")

    cache_key = cache.build_cache_key(
        "search:autocomplete",
        q=q.lower(),
        limit=limit,
        country=country,
    )

    cached = await cache.cache_get(cache_key)
    if cached:
        return AutocompleteResponse(**cached)

    start_time = time.perf_counter()

    prefix = q.lower()

    fts_query = text("title_search_vector @@ to_tsquery('english', :prefix_q || ':*')").bindparams(prefix_q=prefix)

    title_query = (
        select(Product.title, func.count(Product.id).label("product_count"))
        .where(Product.is_active == True)
        .where(fts_query)
    )

    if country is not None:
        country_codes = [c.strip().upper() for c in country.split(",")]
        source_countries = [(src, cc) for src, cc in SOURCE_TO_COUNTRY.items() if cc in country_codes]
        if source_countries:
            source_conditions = [Product.source == src for src, _ in source_countries]
            from sqlalchemy import or_
            title_query = title_query.where(or_(*source_conditions))

    title_query = title_query.group_by(Product.title).order_by(func.count(Product.id).desc()).limit(limit)

    title_result = await db.execute(title_query)
    suggestions = [
        AutocompleteSuggestion(suggestion=row[0], product_count=row[1])
        for row in title_result.fetchall()
    ]

    elapsed_ms = (time.perf_counter() - start_time) * 1000

    log_data = {
        "query": q,
        "elapsed_ms": round(elapsed_ms, 2),
        "suggestions_count": len(suggestions),
    }
    if elapsed_ms > 500:
        logger.warning("Autocomplete query executed (slow)", extra=log_data)
    else:
        logger.info("Autocomplete query executed", extra=log_data)

    response = AutocompleteResponse(
        query=prefix,
        suggestions=suggestions,
        total=len(suggestions),
    )

    await cache.cache_set(cache_key, response.model_dump(mode="json"), ttl_seconds=300)

    return response


@router.get("/benchmark", summary="Benchmark search performance")
@limiter.limit(rate_limit_from_request)
async def benchmark_search(
    request: Request,
    db: AsyncSession = Depends(get_db),
    api_key: ApiKey = Depends(get_current_api_key),
) -> dict:
    request.state.api_key = api_key

    results = []
    for q in BENCHMARK_QUERIES:
        start_time = time.perf_counter()

        base_query = (
            select(Product)
            .where(Product.is_active == True)
            .where(text("search_vector @@ websearch_to_tsquery('english', :q)").bindparams(q=q))
            .order_by(
                text(
                    "ts_rank_cd(search_vector, websearch_to_tsquery('english', :q_rank), 32) DESC"
                ).bindparams(q_rank=q)
            )
            .limit(20)
        )

        result = await db.execute(base_query)
        products = result.scalars().all()

        elapsed_ms = (time.perf_counter() - start_time) * 1000
        results.append({
            "query": q,
            "elapsed_ms": round(elapsed_ms, 2),
            "result_count": len(products),
        })

    avg_ms = sum(r["elapsed_ms"] for r in results) / len(results) if results else 0
    return {
        "benchmarks": results,
        "average_ms": round(avg_ms, 2),
        "total_queries": len(results),
    }


SIMILARITY_THRESHOLD = 0.85
MAX_IMAGE_SEARCH_RESULTS = 20


class ImageSearchRequest(BaseModel):
    image_url: str = Field(..., description="URL of the image to search with")
    min_similarity: float = Field(0.8, ge=0.0, le=1.0, description="Minimum similarity score (0-1)")
    limit: int = Field(20, ge=1, le=50, description="Maximum number of results")


class ImageSearchMatch(BaseModel):
    id: int
    sku: str
    source: str
    merchant_id: str
    name: str
    description: Optional[str] = None
    price: Decimal
    currency: str
    buy_url: str
    affiliate_url: Optional[str] = None
    image_url: Optional[str] = None
    brand: Optional[str] = None
    category: Optional[str] = None
    similarity_score: float
    model_config = {"from_attributes": True}


class ImageSearchResponse(BaseModel):
    query_image_url: str
    total_matches: int
    matches: List[ImageSearchMatch]


async def _fetch_image_and_hash(image_url: str, timeout: float = 5.0) -> Optional[str]:
    try:
        parsed = urlparse(image_url)
        if not parsed.scheme or not parsed.netloc:
            return None
    except Exception:
        return None

    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            response = await client.get(image_url)
            if response.status_code != 200:
                return None
            img = Image.open(BytesIO(response.content))
            img = img.convert("RGB")
            img = img.resize((256, 256))
            return str(imagehash.phash(img))
    except Exception:
        return None


def _compute_similarity(hash1: str, hash2: str) -> float:
    try:
        h1 = imagehash.hex_to_hash(hash1)
        h2 = imagehash.hex_to_hash(hash2)
        return 1 - (h1 - h2) / (len(hash1) * 4)
    except Exception:
        return 0.0


@router.post("/image", response_model=ImageSearchResponse, summary="Find products by image similarity")
@limiter.limit(rate_limit_from_request)
async def search_by_image(
    request: Request,
    body: ImageSearchRequest,
    db: AsyncSession = Depends(get_db),
    api_key: ApiKey = Depends(get_current_api_key),
) -> ImageSearchResponse:
    """Find products visually similar to the provided image.
    
    Uses perceptual hashing (pHash) to compare images. Returns products
    sorted by similarity score. Requires images to be indexed in the
    ImageHash table.
    
    Performance: Limits hash comparisons to prevent O(n) scaling with large image datasets.
    For production, consider approximate nearest neighbor (ANN) indexing.
    """
    request.state.api_key = api_key

    query_hash = await _fetch_image_and_hash(body.image_url)
    if not query_hash:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Could not fetch or hash the provided image URL"
        )

    MAX_IMAGE_HASHES_TO_COMPARE = 5000
    result = await db.execute(
        select(ImageHash)
        .where(ImageHash.hash.isnot(None))
        .order_by(ImageHash.created_at.desc())
        .limit(MAX_IMAGE_HASHES_TO_COMPARE)
    )
    all_hashes = result.scalars().all()

    similarities: List[Tuple[str, float]] = []
    for img_hash in all_hashes:
        sim = _compute_similarity(query_hash, img_hash.hash)
        if sim >= body.min_similarity:
            similarities.append((img_hash.original_url, sim))

    similarities.sort(key=lambda x: x[1], reverse=True)
    similarities = similarities[:body.limit]

    if not similarities:
        return ImageSearchResponse(
            query_image_url=body.image_url,
            total_matches=0,
            matches=[],
        )

    url_to_sim = {url: sim for url, sim in similarities}

    product_result = await db.execute(
        select(Product)
        .where(Product.is_active == True)
        .where(Product.image_url.in_(list(url_to_sim.keys())))
    )
    products = product_result.scalars().all()

    matches = []
    for product in products:
        sim = url_to_sim.get(product.image_url, 0.0)
        if sim >= body.min_similarity:
            matches.append(ImageSearchMatch(
                id=product.id,
                sku=product.sku,
                source=product.source,
                merchant_id=product.merchant_id,
                name=product.title,
                description=product.description,
                price=product.price,
                currency=product.currency,
                buy_url=product.url,
                affiliate_url=get_affiliate_url(product.source, product.url, product_id=product.id) if product.url else None,
                image_url=product.image_url,
                brand=product.brand,
                category=product.category,
                similarity_score=round(sim, 3),
            ))

    matches.sort(key=lambda x: x.similarity_score, reverse=True)

    return ImageSearchResponse(
        query_image_url=body.image_url,
        total_matches=len(matches),
        matches=matches,
    )


@router.get("/filters", response_model=SearchFiltersResponse, summary="Get available filter options with counts for building dynamic filter UIs")
@limiter.limit(rate_limit_from_request)
async def get_search_filters(
    request: Request,
    q: Optional[str] = Query(None, description="Optional search query to get filters scoped to results"),
    db: AsyncSession = Depends(get_db),
    api_key: ApiKey = Depends(get_current_api_key),
):
    request.state.api_key = api_key

    cache_key = cache.build_cache_key(
        "search:filters",
        q=q,
    )
    cached = await cache.cache_get(cache_key)
    if cached:
        return cached

    fts_filter = []
    if q:
        fts_filter.append(text("search_vector @@ websearch_to_tsquery('english', :q)").bindparams(q=q))

    async def execute_parallel(*queries):
        return await asyncio.gather(*queries, return_exceptions=True)

    cat_query = (
        select(Product.category, func.count(Product.id))
        .where(Product.is_active == True)
        .where(Product.category.isnot(None), Product.category != "")
        .group_by(Product.category)
        .order_by(func.count(Product.id).desc())
        .limit(50)
    )
    if fts_filter:
        cat_query = cat_query.where(*fts_filter)

    brand_query = (
        select(Product.brand, func.count(Product.id))
        .where(Product.is_active == True)
        .where(Product.brand.isnot(None), Product.brand != "")
        .group_by(Product.brand)
        .order_by(func.count(Product.id).desc())
        .limit(50)
    )
    if fts_filter:
        brand_query = brand_query.where(*fts_filter)

    platform_query = (
        select(Product.source, func.count(Product.id))
        .where(Product.is_active == True)
        .group_by(Product.source)
        .order_by(func.count(Product.id).desc())
    )
    if fts_filter:
        platform_query = platform_query.where(*fts_filter)

    price_min_max_query = select(
        func.min(Product.price),
        func.max(Product.price),
    ).where(Product.is_active == True)

    price_range_query = select(
        func.floor(Product.price / 10) * 10,
        func.count(Product.id)
    ).where(Product.is_active == True).group_by(
        func.floor(Product.price / 10) * 10
    ).order_by(func.floor(Product.price / 10))

    rating_range_query = select(
        (func.floor(Product.rating / 1) * 1).label("rating_floor"),
        func.count(Product.id)
    ).where(
        Product.is_active == True,
        Product.rating.isnot(None)
    ).group_by(
        func.floor(Product.rating / 1) * 1
    ).order_by(func.floor(Product.rating / 1).desc())

    country_query = select(
        Product.source, func.count(Product.id)
    ).where(Product.is_active == True).group_by(Product.source)

    results = await execute_parallel(
        db.execute(cat_query),
        db.execute(brand_query),
        db.execute(platform_query),
        db.execute(price_min_max_query),
        db.execute(price_range_query),
        db.execute(rating_range_query),
        db.execute(country_query),
    )

    def get_result(idx, default=None):
        result = results[idx]
        if isinstance(result, Exception):
            logger.warning(f"Query {idx} failed: {result}")
            return default
        return result

    cat_result = get_result(0)
    brand_result = get_result(1)
    platform_result = get_result(2)
    price_min_max_result = get_result(3)
    price_range_result = get_result(4)
    rating_result = get_result(5)
    country_result = get_result(6)

    categories = [FacetBucket(value=row[0], count=row[1]) for row in (cat_result.all() if cat_result else []) if row[0]]
    brands = [FacetBucket(value=row[0], count=row[1]) for row in (brand_result.all() if brand_result else []) if row[0]]
    platforms = [FacetBucket(value=row[0], count=row[1]) for row in (platform_result.all() if platform_result else [])]

    price_row = price_min_max_result.one() if price_min_max_result else (0, 1000)
    price_min = float(price_row[0] or 0)
    price_max = float(price_row[1] or 1000)

    price_ranges = []
    for row in (price_range_result.all() if price_range_result else []):
        min_p = float(row[0] or 0)
        count = row[1]
        if count > 0:
            price_ranges.append(PriceFacetBucket(
                range=f"{min_p}-{min_p + 10}",
                count=count,
            ))

    country_counts: dict[str, int] = {code: 0 for code in COUNTRY_NAMES}
    for source, count in (country_result.all() if country_result else []):
        country_code = SOURCE_TO_COUNTRY.get(source)
        if country_code:
            country_counts[country_code] = country_counts.get(country_code, 0) + count
    countries = [
        FacetBucket(value=code, count=count)
        for code, count in country_counts.items()
        if count > 0
    ]
    countries.sort(key=lambda x: x.count, reverse=True)

    rating_ranges = []
    for row in (rating_result.all() if rating_result else []):
        min_r = float(row[0] or 0)
        count = row[1]
        if count > 0:
            rating_ranges.append(RatingFacetBucket(
                range=f"{min_r}-{min_r + 1}",
                count=count,
            ))

    response = SearchFiltersResponse(
        categories=categories,
        brands=brands,
        platforms=platforms,
        countries=countries,
        price_ranges=price_ranges,
        rating_ranges=rating_ranges,
        price_min=Decimal(str(price_min)),
        price_max=Decimal(str(price_max)),
    )

    await cache.cache_set(cache_key, response.model_dump(mode="json"), ttl_seconds=300)
    return response


MAX_SEARCH_HISTORY = 100


@router.get("/history", response_model=SearchHistoryListResponse, summary="Get search history for the authenticated API key")
@limiter.limit("60/minute")
async def get_search_history(
    request: Request,
    limit: int = Query(20, ge=1, le=100, description="Results per page (1-100)"),
    offset: int = Query(0, ge=0, description="Pagination offset"),
    db: AsyncSession = Depends(get_db),
    api_key: ApiKey = Depends(get_current_api_key),
) -> SearchHistoryListResponse:
    request.state.api_key = api_key

    count_result = await db.execute(
        select(func.count(SearchHistory.id)).where(
            SearchHistory.developer_id == api_key.developer_id,
        )
    )
    total = count_result.scalar() or 0

    result = await db.execute(
        select(SearchHistory)
        .where(SearchHistory.developer_id == api_key.developer_id)
        .order_by(SearchHistory.created_at.desc())
        .limit(min(limit, MAX_SEARCH_HISTORY))
        .offset(offset)
    )
    searches = result.scalars().all()

    return SearchHistoryListResponse(
        searches=[SearchHistoryEntry.model_validate(s) for s in searches],
        total=total,
        limit=limit,
        offset=offset,
        has_more=(offset + len(searches)) < total,
    )
