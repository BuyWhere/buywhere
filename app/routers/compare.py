import logging
import re
from typing import Optional, List, Any, Dict
from decimal import Decimal
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import JSONResponse
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_api_key
from app.database import get_db
from app.models.product import ApiKey, Product, ComparisonPage
from app.rate_limit import limiter, rate_limit_from_request
from app.schemas.product import (
    CompareResponse,
)
from app.schemas.product import CompareMatch
from app.schemas.product import CompareHighlights
from app import cache
from app.affiliate_links import get_affiliate_url
from app.compare import ProductMatcher

logger = logging.getLogger("buywhere_api")

router = APIRouter(prefix="/compare", tags=["compare"])

_SLUG_RE = re.compile(r'^[a-z0-9]+(-[a-z0-9]+)*$')
_CACHE_TTL = 300  # 5 min


def _is_valid_slug(s: str) -> bool:
    return bool(_SLUG_RE.match(s)) and len(s) <= 70


def _retailer_meta(source: str) -> Dict[str, str]:
    s = (source or "").lower()
    if "fairprice" in s:    return {"name": "FairPrice",  "domain": "fairprice.com.sg",  "region": "SG"}
    if "challenger" in s:   return {"name": "Challenger", "domain": "challenger.com.sg", "region": "SG"}
    if "lazada" in s:       return {"name": "Lazada",     "domain": "lazada.sg",          "region": "SG"}
    if s == "amazon_sg":    return {"name": "Amazon SG",  "domain": "amazon.sg",          "region": "SG"}
    if s in ("amazon_us", "amazon"): return {"name": "Amazon US", "domain": "amazon.com", "region": "US"}
    if "shopee" in s:       return {"name": "Shopee",     "domain": "shopee.sg",          "region": "SG"}
    if "bestdenki" in s or "best_denki" in s: return {"name": "Best Denki", "domain": "bestdenki.com.sg", "region": "SG"}
    if "popular" in s:      return {"name": "Popular",    "domain": "popular.com.sg",     "region": "SG"}
    if "courts" in s:       return {"name": "Courts",     "domain": "courts.com.sg",      "region": "SG"}
    return {"name": source, "domain": source, "region": "SG"}


def _fmt_price(price: float) -> str:
    return f"S${price:.2f}"


def _build_structured_data(page: ComparisonPage, product: Product, retailers: List[Dict]) -> List[Dict]:
    ld: List[Dict] = [
        {
            "@context": "https://schema.org",
            "@type": "Product",
            "name": product.title if product else page.slug,
            "description": product.description if product else None,
            "image": page.hero_image_url or (product.image_url if product else None),
            "brand": {"@type": "Brand", "name": product.brand} if (product and product.brand) else None,
            "offers": {
                "@type": "AggregateOffer",
                "priceCurrency": "SGD",
                "lowPrice": retailers[0]["price"] if retailers else None,
                "highPrice": retailers[-1]["price"] if retailers else None,
                "offerCount": len(retailers),
                "offers": [
                    {
                        "@type": "Offer",
                        "priceCurrency": "SGD",
                        "price": r["price"],
                        "availability": "https://schema.org/OutOfStock" if r["availability"] == "out_of_stock" else "https://schema.org/InStock",
                        "url": r["url"],
                        "seller": {"@type": "Organization", "name": r["retailer_name"]},
                    }
                    for r in retailers
                ],
            } if retailers else None,
        },
        {
            "@context": "https://schema.org",
            "@type": "BreadcrumbList",
            "itemListElement": [
                {"@type": "ListItem", "position": 1, "name": "Home"},
                {"@type": "ListItem", "position": 2, "name": "Compare"},
                {"@type": "ListItem", "position": 3, "name": page.category.capitalize()},
                {"@type": "ListItem", "position": 4, "name": product.title if product else page.slug},
            ],
        },
    ]
    meta = page.metadata_ or {}
    faq_items = meta.get("faq", [])
    if isinstance(faq_items, list) and faq_items:
        ld.append({
            "@context": "https://schema.org",
            "@type": "FAQPage",
            "mainEntity": [
                {"@type": "Question", "name": f["q"], "acceptedAnswer": {"@type": "Answer", "text": f["a"]}}
                for f in faq_items
                if isinstance(f, dict) and "q" in f and "a" in f
            ],
        })
    return ld


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
        last_checked=p.last_checked,
        metadata=p.metadata_,
        updated_at=p.updated_at,
        match_score=round(score, 3),
    )


