"""Smoke tests for SQLAlchemy metadata wiring."""

from __future__ import annotations

from sqlalchemy import create_engine

from xcs_gen_web.models import metadata


def test_metadata_has_all_tables():
    names = set(metadata.tables.keys())
    assert names == {
        "materials", "presets", "tests",
        "results", "palette_entries", "users",
        "saved_spectrums", "saved_spectrum_swatches",
        "saved_spectrum_fit_coefficients",
        "validation_cells",
        "text_reg_defaults_machine", "text_reg_defaults_material",
    }


def test_metadata_create_all_on_sqlite_memory():
    engine = create_engine("sqlite://")
    metadata.create_all(engine)
    with engine.connect() as conn:
        rows = conn.exec_driver_sql(
            "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
        ).fetchall()
    assert [r[0] for r in rows] == [
        "materials", "palette_entries", "presets", "results",
        "saved_spectrum_fit_coefficients", "saved_spectrum_swatches",
        "saved_spectrums",
        "tests", "text_reg_defaults_machine", "text_reg_defaults_material",
        "users", "validation_cells",
    ]


def test_server_defaults_on_create_all_insert():
    """server_default values must render bare SQL literals, not nested-quoted ones."""
    from sqlalchemy import create_engine, insert, select
    from xcs_gen_web.models import materials, tests as tests_table, metadata

    engine = create_engine("sqlite://")
    metadata.create_all(engine)
    with engine.begin() as conn:
        mid = conn.execute(insert(materials).values(
            name="M", created_at="2026-01-01T00:00:00Z",
            owner_id=0,
        )).inserted_primary_key[0]
        tid = conn.execute(insert(tests_table).values(
            name="T", material_id=mid,
            spec_json="{}",
            created_at="2026-01-01T00:00:00Z",
            updated_at="2026-01-01T00:00:00Z",
            owner_id=0,
        )).inserted_primary_key[0]
        row = conn.execute(select(tests_table).where(tests_table.c.id == tid)).one()
    assert row.status == "created"      # NOT "'created'"
    assert row.notes == ""              # NOT "'"  or "''"
    assert row.visibility == "private"  # server_default kicked in
    assert row.owner_id == 0


def test_palette_entries_has_indices_columns() -> None:
    from xcs_gen_web.models import palette_entries

    expected = {
        "pulse_spacing_mm",
        "line_spacing_mm",
        "pulse_energy_index",
        "pulse_intensity_index",
        "total_exposure_index",
        "indices_formula_version",
        "density_model",
        "power_model",
    }
    actual = {c.name for c in palette_entries.columns}
    missing = expected - actual
    assert not missing, f"palette_entries missing columns: {missing}"


def test_palette_entries_indices_indexes_exist() -> None:
    from xcs_gen_web.models import palette_entries

    indexed_pairs = {
        tuple(c.name for c in idx.columns) for idx in palette_entries.indexes
    }
    assert ("material_id", "total_exposure_index") in indexed_pairs, (
        f"missing (material_id, total_exposure_index) index; have {indexed_pairs}"
    )
    assert ("material_id", "pulse_intensity_index") in indexed_pairs, (
        f"missing (material_id, pulse_intensity_index) index; have {indexed_pairs}"
    )


def test_palette_entries_renamed_total_exposure_column() -> None:
    from xcs_gen_web.models import palette_entries

    cols = {c.name for c in palette_entries.columns}
    assert "total_exposure_index" in cols
    assert "surface_exposure_index" not in cols, (
        "Old column name should be gone after the rename"
    )


def test_palette_entries_has_combined_indices_columns() -> None:
    from xcs_gen_web.models import palette_entries

    cols = {c.name for c in palette_entries.columns}
    assert "ablation_aggression_index" in cols
    assert "delivery_smoothness_index" in cols


def test_palette_entries_combined_indices_indexes() -> None:
    from xcs_gen_web.models import palette_entries

    indexed_pairs = {
        tuple(c.name for c in idx.columns) for idx in palette_entries.indexes
    }
    assert ("material_id", "total_exposure_index") in indexed_pairs, (
        f"missing renamed (material_id, total_exposure_index); have {indexed_pairs}"
    )
    assert ("material_id", "ablation_aggression_index") in indexed_pairs, (
        f"missing new aggression index; have {indexed_pairs}"
    )


def test_line_spacing_mm_is_nullable() -> None:
    from xcs_gen_web.models import palette_entries

    col = palette_entries.c.line_spacing_mm
    assert col.nullable is True, (
        "line_spacing_mm must be nullable — stays NULL while density_model='opaque'"
    )


def test_tests_table_has_lineage_columns():
    from xcs_gen_web.models import tests
    cols = {c.name for c in tests.columns}
    assert "source_test_id" in cols
    assert "parent_test_id" in cols
    assert "tag" in cols
    # FKs point at tests.id with ON DELETE SET NULL.
    src_fk = next(fk for c in tests.columns for fk in c.foreign_keys
                  if c.name == "source_test_id")
    assert src_fk.target_fullname == "tests.id"
    assert src_fk.ondelete == "SET NULL"


def test_palette_entries_table_has_derived_from_and_no_line_spacing_index():
    from xcs_gen_web.models import palette_entries
    cols = {c.name for c in palette_entries.columns}
    assert "derived_from_entry_id" in cols
    assert "line_spacing_index" not in cols
    assert "line_spacing_mm" in cols
    fk = next(fk for c in palette_entries.columns for fk in c.foreign_keys
              if c.name == "derived_from_entry_id")
    assert fk.target_fullname == "palette_entries.id"
    assert fk.ondelete == "SET NULL"
