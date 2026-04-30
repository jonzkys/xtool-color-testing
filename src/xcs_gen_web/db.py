"""Engine/session plumbing for the xcs-gen SQLite store."""

from __future__ import annotations

import os
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator

from sqlalchemy import Engine, create_engine, event, text
from sqlalchemy.orm import Session, sessionmaker


def default_db_path() -> Path:
    return Path.home() / ".xcs-gen" / "app.db"


def db_url() -> str:
    override = os.environ.get("XCS_GEN_DB_URL")
    if override:
        return override
    path = default_db_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    return f"sqlite:///{path}"


_engine: Engine | None = None
_SessionLocal: sessionmaker[Session] | None = None


def _set_sqlite_pragma(dbapi_connection, _connection_record):
    """Enable FK enforcement for every new SQLite connection."""
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.close()


def get_engine() -> Engine:
    global _engine, _SessionLocal
    if _engine is None:
        _engine = create_engine(db_url(), future=True)
        # Enable ON DELETE CASCADE / ON DELETE SET NULL for SQLite.
        # Must be applied per-connection; SQLite defaults to FK enforcement OFF.
        if _engine.dialect.name == "sqlite":
            event.listen(_engine, "connect", _set_sqlite_pragma)
        _SessionLocal = sessionmaker(bind=_engine, expire_on_commit=False, future=True)
    return _engine


def reset_engine_for_tests() -> None:
    """Drop cached engine/sessionmaker so the next call rebuilds from env."""
    global _engine, _SessionLocal
    _engine = None
    _SessionLocal = None


@contextmanager
def session_scope() -> Iterator[Session]:
    get_engine()  # ensure _SessionLocal is populated
    assert _SessionLocal is not None
    session = _SessionLocal()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()
