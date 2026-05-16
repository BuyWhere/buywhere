"""Push notifications router for browser push notification subscriptions."""
import uuid
import base64
import json
from datetime import datetime
from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field
from pywebpush import webpush
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_api_key
from app.database import get_db
from app.models.product import ApiKey
from app.models.push_subscription import PushSubscription
from app.config import get_settings

router = APIRouter(prefix="/v1/push", tags=["push"])

settings = get_settings()


class PushSubscriptionRequest(BaseModel):
    endpoint: str
    p256dh: str = Field(..., description="Browser push subscription p256dh key")
    auth: str = Field(..., description="Browser push subscription auth key")
    user_id: Optional[str] = None


class PushSubscriptionResponse(BaseModel):
    id: str
    endpoint: str
    is_active: bool
    created_at: datetime


class VapidKeyResponse(BaseModel):
    public_key: str


class SendPushRequest(BaseModel):
    endpoint: str
    title: str = Field(..., description="Notification title")
    body: str = Field(..., description="Notification body")
    icon: Optional[str] = Field(None, description="Notification icon URL")
    data: Optional[dict] = None


class SendPushResponse(BaseModel):
    success: bool
    message: str


@router.get("/vapid-key", response_model=VapidKeyResponse, summary="Get VAPID public key for browser subscription")
async def get_vapid_key():
    """Return the VAPID public key for browsers to use when subscribing."""
    if not settings.web_push_enabled:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Push notifications are not enabled",
        )
    
    if not settings.web_push_vapid_public_key:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="VAPID keys not configured",
        )
    
    return VapidKeyResponse(public_key=settings.web_push_vapid_public_key)


@router.post("/subscribe", response_model=PushSubscriptionResponse, status_code=status.HTTP_201_CREATED, summary="Subscribe to push notifications")
async def subscribe_to_push(
    request: Request,
    body: PushSubscriptionRequest,
    db: AsyncSession = Depends(get_db),
    api_key: ApiKey = Depends(get_current_api_key),
) -> PushSubscriptionResponse:
    """Subscribe a browser to push notifications."""
    if not settings.web_push_enabled:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Push notifications are not enabled",
        )
    
    user_id = body.user_id or api_key.developer_id
    
    existing = await db.execute(
        select(PushSubscription).where(
            PushSubscription.endpoint == body.endpoint,
        )
    )
    existing_sub = existing.scalar_one_or_none()
    
    if existing_sub:
        existing_sub.p256dh = body.p256dh
        existing_sub.auth = body.auth
        existing_sub.user_id = user_id
        existing_sub.is_active = True
        existing_sub.updated_at = datetime.utcnow()
        await db.commit()
        await db.refresh(existing_sub)
        return PushSubscriptionResponse(
            id=existing_sub.id,
            endpoint=existing_sub.endpoint,
            is_active=existing_sub.is_active,
            created_at=existing_sub.created_at,
        )
    
    sub_id = str(uuid.uuid4())
    sub = PushSubscription(
        id=sub_id,
        user_id=user_id,
        endpoint=body.endpoint,
        p256dh=body.p256dh,
        auth=body.auth,
        is_active=True,
    )
    db.add(sub)
    await db.commit()
    await db.refresh(sub)
    
    return PushSubscriptionResponse(
        id=sub.id,
        endpoint=sub.endpoint,
        is_active=sub.is_active,
        created_at=sub.created_at,
    )


@router.delete("/unsubscribe", status_code=status.HTTP_204_NO_CONTENT, summary="Unsubscribe from push notifications")
async def unsubscribe_from_push(
    request: Request,
    endpoint: str,
    db: AsyncSession = Depends(get_db),
    api_key: ApiKey = Depends(get_current_api_key),
):
    """Unsubscribe a browser from push notifications."""
    if not settings.web_push_enabled:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Push notifications are not enabled",
        )
    
    result = await db.execute(
        select(PushSubscription).where(
            PushSubscription.endpoint == endpoint,
        )
    )
    sub = result.scalar_one_or_none()
    
    if sub:
        sub.is_active = False
        sub.updated_at = datetime.utcnow()
        await db.commit()
    
    return None


@router.get("/subscriptions", summary="List push subscriptions")
async def list_subscriptions(
    request: Request,
    db: AsyncSession = Depends(get_db),
    api_key: ApiKey = Depends(get_current_api_key),
):
    """List all push subscriptions for the current API key."""
    if not settings.web_push_enabled:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Push notifications are not enabled",
        )
    
    result = await db.execute(
        select(PushSubscription).where(
            PushSubscription.user_id == api_key.developer_id,
            PushSubscription.is_active.is_(True),
        )
    )
    subscriptions = result.scalars().all()
    
    return {
        "count": len(subscriptions),
        "subscriptions": [
            {
                "id": s.id,
                "endpoint": s.endpoint,
                "is_active": s.is_active,
                "created_at": s.created_at.isoformat() if s.created_at else None,
            }
            for s in subscriptions
        ]
    }


@router.post("/send", response_model=SendPushResponse, summary="Send push notification to a subscription")
async def send_push_notification(
    request: Request,
    body: SendPushRequest,
    db: AsyncSession = Depends(get_db),
    api_key: ApiKey = Depends(get_current_api_key),
):
    """Send a push notification to a subscribed browser endpoint."""
    if not settings.web_push_enabled:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Push notifications are not enabled",
        )
    
    if not settings.web_push_vapid_private_key:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="VAPID keys not configured",
        )
    
    sub_result = await db.execute(
        select(PushSubscription).where(
            PushSubscription.endpoint == body.endpoint,
            PushSubscription.is_active.is_(True),
        )
    )
    sub = sub_result.scalar_one_or_none()
    
    if not sub:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Subscription not found or inactive",
        )
    
    payload = json.dumps({
        "title": body.title,
        "body": body.body,
        "icon": body.icon or "/icon.png",
        "data": body.data or {},
    })
    
    try:
        webpush(
            subscription_info={
                "endpoint": sub.endpoint,
                "keys": {
                    "p256dh": sub.p256dh,
                    "auth": sub.auth,
                }
            },
            data=payload,
            vapid_private_key=settings.web_push_vapid_private_key,
            vapid_claims={
                "sub": settings.web_push_vapid_subject or "mailto:alerts@buywhere.ai",
            },
        )
        return SendPushResponse(success=True, message="Push notification sent")
    except Exception as e:
        return SendPushResponse(success=False, message=f"Failed to send push: {str(e)}")
