import logging
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_api_key
from app.database import get_db
from app.models.product import ApiKey, Product, PriceHistory, Merchant, ProductView
from app.affiliate_links import get_affiliate_url
from app.currency import convert_price, SUPPORTED_CURRENCIES
from app import cache
from app.schemas.product import BatchProductRequest, V2BatchProductResponse

logger = logging.getLogger("buywhere_api")

router = APIRouter(prefix="/v2", tags=["v2"])


class V2ProductResponse(BaseModel):
    id: int
    sku: str
    source: str
    merchant_id: str
    name: str
    description: Optional[str] = None
    price: Decimal
    currency: str
    price_sgd: Optional[Decimal] = None
    buy_url: str
    affiliate_url: Optional[str] = None
    image_url: Optional[str] = None
    brand: Optional[str] = None
    category: Optional[str] = None
    category_path: Optional[List[str]] = None
    rating: Optional[Decimal] = None
    review_count: Optional[int] = None
    is_available: bool = True
    in_stock: Optional[bool] = None
    stock_level: Optional[str] = None
    last_checked: Optional[datetime] = None
    data_updated_at: Optional[datetime] = None
    metadata: Optional[dict] = None
    updated_at: datetime
    price_trend: Optional[str] = None
    # Agent-native enhancements
    confidence_score: Optional[float] = None
    availability_prediction: Optional[str] = None
    competitor_count: Optional[int] = None

    model_config = {"from_attributes": True}


class V2ProductListResponse(BaseModel):
    total: int
    limit: int
    offset: int
    items: List[V2ProductResponse]
    has_more: bool = False


def _map_v2_product(p: Product, target_currency: Optional[str] = None, confidence_score: Optional[float] = None) -> V2ProductResponse:
    price = p.price
    currency = p.currency or "SGD"
    price_sgd = p.price_sgd
    converted_price = None
    converted_currency = None
    
    if target_currency and target_currency != currency:
        converted_price = convert_price(price, currency, target_currency)
        if converted_price is not None:
            converted_currency = target_currency
    
    # Use provided confidence score or default to 1.0 for direct lookups
    final_confidence_score = confidence_score if confidence_score is not None else 1.0
    
    return V2ProductResponse(
        id=p.id,
        sku=p.sku,
        source=p.source,
        merchant_id=p.merchant_id,
        name=p.title,
        description=p.description,
        price=price,
        currency=currency,
        price_sgd=price_sgd,
        buy_url=p.url,
        affiliate_url=get_affiliate_url(p.source, p.url) if p.url else None,
        image_url=p.image_url,
        brand=p.brand,
        category=p.category,
        category_path=p.category_path,
        rating=p.rating,
        review_count=p.review_count,
        is_available=p.is_available,
        in_stock=p.in_stock,
        stock_level=p.stock_level,
        last_checked=p.last_checked,
        data_updated_at=p.data_updated_at,
        metadata=p.metadata_,
        updated_at=p.updated_at,
        # Agent-native enhancements
        confidence_score=final_confidence_score,
        availability_prediction=None,  # Would need historical data computation
        competitor_count=None,  # Would need cross-platform counting
    )


def _compute_price_trend(db: AsyncSession, product_id: int) -> Optional[str]:
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


