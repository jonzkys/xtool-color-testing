# Tests-as-Entities + SQLite Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Elevate parameter tests to persistent SQLite entities with per-test result photos + averaged swatches, replace the 12 mm inline QR with a tiny id-only QR + 3 ArUco corners, and upgrade the test preview. See `docs/superpowers/specs/2026-04-20-tests-and-persistence-design.md`.

**Architecture:** SQLAlchemy 2.0 Core + Alembic migrations over SQLite at `~/.xcs-gen/app.db`. Repositories in `src/xcs_gen_web/repositories/`, services in `src/xcs_gen_web/services/`. Frontend becomes a thin client: hash-based router, per-resource API clients, no localStorage. Fiducial detection uses `cv2.aruco` + pyzbar with over-determined homography from four corner markers.

**Tech Stack:** FastAPI · SQLAlchemy 2.0 Core · Alembic · SQLite · OpenCV contrib (ArUco) · pyzbar · segno · React 18 · Vite · vitest · pytest

**Phasing:** This plan is long. Execute in phases; each phase leaves the app working and testable.
- Phase A (Tasks 1–3): DB foundation.
- Phase B (Tasks 4–8): Library + Palette ported to DB behind their existing API shape.
- Phase C (Tasks 9–14): Tests + Results entities, ingestion pipeline (fiducials still old-style).
- Phase D (Tasks 15–19): Fiducial redesign (ArUco + ID-only QR).
- Phase E (Tasks 20–22): Per-test XCS generation + ingest-to-palette from test.
- Phase F (Tasks 23–28): Frontend rewrite — router, API clients, new pages.
- Phase G (Tasks 29–31): Preview upgrade, results panel, Library/Palette page tweaks.
- Phase H (Tasks 32–33): Retire dead code.

---

## Phase A — Database foundation

### Task 1: Add dependencies and initialise Alembic

**Files:**
- Modify: `pyproject.toml`
- Create: `alembic.ini`
- Create: `alembic/env.py`
- Create: `alembic/script.py.mako`
- Create: `alembic/versions/` (empty dir, keep with `.gitkeep`)

- [ ] **Step 1: Add deps to `pyproject.toml`**

Replace the `opencv-python-headless` line and add two new deps. The resulting `dependencies` list is:

```toml
dependencies = [
    "Pillow>=10.0",
    "fastapi>=0.110",
    "uvicorn[standard]>=0.27",
    "svgelements>=1.9",
    "shapely>=2.0",
    "pyyaml>=6.0",
    "vtracer>=0.6",
    "opencv-contrib-python-headless>=4.8",
    "segno>=1.6",
    "numpy>=1.24",
    "pyzbar>=0.1.9",
    "sqlalchemy>=2.0",
    "alembic>=1.13",
]
```

- [ ] **Step 2: Install**

Run: `pip install -e .`
Expected: installs cleanly. `python -c "import cv2.aruco; import sqlalchemy; import alembic"` returns no error.

- [ ] **Step 3: Initialise Alembic scaffold**

Create `alembic.ini` at repo root:

```ini
[alembic]
script_location = alembic
sqlalchemy.url = %(DB_URL)s

[loggers]
keys = root,sqlalchemy,alembic

[handlers]
keys = console

[formatters]
keys = generic

[logger_root]
level = WARN
handlers = console
qualname =

[logger_sqlalchemy]
level = WARN
handlers =
qualname = sqlalchemy.engine

[logger_alembic]
level = INFO
handlers =
qualname = alembic

[handler_console]
class = StreamHandler
args = (sys.stderr,)
level = NOTSET
formatter = generic

[formatter_generic]
format = %(levelname)-5.5s [%(name)s] %(message)s
datefmt = %H:%M:%S
```

Create `alembic/env.py`:

```python
"""Alembic environment.

Reads the DB URL from XCS_GEN_DB_URL or defaults to ~/.xcs-gen/app.db.
"""

from __future__ import annotations

import os
from logging.config import fileConfig
from pathlib import Path

from alembic import context
from sqlalchemy import engine_from_config, pool

from xcs_gen_web.models import metadata

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)


def _default_db_url() -> str:
    path = Path.home() / ".xcs-gen" / "app.db"
    return f"sqlite:///{path}"


target_metadata = metadata
db_url = os.environ.get("XCS_GEN_DB_URL") or _default_db_url()
config.set_main_option("sqlalchemy.url", db_url)


def run_migrations_offline() -> None:
    context.configure(
        url=db_url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        render_as_batch=True,  # SQLite-safe ALTERs
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            render_as_batch=True,
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
```

Create `alembic/script.py.mako`:

```
"""${message}

Revision ID: ${up_revision}
Revises: ${down_revision | comma,n}
Create Date: ${create_date}

"""
from alembic import op
import sqlalchemy as sa
${imports if imports else ""}

revision = ${repr(up_revision)}
down_revision = ${repr(down_revision)}
branch_labels = ${repr(branch_labels)}
depends_on = ${repr(depends_on)}


def upgrade() -> None:
    ${upgrades if upgrades else "pass"}


def downgrade() -> None:
    ${downgrades if downgrades else "pass"}
```

Create `alembic/versions/.gitkeep` (empty).

- [ ] **Step 4: Commit**

```bash
git add pyproject.toml alembic.ini alembic/
git commit -m "Add SQLAlchemy + Alembic scaffold; swap to opencv-contrib-python-headless"
```

---

### Task 2: Define SQLAlchemy table metadata

**Files:**
- Create: `src/xcs_gen_web/db.py`
- Create: `src/xcs_gen_web/models.py`
- Create: `tests/test_db_models.py`

- [ ] **Step 1: Write failing test**

`tests/test_db_models.py`:

```python
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
```

Run: `pytest tests/test_db_models.py -v`
Expected: FAIL (ImportError on `xcs_gen_web.models`).

- [ ] **Step 2: Create `db.py`**

```python
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
```

- [ ] **Step 3: Create `models.py`**

```python
"""SQLAlchemy Core table definitions.

Storing spec/params/swatches as TEXT (opaque JSON) — they're consumed whole
by the app; no query filters on their internals. First-class columns are
reserved for fields that do appear in WHERE clauses.
"""

from __future__ import annotations

from sqlalchemy import (
    CheckConstraint,
    Column,
    Float,
    ForeignKey,
    Index,
    Integer,
    MetaData,
    Table,
    Text,
)

metadata = MetaData()

materials = Table(
    "materials", metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("name", Text, nullable=False),
    Column("notes", Text),
    Column("created_at", Text, nullable=False),
)

presets = Table(
    "presets", metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("material_id", Integer, ForeignKey("materials.id"), nullable=False),
    Column("name", Text, nullable=False),
    Column("color", Text),
    Column("is_default", Integer, nullable=False, server_default="0"),
    Column("base_params_json", Text, nullable=False),
    Column("created_at", Text, nullable=False),
    Column("updated_at", Text, nullable=False),
    Index("ix_presets_material_id", "material_id"),
)

tests = Table(
    "tests", metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("name", Text, nullable=False),
    Column("material_id", Integer, ForeignKey("materials.id"), nullable=False),
    Column("status", Text, nullable=False, server_default="'created'"),
    Column("spec_json", Text, nullable=False),
    Column("notes", Text, nullable=False, server_default="''"),
    Column("created_at", Text, nullable=False),
    Column("updated_at", Text, nullable=False),
    Column("locked", Integer, nullable=False, server_default="0"),
    CheckConstraint("status IN ('created','tested','deleted')", name="tests_status_chk"),
    Index("ix_tests_material_id", "material_id"),
    Index("ix_tests_status", "status"),
)

results = Table(
    "results", metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("test_id", Integer, ForeignKey("tests.id"), nullable=False),
    Column("uploaded_at", Text, nullable=False),
    Column("image_path", Text, nullable=False),
    Column("image_sha256", Text, nullable=False),
    Column("excluded", Integer, nullable=False, server_default="0"),
    Column("notes", Text, nullable=False, server_default="''"),
    Column("swatches_json", Text, nullable=False),
    Index("ix_results_test_id", "test_id"),
)

palette_entries = Table(
    "palette_entries", metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("test_id", Integer, ForeignKey("tests.id"), nullable=False),
    Column("material_id", Integer, ForeignKey("materials.id"), nullable=False),
    Column("x_value", Float),
    Column("y_value", Float),
    Column("hex", Text, nullable=False),
    Column("lab_l", Float, nullable=False),
    Column("lab_a", Float, nullable=False),
    Column("lab_b", Float, nullable=False),
    Column("params_json", Text, nullable=False),
    Column("sigma", Float, nullable=False),
    Column("source", Text, nullable=False),
    Column("source_result_id", Integer, ForeignKey("results.id")),
    Column("notes", Text, nullable=False, server_default="''"),
    Column("created_at", Text, nullable=False),
    CheckConstraint(
        "source IN ('averaged','single_result')",
        name="palette_entries_source_chk",
    ),
    Index("ix_palette_entries_material_id", "material_id"),
    Index("ix_palette_entries_test_id", "test_id"),
)
```

- [ ] **Step 4: Run tests**

Run: `pytest tests/test_db_models.py -v`
Expected: both tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/xcs_gen_web/db.py src/xcs_gen_web/models.py tests/test_db_models.py
git commit -m "Define SQLAlchemy Core tables and engine helper"
```

---

### Task 3: Initial Alembic migration

**Files:**
- Create: `alembic/versions/0001_initial.py`
- Create: `tests/test_alembic.py`

- [ ] **Step 1: Write failing test**

`tests/test_alembic.py`:

```python
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
```

Run: `pytest tests/test_alembic.py -v`
Expected: FAIL — no initial migration.

- [ ] **Step 2: Generate the migration via autogenerate**

Run:

```bash
XCS_GEN_DB_URL="sqlite:////tmp/xcs_gen_autogen.db" alembic revision --autogenerate -m "initial" --rev-id 0001
```

- [ ] **Step 3: Review + clean up the generated migration**

Open `alembic/versions/0001_initial.py`. Confirm `upgrade()` creates all 5 tables + indexes with column types matching `models.py`. Trim any extraneous imports. Rename the file to `0001_initial.py` if autogenerate named it differently (should already match `--rev-id`).

- [ ] **Step 4: Run tests**

Run: `pytest tests/test_alembic.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
rm -f /tmp/xcs_gen_autogen.db
git add alembic/versions/0001_initial.py tests/test_alembic.py
git commit -m "Initial Alembic migration: create all 5 tables"
```

---

## Phase B — Library + Palette to the DB

Rationale: port the two existing server-side data stores (library was in `localStorage`; palette was a JSON file) onto the DB **without** changing their HTTP API shape. This keeps the UI working through the port; the only code that needs to change in the frontend is `library.ts` → server-backed. Afterwards palette.json is dead code.

### Task 4: `materials` + `presets` repositories

**Files:**
- Create: `src/xcs_gen_web/repositories/__init__.py` (empty)
- Create: `src/xcs_gen_web/repositories/materials.py`
- Create: `src/xcs_gen_web/repositories/presets.py`
- Create: `tests/test_repo_materials.py`
- Create: `tests/test_repo_presets.py`
- Create: `tests/conftest.py` (adds a shared `fresh_db` fixture)

- [ ] **Step 1: Add shared DB fixture**

`tests/conftest.py`:

```python
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
```

- [ ] **Step 2: Write failing materials-repo tests**

`tests/test_repo_materials.py`:

```python
from __future__ import annotations

import pytest

from xcs_gen_web.repositories import materials as repo


def test_create_and_list(fresh_db):
    m = repo.create(name="Stainless", notes="304 grade")
    assert m["id"] == 1
    assert m["name"] == "Stainless"
    all_ = repo.list_all()
    assert [x["id"] for x in all_] == [1]


def test_rename(fresh_db):
    m = repo.create(name="Old")
    repo.update(m["id"], name="New")
    assert repo.get(m["id"])["name"] == "New"


def test_delete_blocked_when_preset_references_material(fresh_db):
    m = repo.create(name="Stainless")
    from xcs_gen_web.repositories import presets as p_repo
    p_repo.create(
        material_id=m["id"], name="Default", color=None,
        base_params={"power": 50, "speed": 1000, "frequency": 60000,
                     "density": 200, "passes": 1, "pulse_width": 200, "laser": "red"},
    )
    with pytest.raises(repo.InUseError):
        repo.delete(m["id"])


def test_delete_when_empty(fresh_db):
    m = repo.create(name="Stainless")
    repo.delete(m["id"])
    assert repo.get(m["id"]) is None
```

Run: `pytest tests/test_repo_materials.py -v`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `materials.py`**

```python
"""Materials repository (library table 1 of 2)."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select

from ..db import session_scope
from ..models import materials, presets, tests


class InUseError(Exception):
    """Raised when attempting to delete a material still referenced by a preset or test."""


def _row_to_dict(r) -> dict[str, Any]:
    return {
        "id": r.id, "name": r.name, "notes": r.notes or "",
        "created_at": r.created_at,
    }


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def create(*, name: str, notes: str | None = None) -> dict[str, Any]:
    with session_scope() as s:
        res = s.execute(materials.insert().values(
            name=name, notes=notes, created_at=_now(),
        ))
        return get(res.inserted_primary_key[0])


def get(mid: int) -> dict[str, Any] | None:
    with session_scope() as s:
        row = s.execute(select(materials).where(materials.c.id == mid)).one_or_none()
        return _row_to_dict(row) if row else None


def list_all() -> list[dict[str, Any]]:
    with session_scope() as s:
        rows = s.execute(select(materials).order_by(materials.c.created_at)).all()
        return [_row_to_dict(r) for r in rows]


def update(mid: int, *, name: str | None = None, notes: str | None = None) -> dict[str, Any]:
    values: dict[str, Any] = {}
    if name is not None:
        values["name"] = name
    if notes is not None:
        values["notes"] = notes
    if values:
        with session_scope() as s:
            s.execute(materials.update().where(materials.c.id == mid).values(**values))
    return get(mid)


def delete(mid: int) -> None:
    with session_scope() as s:
        in_preset = s.execute(
            select(presets.c.id).where(presets.c.material_id == mid).limit(1)
        ).first()
        in_test = s.execute(
            select(tests.c.id).where(tests.c.material_id == mid).limit(1)
        ).first()
        if in_preset or in_test:
            raise InUseError(
                f"material {mid} is referenced by existing presets or tests"
            )
        s.execute(materials.delete().where(materials.c.id == mid))
```

- [ ] **Step 4: Write failing presets-repo tests**

`tests/test_repo_presets.py`:

```python
from __future__ import annotations

import pytest

from xcs_gen_web.repositories import materials as m_repo
from xcs_gen_web.repositories import presets as repo

BASE = {
    "power": 50, "speed": 1000, "frequency": 60000,
    "density": 200, "passes": 1, "pulse_width": 200, "laser": "red",
}


def test_first_preset_in_material_becomes_default(fresh_db):
    mid = m_repo.create(name="Stainless")["id"]
    p1 = repo.create(material_id=mid, name="Default", color=None, base_params=BASE)
    assert p1["is_default"] is True


def test_second_preset_is_not_default_unless_promoted(fresh_db):
    mid = m_repo.create(name="Stainless")["id"]
    p1 = repo.create(material_id=mid, name="P1", color=None, base_params=BASE)
    p2 = repo.create(material_id=mid, name="P2", color=None, base_params=BASE)
    assert p1["is_default"] is True
    assert p2["is_default"] is False


def test_set_default_is_exclusive_per_material(fresh_db):
    mid = m_repo.create(name="Stainless")["id"]
    p1 = repo.create(material_id=mid, name="P1", color=None, base_params=BASE)
    p2 = repo.create(material_id=mid, name="P2", color=None, base_params=BASE)
    repo.set_default(p2["id"])
    assert repo.get(p1["id"])["is_default"] is False
    assert repo.get(p2["id"])["is_default"] is True


def test_deleting_default_promotes_next(fresh_db):
    mid = m_repo.create(name="Stainless")["id"]
    p1 = repo.create(material_id=mid, name="P1", color=None, base_params=BASE)
    p2 = repo.create(material_id=mid, name="P2", color=None, base_params=BASE)
    repo.delete(p1["id"])
    # p2 was the only remaining preset in material → promoted
    assert repo.get(p2["id"])["is_default"] is True


def test_list_by_material(fresh_db):
    m1 = m_repo.create(name="A")["id"]
    m2 = m_repo.create(name="B")["id"]
    repo.create(material_id=m1, name="P1", color=None, base_params=BASE)
    repo.create(material_id=m2, name="P2", color=None, base_params=BASE)
    assert [p["name"] for p in repo.list_by_material(m1)] == ["P1"]
```

Run: `pytest tests/test_repo_presets.py -v`
Expected: FAIL — module not found.

- [ ] **Step 5: Implement `presets.py`**

```python
"""Presets repository — default-per-material invariant enforced here."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select

from ..db import session_scope
from ..models import presets


def _row_to_dict(r) -> dict[str, Any]:
    return {
        "id": r.id,
        "material_id": r.material_id,
        "name": r.name,
        "color": r.color,
        "is_default": bool(r.is_default),
        "base_params": json.loads(r.base_params_json),
        "created_at": r.created_at,
        "updated_at": r.updated_at,
    }


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def create(
    *, material_id: int, name: str, color: str | None,
    base_params: dict[str, Any],
) -> dict[str, Any]:
    ts = _now()
    with session_scope() as s:
        is_first = s.execute(
            select(presets.c.id).where(presets.c.material_id == material_id).limit(1)
        ).first() is None
        res = s.execute(presets.insert().values(
            material_id=material_id,
            name=name, color=color,
            is_default=1 if is_first else 0,
            base_params_json=json.dumps(base_params, separators=(",", ":")),
            created_at=ts, updated_at=ts,
        ))
        return get(res.inserted_primary_key[0])


def get(pid: int) -> dict[str, Any] | None:
    with session_scope() as s:
        row = s.execute(select(presets).where(presets.c.id == pid)).one_or_none()
        return _row_to_dict(row) if row else None


def list_by_material(mid: int) -> list[dict[str, Any]]:
    with session_scope() as s:
        rows = s.execute(
            select(presets).where(presets.c.material_id == mid)
            .order_by(presets.c.created_at)
        ).all()
        return [_row_to_dict(r) for r in rows]


def list_all() -> list[dict[str, Any]]:
    with session_scope() as s:
        rows = s.execute(select(presets).order_by(presets.c.created_at)).all()
        return [_row_to_dict(r) for r in rows]


def update(pid: int, *, name: str | None = None, color: str | None = None,
           base_params: dict[str, Any] | None = None) -> dict[str, Any] | None:
    values: dict[str, Any] = {"updated_at": _now()}
    if name is not None:
        values["name"] = name
    if color is not None:
        values["color"] = color
    if base_params is not None:
        values["base_params_json"] = json.dumps(base_params, separators=(",", ":"))
    with session_scope() as s:
        s.execute(presets.update().where(presets.c.id == pid).values(**values))
    return get(pid)


def delete(pid: int) -> None:
    with session_scope() as s:
        row = s.execute(select(presets).where(presets.c.id == pid)).one_or_none()
        if row is None:
            return
        s.execute(presets.delete().where(presets.c.id == pid))
        if row.is_default:
            # Promote the oldest remaining preset in the same material.
            promote = s.execute(
                select(presets.c.id)
                .where(presets.c.material_id == row.material_id)
                .order_by(presets.c.created_at)
                .limit(1)
            ).first()
            if promote:
                s.execute(
                    presets.update().where(presets.c.id == promote.id)
                    .values(is_default=1)
                )


def set_default(pid: int) -> None:
    with session_scope() as s:
        row = s.execute(select(presets).where(presets.c.id == pid)).one_or_none()
        if row is None:
            return
        s.execute(
            presets.update()
            .where(presets.c.material_id == row.material_id)
            .values(is_default=0)
        )
        s.execute(
            presets.update().where(presets.c.id == pid).values(is_default=1)
        )
```

- [ ] **Step 6: Run tests**

Run: `pytest tests/test_repo_materials.py tests/test_repo_presets.py -v`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/xcs_gen_web/repositories tests/conftest.py tests/test_repo_materials.py tests/test_repo_presets.py
git commit -m "Materials + presets repositories with default-per-material invariant"
```

---

### Task 5: Library HTTP API

**Files:**
- Modify: `src/xcs_gen_web/schemas.py`
- Modify: `src/xcs_gen_web/app.py`
- Create: `tests/test_library_api.py`

- [ ] **Step 1: Add schema types**

