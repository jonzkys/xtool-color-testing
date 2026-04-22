"""users table for alpha bearer-token auth.

The api_key is both the primary key AND the owner_id value that other
tables already store. Keeping the key *as* the id means there's no
lookup from "credential" to "user id" — the credential is the id.

Revision ID: 0003
Revises: 0002
Create Date: 2026-04-22
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("api_key", sa.Text(), nullable=False),
        sa.Column("first_name", sa.Text(), nullable=False, server_default=""),
        sa.Column("created_at", sa.Text(), nullable=False),
        sa.Column("last_seen_at", sa.Text(), nullable=False),
        sa.PrimaryKeyConstraint("api_key"),
    )


def downgrade() -> None:
    op.drop_table("users")
