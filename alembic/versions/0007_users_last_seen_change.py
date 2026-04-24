"""users.last_seen_change_id

Adds a nullable column to users tracking the most recent changelog
entry the user has dismissed. The Changelog page writes the latest
entry's id here on mount; the TopBar uses this value to decide
whether to show the "NEW" badge.

Nullable (no backfill) so existing users see every current entry as
unseen the first time the page loads after this migration.

Revision ID: 0007
Revises: 0006
Create Date: 2026-04-24
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("users") as batch:
        batch.add_column(
            sa.Column("last_seen_change_id", sa.String(length=80), nullable=True),
        )


def downgrade() -> None:
    with op.batch_alter_table("users") as batch:
        batch.drop_column("last_seen_change_id")