@router.get("/products", response_model=V2ProductListResponse, summary="List and search products (v2 API)")
async def v2_list_products(
    request: Request,
    q: Optional[str] = Query(None, max_length=500, description="Full-text search query"),
    category: Optional[str] = Query(None, description="Filter by category"),
    brand: Optional[str] = Query(None, description="Filter by brand"),
    min_price: Optional[Decimal] = Query(None, ge=0, description="Minimum price"),
    max_price: Optional[Decimal] = Query(None, ge=0, description="Maximum price"),
    platform: Optional[str] = Query(None, description="Filter by platform (source)"),
    country: Optional[str] = Query(None, description="Filter by country code (SG, MY, etc.)"),
    in_stock: Optional[bool] = Query(None, description="Filter by availability"),
    sort_by: Optional[str] = Query(None, description="Sort: relevance, price_asc, price_desc, newest"),
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0, le=10000),
    currency: Optional[str] = Query(None, description=f"Target currency. Supported: {', '.join(SUPPORTED_CURRENCIES)}"),
    db: AsyncSession = Depends(get_db),
    api_key: ApiKey = Depends(get_current_api_key),
) -> V2ProductListResponse:
    if min_price is not None and max_price is not None and min_price > max_price:
        raise HTTPException(status_code=422, detail="min_price cannot be greater than max_price")
    
    if currency and currency not in SUPPORTED_CURRENCIES:
        raise HTTPException(status_code=422, detail=f"Unsupported currency: {currency}")
    
    cache_key = cache.build_cache_key(
        "v2:products:search",
        q=q,
        category=category,
        brand=brand,
        min_price=str(min_price) if min_price else None,
        max_price=str(max_price) if max_price else None,
        platform=platform,
        country=country,
        in_stock=in_stock,
        sort_by=sort_by,
        limit=limit,
        offset=offset,
        currency=currency,
    )
    
    cached = await cache.cache_get(cache_key)
    if cached:
        return V2ProductListResponse(**cached)
    
    base_query = select(Product).where(Product.is_active == True)
    
    if q:
        base_query = base_query.where(
            text("search_vector @@ plainto_tsquery('english', :q)").bindparams(q=q)
        ).order_by(
            text("ts_rank(search_vector, plainto_tsquery('english', :q_rank), 32) DESC").bindparams(q_rank=q),
            Product.updated_at.desc()
        )
    elif sort_by == "price_asc":
        base_query = base_query.order_by(Product.price.asc())
    elif sort_by == "price_desc":
        base_query = base_query.order_by(Product.price.desc())
    elif sort_by == "newest":
        base_query = base_query.order_by(Product.created_at.desc())
    else:
        base_query = base_query.order_by(Product.updated_at.desc())
    
    if category:
        base_query = base_query.where(Product.category.ilike(f"%{category}%"))
    if brand:
        base_query = base_query.where(Product.brand.ilike(f"%{brand}%"))
    if min_price is not None:
        base_query = base_query.where(Product.price >= min_price)
    if max_price is not None:
        base_query = base_query.where(Product.price <= max_price)
    if platform:
        base_query = base_query.where(Product.source == platform)
    if country:
        country_source_map = {
            "SG": ("shopee_sg", "lazada_sg", "carousell_sg", "qoo10_sg", "amazon_sg"),
            "MY": ("shopee_my", "lazada_my"),
            "PH": ("shopee_ph", "lazada_ph"),
            "TH": ("shopee_th", "lazada_th"),
            "VN": ("shopee_vn", "lazada_vn"),
        }
        sources = country_source_map.get(country.upper())
        if sources:
            base_query = base_query.where(Product.source.in_(sources))
    if in_stock is not None:
        base_query = base_query.where(Product.in_stock == in_stock)
    
    if offset == 0:
        count_query = select(func.count()).select_from(base_query.subquery())
        total_result = await db.execute(count_query)
        total = total_result.scalar_one()
    else:
        total = None
    
    results = await db.execute(base_query.limit(limit).offset(offset))
    products = results.scalars().all()
    
    items = [_map_v2_product(p, target_currency=currency) for p in products]
    effective_total = total if total is not None else offset + len(items)
    has_more = len(items) == limit if total is None else (offset + limit) < total
    
    response = V2ProductListResponse(
        total=effective_total,
        limit=limit,
        offset=offset,
        items=items,
        has_more=has_more,
    )
    
    await cache.cache_set(cache_key, response.model_dump(mode="json"), ttl_seconds=300)
    
    return response


