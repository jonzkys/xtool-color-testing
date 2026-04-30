# Saved Spectrums (stage 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist a cropped + fitted 1D sub-spectrum (data points inside the crop, per-channel Lab polynomial, R² per channel, axis bounds) and surface a top-level browse page so the user can save, list, and delete saved spectrums.

**Architecture:** Three normalised SQL tables (`saved_spectrums` parent, `saved_spectrum_swatches` child, `saved_spectrum_fit_coefficients` child) with cascade-delete on the parent. Five REST endpoints under `/api/spectrums`. The polyfit is computed client-side (existing math in `web/src/color/math.ts`); the backend persists what was computed plus server-derived bbox/centroid columns indexed for the future colour-→-spectrum predictor query. New "Save" affordance lives inside `FitPanel` on the spectrum page; new top-level page `#/saved-spectrums` lists records via the existing repository pattern.

**Tech Stack:** Python 3.12 (FastAPI, SQLAlchemy core, Alembic, Pydantic v2, pytest), TypeScript (React 18, Vite, vitest, RTL).

---

## File Structure

### Backend (Python)

| Path | Responsibility |
|---|---|
| `alembic/versions/0015_saved_spectrums.py` (new) | Migration creating the three tables + their indexes + cascade FKs |
| `.github/workflows/ci.yml` (modify ~line 144) | Bump hardcoded alembic head check from `0014` → `0015` |
| `src/xcs_gen_web/models.py` (modify) | Add `saved_spectrums`, `saved_spectrum_swatches`, `saved_spectrum_fit_coefficients` `Table` declarations |
| `src/xcs_gen_web/schemas.py` (modify) | Add `SavedSpectrumSwatchInput`, `SavedSpectrumCoefficientsInput`, `SavedSpectrumCreate`, `SavedSpectrumPatch`, `SavedSpectrumResponse` |
| `src/xcs_gen_web/repositories/saved_spectrums.py` (new) | CRUD repository — multi-table transactions, owner+machine scoping, server-derived bbox/centroid |
| `src/xcs_gen_web/app.py` (modify) | Five endpoints under `/api/spectrums` |
| `tests/test_saved_spectrums_repo.py` (new) | Repository unit tests — bbox derivation, cascade delete, fit-coefficient round-trip |
| `tests/test_saved_spectrums_api.py` (new) | Endpoint integration tests — POST/GET list/GET detail/PATCH/DELETE happy paths + validation failures |

### Frontend (TypeScript / React)

| Path | Responsibility |
|---|---|
| `web/src/types.ts` (modify) | `SavedSpectrum`, `SavedSpectrumCreate`, `SavedSpectrumSwatch`, `SavedSpectrumCoefficient` types |
| `web/src/api/savedSpectrums.ts` (new) | `listSpectrums`, `getSpectrum`, `createSpectrum`, `patchSpectrum`, `deleteSpectrum` via the existing `j()` fetch helper |
| `web/src/api/savedSpectrums.test.ts` (new) | URL/payload-shape tests for the API helpers |
| `web/src/components/SaveSpectrumDialog.tsx` (new) | Save dialog: name input + read-only preview block; calls `createSpectrum` |
| `web/src/components/SaveSpectrumDialog.test.tsx` (new) | Default name format, disabled-state logic, submit payload shape |
| `web/src/pages/SpectrumPage.tsx` (modify around line 689 / `FitPanel`) | "Save spectrum" button inside `FitPanel`; opens the dialog with the current crop + fit |
| `web/src/pages/SavedSpectrumsPage.tsx` (new) | Top-level list page at `#/saved-spectrums` — filters, cards, delete |
| `web/src/router.ts` (modify) | New route `{ name: "saved-spectrums" }` parsed from `#/saved-spectrums` |
| `web/src/components/TopBar.tsx` (modify around line 85) | New `<TabLink>` for Saved Spectrums after Spectrum |
| `web/src/App.tsx` (modify) | Mount `SavedSpectrumsPage` for the new route name |

---

## Backend tasks

### Task 1: Alembic migration for the three tables

**Files:**
- Create: `alembic/versions/0015_saved_spectrums.py`
- Modify: `.github/workflows/ci.yml` (the hardcoded `test "$VER" = "0014"` line)

- [ ] **Step 1: Write the migration**

```python
# alembic/versions/0015_saved_spectrums.py
"""Saved spectrums — persist cropped + fitted 1D sub-spectrums.

Three tables: saved_spectrums (parent metadata + indexed Lab bbox), 
saved_spectrum_swatches (child, one row per data point inside the crop),
saved_spectrum_fit_coefficients (child, one row per (channel, degree)).

Indexed Lab bounding box on the parent supports the future colour-to-
spectrum predictor's per-material prefilter.

Revision ID: 0015
Revises: 0014
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision = "0015"
down_revision = "0014"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "saved_spectrums",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("name", sa.String(128), nullable=False),
        sa.Column(
            "source_test_id", sa.Integer,
            sa.ForeignKey("tests.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("machine_id", sa.String(64), nullable=False, server_default="F2Ultra"),
        sa.Column(
            "material_id", sa.Integer,
            sa.ForeignKey("materials.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("owner_id", sa.Integer, nullable=False),
        sa.Column("axis_param", sa.String(32), nullable=False),
        sa.Column("axis_min", sa.Float, nullable=False),
        sa.Column("axis_max", sa.Float, nullable=False),
        sa.Column("fit_form", sa.String(32), nullable=False, server_default="polynomial"),
        sa.Column("fit_degree", sa.Integer, nullable=False),
        sa.Column("fit_l_r2", sa.Float, nullable=False),
        sa.Column("fit_a_r2", sa.Float, nullable=False),
        sa.Column("fit_b_r2", sa.Float, nullable=False),
        sa.Column("fit_r2_min", sa.Float, nullable=False),
        sa.Column("displayed_projection", sa.String(32), nullable=False),
        sa.Column("lab_l_min", sa.Float, nullable=False),
        sa.Column("lab_l_max", sa.Float, nullable=False),
        sa.Column("lab_a_min", sa.Float, nullable=False),
        sa.Column("lab_a_max", sa.Float, nullable=False),
        sa.Column("lab_b_min", sa.Float, nullable=False),
        sa.Column("lab_b_max", sa.Float, nullable=False),
        sa.Column("lab_l_centroid", sa.Float, nullable=False),
        sa.Column("lab_a_centroid", sa.Float, nullable=False),
        sa.Column("lab_b_centroid", sa.Float, nullable=False),
        sa.Column("created_at", sa.String(40), nullable=False),
        sa.CheckConstraint(
            "fit_degree BETWEEN 1 AND 3",
            name="saved_spectrums_fit_degree_chk",
        ),
    )
    op.create_index(
        "ix_saved_spectrums_owner_machine_created",
        "saved_spectrums",
        ["owner_id", "machine_id", "created_at"],
    )
    op.create_index(
        "ix_saved_spectrums_material_lab_l",
        "saved_spectrums",
        ["material_id", "lab_l_min", "lab_l_max"],
    )
    op.create_index(
        "ix_saved_spectrums_material_lab_a",
        "saved_spectrums",
        ["material_id", "lab_a_min", "lab_a_max"],
    )
    op.create_index(
        "ix_saved_spectrums_material_lab_b",
        "saved_spectrums",
        ["material_id", "lab_b_min", "lab_b_max"],
    )
    op.create_index(
        "ix_saved_spectrums_fit_r2_min",
        "saved_spectrums",
        ["fit_r2_min"],
    )

    op.create_table(
        "saved_spectrum_swatches",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column(
            "saved_spectrum_id", sa.Integer,
            sa.ForeignKey("saved_spectrums.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("swatch_row", sa.Integer, nullable=False),
        sa.Column("swatch_col", sa.Integer, nullable=False),
        sa.Column("x_value", sa.Float, nullable=False),
        sa.Column("hex", sa.String(7), nullable=False),
        sa.Column("lab_l", sa.Float, nullable=False),
        sa.Column("lab_a", sa.Float, nullable=False),
        sa.Column("lab_b", sa.Float, nullable=False),
        sa.UniqueConstraint(
            "saved_spectrum_id", "swatch_row", "swatch_col",
            name="uq_saved_spectrum_swatch_cell",
        ),
    )
    op.create_index(
        "ix_saved_spectrum_swatches_parent",
        "saved_spectrum_swatches",
        ["saved_spectrum_id"],
    )

    op.create_table(
        "saved_spectrum_fit_coefficients",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column(
            "saved_spectrum_id", sa.Integer,
            sa.ForeignKey("saved_spectrums.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("channel", sa.String(1), nullable=False),
        sa.Column("degree", sa.Integer, nullable=False),
        sa.Column("coeff", sa.Float, nullable=False),
        sa.CheckConstraint(
            "channel IN ('l','a','b')",
            name="saved_spectrum_fit_coefficients_channel_chk",
        ),
        sa.UniqueConstraint(
            "saved_spectrum_id", "channel", "degree",
            name="uq_saved_spectrum_fit_coeff_cell",
        ),
    )
    op.create_index(
        "ix_saved_spectrum_fit_coefficients_parent",
        "saved_spectrum_fit_coefficients",
        ["saved_spectrum_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_saved_spectrum_fit_coefficients_parent", "saved_spectrum_fit_coefficients")
    op.drop_table("saved_spectrum_fit_coefficients")
    op.drop_index("ix_saved_spectrum_swatches_parent", "saved_spectrum_swatches")
    op.drop_table("saved_spectrum_swatches")
    op.drop_index("ix_saved_spectrums_fit_r2_min", "saved_spectrums")
    op.drop_index("ix_saved_spectrums_material_lab_b", "saved_spectrums")
    op.drop_index("ix_saved_spectrums_material_lab_a", "saved_spectrums")
    op.drop_index("ix_saved_spectrums_material_lab_l", "saved_spectrums")
    op.drop_index("ix_saved_spectrums_owner_machine_created", "saved_spectrums")
    op.drop_table("saved_spectrums")
```

- [ ] **Step 2: Update CI alembic head check**

Open `.github/workflows/ci.yml`, find the line `test "$VER" = "0014"`, change to `test "$VER" = "0015"`. (Per CLAUDE.md: this MUST land in the same commit as the migration to keep CI green.)

- [ ] **Step 3: Run migration locally to verify it applies cleanly**

Run: `uv run --active alembic upgrade head`
Expected: stdout includes `Running upgrade 0014 -> 0015, Saved spectrums`.

- [ ] **Step 4: Run downgrade then upgrade to verify reversibility**

Run: `uv run --active alembic downgrade 0014 && uv run --active alembic upgrade head`
Expected: both succeed cleanly with no errors.

- [ ] **Step 5: Commit**

```bash
git add alembic/versions/0015_saved_spectrums.py .github/workflows/ci.yml
git commit -m "feat(saved-spectrums): alembic 0015 — three-table schema for saved sub-spectrums"
```

---

### Task 2: SQLAlchemy models for the new tables

**Files:**
- Modify: `src/xcs_gen_web/models.py` (add three `Table` declarations after `palette_entries`)

- [ ] **Step 1: Add the three model tables**

Append after the existing `palette_entries` table definition. The constants `_NAME_LEN`, `_ISO_TS_LEN`, `_VISIBILITY_LEN`, `_MACHINE_ID_LEN`, `_COLOR_HEX_LEN` already exist at the top of the file — reuse them.

