"""Add query_log table for launch window telemetry

Revision ID: 056
Revises: 055
Create Date: 2026-04-23 10:40:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import BIGINT, JSONB


revision = "056"
down_revision = "055"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "query_log",
        sa.Column("id", BIGINT, primary_key=True, autoincrement=True),
        sa.Column("api_key_id", sa.String(), sa.Index("idx_query_log_api_key_id"), nullable=True),
        sa.Column("path", sa.Text(), nullable=False),
        sa.Column("method", sa.String(), nullable=False, server_default="GET"),
        sa.Column("status_code", sa.Integer(), nullable=False),
        sa.Column("duration_ms", sa.Numeric(10, 2), nullable=True),
        sa.Column("user_agent", sa.Text(), nullable=True),
        sa.Column("ip_address", sa.String(), nullable=True),
        sa.Column("country", sa.String(length=2), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
            index=True,
        ),
    )
    op.create_index("idx_query_log_created_at", "query_log", ["created_at"])
    op.create_index("idx_query_log_status_code", "query_log", ["status_code"])


def downgrade() -> None:
    op.drop_index("idx_query_log_status_code", table_name="query_log")
    op.drop_index("idx_query_log_created_at", table_name="query_log")
    op.drop_table("query_log")