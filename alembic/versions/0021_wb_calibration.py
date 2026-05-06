"""WB calibration: materials + results columns

Adds the schema scaffolding for white-balance calibration:

  - ``materials.wb_supported`` — flag controlling whether the capture
    pipeline emits a calibration strip for tests on this material.
    Defaults to ``1`` (true); existing rows are eligible for calibration
    but stay uncalibrated until ``calibration_patches_json`` is filled.
  - ``materials.clean_pass_params_json`` — JSON-encoded BaseParams for
    the substrate-clearing pass that runs underneath each calibration
    patch. ``NULL`` falls back to the per-substrate default in
    ``calibration_defaults.py``.
  - ``materials.calibration_patches_json`` — JSON list of
    ``{label, params, canonical_rgb}`` describing the per-material
    patch set. ``NULL`` means the material isn't calibrated yet, so
    anchored mode falls back to chromaticity-only.
  - ``results.wb_mode`` — which correction strategy ran at ingest:
    ``"anchored"``, ``"chromaticity"``, ``"skipped"``, ``"disabled"``.
    ``NULL`` on legacy rows from before the feature shipped.
  - ``results.wb_anchor_rgb_json`` — the measured neutral RGB anchor
    used for chromaticity correction, or the per-patch RGBs for
    anchored mode.
  - ``results.wb_correction_json`` — the fitted per-channel correction
    (scale-only for chromaticity; affine-or-gamma for anchored).
  - ``results.wb_canonical_id`` — versioning hook for canonical-RGB
    recalibration so we can identify which canonical set produced a
    given correction (e.g. ``"v1.steel-default.2026-05-06"``).

All seven columns are nullable (or default in a way that keeps existing
rows valid) so the migration is forward-only with no backfill.

Revision ID: 0021
Revises: 0020
Create Date: 2026-05-06
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
                server_default="1",
                nullable=False,
            ),
        )
        batch_op.add_column(
            sa.Column("clean_pass_params_json", sa.Text(), nullable=True),
        )
        batch_op.add_column(
            sa.Column("calibration_patches_json", sa.Text(), nullable=True),
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
        batch_op.drop_column("calibration_patches_json")
        batch_op.drop_column("clean_pass_params_json")
        batch_op.drop_column("wb_supported")
