# Test Schema Lineage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add explicit lineage between tests and palette entries (`tests.source_test_id`, `tests.parent_test_id`, `tests.tag`, `palette_entries.derived_from_entry_id`); make laser `density` first-class as lines/cm and replace the dimensionless `line_spacing_index` with a populated `line_spacing_mm`.

**Architecture:** A single Alembic migration (0024) adds three FK columns on `tests`, one FK column on `palette_entries`, drops `palette_entries.line_spacing_index`, and runs two backfill passes (test→source-test from validation cells, entry→source-entry from `validated_cell_index`). The pure-compute `LaserIndices` dataclass loses its `line_spacing_index` field and bumps formula version 2 → 3, with `density_model="lpc"` becoming the only legal value for fresh computation. Repos, schemas, and the validation-ingest path in `app.py` propagate the new fields. Frontend renames `line_spacing_index` → `line_spacing_mm` everywhere it appears (correlations matrix, scatter, palette indices chips, help copy) and drops the redundant chip.

**Tech Stack:** Python 3.12, FastAPI, SQLAlchemy 2.x, Alembic, Pydantic v2, pytest, React 18 + TypeScript + vitest.

**Spec:** `docs/superpowers/specs/2026-05-10-test-schema-lineage-design.md`

---

## File structure

**New:**
- `alembic/versions/0024_test_schema_lineage.py` — schema additions + `line_spacing_index` drop + two backfill passes + indices recompute (formula v3).

**Modified — backend:**
- `src/xcs_gen/laser_indices.py` — `LaserIndices` dataclass loses `line_spacing_index`, formula version 2 → 3, default `density_model="lpc"`, `compute_indices()` rejects any other value.
- `src/xcs_gen_web/models.py` — `tests` gains `source_test_id`/`parent_test_id`/`tag` (+ indexes); `palette_entries` gains `derived_from_entry_id` (+ index) and drops `line_spacing_index`.
- `src/xcs_gen_web/repositories/palette.py` — `_compute_index_values`, `_REFRESH_COLUMNS`, `_row_to_entry`, `create_validated_entry` lose `line_spacing_index`; `_row_to_entry` and `create_validated_entry` gain `derived_from_entry_id`.
- `src/xcs_gen_web/repositories/tests.py` — `_row` carries `source_test_id`/`parent_test_id`/`tag`; `update()` accepts `parent_test_id` and `tag`.
- `src/xcs_gen_web/repositories/validation_cells.py` — after `replace_for_test`, recompute and persist the test's `source_test_id` from the new cells.
- `src/xcs_gen_web/schemas.py` — `LaserIndicesResponse`, `TestResponse`, `TestUpdate`, `PaletteEntryResponse` updated.
- `src/xcs_gen_web/app.py` — both `tests_validate` flows (around line 1990 and ~2150) pass `derived_from_entry_id` to `pal_repo.create_validated_entry`.
- `.github/workflows/ci.yml` — `mysql-migration-test` revision assertion bumps `0023` → `0024`.

**Modified — frontend:**
- `web/src/components/exposure/exposureCorrelations.ts` — `INDEX_ROWS` rename.
- `web/src/components/exposure/exposureHelpCopy.ts` — `EXPOSURE_INDEX_HELP` rename + content; `EXPOSURE_RAW_PARAM_HELP.density` unit change; cross-reference cleanup of input-units.
- `web/src/pages/ExposurePage.tsx` — `INDEX_LABELS` and `INDEX_LABELS_MATRIX` rename.
- `web/src/components/PaletteIndicesChips.tsx` — chip count drops 8 → 7; `Line spacing index` chip removed; `Line spacing (mm)` becomes the prime `Line spacing` chip; `LaserIndices` interface drops `line_spacing_index`; `CHIP_INDEX_KEY` updated.

**Modified — tests:**
- `tests/test_db_models.py`, `tests/test_laser_indices.py`, `tests/test_repo_palette.py`, `tests/test_repo_tests.py`, `tests/test_palette_api.py`, `tests/test_test_api.py`, `tests/test_schemas.py` — covered task by task.
- `web/src/components/PaletteIndicesChips.test.tsx`, `web/src/components/exposure/exposureHelpCopy.test.ts`, `web/src/components/exposure/exposureCorrelations.test.ts`, `web/src/pages/ExposurePage.test.tsx`, `web/src/components/exposure/ExposureScatter.test.tsx` — frontend updates.

**Created — changelog:**
- `changelog/2026-05-11-test-schema-lineage.md`.

---

### Task 1: `LaserIndices` formula version 3 (`density_model="lpc"`)

Pure-Python, isolated. The dataclass loses `line_spacing_index`; the function defaults to and only accepts `density_model="lpc"`.

**Files:**
- Modify: `src/xcs_gen/laser_indices.py`
- Modify: `tests/test_laser_indices.py`

- [ ] **Step 1: Read the current file**

```bash
sed -n '1,120p' /Users/jonzky/Documents/XTools/Reverse/src/xcs_gen/laser_indices.py
```

Note: `INDICES_FORMULA_VERSION = 2`; `LaserIndices` has `line_spacing_index: float`; `compute_indices` accepts `density_model: str = "opaque"` and raises if not `"opaque"`.

- [ ] **Step 2: Update the failing test first (TDD)**

In `tests/test_laser_indices.py`, find the existing test that asserts `line_spacing_index` and the existing test that asserts `density_model="opaque"` is the default. Adjust them and add a new one. Final shape:

```python
def test_compute_indices_returns_line_spacing_mm():
    p = ProcessingParams(speed=600, power=50, density=5000,
                         mopa_frequency=200, pulse_width=100, repeat=1)
    out = compute_indices(p)
    # line_spacing_mm = 10 / density (cm → mm; lines/cm → mm/line)
    assert out.line_spacing_mm == 10 / 5000
    assert out.density_model == "lpc"
    assert out.formula_version == 3


def test_compute_indices_defaults_density_model_to_lpc():
    p = ProcessingParams(speed=600, power=50, density=100,
                         mopa_frequency=30, pulse_width=2,
                         repeat=1)
    out = compute_indices(p)
    assert out.density_model == "lpc"


def test_compute_indices_rejects_legacy_opaque_density_model():
    p = ProcessingParams(speed=600, power=50, density=100,
                         mopa_frequency=30, pulse_width=2,
                         repeat=1)
    with pytest.raises(ValueError, match="density_model"):
        compute_indices(p, density_model="opaque")


def test_laser_indices_dataclass_has_no_line_spacing_index():
    fields = {f.name for f in dataclasses.fields(LaserIndices)}
    assert "line_spacing_index" not in fields
    assert "line_spacing_mm" in fields
```

(Also update or remove any legacy test that asserted `line_spacing_index = 1/density` or that compute_indices accepts `"opaque"`. Keep tests that exercise the other indices unchanged.)

Imports needed at the top of the test file: `import dataclasses`, `import pytest`, `from xcs_gen.laser_indices import compute_indices, LaserIndices`.

- [ ] **Step 3: Run tests to verify they fail**

```bash
uv run --active pytest tests/test_laser_indices.py -v
```

Expected: failures referencing `line_spacing_index`, formula_version=2, default `density_model="opaque"`.

- [ ] **Step 4: Update `src/xcs_gen/laser_indices.py`**

Replace the file's contents with:

