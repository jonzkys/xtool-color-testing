"""Convert frequency from Hz to kHz in stored params

Existing rows store frequency in Hz (e.g. 60000 for 60 kHz).
xtool's .xcs format actually expects kHz, so the previous values
were silently writing wrong-unit data to the laser. This migration
walks every JSON column that stores params and divides any
frequency > 1000 by 1000.

Revision ID: 0010
Revises: 0009
Create Date: 2026-04-25
"""
from __future__ import annotations

import json
from alembic import op
import sqlalchemy as sa

revision = "0010"
down_revision = "0009"
branch_labels = None
depends_on = None


def _convert_frequency(params: dict | None) -> tuple[dict | None, bool]:
    """Returns (new_params, changed)."""
    if not isinstance(params, dict):
        return params, False
    freq = params.get("frequency")
    if isinstance(freq, (int, float)) and freq > 1000:
        params["frequency"] = round(freq / 1000)
        return params, True
    return params, False


def upgrade() -> None:
    conn = op.get_bind()

    # tests.spec_json — params live at spec_json.base_params
    rows = conn.execute(sa.text("SELECT id, spec_json FROM tests")).fetchall()
    for row in rows:
        spec = json.loads(row.spec_json)
        bp, changed = _convert_frequency(spec.get("base_params"))
        if changed:
            spec["base_params"] = bp
            conn.execute(
                sa.text("UPDATE tests SET spec_json = :v WHERE id = :id")
                .bindparams(v=json.dumps(spec, separators=(",", ":")), id=row.id)
            )

    # presets.base_params_json — params at root
    rows = conn.execute(sa.text("SELECT id, base_params_json FROM presets")).fetchall()
    for row in rows:
        bp = json.loads(row.base_params_json)
        bp, changed = _convert_frequency(bp)
        if changed:
            conn.execute(
                sa.text("UPDATE presets SET base_params_json = :v WHERE id = :id")
                .bindparams(v=json.dumps(bp, separators=(",", ":")), id=row.id)
            )

    # palette_entries.params_json — params at root
    rows = conn.execute(sa.text("SELECT id, params_json FROM palette_entries")).fetchall()
    for row in rows:
        bp = json.loads(row.params_json)
        bp, changed = _convert_frequency(bp)
        if changed:
            conn.execute(
                sa.text("UPDATE palette_entries SET params_json = :v WHERE id = :id")
                .bindparams(v=json.dumps(bp, separators=(",", ":")), id=row.id)
            )


def downgrade() -> None:
    # Multiplies back. Heuristic-driven: any frequency ≤ 1000 is treated as kHz.
    conn = op.get_bind()
    for table, col in [
        ("tests", "spec_json"),
        ("presets", "base_params_json"),
        ("palette_entries", "params_json"),
    ]:
        rows = conn.execute(sa.text(f"SELECT id, {col} FROM {table}")).fetchall()
        for row in rows:
            data = json.loads(getattr(row, col))
            target = data.get("base_params") if table == "tests" else data
            if isinstance(target, dict):
                freq = target.get("frequency")
                if isinstance(freq, (int, float)) and 0 < freq <= 1000:
                    target["frequency"] = freq * 1000
                    new_blob = json.dumps(data, separators=(",", ":"))
                    conn.execute(
                        sa.text(f"UPDATE {table} SET {col} = :v WHERE id = :id")
                        .bindparams(v=new_blob, id=row.id)
                    )
