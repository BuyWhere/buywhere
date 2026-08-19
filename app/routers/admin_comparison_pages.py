from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any
from datetime import datetime, timezone
from decimal import Decimal

from sqlalchemy import select, update, delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.product import ComparisonPage, Product
from app.config import get_settings

settings = get_settings()
ADMIN_SECRET = settings.jwt_secret_key

router = APIRouter(prefix="/admin/comparison-pages", tags=["admin-comparison-pages"])


class ComparisonPageCreate(BaseModel):
    slug: str = Field(..., description="URL slug (e.g. nintendo-switch-2)")
    category: str = Field(default="general")
    status: str = Field(default="draft")
    product_ids: List[int] = Field(default_factory=list)
    expert_summary: Optional[str] = None
    hero_image_url: Optional[str] = None
    metadata: Optional[Dict[str, Any]] = None


class ComparisonPageUpdate(BaseModel):
    category: Optional[str] = None
    status: Optional[str] = None
    product_ids: Optional[List[int]] = None
    expert_summary: Optional[str] = None
    hero_image_url: Optional[str] = None
    metadata: Optional[Dict[str, Any]] = None


class ComparisonPageResponse(BaseModel):
    id: int
    slug: str
    category: str
    status: str
    product_ids: List[int]
    expert_summary: Optional[str]
    hero_image_url: Optional[str]
    metadata: Optional[Dict[str, Any]]
    published_at: Optional[datetime]
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class AdminSecretHeader(BaseModel):
    admin_secret: str


def _authenticate(admin_secret: str) -> None:
    if admin_secret != ADMIN_SECRET:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Invalid admin secret"
        )


async def _verify_product_ids(db: AsyncSession, product_ids: List[int]) -> tuple[int, int]:
    if not product_ids:
        return 0, 0
    result = await db.execute(
        select(Product.id).where(
            Product.id.in_(product_ids),
            Product.is_active == True,
            Product.url.isnot(None),
        )
    )
    found_ids = set(r[0] for r in result.fetchall())
    missing = [pid for pid in product_ids if pid not in found_ids]
    return len(found_ids), len(missing)


@router.post("", response_model=ComparisonPageResponse, status_code=status.HTTP_201_CREATED)
async def create_comparison_page(
    body: ComparisonPageCreate,
    db: AsyncSession = Depends(get_db),
    admin_secret: str = "",
) -> ComparisonPageResponse:
    _authenticate(admin_secret)

    found_count, missing_count = await _verify_product_ids(db, body.product_ids)
    if missing_count > 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"{missing_count} product_id(s) not found or inactive: {[pid for pid in body.product_ids if pid not in {r[0] for r in (await db.execute(select(Product.id).where(Product.id.in_(body.product_ids)))).fetchall()}]}"
        )

    now = datetime.now(timezone.utc)
    published_at = now if body.status == "published" else None

    page = ComparisonPage(
        slug=body.slug,
        category=body.category,
        status=body.status,
        product_ids=body.product_ids,
        expert_summary=body.expert_summary,
        hero_image_url=body.hero_image_url,
        metadata_=body.metadata,
        published_at=published_at,
        created_at=now,
        updated_at=now,
    )
    db.add(page)
    await db.flush()
    await db.refresh(page)

    return ComparisonPageResponse(
        id=page.id,
        slug=page.slug,
        category=page.category,
        status=page.status,
        product_ids=list(page.product_ids or []),
        expert_summary=page.expert_summary,
        hero_image_url=page.hero_image_url,
        metadata=page.metadata_,
        published_at=page.published_at,
        created_at=page.created_at,
        updated_at=page.updated_at,
    )


@router.get("/{page_id}", response_model=ComparisonPageResponse)
async def get_comparison_page(
    page_id: int,
    db: AsyncSession = Depends(get_db),
    admin_secret: str = "",
) -> ComparisonPageResponse:
    _authenticate(admin_secret)

    result = await db.execute(
        select(ComparisonPage).where(ComparisonPage.id == page_id)
    )
    page = result.scalar_one_or_none()
    if not page:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Comparison page not found")

    return ComparisonPageResponse(
        id=page.id,
        slug=page.slug,
        category=page.category,
        status=page.status,
        product_ids=list(page.product_ids or []),
        expert_summary=page.expert_summary,
        hero_image_url=page.hero_image_url,
        metadata=page.metadata_,
        published_at=page.published_at,
        created_at=page.created_at,
        updated_at=page.updated_at,
    )


@router.get("", response_model=List[ComparisonPageResponse])
async def list_comparison_pages(
    status: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    admin_secret: str = "",
) -> list[ComparisonPageResponse]:
    _authenticate(admin_secret)

    query = select(ComparisonPage)
    if status:
        query = query.where(ComparisonPage.status == status)
    query = query.order_by(ComparisonPage.updated_at.desc())

    result = await db.execute(query)
    pages = result.scalars().all()

    return [
        ComparisonPageResponse(
            id=p.id,
            slug=p.slug,
            category=p.category,
            status=p.status,
            product_ids=list(p.product_ids or []),
            expert_summary=p.expert_summary,
            hero_image_url=p.hero_image_url,
            metadata=p.metadata_,
            published_at=p.published_at,
            created_at=p.created_at,
            updated_at=p.updated_at,
        )
        for p in pages
    ]


@router.patch("/{page_id}", response_model=ComparisonPageResponse)
async def update_comparison_page(
    page_id: int,
    body: ComparisonPageUpdate,
    db: AsyncSession = Depends(get_db),
    admin_secret: str = "",
) -> ComparisonPageResponse:
    _authenticate(admin_secret)

    result = await db.execute(
        select(ComparisonPage).where(ComparisonPage.id == page_id)
    )
    page = result.scalar_one_or_none()
    if not page:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Comparison page not found")

    update_data = body.model_dump(exclude_unset=True)
    if "product_ids" in update_data and update_data["product_ids"] is not None:
        found_count, missing_count = await _verify_product_ids(db, update_data["product_ids"])
        if missing_count > 0:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"{missing_count} product_id(s) not found or inactive"
            )

    now = datetime.now(timezone.utc)
    for field, value in update_data.items():
        if field == "metadata" and value is not None:
            setattr(page, "metadata_", value)
        elif hasattr(page, field):
            setattr(page, field, value)

    if "status" in update_data:
        if update_data["status"] == "published" and page.published_at is None:
            page.published_at = now

    page.updated_at = now
    await db.flush()
    await db.refresh(page)

    return ComparisonPageResponse(
        id=page.id,
        slug=page.slug,
        category=page.category,
        status=page.status,
        product_ids=list(page.product_ids or []),
        expert_summary=page.expert_summary,
        hero_image_url=page.hero_image_url,
        metadata=page.metadata_,
        published_at=page.published_at,
        created_at=page.created_at,
        updated_at=page.updated_at,
    )


@router.delete("/{page_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_comparison_page(
    page_id: int,
    db: AsyncSession = Depends(get_db),
    admin_secret: str = "",
) -> None:
    _authenticate(admin_secret)

    result = await db.execute(
        select(ComparisonPage).where(ComparisonPage.id == page_id)
    )
    page = result.scalar_one_or_none()
    if not page:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Comparison page not found")

    await db.execute(
        delete(ComparisonPage).where(ComparisonPage.id == page_id)
    )
    await db.flush()