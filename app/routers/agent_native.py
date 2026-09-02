from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import JSONResponse
import time
from typing import Optional, List
from decimal import Decimal

from sqlalchemy import func, select, or_, and_, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_api_key
from app.database import get_db
from app.models.product import ApiKey, Product
from app import cache
from app.schemas.agent.search import AgentSearchQuery, AgentSearchResponse, AgentSearchResult
from app.schemas.agent.compare import AgentPriceComparisonRequest, AgentPriceComparisonResponse, AgentPriceComparisonItem
from app.schemas.agent.batch import AgentBatchLookupRequest, AgentBatchLookupResponse, AgentBatchLookupItem

router = APIRouter(prefix="/v2/agents", tags=["agent-native"])


@router.get("/search", response_model=AgentSearchResponse, summary="Agent-optimized natural language product search")
async def agent_search(
    request: Request,
    q: str = Query(..., min_length=1, description="Natural language search query"),
    limit: int = Query(10, ge=1, le=100, description="Number of results to return"),
    offset: int = Query(0, ge=0, description="Pagination offset"),
    source: Optional[str] = Query(None, description="Filter by source platform"),
    min_price: Optional[Decimal] = Query(None, description="Minimum price filter"),
    max_price: Optional[Decimal] = Query(None, description="Maximum price filter"),
    availability: Optional[bool] = Query(None, description="Filter by availability"),
    sort_by: str = Query("relevance", description="Sort by: relevance, price_asc, price_desc, newest"),
    db: AsyncSession = Depends(get_db),
    api_key: ApiKey = Depends(get_current_api_key),
):
    """
    Agent-optimized product search with natural language processing.
    Returns enhanced results with confidence scores, availability predictions, and competitor counts.
    """
    start_time = time.time()
    
    # Normalize query
    query_processed = q.lower().strip()
    
    # Build base query
    base_query = select(Product).where(Product.is_active == True)
    
    # Apply text search using PostgreSQL full-text search
    if query_processed:
        search_term = query_processed.replace(' ', ' & ')  # Convert to tsquery format
        base_query = base_query.where(Product.title_search_vector.op('@@')(func.to_tsquery('english', search_term)))
    
    # Apply filters
    if source is not None:
        base_query = base_query.where(Product.source == source)
    
    if min_price is not None:
        base_query = base_query.where(Product.price >= min_price)
        
    if max_price is not None:
        base_query = base_query.where(Product.price <= max_price)
        
    if availability is not None:
        base_query = base_query.where(Product.is_available == availability)
    
    # Apply sorting
    if sort_by == "price_asc":
        base_query = base_query.order_by(Product.price.asc())
    elif sort_by == "price_desc":
        base_query = base_query.order_by(Product.price.desc())
    elif sort_by == "newest":
        base_query = base_query.order_by(Product.updated_at.desc())
    else:  # relevance (default)
        # Already sorted by full-text search ranking via title_search_vector
        base_query = base_query.order_by(Product.title_search_vector.desc())
    
    # Get total count for pagination
    count_query = select(func.count()).select_from(base_query.subquery())
    total_result = await db.execute(count_query)
    total = total_result.scalar_one()
    
    # Apply pagination and execute query
    paginated_query = base_query.limit(limit).offset(offset)
    result = await db.execute(paginated_query)
    products = result.scalars().all()
    
    # Enhance products with agent-specific data
    search_results = []
    for product in products:
        # Calculate confidence score based on text match quality
        confidence_score = 1.0  # Simplified - in production would use ts_rank
        
        # Predict availability based on stock levels
        availability_prediction = None
        if product.stock_level:
            stock_lower = product.stock_level.lower()
            if 'out' in stock_lower or 'zero' in stock_lower:
                availability_prediction = "out_of_stock"
            elif 'low' in stock_lower or 'few' in stock_lower:
                availability_prediction = "low_stock"
            else:
                availability_prediction = "in_stock"
        elif product.in_stock is False:
            availability_prediction = "out_of_stock"
        elif product.in_stock is True:
            availability_prediction = "in_stock"
        
        # Get competitor count (simplified - count of same SKU from different sources)
        competitor_count = 0
        if product.sku:
            competitor_query = select(func.count(Product.id)).where(
                and_(
                    Product.sku == product.sku,
                    Product.source != product.source,
                    Product.is_active == True
                )
            )
            competitor_result = await db.execute(competitor_query)
            competitor_count = competitor_result.scalar_one() or 0
        
        # Get buybox price (lowest price for this product across all sources)
        buybox_price = None
        if product.sku:
            buybox_query = select(func.min(Product.price)).where(
                and_(
                    Product.sku == product.sku,
                    Product.is_active == True
                )
            )
            buybox_result = await db.execute(buybox_query)
            buybox_price = buybox_result.scalar_one()
        
        # Generate affiliate URL
        affiliate_url = None
        if product.url:
            # In production, this would call the affiliate service
            affiliate_url = f"{product.url}?aff_id=buywhere_agent"
        
        search_result = AgentSearchResult(
            id=product.id,
            sku=product.sku,
            source=product.source,
            title=product.title,
            price=product.price,
            currency=product.currency or "SGD",
            price_sgd=product.price_sgd,
            url=product.url,
            brand=product.brand,
            category=product.category,
            image_url=product.image_url,
            rating=float(product.rating) if product.rating else None,
            review_count=product.review_count,
            is_available=product.is_available,
            in_stock=product.in_stock,
            stock_level=product.stock_level,
            confidence_score=confidence_score,
            availability_prediction=availability_prediction,
            competitor_count=competitor_count,
            buybox_price=buybox_price,
            affiliate_url=affiliate_url
        )
        search_results.append(search_result)
    
    # Calculate query time
    query_time_ms = (time.time() - start_time) * 1000
    
    # Check cache hit (simplified)
    cache_hit = False  # In production, would check actual cache
    
    response = AgentSearchResponse(
        total=total,
        limit=limit,
        offset=offset,
        has_more=(offset + limit) < total,
        query_processed=query_processed,
        results=search_results,
        query_time_ms=round(query_time_ms, 2),
        cache_hit=cache_hit
    )
    
    return response


