from fastapi import APIRouter, Depends, Request
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_api_key
from app.database import get_db
from app.models.product import ApiKey, Product
from app.rate_limit import limiter
from app.schemas.product import CategoryNode, CategoryResponse

router = APIRouter(prefix="/v1/categories", tags=["categories"])


@router.get("", response_model=CategoryResponse, summary="List available categories")
@limiter.limit("1000/minute")
async def list_categories(
    request: Request,
    db: AsyncSession = Depends(get_db),
    api_key: ApiKey = Depends(get_current_api_key),
) -> CategoryResponse:
    request.state.api_key = api_key

    # Get category counts for active products
    result = await db.execute(
        select(Product.category, func.count(Product.id).label("count"))
        .where(Product.is_active == True, Product.category.isnot(None))
        .group_by(Product.category)
        .order_by(func.count(Product.id).desc())
    )
    rows = result.all()

    nodes = [CategoryNode(name=row.category, count=row.count) for row in rows]

    return CategoryResponse(categories=nodes, total=len(nodes))
