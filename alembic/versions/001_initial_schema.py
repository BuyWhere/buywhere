"""Initial schema: products, merchants, ingestion_runs, api_keys

Revision ID: 001
Revises:
Create Date: 2026-04-03
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "merchants",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("source", sa.String(), nullable=False),
        sa.Column("country", sa.String(2), nullable=False, server_default="SG"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )

    op.create_table(
        "products",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("sku", sa.Text(), nullable=False),
        sa.Column("source", sa.Text(), nullable=False),
        sa.Column("merchant_id", sa.Text(), nullable=False),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("price", sa.Numeric(12, 2), nullable=False),
        sa.Column("currency", sa.String(3), nullable=False, server_default="SGD"),
        sa.Column("url", sa.Text(), nullable=False),
        sa.Column("category", sa.Text(), nullable=True),
        sa.Column("category_path", postgresql.ARRAY(sa.Text()), nullable=True),
        sa.Column("image_url", sa.Text(), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("metadata", postgresql.JSONB(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("sku", "source", name="products_sku_source_unique"),
    )

    # Indexes
    op.create_index(
        "idx_products_title_fts",
        "products",
        [sa.text("to_tsvector('english', title)")],
        postgresql_using="gin",
    )
    op.create_index(
        "idx_products_category_active",
        "products",
        ["category", "is_active", "id"],
        postgresql_where=sa.text("is_active = TRUE"),
    )
    op.create_index(
        "idx_products_price_active",
        "products",
        ["price", "is_active"],
        postgresql_where=sa.text("is_active = TRUE"),
    )
    op.create_index(
        "idx_products_source_merchant",
        "products",
        ["source", "merchant_id"],
    )
    op.create_index(
        "idx_products_updated_at",
        "products",
        [sa.text("updated_at DESC")],
    )

    op.create_table(
        "ingestion_runs",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("source", sa.Text(), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("rows_inserted", sa.Integer(), nullable=True),
        sa.Column("rows_updated", sa.Integer(), nullable=True),
        sa.Column("rows_failed", sa.Integer(), nullable=True),
        sa.Column("status", sa.Text(), nullable=False, server_default="running"),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )

    op.create_table(
        "api_keys",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("key_hash", sa.String(), nullable=False),
        sa.Column("developer_id", sa.String(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("tier", sa.String(), nullable=False, server_default="basic"),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("key_hash"),
    )


def downgrade() -> None:
    op.drop_table("api_keys")
    op.drop_table("ingestion_runs")
    op.drop_index("idx_products_updated_at", table_name="products")
    op.drop_index("idx_products_source_merchant", table_name="products")
    op.drop_index("idx_products_price_active", table_name="products")
    op.drop_index("idx_products_category_active", table_name="products")
    op.drop_index("idx_products_title_fts", table_name="products")
    op.drop_table("products")
    op.drop_table("merchants")
