"""
SEO sitemap endpoints.

GET /sitemap.xml  - XML sitemap listing all product URLs and category pages.
GET /robots.txt    - robots.txt file.
"""
from __future__ import annotations

import html
import json
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, Request
from fastapi.responses import Response
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.product import Product, ComparisonPage

router = APIRouter(tags=["seo"])

TAXONOMY_PATH = Path("taxonomy.json")
STATIC_DIR = Path("static")
_cached_taxonomy = None

SITEMAP_CHANGE_FREQ = "daily"
SITEMAP_DEFAULT_PRIORITY = "0.5"
SITEMAP_PRODUCT_PRIORITY = "0.7"
SITEMAP_CATEGORY_PRIORITY = "0.6"

STATIC_PAGES = [
    {"loc": "", "priority": "1.0", "changefreq": "hourly"},
    {"loc": "api/v1", "priority": "0.9", "changefreq": "hourly"},
    {"loc": "docs", "priority": "0.8", "changefreq": "weekly"},
    {"loc": "redoc", "priority": "0.8", "changefreq": "weekly"},
    {"loc": "api/v1/categories", "priority": "0.9", "changefreq": "daily"},
    {"loc": "api/v1/deals", "priority": "0.8", "changefreq": "daily"},
    {"loc": "api/v1/products/trending", "priority": "0.7", "changefreq": "daily"},
    {"loc": "compare/diff", "priority": "0.8", "changefreq": "daily"},
]


def _slugify(name: str) -> str:
    return re.sub(r'[^a-z0-9]+', '_', name.lower()).strip('_')


def _escape_xml(text: Optional[str]) -> str:
    if text is None:
        return ""
    return html.escape(str(text), quote=True)


def _load_taxonomy():
    global _cached_taxonomy
    if _cached_taxonomy is None:
        if TAXONOMY_PATH.exists():
            with open(TAXONOMY_PATH) as f:
                _cached_taxonomy = json.load(f)
        else:
            _cached_taxonomy = {"top_categories": [], "mapping": {}}
    return _cached_taxonomy


def _build_url(base_url: str, path: str) -> str:
    return f"{base_url}/{path}"


def _render_sitemap_url(base_url: str, loc: str, lastmod: Optional[str], changefreq: str, priority: str) -> str:
    return f"""<url>
  <loc>{_escape_xml(_build_url(base_url, loc))}</loc>
  <lastmod>{lastmod or datetime.now(timezone.utc).strftime('%Y-%m-%d')}</lastmod>
  <changefreq>{changefreq}</changefreq>
  <priority>{priority}</priority>
</url>"""


def _static_file_response(path: Path, media_type: str) -> Optional[Response]:
    if not path.exists():
        return None
    return Response(
        content=path.read_text(encoding="utf-8"),
        media_type=media_type,
        headers={"Cache-Control": "max-age=86400"},
    )


@router.get("/sitemap.xml", include_in_schema=False)
async def get_sitemap(request: Request, db: AsyncSession = Depends(get_db)) -> Response:
    """
    US products sitemap - top 50K products by view count.

    Issue: BUY-3124
    Format: https://us.buywhere.com/product/{id}
    Priority: 0.8, Changefreq: daily
    """
    base_url = str(request.base_url).rstrip("/").replace("http://", "https://")
    us_base_url = base_url.replace(".buywhere.com", ".us.buywhere.com")
    today = datetime.now(timezone.utc).strftime('%Y-%m-%d')

    US_PRODUCT_PRIORITY = "0.8"
    US_PRODUCT_CHANGE_FREQ = "daily"
    MAX_US_PRODUCTS = 50000

    from app.models.product import ProductView

    view_count_subq = (
        select(
            ProductView.product_id,
            func.count(ProductView.id).label("view_count")
        )
        .where(ProductView.viewed_at >= datetime.now(timezone.utc) - timedelta(days=30))
        .group_by(ProductView.product_id)
        .subquery()
    )

    us_products_query = (
        select(
            Product.id,
            Product.updated_at,
            view_count_subq.c.view_count
        )
        .join(view_count_subq, Product.id == view_count_subq.c.product_id)
        .where(
            Product.is_active,
            Product.region == "us"
        )
        .order_by(view_count_subq.c.view_count.desc())
        .limit(MAX_US_PRODUCTS)
    )

    result = await db.execute(us_products_query)
    us_products = result.all()

    sitemap_entries: list[str] = []

    sitemap_entries.append(_render_sitemap_url(
        us_base_url,
        "",
        today,
        "hourly",
        "1.0",
    ))

    sitemap_entries.append(_render_sitemap_url(
        us_base_url,
        "api/v1",
        today,
        "hourly",
        "0.9",
    ))

    sitemap_entries.append(_render_sitemap_url(
        us_base_url,
        "api/v1/categories",
        today,
        "daily",
        "0.9",
    ))

    sitemap_entries.append(_render_sitemap_url(
        us_base_url,
        "api/v1/deals",
        today,
        "daily",
        "0.8",
    ))

    sitemap_entries.append(_render_sitemap_url(
        us_base_url,
        "api/v1/products/trending",
        today,
        "daily",
        "0.7",
    ))

    sitemap_entries.append(_render_sitemap_url(
        us_base_url,
        "compare/diff",
        today,
        "daily",
        "0.8",
    ))

    for p in us_products:
        lastmod = p.updated_at.strftime('%Y-%m-%d') if p.updated_at else today
        sitemap_entries.append(_render_sitemap_url(
            us_base_url,
            f"product/{p.id}",
            lastmod,
            US_PRODUCT_CHANGE_FREQ,
            US_PRODUCT_PRIORITY,
        ))

    sitemap_xml = f"""<?xml version="1.0" encoding="UTF-8"?>
<!-- US Products Sitemap - Top 50K by view count - Generated: {datetime.now(timezone.utc).isoformat()} -->
<!-- Total US products in sitemap: {len(us_products)} -->
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
{chr(10).join(sitemap_entries)}
</urlset>"""

    return Response(
        content=sitemap_xml,
        media_type="application/xml",
        headers={"Cache-Control": "max-age=86400"},
    )


