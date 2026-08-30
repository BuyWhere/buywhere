"""Stripe billing endpoints for BuyWhere tier upgrades."""
import logging
from typing import Optional

import stripe
from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_api_key
from app.config import get_settings
from app.database import get_db
from app.models.product import ApiKey, Developer
from app.services.analytics import post_hog

logger = logging.getLogger("buywhere_api")
router = APIRouter(prefix="/billing", tags=["billing"])

TIERS_RESPONSE = {
    "tiers": [
        {
            "id": "free",
            "name": "Free",
            "price_sgd": 0,
            "rate_limit_rpm": 60,
            "features": ["60 req/min", "Basic catalog access"],
        },
        {
            "id": "pro",
            "name": "Pro",
            "price_sgd": 49,
            "rate_limit_rpm": 600,
            "features": ["600 req/min", "Full catalog", "Priority support"],
        },
        {
            "id": "enterprise",
            "name": "Enterprise",
            "price_sgd": None,
            "rate_limit_rpm": None,
            "features": ["Unlimited", "Dedicated support", "SLA"],
        },
    ],
    "currency": "SGD",
}


@router.get("/tiers", summary="List available billing tiers")
async def get_tiers():
    return TIERS_RESPONSE


@router.get("/status", summary="Get current billing status for the authenticated key")
async def get_billing_status(
    api_key: ApiKey = Depends(get_current_api_key),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Developer).where(Developer.id == api_key.developer_id)
    )
    developer = result.scalar_one_or_none()
    plan = developer.plan if developer else "free"
    return {"plan": plan, "tier": api_key.tier}


class UpgradeRequest(BaseModel):
    plan: str = "pro"


@router.post("/upgrade", summary="Create Stripe checkout session for tier upgrade")
async def create_upgrade_session(
    body: UpgradeRequest,
    api_key: ApiKey = Depends(get_current_api_key),
    db: AsyncSession = Depends(get_db),
):
    settings = get_settings()

    if not settings.stripe_secret_key:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Billing not configured — contact support@buywhere.ai",
        )
    if not settings.stripe_pro_price_id:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Pro price not configured — contact support@buywhere.ai",
        )
    if body.plan != "pro":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unsupported plan: {body.plan}. Only 'pro' is available.",
        )

    result = await db.execute(
        select(Developer).where(Developer.id == api_key.developer_id)
    )
    developer = result.scalar_one_or_none()

    stripe.api_key = settings.stripe_secret_key
    try:
        session = stripe.checkout.Session.create(
            mode="subscription",
            line_items=[{"price": settings.stripe_pro_price_id, "quantity": 1}],
            metadata={
                "developer_id": api_key.developer_id,
                "api_key_id": api_key.id,
            },
            customer_email=developer.email if developer else None,
            success_url=settings.stripe_success_url,
            cancel_url=settings.stripe_cancel_url,
        )
    except stripe.StripeError as e:
        logger.error("Stripe checkout session creation failed: %s", e)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Payment provider error — please try again",
        )

    post_hog.track_upgrade_intent(
        developer_id=api_key.developer_id,
        current_tier=api_key.tier,
        api_key_id=api_key.id,
    )

    return {"checkout_url": session.url, "session_id": session.id}


@router.post("/webhook", summary="Stripe webhook receiver", include_in_schema=False)
async def stripe_webhook(request: Request, db: AsyncSession = Depends(get_db)):
    settings = get_settings()

    payload = await request.body()
    sig = request.headers.get("stripe-signature", "")

    if settings.stripe_webhook_secret:
        try:
            event = stripe.Webhook.construct_event(
                payload, sig, settings.stripe_webhook_secret
            )
        except stripe.SignatureVerificationError:
            raise HTTPException(status_code=400, detail="Invalid signature")
        except Exception as e:
            logger.error("Webhook parse error: %s", e)
            raise HTTPException(status_code=400, detail="Bad webhook payload")
    else:
        import json
        try:
            event = json.loads(payload)
        except Exception:
            raise HTTPException(status_code=400, detail="Bad webhook payload")

    event_type = event.get("type") if isinstance(event, dict) else event.type

    if event_type == "checkout.session.completed":
        session = event["data"]["object"] if isinstance(event, dict) else event.data.object
        developer_id: Optional[str] = (
            session.get("metadata", {}).get("developer_id")
            if isinstance(session, dict)
            else session.metadata.get("developer_id")
        )
        stripe_session_id = session.get("id") if isinstance(session, dict) else session.id

        if developer_id:
            await db.execute(
                update(Developer)
                .where(Developer.id == developer_id)
                .values(plan="pro")
            )
            await db.execute(
                update(ApiKey)
                .where(ApiKey.developer_id == developer_id)
                .values(tier="pro")
            )
            await db.commit()
            post_hog.track_upgrade_completed(
                developer_id=developer_id,
                stripe_session_id=stripe_session_id,
            )

    elif event_type == "customer.subscription.deleted":
        subscription = event["data"]["object"] if isinstance(event, dict) else event.data.object
        metadata = (
            subscription.get("metadata", {})
            if isinstance(subscription, dict)
            else subscription.metadata
        )
        developer_id = metadata.get("developer_id") if metadata else None

        if developer_id:
            await db.execute(
                update(Developer)
                .where(Developer.id == developer_id)
                .values(plan="free")
            )
            await db.execute(
                update(ApiKey)
                .where(ApiKey.developer_id == developer_id)
                .values(tier="basic")
            )
            await db.commit()

    return {"received": True}
