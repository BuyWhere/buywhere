"""Add comparison_pages table for /compare/<slug> editorial pages

Revision ID: 808_add_comparison_pages_table
Revises: 804_add_affiliate_links_table
Create Date: 2026-04-27

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, ARRAY

revision: str = "808_add_comparison_pages_table"
down_revision: Union[str, None] = "804_add_affiliate_links_table"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "comparison_pages",
        sa.Column("id", sa.BigInteger, primary_key=True, autoincrement=True),
        sa.Column("slug", sa.Text, nullable=False),
        sa.Column("category", sa.Text, nullable=False, server_default="general"),
        sa.Column("status", sa.Text, nullable=False, server_default="draft"),
        sa.Column("product_ids", ARRAY(sa.BigInteger), nullable=False, server_default="{}"),
        sa.Column("expert_summary", sa.Text, nullable=True),
        sa.Column("hero_image_url", sa.Text, nullable=True),
        sa.Column("metadata", JSONB, nullable=True),
        sa.Column("published_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now(), nullable=False),
        sa.UniqueConstraint("slug", name="uq_comparison_pages_slug"),
    )
    op.create_index(
        "idx_comparison_pages_published",
        "comparison_pages",
        ["status"],
        postgresql_where=sa.text("status = 'published'"),
    )


def downgrade() -> None:
    op.drop_index("idx_comparison_pages_published", table_name="comparison_pages")
    op.drop_table("comparison_pages")
