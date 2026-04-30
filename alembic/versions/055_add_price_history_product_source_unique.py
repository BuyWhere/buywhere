"""Add unique constraint for price_history snapshot identity

Revision ID: 055
Revises: 054
Create Date: 2026-04-22 21:35:00.000000

"""
from alembic import op


revision = "055"
down_revision = "054"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        DELETE FROM price_history ph
        USING price_history duplicate
        WHERE ph.product_id = duplicate.product_id
          AND ph.source = duplicate.source
          AND ph.recorded_at = duplicate.recorded_at
          AND ph.id < duplicate.id
        """
    )
    op.create_unique_constraint(
        "price_history_product_source_unique",
        "price_history",
        ["product_id", "source", "recorded_at"],
    )


def downgrade() -> None:
    op.drop_constraint(
        "price_history_product_source_unique",
        "price_history",
        type_="unique",
    )