```python
"""Derived exposure indices for laser parameters.

These are HEURISTIC INDICES, not calibrated physical quantities for
power. ``density`` is treated as lines per cm — confirmed by the
controller stepped-value tables in ``xcs_gen.machines`` — so
``line_spacing_mm`` IS a real physical quantity (10 / density mm/line).
``power_model`` stays opaque pending wall-plug-watts calibration.

Formula change vs. v2 (PR #80 lineage):
- ``density_model`` default + only legal value is now ``"lpc"``;
  ``"opaque"`` is no longer accepted (legacy rows still deserialise via
  the response schema, they're just not recomputed without an explicit
  pass).
- ``line_spacing_index`` is removed from the dataclass and from any
  downstream consumer. ``line_spacing_mm`` carries the same information
  in a meaningful unit.

``mopa_frequency`` is in kHz; ``speed`` is mm/s; ``pulse_width`` is ns;
``power`` is the controller % setting.
"""

from __future__ import annotations

from dataclasses import dataclass

from .model import ProcessingParams

INDICES_FORMULA_VERSION = 3


@dataclass(frozen=True)
class LaserIndices:
    pulse_spacing_mm: float
    line_spacing_mm: float
    pulse_energy_index: float
    pulse_intensity_index: float
    total_exposure_index: float
    ablation_aggression_index: float
    delivery_smoothness_index: float
    formula_version: int
    density_model: str
    power_model: str


def compute_indices(
    params: ProcessingParams,
    *,
    density_model: str = "lpc",
    power_model: str = "controller_percent",
) -> LaserIndices:
    """Compute derived exposure indices from raw `ProcessingParams`.

    Raises `ValueError` (naming the offending field) if any input that
    appears in a denominator is zero, or if either model string is not
    the supported value for formula version 3.
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

    if density_model != "lpc":
        raise ValueError(
            f"density_model={density_model!r} not supported in formula "
            f"version {INDICES_FORMULA_VERSION} (only 'lpc' is accepted)",
        )

    if power_model != "controller_percent":
        raise ValueError(
            f"power_model={power_model!r} not supported in formula "
            f"version {INDICES_FORMULA_VERSION}",
        )

    pulse_spacing_mm = speed / (freq * 1000)
    line_spacing_mm = 10 / density  # 1 cm = 10 mm; lines/cm → mm/line
    pulse_energy_index = power / freq
    pulse_intensity_index = power / (freq * pw)
    total_exposure_index = power * density * repeat / speed
    ablation_aggression_index = total_exposure_index * pulse_intensity_index
    delivery_smoothness_index = total_exposure_index / pulse_intensity_index

    return LaserIndices(
        pulse_spacing_mm=pulse_spacing_mm,
        line_spacing_mm=line_spacing_mm,
        pulse_energy_index=pulse_energy_index,
        pulse_intensity_index=pulse_intensity_index,
        total_exposure_index=total_exposure_index,
        ablation_aggression_index=ablation_aggression_index,
        delivery_smoothness_index=delivery_smoothness_index,
        formula_version=INDICES_FORMULA_VERSION,
        density_model=density_model,
        power_model=power_model,
    )
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
uv run --active pytest tests/test_laser_indices.py -v
```

Expected: PASS.

- [ ] **Step 6: Run downstream tests to find what breaks**

```bash
uv run --active pytest tests/ -q 2>&1 | tail -30
```

Expect failures in `test_repo_palette.py`, `test_palette_api.py`, `test_schemas.py`, `test_db_models.py` referencing `line_spacing_index` or `density_model="opaque"`. These are addressed in Tasks 3, 5, 6, and 7 respectively. Note them, but DO NOT fix them in this task.

- [ ] **Step 7: Commit**

```bash
git add src/xcs_gen/laser_indices.py tests/test_laser_indices.py
git commit -m "$(cat <<'EOF'
feat(laser_indices): formula v3 with density_model='lpc' default

LaserIndices loses line_spacing_index; line_spacing_mm = 10 / density
(lines/cm). compute_indices() rejects density_model='opaque' for
fresh computation — legacy rows that already store 'opaque' still
deserialise via the response schema, they just don't recompute
without explicit migration.

INDICES_FORMULA_VERSION 2 -> 3.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: `models.py` schema declaration

Updates the SQLAlchemy table definitions so fresh test fixtures (which build via `metadata.create_all`) match the new shape. No DB migration yet — that's Task 7.

**Files:**
- Modify: `src/xcs_gen_web/models.py`
- Modify: `tests/test_db_models.py`

- [ ] **Step 1: Write failing tests**

Append to `tests/test_db_models.py`:

```python
def test_tests_table_has_lineage_columns():
    from xcs_gen_web.models import tests
    cols = {c.name for c in tests.columns}
    assert "source_test_id" in cols
    assert "parent_test_id" in cols
    assert "tag" in cols
    # FKs point at tests.id with ON DELETE SET NULL.
    src_fk = next(fk for c in tests.columns for fk in c.foreign_keys
                  if c.name == "source_test_id")
    assert src_fk.target_fullname == "tests.id"
    assert src_fk.ondelete == "SET NULL"


def test_palette_entries_table_has_derived_from_and_no_line_spacing_index():
    from xcs_gen_web.models import palette_entries
    cols = {c.name for c in palette_entries.columns}
    assert "derived_from_entry_id" in cols
    assert "line_spacing_index" not in cols
    assert "line_spacing_mm" in cols
    fk = next(fk for c in palette_entries.columns for fk in c.foreign_keys
              if c.name == "derived_from_entry_id")
    assert fk.target_fullname == "palette_entries.id"
    assert fk.ondelete == "SET NULL"
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
uv run --active pytest tests/test_db_models.py -v -k "lineage or derived_from"
```

Expected: FAIL — columns absent.

- [ ] **Step 3: Update `src/xcs_gen_web/models.py`**

In the `tests` table (around line 138), add three columns AFTER the `kind` column (line 156) and before the `CheckConstraint` lines:

```python
    Column(
        "source_test_id", Integer,
        ForeignKey("tests.id", ondelete="SET NULL"),
        nullable=True,
    ),
    Column(
        "parent_test_id", Integer,
        ForeignKey("tests.id", ondelete="SET NULL"),
        nullable=True,
    ),
    Column("tag", String(64), nullable=True),
```

And three indexes at the bottom of the `tests = Table(...)` block (after the existing `Index` calls):

```python
    Index("ix_tests_source_test_id", "source_test_id"),
    Index("ix_tests_parent_test_id", "parent_test_id"),
    Index("ix_tests_tag", "tag"),
```

In the `palette_entries` table (around line 214):

1. Delete the line `Column("line_spacing_index", Float, nullable=True),`.
2. Add right after the `validated_cell_index` column (around line 255):

```python
    Column(
        "derived_from_entry_id", Integer,
        ForeignKey("palette_entries.id", ondelete="SET NULL"),
        nullable=True,
    ),
```

3. Add at the bottom of the `palette_entries = Table(...)` block, alongside the other indexes:

```python
    Index(
        "ix_palette_entries_derived_from",
        "derived_from_entry_id",
    ),
```

- [ ] **Step 4: Run the new + existing model tests**

```bash
uv run --active pytest tests/test_db_models.py -v
```

Expected: PASS for the new tests. Any pre-existing test that referenced `line_spacing_index` will fail — fix those by removing the references (the column simply doesn't exist any more).

- [ ] **Step 5: Run the entire backend suite**

```bash
uv run --active pytest tests/ -q 2>&1 | tail -10
```

Expect: continued failures in `test_repo_palette.py`, `test_palette_api.py`, `test_schemas.py` from the cascade. They're fixed in later tasks.

- [ ] **Step 6: Commit**

```bash
git add src/xcs_gen_web/models.py tests/test_db_models.py
git commit -m "$(cat <<'EOF'
feat(models): tests/palette_entries lineage columns

tests gains source_test_id, parent_test_id, tag. palette_entries
gains derived_from_entry_id and drops line_spacing_index. New
indexes on each.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: `palette` repo: drop `line_spacing_index`, add `derived_from_entry_id`

**Files:**
- Modify: `src/xcs_gen_web/repositories/palette.py`
- Modify: `tests/test_repo_palette.py`

- [ ] **Step 1: Write failing tests**

Append to `tests/test_repo_palette.py`:

```python
def test_create_validated_entry_persists_derived_from_entry_id(tmp_db):
    from xcs_gen_web.repositories import palette as pal_repo
    # Seed: a sweep test + one source palette entry that the validation
    # will be derived from.
    src = pal_repo.create_manual(
        material_id=1, hex="#ffaa00",
        params={"speed": 600, "power": 50, "density": 100,
                "mopa_frequency": 30, "pulse_width": 2, "repeat": 1},
        owner_id=0, machine_id="F2Ultra",
    )
    new_entry = pal_repo.create_validated_entry(
        machine_id="F2Ultra", material_id=2,
        burn_mean_lab=(50.0, 0.0, 0.0),
        validated_test_id=99, validated_cell_index=0,
        run_count=3, stability_de=1.5,
        params={"speed": 600, "power": 50, "density": 100,
                "mopa_frequency": 30, "pulse_width": 2, "repeat": 1},
        derived_from_entry_id=src["id"],
        owner_id=0,
    )
    assert new_entry["derived_from_entry_id"] == src["id"]


def test_palette_entry_dict_has_no_line_spacing_index(tmp_db):
    from xcs_gen_web.repositories import palette as pal_repo
    e = pal_repo.create_manual(
        material_id=1, hex="#ffaa00",
        params={"speed": 600, "power": 50, "density": 100,
                "mopa_frequency": 30, "pulse_width": 2, "repeat": 1},
        owner_id=0, machine_id="F2Ultra",
    )
    assert "line_spacing_index" not in e["indices"]
    assert "line_spacing_mm" in e["indices"]
    assert e["indices"]["line_spacing_mm"] == 10 / 100
```