def _get_highlights(matches: List[CompareMatch]) -> Optional[CompareHighlights]:
    if not matches:
        return None

    cheapest = min(matches, key=lambda x: x.price, default=None)
    best_rated = max((m for m in matches if m.rating is not None), key=lambda x: x.rating, default=None)

    fastest_shipping = None
    fastest_shipping_days = None
    for m in matches:
        if m.metadata and isinstance(m.metadata, dict):
            shipping = m.metadata.get("shipping_days") or m.metadata.get("shipping")
            if shipping is not None:
                try:
                    shipping_int = int(shipping)
                    if fastest_shipping_days is None or shipping_int < fastest_shipping_days:
                        fastest_shipping_days = shipping_int
                        fastest_shipping = m
                except (ValueError, TypeError):
                    pass

    if not cheapest and not best_rated and not fastest_shipping:
        return None

    return CompareHighlights(
        cheapest=cheapest,
        best_rated=best_rated,
        fastest_shipping=fastest_shipping,
    )


@router.get("/pages/{slug}", summary="Get comparison page payload by slug (BUY-2270)")
@limiter.limit(rate_limit_from_request)
async def compare_page_by_slug(
    request: Request,
    slug: str,
    db: AsyncSession = Depends(get_db),
) -> JSONResponse:
    """Return the full comparison page payload for a given slug.

    Used by the /compare/[slug] Next.js SSR page. No API key required (public).
    Includes structured data (JSON-LD), retailer prices, SEO metadata, and FAQ.
    5-minute cache (Cache-Control + in-memory).
    """
    return await _compare_page_by_slug_impl(request, slug, db)


async def _compare_page_by_slug_impl(
    request: Request,
    slug: str,
    db: AsyncSession,
) -> JSONResponse:
    if not _is_valid_slug(slug):
        raise HTTPException(status_code=404, detail="Not found")

    cache_key = f"compare:page:{slug}"
    cached = await cache.cache_get(cache_key)
    if cached:
        return JSONResponse(content=cached, headers={"X-Cache": "HIT", "Cache-Control": f"public, max-age={_CACHE_TTL}", "X-Robots-Tag": "ai-index"})

    result = await db.execute(
        select(ComparisonPage).where(
            ComparisonPage.slug == slug,
            ComparisonPage.status == "published",
        )
    )
    page = result.scalar_one_or_none()
    if not page:
        raise HTTPException(status_code=404, detail="Not found")

    product_ids = [int(pid) for pid in (page.product_ids or []) if pid]
    if not product_ids:
        raise HTTPException(status_code=404, detail="No products linked")

    products_result = await db.execute(
        select(Product).where(
            Product.id.in_(product_ids),
            Product.url.isnot(None),
            Product.is_active == True,
        ).order_by(
            text("COALESCE(price_sgd, price) ASC NULLS LAST")
        )
    )
    products = list(products_result.scalars())
    canonical = products[0] if products else None

    proto = request.headers.get("x-forwarded-proto", request.url.scheme).split(",")[0].strip()
    host = request.headers.get("x-forwarded-host") or request.headers.get("host", "")
    base = f"{proto}://{host}"

    retailers = []
    lowest_price = None
    for i, p in enumerate(products):
        price_num = float(p.price_sgd) if p.price_sgd is not None else (float(p.price) if p.price is not None else None)
        if i == 0:
            lowest_price = price_num
        meta = _retailer_meta(p.source)
        retailers.append({
            "retailer_id": p.source,
            "retailer_name": meta["name"],
            "retailer_logo_url": f"https://logo.clearbit.com/{meta['domain']}",
            "retailer_domain": meta["domain"],
            "region": meta["region"],
            "price": price_num,
            "price_formatted": _fmt_price(price_num) if price_num is not None else "N/A",
            "availability": "out_of_stock" if p.is_available is False else "in_stock",
            "availability_label": "Out of Stock" if p.is_available is False else "In Stock",
            "url": p.url,
            "delta_vs_lowest": round(price_num - lowest_price, 2) if (price_num is not None and lowest_price is not None and i > 0) else 0,
        })

    page_meta = page.metadata_ or {}
    faq = [
        {"question": f["q"], "answer": f["a"]}
        for f in (page_meta.get("faq") or [])
        if isinstance(f, dict) and "q" in f and "a" in f
    ]

    raw_specs = getattr(canonical, "specs", None) if canonical else None
    if isinstance(raw_specs, list):
        specs = raw_specs
    elif isinstance(raw_specs, dict):
        specs = [{"label": k, "value": str(v)} for k, v in raw_specs.items()]
    else:
        specs = []

    product_title = canonical.title if canonical else slug
    product_brand = canonical.brand if canonical else None

    payload: Dict[str, Any] = {
        "slug": page.slug,
        "product_id": str(canonical.id) if canonical else str(product_ids[0]),
        "category": page.category,
        "canonical_url": f"{base}/compare/{slug}",
        "product": {
            "id": str(canonical.id) if canonical else str(product_ids[0]),
            "title": product_title,
            "brand": product_brand,
            "gtin": getattr(canonical, "barcode", None) if canonical else None,
            "description": canonical.description if canonical else None,
            "image_url": page.hero_image_url or (canonical.image_url if canonical else None),
            "category_path": list(canonical.category_path or []) if canonical else [],
            "specs": specs,
        },
        "retailers": retailers,
        "lowest_price": lowest_price,
        "lowest_price_formatted": _fmt_price(lowest_price) if lowest_price is not None else "N/A",
        "lowest_price_retailer": retailers[0]["retailer_name"] if retailers else None,
        "expert_summary": page.expert_summary,
        "faq": faq,
        "related_comparisons": [],
        "metadata": {
            "updated_at": canonical.updated_at.isoformat() if (canonical and canonical.updated_at) else datetime.now(timezone.utc).isoformat(),
            "published_at": page.published_at.isoformat() if page.published_at else None,
        },
        "breadcrumb": [
            {"name": "Home", "url": base},
            {"name": "Compare", "url": f"{base}/compare"},
            {"name": page.category.capitalize(), "url": f"{base}/compare?category={page.category}"},
            {"name": product_title, "url": f"{base}/compare/{slug}"},
        ],
        "structured_data": _build_structured_data(page, canonical, retailers),
        "seo": {
            "title": f"Compare {(product_brand + ' ') if product_brand else ''}{product_title} prices across {len(retailers)} Singapore retailers — BuyWhere",
            "description": (
                f"Find the best price for {product_title} in Singapore. "
                f"Compare live prices{(' from ' + ', '.join(r['retailer_name'] for r in retailers[:3])) if retailers else ''}."
                f"{(' From ' + _fmt_price(lowest_price) + '.') if lowest_price else ''}"
            )[:155],
            "canonical": f"{base}/compare/{slug}",
        },
    }

    await cache.cache_set(cache_key, payload, ttl_seconds=_CACHE_TTL)
    return JSONResponse(
        content=payload,
        headers={
            "X-Cache": "MISS",
            "Cache-Control": f"public, max-age={_CACHE_TTL}",
            "X-Robots-Tag": "ai-index",
        },
    )


