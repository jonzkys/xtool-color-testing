# Palette: manual entries + favorites — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users hand-author palette swatches and star (favorite) any swatch — both surfaces feed the SVG matcher.

**Architecture:** One `palette_entries` table, with `source` extended to `'manual'`, `test_id` made nullable, and a new `favorited` boolean. New tabs on the Palette page (`Manual`, `Favorites`) + a star button on every swatch + a paginated favorites row on the SVG matcher.

**Tech Stack:** FastAPI / SQLAlchemy Core / Alembic / pytest (backend); React 18 + Tailwind v4 + Radix UI + vitest (frontend).

**Spec:** `docs/superpowers/specs/2026-04-25-palette-manual-favorites-design.md`

---

## File Structure

**Create**
- `alembic/versions/0008_palette_manual_favorites.py` — adds `favorited`, makes `test_id` nullable, widens `source` CHECK.
- `web/src/components/PaletteEntryDialog.tsx` — Add/Edit modal for manual entries.
- `web/src/components/StarToggle.tsx` — small reusable star button with optimistic toggle.
- `web/src/svg/favoritesPager.ts` — pure helper for auto-fit pagination math + a unit test.
- `web/src/svg/favoritesPager.test.ts` — vitest for the helper.
- `changelog/2026-04-25-palette-manual-favorites.md` — changelog entry (+ 1–2 PNGs in `changelog/images/`).

**Modify**
- `src/xcs_gen_web/models.py` — palette_entries schema (lines 161-188).
- `src/xcs_gen_web/repositories/palette.py` — add `create_manual`, `update_entry`, `set_favorited`; widen `list_all`; remove `update_notes`.
- `src/xcs_gen_web/schemas.py` — `PaletteEntryResponse` gains `favorited` + nullable `test_id`; `PaletteEntryPatch` widens; new `PaletteEntryCreateManual`.
- `src/xcs_gen_web/app.py` — new `POST /api/palette/manual`; widen `PATCH /api/palette/{id}` and `GET /api/palette`.
- `tests/test_repo_palette.py` — fixtures + tests for new helpers.
- `tests/test_palette_api.py` — fixtures + tests for new endpoints.
- `.github/workflows/ci.yml` — bump `test "$VER" = "0007"` → `0008`.
- `web/src/types.ts` — `PaletteEntry` updates.
- `web/src/api/palette.ts` — new `createManualPaletteEntry`, widen `patchPaletteEntry`.
- `web/src/components/PalettePage.tsx` — new tabs, modal wiring, star button on `EntryCard`, edit/copy actions.
- `web/src/components/SvgLayersPage.tsx` — `MAN` badge + star toggle in `PaletteMatchSection`; new `PaletteFavoritesRow` subcomponent.

---

## Task 1: Migration 0008 — palette schema changes

**Files:**
- Create: `alembic/versions/0008_palette_manual_favorites.py`

- [ ] **Step 1: Write the migration**

Create `alembic/versions/0008_palette_manual_favorites.py`:

```python
"""palette_entries: favorited + nullable test_id + manual source

Adds:
  - favorited BOOLEAN NOT NULL DEFAULT 0  — per-row pin (per-user via owner_id).
  - test_id becomes nullable                — manual entries aren't tied to a test.
  - source CHECK widens to include 'manual' — manual swatches are a third source.

Revision ID: 0008
Revises: 0007
Create Date: 2026-04-25
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0008"
down_revision = "0007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("palette_entries") as batch:
        batch.add_column(
            sa.Column(
                "favorited", sa.Boolean(),
                nullable=False, server_default="0",
            ),
        )
        batch.alter_column("test_id", existing_type=sa.Integer(), nullable=True)
        batch.drop_constraint("palette_entries_source_chk", type_="check")
        batch.create_check_constraint(
            "palette_entries_source_chk",
            "source IN ('averaged','single_result','manual')",
        )


def downgrade() -> None:
    with op.batch_alter_table("palette_entries") as batch:
        batch.drop_constraint("palette_entries_source_chk", type_="check")
        batch.create_check_constraint(
            "palette_entries_source_chk",
            "source IN ('averaged','single_result')",
        )
        batch.alter_column("test_id", existing_type=sa.Integer(), nullable=False)
        batch.drop_column("favorited")
```

- [ ] **Step 2: Update CI revision check**

Edit `.github/workflows/ci.yml` around line 144:

```yaml
          test "$VER" = "0008"
```

(was `0007`).

- [ ] **Step 3: Run migration smoke test**

Run: `uv run --active alembic upgrade head`
Expected: alembic ends without error; sqlite file at `~/.xcs-gen/app.db` reaches revision `0008`.

If you don't want to migrate the dev DB, point `XCS_GEN_DB_URL` at a tmpfile:
```bash
XCS_GEN_DB_URL="sqlite:////tmp/m8.db" uv run --active alembic upgrade head
```

- [ ] **Step 4: Run existing alembic test**

Run: `uv run --active pytest tests/test_alembic.py -q`
Expected: PASS — proves upgrade-head works on a fresh DB.

- [ ] **Step 5: Commit**

```bash
git add alembic/versions/0008_palette_manual_favorites.py .github/workflows/ci.yml
git commit -m "alembic: 0008 — palette favorited + manual source"
```

---

## Task 2: Update SQLAlchemy table definition

**Files:**
- Modify: `src/xcs_gen_web/models.py:161-188`

- [ ] **Step 1: Edit the `palette_entries` table**

Replace the `palette_entries = Table(...)` block (currently lines 161–188) with the version below. Three differences from today: `test_id` drops `nullable=False`; new `favorited` column; widened `source` CHECK.

```python
palette_entries = Table(
    "palette_entries", metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("test_id", Integer, ForeignKey("tests.id"), nullable=True),
    Column("material_id", Integer, ForeignKey("materials.id"), nullable=False),
    Column("x_value", Float),
    Column("y_value", Float),
    Column("hex", String(_COLOR_HEX_LEN), nullable=False),
    Column("lab_l", Float, nullable=False),
    Column("lab_a", Float, nullable=False),
    Column("lab_b", Float, nullable=False),
    Column("params_json", Text, nullable=False),
    Column("sigma", Float, nullable=False),
    Column("source", String(_STATUS_LEN), nullable=False),
    Column("source_result_id", Integer, ForeignKey("results.id")),
    Column("notes", Text, nullable=False, server_default=""),
    Column("created_at", String(_ISO_TS_LEN), nullable=False),
    Column("owner_id", Integer, nullable=False),
    Column("visibility", String(_VISIBILITY_LEN), nullable=False, server_default="private"),
    Column("favorited", Boolean, nullable=False, server_default="0"),
    CheckConstraint(
        "source IN ('averaged','single_result','manual')",
        name="palette_entries_source_chk",
    ),
    CheckConstraint(_VISIBILITY_CHECK, name="palette_entries_visibility_chk"),
    Index("ix_palette_entries_material_id", "material_id"),
    Index("ix_palette_entries_test_id", "test_id"),
    Index("ix_palette_entries_owner", "owner_id"),
)
```

- [ ] **Step 2: Add `Boolean` to the import line**

Find the line near the top of `models.py`:

```python
from sqlalchemy import (
    CheckConstraint, Column, ForeignKey, Index,
    Integer, MetaData, String, Table, Text, Float,
)
```

Add `Boolean`:

```python
from sqlalchemy import (
    Boolean, CheckConstraint, Column, ForeignKey, Index,
    Integer, MetaData, String, Table, Text, Float,
)
```

- [ ] **Step 3: Run db-models test**

Run: `uv run --active pytest tests/test_db_models.py -q`
Expected: PASS — sanity-checks the schema can build.

- [ ] **Step 4: Commit**

```bash
git add src/xcs_gen_web/models.py
git commit -m "models: palette_entries — favorited + nullable test_id"
```

---

## Task 3: Repository — extend `list_all` with new filters

**Files:**
- Modify: `src/xcs_gen_web/repositories/palette.py`
- Test: `tests/test_repo_palette.py`

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_repo_palette.py`:

```python
def test_list_filters_by_source(fresh_db):
    mid = _seed_material()
    repo.insert_bulk([
        dict(test_id=1, material_id=mid, x_value=0, y_value=None,
             hex="#abcdef", sigma=0.0, source="averaged",
             source_result_id=None, params={}),
        dict(test_id=2, material_id=mid, x_value=0, y_value=None,
             hex="#fedcba", sigma=0.0, source="single_result",
             source_result_id=None, params={}),
    ])
    averaged = repo.list_all(source="averaged")
    assert [e["hex"] for e in averaged] == ["#abcdef"]


def test_list_filters_by_favorites_only(fresh_db):
    mid = _seed_material()
    repo.insert_bulk([
        dict(test_id=1, material_id=mid, x_value=0, y_value=None,
             hex="#000000", sigma=0.0, source="averaged",
             source_result_id=None, params={}),
    ])
    # No favorites yet
    assert repo.list_all(favorites_only=True) == []
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run --active pytest tests/test_repo_palette.py::test_list_filters_by_source tests/test_repo_palette.py::test_list_filters_by_favorites_only -v`
Expected: FAIL — `list_all() got an unexpected keyword argument 'source'`.

- [ ] **Step 3: Extend `list_all` signature**

In `src/xcs_gen_web/repositories/palette.py`, replace the existing `list_all`:

```python
def list_all(
    *, owner_id: int = STANDALONE_USER_ID,
    material_id: int | None = None,
    favorites_only: bool = False,
    source: str | None = None,
) -> list[dict[str, Any]]:
    with session_scope() as s:
        q = select(palette_entries).where(
            palette_entries.c.owner_id == owner_id,
        )
        if material_id is not None:
            q = q.where(palette_entries.c.material_id == material_id)
        if favorites_only:
            q = q.where(palette_entries.c.favorited == True)  # noqa: E712
        if source is not None:
            q = q.where(palette_entries.c.source == source)
        q = q.order_by(palette_entries.c.created_at.desc())
        return [_row_to_entry(r) for r in s.execute(q).all()]
