"""Palette entry validated_cell_index

Adds ``validated_cell_index`` to ``palette_entries``. When a validation
test creates a fresh palette entry from the burn-mean of a particular
cell, this records *which* cell of that test the entry came from —
the existing ``validated_test_id`` only points at the test, not the
cell. Without this column the only way to navigate from a wrong-
looking validated entry back to its source cell is to compare burn
parameters by hand against every cell of the test.

Nullable so existing entries (and any future entry created outside
the batch validate path) coexist.

Revision ID: 0020
Revises: 0019
Create Date: 2026-05-04
"""
from alembic import op
import sqlalchemy as sa


revision = "0020"
down_revision = "0019"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("palette_entries", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column("validated_cell_index", sa.Integer(), nullable=True),
        )


def downgrade() -> None:
    with op.batch_alter_table("palette_entries", schema=None) as batch_op:
        batch_op.drop_column("validated_cell_index")
