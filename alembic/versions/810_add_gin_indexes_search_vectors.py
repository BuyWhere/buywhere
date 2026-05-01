"""Add GIN indexes on search_vector and title_search_vector for FTS performance

Revision ID: 810
Revises: 809
Create Date: 2026-05-01

Context: BUY-6128 — /v1/products/search was hitting 2s+ latency because the
search_vector and title_search_vector TSVECTOR columns had no GIN indexes.
The existing idx_products_title_fts index was built on the expression
to_tsvector('english', title) but the query uses the stored search_vector column.
Without GIN, every search did a full sequential scan of 3.7M rows.

We also drop the old functional expression index (idx_products_title_fts) which
the query no longer uses, and the orphaned B-tree indexes on TSVECTOR columns.
"""
from alembic import op

revision = "810"
down_revision = "809"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Create GIN indexes on the stored TSVECTOR columns.
    # CONCURRENTLY avoids a full table lock on the 3.7M row catalog.
    op.execute(
        "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_products_search_vector_gin "
        "ON products USING gin(search_vector)"
    )
    op.execute(
        "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_products_title_search_vector_gin "
        "ON products USING gin(title_search_vector)"
    )

    # Drop the old functional GIN index that was on the expression
    # to_tsvector('english', title) — this is superseded by search_vector.
    op.execute(
        "DROP INDEX CONCURRENTLY IF EXISTS idx_products_title_fts"
    )

    # Drop the B-tree indexes on TSVECTOR columns created by SQLAlchemy model
    # (B-tree on tsvector is useless for @@ queries).
    op.execute(
        "DROP INDEX CONCURRENTLY IF EXISTS idx_products_search_vector"
    )
    op.execute(
        "DROP INDEX CONCURRENTLY IF EXISTS idx_products_title_search"
    )


def downgrade() -> None:
    op.execute(
        "DROP INDEX CONCURRENTLY IF EXISTS idx_products_search_vector_gin"
    )
    op.execute(
        "DROP INDEX CONCURRENTLY IF EXISTS idx_products_title_search_vector_gin"
    )
    op.execute(
        "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_products_title_fts "
        "ON products USING gin(to_tsvector('english', title))"
    )