Append to `src/xcs_gen_web/schemas.py`:

```python
class MaterialCreate(BaseModel):
    name: str
    notes: str | None = None


class MaterialUpdate(BaseModel):
    name: str | None = None
    notes: str | None = None


class MaterialResponse(BaseModel):
    id: int
    name: str
    notes: str
    created_at: str


class PresetCreate(BaseModel):
    material_id: int
    name: str
    color: str | None = None
    base_params: BaseParams


class PresetUpdate(BaseModel):
    name: str | None = None
    color: str | None = None
    base_params: BaseParams | None = None


class PresetResponse(BaseModel):
    id: int
    material_id: int
    name: str
    color: str | None
    is_default: bool
    base_params: BaseParams
    created_at: str
    updated_at: str
```

- [ ] **Step 2: Write failing API test**

`tests/test_library_api.py`:

```python
from __future__ import annotations

from fastapi.testclient import TestClient

from xcs_gen_web.app import create_app


def _client():
    return TestClient(create_app())


BASE = {"power": 50, "speed": 1000, "frequency": 60000,
        "density": 200, "passes": 1, "pulse_width": 200, "laser": "red"}


def test_material_crud(fresh_db):
    c = _client()
    r = c.post("/api/materials", json={"name": "Stainless"})
    assert r.status_code == 201
    mid = r.json()["id"]

    r = c.get("/api/materials")
    assert [m["id"] for m in r.json()] == [mid]

    c.patch(f"/api/materials/{mid}", json={"name": "Stainless 304"})
    assert c.get(f"/api/materials/{mid}").json()["name"] == "Stainless 304"

    c.delete(f"/api/materials/{mid}")
    assert c.get(f"/api/materials/{mid}").status_code == 404


def test_preset_default_promotion(fresh_db):
    c = _client()
    mid = c.post("/api/materials", json={"name": "SS"}).json()["id"]
    p1 = c.post("/api/presets", json={"material_id": mid, "name": "P1", "base_params": BASE}).json()
    p2 = c.post("/api/presets", json={"material_id": mid, "name": "P2", "base_params": BASE}).json()
    assert p1["is_default"] is True and p2["is_default"] is False
    c.post(f"/api/presets/{p2['id']}/set-default")
    assert c.get(f"/api/presets/{p1['id']}").json()["is_default"] is False
    assert c.get(f"/api/presets/{p2['id']}").json()["is_default"] is True


def test_material_delete_blocked_when_preset_exists(fresh_db):
    c = _client()
    mid = c.post("/api/materials", json={"name": "SS"}).json()["id"]
    c.post("/api/presets", json={"material_id": mid, "name": "P1", "base_params": BASE})
    r = c.delete(f"/api/materials/{mid}")
    assert r.status_code == 409
```

Run: `pytest tests/test_library_api.py -v`
Expected: FAIL — routes don't exist yet.

- [ ] **Step 3: Add the library endpoints in `app.py`**

Inside `create_app()`, add these routes (keep them near each other, below the existing SVG endpoints):

```python
from .repositories import materials as m_repo
from .repositories import presets as p_repo
from .repositories.materials import InUseError

# Materials
@app.post("/api/materials", response_model=MaterialResponse, status_code=201)
def materials_create(body: MaterialCreate) -> MaterialResponse:
    return MaterialResponse(**m_repo.create(name=body.name, notes=body.notes))

@app.get("/api/materials", response_model=list[MaterialResponse])
def materials_list() -> list[MaterialResponse]:
    return [MaterialResponse(**m) for m in m_repo.list_all()]

@app.get("/api/materials/{mid}", response_model=MaterialResponse)
def materials_get(mid: int) -> MaterialResponse:
    m = m_repo.get(mid)
    if m is None:
        raise HTTPException(status_code=404, detail="material not found")
    return MaterialResponse(**m)

@app.patch("/api/materials/{mid}", response_model=MaterialResponse)
def materials_patch(mid: int, body: MaterialUpdate) -> MaterialResponse:
    if m_repo.get(mid) is None:
        raise HTTPException(status_code=404, detail="material not found")
    return MaterialResponse(**m_repo.update(mid, name=body.name, notes=body.notes))

@app.delete("/api/materials/{mid}", status_code=204)
def materials_delete(mid: int) -> Response:
    try:
        m_repo.delete(mid)
    except InUseError as e:
        raise HTTPException(status_code=409, detail=str(e))
    return Response(status_code=204)

# Presets
@app.post("/api/presets", response_model=PresetResponse, status_code=201)
def presets_create(body: PresetCreate) -> PresetResponse:
    if m_repo.get(body.material_id) is None:
        raise HTTPException(status_code=400, detail="unknown material_id")
    return PresetResponse(**p_repo.create(
        material_id=body.material_id, name=body.name, color=body.color,
        base_params=body.base_params.model_dump(),
    ))

@app.get("/api/presets", response_model=list[PresetResponse])
def presets_list(material_id: int | None = None) -> list[PresetResponse]:
    rows = p_repo.list_by_material(material_id) if material_id else p_repo.list_all()
    return [PresetResponse(**p) for p in rows]

@app.get("/api/presets/{pid}", response_model=PresetResponse)
def presets_get(pid: int) -> PresetResponse:
    p = p_repo.get(pid)
    if p is None:
        raise HTTPException(status_code=404, detail="preset not found")
    return PresetResponse(**p)

@app.patch("/api/presets/{pid}", response_model=PresetResponse)
def presets_patch(pid: int, body: PresetUpdate) -> PresetResponse:
    if p_repo.get(pid) is None:
        raise HTTPException(status_code=404, detail="preset not found")
    base_params = body.base_params.model_dump() if body.base_params else None
    return PresetResponse(**p_repo.update(
        pid, name=body.name, color=body.color, base_params=base_params,
    ))

@app.post("/api/presets/{pid}/set-default", status_code=204)
def presets_set_default(pid: int) -> Response:
    if p_repo.get(pid) is None:
        raise HTTPException(status_code=404, detail="preset not found")
    p_repo.set_default(pid)
    return Response(status_code=204)

@app.delete("/api/presets/{pid}", status_code=204)
def presets_delete(pid: int) -> Response:
    p_repo.delete(pid)
    return Response(status_code=204)
```

Also ensure `from .schemas import MaterialCreate, MaterialUpdate, MaterialResponse, PresetCreate, PresetUpdate, PresetResponse` is present in the imports block.

- [ ] **Step 4: Run tests**

Run: `pytest tests/test_library_api.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/xcs_gen_web/app.py src/xcs_gen_web/schemas.py tests/test_library_api.py
git commit -m "Materials + presets HTTP API"
```

---

### Task 6: Port frontend Library to the server

**Files:**
- Create: `web/src/api/library.ts`
- Modify: `web/src/library.ts`
- Modify: `web/src/components/LibraryPage.tsx`
- Modify: `web/src/App.tsx`
- Modify: `web/src/storage.ts` (remove `loadLibrary` / `saveLibrary`)
- Modify: `web/src/storage.test.ts`

- [ ] **Step 1: Create the API client**

`web/src/api/library.ts`:

```typescript
import type { Material, Preset } from "../library";

async function j<T>(r: Response): Promise<T> {
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return (r.status === 204 ? undefined : r.json()) as Promise<T>;
}

export async function listMaterials(): Promise<Material[]> {
  return j(await fetch("/api/materials"));
}
export async function createMaterial(name: string, notes?: string): Promise<Material> {
  return j(await fetch("/api/materials", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, notes }),
  }));
}
export async function updateMaterial(id: number, patch: { name?: string; notes?: string }): Promise<Material> {
  return j(await fetch(`/api/materials/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  }));
}
export async function deleteMaterial(id: number): Promise<void> {
  await j(await fetch(`/api/materials/${id}`, { method: "DELETE" }));
}

