"""Laser indices v5: factor mopa_frequency into total_exposure_index.

No schema change — pure data-side recompute. ``compute_indices`` now
multiplies ``total_exposure_index`` by ``mopa_frequency`` (kHz), which
propagates through ``ablation_aggression_index`` and
``delivery_smoothness_index``. ``pulse_spacing_mm``, ``line_spacing_mm``,
``pulse_energy_index``, and ``pulse_intensity_index`` are unchanged.

Rationale: prior versions of TEi collapsed pure frequency sweeps onto a
single x-value on the exposure-page scatter because freq carried zero
weight. On MOPA fiber lasers the average optical power at fixed
controller-% scales with the pulse rate, so total energy delivered per
cell scales with freq. See PR notes for the SS-material walkthrough.

Backfill recomputes every palette_entries row via compute_indices and
threads the per-row ``crosshatch`` flag from params_json (same pattern
as 0024). Per-row failure -> formula_version=0.

Revision ID: 0025
Revises: 0024
"""
from __future__ import annotations

import json
import logging

import sqlalchemy as sa
from alembic import op


revision = "0025"
down_revision = "0024"
branch_labels = None
depends_on = None

log = logging.getLogger("alembic.runtime.migration")


def upgrade() -> None:
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
            "0025 indices recompute: %d rows fell back to formula_version=0; "
            "first few: %s", len(skipped), skipped[:10],
        )


def downgrade() -> None:
    # Pure data-side change. Downgrade resets formula_version on every
    # row so the next startup recompute (or a 0024-style migration)
    # rewrites them under whichever formula is current. We deliberately
    # don't try to undo the multiplication in place — the v4 values are
    # rebuildable from params_json by the previous code revision.
    conn = op.get_bind()
    conn.execute(sa.text(
        "UPDATE palette_entries SET indices_formula_version=0",
    ))
