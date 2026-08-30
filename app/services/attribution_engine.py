"""Linkless referral attribution decision engine.

Runs synchronously on each conversion POST. Matches conversions to referral
intents using deterministic methods only (v1):

  1. Exact promo code match
  2. Exact referral token match
  3. Exact session match (via session_claims)
  4. No match → unattributed
"""

import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Optional

from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.linkless_attribution import (
    CommissionDecision,
    LinklessConversion,
    PromoCodeReservation,
    ReferralIntent,
    SessionClaim,
)

# Default lookback window (days) from referral intent creation
LOOKBACK_DAYS = 30

# Default commission rate when merchant-specific rate isn't configured
DEFAULT_COMMISSION_RATE = Decimal("0.05")

# Fraud guard: flag conversions above this threshold (SGD)
MANUAL_REVIEW_THRESHOLD = Decimal("5000")


async def attribute_conversion(
    db: AsyncSession,
    conversion: LinklessConversion,
    merchant_commission_rate: Optional[Decimal] = None,
) -> Optional[CommissionDecision]:
    """Run the attribution decision engine for a single conversion.

    Returns a CommissionDecision if attribution succeeds, None if unattributed.
    """
    now = datetime.now(timezone.utc)
    lookback_cutoff = conversion.converted_at - timedelta(days=LOOKBACK_DAYS)
    commission_rate = merchant_commission_rate or DEFAULT_COMMISSION_RATE

    # 1. Exact promo code match
    if conversion.promo_codes_used:
        intent = await _match_promo_code(db, conversion, lookback_cutoff)
        if intent:
            return await _create_decision(
                db, conversion, intent,
                session_claim_id=None,
                match_method="promo_code",
                commission_rate=commission_rate,
                reason=f"Exclusive promo code matched to agent referral intent",
            )

    # 2. Exact referral token match
    if conversion.referral_token:
        intent = await _match_referral_token(db, conversion, lookback_cutoff)
        if intent:
            return await _create_decision(
                db, conversion, intent,
                session_claim_id=None,
                match_method="token",
                commission_rate=commission_rate,
                reason=f"Referral token {conversion.referral_token} matched to agent intent",
            )

    # 3. Exact session match via session_claims
    if conversion.merchant_session_id:
        intent, claim = await _match_session(db, conversion, lookback_cutoff)
        if intent and claim:
            return await _create_decision(
                db, conversion, intent,
                session_claim_id=claim.id,
                match_method="session",
                commission_rate=commission_rate,
                reason=f"Session {conversion.merchant_session_id} matched via session claim",
            )

    # 4. No match
    return None


async def _match_promo_code(
    db: AsyncSession,
    conversion: LinklessConversion,
    lookback_cutoff: datetime,
) -> Optional[ReferralIntent]:
    """Match by promo code. Exclusive reservations take priority."""
    promo_codes = conversion.promo_codes_used or []

    # First check exclusive reservations
    for code in promo_codes:
        result = await db.execute(
            select(PromoCodeReservation).where(
                and_(
                    PromoCodeReservation.merchant_id == conversion.merchant_id,
                    PromoCodeReservation.code == code,
                    PromoCodeReservation.is_exclusive == True,
                )
            )
        )
        reservation = result.scalar_one_or_none()
        if reservation:
            # Find the intent from this agent with this promo code
            intent_result = await db.execute(
                select(ReferralIntent).where(
                    and_(
                        ReferralIntent.api_key_id == reservation.api_key_id,
                        ReferralIntent.merchant_id == conversion.merchant_id,
                        ReferralIntent.promo_code == code,
                        ReferralIntent.created_at >= lookback_cutoff,
                    )
                ).order_by(ReferralIntent.created_at.desc()).limit(1)
            )
            intent = intent_result.scalar_one_or_none()
            if intent:
                return intent

    # Fall back to any intent with a matching promo code (last-touch)
    for code in promo_codes:
        result = await db.execute(
            select(ReferralIntent).where(
                and_(
                    ReferralIntent.merchant_id == conversion.merchant_id,
                    ReferralIntent.promo_code == code,
                    ReferralIntent.created_at >= lookback_cutoff,
                )
            ).order_by(ReferralIntent.created_at.desc()).limit(1)
        )
        intent = result.scalar_one_or_none()
        if intent:
            return intent

    return None


async def _match_referral_token(
    db: AsyncSession,
    conversion: LinklessConversion,
    lookback_cutoff: datetime,
) -> Optional[ReferralIntent]:
    """Match by exact referral token."""
    result = await db.execute(
        select(ReferralIntent).where(
            and_(
                ReferralIntent.referral_token == conversion.referral_token,
                ReferralIntent.created_at >= lookback_cutoff,
            )
        )
    )
    return result.scalar_one_or_none()


async def _match_session(
    db: AsyncSession,
    conversion: LinklessConversion,
    lookback_cutoff: datetime,
) -> tuple[Optional[ReferralIntent], Optional[SessionClaim]]:
    """Match by merchant session ID via session_claims table."""
    result = await db.execute(
        select(SessionClaim).where(
            and_(
                SessionClaim.merchant_id == conversion.merchant_id,
                SessionClaim.merchant_session_id == conversion.merchant_session_id,
            )
        ).order_by(SessionClaim.claimed_at.desc()).limit(1)
    )
    claim = result.scalar_one_or_none()
    if not claim:
        return None, None

    # Find the referral intent that this session claim points to
    intent_result = await db.execute(
        select(ReferralIntent).where(
            and_(
                ReferralIntent.referral_token == claim.referral_token,
                ReferralIntent.created_at >= lookback_cutoff,
            )
        )
    )
    intent = intent_result.scalar_one_or_none()
    return intent, claim


async def _create_decision(
    db: AsyncSession,
    conversion: LinklessConversion,
    intent: ReferralIntent,
    session_claim_id: Optional[str],
    match_method: str,
    commission_rate: Decimal,
    reason: str,
) -> CommissionDecision:
    """Create and persist a commission decision."""
    commissionable = conversion.subtotal - (conversion.discount_amount or Decimal("0"))
    commission_amount = commissionable * commission_rate

    status = "pending"
    if commissionable > MANUAL_REVIEW_THRESHOLD:
        status = "flagged"

    decision = CommissionDecision(
        id=str(uuid.uuid4()),
        conversion_id=conversion.id,
        referral_intent_id=intent.id,
        session_claim_id=session_claim_id,
        api_key_id=intent.api_key_id,
        match_method=match_method,
        match_confidence="deterministic",
        commissionable_amount=commissionable,
        commission_rate=commission_rate,
        commission_amount=commission_amount,
        currency=conversion.currency,
        status=status,
        reason_code=reason,
    )
    db.add(decision)
    await db.flush()
    return decision
