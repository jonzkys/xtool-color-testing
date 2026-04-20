"""Smoke tests for SQLAlchemy metadata wiring."""

from __future__ import annotations

from sqlalchemy import create_engine

from xcs_gen_web.models import metadata


def test_metadata_has_all_tables():
    names = set(metadata.tables.keys())
    assert names == {
        "materials", "presets", "tests",
        "results", "palette_entries",
    }


def test_metadata_create_all_on_sqlite_memory():
    engine = create_engine("sqlite://")
    metadata.create_all(engine)
    with engine.connect() as conn:
        rows = conn.exec_driver_sql(
            "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
        ).fetchall()
    assert [r[0] for r in rows] == [
        "materials", "palette_entries", "presets", "results", "tests",
    ]
