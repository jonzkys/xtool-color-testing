"""Laser indices v6: add ``duty_cycle_index`` column.

Adds a nullable ``duty_cycle_index`` float column to ``palette_entries``
and backfills it via ``xcs_gen.laser_indices.compute_indices``. The new
index is a true physical ratio (laser-on time ÷ pulse period), expressed
as a percentage 0–100 (= mopa_frequency_khz * pulse_width_ns / 10000).
No other indices change, so the backfill recomputes everything but only
``duty_cycle_index`` is materially new. Per-row failures fall back to
formula_version=0, matching the pattern in 0025.

Revision ID: 0026
Revises: 0025
"""
from __future__ import annotations

import json
import logging

import sqlalchemy as sa
from alembic import op


revision = "0026"
down_revision = "0025"
branch_labels = None
depends_on = None

log = logging.getLogger("alembic.runtime.migration")


def upgrade() -> None:
    op.add_column(
        "palette_entries",
        sa.Column("duty_cycle_index", sa.Float(), nullable=True),
    )

    conn = op.get_bind()

    from xcs_gen.laser_indices import INDICES_FORMULA_VERSION, compute_indices
    from xcs_gen.model import ProcessingParams

    pe_rows = conn.execute(sa.text(
        "SELECT id, params_json FROM palette_entries",
    )).fetchall()

    update_sql = sa.text(
        "UPDATE palette_entries SET "
        "pulse_spacing_mm=:pulse_spacing_mm, "
        "line_spacing_mm=:line_spacing_mm, "
        "pulse_energy_index=:pulse_energy_index, "
        "pulse_intensity_index=:pulse_intensity_index, "
        "total_exposure_index=:total_exposure_index, "
        "ablation_aggression_index=:ablation_aggression_index, "
        "delivery_smoothness_index=:delivery_smoothness_index, "
        "duty_cycle_index=:duty_cycle_index, "
        "indices_formula_version=:formula_version, "
        "density_model=:density_model, "
        "power_model=:power_model "
        "WHERE id=:id"
    )
    skipped: list[tuple[int, str]] = []
    for row in pe_rows:
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
            crosshatch = bool(d.get("crosshatch", False))
            indices = compute_indices(params, crosshatch=crosshatch)
            conn.execute(update_sql, {
                "id": row.id,
                "pulse_spacing_mm": indices.pulse_spacing_mm,
                "line_spacing_mm": indices.line_spacing_mm,
                "pulse_energy_index": indices.pulse_energy_index,
                "pulse_intensity_index": indices.pulse_intensity_index,
                "total_exposure_index": indices.total_exposure_index,
                "ablation_aggression_index": indices.ablation_aggression_index,
                "delivery_smoothness_index": indices.delivery_smoothness_index,
                "duty_cycle_index": indices.duty_cycle_index,
                "formula_version": INDICES_FORMULA_VERSION,
                "density_model": indices.density_model,
                "power_model": indices.power_model,
            })
        except Exception as exc:  # noqa: BLE001 - best-effort backfill
            skipped.append((row.id, str(exc)))
            conn.execute(
                sa.text(
                    "UPDATE palette_entries SET indices_formula_version=0 "
                    "WHERE id=:id",
                ),
                {"id": row.id},
            )
    if skipped:
        log.warning(
            "0026 indices recompute: %d rows fell back to formula_version=0; "
            "first few: %s", len(skipped), skipped[:10],
        )


def downgrade() -> None:
    op.drop_column("palette_entries", "duty_cycle_index")
    conn = op.get_bind()
    conn.execute(sa.text(
        "UPDATE palette_entries SET indices_formula_version=0",
    ))
