"""Saved spectrums — persist cropped + fitted 1D sub-spectrums.

Three tables: saved_spectrums (parent metadata + indexed Lab bbox),
saved_spectrum_swatches (child, one row per data point inside the crop),
saved_spectrum_fit_coefficients (child, one row per (channel, degree)).

Indexed Lab bounding box on the parent supports the future colour-to-
spectrum predictor's per-material prefilter.

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
    op.create_table(
        "saved_spectrums",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("name", sa.String(128), nullable=False),
        sa.Column(
            "source_test_id", sa.Integer,
            sa.ForeignKey("tests.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("machine_id", sa.String(64), nullable=False, server_default="F2Ultra"),
        sa.Column(
            "material_id", sa.Integer,
            sa.ForeignKey("materials.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("owner_id", sa.Integer, nullable=False),
        sa.Column("axis_param", sa.String(32), nullable=False),
        sa.Column("axis_min", sa.Float, nullable=False),
        sa.Column("axis_max", sa.Float, nullable=False),
        sa.Column("fit_form", sa.String(32), nullable=False, server_default="polynomial"),
        sa.Column("fit_degree", sa.Integer, nullable=False),
        sa.Column("fit_l_r2", sa.Float, nullable=False),
        sa.Column("fit_a_r2", sa.Float, nullable=False),
        sa.Column("fit_b_r2", sa.Float, nullable=False),
        sa.Column("fit_r2_min", sa.Float, nullable=False),
        sa.Column("displayed_projection", sa.String(32), nullable=False),
        sa.Column("lab_l_min", sa.Float, nullable=False),
        sa.Column("lab_l_max", sa.Float, nullable=False),
        sa.Column("lab_a_min", sa.Float, nullable=False),
        sa.Column("lab_a_max", sa.Float, nullable=False),
        sa.Column("lab_b_min", sa.Float, nullable=False),
        sa.Column("lab_b_max", sa.Float, nullable=False),
        sa.Column("lab_l_centroid", sa.Float, nullable=False),
        sa.Column("lab_a_centroid", sa.Float, nullable=False),
        sa.Column("lab_b_centroid", sa.Float, nullable=False),
        sa.Column("created_at", sa.String(40), nullable=False),
        sa.CheckConstraint(
            "fit_degree BETWEEN 1 AND 3",
            name="saved_spectrums_fit_degree_chk",
        ),
    )
    op.create_index(
        "ix_saved_spectrums_owner_machine_created",
        "saved_spectrums",
        ["owner_id", "machine_id", "created_at"],
    )
    op.create_index(
        "ix_saved_spectrums_material_lab_l",
        "saved_spectrums",
        ["material_id", "lab_l_min", "lab_l_max"],
    )
    op.create_index(
        "ix_saved_spectrums_material_lab_a",
        "saved_spectrums",
        ["material_id", "lab_a_min", "lab_a_max"],
    )
    op.create_index(
        "ix_saved_spectrums_material_lab_b",
        "saved_spectrums",
        ["material_id", "lab_b_min", "lab_b_max"],
    )
    op.create_index(
        "ix_saved_spectrums_fit_r2_min",
        "saved_spectrums",
        ["fit_r2_min"],
    )

    op.create_table(
        "saved_spectrum_swatches",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column(
            "saved_spectrum_id", sa.Integer,
            sa.ForeignKey("saved_spectrums.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("swatch_row", sa.Integer, nullable=False),
        sa.Column("swatch_col", sa.Integer, nullable=False),
        sa.Column("x_value", sa.Float, nullable=False),
        sa.Column("hex", sa.String(7), nullable=False),
        sa.Column("lab_l", sa.Float, nullable=False),
        sa.Column("lab_a", sa.Float, nullable=False),
        sa.Column("lab_b", sa.Float, nullable=False),
        sa.UniqueConstraint(
            "saved_spectrum_id", "swatch_row", "swatch_col",
            name="uq_saved_spectrum_swatch_cell",
        ),
    )
    op.create_index(
        "ix_saved_spectrum_swatches_parent",
        "saved_spectrum_swatches",
        ["saved_spectrum_id"],
    )

    op.create_table(
        "saved_spectrum_fit_coefficients",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column(
            "saved_spectrum_id", sa.Integer,
            sa.ForeignKey("saved_spectrums.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("channel", sa.String(1), nullable=False),
        sa.Column("degree", sa.Integer, nullable=False),
        sa.Column("coeff", sa.Float, nullable=False),
        sa.CheckConstraint(
            "channel IN ('l','a','b')",
            name="saved_spectrum_fit_coefficients_channel_chk",
        ),
        sa.UniqueConstraint(
            "saved_spectrum_id", "channel", "degree",
            name="uq_saved_spectrum_fit_coeff_cell",
        ),
    )
    op.create_index(
        "ix_saved_spectrum_fit_coefficients_parent",
        "saved_spectrum_fit_coefficients",
        ["saved_spectrum_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_saved_spectrum_fit_coefficients_parent", "saved_spectrum_fit_coefficients")
    op.drop_table("saved_spectrum_fit_coefficients")
    op.drop_index("ix_saved_spectrum_swatches_parent", "saved_spectrum_swatches")
    op.drop_table("saved_spectrum_swatches")
    op.drop_index("ix_saved_spectrums_fit_r2_min", "saved_spectrums")
    op.drop_index("ix_saved_spectrums_material_lab_b", "saved_spectrums")
    op.drop_index("ix_saved_spectrums_material_lab_a", "saved_spectrums")
    op.drop_index("ix_saved_spectrums_material_lab_l", "saved_spectrums")
    op.drop_index("ix_saved_spectrums_owner_machine_created", "saved_spectrums")
    op.drop_table("saved_spectrums")