```

- [ ] **Step 4: Add `favorited` to `_row_to_entry`**

In the same file, update `_row_to_entry`:

```python
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
        "owner_id": r.owner_id,
        "visibility": r.visibility,
        "favorited": bool(r.favorited),
    }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `uv run --active pytest tests/test_repo_palette.py -q`
Expected: PASS — every test, including the two new ones.

- [ ] **Step 6: Commit**

```bash
git add src/xcs_gen_web/repositories/palette.py tests/test_repo_palette.py
git commit -m "palette repo: list_all filters by source + favorites"
```

---

## Task 4: Repository — `create_manual`

**Files:**
- Modify: `src/xcs_gen_web/repositories/palette.py`
- Test: `tests/test_repo_palette.py`

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_repo_palette.py`:

```python
def test_create_manual(fresh_db):
    mid = _seed_material()
    e = repo.create_manual(
        material_id=mid, hex_="#abcdef",
        params={"power": 50, "speed": 1000, "laser": "red"},
        notes="quick test",
    )
    assert e["source"] == "manual"
    assert e["test_id"] is None
    assert e["sigma"] == 0.0
    assert e["favorited"] is False
    assert e["notes"] == "quick test"
    # Lab is computed
    assert len(e["lab"]) == 3
    # Round-trips via list
    assert any(x["id"] == e["id"] for x in repo.list_all())


def test_create_manual_owner_scoped(fresh_db):
    mid = _seed_material()
    repo.create_manual(material_id=mid, hex_="#abcdef", params={}, notes="", owner_id=1)
    # Different owner sees nothing
    assert repo.list_all(owner_id=2) == []
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run --active pytest tests/test_repo_palette.py::test_create_manual tests/test_repo_palette.py::test_create_manual_owner_scoped -v`
Expected: FAIL — `module 'palette' has no attribute 'create_manual'`.

- [ ] **Step 3: Implement `create_manual`**

In `src/xcs_gen_web/repositories/palette.py`, append after `replace_for_test`:

```python
def create_manual(
    *,
    material_id: int,
    hex_: str,
    params: dict[str, Any],
    notes: str,
    owner_id: int = STANDALONE_USER_ID,
    visibility: str = DEFAULT_VISIBILITY,
) -> dict[str, Any]:
    L, a, b = hex_to_lab(hex_)
    now = _now()
    row = {
        "test_id": None,
        "material_id": material_id,
        "x_value": None,
        "y_value": None,
        "hex": hex_,
        "lab_l": L, "lab_a": a, "lab_b": b,
        "params_json": json.dumps(params, separators=(",", ":")),
        "sigma": 0.0,
        "source": "manual",
        "source_result_id": None,
        "notes": notes,
        "created_at": now,
        "owner_id": owner_id,
        "visibility": visibility,
        "favorited": False,
    }
    with session_scope() as s:
        res = s.execute(palette_entries.insert().values(**row))
        new_id = res.inserted_primary_key[0]
        out = s.execute(
            select(palette_entries).where(palette_entries.c.id == new_id),
        ).one()
    return _row_to_entry(out)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `uv run --active pytest tests/test_repo_palette.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/xcs_gen_web/repositories/palette.py tests/test_repo_palette.py
git commit -m "palette repo: create_manual"
```

---

## Task 5: Repository — `update_entry` (replaces `update_notes`)

**Files:**
- Modify: `src/xcs_gen_web/repositories/palette.py`
- Test: `tests/test_repo_palette.py`

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_repo_palette.py`:

```python
import pytest


def test_update_entry_manual_changes_hex_and_lab(fresh_db):
    mid = _seed_material()
    e = repo.create_manual(material_id=mid, hex_="#000000", params={}, notes="")
    updated = repo.update_entry(e["id"], hex_="#ffffff")
    assert updated["hex"] == "#ffffff"
    # Lab should differ from the original (black → white)
    assert updated["lab"][0] > e["lab"][0]


def test_update_entry_manual_partial_patch(fresh_db):
    mid = _seed_material()
    e = repo.create_manual(material_id=mid, hex_="#000000", params={"power": 1}, notes="")
    updated = repo.update_entry(e["id"], notes="renamed")
    assert updated["notes"] == "renamed"
    assert updated["hex"] == "#000000"
    assert updated["params"] == {"power": 1}


def test_update_entry_rejects_param_mutation_on_ingested(fresh_db):
    mid = _seed_material()
    repo.insert_bulk([
        dict(test_id=1, material_id=mid, x_value=0, y_value=None,
             hex="#abcdef", sigma=0.0, source="averaged",
             source_result_id=None, params={"power": 10}),
    ])
    eid = repo.list_all()[0]["id"]
    with pytest.raises(repo.NotMutableError):
        repo.update_entry(eid, hex_="#ffffff")


def test_update_entry_notes_allowed_on_ingested(fresh_db):
    """Notes are mutable on any source (preserves today's behavior)."""
    mid = _seed_material()
    repo.insert_bulk([
        dict(test_id=1, material_id=mid, x_value=0, y_value=None,
             hex="#abcdef", sigma=0.0, source="averaged",
             source_result_id=None, params={}),
    ])
    eid = repo.list_all()[0]["id"]
    updated = repo.update_entry(eid, notes="ok to rename")
    assert updated["notes"] == "ok to rename"


def test_update_entry_missing_returns_none(fresh_db):
    assert repo.update_entry(99999, notes="x") is None
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run --active pytest tests/test_repo_palette.py -k update_entry -v`
Expected: FAIL — `module 'palette' has no attribute 'update_entry'`.

- [ ] **Step 3: Implement `update_entry`**

In `src/xcs_gen_web/repositories/palette.py`, append:

```python
class NotMutableError(Exception):
    """Raised when callers try to mutate hex/material_id/params on a non-manual row."""


def update_entry(
    eid: int,
    *,
    hex_: str | None = None,
    material_id: int | None = None,
    params: dict[str, Any] | None = None,
    notes: str | None = None,
    owner_id: int = STANDALONE_USER_ID,
) -> dict[str, Any] | None:
    with session_scope() as s:
        row = s.execute(
            select(palette_entries).where(
                and_(
                    palette_entries.c.id == eid,
                    palette_entries.c.owner_id == owner_id,
                ),
            )
        ).one_or_none()
        if row is None:
            return None
        is_manual = row.source == "manual"
        wants_recipe_change = (
            hex_ is not None or material_id is not None or params is not None
        )
        if wants_recipe_change and not is_manual:
            raise NotMutableError(
                "cannot mutate hex/material_id/params on ingested swatch",
            )
        values: dict[str, Any] = {}
        if hex_ is not None:
            L, a, b = hex_to_lab(hex_)
            values["hex"] = hex_
            values["lab_l"] = L
            values["lab_a"] = a
            values["lab_b"] = b
        if material_id is not None:
            values["material_id"] = material_id
        if params is not None:
            values["params_json"] = json.dumps(params, separators=(",", ":"))
        if notes is not None:
            values["notes"] = notes
        if values:
            s.execute(
                palette_entries.update()
                .where(
                    and_(
                        palette_entries.c.id == eid,
                        palette_entries.c.owner_id == owner_id,
                    ),
                )
                .values(**values)
            )
        out = s.execute(
            select(palette_entries).where(palette_entries.c.id == eid),
        ).one()
        return _row_to_entry(out)
```

- [ ] **Step 4: Delete the old `update_notes` helper**

In `src/xcs_gen_web/repositories/palette.py`, find the `update_notes` function (around lines 162–183) and delete it. `update_entry(eid, notes=…)` is the replacement.

- [ ] **Step 5: Run tests to verify they pass**

Run: `uv run --active pytest tests/test_repo_palette.py -q`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/xcs_gen_web/repositories/palette.py tests/test_repo_palette.py
git commit -m "palette repo: update_entry replaces update_notes"
```

---

## Task 6: Repository — `set_favorited`

**Files:**
- Modify: `src/xcs_gen_web/repositories/palette.py`
- Test: `tests/test_repo_palette.py`

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_repo_palette.py`:

```python
def test_set_favorited_toggle(fresh_db):
    mid = _seed_material()
    e = repo.create_manual(material_id=mid, hex_="#000000", params={}, notes="")
    on = repo.set_favorited(e["id"], True)
    assert on["favorited"] is True
    off = repo.set_favorited(e["id"], False)
    assert off["favorited"] is False


def test_set_favorited_idempotent(fresh_db):
    mid = _seed_material()
    e = repo.create_manual(material_id=mid, hex_="#000000", params={}, notes="")
    repo.set_favorited(e["id"], True)
    again = repo.set_favorited(e["id"], True)
    assert again["favorited"] is True


def test_set_favorited_works_on_any_source(fresh_db):
    """Stars are a personal pin — works on ingested rows too."""
    mid = _seed_material()
    repo.insert_bulk([
        dict(test_id=1, material_id=mid, x_value=0, y_value=None,
             hex="#abcdef", sigma=0.0, source="averaged",
             source_result_id=None, params={}),
    ])
    eid = repo.list_all()[0]["id"]
    out = repo.set_favorited(eid, True)
    assert out["favorited"] is True


