"""add product matches table

Revision ID: 054
Revises: 053
Create Date: 2026-04-22 05:40:00.000000

"""
from alembic import op
import sqlalchemy as sa


revision = "054"
down_revision = "026_054_bridge"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS product_matches (
            id BIGSERIAL PRIMARY KEY,
            source_product_id BIGINT NOT NULL,
            matched_product_id BIGINT NOT NULL,
            confidence_score NUMERIC(5, 4) NOT NULL,
            match_method TEXT NOT NULL,
            name_similarity NUMERIC(5, 4),
            image_similarity NUMERIC(5, 4),
            price_diff_pct NUMERIC(8, 4),
            source TEXT NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT product_matches_unique UNIQUE (source_product_id, matched_product_id, source)
        )
        """
    )
    op.execute("CREATE INDEX IF NOT EXISTS idx_product_matches_source_product ON product_matches (source_product_id)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_product_matches_matched_product ON product_matches (matched_product_id)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_product_matches_confidence ON product_matches (confidence_score)")


def downgrade() -> None:
    op.drop_index("idx_product_matches_confidence", table_name="product_matches")
    op.drop_index("idx_product_matches_matched_product", table_name="product_matches")
    op.drop_index("idx_product_matches_source_product", table_name="product_matches")
    op.drop_table("product_matches")
