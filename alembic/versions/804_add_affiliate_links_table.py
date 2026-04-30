"""Add affiliate_links table

Revision ID: 804_add_affiliate_links_table
Revises: 803ce1369b8a
Create Date: 2026-04-16
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "804_add_affiliate_links_table"
down_revision: Union[str, None] = "056_804_bridge"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "affiliate_links",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("product_id", sa.BigInteger(), nullable=False),
        sa.Column("platform", sa.Text(), nullable=False),
        sa.Column("raw_url", sa.Text(), nullable=False),
        sa.Column("affiliate_url", sa.Text(), nullable=False),
        sa.Column("tracking_id", sa.Text(), nullable=True),
        sa.Column("program", sa.Text(), nullable=False),
        sa.Column("commission_pct", sa.Numeric(5, 2), nullable=False, server_default="0"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("product_id", name="uq_affiliate_links_product_id"),
    )
    op.create_index("idx_affiliate_links_product_id", "affiliate_links", ["product_id"])
    op.create_index("idx_affiliate_links_platform", "affiliate_links", ["platform"])
    op.create_index("idx_affiliate_links_created_at", "affiliate_links", ["created_at"])


def downgrade() -> None:
    op.drop_index("idx_affiliate_links_created_at", table_name="affiliate_links")
    op.drop_index("idx_affiliate_links_platform", table_name="affiliate_links")
    op.drop_index("idx_affiliate_links_product_id", table_name="affiliate_links")
    op.drop_table("affiliate_links")
