# Laser Exposure Indices Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Attach a small set of derived exposure indices to every palette entry — computed from raw laser parameters, framed as opaque controller-setting products (not calibrated physics) — so we can analyse and (later) plot palette entries in exposure-vs-intensity space.

**Architecture:** Pure compute module in `src/xcs_gen/laser_indices.py` produces a `LaserIndices` dataclass from `ProcessingParams`. Six derived columns plus three metadata columns are added to `palette_entries`. The repository layer's `_build_row` populates the columns on every insert; `_row_to_entry` exposes them as a nested `indices` object. An alembic migration backfills existing rows; a new `xcs-gen recompute-indices` CLI handles future formula bumps. UI surfaces the values as a chip strip on the palette-entry detail dialog.

**Tech Stack:** Python 3.11+ / SQLAlchemy 2.x / Alembic / FastAPI / Pydantic v2 / React + TypeScript / Tailwind v4 / Radix UI / Vitest.

**Spec:** `docs/superpowers/specs/2026-05-07-laser-exposure-indices-design.md`

**Branch:** Cut a fresh branch off `main` named `feat/laser-exposure-indices` (per the spec — this work is independent of `feat/saved-spectrums`). The spec and plan are committed on `feat/saved-spectrums` (commits `416fa26` for the spec, `8ffdc76` for this plan, plus the plan-refresh commit cherry-picked alongside); cherry-pick the chain onto the new branch so the implementation branch carries its own design context:

```bash
git checkout main && git pull
git checkout -b feat/laser-exposure-indices
git cherry-pick 416fa26 8ffdc76 <plan-refresh-sha>
```

**Rebuild reminder:** After every `web/src/**` edit, run `cd web && npm run build` before testing in a browser — `xcs-gen serve` mounts `web/dist/`, not the Vite dev server.

**Current state of `palette_entries` on `main` (informational, for subagents):**

`origin/main` moved on while this design was being written. Migrations 0019 and 0020 added validation-state columns to `palette_entries`. They are independent of exposure indices — DO NOT remove or restructure them; just leave them alongside the columns this plan adds:

```
is_validated          BOOLEAN  NOT NULL DEFAULT 0
validated_at          VARCHAR  (ISO timestamp) NULL
validated_test_id     INTEGER  FK -> tests.id NULL
validated_lab_l       FLOAT    NULL
validated_lab_a       FLOAT    NULL
validated_lab_b       FLOAT    NULL
validated_run_count   INTEGER  NULL
validated_residual_de FLOAT    NULL
validated_cell_index  INTEGER  NULL
```

`PaletteEntryResponse` in `schemas.py` already exposes these as fields with default values, and `_row_to_entry` already populates them in its return dict. The exposure-indices changes only ADD to those structures — never replace, remove, or restructure existing fields.

The bulk-insert path also previously had `_check_machine_matches_test` (singular, per-entry) which has been replaced by `_check_machine_matches_tests_bulk` (batched). This plan doesn't touch that function but subagents should be aware of the rename when reading the file.

Latest alembic revision on `main` is `0021_wb_flatfield`. The migration this plan adds is therefore `0022_palette_exposure_indices`, and the CI version assertion bumps from `0021` to `0022`.

---

## File Structure

**Create:**
- `src/xcs_gen/laser_indices.py` — pure compute module + `LaserIndices` dataclass + `INDICES_FORMULA_VERSION` constant
- `tests/test_laser_indices.py` — unit tests for `compute_indices`
- `alembic/versions/0022_palette_exposure_indices.py` — schema additions, backfill, indexes
- `web/src/components/PaletteIndicesChips.tsx` — chip strip component
- `web/src/components/PaletteIndicesChips.test.tsx` — vitest for the chip strip
- `changelog/2026-05-07-laser-exposure-indices.md` — major-level changelog entry
- `changelog/images/laser-exposure-indices-chips.png` — screenshot of the chip strip (taken in Task 14)

**Modify:**
- `src/xcs_gen_web/models.py` — add nine columns + two composite indices to `palette_entries`
- `src/xcs_gen_web/repositories/palette.py` — `_build_row` computes indices; `_row_to_entry` exposes them
- `src/xcs_gen_web/schemas.py` — add `LaserIndicesResponse`; embed in `PaletteEntryResponse`
- `src/xcs_gen/cli.py` — add `recompute-indices` subcommand
- `web/src/components/PaletteEntryDialog.tsx` — render the chip strip
- `.github/workflows/ci.yml` — bump alembic version assertion `0021` → `0022`
- `tests/test_db_models.py` — assert the new columns exist on `palette_entries`
- `tests/test_repo_palette.py` — assert indices are written on insert and exposed on read
- `tests/test_palette_api.py` — assert `indices` block on `GET /api/palette` responses
- `tests/test_alembic.py` — pick up the new revision automatically (verify, don't necessarily edit)

---

## Task 1: Pure compute module — `LaserIndices` and `compute_indices`

**Files:**
- Create: `src/xcs_gen/laser_indices.py`
- Create: `tests/test_laser_indices.py`

- [ ] **Step 1: Write the failing test**

Create `tests/test_laser_indices.py`:

```python
"""Tests for laser_indices.compute_indices.

Reference values are hand-computed from the formulas in the spec:
- pulse_spacing_mm     = speed / (mopa_frequency_khz * 1000)
- line_spacing_index   = 1 / density
- pulse_energy_index   = power_percent / mopa_frequency_khz
- pulse_intensity_index = power_percent / (mopa_frequency_khz * pulse_width_ns)
- surface_exposure_index = power_percent * density * repeat / speed
"""
from __future__ import annotations

import math

import pytest

from xcs_gen.laser_indices import (
    INDICES_FORMULA_VERSION,
    LaserIndices,
    compute_indices,
)
from xcs_gen.model import ProcessingParams


def test_defaults_match_hand_computation() -> None:
    # ProcessingParams defaults: speed=1000, power=50, density=100,
    # mopa_frequency=65, pulse_width=200, repeat=1.
    indices = compute_indices(ProcessingParams())
    assert isinstance(indices, LaserIndices)
    assert indices.pulse_spacing_mm == pytest.approx(1000 / (65 * 1000))
    assert indices.line_spacing_index == pytest.approx(1 / 100)
    assert indices.line_spacing_mm is None  # density_model="opaque"
    assert indices.pulse_energy_index == pytest.approx(50 / 65)
    assert indices.pulse_intensity_index == pytest.approx(50 / (65 * 200))
    assert indices.surface_exposure_index == pytest.approx(50 * 100 * 1 / 1000)
    assert indices.formula_version == INDICES_FORMULA_VERSION
    assert indices.density_model == "opaque"
    assert indices.power_model == "controller_percent"


def test_stainless_high_density_case() -> None:
    # From src/xcs_gen/generators.py: stainless reference uses
    # speed=400, density=2566 (others left at defaults of the call site).
    p = ProcessingParams(speed=400, density=2566, repeat=2)
    indices = compute_indices(p)
    assert indices.surface_exposure_index == pytest.approx(50 * 2566 * 2 / 400)
    assert indices.line_spacing_index == pytest.approx(1 / 2566)


def test_zero_speed_raises_value_error_naming_field() -> None:
    p = ProcessingParams(speed=0)
    with pytest.raises(ValueError, match="speed"):
        compute_indices(p)


def test_zero_frequency_raises_value_error_naming_field() -> None:
    p = ProcessingParams(mopa_frequency=0)
    with pytest.raises(ValueError, match="mopa_frequency"):
        compute_indices(p)


def test_zero_density_raises_value_error_naming_field() -> None:
    p = ProcessingParams(density=0)
    with pytest.raises(ValueError, match="density"):
        compute_indices(p)


def test_zero_pulse_width_raises_value_error_naming_field() -> None:
    p = ProcessingParams(pulse_width=0)
    with pytest.raises(ValueError, match="pulse_width"):
        compute_indices(p)


def test_line_spacing_mm_stays_none_under_opaque_model() -> None:
    indices = compute_indices(ProcessingParams(), density_model="opaque")
    assert indices.line_spacing_mm is None


def test_formula_version_is_one() -> None:
    assert INDICES_FORMULA_VERSION == 1


def test_immutable_dataclass() -> None:
    p = ProcessingParams()
    indices = compute_indices(p)
    with pytest.raises(Exception):  # frozen dataclass: FrozenInstanceError
        indices.surface_exposure_index = 999.0  # type: ignore[misc]


def test_finite_values_for_all_indices() -> None:
    indices = compute_indices(ProcessingParams())
    for name in (
        "pulse_spacing_mm",
        "line_spacing_index",
        "pulse_energy_index",
        "pulse_intensity_index",
        "surface_exposure_index",
    ):
        v = getattr(indices, name)
        assert math.isfinite(v), f"{name} is not finite: {v}"
```

- [ ] **Step 2: Run test to verify it fails**

```bash
uv run --active pytest tests/test_laser_indices.py -v
```

Expected: ImportError / collection failure — module doesn't exist yet.

- [ ] **Step 3: Write the compute module**

Create `src/xcs_gen/laser_indices.py`:

```python
"""Derived exposure indices for laser parameters.

These are HEURISTIC INDICES, not calibrated physical quantities.
xTool's `power` and `density` parameters are controller settings whose
mapping to wall-plug watts and physical line spacing isn't guaranteed,
so we frame everything as opaque dimensionless products under explicit
`density_model` / `power_model` strings. When calibration arrives,
this module gains alternative formula branches keyed off those strings
and `INDICES_FORMULA_VERSION` is bumped — callers stamp every row with
the version so a recompute pass can flush stale values.

Formulas (see docs/superpowers/specs/2026-05-07-laser-exposure-indices-design.md):

    pulse_spacing_mm        = speed / (mopa_frequency * 1000)        # honest mm
    line_spacing_index      = 1 / density                             # opaque
    line_spacing_mm         = NULL while density_model == "opaque"
    pulse_energy_index      = power / mopa_frequency
    pulse_intensity_index   = power / (mopa_frequency * pulse_width)
    surface_exposure_index  = power * density * repeat / speed

`mopa_frequency` is in kHz; `speed` is mm/s; `pulse_width` is ns;
`power` is the controller % setting.
"""

from __future__ import annotations

from dataclasses import dataclass

from .model import ProcessingParams

INDICES_FORMULA_VERSION = 1


@dataclass(frozen=True)
class LaserIndices:
    pulse_spacing_mm: float
    line_spacing_index: float
    line_spacing_mm: float | None
    pulse_energy_index: float
    pulse_intensity_index: float
    surface_exposure_index: float
    formula_version: int
    density_model: str
    power_model: str


def compute_indices(
    params: ProcessingParams,
    *,
    density_model: str = "opaque",
    power_model: str = "controller_percent",
) -> LaserIndices:
    """Compute derived exposure indices from raw `ProcessingParams`.

    Raises `ValueError` (naming the offending field) if any input that
    appears in a denominator is zero. Callers handle the error —
    palette entries with non-physical params shouldn't have silent NaN
    indices.
    """
    speed = params.speed
    power = params.power
    density = params.density
    freq = params.mopa_frequency
    pw = params.pulse_width
    repeat = params.repeat

    if speed == 0:
        raise ValueError("speed must be non-zero to compute laser indices")
    if freq == 0:
        raise ValueError("mopa_frequency must be non-zero to compute laser indices")
    if density == 0:
        raise ValueError("density must be non-zero to compute laser indices")
    if pw == 0:
        raise ValueError("pulse_width must be non-zero to compute laser indices")

    pulse_spacing_mm = speed / (freq * 1000)
    line_spacing_index = 1 / density
    pulse_energy_index = power / freq
    pulse_intensity_index = power / (freq * pw)
    surface_exposure_index = power * density * repeat / speed

    line_spacing_mm: float | None = None
    if density_model != "opaque":
        # Future: dispatch on calibrated density_model values here.
        # For now the only supported value is "opaque", and any other
        # value is a forward-compat signal we haven't shipped yet.
        raise ValueError(
            f"density_model={density_model!r} not supported in formula "
            f"version {INDICES_FORMULA_VERSION}",
        )

    if power_model != "controller_percent":
        raise ValueError(
            f"power_model={power_model!r} not supported in formula "
            f"version {INDICES_FORMULA_VERSION}",
        )

    return LaserIndices(
        pulse_spacing_mm=pulse_spacing_mm,
        line_spacing_index=line_spacing_index,
        line_spacing_mm=line_spacing_mm,
        pulse_energy_index=pulse_energy_index,
        pulse_intensity_index=pulse_intensity_index,
        surface_exposure_index=surface_exposure_index,
        formula_version=INDICES_FORMULA_VERSION,
        density_model=density_model,
        power_model=power_model,
    )
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
uv run --active pytest tests/test_laser_indices.py -v
```

Expected: 9 passing.

- [ ] **Step 5: Commit**

```bash
git add src/xcs_gen/laser_indices.py tests/test_laser_indices.py
git commit -m "feat(indices): pure laser_indices compute module

Adds the LaserIndices dataclass and compute_indices() pure function —
the seam where future calibration (effective_power_index, calibrated
line spacing) will land without disturbing the surrounding system.
Inputs come from ProcessingParams; outputs are opaque controller-
setting products with explicit density_model / power_model strings."
```

---

## Task 2: ProcessingParams adapter for the params_json shape

The dict stored in `palette_entries.params_json` uses different keys
than `ProcessingParams` field names: `frequency` (not `mopa_frequency`)
and `passes` (not `repeat`). Existing migration `0010` confirms
`frequency` is the dict key. We need a small adapter so callers can
convert a stored params dict into a `ProcessingParams` for
`compute_indices`.

**Files:**
- Modify: `src/xcs_gen_web/repositories/palette.py`
- Modify: `tests/test_repo_palette.py`

- [ ] **Step 1: Write the failing test**

Append to `tests/test_repo_palette.py`:

```python
def test_processing_params_from_palette_dict_handles_legacy_keys() -> None:
    from xcs_gen_web.repositories.palette import (
        _processing_params_from_palette_dict,
    )

    # A representative params_json blob with the legacy "frequency" /
    # "passes" keys we know exist in production.
    raw = {
        "speed": 800,
        "power": 35.0,
        "density": 250,
        "frequency": 60,        # → mopa_frequency on dataclass
        "passes": 3,            # → repeat on dataclass
        "pulse_width": 100,
    }
    p = _processing_params_from_palette_dict(raw)
    assert p.speed == 800
    assert p.power == 35.0
    assert p.density == 250
    assert p.mopa_frequency == 60
    assert p.pulse_width == 100
    assert p.repeat == 3


def test_processing_params_from_palette_dict_falls_back_to_defaults() -> None:
    from xcs_gen.model import ProcessingParams
    from xcs_gen_web.repositories.palette import (
        _processing_params_from_palette_dict,
    )

    p = _processing_params_from_palette_dict({})
    defaults = ProcessingParams()
    assert p.speed == defaults.speed
    assert p.power == defaults.power
    assert p.density == defaults.density
    assert p.mopa_frequency == defaults.mopa_frequency
    assert p.pulse_width == defaults.pulse_width
    assert p.repeat == defaults.repeat


def test_processing_params_from_palette_dict_accepts_canonical_keys() -> None:
    from xcs_gen_web.repositories.palette import (
        _processing_params_from_palette_dict,
    )

    raw = {
        "speed": 500,
        "power": 80.0,
        "density": 150,
        "mopa_frequency": 80,    # canonical dataclass name
        "repeat": 2,             # canonical dataclass name
        "pulse_width": 60,
    }
    p = _processing_params_from_palette_dict(raw)
    assert p.mopa_frequency == 80
    assert p.repeat == 2
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
uv run --active pytest tests/test_repo_palette.py::test_processing_params_from_palette_dict_handles_legacy_keys -v
```

Expected: ImportError on `_processing_params_from_palette_dict`.

- [ ] **Step 3: Add the helper to the repository module**

Edit `src/xcs_gen_web/repositories/palette.py`. Add the import near the top:

```python
from xcs_gen.model import ProcessingParams
```

Add this helper somewhere above `_build_row` (e.g. just below the `_now()` helper):

```python
def _processing_params_from_palette_dict(d: dict[str, Any]) -> ProcessingParams:
    """Build a ProcessingParams from the dict shape stored in
    palette_entries.params_json.

    Handles the historical key mismatches (`frequency` ↔
    `mopa_frequency`, `passes` ↔ `repeat`) so callers don't have to
    care which form a given row uses. Missing fields fall back to
    ProcessingParams defaults.
    """
    defaults = ProcessingParams()
    return ProcessingParams(
        speed=d.get("speed", defaults.speed),
        power=d.get("power", defaults.power),
        density=d.get("density", defaults.density),
        mopa_frequency=d.get(
            "mopa_frequency", d.get("frequency", defaults.mopa_frequency),
        ),
        pulse_width=d.get("pulse_width", defaults.pulse_width),
        repeat=d.get("repeat", d.get("passes", defaults.repeat)),
    )
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
uv run --active pytest tests/test_repo_palette.py -v -k processing_params_from_palette_dict
```

Expected: 3 passing.

- [ ] **Step 5: Commit**

```bash
git add src/xcs_gen_web/repositories/palette.py tests/test_repo_palette.py
git commit -m "feat(palette): adapter from params_json dict to ProcessingParams

Handles the legacy frequency↔mopa_frequency and passes↔repeat key
mismatches in one place so the indices compute path doesn't need to
know about historical key names."
```

---

## Task 3: Schema additions to `palette_entries`

**Files:**
- Modify: `src/xcs_gen_web/models.py`
- Modify: `tests/test_db_models.py`

- [ ] **Step 1: Write the failing test**

Append to `tests/test_db_models.py`:

```python
def test_palette_entries_has_indices_columns() -> None:
    from xcs_gen_web.models import palette_entries

    expected = {
        "pulse_spacing_mm",
        "line_spacing_index",
        "line_spacing_mm",
        "pulse_energy_index",
        "pulse_intensity_index",
        "surface_exposure_index",
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
    assert ("material_id", "surface_exposure_index") in indexed_pairs, (
        f"missing (material_id, surface_exposure_index) index; have {indexed_pairs}"
    )
    assert ("material_id", "pulse_intensity_index") in indexed_pairs, (
        f"missing (material_id, pulse_intensity_index) index; have {indexed_pairs}"
    )


def test_line_spacing_mm_is_nullable() -> None:
    from xcs_gen_web.models import palette_entries

    col = palette_entries.c.line_spacing_mm
    assert col.nullable is True, (
        "line_spacing_mm must be nullable — stays NULL while density_model='opaque'"
    )
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
uv run --active pytest tests/test_db_models.py -v -k indices
```

Expected: 3 failures — columns don't exist yet.

- [ ] **Step 3: Add the columns and indexes**

Edit `src/xcs_gen_web/models.py`. Find the `palette_entries = Table(` block. The block currently ends with several `validated_*` columns followed by `CheckConstraint(...)` calls — add the new columns just before the first `CheckConstraint(` line, alongside the existing `validated_*` columns (don't replace them):

```python
    Column("pulse_spacing_mm", Float, nullable=True),
    Column("line_spacing_index", Float, nullable=True),
    Column("line_spacing_mm", Float, nullable=True),
    Column("pulse_energy_index", Float, nullable=True),
    Column("pulse_intensity_index", Float, nullable=True),
    Column("surface_exposure_index", Float, nullable=True),
    Column(
        "indices_formula_version", Integer,
        nullable=False, server_default="1",
    ),
    Column(
        "density_model", String(32),
        nullable=False, server_default="opaque",
    ),
    Column(
        "power_model", String(32),
        nullable=False, server_default="controller_percent",
    ),
```

Then add the two composite indexes at the end of the table definition (after the existing `Index(...)` lines):

```python
    Index(
        "ix_palette_entries_material_exposure",
        "material_id", "surface_exposure_index",
    ),
    Index(
        "ix_palette_entries_material_intensity",
        "material_id", "pulse_intensity_index",
    ),
```

If `Float` or `Integer` aren't already imported in this file, add them to the existing SQLAlchemy import block.

- [ ] **Step 4: Run tests to verify they pass**

```bash
uv run --active pytest tests/test_db_models.py -v -k indices
```

Expected: 3 passing.

- [ ] **Step 5: Run the full models / schema test suite to catch any drift**

```bash
uv run --active pytest tests/test_db_models.py tests/test_schemas.py -v
```

Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add src/xcs_gen_web/models.py tests/test_db_models.py
git commit -m "feat(palette): exposure index columns on palette_entries

Adds nine columns (six index values + three metadata fields) plus two
composite indexes on (material_id, surface_exposure_index) and
(material_id, pulse_intensity_index) to keep the future
exposure-vs-intensity scatter query cheap. Numeric columns are
nullable to allow best-effort backfill in the migration."
```

---

## Task 4: Alembic migration with backfill

**Files:**
- Create: `alembic/versions/0022_palette_exposure_indices.py`
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: Write the migration**

Create `alembic/versions/0022_palette_exposure_indices.py`:

```python
"""Add laser exposure indices to palette_entries.

Adds six numeric columns plus three metadata columns capturing how
the indices were computed (`indices_formula_version`, `density_model`,
`power_model`). Two composite indexes cover the planned phase-2
exposure-vs-intensity scatter queries per material.

Backfill: walks every existing palette_entries row, parses
params_json, and populates the indices via xcs_gen.laser_indices.
Rows that fail to parse or hit a divide-by-zero are stamped with
indices_formula_version=0 so a `WHERE indices_formula_version = 0`
query surfaces them later.

Revision ID: 0022
Revises: 0021
"""
from __future__ import annotations

import json
import logging

import sqlalchemy as sa
from alembic import op


revision = "0022"
down_revision = "0021"
branch_labels = None
depends_on = None

log = logging.getLogger("alembic.runtime.migration.0022")


def upgrade() -> None:
    op.add_column(
        "palette_entries", sa.Column("pulse_spacing_mm", sa.Float, nullable=True),
    )
    op.add_column(
        "palette_entries", sa.Column("line_spacing_index", sa.Float, nullable=True),
    )
    op.add_column(
        "palette_entries", sa.Column("line_spacing_mm", sa.Float, nullable=True),
    )
    op.add_column(
        "palette_entries", sa.Column("pulse_energy_index", sa.Float, nullable=True),
    )
    op.add_column(
        "palette_entries", sa.Column("pulse_intensity_index", sa.Float, nullable=True),
    )
    op.add_column(
        "palette_entries", sa.Column("surface_exposure_index", sa.Float, nullable=True),
    )
    op.add_column(
        "palette_entries",
        sa.Column(
            "indices_formula_version", sa.Integer,
            nullable=False, server_default="1",
        ),
    )
    op.add_column(
        "palette_entries",
        sa.Column(
            "density_model", sa.String(32),
            nullable=False, server_default="opaque",
        ),
    )
    op.add_column(
        "palette_entries",
        sa.Column(
            "power_model", sa.String(32),
            nullable=False, server_default="controller_percent",
        ),
    )

    op.create_index(
        "ix_palette_entries_material_exposure",
        "palette_entries",
        ["material_id", "surface_exposure_index"],
    )
    op.create_index(
        "ix_palette_entries_material_intensity",
        "palette_entries",
        ["material_id", "pulse_intensity_index"],
    )

    # Backfill — best-effort; rows that fail get formula_version=0.
    # Imports are local to keep alembic env startup cheap and avoid
    # circular imports during stamp-only operations.
    from xcs_gen.laser_indices import INDICES_FORMULA_VERSION, compute_indices
    from xcs_gen.model import ProcessingParams

    conn = op.get_bind()
    rows = conn.execute(
        sa.text("SELECT id, params_json FROM palette_entries"),
    ).fetchall()

    update_sql = sa.text(
        "UPDATE palette_entries SET "
        "pulse_spacing_mm=:pulse_spacing_mm, "
        "line_spacing_index=:line_spacing_index, "
        "line_spacing_mm=:line_spacing_mm, "
        "pulse_energy_index=:pulse_energy_index, "
        "pulse_intensity_index=:pulse_intensity_index, "
        "surface_exposure_index=:surface_exposure_index, "
        "indices_formula_version=:formula_version, "
        "density_model=:density_model, "
        "power_model=:power_model "
        "WHERE id=:id"
    )

    skipped: list[tuple[int, str]] = []
    for row in rows:
        try:
            d = json.loads(row.params_json) if row.params_json else {}
            defaults = ProcessingParams()
            params = ProcessingParams(
                speed=d.get("speed", defaults.speed),
                power=d.get("power", defaults.power),
                density=d.get("density", defaults.density),
                mopa_frequency=d.get(
                    "mopa_frequency",
                    d.get("frequency", defaults.mopa_frequency),
                ),
                pulse_width=d.get("pulse_width", defaults.pulse_width),
                repeat=d.get("repeat", d.get("passes", defaults.repeat)),
            )
            indices = compute_indices(params)
            conn.execute(
                update_sql,
                {
                    "id": row.id,
                    "pulse_spacing_mm": indices.pulse_spacing_mm,
                    "line_spacing_index": indices.line_spacing_index,
                    "line_spacing_mm": indices.line_spacing_mm,
                    "pulse_energy_index": indices.pulse_energy_index,
                    "pulse_intensity_index": indices.pulse_intensity_index,
                    "surface_exposure_index": indices.surface_exposure_index,
                    "formula_version": INDICES_FORMULA_VERSION,
                    "density_model": indices.density_model,
                    "power_model": indices.power_model,
                },
            )
        except Exception as exc:  # noqa: BLE001 - best-effort backfill
            skipped.append((row.id, str(exc)))
            conn.execute(
                sa.text(
                    "UPDATE palette_entries SET indices_formula_version=0 "
                    "WHERE id=:id"
                ),
                {"id": row.id},
            )

    if skipped:
        log.warning(
            "0022 backfill: %d palette_entries rows could not be computed "
            "(formula_version=0); first few: %s",
            len(skipped), skipped[:5],
        )


def downgrade() -> None:
    op.drop_index(
        "ix_palette_entries_material_intensity", table_name="palette_entries",
    )
    op.drop_index(
        "ix_palette_entries_material_exposure", table_name="palette_entries",
    )
    op.drop_column("palette_entries", "power_model")
    op.drop_column("palette_entries", "density_model")
    op.drop_column("palette_entries", "indices_formula_version")
    op.drop_column("palette_entries", "surface_exposure_index")
    op.drop_column("palette_entries", "pulse_intensity_index")
    op.drop_column("palette_entries", "pulse_energy_index")
    op.drop_column("palette_entries", "line_spacing_mm")
    op.drop_column("palette_entries", "line_spacing_index")
    op.drop_column("palette_entries", "pulse_spacing_mm")
```

- [ ] **Step 2: Run the migration locally against a fresh DB**

```bash
rm -f /tmp/xcs-gen-test.db
XCS_GEN_DB_URL="sqlite:////tmp/xcs-gen-test.db" uv run --active alembic upgrade head
```

Expected: ends at revision `0022`, no errors.

- [ ] **Step 3: Verify idempotence**

```bash
XCS_GEN_DB_URL="sqlite:////tmp/xcs-gen-test.db" uv run --active alembic upgrade head
```

Expected: no-op (already at head).

- [ ] **Step 4: Verify reversibility**

```bash
XCS_GEN_DB_URL="sqlite:////tmp/xcs-gen-test.db" uv run --active alembic downgrade -1
XCS_GEN_DB_URL="sqlite:////tmp/xcs-gen-test.db" uv run --active alembic upgrade head
```

Expected: both succeed; final state at revision `0022`.

- [ ] **Step 5: Update the CI version assertion**

Edit `.github/workflows/ci.yml`. Find the line `test "$VER" = "0021"` (currently in `.github/workflows/ci.yml`) and change it to:

```yaml
          test "$VER" = "0022"
```

- [ ] **Step 6: Run alembic-related tests**

```bash
uv run --active pytest tests/test_alembic.py -v
```

Expected: all green (the existing test typically picks up new revisions automatically; if a hard-coded `head` assertion exists, update it).

- [ ] **Step 7: Commit**

```bash
git add alembic/versions/0022_palette_exposure_indices.py .github/workflows/ci.yml
git commit -m "feat(palette): alembic 0022 — exposure indices columns + backfill

Adds the nine new columns and two composite indexes on
palette_entries, then backfills every existing row by parsing
params_json and calling xcs_gen.laser_indices.compute_indices. Rows
that fail to parse get indices_formula_version=0 so they're queryable
later. Bumps CI revision assertion to 0022."
```

---

## Task 5: Repository — write indices on insert, expose on read

**Files:**
- Modify: `src/xcs_gen_web/repositories/palette.py`
- Modify: `tests/test_repo_palette.py`

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_repo_palette.py`:

```python
def test_insert_bulk_populates_indices(palette_db) -> None:
    """A new palette entry inserted via insert_bulk has all six index
    values populated and metadata stamped at the current formula
    version."""
    from xcs_gen.laser_indices import INDICES_FORMULA_VERSION
    from xcs_gen_web.repositories.palette import insert_bulk, get_by_id

    entry = {
        "test_id": None,
        "material_id": palette_db["material_id"],
        "x_value": 0.5,
        "y_value": None,
        "hex": "#abcdef",
        "params": {
            "speed": 1000,
            "power": 50.0,
            "density": 100,
            "frequency": 65,
            "passes": 1,
            "pulse_width": 200,
        },
        "sigma": 0.1,
        "source": "averaged",
        "source_result_id": None,
        "machine_id": "F2Ultra",
    }
    [eid] = insert_bulk([entry])
    out = get_by_id(eid)
    assert out is not None
    assert "indices" in out
    idx = out["indices"]
    assert idx["pulse_spacing_mm"] == pytest.approx(1000 / (65 * 1000))
    assert idx["line_spacing_index"] == pytest.approx(1 / 100)
    assert idx["line_spacing_mm"] is None
    assert idx["pulse_energy_index"] == pytest.approx(50 / 65)
    assert idx["pulse_intensity_index"] == pytest.approx(50 / (65 * 200))
    assert idx["surface_exposure_index"] == pytest.approx(50 * 100 * 1 / 1000)
    assert idx["formula_version"] == INDICES_FORMULA_VERSION
    assert idx["density_model"] == "opaque"
    assert idx["power_model"] == "controller_percent"


def test_create_manual_populates_indices(palette_db) -> None:
    from xcs_gen.laser_indices import INDICES_FORMULA_VERSION
    from xcs_gen_web.repositories.palette import create_manual

    out = create_manual(
        material_id=palette_db["material_id"],
        hex_="#112233",
        params={
            "speed": 800, "power": 40.0, "density": 200,
            "frequency": 60, "passes": 2, "pulse_width": 100,
        },
        notes="manual",
    )
    idx = out["indices"]
    assert idx["surface_exposure_index"] == pytest.approx(40 * 200 * 2 / 800)
    assert idx["formula_version"] == INDICES_FORMULA_VERSION


def test_list_all_includes_indices(palette_db) -> None:
    from xcs_gen_web.repositories.palette import insert_bulk, list_all

    insert_bulk([{
        "test_id": None,
        "material_id": palette_db["material_id"],
        "x_value": 1.0, "y_value": None,
        "hex": "#aabbcc",
        "params": {
            "speed": 600, "power": 70.0, "density": 150,
            "frequency": 80, "passes": 1, "pulse_width": 60,
        },
        "sigma": 0.0,
        "source": "averaged",
        "source_result_id": None,
        "machine_id": "F2Ultra",
    }])
    rows = list_all()
    assert rows
    for r in rows:
        assert "indices" in r
        assert r["indices"]["formula_version"] >= 1
```

If a `palette_db` fixture isn't already in `conftest.py` for this file's tests, follow the pattern of an existing repo test (e.g. `test_repo_palette.py`'s setup); reuse what's there rather than inventing a new fixture.

- [ ] **Step 2: Run tests to verify they fail**

```bash
uv run --active pytest tests/test_repo_palette.py -v -k "populates_indices or includes_indices"
```

Expected: KeyError / AttributeError on `indices` — the repo doesn't write or expose them yet.

- [ ] **Step 3: Update `_build_row` to compute and write indices**

Edit `src/xcs_gen_web/repositories/palette.py`. Add an import near the top:

```python
from xcs_gen.laser_indices import compute_indices
```

Then update `_build_row` to compute indices and inline them in the row dict:

```python
def _build_row(
    e: dict[str, Any], now: str, owner_id: int, visibility: str,
) -> dict[str, Any]:
    """Build a DB row dict from an entry dict. Used by insert_bulk and replace_for_test."""
    L, a, b = hex_to_lab(e["hex"])
    params_dict = e.get("params", {})
    indices = compute_indices(_processing_params_from_palette_dict(params_dict))
    return {
        "test_id": e["test_id"],
        "material_id": e["material_id"],
        "x_value": e.get("x_value"),
        "y_value": e.get("y_value"),
        "hex": e["hex"],
        "lab_l": L, "lab_a": a, "lab_b": b,
        "params_json": json.dumps(params_dict, separators=(",", ":")),
        "sigma": e["sigma"],
        "source": e["source"],
        "source_result_id": e.get("source_result_id"),
        "notes": e.get("notes", ""),
        "created_at": now,
        "owner_id": owner_id,
        "visibility": e.get("visibility", visibility),
        "machine_id": e.get("machine_id", "F2Ultra"),
        "pulse_spacing_mm": indices.pulse_spacing_mm,
        "line_spacing_index": indices.line_spacing_index,
        "line_spacing_mm": indices.line_spacing_mm,
        "pulse_energy_index": indices.pulse_energy_index,
        "pulse_intensity_index": indices.pulse_intensity_index,
        "surface_exposure_index": indices.surface_exposure_index,
        "indices_formula_version": indices.formula_version,
        "density_model": indices.density_model,
        "power_model": indices.power_model,
    }
```

- [ ] **Step 4: Update `_REFRESH_COLUMNS` so reingest refreshes indices too**

Currently `_REFRESH_COLUMNS = ("hex", "lab_l", "lab_a", "lab_b", "sigma", "params_json")`. Indices are derived from `params_json`, so they must refresh whenever `params_json` does:

```python
_REFRESH_COLUMNS = (
    "hex", "lab_l", "lab_a", "lab_b", "sigma", "params_json",
    "pulse_spacing_mm",
    "line_spacing_index",
    "line_spacing_mm",
    "pulse_energy_index",
    "pulse_intensity_index",
    "surface_exposure_index",
    "indices_formula_version",
    "density_model",
    "power_model",
)
```

- [ ] **Step 5: Update `_row_to_entry` to expose indices as a nested object**

`_row_to_entry` already returns a dict containing many keys (including
the validation-state keys `is_validated`, `validated_at`,
`validated_test_id`, `validated_lab`, `validated_run_count`,
`validated_residual_de`, `validated_cell_index`, `original_validated`).
DO NOT rewrite the function or rebuild the dict from scratch — that
would silently drop the validation keys.

Instead, add a single new `"indices"` key alongside the existing keys.
The simplest patch is to add it just before the closing `}` of the
return dict:

```python
        # ... existing keys (id, test_id, material_id, ..., is_validated,
        # validated_*, original_validated) stay exactly as they are.
        "indices": {
            "pulse_spacing_mm": r.pulse_spacing_mm,
            "line_spacing_index": r.line_spacing_index,
            "line_spacing_mm": r.line_spacing_mm,
            "pulse_energy_index": r.pulse_energy_index,
            "pulse_intensity_index": r.pulse_intensity_index,
            "surface_exposure_index": r.surface_exposure_index,
            "formula_version": r.indices_formula_version,
            "density_model": r.density_model,
            "power_model": r.power_model,
        },
    }
```

After editing, the function should return a dict containing every
existing key PLUS the new `indices` block. If you've removed any
existing key, you've broken the contract.

- [ ] **Step 6: Update `update_entry` so PATCHes that change `params` recompute the indices**

`update_entry` (in the same file) builds a `values` dict and applies
it as a partial UPDATE. When the `params` field is
provided, the indices need to recompute alongside the new
`params_json`. Locate the block:

```python
        if params is not None:
            values["params_json"] = json.dumps(params, separators=(",", ":"))
```

…and replace it with:

```python
        if params is not None:
            values["params_json"] = json.dumps(params, separators=(",", ":"))
            indices = compute_indices(_processing_params_from_palette_dict(params))
            values["pulse_spacing_mm"] = indices.pulse_spacing_mm
            values["line_spacing_index"] = indices.line_spacing_index
            values["line_spacing_mm"] = indices.line_spacing_mm
            values["pulse_energy_index"] = indices.pulse_energy_index
            values["pulse_intensity_index"] = indices.pulse_intensity_index
            values["surface_exposure_index"] = indices.surface_exposure_index
            values["indices_formula_version"] = indices.formula_version
            values["density_model"] = indices.density_model
            values["power_model"] = indices.power_model
```

Add a regression test in `tests/test_repo_palette.py`:

```python
def test_update_entry_refreshes_indices_when_params_change(palette_db) -> None:
    from xcs_gen_web.repositories.palette import (
        create_manual, update_entry, get_by_id,
    )

    out = create_manual(
        material_id=palette_db["material_id"],
        hex_="#445566",
        params={
            "speed": 1000, "power": 50, "density": 100,
            "frequency": 65, "passes": 1, "pulse_width": 200,
        },
        notes="",
    )
    eid = out["id"]
    original_exposure = out["indices"]["surface_exposure_index"]

    # Mutate params: doubling power should double surface_exposure_index.
    update_entry(eid, params={
        "speed": 1000, "power": 100, "density": 100,
        "frequency": 65, "passes": 1, "pulse_width": 200,
    })

    refreshed = get_by_id(eid)
    assert refreshed is not None
    assert refreshed["indices"]["surface_exposure_index"] == pytest.approx(
        original_exposure * 2,
    )
```

- [ ] **Step 7: Run repository tests to verify they pass**

```bash
uv run --active pytest tests/test_repo_palette.py -v
```

Expected: all green, including the four new tests and the existing tests (none should regress).

- [ ] **Step 8: Run the broader repository / palette test suite**

```bash
uv run --active pytest tests/test_repo_palette.py tests/test_palette.py tests/test_ingest_to_palette.py -v
```

Expected: all green.

- [ ] **Step 9: Commit**

```bash
git add src/xcs_gen_web/repositories/palette.py tests/test_repo_palette.py
git commit -m "feat(palette): write & expose exposure indices in repository

_build_row computes indices via compute_indices on every insert;
_row_to_entry surfaces them as a nested 'indices' object. Index
columns are added to _REFRESH_COLUMNS so re-ingest refreshes them
along with params_json, and update_entry recomputes when params are
PATCHed — keeping params_json and the indices columns in lockstep."
```

---

## Task 6: API schema — `LaserIndicesResponse` on `PaletteEntryResponse`

**Files:**
- Modify: `src/xcs_gen_web/schemas.py`
- Modify: `tests/test_schemas.py`
- Modify: `tests/test_palette_api.py`

- [ ] **Step 1: Write the failing tests (schemas + API)**

Append to `tests/test_schemas.py`:

```python
def test_palette_entry_response_includes_indices() -> None:
    from xcs_gen_web.schemas import LaserIndicesResponse, PaletteEntryResponse

    payload = {
        "id": 1,
        "test_id": None,
        "material_id": 1,
        "source": "averaged",
        "hex": "#aabbcc",
        "lab": [50.0, 0.0, 0.0],
        "params": {"speed": 1000},
        "sigma": 0.1,
        "notes": "",
        "created_at": "2026-05-07T00:00:00+00:00",
        "owner_id": 1,
        "visibility": "private",
        "machine_id": "F2Ultra",
        "indices": {
            "pulse_spacing_mm": 0.0154,
            "line_spacing_index": 0.01,
            "line_spacing_mm": None,
            "pulse_energy_index": 0.769,
            "pulse_intensity_index": 0.00385,
            "surface_exposure_index": 5.0,
            "formula_version": 1,
            "density_model": "opaque",
            "power_model": "controller_percent",
        },
    }
    resp = PaletteEntryResponse.model_validate(payload)
    assert isinstance(resp.indices, LaserIndicesResponse)
    assert resp.indices.surface_exposure_index == 5.0
    assert resp.indices.line_spacing_mm is None
```

Append to `tests/test_palette_api.py`:

```python
def test_get_palette_returns_indices_block(client, palette_seeded) -> None:
    """GET /api/palette returns each entry with a populated `indices`
    block (or with `formula_version=0` for unparseable rows — but the
    seeded entries are guaranteed-clean)."""
    r = client.get("/api/palette")
    assert r.status_code == 200
    entries = r.json()
    assert entries
    for e in entries:
        assert "indices" in e
        idx = e["indices"]
        for key in (
            "pulse_spacing_mm", "line_spacing_index", "line_spacing_mm",
            "pulse_energy_index", "pulse_intensity_index",
            "surface_exposure_index", "formula_version",
            "density_model", "power_model",
        ):
            assert key in idx, f"missing {key} in indices for entry {e['id']}"
        assert idx["formula_version"] >= 1
```

Use whichever client / seeding fixtures `tests/test_palette_api.py` already has — don't invent new ones. Match the existing pattern.

- [ ] **Step 2: Run tests to verify they fail**

```bash
uv run --active pytest tests/test_schemas.py tests/test_palette_api.py -v -k "indices"
```

Expected: failures — `LaserIndicesResponse` doesn't exist; `PaletteEntryResponse` has no `indices` field.

- [ ] **Step 3: Add `LaserIndicesResponse` and embed it on `PaletteEntryResponse`**

Edit `src/xcs_gen_web/schemas.py`. Add a new model just above `PaletteEntryResponse`:

```python
class LaserIndicesResponse(BaseModel):
    """Heuristic exposure indices derived from raw laser params.

    These are NOT calibrated physical quantities — see
    docs/superpowers/specs/2026-05-07-laser-exposure-indices-design.md.
    `formula_version`, `density_model`, and `power_model` capture how
    the values were computed so clients can detect stale rows after a
    formula bump.
    """

    pulse_spacing_mm: float
    line_spacing_index: float
    line_spacing_mm: float | None
    pulse_energy_index: float
    pulse_intensity_index: float
    surface_exposure_index: float
    formula_version: int
    density_model: str
    power_model: str
```

Then add a single new field to the existing `PaletteEntryResponse`
class. **Do NOT rewrite the class** — it already has many fields
including the `validated_*` and `original_validated` ones. Add only:

```python
    indices: LaserIndicesResponse
```

…as the last field in the class body. The rest of the class stays
exactly as it is.

- [ ] **Step 4: Run tests to verify they pass**

```bash
uv run --active pytest tests/test_schemas.py tests/test_palette_api.py -v
```

Expected: all green.

- [ ] **Step 5: Run the broader API suite to catch any consumer that built `PaletteEntryResponse` without `indices`**

```bash
uv run --active pytest tests/test_palette_api.py tests/test_api.py tests/test_validation_endpoints.py -v
```

Expected: all green. If any test seeds a `PaletteEntryResponse` directly (rather than going through the repo), it'll now require an `indices` block — fix the seed inline by computing it the same way the repo does, or by going through the repo's `create_manual` helper.

- [ ] **Step 6: Commit**

```bash
git add src/xcs_gen_web/schemas.py tests/test_schemas.py tests/test_palette_api.py
git commit -m "feat(palette): expose indices on PaletteEntryResponse

Adds the LaserIndicesResponse pydantic model and embeds it on
PaletteEntryResponse as a required `indices` block. The repo already
populates this block on every read, so all existing endpoints
automatically gain the new field."
```

---

## Task 7: CLI subcommand — `xcs-gen recompute-indices`

**Files:**
- Modify: `src/xcs_gen_web/repositories/palette.py` — add `recompute_indices()` function
- Modify: `src/xcs_gen/cli.py` — wire up the subcommand
- Modify: `tests/test_repo_palette.py` — test the recompute function
- Create: `tests/test_cli_recompute_indices.py` — smoke-test the CLI dispatch

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_repo_palette.py`:

```python
def test_recompute_indices_updates_stale_rows(palette_db) -> None:
    """recompute_indices walks rows whose indices_formula_version
    doesn't match the current version and rewrites them."""
    from sqlalchemy import select, update

    from xcs_gen.laser_indices import INDICES_FORMULA_VERSION
    from xcs_gen_web.db import session_scope
    from xcs_gen_web.models import palette_entries
    from xcs_gen_web.repositories.palette import (
        insert_bulk, recompute_indices,
    )

    [eid] = insert_bulk([{
        "test_id": None,
        "material_id": palette_db["material_id"],
        "x_value": 0.0, "y_value": None,
        "hex": "#deadbe",
        "params": {
            "speed": 1000, "power": 50, "density": 100,
            "frequency": 65, "passes": 1, "pulse_width": 200,
        },
        "sigma": 0.0,
        "source": "averaged",
        "source_result_id": None,
        "machine_id": "F2Ultra",
    }])

    # Manually stamp the row as stale (simulating a pre-formula-bump
    # state).
    with session_scope() as s:
        s.execute(
            update(palette_entries)
            .where(palette_entries.c.id == eid)
            .values(
                indices_formula_version=0,
                surface_exposure_index=None,
            )
        )

    n_updated = recompute_indices()
    assert n_updated >= 1

    with session_scope() as s:
        row = s.execute(
            select(palette_entries).where(palette_entries.c.id == eid),
        ).one()
    assert row.indices_formula_version == INDICES_FORMULA_VERSION
    assert row.surface_exposure_index == pytest.approx(50 * 100 * 1 / 1000)


def test_recompute_indices_skips_rows_already_at_current_version(
    palette_db,
) -> None:
    from xcs_gen_web.repositories.palette import insert_bulk, recompute_indices

    insert_bulk([{
        "test_id": None,
        "material_id": palette_db["material_id"],
        "x_value": 0.5, "y_value": None,
        "hex": "#cafe00",
        "params": {
            "speed": 1000, "power": 50, "density": 100,
            "frequency": 65, "passes": 1, "pulse_width": 200,
        },
        "sigma": 0.0,
        "source": "averaged",
        "source_result_id": None,
        "machine_id": "F2Ultra",
    }])
    # Default behaviour: only stale rows get rewritten.
    assert recompute_indices() == 0


def test_recompute_indices_force_updates_everything(palette_db) -> None:
    from xcs_gen_web.repositories.palette import insert_bulk, recompute_indices

    insert_bulk([{
        "test_id": None,
        "material_id": palette_db["material_id"],
        "x_value": 0.5, "y_value": None,
        "hex": "#cafe01",
        "params": {
            "speed": 1000, "power": 50, "density": 100,
            "frequency": 65, "passes": 1, "pulse_width": 200,
        },
        "sigma": 0.0,
        "source": "averaged",
        "source_result_id": None,
        "machine_id": "F2Ultra",
    }])
    # Force=True rewrites every row regardless of version.
    assert recompute_indices(force=True) >= 1
```

Create `tests/test_cli_recompute_indices.py`:

```python
"""Smoke-test the `xcs-gen recompute-indices` CLI dispatch."""
from __future__ import annotations

from unittest.mock import patch

from xcs_gen.cli import main


def test_cli_dispatches_to_recompute_indices() -> None:
    """Calling the CLI with `recompute-indices` invokes the repo
    function with the parsed arguments."""
    with patch(
        "xcs_gen_web.repositories.palette.recompute_indices",
        return_value=3,
    ) as mock_fn:
        main(["recompute-indices"])
        mock_fn.assert_called_once()
        kwargs = mock_fn.call_args.kwargs
        assert kwargs.get("material_id") is None
        assert kwargs.get("force") is False


def test_cli_passes_material_id_and_force() -> None:
    with patch(
        "xcs_gen_web.repositories.palette.recompute_indices",
        return_value=0,
    ) as mock_fn:
        main(["recompute-indices", "--material-id", "7", "--force"])
        kwargs = mock_fn.call_args.kwargs
        assert kwargs["material_id"] == 7
        assert kwargs["force"] is True
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
uv run --active pytest tests/test_repo_palette.py tests/test_cli_recompute_indices.py -v -k recompute
```

Expected: failures — `recompute_indices` and the CLI subcommand don't exist.

- [ ] **Step 3: Add `recompute_indices` to the repository module**

Append to `src/xcs_gen_web/repositories/palette.py`:

```python
def recompute_indices(
    *,
    material_id: int | None = None,
    force: bool = False,
    owner_id: int | None = None,
) -> int:
    """Recompute and persist exposure indices on palette_entries rows.

    By default only rows whose `indices_formula_version` doesn't match
    `INDICES_FORMULA_VERSION` are rewritten. `force=True` rewrites
    every row that matches the filter regardless of version. Returns
    the number of rows updated.

    Use after bumping `INDICES_FORMULA_VERSION` (formula change or
    calibration source switch) to flush stale values across the
    palette.
    """
    from xcs_gen.laser_indices import INDICES_FORMULA_VERSION

    with session_scope() as s:
        q = select(palette_entries)
        if material_id is not None:
            q = q.where(palette_entries.c.material_id == material_id)
        if owner_id is not None:
            q = q.where(palette_entries.c.owner_id == owner_id)
        if not force:
            q = q.where(
                palette_entries.c.indices_formula_version
                != INDICES_FORMULA_VERSION,
            )
        rows = s.execute(q).all()

        updated = 0
        for r in rows:
            try:
                params_dict = json.loads(r.params_json) if r.params_json else {}
                params = _processing_params_from_palette_dict(params_dict)
                indices = compute_indices(params)
                s.execute(
                    palette_entries.update()
                    .where(palette_entries.c.id == r.id)
                    .values(
                        pulse_spacing_mm=indices.pulse_spacing_mm,
                        line_spacing_index=indices.line_spacing_index,
                        line_spacing_mm=indices.line_spacing_mm,
                        pulse_energy_index=indices.pulse_energy_index,
                        pulse_intensity_index=indices.pulse_intensity_index,
                        surface_exposure_index=indices.surface_exposure_index,
                        indices_formula_version=indices.formula_version,
                        density_model=indices.density_model,
                        power_model=indices.power_model,
                    )
                )
                updated += 1
            except (ValueError, json.JSONDecodeError):
                # Best-effort: stamp the row as needing attention
                # (formula_version=0) without aborting the batch.
                s.execute(
                    palette_entries.update()
                    .where(palette_entries.c.id == r.id)
                    .values(indices_formula_version=0)
                )
        return updated
```

- [ ] **Step 4: Wire up the CLI subcommand**

Edit `src/xcs_gen/cli.py`. In the `main()` function, after the existing subparsers are added (search for `sub.add_parser("svg-`) but before parsing args, add:

```python
    rc_p = sub.add_parser(
        "recompute-indices",
        help="Recompute exposure indices on palette entries (used after a formula bump).",
    )
    rc_p.add_argument(
        "--material-id", type=int, default=None,
        help="Limit recompute to one material.",
    )
    rc_p.add_argument(
        "--force", action="store_true",
        help="Rewrite every row, even those already at the current formula version.",
    )
```

And add a dispatch handler. Find the existing `if args.command == "..."` chain and add a branch:

```python
    if args.command == "recompute-indices":
        from xcs_gen_web.repositories.palette import recompute_indices

        n = recompute_indices(material_id=args.material_id, force=args.force)
        print(f"Recomputed indices on {n} palette entries.")
        return
```

(Match the dispatch style of whichever neighbouring subcommands already exist — there may be a function-per-subcommand pattern (`_svg_detect`, `_svg_generate`) you can mirror.)

- [ ] **Step 5: Run tests to verify they pass**

```bash
uv run --active pytest tests/test_repo_palette.py tests/test_cli_recompute_indices.py -v -k recompute
```

Expected: all green.

- [ ] **Step 6: Smoke-run the CLI against a real DB**

```bash
uv run --active xcs-gen recompute-indices --help
```

Expected: argparse help text including `--material-id` and `--force`.

```bash
uv run --active xcs-gen recompute-indices
```

Expected: `Recomputed indices on N palette entries.` (N = 0 in a fresh DB; non-zero if any rows are stale).

- [ ] **Step 7: Commit**

```bash
git add src/xcs_gen_web/repositories/palette.py src/xcs_gen/cli.py \
        tests/test_repo_palette.py tests/test_cli_recompute_indices.py
git commit -m "feat(cli): xcs-gen recompute-indices

Adds a CLI subcommand and the underlying repo function for refreshing
exposure indices after a formula bump. Default behaviour only touches
rows whose indices_formula_version != INDICES_FORMULA_VERSION;
--force rewrites every row, --material-id N scopes to one material."
```

---

## Task 8: Frontend chip strip component

**Files:**
- Create: `web/src/components/PaletteIndicesChips.tsx`
- Create: `web/src/components/PaletteIndicesChips.test.tsx`

- [ ] **Step 1: Write the failing component test**

Create `web/src/components/PaletteIndicesChips.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { PaletteIndicesChips } from "./PaletteIndicesChips";

const indices = {
  pulse_spacing_mm: 0.0154,
  line_spacing_index: 0.01,
  line_spacing_mm: null,
  pulse_energy_index: 0.769,
  pulse_intensity_index: 0.00385,
  surface_exposure_index: 5.0,
  formula_version: 1,
  density_model: "opaque",
  power_model: "controller_percent",
};

describe("PaletteIndicesChips", () => {
  it("renders all six chip labels", () => {
    render(<PaletteIndicesChips indices={indices} />);
    expect(screen.getByText(/pulse spacing/i)).toBeInTheDocument();
    expect(screen.getByText(/line spacing index/i)).toBeInTheDocument();
    expect(screen.getByText(/line spacing \(mm\)/i)).toBeInTheDocument();
    expect(screen.getByText(/pulse energy/i)).toBeInTheDocument();
    expect(screen.getByText(/pulse intensity/i)).toBeInTheDocument();
    expect(screen.getByText(/surface exposure/i)).toBeInTheDocument();
  });

  it("shows '—' when line_spacing_mm is null", () => {
    render(<PaletteIndicesChips indices={indices} />);
    const chip = screen.getByText(/line spacing \(mm\)/i).closest("div")!;
    expect(chip.textContent).toContain("—");
  });

  it("renders a numeric line_spacing_mm when populated", () => {
    render(
      <PaletteIndicesChips
        indices={{ ...indices, line_spacing_mm: 0.123 }}
      />,
    );
    const chip = screen.getByText(/line spacing \(mm\)/i).closest("div")!;
    expect(chip.textContent).toMatch(/0\.123/);
  });

  it("shows the formula version badge", () => {
    render(<PaletteIndicesChips indices={indices} />);
    expect(screen.getByText(/v1/i)).toBeInTheDocument();
  });

  it("renders surface_exposure_index value", () => {
    render(<PaletteIndicesChips indices={indices} />);
    const chip = screen.getByText(/surface exposure/i).closest("div")!;
    expect(chip.textContent).toMatch(/5\.0|5(?!\d)/);
  });
});
```

- [ ] **Step 2: Run vitest to verify it fails**

```bash
cd web && npx vitest run src/components/PaletteIndicesChips.test.tsx
```

Expected: ImportError — component doesn't exist.

- [ ] **Step 3: Write the component**

Create `web/src/components/PaletteIndicesChips.tsx`:

```tsx
import * as React from "react";

export interface LaserIndices {
  pulse_spacing_mm: number;
  line_spacing_index: number;
  line_spacing_mm: number | null;
  pulse_energy_index: number;
  pulse_intensity_index: number;
  surface_exposure_index: number;
  formula_version: number;
  density_model: string;
  power_model: string;
}

interface ChipProps {
  label: string;
  value: string;
  // Optional log-scale bar (0..1). Used for surface_exposure_index.
  bar?: number;
}

const Chip: React.FC<ChipProps> = ({ label, value, bar }) => (
  <div
    className="flex flex-col gap-0.5 rounded-sm border border-zinc-700/60 bg-zinc-900/40 px-2 py-1 text-xs"
    role="group"
  >
    <span className="font-sans uppercase tracking-wider text-[10px] text-zinc-400">
      {label}
    </span>
    <span className="font-mono tabular-nums text-zinc-100">{value}</span>
    {bar !== undefined && (
      <div className="mt-0.5 h-0.5 w-full bg-zinc-800">
        <div
          className="h-full bg-amber-400/70"
          style={{ width: `${Math.max(0, Math.min(1, bar)) * 100}%` }}
        />
      </div>
    )}
  </div>
);

function fmtNum(n: number, sig: number = 4): string {
  if (!Number.isFinite(n)) return "—";
  // Prefer fixed notation for small values, exponential for very small / very large.
  const abs = Math.abs(n);
  if (abs === 0) return "0";
  if (abs < 1e-3 || abs >= 1e5) return n.toExponential(2);
  return n.toPrecision(sig);
}

// Map a positive value into a 0..1 log-scaled bar, anchored to a
// realistic palette exposure range (~1 to ~2000). Anything below the
// floor renders as a tiny stub; above the ceiling caps at full.
function logBar(v: number, lo: number = 1, hi: number = 2000): number {
  if (v <= 0 || !Number.isFinite(v)) return 0;
  const t = (Math.log10(v) - Math.log10(lo)) / (Math.log10(hi) - Math.log10(lo));
  return Math.max(0, Math.min(1, t));
}

export const PaletteIndicesChips: React.FC<{ indices: LaserIndices }> = ({
  indices,
}) => {
  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
        <Chip
          label="Pulse spacing"
          value={`${fmtNum(indices.pulse_spacing_mm)} mm`}
        />
        <Chip
          label="Line spacing index"
          value={fmtNum(indices.line_spacing_index)}
        />
        <Chip
          label="Line spacing (mm)"
          value={
            indices.line_spacing_mm === null
              ? "—"
              : `${fmtNum(indices.line_spacing_mm)}`
          }
        />
        <Chip
          label="Pulse energy"
          value={fmtNum(indices.pulse_energy_index)}
        />
        <Chip
          label="Pulse intensity"
          value={fmtNum(indices.pulse_intensity_index)}
        />
        <Chip
          label="Surface exposure"
          value={fmtNum(indices.surface_exposure_index)}
          bar={logBar(indices.surface_exposure_index)}
        />
      </div>
      <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-wider text-zinc-500">
        <span
          title={`density_model=${indices.density_model}; power_model=${indices.power_model}`}
        >
          v{indices.formula_version}
        </span>
        <span aria-hidden="true">·</span>
        <span>heuristic indices, not calibrated values</span>
      </div>
    </div>
  );
};
```

- [ ] **Step 4: Run vitest to verify it passes**

```bash
cd web && npx vitest run src/components/PaletteIndicesChips.test.tsx
```

Expected: 5 passing.

- [ ] **Step 5: Typecheck**

```bash
cd web && npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add web/src/components/PaletteIndicesChips.tsx \
        web/src/components/PaletteIndicesChips.test.tsx
git commit -m "feat(ui): PaletteIndicesChips component

Six chips rendering the LaserIndices block, with — for nullable
line_spacing_mm, log-scaled bar on surface_exposure_index since it
spans orders of magnitude, and a discreet 'v1 · heuristic indices,
not calibrated values' note so we don't oversell the numbers."
```

---

## Task 9: Wire the chip strip into `PaletteEntryDialog`

**Files:**
- Modify: `web/src/components/PaletteEntryDialog.tsx`

- [ ] **Step 1: Read the current dialog to find the right insertion point**

```bash
sed -n '1,30p' web/src/components/PaletteEntryDialog.tsx
```

(Reading the file fully is fine too — use the Read tool. The component renders the per-entry detail; insert the chip strip somewhere visible, ideally just below the existing params display.)

- [ ] **Step 2: Add the import**

Near the existing imports:

```tsx
import { PaletteIndicesChips } from "./PaletteIndicesChips";
```

If the dialog has a typed `entry` prop, ensure its TypeScript type includes `indices: LaserIndices`. If the type is implicit / inferred from a fetched payload, no edit is needed — the field will appear automatically.

- [ ] **Step 3: Render the chip strip**

In the dialog's body, just below the section that shows the laser params (search for `params` rendering — typically a small grid of speed/power/density/etc.), insert:

```tsx
{entry.indices && (
  <div className="mt-3 border-t border-zinc-800 pt-3">
    <h4 className="mb-2 font-sans text-xs uppercase tracking-wider text-zinc-400">
      Exposure indices
    </h4>
    <PaletteIndicesChips indices={entry.indices} />
  </div>
)}
```

The conditional protects against pre-deploy stale clients that haven't refetched yet.

- [ ] **Step 4: Build the frontend**

```bash
cd web && npm run build
```

Expected: clean build, `web/dist/` updated.

- [ ] **Step 5: Typecheck and run vitest**

```bash
cd web && npx tsc --noEmit && npm test -- --run
```

Expected: typecheck clean; all vitest tests pass.

- [ ] **Step 6: Manual visual check**

Start the dev server:

```bash
uv run --active xcs-gen serve --host 127.0.0.1 --port 8017
```

In a browser, open `http://127.0.0.1:8017/#/palette` (or wherever palette entries are listed in this build), open one entry's detail dialog, and verify the chip strip renders. Confirm:

- All six chips visible
- `Line spacing (mm)` shows `—`
- `Surface exposure` chip has a log-scaled bar
- `v1 · heuristic indices, not calibrated values` footer is present
- JetBrains Mono numerals
- Layout doesn't break on narrow widths (use the responsive panel width or shrink the window)

If anything looks off, fix in `PaletteIndicesChips.tsx` and rebuild.

- [ ] **Step 7: Take a screenshot for the changelog**

Capture a clean screenshot of the chip strip in the entry detail panel and save it as `changelog/images/laser-exposure-indices-chips.png`.

- [ ] **Step 8: Commit**

```bash
git add web/src/components/PaletteEntryDialog.tsx changelog/images/laser-exposure-indices-chips.png
git commit -m "feat(ui): show exposure indices on palette entry detail

Renders PaletteIndicesChips below the params block in
PaletteEntryDialog. Wrapped in an entry.indices guard so legacy
client builds without the new schema don't crash."
```

---

## Task 10: Changelog entry

**Files:**
- Create: `changelog/2026-05-07-laser-exposure-indices.md`

- [ ] **Step 1: Write the entry**

Create `changelog/2026-05-07-laser-exposure-indices.md`:

```markdown
---
id: 2026-05-07-laser-exposure-indices
date: 2026-05-07
level: major
title: Exposure indices on every palette entry
summary: Six derived numbers per entry — pulse spacing, line spacing, pulse energy, pulse intensity, surface exposure — surfacing how each colour was actually exposed to the laser.
images:
  - src: laser-exposure-indices-chips.png
    caption: The new chip strip on a palette entry, with surface exposure log-scaled to handle the order-of-magnitude range.
---

Every palette entry now carries a small set of derived **exposure
indices** computed from its raw laser parameters. Open any entry on
the palette page and the new chip strip shows:

- **Pulse spacing (mm)** — how far the head moves between pulses
  (`speed / frequency`). Real millimetres.
- **Line spacing index** — `1 / density`. Dimensionless: xTool's
  `density` is a controller setting, not a guaranteed lines-per-cm,
  so we don't claim mm here yet.
- **Line spacing (mm)** — empty (`—`) for now. Lights up once we
  ship per-machine density calibration.
- **Pulse energy index** — `power / frequency`. How much the
  controller asks each pulse to deliver, before it gets spread out by
  pulse width.
- **Pulse intensity index** — `power / (frequency × pulse width)`.
  Per-pulse "violence" — short pulses at low frequency hit harder
  even at the same average power.
- **Surface exposure index** — `power × density × repeat / speed`.
  The big one: total controller-driven exposure per unit area. This
  is the axis on which colour families separate.

These are explicitly **heuristic indices, not calibrated joules**.
xTool's `power %` and `density` are controller settings whose
mapping to wall-plug watts and physical line spacing isn't
guaranteed. The chip strip footer shows `v1 · heuristic indices, not
calibrated values` so we don't oversell them.

Why bother? Two engravings can hit the same colour through totally
different parameter combinations — higher power vs. lower frequency
vs. tighter line spacing. The indices give a principled way to
compare them, and they're the substrate for an upcoming exploration
page that plots palette entries in exposure-vs-intensity space, per
material.

Existing palette entries got the indices computed retroactively
during the migration; new entries get them on insert. If the formula
changes later (when calibration arrives), `xcs-gen recompute-indices`
flushes every row to the new version in one pass.
```

- [ ] **Step 2: Verify the changelog renders**

Restart the dev server and visit `http://127.0.0.1:8017/#/changelog`. Confirm the new entry appears at the top with the screenshot.

- [ ] **Step 3: Commit**

```bash
git add changelog/2026-05-07-laser-exposure-indices.md
git commit -m "changelog: laser exposure indices on every palette entry"
```

---

## Task 11: Final verification

- [ ] **Step 1: Run the full backend test suite**

```bash
uv run --active pytest tests/ -q
```

Expected: all green.

- [ ] **Step 2: Run frontend typecheck and tests**

```bash
cd web && npx tsc --noEmit && npm test -- --run
```

Expected: clean typecheck, all vitest passing.

- [ ] **Step 3: Run alembic upgrade against a fresh MySQL or SQLite DB once more**

If you have docker available:

```bash
# (Match the CI harness — see .github/workflows/ci.yml mysql-migration-test)
# Easier locally: SQLite
rm -f /tmp/xcs-gen-final.db
XCS_GEN_DB_URL="sqlite:////tmp/xcs-gen-final.db" uv run --active alembic upgrade head
XCS_GEN_DB_URL="sqlite:////tmp/xcs-gen-final.db" uv run --active alembic upgrade head  # idempotent
```

Expected: ends at revision `0022`; second run is a no-op.

- [ ] **Step 4: Push and open a draft PR**

```bash
git push -u origin feat/laser-exposure-indices
gh pr create --draft \
  --title "Exposure indices on palette entries" \
  --body "$(cat <<'EOF'
## Summary

- Adds six derived exposure indices to every palette entry, computed
  from raw laser parameters and framed as opaque controller-setting
  products (not calibrated physics).
- Pure compute module in \`src/xcs_gen/laser_indices.py\`; six numeric
  + three metadata columns on \`palette_entries\`; backfill in alembic
  \`0022\`; \`xcs-gen recompute-indices\` CLI for future formula bumps.
- New chip strip on the palette entry detail dialog. Major-level
  changelog entry.

## Test plan

- [ ] \`uv run --active pytest tests/ -q\`
- [ ] \`cd web && npx tsc --noEmit && npm test -- --run\`
- [ ] \`uv run --active alembic upgrade head\` succeeds against a fresh DB
- [ ] Manual: chip strip renders in \`PaletteEntryDialog\` with all six chips, \`—\` for null \`line_spacing_mm\`, log bar on \`surface_exposure_index\`, \`v1\` formula version badge.
- [ ] \`xcs-gen recompute-indices --force\` smoke-runs against a populated DB.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 5: Flip to ready for review when CI is green**

```bash
gh pr ready
```

---

## Self-review notes (verifying spec coverage)

| Spec requirement | Implementing task |
| --- | --- |
| Pure compute module with `compute_indices(params, density_model, power_model)` | Task 1 |
| `LaserIndices` frozen dataclass with all six values + 3 metadata fields | Task 1 |
| `INDICES_FORMULA_VERSION = 1` | Task 1 |
| Adapter for params_json dict shape | Task 2 |
| Six numeric + 3 metadata columns on `palette_entries` | Task 3 |
| `(material_id, surface_exposure_index)` and `(material_id, pulse_intensity_index)` indexes | Task 3 |
| Alembic migration adds columns, indexes, backfill | Task 4 |
| Backfill: failing rows get `formula_version=0` | Task 4 |
| CI version assertion bumped 0021 → 0022 | Task 4 |
| `_build_row` calls `compute_indices` and writes index columns | Task 5 |
| `_REFRESH_COLUMNS` includes index columns (re-ingest refreshes) | Task 5 |
| `_row_to_entry` exposes nested `indices` dict | Task 5 |
| `LaserIndicesResponse` Pydantic model | Task 6 |
| `PaletteEntryResponse.indices: LaserIndicesResponse` | Task 6 |
| `xcs-gen recompute-indices [--material-id N] [--force]` CLI | Task 7 |
| Default behaviour: only stale rows; `--force` rewrites everything | Task 7 |
| Chip strip UI on palette entry detail | Tasks 8, 9 |
| `Line spacing (mm)` shows `—` while null | Task 8 |
| Log-scaled bar on `surface_exposure_index` | Task 8 |
| Formula version badge | Task 8 |
| Major-level changelog entry with screenshot | Task 10 |