@router.get("/{slug}", summary="Compare page by slug (alias for /pages/{slug})")
@limiter.limit(rate_limit_from_request)
async def compare_page_slug_alias(
    request: Request,
    slug: str,
    db: AsyncSession = Depends(get_db),
) -> JSONResponse:
    """Alias for /pages/{slug} — serves same payload for the FE route /compare/{slug}."""
    return await _compare_page_by_slug_impl(request, slug, db)


@router.get("/{product_id}", response_model=CompareResponse, summary="Compare same product across all sources")
@limiter.limit(rate_limit_from_request)
async def compare_product_by_id(
    request: Request,
    product_id: int,
    min_price: Optional[float] = Query(None, description="Minimum price filter"),
    max_price: Optional[float] = Query(None, description="Maximum price filter"),
    db: AsyncSession = Depends(get_db),
    api_key: ApiKey = Depends(get_current_api_key),
) -> CompareResponse:
    """Find the same product across all sources using title similarity + brand match.
    
    Returns products sorted by price with savings vs most expensive.
    This is THE killer feature for shopping agents.
    """
    request.state.api_key = api_key

    cache_key = cache.build_cache_key(
        "compare:product",
        product_id=product_id,
        min_price=str(min_price) if min_price is not None else None,
        max_price=str(max_price) if max_price is not None else None,
    )
    cached = await cache.cache_get(cache_key)
    if cached:
        return CompareResponse(**cached)

    source_result = await db.execute(
        select(Product).where(Product.id == product_id, Product.is_active == True)
    )
    source_product = source_result.scalar_one_or_none()
    if not source_product:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found")

    matcher = ProductMatcher(db)
    matches_with_scores = await matcher.find_matches(source_product, min_price, max_price)

    matches: List[CompareMatch] = []
    for matched_product, score in matches_with_scores:
        matches.append(_build_compare_match(matched_product, score))

    matches.sort(key=lambda x: x.price)

    most_expensive_price = max((m.price for m in matches), default=None)
    if most_expensive_price and most_expensive_price > 0:
        for m in matches:
            savings = most_expensive_price - m.price
            savings_pct = (savings / most_expensive_price) * 100
            m.savings_vs_most_expensive = float(savings)
            m.savings_pct = round(float(savings_pct), 2)

    highlights = _get_highlights(matches) if matches else None

    response = CompareResponse(
        source_product_id=source_product.id,
        source_product_name=source_product.title,
        matches=matches,
        total_matches=len(matches),
        highlights=highlights,
    )

    await cache.cache_set(cache_key, response.model_dump(mode="json"), ttl_seconds=300)

    return response