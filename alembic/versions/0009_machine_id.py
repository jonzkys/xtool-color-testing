"""Add machine_id to tests / palette_entries / presets

Adds machine_id VARCHAR(32) NOT NULL to each of the three tables and
backfills all existing rows to 'F2Ultra' (the only machine supported
before this migration). Adds a composite (owner_id, machine_id) index
on each since list endpoints filter by both columns.

Revision ID: 0009
Revises: 0008
Create Date: 2026-04-25
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0009"
down_revision = "0008"
branch_labels = None
depends_on = None


_MACHINE_ID_LEN = 32
_DEFAULT = "F2Ultra"


def _add_machine_column(table_name: str) -> None:
    with op.batch_alter_table(table_name) as batch:
        batch.add_column(
            sa.Column(
                "machine_id",
                sa.String(_MACHINE_ID_LEN),
                nullable=False,
                server_default=_DEFAULT,
            ),
        )
    # Belt-and-braces backfill — server_default handles new rows during
    # the ALTER on most engines, but explicitly setting it covers any
    # backend where the default isn't applied to pre-existing rows.
    op.execute(
        sa.text(
            f"UPDATE {table_name} SET machine_id = :v WHERE machine_id IS NULL OR machine_id = ''"
        ).bindparams(v=_DEFAULT)
    )


def _drop_machine_column(table_name: str) -> None:
    with op.batch_alter_table(table_name) as batch:
        batch.drop_column("machine_id")


def upgrade() -> None:
    for t in ("presets", "tests", "palette_entries"):
        _add_machine_column(t)
    op.create_index("ix_presets_owner_machine", "presets", ["owner_id", "machine_id"])
    op.create_index("ix_tests_owner_machine", "tests", ["owner_id", "machine_id"])
    op.create_index("ix_palette_entries_owner_machine", "palette_entries", ["owner_id", "machine_id"])


def downgrade() -> None:
    op.drop_index("ix_palette_entries_owner_machine", table_name="palette_entries")
    op.drop_index("ix_tests_owner_machine", table_name="tests")
    op.drop_index("ix_presets_owner_machine", table_name="presets")
    for t in ("palette_entries", "tests", "presets"):
        _drop_machine_column(t)
