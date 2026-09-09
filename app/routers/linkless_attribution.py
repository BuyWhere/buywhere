"""Linkless referral attribution API endpoints.

Agent-facing:
  POST /v1/referrals/intents       — Create referral intent; returns referral token
  GET  /v1/referrals/intents/{id}  — Get intent status and any matched conversion
  POST /v1/promo-codes/reserve     — Reserve/validate an exclusive promo code
  GET  /v1/commissions             — List agent's commission decisions (paginated)
  GET  /v1/commissions/{id}        — Get commission decision detail

Merchant-facing:
  POST /v1/referrals/session-claim — Bind referral token to merchant session
  POST /v1/conversions/linkless    — Report single linkless conversion
  POST /v1/conversions/linkless/batch — Report batch conversions (up to 100)
"""

import secrets
import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import select, func, and_
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_api_key
from app.database import get_db
from app.models.product import ApiKey
from app.models.linkless_attribution import (
    CommissionDecision,
    LinklessConversion,
    PromoCodeReservation,
    ReferralIntent,
    SessionClaim,
)
from app.services.attribution_engine import attribute_conversion

router = APIRouter(tags=["linkless-attribution"])

# Token format: bw_ref_ + 22 chars base62 ≈ 131 bits entropy
TOKEN_PREFIX = "bw_ref_"
TOKEN_EXPIRY_DAYS = 30


def _generate_referral_token() -> str:
    return TOKEN_PREFIX + secrets.token_urlsafe(16)


# ---------------------------------------------------------------------------
# Request / Response schemas
# ---------------------------------------------------------------------------

class CreateIntentRequest(BaseModel):
    merchant_id: str
    product_ids: list[int]
    channel: str = "api"
    promo_code: Optional[str] = None
    user_session_hash: Optional[str] = None
    metadata: Optional[dict] = None


class IntentResponse(BaseModel):
    id: str
    referral_token: str
    token_expires_at: str
    promo_code: Optional[str] = None
    merchant_id: str
    product_ids: list[int]
    channel: str
    created_at: str


class ReservePromoRequest(BaseModel):
    merchant_id: str
    code: str
    is_exclusive: bool = True
    valid_until: Optional[str] = None


class PromoReservationResponse(BaseModel):
    id: str
    merchant_id: str
    code: str
    is_exclusive: bool
    valid_from: str
    valid_until: Optional[str] = None


class SessionClaimRequest(BaseModel):
    referral_token: str
    merchant_session_id: str
    merchant_id: str
    ip_country: Optional[str] = None


class SessionClaimResponse(BaseModel):
    id: str
    referral_token: str
    merchant_session_id: str
    merchant_id: str
    claimed_at: str


class LineItem(BaseModel):
    product_id: Optional[int] = None
    quantity: int = 1
    amount: Decimal


class LinklessConversionRequest(BaseModel):
    order_id: str
    line_items: list[LineItem]
    subtotal: Decimal
    currency: str = "SGD"
    discount_amount: Decimal = Decimal("0")
    promo_codes_used: list[str] = Field(default_factory=list)
    referral_token: Optional[str] = None
    merchant_session_id: Optional[str] = None
    customer_status: str = "unknown"
    converted_at: str
    idempotency_key: Optional[str] = None
    metadata: Optional[dict] = None


class AttributionResult(BaseModel):
    matched: bool
    match_method: Optional[str] = None
    agent_credited: bool
    commission_amount: Optional[float] = None
    reason: Optional[str] = None


class ConversionResponse(BaseModel):
    id: str
    order_id: str
    subtotal: float
    currency: str
    attribution: AttributionResult


class CommissionResponse(BaseModel):
    id: str
    conversion_id: str
    match_method: str
    match_confidence: str
    commissionable_amount: float
    commission_rate: float
    commission_amount: float
    currency: str
    status: str
    reason_code: str
    decided_at: str


class CommissionListResponse(BaseModel):
    items: list[CommissionResponse]
    total: int
    cursor: Optional[str] = None


# ---------------------------------------------------------------------------
# Agent-facing endpoints
# ---------------------------------------------------------------------------

