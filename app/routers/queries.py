import logging
import re
from typing import Optional, List, Any, Dict
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import JSONResponse
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_api_key
from app.database import get_db
from app.models.product import Product
from app.rate_limit import limiter, rate_limit_from_request
from app import cache
from app.affiliate_links import get_affiliate_url

logger = logging.getLogger("buywhere_api")

router = APIRouter(prefix="/queries", tags=["queries"])

_SLUG_RE = re.compile(r'^[a-z0-9]+(-[a-z0-9]+)*$')
_CACHE_TTL = 300


def _is_valid_slug(s: str) -> bool:
    return bool(_SLUG_RE.match(s)) and 3 <= len(s) <= 70


def _fmt_price(price: float, currency: str = "SGD") -> str:
    if currency == "USD":
        return f"${price:.2f}"
    return f"S${price:.2f}"


def _build_structured_data(query: str, products: List[Dict], base_url: str, slug: str) -> List[Dict]:
    ld = [
        {
            "@context": "https://schema.org",
            "@type": "CollectionPage",
            "name": query,
            "description": f"Product search results for '{query}' across multiple Singapore retailers",
            "url": f"{base_url}/queries/{slug}",
            "mainEntity": {
                "@type": "ItemList",
                "itemListElement": [
                    {
                        "@type": "ListItem",
                        "position": i + 1,
                        "item": {
                            "@type": "Product",
                            "name": p.get("title"),
                            "image": p.get("image_url"),
                            "offers": {
                                "@type": "Offer",
                                "priceCurrency": p.get("currency", "SGD"),
                                "price": p.get("price"),
                                "availability": "https://schema.org/InStock" if p.get("in_stock") else "https://schema.org/OutOfStock",
                                "url": p.get("url"),
                            }
                        }
                    }
                    for i, p in enumerate(products[:5])
                ],
            }
        },
        {
            "@context": "https://schema.org",
            "@type": "BreadcrumbList",
            "itemListElement": [
                {"@type": "ListItem", "position": 1, "name": "Home"},
                {"@type": "ListItem", "position": 2, "name": "Search"},
                {"@type": "ListItem", "position": 3, "name": query},
            ],
        },
    ]
    return ld


def _build_seo_title(query: str, count: int) -> str:
    return f"{query} — Search results from 30+ Singapore retailers | BuyWhere"


def _build_seo_description(query: str, lowest_price: Optional[float], retailer_count: int) -> str:
    parts = []
    if lowest_price is not None:
        parts.append(f"Prices from S${lowest_price:.2f}")
    parts.append(f"{retailer_count} retailers")
    suffix = f". {' '.join(parts)}." if parts else "."
    desc = f"Find the best {query} deals in Singapore.{suffix} Compare prices across Shopee, Lazada, Amazon, and more."
    return desc[:160]


@router.get("/{slug}", summary="Get query-specific product results page by slug (BUY-5004)")
@limiter.limit(rate_limit_from_request)
async def query_page_by_slug(
    request: Request,
    slug: str,
    limit: int = Query(10, ge=1, le=50, description="Number of products to return"),
    db: AsyncSession = Depends(get_db),
) -> JSONResponse:
    """Return a query-specific product results page for a given slug.

    Used by /queries/[slug] pages for SEO and AEO. No API key required (public).
    The slug encodes the search query, e.g. /queries/best-laptop-under-1000.

    Includes structured data (JSON-LD), ranked products, and API usage examples.
    5-minute cache (Cache-Control + in-memory).
    """
    if not _is_valid_slug(slug):
        raise HTTPException(status_code=404, detail="Not found")

    cache_key = f"queries:page:{slug}"
    cached = await cache.cache_get(cache_key)
    if cached:
        return JSONResponse(
            content=cached,
            headers={
                "X-Cache": "HIT",
                "Cache-Control": f"public, max-age={_CACHE_TTL}",
                "X-Robots-Tag": "ai-index"
            }
        )

    query_text = slug.replace("-", " ")

    proto = request.headers.get("x-forwarded-proto", request.url.scheme).split(",")[0].strip()
    host = request.headers.get("x-forwarded-host") or request.headers.get("host", "")
    base = f"{proto}://{host}"

    result = await db.execute(
        select(Product).where(
            Product.is_active == True,
            Product.url.isnot(None),
        ).order_by(
            Product.updated_at.desc()
        )
    )
    all_products = list(result.scalars().all())

    query_lower = query_text.lower()
    scored = []
    for p in all_products:
        score = 0.0
        title_lower = (p.title or "").lower()
        category_lower = (p.category or "").lower()
        brand_lower = (p.brand or "").lower()
        desc_lower = (p.description or "").lower()

        for word in query_lower.split():
            if word in title_lower:
                score += 3.0
            if word in brand_lower:
                score += 2.0
            if word in category_lower:
                score += 1.5
            if word in desc_lower:
                score += 0.5

        price_val = float(p.price_sgd) if p.price_sgd is not None else float(p.price) if p.price is not None else None
        if price_val is not None:
            if "cheapest" in query_lower or " cheapest" in query_lower or "best value" in query_lower:
                score -= price_val / 1000
            elif "under" in query_lower or "under_" in slug:
                import re
                m = re.search(r'under[_-]?(\d+)', slug)
                if m:
                    budget = float(m.group(1))
                    if price_val <= budget:
                        score += 5.0
                    else:
                        score -= 10.0

        scored.append((p, score))

    scored.sort(key=lambda x: x[1], reverse=True)
    top_products = [p for p, s in scored[:limit] if s > 0]

    if not top_products:
        top_products = all_products[:limit]

    currency = "SGD"
    products_out = []
    for p in top_products:
        price_val = float(p.price_sgd) if p.price_sgd is not None else float(p.price) if p.price is not None else None
        meta = _retailer_meta(p.source or "")
        products_out.append({
            "id": str(p.id),
            "title": p.title,
            "brand": p.brand,
            "price": price_val,
            "price_formatted": _fmt_price(price_val, currency) if price_val is not None else "N/A",
            "currency": currency,
            "source": p.source,
            "retailer_name": meta["name"],
            "retailer_domain": meta["domain"],
            "image_url": p.image_url,
            "url": p.url,
            "affiliate_url": get_affiliate_url(p.source, p.url) if p.url else None,
            "rating": p.rating,
            "review_count": p.review_count,
            "in_stock": p.in_stock,
            "is_available": p.is_active,
        })

    lowest_price = min((x["price"] for x in products_out if x["price"] is not None), default=None)
    retailer_count = len(set(x["source"] for x in products_out))

    api_example = (
        f"curl -sS '{base}/v1/search?q={slug.replace(' ', '+')}' "
        f"-H 'Authorization: Bearer YOUR_API_KEY'"
    )

    payload: Dict[str, Any] = {
        "slug": slug,
        "query": query_text,
        "product_count": len(products_out),
        "retailer_count": retailer_count,
        "lowest_price": lowest_price,
        "lowest_price_formatted": _fmt_price(lowest_price, currency) if lowest_price is not None else None,
        "api_example": api_example,
        "products": products_out,
        "structured_data": _build_structured_data(query_text, products_out, base, slug),
        "seo": {
            "title": _build_seo_title(query_text, len(products_out)),
            "description": _build_seo_description(query_text, lowest_price, retailer_count),
            "canonical": f"{base}/queries/{slug}",
        },
        "metadata": {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "cache_ttl_seconds": _CACHE_TTL,
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