(`tmp_db` is the existing fixture this file uses; if not present, follow the file's actual setup — typically a `db_session` or `setup_db` fixture from `conftest.py`.)

- [ ] **Step 2: Run tests to verify they fail**

```bash
uv run --active pytest tests/test_repo_palette.py -v -k "derived_from or line_spacing"
```

Expected: FAIL — `derived_from_entry_id` keyword unrecognised; `line_spacing_index` still present in the indices dict.

- [ ] **Step 3: Update `src/xcs_gen_web/repositories/palette.py`**

Edit `_compute_index_values` (around line 68): remove the `"line_spacing_index": indices.line_spacing_index,` line. Final shape:

```python
def _compute_index_values(params: dict[str, Any]) -> dict[str, Any]:
    indices = compute_indices(_processing_params_from_palette_dict(params))
    return {
        "pulse_spacing_mm": indices.pulse_spacing_mm,
        "line_spacing_mm": indices.line_spacing_mm,
        "pulse_energy_index": indices.pulse_energy_index,
        "pulse_intensity_index": indices.pulse_intensity_index,
        "total_exposure_index": indices.total_exposure_index,
        "ablation_aggression_index": indices.ablation_aggression_index,
        "delivery_smoothness_index": indices.delivery_smoothness_index,
        "indices_formula_version": indices.formula_version,
        "density_model": indices.density_model,
        "power_model": indices.power_model,
    }
```

Edit `_REFRESH_COLUMNS` (around line 179): drop `"line_spacing_index",`. Final shape (15 entries → 14):

```python
_REFRESH_COLUMNS = (
    "hex", "lab_l", "lab_a", "lab_b", "sigma", "params_json",
    "pulse_spacing_mm",
    "line_spacing_mm",
    "pulse_energy_index",
    "pulse_intensity_index",
    "total_exposure_index",
    "ablation_aggression_index",
    "delivery_smoothness_index",
    "indices_formula_version",
    "density_model",
    "power_model",
)
```

Edit `_row_to_entry` (around line 88):
1. Drop the `"line_spacing_index": r.line_spacing_index,` line from the `indices` dict.
2. Add a top-level `"derived_from_entry_id": r.derived_from_entry_id,` entry on the returned dict, right after `"validated_residual_de": r.validated_residual_de,`.

Edit `create_validated_entry` (around line 825):
1. Add a new keyword-only argument: `derived_from_entry_id: int | None = None`. Place it right after `validated_cell_index: int`.
2. In the `refresh_values` dict (line 866), add: `"derived_from_entry_id": derived_from_entry_id,`.
3. In the `else: row = { ... }` branch (around line 909), add: `"derived_from_entry_id": derived_from_entry_id,` to the row dict.

Edit `_build_row` (around line 151) — no changes needed; sweep entries don't get `derived_from_entry_id` set (defaults to NULL).

- [ ] **Step 4: Run tests**

```bash
uv run --active pytest tests/test_repo_palette.py -v
```

Expected: PASS for the new tests. Any pre-existing test that asserted `e["indices"]["line_spacing_index"]` will fail — drop those assertions (the field is gone). Pre-existing tests that asserted `e["indices"]["line_spacing_mm"] is None` should be flipped to assert the populated mm value.

- [ ] **Step 5: Commit**

```bash
git add src/xcs_gen_web/repositories/palette.py tests/test_repo_palette.py
git commit -m "$(cat <<'EOF'
feat(palette repo): drop line_spacing_index, add derived_from_entry_id

_compute_index_values, _REFRESH_COLUMNS, and _row_to_entry no longer
reference line_spacing_index. create_validated_entry gains a
derived_from_entry_id keyword that's persisted into both the
upsert-refresh path and the insert path.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: `tests` repo: surface lineage columns and accept edits

**Files:**
- Modify: `src/xcs_gen_web/repositories/tests.py`
- Modify: `src/xcs_gen_web/repositories/validation_cells.py`
- Modify: `tests/test_repo_tests.py`

- [ ] **Step 1: Write failing tests**

Append to `tests/test_repo_tests.py`:

```python
def test_test_dict_has_lineage_fields(tmp_db):
    from xcs_gen_web.repositories import tests as t_repo
    t = t_repo.create(
        name="t", material_id=1,
        spec={"x_param": "power", "x_min": 1, "x_max": 100, "x_steps": 10,
              "rows": 1, "width_mm": 50, "height_mm": 50,
              "base_params": {"speed": 600, "power": 50, "density": 100,
                              "mopa_frequency": 30, "pulse_width": 2,
                              "repeat": 1}},
        owner_id=0,
    )
    assert t["source_test_id"] is None
    assert t["parent_test_id"] is None
    assert t["tag"] is None


def test_update_accepts_parent_test_id_and_tag(tmp_db):
    from xcs_gen_web.repositories import tests as t_repo
    parent = t_repo.create(name="parent", material_id=1, spec={...full spec...},
                           owner_id=0)
    child = t_repo.create(name="child", material_id=1, spec={...full spec...},
                          owner_id=0)
    updated = t_repo.update(
        child["id"], owner_id=0,
        parent_test_id=parent["id"], tag="blues-exploration",
    )
    assert updated["parent_test_id"] == parent["id"]
    assert updated["tag"] == "blues-exploration"


def test_replace_validation_cells_recomputes_source_test_id(tmp_db):
    """Setting validation cells whose palette_entry_id all came from
    the same source test populates tests.source_test_id with that id."""
    from xcs_gen_web.repositories import tests as t_repo
    from xcs_gen_web.repositories import validation_cells as vc_repo
    from xcs_gen_web.repositories import palette as pal_repo

    src_test = t_repo.create(name="sweep", material_id=1, spec={...},
                             owner_id=0)
    src_entries = [pal_repo.create_manual(
        material_id=1, hex=f"#{i:02x}aa00",
        params={"speed": 600, "power": 50, "density": 100,
                "mopa_frequency": 30, "pulse_width": 2, "repeat": 1},
        owner_id=0, machine_id="F2Ultra",
    ) for i in range(3)]
    # Pretend they came from src_test (the create_manual API may not
    # let you set test_id at creation; if so, update them here directly
    # via the DB session.) Skip this if create_manual supports test_id.
    val_test = t_repo.create(name="val", material_id=2,
                             spec={...full spec...},
                             kind="validation", owner_id=0)
    cells = [{"cell_index": i,
              "palette_entry_id": src_entries[i]["id"],
              "expected_hex": "#000000",
              "expected_lab_l": 50, "expected_lab_a": 0, "expected_lab_b": 0,
              "params_json": "{}"} for i in range(3)]
    vc_repo.replace_for_test(test_id=val_test["id"], cells=cells)

    refreshed = t_repo.get(val_test["id"], owner_id=0)
    assert refreshed["source_test_id"] == src_test["id"]
```

(For these tests you'll need a complete `spec` dict — duplicate the one from the existing tests in this file. The placeholders above keep the plan readable but the implementer must paste a real spec.)

- [ ] **Step 2: Run tests to verify they fail**

```bash
uv run --active pytest tests/test_repo_tests.py -v -k "lineage or parent_test_id or source_test_id"
```

Expected: FAIL.

- [ ] **Step 3: Update `_row` in `src/xcs_gen_web/repositories/tests.py`**

In `_row` (around line 33), add three new fields to the returned dict, right after `"machine_id"`:

```python
        "source_test_id": getattr(r, "source_test_id", None),
        "parent_test_id": getattr(r, "parent_test_id", None),
        "tag": getattr(r, "tag", None),
```

(The `getattr` fallbacks gracefully handle DB rows from before the migration runs in tests — the SQLAlchemy column has `None` if missing.)

- [ ] **Step 4: Update `update()` to accept `parent_test_id` and `tag`**

Around line 156 in `tests.py`, extend the signature:

```python
def update(
    tid: int, *, owner_id: int = STANDALONE_USER_ID,
    name: str | None = None, notes: str | None = None,
    spec: dict[str, Any] | None = None,
    material_id: int | None = None,
    visibility: str | None = None,
    machine_id: str | None = None,
    parent_test_id: int | None = None,
    tag: str | None = None,
) -> dict[str, Any] | None:
```

And inside the function, after the existing `if visibility is not None:` block, add:

```python
    if parent_test_id is not None:
        # Sentinel: pass -1 to clear; positive ints set the FK.
        values["parent_test_id"] = None if parent_test_id == -1 else parent_test_id
    if tag is not None:
        # Sentinel: empty string clears.
        values["tag"] = None if tag == "" else tag
```

(The sentinel pattern matches how other nullable optionals are cleared in this file's PATCH endpoints. Confirm by reading existing `app.py` PATCH handlers; if a different pattern is used, mirror it.)

- [ ] **Step 5: Update `validation_cells.replace_for_test` to recompute `source_test_id`**

Read the existing `validation_cells.replace_for_test` in `src/xcs_gen_web/repositories/validation_cells.py`. After the existing INSERT batch, add a step to compute the modal source test from the new cells and write it to the test row.

```python
def replace_for_test(*, test_id: int, cells: list[dict[str, Any]]) -> None:
    # ... existing DELETE + INSERT logic ...

    # Recompute tests.source_test_id from the new cells. The modal source
    # is the most-common test_id across the entries the cells reference.
    # Empty cells or all-NULL palette_entry_ids leave it NULL.
    from collections import Counter
    with session_scope() as s:
        rows = s.execute(
            select(palette_entries.c.test_id)
            .where(
                palette_entries.c.id.in_([
                    c["palette_entry_id"] for c in cells
                    if c.get("palette_entry_id") is not None
                ]),
            ),
        ).all()
        counts = Counter(int(r.test_id) for r in rows if r.test_id is not None)
        source_test_id = counts.most_common(1)[0][0] if counts else None
        s.execute(
            tests.update()
            .where(tests.c.id == test_id)
            .values(source_test_id=source_test_id, updated_at=_now())
        )
```

(Imports needed: `from collections import Counter`, `from sqlalchemy import select`, `from ..models import palette_entries, tests`, `from ..db import session_scope`. If any are already imported, skip them. `_now` may need to be imported from `tests.py` repo or duplicated as a local helper — copy whichever the file's existing pattern uses.)

- [ ] **Step 6: Run tests**

```bash
uv run --active pytest tests/test_repo_tests.py -v
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/xcs_gen_web/repositories/tests.py \
        src/xcs_gen_web/repositories/validation_cells.py \
        tests/test_repo_tests.py
git commit -m "$(cat <<'EOF'
feat(tests repo): surface source_test_id/parent_test_id/tag

_row carries the three new lineage fields. update() accepts
parent_test_id and tag (sentinel -1/'' to clear). validation_cells
.replace_for_test recomputes the test's source_test_id from the
modal palette_entries.test_id of its cells.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Pydantic schemas

**Files:**
- Modify: `src/xcs_gen_web/schemas.py`
- Modify: `tests/test_schemas.py`

- [ ] **Step 1: Write failing tests**

Append to `tests/test_schemas.py`:

```python
def test_laser_indices_response_drops_line_spacing_index():
    from xcs_gen_web.schemas import LaserIndicesResponse
    fields = LaserIndicesResponse.model_fields
    assert "line_spacing_index" not in fields
    assert "line_spacing_mm" in fields
    # Density model still accepts the legacy "opaque" value for old rows.
    payload = {
        "pulse_spacing_mm": 0.05,
        "line_spacing_mm": 0.1,
        "pulse_energy_index": 1.0,
        "pulse_intensity_index": 0.001,
        "total_exposure_index": 5.0,
        "ablation_aggression_index": 0.005,
        "delivery_smoothness_index": 5000.0,
        "formula_version": 3,
        "density_model": "lpc",
        "power_model": "controller_percent",
    }
    out = LaserIndicesResponse(**payload)
    assert out.density_model == "lpc"
    out_legacy = LaserIndicesResponse(**{**payload, "density_model": "opaque",
                                         "formula_version": 2})
    assert out_legacy.density_model == "opaque"


def test_test_response_carries_lineage_fields():
    from xcs_gen_web.schemas import TestResponse
    fields = TestResponse.model_fields
    assert "source_test_id" in fields
    assert "parent_test_id" in fields
    assert "tag" in fields


def test_test_update_accepts_parent_test_id_and_tag():
    from xcs_gen_web.schemas import TestUpdate
    out = TestUpdate(parent_test_id=42, tag="campaign-a")
    assert out.parent_test_id == 42
    assert out.tag == "campaign-a"


def test_palette_entry_response_carries_derived_from_entry_id():
    from xcs_gen_web.schemas import PaletteEntryResponse
    assert "derived_from_entry_id" in PaletteEntryResponse.model_fields
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
uv run --active pytest tests/test_schemas.py -v -k "lineage or derived_from or laser_indices"
```

Expected: FAIL.

- [ ] **Step 3: Update `src/xcs_gen_web/schemas.py`**

Find `LaserIndicesResponse` (search for `class LaserIndicesResponse`). Apply two edits:
1. Remove the `line_spacing_index: float | None = None` field if present.
2. Update `density_model` to: `density_model: Literal["lpc", "opaque"] = "lpc"`. (Use `from typing import Literal` if not already imported — check the top of the file.)
3. If a `@computed_field` `surface_exposure_index` alias for `total_exposure_index` exists from the previous formula bump (PR #79 left it in place), keep it. If a similar alias exists for `line_spacing_index` it should be removed.

Find `TestResponse` (around line 896). Add three optional fields just before the closing `validation_cells: list[...]` line:

```python
    source_test_id: int | None = None
    parent_test_id: int | None = None
    tag: str | None = None
```

Find `TestUpdate` (around line 885). Add two optional fields:

```python
    parent_test_id: int | None = None
    tag: str | None = None
```

Find `PaletteEntryResponse` (around line 412). Add right before `indices: LaserIndicesResponse`:

```python
    derived_from_entry_id: int | None = None
```

- [ ] **Step 4: Run tests**

```bash
uv run --active pytest tests/test_schemas.py -v
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/xcs_gen_web/schemas.py tests/test_schemas.py
git commit -m "$(cat <<'EOF'
feat(schemas): lineage fields + density_model='lpc' on responses

LaserIndicesResponse drops line_spacing_index and accepts both 'lpc'
and (legacy) 'opaque' for density_model. TestResponse +
PaletteEntryResponse + TestUpdate gain the new lineage fields.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: app.py — wire `derived_from_entry_id` into validation ingest

**Files:**
- Modify: `src/xcs_gen_web/app.py`
- Modify: `tests/test_test_api.py` (or whichever file exercises the validate endpoint)

- [ ] **Step 1: Write failing tests**

Append to `tests/test_test_api.py` (or the validate-endpoint test file — locate via `grep -l 'tests_validate\|/validate\|stable\|drifted' tests/`):

```python
def test_validate_persists_derived_from_entry_id(client, tmp_db):
    """When a validation test ingests results, each new palette entry
    carries derived_from_entry_id pointing at the source palette entry
    its cell was burned to validate."""
    # Setup: source sweep test + source palette entry on material 1
    # + validation test on material 2 + cell pointing at the source.
    # Upload a validation result that produces one cell-result.
    ...
    # After validate:
    response = client.post(f"/api/tests/{val_tid}/validate", json={"overrides": []})
    assert response.status_code == 200
    new_id = response.json()["new_entry_ids"][0]
    entry = client.get(f"/api/palette/{new_id}").json()
    assert entry["derived_from_entry_id"] == src_entry_id
```

(The harness for this file already has fixtures for setting up tests + uploading photos. Reuse them; the placeholders are intentional — fill in the existing `client.post("/api/tests", ...)` and `client.post("/api/tests/{tid}/results/upload", ...)` calls.)

- [ ] **Step 2: Run tests to verify they fail**

```bash
uv run --active pytest tests/test_test_api.py -v -k "derived_from_entry_id"
```

Expected: FAIL — entry has `derived_from_entry_id == None` because we don't pass it through yet.

- [ ] **Step 3: Update `src/xcs_gen_web/app.py` — first validate flow (around line 1990)**

Find the `tests_validate` function (around line 1932). Inside it, where `cell_params` is built (around line 1979):

```python
cell_params[c["cell_index"]] = c.get("params") or {}
```

Add a parallel lookup for the source entry id:

```python
cell_src_entry: dict[int, int | None] = {}
for c in vc_repo.list_for_test(test_id=tid):
    cell_src_entry[c["cell_index"]] = c.get("palette_entry_id")
```

(Place this near the existing `cell_params` build — they iterate the same source data. Fold into one loop if the existing code already iterates `vc_repo.list_for_test`.)

In the inner loop calling `pal_repo.create_validated_entry` (around line 2008), add the new keyword argument:

```python
new_entry = pal_repo.create_validated_entry(
    machine_id=machine_id,
    material_id=material_id,
    burn_mean_lab=tuple(entry["burn_mean_lab"]),
    validated_test_id=tid,
    validated_cell_index=int(entry["cell_index"]),
    run_count=int(entry["run_count"]),
    stability_de=float(entry["stability_de"]),
    params=cell_params.get(entry["cell_index"]) or {},
    derived_from_entry_id=cell_src_entry.get(int(entry["cell_index"])),
    owner_id=user_id,
)
```

- [ ] **Step 4: Apply the same change to the parallel auto-validate flow (around line 2150)**

Search the file for the second `pal_repo.create_validated_entry(` call (around line 2154). Make the same `derived_from_entry_id=cell_src_entry.get(...)` addition. The `cell_src_entry` lookup needs to be available in scope — likely the same function (or a sibling). If it's a different function, build the same lookup at the top.

- [ ] **Step 5: Run tests**

```bash
uv run --active pytest tests/test_test_api.py -v
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/xcs_gen_web/app.py tests/test_test_api.py
git commit -m "$(cat <<'EOF'
feat(app): plumb derived_from_entry_id through validate ingest

Both validation-result paths (tests_validate and the parallel
auto-validate flow) now carry the validation_cell's palette_entry_id
into the new palette entry's derived_from_entry_id, so cross-material
validations preserve their entry-to-entry lineage.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Migration `0024` — schema + backfill + CI guard

This task wires up the live DB. SQLite local + MySQL CI both must pass. We mirror the structure of `0023_palette_combined_indices.py` (two `batch_alter_table` blocks for SQLite-friendliness, `existing_type=` on every rename, in-place backfill).

**Files:**
- Create: `alembic/versions/0024_test_schema_lineage.py`
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: Read 0023 for the structural pattern**

```bash
cat /Users/jonzky/Documents/XTools/Reverse/alembic/versions/0023_palette_combined_indices.py | head -80
```

Note: two `batch_alter_table` blocks, then a `for row in rows` backfill, then a `log.warning` for skipped rows. Mirror this structure.

- [ ] **Step 2: Write the migration**

Create `alembic/versions/0024_test_schema_lineage.py`:

```python
"""Test schema lineage + line-spacing physical units.

Schema changes:
- tests gains source_test_id, parent_test_id, tag (FKs nullable, ON
  DELETE SET NULL on the FKs; tag is plain VARCHAR(64)).
- palette_entries gains derived_from_entry_id (FK self-ref nullable,
  ON DELETE SET NULL) and DROPS line_spacing_index (recoverable from
  params.density via 1/density if ever needed).

Backfill:
- For every kind=validation test, find the modal source test by
  joining validation_cells.palette_entry_id -> palette_entries.test_id.
  Persist as tests.source_test_id (NULL when ambiguous or empty).
- For every palette entry that was produced by a validation test
  (validated_test_id IS NOT NULL AND validated_cell_index IS NOT NULL),
  look up validation_cells.palette_entry_id by (test_id, cell_index)
  and persist as derived_from_entry_id.
- Recompute every palette entry's indices via
  xcs_gen.laser_indices.compute_indices with density_model='lpc'.
  Bumps formula_version 2 -> 3, populates line_spacing_mm. Per-row
  failure -> formula_version=0 (legacy pattern from 0022/0023).

Revision ID: 0024
Revises: 0023
"""
from __future__ import annotations

import json
import logging
from collections import Counter

import sqlalchemy as sa
from alembic import op


revision = "0024"
down_revision = "0023"
branch_labels = None
depends_on = None

log = logging.getLogger("alembic.runtime.migration.0024")


def upgrade() -> None:
    # Phase 1a: tests — add columns + indexes.
    with op.batch_alter_table("tests", schema=None) as batch:
        batch.add_column(
            sa.Column(
                "source_test_id", sa.Integer,
                sa.ForeignKey("tests.id", ondelete="SET NULL"),
                nullable=True,
            ),
        )
        batch.add_column(
            sa.Column(
                "parent_test_id", sa.Integer,
                sa.ForeignKey("tests.id", ondelete="SET NULL"),
                nullable=True,
            ),
        )
        batch.add_column(sa.Column("tag", sa.String(64), nullable=True))
        batch.create_index("ix_tests_source_test_id", ["source_test_id"])
        batch.create_index("ix_tests_parent_test_id", ["parent_test_id"])
        batch.create_index("ix_tests_tag", ["tag"])

    # Phase 1b: palette_entries — add derived_from_entry_id + drop
    # line_spacing_index. Two-phase mirrors 0023's split because
    # SQLite batch_alter_table does a full table-copy and references
    # to dropped columns within the same batch can fail.
    with op.batch_alter_table("palette_entries", schema=None) as batch:
        batch.add_column(
            sa.Column(
                "derived_from_entry_id", sa.Integer,
                sa.ForeignKey("palette_entries.id", ondelete="SET NULL"),
                nullable=True,
            ),
        )
        batch.create_index(
            "ix_palette_entries_derived_from",
            ["derived_from_entry_id"],
        )
        batch.drop_column("line_spacing_index")

    conn = op.get_bind()

    # Phase 2: backfill tests.source_test_id from validation_cells.
    val_test_ids = [
        r.id for r in conn.execute(sa.text(
            "SELECT id FROM tests WHERE kind='validation'",
        )).fetchall()
    ]
    src_skipped: list[int] = []
    for tid in val_test_ids:
        cells = conn.execute(sa.text(
            "SELECT palette_entry_id FROM validation_cells WHERE test_id=:t",
        ), {"t": tid}).fetchall()
        entry_ids = [c.palette_entry_id for c in cells if c.palette_entry_id is not None]
        if not entry_ids:
            continue
        rows = conn.execute(
            sa.text(
                "SELECT test_id FROM palette_entries WHERE id IN :ids",
            ).bindparams(sa.bindparam("ids", expanding=True)),
            {"ids": entry_ids},
        ).fetchall()
        counts = Counter(int(r.test_id) for r in rows if r.test_id is not None)
        if counts:
            most = counts.most_common(1)[0][0]
            conn.execute(
                sa.text("UPDATE tests SET source_test_id=:s WHERE id=:t"),
                {"s": most, "t": tid},
            )
        else:
            src_skipped.append(tid)
    if src_skipped:
        log.warning(
            "0024 source_test_id backfill: %d validation tests had no "
            "resolvable source (cells empty or all NULL): %s",
            len(src_skipped), src_skipped[:10],
        )

    # Phase 3: backfill palette_entries.derived_from_entry_id by joining
    # through validation_cells via (validated_test_id, validated_cell_index).
    # We want each palette entry that was *produced* by a validation test
    # (i.e. its own test_id is a kind=validation test, OR equivalently
    # its validated_test_id is set) to point at the cell's source.
    derived_rows = conn.execute(sa.text(
        """
        SELECT pe.id AS pid,
               pe.validated_test_id AS vt,
               pe.validated_cell_index AS vci
        FROM palette_entries pe
        WHERE pe.validated_test_id IS NOT NULL
          AND pe.validated_cell_index IS NOT NULL
        """,
    )).fetchall()
    derived_skipped: list[int] = []
    for r in derived_rows:
        cell = conn.execute(sa.text(
            "SELECT palette_entry_id FROM validation_cells "
            "WHERE test_id=:t AND cell_index=:c",
        ), {"t": r.vt, "c": r.vci}).fetchone()
        if cell is None or cell.palette_entry_id is None:
            derived_skipped.append(r.pid)
            continue
        conn.execute(
            sa.text(
                "UPDATE palette_entries SET derived_from_entry_id=:s "
                "WHERE id=:p",
            ),
            {"s": cell.palette_entry_id, "p": r.pid},
        )
    if derived_skipped:
        log.warning(
            "0024 derived_from_entry_id backfill: %d entries had no "
            "resolvable source cell: first few %s",
            len(derived_skipped), derived_skipped[:10],
        )

    # Phase 4: recompute every palette entry's indices via
    # compute_indices(..., density_model='lpc'). Bumps formula_version
    # 2 -> 3 and populates line_spacing_mm. Failures land at
    # formula_version=0 per the 0022/0023 pattern.
    from xcs_gen.laser_indices import INDICES_FORMULA_VERSION, compute_indices
    from xcs_gen.model import ProcessingParams

    pe_rows = conn.execute(sa.text(
        "SELECT id, params_json FROM palette_entries",
    )).fetchall()
    update_sql = sa.text(
        "UPDATE palette_entries SET "
        "pulse_spacing_mm=:pulse_spacing_mm, "
        "line_spacing_mm=:line_spacing_mm, "
        "pulse_energy_index=:pulse_energy_index, "
        "pulse_intensity_index=:pulse_intensity_index, "
        "total_exposure_index=:total_exposure_index, "
        "ablation_aggression_index=:ablation_aggression_index, "
        "delivery_smoothness_index=:delivery_smoothness_index, "
        "indices_formula_version=:formula_version, "
        "density_model=:density_model, "
        "power_model=:power_model "
        "WHERE id=:id"
    )
    skipped: list[tuple[int, str]] = []
    for row in pe_rows:
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
            indices = compute_indices(params)  # density_model='lpc' default
            conn.execute(update_sql, {
                "id": row.id,
                "pulse_spacing_mm": indices.pulse_spacing_mm,
                "line_spacing_mm": indices.line_spacing_mm,
                "pulse_energy_index": indices.pulse_energy_index,
                "pulse_intensity_index": indices.pulse_intensity_index,
                "total_exposure_index": indices.total_exposure_index,
                "ablation_aggression_index": indices.ablation_aggression_index,
                "delivery_smoothness_index": indices.delivery_smoothness_index,
                "formula_version": INDICES_FORMULA_VERSION,
                "density_model": indices.density_model,
                "power_model": indices.power_model,
            })
        except Exception as exc:  # noqa: BLE001 - best-effort backfill
            skipped.append((row.id, str(exc)))
            conn.execute(
                sa.text(
                    "UPDATE palette_entries SET indices_formula_version=0 "
                    "WHERE id=:id",
                ),
                {"id": row.id},
            )
    if skipped:
        log.warning(
            "0024 indices recompute: %d palette_entries rows could not "
            "be computed (formula_version=0); first few: %s",
            len(skipped), skipped[:5],
        )


def downgrade() -> None:
    # Reverse the structural change. We don't restore line_spacing_index
    # values (they're easily recomputed from params.density on re-upgrade),
    # but we do re-add the column so a downgrade leaves a usable schema.
    with op.batch_alter_table("palette_entries", schema=None) as batch:
        batch.drop_index("ix_palette_entries_derived_from")
        batch.drop_column("derived_from_entry_id")
        batch.add_column(sa.Column("line_spacing_index", sa.Float, nullable=True))

    with op.batch_alter_table("tests", schema=None) as batch:
        batch.drop_index("ix_tests_source_test_id")
        batch.drop_index("ix_tests_parent_test_id")
        batch.drop_index("ix_tests_tag")
        batch.drop_column("tag")
        batch.drop_column("parent_test_id")
        batch.drop_column("source_test_id")
```

- [ ] **Step 3: Update CI workflow alembic-revision assertion**

Edit `.github/workflows/ci.yml`. Find the `mysql-migration-test` job's step that reads:

```yaml
test "$VER" = "0023"
```

Change to:

```yaml
test "$VER" = "0024"
```

(Confirm via `grep -n '0023' .github/workflows/ci.yml` first.)

- [ ] **Step 4: Round-trip the migration locally against fresh SQLite**

```bash
rm -f ~/.xcs-gen/app.db
uv run --active alembic upgrade head
uv run --active alembic downgrade -1
uv run --active alembic upgrade head
```

Expected: all three commands succeed without error. Confirm the columns exist:

```bash
uv run --active python -c "
from sqlalchemy import inspect
from xcs_gen_web.db import engine
i = inspect(engine())
print('tests cols:', [c['name'] for c in i.get_columns('tests')])
print('palette cols:', [c['name'] for c in i.get_columns('palette_entries')])
"
```

Expected: `tests` includes `source_test_id`, `parent_test_id`, `tag`. `palette_entries` includes `derived_from_entry_id`, NOT `line_spacing_index`.

- [ ] **Step 5: Run the full backend suite**

```bash
uv run --active pytest tests/ -q 2>&1 | tail -10
```

Expected: PASS for everything except possibly pre-existing unrelated failures (`tests/test_storage_s3.py` failures from missing optional deps are known and unrelated).

- [ ] **Step 6: Commit**

```bash
git add alembic/versions/0024_test_schema_lineage.py .github/workflows/ci.yml
git commit -m "$(cat <<'EOF'
feat(migration): 0024 test schema lineage + line_spacing_mm

Adds tests.source_test_id/parent_test_id/tag and
palette_entries.derived_from_entry_id (all FKs nullable, ON DELETE
SET NULL on the self-refs). Drops palette_entries.line_spacing_index.
Two backfill passes populate the new lineage columns from
validation_cells; an indices recompute pass bumps formula_version
2 -> 3 and writes the new line_spacing_mm everywhere.

CI mysql-migration-test revision assertion bumps 0023 -> 0024.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Frontend types + help copy + correlations + label maps

**Files:**
- Modify: `web/src/components/exposure/exposureCorrelations.ts`
- Modify: `web/src/components/exposure/exposureHelpCopy.ts`
- Modify: `web/src/pages/ExposurePage.tsx`
- Modify: `web/src/components/PaletteIndicesChips.tsx` (only the `LaserIndices` interface; chip layout in Task 9)
- Modify: `web/src/components/exposure/exposureCorrelations.test.ts`
- Modify: `web/src/components/exposure/exposureHelpCopy.test.ts`

- [ ] **Step 1: Update `exposureCorrelations.ts`**

Find `INDEX_ROWS` (an array literal) and `IndexRow` (a derived type). Rename `line_spacing_index` to `line_spacing_mm` in the array literal. Order stays the same.

```ts
export const INDEX_ROWS = [
  "pulse_spacing_mm",
  "line_spacing_mm",
  "pulse_energy_index",
  "pulse_intensity_index",
  "total_exposure_index",
  "ablation_aggression_index",
  "delivery_smoothness_index",
] as const;
```

The derived `export type IndexRow = (typeof INDEX_ROWS)[number]` automatically updates.

- [ ] **Step 2: Update `exposureHelpCopy.ts`**

Find `EXPOSURE_INDEX_HELP`. Replace the `line_spacing_index` entry with:

```ts
  line_spacing_mm: {
    heading: "Line spacing",
    unit: "mm",
    definition:
      "Physical distance between adjacent scan lines, derived from the controller's density setting.",
    formula: "10 ÷ density",
    inputs: [
      { name: "density", unit: "lines/cm" },
    ],
    guide:
      "Smaller is denser hatching. Below the spot diameter, lines start to overlap and the burn behaves as a continuous fill — additional density gains then translate into more pulse overlap, not finer hatching.",
    schematic: "line_pitch",
  },
```

Find `EXPOSURE_RAW_PARAM_HELP.density` and update its `unit` and `definition`:

```ts
  density: {
    heading: "Density",
    unit: "lines/cm",
    definition:
      "Number of laser scan lines per centimetre. Stepped controller value (e.g. 10–200 for the STANDARD profile).",
  },
```

Walk every other entry's `inputs[]` array. Anywhere `{name: "density", unit: "controller value (opaque)"}` appears, change to `{name: "density", unit: "lines/cm"}`. Affected entries: `line_spacing_mm` (just authored), `total_exposure_index`, `ablation_aggression_index`, `delivery_smoothness_index`.

- [ ] **Step 3: Update `ExposurePage.tsx` label maps**

Find the `INDEX_LABELS` and `INDEX_LABELS_MATRIX` records (around lines 72 and 90). Rename the key `line_spacing_index` → `line_spacing_mm`:

```ts
const INDEX_LABELS: Record<IndexRow, string> = {
  pulse_spacing_mm: "Pulse Spacing (mm)",
  line_spacing_mm: "Line Spacing (mm)",
  pulse_energy_index: "Pulse Energy Index",
  pulse_intensity_index: "Pulse Intensity Index",
  total_exposure_index: "Total Exposure",
  ablation_aggression_index: "Ablation Aggression",
  delivery_smoothness_index: "Delivery Smoothness",
};

const INDEX_LABELS_MATRIX: Record<IndexRow, string> = {
  pulse_spacing_mm: "PSp",
  line_spacing_mm: "LSp",
  pulse_energy_index: "PEn",
  pulse_intensity_index: "PIn",
  total_exposure_index: "TEx",
  ablation_aggression_index: "AAg",
  delivery_smoothness_index: "DSm",
};
```

- [ ] **Step 4: Update `LaserIndices` interface in `PaletteIndicesChips.tsx`**

Around the top of `web/src/components/PaletteIndicesChips.tsx`, find:

```ts
export interface LaserIndices {
  pulse_spacing_mm: number;
  line_spacing_index: number;
  line_spacing_mm: number | null;
  ...
}
```

Edit:
1. Drop `line_spacing_index: number;`.
2. Change `line_spacing_mm: number | null;` to `line_spacing_mm: number;`.

(Leave the rest of the file alone for now — chip layout is Task 9.)

- [ ] **Step 5: Update tests**

In `web/src/components/exposure/exposureCorrelations.test.ts`, find any test that asserts `INDEX_ROWS` content or that references `line_spacing_index`. Update the references to `line_spacing_mm`. The array length stays at 7.

In `web/src/components/exposure/exposureHelpCopy.test.ts`, the existing tests iterate over `INDEX_ROWS` and assert each key has a matching entry — those will pass automatically once the array and the `EXPOSURE_INDEX_HELP` keys both rename. Add or adjust the channel/raw-param tests if any explicitly assert `density.unit === "controller value (opaque)"`; change to `"lines/cm"`.

- [ ] **Step 6: Run vitest**

```bash
cd web && npx vitest run src/components/exposure/exposureCorrelations.test.ts src/components/exposure/exposureHelpCopy.test.ts
```

Expected: PASS.

- [ ] **Step 7: Run typecheck (likely fails — chips file not updated yet)**

```bash
cd web && npx tsc --noEmit
```

Expected: failures in `PaletteIndicesChips.tsx` referring to `line_spacing_index` chip, and possibly any other consumer of the `IndexRow` union that referenced the old key. Note them; Task 9 fixes them.

- [ ] **Step 8: Commit**

```bash
git add web/src/components/exposure/exposureCorrelations.ts \
        web/src/components/exposure/exposureHelpCopy.ts \
        web/src/components/exposure/exposureCorrelations.test.ts \
        web/src/components/exposure/exposureHelpCopy.test.ts \
        web/src/pages/ExposurePage.tsx \
        web/src/components/PaletteIndicesChips.tsx
git commit -m "$(cat <<'EOF'
refactor(exposure): rename line_spacing_index -> line_spacing_mm

INDEX_ROWS, INDEX_LABELS, INDEX_LABELS_MATRIX, EXPOSURE_INDEX_HELP,
and the LaserIndices interface all rename. EXPOSURE_RAW_PARAM_HELP
.density.unit becomes 'lines/cm' (was 'controller value (opaque)');
matching cleanup of inputs[].unit across every index entry that
referenced density.

Frontend types align with formula version 3.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: `PaletteIndicesChips` — drop the redundant chip + update tests

**Files:**
- Modify: `web/src/components/PaletteIndicesChips.tsx`
- Modify: `web/src/components/PaletteIndicesChips.test.tsx`

- [ ] **Step 1: Update failing tests first**

Read `web/src/components/PaletteIndicesChips.test.tsx`. Update tests that assert chip count, label text, or numeric values for `line_spacing_index` / `line_spacing_mm`:

1. Tests that check the count of chips — change from 8 to 7.
2. Test "renders all eight chip labels" — rename to "renders all seven chip labels", drop the assertion for `Line spacing index`, change `Line spacing (mm)` assertion to expect a numeric value (no longer `—`).
3. Test "shows '—' when line_spacing_mm is null" — DELETE. `line_spacing_mm` is no longer nullable post-formula-v3.
4. Test "renders a numeric line_spacing_mm when populated" — rewrite to use the default fixture (no override needed) and expect a real value.

Final fixture's `indices` should already populate `line_spacing_mm: 10 / density`. If the test fixture has a hardcoded `line_spacing_mm: null`, replace with `line_spacing_mm: 0.0001` (matches density=100000 if you want a clean number; otherwise pick anything finite).

The hover-card assertion on the `Total exposure` chip stays the same.

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd web && npx vitest run src/components/PaletteIndicesChips.test.tsx
```

Expected: FAIL with chip count mismatch / null assertion failure / unknown chip label.

- [ ] **Step 3: Update `PaletteIndicesChips.tsx`**

Find the eight `<HelpfulChip>` invocations inside the grid. Delete the one whose `label="Line spacing index"`. Update the one whose `label="Line spacing (mm)"`:

```tsx
<HelpfulChip
  label="Line spacing"
  value={`${fmtNum(indices.line_spacing_mm)} mm`}
/>
```

Result: 7 chips total. The `Line spacing` chip is the merger of the two old chips and is now populated for every entry post-migration.

Update `CHIP_INDEX_KEY`. Drop `"Line spacing index"` and `"Line spacing (mm)"`. Add `"Line spacing"` mapping to `"line_spacing_mm"`:

```ts
const CHIP_INDEX_KEY: Record<string, IndexRow | null> = {
  "Pulse spacing": "pulse_spacing_mm",
  "Line spacing": "line_spacing_mm",
  "Pulse energy": "pulse_energy_index",
  "Pulse intensity": "pulse_intensity_index",
  "Total exposure": "total_exposure_index",
  "Ablation aggression": "ablation_aggression_index",
  "Delivery smoothness": "delivery_smoothness_index",
};
```

- [ ] **Step 4: Run vitest + tsc**

```bash
cd web && npx vitest run src/components/PaletteIndicesChips.test.tsx
cd web && npx tsc --noEmit
```

Expected: PASS for both. tsc may surface other consumers of the `LaserIndices` interface; chase them down (most likely `web/src/api/palette.ts` or similar — drop any reference to `line_spacing_index`).

- [ ] **Step 5: Run the entire frontend suite**

```bash
cd web && npm test
```

Expected: ALL PASS.

- [ ] **Step 6: Commit**

```bash
git add web/src/components/PaletteIndicesChips.tsx \
        web/src/components/PaletteIndicesChips.test.tsx
git commit -m "$(cat <<'EOF'
refactor(palette chips): drop Line spacing index, promote mm

The dimensionless line_spacing_index chip is gone (no longer
computed). The previously-blank Line spacing (mm) chip becomes
the prime Line spacing chip and now shows a real value for every
entry post-formula-v3.

Chip count drops 8 -> 7. CHIP_INDEX_KEY updated.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: Browser verification + changelog

**Files:**
- Create: `changelog/2026-05-11-test-schema-lineage.md`

- [ ] **Step 1: Build the frontend**

```bash
cd web && npm run build > /dev/null 2>&1 && echo build-ok
```

Expected: `build-ok`.

- [ ] **Step 2: Start the dev server**

```bash
uv run --active xcs-gen serve --host 127.0.0.1 --port 8017
```

(Run in a separate terminal or background with `&`. Ensure no stale instance from prior PRs — `pkill -f xcs-gen` if needed.)

- [ ] **Step 3: Sanity-check via the browser**

Navigate to `http://127.0.0.1:8017/#/exposure?material=1`. Verify:

1. The scatter labels/picker shows `Line Spacing (mm)` instead of `Line Spacing Index`.
2. Hovering the `Line spacing` axis label opens a card with formula `10 ÷ density` and inputs listing `density · lines/cm`.
3. Hovering a `density` raw-params row label in the correlation matrix shows unit `lines/cm`.
4. Open a saved palette entry's test-detail page; the chips section shows `Line spacing` with a real mm value and there's no separate `Line spacing index` chip.

If any visual issue, fix it before continuing.

- [ ] **Step 4: Stop the dev server**

`Ctrl-C` (or `pkill -f xcs-gen`).

- [ ] **Step 5: Author the changelog**

Create `changelog/2026-05-11-test-schema-lineage.md`:

```markdown
---
id: 2026-05-11-test-schema-lineage
date: 2026-05-11
level: minor
title: Tests + palette — explicit lineage and physical line spacing
summary: Tests record source/parent/tag; palette entries record their source entry; line spacing is in mm now, not a dimensionless index.
---

The tests model gains three new fields:

- **`source_test_id`** — for `kind=validation` tests, points at the
  test whose harvested palette is being validated. Filled
  automatically when validation cells get persisted.
- **`parent_test_id`** — fork/iteration lineage. Set when a future
  copy-this-test affordance writes a new test from an existing one.
- **`tag`** — short campaign label (≤64 chars) for grouping related
  tests across a project.

Palette entries gain **`derived_from_entry_id`** — for entries
produced by ingesting cross-material validation results, this points
at the original entry the validation was run against. Different from
the existing `validated_test_id` / `validated_cell_index`, which
point downstream (this entry has been validated by a later test).

Separately: laser `density` is now treated as the lines-per-cm value
it always was. The dimensionless `line_spacing_index` is gone; in its
place, `line_spacing_mm = 10 / density` is populated for every entry.
The exposure page and palette-indices chips show one `Line spacing`
field in mm instead of a redundant pair.

Migration `0024` adds the columns, backfills lineage from the
existing validation-cell joins, and recomputes every palette entry's
indices under the new formula version 3.

UI surfacing of the new lineage fields (test header, focused-card
provenance row) is a separate follow-up.
```

- [ ] **Step 6: Commit**

```bash
git add changelog/2026-05-11-test-schema-lineage.md
git commit -m "$(cat <<'EOF'
changelog: test schema lineage + line_spacing_mm

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 11: Final pre-PR checks + push

- [ ] **Step 1: Full backend test suite**

```bash
uv run --active pytest tests/ -q 2>&1 | tail -10
```

Expected: PASS (the pre-existing `tests/test_storage_s3.py` 5-failure cluster from missing optional deps is unrelated and acceptable).

- [ ] **Step 2: Full frontend test + typecheck + build**

```bash
cd web && npm test
cd web && npx tsc --noEmit
cd web && npm run build > /dev/null 2>&1 && echo build-ok
```

Expected: ALL PASS.

- [ ] **Step 3: Round-trip the migration one more time**

```bash
rm -f ~/.xcs-gen/app.db
uv run --active alembic upgrade head
uv run --active alembic downgrade -1
uv run --active alembic upgrade head
```

Expected: clean.

- [ ] **Step 4: Push branch**

```bash
git push -u origin feat/test-schema-lineage
```

- [ ] **Step 5: Open draft PR**

```bash
gh pr create --draft --title "feat: test schema lineage + line_spacing_mm" --body "$(cat <<'EOF'
## Summary
- Tests gain `source_test_id`, `parent_test_id`, `tag`. Validation tests auto-populate `source_test_id` from their cells' modal source.
- Palette entries gain `derived_from_entry_id` (set at ingest from `validation_cells.palette_entry_id`).
- `LaserIndices` formula version 3: `density_model="lpc"` is the only legal value for fresh computation; `line_spacing_mm = 10 / density` is populated; `line_spacing_index` is dropped.
- Migration 0024 with two-phase schema change + three backfill passes (source-test, derived-from-entry, indices recompute).
- CI guard bumped 0023 → 0024.
- Frontend rename across `INDEX_ROWS`, help copy, label maps, palette chips. Chip count drops 8 → 7.

Spec: `docs/superpowers/specs/2026-05-10-test-schema-lineage-design.md`
Plan: `docs/superpowers/plans/2026-05-10-test-schema-lineage.md`

## Test plan
- [x] `uv run --active pytest tests/ -q` — backend green
- [x] `cd web && npm test` — 439+/439+ frontend tests pass
- [x] `cd web && npx tsc --noEmit` — clean
- [x] `cd web && npm run build` — succeeds
- [x] `alembic upgrade head; downgrade -1; upgrade head` — clean
- [x] Browser walk-through on `#/exposure` — Line spacing reads in mm, density unit is `lines/cm`, chips count is 7
- [ ] CI: backend, frontend, MySQL migration, docker, CodeQL

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: PR opened. Note its number for the next steps.

- [ ] **Step 6: Watch CI**

```bash
gh pr checks <PR-NUMBER> --watch
```

If the MySQL migration test fails, inspect — most likely culprit is an `alter_column` without `existing_type`. Fix and push.

If everything's green, the PR is ready to flip to ready-for-review.

---

## Self-review

**Spec coverage:**
- Migration 0024 (schema additions + line_spacing_index drop) → Task 7. ✓
- Formula version 2→3 + density_model="lpc" → Task 1, with the recompute pass embedded in Task 7. ✓
- `tests.source_test_id` auto-populated from validation cells → Task 4 (validation_cells.replace_for_test) + Task 7 (backfill). ✓
- `palette_entries.derived_from_entry_id` populated at ingest → Task 6 + Task 7 (backfill). ✓
- `parent_test_id` and `tag` editable via TestUpdate → Task 4 (repo) + Task 5 (schema). ✓
- Pydantic schemas align → Task 5. ✓
- Frontend rename across all consumers → Tasks 8 + 9. ✓
- CI alembic-revision guard bump → Task 7. ✓
- Changelog → Task 10. ✓
- Pre-PR checks + push → Task 11. ✓

**Placeholder scan:** The `test_replace_validation_cells_recomputes_source_test_id` test in Task 4 has `spec={...full spec...}` placeholders — explicit instruction to the implementer to paste a real spec from existing tests, not a TBD that ships. Same for `test_validate_persists_derived_from_entry_id` in Task 6, where the harness setup placeholders point to existing fixtures. No other TBDs.

**Type consistency:** `line_spacing_mm`, `derived_from_entry_id`, `source_test_id`, `parent_test_id`, `tag` — used identically across DB columns, Pydantic field names, repo dict keys, and frontend type members. `INDICES_FORMULA_VERSION = 3` referenced consistently between Task 1 (constant declaration) and Task 7 (used in migration). `density_model="lpc"` is the spelled-out string everywhere it appears.
