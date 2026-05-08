"""Combined heuristic indices: rename total_exposure, add aggression + smoothness.

Renames `surface_exposure_index` column → `total_exposure_index` (the
canonical name going forward; the old name lives on as a Pydantic
read-side alias). Adds two new columns:
- `ablation_aggression_index` = total_exposure × pulse_intensity
- `delivery_smoothness_index` = total_exposure / pulse_intensity

The composite index on (material_id, surface_exposure_index) is
renamed to match the column. A new composite index on
(material_id, ablation_aggression_index) is added for the phase-2
scatter to be cheap on the new axis.

Backfill walks every palette_entries row and recomputes via
xcs_gen.laser_indices.compute_indices (formula version bumps 1 → 2).
Per-row error isolation matches 0022 — failing rows get
formula_version=0.

Revision ID: 0023
Revises: 0022
"""
from __future__ import annotations

import json
import logging

import sqlalchemy as sa
from alembic import op


revision = "0023"
down_revision = "0022"
branch_labels = None
depends_on = None

log = logging.getLogger("alembic.runtime.migration.0023")


def upgrade() -> None:
    # Phase 1: drop old index and rename the column.  SQLite batch alter
    # does a full table-copy internally; doing the rename in its own batch
    # avoids a KeyError when the new-index creation tries to reference the
    # column by its post-rename name before the copy is finished.
    with op.batch_alter_table("palette_entries", schema=None) as batch_op:
        batch_op.drop_index("ix_palette_entries_material_exposure")
        batch_op.alter_column(
            "surface_exposure_index",
            new_column_name="total_exposure_index",
            existing_type=sa.Float(),
            existing_nullable=True,
        )

    # Phase 2: add new columns and create new composite indexes.
    with op.batch_alter_table("palette_entries", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column("ablation_aggression_index", sa.Float, nullable=True),
        )
        batch_op.add_column(
            sa.Column("delivery_smoothness_index", sa.Float, nullable=True),
        )
        batch_op.create_index(
            "ix_palette_entries_material_total_exposure",
            ["material_id", "total_exposure_index"],
        )
        batch_op.create_index(
            "ix_palette_entries_material_aggression",
            ["material_id", "ablation_aggression_index"],
        )

    # Backfill — best-effort; rows that fail get formula_version=0.
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
        "total_exposure_index=:total_exposure_index, "
        "ablation_aggression_index=:ablation_aggression_index, "
        "delivery_smoothness_index=:delivery_smoothness_index, "
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
                    "total_exposure_index": indices.total_exposure_index,
                    "ablation_aggression_index": indices.ablation_aggression_index,
                    "delivery_smoothness_index": indices.delivery_smoothness_index,
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
            "0023 backfill: %d palette_entries rows could not be computed "
            "(formula_version=0); first few: %s",
            len(skipped), skipped[:5],
        )


def downgrade() -> None:
    """Reverse the rename and drop the new columns/indexes.

    A downgrade leaves surface_exposure_index populated with what
    total_exposure_index held (they're the same number). The phase-1
    backfill data is preserved through the upgrade/downgrade.

    Two batch contexts mirror the upgrade split: first drop new
    columns/indexes and rename the column back, then recreate the
    original composite index now that the column name is stable.
    """
    # Phase 1: drop new indexes, new columns, and rename column back.
    with op.batch_alter_table("palette_entries", schema=None) as batch_op:
        batch_op.drop_index("ix_palette_entries_material_aggression")
        batch_op.drop_index("ix_palette_entries_material_total_exposure")
        batch_op.drop_column("delivery_smoothness_index")
        batch_op.drop_column("ablation_aggression_index")
        batch_op.alter_column(
            "total_exposure_index",
            new_column_name="surface_exposure_index",
            existing_type=sa.Float(),
            existing_nullable=True,
        )

    # Phase 2: recreate original composite index under the restored column name.
    with op.batch_alter_table("palette_entries", schema=None) as batch_op:
        batch_op.create_index(
            "ix_palette_entries_material_exposure",
            ["material_id", "surface_exposure_index"],
        )
