"""Add clicks table for tracking affiliate link clicks

Revision ID: 006
Revises: 005
Create Date: 2026-04-03
"""
from alembic import op
import sqlalchemy as sa

revision = "006"
down_revision = "005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "clicks",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("tracking_id", sa.Text(), nullable=False),
        sa.Column("product_id", sa.BigInteger(), nullable=False),
        sa.Column("platform", sa.Text(), nullable=False),
        sa.Column("destination_url", sa.Text(), nullable=False),
        sa.Column("api_key_id", sa.Text(), nullable=True),
        sa.Column(
            "clicked_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("tracking_id"),
    )

    op.create_index("idx_clicks_tracking_id", "clicks", ["tracking_id"])
    op.create_index("idx_clicks_product_id", "clicks", ["product_id"])
    op.create_index("idx_clicks_clicked_at", "clicks", ["clicked_at"])


def downgrade() -> None:
    op.drop_index("idx_clicks_clicked_at", table_name="clicks")
    op.drop_index("idx_clicks_product_id", table_name="clicks")
    op.drop_index("idx_clicks_tracking_id", table_name="clicks")
    op.drop_table("clicks")