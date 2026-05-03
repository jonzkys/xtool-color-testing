"""Add tests.kind discriminator + validation_cells table.

Powers the new "validation" mode: a kind=validation test burns one
cell per palette entry the user picked from the material's palette
(rather than sweeping a parameter axis). The plan for each cell is
frozen at test-create time into ``validation_cells`` — one row per
planned cell, carrying the source palette_entry_id (nullable, ON
DELETE SET NULL so palette pruning doesn't kill validation history),
the expected Lab the burn should reproduce, and the param bundle the
xcs builder will write into the cell's job. Order on the burn
surface is ``cell_index`` ascending.

The ``kind`` column on ``tests`` discriminates sweep vs validation
flows; existing rows backfill to ``'sweep'`` via the server default.

Revision ID: 0015
Revises: 0014
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0015"
down_revision = "0014"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # tests.kind — discriminator column, defaults to 'sweep' so existing
    # rows are correctly classified without an explicit backfill.
    with op.batch_alter_table("tests") as batch:
        batch.add_column(
            sa.Column(
                "kind",
                sa.String(length=16),
                nullable=False,
                server_default="sweep",
            ),
        )
        batch.create_check_constraint(
            "tests_kind_chk", "kind IN ('sweep','validation')"
        )

    # validation_cells — frozen per-cell plan for kind=validation tests.
    op.create_table(
        "validation_cells",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("test_id", sa.Integer(), nullable=False),
        sa.Column("cell_index", sa.Integer(), nullable=False),
        sa.Column("palette_entry_id", sa.Integer(), nullable=True),
        sa.Column("expected_hex", sa.String(length=16), nullable=False),
        sa.Column("expected_lab_l", sa.Float(), nullable=False),
        sa.Column("expected_lab_a", sa.Float(), nullable=False),
        sa.Column("expected_lab_b", sa.Float(), nullable=False),
        sa.Column("params_json", sa.Text(), nullable=False),
        sa.ForeignKeyConstraint(
            ["palette_entry_id"], ["palette_entries.id"], ondelete="SET NULL"
        ),
        sa.ForeignKeyConstraint(["test_id"], ["tests.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "test_id", "cell_index", name="uq_validation_cells_test_cell"
        ),
    )
    with op.batch_alter_table("validation_cells") as batch:
        batch.create_index(
            "ix_validation_cells_palette_entry_id",
            ["palette_entry_id"],
            unique=False,
        )


def downgrade() -> None:
    with op.batch_alter_table("validation_cells") as batch:
        batch.drop_index("ix_validation_cells_palette_entry_id")
    op.drop_table("validation_cells")

    with op.batch_alter_table("tests") as batch:
        batch.drop_constraint("tests_kind_chk", type_="check")
        batch.drop_column("kind")