def test_set_favorited_missing_returns_none(fresh_db):
    assert repo.set_favorited(99999, True) is None
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run --active pytest tests/test_repo_palette.py -k set_favorited -v`
Expected: FAIL — `module 'palette' has no attribute 'set_favorited'`.

- [ ] **Step 3: Implement `set_favorited`**

In `src/xcs_gen_web/repositories/palette.py`, append:

```python
def set_favorited(
    eid: int, value: bool, *, owner_id: int = STANDALONE_USER_ID,
) -> dict[str, Any] | None:
    with session_scope() as s:
        res = s.execute(
            palette_entries.update()
            .where(
                and_(
                    palette_entries.c.id == eid,
                    palette_entries.c.owner_id == owner_id,
                ),
            )
            .values(favorited=value)
        )
        if res.rowcount == 0:
            return None
        row = s.execute(
            select(palette_entries).where(palette_entries.c.id == eid),
        ).one()
        return _row_to_entry(row)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `uv run --active pytest tests/test_repo_palette.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/xcs_gen_web/repositories/palette.py tests/test_repo_palette.py
git commit -m "palette repo: set_favorited"
```

---

## Task 7: Pydantic schemas

**Files:**
- Modify: `src/xcs_gen_web/schemas.py:324-348`

- [ ] **Step 1: Update `PaletteEntryResponse`**

In `src/xcs_gen_web/schemas.py`, replace `PaletteEntryResponse` (currently around lines 324–339):

```python
class PaletteEntryResponse(BaseModel):
    id: int
    test_id: int | None = None
    material_id: int
    source: str
    hex: str
    lab: list[float]
    params: dict
    sigma: float
    notes: str
    created_at: str
    favorited: bool = False
    x_value: float | None = None
    y_value: float | None = None
    source_result_id: int | None = None
    owner_id: int
    visibility: str
```

- [ ] **Step 2: Widen `PaletteEntryPatch`**

Replace the existing `PaletteEntryPatch` (around line 347) with:

```python
class PaletteEntryPatch(BaseModel):
    """All fields optional. Backend rejects hex/material_id/params changes
    on non-manual rows with 409 Conflict (see app.py:palette_patch)."""

    hex: str | None = None
    material_id: int | None = None
    params: dict | None = None
    notes: str | None = None
    favorited: bool | None = None
```

- [ ] **Step 3: Add `PaletteEntryCreateManual`**

Append below `PaletteEntryPatch`:

```python
class PaletteEntryCreateManual(BaseModel):
    material_id: int
    hex: str
    params: dict
    notes: str = ""
```

- [ ] **Step 4: Run schemas test**

Run: `uv run --active pytest tests/test_schemas.py -q`
Expected: PASS — schemas import and validate cleanly.

- [ ] **Step 5: Commit**

```bash
git add src/xcs_gen_web/schemas.py
git commit -m "schemas: palette manual create + widened patch"
```

---

## Task 8: API — `POST /api/palette/manual`

**Files:**
- Modify: `src/xcs_gen_web/app.py:625` (palette section)
- Test: `tests/test_palette_api.py`

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_palette_api.py`:

```python
import re


def test_create_manual_success(client, mid):
    body = {
        "material_id": mid,
        "hex": "#abcdef",
        "params": {"power": 50, "speed": 1000, "laser": "red"},
        "notes": "first manual",
    }
    resp = client.post("/api/palette/manual", json=body)
    assert resp.status_code == 201
    e = resp.json()
    assert e["source"] == "manual"
    assert e["test_id"] is None
    assert e["favorited"] is False
    assert re.fullmatch(r"#[0-9a-fA-F]{6}", e["hex"])


def test_create_manual_invalid_hex(client, mid):
    resp = client.post("/api/palette/manual", json={
        "material_id": mid, "hex": "blue", "params": {}, "notes": "",
    })
    assert resp.status_code == 422


def test_create_manual_missing_material(client, fresh_db):
    resp = client.post("/api/palette/manual", json={
        "hex": "#abcdef", "params": {}, "notes": "",
    })
    assert resp.status_code == 422
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run --active pytest tests/test_palette_api.py::test_create_manual_success -v`
Expected: FAIL — 404, route doesn't exist yet.

- [ ] **Step 3: Add a hex validator to schemas**

In `src/xcs_gen_web/schemas.py`, replace `PaletteEntryCreateManual` with:

```python
class PaletteEntryCreateManual(BaseModel):
    material_id: int
    hex: str
    params: dict
    notes: str = ""

    @field_validator("hex")
    @classmethod
    def _hex_must_match(cls, v: str) -> str:
        import re as _re
        if not _re.fullmatch(r"#[0-9a-fA-F]{6}", v):
            raise ValueError("hex must match #RRGGBB")
        return v.lower()
```

If `field_validator` isn't already imported, find the existing `from pydantic import …` line and add `field_validator`:

```python
from pydantic import BaseModel, field_validator
```

- [ ] **Step 4: Add the route**

In `src/xcs_gen_web/app.py`, near the other palette routes (around line 625, just below the `from .repositories import palette as pal_repo` import block), add the new endpoint. Place it before the `@app.get("/api/palette", …)` route so routing prefers `/manual` over `/{entry_id}`:

```python
    @app.post("/api/palette/manual", response_model=PaletteEntryResponse, status_code=201)
    def palette_create_manual(
        body: PaletteEntryCreateManual,
        user_id: int = Depends(get_current_user),
    ) -> PaletteEntryResponse:
        # Material ownership is enforced indirectly: list_all filters by
        # owner_id, and any read of this entry will be owner-scoped.
        e = pal_repo.create_manual(
            material_id=body.material_id, hex_=body.hex,
            params=body.params, notes=body.notes,
            owner_id=user_id,
        )
        return PaletteEntryResponse(**e)
```

Make sure `PaletteEntryCreateManual` is imported at the top of `app.py` (alongside `PaletteEntryResponse` etc.).

- [ ] **Step 5: Run tests to verify they pass**

Run: `uv run --active pytest tests/test_palette_api.py -q`
Expected: PASS — including the three new ones plus existing.

- [ ] **Step 6: Commit**

```bash
git add src/xcs_gen_web/app.py src/xcs_gen_web/schemas.py tests/test_palette_api.py
git commit -m "api: POST /api/palette/manual"
```

---

## Task 9: API — widen `PATCH /api/palette/{id}` + `GET /api/palette`

**Files:**
- Modify: `src/xcs_gen_web/app.py:626-675` (palette section)
- Test: `tests/test_palette_api.py`

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_palette_api.py`:

```python
def test_patch_favorited(client, mid):
    ids = _seed_entries(mid)
    eid = ids[0]
    resp = client.patch(f"/api/palette/{eid}", json={"favorited": True})
    assert resp.status_code == 200
    assert resp.json()["favorited"] is True
    listed = next(e for e in client.get("/api/palette").json() if e["id"] == eid)
    assert listed["favorited"] is True


def test_patch_recipe_on_manual_succeeds(client, mid):
    body = {"material_id": mid, "hex": "#000000", "params": {"power": 1}, "notes": "x"}
    e = client.post("/api/palette/manual", json=body).json()
    resp = client.patch(f"/api/palette/{e['id']}", json={"hex": "#ffffff"})
    assert resp.status_code == 200
    assert resp.json()["hex"] == "#ffffff"


def test_patch_recipe_on_ingested_409(client, mid):
    ids = _seed_entries(mid)
    resp = client.patch(f"/api/palette/{ids[0]}", json={"hex": "#ffffff"})
    assert resp.status_code == 409


def test_list_filters_favorites_only(client, mid):
    ids = _seed_entries(mid)
    client.patch(f"/api/palette/{ids[0]}", json={"favorited": True})
    favs = client.get("/api/palette", params={"favorites_only": "true"}).json()
    assert len(favs) == 1
    assert favs[0]["id"] == ids[0]


def test_list_filters_by_source(client, mid):
    _seed_entries(mid)  # 'averaged'
    client.post("/api/palette/manual", json={
        "material_id": mid, "hex": "#cafefe", "params": {}, "notes": "",
    })
    manual = client.get("/api/palette", params={"source": "manual"}).json()
    assert len(manual) == 1
    assert manual[0]["source"] == "manual"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run --active pytest tests/test_palette_api.py -k "patch_favorited or patch_recipe or filters_favorites_only or filters_by_source" -v`
Expected: FAIL — patch ignores favorited / 200 instead of 409 / no filter applied.

- [ ] **Step 3: Rewrite the PATCH route**

In `src/xcs_gen_web/app.py`, replace the existing `palette_patch` (around line 667) with:

```python
    @app.patch("/api/palette/{entry_id}", response_model=PaletteEntryResponse)
    def palette_patch(
        entry_id: int, patch: PaletteEntryPatch,
        user_id: int = Depends(get_current_user),
    ) -> PaletteEntryResponse:
        if patch.favorited is not None:
            fav_result = pal_repo.set_favorited(
                entry_id, patch.favorited, owner_id=user_id,
            )
            if fav_result is None:
                raise HTTPException(status_code=404, detail="entry not found")
        try:
            result = pal_repo.update_entry(
                entry_id,
                hex_=patch.hex, material_id=patch.material_id,
                params=patch.params, notes=patch.notes,
                owner_id=user_id,
            )
        except pal_repo.NotMutableError as exc:
            raise HTTPException(status_code=409, detail=str(exc))
        if result is None:
            raise HTTPException(status_code=404, detail="entry not found")
        return PaletteEntryResponse(**result)
```

- [ ] **Step 4: Widen the GET route**

In `src/xcs_gen_web/app.py`, replace the existing `palette_list`:

