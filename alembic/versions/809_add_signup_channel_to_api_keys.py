"""Add signup_channel to api_keys

Revision ID: 809
Revises: 808
Create Date: 2026-04-27
"""
from alembic import op
import sqlalchemy as sa

revision = "809"
down_revision = "808"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "api_keys",
        sa.Column("signup_channel", sa.String(), nullable=True, server_default=None)
    )
    op.create_index(
        "idx_api_keys_signup_channel_name",
        "api_keys",
        ["signup_channel", "name"],
        unique=False,
        if_not_exists=True,
    )


def downgrade() -> None:
    op.drop_index("idx_api_keys_signup_channel_name", table_name="api_keys")
    op.drop_column("api_keys", "signup_channel")
