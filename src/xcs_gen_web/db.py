"""Engine/session plumbing for the xcs-gen SQLite store."""

from __future__ import annotations

import os
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator

from sqlalchemy import Engine, create_engine
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


def get_engine() -> Engine:
    global _engine, _SessionLocal
    if _engine is None:
        _engine = create_engine(db_url(), future=True)
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