```python
# Inserted after palette_entries.

saved_spectrums = Table(
    "saved_spectrums", metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("name", String(_NAME_LEN), nullable=False),
    # source_test_id NULLs out via ON DELETE SET NULL when the source
    # test is deleted — saved spectrums are self-contained predictors;
    # losing the test reference is acceptable, losing the data isn't.
    Column(
        "source_test_id", Integer,
        ForeignKey("tests.id", ondelete="SET NULL"),
        nullable=True,
    ),
    Column("machine_id", String(_MACHINE_ID_LEN), nullable=False, server_default="F2Ultra"),
    Column(
        "material_id", Integer,
        ForeignKey("materials.id", ondelete="SET NULL"),
        nullable=True,
    ),
    Column("owner_id", Integer, nullable=False),
    Column("axis_param", String(32), nullable=False),
    Column("axis_min", Float, nullable=False),
    Column("axis_max", Float, nullable=False),
    Column("fit_form", String(32), nullable=False, server_default="polynomial"),
    Column("fit_degree", Integer, nullable=False),
    Column("fit_l_r2", Float, nullable=False),
    Column("fit_a_r2", Float, nullable=False),
    Column("fit_b_r2", Float, nullable=False),
    Column("fit_r2_min", Float, nullable=False),
    Column("displayed_projection", String(32), nullable=False),
    Column("lab_l_min", Float, nullable=False),
    Column("lab_l_max", Float, nullable=False),
    Column("lab_a_min", Float, nullable=False),
    Column("lab_a_max", Float, nullable=False),
    Column("lab_b_min", Float, nullable=False),
    Column("lab_b_max", Float, nullable=False),
    Column("lab_l_centroid", Float, nullable=False),
    Column("lab_a_centroid", Float, nullable=False),
    Column("lab_b_centroid", Float, nullable=False),
    Column("created_at", String(_ISO_TS_LEN), nullable=False),
    CheckConstraint(
        "fit_degree BETWEEN 1 AND 3",
        name="saved_spectrums_fit_degree_chk",
    ),
    Index(
        "ix_saved_spectrums_owner_machine_created",
        "owner_id", "machine_id", "created_at",
    ),
    Index(
        "ix_saved_spectrums_material_lab_l",
        "material_id", "lab_l_min", "lab_l_max",
    ),
    Index(
        "ix_saved_spectrums_material_lab_a",
        "material_id", "lab_a_min", "lab_a_max",
    ),
    Index(
        "ix_saved_spectrums_material_lab_b",
        "material_id", "lab_b_min", "lab_b_max",
    ),
    Index("ix_saved_spectrums_fit_r2_min", "fit_r2_min"),
)

saved_spectrum_swatches = Table(
    "saved_spectrum_swatches", metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column(
        "saved_spectrum_id", Integer,
        ForeignKey("saved_spectrums.id", ondelete="CASCADE"),
        nullable=False,
    ),
    Column("swatch_row", Integer, nullable=False),
    Column("swatch_col", Integer, nullable=False),
    Column("x_value", Float, nullable=False),
    Column("hex", String(_COLOR_HEX_LEN), nullable=False),
    Column("lab_l", Float, nullable=False),
    Column("lab_a", Float, nullable=False),
    Column("lab_b", Float, nullable=False),
    UniqueConstraint(
        "saved_spectrum_id", "swatch_row", "swatch_col",
        name="uq_saved_spectrum_swatch_cell",
    ),
    Index("ix_saved_spectrum_swatches_parent", "saved_spectrum_id"),
)

saved_spectrum_fit_coefficients = Table(
    "saved_spectrum_fit_coefficients", metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column(
        "saved_spectrum_id", Integer,
        ForeignKey("saved_spectrums.id", ondelete="CASCADE"),
        nullable=False,
    ),
    Column("channel", String(1), nullable=False),
    Column("degree", Integer, nullable=False),
    Column("coeff", Float, nullable=False),
    CheckConstraint(
        "channel IN ('l','a','b')",
        name="saved_spectrum_fit_coefficients_channel_chk",
    ),
    UniqueConstraint(
        "saved_spectrum_id", "channel", "degree",
        name="uq_saved_spectrum_fit_coeff_cell",
    ),
    Index("ix_saved_spectrum_fit_coefficients_parent", "saved_spectrum_id"),
)
```

The imports at the top of `models.py` already include `Boolean, CheckConstraint, Column, Float, ForeignKey, Index, Integer, String, Table, Text, UniqueConstraint, metadata`. If `UniqueConstraint` is not yet imported, add it to the existing import list.

- [ ] **Step 2: Sanity-check the import side-effect**

Run: `uv run --active python -c "from xcs_gen_web.models import saved_spectrums, saved_spectrum_swatches, saved_spectrum_fit_coefficients; print('ok')"`
Expected: `ok`

- [ ] **Step 3: Commit**

```bash
git add src/xcs_gen_web/models.py
git commit -m "feat(saved-spectrums): SQLAlchemy table declarations"
```

---

### Task 3: Pydantic schemas

**Files:**
- Modify: `src/xcs_gen_web/schemas.py` (append new classes near the end, after the existing palette/result/test schemas)

- [ ] **Step 1: Add the schemas**

Append these classes. The existing file already imports `BaseModel`, `Field`, `Literal`. If `Literal` isn't already imported from `typing`, add it.

```python
# Saved Spectrums (stage 1) ------------------------------------------------

class SavedSpectrumSwatchInput(BaseModel):
    """One data point inside a saved sub-spectrum's crop."""
    swatch_row: int = Field(ge=0)
    swatch_col: int = Field(ge=0)
    x_value: float
    hex: str = Field(pattern=r"^#[0-9a-fA-F]{6}$")
    lab: tuple[float, float, float]


class SavedSpectrumCreate(BaseModel):
    """Body of POST /api/spectrums."""
    name: str = Field(min_length=1, max_length=128)
    source_test_id: int = Field(ge=1)
    axis_param: str = Field(min_length=1, max_length=32)
    axis_min: float
    axis_max: float
    fit_form: Literal["polynomial"] = "polynomial"
    fit_degree: int = Field(ge=1, le=3)
    # One coefficient list per channel; length must equal fit_degree + 1.
    fit_coefficients: dict[Literal["l", "a", "b"], list[float]]
    # Per-channel R²; length is always 3.
    fit_r2: dict[Literal["l", "a", "b"], float]
    displayed_projection: str = Field(min_length=1, max_length=32)
    swatches: list[SavedSpectrumSwatchInput] = Field(min_length=2)


class SavedSpectrumPatch(BaseModel):
    """Body of PATCH /api/spectrums/{id}. Only ``name`` is mutable in stage 1."""
    name: str | None = Field(default=None, min_length=1, max_length=128)


class SavedSpectrumSwatchResponse(BaseModel):
    swatch_row: int
    swatch_col: int
    x_value: float
    hex: str
    lab: tuple[float, float, float]


class SavedSpectrumResponse(BaseModel):
    id: int
    name: str
    source_test_id: int | None
    machine_id: str
    material_id: int | None
    owner_id: int
    axis_param: str
    axis_min: float
    axis_max: float
    fit_form: str
    fit_degree: int
    fit_coefficients: dict[Literal["l", "a", "b"], list[float]]
    fit_r2: dict[Literal["l", "a", "b"], float]
    fit_r2_min: float
    displayed_projection: str
    lab_l_min: float; lab_l_max: float
    lab_a_min: float; lab_a_max: float
    lab_b_min: float; lab_b_max: float
    lab_l_centroid: float
    lab_a_centroid: float
    lab_b_centroid: float
    swatches: list[SavedSpectrumSwatchResponse]
    created_at: str
```

- [ ] **Step 2: Smoke-import**

Run: `uv run --active python -c "from xcs_gen_web.schemas import SavedSpectrumCreate, SavedSpectrumResponse, SavedSpectrumPatch; print('ok')"`
Expected: `ok`

- [ ] **Step 3: Commit**

```bash
git add src/xcs_gen_web/schemas.py
git commit -m "feat(saved-spectrums): pydantic schemas for create/patch/response"
```

---

### Task 4: Repository — happy-path create + read

**Files:**
- Create: `src/xcs_gen_web/repositories/saved_spectrums.py`
- Create: `tests/test_saved_spectrums_repo.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_saved_spectrums_repo.py
"""Repository unit tests for saved spectrums.

Covers:
* create() persists across all three tables and derives bbox/centroid
* get() reassembles the parent + children into the response shape
* delete() cascades to swatches + coefficients
* delete_test() preserves the saved spectrum but nulls source_test_id
"""

from __future__ import annotations

from xcs_gen_web.repositories import saved_spectrums as ss_repo
from xcs_gen_web.repositories import materials as m_repo
from xcs_gen_web.repositories import tests as t_repo


_BASE_PARAMS = {
    "power": 50, "speed": 1000, "frequency": 60,
    "density": 200, "passes": 1, "pulse_width": 200, "laser": "red",
}
_TEST_SPEC = {
    "x_param": "speed", "x_min": 500, "x_max": 3000, "x_steps": 6,
    "rows": 1, "width_mm": 30, "height_mm": 10, "gap_mm": 0.5,
    "cell_shape": "rect", "square_cells": True, "angle_mode": "fixed",
    "unidirectional": False, "base_params": _BASE_PARAMS,
    "registration": {"mode": "on"},
}

# Five mid-grey-to-blue swatches inside a fictional crop on speed.
_SWATCHES = [
    {"swatch_row": 0, "swatch_col": 1, "x_value": 1000.0,
     "hex": "#404060", "lab": (28.0, 5.0, -22.0)},
    {"swatch_row": 0, "swatch_col": 2, "x_value": 1500.0,
     "hex": "#506080", "lab": (38.0, 4.0, -25.0)},
    {"swatch_row": 0, "swatch_col": 3, "x_value": 2000.0,
     "hex": "#7080a0", "lab": (50.0, 3.0, -22.0)},
    {"swatch_row": 0, "swatch_col": 4, "x_value": 2500.0,
     "hex": "#90a0c0", "lab": (62.0, 2.0, -18.0)},
    {"swatch_row": 0, "swatch_col": 5, "x_value": 3000.0,
     "hex": "#b0c0e0", "lab": (75.0, 1.0, -10.0)},
]
_FIT_COEFFS = {
    "l": [10.0, 0.022, 0.0],            # degree 2: c0 + c1*x + c2*x^2
    "a": [6.0, -0.0017, 0.0],
    "b": [-25.0, 0.005, 0.0],
}
_FIT_R2 = {"l": 0.999, "a": 0.95, "b": 0.92}


def _setup_test(fresh_db) -> int:
    mid = m_repo.create(name="SS Tag")["id"]
    return t_repo.create(name="Speed sweep", material_id=mid, spec=_TEST_SPEC)["id"]


def test_create_persists_across_three_tables_and_derives_bbox(fresh_db):
    tid = _setup_test(fresh_db)
    rec = ss_repo.create({
        "name": "SS Blue 1000-3000",
        "source_test_id": tid,
        "axis_param": "speed",
        "axis_min": 1000.0,
        "axis_max": 3000.0,
        "fit_form": "polynomial",
        "fit_degree": 2,
        "fit_coefficients": _FIT_COEFFS,
        "fit_r2": _FIT_R2,
        "displayed_projection": "lightness",
        "swatches": _SWATCHES,
    })

    # Top-level columns
    assert rec["id"] >= 1
    assert rec["name"] == "SS Blue 1000-3000"
    assert rec["source_test_id"] == tid
    assert rec["axis_param"] == "speed"
    assert rec["fit_degree"] == 2
    assert rec["fit_r2"]["l"] == 0.999
    assert rec["fit_r2_min"] == 0.92  # min across L/a/b

    # Bbox derived server-side from the swatches.
    assert rec["lab_l_min"] == 28.0
    assert rec["lab_l_max"] == 75.0
    assert rec["lab_a_min"] == 1.0
    assert rec["lab_a_max"] == 5.0
    assert rec["lab_b_min"] == -25.0
    assert rec["lab_b_max"] == -10.0

    # Centroids = mean of each channel.
    assert abs(rec["lab_l_centroid"] - (28+38+50+62+75)/5) < 1e-9
    assert abs(rec["lab_a_centroid"] - (5+4+3+2+1)/5) < 1e-9

    # Children round-trip.
    assert len(rec["swatches"]) == 5
    assert {s["x_value"] for s in rec["swatches"]} == {1000.0, 1500.0, 2000.0, 2500.0, 3000.0}
    assert rec["fit_coefficients"]["l"] == [10.0, 0.022, 0.0]


def test_get_returns_full_record(fresh_db):
    tid = _setup_test(fresh_db)
    rec = ss_repo.create({
        "name": "thing", "source_test_id": tid,
        "axis_param": "speed", "axis_min": 1000.0, "axis_max": 3000.0,
        "fit_form": "polynomial", "fit_degree": 2,
        "fit_coefficients": _FIT_COEFFS, "fit_r2": _FIT_R2,
        "displayed_projection": "lightness",
        "swatches": _SWATCHES,
    })
    got = ss_repo.get(rec["id"])
    assert got is not None
    assert got["id"] == rec["id"]
    assert len(got["swatches"]) == 5
    assert set(got["fit_coefficients"].keys()) == {"l", "a", "b"}


def test_delete_cascades_to_children(fresh_db):
    tid = _setup_test(fresh_db)
    rec = ss_repo.create({
        "name": "thing", "source_test_id": tid,
        "axis_param": "speed", "axis_min": 1000.0, "axis_max": 3000.0,
        "fit_form": "polynomial", "fit_degree": 2,
        "fit_coefficients": _FIT_COEFFS, "fit_r2": _FIT_R2,
        "displayed_projection": "lightness",
        "swatches": _SWATCHES,
    })
    ss_repo.delete(rec["id"])
    assert ss_repo.get(rec["id"]) is None
    # Direct count check on children.
    from xcs_gen_web.db import session_scope
    from xcs_gen_web.models import (
        saved_spectrum_swatches, saved_spectrum_fit_coefficients,
    )
    from sqlalchemy import select, func
    with session_scope() as s:
        n_sw = s.execute(
            select(func.count()).select_from(saved_spectrum_swatches)
            .where(saved_spectrum_swatches.c.saved_spectrum_id == rec["id"])
        ).scalar()
        n_co = s.execute(
            select(func.count()).select_from(saved_spectrum_fit_coefficients)
            .where(saved_spectrum_fit_coefficients.c.saved_spectrum_id == rec["id"])
        ).scalar()
        assert n_sw == 0
        assert n_co == 0


def test_source_test_delete_nulls_reference(fresh_db):
    tid = _setup_test(fresh_db)
    rec = ss_repo.create({
        "name": "thing", "source_test_id": tid,
        "axis_param": "speed", "axis_min": 1000.0, "axis_max": 3000.0,
        "fit_form": "polynomial", "fit_degree": 2,
        "fit_coefficients": _FIT_COEFFS, "fit_r2": _FIT_R2,
        "displayed_projection": "lightness",
        "swatches": _SWATCHES,
    })
    t_repo.delete(tid)
    got = ss_repo.get(rec["id"])
    assert got is not None
    assert got["source_test_id"] is None
    assert len(got["swatches"]) == 5  # data preserved
```

- [ ] **Step 2: Run the test to verify it fails for the right reason**

Run: `cd /Users/jonzky/Documents/XTools/Reverse && uv run --active pytest tests/test_saved_spectrums_repo.py -v`
Expected: errors with `ImportError: cannot import name 'saved_spectrums' from 'xcs_gen_web.repositories'` (the repo module doesn't exist yet).

- [ ] **Step 3: Create the repository module**

```python
# src/xcs_gen_web/repositories/saved_spectrums.py
"""Saved spectrums repository — multi-table CRUD.

The parent row in ``saved_spectrums`` carries the indexed Lab bounding
box and centroid (server-derived from the supplied swatches — never
client-supplied for derived numbers). The two child tables hold the
raw swatches and the polynomial coefficients respectively. All three
inserts run in one transaction; cascade-delete cleans up children.

Material/machine FKs are denormalised from the source test at create
time so future predictor queries can prefilter by material without
joining ``tests``.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from sqlalchemy import and_, delete as sa_delete, select, update

from ..config import STANDALONE_USER_ID
from ..db import session_scope
from ..models import (
    saved_spectrums,
    saved_spectrum_swatches,
    saved_spectrum_fit_coefficients,
    tests,
)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _bbox_and_centroid(swatches: list[dict[str, Any]]) -> dict[str, float]:
    """Server-derived Lab bbox + centroid from supplied swatches."""
    Ls = [s["lab"][0] for s in swatches]
    As = [s["lab"][1] for s in swatches]
    Bs = [s["lab"][2] for s in swatches]
    n = len(swatches)
    return {
        "lab_l_min": min(Ls), "lab_l_max": max(Ls),
        "lab_a_min": min(As), "lab_a_max": max(As),
        "lab_b_min": min(Bs), "lab_b_max": max(Bs),
        "lab_l_centroid": sum(Ls) / n,
        "lab_a_centroid": sum(As) / n,
        "lab_b_centroid": sum(Bs) / n,
    }


def _row_to_record(
    s, parent_row, swatch_rows, coefficient_rows,
) -> dict[str, Any]:
    fit_coefficients: dict[str, list[float]] = {"l": [], "a": [], "b": []}
    # Order rows by degree so coeffs[0] is c0, coeffs[1] is c1, etc.
    for row in sorted(coefficient_rows, key=lambda r: (r.channel, r.degree)):
        fit_coefficients[row.channel].append(row.coeff)
    return {
        "id": parent_row.id,
        "name": parent_row.name,
        "source_test_id": parent_row.source_test_id,
        "machine_id": parent_row.machine_id,
        "material_id": parent_row.material_id,
        "owner_id": parent_row.owner_id,
        "axis_param": parent_row.axis_param,
        "axis_min": parent_row.axis_min,
        "axis_max": parent_row.axis_max,
        "fit_form": parent_row.fit_form,
        "fit_degree": parent_row.fit_degree,
        "fit_coefficients": fit_coefficients,
        "fit_r2": {
            "l": parent_row.fit_l_r2,
            "a": parent_row.fit_a_r2,
            "b": parent_row.fit_b_r2,
        },
        "fit_r2_min": parent_row.fit_r2_min,
        "displayed_projection": parent_row.displayed_projection,
        "lab_l_min": parent_row.lab_l_min, "lab_l_max": parent_row.lab_l_max,
        "lab_a_min": parent_row.lab_a_min, "lab_a_max": parent_row.lab_a_max,
        "lab_b_min": parent_row.lab_b_min, "lab_b_max": parent_row.lab_b_max,
        "lab_l_centroid": parent_row.lab_l_centroid,
        "lab_a_centroid": parent_row.lab_a_centroid,
        "lab_b_centroid": parent_row.lab_b_centroid,
        "swatches": [
            {
                "swatch_row": r.swatch_row,
                "swatch_col": r.swatch_col,
                "x_value": r.x_value,
                "hex": r.hex,
                "lab": (r.lab_l, r.lab_a, r.lab_b),
            }
            for r in sorted(swatch_rows, key=lambda r: (r.swatch_row, r.swatch_col))
        ],
        "created_at": parent_row.created_at,
    }


def create(
    payload: dict[str, Any],
    *,
    owner_id: int = STANDALONE_USER_ID,
) -> dict[str, Any]:
    """Create a saved spectrum from a validated payload.

    Looks up ``machine_id`` and ``material_id`` from the source test
    so the FK denormalisation is server-driven. Caller (the API
    handler) is responsible for verifying that the requesting user
    can read the source test.

    Returns the freshly created record in response shape.
    """
    swatches = payload["swatches"]
    fit_coefficients = payload["fit_coefficients"]
    fit_r2 = payload["fit_r2"]
    fit_r2_min = min(fit_r2["l"], fit_r2["a"], fit_r2["b"])
    bbox = _bbox_and_centroid(swatches)
    now = _now()

    with session_scope() as s:
        # Derive machine_id and material_id from the source test.
        test_row = s.execute(
            select(tests.c.machine_id, tests.c.material_id)
            .where(tests.c.id == payload["source_test_id"])
        ).one_or_none()
        if test_row is None:
            raise LookupError(
                f"source test {payload['source_test_id']!r} not found",
            )

        result = s.execute(
            saved_spectrums.insert().values(
                name=payload["name"],
                source_test_id=payload["source_test_id"],
                machine_id=test_row.machine_id,
                material_id=test_row.material_id,
                owner_id=owner_id,
                axis_param=payload["axis_param"],
                axis_min=payload["axis_min"],
                axis_max=payload["axis_max"],
                fit_form=payload["fit_form"],
                fit_degree=payload["fit_degree"],
                fit_l_r2=fit_r2["l"],
                fit_a_r2=fit_r2["a"],
                fit_b_r2=fit_r2["b"],
                fit_r2_min=fit_r2_min,
                displayed_projection=payload["displayed_projection"],
                created_at=now,
                **bbox,
            )
        )
        new_id = result.inserted_primary_key[0]

        if swatches:
            s.execute(
                saved_spectrum_swatches.insert(),
                [
                    {
                        "saved_spectrum_id": new_id,
                        "swatch_row": w["swatch_row"],
                        "swatch_col": w["swatch_col"],
                        "x_value": w["x_value"],
                        "hex": w["hex"],
                        "lab_l": w["lab"][0],
                        "lab_a": w["lab"][1],
                        "lab_b": w["lab"][2],
                    }
                    for w in swatches
                ],
            )

        coeff_rows = []
        for channel in ("l", "a", "b"):
            for degree, coeff in enumerate(fit_coefficients[channel]):
                coeff_rows.append({
                    "saved_spectrum_id": new_id,
                    "channel": channel,
                    "degree": degree,
                    "coeff": coeff,
                })
        if coeff_rows:
            s.execute(saved_spectrum_fit_coefficients.insert(), coeff_rows)

        return _read_within_session(s, new_id)


def _read_within_session(s, spectrum_id: int) -> dict[str, Any] | None:
    """Reassemble a full record while the session is still open."""
    parent = s.execute(
        select(saved_spectrums).where(saved_spectrums.c.id == spectrum_id)
    ).one_or_none()
    if parent is None:
        return None
    swatch_rows = s.execute(
        select(saved_spectrum_swatches)
        .where(saved_spectrum_swatches.c.saved_spectrum_id == spectrum_id)
    ).all()
    coefficient_rows = s.execute(
        select(saved_spectrum_fit_coefficients)
        .where(
            saved_spectrum_fit_coefficients.c.saved_spectrum_id == spectrum_id
        )
    ).all()
    return _row_to_record(s, parent, swatch_rows, coefficient_rows)


def get(spectrum_id: int) -> dict[str, Any] | None:
    """Fetch a single saved spectrum by id, or None if not found."""
    with session_scope() as s:
        return _read_within_session(s, spectrum_id)


def delete(spectrum_id: int) -> None:
    """Delete a saved spectrum. Cascades to children via FK ON DELETE CASCADE."""
    with session_scope() as s:
        s.execute(
            sa_delete(saved_spectrums).where(saved_spectrums.c.id == spectrum_id)
        )
```

- [ ] **Step 4: Run the failing test again — should now pass**

Run: `cd /Users/jonzky/Documents/XTools/Reverse && uv run --active pytest tests/test_saved_spectrums_repo.py -v`
Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/xcs_gen_web/repositories/saved_spectrums.py tests/test_saved_spectrums_repo.py
git commit -m "feat(saved-spectrums): repository CRUD with bbox/centroid derivation"
```

---

### Task 5: Repository — list with filters + patch

**Files:**
- Modify: `src/xcs_gen_web/repositories/saved_spectrums.py`
- Modify: `tests/test_saved_spectrums_repo.py`

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_saved_spectrums_repo.py`:

```python
def test_list_returns_owner_machine_scoped_records_newest_first(fresh_db):
    tid = _setup_test(fresh_db)
    older = ss_repo.create({
        "name": "older", "source_test_id": tid,
        "axis_param": "speed", "axis_min": 1000.0, "axis_max": 3000.0,
        "fit_form": "polynomial", "fit_degree": 2,
        "fit_coefficients": _FIT_COEFFS, "fit_r2": _FIT_R2,
        "displayed_projection": "lightness", "swatches": _SWATCHES,
    })
    newer = ss_repo.create({
        "name": "newer", "source_test_id": tid,
        "axis_param": "speed", "axis_min": 1000.0, "axis_max": 3000.0,
        "fit_form": "polynomial", "fit_degree": 2,
        "fit_coefficients": _FIT_COEFFS, "fit_r2": _FIT_R2,
        "displayed_projection": "lightness", "swatches": _SWATCHES,
    })
    rows = ss_repo.list_(machine_id="F2Ultra")
    ids = [r["id"] for r in rows]
    # newer first, older second
    assert ids == [newer["id"], older["id"]]


def test_list_filters_by_min_r2(fresh_db):
    tid = _setup_test(fresh_db)
    weak = ss_repo.create({
        "name": "weak", "source_test_id": tid,
        "axis_param": "speed", "axis_min": 1000.0, "axis_max": 3000.0,
        "fit_form": "polynomial", "fit_degree": 2,
        "fit_coefficients": _FIT_COEFFS,
        "fit_r2": {"l": 0.5, "a": 0.6, "b": 0.7},  # min is 0.5
        "displayed_projection": "lightness", "swatches": _SWATCHES,
    })
    strong = ss_repo.create({
        "name": "strong", "source_test_id": tid,
        "axis_param": "speed", "axis_min": 1000.0, "axis_max": 3000.0,
        "fit_form": "polynomial", "fit_degree": 2,
        "fit_coefficients": _FIT_COEFFS,
        "fit_r2": {"l": 0.99, "a": 0.95, "b": 0.92},  # min is 0.92
        "displayed_projection": "lightness", "swatches": _SWATCHES,
    })
    ids = [r["id"] for r in ss_repo.list_(machine_id="F2Ultra", min_r2=0.9)]
    assert strong["id"] in ids
    assert weak["id"] not in ids


def test_list_filters_by_source_test(fresh_db):
    t1 = _setup_test(fresh_db)
    other_mid = m_repo.create(name="OtherMat")["id"]
    t2 = t_repo.create(name="Other test", material_id=other_mid, spec=_TEST_SPEC)["id"]
    a = ss_repo.create({
        "name": "a", "source_test_id": t1,
        "axis_param": "speed", "axis_min": 1000.0, "axis_max": 3000.0,
        "fit_form": "polynomial", "fit_degree": 2,
        "fit_coefficients": _FIT_COEFFS, "fit_r2": _FIT_R2,
        "displayed_projection": "lightness", "swatches": _SWATCHES,
    })
    ss_repo.create({
        "name": "b", "source_test_id": t2,
        "axis_param": "speed", "axis_min": 1000.0, "axis_max": 3000.0,
        "fit_form": "polynomial", "fit_degree": 2,
        "fit_coefficients": _FIT_COEFFS, "fit_r2": _FIT_R2,
        "displayed_projection": "lightness", "swatches": _SWATCHES,
    })
    ids = [r["id"] for r in ss_repo.list_(machine_id="F2Ultra", source_test_id=t1)]
    assert ids == [a["id"]]


def test_patch_renames_only(fresh_db):
    tid = _setup_test(fresh_db)
    rec = ss_repo.create({
        "name": "old name", "source_test_id": tid,
        "axis_param": "speed", "axis_min": 1000.0, "axis_max": 3000.0,
        "fit_form": "polynomial", "fit_degree": 2,
        "fit_coefficients": _FIT_COEFFS, "fit_r2": _FIT_R2,
        "displayed_projection": "lightness", "swatches": _SWATCHES,
    })
    updated = ss_repo.patch(rec["id"], {"name": "new name"})
    assert updated["name"] == "new name"
    # Children untouched.
    assert len(updated["swatches"]) == 5
```

- [ ] **Step 2: Run — expect failures**

Run: `uv run --active pytest tests/test_saved_spectrums_repo.py -v -k "list_ or patch"`
Expected: errors complaining `module has no attribute 'list_'` / `'patch'`.

- [ ] **Step 3: Add the helpers to the repository**

Append to `src/xcs_gen_web/repositories/saved_spectrums.py`:

```python
def list_(
    *,
    machine_id: str,
    material_id: int | None = None,
    min_r2: float | None = None,
    source_test_id: int | None = None,
    owner_id: int = STANDALONE_USER_ID,
) -> list[dict[str, Any]]:
    """List saved spectrums for the (owner, machine) scope.

    Optional filters: ``material_id``, ``min_r2`` (excludes anything
    with fit_r2_min below the threshold), ``source_test_id``.
    Newest-first by created_at.
    """
    with session_scope() as s:
        clauses = [
            saved_spectrums.c.owner_id == owner_id,
            saved_spectrums.c.machine_id == machine_id,
        ]
        if material_id is not None:
            clauses.append(saved_spectrums.c.material_id == material_id)
        if min_r2 is not None:
            clauses.append(saved_spectrums.c.fit_r2_min >= min_r2)
        if source_test_id is not None:
            clauses.append(saved_spectrums.c.source_test_id == source_test_id)
        parent_rows = s.execute(
            select(saved_spectrums)
            .where(and_(*clauses))
            .order_by(saved_spectrums.c.created_at.desc())
        ).all()
        if not parent_rows:
            return []
        ids = [r.id for r in parent_rows]
        all_swatches = s.execute(
            select(saved_spectrum_swatches)
            .where(saved_spectrum_swatches.c.saved_spectrum_id.in_(ids))
        ).all()
        all_coeffs = s.execute(
            select(saved_spectrum_fit_coefficients)
            .where(saved_spectrum_fit_coefficients.c.saved_spectrum_id.in_(ids))
        ).all()
        # Bucket children by parent id for assembly.
        sw_by_id: dict[int, list] = {i: [] for i in ids}
        co_by_id: dict[int, list] = {i: [] for i in ids}
        for r in all_swatches:
            sw_by_id[r.saved_spectrum_id].append(r)
        for r in all_coeffs:
            co_by_id[r.saved_spectrum_id].append(r)
        return [
            _row_to_record(s, p, sw_by_id[p.id], co_by_id[p.id])
            for p in parent_rows
        ]


def patch(spectrum_id: int, fields: dict[str, Any]) -> dict[str, Any] | None:
    """Apply a partial update. Stage 1 only allows ``name``."""
    allowed = {"name"}
    payload = {k: v for k, v in fields.items() if k in allowed and v is not None}
    if not payload:
        return get(spectrum_id)
    with session_scope() as s:
        s.execute(
            update(saved_spectrums)
            .where(saved_spectrums.c.id == spectrum_id)
            .values(**payload)
        )
        return _read_within_session(s, spectrum_id)
```

- [ ] **Step 4: Run — expect pass**

Run: `uv run --active pytest tests/test_saved_spectrums_repo.py -v`
Expected: all 8 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/xcs_gen_web/repositories/saved_spectrums.py tests/test_saved_spectrums_repo.py
git commit -m "feat(saved-spectrums): repository list (with filters) and patch"
```

---

### Task 6: API endpoints — POST + GET list + GET detail

**Files:**
- Modify: `src/xcs_gen_web/app.py`
- Create: `tests/test_saved_spectrums_api.py`

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_saved_spectrums_api.py
"""Endpoint tests for /api/spectrums (saved spectrums)."""

from __future__ import annotations

from fastapi.testclient import TestClient

from xcs_gen_web.app import create_app
from xcs_gen_web.repositories import materials as m_repo
from xcs_gen_web.repositories import tests as t_repo


_BASE_PARAMS = {
    "power": 50, "speed": 1000, "frequency": 60,
    "density": 200, "passes": 1, "pulse_width": 200, "laser": "red",
}
_TEST_SPEC = {
    "x_param": "speed", "x_min": 500, "x_max": 3000, "x_steps": 6,
    "rows": 1, "width_mm": 30, "height_mm": 10, "gap_mm": 0.5,
    "cell_shape": "rect", "square_cells": True, "angle_mode": "fixed",
    "unidirectional": False, "base_params": _BASE_PARAMS,
    "registration": {"mode": "on"},
}


def _payload(tid: int, name: str = "spec", min_r2: float = 0.95) -> dict:
    return {
        "name": name,
        "source_test_id": tid,
        "axis_param": "speed",
        "axis_min": 1000.0,
        "axis_max": 3000.0,
        "fit_form": "polynomial",
        "fit_degree": 2,
        "fit_coefficients": {
            "l": [10.0, 0.022, 0.0],
            "a": [6.0, -0.0017, 0.0],
            "b": [-25.0, 0.005, 0.0],
        },
        "fit_r2": {"l": 0.999, "a": min_r2, "b": 0.92},
        "displayed_projection": "lightness",
        "swatches": [
            {"swatch_row": 0, "swatch_col": 1, "x_value": 1000.0,
             "hex": "#404060", "lab": [28.0, 5.0, -22.0]},
            {"swatch_row": 0, "swatch_col": 2, "x_value": 1500.0,
             "hex": "#506080", "lab": [38.0, 4.0, -25.0]},
            {"swatch_row": 0, "swatch_col": 3, "x_value": 2000.0,
             "hex": "#7080a0", "lab": [50.0, 3.0, -22.0]},
            {"swatch_row": 0, "swatch_col": 4, "x_value": 2500.0,
             "hex": "#90a0c0", "lab": [62.0, 2.0, -18.0]},
            {"swatch_row": 0, "swatch_col": 5, "x_value": 3000.0,
             "hex": "#b0c0e0", "lab": [75.0, 1.0, -10.0]},
        ],
    }


def _setup(fresh_db):
    c = TestClient(create_app())
    mid = m_repo.create(name="SS")["id"]
    tid = t_repo.create(name="Speed sweep", material_id=mid, spec=_TEST_SPEC)["id"]
    return c, tid


def test_post_creates_record_201(fresh_db):
    c, tid = _setup(fresh_db)
    r = c.post("/api/spectrums", json=_payload(tid))
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["id"] >= 1
    assert body["source_test_id"] == tid
    assert len(body["swatches"]) == 5
    # Bbox derived server-side.
    assert body["lab_l_min"] == 28.0
    assert body["lab_l_max"] == 75.0


def test_post_rejects_mismatched_coefficient_count_422(fresh_db):
    c, tid = _setup(fresh_db)
    payload = _payload(tid)
    payload["fit_coefficients"]["l"] = [10.0, 0.022]  # only 2 for degree 2
    r = c.post("/api/spectrums", json=payload)
    assert r.status_code == 422
    assert "coefficient" in r.text.lower() or "fit_coefficients" in r.text.lower()


def test_post_rejects_too_few_swatches_422(fresh_db):
    c, tid = _setup(fresh_db)
    payload = _payload(tid)
    payload["swatches"] = payload["swatches"][:1]  # one swatch
    r = c.post("/api/spectrums", json=payload)
    # Pydantic min_length=2 on swatches catches this.
    assert r.status_code == 422


def test_post_404_for_unknown_source_test(fresh_db):
    c, _ = _setup(fresh_db)
    payload = _payload(9999)
    r = c.post("/api/spectrums", json=payload)
    assert r.status_code == 404


def test_get_list_returns_records_for_machine(fresh_db):
    c, tid = _setup(fresh_db)
    c.post("/api/spectrums", json=_payload(tid, name="alpha"))
    c.post("/api/spectrums", json=_payload(tid, name="beta"))
    r = c.get("/api/spectrums")
    assert r.status_code == 200
    rows = r.json()
    assert {row["name"] for row in rows} == {"alpha", "beta"}


def test_get_list_filters_by_min_r2(fresh_db):
    c, tid = _setup(fresh_db)
    c.post("/api/spectrums", json=_payload(tid, name="weak", min_r2=0.5))
    c.post("/api/spectrums", json=_payload(tid, name="strong", min_r2=0.99))
    r = c.get("/api/spectrums?min_r2=0.9")
    rows = r.json()
    assert {row["name"] for row in rows} == {"strong"}


def test_get_detail_404_for_unknown_id(fresh_db):
    c, _ = _setup(fresh_db)
    r = c.get("/api/spectrums/9999")
    assert r.status_code == 404
```

- [ ] **Step 2: Run — expect failures (404 from FastAPI for missing routes)**

Run: `uv run --active pytest tests/test_saved_spectrums_api.py -v`
Expected: tests fail with 404 (route not registered) on the POST/GET calls.

- [ ] **Step 3: Add the imports**

Open `src/xcs_gen_web/app.py`. Add to the existing schema imports:

```python
# Add these to the existing `from .schemas import (...)` tuple
SavedSpectrumCreate,
SavedSpectrumPatch,
SavedSpectrumResponse,
```

Add this near the other repository imports inside `create_app`:

```python
from .repositories import saved_spectrums as ss_repo
```

- [ ] **Step 4: Add the endpoints**

Add inside `create_app()` near the other result endpoints (e.g. after `results_grid_layout` if it exists, or after `results_warped_image`):

```python
    # ── Saved spectrums (stage 1: store + list, no predictor yet) ──

    @app.post(
        "/api/spectrums",
        response_model=SavedSpectrumResponse,
        status_code=201,
    )
    def saved_spectrums_create(
        body: SavedSpectrumCreate,
        user_id: int = Depends(get_current_user),
    ) -> SavedSpectrumResponse:
        # Pydantic guarantees fit_degree ∈ {1,2,3}, but it doesn't check
        # that each channel's coefficient list is the right length —
        # enforce here.
        for channel in ("l", "a", "b"):
            coeffs = body.fit_coefficients.get(channel)
            if coeffs is None or len(coeffs) != body.fit_degree + 1:
                raise HTTPException(
                    status_code=422,
                    detail=(
                        f"fit_coefficients[{channel!r}] must have length "
                        f"{body.fit_degree + 1} for fit_degree={body.fit_degree}"
                    ),
                )

        try:
            rec = ss_repo.create(
                body.model_dump(),
                owner_id=user_id,
            )
        except LookupError as e:
            raise HTTPException(status_code=404, detail=str(e))
        return SavedSpectrumResponse(**rec)

    @app.get(
        "/api/spectrums",
        response_model=list[SavedSpectrumResponse],
    )
    def saved_spectrums_list(
        request: Request,
        material_id: int | None = None,
        min_r2: float | None = None,
        source_test_id: int | None = None,
        user_id: int = Depends(get_current_user),
    ) -> list[SavedSpectrumResponse]:
        machine_id = request.headers.get("X-Machine-Id", "F2Ultra")
        rows = ss_repo.list_(
            machine_id=machine_id,
            material_id=material_id,
            min_r2=min_r2,
            source_test_id=source_test_id,
            owner_id=user_id,
        )
        return [SavedSpectrumResponse(**r) for r in rows]

    @app.get(
        "/api/spectrums/{spectrum_id}",
        response_model=SavedSpectrumResponse,
    )
    def saved_spectrums_get(
        spectrum_id: int,
        user_id: int = Depends(get_current_user),
    ) -> SavedSpectrumResponse:
        rec = ss_repo.get(spectrum_id)
        if rec is None or rec["owner_id"] != user_id:
            raise HTTPException(status_code=404, detail="saved spectrum not found")
        return SavedSpectrumResponse(**rec)
```

- [ ] **Step 5: Run — expect pass**

Run: `uv run --active pytest tests/test_saved_spectrums_api.py -v`
Expected: 7 tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/xcs_gen_web/app.py tests/test_saved_spectrums_api.py
git commit -m "feat(saved-spectrums): POST/GET list/GET detail endpoints"
```

---

### Task 7: API endpoints — PATCH + DELETE

**Files:**
- Modify: `src/xcs_gen_web/app.py`
- Modify: `tests/test_saved_spectrums_api.py`

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_saved_spectrums_api.py`:

```python
def test_patch_renames(fresh_db):
    c, tid = _setup(fresh_db)
    created = c.post("/api/spectrums", json=_payload(tid, name="old")).json()
    r = c.patch(f"/api/spectrums/{created['id']}", json={"name": "new"})
    assert r.status_code == 200
    assert r.json()["name"] == "new"


def test_patch_404_for_unknown_id(fresh_db):
    c, _ = _setup(fresh_db)
    r = c.patch("/api/spectrums/9999", json={"name": "doesn't matter"})
    assert r.status_code == 404


def test_delete_removes_record(fresh_db):
    c, tid = _setup(fresh_db)
    created = c.post("/api/spectrums", json=_payload(tid)).json()
    r = c.delete(f"/api/spectrums/{created['id']}")
    assert r.status_code == 204
    # Subsequent GET returns 404.
    r2 = c.get(f"/api/spectrums/{created['id']}")
    assert r2.status_code == 404


def test_delete_404_for_unknown_id(fresh_db):
    c, _ = _setup(fresh_db)
    r = c.delete("/api/spectrums/9999")
    assert r.status_code == 404
```

- [ ] **Step 2: Run — expect 405/404 failures**

Run: `uv run --active pytest tests/test_saved_spectrums_api.py -v -k "patch or delete"`
Expected: failures because PATCH and DELETE routes aren't registered.

- [ ] **Step 3: Add the endpoints**

Add to `create_app()` right after `saved_spectrums_get`:

```python
    @app.patch(
        "/api/spectrums/{spectrum_id}",
        response_model=SavedSpectrumResponse,
    )
    def saved_spectrums_patch(
        spectrum_id: int,
        patch_body: SavedSpectrumPatch,
        user_id: int = Depends(get_current_user),
    ) -> SavedSpectrumResponse:
        existing = ss_repo.get(spectrum_id)
        if existing is None or existing["owner_id"] != user_id:
            raise HTTPException(status_code=404, detail="saved spectrum not found")
        updated = ss_repo.patch(
            spectrum_id, patch_body.model_dump(exclude_none=True)
        )
        # patch returns None only if the row vanished mid-call.
        if updated is None:
            raise HTTPException(status_code=404, detail="saved spectrum not found")
        return SavedSpectrumResponse(**updated)

    @app.delete(
        "/api/spectrums/{spectrum_id}",
        status_code=204,
    )
    def saved_spectrums_delete(
        spectrum_id: int,
        user_id: int = Depends(get_current_user),
    ) -> Response:
        existing = ss_repo.get(spectrum_id)
        if existing is None or existing["owner_id"] != user_id:
            raise HTTPException(status_code=404, detail="saved spectrum not found")
        ss_repo.delete(spectrum_id)
        return Response(status_code=204)
```

- [ ] **Step 4: Run — expect pass**

Run: `uv run --active pytest tests/test_saved_spectrums_api.py -v`
Expected: all 11 tests pass.

- [ ] **Step 5: Run the full backend suite to confirm no regressions**

Run: `uv run --active pytest tests/ -q`
Expected: previous total + 15 new tests, all green.

- [ ] **Step 6: Commit**

```bash
git add src/xcs_gen_web/app.py tests/test_saved_spectrums_api.py
git commit -m "feat(saved-spectrums): PATCH and DELETE endpoints"
```

---

## Frontend tasks

### Task 8: TypeScript types

**Files:**
- Modify: `web/src/types.ts`

- [ ] **Step 1: Append types**

Append after the existing `AveragedSwatch` / palette types:

```ts
// Saved Spectrums (stage 1) ───────────────────────────────────────────────

export interface SavedSpectrumSwatch {
  swatch_row: number;
  swatch_col: number;
  x_value: number;
  hex: string;
  lab: [number, number, number];
}

/** Per-channel polynomial coefficient list for a saved spectrum. Each
 *  list is ordered c0, c1, c2, ... and length === fit_degree + 1. */
export type SavedSpectrumCoefficients = {
  l: number[];
  a: number[];
  b: number[];
};

export interface SavedSpectrum {
  id: number;
  name: string;
  source_test_id: number | null;
  machine_id: string;
  material_id: number | null;
  owner_id: number;
  axis_param: string;
  axis_min: number;
  axis_max: number;
  fit_form: "polynomial";
  fit_degree: 1 | 2 | 3;
  fit_coefficients: SavedSpectrumCoefficients;
  fit_r2: { l: number; a: number; b: number };
  fit_r2_min: number;
  displayed_projection: string;
  lab_l_min: number; lab_l_max: number;
  lab_a_min: number; lab_a_max: number;
  lab_b_min: number; lab_b_max: number;
  lab_l_centroid: number;
  lab_a_centroid: number;
  lab_b_centroid: number;
  swatches: SavedSpectrumSwatch[];
  created_at: string;
}

export interface SavedSpectrumCreate {
  name: string;
  source_test_id: number;
  axis_param: string;
  axis_min: number;
  axis_max: number;
  fit_form: "polynomial";
  fit_degree: 1 | 2 | 3;
  fit_coefficients: SavedSpectrumCoefficients;
  fit_r2: { l: number; a: number; b: number };
  displayed_projection: string;
  swatches: SavedSpectrumSwatch[];
}
```

- [ ] **Step 2: Verify types compile**

Run: `cd /Users/jonzky/Documents/XTools/Reverse/web && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add web/src/types.ts
git commit -m "feat(saved-spectrums): TS types"
```

---

### Task 9: API helper module

**Files:**
- Create: `web/src/api/savedSpectrums.ts`
- Create: `web/src/api/savedSpectrums.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// web/src/api/savedSpectrums.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  listSpectrums,
  getSpectrum,
  createSpectrum,
  patchSpectrum,
  deleteSpectrum,
} from "./savedSpectrums";

const FIXTURE = {
  id: 1, name: "spec",
  source_test_id: 5, machine_id: "F2Ultra", material_id: 2, owner_id: 0,
  axis_param: "speed", axis_min: 1000, axis_max: 3000,
  fit_form: "polynomial", fit_degree: 2,
  fit_coefficients: { l: [0, 0, 0], a: [0, 0, 0], b: [0, 0, 0] },
  fit_r2: { l: 0.99, a: 0.95, b: 0.92 },
  fit_r2_min: 0.92,
  displayed_projection: "lightness",
  lab_l_min: 0, lab_l_max: 0, lab_a_min: 0, lab_a_max: 0,
  lab_b_min: 0, lab_b_max: 0,
  lab_l_centroid: 0, lab_a_centroid: 0, lab_b_centroid: 0,
  swatches: [],
  created_at: "2026-04-30T00:00:00Z",
};

let captured: { url: string; init?: RequestInit } | null = null;

beforeEach(() => {
  captured = null;
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    captured = { url, init };
    return new Response(JSON.stringify(FIXTURE), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }));
});
afterEach(() => { vi.unstubAllGlobals(); });

describe("savedSpectrums API", () => {
  it("listSpectrums GETs /api/spectrums with optional filter params", async () => {
    await listSpectrums({ minR2: 0.9, materialId: 2 });
    expect(captured!.url).toBe("/api/spectrums?min_r2=0.9&material_id=2");
    expect(captured!.init?.method ?? "GET").toBe("GET");
  });

  it("listSpectrums omits empty params", async () => {
    await listSpectrums();
    expect(captured!.url).toBe("/api/spectrums");
  });

  it("getSpectrum GETs /api/spectrums/:id", async () => {
    await getSpectrum(7);
    expect(captured!.url).toBe("/api/spectrums/7");
  });

  it("createSpectrum POSTs JSON", async () => {
    const body = {
      name: "x", source_test_id: 1,
      axis_param: "speed", axis_min: 0, axis_max: 1,
      fit_form: "polynomial" as const, fit_degree: 2 as const,
      fit_coefficients: { l: [0, 0, 0], a: [0, 0, 0], b: [0, 0, 0] },
      fit_r2: { l: 1, a: 1, b: 1 },
      displayed_projection: "lightness",
      swatches: [],
    };
    await createSpectrum(body);
    expect(captured!.url).toBe("/api/spectrums");
    expect(captured!.init?.method).toBe("POST");
    expect((captured!.init?.headers as Record<string, string>)["Content-Type"])
      .toBe("application/json");
    expect(JSON.parse(captured!.init?.body as string).name).toBe("x");
  });

  it("patchSpectrum PATCHes /api/spectrums/:id", async () => {
    await patchSpectrum(7, { name: "renamed" });
    expect(captured!.url).toBe("/api/spectrums/7");
    expect(captured!.init?.method).toBe("PATCH");
    expect(JSON.parse(captured!.init?.body as string).name).toBe("renamed");
  });

  it("deleteSpectrum DELETEs /api/spectrums/:id", async () => {
    await deleteSpectrum(7);
    expect(captured!.url).toBe("/api/spectrums/7");
    expect(captured!.init?.method).toBe("DELETE");
  });
});
```

- [ ] **Step 2: Run — expect import errors**

Run: `cd /Users/jonzky/Documents/XTools/Reverse/web && npx vitest run src/api/savedSpectrums.test.ts`
Expected: error — module not found.

- [ ] **Step 3: Implement the API module**

```ts
// web/src/api/savedSpectrums.ts
import type { SavedSpectrum, SavedSpectrumCreate } from "../types";
import { j } from "./_fetch";

export async function listSpectrums(filters: {
  materialId?: number;
  minR2?: number;
  sourceTestId?: number;
} = {}): Promise<SavedSpectrum[]> {
  const params = new URLSearchParams();
  if (filters.minR2 != null) params.set("min_r2", String(filters.minR2));
  if (filters.materialId != null) params.set("material_id", String(filters.materialId));
  if (filters.sourceTestId != null) params.set("source_test_id", String(filters.sourceTestId));
  const qs = params.toString();
  return j(await fetch(`/api/spectrums${qs ? `?${qs}` : ""}`));
}

export async function getSpectrum(id: number): Promise<SavedSpectrum> {
  return j(await fetch(`/api/spectrums/${id}`));
}

export async function createSpectrum(
  body: SavedSpectrumCreate,
): Promise<SavedSpectrum> {
  return j(await fetch("/api/spectrums", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }));
}

export async function patchSpectrum(
  id: number,
  patch: { name?: string },
): Promise<SavedSpectrum> {
  return j(await fetch(`/api/spectrums/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  }));
}

export async function deleteSpectrum(id: number): Promise<void> {
  await j(await fetch(`/api/spectrums/${id}`, { method: "DELETE" }));
}
```

- [ ] **Step 4: Run — expect pass**

Run: `npx vitest run src/api/savedSpectrums.test.ts`
Expected: 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add web/src/api/savedSpectrums.ts web/src/api/savedSpectrums.test.ts
git commit -m "feat(saved-spectrums): TS API client"
```

---

### Task 10: Save dialog component

**Files:**
- Create: `web/src/components/SaveSpectrumDialog.tsx`
- Create: `web/src/components/SaveSpectrumDialog.test.tsx`

- [ ] **Step 1: Write the failing tests**

```tsx
// web/src/components/SaveSpectrumDialog.test.tsx
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SaveSpectrumDialog } from "./SaveSpectrumDialog";

const FIXTURE_PROPS = {
  open: true,
  onOpenChange: vi.fn(),
  onSaved: vi.fn(),
  testName: "Speed sweep",
  testId: 5,
  axisParam: "speed",
  axisMin: 1000,
  axisMax: 3000,
  swatches: [
    { swatch_row: 0, swatch_col: 1, x_value: 1000, hex: "#404060",
      lab: [28, 5, -22] as [number, number, number] },
    { swatch_row: 0, swatch_col: 2, x_value: 2000, hex: "#7080a0",
      lab: [50, 3, -22] as [number, number, number] },
    { swatch_row: 0, swatch_col: 3, x_value: 3000, hex: "#b0c0e0",
      lab: [75, 1, -10] as [number, number, number] },
  ],
  fitDegree: 2 as const,
  fitCoefficients: {
    l: [10, 0.022, 0],
    a: [6, -0.0017, 0],
    b: [-25, 0.005, 0],
  },
  fitR2: { l: 0.999, a: 0.95, b: 0.92 },
  displayedProjection: "lightness",
};

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(
    JSON.stringify({ id: 42, ...FIXTURE_PROPS }),
    { status: 201, headers: { "content-type": "application/json" } },
  )));
});
afterEach(() => { vi.unstubAllGlobals(); });

describe("SaveSpectrumDialog", () => {
  it("defaults the name to '<test> · <axis> <min>-<max>'", () => {
    render(<SaveSpectrumDialog {...FIXTURE_PROPS} />);
    const input = screen.getByLabelText(/name/i) as HTMLInputElement;
    expect(input.value).toBe("Speed sweep · speed 1000-3000");
  });

  it("shows the source test, axis range, and fit summary in the preview", () => {
    render(<SaveSpectrumDialog {...FIXTURE_PROPS} />);
    expect(screen.getByText(/Speed sweep/i)).toBeInTheDocument();
    expect(screen.getByText(/1000.*3000/)).toBeInTheDocument();
    expect(screen.getByText(/degree 2/i)).toBeInTheDocument();
    // R² values are rendered with two decimals
    expect(screen.getByText(/0\.99/)).toBeInTheDocument();
  });

  it("submits a payload with the supplied data + the user-edited name", async () => {
    const onSaved = vi.fn();
    render(<SaveSpectrumDialog {...FIXTURE_PROPS} onSaved={onSaved} />);
    const input = screen.getByLabelText(/name/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Renamed" } });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.name).toBe("Renamed");
    expect(body.source_test_id).toBe(5);
    expect(body.axis_min).toBe(1000);
    expect(body.swatches).toHaveLength(3);
    expect(body.fit_coefficients.l).toEqual([10, 0.022, 0]);
  });
});
```

