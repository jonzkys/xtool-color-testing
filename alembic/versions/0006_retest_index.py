"""tests.retest_index and results.retest_index

Adds a monotonically-increasing ``retest_index`` counter to tests so a
user re-burning the same test can flag each subsequent engraving with
a distinct label. The current value is embedded in the generated XCS
file's QR payload; on photo ingest the decoded index is copied onto
the result record so multi-run variability views can identify which
burn each swatch came from.

Both columns default to 0. Existing results without QR-carried data
inherit 0 and read as "the first burn" — monotonic truth only kicks
in for tests regenerated after this migration lands.

Revision ID: 0006
Revises: 0005
Create Date: 2026-04-23
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("tests") as batch:
        batch.add_column(
            sa.Column(
                "retest_index", sa.Integer(),
                nullable=False, server_default="0",
            ),
        )
    with op.batch_alter_table("results") as batch:
        batch.add_column(
            sa.Column(
                "retest_index", sa.Integer(),
                nullable=False, server_default="0",
            ),
        )


def downgrade() -> None:
    with op.batch_alter_table("results") as batch:
        batch.drop_column("retest_index")
    with op.batch_alter_table("tests") as batch:
        batch.drop_column("retest_index")
