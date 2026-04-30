"""Bridge migration: fill missing revision 005 in the chain

Revision ID: 005
Revises: 001_initial_schema
Create Date: 2026-04-27
"""
from typing import Sequence, Union

from alembic import op


revision = "005"
down_revision = "001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass