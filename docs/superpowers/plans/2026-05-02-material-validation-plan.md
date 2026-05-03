# Material Palette Validation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `kind=validation` test type that lets users burn a representative subset of an existing material palette and see per-cell ΔE76 against the stored Lab values.

**Architecture:** New `kind` column on `tests` (defaults to `'sweep'`), plus a normalised `validation_cells` table that stores per-test, per-cell snapshots (palette FK + expected Lab + params JSON). The `xcs_gen_web.services.xcs` builder branches on `kind`: for validation it iterates `validation_cells` instead of computing the sweep grid. Frontend ships a new `palette` tab in `ParamTestEditor` with a picker (already drafted in `MaterialPalettePicker.tsx`) and augments `ResultDetailDialog` with paired measured/expected tiles. ΔE is computed at render time on the frontend — no need to persist it.

**Tech Stack:** SQLite/MySQL via SQLAlchemy + Alembic, FastAPI on the backend; React + Tailwind v4 + Radix on the frontend; pytest for backend tests, vitest for frontend, Playwright MCP for end-to-end smoke.

---

## File Structure

### Backend (Python, `src/xcs_gen_web/`)
- **Modify** `models.py` — add `kind` column to `tests`, create `validation_cells` table
- **Create** `alembic/versions/0042_validation_kind.py` — autogen migration; revision `0042` for the CI hardcoded assertion
- **Create** `repositories/validation_cells.py` — CRUD for `validation_cells` rows
- **Modify** `repositories/tests.py` — kind-aware create/update; carry `validation_cells` in/out
- **Modify** `services/xcs.py` — branch on `kind` in `build_xcs_from_test`
- **Modify** `app.py` — expose `kind` + `validation_cells` on test endpoints; new POST endpoint to materialise cells from a palette pick

### Backend tests (`tests/`)
- **Create** `tests/test_validation_cells_repo.py`
- **Create** `tests/test_xcs_validation_kind.py`
- **Create** `tests/test_validation_endpoints.py`

### Frontend (TypeScript, `web/src/`)
- **Create** `svg/colorSelection.ts` — pure FPS + ΔE76 (extracted from `MaterialPalettePicker.tsx`)
- **Create** `svg/colorSelection.test.ts`
- **Modify** `types.ts` — `kind`, `ValidationCell`, swatch fields
- **Modify** `api/tests.ts` — surface `validation_cells` on test record
- **Create** `api/validationCells.ts` — auto-pick endpoint client
- **Modify** `components/MaterialPalettePicker.tsx` — re-import helpers from `colorSelection.ts` instead of defining them in-file
- **Modify** `components/ParamTestEditor.tsx` — `kind`-aware tab list; render picker for validation
- **Modify** `pages/TestsPage.tsx` — "New test" → choose kind first
- **Modify** `pages/TestDetailPage.tsx` — surface `kind` badge
- **Modify** `components/ResultDetailDialog.tsx` — kind-aware paired tiles + summary strip

### Misc
- **Modify** `.github/workflows/ci.yml` — bump alembic revision assertion to `0042`
- **Create** `changelog/2026-05-02-material-validation.md`

---

## Task 1: Schema — `tests.kind` column + `validation_cells` table

**Files:**
- Modify: `src/xcs_gen_web/models.py:131-155` (tests table) and append a new `validation_cells` table

- [ ] **Step 1: Read the current `tests` table definition**

```bash
cd /Users/jonzky/Documents/XTools/Reverse/.worktrees/material-validation
grep -n "tests = Table\|palette_entries = Table" src/xcs_gen_web/models.py
```

Expected: line numbers for `tests` (~131) and `palette_entries` (~192).

- [ ] **Step 2: Add the `kind` column to `tests`**

Open `src/xcs_gen_web/models.py`. Inside the `tests = Table(...)` block, AFTER the `machine_id` column and BEFORE the first `CheckConstraint`, add:

```python
    Column(
        "kind", String(_STATUS_LEN), nullable=False, server_default="sweep",
    ),
```

Then add a new constraint immediately after the existing `tests_status_chk` constraint:

```python
    CheckConstraint("kind IN ('sweep','validation')", name="tests_kind_chk"),
```

- [ ] **Step 3: Append the `validation_cells` table**

After the `palette_entries = Table(...)` block (find it around line 192-225 — search for "ix_palette_entries_owner" to find its end), append:

```python
# One row per planned cell on a kind=validation test. Frozen at test-
# create time from the user's palette pick: each cell carries its
# source palette_entry_id (nullable for "manual" — we set ON DELETE
# SET NULL so removing a palette entry doesn't kill validation
# history), the Lab the burn is supposed to reproduce, and the param
# bundle the xcs builder will write into the cell's job. Order on
# the burn surface is `cell_index` ascending (sorted by L* at insert
# time so the burn forms a luminance ramp).
validation_cells = Table(
    "validation_cells", metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("test_id", Integer, ForeignKey("tests.id"), nullable=False),
    Column("cell_index", Integer, nullable=False),
    Column(
        "palette_entry_id",
        Integer,
        ForeignKey("palette_entries.id", ondelete="SET NULL"),
        nullable=True,
    ),
    Column("expected_hex", String(_COLOR_HEX_LEN), nullable=False),
    Column("expected_lab_l", Float, nullable=False),
    Column("expected_lab_a", Float, nullable=False),
    Column("expected_lab_b", Float, nullable=False),
    Column("params_json", Text, nullable=False),
    Index("ix_validation_cells_test_id", "test_id"),
    Index("ix_validation_cells_palette_entry_id", "palette_entry_id"),
)
```

- [ ] **Step 4: Verify model parse**

```bash
cd /Users/jonzky/Documents/XTools/Reverse/.worktrees/material-validation
uv run --active python -c "from xcs_gen_web.models import metadata, tests, validation_cells; print(sorted(t.name for t in metadata.tables.values()))"
```

Expected: includes `tests` and `validation_cells`. No traceback.

- [ ] **Step 5: Commit**

```bash
git add src/xcs_gen_web/models.py
git commit -m "feat(models): add tests.kind + validation_cells table"
```

---

## Task 2: Alembic migration + CI version bump

**Files:**
- Create: `alembic/versions/0042_validation_kind.py`
- Modify: `.github/workflows/ci.yml` (the `mysql-migration-test` job's hardcoded version assertion)

- [ ] **Step 1: Find the latest alembic revision number**

```bash
cd /Users/jonzky/Documents/XTools/Reverse/.worktrees/material-validation
ls alembic/versions/ | sort | tail -3
```

Expected: highest existing revision (likely `0041_*.py`). Confirm by reading it: `cat alembic/versions/0041_*.py | head -10`.

- [ ] **Step 2: Generate the migration**

```bash
cd /Users/jonzky/Documents/XTools/Reverse/.worktrees/material-validation
uv run --active alembic revision --autogenerate -m "validation_kind" --rev-id=0042
```

Expected: writes `alembic/versions/0042_validation_kind.py`.

- [ ] **Step 3: Inspect the migration**

```bash
cat alembic/versions/0042_validation_kind.py
```

Verify it contains:
- `op.add_column('tests', sa.Column('kind', sa.String(...), server_default='sweep', nullable=False))`
- A `tests_kind_chk` check constraint creation
- `op.create_table('validation_cells', ...)` with the columns from Task 1
- The two indexes

If the autogenerator emitted spurious diffs (e.g. `server_default` shenanigans on existing columns), edit the file to remove them — keep only the four listed changes.

- [ ] **Step 4: Run the migration locally**

```bash
cd /Users/jonzky/Documents/XTools/Reverse/.worktrees/material-validation
uv run --active alembic upgrade head
```

Expected: `INFO [alembic.runtime.migration] Running upgrade 0041_xxx -> 0042_validation_kind`.

- [ ] **Step 5: Verify schema**

```bash
sqlite3 ~/.xcs-gen/app.db ".schema tests" | head -5
sqlite3 ~/.xcs-gen/app.db ".schema validation_cells"
```

Expected: `tests` schema includes `kind TEXT NOT NULL DEFAULT 'sweep'`; `validation_cells` schema matches the model.

- [ ] **Step 6: Bump CI assertion**

Open `.github/workflows/ci.yml`. Search for `mysql-migration-test` and find the `test "$VER" =` line. Update:

```yaml
        # Replace the existing line:
        #   test "$VER" = "0041_xxx" || (echo "alembic version mismatch" && exit 1)
        # with:
            test "$VER" = "0042_validation_kind" || (echo "alembic version mismatch" && exit 1)
```

(Use the exact filename of the migration file as `$VER` — including the descriptive suffix that alembic appended.)

- [ ] **Step 7: Commit**

```bash
git add alembic/versions/0042_validation_kind.py .github/workflows/ci.yml
git commit -m "feat(db): migration for validation kind + CI version bump"
```

---

## Task 3: `validation_cells` repository

**Files:**
- Create: `src/xcs_gen_web/repositories/validation_cells.py`
- Create: `tests/test_validation_cells_repo.py`

- [ ] **Step 1: Write the failing test**

Create `tests/test_validation_cells_repo.py`:

```python
"""Validation-cells repo: insert a batch keyed to a test, fetch back
ordered by cell_index, replace on update, cascade-clear on test delete."""
from __future__ import annotations

import json

import pytest

from xcs_gen_web.db import SessionLocal, engine, metadata
from xcs_gen_web.repositories import validation_cells as vc_repo


@pytest.fixture(autouse=True)
def _schema():
    metadata.create_all(bind=engine)
    yield
    metadata.drop_all(bind=engine)


def _make_test(material_id: int = 1, owner_id: int = 1) -> int:
    from xcs_gen_web.models import tests
    from sqlalchemy import insert
    from datetime import datetime, timezone

    now = datetime.now(timezone.utc).isoformat()
    with SessionLocal.begin() as s:
        result = s.execute(
            insert(tests).values(
                name="V", material_id=material_id, status="created",
                spec_json="{}", notes="", created_at=now, updated_at=now,
                owner_id=owner_id, kind="validation",
            ),
        )
        return int(result.inserted_primary_key[0])


def test_replace_for_test_keeps_order():
    tid = _make_test()
    rows = [
        {
            "cell_index": i,
            "palette_entry_id": None,
            "expected_hex": f"#{i:02x}0000",
            "expected_lab": [50.0 + i, 0.0, 0.0],
            "params": {"power": 10, "speed": 1000},
        }
        for i in range(3)
    ]
    vc_repo.replace_for_test(test_id=tid, cells=rows)

    fetched = vc_repo.list_for_test(test_id=tid)
    assert [c["cell_index"] for c in fetched] == [0, 1, 2]
    assert fetched[0]["expected_hex"] == "#000000"
    assert fetched[2]["expected_lab"] == [52.0, 0.0, 0.0]
    assert fetched[1]["params"] == {"power": 10, "speed": 1000}


def test_replace_overwrites_previous():
    tid = _make_test()
    vc_repo.replace_for_test(test_id=tid, cells=[
        {"cell_index": 0, "palette_entry_id": None, "expected_hex": "#abc",
         "expected_lab": [50.0, 0.0, 0.0], "params": {}},
    ])
    vc_repo.replace_for_test(test_id=tid, cells=[
        {"cell_index": 0, "palette_entry_id": None, "expected_hex": "#cba",
         "expected_lab": [60.0, 0.0, 0.0], "params": {}},
        {"cell_index": 1, "palette_entry_id": None, "expected_hex": "#def",
         "expected_lab": [70.0, 0.0, 0.0], "params": {}},
    ])
    fetched = vc_repo.list_for_test(test_id=tid)
    assert len(fetched) == 2
    assert fetched[0]["expected_hex"] == "#cba"


def test_delete_for_test():
    tid = _make_test()
    vc_repo.replace_for_test(test_id=tid, cells=[
        {"cell_index": 0, "palette_entry_id": None, "expected_hex": "#000",
         "expected_lab": [50.0, 0.0, 0.0], "params": {}},
    ])
    vc_repo.delete_for_test(test_id=tid)
    assert vc_repo.list_for_test(test_id=tid) == []
```

- [ ] **Step 2: Run the test, confirm it fails**

```bash
cd /Users/jonzky/Documents/XTools/Reverse/.worktrees/material-validation
uv run --active pytest tests/test_validation_cells_repo.py -v
```

Expected: `ModuleNotFoundError: No module named 'xcs_gen_web.repositories.validation_cells'`.

- [ ] **Step 3: Implement the repository**

Create `src/xcs_gen_web/repositories/validation_cells.py`:

```python
"""Repository for validation_cells — frozen per-cell snapshots used by
kind=validation tests.

Read shape (returned by ``list_for_test``):
    [{
        "id": int,
        "test_id": int,
        "cell_index": int,
        "palette_entry_id": int | None,
        "expected_hex": str,
        "expected_lab": [L*, a*, b*],
        "params": {param_name: value, ...},
    }, ...]

Write shape (accepted by ``replace_for_test``):
    [{
        "cell_index": int,
        "palette_entry_id": int | None,
        "expected_hex": str,
        "expected_lab": [L*, a*, b*],
        "params": {param_name: value, ...},
    }, ...]
"""
from __future__ import annotations

import json
from typing import Any, Iterable

from sqlalchemy import delete, insert, select

from ..db import SessionLocal
from ..models import validation_cells


def _row_to_dict(r) -> dict[str, Any]:
    return {
        "id": r.id,
        "test_id": r.test_id,
        "cell_index": r.cell_index,
        "palette_entry_id": r.palette_entry_id,
        "expected_hex": r.expected_hex,
        "expected_lab": [r.expected_lab_l, r.expected_lab_a, r.expected_lab_b],
        "params": json.loads(r.params_json),
    }


def list_for_test(*, test_id: int) -> list[dict[str, Any]]:
    with SessionLocal() as s:
        rows = s.execute(
            select(validation_cells)
            .where(validation_cells.c.test_id == test_id)
            .order_by(validation_cells.c.cell_index.asc()),
        ).all()
    return [_row_to_dict(r) for r in rows]


def replace_for_test(*, test_id: int, cells: Iterable[dict[str, Any]]) -> None:
    """Atomic replace — wipes existing cells and inserts the new batch."""
    payload = [
        {
            "test_id": test_id,
            "cell_index": int(c["cell_index"]),
            "palette_entry_id": c.get("palette_entry_id"),
            "expected_hex": c["expected_hex"],
            "expected_lab_l": float(c["expected_lab"][0]),
            "expected_lab_a": float(c["expected_lab"][1]),
            "expected_lab_b": float(c["expected_lab"][2]),
            "params_json": json.dumps(c.get("params", {})),
        }
        for c in cells
    ]
    with SessionLocal.begin() as s:
        s.execute(
            delete(validation_cells).where(validation_cells.c.test_id == test_id),
        )
        if payload:
            s.execute(insert(validation_cells), payload)


def delete_for_test(*, test_id: int) -> None:
    with SessionLocal.begin() as s:
        s.execute(
            delete(validation_cells).where(validation_cells.c.test_id == test_id),
        )
```

- [ ] **Step 4: Run the tests, verify they pass**

```bash
cd /Users/jonzky/Documents/XTools/Reverse/.worktrees/material-validation
uv run --active pytest tests/test_validation_cells_repo.py -v
```

Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/xcs_gen_web/repositories/validation_cells.py tests/test_validation_cells_repo.py
git commit -m "feat(repo): validation_cells repository"
```

---

## Task 4: `tests` repository — surface `kind` and validation cells

**Files:**
- Modify: `src/xcs_gen_web/repositories/tests.py`

- [ ] **Step 1: Locate the read shape**

```bash
cd /Users/jonzky/Documents/XTools/Reverse/.worktrees/material-validation
grep -nE "_row_to_dict|kind" src/xcs_gen_web/repositories/tests.py | head -10
```

Find the `_row_to_dict` (or equivalent) helper that converts a `tests` row into the dict the API returns.

- [ ] **Step 2: Add `kind` to the read shape**

Inside that helper, add `"kind": r.kind` to the returned dict. The exact line is alongside the other `r.<col>` field reads.

- [ ] **Step 3: Add `validation_cells` to the read shape**

Still inside the same helper, append:

```python
    if r.kind == "validation":
        from . import validation_cells as vc_repo
        out["validation_cells"] = vc_repo.list_for_test(test_id=r.id)
    else:
        out["validation_cells"] = []
```

(`out` is whatever local variable the helper builds. If the helper returns a dict literal directly, refactor to assign to a local `out` first, then add the conditional, then `return out`.)

- [ ] **Step 4: Allow `kind` on `create`**

Find the `create` (or `insert_test` / similar) function. Add `kind` to its parameter list with default `"sweep"` and pass it through to the SQL insert. Example shape:

```python
def create(
    *, name: str, material_id: int, spec: dict[str, Any], owner_id: int,
    notes: str = "", machine_id: str = "F2Ultra",
    kind: str = "sweep",
) -> dict[str, Any]:
    ...
    s.execute(insert(tests).values(
        ...,
        kind=kind,
    ))
```

- [ ] **Step 5: Cascade-delete validation cells in the test-delete path**

Find the function that deletes a test (likely `delete_test` or `soft_delete`). Before the `tests` row is deleted, call:

```python
    from . import validation_cells as vc_repo
    vc_repo.delete_for_test(test_id=test_id)
```

(For soft-delete, do NOT call this — only on hard delete. Check the existing repo pattern; if it only soft-deletes, skip this step — the FK orphans are harmless.)

- [ ] **Step 6: Run the existing tests repo tests**

```bash
cd /Users/jonzky/Documents/XTools/Reverse/.worktrees/material-validation
uv run --active pytest tests/test_tests_repo.py -v 2>&1 | tail -10
```

Expected: existing tests still pass. (No new tests added in this task — coverage comes via the endpoint tests in Task 7.)

- [ ] **Step 7: Commit**

```bash
git add src/xcs_gen_web/repositories/tests.py
git commit -m "feat(repo): tests repo surfaces kind + validation_cells"
```

---

## Task 5: xcs builder — branch on `kind`

**Files:**
- Modify: `src/xcs_gen_web/services/xcs.py`

- [ ] **Step 1: Locate the builder entry point**

```bash
cd /Users/jonzky/Documents/XTools/Reverse/.worktrees/material-validation
grep -nE "def build|generate_xcs|^def " src/xcs_gen_web/services/xcs.py | head -10
```

Identify the function that takes a test record and produces `.xcs` bytes (likely `build_xcs_from_test` or `generate`).

- [ ] **Step 2: Read the existing sweep-cell-list construction**

Find where the function builds the per-cell parameter list (it iterates `x_steps`, possibly `y_steps`, computing each cell's params from the spec's sweep ranges + base params). Note the variable name — likely `cells: list[dict]` or similar — and the shape: at minimum `{x_value, y_value, params: {power, speed, freq, pulse_width, density, passes}}`.

- [ ] **Step 3: Add the kind-aware branch**

At the TOP of the cell-list construction, add:

```python
    if test.get("kind") == "validation":
        # Validation: cell list is frozen at test-create time. The
        # ordering on the burn = `cell_index` ascending (already L*-sorted
        # by the auto-pick). Each cell's params are stored as JSON in the
        # validation_cells row.
        validation_cells = test.get("validation_cells") or []
        if not validation_cells:
            raise ValueError(
                "validation test has no cells — pick at least one palette swatch first",
            )
        cells = [
            {
                "x_value": vc["cell_index"],          # cosmetic — used as fallback label
                "y_value": None,
                "params": {**base_params, **vc["params"]},
            }
            for vc in validation_cells
        ]
        # Wrapped 1D layout, hide axis labels, since cells aren't a sweep.
        layout_kind = "wrapped_1d"
        rows_count = max(1, -(-len(cells) // max(1, spec.get("cells_per_row", 1))))
    else:
        # Existing sweep code path — unchanged.
        ...   # (keep existing implementation)
```

(Replace the `...` with whatever the existing code already does for sweeps. Don't delete the sweep branch — it's the default for `kind != 'validation'`.)

- [ ] **Step 4: Force `hide_axis_labels=True` for validation**

Wherever the spec passes `hide_axis_labels` into the layout / SVG generator, force it to `True` for validation:

```python
    hide_axis_labels = (
        True if test.get("kind") == "validation"
        else bool(spec.get("hide_axis_labels", False))
    )
```

- [ ] **Step 5: Type-check — no Python type hints to break**

Just run a smoke import:

```bash
cd /Users/jonzky/Documents/XTools/Reverse/.worktrees/material-validation
uv run --active python -c "from xcs_gen_web.services import xcs"
```

Expected: no traceback.

- [ ] **Step 6: Commit**

```bash
git add src/xcs_gen_web/services/xcs.py
git commit -m "feat(xcs): branch on test.kind for validation cell list"
```

---

## Task 6: API endpoints

**Files:**
- Modify: `src/xcs_gen_web/app.py`
- Modify: `src/xcs_gen_web/schemas.py` (Pydantic models for the new endpoints)

- [ ] **Step 1: Locate the existing test-create endpoint**

```bash
cd /Users/jonzky/Documents/XTools/Reverse/.worktrees/material-validation
grep -nE "tests_create|@router.post.*tests|POST.*tests" src/xcs_gen_web/app.py | head -10
```

Find the handler for `POST /api/tests`.

- [ ] **Step 2: Add `kind` to the create payload**

Open `src/xcs_gen_web/schemas.py`. Find `TestCreate` (or `TestRequest`). Add:

```python
    kind: Literal["sweep", "validation"] = "sweep"
```

In `app.py`'s create handler, pass `kind=payload.kind` to the repo's `create` call.

- [ ] **Step 3: Define the `validation_cells` PATCH endpoint schema**

Append to `src/xcs_gen_web/schemas.py`:

```python
class ValidationCellIn(BaseModel):
    cell_index: int
    palette_entry_id: int | None = None
    expected_hex: str
    expected_lab: list[float]
    params: dict[str, float | int | str]


class ValidationCellsPatch(BaseModel):
    cells: list[ValidationCellIn]
```

- [ ] **Step 4: Add the PATCH handler**

In `app.py`, near the other test routes, add:

```python
@router.patch("/api/tests/{test_id}/validation-cells")
async def patch_validation_cells(
    test_id: int,
    payload: ValidationCellsPatch,
    user: User = Depends(get_current_user),
):
    """Replace the validation-cell list for a kind=validation test.

    Frontend calls this after the user finishes adjusting picks (or
    after an auto-pick). Cells are stored in the order received; the
    builder iterates them by cell_index ascending, so the frontend is
    responsible for L*-sorting before posting.
    """
    from .repositories import tests as test_repo, validation_cells as vc_repo
    test = test_repo.get_by_id(test_id, owner_id=user.id)
    if test is None:
        raise HTTPException(404, "test not found")
    if test["kind"] != "validation":
        raise HTTPException(409, "test kind is not 'validation'")
    if test.get("locked"):
        raise HTTPException(409, "test is locked")
    vc_repo.replace_for_test(
        test_id=test_id,
        cells=[c.model_dump() for c in payload.cells],
    )
    return {"ok": True, "count": len(payload.cells)}
```

- [ ] **Step 5: Confirm the GET endpoint surfaces `kind` + `validation_cells`**

The repo change in Task 4 already added these to the row dict, so `GET /api/tests/{id}` returns them automatically. Verify by running:

```bash
cd /Users/jonzky/Documents/XTools/Reverse/.worktrees/material-validation
uv run --active python -c "
from xcs_gen_web.app import app
from fastapi.testclient import TestClient
c = TestClient(app)
r = c.get('/api/health')
print(r.status_code, r.json())
"
```

Expected: `200 {'status': 'ok', ...}`.

- [ ] **Step 6: Commit**

```bash
git add src/xcs_gen_web/app.py src/xcs_gen_web/schemas.py
git commit -m "feat(api): kind on test create; PATCH /api/tests/:id/validation-cells"
```

---

## Task 7: End-to-end backend test (xcs round-trip)

**Files:**
- Create: `tests/test_xcs_validation_kind.py`

- [ ] **Step 1: Write the test**

Create `tests/test_xcs_validation_kind.py`:

```python
"""Round-trip a kind=validation test through the xcs builder and assert
each cell uses the params from its validation_cell row, not anything
derived from a sweep."""
from __future__ import annotations

import json

import pytest

from xcs_gen_web.db import SessionLocal, engine, metadata


@pytest.fixture(autouse=True)
def _schema():
    metadata.create_all(bind=engine)
    yield
    metadata.drop_all(bind=engine)


def _bootstrap_validation_test():
    """Insert a material, three palette entries, and a kind=validation
    test that wires the picker selection through. Returns the test id."""
    from datetime import datetime, timezone
    from sqlalchemy import insert
    from xcs_gen_web.models import (
        materials, palette_entries, tests, users,
    )
    from xcs_gen_web.repositories import validation_cells as vc_repo

    now = datetime.now(timezone.utc).isoformat()
    with SessionLocal.begin() as s:
        owner = s.execute(insert(users).values(
            api_key="k", first_name="t",
            created_at=now, last_seen_at=now,
        )).inserted_primary_key[0]
        material_id = s.execute(insert(materials).values(
            name="m", notes="", created_at=now, owner_id=owner,
        )).inserted_primary_key[0]
        # Three palette entries, distinct params per entry.
        pe_rows = []
        for i, (hex_, params) in enumerate([
            ("#100000", {"power": 8, "speed": 1500}),
            ("#400000", {"power": 11, "speed": 1500}),
            ("#900000", {"power": 14, "speed": 1500}),
        ]):
            res = s.execute(insert(palette_entries).values(
                machine_id="F2Ultra", test_id=None, material_id=material_id,
                hex=hex_, lab_l=20.0 + 30.0 * i, lab_a=20.0, lab_b=10.0,
                params_json=json.dumps(params), sigma=1.0, source="manual",
                notes="", created_at=now, owner_id=owner,
            ))
            pe_rows.append(res.inserted_primary_key[0])
        spec = {
            "x_param": "power", "x_min": 8, "x_max": 14, "x_steps": 3,
            "rows": 1, "width_mm": 30, "height_mm": 30,
            "cell_shape": "rect", "sample_aggregator": "saturation_median",
            "base_params": {"frequency": 200, "pulse_width": 200},
            "cells_per_row": 3,
            "registration": {"mode": "on"},
            "hide_axis_labels": True,
        }
        test_id = s.execute(insert(tests).values(
            name="vtest", material_id=material_id, status="created",
            spec_json=json.dumps(spec), notes="",
            created_at=now, updated_at=now, owner_id=owner,
            kind="validation",
        )).inserted_primary_key[0]

    vc_repo.replace_for_test(test_id=test_id, cells=[
        {
            "cell_index": i,
            "palette_entry_id": pe_rows[i],
            "expected_hex": ["#100000", "#400000", "#900000"][i],
            "expected_lab": [20.0 + 30.0 * i, 20.0, 10.0],
            "params": [
                {"power": 8, "speed": 1500},
                {"power": 11, "speed": 1500},
                {"power": 14, "speed": 1500},
            ][i],
        }
        for i in range(3)
    ])
    return test_id


def test_validation_xcs_uses_per_cell_params():
    """Build the xcs and confirm cell power values come from
    validation_cells, not from any sweep computation."""
    from xcs_gen_web.repositories import tests as test_repo
    from xcs_gen_web.services.xcs import build_xcs_from_test

    test_id = _bootstrap_validation_test()
    test = test_repo.get_by_id(test_id, owner_id=1)
    assert test["kind"] == "validation"
    assert len(test["validation_cells"]) == 3

    payload = build_xcs_from_test(test=test)
    # `payload` is the bytes / dict the existing builder returns. We
    # assert on the cells the builder sees by capturing them via a hook
    # — since the builder returns opaque bytes, we instead test the
    # cell list it would produce. For that we exercise the same
    # internal pure function the builder uses to derive cells.
    from xcs_gen_web.services.xcs import _cell_list_for_test
    cells = _cell_list_for_test(test=test)
    assert [c["params"]["power"] for c in cells] == [8, 11, 14]
    # All three cells share the base-params overlay.
    assert all(c["params"]["frequency"] == 200 for c in cells)


def test_validation_xcs_rejects_empty_pick():
    """Validation test with zero cells must raise — the user can't burn
    nothing."""
    from xcs_gen_web.repositories import tests as test_repo
    from xcs_gen_web.repositories import validation_cells as vc_repo
    from xcs_gen_web.services.xcs import build_xcs_from_test

    test_id = _bootstrap_validation_test()
    vc_repo.replace_for_test(test_id=test_id, cells=[])  # clear

    test = test_repo.get_by_id(test_id, owner_id=1)
    with pytest.raises(ValueError, match="no cells"):
        build_xcs_from_test(test=test)
```

- [ ] **Step 2: Refactor the xcs builder so the test can target `_cell_list_for_test`**

This is the bit that lets the test assert on cells without fully serialising. In `services/xcs.py`, extract the per-cell loop into a private function:

```python
def _cell_list_for_test(*, test: dict[str, Any]) -> list[dict[str, Any]]:
    """Pure: spec + kind → list of {x_value, y_value, params} dicts in
    burn order. No I/O, no DOM, no SVG. Used by the builder and by
    pytest to verify the kind branch without serialising .xcs."""
    spec = json.loads(test["spec_json"]) if isinstance(test["spec_json"], str) else test["spec_json"]
    base_params = spec.get("base_params", {})

    if test.get("kind") == "validation":
        validation_cells = test.get("validation_cells") or []
        if not validation_cells:
            raise ValueError(
                "validation test has no cells — pick at least one palette swatch first",
            )
        return [
            {
                "x_value": vc["cell_index"],
                "y_value": None,
                "params": {**base_params, **vc["params"]},
            }
            for vc in validation_cells
        ]

    # Existing sweep-grid construction — extract the loop body verbatim.
    ...   # (keep existing implementation)
```

Then call `_cell_list_for_test(test=test)` from the existing `build_xcs_from_test` instead of inlining the loop.

- [ ] **Step 3: Run the new tests**

```bash
cd /Users/jonzky/Documents/XTools/Reverse/.worktrees/material-validation
uv run --active pytest tests/test_xcs_validation_kind.py -v
```

Expected: 2 tests pass.

- [ ] **Step 4: Run the full backend suite to catch regressions**

```bash
uv run --active pytest tests/ -q 2>&1 | tail -10
```

Expected: full suite green.

- [ ] **Step 5: Commit**

```bash
git add tests/test_xcs_validation_kind.py src/xcs_gen_web/services/xcs.py
git commit -m "test(xcs): kind=validation builds cells from validation_cells"
```

---

## Task 8: Frontend — extract FPS + ΔE76 into `colorSelection.ts`

**Files:**
- Create: `web/src/svg/colorSelection.ts`
- Create: `web/src/svg/colorSelection.test.ts`
- Modify: `web/src/components/MaterialPalettePicker.tsx`

- [ ] **Step 1: Write the failing test**

Create `web/src/svg/colorSelection.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { deltaE76, seedFarthestPointSample } from "./colorSelection";
import type { PaletteEntry } from "../types";

const lab = (id: number, l: number, a: number, b: number): PaletteEntry => ({
  id,
  machine_id: "F2Ultra",
  test_id: null,
  material_id: 1,
  x_value: null, y_value: null,
  hex: "#000000", lab: [l, a, b],
  params: {}, sigma: 0, source: "manual",
  source_result_id: null, notes: "", favorited: false,
  created_at: "",
});

describe("deltaE76", () => {
  it("is zero for identical Lab", () => {
    expect(deltaE76([50, 0, 0], [50, 0, 0])).toBe(0);
  });
  it("is the Euclidean distance otherwise", () => {
    expect(deltaE76([0, 0, 0], [3, 4, 0])).toBeCloseTo(5);
  });
});

describe("seedFarthestPointSample", () => {
  it("returns empty when the palette is empty", () => {
    expect(seedFarthestPointSample([], 5).size).toBe(0);
  });

  it("never returns more than min(N, palette size)", () => {
    const palette = [lab(1, 30, 0, 0), lab(2, 70, 0, 0)];
    expect(seedFarthestPointSample(palette, 10).size).toBe(2);
  });

  it("seeds with the entry farthest from mean L*", () => {
    const palette = [lab(1, 50, 0, 0), lab(2, 51, 0, 0), lab(3, 90, 0, 0)];
    // Mean L = ~63.7; |90-63.7| = 26.3 (max). Seed must be id=3.
    const picked = seedFarthestPointSample(palette, 1);
    expect(Array.from(picked)).toEqual([3]);
  });

  it("picks a second entry that maximises minimum ΔE76 to the seed", () => {
    const palette = [
      lab(1, 50, 0, 0),
      lab(2, 50, 5, 0),    // close to id=1
      lab(3, 50, 50, 50),  // far from id=1
    ];
    const picked = seedFarthestPointSample(palette, 2);
    // Seed (extreme L*) is one of {1,2,3} — they all share L*=50, so seed
    // resolves by id (lowest id on tie). Then the second pick maximises
    // min-distance: id=3 wins regardless.
    expect(picked.has(3)).toBe(true);
  });

  it("is deterministic for tied inputs", () => {
    const palette = [lab(1, 30, 0, 0), lab(2, 70, 0, 0), lab(3, 50, 50, 50)];
    const a = Array.from(seedFarthestPointSample(palette, 3));
    const b = Array.from(seedFarthestPointSample(palette, 3));
    expect(a).toEqual(b);
  });
});
```

- [ ] **Step 2: Run the test, confirm it fails**

```bash
cd /Users/jonzky/Documents/XTools/Reverse/.worktrees/material-validation/web
npm test -- --run colorSelection
```

Expected: FAIL — module does not exist.

- [ ] **Step 3: Create `colorSelection.ts`**

Create `web/src/svg/colorSelection.ts`:

```ts
/**
 * Pure helpers for picking validation-burn colours from a material's
 * palette. Lifted out of MaterialPalettePicker.tsx so they're unit-
 * testable without DOM / RTL setup.
 */

import type { PaletteEntry } from "../types";

/** Euclidean distance in Lab space — ΔE76. Cheap and consistent
 *  with the threshold the user sees on the result-detail summary. */
export function deltaE76(a: readonly number[], b: readonly number[]): number {
  const dl = (a[0] ?? 0) - (b[0] ?? 0);
  const da = (a[1] ?? 0) - (b[1] ?? 0);
  const db = (a[2] ?? 0) - (b[2] ?? 0);
  return Math.sqrt(dl * dl + da * da + db * db);
}

/** Pick `n` palette entries that are spread out in Lab space.
 *  Returns the `id`s of the picked entries. Seed = the entry with
 *  maximum |L* - mean(L*)|; subsequent picks maximise minimum ΔE76
 *  to the already-picked set. Deterministic — tie-breaks by lowest id. */
export function seedFarthestPointSample(
  entries: PaletteEntry[],
  n: number,
): Set<number> {
  const ids = new Set<number>();
  if (entries.length === 0 || n <= 0) return ids;
  const eligible = entries.filter((e) => e.lab && e.lab.length >= 3);
  if (eligible.length === 0) return ids;

  const meanL = eligible.reduce((acc, e) => acc + e.lab[0], 0) / eligible.length;
  let seed = eligible[0];
  let seedScore = -1;
  for (const e of eligible) {
    const score = Math.abs(e.lab[0] - meanL);
    if (score > seedScore || (score === seedScore && e.id < seed.id)) {
      seed = e;
      seedScore = score;
    }
  }
  ids.add(seed.id);

  while (ids.size < Math.min(n, eligible.length)) {
    let best: PaletteEntry | null = null;
    let bestScore = -1;
    for (const e of eligible) {
      if (ids.has(e.id)) continue;
      let minD = Infinity;
      for (const p of eligible) {
        if (!ids.has(p.id)) continue;
        const d = deltaE76(e.lab, p.lab);
        if (d < minD) minD = d;
      }
      if (minD > bestScore || (minD === bestScore && best != null && e.id < best.id)) {
        best = e;
        bestScore = minD;
      }
    }
    if (!best) break;
    ids.add(best.id);
  }
  return ids;
}
```

- [ ] **Step 4: Run the tests, verify they pass**

```bash
cd /Users/jonzky/Documents/XTools/Reverse/.worktrees/material-validation/web
npm test -- --run colorSelection
```

Expected: 5 tests pass.

- [ ] **Step 5: Update `MaterialPalettePicker.tsx` to import the helpers**

Open `web/src/components/MaterialPalettePicker.tsx`. Replace the inline definitions of `deltaE76` and `seedFarthestPointSample` (around lines 35-100) with:

```ts
import { deltaE76, seedFarthestPointSample } from "../svg/colorSelection";
```

(Add this to the existing imports at the top of the file. Then DELETE lines 37-103 — the in-file `deltaE76` and `seedFarthestPointSample` definitions.)

Also REMOVE the `export` from `deltaE76` and `seedFarthestPointSample` references (since they're now imported, not declared).

- [ ] **Step 6: Run frontend tsc + tests**

```bash
cd /Users/jonzky/Documents/XTools/Reverse/.worktrees/material-validation/web
npx tsc --noEmit && npm test -- --run
```

Expected: tsc clean; all tests green.

- [ ] **Step 7: Commit**

```bash
git add web/src/svg/colorSelection.ts web/src/svg/colorSelection.test.ts web/src/components/MaterialPalettePicker.tsx
git commit -m "refactor(svg): extract FPS + ΔE76 into colorSelection.ts with tests"
```

---

## Task 9: Frontend types

**Files:**
- Modify: `web/src/types.ts`
- Modify: `web/src/api/tests.ts`

- [ ] **Step 1: Add `kind` and `validation_cells` to TestRecord**

Open `web/src/types.ts`. Find the `TestRecord` interface (around line 173). Add (in alphabetical order or following the existing field order):

```ts
  kind: "sweep" | "validation";
  validation_cells: ValidationCell[];
```

Then APPEND a new exported interface:

```ts
export interface ValidationCell {
  id: number;
  test_id: number;
  cell_index: number;
  palette_entry_id: number | null;
  expected_hex: string;
  expected_lab: number[];   // [L*, a*, b*]
  params: Record<string, string | number>;
}
```

- [ ] **Step 2: Add `cells_per_row` to TestSpec**

In the same file, find `TestSpec` (around line 151). Add:

```ts
  /** Validation tests only — how many cells per physical row on the
   *  burn. Sweep tests ignore this. */
  cells_per_row?: number;
```

- [ ] **Step 3: Update the API client**

Open `web/src/api/tests.ts`. Find the `createTest` (or equivalent) request payload type. Add `kind?: "sweep" | "validation"`:

```ts
export async function createTest(payload: {
  name: string;
  material_id: number;
  spec: TestSpec;
  notes?: string;
  machine_id: string;
  kind?: "sweep" | "validation";
}): Promise<TestRecord> { ... }
```

- [ ] **Step 4: tsc + tests**

```bash
cd /Users/jonzky/Documents/XTools/Reverse/.worktrees/material-validation/web
npx tsc --noEmit && npm test -- --run
```

Expected: clean. (Existing tests don't touch the new fields; they're additive.)

- [ ] **Step 5: Commit**

```bash
git add web/src/types.ts web/src/api/tests.ts
git commit -m "feat(types): TestRecord.kind + ValidationCell"
```

---

## Task 10: API client for validation-cells PATCH

**Files:**
- Create: `web/src/api/validationCells.ts`

- [ ] **Step 1: Create the client**

```ts
/**
 * PATCH /api/tests/{id}/validation-cells — replaces the cell list for
 * a kind=validation test in one shot. Frontend sorts cells by L*
 * before posting (the burn ordering). Returns the new cell count.
 */
import { authedFetch } from "./_authedFetch";

export interface ValidationCellPayload {
  cell_index: number;
  palette_entry_id: number | null;
  expected_hex: string;
  expected_lab: number[];   // [L*, a*, b*]
  params: Record<string, string | number>;
}

export async function patchValidationCells(
  testId: number,
  cells: ValidationCellPayload[],
): Promise<{ ok: boolean; count: number }> {
  const r = await authedFetch(`/api/tests/${testId}/validation-cells`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ cells }),
  });
  if (!r.ok) {
    throw new Error(`patch validation cells failed: ${r.status}`);
  }
  return r.json();
}
```

(Verify the import path for `authedFetch` matches the existing pattern by running `grep -n "authedFetch" web/src/api/*.ts | head -3`.)

- [ ] **Step 2: tsc**

```bash
cd /Users/jonzky/Documents/XTools/Reverse/.worktrees/material-validation/web
npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add web/src/api/validationCells.ts
git commit -m "feat(api): validation-cells PATCH client"
```

---

## Task 11: `ParamTestEditor` — palette tab for validation tests

**Files:**
- Modify: `web/src/components/ParamTestEditor.tsx`

- [ ] **Step 1: Read the existing tab list**

```bash
cd /Users/jonzky/Documents/XTools/Reverse/.worktrees/material-validation
grep -nE "ParamTestEditorTab|tab === |\"sweep\"|\"test\"" web/src/components/ParamTestEditor.tsx | head -20
```

Identify where the tab list is rendered (likely as a `<TabBar>` with items `["test","sweep","base","registration"]`).

- [ ] **Step 2: Make the tab list `kind`-aware**

In the file, find the line that constructs the `tabs` array. Replace it with:

```tsx
const tabs: TabItem[] = t.kind === "validation"
  ? [
      { value: "test", label: "Test" },
      { value: "palette", label: "Palette" },
      { value: "base", label: "Base params" },
      { value: "registration", label: "Registration" },
    ]
  : [
      { value: "test", label: "Test" },
      { value: "sweep", label: "Sweep" },
      { value: "base", label: "Base params" },
      { value: "registration", label: "Registration" },
    ];
```

(`t` is the test record bound by the editor; if the variable name differs, use the existing one.)

- [ ] **Step 3: Update the `ParamTestEditorTab` type**

Find the `export type ParamTestEditorTab = ...` line (~line 59). Update:

```ts
export type ParamTestEditorTab = "test" | "sweep" | "palette" | "base" | "registration";
```

- [ ] **Step 4: Render the picker when `tab === "palette"`**

Find the existing `{tab === "sweep" && (...)}` block (~line 483). Add a sibling block AFTER it:

```tsx
{tab === "palette" && (
  <ValidationPaletteTab
    test={t}
    onTestChange={onChange}
    palette={palette}
    onPaletteRequest={onPaletteRequest}
  />
)}
```

- [ ] **Step 5: Add the `ValidationPaletteTab` sub-component**

At the bottom of `ParamTestEditor.tsx` (or in a sibling file `ValidationPaletteTab.tsx` if you prefer — same folder), add:

```tsx
import { useEffect, useMemo, useState } from "react";
import { MaterialPalettePicker } from "./MaterialPalettePicker";
import { patchValidationCells } from "../api/validationCells";
import type { PaletteEntry, TestRecord, ValidationCell } from "../types";

interface ValidationPaletteTabProps {
  test: TestRecord;
  onTestChange: (next: Partial<TestRecord>) => void;
  /** Palette entries for the test's material — fetched upstream and
   *  passed in. Empty array if not yet loaded. */
  palette: PaletteEntry[];
  /** Trigger a palette refetch — called after Save. */
  onPaletteRequest?: () => void;
}

function ValidationPaletteTab({
  test, onTestChange, palette,
}: ValidationPaletteTabProps) {
  // Selected ids hydrated from the test's existing validation_cells.
  const [selectedIds, setSelectedIds] = useState<Set<number>>(() =>
    new Set(test.validation_cells
      .map((c) => c.palette_entry_id)
      .filter((x): x is number => x != null)),
  );
  const [seedN, setSeedN] = useState<number>(
    Math.max(test.validation_cells.length, 12),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (next: Set<number>) => {
    setSaving(true);
    setError(null);
    try {
      // L*-sort the picked entries — the burn ordering.
      const picked = palette
        .filter((p) => next.has(p.id))
        .sort((a, b) => (a.lab?.[0] ?? 0) - (b.lab?.[0] ?? 0));
      const cells = picked.map((p, i) => ({
        cell_index: i,
        palette_entry_id: p.id,
        expected_hex: p.hex,
        expected_lab: p.lab,
        params: p.params,
      }));
      await patchValidationCells(test.id, cells);
      // Reflect the new shape in the parent without a refetch round-trip.
      onTestChange({
        validation_cells: cells.map((c, i) => ({
          ...c,
          id: -i,                     // ephemeral — server will reissue ids
          test_id: test.id,
        })) as ValidationCell[],
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3">
      <MaterialPalettePicker
        entries={palette}
        selectedIds={selectedIds}
        onSelectionChange={(next) => {
          setSelectedIds(next);
          void save(next);
        }}
        seedN={seedN}
        onSeedNChange={setSeedN}
        materialLabel={`material #${test.material_id}`}
      />
      {saving && (
        <div className="text-[11px] text-[color:var(--color-ink-muted)]">
          saving picks…
        </div>
      )}
      {error && (
        <div className="text-[11px] text-[color:var(--color-destructive)]">
          {error}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 6: Wire the palette fetch in `TestDetailPage`**

Open `web/src/pages/TestDetailPage.tsx`. Where the page already fetches data for the active test, add a parallel fetch when `t.kind === "validation"`:

```tsx
const [palette, setPalette] = useState<PaletteEntry[]>([]);
useEffect(() => {
  if (!t || t.kind !== "validation") return;
  let cancelled = false;
  (async () => {
    const { listPaletteByMaterial } = await import("../api/palette");
    const entries = await listPaletteByMaterial(t.material_id);
    if (!cancelled) setPalette(entries);
  })();
  return () => { cancelled = true; };
}, [t?.id, t?.material_id, t?.kind]);
```

(If `listPaletteByMaterial` doesn't exist, scan `web/src/api/palette.ts` for the closest function name and use that. Add a thin alias if needed.)

Pass `palette` into the `ParamTestEditor`'s props.

- [ ] **Step 7: Update `ParamTestEditor` props**

Add to its props interface:

```ts
palette?: PaletteEntry[];
onPaletteRequest?: () => void;
```

(Defaulted to `[]` and noop respectively.)

- [ ] **Step 8: tsc + run unit tests**

```bash
cd /Users/jonzky/Documents/XTools/Reverse/.worktrees/material-validation/web
npx tsc --noEmit && npm test -- --run
```

Expected: clean. The existing `ParamTestEditor.test.tsx` tests should still pass (they exercise the sweep tab, which is unchanged for non-validation tests).

- [ ] **Step 9: Commit**

```bash
git add web/src/components/ParamTestEditor.tsx web/src/pages/TestDetailPage.tsx
git commit -m "feat(test-editor): kind-aware palette tab for validation tests"
```

---

## Task 12: "New test" → kind chooser on `TestsPage`

**Files:**
- Modify: `web/src/pages/TestsPage.tsx`

- [ ] **Step 1: Locate the "New test" button**

```bash
cd /Users/jonzky/Documents/XTools/Reverse/.worktrees/material-validation
grep -n "New test\|newTest\|onNewTest" web/src/pages/TestsPage.tsx | head -5
```

- [ ] **Step 2: Replace the click-handler with a kind chooser**

Replace the existing single-action button with a small dropdown / split-button. Keep the markup minimal — same `Button` primitive, with two options:

```tsx
import { Plus } from "lucide-react";
import { useState } from "react";
import { Button, cn } from "../ui";

function NewTestMenu({ onCreate }: { onCreate: (kind: "sweep" | "validation") => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative inline-flex">
      <Button
        variant="primary"
        size="md"
        onClick={() => setOpen((v) => !v)}
        className="gap-1.5"
      >
        <Plus className="h-3.5 w-3.5" strokeWidth={2.2} />
        <span>New test</span>
      </Button>
      {open && (
        <div
          className={cn(
            "absolute top-full left-0 mt-1 z-10",
            "rounded-[5px] border border-[color:var(--color-border)]",
            "bg-[color:var(--color-surface)] shadow-md min-w-[200px]",
          )}
          onMouseLeave={() => setOpen(false)}
        >
          <KindOption
            label="Sweep"
            hint="Vary parameters across a grid"
            onClick={() => { onCreate("sweep"); setOpen(false); }}
          />
          <KindOption
            label="Validation"
            hint="Verify a material's palette reproduces"
            onClick={() => { onCreate("validation"); setOpen(false); }}
          />
        </div>
      )}
    </div>
  );
}

function KindOption({
  label, hint, onClick,
}: { label: string; hint: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "block w-full text-left px-3 py-2",
        "hover:bg-[color:var(--color-surface-elevated)]",
        "border-b border-[color:var(--color-border)] last:border-b-0",
      )}
    >
      <div className="font-mono text-[10px] tracking-[0.18em] uppercase font-semibold text-[color:var(--color-ink)]">
        {label}
      </div>
      <div className="text-[11px] text-[color:var(--color-ink-muted)] mt-0.5 leading-snug">
        {hint}
      </div>
    </button>
  );
}
```

- [ ] **Step 3: Wire it to `createTest`**

Replace the existing `<Button onClick={createNewTest}>New test</Button>` with:

```tsx
<NewTestMenu onCreate={(kind) => createNewTest(kind)} />
```

Update `createNewTest` to accept and forward the kind:

```tsx
async function createNewTest(kind: "sweep" | "validation" = "sweep") {
  const created = await createTest({
    name: kind === "validation" ? "New validation" : "New test",
    material_id: defaultMaterialId,    // however the page already picks one
    spec: kind === "validation"
      ? { ...defaultValidationSpec, cells_per_row: 6 }
      : defaultSweepSpec,
    machine_id: machineId,
    kind,
  });
  // navigate to the new test's detail page (existing pattern)
  ...
}
```

(Keep the existing navigation logic — only the create payload changes.)

- [ ] **Step 4: Define `defaultValidationSpec`**

Add at the top of the file (or near the existing `defaultSweepSpec`):

```ts
const defaultValidationSpec: TestSpec = {
  // Validation has no sweep; x_steps is cosmetic — the cell count
  // comes from the palette pick. Fields kept to satisfy the existing
  // TestSpec shape.
  x_param: "power",
  x_min: 1, x_max: 1, x_steps: 1,
  rows: 1,
  width_mm: 30, height_mm: 30,
  cell_shape: "rect",
  sample_aggregator: "saturation_median",
  base_params: {},
  registration: { mode: "on" },
  hide_axis_labels: true,
  cells_per_row: 6,
};
```

- [ ] **Step 5: tsc + tests**

```bash
cd /Users/jonzky/Documents/XTools/Reverse/.worktrees/material-validation/web
npx tsc --noEmit && npm test -- --run
```

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add web/src/pages/TestsPage.tsx
git commit -m "feat(tests-page): kind chooser on New-test action"
```

---

## Task 13: `ResultDetailDialog` — paired tiles + summary strip for validation results

**Files:**
- Modify: `web/src/components/ResultDetailDialog.tsx`
- Create: `web/src/components/ResultDetailDialog.validation.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `web/src/components/ResultDetailDialog.validation.test.tsx`:

```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { ResultDetailDialog } from "./ResultDetailDialog";

vi.mock("../hooks/useAuthedImage", () => ({ useAuthedImage: () => null }));

const validationResult = {
  id: 1, test_id: 1, uploaded_at: "2026-05-02T10:00:00Z",
  image_url: "/api/results/1/image", image_sha256: "x",
  excluded: false, notes: "",
  swatches: [
    { row: 0, col: 0, x_value: 0, y_value: null,
      hex: "#ff0000", lab: [50, 80, 70], sigma: 1.2 },
    { row: 0, col: 1, x_value: 1, y_value: null,
      hex: "#00ff00", lab: [60, -50, 40], sigma: 0.8 },
  ],
  retest_index: 0, missing_markers: [],
};

const validationTest = {
  id: 1, name: "v", material_id: 1, status: "tested",
  notes: "", created_at: "", updated_at: "",
  locked: true, owner_id: 1, visibility: "private",
  machine_id: "F2Ultra",
  kind: "validation" as const,
  validation_cells: [
    { id: 1, test_id: 1, cell_index: 0,
      palette_entry_id: 10, expected_hex: "#ff0001",
      expected_lab: [51, 79, 69], params: {} },
    { id: 2, test_id: 1, cell_index: 1,
      palette_entry_id: 11, expected_hex: "#00ff10",
      expected_lab: [62, -52, 38], params: {} },
  ],
  spec: {
    x_param: "power", x_min: 0, x_max: 0, x_steps: 2,
    rows: 1, width_mm: 30, height_mm: 30,
    cell_shape: "rect", sample_aggregator: "saturation_median",
    base_params: {}, registration: { mode: "on" }, hide_axis_labels: true,
    cells_per_row: 2,
  },
};

describe("ResultDetailDialog · validation", () => {
  it("renders the validation summary strip with median/max/over-threshold", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(((url: string) => {
      if (String(url).endsWith("/api/tests/1")) {
        return Promise.resolve(new Response(
          JSON.stringify(validationTest),
          { status: 200, headers: { "content-type": "application/json" } },
        ));
      }
      if (String(url).includes("/api/health")) {
        return Promise.resolve(new Response(
          JSON.stringify({ status: "ok", mode: "standalone" }),
          { status: 200, headers: { "content-type": "application/json" } },
        ));
      }
      return Promise.reject(new Error("unexpected " + url));
    }) as typeof fetch);

    render(
      <ResultDetailDialog
        open={true}
        onOpenChange={() => {}}
        result={validationResult as any}
      />,
    );

    // Summary appears after the test fetches.
    await waitFor(() => {
      expect(screen.getByText(/median ΔE/i)).toBeTruthy();
    });
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

```bash
cd /Users/jonzky/Documents/XTools/Reverse/.worktrees/material-validation/web
npm test -- --run ResultDetailDialog.validation
```

Expected: FAIL — "Median ΔE" not found.

- [ ] **Step 3: Wire the validation summary into `ResultDetailDialog`**

Open `web/src/components/ResultDetailDialog.tsx`. At the top, import:

```ts
import {
  ValidationSummaryStrip, PairedSwatchTile,
} from "./MaterialPalettePicker";
import { deltaE76 } from "../svg/colorSelection";
```

Inside `ResultDetailBody`, after `const isPreviewing = ...` (around line 102), add:

```ts
const isValidation = testSpec != null && (testSpec as any).kind === "validation";
// Note: testSpec is the spec, not the full TestRecord. Need to read
// validation_cells from the test itself — extend the test fetch.
```

Wait — `testSpec` only carries the spec, not the kind. The test record has `kind` and `validation_cells`. Refactor the existing test fetch to keep the full record:

```ts
const [testRecord, setTestRecord] = useState<TestRecord | null>(null);

useEffect(() => {
  let cancelled = false;
  (async () => {
    try {
      const { getTest } = await import("../api/tests");
      const test = await getTest(result.test_id);
      if (!cancelled) {
        setTestRecord(test);
        setTestSpec(test.spec);
      }
    } catch (err) {
      console.error("Failed to fetch test:", err);
    }
  })();
  return () => { cancelled = true; };
}, [result.test_id]);
```

Replace the existing `setTestSpec` flow with this. Then derive:

```ts
const isValidation = testRecord?.kind === "validation";
const validationCells = testRecord?.validation_cells ?? [];

// Build (cell_index → expected_lab) for fast lookup.
const expectedByIndex = useMemo(() => {
  const m = new Map<number, ValidationCell>();
  for (const c of validationCells) m.set(c.cell_index, c);
  return m;
}, [validationCells]);

// Map measured → measured + expected_lab + delta. Cell index = the
// position of the swatch in `displayedSwatches` (which is L*-sorted
// at burn time, matching cell_index ordering).
const validationDeltas = useMemo<number[]>(() => {
  if (!isValidation) return [];
  return displayedSwatches.map((s, i) => {
    const expected = expectedByIndex.get(i);
    if (!expected) return 0;
    return deltaE76(s.lab, expected.expected_lab);
  });
}, [isValidation, displayedSwatches, expectedByIndex]);

const [threshold, setThreshold] = useState(3.0);
```

- [ ] **Step 4: Render the summary strip + paired tiles**

Find the existing `<ChartLabel title={\`Swatches (${displayedSwatches.length})\`} />` block in the swatch grid (around line 350). Insert ABOVE it:

```tsx
{isValidation && (
  <ValidationSummaryStrip
    deltas={validationDeltas}
    threshold={threshold}
    onThresholdChange={setThreshold}
  />
)}
```

Then find the `displayedSwatches.map(...)` loop that renders `<SwatchTile>` (around line 381). Replace with:

```tsx
{displayedSwatches.map((s, i) => {
  const expected = expectedByIndex.get(i);
  if (isValidation && expected) {
    return (
      <PairedSwatchTile
        key={`${s.row}-${s.col}-${i}`}
        measuredHex={s.hex}
        expectedHex={expected.expected_hex}
        delta={validationDeltas[i] ?? 0}
        threshold={threshold}
        sigma={s.sigma}
        onClick={() => setInspectingCell({ row: s.row, col: s.col })}
      />
    );
  }
  return (
    <SwatchTile
      key={`${s.row}-${s.col}-${i}`}
      swatch={s}
      compact={displayedSwatches.length > 60}
      onClick={() => setInspectingCell({ row: s.row, col: s.col })}
    />
  );
})}
```

- [ ] **Step 5: Run the test, verify it passes**

```bash
cd /Users/jonzky/Documents/XTools/Reverse/.worktrees/material-validation/web
npm test -- --run ResultDetailDialog.validation
```

Expected: PASS.

- [ ] **Step 6: Run the full frontend suite**

```bash
cd /Users/jonzky/Documents/XTools/Reverse/.worktrees/material-validation/web
npx tsc --noEmit && npm test -- --run
```

Expected: clean tsc; all tests green (the existing aggregator-dropdown test on `ResultDetailDialog` continues to pass — its mock returns no `kind` so the validation branches don't trigger).

- [ ] **Step 7: Commit**

```bash
git add web/src/components/ResultDetailDialog.tsx web/src/components/ResultDetailDialog.validation.test.tsx
git commit -m "feat(result-detail): paired tiles + validation summary strip"
```

---

## Task 14: Live walkthrough + changelog

**Files:**
- Create: `changelog/2026-05-02-material-validation.md`

- [ ] **Step 1: Build the worktree**

```bash
cd /Users/jonzky/Documents/XTools/Reverse/.worktrees/material-validation/web
npm run build > /dev/null 2>&1 && echo BUILD_OK
```

Expected: `BUILD_OK`.

- [ ] **Step 2: Boot the worktree's server on port 8020**

```bash
cd /Users/jonzky/Documents/XTools/Reverse/.worktrees/material-validation
uv run --active xcs-gen serve --host 127.0.0.1 --port 8020 &
sleep 4
curl -s http://127.0.0.1:8020/api/health
```

Expected: `{"status":"ok",...}`.

- [ ] **Step 3: Drive Playwright through the golden path**

Use the Playwright MCP tools to:
1. Navigate to `http://127.0.0.1:8020/#/tests`
2. Click "New test" → "Validation"
3. Confirm the new test detail page shows a `Palette` tab (no `Sweep` tab)
4. Pick a material with an existing palette (e.g. test #2's material)
5. Wait for the picker to load; click "Auto-pick" with N=12; confirm 12 selected
6. Toggle a few tiles; confirm the saving-picks indicator flashes; reload the page; confirm the same selection comes back from the server
7. Click "Generate .xcs"; download the file; confirm it contains the expected number of cells (best-effort — open in xTool studio if available)
8. Take screenshots of: the palette picker, the kind chooser, an empty-palette state, and a validation result modal (use a synthetic result if no real burn is available)

Save screenshots to `validation-picker.png`, `validation-kind-chooser.png`, etc., for the changelog.

- [ ] **Step 4: Kill the server**

```bash
lsof -ti:8020 | xargs kill 2>/dev/null
echo done
```

- [ ] **Step 5: Write the changelog entry**

Create `changelog/2026-05-02-material-validation.md`:

```markdown
---
id: 2026-05-02-material-validation
date: 2026-05-02
level: major
title: Material validation tests
summary: A new test kind that re-burns a representative subset of a material's palette and reports per-cell ΔE against the stored Lab.
images:
  - src: validation-picker.png
    caption: The palette tab — a*/b* gamut on the left, swatch grid on the right. Click any tile to toggle.
  - src: validation-result.png
    caption: Result modal with paired tiles (measured top, expected bottom) and a median/max/over-threshold summary strip.
---

Tests used to be one shape: pick a sweep axis, burn the grid, ingest
the colours that emerge. The new **validation** kind inverts that —
given a material whose palette is already ingested, pick the swatches
you want to re-prove, burn them with their stored params, and the
result modal will show you per-cell ΔE76 against what the palette
predicted.

Pick "Validation" on the **New test** menu. The form's `Sweep` tab
becomes a **Palette** tab: an a*/b* scatter mini-map plus a swatch
grid. The picker auto-picks N farthest-point samples in 3D Lab space
to give you a spread; you can swap any tile in or out by clicking it.
Generate the xcs as usual, burn it, upload the photo. The result
modal will show paired tiles (measured top, expected bottom) and a
summary strip with median ΔE, max ΔE, and a configurable
"over-threshold" count — drag the threshold slider live to see what
shifts.

Curves and primitives in your design SVG continue to be untouched;
this is purely a per-cell colour-reproduction story.
```

- [ ] **Step 6: Drop the screenshots into changelog/images/**

```bash
mv validation-picker.png changelog/images/
# (and any others you captured)
```

- [ ] **Step 7: Commit + push**

```bash
cd /Users/jonzky/Documents/XTools/Reverse/.worktrees/material-validation
git add changelog/2026-05-02-material-validation.md changelog/images/validation-*.png
git commit -m "docs(changelog): material validation"
git push -u origin feat/material-validation
```

- [ ] **Step 8: Open a draft PR**

```bash
gh pr create --draft --base main --title "feat: material palette validation tests" --body "$(cat <<'EOF'
## Summary
- New `kind=validation` test that lets users burn a representative subset of a material's palette and see per-cell ΔE76 vs. stored Lab.
- Adds `tests.kind`, `validation_cells` table, the `palette` tab on the test editor, and paired tiles + summary strip on the result modal.
- Reuses the existing capture pipeline; ΔE is computed at render time on the frontend (no extra storage).

## Test plan
- [x] Backend unit tests: validation_cells repo, kind-aware xcs builder
- [x] Frontend unit tests: FPS + ΔE76 helpers, ResultDetailDialog validation branch
- [x] Manual walkthrough: New test → validation, auto-pick, edit picks, save, reload, generate .xcs, upload a synthetic result, see summary strip + paired tiles
- [ ] Real burn round-trip on a calibrated material (deferred to first user test)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-Review

**1. Spec coverage:**
- "New test kind on Tests page" → Tasks 1, 4, 11, 12 ✓
- "FPS in 3D Lab" → Task 8 (extracted from existing picker) ✓
- "Wrapped 1D layout, ordered by L*" → Task 5 (validates) + Task 11 (sort on save) ✓
- "Picker = grid + scatter, N is seed" → already exists in `MaterialPalettePicker.tsx`; Task 11 wires it ✓
- "Augmented result modal with paired tiles + summary strip" → Task 13 ✓
- "DB: tests.kind + validation_cells" → Tasks 1, 2, 3 ✓
- "ΔE76 throughout" → Task 8 (helper), Task 13 (render-time use) ✓
- "Out of scope (stage 1) items" — none implemented ✓

**2. Placeholder scan:** None — every code-changing step has its full code block. The two `...   # (keep existing implementation)` placeholders in Tasks 5 and 7 are deliberate: they refer to the engineer keeping the existing sweep-cell-list code as-is, with the new validation branch ABOVE it. Documented inline.

**3. Type consistency:**
- `kind: "sweep" | "validation"` — used identically in Tasks 1 (Python), 6 (Pydantic), 9 (TS), 11 (component), 12 (chooser)
- `ValidationCell` shape — defined in Task 9, consumed in 11 and 13 with matching property names (`cell_index`, `palette_entry_id`, `expected_hex`, `expected_lab`, `params`)
- `validation_cells` table column names match between Task 1 (DDL), Task 3 (read shape), Task 6 (Pydantic) ✓
- `seedFarthestPointSample` and `deltaE76` signatures match between Task 8 source and existing usages in `MaterialPalettePicker.tsx` ✓
