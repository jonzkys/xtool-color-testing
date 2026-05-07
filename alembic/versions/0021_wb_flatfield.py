"""WB flat-field: materials + results columns

Adds the per-material calibration toggle + clean-pass burn params to
``materials``, and the per-result WB correction state to ``results``.
The new columns back the perimeter clean-pass strip + flat-field /
chromaticity correction pipeline. See
``docs/superpowers/specs/2026-05-07-wb-flatfield-design.md`` for the
full design.

All result-side columns are nullable so legacy rows ingested before
this feature continue to load. ``materials.wb_supported`` defaults
to true so existing materials opt in automatically; the per-row
``clean_pass_params_json`` falls back to the per-substrate default
in ``calibration_defaults.py`` when NULL.

Revision ID: 0021
Revises: 0020
Create Date: 2026-05-07
"""
from alembic import op
import sqlalchemy as sa


revision = "0021"
down_revision = "0020"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("materials", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column(
                "wb_supported",
                sa.Boolean(),
                nullable=False,
                server_default="1",
            ),
        )
        batch_op.add_column(
            sa.Column("clean_pass_params_json", sa.Text(), nullable=True),
        )

    with op.batch_alter_table("results", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column("wb_mode", sa.String(length=16), nullable=True),
        )
        batch_op.add_column(
            sa.Column("wb_anchor_rgb_json", sa.Text(), nullable=True),
        )
        batch_op.add_column(
            sa.Column("wb_correction_json", sa.Text(), nullable=True),
        )
        batch_op.add_column(
            sa.Column("wb_canonical_id", sa.String(length=64), nullable=True),
        )


def downgrade() -> None:
    with op.batch_alter_table("results", schema=None) as batch_op:
        batch_op.drop_column("wb_canonical_id")
        batch_op.drop_column("wb_correction_json")
        batch_op.drop_column("wb_anchor_rgb_json")
        batch_op.drop_column("wb_mode")

    with op.batch_alter_table("materials", schema=None) as batch_op:
        batch_op.drop_column("clean_pass_params_json")
        batch_op.drop_column("wb_supported")