- [ ] **Step 2: Run — expect missing module errors**

Run: `npx vitest run src/components/SaveSpectrumDialog.test.tsx`
Expected: cannot find module.

- [ ] **Step 3: Implement the component**

```tsx
// web/src/components/SaveSpectrumDialog.tsx
import { useState } from "react";
import { Button, Dialog, DialogContent, DialogHeader, DialogTitle } from "../ui";
import { createSpectrum } from "../api/savedSpectrums";
import type {
  SavedSpectrum,
  SavedSpectrumCoefficients,
  SavedSpectrumSwatch,
} from "../types";

export interface SaveSpectrumDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (saved: SavedSpectrum) => void;

  /** Source test name + id for default name and the FK. */
  testName: string;
  testId: number;

  /** Axis bounds (the crop) and the swatches inside it. */
  axisParam: string;
  axisMin: number;
  axisMax: number;
  swatches: SavedSpectrumSwatch[];

  /** Fit details — already computed on the spectrum page. */
  fitDegree: 1 | 2 | 3;
  fitCoefficients: SavedSpectrumCoefficients;
  fitR2: { l: number; a: number; b: number };
  displayedProjection: string;
}

function defaultName(testName: string, axisParam: string, min: number, max: number): string {
  return `${testName} · ${axisParam} ${min}-${max}`;
}

export function SaveSpectrumDialog(props: SaveSpectrumDialogProps) {
  const {
    open, onOpenChange, onSaved,
    testName, testId, axisParam, axisMin, axisMax, swatches,
    fitDegree, fitCoefficients, fitR2, displayedProjection,
  } = props;

  const [name, setName] = useState(defaultName(testName, axisParam, axisMin, axisMax));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset name when source test / range changes (parent unmounts via the
  // dialog open prop, but for safety also re-derive on prop drift).
  function handleSubmit() {
    setSaving(true);
    setError(null);
    void createSpectrum({
      name: name.trim(),
      source_test_id: testId,
      axis_param: axisParam,
      axis_min: axisMin,
      axis_max: axisMax,
      fit_form: "polynomial",
      fit_degree: fitDegree,
      fit_coefficients: fitCoefficients,
      fit_r2: fitR2,
      displayed_projection: displayedProjection,
      swatches,
    })
      .then((saved) => {
        onSaved(saved);
        onOpenChange(false);
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setSaving(false));
  }

  // Lab range covered by the saved swatches — read-only summary.
  const Ls = swatches.map((s) => s.lab[0]);
  const As = swatches.map((s) => s.lab[1]);
  const Bs = swatches.map((s) => s.lab[2]);
  const labSummary = swatches.length > 0
    ? `L ${Math.min(...Ls).toFixed(0)}–${Math.max(...Ls).toFixed(0)} · `
      + `a ${Math.min(...As).toFixed(0)}..${Math.max(...As).toFixed(0)} · `
      + `b ${Math.min(...Bs).toFixed(0)}..${Math.max(...Bs).toFixed(0)}`
    : "—";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent width="md">
        <DialogHeader>
          <DialogTitle>Save spectrum</DialogTitle>
        </DialogHeader>

        <label className="block mb-3">
          <span className="block text-[11.5px] uppercase tracking-[0.12em] text-[color:var(--color-ink-muted)] mb-1">
            Name
          </span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full h-9 px-3 rounded-[6px] border border-[color:var(--color-border-strong)] bg-[color:var(--color-surface)] text-[14px]"
            aria-label="name"
          />
        </label>

        <div className="rounded-[6px] border border-[color:var(--color-border)] bg-[color:var(--color-surface-elevated)] p-3 mb-3 text-[12px]">
          <div className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5">
            <div className="text-[color:var(--color-ink-muted)]">Source</div>
            <div className="font-mono">Test #{testId} · {testName}</div>
            <div className="text-[color:var(--color-ink-muted)]">Axis</div>
            <div className="font-mono">{axisParam}: {axisMin} → {axisMax}  ({swatches.length} points)</div>
            <div className="text-[color:var(--color-ink-muted)]">Fit</div>
            <div className="font-mono">
              polynomial · degree {fitDegree}
              <br />
              L* R² {fitR2.l.toFixed(2)} · a* R² {fitR2.a.toFixed(2)} · b* R² {fitR2.b.toFixed(2)}
            </div>
            <div className="text-[color:var(--color-ink-muted)]">Lab range</div>
            <div className="font-mono">{labSummary}</div>
          </div>
        </div>

        {error && (
          <div className="text-[12px] text-[color:var(--color-destructive)] mb-2">
            {error}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            variant="primary"
            disabled={saving || name.trim().length === 0}
            onClick={handleSubmit}
          >
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 4: Run — expect pass**

Run: `npx vitest run src/components/SaveSpectrumDialog.test.tsx`
Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/SaveSpectrumDialog.tsx web/src/components/SaveSpectrumDialog.test.tsx
git commit -m "feat(saved-spectrums): SaveSpectrumDialog component"
```

