from datetime import date, datetime, time, timezone
from typing import Any, Dict, Literal, Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Query, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.database import get_db
from app.models.product import Product, SeoPage

settings = get_settings()
ADMIN_SECRET = settings.jwt_secret_key

router = APIRouter(prefix="/seo-pages", tags=["seo-pages"])

SeoPageStatus = Literal["draft", "review", "published"]


class SeoPageWrite(BaseModel):
    slug: str = Field(..., min_length=1, max_length=220)
    status: SeoPageStatus = "draft"
    reviewer: Optional[str] = None
    dateModified: Optional[date | datetime] = None
    page: Dict[str, Any]

    @field_validator("slug")
    @classmethod
    def normalize_slug(cls, value: str) -> str:
        slug = value.strip().strip("/")
        if not slug:
            raise ValueError("slug is required")
        return slug


class SeoPageUpdate(BaseModel):
    status: Optional[SeoPageStatus] = None
    reviewer: Optional[str] = None
    dateModified: Optional[date | datetime] = None
    page: Optional[Dict[str, Any]] = None


class SeoPageResponse(BaseModel):
    id: int
    slug: str
    status: str
    country: str
    searchQuery: str
    reviewer: Optional[str]
    dateModified: datetime
    publishedAt: Optional[datetime]
    page: Dict[str, Any]


def _coerce_datetime(value: Optional[date | datetime], fallback: datetime) -> datetime:
    if value is None:
        return fallback
    if isinstance(value, datetime):
        return value
    return datetime.combine(value, time.min, tzinfo=timezone.utc)


def _authenticate(admin_secret: str, x_admin_key: Optional[str], authorization: Optional[str]) -> None:
    bearer = ""
    if authorization and authorization.lower().startswith("bearer "):
        bearer = authorization.split(" ", 1)[1].strip()
    if admin_secret != ADMIN_SECRET and x_admin_key != ADMIN_SECRET and bearer != ADMIN_SECRET:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Invalid admin secret")


def _page_country(page: Dict[str, Any]) -> str:
    country = str(page.get("country") or "").upper()
    if country not in {"US", "SG"}:
        raise HTTPException(status_code=400, detail="page.country must be US or SG")
    return country


def _page_search_query(page: Dict[str, Any]) -> str:
    query = str(page.get("searchQuery") or "").strip()
    if not query:
        raise HTTPException(status_code=400, detail="page.searchQuery is required")
    return query


def _assert_links_are_safe(value: Any, path: str = "page") -> None:
    if isinstance(value, str):
        lowered = value.lower()
        if "http://" in lowered or "https://" in lowered:
            raise HTTPException(status_code=400, detail=f"external URL is not allowed at {path}; merchant links must use /r")
    elif isinstance(value, list):
        for index, item in enumerate(value):
            _assert_links_are_safe(item, f"{path}[{index}]")
    elif isinstance(value, dict):
        for key, item in value.items():
            key_lower = key.lower()
            if isinstance(item, str) and ("href" in key_lower or "url" in key_lower or "link" in key_lower):
                if item.startswith("http://") or item.startswith("https://"):
                    raise HTTPException(status_code=400, detail=f"merchant href at {path}.{key} must be a /r link")
                if "merchant" in key_lower and item and not item.startswith("/r"):
                    raise HTTPException(status_code=400, detail=f"merchant href at {path}.{key} must be a /r link")
            _assert_links_are_safe(item, f"{path}.{key}")


async def _priced_search_count(db: AsyncSession, page: Dict[str, Any]) -> int:
    country = _page_country(page)
    query = _page_search_query(page)
    min_price = page.get("minPrice") or 0
    query_terms = [term.strip() for term in query.split() if len(term.strip()) > 1][:6]

    predicates = [
        Product.is_active == True,
        Product.price.isnot(None),
        Product.price > min_price,
        func.upper(Product.country_code) == country,
    ]
    if query_terms:
        predicates.append(or_(*[Product.title.ilike(f"%{term}%") for term in query_terms]))

    result = await db.execute(select(func.count()).select_from(Product).where(*predicates))
    return int(result.scalar() or 0)


