"""palette_entries: favorited + nullable test_id + manual source

Adds:
  - favorited BOOLEAN NOT NULL DEFAULT 0  — per-row pin (per-user via owner_id).
  - test_id becomes nullable                — manual entries aren't tied to a test.
  - source CHECK widens to include 'manual' — manual swatches are a third source.

Revision ID: 0008
Revises: 0007
Create Date: 2026-04-25
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0008"
down_revision = "0007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("palette_entries") as batch:
        batch.add_column(
            sa.Column(
                "favorited", sa.Boolean(),
                nullable=False, server_default="0",
            ),
        )
        batch.alter_column("test_id", existing_type=sa.Integer(), nullable=True)
        batch.drop_constraint("palette_entries_source_chk", type_="check")
        batch.create_check_constraint(
            "palette_entries_source_chk",
            "source IN ('averaged','single_result','manual')",
        )


def downgrade() -> None:
    with op.batch_alter_table("palette_entries") as batch:
        batch.drop_constraint("palette_entries_source_chk", type_="check")
        batch.create_check_constraint(
            "palette_entries_source_chk",
            "source IN ('averaged','single_result')",
        )
        batch.alter_column("test_id", existing_type=sa.Integer(), nullable=False)
        batch.drop_column("favorited")