@router.get("/products/{product_id}", summary="Get product by ID (v2 API)")
async def v2_get_product(
    request: Request,
    product_id: int,
    currency: Optional[str] = Query(None, description=f"Target currency for price conversion"),
    db: AsyncSession = Depends(get_db),
    api_key: ApiKey = Depends(get_current_api_key),
):
    if currency and currency not in SUPPORTED_CURRENCIES:
        raise HTTPException(status_code=422, detail=f"Unsupported currency: {currency}")
    
    cache_key = cache.build_cache_key("v2:product", product_id=product_id, currency=currency)
    cached = await cache.cache_get(cache_key)
    if cached:
        return cached
    
    result = await db.execute(
        select(Product).where(Product.id == product_id)
    )
    product = result.scalar_one_or_none()
    
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    
    price_trend = _compute_price_trend(db, product_id)
    response = _map_v2_product(product, target_currency=currency)
    response.price_trend = price_trend
    
    await cache.cache_set(cache_key, response.model_dump(mode="json"), ttl_seconds=600)
    
    return response


@router.get("/search", summary="Search products (v2 API)")
async def v2_search(
    request: Request,
    q: str = Query(..., max_length=500, description="Search query"),
    category: Optional[str] = Query(None),
    platform: Optional[str] = Query(None),
    min_price: Optional[Decimal] = Query(None, ge=0),
    max_price: Optional[Decimal] = Query(None, ge=0),
    in_stock: Optional[bool] = Query(None),
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0, le=10000),
    currency: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    api_key: ApiKey = Depends(get_current_api_key),
):
    if len(q) > 500:
        raise HTTPException(status_code=422, detail="Query too long (max 500 chars)")
    
    if min_price is not None and max_price is not None and min_price > max_price:
        raise HTTPException(status_code=422, detail="min_price cannot be greater than max_price")
    
    cache_key = cache.build_cache_key(
        "v2:search", q=q, category=category, platform=platform,
        min_price=str(min_price) if min_price else None,
        max_price=str(max_price) if max_price else None,
        in_stock=in_stock, limit=limit, offset=offset, currency=currency,
    )
    
    cached = await cache.cache_get(cache_key)
    if cached:
        return cached
    
    base_query = select(Product).where(
        Product.is_active == True,
        text("search_vector @@ plainto_tsquery('english', :q)").bindparams(q=q)
    ).add_columns(
        text("ts_rank(search_vector, plainto_tsquery('english', :q_rank), 32)").bindparams(q_rank=q).label("rank")
    ).order_by(
        text("ts_rank(search_vector, plainto_tsquery('english', :q_rank), 32) DESC").bindparams(q_rank=q),
        Product.updated_at.desc()
    )
    
    if category:
        base_query = base_query.where(Product.category.ilike(f"%{category}%"))
    if platform:
        base_query = base_query.where(Product.source == platform)
    if min_price is not None:
        base_query = base_query.where(Product.price >= min_price)
    if max_price is not None:
        base_query = base_query.where(Product.price <= max_price)
    if in_stock is not None:
        base_query = base_query.where(Product.in_stock == in_stock)
    
    count_query = select(func.count()).select_from(base_query.subquery())
    total_result = await db.execute(count_query)
    total = total_result.scalar_one()
    
    results = await db.execute(base_query.limit(limit).offset(offset))
    products = results.scalars().all()
    
    items = [_map_v2_product(p, target_currency=currency) for p in products]
    
    response = {
        "total": total,
        "limit": limit,
        "offset": offset,
        "items": [i.model_dump(mode="json") for i in items],
        "has_more": (offset + limit) < total,
        "query": q,
    }
    
    await cache.cache_set(cache_key, response, ttl_seconds=300)
    
    return response