async def _validate_publish_gate(db: AsyncSession, page: Dict[str, Any]) -> None:
    _assert_links_are_safe(page)
    priced_count = await _priced_search_count(db, page)
    if priced_count < 6:
        raise HTTPException(
            status_code=400,
            detail=f"publish gate failed: searchQuery returned {priced_count} priced products; need >=6",
        )


def _to_response(row: SeoPage) -> SeoPageResponse:
    return SeoPageResponse(
        id=int(row.id),
        slug=row.slug,
        status=row.status,
        country=row.country,
        searchQuery=row.search_query,
        reviewer=row.reviewer,
        dateModified=row.date_modified,
        publishedAt=row.published_at,
        page=row.page,
    )


@router.get("/{slug}", response_model=SeoPageResponse)
async def get_published_seo_page(slug: str, db: AsyncSession = Depends(get_db)) -> SeoPageResponse:
    normalized_slug = slug.strip().strip("/")
    result = await db.execute(select(SeoPage).where(SeoPage.slug == normalized_slug, SeoPage.status == "published"))
    page = result.scalar_one_or_none()
    if not page:
        raise HTTPException(status_code=404, detail="SEO page not found")
    return _to_response(page)


@router.post("", response_model=SeoPageResponse, status_code=status.HTTP_201_CREATED)
async def create_seo_page(
    body: SeoPageWrite,
    db: AsyncSession = Depends(get_db),
    admin_secret: str = Query(default=""),
    x_admin_key: Optional[str] = Header(default=None),
    authorization: Optional[str] = Header(default=None),
) -> SeoPageResponse:
    _authenticate(admin_secret, x_admin_key, authorization)
    page = dict(body.page)
    page["slug"] = body.slug
    country = _page_country(page)
    search_query = _page_search_query(page)
    now = datetime.now(timezone.utc)
    if body.status == "published":
        await _validate_publish_gate(db, page)

    row = SeoPage(
        slug=body.slug,
        status=body.status,
        country=country,
        search_query=search_query,
        reviewer=body.reviewer,
        page=page,
        date_modified=_coerce_datetime(body.dateModified, now),
        published_at=now if body.status == "published" else None,
        created_at=now,
        updated_at=now,
    )
    db.add(row)
    await db.flush()
    await db.refresh(row)
    return _to_response(row)


@router.put("/{slug}", response_model=SeoPageResponse)
async def update_seo_page(
    slug: str,
    body: SeoPageUpdate,
    db: AsyncSession = Depends(get_db),
    admin_secret: str = Query(default=""),
    x_admin_key: Optional[str] = Header(default=None),
    authorization: Optional[str] = Header(default=None),
) -> SeoPageResponse:
    _authenticate(admin_secret, x_admin_key, authorization)
    normalized_slug = slug.strip().strip("/")
    result = await db.execute(select(SeoPage).where(SeoPage.slug == normalized_slug))
    row = result.scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="SEO page not found")

    next_page = dict(body.page) if body.page is not None else dict(row.page)
    next_page["slug"] = normalized_slug
    next_status = body.status or row.status
    if next_status == "published":
        await _validate_publish_gate(db, next_page)

    now = datetime.now(timezone.utc)
    row.status = next_status
    row.country = _page_country(next_page)
    row.search_query = _page_search_query(next_page)
    row.reviewer = body.reviewer if body.reviewer is not None else row.reviewer
    row.page = next_page
    row.date_modified = _coerce_datetime(body.dateModified, row.date_modified or now)
    row.published_at = row.published_at or (now if next_status == "published" else None)
    row.updated_at = now
    await db.flush()
    await db.refresh(row)
    return _to_response(row)
