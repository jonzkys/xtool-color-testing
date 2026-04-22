"""multi-user scoping: owner_id + visibility

Adds ``owner_id`` (NOT NULL) and ``visibility`` (NOT NULL, default
'private') to every user-facing table. Existing rows are backfilled
with the standalone sentinel (``_standalone``) and ``private``
visibility so existing single-user databases keep working after upgrade.

Per-table indexes on owner_id support the scoped SELECTs added alongside
this migration.

Revision ID: 0002
Revises: 0001
Create Date: 2026-04-22
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


_TABLES = ("materials", "presets", "tests", "results", "palette_entries")
_STANDALONE = "_standalone"
_VIS_CHECK = "visibility IN ('private','public')"


def upgrade() -> None:
    for table in _TABLES:
        # Step 1: add columns as nullable with server defaults so existing
        # rows pick up a value without us touching them.
        with op.batch_alter_table(table, schema=None) as batch:
            batch.add_column(
                sa.Column(
                    "owner_id",
                    sa.Text(),
                    nullable=True,
                    server_default=_STANDALONE,
                ),
            )
            batch.add_column(
                sa.Column(
                    "visibility",
                    sa.Text(),
                    nullable=False,
                    server_default="private",
                ),
            )
        # Step 2: explicitly backfill in case any driver skipped defaults.
        # Parameterized even though the value is a hardcoded literal — no
        # reason to rely on quoting rules when bind params are free.
        op.execute(
            sa.text(
                f"UPDATE {table} SET owner_id = :s WHERE owner_id IS NULL"
            ).bindparams(s=_STANDALONE),
        )
        # Step 3: tighten owner_id to NOT NULL now that every row has a
        # value, and drop the synthetic server_default so future inserts
        # must supply an owner_id explicitly (the repo layer's job).
        with op.batch_alter_table(table, schema=None) as batch:
            batch.alter_column(
                "owner_id",
                existing_type=sa.Text(),
                nullable=False,
                server_default=None,
            )
            batch.create_check_constraint(
                f"{table}_visibility_chk", _VIS_CHECK,
            )
            batch.create_index(f"ix_{table}_owner", ["owner_id"])


def downgrade() -> None:
    for table in reversed(_TABLES):
        with op.batch_alter_table(table, schema=None) as batch:
            batch.drop_index(f"ix_{table}_owner")
            batch.drop_constraint(f"{table}_visibility_chk", type_="check")
            batch.drop_column("visibility")
            batch.drop_column("owner_id")