@router.get("/trending", summary="Get trending products (v2 API)")
async def v2_trending(
    request: Request,
    category: Optional[str] = Query(None),
    limit: int = Query(20, ge=1, le=100),
    period: str = Query("7d", description="Time period: 1d, 7d, 30d"),
    db: AsyncSession = Depends(get_db),
    api_key: ApiKey = Depends(get_current_api_key),
):
    cache_key = cache.build_cache_key("v2:trending", category=category, limit=limit, period=period)
    cached = await cache.cache_get(cache_key)
    if cached:
        return cached
    
    days_map = {"1d": 1, "7d": 7, "30d": 30}
    days = days_map.get(period, 7)
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    
    subq = select(
        ProductView.product_id,
        func.count(ProductView.id).label("views")
    ).where(ProductView.viewed_at >= cutoff).group_by(ProductView.product_id).subquery()
    
    query = select(Product).join(subq, Product.id == subq.c.product_id).where(
        Product.is_active == True
    ).order_by(subq.c.views.desc()).limit(limit)
    
    if category:
        query = query.where(Product.category.ilike(f"%{category}%"))
    
    results = await db.execute(query)
    products = results.scalars().all()
    
    items = [_map_v2_product(p) for p in products]
    
    response = {
        "total": len(items),
        "limit": limit,
        "period": period,
        "items": [i.model_dump(mode="json") for i in items],
    }
    
    await cache.cache_set(cache_key, response, ttl_seconds=300)
    
    return response


@router.post("/products/batch-details", summary="Batch product lookup optimized for agents")
async def v2_batch_product_details(
    request: Request,
    body: BatchProductRequest,
    db: AsyncSession = Depends(get_db),
    api_key: ApiKey = Depends(get_current_api_key),
):
    """Optimized batch endpoint for agent decision-making with minimal payload"""
    request.state.api_key = api_key
    
    if len(body.product_ids) > 100:
        raise HTTPException(status_code=400, detail="Maximum 100 product IDs per request")
    
    # Check cache first
    cache_keys = [f"v2:product:{pid}" for pid in body.product_ids]
    cached_results = await cache.cache_get_many(cache_keys)
    cached_products = {}
    for pid in body.product_ids:
        cached_data = cached_results.get(f"v2:product:{pid}")
        if cached_data:
            cached_products[pid] = cached_data
    
    # Fetch missing products from database
    product_ids_to_fetch = [pid for pid in body.product_ids if pid not in cached_products]
    products = []
    
    if product_ids_to_fetch:
        result = await db.execute(
            select(Product).where(
                Product.id.in_(product_ids_to_fetch),
                Product.is_active == True,
            )
        )
        rows = result.scalars().all()
        
        for row in rows:
            product_response = _map_v2_product(row)
            product_data = product_response.model_dump(mode="json")
            products.append(product_data)
            # Cache individual product
            await cache.cache_set(f"v2:product:{row.id}", product_data, ttl_seconds=600)
    
    # Add cached products
    for pid, cached_data in cached_products.items():
        products.append(cached_data)
    
    # Calculate cache hit rate
    cache_hit_rate = len(cached_products) / len(body.product_ids) if body.product_ids else 0
    
    response = V2BatchProductResponse(
        products=products,
        total=len(products),
        found=len(products),
        not_found=len(body.product_ids) - len(products),
        cache_hit_rate=round(cache_hit_rate, 2),
        query_time_ms=0  # TODO: Implement actual timing
    )
    return response