---

### Task 11: Wire Save button into FitPanel on the spectrum page

**Files:**
- Modify: `web/src/pages/SpectrumPage.tsx`

The `FitPanel` component is at `web/src/pages/SpectrumPage.tsx:1989`. The parent component (`SpectrumBody`) holds the data we need: `fit`, `modeled?.perChannelR2`, `samples` (already filtered to inside the crop), `fitDegree`, `rangeStart`, `rangeEnd`, `projection`, and `test.spec.x_param`.

- [ ] **Step 1: Add the dialog import + state in `SpectrumBody`**

Find the `import { ... } from "../color/math";` line (~10) and add a separate import below the existing component imports:

```ts
import { SaveSpectrumDialog } from "../components/SaveSpectrumDialog";
```

In `SpectrumBody` (around line 366-410), add state and a derived guard:

```tsx
const [saveDialogOpen, setSaveDialogOpen] = useState(false);

const canSave = useMemo(() => {
  // Disable when nothing's worth saving:
  // - full-range crop (nothing was filtered out),
  // - degree 0 (no equation),
  // - under-determined fit (need >= degree+1 points).
  if (!clipped) return false;
  if (fitDegree === 0) return false;
  if (samples.length < fitDegree + 1) return false;
  if (modeled === null) return false;  // means a polyFit somewhere returned NaN
  return true;
}, [clipped, fitDegree, samples.length, modeled]);
```

- [ ] **Step 2: Pass save handlers + state into FitPanel**

Update the `<FitPanel ... />` call site (around line 689) to add new props:

```tsx
<FitPanel
  fitDegree={fitDegree}
  onChangeDegree={setFitDegree}
  fit={fit}
  xParam={test.spec.x_param}
  yUnit={proj.unit}
  proj={proj}
  projection={projection}
  canSave={canSave}
  onSave={() => setSaveDialogOpen(true)}
/>
```

- [ ] **Step 3: Update `FitPanel` (around line 1989) to accept + render the Save button**

Add to the props type:

```ts
canSave: boolean;
onSave: () => void;
```

Inside the component, after the existing `<div>` with the `Fit degree` selector and *before* the closing `</div>` of the panel, add:

```tsx
<button
  type="button"
  disabled={!canSave}
  onClick={onSave}
  title={
    canSave
      ? "Save this cropped sub-spectrum + its fit equation"
      : "Crop the range and pick a fit degree to save."
  }
  className={cn(
    "w-full h-9 rounded-[6px] font-mono text-[11px] uppercase tracking-[0.18em] transition-colors",
    canSave
      ? "bg-[color:var(--color-primary)] text-white hover:bg-[color:var(--color-primary-tint)]"
      : "bg-[color:var(--color-surface)] border border-[color:var(--color-border)] text-[color:var(--color-ink-subtle)] cursor-not-allowed",
  )}
>
  Save spectrum
</button>
```

- [ ] **Step 4: Mount the dialog at the bottom of `SpectrumBody`**

Just before `SpectrumBody` returns its outermost JSX wrapper's closing tag, add:

```tsx
{modeled !== null && fit !== null && (
  <SaveSpectrumDialog
    open={saveDialogOpen}
    onOpenChange={setSaveDialogOpen}
    onSaved={() => { /* toast handled by parent listener if any */ }}
    testName={test.name}
    testId={test.id}
    axisParam={test.spec.x_param}
    axisMin={rangeStart}
    axisMax={rangeEnd}
    swatches={samples.map((s) => ({
      swatch_row: s.row,
      swatch_col: s.col,
      x_value: s.x,
      hex: s.hex,
      lab: [s.lab[0], s.lab[1], s.lab[2]] as [number, number, number],
    }))}
    fitDegree={fitDegree as 1 | 2 | 3}
    fitCoefficients={{
      l: modeled.fitL.coeffs,
      a: modeled.fitA.coeffs,
      b: modeled.fitB.coeffs,
    }}
    fitR2={{
      l: modeled.perChannelR2[0],
      a: modeled.perChannelR2[1],
      b: modeled.perChannelR2[2],
    }}
    displayedProjection={projection}
  />
)}
```

The `modeled` variable currently doesn't expose `fitL`/`fitA`/`fitB` in its returned object — only the per-channel R² as a tuple. So in the same file, around line 487, change the `modeled` `useMemo` return to also surface the fit objects:

Find:
```tsx
return {
  strip,
  meanResidualDeltaE: totalDelta / samples.length,
  worstResidualDeltaE: worstDelta,
  perChannelR2: [fitL.r2, fitA.r2, fitB.r2] as const,
};
```

Replace with:
```tsx
return {
  strip,
  meanResidualDeltaE: totalDelta / samples.length,
  worstResidualDeltaE: worstDelta,
  perChannelR2: [fitL.r2, fitA.r2, fitB.r2] as const,
  fitL,
  fitA,
  fitB,
};
```

- [ ] **Step 5: Verify everything compiles**

Run: `cd /Users/jonzky/Documents/XTools/Reverse/web && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Run vitest to confirm no existing tests broke**

Run: `npx vitest run`
Expected: all tests pass (count = previous + 6 from API + 3 from dialog = +9).

- [ ] **Step 7: Commit**

```bash
git add web/src/pages/SpectrumPage.tsx
git commit -m "feat(saved-spectrums): Save button in FitPanel + dialog wiring"
```

---

### Task 12: Saved Spectrums page — list + delete

**Files:**
- Create: `web/src/pages/SavedSpectrumsPage.tsx`
- Modify: `web/src/router.ts`
- Modify: `web/src/App.tsx`
- Modify: `web/src/components/TopBar.tsx`

- [ ] **Step 1: Update the router**

Open `web/src/router.ts`. In the `Route` union, add:

```ts
| { name: "saved-spectrums" }
```

In `parseRoute`, after the `if (h === "spectrum") return ...` line, add:

```ts
if (h === "saved-spectrums") return { name: "saved-spectrums" };
```

In `formatRoute`, add a case:

```ts
case "saved-spectrums": return "#/saved-spectrums";
```

- [ ] **Step 2: Add the nav entry**

Open `web/src/components/TopBar.tsx`. After the existing `<TabLink ... target={{ name: "spectrum" }} ...>` block (around line 85-87), add:

```tsx
<TabLink route={route} target={{ name: "saved-spectrums" }} onNavigate={onNavigate}>
  Saved
</TabLink>
```

- [ ] **Step 3: Create the page**

```tsx
// web/src/pages/SavedSpectrumsPage.tsx
import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { Button, Section, PageContainer, EmptyState } from "../ui";
import { listSpectrums, deleteSpectrum } from "../api/savedSpectrums";
import type { SavedSpectrum } from "../types";

export function SavedSpectrumsPage() {
  const [spectrums, setSpectrums] = useState<SavedSpectrum[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [minR2, setMinR2] = useState<number | "">("");

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const rows = await listSpectrums({
        minR2: typeof minR2 === "number" ? minR2 : undefined,
      });
      setSpectrums(rows);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void refresh(); /* eslint-disable-line react-hooks/exhaustive-deps */ }, []);
  useEffect(() => { void refresh(); /* eslint-disable-line react-hooks/exhaustive-deps */ }, [minR2]);

  async function onDelete(id: number) {
    if (!window.confirm("Delete this saved spectrum?")) return;
    await deleteSpectrum(id);
    await refresh();
  }

  return (
    <PageContainer maxWidth="wide" className="py-6">
      <header className="mb-4">
        <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[color:var(--color-ink-subtle)] mb-1">
          Saved spectrums
        </div>
        <h1 className="text-[22px] font-semibold text-[color:var(--color-ink)]">
          Cropped sub-spectrums + fits
        </h1>
        <p className="mt-1 text-[13px] text-[color:var(--color-ink-muted)] max-w-[68ch]">
          Each saved spectrum carries its data points, axis bounds, and per-channel
          Lab polynomial. The upcoming colour-to-spectrum predictor will read these
          to find which saved range a given colour belongs to.
        </p>
      </header>

      <div className="grid grid-cols-[260px_1fr] gap-6">
        <aside>
          <Section title="Filters" dense>
            <label className="block">
              <span className="block text-[11.5px] uppercase tracking-[0.12em] text-[color:var(--color-ink-muted)] mb-1">
                Min R²
              </span>
              <input
                type="number"
                step="0.01" min="0" max="1"
                value={minR2}
                onChange={(e) =>
                  setMinR2(e.target.value === "" ? "" : Number(e.target.value))
                }
                placeholder="any"
                className="w-full h-9 px-3 rounded-[6px] border border-[color:var(--color-border-strong)] bg-[color:var(--color-surface)] text-[14px]"
              />
            </label>
          </Section>
        </aside>

        <main>
          {loading ? (
            <div className="text-[13px] text-[color:var(--color-ink-muted)]">Loading…</div>
          ) : error ? (
            <div className="text-[13px] text-[color:var(--color-destructive)]">{error}</div>
          ) : spectrums.length === 0 ? (
            <EmptyState
              title="No saved spectrums yet"
              description="Save one from the spectrum page — crop a sub-range, pick a fit degree, click Save spectrum. These will become the source data for the upcoming colour-to-spectrum predictor."
            />
          ) : (
            <ul className="space-y-3">
              {spectrums.map((sp) => (
                <SavedSpectrumCard key={sp.id} spectrum={sp} onDelete={onDelete} />
              ))}
            </ul>
          )}
        </main>
      </div>
    </PageContainer>
  );
}

