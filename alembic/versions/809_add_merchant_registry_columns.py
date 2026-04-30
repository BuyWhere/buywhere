"""Extend merchants table with scraping metadata, contact info, and policy.

Revision ID: 809_add_merchant_registry_columns
Revises: 809_add_signup_channel_to_api_keys
Create Date: 2026-04-27
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "809_add_merchant_registry_columns"
down_revision = "809_add_signup_channel_to_api_keys"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "merchants",
        sa.Column("domain", sa.Text(), nullable=True),
    )
    op.add_column(
        "merchants",
        sa.Column("scraping_policy", postgresql.JSONB(), nullable=True),
    )
    op.add_column(
        "merchants",
        sa.Column("contact_email", sa.Text(), nullable=True),
    )
    op.add_column(
        "merchants",
        sa.Column("contact_phone", sa.Text(), nullable=True),
    )
    op.add_column(
        "merchants",
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default="true"),
    )
    op.add_column(
        "merchants",
        sa.Column("scraping_priority", sa.Text(), nullable=True),
    )
    op.add_column(
        "merchants",
        sa.Column("proxy_config", postgresql.JSONB(), nullable=True),
    )
    op.add_column(
        "merchants",
        sa.Column("last_scraped_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "merchants",
        sa.Column("scrape_error", sa.Text(), nullable=True),
    )
    op.add_column(
        "merchants",
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
    )

    op.create_index("idx_merchants_domain", "merchants", ["domain"])
    op.create_index("idx_merchants_is_active", "merchants", ["is_active"])
    op.create_index("idx_merchants_scraping_priority", "merchants", ["scraping_priority"])


def downgrade() -> None:
    op.drop_index("idx_merchants_scraping_priority", table_name="merchants")
    op.drop_index("idx_merchants_is_active", table_name="merchants")
    op.drop_index("idx_merchants_domain", table_name="merchants")
    op.drop_column("merchants", "updated_at")
    op.drop_column("merchants", "scrape_error")
    op.drop_column("merchants", "last_scraped_at")
    op.drop_column("merchants", "proxy_config")
    op.drop_column("merchants", "scraping_priority")
    op.drop_column("merchants", "is_active")
    op.drop_column("merchants", "contact_phone")
    op.drop_column("merchants", "contact_email")
    op.drop_column("merchants", "scraping_policy")
    op.drop_column("merchants", "domain")