@router.get("/agents/explore", summary="Explore products for agent discovery (v2 API)")
async def v2_agents_explore(
    request: Request,
    category: Optional[str] = Query(None, description="Filter by category"),
    brand: Optional[str] = Query(None, description="Filter by brand"),
    min_price: Optional[Decimal] = Query(None, ge=0, description="Minimum price"),
    max_price: Optional[Decimal] = Query(None, ge=0, description="Maximum price"),
    platform: Optional[str] = Query(None, description="Filter by platform (source)"),
    country: Optional[str] = Query(None, description="Filter by country code (SG, MY, etc.)"),
    in_stock: Optional[bool] = Query(None, description="Filter by availability"),
    limit: int = Query(10, ge=1, le=50, description="Number of products to return"),
    currency: Optional[str] = Query(None, description=f"Target currency. Supported: {', '.join(SUPPORTED_CURRENCIES)}"),
    db: AsyncSession = Depends(get_db),
    api_key: ApiKey = Depends(get_current_api_key),
):
    """
    Get a randomized selection of products for agent exploration and discovery.
    This endpoint is optimized for agents that need to discover products without
    specific search queries, enabling serendipitous discovery and market analysis.
    """
    if min_price is not None and max_price is not None and min_price > max_price:
        raise HTTPException(status_code=422, detail="min_price cannot be greater than max_price")
    
    if currency and currency not in SUPPORTED_CURRENCIES:
        raise HTTPException(status_code=422, detail=f"Unsupported currency: {currency}")
    
    # Build cache key
    cache_key = cache.build_cache_key(
        "v2:agents:explore",
        category=category,
        brand=brand,
        min_price=str(min_price) if min_price else None,
        max_price=str(max_price) if max_price else None,
        platform=platform,
        country=country,
        in_stock=in_stock,
        limit=limit,
        currency=currency,
    )
    
    cached = await cache.cache_get(cache_key)
    if cached:
        return cached
    
    base_query = select(Product).where(Product.is_active == True)
    
    if category:
        base_query = base_query.where(Product.category.ilike(f"%{category}%"))
    if brand:
        base_query = base_query.where(Product.brand.ilike(f"%{brand}%"))
    if min_price is not None:
        base_query = base_query.where(Product.price >= min_price)
    if max_price is not None:
        base_query = base_query.where(Product.price <= max_price)
    if platform:
        base_query = base_query.where(Product.source == platform)
    if country:
        country_source_map = {
            "SG": ("shopee_sg", "lazada_sg", "carousell_sg", "qoo10_sg", "amazon_sg"),
            "MY": ("shopee_my", "lazada_my"),
            "PH": ("shopee_ph", "lazada_ph"),
            "TH": ("shopee_th", "lazada_th"),
            "VN": ("shopee_vn", "lazada_vn"),
        }
        sources = country_source_map.get(country.upper())
        if sources:
            base_query = base_query.where(Product.source.in_(sources))
    if in_stock is not None:
        base_query = base_query.where(Product.in_stock == in_stock)
    
    # Get total count for has_more calculation
    if limit == 0:
        count_query = select(func.count()).select_from(base_query.subquery())
        total_result = await db.execute(count_query)
        total = total_result.scalar_one()
    else:
        total = None
    
    # Use random ordering for exploration
    results = await db.execute(
        base_query
        .order_by(func.random())
        .limit(limit)
    )
    products = results.scalars().all()
    
    items = [_map_v2_product(p, target_currency=currency) for p in products]
    effective_total = total if total is not None else len(items)
    has_more = len(items) == limit if total is not None else False
    
    response = {
        "total": effective_total,
        "limit": limit,
        "offset": 0,  # Exploration doesn't use traditional pagination
        "items": [i.model_dump(mode="json") for i in items],
        "has_more": has_more,
        "filters_applied": {
            "category": category,
            "brand": brand,
            "min_price": min_price,
            "max_price": max_price,
            "platform": platform,
            "country": country,
            "in_stock": in_stock
        }
    }
    
    await cache.cache_set(cache_key, response, ttl_seconds=180)  # Shorter cache for exploration
    
    return response


@router.get("/health")
async def v2_health(request: Request):
    return JSONResponse(content={"status": "healthy", "version": "2.0"})


@router.get("")
async def v2_root(request: Request):
    return JSONResponse(content={
        "api": "BuyWhere Catalog API",
        "version": "v2",
        "status": "active",
         "message": "v2 API is available. See endpoint documentation for details.",
         "endpoints": {
             "health": "GET /v2/health",
             "products": "GET /v2/products",
             "product_detail": "GET /v2/products/{product_id}",
             "search": "GET /v2/search",
             "categories": "GET /v2/categories",
             "brands": "GET /v2/brands",
             "deals": "GET /v2/deals",
             "merchants": "GET /v2/merchants",
             "trending": "GET /v2/trending",
             "batch_details": "POST /v2/products/batch-details",
             "agents_explore": "GET /v2/agents/explore",
             "agents_trending_by_category": "GET /v2/agents/trending-by-category",
             "webhooks": {
                 "register": "POST /v2/webhooks",
                 "list": "GET /v2/webhooks",
                 "delete": "DELETE /v2/webhooks/{webhook_id}",
                 "test": "POST /v2/webhooks/test",
                 "toggle": "PATCH /v2/webhooks/{webhook_id}/active"
             }
         },
    })