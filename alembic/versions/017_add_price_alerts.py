"""Add price alerts tables

Revision ID: 017
Revises: 016
Create Date: 2026-04-04
"""
from alembic import op
import sqlalchemy as sa

revision = "017"
down_revision = "006_017_bridge"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "price_alerts",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("developer_id", sa.String(), nullable=False),
        sa.Column("product_id", sa.BigInteger(), nullable=False),
        sa.Column("target_price", sa.Numeric(12, 2), nullable=False),
        sa.Column("direction", sa.String(length=10), nullable=False, server_default="below"),
        sa.Column("currency", sa.String(length=3), nullable=False, server_default="SGD"),
        sa.Column("callback_url", sa.Text(), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("triggered_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )
    op.create_index("idx_price_alerts_developer_id", "price_alerts", ["developer_id"])
    op.create_index("idx_price_alerts_product_id", "price_alerts", ["product_id"])
    op.create_index("idx_price_alerts_is_active", "price_alerts", ["is_active"])
    op.create_index("idx_price_alerts_developer_active", "price_alerts", ["developer_id", "is_active"])

    op.create_table(
        "price_alert_deliveries",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("alert_id", sa.String(), nullable=False),
        sa.Column("event_type", sa.Text(), nullable=False),
        sa.Column("payload", sa.Text(), nullable=False),
        sa.Column("status_code", sa.BigInteger(), nullable=True),
        sa.Column("response_body", sa.Text(), nullable=True),
        sa.Column("attempts", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("delivered_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("next_retry_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )
    op.create_index("idx_price_alert_deliveries_alert_id", "price_alert_deliveries", ["alert_id"])
    op.create_index("idx_price_alert_deliveries_next_retry", "price_alert_deliveries", ["next_retry_at"])


def downgrade() -> None:
    op.drop_index("idx_price_alert_deliveries_next_retry", table_name="price_alert_deliveries")
    op.drop_index("idx_price_alert_deliveries_alert_id", table_name="price_alert_deliveries")
    op.drop_table("price_alert_deliveries")

    op.drop_index("idx_price_alerts_developer_active", table_name="price_alerts")
    op.drop_index("idx_price_alerts_is_active", table_name="price_alerts")
    op.drop_index("idx_price_alerts_product_id", table_name="price_alerts")
    op.drop_index("idx_price_alerts_developer_id", table_name="price_alerts")
    op.drop_table("price_alerts")