@router.post(
    "/referrals/intents",
    response_model=IntentResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create referral intent",
)
async def create_referral_intent(
    body: CreateIntentRequest,
    db: AsyncSession = Depends(get_db),
    api_key: ApiKey = Depends(get_current_api_key),
) -> IntentResponse:
    token = _generate_referral_token()
    expires_at = datetime.now(timezone.utc) + timedelta(days=TOKEN_EXPIRY_DAYS)
    intent_id = str(uuid.uuid4())

    intent = ReferralIntent(
        id=intent_id,
        api_key_id=api_key.id,
        merchant_id=body.merchant_id,
        product_ids=body.product_ids,
        channel=body.channel,
        promo_code=body.promo_code,
        user_session_hash=body.user_session_hash,
        referral_token=token,
        token_expires_at=expires_at,
    )
    db.add(intent)
    await db.flush()

    return IntentResponse(
        id=intent_id,
        referral_token=token,
        token_expires_at=expires_at.isoformat(),
        promo_code=body.promo_code,
        merchant_id=body.merchant_id,
        product_ids=body.product_ids,
        channel=body.channel,
        created_at=intent.created_at.isoformat() if intent.created_at else datetime.now(timezone.utc).isoformat(),
    )


@router.get(
    "/referrals/intents/{intent_id}",
    response_model=IntentResponse,
    summary="Get referral intent status",
)
async def get_referral_intent(
    intent_id: str,
    db: AsyncSession = Depends(get_db),
    api_key: ApiKey = Depends(get_current_api_key),
) -> IntentResponse:
    result = await db.execute(
        select(ReferralIntent).where(
            ReferralIntent.id == intent_id,
            ReferralIntent.api_key_id == api_key.id,
        )
    )
    intent = result.scalar_one_or_none()
    if not intent:
        raise HTTPException(status_code=404, detail="Referral intent not found")

    return IntentResponse(
        id=intent.id,
        referral_token=intent.referral_token,
        token_expires_at=intent.token_expires_at.isoformat(),
        promo_code=intent.promo_code,
        merchant_id=intent.merchant_id,
        product_ids=intent.product_ids,
        channel=intent.channel,
        created_at=intent.created_at.isoformat(),
    )