@router.get("/price-comparison", response_model=AgentPriceComparisonResponse, summary="Agent-optimized price comparison across platforms")
async def agent_price_comparison(
    request: Request,
    product_name: str = Query(..., min_length=1, description="Product name to compare prices for"),
    limit: int = Query(10, ge=1, le=50, description="Maximum number of results to return"),
    sources: Optional[List[str]] = Query(None, description="Specific sources to include"),
    country: Optional[str] = Query(None, description="Country code filter"),
    min_price: Optional[Decimal] = Query(None, description="Minimum price filter"),
    max_price: Optional[Decimal] = Query(None, description="Maximum price filter"),
    availability_only: bool = Query(False, description="Only show products that are in stock"),
    sort_by: str = Query("price_asc", description="Sort by: price_asc, price_desc, relevance, newest"),
    db: AsyncSession = Depends(get_db),
    api_key: ApiKey = Depends(get_current_api_key),
):
    """
    Agent-optimized price comparison that finds the same product across multiple platforms
    and returns results sorted by price with savings calculations.
    """
    start_time = time.time()
    
    # Normalize product name for search
    query_processed = product_name.lower().strip()
    search_term = query_processed.replace(' ', ' & ')
    
    # Build base query
    base_query = select(Product).where(
        and_(
            Product.is_active == True,
            Product.title_search_vector.op('@@')(func.to_tsquery('english', search_term))
        )
    )
    
    # Apply filters
    if sources:
        base_query = base_query.where(Product.source.in_(sources))
        
    if country:
        # Assuming we have a country field or can derive from source
        pass  # Would need to join with merchants table
        
    if min_price is not None:
        base_query = base_query.where(Product.price >= min_price)
        
    if max_price is not None:
        base_query = base_query.where(Product.price <= max_price)
        
    if availability_only:
        base_query = base_query.where(Product.is_available == True)
    
    # Apply sorting
    if sort_by == "price_asc":
        base_query = base_query.order_by(Product.price.asc())
    elif sort_by == "price_desc":
        base_query = base_query.order_by(Product.price.desc())
    elif sort_by == "newest":
        base_query = base_query.order_by(Product.updated_at.desc())
    else:  # relevance
        base_query = base_query.order_by(Product.title_search_vector.desc())
    
    # Limit results
    limited_query = base_query.limit(limit)
    result = await db.execute(limited_query)
    products = result.scalars().all()
    
    if not products:
        # Return empty response if no products found
        return AgentPriceComparisonResponse(
            query=product_name,
            query_processed=query_processed,
            total_results=0,
            limit=limit,
            offset=0,
            has_more=False,
            price_stats={"min": 0, "max": 0, "avg": 0, "median": 0},
            results=[],
            query_time_ms=round((time.time() - start_time) * 1000, 2),
            cache_hit=False,
            best_deal=None
        )
    
    # Enhance products with agent-specific comparison data
    comparison_items = []
    prices = []
    
    for idx, product in enumerate(products):
        prices.append(float(product.price))
        
        # Calculate confidence score (simplified)
        confidence_score = 1.0
        
        # Calculate price rank
        sorted_prices = sorted(prices)
        price_rank = sorted_prices.index(float(product.price)) + 1
        
        # Calculate savings vs average and max
        avg_price = sum(prices) / len(prices) if prices else 0
        max_price_val = max(prices) if prices else 0
        savings_vs_avg = Decimal(str(avg_price)) - product.price if avg_price > 0 else None
        savings_vs_max = Decimal(str(max_price_val)) - product.price if max_price_val > 0 else None
        
        # Get affiliate URL
        affiliate_url = None
        if product.url:
            affiliate_url = f"{product.url}?aff_id=buywhere_agent"
        
        # Get buybox URL (URL of the lowest price seller)
        buybox_url = None
        if product.sku:
            # In production, would query for the product with minimum price
            buybox_url = product.url  # Simplified
        
        comparison_item = AgentPriceComparisonItem(
            id=product.id,
            sku=product.sku,
            source=product.source,
            title=product.title,
            price=product.price,
            currency=product.currency or "SGD",
            price_sgd=product.price_sgd,
            url=product.url,
            brand=product.brand,
            category=product.category,
            image_url=product.image_url,
            rating=float(product.rating) if product.rating else None,
            review_count=product.review_count,
            is_available=product.is_available,
            in_stock=product.in_stock,
            stock_level=product.stock_level,
            confidence_score=confidence_score,
            price_rank=price_rank,
            savings_vs_avg=savings_vs_avg,
            savings_vs_max=savings_vs_max,
            affiliate_url=affiliate_url,
            buybox_url=buybox_url
        )
        comparison_items.append(comparison_item)
    
    # Determine best deal (considering price, availability, and rating)
    best_deal = None
    if comparison_items:
        # Simple scoring: prefer in-stock, higher rating, lower price
        scored_items = []
        for item in comparison_items:
            score = 0
            # Availability score (40%)
            if item.in_stock is True:
                score += 40
            elif item.in_stock is None:
                score += 20  # Unknown availability
            
            # Rating score (30%)
            if item.rating:
                score += min(30, item.rating * 6)  # 5-star rating -> 30 points max
            
            # Price score (30%) - inverse of price rank
            if item.price_rank:
                score += (30 * (len(comparison_items) - item.price_rank + 1) / len(comparison_items))
            
            scored_items.append((score, item))
        
        # Sort by score descending and take the best
        scored_items.sort(key=lambda x: x[0], reverse=True)
        best_deal = scored_items[0][1] if scored_items else None
    
    # Calculate price statistics
    price_stats = {
        "min": min(prices) if prices else 0,
        "max": max(prices) if prices else 0,
        "avg": sum(prices) / len(prices) if prices else 0,
        "median": sorted(prices)[len(prices)//2] if prices else 0
    }
    
    # Calculate query time
    query_time_ms = (time.time() - start_time) * 1000
    
    response = AgentPriceComparisonResponse(
        query=product_name,
        query_processed=query_processed,
        total_results=len(products),
        limit=limit,
        offset=0,  # Simplified - in production would support pagination
        has_more=len(products) >= limit,  # Simplified
        price_stats=price_stats,
        results=comparison_items,
        query_time_ms=round(query_time_ms, 2),
        cache_hit=False,  # Simplified
        best_deal=best_deal
    )
    
    return response


@router.get("/explore", response_model=AgentSearchResponse, summary="Agent-driven product exploration")
async def agent_explore(
    request: Request,
    limit: int = Query(10, ge=1, le=50, description="Number of products to return"),
    category: Optional[str] = Query(None, description="Filter by category"),
    source: Optional[str] = Query(None, description="Filter by source platform"),
    min_price: Optional[Decimal] = Query(None, description="Minimum price filter"),
    max_price: Optional[Decimal] = Query(None, description="Maximum price filter"),
    availability: Optional[bool] = Query(None, description="Filter by availability"),
    db: AsyncSession = Depends(get_db),
    api_key: ApiKey = Depends(get_current_api_key),
):
    """
    Agent-driven product exploration endpoint that returns randomized products
    with optional filters for discovering new products and categories.
    This endpoint is designed for agents that need to explore the product catalog
    without a specific search query.
    """
    import random
    
    start_time = time.time()
    
    # Build base query for active products
    base_query = select(Product).where(Product.is_active == True)
    
    # Apply filters
    if category is not None:
        base_query = base_query.where(Product.category.ilike(f"%{category}%"))
    
    if source is not None:
        base_query = base_query.where(Product.source == source)
    
    if min_price is not None:
        base_query = base_query.where(Product.price >= min_price)
        
    if max_price is not None:
        base_query = base_query.where(Product.price <= max_price)
        
    if availability is not None:
        base_query = base_query.where(Product.is_available == availability)
    
    # Get total count for pagination
    count_query = select(func.count()).select_from(base_query.subquery())
    total_result = await db.execute(count_query)
    total = total_result.scalar_one()
    
    # If no products match filters, return empty response
    if total == 0:
        from app.schemas.agent.search import AgentSearchResponse
        return AgentSearchResponse(
            total=0,
            limit=limit,
            offset=0,
            has_more=False,
            query_processed="",
            results=[],
            query_time_ms=round((time.time() - start_time) * 1000, 2),
            cache_hit=False
        )
    
    # Get a random offset for exploration (ensuring we don't exceed total)
    max_offset = max(0, total - limit)
    random_offset = random.randint(0, max_offset) if max_offset > 0 else 0
    
    # Apply pagination with random offset
    paginated_query = base_query.limit(limit).offset(random_offset)
    result = await db.execute(paginated_query)
    products = result.scalars().all()
    
    # Enhance products with agent-specific data (similar to agent_search)
    search_results = []
    for product in products:
        # Calculate confidence score based on text match quality
        confidence_score = 1.0  # Simplified - in production would use ts_rank
        
        # Predict availability based on stock levels
        availability_prediction = None
        if product.stock_level:
            stock_lower = product.stock_level.lower()
            if 'out' in stock_lower or 'zero' in stock_lower:
                availability_prediction = "out_of_stock"
            elif 'low' in stock_lower or 'few' in stock_lower:
                availability_prediction = "low_stock"
            else:
                availability_prediction = "in_stock"
        elif product.in_stock is False:
            availability_prediction = "out_of_stock"
        elif product.in_stock is True:
            availability_prediction = "in_stock"
        
        # Get competitor count (simplified - count of same SKU from different sources)
        competitor_count = 0
        if product.sku:
            competitor_query = select(func.count(Product.id)).where(
                and_(
                    Product.sku == product.sku,
                    Product.source != product.source,
                    Product.is_active == True
                )
            )
            competitor_result = await db.execute(competitor_query)
            competitor_count = competitor_result.scalar_one() or 0
        
        # Get buybox price (lowest price for this product across all sources)
        buybox_price = None
        if product.sku:
            buybox_query = select(func.min(Product.price)).where(
                and_(
                    Product.sku == product.sku,
                    Product.is_active == True
                )
            )
            buybox_result = await db.execute(buybox_query)
            buybox_price = buybox_result.scalar_one()
        
        # Generate affiliate URL
        affiliate_url = None
        if product.url:
            # In production, this would call the affiliate service
            affiliate_url = f"{product.url}?aff_id=buywhere_agent"
        
        from app.schemas.agent.search import AgentSearchResult
        search_result = AgentSearchResult(
            id=product.id,
            sku=product.sku,
            source=product.source,
            title=product.title,
            price=product.price,
            currency=product.currency or "SGD",
            price_sgd=product.price_sgd,
            url=product.url,
            brand=product.brand,
            category=product.category,
            image_url=product.image_url,
            rating=float(product.rating) if product.rating else None,
            review_count=product.review_count,
            is_available=product.is_available,
            in_stock=product.in_stock,
            stock_level=product.stock_level,
            confidence_score=confidence_score,
            availability_prediction=availability_prediction,
            competitor_count=competitor_count,
            buybox_price=buybox_price,
            affiliate_url=affiliate_url
        )
        search_results.append(search_result)
    
    # Calculate query time
    query_time_ms = (time.time() - start_time) * 1000
    
    # Check cache hit (simplified)
    cache_hit = False  # In production, would check actual cache
    
    from app.schemas.agent.search import AgentSearchResponse
    response = AgentSearchResponse(
        total=total,
        limit=limit,
        offset=random_offset,
        has_more=(random_offset + limit) < total,
        query_processed="explore",
        results=search_results,
        query_time_ms=round(query_time_ms, 2),
        cache_hit=cache_hit
    )
    
    return response


@router.post("/batch-lookup", response_model=AgentBatchLookupResponse, summary="Agent-optimized batch product lookup")
async def agent_batch_lookup(
    request: Request,
    body: AgentBatchLookupRequest,
    db: AsyncSession = Depends(get_db),
    api_key: ApiKey = Depends(get_current_api_key),
):
    """
    Agent-optimized batch product lookup for efficiently retrieving multiple products
    by ID with optional metadata, price history, and affiliate links.
    """
    start_time = time.time()
    
    if not body.product_ids:
        raise HTTPException(status_code=400, detail="product_ids list cannot be empty")
    
    if len(body.product_ids) > 100:
        raise HTTPException(status_code=400, detail="Maximum 100 product IDs per request")
    
    # Check cache first
    cache_keys = [f"agent:product:{pid}" for pid in body.product_ids]
    cached_results = await cache.cache_get_many(cache_keys)
    cached_products = {}
    for pid in body.product_ids:
        cached_data = cached_results.get(f"agent:product:{pid}")
        if cached_data:
            cached_products[pid] = cached_data
    
      # Fetch missing products from database
    product_ids_to_fetch = [pid for pid in body.product_ids if pid not in cached_products]
    products = []
    
    if product_ids_to_fetch:
        # Build query with optional joins for expanded data
        query = select(Product).where(
            and_(
                Product.id.in_(product_ids_to_fetch),
                Product.is_active == True,
            )
        )
        
        result = await db.execute(query)
        rows = result.scalars().all()
        
        for row in rows:
            # Calculate agent-specific fields
            # Confidence score based on data completeness
            confidence_score = 1.0
            missing_fields = 0
            total_fields = 5  # title, description, brand, category, image_url
            if not row.title or row.title.strip() == "":
                missing_fields += 1
            if not row.description or row.description.strip() == "":
                missing_fields += 1
            if not row.brand or row.brand.strip() == "":
                missing_fields += 1
            if not row.category or row.category.strip() == "":
                missing_fields += 1
            if not row.image_url or row.image_url.strip() == "":
                missing_fields += 1
                if total_fields > 0:
                    confidence_score = max(0.3, 1.0 - (missing_fields / total_fields))
                
                # Availability prediction based on stock level
                availability_prediction = None
                if row.stock_level:
                    stock_lower = row.stock_level.lower()
                    if 'out' in stock_lower or 'zero' in stock_lower or 'empty' in stock_lower:
                        availability_prediction = "out_of_stock"
                    elif 'low' in stock_lower or 'few' in stock_lower or 'limited' in stock_lower:
                        availability_prediction = "low_stock"
                    elif 'in stock' in stock_lower or 'available' in stock_lower or 'instock' in stock_lower:
                        availability_prediction = "in_stock"
                    elif 'preorder' in stock_lower or 'backorder' in stock_lower:
                        availability_prediction = "preorder"
                    else:
                        # Default based on in_stock boolean
                        availability_prediction = "in_stock" if row.in_stock else "out_of_stock"
                elif row.in_stock is False:
                    availability_prediction = "out_of_stock"
                elif row.in_stock is True:
                    availability_prediction = "in_stock"
                else:
                    availability_prediction = "unknown"
                
                # Competitor count - count of same SKU from different sources
                competitor_count = 0
                if row.sku:
                    competitor_query = select(func.count(Product.id)).where(
                        and_(
                            Product.sku == row.sku,
                            Product.source != row.source,
                            Product.is_active == True
                        )
                    )
                    competitor_result = await db.execute(competitor_query)
                    competitor_count = competitor_result.scalar_one() or 0
                
                # Buybox price - lowest price for this product across all sources
                buybox_price = None
                if row.sku:
                    buybox_query = select(func.min(Product.price)).where(
                        and_(
                            Product.sku == row.sku,
                            Product.is_active == True
                        )
                    )
                    buybox_result = await db.execute(buybox_query)
                    buybox_price = buybox_result.scalar_one()
                
                # Map to agent batch lookup item
                batch_item = _map_to_agent_batch_item(
                    row, body, 
                    confidence_score=confidence_score,
                    availability_prediction=availability_prediction,
                    competitor_count=competitor_count,
                    buybox_price=buybox_price
                )
                products.append(batch_item)
                
                # Cache individual product
                product_data = batch_item.model_dump(mode="json")
                await cache.cache_set(f"agent:product:{row.id}", product_data, ttl_seconds=600)
    
    # Add cached products
    for pid, cached_data in cached_products.items():
        products.append(cached_data)
    
    # Calculate cache hit rate
    cache_hit_rate = len(cached_products) / len(body.product_ids) if body.product_ids else 0
    
    # Calculate query time
    query_time_ms = (time.time() - start_time) * 1000
    
    response = AgentBatchLookupResponse(
        total=len(body.product_ids),
        found=len(products),
        not_found=len(body.product_ids) - len(products),
        not_found_ids=[pid for pid in body.product_ids if pid not in [p.id for p in products]],
        products=products,
        cache_hit_rate=round(cache_hit_rate, 2),
        query_time_ms=round(query_time_ms, 2),
        requested_at=None  # Would set to datetime.utcnow() in production
    )
    
    return response


def _map_to_agent_batch_item(product: Product, request: AgentBatchLookupRequest, 
                           confidence_score: float = 1.0,
                           availability_prediction: Optional[str] = None,
                           competitor_count: Optional[int] = None,
                           buybox_price: Optional[Decimal] = None) -> AgentBatchLookupItem:
    """Map Product model to AgentBatchLookupItem with optional expanded fields."""
    # Get affiliate URL
    affiliate_url = None
    if product.url and request.affiliate_links:
        affiliate_url = f"{product.url}?aff_id=buywhere_agent"
    
    # Base item
    item = AgentBatchLookupItem(
        id=product.id,
        sku=product.sku,
        source=product.source,
        title=product.title,
        price=product.price,
        currency=product.currency or "SGD",
        price_sgd=product.price_sgd,
        url=product.url,
        brand=product.brand,
        category=product.category,
        image_url=product.image_url,
        rating=float(product.rating) if product.rating else None,
        review_count=product.review_count,
        is_available=product.is_available,
        in_stock=product.in_stock,
        stock_level=product.stock_level,
        # Agent-specific fields - now properly calculated
        confidence_score=confidence_score,
        availability_prediction=availability_prediction,
        competitor_count=competitor_count,
        buybox_price=buybox_price,
        affiliate_url=affiliate_url
    )
    
    # Add optional expanded fields if requested
    if request.include_metadata and product.metadata_:
        item.metadata_ = product.metadata_
    
    if request.include_metadata and product.specs:
        item.specs = product.specs
    
    # Price history would require separate query - simplified for now
    # if request.include_price_history:
    #     item.price_history = [...]  # Would query PriceHistory table
    
    return item