function SavedSpectrumCard({
  spectrum, onDelete,
}: { spectrum: SavedSpectrum; onDelete: (id: number) => void }) {
  return (
    <li className="rounded-[8px] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-[15px] font-semibold text-[color:var(--color-ink)]">
            {spectrum.name}
          </h3>
          {spectrum.source_test_id !== null ? (
            <a
              href={`#/spectrum/${spectrum.source_test_id}`}
              className="text-[12px] text-[color:var(--color-primary)] hover:underline"
            >
              Test #{spectrum.source_test_id} →
            </a>
          ) : (
            <span className="text-[12px] text-[color:var(--color-ink-subtle)] italic">
              source test deleted
            </span>
          )}
        </div>
        <Button
          variant="ghost" size="sm"
          onClick={() => onDelete(spectrum.id)}
          aria-label={`Delete ${spectrum.name}`}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
      <div className="mt-2 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-[12px] font-mono">
        <div className="text-[color:var(--color-ink-muted)]">axis</div>
        <div>{spectrum.axis_param}: {spectrum.axis_min}→{spectrum.axis_max} · {spectrum.swatches.length} points</div>
        <div className="text-[color:var(--color-ink-muted)]">fit</div>
        <div>
          {spectrum.fit_form} · degree {spectrum.fit_degree} ·
          {" "}L {spectrum.fit_r2.l.toFixed(2)} · a {spectrum.fit_r2.a.toFixed(2)} · b {spectrum.fit_r2.b.toFixed(2)}
        </div>
        <div className="text-[color:var(--color-ink-muted)]">lab</div>
        <div>
          L {spectrum.lab_l_min.toFixed(0)}–{spectrum.lab_l_max.toFixed(0)}
          {" "}· a {spectrum.lab_a_min.toFixed(0)}..{spectrum.lab_a_max.toFixed(0)}
          {" "}· b {spectrum.lab_b_min.toFixed(0)}..{spectrum.lab_b_max.toFixed(0)}
        </div>
        <div className="text-[color:var(--color-ink-muted)]">saved</div>
        <div>{new Date(spectrum.created_at).toLocaleString()}</div>
      </div>
      <SavedSpectrumStrip spectrum={spectrum} />
    </li>
  );
}

function SavedSpectrumStrip({ spectrum }: { spectrum: SavedSpectrum }) {
  // Render the saved swatches as a horizontal colour bar — each swatch
  // gets equal width (already evenly spaced in x_value within the crop).
  if (spectrum.swatches.length === 0) return null;
  return (
    <div className="mt-3 flex h-6 rounded-[3px] overflow-hidden border border-[color:var(--color-border)]">
      {spectrum.swatches.map((sw) => (
        <div
          key={`${sw.swatch_row}-${sw.swatch_col}`}
          className="flex-1"
          style={{ backgroundColor: sw.hex }}
          title={`${sw.x_value} → ${sw.hex}`}
        />
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Mount the page in App**

Open `web/src/App.tsx`. Add an import:

```ts
import { SavedSpectrumsPage } from "./pages/SavedSpectrumsPage";
```

Find the existing route-name → component dispatch (look for `route.name === "spectrum"`) and add a case for `"saved-spectrums"`:

```tsx
{route.name === "saved-spectrums" && <SavedSpectrumsPage />}
```

Also add the title mapping near the title-resolution block:

```tsx
: route.name === "saved-spectrums" ? "Saved spectrums"
```

- [ ] **Step 5: Verify TS + tests**

Run: `cd /Users/jonzky/Documents/XTools/Reverse/web && npx tsc --noEmit && npx vitest run`
Expected: clean.

- [ ] **Step 6: Verify the build**

Run: `npm run build`
Expected: `built in ...` with no errors.

- [ ] **Step 7: Commit**

```bash
git add web/src/pages/SavedSpectrumsPage.tsx web/src/router.ts web/src/App.tsx web/src/components/TopBar.tsx
git commit -m "feat(saved-spectrums): top-level Saved page with list + delete"
```

---

### Task 13: Browser walkthrough + final commit

**Files:** none new — this is verification.

- [ ] **Step 1: Start the dev server**

Run: `uv run --active xcs-gen serve --host 127.0.0.1 --port 8017 > /tmp/xcs.log 2>&1 &`

Wait for `curl -s http://127.0.0.1:8017/` to return 200.

- [ ] **Step 2: Save a spectrum from a real test**

Manually:
1. Open `#/spectrum/<id>` for a test with usable swatches.
2. Drag the range handles or use the numeric inputs to crop a sub-range with a strong fit (e.g. R² > 0.9 on at least one channel).
3. Confirm the **Save spectrum** button is enabled in the FitPanel.
4. Click it. Confirm the dialog opens with a sensible default name and a preview block.
5. Click **Save**. Confirm the toast / dialog dismisses.

- [ ] **Step 3: Verify it appears on the Saved page**

Navigate to `#/saved-spectrums`. Confirm:
1. The card you just saved is at the top.
2. Source test link goes back to `#/spectrum/<id>`.
3. The strip preview shows your saved swatches.
4. The Min R² filter narrows the list when set above the saved fit's R².

- [ ] **Step 4: Verify delete works**

Click delete on the saved record. Confirm it disappears from the list, and that re-fetching `/api/spectrums/<id>` returns 404 (curl check optional).

- [ ] **Step 5: Stop the server and commit a changelog entry**

The CLAUDE.md changelog rules: this is a new top-level page with new persistence — major level entry warranted.

```markdown
<!-- changelog/2026-04-30-saved-spectrums.md -->
---
id: 2026-04-30-saved-spectrums
date: 2026-04-30
created_at: 2026-04-30T13:00:00Z
level: major
title: Saved Spectrums — persist cropped sub-spectrums and their fits
summary: Crop the spectrum page to a sub-range with a strong polynomial fit and save it. The new Saved tab in the workbench lists every saved record — name, source test, axis range, per-channel R², a strip rendered from the saved swatches. This is stage 1 of an upcoming colour-to-spectrum predictor that will read these saved records to map a target colour back to its place on a known gradient.
images:
  - src: saved-spectrums-list.png
    caption: A handful of saved sub-spectrums, each carrying its own swatches, axis bounds, and Lab polynomial.
---

(prose body here following the workshop voice)
```

Take a screenshot of the Saved page populated with at least one record:

```bash
mkdir -p changelog/images
# Use playwright MCP or manually save to changelog/images/saved-spectrums-list.png
```

Commit changelog + image:

```bash
git add changelog/2026-04-30-saved-spectrums.md changelog/images/saved-spectrums-list.png
git commit -m "docs(changelog): saved spectrums major-level entry"
```

- [ ] **Step 6: Push the branch + open the PR**

```bash
git push -u origin feat/saved-spectrums

gh pr create --base main --head feat/saved-spectrums \
  --title "feat(saved-spectrums): persist cropped sub-spectrums + fits" \
  --body "$(cat <<'EOF'
## Summary
Stage 1 of the upcoming colour-to-spectrum predictor:
* Three normalised tables (`saved_spectrums`, `saved_spectrum_swatches`, `saved_spectrum_fit_coefficients`) — no JSON columns. Indexed Lab bounding box on the parent so the future predictor's per-material prefilter is cheap from day 1.
* Five endpoints under `/api/spectrums` (POST, GET list, GET detail, PATCH name, DELETE).
* New top-level `#/saved-spectrums` page with a filter rail (Min R²) and a card per record.
* New Save button in the existing `FitPanel` on the spectrum page.

Predictor query, comparison view, ES migration are all explicitly stage 2+ — schema designed to support without restructuring.

## Test plan
- [x] `pytest tests/` — 15 new tests pass (repository + endpoints).
- [x] `npx vitest run` — 9 new tests pass (API client + dialog).
- [x] `npx tsc --noEmit` clean.
- [x] `npm run build` clean.
- [x] Browser walkthrough: save → list → delete on a real test.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 7: Update branch tracking + verify CI**

```bash
gh pr view <new-pr-number> --json statusCheckRollup
```

Wait for backend-test, frontend-build, mysql-migration-test (which would catch a missing CI revision bump), CodeQL to all be green or queued. Address any failures.

---

## Self-review

I checked the plan against the spec at `docs/superpowers/specs/2026-04-30-saved-spectrums-design.md`:

| Spec section | Covered by |
|---|---|
| Three normalised tables | Tasks 1-2 (migration + models) |
| Indexed Lab bbox columns | Task 1 (`ix_saved_spectrums_material_lab_*`) |
| `is_2d` decision (n/a, 1D only) | Implicitly — no axis_y in this stage |
| Cascade-delete children | Task 1 (FK `ON DELETE CASCADE`) |
| `ON DELETE SET NULL` for source_test_id | Task 1, Task 4 (`test_source_test_delete_nulls_reference`) |
| Server-derived bbox/centroid | Task 4 (`_bbox_and_centroid`) |
| Five endpoints | Tasks 6-7 |
| Trust-boundary: client posts coefficients | Task 6 (no recomputation) |
| `fit_coefficients[c]` length validation | Task 6 (explicit 422 raise) |
| Min-2 swatches | Task 3 (`Field(min_length=2)` on `SavedSpectrumCreate`) |
| Save button in `FitPanel` | Task 11 |
| Save dialog with preview | Task 10 |
| Top-level page | Task 12 |
| Nav entry after Spectrum | Task 12 (TopBar mod) |
| Empty state with stage-2 hint | Task 12 (`EmptyState` description) |
| Per-card client-rendered strip | Task 12 (`SavedSpectrumStrip`) |
| CI alembic check bump | Task 1 step 2 |

Type consistency: `SavedSpectrumCoefficients` is `{ l: number[]; a: number[]; b: number[] }` everywhere it appears (types, API body, dialog props, page render). Polynomial degree is `1 | 2 | 3` everywhere. Coefficient list length is enforced as `degree + 1` in three places: Pydantic model docstring, repository test, and API handler validation.

No placeholders — every step has the concrete file, the concrete code, the concrete command, the expected output. No "TBD"/"TODO" patterns; no "implement later"; no references to undefined types.

Scope is one cohesive feature: persist a saved spectrum + browse/delete it. The predictor query is explicitly out of scope and lives in stage 2 (also called out in the changelog summary).
