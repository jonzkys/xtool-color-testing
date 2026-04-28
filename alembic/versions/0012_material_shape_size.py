"""Add optional shape + size columns to materials.

Powers the new Tests-page auto-fit feature: when a material has its
shape and dimensions on file, the test editor can size the generated
grid to fit the material (minus a user buffer) automatically. All four
columns are nullable so existing materials need no backfill — they
keep showing up as "no shape configured" in the UI and the auto-fit
toggle stays disabled until the user opens the Library page and adds
a shape.

Revision ID: 0012
Revises: 0011
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0012"
down_revision = "0011"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # batch_alter_table for SQLite-compatible add-column. All four
    # columns are nullable so the change is non-blocking on MySQL too —
    # no row rewrite, just a metadata-only ALTER.
    with op.batch_alter_table("materials") as batch:
        batch.add_column(sa.Column("shape", sa.String(length=8), nullable=True))
        batch.add_column(sa.Column("diameter_mm", sa.Float(), nullable=True))
        batch.add_column(sa.Column("width_mm", sa.Float(), nullable=True))
        batch.add_column(sa.Column("height_mm", sa.Float(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("materials") as batch:
        batch.drop_column("height_mm")
        batch.drop_column("width_mm")
        batch.drop_column("diameter_mm")
        batch.drop_column("shape")
