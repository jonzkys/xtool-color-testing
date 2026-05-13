"""add import_source column for row provenance

Revision ID: 0027
Revises: 0026
Create Date: 2026-05-13 12:37:03.790812

Adds a nullable ``import_source`` column to every user-owned table so
rows copied by automated import flows (the demo-import feature being
the first user) can be tagged for revert / idempotency. ``None`` on
all existing rows; ``"seed"`` is the first sentinel value used.
"""
from alembic import op
import sqlalchemy as sa


revision = '0027'
down_revision = '0026'
branch_labels = None
depends_on = None


_TABLES = (
    "materials",
    "presets",
    "tests",
    "results",
    "palette_entries",
    "saved_spectrums",
    "text_reg_defaults_machine",
    "text_reg_defaults_material",
)


def upgrade() -> None:
    for tbl in _TABLES:
        with op.batch_alter_table(tbl, schema=None) as batch_op:
            batch_op.add_column(
                sa.Column("import_source", sa.String(length=32), nullable=True)
            )


def downgrade() -> None:
    for tbl in reversed(_TABLES):
        with op.batch_alter_table(tbl, schema=None) as batch_op:
            batch_op.drop_column("import_source")
