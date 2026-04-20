"""Verifies the initial migration creates the expected schema."""

from __future__ import annotations

import os
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, inspect

from xcs_gen_web import db as db_module

REPO_ROOT = Path(__file__).resolve().parents[1]


@pytest.fixture()
def alembic_sqlite(tmp_path, monkeypatch):
    db_file = tmp_path / "app.db"
    url = f"sqlite:///{db_file}"
    monkeypatch.setenv("XCS_GEN_DB_URL", url)
    db_module.reset_engine_for_tests()
    cfg = Config(str(REPO_ROOT / "alembic.ini"))
    cfg.set_main_option("script_location", str(REPO_ROOT / "alembic"))
    cfg.set_main_option("sqlalchemy.url", url)
    yield cfg, url
    db_module.reset_engine_for_tests()


def test_initial_migration_creates_all_tables(alembic_sqlite):
    cfg, url = alembic_sqlite
    command.upgrade(cfg, "head")
    engine = create_engine(url)
    insp = inspect(engine)
    assert set(insp.get_table_names()) == {
        "alembic_version",
        "materials", "presets", "tests",
        "results", "palette_entries",
    }


def test_initial_migration_is_reversible(alembic_sqlite):
    cfg, url = alembic_sqlite
    command.upgrade(cfg, "head")
    command.downgrade(cfg, "base")
    engine = create_engine(url)
    insp = inspect(engine)
    remaining = set(insp.get_table_names()) - {"alembic_version"}
    assert remaining == set()
