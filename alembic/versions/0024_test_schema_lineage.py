"""Test schema lineage + line-spacing physical units.

Schema changes:
- tests gains source_test_id, parent_test_id, tag (FKs nullable, ON
  DELETE SET NULL on the FKs; tag is plain VARCHAR(64)).
- palette_entries gains derived_from_entry_id (FK self-ref nullable,
  ON DELETE SET NULL) and DROPS line_spacing_index (recoverable from
  params.density via 1/density if ever needed).

Backfill:
- For every kind=validation test, find the modal source test by
  joining validation_cells.palette_entry_id -> palette_entries.test_id.
  Persist as tests.source_test_id (NULL when ambiguous or empty).
- For every palette entry that was produced by a validation test
  (validated_test_id IS NOT NULL AND validated_cell_index IS NOT NULL),
  look up validation_cells.palette_entry_id by (test_id, cell_index)
  and persist as derived_from_entry_id.
- Recompute every palette entry's indices via
  xcs_gen.laser_indices.compute_indices with density_model='lpc'.
  Bumps formula_version 2 -> 3, populates line_spacing_mm. Per-row
  failure -> formula_version=0 (legacy pattern from 0022/0023).

Revision ID: 0024
Revises: 0023
"""
from __future__ import annotations

import json
import logging
from collections import Counter

import sqlalchemy as sa
from alembic import op


revision = "0024"
down_revision = "0023"
branch_labels = None
depends_on = None

log = logging.getLogger("alembic.runtime.migration.0024")


def upgrade() -> None:
    # Phase 1a: tests — add columns + indexes + named FKs.
    # batch_alter_table on SQLite requires named constraints; we add the
    # columns first (no inline FK), then declare FKs via create_foreign_key.
    with op.batch_alter_table("tests", schema=None) as batch:
        batch.add_column(sa.Column("source_test_id", sa.Integer, nullable=True))
        batch.add_column(sa.Column("parent_test_id", sa.Integer, nullable=True))
        batch.add_column(sa.Column("tag", sa.String(64), nullable=True))
        batch.create_index("ix_tests_source_test_id", ["source_test_id"])
        batch.create_index("ix_tests_parent_test_id", ["parent_test_id"])
        batch.create_index("ix_tests_tag", ["tag"])
        batch.create_foreign_key(
            "fk_tests_source_test_id",
            "tests",
            ["source_test_id"],
            ["id"],
            ondelete="SET NULL",
        )
        batch.create_foreign_key(
            "fk_tests_parent_test_id",
            "tests",
            ["parent_test_id"],
            ["id"],
            ondelete="SET NULL",
        )

    # Phase 1b: palette_entries — add derived_from_entry_id (named FK) + drop
    # line_spacing_index.
    with op.batch_alter_table("palette_entries", schema=None) as batch:
        batch.add_column(sa.Column("derived_from_entry_id", sa.Integer, nullable=True))
        batch.create_index(
            "ix_palette_entries_derived_from",
            ["derived_from_entry_id"],
        )
        batch.create_foreign_key(
            "fk_palette_entries_derived_from",
            "palette_entries",
            ["derived_from_entry_id"],
            ["id"],
            ondelete="SET NULL",
        )
        batch.drop_column("line_spacing_index")

    conn = op.get_bind()

    # Phase 2: backfill tests.source_test_id from validation_cells.
    val_test_ids = [
        r.id for r in conn.execute(sa.text(
            "SELECT id FROM tests WHERE kind='validation'",
        )).fetchall()
    ]
    src_skipped: list[int] = []
    for tid in val_test_ids:
        cells = conn.execute(sa.text(
            "SELECT palette_entry_id FROM validation_cells WHERE test_id=:t",
        ), {"t": tid}).fetchall()
        entry_ids = [c.palette_entry_id for c in cells if c.palette_entry_id is not None]
        if not entry_ids:
            continue
        rows = conn.execute(
            sa.text(
                "SELECT test_id FROM palette_entries WHERE id IN :ids",
            ).bindparams(sa.bindparam("ids", expanding=True)),
            {"ids": entry_ids},
        ).fetchall()
        counts = Counter(int(r.test_id) for r in rows if r.test_id is not None)
        if counts:
            most = counts.most_common(1)[0][0]
            conn.execute(
                sa.text("UPDATE tests SET source_test_id=:s WHERE id=:t"),
                {"s": most, "t": tid},
            )
        else:
            src_skipped.append(tid)
    if src_skipped:
        log.warning(
            "0024 source_test_id backfill: %d validation tests had no "
            "resolvable source (cells empty or all NULL): %s",
            len(src_skipped), src_skipped[:10],
        )

    # Phase 3: backfill palette_entries.derived_from_entry_id by joining
    # through validation_cells via (validated_test_id, validated_cell_index).
    derived_rows = conn.execute(sa.text(
        """
        SELECT pe.id AS pid,
               pe.validated_test_id AS vt,
               pe.validated_cell_index AS vci
        FROM palette_entries pe
        WHERE pe.validated_test_id IS NOT NULL
          AND pe.validated_cell_index IS NOT NULL
        """,
    )).fetchall()
    derived_skipped: list[int] = []
    for r in derived_rows:
        cell = conn.execute(sa.text(
            "SELECT palette_entry_id FROM validation_cells "
            "WHERE test_id=:t AND cell_index=:c",
        ), {"t": r.vt, "c": r.vci}).fetchone()
        if cell is None or cell.palette_entry_id is None:
            derived_skipped.append(r.pid)
            continue
        conn.execute(
            sa.text(
                "UPDATE palette_entries SET derived_from_entry_id=:s "
                "WHERE id=:p",
            ),
            {"s": cell.palette_entry_id, "p": r.pid},
        )
    if derived_skipped:
        log.warning(
            "0024 derived_from_entry_id backfill: %d entries had no "
            "resolvable source cell: first few %s",
            len(derived_skipped), derived_skipped[:10],
        )

    # Phase 4: recompute every palette entry's indices via
    # compute_indices(..., density_model='lpc'). Bumps formula_version
    # 2 -> 3 and populates line_spacing_mm. Failures land at
    # formula_version=0 per the 0022/0023 pattern.
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
            indices = compute_indices(params)  # density_model='lpc' default
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
            "0024 indices recompute: %d palette_entries rows could not "
            "be computed (formula_version=0); first few: %s",
            len(skipped), skipped[:5],
        )


def downgrade() -> None:
    # Reverse the structural change. We don't restore line_spacing_index
    # values (they're easily recomputed from params.density on re-upgrade),
    # but we do re-add the column so a downgrade leaves a usable schema.
    with op.batch_alter_table("palette_entries", schema=None) as batch:
        batch.drop_constraint("fk_palette_entries_derived_from", type_="foreignkey")
        batch.drop_index("ix_palette_entries_derived_from")
        batch.drop_column("derived_from_entry_id")
        batch.add_column(sa.Column("line_spacing_index", sa.Float, nullable=True))

    with op.batch_alter_table("tests", schema=None) as batch:
        batch.drop_constraint("fk_tests_parent_test_id", type_="foreignkey")
        batch.drop_constraint("fk_tests_source_test_id", type_="foreignkey")
        batch.drop_index("ix_tests_source_test_id")
        batch.drop_index("ix_tests_parent_test_id")
        batch.drop_index("ix_tests_tag")
        batch.drop_column("tag")
        batch.drop_column("parent_test_id")
        batch.drop_column("source_test_id")
