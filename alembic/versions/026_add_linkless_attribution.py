"""Add linkless referral attribution tables

Revision ID: 026
Revises: 025
Create Date: 2026-04-07
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, ARRAY

revision = "026"
down_revision = "017_026_bridge"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Referral intents — agent declares intent to refer a user to a merchant
    op.create_table(
        "referral_intents",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("api_key_id", sa.Text(), nullable=False),
        sa.Column("merchant_id", sa.Text(), nullable=False),
        sa.Column("product_ids", ARRAY(sa.BigInteger()), nullable=False),
        sa.Column("channel", sa.Text(), nullable=False, server_default="api"),
        sa.Column("promo_code", sa.Text(), nullable=True),
        sa.Column("user_session_hash", sa.Text(), nullable=True),
        sa.Column("referral_token", sa.Text(), nullable=False),
        sa.Column(
            "token_expires_at",
            sa.DateTime(timezone=True),
            nullable=False,
        ),
        sa.Column("metadata_", JSONB(), server_default="{}"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("referral_token", name="uq_referral_intents_token"),
    )
    op.create_index("idx_ri_token", "referral_intents", ["referral_token"])
    op.create_index(
        "idx_ri_promo",
        "referral_intents",
        ["promo_code"],
        postgresql_where=sa.text("promo_code IS NOT NULL"),
    )
    op.create_index("idx_ri_merchant", "referral_intents", ["merchant_id", "created_at"])
    op.create_index("idx_ri_api_key", "referral_intents", ["api_key_id"])

    # Session claims — merchant binds referral token to a shopping session
    op.create_table(
        "session_claims",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("referral_token", sa.Text(), nullable=False),
        sa.Column("merchant_session_id", sa.Text(), nullable=False),
        sa.Column("merchant_id", sa.Text(), nullable=False),
        sa.Column("ip_country", sa.Text(), nullable=True),
        sa.Column(
            "claimed_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("idx_sc_merchant_session", "session_claims", ["merchant_id", "merchant_session_id"])
    op.create_index("idx_sc_token", "session_claims", ["referral_token"])

    # Linkless conversions — merchant reports a purchase
    op.create_table(
        "linkless_conversions",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("merchant_id", sa.Text(), nullable=False),
        sa.Column("order_id", sa.Text(), nullable=False),
        sa.Column("line_items", JSONB(), nullable=False),
        sa.Column("subtotal", sa.Numeric(12, 2), nullable=False),
        sa.Column("currency", sa.Text(), nullable=False, server_default="SGD"),
        sa.Column("discount_amount", sa.Numeric(12, 2), server_default="0"),
        sa.Column("promo_codes_used", ARRAY(sa.Text()), server_default="{}"),
        sa.Column("referral_token", sa.Text(), nullable=True),
        sa.Column("merchant_session_id", sa.Text(), nullable=True),
        sa.Column("customer_status", sa.Text(), server_default="unknown"),
        sa.Column("converted_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "received_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("idempotency_key", sa.Text(), nullable=False),
        sa.Column("metadata_", JSONB(), server_default="{}"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("idempotency_key", name="uq_linkless_conv_idempotency"),
    )
    op.create_index("idx_lconv_merchant_order", "linkless_conversions", ["merchant_id", "order_id"])
    op.create_index("idx_lconv_promo", "linkless_conversions", ["promo_codes_used"], postgresql_using="gin")
    op.create_index(
        "idx_lconv_token",
        "linkless_conversions",
        ["referral_token"],
        postgresql_where=sa.text("referral_token IS NOT NULL"),
    )

    # Commission decisions — attribution result for each conversion
    op.create_table(
        "commission_decisions",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("conversion_id", sa.Text(), nullable=False),
        sa.Column("referral_intent_id", sa.Text(), nullable=True),
        sa.Column("session_claim_id", sa.Text(), nullable=True),
        sa.Column("api_key_id", sa.Text(), nullable=False),
        sa.Column("match_method", sa.Text(), nullable=False),
        sa.Column("match_confidence", sa.Text(), nullable=False, server_default="deterministic"),
        sa.Column("commissionable_amount", sa.Numeric(12, 2), nullable=False),
        sa.Column("commission_rate", sa.Numeric(5, 4), nullable=False),
        sa.Column("commission_amount", sa.Numeric(12, 2), nullable=False),
        sa.Column("currency", sa.Text(), nullable=False, server_default="SGD"),
        sa.Column("status", sa.Text(), nullable=False, server_default="pending"),
        sa.Column("reason_code", sa.Text(), nullable=False),
        sa.Column(
            "decided_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("idx_cd_conversion", "commission_decisions", ["conversion_id"])
    op.create_index("idx_cd_agent", "commission_decisions", ["api_key_id", "decided_at"])
    op.create_index(
        "idx_cd_status",
        "commission_decisions",
        ["status"],
        postgresql_where=sa.text("status IN ('pending', 'disputed')"),
    )

    # Promo code reservations — exclusive codes reserved for agents
    op.create_table(
        "promo_code_reservations",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("merchant_id", sa.Text(), nullable=False),
        sa.Column("code", sa.Text(), nullable=False),
        sa.Column("api_key_id", sa.Text(), nullable=False),
        sa.Column("is_exclusive", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column(
            "valid_from",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("valid_until", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("merchant_id", "code", name="uq_promo_merchant_code"),
    )


def downgrade() -> None:
    op.drop_table("promo_code_reservations")
    op.drop_table("commission_decisions")
    op.drop_table("linkless_conversions")
    op.drop_table("session_claims")
    op.drop_table("referral_intents")