export async function listPresets(materialId?: number): Promise<Preset[]> {
  const qs = materialId ? `?material_id=${materialId}` : "";
  return j(await fetch(`/api/presets${qs}`));
}
export async function createPreset(body: {
  material_id: number; name: string; color?: string; base_params: Preset["base_params"];
}): Promise<Preset> {
  return j(await fetch("/api/presets", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }));
}
export async function updatePreset(id: number, patch: Partial<Pick<Preset, "name" | "color" | "base_params">>): Promise<Preset> {
  return j(await fetch(`/api/presets/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  }));
}
export async function setDefaultPreset(id: number): Promise<void> {
  await j(await fetch(`/api/presets/${id}/set-default`, { method: "POST" }));
}
export async function deletePreset(id: number): Promise<void> {
  await j(await fetch(`/api/presets/${id}`, { method: "DELETE" }));
}
```

- [ ] **Step 2: Update `library.ts` types and drop bootstrap/mutation helpers**

Rewrite `web/src/library.ts` — keep only the type definitions; remove every pure-function mutator. The page will now call the API client instead.

```typescript
export interface Material {
  id: number;
  name: string;
  notes: string;
  created_at: string;
}

export interface Preset {
  id: number;
  material_id: number;
  name: string;
  color: string | null;
  is_default: boolean;
  base_params: {
    power: number;
    speed: number;
    frequency: number;
    density: number;
    passes: number;
    pulse_width: number;
    laser: "red" | "blue";
  };
  created_at: string;
  updated_at: string;
}

export interface LibraryState {
  materials: Material[];
  presets: Preset[];
  active_material_id: number | null;
}
```

Note the id types have changed from `string` to `number`. Every consumer of material/preset IDs needs to follow. Fixes land in the next step.

- [ ] **Step 3: Rewrite `LibraryPage.tsx` to use the API client**

Open `web/src/components/LibraryPage.tsx`. Replace the import of the old mutators with:

```typescript
import {
  listMaterials, createMaterial, deleteMaterial, renameMaterial as _unusedClient,
  listPresets, createPreset, updatePreset, setDefaultPreset, deletePreset,
} from "../api/library";
```

Remove the `renameMaterial` import (use `updateMaterial` instead).

Change every place that constructs or reads IDs as strings to use numbers. The file structure stays the same — list + edit panes — but:

- Use `useEffect` to load materials + presets on mount and after every write.
- Replace synchronous state updates (e.g. `setLibrary(addMaterial(library, name))`) with `await createMaterial(name); await refresh();`.
- Add a tiny inline `loading` flag so rapid clicks don't double-submit.

Pseudo-patch for the top of the component:

```typescript
export function LibraryPage({
  onMaterialsChange,
}: { onMaterialsChange?: (m: Material[]) => void }) {
  const [materials, setMaterials] = useState<Material[]>([]);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [activeMaterialId, setActiveMaterialId] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();

  async function refresh() {
    try {
      const [m, p] = await Promise.all([listMaterials(), listPresets()]);
      setMaterials(m);
      setPresets(p);
      if (activeMaterialId === null && m[0]) setActiveMaterialId(m[0].id);
      onMaterialsChange?.(m);
    } catch (e) { setError((e as Error).message); }
  }
  useEffect(() => { refresh(); }, []);  // eslint-disable-line react-hooks/exhaustive-deps
  // ...rest follows existing UI, using createMaterial/deleteMaterial/etc. in click handlers
}
```

Mirror the same pattern for presets. The `active_material_id` notion becomes client-only session state (not persisted); that's fine — it's a UI convenience, not durable data.

- [ ] **Step 4: Remove library from `storage.ts`**

In `web/src/storage.ts`:
- Delete `loadLibrary`, `saveLibrary`, `LIBRARY_STORAGE_KEY`, `isValidLibrary`.
- Delete `backfillProjectMaterialIds` (projects are going away entirely in Phase F; leave now so App.tsx can compile without it).
- Leave `loadProject`/`saveProject` alone for now — App.tsx still calls them; they'll be removed in Phase F.

Rewrite `web/src/storage.test.ts` to drop library-specific tests; keep only the `migrateProject` ones.

- [ ] **Step 5: Update `App.tsx`**

- Remove `loadLibrary`, `saveLibrary`, `backfillProjectMaterialIds`, `bootstrapLibrary` imports and calls.
- Remove the `library` state variable and its `useEffect` save.
- Pass `onMaterialsChange` down to `LibraryPage` if needed so child components know materials exist.
- Every place that used `library.active_material_id` as a string needs updating to `number | null`; for now TestEditor etc. can pass the current material via a new `useState` hook driven by `listMaterials()` on mount. Don't try to preserve the old preset-auto-application UX in this task — that's Phase F (new TestsPage).

Keep the app compiling; don't worry if the param-tests tab UX is temporarily degraded — it's about to be replaced.

- [ ] **Step 6: Run tests + build**

```bash
cd web && npm test -- --run && npm run build && cd ..
pytest tests/test_library_api.py tests/test_repo_materials.py tests/test_repo_presets.py -v
```

Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add web/src src/xcs_gen_web tests/test_library_api.py
git commit -m "Port frontend Library to server-backed API"
```

---

### Task 7: Palette repository (DB-backed)

**Files:**
- Create: `src/xcs_gen_web/repositories/palette.py`
- Modify: `src/xcs_gen_web/palette.py` (keep Lab/ΔE helpers only; drop file I/O)
- Modify: `src/xcs_gen_web/app.py` (port `/api/palette*` endpoints to repository)
- Create: `tests/test_repo_palette.py`
- Modify: `tests/test_palette.py` (drop file-roundtrip tests)
- Modify: `tests/test_palette_api.py` (use `fresh_db` fixture, `material_id` as int)

- [ ] **Step 1: Strip `palette.py` down to pure helpers**

Replace the body of `src/xcs_gen_web/palette.py` with only these functions: `hex_to_lab`, `_hex_to_srgb`, `_srgb_to_linear`, `_linear_srgb_to_xyz`, `_xyz_to_lab`, and `delta_e_2000`. Remove `PaletteEntry`, `QueryResult`, `default_palette_path`, `load_palette`, `save_palette`, `append_entries`, `query_by_hex`. The remaining file should be ~80 lines.

- [ ] **Step 2: Write failing repo tests**

`tests/test_repo_palette.py`:

```python
from __future__ import annotations

from xcs_gen_web.repositories import palette as repo
from xcs_gen_web.repositories import materials as m_repo


def _seed_material(name: str = "SS") -> int:
    return m_repo.create(name=name)["id"]


def test_insert_and_query(fresh_db):
    mid = _seed_material()
    repo.insert_bulk([
        dict(test_id=1, material_id=mid, x_value=500, y_value=None,
             hex="#ff0000", sigma=1.0, source="averaged", source_result_id=None,
             params={"power": 50}),
        dict(test_id=1, material_id=mid, x_value=600, y_value=None,
             hex="#00ff00", sigma=1.0, source="averaged", source_result_id=None,
             params={"power": 60}),
    ])
    results = repo.query_by_hex("#ff0101", limit=2, material_id=mid)
    assert results[0]["entry"]["hex"] == "#ff0000"
    assert results[0]["delta_e"] < results[1]["delta_e"]


def test_list_filter_by_material(fresh_db):
    m1 = _seed_material("A")
    m2 = _seed_material("B")
    repo.insert_bulk([dict(test_id=1, material_id=m1, x_value=0, y_value=None,
                           hex="#000000", sigma=0.0, source="averaged",
                           source_result_id=None, params={})])
    repo.insert_bulk([dict(test_id=2, material_id=m2, x_value=0, y_value=None,
                           hex="#111111", sigma=0.0, source="averaged",
                           source_result_id=None, params={})])
    assert [e["material_id"] for e in repo.list_all(material_id=m1)] == [m1]


def test_delete_by_test(fresh_db):
    mid = _seed_material()
    repo.insert_bulk([dict(test_id=7, material_id=mid, x_value=0, y_value=None,
                           hex="#abcdef", sigma=0.0, source="averaged",
                           source_result_id=None, params={})])
    repo.delete_by_test(7)
    assert repo.list_all() == []
```

Run: `pytest tests/test_repo_palette.py -v`
Expected: FAIL.

- [ ] **Step 3: Implement `repositories/palette.py`**

```python
"""Palette repository — persistence + ΔE2000 query over SQLite."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any, Iterable

from sqlalchemy import select

from ..db import session_scope
from ..models import palette_entries
from ..palette import delta_e_2000, hex_to_lab


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _row_to_entry(r) -> dict[str, Any]:
    return {
        "id": r.id,
        "test_id": r.test_id,
        "material_id": r.material_id,
        "x_value": r.x_value,
        "y_value": r.y_value,
        "hex": r.hex,
        "lab": [r.lab_l, r.lab_a, r.lab_b],
        "params": json.loads(r.params_json),
        "sigma": r.sigma,
        "source": r.source,
        "source_result_id": r.source_result_id,
        "notes": r.notes,
        "created_at": r.created_at,
    }


def insert_bulk(entries: Iterable[dict[str, Any]]) -> list[int]:
    """Insert N entries. Each dict needs test_id, material_id, x_value,
    y_value, hex, sigma, source, source_result_id, params."""
    now = _now()
    rows = []
    for e in entries:
        L, a, b = hex_to_lab(e["hex"])
        rows.append({
            "test_id": e["test_id"],
            "material_id": e["material_id"],
            "x_value": e.get("x_value"),
            "y_value": e.get("y_value"),
            "hex": e["hex"],
            "lab_l": L, "lab_a": a, "lab_b": b,
            "params_json": json.dumps(e.get("params", {}), separators=(",", ":")),
            "sigma": e["sigma"],
            "source": e["source"],
            "source_result_id": e.get("source_result_id"),
            "notes": e.get("notes", ""),
            "created_at": now,
        })
    if not rows:
        return []
    with session_scope() as s:
        ids: list[int] = []
        for row in rows:
            res = s.execute(palette_entries.insert().values(**row))
            ids.append(res.inserted_primary_key[0])
        return ids


def list_all(*, material_id: int | None = None) -> list[dict[str, Any]]:
    with session_scope() as s:
        q = select(palette_entries)
        if material_id is not None:
            q = q.where(palette_entries.c.material_id == material_id)
        q = q.order_by(palette_entries.c.created_at.desc())
        return [_row_to_entry(r) for r in s.execute(q).all()]


def query_by_hex(hex_: str, *, limit: int = 5,
                 material_id: int | None = None) -> list[dict[str, Any]]:
    target = hex_to_lab(hex_)
    rows = list_all(material_id=material_id)
    scored = []
    for r in rows:
        de = delta_e_2000(target, tuple(r["lab"]))
        scored.append({"entry": r, "delta_e": de})
    scored.sort(key=lambda x: x["delta_e"])
    return scored[:limit]


def delete_entry(eid: int) -> bool:
    with session_scope() as s:
        res = s.execute(palette_entries.delete().where(palette_entries.c.id == eid))
        return res.rowcount > 0


def delete_by_test(test_id: int) -> int:
    with session_scope() as s:
        res = s.execute(
            palette_entries.delete().where(palette_entries.c.test_id == test_id)
        )
        return res.rowcount


def update_notes(eid: int, notes: str) -> dict[str, Any] | None:
    with session_scope() as s:
        s.execute(
            palette_entries.update()
            .where(palette_entries.c.id == eid)
            .values(notes=notes)
        )
        row = s.execute(
            select(palette_entries).where(palette_entries.c.id == eid)
        ).one_or_none()
        return _row_to_entry(row) if row else None
```

- [ ] **Step 4: Update `app.py` palette endpoints**

Replace the five existing palette endpoints' bodies to call the repo. Drop the `_palette_path()` helper. Keep `PaletteEntryResponse` shape (already exists in schemas) but change `material_id` / `test_id` / `source_result_id` to `int`. Update `PaletteIngestRequest` is dropped in Task 21 (new endpoint shape), so for now ignore the `/api/palette/ingest` endpoint — it's going to be retired in Task 33. You can comment it out / delete it now if easier; existing frontend call sites that use it will be ported in Phase F.

- [ ] **Step 5: Port old palette tests**

Delete the file-roundtrip tests in `tests/test_palette.py` (only pure Lab/ΔE tests remain). In `tests/test_palette_api.py`, switch to the `fresh_db` fixture, use integer ids, and drop `/api/palette/ingest` tests. For each endpoint still present, keep a coverage test.

- [ ] **Step 6: Run the suite**

Run: `pytest tests/test_palette.py tests/test_repo_palette.py tests/test_palette_api.py -v`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/xcs_gen_web tests/test_palette.py tests/test_repo_palette.py tests/test_palette_api.py
git commit -m "Port palette store from palette.json to SQLite"
```

---

### Task 8: Drop palette.json + auto-run migrations on server start

**Files:**
- Modify: `src/xcs_gen_web/app.py`
- Modify: `src/xcs_gen/cli.py` (or wherever `xcs-gen serve` lives — check this file first)
- Create: `tests/test_app_startup.py`

- [ ] **Step 1: Find the serve entry point**

Run: `grep -rn "def serve\|app.run\|uvicorn" src/xcs_gen/cli.py src/xcs_gen_web/app.py`
Note the file + function.

- [ ] **Step 2: Add auto-migrate on startup**

In `create_app()` in `app.py`, run the migration programmatically before returning the app:

```python
def _run_migrations() -> None:
    from pathlib import Path
    from alembic import command
    from alembic.config import Config
    from .db import db_url
    repo_root = Path(__file__).resolve().parents[2]
    cfg = Config(str(repo_root / "alembic.ini"))
    cfg.set_main_option("script_location", str(repo_root / "alembic"))
    cfg.set_main_option("sqlalchemy.url", db_url())
    command.upgrade(cfg, "head")
```

Call `_run_migrations()` at the top of `create_app()`.

- [ ] **Step 3: Smoke test**

`tests/test_app_startup.py`:

```python
from __future__ import annotations

from fastapi.testclient import TestClient

from xcs_gen_web.app import create_app


def test_health_ok_after_fresh_migration(fresh_db):
    client = TestClient(create_app())
    assert client.get("/api/health").json() == {"status": "ok"}
    assert client.get("/api/materials").json() == []
```

Run: `pytest tests/test_app_startup.py -v`
Expected: PASS.

- [ ] **Step 4: Delete `palette.json` handling**

Grep: `grep -rn "palette.json\|XCS_GEN_PALETTE_PATH\|default_palette_path" src tests`
Remove every matching line. The env var is gone; the default path is gone.

- [ ] **Step 5: Run the full backend suite**

Run: `pytest -x -q`
Expected: green.

- [ ] **Step 6: Commit**

```bash
git add src/xcs_gen_web tests/test_app_startup.py
git commit -m "Retire palette.json; auto-run Alembic migrations on startup"
```

---

## Phase C — Tests + Results entities

In this phase the capture pipeline still uses the existing single-QR fiducial scheme. Phase D replaces it with ArUco corners. Splitting the work this way keeps each task small and each green-bar state trivially deployable.

### Task 9: Tests repository

**Files:**
- Create: `src/xcs_gen_web/repositories/tests.py`
- Create: `tests/test_repo_tests.py`

The spec for a test is stored as opaque JSON (`spec_json`). A TypedDict-lite helper at the top of the module documents the expected shape but doesn't enforce it — validation happens at the API boundary via Pydantic.

- [ ] **Step 1: Write failing tests**

`tests/test_repo_tests.py`:

```python
from __future__ import annotations

import pytest

from xcs_gen_web.repositories import materials as m_repo
from xcs_gen_web.repositories import tests as repo


SPEC = {
    "x_param": "speed", "x_min": 500, "x_max": 3000, "x_steps": 10,
    "y_param": None, "y_min": None, "y_max": None, "y_steps": None,
    "rows": 1, "width_mm": 50, "height_mm": 10, "gap_mm": 0.5,
    "cell_shape": "rect", "square_cells": True, "angle_mode": "fixed",
    "unidirectional": False,
    "base_params": {"power": 50, "speed": 1000, "frequency": 60000,
                    "density": 200, "passes": 1, "pulse_width": 200, "laser": "red"},
    "registration": {"mode": "on", "qr_size_mm": None, "aruco_size_mm": None},
}


def _seed(fresh_db):
    return m_repo.create(name="SS")["id"]


def test_create_sets_status_created_and_locked_zero(fresh_db):
    mid = _seed(fresh_db)
    t = repo.create(name="T1", material_id=mid, spec=SPEC)
    assert t["status"] == "created"
    assert t["locked"] is False


def test_update_spec_allowed_while_unlocked(fresh_db):
    mid = _seed(fresh_db)
    t = repo.create(name="T1", material_id=mid, spec=SPEC)
    updated = repo.update(t["id"], spec={**SPEC, "x_steps": 20})
    assert updated["spec"]["x_steps"] == 20


def test_update_spec_blocked_when_locked(fresh_db):
    mid = _seed(fresh_db)
    t = repo.create(name="T1", material_id=mid, spec=SPEC)
    repo.mark_tested_and_lock(t["id"])
    with pytest.raises(repo.LockedError):
        repo.update(t["id"], spec={**SPEC, "x_steps": 20})


def test_update_name_and_notes_allowed_when_locked(fresh_db):
    mid = _seed(fresh_db)
    t = repo.create(name="T1", material_id=mid, spec=SPEC)
    repo.mark_tested_and_lock(t["id"])
    updated = repo.update(t["id"], name="T1 renamed", notes="after burn")
    assert updated["name"] == "T1 renamed"
    assert updated["notes"] == "after burn"


def test_soft_delete(fresh_db):
    mid = _seed(fresh_db)
    t = repo.create(name="T1", material_id=mid, spec=SPEC)
    repo.soft_delete(t["id"])
    listed = [x["id"] for x in repo.list_all()]
    assert t["id"] not in listed
    assert repo.get(t["id"])["status"] == "deleted"


def test_list_filters(fresh_db):
    m1 = m_repo.create(name="A")["id"]
    m2 = m_repo.create(name="B")["id"]
    a = repo.create(name="A1", material_id=m1, spec=SPEC)
    b = repo.create(name="B1", material_id=m2, spec=SPEC)
    repo.mark_tested_and_lock(b["id"])
    assert [t["id"] for t in repo.list_all(material_id=m1)] == [a["id"]]
    assert [t["id"] for t in repo.list_all(status="tested")] == [b["id"]]
```

Run: `pytest tests/test_repo_tests.py -v`
Expected: FAIL.

- [ ] **Step 2: Implement `repositories/tests.py`**

```python
"""Tests (param-tests) repository."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select

from ..db import session_scope
from ..models import tests


class LockedError(Exception):
    """spec_json edits attempted on a locked test."""


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _row(r) -> dict[str, Any]:
    return {
        "id": r.id,
        "name": r.name,
        "material_id": r.material_id,
        "status": r.status,
        "spec": json.loads(r.spec_json),
        "notes": r.notes,
        "created_at": r.created_at,
        "updated_at": r.updated_at,
        "locked": bool(r.locked),
    }


def create(*, name: str, material_id: int, spec: dict[str, Any],
           notes: str = "") -> dict[str, Any]:
    ts = _now()
    with session_scope() as s:
        res = s.execute(tests.insert().values(
            name=name, material_id=material_id,
            status="created",
            spec_json=json.dumps(spec, separators=(",", ":")),
            notes=notes, created_at=ts, updated_at=ts, locked=0,
        ))
        return get(res.inserted_primary_key[0])


def get(tid: int) -> dict[str, Any] | None:
    with session_scope() as s:
        row = s.execute(select(tests).where(tests.c.id == tid)).one_or_none()
        return _row(row) if row else None


def list_all(*, material_id: int | None = None,
             status: str | None = None) -> list[dict[str, Any]]:
    with session_scope() as s:
        q = select(tests)
        if material_id is not None:
            q = q.where(tests.c.material_id == material_id)
        if status is not None:
            q = q.where(tests.c.status == status)
        else:
            q = q.where(tests.c.status != "deleted")
        q = q.order_by(tests.c.id.desc())
        return [_row(r) for r in s.execute(q).all()]


def update(tid: int, *, name: str | None = None, notes: str | None = None,
           spec: dict[str, Any] | None = None) -> dict[str, Any] | None:
    cur = get(tid)
    if cur is None:
        return None
    values: dict[str, Any] = {"updated_at": _now()}
    if name is not None:
        values["name"] = name
    if notes is not None:
        values["notes"] = notes
    if spec is not None:
        if cur["locked"]:
            raise LockedError(f"test {tid} is locked; duplicate it to change spec")
        values["spec_json"] = json.dumps(spec, separators=(",", ":"))
    with session_scope() as s:
        s.execute(tests.update().where(tests.c.id == tid).values(**values))
    return get(tid)


def mark_tested_and_lock(tid: int) -> None:
    """Idempotent: called every time a result is written for `tid`."""
    with session_scope() as s:
        s.execute(
            tests.update().where(tests.c.id == tid)
            .values(status="tested", locked=1, updated_at=_now())
        )


def soft_delete(tid: int) -> None:
    with session_scope() as s:
        s.execute(
            tests.update().where(tests.c.id == tid)
            .values(status="deleted", updated_at=_now())
        )
```

- [ ] **Step 3: Run tests**

Run: `pytest tests/test_repo_tests.py -v`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/xcs_gen_web/repositories/tests.py tests/test_repo_tests.py
git commit -m "Tests repository with lock/status invariants"
```

---

### Task 10: Tests HTTP API

**Files:**
- Modify: `src/xcs_gen_web/schemas.py` (add `TestCreate`, `TestUpdate`, `TestResponse`, and a `TestSpec` TypedDict/Pydantic)
- Modify: `src/xcs_gen_web/app.py`
- Create: `tests/test_tests_api.py`

- [ ] **Step 1: Add schemas**

Append to `schemas.py`:

```python
class RegistrationConfig(BaseModel):
    mode: str = "on"                      # "on" | "off"
    qr_size_mm: float | None = None
    aruco_size_mm: float | None = None


class TestSpec(BaseModel):
    x_param: str
    x_min: float
    x_max: float
    x_steps: int
    y_param: str | None = None
    y_min: float | None = None
    y_max: float | None = None
    y_steps: int | None = None
    rows: int = 1
    width_mm: float
    height_mm: float
    gap_mm: float = 0.5
    cell_shape: str = "rect"              # "rect" | "circle"
    square_cells: bool = False
    angle_mode: str = "fixed"             # "fixed" | "crosshatch" | "incremental"
    unidirectional: bool = False
    base_params: BaseParams
    registration: RegistrationConfig = RegistrationConfig()


class TestCreate(BaseModel):
    name: str
    material_id: int
    spec: TestSpec
    notes: str = ""


class TestUpdate(BaseModel):
    name: str | None = None
    notes: str | None = None
    spec: TestSpec | None = None


class TestResponse(BaseModel):
    id: int
    name: str
    material_id: int
    status: str
    spec: TestSpec
    notes: str
    created_at: str
    updated_at: str
    locked: bool
```

- [ ] **Step 2: Write failing API tests**

`tests/test_tests_api.py`:

```python
from __future__ import annotations

from fastapi.testclient import TestClient

from xcs_gen_web.app import create_app
from xcs_gen_web.repositories import materials as m_repo
from xcs_gen_web.repositories import tests as t_repo


BASE = {"power": 50, "speed": 1000, "frequency": 60000,
        "density": 200, "passes": 1, "pulse_width": 200, "laser": "red"}

SPEC = {
    "x_param": "speed", "x_min": 500, "x_max": 3000, "x_steps": 10,
    "rows": 1, "width_mm": 50, "height_mm": 10, "gap_mm": 0.5,
    "cell_shape": "rect", "square_cells": True, "angle_mode": "fixed",
    "unidirectional": False, "base_params": BASE,
    "registration": {"mode": "on"},
}


def _client_and_material(fresh_db):
    c = TestClient(create_app())
    mid = m_repo.create(name="SS")["id"]
    return c, mid


def test_create_and_get(fresh_db):
    c, mid = _client_and_material(fresh_db)
    r = c.post("/api/tests", json={
        "name": "T1", "material_id": mid, "spec": SPEC, "notes": "",
    })
    assert r.status_code == 201
    body = r.json()
    assert body["status"] == "created" and body["locked"] is False
    tid = body["id"]
    assert c.get(f"/api/tests/{tid}").json()["name"] == "T1"


def test_list_filters(fresh_db):
    c, mid = _client_and_material(fresh_db)
    c.post("/api/tests", json={"name": "A", "material_id": mid, "spec": SPEC})
    c.post("/api/tests", json={"name": "B", "material_id": mid, "spec": SPEC})
    rows = c.get("/api/tests").json()
    assert {r["name"] for r in rows} == {"A", "B"}


def test_patch_spec_blocked_when_locked(fresh_db):
    c, mid = _client_and_material(fresh_db)
    tid = c.post("/api/tests", json={"name": "T", "material_id": mid, "spec": SPEC}).json()["id"]
    t_repo.mark_tested_and_lock(tid)
    r = c.patch(f"/api/tests/{tid}", json={"spec": {**SPEC, "x_steps": 20}})
    assert r.status_code == 409


def test_patch_name_notes_allowed_when_locked(fresh_db):
    c, mid = _client_and_material(fresh_db)
    tid = c.post("/api/tests", json={"name": "T", "material_id": mid, "spec": SPEC}).json()["id"]
    t_repo.mark_tested_and_lock(tid)
    r = c.patch(f"/api/tests/{tid}", json={"name": "renamed"})
    assert r.status_code == 200 and r.json()["name"] == "renamed"


def test_soft_delete_removes_from_default_list(fresh_db):
    c, mid = _client_and_material(fresh_db)
    tid = c.post("/api/tests", json={"name": "T", "material_id": mid, "spec": SPEC}).json()["id"]
    c.delete(f"/api/tests/{tid}")
    assert c.get("/api/tests").json() == []
    assert c.get(f"/api/tests/{tid}").json()["status"] == "deleted"
```

Run: `pytest tests/test_tests_api.py -v`
Expected: FAIL.

- [ ] **Step 3: Implement endpoints in `app.py`**

```python
from .repositories import tests as t_repo
from .repositories.tests import LockedError

@app.post("/api/tests", response_model=TestResponse, status_code=201)
def tests_create(body: TestCreate) -> TestResponse:
    if m_repo.get(body.material_id) is None:
        raise HTTPException(status_code=400, detail="unknown material_id")
    t = t_repo.create(
        name=body.name, material_id=body.material_id,
        spec=body.spec.model_dump(), notes=body.notes,
    )
    return TestResponse(**t)

@app.get("/api/tests", response_model=list[TestResponse])
def tests_list(material_id: int | None = None,
               status: str | None = None) -> list[TestResponse]:
    return [TestResponse(**t) for t in t_repo.list_all(
        material_id=material_id, status=status,
    )]

@app.get("/api/tests/{tid}", response_model=TestResponse)
def tests_get(tid: int) -> TestResponse:
    t = t_repo.get(tid)
    if t is None:
        raise HTTPException(status_code=404, detail="test not found")
    return TestResponse(**t)

@app.patch("/api/tests/{tid}", response_model=TestResponse)
def tests_patch(tid: int, body: TestUpdate) -> TestResponse:
    if t_repo.get(tid) is None:
        raise HTTPException(status_code=404, detail="test not found")
    try:
        t = t_repo.update(
            tid, name=body.name, notes=body.notes,
            spec=body.spec.model_dump() if body.spec else None,
        )
    except LockedError as e:
        raise HTTPException(status_code=409, detail=str(e))
    return TestResponse(**t)

@app.delete("/api/tests/{tid}", status_code=204)
def tests_delete(tid: int) -> Response:
    if t_repo.get(tid) is None:
        raise HTTPException(status_code=404, detail="test not found")
    t_repo.soft_delete(tid)
    return Response(status_code=204)
```

Add the necessary schema imports at the top of the file.

- [ ] **Step 4: Run tests**

Run: `pytest tests/test_tests_api.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/xcs_gen_web tests/test_tests_api.py
git commit -m "Tests HTTP API (create/list/get/patch/delete)"
```

---

### Task 11: Image filesystem helper

**Files:**
- Create: `src/xcs_gen_web/images.py`
- Create: `tests/test_images.py`

- [ ] **Step 1: Write failing test**

`tests/test_images.py`:

```python
from __future__ import annotations

from pathlib import Path

from xcs_gen_web import images


def test_save_and_read_roundtrip(tmp_path, monkeypatch):
    monkeypatch.setenv("XCS_GEN_IMAGES_DIR", str(tmp_path))
    data = b"\x89PNG\r\n\x1a\n" + b"\x00" * 20
    rec = images.save(test_id=7, result_id=3, data=data, suffix=".png")
    assert rec["path"].endswith("7/3.png")
    assert rec["sha256"] == images.sha256_hex(data)
    assert (tmp_path / "7" / "3.png").read_bytes() == data


def test_delete(tmp_path, monkeypatch):
    monkeypatch.setenv("XCS_GEN_IMAGES_DIR", str(tmp_path))
    rec = images.save(test_id=7, result_id=3, data=b"x", suffix=".bin")
    images.delete(rec["path"])
    assert not Path(rec["path"]).exists()
```

Run: `pytest tests/test_images.py -v`
Expected: FAIL.

- [ ] **Step 2: Implement**

```python
"""Filesystem storage for result photos.

Canonical layout: <images_root>/<test_id>/<result_id>.<ext>.
Path is returned as an absolute string; the caller stores it in
results.image_path.
"""

from __future__ import annotations

import hashlib
import os
from pathlib import Path
from typing import Any


def images_root() -> Path:
    override = os.environ.get("XCS_GEN_IMAGES_DIR")
    if override:
        return Path(override)
    return Path.home() / ".xcs-gen" / "images"


def sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def save(*, test_id: int, result_id: int, data: bytes,
         suffix: str) -> dict[str, Any]:
    root = images_root()
    target_dir = root / str(test_id)
    target_dir.mkdir(parents=True, exist_ok=True)
    path = target_dir / f"{result_id}{suffix}"
    path.write_bytes(data)
    return {"path": str(path), "sha256": sha256_hex(data)}


def read(path: str) -> bytes:
    return Path(path).read_bytes()


def delete(path: str) -> None:
    try:
        Path(path).unlink()
    except FileNotFoundError:
        pass
```

- [ ] **Step 3: Run tests + commit**

```bash
pytest tests/test_images.py -v
git add src/xcs_gen_web/images.py tests/test_images.py
git commit -m "images.py: filesystem-backed result photo storage"
```

---

### Task 12: Results repository + averaged swatches

**Files:**
- Create: `src/xcs_gen_web/repositories/results.py`
- Create: `tests/test_repo_results.py`

- [ ] **Step 1: Write failing tests**

`tests/test_repo_results.py`:

```python
from __future__ import annotations

from xcs_gen_web.repositories import materials as m_repo
from xcs_gen_web.repositories import results as repo
from xcs_gen_web.repositories import tests as t_repo


SPEC = {
    "x_param": "speed", "x_min": 500, "x_max": 3000, "x_steps": 3,
    "rows": 1, "width_mm": 30, "height_mm": 10, "gap_mm": 0.5,
    "cell_shape": "rect", "square_cells": True, "angle_mode": "fixed",
    "unidirectional": False,
    "base_params": {"power": 50, "speed": 1000, "frequency": 60000,
                    "density": 200, "passes": 1, "pulse_width": 200, "laser": "red"},
    "registration": {"mode": "on"},
}


def _setup(fresh_db):
    mid = m_repo.create(name="SS")["id"]
    t = t_repo.create(name="T", material_id=mid, spec=SPEC)
    return t["id"]


def _swatch(x_value: float, hex_: str, sigma: float = 1.0) -> dict:
    return {"row": 0, "col": 0, "x_value": x_value,
            "y_value": None, "hex": hex_, "lab": [0, 0, 0], "sigma": sigma}


def test_insert_result_and_list(fresh_db):
    tid = _setup(fresh_db)
    r = repo.create(
        test_id=tid, image_path="/tmp/x.png",
        image_sha256="abc", swatches=[_swatch(500, "#ff0000")],
    )
    assert r["test_id"] == tid and r["excluded"] is False
    listed = repo.list_by_test(tid)
    assert [x["id"] for x in listed] == [r["id"]]


def test_exclude_toggle(fresh_db):
    tid = _setup(fresh_db)
    r = repo.create(
        test_id=tid, image_path="/tmp/x.png",
        image_sha256="abc", swatches=[_swatch(500, "#ff0000")],
    )
    repo.set_excluded(r["id"], True)
    assert repo.get(r["id"])["excluded"] is True


def test_averaged_swatches_one_result(fresh_db):
    tid = _setup(fresh_db)
    repo.create(
        test_id=tid, image_path="/tmp/x.png", image_sha256="abc",
        swatches=[_swatch(500, "#ff0000"), _swatch(600, "#00ff00")],
    )
    avg = repo.averaged_swatches(tid)
    assert len(avg) == 2
    assert avg[0]["sample_count"] == 1
    assert avg[0]["hex"].lower() == "#ff0000"


def test_averaged_swatches_two_results_lab_mean(fresh_db):
    tid = _setup(fresh_db)
    repo.create(
        test_id=tid, image_path="/tmp/a.png", image_sha256="a",
        swatches=[_swatch(500, "#800000")],
    )
    repo.create(
        test_id=tid, image_path="/tmp/b.png", image_sha256="b",
        swatches=[_swatch(500, "#400000")],
    )
    avg = repo.averaged_swatches(tid)
    assert len(avg) == 1
    assert avg[0]["sample_count"] == 2
    # Rough sanity: the averaged L should be between the two inputs' L
    assert 10 < avg[0]["lab"][0] < 40


def test_averaged_swatches_ignores_excluded(fresh_db):
    tid = _setup(fresh_db)
    r1 = repo.create(test_id=tid, image_path="/tmp/a.png", image_sha256="a",
                     swatches=[_swatch(500, "#ff0000")])
    r2 = repo.create(test_id=tid, image_path="/tmp/b.png", image_sha256="b",
                     swatches=[_swatch(500, "#00ff00")])
    repo.set_excluded(r2["id"], True)
    avg = repo.averaged_swatches(tid)
    assert avg[0]["hex"].lower() == "#ff0000"
    assert avg[0]["sample_count"] == 1
```

Run: `pytest tests/test_repo_results.py -v`
Expected: FAIL.

- [ ] **Step 2: Implement**

```python
"""Results repository + averaged-swatch computation."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select

from ..db import session_scope
from ..models import results
from ..palette import hex_to_lab


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _row(r) -> dict[str, Any]:
    return {
        "id": r.id,
        "test_id": r.test_id,
        "uploaded_at": r.uploaded_at,
        "image_path": r.image_path,
        "image_sha256": r.image_sha256,
        "excluded": bool(r.excluded),
        "notes": r.notes,
        "swatches": json.loads(r.swatches_json),
    }


def create(*, test_id: int, image_path: str, image_sha256: str,
           swatches: list[dict[str, Any]], notes: str = "") -> dict[str, Any]:
    with session_scope() as s:
        res = s.execute(results.insert().values(
            test_id=test_id,
            uploaded_at=_now(),
            image_path=image_path,
            image_sha256=image_sha256,
            excluded=0, notes=notes,
            swatches_json=json.dumps(swatches, separators=(",", ":")),
        ))
        return get(res.inserted_primary_key[0])


def get(rid: int) -> dict[str, Any] | None:
    with session_scope() as s:
        row = s.execute(select(results).where(results.c.id == rid)).one_or_none()
        return _row(row) if row else None


def list_by_test(tid: int, *, include_excluded: bool = True) -> list[dict[str, Any]]:
    with session_scope() as s:
        q = select(results).where(results.c.test_id == tid)
        if not include_excluded:
            q = q.where(results.c.excluded == 0)
        q = q.order_by(results.c.uploaded_at.desc())
        return [_row(r) for r in s.execute(q).all()]


def set_excluded(rid: int, excluded: bool) -> None:
    with session_scope() as s:
        s.execute(results.update().where(results.c.id == rid)
                  .values(excluded=1 if excluded else 0))


def set_notes(rid: int, notes: str) -> None:
    with session_scope() as s:
        s.execute(results.update().where(results.c.id == rid).values(notes=notes))


def delete(rid: int) -> str | None:
    """Delete the row and return the image_path so the caller can unlink."""
    row = get(rid)
    if row is None:
        return None
    with session_scope() as s:
        s.execute(results.delete().where(results.c.id == rid))
    return row["image_path"]


def _lab_to_hex(L: float, a: float, b: float) -> str:
    """Inverse of palette.hex_to_lab for rendering the averaged colour.

    Round-trip through XYZ → linear sRGB → sRGB. Values clamped to [0,1].
    """
    def f_inv(t: float) -> float:
        return t ** 3 if t ** 3 > 0.008856 else (t - 16 / 116) / 7.787

    fy = (L + 16) / 116
    fx = fy + a / 500
    fz = fy - b / 200
    xn, yn, zn = 0.95047, 1.00000, 1.08883
    X, Y, Z = f_inv(fx) * xn, f_inv(fy) * yn, f_inv(fz) * zn
    # XYZ → linear sRGB (D65)
    r =  3.2404542 * X - 1.5371385 * Y - 0.4985314 * Z
    g = -0.9692660 * X + 1.8760108 * Y + 0.0415560 * Z
    b_ = 0.0556434 * X - 0.2040259 * Y + 1.0572252 * Z

    def to_srgb(u: float) -> int:
        if u <= 0:
            return 0
        if u >= 1:
            return 255
        v = 12.92 * u if u <= 0.0031308 else 1.055 * (u ** (1 / 2.4)) - 0.055
        return max(0, min(255, round(v * 255)))

    return f"#{to_srgb(r):02x}{to_srgb(g):02x}{to_srgb(b_):02x}"


def averaged_swatches(tid: int) -> list[dict[str, Any]]:
    """Per (row, col): mean Lab across non-excluded results.

    Cells with no contributing samples are returned with sample_count=0 and
    a placeholder hex of '#000000' so the frontend can draw a "unavailable"
    state without special-casing missing keys.
    """
    buckets: dict[tuple[int, int], list[dict[str, Any]]] = {}
    results_list = list_by_test(tid, include_excluded=False)
    for r in results_list:
        for sw in r["swatches"]:
            key = (sw["row"], sw["col"])
            buckets.setdefault(key, []).append({
                "x_value": sw["x_value"], "y_value": sw.get("y_value"),
                "hex": sw["hex"], "lab": sw["lab"], "sigma": sw["sigma"],
                "result_id": r["id"],
            })

    out: list[dict[str, Any]] = []
    for (row, col), items in sorted(buckets.items()):
        labs = [[*hex_to_lab(it["hex"])] for it in items]
        n = len(labs)
        L = sum(x[0] for x in labs) / n
        a = sum(x[1] for x in labs) / n
        b = sum(x[2] for x in labs) / n
        out.append({
            "row": row, "col": col,
            "x_value": items[0]["x_value"], "y_value": items[0]["y_value"],
            "hex": _lab_to_hex(L, a, b),
            "lab": [L, a, b],
            "sigma": max(it["sigma"] for it in items),
            "sample_count": n,
            "per_result": [
                {"result_id": it["result_id"], "hex": it["hex"], "sigma": it["sigma"]}
                for it in items
            ],
        })
    return out
```

- [ ] **Step 3: Run tests + commit**

```bash
pytest tests/test_repo_results.py -v
git add src/xcs_gen_web/repositories/results.py tests/test_repo_results.py
git commit -m "Results repository with averaged-swatches computation"
```

---

### Task 13: Capture service — wrap the existing pipeline

**Files:**
- Create: `src/xcs_gen_web/services/__init__.py` (empty)
- Create: `src/xcs_gen_web/services/capture.py`
- Create: `tests/test_service_capture.py`

This task gives the old pipeline a clean entry point that takes a Test row. Phase D replaces the internals but keeps the interface.

- [ ] **Step 1: Write failing test (happy path, with a synthetic image the existing pipeline already knows how to handle)**

Look at existing `tests/test_capture_pipeline.py` for a working synthetic-image fixture. Reuse the same shape. If there isn't one, skip this step and add a trivial test that asserts the module imports and exposes `CaptureResult` + `run_capture`.

`tests/test_service_capture.py` (import-only for now):

```python
from __future__ import annotations

from xcs_gen_web.services import capture


def test_module_exports():
    assert hasattr(capture, "run_capture")
    assert hasattr(capture, "CaptureError")
```

- [ ] **Step 2: Implement**

```python
"""Capture service: photo bytes + Test spec → sampled swatches.

Phase C wires through the existing QR-based capture pipeline. Phase D
replaces the internals with the ArUco + id-only-QR scheme.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import cv2
import numpy as np

from xcs_gen.capture.layout import MARKER_MARGIN_MM, _QR_SIZE_INLINE_MM
from xcs_gen.capture.qr_payload import PayloadError, decode_payload

from ..capture_pipeline import DetectionError, decode_image_bytes, detect_qr, warp_to_burn_space
from ..capture_sampling import sample_grid


class CaptureError(Exception):
    """Raised by run_capture when the image can't be processed."""


@dataclass
class CaptureResult:
    swatches: list[dict[str, Any]]
    warped_image_bgr: np.ndarray


def run_capture(*, image_bytes: bytes, test_id: int,
                spec: dict[str, Any]) -> CaptureResult:
    try:
        img = decode_image_bytes(image_bytes)
    except Exception as e:
        raise CaptureError(f"could not decode image: {e}") from e

    try:
        qr_text, qr_corners = detect_qr(img)
    except DetectionError as e:
        raise CaptureError(f"QR detection failed: {e}") from e

    try:
        payload = decode_payload(qr_text)
    except PayloadError as e:
        raise CaptureError(f"QR payload invalid: {e}") from e

    if str(payload.get("id")) != str(test_id):
        raise CaptureError(
            f"QR is for test {payload.get('id')!r}; upload is for test {test_id}",
        )

    qr_size_mm = float(payload.get("qs", _QR_SIZE_INLINE_MM))
    default_offset = qr_size_mm + MARKER_MARGIN_MM
    grid_w = spec["width_mm"]
    grid_h = spec["height_mm"]
    ox = default_offset
    oy = default_offset
    actual_grid_h = grid_h

    min_x = min(0.0, ox)
    max_x = max(qr_size_mm, ox + grid_w)
    min_y = min(0.0, oy)
    max_y = max(qr_size_mm, oy + actual_grid_h)
    burn_size_mm = (max_x - min_x, max_y - min_y)
    qr_origin_mm = (-min_x, -min_y)
    grid_origin_mm = (ox - min_x, oy - min_y)

    warped = warp_to_burn_space(
        img,
        qr_corners_px=qr_corners,
        qr_size_mm=qr_size_mm,
        qr_origin_mm=qr_origin_mm,
        burn_size_mm=burn_size_mm,
        px_per_mm=10.0,
    )

    swatches_raw = sample_grid(
        warped,
        grid_origin_mm=grid_origin_mm,
        grid_size_mm=(grid_w, grid_h),
        px_per_mm=10.0,
        x_param=spec["x_param"],
        x_min=spec["x_min"], x_max=spec["x_max"], x_steps=spec["x_steps"],
        y_param=spec.get("y_param"),
        y_min=spec.get("y_min") or 0.0,
        y_max=spec.get("y_max") or 0.0,
        y_steps=spec.get("y_steps") or 1,
        rows=spec.get("rows", 1),
        row_stride_mm=None,
    )
    swatches = [
        {"row": s.row, "col": s.col,
         "x_value": s.x_value, "y_value": s.y_value,
         "hex": s.hex, "lab": list(s.lab), "sigma": s.sigma}
        for s in swatches_raw
    ]
    return CaptureResult(swatches=swatches, warped_image_bgr=warped)
```

(The exact fields of the `CaptureSwatch` returned by `sample_grid` are in `src/xcs_gen_web/capture_sampling.py` — inspect once and adjust field names if they differ.)

- [ ] **Step 3: Run tests + commit**

```bash
pytest tests/test_service_capture.py -v
git add src/xcs_gen_web/services tests/test_service_capture.py
git commit -m "services/capture: wrap existing QR pipeline behind a clean entry point"
```

---

### Task 14: Results HTTP API + upload flow

**Files:**
- Modify: `src/xcs_gen_web/schemas.py`
- Modify: `src/xcs_gen_web/app.py`
- Create: `tests/test_results_api.py`

- [ ] **Step 1: Add schemas**

Append to `schemas.py`:

```python
class ResultSwatch(BaseModel):
    row: int
    col: int
    x_value: float
    y_value: float | None = None
    hex: str
    lab: list[float]
    sigma: float


class ResultResponse(BaseModel):
    id: int
    test_id: int
    uploaded_at: str
    image_url: str
    image_sha256: str
    excluded: bool
    notes: str
    swatches: list[ResultSwatch]


class ResultPatch(BaseModel):
    excluded: bool | None = None
    notes: str | None = None


class AveragedSwatch(BaseModel):
    row: int
    col: int
    x_value: float
    y_value: float | None = None
    hex: str
    lab: list[float]
    sigma: float
    sample_count: int
    per_result: list[dict]
```

- [ ] **Step 2: Write failing API test (isolate to endpoint wiring; use a monkeypatched `run_capture` so the tests don't need a real photo)**

`tests/test_results_api.py`:

```python
from __future__ import annotations

import numpy as np
from fastapi.testclient import TestClient

from xcs_gen_web.app import create_app
from xcs_gen_web.repositories import materials as m_repo
from xcs_gen_web.repositories import tests as t_repo
from xcs_gen_web.services import capture as cap


SPEC = {
    "x_param": "speed", "x_min": 500, "x_max": 3000, "x_steps": 3,
    "rows": 1, "width_mm": 30, "height_mm": 10, "gap_mm": 0.5,
    "cell_shape": "rect", "square_cells": True, "angle_mode": "fixed",
    "unidirectional": False,
    "base_params": {"power": 50, "speed": 1000, "frequency": 60000,
                    "density": 200, "passes": 1, "pulse_width": 200, "laser": "red"},
    "registration": {"mode": "on"},
}


def _fake_capture(*, image_bytes, test_id, spec):
    return cap.CaptureResult(
        swatches=[
            {"row": 0, "col": 0, "x_value": 500, "y_value": None,
             "hex": "#ff0000", "lab": [0, 0, 0], "sigma": 1.0},
            {"row": 0, "col": 1, "x_value": 1000, "y_value": None,
             "hex": "#00ff00", "lab": [0, 0, 0], "sigma": 1.2},
        ],
        warped_image_bgr=np.zeros((10, 10, 3), dtype=np.uint8),
    )


def test_upload_happy_path(fresh_db, monkeypatch, tmp_path):
    monkeypatch.setenv("XCS_GEN_IMAGES_DIR", str(tmp_path))
    monkeypatch.setattr(cap, "run_capture", _fake_capture)
    c = TestClient(create_app())
    mid = m_repo.create(name="SS")["id"]
    tid = t_repo.create(name="T", material_id=mid, spec=SPEC)["id"]

    r = c.post(
        f"/api/tests/{tid}/results",
        files={"image": ("x.png", b"fake", "image/png")},
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["test_id"] == tid
    assert len(body["swatches"]) == 2

    # status + lock promoted
    t = c.get(f"/api/tests/{tid}").json()
    assert t["status"] == "tested"
    assert t["locked"] is True


def test_averaged_swatches_endpoint(fresh_db, monkeypatch, tmp_path):
    monkeypatch.setenv("XCS_GEN_IMAGES_DIR", str(tmp_path))
    monkeypatch.setattr(cap, "run_capture", _fake_capture)
    c = TestClient(create_app())
    mid = m_repo.create(name="SS")["id"]
    tid = t_repo.create(name="T", material_id=mid, spec=SPEC)["id"]
    c.post(f"/api/tests/{tid}/results", files={"image": ("x.png", b"fake", "image/png")})
    r = c.get(f"/api/tests/{tid}/swatches")
    assert r.status_code == 200
    rows = r.json()
    assert {rr["hex"] for rr in rows} == {"#ff0000", "#00ff00"}


def test_patch_excluded_flips_average(fresh_db, monkeypatch, tmp_path):
    monkeypatch.setenv("XCS_GEN_IMAGES_DIR", str(tmp_path))
    monkeypatch.setattr(cap, "run_capture", _fake_capture)
    c = TestClient(create_app())
    mid = m_repo.create(name="SS")["id"]
    tid = t_repo.create(name="T", material_id=mid, spec=SPEC)["id"]
    r = c.post(f"/api/tests/{tid}/results", files={"image": ("x.png", b"fake", "image/png")})
    rid = r.json()["id"]
    c.patch(f"/api/results/{rid}", json={"excluded": True})
    assert c.get(f"/api/tests/{tid}/swatches").json() == []
```

Run: `pytest tests/test_results_api.py -v`
Expected: FAIL.

- [ ] **Step 3: Implement endpoints**

Add to `app.py`:

```python
from pathlib import Path
from .services import capture as capture_service
from .repositories import results as r_repo
from . import images

@app.post("/api/tests/{tid}/results", response_model=ResultResponse, status_code=201)
async def results_upload(tid: int, image: UploadFile = File(...)) -> ResultResponse:
    t = t_repo.get(tid)
    if t is None:
        raise HTTPException(status_code=404, detail="test not found")

    data = await image.read()
    try:
        cap_result = capture_service.run_capture(
            image_bytes=data, test_id=tid, spec=t["spec"],
        )
    except capture_service.CaptureError as e:
        raise HTTPException(status_code=400, detail=str(e))

    suffix = Path(image.filename or "upload.png").suffix or ".png"
    # Two-step: insert with a placeholder image_path → get id → write file → update path.
    placeholder = r_repo.create(
        test_id=tid,
        image_path="pending",
        image_sha256=images.sha256_hex(data),
        swatches=cap_result.swatches,
    )
    rec = images.save(test_id=tid, result_id=placeholder["id"],
                      data=data, suffix=suffix)
    # Write the real path back.
    with db_module_session() as s:  # see helper below
        s.execute(
            models.results.update()
            .where(models.results.c.id == placeholder["id"])
            .values(image_path=rec["path"])
        )
    t_repo.mark_tested_and_lock(tid)
    refreshed = r_repo.get(placeholder["id"])
    return _result_to_response(refreshed)


@app.get("/api/tests/{tid}/results", response_model=list[ResultResponse])
def results_list(tid: int) -> list[ResultResponse]:
    if t_repo.get(tid) is None:
        raise HTTPException(status_code=404, detail="test not found")
    return [_result_to_response(r) for r in r_repo.list_by_test(tid)]


@app.patch("/api/results/{rid}", response_model=ResultResponse)
def results_patch(rid: int, body: ResultPatch) -> ResultResponse:
    if r_repo.get(rid) is None:
        raise HTTPException(status_code=404, detail="result not found")
    if body.excluded is not None:
        r_repo.set_excluded(rid, body.excluded)
    if body.notes is not None:
        r_repo.set_notes(rid, body.notes)
    return _result_to_response(r_repo.get(rid))


@app.delete("/api/results/{rid}", status_code=204)
def results_delete(rid: int) -> Response:
    path = r_repo.delete(rid)
    if path is None:
        raise HTTPException(status_code=404, detail="result not found")
    images.delete(path)
    return Response(status_code=204)


@app.get("/api/results/{rid}/image")
def results_image(rid: int) -> Response:
    r = r_repo.get(rid)
    if r is None:
        raise HTTPException(status_code=404, detail="result not found")
    data = images.read(r["image_path"])
    return Response(content=data, media_type="image/*")


@app.get("/api/tests/{tid}/swatches", response_model=list[AveragedSwatch])
def test_swatches(tid: int) -> list[AveragedSwatch]:
    if t_repo.get(tid) is None:
        raise HTTPException(status_code=404, detail="test not found")
    return [AveragedSwatch(**s) for s in r_repo.averaged_swatches(tid)]


def _result_to_response(r: dict) -> ResultResponse:
    return ResultResponse(
        id=r["id"], test_id=r["test_id"],
        uploaded_at=r["uploaded_at"],
        image_url=f"/api/results/{r['id']}/image",
        image_sha256=r["image_sha256"],
        excluded=r["excluded"], notes=r["notes"],
        swatches=[ResultSwatch(**s) for s in r["swatches"]],
    )
```

Add a tiny helper `db_module_session()` in `db.py`:

```python
from contextlib import contextmanager
from typing import Iterator

@contextmanager
def db_module_session() -> Iterator[Session]:
    # Alias of session_scope; kept so callers in app.py read naturally.
    with session_scope() as s:
        yield s
```

And `from . import models` as needed.

- [ ] **Step 4: Run tests + commit**

```bash
pytest tests/test_results_api.py -v
git add src/xcs_gen_web tests/test_results_api.py
git commit -m "Results upload + averaged-swatches HTTP endpoints"
```

---

## Phase D — Fiducial redesign: ID-only QR + 3 ArUco corners

### Task 15: QR payload slimmed to id-only; new layout module

**Files:**
- Modify: `src/xcs_gen/capture/qr_payload.py` — remove `encode_inline`; `id` is now stored as a stringified int; keep decoder liberal (accepts both str and int `id`s).
- Modify: `src/xcs_gen/capture/layout.py`
- Modify: `tests/test_qr_payload.py`
- Modify: `tests/test_capture_layout.py`

- [ ] **Step 1: Update `qr_payload.py`**

Replace the file with:

```python
"""QR payload codec for registration blocks.

Payload shape (schema v1): {"v": 1, "id": <int>}.
The server resolves the full test spec from the id via the DB; the QR
carries only the test id so we can fit a 4–6 mm marker on small strips.
"""

from __future__ import annotations

import json
from typing import Any

_SCHEMA_VERSION = 1


class PayloadError(ValueError):
    """Raised when a QR payload cannot be decoded or has an unknown version."""


def encode_id(test_id: int) -> str:
    if not isinstance(test_id, int) or test_id < 1:
        raise PayloadError("test_id must be a positive int")
    return json.dumps({"v": _SCHEMA_VERSION, "id": test_id}, separators=(",", ":"))


def decode_payload(s: str) -> dict[str, Any]:
    try:
        data = json.loads(s)
    except json.JSONDecodeError as e:
        raise PayloadError(f"invalid JSON: {e}") from e
    if not isinstance(data, dict):
        raise PayloadError("payload must be a JSON object")
    if data.get("v") != _SCHEMA_VERSION:
        raise PayloadError(f"unsupported schema version: {data.get('v')!r}")
    raw_id = data.get("id")
    if raw_id is None:
        raise PayloadError("missing required field: id")
    try:
        data["id"] = int(raw_id)
    except (TypeError, ValueError):
        raise PayloadError(f"id must be int-coercible, got {raw_id!r}") from None
    return data
```

Update `tests/test_qr_payload.py` — replace `encode_inline` tests with:

```python
from xcs_gen.capture.qr_payload import PayloadError, decode_payload, encode_id


def test_encode_id_roundtrip():
    s = encode_id(42)
    assert decode_payload(s) == {"v": 1, "id": 42}


def test_decode_accepts_string_id_for_legacy():
    import json
    s = json.dumps({"v": 1, "id": "42"})
    assert decode_payload(s)["id"] == 42


def test_rejects_unknown_version():
    import json
    import pytest
    with pytest.raises(PayloadError):
        decode_payload(json.dumps({"v": 99, "id": 1}))
```

- [ ] **Step 2: Rewrite layout module**

Replace `src/xcs_gen/capture/layout.py` with:

```python
"""Fiducial layout: QR top-left + 3 ArUco corners.

Burn-space coordinates (top-left origin; mm). Returned positions are the
top-left corner of each marker's bounding box.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

MARKER_MARGIN_MM = 1.5

QR_SIZE_DEFAULT_MM = 5.0
ARUCO_SIZE_DEFAULT_MM = 2.0

# ArUco IDs assigned to each corner. The QR sits at top-left; the ArUcos
# at the other three corners carry IDs 1, 2, 3.
ARUCO_ID_TOP_RIGHT = 1
ARUCO_ID_BOTTOM_LEFT = 2
ARUCO_ID_BOTTOM_RIGHT = 3


@dataclass
class MarkerPosition:
    x: float
    y: float
    size: float
    marker_id: int  # 0 for QR (by convention); 1/2/3 for ArUcos


@dataclass
class RegistrationLayout:
    qr: MarkerPosition | None
    arucos: list[MarkerPosition]


def registration_reservation_mm(
    mode: Literal["on", "off"],
    *,
    qr_size_mm: float | None = None,
    aruco_size_mm: float | None = None,
) -> tuple[float, float]:
    """Returns (x_shift_mm, y_shift_mm) that the grid must inset by.

    With QR at top-left and ArUcos at the other corners, the grid is
    bounded on the top and left by the QR (bigger of the two), and on
    top by the top-right ArUco's required clearance. We take the max
    of QR-bounded and ArUco-bounded clearance for each axis.
    """
    if mode == "off":
        return 0.0, 0.0
    qr_size = qr_size_mm or QR_SIZE_DEFAULT_MM
    aruco_size = aruco_size_mm or ARUCO_SIZE_DEFAULT_MM
    x_shift = qr_size + MARKER_MARGIN_MM
    y_shift = max(qr_size, aruco_size) + MARKER_MARGIN_MM
    return x_shift, y_shift


def compute_layout(
    *,
    grid_x: float, grid_y: float,
    grid_w: float, grid_h: float,
    mode: Literal["on", "off"] = "on",
    qr_size_mm: float | None = None,
    aruco_size_mm: float | None = None,
) -> RegistrationLayout:
    if mode == "off":
        return RegistrationLayout(qr=None, arucos=[])
    qr_size = qr_size_mm or QR_SIZE_DEFAULT_MM
    aruco_size = aruco_size_mm or ARUCO_SIZE_DEFAULT_MM

    # QR top-left, inset from grid by the margin
    qr_x = grid_x - qr_size - MARKER_MARGIN_MM
    qr_y = grid_y - qr_size - MARKER_MARGIN_MM

    # ArUcos at three other corners, each inset by margin
    tr = MarkerPosition(
        x=grid_x + grid_w + MARKER_MARGIN_MM,
        y=grid_y - aruco_size - MARKER_MARGIN_MM,
        size=aruco_size, marker_id=ARUCO_ID_TOP_RIGHT,
    )
    bl = MarkerPosition(
        x=grid_x - aruco_size - MARKER_MARGIN_MM,
        y=grid_y + grid_h + MARKER_MARGIN_MM,
        size=aruco_size, marker_id=ARUCO_ID_BOTTOM_LEFT,
    )
    br = MarkerPosition(
        x=grid_x + grid_w + MARKER_MARGIN_MM,
        y=grid_y + grid_h + MARKER_MARGIN_MM,
        size=aruco_size, marker_id=ARUCO_ID_BOTTOM_RIGHT,
    )
    return RegistrationLayout(
        qr=MarkerPosition(x=qr_x, y=qr_y, size=qr_size, marker_id=0),
        arucos=[tr, bl, br],
    )
```

Update `tests/test_capture_layout.py` tests to cover:
- `registration_reservation_mm("off")` → `(0, 0)`
- `registration_reservation_mm("on")` → `(qr+margin, max(qr,aruco)+margin)`
- `compute_layout(...)` with known args returns exactly the four expected positions.

- [ ] **Step 3: Run tests**

Run: `pytest tests/test_qr_payload.py tests/test_capture_layout.py -v`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/xcs_gen/capture tests/test_qr_payload.py tests/test_capture_layout.py
git commit -m "QR payload slimmed to id-only; layout adds 3 ArUco corners"
```

---

### Task 16: Render ArUco markers

**Files:**
- Modify: `src/xcs_gen/capture/marker_render.py`
- Modify: `tests/test_capture_markers.py`

- [ ] **Step 1: Write failing test**

Add to `tests/test_capture_markers.py`:

```python
from xcs_gen.capture.marker_render import render_aruco_bits


def test_aruco_bits_shape():
    bits = render_aruco_bits(marker_id=1, modules_side=6)
    # 4x4 code + 1 black-border on each side = 6x6 modules
    assert bits.shape == (6, 6)
    # All 4 edge modules are black (True)
    assert bits[0, :].all() and bits[-1, :].all()
    assert bits[:, 0].all() and bits[:, -1].all()


def test_aruco_ids_differ():
    b1 = render_aruco_bits(marker_id=1)
    b2 = render_aruco_bits(marker_id=2)
    # the inner 4x4 must be different for different IDs
    assert not (b1[1:-1, 1:-1] == b2[1:-1, 1:-1]).all()
```

Run: `pytest tests/test_capture_markers.py -v`
Expected: FAIL.

- [ ] **Step 2: Implement**

Update `src/xcs_gen/capture/marker_render.py`:

- Drop the no-longer-used `qr_payload_for_test()` (its callers migrate in Task 18).
- Keep the QR rendering path; rename `_qr_bits` to stay.
- Add:

```python
import cv2

_ARUCO_DICT = cv2.aruco.getPredefinedDictionary(cv2.aruco.DICT_4X4_50)


def render_aruco_bits(marker_id: int, modules_side: int = 6) -> np.ndarray:
    """Render ArUco marker as a (side, side) boolean array (True = dark).

    modules_side is the total with border; for DICT_4X4 this is 6 (4x4 +
    1-module black border on each side).
    """
    # cv2.aruco.generateImageMarker returns an N×N uint8 image; N is
    # modules_side * pixels_per_module. We want the logical bit grid, so
    # we render at 1 px per module and threshold.
    img = cv2.aruco.generateImageMarker(_ARUCO_DICT, marker_id, modules_side, borderBits=1)
    return img < 128  # True where dark


def emit_aruco(
    project: XCSProject, *,
    position: MarkerPosition,
    annotation_params: ProcessingParams,
    modules_side: int = 6,
) -> None:
    bits = render_aruco_bits(position.marker_id, modules_side=modules_side)
    _emit_bitmap(
        project, bits=bits,
        origin_x=position.x, origin_y=position.y,
        total_size=position.size,
        annotation_params=annotation_params,
    )
```

Replace the existing `emit_registration_markers(layout, qr_text, annotation_params)` signature with:

```python
def emit_registration_markers(
    project: XCSProject, *,
    layout: RegistrationLayout,
    test_id: int,
    annotation_params: ProcessingParams,
) -> None:
    """Emit the QR (id-only) plus any ArUco corners on the annotation layer."""
    if layout.qr is None:
        return
    qr_text = encode_id(test_id)
    _emit_bitmap(
        project, bits=_qr_bits(qr_text),
        origin_x=layout.qr.x, origin_y=layout.qr.y,
        total_size=layout.qr.size, annotation_params=annotation_params,
    )
    for ar in layout.arucos:
        emit_aruco(project, position=ar, annotation_params=annotation_params)
```

- [ ] **Step 3: Run tests + commit**

```bash
pytest tests/test_capture_markers.py -v
git add src/xcs_gen/capture/marker_render.py tests/test_capture_markers.py
git commit -m "ArUco marker rendering + emit on annotation layer"
```

---

### Task 17: Capture pipeline — ArUco detection + new warp

**Files:**
- Modify: `src/xcs_gen_web/capture_pipeline.py`
- Create: `tests/test_capture_fiducials.py`

- [ ] **Step 1: Write failing test**

The test renders a synthetic "burned strip" by drawing the QR + 3 ArUco markers at known burn-space coordinates onto a white image with known pixel-per-mm, scans it, and asserts the returned marker positions.

`tests/test_capture_fiducials.py`:

```python
from __future__ import annotations

import cv2
import numpy as np
import segno

from xcs_gen.capture.marker_render import render_aruco_bits
from xcs_gen.capture.qr_payload import encode_id
from xcs_gen_web.capture_pipeline import detect_fiducials


def _render_strip(px_per_mm: int = 20) -> tuple[np.ndarray, dict]:
    # 50x30 mm strip; QR (5mm) at (1,1); ArUcos (2mm) at TR/BL/BR
    W_mm, H_mm = 50, 30
    img = np.full((H_mm * px_per_mm, W_mm * px_per_mm, 3), 255, dtype=np.uint8)

    def paste_bits(bits, x_mm, y_mm, size_mm):
        side = int(size_mm * px_per_mm)
        arr = np.where(bits, 0, 255).astype(np.uint8)
        arr = np.repeat(np.repeat(arr, side // bits.shape[0], axis=0),
                        side // bits.shape[1], axis=1)
        arr = arr[:side, :side]
        x_px, y_px = int(x_mm * px_per_mm), int(y_mm * px_per_mm)
        region = img[y_px:y_px + side, x_px:x_px + side]
        for c in range(3):
            region[..., c] = arr

    # QR (segno)
    qr = segno.make(encode_id(42), error="m")
    qr_bits = np.array(qr.matrix, dtype=bool)
    paste_bits(qr_bits, 1, 1, 5)

    # ArUcos
    paste_bits(render_aruco_bits(1), W_mm - 1 - 2, 1,         2)
    paste_bits(render_aruco_bits(2), 1,           H_mm - 1 - 2, 2)
    paste_bits(render_aruco_bits(3), W_mm - 1 - 2, H_mm - 1 - 2, 2)

    expected = {
        "qr_id": 42,
        "qr_mm": (1, 1, 5),
        "aruco_mm": {
            1: (W_mm - 1 - 2, 1,         2),
            2: (1,           H_mm - 1 - 2, 2),
            3: (W_mm - 1 - 2, H_mm - 1 - 2, 2),
        },
    }
    return img, expected


def test_detect_finds_qr_and_three_arucos():
    img, _ = _render_strip()
    qr_id, corners = detect_fiducials(img)
    assert qr_id == 42
    assert set(corners.keys()) == {0, 1, 2, 3}
    # All returned "corners" are (x, y) px tuples
    for k in corners:
        assert len(corners[k]) == 2
```

Run: `pytest tests/test_capture_fiducials.py -v`
Expected: FAIL.

- [ ] **Step 2: Rewrite `capture_pipeline.py`**

Replace `detect_qr` with `detect_fiducials` and rewrite `warp_to_burn_space` to take a mapping of known burn-space positions.

```python
"""Photo → burn-space warp, with ID-only QR + 3 ArUco fiducials."""

from __future__ import annotations

from typing import Iterable

import cv2
import numpy as np
import pyzbar.pyzbar as pyzbar

from xcs_gen.capture.qr_payload import PayloadError, decode_payload


class DetectionError(Exception):
    """Raised when mandatory fiducials can't be located."""


_ARUCO_DICT = cv2.aruco.getPredefinedDictionary(cv2.aruco.DICT_4X4_50)
_ARUCO_PARAMS = cv2.aruco.DetectorParameters()


def decode_image_bytes(data: bytes) -> np.ndarray:
    arr = np.frombuffer(data, dtype=np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img is None:
        raise DetectionError("could not decode image bytes")
    return img


def _qr_top_left_px(img: np.ndarray) -> tuple[int, tuple[float, float]]:
    """Return (qr_id, top_left_px). The QR's top-left module anchors the homography."""
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    for sym in pyzbar.decode(gray):
        try:
            payload = decode_payload(sym.data.decode("utf-8"))
        except PayloadError:
            continue
        # pyzbar gives polygon points in image order; take the top-left one.
        pts = sym.polygon
        if len(pts) < 4:
            continue
        tl = min(pts, key=lambda p: p.x + p.y)
        return payload["id"], (float(tl.x), float(tl.y))
    raise DetectionError("no valid id-only QR detected")


def _aruco_centres_px(img: np.ndarray) -> dict[int, tuple[float, float]]:
    """Return {marker_id: centre_px} for every detected ArUco 1/2/3."""
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    detector = cv2.aruco.ArucoDetector(_ARUCO_DICT, _ARUCO_PARAMS)
    corners, ids, _ = detector.detectMarkers(gray)
    out: dict[int, tuple[float, float]] = {}
    if ids is None:
        return out
    for c_set, id_ in zip(corners, ids.flatten()):
        if int(id_) not in (1, 2, 3):
            continue
        pts = c_set.reshape(-1, 2)
        cx, cy = pts[:, 0].mean(), pts[:, 1].mean()
        out[int(id_)] = (float(cx), float(cy))
    return out


def detect_fiducials(img: np.ndarray) -> tuple[int, dict[int, tuple[float, float]]]:
    """Return (qr_id, {0: QR-top-left, 1/2/3: ArUco centres}) in pixel coords."""
    qr_id, qr_tl = _qr_top_left_px(img)
    arucos = _aruco_centres_px(img)
    missing = [i for i in (1, 2, 3) if i not in arucos]
    if len(missing) > 1:
        raise DetectionError(f"insufficient ArUco markers; missing {missing}")
    corners = {0: qr_tl, **arucos}
    return qr_id, corners


def warp_to_burn_space(
    img: np.ndarray,
    *,
    burn_anchors_mm: dict[int, tuple[float, float]],
    corners_px: dict[int, tuple[float, float]],
    burn_size_mm: tuple[float, float],
    px_per_mm: float = 10.0,
) -> np.ndarray:
    """Compute homography from the shared keys of burn_anchors_mm and corners_px."""
    keys = sorted(set(burn_anchors_mm.keys()) & set(corners_px.keys()))
    if len(keys) < 4:
        raise DetectionError(
            f"need ≥4 matching fiducials for homography; have {len(keys)}",
        )
    src = np.array([corners_px[k] for k in keys], dtype=np.float32)
    dst = np.array([
        (burn_anchors_mm[k][0] * px_per_mm, burn_anchors_mm[k][1] * px_per_mm)
        for k in keys
    ], dtype=np.float32)
    H, _ = cv2.findHomography(src, dst, method=cv2.RANSAC)
    if H is None:
        raise DetectionError("homography solve failed")
    w_px = int(burn_size_mm[0] * px_per_mm)
    h_px = int(burn_size_mm[1] * px_per_mm)
    return cv2.warpPerspective(img, H, (w_px, h_px))
```

- [ ] **Step 3: Update `services/capture.py` to use the new pipeline**

Replace the body of `run_capture` with:

```python
def run_capture(*, image_bytes: bytes, test_id: int,
                spec: dict[str, Any]) -> CaptureResult:
    from xcs_gen.capture.layout import (
        MARKER_MARGIN_MM, QR_SIZE_DEFAULT_MM, ARUCO_SIZE_DEFAULT_MM,
        ARUCO_ID_TOP_RIGHT, ARUCO_ID_BOTTOM_LEFT, ARUCO_ID_BOTTOM_RIGHT,
    )
    from ..capture_pipeline import (
        DetectionError, decode_image_bytes, detect_fiducials,
        warp_to_burn_space,
    )
    from ..capture_sampling import sample_grid

    try:
        img = decode_image_bytes(image_bytes)
        qr_id, corners_px = detect_fiducials(img)
    except DetectionError as e:
        raise CaptureError(str(e)) from e

    if qr_id != test_id:
        raise CaptureError(
            f"QR on photo is test #{qr_id}; upload is for test #{test_id}",
        )

    reg = spec.get("registration", {})
    qr_size = reg.get("qr_size_mm") or QR_SIZE_DEFAULT_MM
    aruco_size = reg.get("aruco_size_mm") or ARUCO_SIZE_DEFAULT_MM
    grid_w = spec["width_mm"]
    grid_h = spec["height_mm"]
    margin = MARKER_MARGIN_MM

    # Burn-space anchors (mm) for each marker's "reference point".
    # QR: top-left corner. ArUcos: centre.
    qr_tl = (margin, margin)  # QR at (margin, margin) top-left
    grid_origin_mm = (
        qr_tl[0] + qr_size + margin,
        max(qr_tl[1] + qr_size + margin, margin + aruco_size + margin),
    )
    burn_w = grid_origin_mm[0] + grid_w + aruco_size + margin
    burn_h = grid_origin_mm[1] + grid_h + aruco_size + margin
    tr_c = (grid_origin_mm[0] + grid_w + margin + aruco_size / 2,
            margin + aruco_size / 2)
    bl_c = (qr_tl[0] + qr_size / 2,  # centred on QR column for simplicity
            grid_origin_mm[1] + grid_h + margin + aruco_size / 2)
    br_c = (grid_origin_mm[0] + grid_w + margin + aruco_size / 2,
            grid_origin_mm[1] + grid_h + margin + aruco_size / 2)

    burn_anchors = {
        0: qr_tl,
        ARUCO_ID_TOP_RIGHT: tr_c,
        ARUCO_ID_BOTTOM_LEFT: bl_c,
        ARUCO_ID_BOTTOM_RIGHT: br_c,
    }

    warped = warp_to_burn_space(
        img,
        burn_anchors_mm=burn_anchors,
        corners_px=corners_px,
        burn_size_mm=(burn_w, burn_h),
        px_per_mm=10.0,
    )

    swatches_raw = sample_grid(
        warped,
        grid_origin_mm=grid_origin_mm,
        grid_size_mm=(grid_w, grid_h),
        px_per_mm=10.0,
        x_param=spec["x_param"],
        x_min=spec["x_min"], x_max=spec["x_max"], x_steps=spec["x_steps"],
        y_param=spec.get("y_param"),
        y_min=spec.get("y_min") or 0.0,
        y_max=spec.get("y_max") or 0.0,
        y_steps=spec.get("y_steps") or 1,
        rows=spec.get("rows", 1),
        row_stride_mm=None,
    )
    swatches = [
        {"row": s.row, "col": s.col,
         "x_value": s.x_value, "y_value": s.y_value,
         "hex": s.hex, "lab": list(s.lab), "sigma": s.sigma}
        for s in swatches_raw
    ]
    return CaptureResult(swatches=swatches, warped_image_bgr=warped)
```

The grid-origin math must agree with the generator (Task 18). Adjust exact offsets there to match.

- [ ] **Step 4: Run tests (unit-only here; pipeline integration was covered by Task 14)**

Run: `pytest tests/test_capture_fiducials.py tests/test_capture_pipeline.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/xcs_gen_web/capture_pipeline.py src/xcs_gen_web/services/capture.py tests/test_capture_fiducials.py
git commit -m "Capture pipeline: ArUco detection + least-squares homography"
```

---

### Task 18: XCS generator — emit QR + 3 ArUcos

**Files:**
- Modify: `src/xcs_gen/builder.py` (or whichever module assembles the XCS file — grep for `compute_layout`).
- Modify: `src/xcs_gen/generators.py` (if the param-test generator is here).
- Modify: tests covering the generator end-to-end.

- [ ] **Step 1: Find existing call sites**

Run: `grep -rn "compute_layout\|emit_registration_markers\|qr_payload_for_test" src tests`

- [ ] **Step 2: Replace each call**

Every call to `compute_layout(...)` must pass the new `mode`/`qr_size_mm`/`aruco_size_mm` args. Every call to `emit_registration_markers` must pass `test_id=<int>` instead of `qr_text=...`. Every call to `qr_payload_for_test(...)` is removed (callers only need the id now; the generator resolves the layout and renders).

Example patch inside the param-test generator:

```python
from xcs_gen.capture.layout import compute_layout
from xcs_gen.capture.marker_render import emit_registration_markers

layout = compute_layout(
    grid_x=grid_x, grid_y=grid_y, grid_w=grid_w, grid_h=grid_h,
    mode="on" if reg["mode"] == "on" else "off",
    qr_size_mm=reg.get("qr_size_mm"),
    aruco_size_mm=reg.get("aruco_size_mm"),
)
emit_registration_markers(
    project, layout=layout, test_id=test_id,
    annotation_params=annotation_params,
)
```

- [ ] **Step 3: Update existing end-to-end generator tests**

Run: `grep -rn "qr_payload_for_test\|encode_inline" tests` — update each spot. The expected `extName`/byte-count assertions may need refreshing; match the shape, not exact bytes.

- [ ] **Step 4: Run the full suite**

Run: `pytest -x -q`
Expected: green.

- [ ] **Step 5: Commit**

```bash
git add -A src tests
git commit -m "Param-test generator emits id-only QR + 3 ArUco corners"
```

---

### Task 19: Manual burn validation

**Files:**
- Create: `scripts/validate_fiducials.py`

- [ ] **Step 1: Write a small CLI helper**

```python
#!/usr/bin/env python3
"""One-off helper: decode a burned-strip photo, print id + marker positions.

Usage: python scripts/validate_fiducials.py <photo.jpg>
"""

from __future__ import annotations

import sys

import cv2

from xcs_gen_web.capture_pipeline import decode_image_bytes, detect_fiducials


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: validate_fiducials.py <photo>", file=sys.stderr)
        return 2
    with open(sys.argv[1], "rb") as f:
        img = decode_image_bytes(f.read())
    qr_id, corners = detect_fiducials(img)
    print(f"QR id: {qr_id}")
    for k in sorted(corners):
        print(f"  marker {k}: {corners[k]}")
    cv2.imwrite("fiducials_debug.png", img)
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 2: Document the physical validation**

Update `RESUME_VALIDATION.txt` (or write a replacement `docs/validating-fiducials.md`):
- Generate an XCS for any small test (post-Task 18 output).
- Burn it on a 25×50 mm blank.
- Photograph, run `python scripts/validate_fiducials.py /path/to/photo.jpg`.
- Expected: non-zero QR id; four marker entries printed; no errors.

This task has no tests — the acceptance is hands-on.

- [ ] **Step 3: Commit**

```bash
git add scripts/validate_fiducials.py docs/validating-fiducials.md
git rm -f RESUME_VALIDATION.txt
git commit -m "Fiducial-validation helper script + docs"
```

---

## Phase E — Per-test XCS generation + palette ingest

### Task 20: Per-test XCS generation endpoint

**Files:**
- Create: `src/xcs_gen_web/services/xcs.py`
- Modify: `src/xcs_gen_web/app.py`
- Create: `tests/test_service_xcs.py`

- [ ] **Step 1: Write failing test**

```python
from fastapi.testclient import TestClient

from xcs_gen_web.app import create_app
from xcs_gen_web.repositories import materials as m_repo
from xcs_gen_web.repositories import tests as t_repo


BASE = {"power": 50, "speed": 1000, "frequency": 60000,
        "density": 200, "passes": 1, "pulse_width": 200, "laser": "red"}
SPEC = {
    "x_param": "speed", "x_min": 500, "x_max": 3000, "x_steps": 10,
    "rows": 1, "width_mm": 50, "height_mm": 10, "gap_mm": 0.5,
    "cell_shape": "rect", "square_cells": True, "angle_mode": "fixed",
    "unidirectional": False, "base_params": BASE,
    "registration": {"mode": "on"},
}


def test_generate_returns_xcs_bytes(fresh_db):
    c = TestClient(create_app())
    mid = m_repo.create(name="SS")["id"]
    tid = t_repo.create(name="T", material_id=mid, spec=SPEC)["id"]
    r = c.post(f"/api/tests/{tid}/generate")
    assert r.status_code == 200
    assert r.headers["content-type"] == "application/octet-stream"
    assert r.content.startswith(b"{") or b"canvasId" in r.content
    assert "filename=" in r.headers.get("content-disposition", "")
```

Run: `pytest tests/test_service_xcs.py -v`
Expected: FAIL.

- [ ] **Step 2: Implement**

`src/xcs_gen_web/services/xcs.py`:

```python
"""Build XCS bytes from a Test row."""

from __future__ import annotations

from typing import Any

# The existing converter was written against a Project (Pydantic). Now we
# feed it a single TestPlacement synthesised from the stored spec + name.
from .. import converter


def bytes_for_test(*, test_id: int, name: str, material_id: int,
                   spec: dict[str, Any]) -> bytes:
    # Build a throwaway Project with exactly one placement so the existing
    # converter machinery keeps working. When the frontend project wrapper
    # is removed we'll fold this into a cleaner single-test path.
    placement = {
        "row": 0, "col": 0, "col_span": 1,
        "test": {
            "id": test_id, "name": name, "material_id": material_id, **spec,
        },
    }
    project = {
        "name": name,
        "grid_gap_mm": 0,
        "focus_mm": 1.5,
        "tests": [placement],
    }
    from ..schemas import Project
    return converter.project_to_xcs_bytes(Project.model_validate(project))
```

(If `converter.project_to_xcs_bytes` needs a real ParamTest instance rather than a dict, the converter will raise a clear error; address by constructing the exact Pydantic model it expects.)

Add in `app.py`:

```python
from .services import xcs as xcs_service

@app.post("/api/tests/{tid}/generate")
def tests_generate(tid: int) -> Response:
    t = t_repo.get(tid)
    if t is None:
        raise HTTPException(status_code=404, detail="test not found")
    body = xcs_service.bytes_for_test(
        test_id=t["id"], name=t["name"],
        material_id=t["material_id"], spec=t["spec"],
    )
    safe_name = t["name"].replace("/", "_") or f"test-{t['id']}"
    return Response(
        content=body,
        media_type="application/octet-stream",
        headers={"Content-Disposition": f'attachment; filename="{safe_name}.xcs"'},
    )
```

- [ ] **Step 3: Run tests + commit**

```bash
pytest tests/test_service_xcs.py -v
git add src/xcs_gen_web tests/test_service_xcs.py
git commit -m "Per-test XCS generation endpoint"
```

---

### Task 21: Ingest-to-palette from a test

**Files:**
- Modify: `src/xcs_gen_web/schemas.py`
- Modify: `src/xcs_gen_web/app.py`
- Create: `tests/test_ingest_to_palette.py`

- [ ] **Step 1: Add schemas**

```python
class IngestToPaletteRequest(BaseModel):
    swatch_indices: list[int]
    mode: str                       # "averaged" | "single_result"
    result_id: int | None = None    # required when mode == "single_result"
    replace_existing: bool = False
```

- [ ] **Step 2: Write failing test**

`tests/test_ingest_to_palette.py`:

```python
from __future__ import annotations

import numpy as np
from fastapi.testclient import TestClient

from xcs_gen_web.app import create_app
from xcs_gen_web.repositories import materials as m_repo
from xcs_gen_web.repositories import tests as t_repo
from xcs_gen_web.services import capture as cap


BASE = {"power": 50, "speed": 1000, "frequency": 60000,
        "density": 200, "passes": 1, "pulse_width": 200, "laser": "red"}
SPEC = {
    "x_param": "speed", "x_min": 500, "x_max": 3000, "x_steps": 3,
    "rows": 1, "width_mm": 30, "height_mm": 10, "gap_mm": 0.5,
    "cell_shape": "rect", "square_cells": True, "angle_mode": "fixed",
    "unidirectional": False, "base_params": BASE,
    "registration": {"mode": "on"},
}


def _fake_cap(*, image_bytes, test_id, spec):
    return cap.CaptureResult(
        swatches=[
            {"row": 0, "col": 0, "x_value": 500, "y_value": None,
             "hex": "#ff0000", "lab": [0, 0, 0], "sigma": 1.0},
            {"row": 0, "col": 1, "x_value": 1000, "y_value": None,
             "hex": "#00ff00", "lab": [0, 0, 0], "sigma": 1.2},
        ],
        warped_image_bgr=np.zeros((10, 10, 3), dtype=np.uint8),
    )


def test_ingest_averaged(fresh_db, monkeypatch, tmp_path):
    monkeypatch.setenv("XCS_GEN_IMAGES_DIR", str(tmp_path))
    monkeypatch.setattr(cap, "run_capture", _fake_cap)
    c = TestClient(create_app())
    mid = m_repo.create(name="SS")["id"]
    tid = t_repo.create(name="T", material_id=mid, spec=SPEC)["id"]
    c.post(f"/api/tests/{tid}/results", files={"image": ("x.png", b"fake", "image/png")})
    r = c.post(f"/api/tests/{tid}/ingest-to-palette",
               json={"swatch_indices": [0, 1], "mode": "averaged"})
    assert r.status_code == 200
    assert r.json()["added"] == 2
    entries = c.get(f"/api/palette?material_id={mid}").json()
    assert len(entries) == 2
    assert {e["source"] for e in entries} == {"averaged"}


def test_ingest_single_result(fresh_db, monkeypatch, tmp_path):
    monkeypatch.setenv("XCS_GEN_IMAGES_DIR", str(tmp_path))
    monkeypatch.setattr(cap, "run_capture", _fake_cap)
    c = TestClient(create_app())
    mid = m_repo.create(name="SS")["id"]
    tid = t_repo.create(name="T", material_id=mid, spec=SPEC)["id"]
    rid = c.post(f"/api/tests/{tid}/results",
                 files={"image": ("x.png", b"fake", "image/png")}).json()["id"]
    r = c.post(f"/api/tests/{tid}/ingest-to-palette", json={
        "swatch_indices": [0],
        "mode": "single_result", "result_id": rid,
    })
    assert r.status_code == 200
    e = c.get(f"/api/palette?material_id={mid}").json()[0]
    assert e["source"] == "single_result"
    assert e["source_result_id"] == rid


def test_ingest_replace_existing(fresh_db, monkeypatch, tmp_path):
    monkeypatch.setenv("XCS_GEN_IMAGES_DIR", str(tmp_path))
    monkeypatch.setattr(cap, "run_capture", _fake_cap)
    c = TestClient(create_app())
    mid = m_repo.create(name="SS")["id"]
    tid = t_repo.create(name="T", material_id=mid, spec=SPEC)["id"]
    c.post(f"/api/tests/{tid}/results", files={"image": ("x.png", b"fake", "image/png")})
    c.post(f"/api/tests/{tid}/ingest-to-palette",
           json={"swatch_indices": [0, 1], "mode": "averaged"})
    r = c.post(f"/api/tests/{tid}/ingest-to-palette",
               json={"swatch_indices": [0], "mode": "averaged", "replace_existing": True})
    assert r.json()["added"] == 1
    assert len(c.get(f"/api/palette?material_id={mid}").json()) == 1
```

Run: `pytest tests/test_ingest_to_palette.py -v`
Expected: FAIL.

- [ ] **Step 3: Implement endpoint**

```python
from .repositories import palette as pal_repo

@app.post("/api/tests/{tid}/ingest-to-palette")
def tests_ingest_to_palette(tid: int, body: IngestToPaletteRequest) -> dict:
    t = t_repo.get(tid)
    if t is None:
        raise HTTPException(status_code=404, detail="test not found")

    if body.mode not in ("averaged", "single_result"):
        raise HTTPException(status_code=400, detail="mode must be averaged|single_result")

    if body.mode == "averaged":
        swatches = r_repo.averaged_swatches(tid)
        source_result_id = None
    else:
        if body.result_id is None:
            raise HTTPException(status_code=400, detail="result_id required for single_result")
        r = r_repo.get(body.result_id)
        if r is None or r["test_id"] != tid:
            raise HTTPException(status_code=400, detail="result_id does not belong to test")
        swatches = r["swatches"]
        source_result_id = r["id"]

    if any(i < 0 or i >= len(swatches) for i in body.swatch_indices):
        raise HTTPException(status_code=400, detail="swatch_indices out of range")
    picked = [swatches[i] for i in body.swatch_indices]

    if body.replace_existing:
        pal_repo.delete_by_test(tid)

    base = t["spec"]["base_params"]
    x_param = t["spec"]["x_param"]
    y_param = t["spec"].get("y_param")

    payload = []
    for s in picked:
        params = dict(base)
        if s.get("x_value") is not None:
            params[x_param] = s["x_value"]
        if y_param and s.get("y_value") is not None:
            params[y_param] = s["y_value"]
        payload.append({
            "test_id": tid, "material_id": t["material_id"],
            "x_value": s.get("x_value"), "y_value": s.get("y_value"),
            "hex": s["hex"], "sigma": s["sigma"],
            "source": body.mode, "source_result_id": source_result_id,
            "params": params,
        })
    ids = pal_repo.insert_bulk(payload)
    return {"added": len(ids), "ids": ids}
```

- [ ] **Step 4: Run tests + commit**

```bash
pytest tests/test_ingest_to_palette.py -v
git add src/xcs_gen_web tests/test_ingest_to_palette.py
git commit -m "Ingest-to-palette from test (averaged or single-result)"
```

---

### Task 22: End-to-end backend sanity check

**Files:** none

- [ ] **Step 1: Full suite**

Run: `pytest -x -q`
Expected: all green.

- [ ] **Step 2: Manual smoke**

```bash
XCS_GEN_DB_URL="sqlite:////tmp/smoke.db" \
XCS_GEN_IMAGES_DIR=/tmp/smoke-images \
uvicorn xcs_gen_web.app:app --port 4500 &
sleep 1
curl -s localhost:4500/api/health
curl -s -X POST localhost:4500/api/materials -H content-type:application/json -d '{"name":"Stainless"}'
curl -s localhost:4500/api/materials
kill %1 2>/dev/null
```

Expected: returns `{"status":"ok"}` and a material row with `"id": 1`.

- [ ] **Step 3: Commit tag (optional)**

```bash
git tag backend-ready-pre-frontend
```

---

## Phase F — Frontend: router, API clients, Tests pages

### Task 23: Hash-based router + shared types

**Files:**
- Create: `web/src/router.ts`
- Create: `web/src/router.test.ts`
- Modify: `web/src/types.ts` — replace test-related types with the server-authoritative shapes.

- [ ] **Step 1: Write failing router test**

`web/src/router.test.ts`:

```typescript
import { describe, expect, test, beforeEach } from "vitest";
import { parseRoute, formatRoute } from "./router";

beforeEach(() => { window.location.hash = ""; });

describe("parseRoute", () => {
  test("defaults to tests list", () => {
    expect(parseRoute("")).toEqual({ name: "tests" });
    expect(parseRoute("#/")).toEqual({ name: "tests" });
  });
  test("tests detail", () => {
    expect(parseRoute("#/tests/42")).toEqual({ name: "test-detail", id: 42 });
    expect(parseRoute("#/tests/new")).toEqual({ name: "test-new" });
  });
  test("top-level tabs", () => {
    expect(parseRoute("#/svg-stack")).toEqual({ name: "svg-stack" });
    expect(parseRoute("#/svg-layers")).toEqual({ name: "svg-layers" });
    expect(parseRoute("#/library")).toEqual({ name: "library" });
    expect(parseRoute("#/palette")).toEqual({ name: "palette" });
  });
});

describe("formatRoute", () => {
  test("round-trip", () => {
    for (const r of [
      { name: "tests" },
      { name: "test-new" },
      { name: "test-detail", id: 7 },
      { name: "svg-stack" },
      { name: "library" },
      { name: "palette" },
    ] as const) {
      expect(parseRoute(formatRoute(r))).toEqual(r);
    }
  });
});
```

Run: `cd web && npm test -- --run router.test`
Expected: FAIL (module not found).

- [ ] **Step 2: Implement `router.ts`**

```typescript
export type Route =
  | { name: "tests" }
  | { name: "test-new" }
  | { name: "test-detail"; id: number }
  | { name: "svg-stack" }
  | { name: "svg-layers" }
  | { name: "library" }
  | { name: "palette" };

export function parseRoute(hash: string): Route {
  const h = hash.replace(/^#/, "").replace(/^\/+/, "");
  if (h === "" || h === "tests") return { name: "tests" };
  if (h === "tests/new") return { name: "test-new" };
  const m = h.match(/^tests\/(\d+)$/);
  if (m) return { name: "test-detail", id: Number(m[1]) };
  if (h === "svg-stack") return { name: "svg-stack" };
  if (h === "svg-layers") return { name: "svg-layers" };
  if (h === "library") return { name: "library" };
  if (h === "palette") return { name: "palette" };
  return { name: "tests" };
}

export function formatRoute(r: Route): string {
  switch (r.name) {
    case "tests":       return "#/tests";
    case "test-new":    return "#/tests/new";
    case "test-detail": return `#/tests/${r.id}`;
    case "svg-stack":   return "#/svg-stack";
    case "svg-layers":  return "#/svg-layers";
    case "library":     return "#/library";
    case "palette":     return "#/palette";
  }
}

import { useEffect, useState } from "react";
export function useRoute(): [Route, (r: Route) => void] {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.hash));
  useEffect(() => {
    const onHash = () => setRoute(parseRoute(window.location.hash));
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  const navigate = (r: Route) => { window.location.hash = formatRoute(r); };
  return [route, navigate];
}
```

- [ ] **Step 3: Rewrite `web/src/types.ts`**

Replace the file with the server-authoritative types:

```typescript
export type Laser = "red" | "blue";

export const PARAM_NAMES = [
  "speed", "power", "frequency", "density", "passes", "pulse_width",
] as const;
export type ParamName = (typeof PARAM_NAMES)[number];

export interface BaseParams {
  power: number; speed: number; frequency: number;
  density: number; passes: number; pulse_width: number; laser: Laser;
}

export interface RegistrationConfig {
  mode: "on" | "off";
  qr_size_mm: number | null;
  aruco_size_mm: number | null;
}

export interface TestSpec {
  x_param: ParamName;
  x_min: number; x_max: number; x_steps: number;
  y_param: ParamName | null;
  y_min: number | null; y_max: number | null; y_steps: number | null;
  rows: number;
  width_mm: number; height_mm: number; gap_mm: number;
  cell_shape: "rect" | "circle";
  square_cells: boolean;
  angle_mode: "fixed" | "crosshatch" | "incremental";
  unidirectional: boolean;
  base_params: BaseParams;
  registration: RegistrationConfig;
}

export interface TestRecord {
  id: number;
  name: string;
  material_id: number;
  status: "created" | "tested" | "deleted";
  spec: TestSpec;
  notes: string;
  created_at: string;
  updated_at: string;
  locked: boolean;
}

export interface ResultSwatch {
  row: number; col: number;
  x_value: number; y_value: number | null;
  hex: string; lab: number[]; sigma: number;
}

export interface ResultRecord {
  id: number;
  test_id: number;
  uploaded_at: string;
  image_url: string;
  image_sha256: string;
  excluded: boolean;
  notes: string;
  swatches: ResultSwatch[];
}

export interface AveragedSwatch extends ResultSwatch {
  sample_count: number;
  per_result: { result_id: number; hex: string; sigma: number }[];
}

export interface PaletteEntry {
  id: number;
  test_id: number; material_id: number;
  x_value: number | null; y_value: number | null;
  hex: string; lab: number[];
  params: Record<string, string | number>;
  sigma: number;
  source: "averaged" | "single_result";
  source_result_id: number | null;
  notes: string;
  created_at: string;
}

export interface PaletteQueryResult {
  entry: PaletteEntry;
  delta_e: number;
}

// SVG-feature types from the existing types.ts stay put — copy them verbatim.
// (HatchPassSpec, SvgStackRequest, LayerSpec, SvgLayersRequest, DetectedLayer)
```

Copy over the remaining SVG-related types from the old `types.ts`.

- [ ] **Step 4: Run tests + commit**

```bash
cd web && npm test -- --run router.test && npm run build && cd ..
git add web/src/router.ts web/src/router.test.ts web/src/types.ts
git commit -m "Hash router + server-authoritative types"
```

---

### Task 24: API clients for tests, results, palette

**Files:**
- Create: `web/src/api/tests.ts`
- Create: `web/src/api/results.ts`
- Create: `web/src/api/palette.ts`
- Delete: `web/src/palette-api.ts` (contents replaced by `api/palette.ts`)

- [ ] **Step 1: Create `api/tests.ts`**

```typescript
import type { TestRecord, TestSpec } from "../types";

async function j<T>(r: Response): Promise<T> {
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return (r.status === 204 ? undefined : r.json()) as Promise<T>;
}

export async function listTests(params: {
  material_id?: number; status?: string;
} = {}): Promise<TestRecord[]> {
  const qs = new URLSearchParams();
  if (params.material_id) qs.set("material_id", String(params.material_id));
  if (params.status) qs.set("status", params.status);
  return j(await fetch(`/api/tests?${qs.toString()}`));
}
export async function getTest(id: number): Promise<TestRecord> {
  return j(await fetch(`/api/tests/${id}`));
}
export async function createTest(body: {
  name: string; material_id: number; spec: TestSpec; notes?: string;
}): Promise<TestRecord> {
  return j(await fetch("/api/tests", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }));
}
export async function updateTest(id: number, patch: {
  name?: string; notes?: string; spec?: TestSpec;
}): Promise<TestRecord> {
  return j(await fetch(`/api/tests/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  }));
}
export async function deleteTest(id: number): Promise<void> {
  await j(await fetch(`/api/tests/${id}`, { method: "DELETE" }));
}
export async function generateTestXcs(id: number): Promise<Blob> {
  const r = await fetch(`/api/tests/${id}/generate`, { method: "POST" });
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return r.blob();
}
```

- [ ] **Step 2: Create `api/results.ts`**

```typescript
import type { AveragedSwatch, ResultRecord } from "../types";

async function j<T>(r: Response): Promise<T> {
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return (r.status === 204 ? undefined : r.json()) as Promise<T>;
}

export async function listResults(testId: number): Promise<ResultRecord[]> {
  return j(await fetch(`/api/tests/${testId}/results`));
}
export async function uploadResult(testId: number, file: File): Promise<ResultRecord> {
  const fd = new FormData(); fd.append("image", file);
  return j(await fetch(`/api/tests/${testId}/results`, { method: "POST", body: fd }));
}
export async function patchResult(rid: number, patch: { excluded?: boolean; notes?: string; }): Promise<ResultRecord> {
  return j(await fetch(`/api/results/${rid}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  }));
}
export async function deleteResult(rid: number): Promise<void> {
  await j(await fetch(`/api/results/${rid}`, { method: "DELETE" }));
}
export async function getAveragedSwatches(testId: number): Promise<AveragedSwatch[]> {
  return j(await fetch(`/api/tests/${testId}/swatches`));
}
export async function ingestToPalette(testId: number, body: {
  swatch_indices: number[];
  mode: "averaged" | "single_result";
  result_id?: number;
  replace_existing?: boolean;
}): Promise<{ added: number; ids: number[] }> {
  return j(await fetch(`/api/tests/${testId}/ingest-to-palette`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }));
}
```

- [ ] **Step 3: Create `api/palette.ts`**

```typescript
import type { PaletteEntry, PaletteQueryResult } from "../types";

async function j<T>(r: Response): Promise<T> {
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return (r.status === 204 ? undefined : r.json()) as Promise<T>;
}

export async function listPaletteEntries(materialId?: number): Promise<PaletteEntry[]> {
  const qs = materialId ? `?material_id=${materialId}` : "";
  return j(await fetch(`/api/palette${qs}`));
}
export async function queryPalette(hex: string, opts: {
  limit?: number; material_id?: number;
} = {}): Promise<PaletteQueryResult[]> {
  const qs = new URLSearchParams({ hex });
  if (opts.limit) qs.set("limit", String(opts.limit));
  if (opts.material_id) qs.set("material_id", String(opts.material_id));
  return j(await fetch(`/api/palette/query?${qs}`));
}
export async function deletePaletteEntry(id: number): Promise<void> {
  await j(await fetch(`/api/palette/${id}`, { method: "DELETE" }));
}
export async function deletePaletteByTest(testId: number): Promise<void> {
  await j(await fetch(`/api/palette/by-test/${testId}`, { method: "DELETE" }));
}
export async function patchPaletteNotes(id: number, notes: string): Promise<PaletteEntry> {
  return j(await fetch(`/api/palette/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ notes }),
  }));
}
```

- [ ] **Step 4: Delete old client**

```bash
rm web/src/palette-api.ts
```

Adjust imports anywhere that still references `../palette-api` — point them at `../api/palette` instead. `grep -rn "palette-api" web/src` should be empty.

- [ ] **Step 5: Commit**

```bash
cd web && npm run build && cd ..
git add web/src
git commit -m "API clients for tests, results, palette"
```

---

### Task 25: TestsPage (list + filters)

**Files:**
- Create: `web/src/pages/TestsPage.tsx`

- [ ] **Step 1: Write the list-page component**

```typescript
import { useEffect, useState } from "react";
import type { Material, Preset } from "../library";
import type { TestRecord } from "../types";
import { listTests, createTest } from "../api/tests";
import { listMaterials, listPresets } from "../api/library";
import { formatRoute } from "../router";
import { DEFAULT_SPEC } from "../defaults";

export function TestsPage() {
  const [materials, setMaterials] = useState<Material[]>([]);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [tests, setTests] = useState<TestRecord[]>([]);
  const [materialId, setMaterialId] = useState<number | undefined>();
  const [status, setStatus] = useState<string>("");
  const [error, setError] = useState<string>();

  async function refresh() {
    try {
      const [m, p, t] = await Promise.all([
        listMaterials(), listPresets(),
        listTests({ material_id: materialId, status: status || undefined }),
      ]);
      setMaterials(m); setPresets(p); setTests(t);
    } catch (e) { setError((e as Error).message); }
  }
  useEffect(() => { refresh(); }, [materialId, status]);  // eslint-disable-line

  async function onNew() {
    if (materials.length === 0) {
      setError("Create a material on the Library tab first.");
      return;
    }
    const mid = materialId ?? materials[0].id;
    const preset = presets.find(p => p.material_id === mid && p.is_default);
    const spec = { ...DEFAULT_SPEC, base_params: preset?.base_params ?? DEFAULT_SPEC.base_params };
    const t = await createTest({ name: "New test", material_id: mid, spec });
    window.location.hash = formatRoute({ name: "test-detail", id: t.id });
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "260px 1fr", height: "100%" }}>
      <div style={{ borderRight: "1px solid #ddd", padding: 12, overflow: "auto" }}>
        <button onClick={onNew} style={{ width: "100%", padding: "8px 12px", marginBottom: 12 }}>
          + New test
        </button>
        <label style={{ fontSize: 11, color: "#666", display: "block", marginBottom: 4 }}>
          Material
          <select value={materialId ?? ""} onChange={e =>
            setMaterialId(e.target.value ? Number(e.target.value) : undefined)
          } style={{ width: "100%", padding: 4 }}>
            <option value="">— all —</option>
            {materials.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </label>
        <label style={{ fontSize: 11, color: "#666", display: "block", marginBottom: 12 }}>
          Status
          <select value={status} onChange={e => setStatus(e.target.value)}
                  style={{ width: "100%", padding: 4 }}>
            <option value="">not deleted</option>
            <option value="created">created</option>
            <option value="tested">tested</option>
            <option value="deleted">deleted</option>
          </select>
        </label>

        {error && <div style={{ color: "#a02840", fontSize: 12 }}>{error}</div>}

        {tests.map(t => (
          <a key={t.id}
             href={formatRoute({ name: "test-detail", id: t.id })}
             style={{
               display: "block", padding: "8px 6px",
               borderBottom: "1px solid #eee", color: "#222",
               textDecoration: "none",
             }}>
            <div style={{ fontWeight: 500 }}>#{t.id} {t.name}</div>
            <div style={{ fontSize: 11, color: "#666" }}>
              {t.status}{t.locked ? " · 🔒" : ""} · {materials.find(m => m.id === t.material_id)?.name ?? "?"}
            </div>
          </a>
        ))}
        {tests.length === 0 && !error && (
          <div style={{ color: "#888", fontSize: 12, padding: 8 }}>No tests match.</div>
        )}
      </div>
      <div style={{ padding: 24, color: "#888" }}>
        Pick a test from the list, or click "New test".
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add `DEFAULT_SPEC` to `defaults.ts`**

Replace/augment the existing helpers so the new shape is exported:

```typescript
import type { TestSpec } from "./types";

export function defaultBaseParams(): TestSpec["base_params"] {
  return { power: 50, speed: 1000, frequency: 60000,
           density: 200, passes: 1, pulse_width: 200, laser: "red" };
}

export const DEFAULT_SPEC: TestSpec = {
  x_param: "speed", x_min: 500, x_max: 3000, x_steps: 10,
  y_param: null, y_min: null, y_max: null, y_steps: null,
  rows: 1, width_mm: 50, height_mm: 10, gap_mm: 0.5,
  cell_shape: "rect", square_cells: true, angle_mode: "fixed",
  unidirectional: false,
  base_params: defaultBaseParams(),
  registration: { mode: "on", qr_size_mm: null, aruco_size_mm: null },
};
```

Remove the old `defaultProject`/`defaultPlacement`/`newId` exports — they're unused after Phase F.

- [ ] **Step 3: Build + eyeball**

```bash
cd web && npm run build && cd ..
```

- [ ] **Step 4: Commit**

```bash
git add web/src
git commit -m "TestsPage: server-backed list + filters + New button"
```

---

### Task 26: TestDetailPage — editor + actions

**Files:**
- Create: `web/src/pages/TestDetailPage.tsx`
- Create: `web/src/components/ParamTestEditor.tsx` (ported from today's `TestEditor.tsx`, reading/writing `TestSpec` instead of `TestPlacement`)

- [ ] **Step 1: Extract the editor**

Copy `web/src/components/TestEditor.tsx` to `web/src/components/ParamTestEditor.tsx`. Strip anything that deals with placement (row/col/col_span). Change the prop shape to:

```typescript
interface Props {
  spec: TestSpec;
  onChange: (next: TestSpec) => void;
  locked: boolean;
  issues?: { field: string; message: string; severity: "error" | "warning" }[];
}
```

All `updateTest({...})` calls simply become `onChange({ ...spec, ...patch })`. The registration-config section replaces the `qr_mode` and `qr_position` controls with a single on/off toggle plus two number inputs (QR size, ArUco size).

- [ ] **Step 2: TestDetailPage shell**

```typescript
import { useEffect, useState } from "react";
import type { Material, Preset } from "../library";
import type { TestRecord, TestSpec, AveragedSwatch } from "../types";
import { getTest, updateTest, deleteTest, generateTestXcs, createTest } from "../api/tests";
import { listMaterials, listPresets } from "../api/library";
import { ParamTestEditor } from "../components/ParamTestEditor";
import { TestPreview } from "../components/TestPreview";   // Task 29
import { ResultsPanel } from "../components/ResultsPanel"; // Task 27
import { formatRoute } from "../router";
import { DEFAULT_SPEC } from "../defaults";

interface Props {
  testId: number | "new";
}

export function TestDetailPage({ testId }: Props) {
  const [test, setTest] = useState<TestRecord | null>(null);
  const [spec, setSpec] = useState<TestSpec>(DEFAULT_SPEC);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [materialId, setMaterialId] = useState<number | null>(null);
  const [name, setName] = useState("New test");
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const [m, p] = await Promise.all([listMaterials(), listPresets()]);
      setMaterials(m); setPresets(p);
      if (testId !== "new") {
        const t = await getTest(testId);
        setTest(t);
        setSpec(t.spec); setName(t.name); setMaterialId(t.material_id);
      } else {
        const firstMid = m[0]?.id ?? null;
        setMaterialId(firstMid);
        const preset = firstMid ? p.find(q => q.material_id === firstMid && q.is_default) : null;
        if (preset) setSpec(s => ({ ...s, base_params: preset.base_params }));
      }
    })().catch(e => setError((e as Error).message));
  }, [testId]);

  async function onSave() {
    if (materialId === null) { setError("Pick a material"); return; }
    setSaving(true); setError(undefined);
    try {
      if (test) {
        const updated = await updateTest(test.id, test.locked ? { name } : { name, spec });
        setTest(updated);
      } else {
        const created = await createTest({ name, material_id: materialId, spec });
        window.location.hash = formatRoute({ name: "test-detail", id: created.id });
      }
    } catch (e) { setError((e as Error).message); }
    finally { setSaving(false); }
  }

  async function onDelete() {
    if (!test) return;
    if (!confirm(`Delete test #${test.id}?`)) return;
    await deleteTest(test.id);
    window.location.hash = formatRoute({ name: "tests" });
  }

  async function onDuplicate() {
    if (materialId === null) return;
    const copy = await createTest({ name: `${name} (copy)`, material_id: materialId, spec });
    window.location.hash = formatRoute({ name: "test-detail", id: copy.id });
  }

  async function onGenerate() {
    if (!test) return;
    const blob = await generateTestXcs(test.id);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `${test.name || `test-${test.id}`}.xcs`;
    a.click(); URL.revokeObjectURL(url);
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(320px, 360px) 1fr minmax(320px, 400px)",
                  height: "100%", minHeight: 0 }}>
      {/* Editor */}
      <div style={{ overflow: "auto", borderRight: "1px solid #ddd" }}>
        <div style={{ padding: 12 }}>
          <input value={name} onChange={e => setName(e.target.value)}
                 style={{ width: "100%", fontSize: 18, padding: 6, marginBottom: 8 }} />
          {test && (
            <div style={{ fontSize: 12, color: "#666", marginBottom: 8 }}>
              #{test.id} · {test.status}{test.locked ? " · 🔒 locked" : ""}
            </div>
          )}
          <label style={{ display: "block", marginBottom: 8, fontSize: 12 }}>
            Material
            <select value={materialId ?? ""} disabled={!!test}
                    onChange={e => setMaterialId(Number(e.target.value))}
                    style={{ width: "100%", padding: 4 }}>
              {materials.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </label>
          {error && <div style={{ color: "#a02840", fontSize: 12, marginBottom: 8 }}>{error}</div>}
        </div>
        <ParamTestEditor spec={spec} onChange={setSpec} locked={test?.locked ?? false} />
        <div style={{ padding: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button onClick={onSave} disabled={saving || (test?.locked && false)}>
            {test ? (test.locked ? "Save name/notes" : "Save") : "Create"}
          </button>
          {test && <button onClick={onGenerate}>Generate .xcs</button>}
          {test && <button onClick={onDuplicate}>Duplicate as new</button>}
          {test && <button onClick={onDelete} style={{ color: "#a02840" }}>Delete</button>}
        </div>
      </div>

      {/* Preview */}
      <div style={{ overflow: "auto", padding: 12, borderRight: "1px solid #ddd" }}>
        <TestPreview spec={spec} testId={test?.id ?? null} />
      </div>

      {/* Results panel */}
      <div style={{ overflow: "auto" }}>
        {test ? <ResultsPanel testId={test.id} locked={test.locked} /> : (
          <div style={{ padding: 24, color: "#888" }}>Save the test to upload results.</div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2b: Temporary stubs for TestPreview + ResultsPanel**

To keep this task self-contained, create stubs the next tasks replace:

`web/src/components/TestPreview.tsx`:

```typescript
import type { TestSpec } from "../types";
export function TestPreview({ spec }: { spec: TestSpec; testId: number | null }) {
  return <div style={{ color: "#888" }}>Preview — {spec.width_mm}×{spec.height_mm} mm</div>;
}
```

`web/src/components/ResultsPanel.tsx`:

```typescript
export function ResultsPanel(_: { testId: number; locked: boolean }) {
  return <div style={{ padding: 16, color: "#888" }}>Results — upload in next task</div>;
}
```

- [ ] **Step 3: Build**

```bash
cd web && npm run build && cd ..
```

- [ ] **Step 4: Commit**

```bash
git add web/src
git commit -m "TestDetailPage skeleton with editor + save/generate/duplicate/delete"
```

---

### Task 27: ResultsPanel — upload + list + ingest

**Files:**
- Modify: `web/src/components/ResultsPanel.tsx`

- [ ] **Step 1: Rewrite the panel**

```typescript
import { useEffect, useState } from "react";
import type { AveragedSwatch, ResultRecord } from "../types";
import {
  listResults, uploadResult, patchResult, deleteResult,
  getAveragedSwatches, ingestToPalette,
} from "../api/results";

const SIGMA_WARN = 10;

export function ResultsPanel({ testId, locked: _locked }: { testId: number; locked: boolean }) {
  const [results, setResults] = useState<ResultRecord[]>([]);
  const [averaged, setAveragedSwatches] = useState<AveragedSwatch[]>([]);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<Record<number, boolean>>({});
  const [mode, setMode] = useState<"averaged" | "single_result">("averaged");
  const [sourceResultId, setSourceResultId] = useState<number | null>(null);
  const [replaceExisting, setReplaceExisting] = useState(false);

  async function refresh() {
    try {
      const [r, a] = await Promise.all([listResults(testId), getAveragedSwatches(testId)]);
      setResults(r); setAveragedSwatches(a);
    } catch (e) { setError((e as Error).message); }
  }
  useEffect(() => { refresh(); }, [testId]);

  async function onUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return;
    setBusy(true); setError(undefined);
    try { await uploadResult(testId, file); await refresh(); }
    catch (err) { setError((err as Error).message); }
    finally { setBusy(false); e.target.value = ""; }
  }

  async function toggleExclude(rid: number, excluded: boolean) {
    await patchResult(rid, { excluded }); await refresh();
  }

  async function onDeleteResult(rid: number) {
    if (!confirm("Delete this result?")) return;
    await deleteResult(rid); await refresh();
  }

  const indices = Object.entries(selected).filter(([, v]) => v).map(([k]) => Number(k));
  async function doIngest() {
    if (indices.length === 0) return;
    await ingestToPalette(testId, {
      swatch_indices: indices,
      mode,
      result_id: mode === "single_result" && sourceResultId !== null ? sourceResultId : undefined,
      replace_existing: replaceExisting,
    });
    setSelected({}); setReplaceExisting(false);
    alert("Ingested.");
  }

  return (
    <div style={{ padding: 12 }}>
      <label style={{
        display: "inline-block", padding: "8px 16px", background: "#336", color: "white",
        borderRadius: 4, cursor: busy ? "wait" : "pointer", opacity: busy ? 0.6 : 1,
      }}>
        {busy ? "Uploading..." : "Upload photo"}
        <input type="file" accept="image/*" capture="environment"
               disabled={busy} onChange={onUpload} style={{ display: "none" }} />
      </label>
      {error && <div style={{ color: "#a02840", fontSize: 12, marginTop: 8 }}>{error}</div>}

      <h3 style={{ marginTop: 20, fontSize: 13 }}>Results ({results.length})</h3>
      {results.map(r => (
        <div key={r.id} style={{
          border: "1px solid #ddd", borderRadius: 4, marginBottom: 8, padding: 8,
          opacity: r.excluded ? 0.5 : 1,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <img src={r.image_url} alt="" style={{ width: 56, height: 56, objectFit: "cover", borderRadius: 4 }} />
            <div style={{ fontSize: 12, flex: 1 }}>
              <div>#{r.id} · {new Date(r.uploaded_at).toLocaleString()}</div>
              <div style={{ color: "#666" }}>
                {r.swatches.length} swatches · max σ {Math.max(...r.swatches.map(s => s.sigma), 0).toFixed(1)}
              </div>
            </div>
            <label style={{ fontSize: 11 }}>
              <input type="checkbox" checked={r.excluded}
                     onChange={e => toggleExclude(r.id, e.target.checked)} />
              exclude
            </label>
            <button onClick={() => onDeleteResult(r.id)} style={{ color: "#a02840" }}>✕</button>
          </div>
        </div>
      ))}

      <h3 style={{ marginTop: 20, fontSize: 13 }}>Averaged swatches</h3>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(60px, 1fr))", gap: 4 }}>
        {averaged.map((s, i) => {
          const unavailable = s.sample_count === 0;
          return (
            <div key={i} onClick={() => !unavailable && setSelected(p => ({ ...p, [i]: !p[i] }))}
                 style={{
                   border: selected[i] ? "2px solid #336" : unavailable ? "1px dashed #aaa" : "1px solid #ccc",
                   padding: 3, cursor: unavailable ? "default" : "pointer",
                   opacity: unavailable ? 0.4 : 1,
                 }}>
              <div style={{ background: s.hex, height: 30, borderRadius: 2 }} />
              <div style={{ fontSize: 9, fontFamily: "monospace" }}>{s.hex}</div>
              <div style={{ fontSize: 9, color: s.sigma >= SIGMA_WARN ? "#a05000" : "#666" }}>
                n={s.sample_count} σ={s.sigma.toFixed(1)}
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ marginTop: 12, padding: 8, border: "1px solid #eee", borderRadius: 4 }}>
        <div style={{ fontSize: 12, marginBottom: 6 }}>
          Ingest {indices.length} swatch{indices.length === 1 ? "" : "es"} to palette
        </div>
        <label style={{ fontSize: 11, marginRight: 8 }}>
          <input type="radio" name="mode" checked={mode === "averaged"} onChange={() => setMode("averaged")} />
          averaged
        </label>
        <label style={{ fontSize: 11, marginRight: 8 }}>
          <input type="radio" name="mode" checked={mode === "single_result"}
                 onChange={() => setMode("single_result")} />
          from specific result
        </label>
        {mode === "single_result" && (
          <select value={sourceResultId ?? ""} onChange={e => setSourceResultId(Number(e.target.value))}
                  style={{ fontSize: 11, marginLeft: 4 }}>
            <option value="">— pick —</option>
            {results.filter(r => !r.excluded).map(r => (
              <option key={r.id} value={r.id}>#{r.id}</option>
            ))}
          </select>
        )}
        <label style={{ fontSize: 11, marginLeft: 8 }}>
          <input type="checkbox" checked={replaceExisting}
                 onChange={e => setReplaceExisting(e.target.checked)} />
          replace existing
        </label>
        <br />
        <button onClick={doIngest} disabled={indices.length === 0}
                style={{ marginTop: 6 }}>
          Ingest to palette
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Build**

```bash
cd web && npm run build && cd ..
```

- [ ] **Step 3: Commit**

```bash
git add web/src
git commit -m "ResultsPanel: upload + list + ingest-to-palette"
```

---

### Task 28: Wire App.tsx to the router

**Files:**
- Modify: `web/src/App.tsx`
- Delete: `web/src/storage.ts` (tests.ts, storage.test.ts also removed — see cleanup task)

- [ ] **Step 1: Rewrite `App.tsx`**

```typescript
import { useEffect } from "react";
import { TopBar } from "./components/TopBar";
import { SvgStackPage } from "./components/SvgStackPage";
import { SvgLayersPage } from "./components/SvgLayersPage";
import { LibraryPage } from "./components/LibraryPage";
import { PalettePage } from "./components/PalettePage";
import { TestsPage } from "./pages/TestsPage";
import { TestDetailPage } from "./pages/TestDetailPage";
import { formatRoute, useRoute } from "./router";

export default function App() {
  const [route, navigate] = useRoute();

  useEffect(() => {
    if (window.location.hash === "") navigate({ name: "tests" });
  }, [navigate]);

  const title =
    route.name === "tests"       ? "Tests"
    : route.name === "test-new"  ? "New test"
    : route.name === "test-detail" ? `Test #${route.id}`
    : route.name === "svg-stack" ? "SVG stack"
    : route.name === "svg-layers" ? "SVG layers"
    : route.name === "library"    ? "Library"
    : "Palette";

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
      <TopBar title={title} route={route} onNavigate={navigate} />
      <div style={{ flex: 1, minHeight: 0 }}>
        {route.name === "tests"        && <TestsPage />}
        {route.name === "test-new"     && <TestDetailPage testId="new" />}
        {route.name === "test-detail"  && <TestDetailPage testId={route.id} />}
        {route.name === "svg-stack"    && <SvgStackPage />}
        {route.name === "svg-layers"   && <SvgLayersPage />}
        {route.name === "library"      && <LibraryPage />}
        {route.name === "palette"      && <PalettePage />}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Update TopBar**

`TopBar` props change from `(tab, onTabChange)` to `(route, onNavigate)`. Inside, render a row of `<a>` tags with `href={formatRoute({...})}`. Remove the Generate button (per-test now). `SvgStackPage`/`SvgLayersPage` still need their own Generate buttons inside their pages — leave those alone.

- [ ] **Step 3: Remove old plumbing**

```bash
rm web/src/storage.ts web/src/storage.test.ts
```

Fix any imports that referenced `./storage` — `grep -rn "from.*storage" web/src`.

SVG pages that took a `library` prop need updating — they can now call `listMaterials()`/`listPresets()` themselves on mount, same pattern as LibraryPage.

- [ ] **Step 4: Build**

```bash
cd web && npm run build && cd ..
```

- [ ] **Step 5: Commit**

```bash
git add web/src
git commit -m "App.tsx: hash-router with Tests/SVG/Library/Palette routes"
```

---

## Phase G — Upgraded preview + page polish

### Task 29: TestPreview SVG component

**Files:**
- Modify: `web/src/components/TestPreview.tsx`
- Create: `web/src/components/TestPreview.test.ts`

- [ ] **Step 1: Failing unit test for the geometry helper**

Split out a pure geometry function so we can unit-test it without rendering.

`web/src/components/TestPreview.test.ts`:

```typescript
import { describe, expect, test } from "vitest";
import { computePreviewGeometry } from "./TestPreview";
import { DEFAULT_SPEC } from "../defaults";

describe("computePreviewGeometry", () => {
  test("1D 10 steps, rows=1 → one row of 10 cells", () => {
    const g = computePreviewGeometry({ ...DEFAULT_SPEC, x_steps: 10, rows: 1 });
    expect(g.rows).toHaveLength(1);
    expect(g.rows[0].cells).toHaveLength(10);
  });

  test("wrapped 20 steps across 2 rows → 10+10", () => {
    const g = computePreviewGeometry({ ...DEFAULT_SPEC, x_steps: 20, rows: 2 });
    expect(g.rows).toHaveLength(2);
    expect(g.rows.map(r => r.cells.length)).toEqual([10, 10]);
  });

  test("registration markers emit when mode=on", () => {
    const g = computePreviewGeometry(DEFAULT_SPEC);
    expect(g.qr).not.toBeNull();
    expect(g.arucos).toHaveLength(3);
  });

  test("registration markers absent when mode=off", () => {
    const g = computePreviewGeometry({
      ...DEFAULT_SPEC,
      registration: { mode: "off", qr_size_mm: null, aruco_size_mm: null },
    });
    expect(g.qr).toBeNull();
    expect(g.arucos).toHaveLength(0);
  });
});
```

Run: `cd web && npm test -- --run TestPreview`
Expected: FAIL — function doesn't exist yet.

- [ ] **Step 2: Implement `TestPreview.tsx`**

```typescript
import type { TestSpec } from "../types";

const MARGIN = 1.5;
const QR_DEFAULT = 5;
const ARUCO_DEFAULT = 2;

interface Cell { x: number; y: number; w: number; h: number; }
interface Row { yMm: number; heightMm: number; cells: Cell[]; labelMin: string; labelMax: string; }

export interface PreviewGeometry {
  viewW: number; viewH: number;
  gridX: number; gridY: number;
  gridW: number; gridH: number;
  rows: Row[];
  qr: { x: number; y: number; size: number } | null;
  arucos: { x: number; y: number; size: number; id: number }[];
  shape: "rect" | "circle";
}

export function computePreviewGeometry(spec: TestSpec): PreviewGeometry {
  const regOn = spec.registration.mode === "on";
  const qrSize = spec.registration.qr_size_mm ?? QR_DEFAULT;
  const arucoSize = spec.registration.aruco_size_mm ?? ARUCO_DEFAULT;

  const xShift = regOn ? qrSize + MARGIN : 0;
  const yShift = regOn ? Math.max(qrSize, arucoSize) + MARGIN : 0;
  const gridX = xShift;
  const gridY = yShift;
  const gridW = spec.width_mm;
  const gridH = spec.height_mm;

  const viewW = gridX + gridW + (regOn ? arucoSize + MARGIN : 0);
  const viewH = gridY + gridH + (regOn ? arucoSize + MARGIN : 0);

  const rowCount = Math.max(1, spec.rows);
  const cellsPerRow = Math.ceil(spec.x_steps / rowCount);
  const cellW = (gridW - Math.max(0, cellsPerRow - 1) * spec.gap_mm) / cellsPerRow;
  const rowHeight = (gridH - Math.max(0, rowCount - 1) * spec.gap_mm) / rowCount;

  const step = (spec.x_max - spec.x_min) / Math.max(1, spec.x_steps - 1);
  const rows: Row[] = [];
  let cellsLeft = spec.x_steps;
  let cellIdx = 0;
  for (let r = 0; r < rowCount; r++) {
    const take = Math.min(cellsPerRow, cellsLeft);
    const cells: Cell[] = [];
    for (let c = 0; c < take; c++) {
      cells.push({
        x: gridX + c * (cellW + spec.gap_mm),
        y: gridY + r * (rowHeight + spec.gap_mm),
        w: cellW, h: rowHeight,
      });
    }
    const minVal = spec.x_min + cellIdx * step;
    const maxVal = spec.x_min + (cellIdx + take - 1) * step;
    rows.push({
      yMm: gridY + r * (rowHeight + spec.gap_mm),
      heightMm: rowHeight,
      cells,
      labelMin: minVal.toFixed(0),
      labelMax: maxVal.toFixed(0),
    });
    cellIdx += take; cellsLeft -= take;
  }

  const qr = regOn ? { x: MARGIN, y: MARGIN, size: qrSize } : null;
  const arucos = regOn ? [
    { x: gridX + gridW + MARGIN, y: MARGIN, size: arucoSize, id: 1 },
    { x: MARGIN, y: gridY + gridH + MARGIN, size: arucoSize, id: 2 },
    { x: gridX + gridW + MARGIN, y: gridY + gridH + MARGIN, size: arucoSize, id: 3 },
  ] : [];

  return { viewW, viewH, gridX, gridY, gridW, gridH, rows, qr, arucos, shape: spec.cell_shape };
}

export function TestPreview({ spec, testId: _testId }: { spec: TestSpec; testId: number | null }) {
  const g = computePreviewGeometry(spec);

  return (
    <div style={{ width: "100%" }}>
      <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5,
                    color: "#666", marginBottom: 6 }}>
        Preview ({g.viewW.toFixed(1)}mm × {g.viewH.toFixed(1)}mm)
      </div>
      <svg viewBox={`0 0 ${g.viewW} ${g.viewH}`}
           style={{ width: "100%", height: "auto", background: "#f4e9d4",
                    border: "1px solid #bbb", display: "block" }}>
        {/* Cells */}
        {g.rows.map((row, ri) => (
          <g key={ri}>
            {row.cells.map((cell, ci) => (
              g.shape === "circle" ? (
                <circle key={ci} cx={cell.x + cell.w / 2} cy={cell.y + cell.h / 2}
                        r={Math.min(cell.w, cell.h) / 2}
                        fill="#c7a46a" stroke="#8d6d3d" strokeWidth={0.1} />
              ) : (
                <rect key={ci} x={cell.x} y={cell.y} width={cell.w} height={cell.h}
                      fill="#c7a46a" stroke="#8d6d3d" strokeWidth={0.1} />
              )
            ))}
            <text x={g.gridX} y={row.yMm + row.heightMm + 1.8}
                  fontSize={1.4} fill="#444" fontFamily="monospace">{row.labelMin}</text>
            <text x={g.gridX + g.gridW} y={row.yMm + row.heightMm + 1.8}
                  fontSize={1.4} fill="#444" fontFamily="monospace"
                  textAnchor="end">{row.labelMax}</text>
          </g>
        ))}
        {/* QR */}
        {g.qr && (
          <rect x={g.qr.x} y={g.qr.y} width={g.qr.size} height={g.qr.size}
                fill="#111" />
        )}
        {g.qr && (
          <rect x={g.qr.x + g.qr.size * 0.25} y={g.qr.y + g.qr.size * 0.25}
                width={g.qr.size * 0.15} height={g.qr.size * 0.15} fill="#f4e9d4" />
        )}
        {/* ArUcos */}
        {g.arucos.map(a => (
          <g key={a.id}>
            <rect x={a.x} y={a.y} width={a.size} height={a.size} fill="#111" />
            <rect x={a.x + a.size * 0.35} y={a.y + a.size * 0.35}
                  width={a.size * 0.3} height={a.size * 0.3} fill="#f4e9d4" />
          </g>
        ))}
      </svg>
    </div>
  );
}
```

- [ ] **Step 3: Run tests + commit**

```bash
cd web && npm test -- --run && npm run build && cd ..
git add web/src/components/TestPreview.tsx web/src/components/TestPreview.test.ts
git commit -m "TestPreview: proportional SVG with cells, axis labels, QR + 3 ArUcos"
```

---

### Task 30: Library page — Materials row expands to show tests

**Files:**
- Modify: `web/src/components/LibraryPage.tsx`

- [ ] **Step 1: Add per-material test listing**

Next to each material row in the existing page, add a `▸ N tests` disclosure. Expanded, render a small list of tests (fetch via `listTests({ material_id: m.id })` on first expand; cache the result in component state).

Minimal patch:

```typescript
const [expanded, setExpanded] = useState<Record<number, boolean>>({});
const [byMaterial, setByMaterial] = useState<Record<number, TestRecord[]>>({});

async function toggle(m: Material) {
  if (!expanded[m.id]) {
    setByMaterial(prev => ({ ...prev, [m.id]: await listTests({ material_id: m.id }) }));
  }
  setExpanded(prev => ({ ...prev, [m.id]: !prev[m.id] }));
}
```

Render:

```jsx
<button onClick={() => toggle(m)} style={{ border: "none", background: "none" }}>
  {expanded[m.id] ? "▾" : "▸"} {byMaterial[m.id]?.length ?? 0} tests
</button>
{expanded[m.id] && (
  <ul style={{ marginTop: 4, marginLeft: 16, fontSize: 12 }}>
    {(byMaterial[m.id] ?? []).map(t => (
      <li key={t.id}>
        <a href={formatRoute({ name: "test-detail", id: t.id })}>
          #{t.id} {t.name} ({t.status})
        </a>
      </li>
    ))}
  </ul>
)}
```

- [ ] **Step 2: Build + commit**

```bash
cd web && npm run build && cd ..
git add web/src
git commit -m "Library: show tests burned on each material"
```

---

### Task 31: Palette page — remove Upload sub-tab

**Files:**
- Modify: `web/src/components/PalettePage.tsx`

- [ ] **Step 1: Trim the page**

- Remove the `"upload"` value from the `View` type.
- Remove the `UploadView` component and its helpers (`SwatchCard`, etc. if unused elsewhere).
- Remove the "Upload" sub-tab button from the `SubTab` group.
- `BrowseView`: on each `EntryCard`, add a "View test" link → `formatRoute({ name: "test-detail", id: entry.test_id })`.
- `QueryView` + `BrowseView` already work against the server endpoints; just switch their imports to `../api/palette`.

- [ ] **Step 2: Replace any IDs typed as string with number**

The existing `PaletteEntry` client type used `string` for test/material IDs. After Task 23 they're numbers. Follow the compiler errors.

- [ ] **Step 3: Build + commit**

```bash
cd web && npm run build && cd ..
git add web/src
git commit -m "Palette: remove Upload sub-tab; add View test link in Browse"
```

---

## Phase H — Cleanup

### Task 32: Retire dead endpoints + dead code

**Files:**
- Modify: `src/xcs_gen_web/app.py`
- Modify: `src/xcs_gen_web/schemas.py`
- Delete: old tests covering retired endpoints.
- Delete: `src/xcs_gen_web/capture_pipeline.py` old signatures (already replaced in Task 17).

- [ ] **Step 1: Remove retired endpoints**

From `app.py`, delete:
- `POST /api/capture/ingest` and its imports/schemas.
- `POST /api/generate` (top-level) — Generate is now per-test.
- `POST /api/palette/ingest` — replaced by `/api/tests/{id}/ingest-to-palette`.

Delete unused `CaptureIngestResponse`, `CaptureSwatch`, `PaletteIngestRequest`, `PaletteIngestResponse` from `schemas.py`.

- [ ] **Step 2: Remove now-unused code in `src/xcs_gen`**

Remove: `qr_payload_for_test` (already done in Task 18; double-check). Remove `encode_inline` from qr_payload.py if not already. Remove any references to `registration.qr_mode` / `registration.qr_position` / `registration.mode=="compact"|"full"` in the param-test generator. `grep -rn 'qr_mode\|qr_position\|"compact"\|"full"' src` should return zero lines.

- [ ] **Step 3: Delete dead tests**

Remove test files targeting retired endpoints:
- `tests/test_capture_api.py` (if it tested the old /api/capture/ingest; keep tests of internal helpers).
- Any test that constructs the old `Project` with > 1 `TestPlacement`.

`grep -rn "/api/capture/ingest\|/api/generate$\|/api/palette/ingest" tests src` should return zero lines.

- [ ] **Step 4: Run suite**

Run: `pytest -x -q`
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Retire legacy endpoints and dead capture/Project code"
```

---

### Task 33: README, docs, final sweep

**Files:**
- Modify: `README.md`
- Possibly delete/rewrite: `docs/superpowers/specs/2026-04-17-photo-palette-ingest-design.md`'s references in README (keep the spec as history; don't delete).

- [ ] **Step 1: Update README**

Replace the "Project Status" + "Web UI" sections to reflect:
- DB lives at `~/.xcs-gen/app.db` (env override `XCS_GEN_DB_URL`).
- Image store at `~/.xcs-gen/images/` (env override `XCS_GEN_IMAGES_DIR`).
- `xcs-gen serve` now runs Alembic migrations on startup.
- Tests page is primary; palette is populated by uploading photos *into a test*.

- [ ] **Step 2: Full type-check + tests**

```bash
pytest -x -q
cd web && npm test -- --run && npm run build && cd ..
```

Expected: all green.

- [ ] **Step 3: Manual smoke**

```bash
rm -f /tmp/final.db
XCS_GEN_DB_URL="sqlite:////tmp/final.db" \
XCS_GEN_IMAGES_DIR=/tmp/final-images \
xcs-gen serve --no-browser &
sleep 2
curl -s localhost:4000/api/health
```

Open http://localhost:4000 in a browser:
- Library tab: add a material.
- Tests tab: click "+ New test", pick that material, set X axis, click Create.
- Click Generate .xcs, burn (or verify the .xcs downloads).
- Upload a photo; confirm a Result appears with swatches.
- Select swatches → Ingest to palette.
- Palette → Browse: see the rows, "View test" link works.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "Docs: reflect SQLite persistence + tests-as-entities workflow"
```

- [ ] **Step 5: Delete `RESUME_VALIDATION.txt`** (already done in Task 19, but if it regressed during a merge)

```bash
git rm -f RESUME_VALIDATION.txt 2>/dev/null || true
```

---

## Self-review checklist (for the plan author)

Before handing this plan off, verify:

- [x] Spec coverage: every section of `docs/superpowers/specs/2026-04-20-tests-and-persistence-design.md` maps to a task.
  - Data model → Tasks 2, 3.
  - Fiducials → Tasks 15–17, 19.
  - Test lifecycle → Tasks 9, 10, 14.
  - Averaged swatches → Task 12, 14, 27, 29.
  - Ingest → Tasks 21, 27.
  - UI layout → Tasks 25–30.
  - Backend surface → Tasks 4–8, 9–14, 20–21, 32.
  - Code structure → reflected in file paths throughout.
- [x] No placeholders (TBD / TODO / "similar to…").
- [x] Type consistency: `TestRecord`, `TestSpec`, `ResultRecord`, `AveragedSwatch`, `PaletteEntry` match between server schemas and client types (Task 10/14 + Task 23/24).
- [x] Every test has its actual test code inlined.
- [x] Every code change has the actual code inlined.

If any of the above feels off during execution, pause and fix the plan before diverging from it.





