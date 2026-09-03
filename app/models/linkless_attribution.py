"""SQLAlchemy models for the linkless referral attribution system."""

from sqlalchemy import (
    BigInteger, Boolean, Column, DateTime, Index, Numeric, Text, UniqueConstraint, func
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB

from app.database import Base


class ReferralIntent(Base):
    __tablename__ = "referral_intents"

    id = Column(Text, primary_key=True)
    api_key_id = Column(Text, nullable=False, index=True)
    merchant_id = Column(Text, nullable=False)
    product_ids = Column(ARRAY(BigInteger), nullable=False)
    channel = Column(Text, nullable=False, server_default="api")
    promo_code = Column(Text, nullable=True)
    user_session_hash = Column(Text, nullable=True)
    referral_token = Column(Text, nullable=False, unique=True)
    token_expires_at = Column(DateTime(timezone=True), nullable=False)
    metadata_ = Column("metadata_", JSONB, server_default="{}")
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    __table_args__ = (
        Index("idx_ri_token", "referral_token"),
        Index("idx_ri_merchant", "merchant_id", "created_at"),
        Index("idx_ri_api_key", "api_key_id"),
    )


class SessionClaim(Base):
    __tablename__ = "session_claims"

    id = Column(Text, primary_key=True)
    referral_token = Column(Text, nullable=False)
    merchant_session_id = Column(Text, nullable=False)
    merchant_id = Column(Text, nullable=False)
    ip_country = Column(Text, nullable=True)
    claimed_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    __table_args__ = (
        Index("idx_sc_merchant_session", "merchant_id", "merchant_session_id"),
        Index("idx_sc_token", "referral_token"),
    )


class LinklessConversion(Base):
    __tablename__ = "linkless_conversions"

    id = Column(Text, primary_key=True)
    merchant_id = Column(Text, nullable=False)
    order_id = Column(Text, nullable=False)
    line_items = Column(JSONB, nullable=False)
    subtotal = Column(Numeric(12, 2), nullable=False)
    currency = Column(Text, nullable=False, server_default="SGD")
    discount_amount = Column(Numeric(12, 2), server_default="0")
    promo_codes_used = Column(ARRAY(Text), server_default="{}")
    referral_token = Column(Text, nullable=True)
    merchant_session_id = Column(Text, nullable=True)
    customer_status = Column(Text, server_default="unknown")
    converted_at = Column(DateTime(timezone=True), nullable=False)
    received_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    idempotency_key = Column(Text, nullable=False, unique=True)
    metadata_ = Column("metadata_", JSONB, server_default="{}")

    __table_args__ = (
        Index("idx_lconv_merchant_order", "merchant_id", "order_id"),
        UniqueConstraint("idempotency_key", name="uq_linkless_conv_idempotency"),
    )


class CommissionDecision(Base):
    __tablename__ = "commission_decisions"

    id = Column(Text, primary_key=True)
    conversion_id = Column(Text, nullable=False)
    referral_intent_id = Column(Text, nullable=True)
    session_claim_id = Column(Text, nullable=True)
    api_key_id = Column(Text, nullable=False)
    match_method = Column(Text, nullable=False)
    match_confidence = Column(Text, nullable=False, server_default="deterministic")
    commissionable_amount = Column(Numeric(12, 2), nullable=False)
    commission_rate = Column(Numeric(5, 4), nullable=False)
    commission_amount = Column(Numeric(12, 2), nullable=False)
    currency = Column(Text, nullable=False, server_default="SGD")
    status = Column(Text, nullable=False, server_default="pending")
    reason_code = Column(Text, nullable=False)
    decided_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    __table_args__ = (
        Index("idx_cd_conversion", "conversion_id"),
        Index("idx_cd_agent", "api_key_id", "decided_at"),
    )


class PromoCodeReservation(Base):
    __tablename__ = "promo_code_reservations"

    id = Column(Text, primary_key=True)
    merchant_id = Column(Text, nullable=False)
    code = Column(Text, nullable=False)
    api_key_id = Column(Text, nullable=False)
    is_exclusive = Column(Boolean, nullable=False, server_default="true")
    valid_from = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    valid_until = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    __table_args__ = (
        UniqueConstraint("merchant_id", "code", name="uq_promo_merchant_code"),
    )
