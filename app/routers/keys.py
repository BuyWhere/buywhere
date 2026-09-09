"""Internal endpoint for provisioning API keys — not public-facing in alpha."""
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import provision_api_key
from app.database import get_db
from app.config import get_settings

settings = get_settings()
router = APIRouter(prefix="/v1/keys", tags=["keys"])

# Simple admin secret guard for internal use
ADMIN_SECRET = settings.jwt_secret_key


class ProvisionRequest(BaseModel):
    developer_id: str
    name: str
    tier: str = "basic"
    admin_secret: str


class ProvisionResponse(BaseModel):
    key_id: str
    raw_key: str
    tier: str
    message: str


@router.post("", response_model=ProvisionResponse, summary="Provision API key (internal)")
async def create_api_key(
    body: ProvisionRequest,
    db: AsyncSession = Depends(get_db),
) -> ProvisionResponse:
    if body.admin_secret != ADMIN_SECRET:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Invalid admin secret")

    raw_key, api_key = await provision_api_key(
        developer_id=body.developer_id,
        name=body.name,
        tier=body.tier,
        db=db,
    )

    return ProvisionResponse(
        key_id=api_key.id,
        raw_key=raw_key,
        tier=api_key.tier,
        message="Store this key securely — it will not be shown again.",
    )
