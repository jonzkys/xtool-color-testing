"""Shared pytest fixtures.

Provides a `fresh_db` fixture that (a) points `XCS_GEN_DB_URL` at a
temp SQLite file, (b) runs alembic upgrade head, (c) yields the URL.
Engine cache is reset before and after so tests don't share state.
"""

from __future__ import annotations

from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config

from xcs_gen_web import db as db_module

REPO_ROOT = Path(__file__).resolve().parents[1]


@pytest.fixture()
def fresh_db(tmp_path, monkeypatch):
    url = f"sqlite:///{tmp_path / 'app.db'}"
    monkeypatch.setenv("XCS_GEN_DB_URL", url)
    db_module.reset_engine_for_tests()
    cfg = Config(str(REPO_ROOT / "alembic.ini"))
    cfg.set_main_option("script_location", str(REPO_ROOT / "alembic"))
    cfg.set_main_option("sqlalchemy.url", url)
    command.upgrade(cfg, "head")
    yield url
    db_module.reset_engine_for_tests()
