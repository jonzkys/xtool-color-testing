"""Add laser exposure indices to palette_entries.

Adds six numeric columns plus three metadata columns capturing how
the indices were computed (`indices_formula_version`, `density_model`,
`power_model`). Two composite indexes cover the planned phase-2
exposure-vs-intensity scatter queries per material.

Backfill: walks every existing palette_entries row, parses
params_json, and populates the indices via xcs_gen.laser_indices.
Rows that fail to parse or hit a divide-by-zero are stamped with
indices_formula_version=0 so a `WHERE indices_formula_version = 0`
query surfaces them later.

Revision ID: 0022
Revises: 0021
"""
from __future__ import annotations

import json
import logging

import sqlalchemy as sa
from alembic import op


revision = "0022"
down_revision = "0021"
branch_labels = None
depends_on = None

log = logging.getLogger("alembic.runtime.migration.0022")


def upgrade() -> None:
    with op.batch_alter_table("palette_entries", schema=None) as batch_op:
        batch_op.add_column(sa.Column("pulse_spacing_mm", sa.Float, nullable=True))
        batch_op.add_column(sa.Column("line_spacing_index", sa.Float, nullable=True))
        batch_op.add_column(sa.Column("line_spacing_mm", sa.Float, nullable=True))
        batch_op.add_column(sa.Column("pulse_energy_index", sa.Float, nullable=True))
        batch_op.add_column(sa.Column("pulse_intensity_index", sa.Float, nullable=True))
        batch_op.add_column(sa.Column("surface_exposure_index", sa.Float, nullable=True))
        batch_op.add_column(
            sa.Column(
                "indices_formula_version", sa.Integer,
                nullable=False, server_default="1",
            ),
        )
        batch_op.add_column(
            sa.Column(
                "density_model", sa.String(32),
                nullable=False, server_default="opaque",
            ),
        )
        batch_op.add_column(
            sa.Column(
                "power_model", sa.String(32),
                nullable=False, server_default="controller_percent",
            ),
        )
        batch_op.create_index(
            "ix_palette_entries_material_exposure",
            ["material_id", "surface_exposure_index"],
        )
        batch_op.create_index(
            "ix_palette_entries_material_intensity",
            ["material_id", "pulse_intensity_index"],
        )

    # Backfill — best-effort; rows that fail get formula_version=0.
    # Imports are local to keep alembic env startup cheap and avoid
    # circular imports during stamp-only operations.
    from xcs_gen.laser_indices import INDICES_FORMULA_VERSION, compute_indices
    from xcs_gen.model import ProcessingParams

    conn = op.get_bind()
    rows = conn.execute(
        sa.text("SELECT id, params_json FROM palette_entries"),
    ).fetchall()

    update_sql = sa.text(
        "UPDATE palette_entries SET "
        "pulse_spacing_mm=:pulse_spacing_mm, "
        "line_spacing_index=:line_spacing_index, "
        "line_spacing_mm=:line_spacing_mm, "
        "pulse_energy_index=:pulse_energy_index, "
        "pulse_intensity_index=:pulse_intensity_index, "
        "surface_exposure_index=:surface_exposure_index, "
        "indices_formula_version=:formula_version, "
        "density_model=:density_model, "
        "power_model=:power_model "
        "WHERE id=:id"
    )

    skipped: list[tuple[int, str]] = []
    for row in rows:
        try:
            d = json.loads(row.params_json) if row.params_json else {}
            defaults = ProcessingParams()
            params = ProcessingParams(
                speed=d.get("speed", defaults.speed),
                power=d.get("power", defaults.power),
                density=d.get("density", defaults.density),
                mopa_frequency=d.get(
                    "mopa_frequency",
                    d.get("frequency", defaults.mopa_frequency),
                ),
                pulse_width=d.get("pulse_width", defaults.pulse_width),
                repeat=d.get("repeat", d.get("passes", defaults.repeat)),
            )
            indices = compute_indices(params)
            conn.execute(
                update_sql,
                {
                    "id": row.id,
                    "pulse_spacing_mm": indices.pulse_spacing_mm,
                    "line_spacing_index": indices.line_spacing_index,
                    "line_spacing_mm": indices.line_spacing_mm,
                    "pulse_energy_index": indices.pulse_energy_index,
                    "pulse_intensity_index": indices.pulse_intensity_index,
                    "surface_exposure_index": indices.surface_exposure_index,
                    "formula_version": INDICES_FORMULA_VERSION,
                    "density_model": indices.density_model,
                    "power_model": indices.power_model,
                },
            )
        except Exception as exc:  # noqa: BLE001 - best-effort backfill
            skipped.append((row.id, str(exc)))
            conn.execute(
                sa.text(
                    "UPDATE palette_entries SET indices_formula_version=0 "
                    "WHERE id=:id"
                ),
                {"id": row.id},
            )

    if skipped:
        log.warning(
            "0022 backfill: %d palette_entries rows could not be computed "
            "(formula_version=0); first few: %s",
            len(skipped), skipped[:5],
        )


def downgrade() -> None:
    with op.batch_alter_table("palette_entries", schema=None) as batch_op:
        batch_op.drop_index("ix_palette_entries_material_intensity")
        batch_op.drop_index("ix_palette_entries_material_exposure")
        batch_op.drop_column("power_model")
        batch_op.drop_column("density_model")
        batch_op.drop_column("indices_formula_version")
        batch_op.drop_column("surface_exposure_index")
        batch_op.drop_column("pulse_intensity_index")
        batch_op.drop_column("pulse_energy_index")
        batch_op.drop_column("line_spacing_mm")
        batch_op.drop_column("line_spacing_index")
        batch_op.drop_column("pulse_spacing_mm")
