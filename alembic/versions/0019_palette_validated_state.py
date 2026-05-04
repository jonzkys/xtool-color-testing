"""Palette entry validated state

Adds the columns that drive the validated-palette workflow:

  - ``is_validated`` flag — the canonical filter for "show me only
    colours I trust".
  - ``validated_at`` / ``validated_test_id`` — provenance for the
    validation event that confirmed the entry. The FK uses
    ``ON DELETE SET NULL`` so deleting the source test preserves the
    validated values.
  - ``validated_lab_l`` / ``validated_lab_a`` / ``validated_lab_b`` —
    the burn-mean Lab across the validation results, which can
    differ from the original ingestion-time ``lab_*`` (the original
    might have been mis-measured under bad lighting; validation
    re-measures more reliably).
  - ``validated_run_count`` — how many results contributed.
  - ``validated_residual_de`` — ΔE76 between the original and
    validated Lab, for "how much did this entry move?" diagnostics.

A composite index over ``(machine_id, material_id, is_validated)``
backs the auto-match's ``Prefer validated`` filter on the SVG
layers tab — the validated entries for a given material on the
current machine are the hot path.

Revision ID: 0019
Revises: 0018
Create Date: 2026-05-04
"""
from alembic import op
import sqlalchemy as sa


revision = "0019"
down_revision = "0018"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("palette_entries", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column(
                "is_validated", sa.Boolean(), server_default="0", nullable=False,
            ),
        )
        batch_op.add_column(
            sa.Column("validated_at", sa.String(length=40), nullable=True),
        )
        batch_op.add_column(
            sa.Column("validated_test_id", sa.Integer(), nullable=True),
        )
        batch_op.add_column(
            sa.Column("validated_lab_l", sa.Float(), nullable=True),
        )
        batch_op.add_column(
            sa.Column("validated_lab_a", sa.Float(), nullable=True),
        )
        batch_op.add_column(
            sa.Column("validated_lab_b", sa.Float(), nullable=True),
        )
        batch_op.add_column(
            sa.Column("validated_run_count", sa.Integer(), nullable=True),
        )
        batch_op.add_column(
            sa.Column("validated_residual_de", sa.Float(), nullable=True),
        )
        batch_op.create_foreign_key(
            "fk_palette_entries_validated_test",
            "tests",
            ["validated_test_id"],
            ["id"],
            ondelete="SET NULL",
        )
        batch_op.create_index(
            "ix_palette_entries_validated",
            ["machine_id", "material_id", "is_validated"],
            unique=False,
        )


def downgrade() -> None:
    with op.batch_alter_table("palette_entries", schema=None) as batch_op:
        batch_op.drop_index("ix_palette_entries_validated")
        batch_op.drop_constraint(
            "fk_palette_entries_validated_test", type_="foreignkey",
        )
        batch_op.drop_column("validated_residual_de")
        batch_op.drop_column("validated_run_count")
        batch_op.drop_column("validated_lab_b")
        batch_op.drop_column("validated_lab_a")
        batch_op.drop_column("validated_lab_l")
        batch_op.drop_column("validated_test_id")
        batch_op.drop_column("validated_at")
        batch_op.drop_column("is_validated")