```python
    @app.get("/api/palette", response_model=list[PaletteEntryResponse])
    def palette_list(
        material_id: int | None = None,
        favorites_only: bool = False,
        source: str | None = None,
        user_id: int = Depends(get_current_user),
    ) -> list[PaletteEntryResponse]:
        return [
            PaletteEntryResponse(**e)
            for e in pal_repo.list_all(
                owner_id=user_id, material_id=material_id,
                favorites_only=favorites_only, source=source,
            )
        ]
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `uv run --active pytest tests/test_palette_api.py -q`
Expected: PASS.

- [ ] **Step 6: Run the full backend suite**

Run: `uv run --active pytest tests/ -q`
Expected: PASS — no regressions.

- [ ] **Step 7: Commit**

```bash
git add src/xcs_gen_web/app.py tests/test_palette_api.py
git commit -m "api: widen palette PATCH + GET (favorited, source filter)"
```

---

## Task 10: Frontend types

**Files:**
- Modify: `web/src/types.ts:200-216`

- [ ] **Step 1: Edit the `PaletteEntry` interface**

In `web/src/types.ts`, replace the existing `PaletteEntry`:

```ts
export interface PaletteEntry {
  id: number;
  test_id: number | null;
  material_id: number;
  x_value: number | null; y_value: number | null;
  hex: string; lab: number[];
  params: Record<string, string | number>;
  sigma: number;
  source: "averaged" | "single_result" | "manual";
  source_result_id: number | null;
  notes: string;
  favorited: boolean;
  created_at: string;
}
```

- [ ] **Step 2: Typecheck the frontend**

Run: `cd web && npx tsc --noEmit`
Expected: errors will surface anywhere `test_id` is used unguarded or `favorited` is missing on test fixtures. Note them — the next tasks address each.

If the only errors are about `favorited` not being supplied to test fixtures or `test_id` being assumed-non-null, that's expected and gets fixed in subsequent tasks. Move on without committing yet.

---

## Task 11: Frontend API client

**Files:**
- Modify: `web/src/api/palette.ts`

- [ ] **Step 1: Replace the file's contents**

Edit `web/src/api/palette.ts`:

```ts
import type { PaletteEntry, PaletteQueryResult } from "../types";

async function j<T>(r: Response): Promise<T> {
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return (r.status === 204 ? undefined : r.json()) as Promise<T>;
}

export interface ListPaletteOptions {
  material_id?: number;
  favorites_only?: boolean;
  source?: "averaged" | "single_result" | "manual";
}

export async function listPaletteEntries(
  arg?: number | ListPaletteOptions,
): Promise<PaletteEntry[]> {
  const opts: ListPaletteOptions =
    typeof arg === "number" ? { material_id: arg } : (arg ?? {});
  const qs = new URLSearchParams();
  if (opts.material_id) qs.set("material_id", String(opts.material_id));
  if (opts.favorites_only) qs.set("favorites_only", "true");
  if (opts.source) qs.set("source", opts.source);
  const tail = qs.toString() ? `?${qs.toString()}` : "";
  return j(await fetch(`/api/palette${tail}`));
}