@router.get("/sitemap-us.xml", include_in_schema=False)
async def get_sitemap_us(request: Request, db: AsyncSession = Depends(get_db)) -> Response:
    static_response = _static_file_response(STATIC_DIR / "sitemap-us.xml", "application/xml")
    if static_response is not None:
        return static_response

    base_url = str(request.base_url).rstrip("/")
    today = datetime.now(timezone.utc).strftime('%Y-%m-%d')

    result_count = await db.execute(
        select(func.count(Product.id)).where(
            Product.is_active,
            Product.region == "us"
        )
    )
    total_products = result_count.scalar_one()

    sitemap_entries: list[str] = []

    sitemap_entries.append(_render_sitemap_url(
        base_url,
        "",
        today,
        "hourly",
        "1.0",
    ))

    sitemap_entries.append(_render_sitemap_url(
        base_url,
        "api/v1",
        today,
        "hourly",
        "0.9",
    ))

    sitemap_entries.append(_render_sitemap_url(
        base_url,
        "us",
        today,
        "hourly",
        "1.0",
    ))

    sitemap_entries.append(_render_sitemap_url(
        base_url,
        "us-electronics",
        today,
        "daily",
        "0.8",
    ))

    sitemap_entries.append(_render_sitemap_url(
        base_url,
        "us-fashion",
        today,
        "daily",
        "0.8",
    ))

    sitemap_entries.append(_render_sitemap_url(
        base_url,
        "us-grocery",
        today,
        "daily",
        "0.8",
    ))

    sitemap_entries.append(_render_sitemap_url(
        base_url,
        "api/v1/categories",
        today,
        "daily",
        "0.9",
    ))

    sitemap_entries.append(_render_sitemap_url(
        base_url,
        "api/v1/deals",
        today,
        "daily",
        "0.8",
    ))

    sitemap_entries.append(_render_sitemap_url(
        base_url,
        "api/v1/products/trending",
        today,
        "daily",
        "0.7",
    ))

    sitemap_entries.append(_render_sitemap_url(
        base_url,
        "compare/diff",
        today,
        "daily",
        "0.8",
    ))

    product_batch_size = 5000
    for offset in range(0, total_products, product_batch_size):
        batch_result = await db.execute(
            select(Product.id, Product.updated_at)
            .where(
                Product.is_active,
                Product.region == "us"
            )
            .order_by(Product.id)
            .limit(product_batch_size)
            .offset(offset)
        )
        batch_products = batch_result.all()

        for p in batch_products:
            lastmod = p.updated_at.strftime('%Y-%m-%d') if p.updated_at else today
            sitemap_entries.append(_render_sitemap_url(
                base_url,
                f"api/v1/products/{p.id}",
                lastmod,
                SITEMAP_CHANGE_FREQ,
                SITEMAP_PRODUCT_PRIORITY,
            ))

    sitemap_xml = f"""<?xml version="1.0" encoding="UTF-8"?>
<!-- US Products Sitemap - Generated: {datetime.now(timezone.utc).isoformat()} -->
<!-- Total US products: {total_products} -->
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
{chr(10).join(sitemap_entries)}
</urlset>"""

    return Response(
        content=sitemap_xml,
        media_type="application/xml",
        headers={"Cache-Control": "max-age=86400"},
    )


@router.get("/sitemap-compare.xml", include_in_schema=False)
async def get_sitemap_compare(request: Request, db: AsyncSession = Depends(get_db)) -> Response:
    """SEO sitemap for compare page slugs (BUY-4903)."""
    base_url = str(request.base_url).rstrip("/").replace("http://", "https://")
    today = datetime.now(timezone.utc).strftime('%Y-%m-%d')

    result = await db.execute(
        select(ComparisonPage.slug, ComparisonPage.updated_at)
        .where(ComparisonPage.status == "published")
        .order_by(ComparisonPage.updated_at.desc())
    )
    pages = result.all()

    entries = []
    for page in pages:
        lastmod = page.updated_at.strftime('%Y-%m-%d') if page.updated_at else today
        entries.append(_render_sitemap_url(
            base_url,
            f"compare/{page.slug}",
            lastmod,
            "daily",
            "0.8"
        ))

    sitemap_xml = f"""<?xml version="1.0" encoding="UTF-8"?>
<!-- sitemap-compare.xml — BuyWhere compare pages -->
<!-- Generated: {datetime.now(timezone.utc).isoformat()} -->
<!-- Total pages: {len(pages)} -->
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
{chr(10).join(entries)}
</urlset>"""

    return Response(
        content=sitemap_xml,
        media_type="application/xml",
        headers={"Cache-Control": "max-age=86400"},
    )


@router.get("/robots.txt", include_in_schema=False)
async def get_robots(request: Request) -> Response:
    static_response = _static_file_response(STATIC_DIR / "robots.txt", "text/plain")
    if static_response is not None:
        return static_response

    base_url = str(request.base_url).rstrip("/")
    robots_txt = f"""User-agent: *
Allow: /

Sitemap: {base_url}/sitemap.xml
Sitemap: {base_url}/sitemap-us.xml
Sitemap: {base_url}/sitemap-compare.xml
"""
    return Response(
        content=robots_txt,
        media_type="text/plain",
        headers={"Cache-Control": "max-age=86400"},
    )
