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
    # Use explicit VARCHAR lengths so MySQL can PK api_key (it refuses
    # TEXT as a primary key) and accept DEFAULT on first_name (error
    # 1101 on TEXT+DEFAULT). SQLite treats VARCHAR(N) the same as TEXT
    # so this change is portable. Migration 0004 drops and recreates
    # this table with a different PK anyway; these sizes just need to
    # unblock us to get there.
    op.create_table(
        "users",
        sa.Column("api_key", sa.String(length=32), nullable=False),
        sa.Column(
            "first_name",
            sa.String(length=64),
            nullable=False,
            server_default="",
        ),
        sa.Column("created_at", sa.String(length=40), nullable=False),
        sa.Column("last_seen_at", sa.String(length=40), nullable=False),
        sa.PrimaryKeyConstraint("api_key"),
    )


def downgrade() -> None:
    op.drop_table("users")