export async function queryPalette(
  hex: string,
  opts: { limit?: number; material_id?: number } = {},
): Promise<PaletteQueryResult[]> {
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

export interface PaletteEntryPatch {
  hex?: string;
  material_id?: number;
  params?: Record<string, string | number>;
  notes?: string;
  favorited?: boolean;
}

export async function patchPaletteEntry(
  id: number, patch: PaletteEntryPatch,
): Promise<PaletteEntry> {
  return j(await fetch(`/api/palette/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  }));
}

export interface CreateManualBody {
  material_id: number;
  hex: string;
  params: Record<string, string | number>;
  notes: string;
}

export async function createManualPaletteEntry(
  body: CreateManualBody,
): Promise<PaletteEntry> {
  return j(await fetch(`/api/palette/manual`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }));
}

// Backwards-compat alias for the single existing call site that imports
// `patchPaletteNotes` (will be removed once PalettePage migrates).
export async function patchPaletteNotes(id: number, notes: string): Promise<PaletteEntry> {
  return patchPaletteEntry(id, { notes });
}
```

- [ ] **Step 2: Typecheck**

Run: `cd web && npx tsc --noEmit`
Expected: no new errors from `web/src/api/palette.ts`. Errors elsewhere remain (those get fixed in later tasks).

- [ ] **Step 3: Commit (snapshot before UI work)**

```bash
git add web/src/api/palette.ts web/src/types.ts
git commit -m "web: palette types + api client (manual + favorited)"
```

---

## Task 12: `StarToggle` component

**Files:**
- Create: `web/src/components/StarToggle.tsx`

- [ ] **Step 1: Create the file**

Create `web/src/components/StarToggle.tsx`:

```tsx
import { Star } from "lucide-react";
import { cn } from "../ui";

export function StarToggle({
  favorited,
  onChange,
  disabled,
  className,
  size = "sm",
}: {
  favorited: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  className?: string;
  size?: "sm" | "md";
}) {
  const px = size === "sm" ? "h-3.5 w-3.5" : "h-4 w-4";
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        if (!disabled) onChange(!favorited);
      }}
      aria-pressed={favorited}
      aria-label={favorited ? "Remove from favorites" : "Add to favorites"}
      title={favorited ? "Favorited" : "Favorite"}
      disabled={disabled}
      className={cn(
        "inline-flex items-center justify-center p-1 rounded-full",
        "transition-opacity",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-primary)]/60",
        favorited
          ? "opacity-100"
          : "opacity-70 hover:opacity-100",
        className,
      )}
      style={{ mixBlendMode: favorited ? "normal" : "difference" }}
    >
      <Star
        className={px}
        strokeWidth={2}
        fill={favorited ? "var(--color-accent, #caa14b)" : "none"}
        color={favorited ? "var(--color-accent, #caa14b)" : "white"}
      />
    </button>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `cd web && npx tsc --noEmit`
Expected: clean for this file.

- [ ] **Step 3: Commit**

```bash
git add web/src/components/StarToggle.tsx
git commit -m "web: StarToggle component"
```

---

## Task 13: Favorites pagination helper + test

**Files:**
- Create: `web/src/svg/favoritesPager.ts`
- Test: `web/src/svg/favoritesPager.test.ts`

- [ ] **Step 1: Write the failing test**

Create `web/src/svg/favoritesPager.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { computePager } from "./favoritesPager";

describe("computePager", () => {
  it("computes page size from container width", () => {
    expect(computePager({ totalCount: 12, containerWidth: 400, chipWidth: 80, page: 0 }).pageSize).toBe(5);
    expect(computePager({ totalCount: 12, containerWidth: 200, chipWidth: 80, page: 0 }).pageSize).toBe(2);
  });

  it("ensures pageSize is at least 1 even on tiny containers", () => {
    expect(computePager({ totalCount: 5, containerWidth: 30, chipWidth: 80, page: 0 }).pageSize).toBe(1);
  });

  it("returns the slice for the current page", () => {
    const r = computePager({ totalCount: 12, containerWidth: 400, chipWidth: 80, page: 1 });
    expect(r.pageSize).toBe(5);
    expect(r.start).toBe(5);
    expect(r.end).toBe(10);
    expect(r.totalPages).toBe(3);
  });

  it("clamps page upward when shrinking past the end", () => {
    const r = computePager({ totalCount: 12, containerWidth: 400, chipWidth: 80, page: 9 });
    expect(r.page).toBe(2);
    expect(r.start).toBe(10);
    expect(r.end).toBe(12);
  });

  it("handles empty inputs without dividing by zero", () => {
    const r = computePager({ totalCount: 0, containerWidth: 400, chipWidth: 80, page: 0 });
    expect(r.pageSize).toBe(5);
    expect(r.totalPages).toBe(0);
    expect(r.start).toBe(0);
    expect(r.end).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run src/svg/favoritesPager.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the helper**

Create `web/src/svg/favoritesPager.ts`:

```ts
export interface PagerInput {
  totalCount: number;
  containerWidth: number;
  chipWidth: number;
  page: number;
}

export interface PagerResult {
  pageSize: number;
  totalPages: number;
  page: number;
  start: number;
  end: number;
}

export function computePager(i: PagerInput): PagerResult {
  const safeChip = Math.max(1, i.chipWidth);
  const fit = Math.floor(i.containerWidth / safeChip);
  const pageSize = Math.max(1, fit);
  const totalPages = Math.ceil(i.totalCount / pageSize);
  const clampedPage = Math.max(0, Math.min(i.page, Math.max(0, totalPages - 1)));
  const start = clampedPage * pageSize;
  const end = Math.min(i.totalCount, start + pageSize);
  return { pageSize, totalPages, page: clampedPage, start, end };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run src/svg/favoritesPager.test.ts`
Expected: PASS — all 5 tests.

- [ ] **Step 5: Commit**

```bash
git add web/src/svg/favoritesPager.ts web/src/svg/favoritesPager.test.ts
git commit -m "web: favoritesPager helper + test"
```

---

## Task 14: `PaletteEntryDialog` (add/edit modal)

**Files:**
- Create: `web/src/components/PaletteEntryDialog.tsx`

- [ ] **Step 1: Read the existing patterns**

Quick context reads (no edit yet):
- `web/src/components/PalettePage.tsx:165-180` — hex picker pattern.
- `web/src/components/SvgLayersPage.tsx:1094-1151` — base-params editor (NumberField, PulseWidthSelect, laser Select).
- `web/src/defaults.ts` — `defaultBaseParams()` for initial seed.

- [ ] **Step 2: Create the dialog**

Create `web/src/components/PaletteEntryDialog.tsx`:

```tsx
import { useEffect, useState } from "react";
import {
  Button, Card, Dialog, DialogContent, DialogTitle,
  Field, Input, NumberField, Section, Select,
} from "../ui";
import { PulseWidthSelect } from "./PulseWidthSelect";
import type { BaseParams, PaletteEntry } from "../types";
import type { Material } from "../library";
import { defaultBaseParams } from "../defaults";
import { createManualPaletteEntry, patchPaletteEntry } from "../api/palette";

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

export interface PaletteEntryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  materials: Material[];
  /** When set, dialog is in EDIT mode for that entry. */
  entry?: PaletteEntry | null;
  /** Default material id for new entries. */
  defaultMaterialId?: string;
  onSaved: (entry: PaletteEntry) => void;
}

export function PaletteEntryDialog({
  open, onOpenChange, materials, entry, defaultMaterialId, onSaved,
}: PaletteEntryDialogProps) {
  const isEdit = !!entry;
  const [hex, setHex] = useState("#cccccc");
  const [materialId, setMaterialId] = useState<string>(defaultMaterialId ?? "");
  const [notes, setNotes] = useState("");
  const [params, setParams] = useState<BaseParams>(defaultBaseParams());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    if (!open) return;
    setError(undefined);
    if (entry) {
      setHex(entry.hex);
      setMaterialId(String(entry.material_id));
      setNotes(entry.notes);
      setParams({ ...defaultBaseParams(), ...paletteParamsToBase(entry.params) });
    } else {
      setHex("#cccccc");
      setMaterialId(defaultMaterialId ?? "");
      setNotes("");
      setParams(defaultBaseParams());
    }
  }, [open, entry, defaultMaterialId]);

  const hexValid = HEX_RE.test(hex);
  const canSave = hexValid && materialId !== "" && !saving;

  async function onSave() {
    setSaving(true);
    setError(undefined);
    try {
      let saved: PaletteEntry;
      const paramsRecord = baseToPaletteParams(params);
      if (isEdit && entry) {
        saved = await patchPaletteEntry(entry.id, {
          hex, material_id: Number(materialId),
          params: paramsRecord, notes,
        });
      } else {
        saved = await createManualPaletteEntry({
          material_id: Number(materialId),
          hex, params: paramsRecord, notes,
        });
      }
      onSaved(saved);
      onOpenChange(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent width="lg">
        <DialogTitle>{isEdit ? "Edit swatch" : "New manual swatch"}</DialogTitle>

        <div className="grid gap-5 mt-3">
          <Card padded={false} className="p-3">
            <Section title="Identity" dense>
              <Field label="Material">
                <Select
                  value={materialId}
                  onChange={(e) => setMaterialId(e.target.value)}
                  invalid={materialId === ""}
                >
                  {materialId === "" && <option value="">— pick a material —</option>}
                  {materials.map((m) => (
                    <option key={m.id} value={String(m.id)}>{m.name}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Hex">
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={hexValid ? hex : "#cccccc"}
                    onChange={(e) => setHex(e.target.value)}
                    aria-label="Pick hex"
                    className="h-9 w-12 rounded-[6px] border border-[color:var(--color-border-strong)] cursor-pointer p-1"
                  />
                  <Input
                    mono
                    value={hex}
                    onChange={(e) => setHex(e.target.value)}
                    invalid={!hexValid}
                    className="w-[160px]"
                  />
                </div>
              </Field>
              <Field label="Label / notes">
                <Input
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="e.g. burnt copper, 1 mm gold"
                />
              </Field>
            </Section>
          </Card>

          <Card padded={false} className="p-3">
            <Section title="Recipe" dense>
              <div className="grid grid-cols-2 gap-3">
                <NumberField
                  label="Power %"
                  value={params.power}
                  onChange={(v) => setParams({ ...params, power: v })}
                />
                <NumberField
                  label="Speed (mm/s)"
                  value={params.speed}
                  integer
                  onChange={(v) => setParams({ ...params, speed: v })}
                />
                <NumberField
                  label="Frequency (Hz)"
                  value={params.frequency}
                  integer
                  onChange={(v) => setParams({ ...params, frequency: v })}
                />
                <NumberField
                  label="Lines/cm"
                  value={params.density}
                  integer
                  onChange={(v) => setParams({ ...params, density: v })}
                />
                <NumberField
                  label="Passes"
                  value={params.passes}
                  integer
                  min={1}
                  onChange={(v) => setParams({ ...params, passes: v })}
                />
                <PulseWidthSelect
                  value={params.pulse_width}
                  onChange={(v) => setParams({ ...params, pulse_width: v })}
                />
                <div className="col-span-2">
                  <Field label="Laser">
                    <Select
                      value={params.laser}
                      onChange={(e) =>
                        setParams({ ...params, laser: e.target.value as "red" | "blue" })
                      }
                    >
                      <option value="red">Red (MOPA)</option>
                      <option value="blue">Blue (diode)</option>
                    </Select>
                  </Field>
                </div>
              </div>
            </Section>
          </Card>

          {error && (
            <p className="text-[12px] text-[color:var(--color-destructive)]">{error}</p>
          )}

          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button variant="primary" onClick={onSave} disabled={!canSave}>
              {saving ? "Saving…" : isEdit ? "Save changes" : "Create swatch"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function paletteParamsToBase(p: Record<string, string | number>): Partial<BaseParams> {
  const num = (k: string) =>
    p[k] === undefined ? undefined : Number(p[k]);
  const laser = p["laser"] === "blue" ? "blue" : "red";
  return {
    power: num("power"),
    speed: num("speed"),
    frequency: num("frequency"),
    density: num("density"),
    passes: num("passes"),
    pulse_width: num("pulse_width"),
    laser,
  };
}

function baseToPaletteParams(b: BaseParams): Record<string, string | number> {
  return {
    power: b.power, speed: b.speed, frequency: b.frequency,
    density: b.density, passes: b.passes, pulse_width: b.pulse_width,
    laser: b.laser, scan_angle: b.scan_angle,
  };
}
```

- [ ] **Step 3: Typecheck**

Run: `cd web && npx tsc --noEmit`
Expected: no errors in this file (callers may still have errors — those resolve in Task 15).

- [ ] **Step 4: Commit**

```bash
git add web/src/components/PaletteEntryDialog.tsx
git commit -m "web: PaletteEntryDialog (add/edit manual swatch)"
```

---

## Task 15: PalettePage tabs + Manual + Favorites + star + edit/copy

**Files:**
- Modify: `web/src/components/PalettePage.tsx`

This is the biggest single edit. We add tabs, wire the new modal, swap the entry-card affordances, and add the star button. Read the existing file once before editing.

- [ ] **Step 1: Update the imports + `View` union**

In `web/src/components/PalettePage.tsx`, replace the existing imports at the top with:

```tsx
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Check, Copy, Info, Pencil, Plus, Search, Trash2, X } from "lucide-react";
import { DialogClose } from "@radix-ui/react-dialog";
import {
  listPaletteEntries,
  queryPalette,
  deletePaletteEntry,
  deletePaletteByTest,
  createManualPaletteEntry,
  patchPaletteEntry,
} from "../api/palette";
import type { PaletteEntry, PaletteQueryResult } from "../types";
import type { Material } from "../library";
import { listMaterials, listPresets } from "../api/library";
import { formatRoute } from "../router";
import { PaletteEntryDialog } from "./PaletteEntryDialog";
import { StarToggle } from "./StarToggle";
import {
  Badge, Button, Card, Dialog, DialogContent, DialogTitle, DemoLock,
  EmptyState, Field, Input, MetalBar, PageContainer, Section, Select,
  Tab, TabList, TabPanel, Tabs, cn,
} from "../ui";
```

Then replace `type View = "query" | "browse";` with:

```tsx
type View = "browse" | "manual" | "favorites" | "query";
```

- [ ] **Step 2: Update the top-level component to add the new tabs**

In the same file, replace the `PalettePage` function body (the `return` block) with:

```tsx
export function PalettePage() {
  const [materials, setMaterials] = useState<Material[]>([]);
  const [view, setView] = useState<View>("browse");

  useEffect(() => {
    Promise.all([listMaterials(), listPresets()])
      .then(([mats]) => setMaterials(mats))
      .catch((e) => console.error("Failed to load library:", e));
  }, []);

  if (materials.length === 0) {
    return (
      <PageContainer className="py-8">
        <Card className="border-dashed">
          <EmptyState
            title="No materials yet"
            description="Palette entries have to be tagged with a material so queries stay scoped. Add a material on the Library tab first, then burn a test and upload the result."
            action={
              <Button variant="primary" onClick={() => (window.location.hash = "#/library")}>
                Open library
              </Button>
            }
          />
        </Card>
      </PageContainer>
    );
  }

  return (
    <PageContainer className="py-8">
      <header className="mb-6">
        <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[color:var(--color-ink-subtle)] mb-1">
          Palette
        </div>
        <h1 className="text-[22px] font-semibold text-[color:var(--color-ink)]">
          Colour swatches per material
        </h1>
        <p className="mt-1 text-[13px] text-[color:var(--color-ink-muted)] max-w-[68ch]">
          Browse every swatch harvested from burn results, hand-author your
          own, or query by hex. Star any swatch to keep it on hand. All entries
          are scoped by material so different substrates never mix.
        </p>
      </header>

      <Tabs value={view} onValueChange={(v) => setView(v as View)}>
        <TabList>
          <Tab value="browse">Browse</Tab>
          <Tab value="manual">Manual</Tab>
          <Tab value="favorites">Favorites</Tab>
          <Tab value="query">Query</Tab>
        </TabList>
        <TabPanel value="browse">
          <BrowseView materials={materials} />
        </TabPanel>
        <TabPanel value="manual">
          <ManualView materials={materials} />
        </TabPanel>
        <TabPanel value="favorites">
          <FavoritesView materials={materials} />
        </TabPanel>
        <TabPanel value="query">
          <QueryView materials={materials} />
        </TabPanel>
      </Tabs>
    </PageContainer>
  );
}
```

- [ ] **Step 3: Replace `EntryCard` to wire the star + edit/copy actions**

Find `function EntryCard({...})` and replace it entirely with:

```tsx
function EntryCard({
  entry,
  materials,
  onDelete,
  onInfo,
  onEdit,
  onCopy,
  onFavoriteToggle,
}: {
  entry: PaletteEntry;
  materials: Material[];
  onDelete: () => void;
  onInfo: () => void;
  onEdit?: (entry: PaletteEntry) => void;
  onCopy?: (entry: PaletteEntry, toMaterialId: number) => void;
  onFavoriteToggle: (entry: PaletteEntry, next: boolean) => void;
}) {
  const [copyOpen, setCopyOpen] = useState(false);
  const [copyTo, setCopyTo] = useState<string>("");
  const isManual = entry.source === "manual";
  return (
    <div className="group relative rounded-[10px] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] overflow-hidden shadow-[var(--shadow-card)]">
      <div
        className="aspect-[4/3] w-full border-b border-[color:var(--color-border)] relative"
        style={{ background: entry.hex }}
      >
        {isManual && (
          <span className="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded-[4px] text-[9px] font-mono font-semibold tracking-[0.08em] uppercase bg-[color:var(--color-accent,#caa14b)] text-black/85">
            MAN
          </span>
        )}
        <StarToggle
          favorited={entry.favorited}
          onChange={(next) => onFavoriteToggle(entry, next)}
          className="absolute top-1 right-1"
        />
      </div>
      <div className="px-2 py-1.5 flex items-center justify-between gap-2">
        <div className="font-mono text-[11px] text-[color:var(--color-ink)]">{entry.hex}</div>
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            type="button"
            onClick={onInfo}
            title="Show full params"
            className="p-1 rounded text-[color:var(--color-ink-muted)] hover:text-[color:var(--color-secondary)] hover:bg-[color:var(--color-surface-elevated)]"
          >
            <Info className="h-3.5 w-3.5" />
          </button>
          {isManual && onEdit && (
            <button
              type="button"
              onClick={() => onEdit(entry)}
              title="Edit swatch"
              className="p-1 rounded text-[color:var(--color-ink-muted)] hover:text-[color:var(--color-secondary)] hover:bg-[color:var(--color-surface-elevated)]"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
          )}
          {isManual && onCopy && (
            <button
              type="button"
              onClick={() => setCopyOpen((v) => !v)}
              title="Copy to another material"
              className="p-1 rounded text-[color:var(--color-ink-muted)] hover:text-[color:var(--color-secondary)] hover:bg-[color:var(--color-surface-elevated)]"
            >
              <Copy className="h-3.5 w-3.5" />
            </button>
          )}
          <DemoLock label="Deleting palette entries is disabled in the demo.">
            <button
              type="button"
              onClick={onDelete}
              title="Delete swatch"
              className="p-1 rounded text-[color:var(--color-ink-muted)] hover:text-[color:var(--color-destructive)] hover:bg-[color:var(--color-destructive-tint)]"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </DemoLock>
        </div>
      </div>
      {copyOpen && isManual && onCopy && (
        <div className="absolute right-2 top-12 z-10 rounded-[6px] border border-[color:var(--color-border)] bg-[color:var(--color-surface-elevated)] shadow-[var(--shadow-card)] p-2 flex items-center gap-2">
          <Select
            value={copyTo}
            onChange={(e) => setCopyTo(e.target.value)}
            className="text-[11px] py-1"
          >
            <option value="">Copy to…</option>
            {materials
              .filter((m) => m.id !== entry.material_id)
              .map((m) => (
                <option key={m.id} value={String(m.id)}>{m.name}</option>
              ))}
          </Select>
          <Button
            variant="primary"
            size="sm"
            disabled={copyTo === ""}
            onClick={() => {
              onCopy(entry, Number(copyTo));
              setCopyTo("");
              setCopyOpen(false);
            }}
          >
            Copy
          </Button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Update `BrowseView` to pass new props to `EntryCard`**

Find `function BrowseView` and replace its `<EntryCard … />` invocation. Specifically, replace the `<EntryCard key={e.id} entry={e} onDelete={…} onInfo={…} />` block with:

```tsx
<EntryCard
  key={e.id}
  entry={e}
  materials={materials}
  onDelete={() => onDelete(e.id)}
  onInfo={() => setInfoId(e.id)}
  onFavoriteToggle={(entry, next) => onFavoriteToggle(entry, next)}
/>
```

Then add the `onFavoriteToggle` handler inside `BrowseView`, after `onDeleteTest`:

```tsx
async function onFavoriteToggle(entry: PaletteEntry, next: boolean) {
  // Optimistic
  setEntries((prev) =>
    prev.map((e) => (e.id === entry.id ? { ...e, favorited: next } : e)),
  );
  try {
    await patchPaletteEntry(entry.id, { favorited: next });
  } catch (e) {
    setError((e as Error).message);
    // rollback
    setEntries((prev) =>
      prev.map((x) => (x.id === entry.id ? { ...x, favorited: !next } : x)),
    );
  }
}
```

- [ ] **Step 5: Add `ManualView`**

In the same file, append before the helper functions at the bottom:

```tsx
function ManualView({ materials }: { materials: Material[] }) {
  const [entries, setEntries] = useState<PaletteEntry[]>([]);
  const [materialId, setMaterialId] = useState<string>("");
  const [error, setError] = useState<string | undefined>();
  const [infoId, setInfoId] = useState<number | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<PaletteEntry | null>(null);

  async function refresh() {
    setError(undefined);
    try {
      setEntries(await listPaletteEntries({
        material_id: materialId ? Number(materialId) : undefined,
        source: "manual",
      }));
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => { void refresh(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [materialId]);

  async function onDelete(id: number) {
    if (!confirm("Delete this manual swatch?")) return;
    try {
      await deletePaletteEntry(id);
      await refresh();
    } catch (e) { setError((e as Error).message); }
  }
  async function onFavoriteToggle(entry: PaletteEntry, next: boolean) {
    setEntries((prev) => prev.map((e) => (e.id === entry.id ? { ...e, favorited: next } : e)));
    try {
      await patchPaletteEntry(entry.id, { favorited: next });
    } catch (e) {
      setError((e as Error).message);
      setEntries((prev) => prev.map((x) => (x.id === entry.id ? { ...x, favorited: !next } : x)));
    }
  }
  async function onCopy(entry: PaletteEntry, toMaterialId: number) {
    try {
      await createManualPaletteEntry({
        material_id: toMaterialId,
        hex: entry.hex,
        params: entry.params,
        notes: entry.notes,
      });
      await refresh();
    } catch (e) { setError((e as Error).message); }
  }

  const byMaterial: Record<number, PaletteEntry[]> = {};
  entries.forEach((e) => { (byMaterial[e.material_id] ??= []).push(e); });
  const matIds = Object.keys(byMaterial).map(Number);

  const infoEntry = useMemo(
    () => (infoId !== null ? entries.find((e) => e.id === infoId) ?? null : null),
    [infoId, entries],
  );

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <MaterialSelect
          materials={materials}
          value={materialId}
          onChange={setMaterialId}
          label="Material"
        />
        <div className="text-[12.5px] text-[color:var(--color-ink-muted)]">
          {entries.length} {entries.length === 1 ? "manual swatch" : "manual swatches"}
        </div>
        <div className="ml-auto">
          <Button
            variant="primary"
            onClick={() => { setEditing(null); setDialogOpen(true); }}
          >
            <Plus className="h-4 w-4" />
            Add manual entry
          </Button>
        </div>
      </div>
      {error && <p className="text-[13px] text-[color:var(--color-destructive)]">{error}</p>}
      {entries.length === 0 && !error && (
        <EmptyState
          title="No manual entries yet"
          description={materialId
            ? "Click + to capture a recipe you've dialled in by hand."
            : "Pick a material above, then click + to add a manual swatch."}
        />
      )}
      {matIds.map((mid) => {
        const group = byMaterial[mid];
        const materialName = materials.find((m) => m.id === mid)?.name ?? "(unknown)";
        return (
          <Section
            key={mid}
            title={
              <span className="flex items-baseline gap-2">
                <span>{materialName}</span>
                <Badge variant="info" size="sm">{group.length}</Badge>
              </span>
            }
          >
            <div className="grid grid-cols-[repeat(auto-fill,minmax(112px,1fr))] gap-2.5">
              {group.map((e) => (
                <EntryCard
                  key={e.id}
                  entry={e}
                  materials={materials}
                  onDelete={() => onDelete(e.id)}
                  onInfo={() => setInfoId(e.id)}
                  onEdit={(en) => { setEditing(en); setDialogOpen(true); }}
                  onCopy={(en, toId) => void onCopy(en, toId)}
                  onFavoriteToggle={(entry, next) => void onFavoriteToggle(entry, next)}
                />
              ))}
            </div>
          </Section>
        );
      })}

      <PaletteEntryDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        materials={materials}
        entry={editing}
        defaultMaterialId={materialId || undefined}
        onSaved={() => { void refresh(); }}
      />

      <Dialog open={infoEntry !== null} onOpenChange={(o) => !o && setInfoId(null)}>
        {infoEntry && (
          <InfoModalContent entry={infoEntry} materials={materials} />
        )}
      </Dialog>
    </div>
  );
}
```

- [ ] **Step 6: Add `FavoritesView`**

Append below `ManualView`:

```tsx
function FavoritesView({ materials }: { materials: Material[] }) {
  const [entries, setEntries] = useState<PaletteEntry[]>([]);
  const [materialId, setMaterialId] = useState<string>("");
  const [error, setError] = useState<string | undefined>();
  const [infoId, setInfoId] = useState<number | null>(null);

  async function refresh() {
    setError(undefined);
    try {
      setEntries(await listPaletteEntries({
        material_id: materialId ? Number(materialId) : undefined,
        favorites_only: true,
      }));
    } catch (e) { setError((e as Error).message); }
  }
  useEffect(() => { void refresh(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [materialId]);

  async function onUnfavorite(entry: PaletteEntry) {
    setEntries((prev) => prev.filter((e) => e.id !== entry.id));
    try {
      await patchPaletteEntry(entry.id, { favorited: false });
    } catch (e) {
      setError((e as Error).message);
      await refresh();
    }
  }
  async function onDelete(id: number) {
    if (!confirm("Delete this swatch?")) return;
    try {
      await deletePaletteEntry(id);
      await refresh();
    } catch (e) { setError((e as Error).message); }
  }

  const byMaterial: Record<number, PaletteEntry[]> = {};
  entries.forEach((e) => { (byMaterial[e.material_id] ??= []).push(e); });
  const matIds = Object.keys(byMaterial).map(Number);

  const infoEntry = useMemo(
    () => (infoId !== null ? entries.find((e) => e.id === infoId) ?? null : null),
    [infoId, entries],
  );

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <MaterialSelect
          materials={materials}
          value={materialId}
          onChange={setMaterialId}
          label="Material"
        />
        <div className="text-[12.5px] text-[color:var(--color-ink-muted)]">
          {entries.length} {entries.length === 1 ? "favorite" : "favorites"}
        </div>
      </div>
      {error && <p className="text-[13px] text-[color:var(--color-destructive)]">{error}</p>}
      {entries.length === 0 && !error && (
        <EmptyState
          title="No favorites yet"
          description="Click the star on any swatch (Browse, Manual, or the SVG matcher) to pin it here."
        />
      )}
      {matIds.map((mid) => {
        const group = byMaterial[mid];
        const materialName = materials.find((m) => m.id === mid)?.name ?? "(unknown)";
        return (
          <Section
            key={mid}
            title={
              <span className="flex items-baseline gap-2">
                <span>{materialName}</span>
                <Badge variant="info" size="sm">{group.length}</Badge>
              </span>
            }
          >
            <div className="grid grid-cols-[repeat(auto-fill,minmax(112px,1fr))] gap-2.5">
              {group.map((e) => (
                <EntryCard
                  key={e.id}
                  entry={e}
                  materials={materials}
                  onDelete={() => onDelete(e.id)}
                  onInfo={() => setInfoId(e.id)}
                  onFavoriteToggle={(entry, next) => {
                    if (!next) void onUnfavorite(entry);
                  }}
                />
              ))}
            </div>
          </Section>
        );
      })}

      <Dialog open={infoEntry !== null} onOpenChange={(o) => !o && setInfoId(null)}>
        {infoEntry && (
          <InfoModalContent entry={infoEntry} materials={materials} />
        )}
      </Dialog>
    </div>
  );
}
```

- [ ] **Step 7: Build the frontend**

Run: `cd web && npm run build > /dev/null 2>&1 && echo OK`
Expected: prints `OK` (build succeeded). If not, drop the `> /dev/null 2>&1` to see errors.

- [ ] **Step 8: Typecheck + unit tests**

Run: `cd web && npx tsc --noEmit && npm test`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add web/src/components/PalettePage.tsx
git commit -m "web: PalettePage — Manual + Favorites tabs, star + edit/copy"
```

---

## Task 16: SVG matcher — `MAN` badge + star toggle on match cards

**Files:**
- Modify: `web/src/components/SvgLayersPage.tsx:1296-1472`

- [ ] **Step 1: Add the badge + star to the match-card grid**

In `web/src/components/SvgLayersPage.tsx`, find the match-card grid inside `PaletteMatchSection` (the `results.map((r) => { … })` rendering swatch buttons, currently around line 1406). Replace just the contents of the `<button>` (after the opening tag, before its closing `</button>`) with:

```tsx
                      <div
                        className="aspect-[4/3] w-full relative"
                        style={{ background: r.entry.hex }}
                      >
                        {r.entry.source === "manual" && (
                          <span className="absolute top-1 left-1 px-1 py-0.5 rounded-[3px] text-[8px] font-mono font-semibold tracking-[0.08em] uppercase bg-[color:var(--color-accent,#caa14b)] text-black/85">
                            MAN
                          </span>
                        )}
                        <StarToggle
                          favorited={r.entry.favorited}
                          onChange={(next) => onFavoriteToggle(r.entry, next)}
                          className="absolute top-0.5 right-0.5"
                        />
                      </div>
                      <div
                        className={cn(
                          "px-1.5 py-1 border-t leading-tight",
                          isActive
                            ? "bg-[color:var(--color-primary-tint)] border-[color:var(--color-primary)]/30"
                            : "bg-[color:var(--color-surface)] border-[color:var(--color-border)]",
                        )}
                      >
                        <div className="font-mono text-[10px] text-[color:var(--color-ink)] truncate">
                          {r.entry.hex}
                        </div>
                        <div className="flex items-center justify-between mt-0.5">
                          <span className="font-mono text-[9.5px] text-[color:var(--color-ink-subtle)]">
                            ΔE {r.delta_e.toFixed(1)}
                          </span>
                          <span
                            aria-hidden="true"
                            title={`${laser} laser`}
                            className={cn(
                              "h-1.5 w-1.5 rounded-full shrink-0",
                              laser === "blue"
                                ? "bg-[color:var(--color-secondary)]"
                                : "bg-[color:var(--color-primary)]",
                            )}
                          />
                        </div>
                      </div>
```

- [ ] **Step 2: Wire the favorite-toggle handler**

Inside `PaletteMatchSection`, just below the `useEffect` that fetches results, add:

```tsx
  async function onFavoriteToggle(entry: PaletteEntry, next: boolean) {
    setResults((prev) =>
      prev.map((r) =>
        r.entry.id === entry.id
          ? { ...r, entry: { ...r.entry, favorited: next } }
          : r,
      ),
    );
    try {
      await patchPaletteEntry(entry.id, { favorited: next });
    } catch {
      // rollback
      setResults((prev) =>
        prev.map((r) =>
          r.entry.id === entry.id
            ? { ...r, entry: { ...r.entry, favorited: !next } }
            : r,
        ),
      );
    }
  }
```

- [ ] **Step 3: Add the imports**

At the top of `web/src/components/SvgLayersPage.tsx`, extend the existing palette-API import:

```tsx
import { listPaletteEntries, queryPalette, patchPaletteEntry } from "../api/palette";
```

And add the `StarToggle` import:

```tsx
import { StarToggle } from "./StarToggle";
```

- [ ] **Step 4: Build**

Run: `cd web && npm run build > /dev/null 2>&1 && echo OK`
Expected: `OK`.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/SvgLayersPage.tsx
git commit -m "web: matcher — MAN badge + star on match cards"
```

---

## Task 17: SVG matcher — `PaletteFavoritesRow` subcomponent

**Files:**
- Modify: `web/src/components/SvgLayersPage.tsx`

- [ ] **Step 1: Create the `PaletteFavoritesRow` subcomponent**

In `web/src/components/SvgLayersPage.tsx`, append after `PaletteMatchSection` (just before `SwatchBox` at the end):

```tsx
function PaletteFavoritesRow({
  layerColor,
  materialId,
  selectedId,
  onSelect,
  onApply,
  onFavoriteToggle,
  refreshKey,
}: {
  layerColor: string;
  materialId: string;
  selectedId: string;
  onSelect: (entryId: number) => void;
  onApply: (params: Partial<BaseParams>, predictedHex: string) => void;
  onFavoriteToggle: (entry: PaletteEntry, next: boolean) => void;
  refreshKey: number;
}) {
  const [favorites, setFavorites] = useState<PaletteEntry[]>([]);
  const [page, setPage] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const CHIP_WIDTH = 90; // matches the suggested-grid chip footprint + gap

  useEffect(() => {
    if (!materialId) {
      setFavorites([]);
      return;
    }
    let cancelled = false;
    listPaletteEntries({
      material_id: Number(materialId), favorites_only: true,
    })
      .then((es) => { if (!cancelled) setFavorites(es); })
      .catch(() => { if (!cancelled) setFavorites([]); });
    return () => { cancelled = true; };
  }, [materialId, refreshKey]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) setContainerWidth(e.contentRect.width);
    });
    ro.observe(el);
    setContainerWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const sorted = useMemo(() => {
    if (!/^#[0-9a-fA-F]{6}$/.test(layerColor)) return favorites;
    const target = hexToLab(layerColor);
    return [...favorites].sort((a, b) => {
      const la = a.lab.length >= 3 ? ([a.lab[0], a.lab[1], a.lab[2]] as Lab) : hexToLab(a.hex);
      const lb = b.lab.length >= 3 ? ([b.lab[0], b.lab[1], b.lab[2]] as Lab) : hexToLab(b.hex);
      return deltaE2000(target, la) - deltaE2000(target, lb);
    });
  }, [favorites, layerColor]);

  const pager = computePager({
    totalCount: sorted.length,
    containerWidth: Math.max(0, containerWidth - 80), // reserve room for prev/next + label
    chipWidth: CHIP_WIDTH,
    page,
  });

  if (favorites.length === 0) return null;

  const slice = sorted.slice(pager.start, pager.end);

  return (
    <div ref={containerRef} className="mt-3">
      <div className="flex items-baseline justify-between mb-1.5">
        <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[color:var(--color-ink-subtle)]">
          ★ Favorites
        </span>
        {pager.totalPages > 1 && (
          <div className="flex items-center gap-1.5 text-[10.5px] text-[color:var(--color-ink-subtle)]">
            <button
              type="button"
              onClick={() => setPage(Math.max(0, pager.page - 1))}
              disabled={pager.page === 0}
              className="px-1.5 py-0.5 rounded border border-[color:var(--color-border)] disabled:opacity-30"
              aria-label="Previous favorites"
            >‹</button>
            <span>{pager.page + 1} / {pager.totalPages}</span>
            <button
              type="button"
              onClick={() => setPage(Math.min(pager.totalPages - 1, pager.page + 1))}
              disabled={pager.page >= pager.totalPages - 1}
              className="px-1.5 py-0.5 rounded border border-[color:var(--color-border)] disabled:opacity-30"
              aria-label="Next favorites"
            >›</button>
          </div>
        )}
      </div>
      <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${pager.pageSize}, minmax(0, 1fr))` }}>
        {slice.map((entry) => {
          const target = /^#[0-9a-fA-F]{6}$/.test(layerColor) ? hexToLab(layerColor) : null;
          const lab = entry.lab.length >= 3
            ? ([entry.lab[0], entry.lab[1], entry.lab[2]] as Lab)
            : hexToLab(entry.hex);
          const dE = target ? deltaE2000(target, lab) : 0;
          const laser = String(entry.params["laser"] ?? "red");
          const isActive = String(entry.id) === selectedId;
          return (
            <button
              key={entry.id}
              type="button"
              onClick={() => {
                onSelect(entry.id);
                onApply(paletteParamsToBaseParams(entry.params), entry.hex);
              }}
              aria-pressed={isActive}
              title={`ΔE ${dE.toFixed(2)} · ${entry.params.power}% · ${entry.params.speed} mm/s · ${laser}`}
              className={cn(
                "group relative rounded-[6px] overflow-hidden border text-left transition-all",
                "focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-primary)]/50",
                isActive
                  ? "border-[color:var(--color-primary)] shadow-[0_0_0_1px_var(--color-primary)_inset]"
                  : "border-[color:var(--color-border)] hover:border-[color:var(--color-border-strong)]",
              )}
            >
              <div className="aspect-[4/3] w-full relative" style={{ background: entry.hex }}>
                {entry.source === "manual" && (
                  <span className="absolute top-1 left-1 px-1 py-0.5 rounded-[3px] text-[8px] font-mono font-semibold tracking-[0.08em] uppercase bg-[color:var(--color-accent,#caa14b)] text-black/85">
                    MAN
                  </span>
                )}
                <StarToggle
                  favorited={entry.favorited}
                  onChange={(next) => onFavoriteToggle(entry, next)}
                  className="absolute top-0.5 right-0.5"
                />
              </div>
              <div className={cn(
                "px-1.5 py-1 border-t leading-tight",
                isActive
                  ? "bg-[color:var(--color-primary-tint)] border-[color:var(--color-primary)]/30"
                  : "bg-[color:var(--color-surface)] border-[color:var(--color-border)]",
              )}>
                <div className="font-mono text-[10px] text-[color:var(--color-ink)] truncate">{entry.hex}</div>
                <div className="flex items-center justify-between mt-0.5">
                  <span className="font-mono text-[9.5px] text-[color:var(--color-ink-subtle)]">
                    ΔE {dE.toFixed(1)}
                  </span>
                  <span
                    aria-hidden="true"
                    className={cn(
                      "h-1.5 w-1.5 rounded-full shrink-0",
                      laser === "blue"
                        ? "bg-[color:var(--color-secondary)]"
                        : "bg-[color:var(--color-primary)]",
                    )}
                  />
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add the missing imports**

At the top of `web/src/components/SvgLayersPage.tsx`, ensure these are present:

```tsx
import { useEffect, useMemo, useRef, useState } from "react";
// (already includes useRef — no change needed)
```

Add (alongside the existing color-math import):

```tsx
import { computePager } from "../svg/favoritesPager";
```

- [ ] **Step 3: Mount the row inside `PaletteMatchSection`**

Inside `PaletteMatchSection`'s return JSX, after the closing `</div>` of the matches-grid section but before the final `</div>` and `</Card>`, add:

```tsx
        <PaletteFavoritesRow
          layerColor={layerColor}
          materialId={materialId}
          selectedId={selectedId}
          onSelect={(id) => setSelectedId(String(id))}
          onApply={onApply}
          onFavoriteToggle={onFavoriteToggle}
          refreshKey={results.length}
        />
```

- [ ] **Step 4: Build**

Run: `cd web && npm run build > /dev/null 2>&1 && echo OK`
Expected: `OK`.

- [ ] **Step 5: Run frontend tests + typecheck**

Run: `cd web && npx tsc --noEmit && npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add web/src/components/SvgLayersPage.tsx
git commit -m "web: matcher — favorites row with auto-fit pagination"
```

---

## Task 18: Manual Playwright walkthrough

**Files:** none modified — exploratory verification before changelog.

- [ ] **Step 1: Start the backend dev server**

Run: `uv run --active xcs-gen serve --host 127.0.0.1 --port 8017 &`
(Alternatively, run in another terminal so the server stays attached.)

- [ ] **Step 2: Confirm the build is current**

Run: `cd web && npm run build > /dev/null 2>&1 && echo OK`
Expected: `OK`.

- [ ] **Step 3: Use the Playwright MCP to walk through the four scenarios from the spec**

Drive the browser through these flows and verify each works:

1. `#/palette` → Manual tab → click `+ Add manual entry` → fill the form → Save → swatch appears in Manual + Browse tabs.
2. Browse tab → click ☆ on any swatch → Favorites tab shows it grouped under its material. Click ★ → it disappears.
3. `#/svg` → upload `samples/Pikachu2.xcs`-like SVG (or any multi-color file) → pick a material that has a manual entry and at least one favorite for that material:
   - The Suggested grid shows the manual swatch with a `MAN` badge.
   - The `★ Favorites` row renders below, sorted closest-first.
   - Resize the window — favorites row reflows pages.
   - Click a favorite — Apply button picks it up and the layer's params populate.
4. Palette → Manual → on a manual swatch, click the copy-to-material icon → pick a different material → confirm. The Manual tab now shows the copy under the new material.

- [ ] **Step 4: If a regression surfaces, return to the relevant Task and fix; otherwise note any small UI tweaks**

Common follow-ups: hex picker styling on dark theme, dialog scroll on small screens, MAN badge contrast on light hexes. Make tiny edits in place and re-run `npm run build`.

- [ ] **Step 5: No commit — this is verification, not a change**

If you made polish edits during step 4, commit them as `web: matcher polish from manual walkthrough`.

---

## Task 19: Changelog entry

**Files:**
- Create: `changelog/2026-04-25-palette-manual-favorites.md`
- Create: `changelog/images/palette-manual-favorites.png` (1–2 screenshots from the manual walkthrough)

- [ ] **Step 1: Capture screenshots**

Either via Playwright MCP screenshot or the OS shortcut. Aim for two:
1. The Palette page Manual tab with one or two manual entries visible (`palette-manual-favorites.png`).
2. The SVG matcher with the favorites row visible (`palette-favorites-row.png`).

Save both into `changelog/images/`.

- [ ] **Step 2: Write the entry**

Create `changelog/2026-04-25-palette-manual-favorites.md`:

```markdown
---
id: 2026-04-25-palette-manual-favorites
date: 2026-04-25
level: major
title: Palette — manual swatches + favorites
summary: Hand-author swatches for recipes you've already dialled in. Star any swatch to keep it on hand; the SVG matcher surfaces your favorites in their own row.
images:
  - src: palette-manual-favorites.png
    caption: The Manual tab — typed hex + a recipe, ready to be matched against.
  - src: palette-favorites-row.png
    caption: Favorites flow into the SVG matcher as a paginated row, sorted closest-first.
---

The palette grew up. Until now every swatch came from a burned test — fine
when you're still mapping a material, less fine when you already know that
"#a76c2f at 38% / 1100 / 25 ns" is the recipe you reach for.

**Manual swatches.** A new Manual tab on the Palette page. Click `+`, type a
hex, dial in the params, save. The entry sits in the same table as ingested
swatches and rides the same matcher — manual rows are marked with a small
`MAN` badge so provenance stays honest.

**Favorites.** Every swatch (manual or ingested) now has a star in the corner.
Star one and it pins to the new Favorites tab. On the SVG matcher, your
favorites for the current material show up in their own row underneath the
top-N matches, sorted closest-first to whatever colour you're matching, with
auto-fit pagination when you have more than fit on a row.

**Copy to material.** Manual entries can be copied across materials from
their card menu — handy when the same recipe lives on adjacent substrates.
```

- [ ] **Step 3: Verify the changelog page picks it up**

Run: `cd web && npm run build > /dev/null 2>&1 && echo OK`
Restart the dev server (`uv run --active xcs-gen serve`) and visit `#/changelog`. The new entry should be at the top with the NEW badge.

- [ ] **Step 4: Commit**

```bash
git add changelog/2026-04-25-palette-manual-favorites.md changelog/images/palette-manual-favorites.png changelog/images/palette-favorites-row.png
git commit -m "changelog: palette manual + favorites"
```

- [ ] **Step 5: Push the branch and open a draft PR**

```bash
git push -u origin feat/palette-manual-favorites  # or current branch name
gh pr create --draft --title "Palette: manual entries + favorites" --body "$(cat <<'EOF'
## Summary
- Manual swatches: hand-author a hex + recipe; full first-class palette entry.
- Favorites: star any swatch; new Favorites tab + a dedicated row on the SVG matcher.
- One unified `palette_entries` table; alembic 0008.

Spec: docs/superpowers/specs/2026-04-25-palette-manual-favorites-design.md
Plan: docs/superpowers/plans/2026-04-25-palette-manual-favorites.md

## Test plan
- [ ] `uv run --active pytest tests/ -q` (backend)
- [ ] `cd web && npx tsc --noEmit && npm test` (frontend types + units)
- [ ] Manual Playwright walkthrough (Task 18)
EOF
)"
```

Once CI is green, flip to ready: `gh pr ready`.

---

## Self-review notes

- **Spec coverage:** every section of the spec maps to a task — migration (1), models (2), repo (3–6), schemas (7), API (8–9), types/api-client (10–11), UI primitives (12–13), modal (14), Palette page (15), matcher (16–17), QA (18), rollout (19).
- **Type consistency:** `update_entry` (repo, Task 5) is invoked from `palette_patch` (route, Task 9); `set_favorited` (Task 6) is invoked from the same route; `createManualPaletteEntry` (Task 11) is consumed by `PaletteEntryDialog` (Task 14) and the copy-to-material flow (Task 15).
- **No placeholders.** Every step has either exact code or an exact command + expected output.
- **Frequent commits.** Each task ends with a commit; Task 15 is the only one that bundles a larger UI change behind a single commit, intentionally.