@router.post(
    "/promo-codes/reserve",
    response_model=PromoReservationResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Reserve an exclusive promo code for agent",
)
async def reserve_promo_code(
    body: ReservePromoRequest,
    db: AsyncSession = Depends(get_db),
    api_key: ApiKey = Depends(get_current_api_key),
) -> PromoReservationResponse:
    # Check for existing reservation
    existing = await db.execute(
        select(PromoCodeReservation).where(
            PromoCodeReservation.merchant_id == body.merchant_id,
            PromoCodeReservation.code == body.code,
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Promo code '{body.code}' is already reserved for this merchant",
        )

    valid_until = None
    if body.valid_until:
        valid_until = datetime.fromisoformat(body.valid_until)

    reservation_id = str(uuid.uuid4())
    reservation = PromoCodeReservation(
        id=reservation_id,
        merchant_id=body.merchant_id,
        code=body.code,
        api_key_id=api_key.id,
        is_exclusive=body.is_exclusive,
        valid_until=valid_until,
    )
    db.add(reservation)
    await db.flush()

    return PromoReservationResponse(
        id=reservation_id,
        merchant_id=body.merchant_id,
        code=body.code,
        is_exclusive=body.is_exclusive,
        valid_from=reservation.valid_from.isoformat() if reservation.valid_from else datetime.now(timezone.utc).isoformat(),
        valid_until=valid_until.isoformat() if valid_until else None,
    )


# ---------------------------------------------------------------------------
# Merchant-facing endpoints
# ---------------------------------------------------------------------------

@router.post(
    "/referrals/session-claim",
    response_model=SessionClaimResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Bind referral token to merchant session",
)
async def create_session_claim(
    body: SessionClaimRequest,
    db: AsyncSession = Depends(get_db),
    api_key: ApiKey = Depends(get_current_api_key),
) -> SessionClaimResponse:
    # Validate referral token exists and isn't expired
    result = await db.execute(
        select(ReferralIntent).where(
            ReferralIntent.referral_token == body.referral_token,
        )
    )
    intent = result.scalar_one_or_none()
    if not intent:
        raise HTTPException(status_code=404, detail="Referral token not found")
    if intent.token_expires_at < datetime.now(timezone.utc):
        raise HTTPException(status_code=410, detail="Referral token has expired")

    claim_id = str(uuid.uuid4())
    claim = SessionClaim(
        id=claim_id,
        referral_token=body.referral_token,
        merchant_session_id=body.merchant_session_id,
        merchant_id=body.merchant_id,
        ip_country=body.ip_country,
    )
    db.add(claim)
    await db.flush()

    return SessionClaimResponse(
        id=claim_id,
        referral_token=body.referral_token,
        merchant_session_id=body.merchant_session_id,
        merchant_id=body.merchant_id,
        claimed_at=claim.claimed_at.isoformat() if claim.claimed_at else datetime.now(timezone.utc).isoformat(),
    )


@router.post(
    "/conversions/linkless",
    response_model=ConversionResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Report a single linkless conversion",
)
async def report_linkless_conversion(
    body: LinklessConversionRequest,
    db: AsyncSession = Depends(get_db),
    api_key: ApiKey = Depends(get_current_api_key),
) -> ConversionResponse:
    # Derive merchant_id from the API key's developer context
    # For merchant-scoped keys, api_key.developer_id serves as merchant_id
    merchant_id = api_key.developer_id

    idempotency_key = body.idempotency_key or f"{merchant_id}:{body.order_id}"

    # Check idempotency
    existing = await db.execute(
        select(LinklessConversion).where(
            LinklessConversion.idempotency_key == idempotency_key,
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Conversion with this idempotency key already exists",
        )

    converted_at = datetime.fromisoformat(body.converted_at)
    conversion_id = str(uuid.uuid4())

    conversion = LinklessConversion(
        id=conversion_id,
        merchant_id=merchant_id,
        order_id=body.order_id,
        line_items=[item.model_dump(mode="json") for item in body.line_items],
        subtotal=body.subtotal,
        currency=body.currency,
        discount_amount=body.discount_amount,
        promo_codes_used=body.promo_codes_used,
        referral_token=body.referral_token,
        merchant_session_id=body.merchant_session_id,
        customer_status=body.customer_status,
        converted_at=converted_at,
        idempotency_key=idempotency_key,
    )
    db.add(conversion)
    await db.flush()

    # Run attribution engine
    decision = await attribute_conversion(db, conversion)

    if decision:
        attribution = AttributionResult(
            matched=True,
            match_method=decision.match_method,
            agent_credited=True,
            commission_amount=float(decision.commission_amount),
            reason=decision.reason_code,
        )
    else:
        attribution = AttributionResult(
            matched=False,
            agent_credited=False,
            reason="No matching referral intent found",
        )

    return ConversionResponse(
        id=conversion_id,
        order_id=body.order_id,
        subtotal=float(body.subtotal),
        currency=body.currency,
        attribution=attribution,
    )


@router.post(
    "/conversions/linkless/batch",
    status_code=status.HTTP_201_CREATED,
    summary="Report batch linkless conversions (up to 100)",
)
async def report_batch_conversions(
    body: list[LinklessConversionRequest],
    db: AsyncSession = Depends(get_db),
    api_key: ApiKey = Depends(get_current_api_key),
):
    if len(body) > 100:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Maximum 100 conversions per batch",
        )

    merchant_id = api_key.developer_id
    results = []

    for item in body:
        idempotency_key = item.idempotency_key or f"{merchant_id}:{item.order_id}"

        existing = await db.execute(
            select(LinklessConversion).where(
                LinklessConversion.idempotency_key == idempotency_key,
            )
        )
        if existing.scalar_one_or_none():
            results.append({
                "order_id": item.order_id,
                "status": "duplicate",
                "attribution": None,
            })
            continue

        converted_at = datetime.fromisoformat(item.converted_at)
        conversion_id = str(uuid.uuid4())

        conversion = LinklessConversion(
            id=conversion_id,
            merchant_id=merchant_id,
            order_id=item.order_id,
            line_items=[li.model_dump(mode="json") for li in item.line_items],
            subtotal=item.subtotal,
            currency=item.currency,
            discount_amount=item.discount_amount,
            promo_codes_used=item.promo_codes_used,
            referral_token=item.referral_token,
            merchant_session_id=item.merchant_session_id,
            customer_status=item.customer_status,
            converted_at=converted_at,
            idempotency_key=idempotency_key,
        )
        db.add(conversion)
        await db.flush()

        decision = await attribute_conversion(db, conversion)

        if decision:
            results.append({
                "order_id": item.order_id,
                "conversion_id": conversion_id,
                "status": "created",
                "attribution": {
                    "matched": True,
                    "match_method": decision.match_method,
                    "commission_amount": float(decision.commission_amount),
                },
            })
        else:
            results.append({
                "order_id": item.order_id,
                "conversion_id": conversion_id,
                "status": "created",
                "attribution": {"matched": False},
            })

    return {"conversions": results, "total": len(results)}


# ---------------------------------------------------------------------------
# Commission query endpoints (agent-facing)
# ---------------------------------------------------------------------------

@router.get(
    "/commissions",
    response_model=CommissionListResponse,
    summary="List agent's commission decisions",
)
async def list_commissions(
    limit: int = Query(default=20, le=100),
    offset: int = Query(default=0, ge=0),
    status_filter: Optional[str] = Query(default=None, alias="status"),
    db: AsyncSession = Depends(get_db),
    api_key: ApiKey = Depends(get_current_api_key),
) -> CommissionListResponse:
    query = select(CommissionDecision).where(
        CommissionDecision.api_key_id == api_key.id,
    )
    count_query = select(func.count(CommissionDecision.id)).where(
        CommissionDecision.api_key_id == api_key.id,
    )

    if status_filter:
        query = query.where(CommissionDecision.status == status_filter)
        count_query = count_query.where(CommissionDecision.status == status_filter)

    total_result = await db.execute(count_query)
    total = total_result.scalar() or 0

    result = await db.execute(
        query.order_by(CommissionDecision.decided_at.desc())
        .offset(offset)
        .limit(limit)
    )
    decisions = result.scalars().all()

    items = [
        CommissionResponse(
            id=d.id,
            conversion_id=d.conversion_id,
            match_method=d.match_method,
            match_confidence=d.match_confidence,
            commissionable_amount=float(d.commissionable_amount),
            commission_rate=float(d.commission_rate),
            commission_amount=float(d.commission_amount),
            currency=d.currency,
            status=d.status,
            reason_code=d.reason_code,
            decided_at=d.decided_at.isoformat(),
        )
        for d in decisions
    ]

    return CommissionListResponse(items=items, total=total)


@router.get(
    "/commissions/{commission_id}",
    response_model=CommissionResponse,
    summary="Get commission decision detail",
)
async def get_commission(
    commission_id: str,
    db: AsyncSession = Depends(get_db),
    api_key: ApiKey = Depends(get_current_api_key),
) -> CommissionResponse:
    result = await db.execute(
        select(CommissionDecision).where(
            CommissionDecision.id == commission_id,
            CommissionDecision.api_key_id == api_key.id,
        )
    )
    decision = result.scalar_one_or_none()
    if not decision:
        raise HTTPException(status_code=404, detail="Commission decision not found")

    return CommissionResponse(
        id=decision.id,
        conversion_id=decision.conversion_id,
        match_method=decision.match_method,
        match_confidence=decision.match_confidence,
        commissionable_amount=float(decision.commissionable_amount),
        commission_rate=float(decision.commission_rate),
        commission_amount=float(decision.commission_amount),
        currency=decision.currency,
        status=decision.status,
        reason_code=decision.reason_code,
        decided_at=decision.decided_at.isoformat(),
    )
