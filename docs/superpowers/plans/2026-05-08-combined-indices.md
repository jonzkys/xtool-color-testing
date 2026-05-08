# Combined Heuristic Indices Implementation Plan (Phase 2.5a)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `ablation_aggression_index` and `delivery_smoothness_index` to every palette entry, rename `surface_exposure_index` → `total_exposure_index` (with API-side deprecated alias), bump `INDICES_FORMULA_VERSION` to `2`, and surface all three changes through the chip strip and the exposure-page axis selectors.

**Architecture:** Phase-1-style cycle. Pure compute module gains two formulas, schema migration `0023` renames a column + adds two + backfills via `_compute_index_values`. Pydantic response gets a `@computed_field` deprecated alias for the renamed field. Frontend `LaserIndices` interface, chip strip, and `INDEX_ROWS` constant pick up the new options; the exploration-page axis dropdowns and correlations matrix light up automatically because they're driven by the constant.

**Tech Stack:** Python 3.11+ / SQLAlchemy 2.x / Alembic / FastAPI / Pydantic v2 / React + TypeScript / Tailwind v4 / Vitest.

**Spec:** `docs/superpowers/specs/2026-05-08-combined-indices-design.md` (committed `5aac676`).

**Branch:** Continue on the current `feat/exposure-indices-exploration` branch — phase 2 (PR #78) and phase 2.5a will land together since the spec depends on phase 2's exposure page existing. (After both ship, PR can be split if reviewers prefer; until then, stack on the same branch.)

**Rebuild reminder:** After every `web/src/**` edit, run `cd web && npm run build` before testing in a browser — `xcs-gen serve` mounts `web/dist/`, not the Vite dev server.

---

## File Structure

**Modify:**
- `src/xcs_gen/laser_indices.py` — `LaserIndices` dataclass field renames + new fields; `compute_indices` formulas; `INDICES_FORMULA_VERSION = 2`.
- `tests/test_laser_indices.py` — update existing assertions for the rename; add tests for the two new formulas and the math identities.
- `src/xcs_gen_web/models.py` — column rename, two new columns, index renames + add.
- `src/xcs_gen_web/repositories/palette.py` — `_compute_index_values` keys; `_REFRESH_COLUMNS` tuple; `_row_to_entry` nested dict.
- `tests/test_repo_palette.py` — update key references.
- `src/xcs_gen_web/schemas.py` — `LaserIndicesResponse` field renames + new fields + `@computed_field` deprecated alias.
- `tests/test_schemas.py` — assert both keys appear in JSON serialisation.
- `tests/test_palette_api.py` — assert both keys appear in `GET /api/palette` response.
- `web/src/components/PaletteIndicesChips.tsx` — `LaserIndices` interface + 8 chips.
- `web/src/components/PaletteIndicesChips.test.tsx` — update existing assertions; add for the two new chips.
- `web/src/components/exposure/exposureCorrelations.ts` — `INDEX_ROWS` 7-tuple.
- `web/src/components/exposure/exposureCorrelations.test.ts` — update length assertions.
- `web/src/components/exposure/ExposureCorrelationMatrix.tsx` — row labels for new entries (`TEx`, `AAg`, `DSm`).
- `web/src/components/exposure/ExposureFocusedCard.tsx` — `INDEX_ORDER` + `INDEX_LABELS` for new entries.
- `web/src/pages/ExposurePage.tsx` — left-rail axis dropdown labels for new entries.
- `docs/exposure-page-validation.md` — update §2 (formulas), §9 (validation checklist), §10 (queue).
- `.github/workflows/ci.yml` — bump alembic version assertion `0022` → `0023`.

**Create:**
- `alembic/versions/0023_palette_combined_indices.py`

---

## Task 1: Pure compute module — extend `LaserIndices` + bump formula version

**Files:**
- Modify: `src/xcs_gen/laser_indices.py`
- Modify: `tests/test_laser_indices.py`

- [ ] **Step 1: Update the failing tests first**

Edit `tests/test_laser_indices.py`. Replace every reference to `surface_exposure_index` with `total_exposure_index` in the existing tests (`test_defaults_match_hand_computation`, `test_stainless_high_density_case`, `test_finite_values_for_all_indices`). Update `test_formula_version_is_one` → `test_formula_version_is_two`:

```python
def test_formula_version_is_two() -> None:
    assert INDICES_FORMULA_VERSION == 2
```

Append three new tests at the bottom of the file:

```python
def test_ablation_aggression_is_total_exposure_times_pulse_intensity() -> None:
    indices = compute_indices(ProcessingParams())
    expected = indices.total_exposure_index * indices.pulse_intensity_index
    assert indices.ablation_aggression_index == pytest.approx(expected)


def test_delivery_smoothness_is_total_exposure_over_pulse_intensity() -> None:
    indices = compute_indices(ProcessingParams())
    expected = indices.total_exposure_index / indices.pulse_intensity_index
    assert indices.delivery_smoothness_index == pytest.approx(expected)


def test_log_space_rotation_identities() -> None:
    """The new pair is a 45° rotation of (total_exposure,
    pulse_intensity) in log-space. Verify two consequences:
    geometric mean recovers total_exposure; ratio is pulse_intensity²."""
    import math
    indices = compute_indices(ProcessingParams())
    aggr = indices.ablation_aggression_index
    smooth = indices.delivery_smoothness_index
    geom_mean = math.sqrt(aggr * smooth)
    ratio = aggr / smooth
    assert geom_mean == pytest.approx(indices.total_exposure_index, rel=1e-9)
    assert ratio == pytest.approx(indices.pulse_intensity_index ** 2, rel=1e-9)
```

Also update the existing immutability test if it references the old field name.

- [ ] **Step 2: Run, confirm failure**

```bash
cd /Users/jonzky/Documents/XTools/Reverse
uv run --active pytest tests/test_laser_indices.py -v
```

Expected: AttributeError on `total_exposure_index` / `ablation_aggression_index` / `delivery_smoothness_index` (fields don't exist yet); `INDICES_FORMULA_VERSION == 1` mismatch.

- [ ] **Step 3: Update the module**

Edit `src/xcs_gen/laser_indices.py`. Update the docstring's formula table:

```
    pulse_spacing_mm           = speed / (mopa_frequency * 1000)        # honest mm
    line_spacing_index         = 1 / density                             # opaque
    line_spacing_mm            = NULL while density_model == "opaque"
    pulse_energy_index         = power / mopa_frequency
    pulse_intensity_index      = power / (mopa_frequency * pulse_width)
    total_exposure_index       = power * density * repeat / speed        # was surface_exposure_index
    ablation_aggression_index  = total_exposure_index * pulse_intensity_index
    delivery_smoothness_index  = total_exposure_index / pulse_intensity_index
```

Bump the version constant:

```python
INDICES_FORMULA_VERSION = 2
```

Update the dataclass:

```python
@dataclass(frozen=True)
class LaserIndices:
    pulse_spacing_mm: float
    line_spacing_index: float
    line_spacing_mm: float | None
    pulse_energy_index: float
    pulse_intensity_index: float
    total_exposure_index: float
    ablation_aggression_index: float
    delivery_smoothness_index: float
    formula_version: int
    density_model: str
    power_model: str
```

Update `compute_indices`. Replace the `surface_exposure_index = ...` line with three new lines:

```python
    pulse_spacing_mm = speed / (freq * 1000)
    line_spacing_index = 1 / density
    line_spacing_mm: float | None = None
    pulse_energy_index = power / freq
    pulse_intensity_index = power / (freq * pw)
    total_exposure_index = power * density * repeat / speed
    ablation_aggression_index = total_exposure_index * pulse_intensity_index
    delivery_smoothness_index = total_exposure_index / pulse_intensity_index
```

And the return:

```python
    return LaserIndices(
        pulse_spacing_mm=pulse_spacing_mm,
        line_spacing_index=line_spacing_index,
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

If the package's `__init__.py` re-exports `LaserIndices`, no change needed there (the symbol name is the same).

- [ ] **Step 4: Run tests, confirm pass**

```bash
uv run --active pytest tests/test_laser_indices.py -v
```

Expected: all green.

- [ ] **Step 5: Typecheck — make sure nothing else in the Python tree references the old field**

```bash
grep -rn "surface_exposure_index" src/xcs_gen/ 2>&1
```

Expected: no matches in `src/xcs_gen/` (the canonical Python library is now clean). Matches in `src/xcs_gen_web/` and `tests/` are fine — those land in later tasks.

- [ ] **Step 6: Commit**

```bash
git add src/xcs_gen/laser_indices.py tests/test_laser_indices.py
git commit -m "feat(indices): add ablation_aggression + delivery_smoothness; rename total_exposure

surface_exposure_index renamed to total_exposure_index (canonical).
Two new combined indices: ablation_aggression = total_exposure ×
pulse_intensity, delivery_smoothness = total_exposure / pulse_intensity.

The new pair is a log-space rotation of (total_exposure,
pulse_intensity) into more interpretable axes — geometric mean of
the pair equals total_exposure, ratio equals pulse_intensity². Tests
verify those identities. INDICES_FORMULA_VERSION bumped 1 → 2."
```

---

## Task 2: Schema model in `models.py`

**Files:**
- Modify: `src/xcs_gen_web/models.py`
- Modify: `tests/test_db_models.py`

- [ ] **Step 1: Write failing tests**

Append to `tests/test_db_models.py`:

```python
def test_palette_entries_renamed_total_exposure_column() -> None:
    from xcs_gen_web.models import palette_entries

    cols = {c.name for c in palette_entries.columns}
    assert "total_exposure_index" in cols
    assert "surface_exposure_index" not in cols, (
        "Old column name should be gone after the rename"
    )


def test_palette_entries_has_combined_indices_columns() -> None:
    from xcs_gen_web.models import palette_entries

    cols = {c.name for c in palette_entries.columns}
    assert "ablation_aggression_index" in cols
    assert "delivery_smoothness_index" in cols


def test_palette_entries_combined_indices_indexes() -> None:
    from xcs_gen_web.models import palette_entries

    indexed_pairs = {
        tuple(c.name for c in idx.columns) for idx in palette_entries.indexes
    }
    assert ("material_id", "total_exposure_index") in indexed_pairs, (
        f"missing renamed (material_id, total_exposure_index); have {indexed_pairs}"
    )
    assert ("material_id", "ablation_aggression_index") in indexed_pairs, (
        f"missing new aggression index; have {indexed_pairs}"
    )
```

- [ ] **Step 2: Run, confirm failure**

```bash
cd /Users/jonzky/Documents/XTools/Reverse
uv run --active pytest tests/test_db_models.py -v -k "combined or renamed_total"
```

Expected: 3 failures.

- [ ] **Step 3: Edit `src/xcs_gen_web/models.py`**

Find the `palette_entries = Table(...)` block. Update the column name and add two new columns alongside:

Replace:
```python
    Column("surface_exposure_index", Float, nullable=True),
```

With:
```python
    Column("total_exposure_index", Float, nullable=True),
    Column("ablation_aggression_index", Float, nullable=True),
    Column("delivery_smoothness_index", Float, nullable=True),
```

Update the composite index. Replace:
```python
    Index(
        "ix_palette_entries_material_exposure",
        "material_id", "surface_exposure_index",
    ),
```

With:
```python
    Index(
        "ix_palette_entries_material_total_exposure",
        "material_id", "total_exposure_index",
    ),
    Index(
        "ix_palette_entries_material_aggression",
        "material_id", "ablation_aggression_index",
    ),
```

(Leave `ix_palette_entries_material_intensity` alone.)

- [ ] **Step 4: Run tests**

```bash
uv run --active pytest tests/test_db_models.py -v
```

Expected: all green (the 3 new tests + every existing test still passing).

- [ ] **Step 5: Commit**

```bash
git add src/xcs_gen_web/models.py tests/test_db_models.py
git commit -m "feat(palette): combined-indices columns + index renames in model

Renames surface_exposure_index → total_exposure_index column and
the matching composite index. Adds ablation_aggression_index and
delivery_smoothness_index columns. Adds composite index on
(material_id, ablation_aggression_index) for phase-2 scatter queries
on the new axis."
```

---

## Task 3: Alembic migration `0023_palette_combined_indices`

**Files:**
- Create: `alembic/versions/0023_palette_combined_indices.py`
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: Write the migration**

Create `alembic/versions/0023_palette_combined_indices.py`:

```python
"""Combined heuristic indices: rename total_exposure, add aggression + smoothness.

Renames `surface_exposure_index` column → `total_exposure_index` (the
canonical name going forward; the old name lives on as a Pydantic
read-side alias). Adds two new columns:
- `ablation_aggression_index` = total_exposure × pulse_intensity
- `delivery_smoothness_index` = total_exposure / pulse_intensity

The composite index on (material_id, surface_exposure_index) is
renamed to match the column. A new composite index on
(material_id, ablation_aggression_index) is added for the phase-2
scatter to be cheap on the new axis.

Backfill walks every palette_entries row and recomputes via
xcs_gen.laser_indices.compute_indices (formula version bumps 1 → 2).
Per-row error isolation matches 0022 — failing rows get
formula_version=0.

Revision ID: 0023
Revises: 0022
"""
from __future__ import annotations

import json
import logging

import sqlalchemy as sa
from alembic import op


revision = "0023"
down_revision = "0022"
branch_labels = None
depends_on = None

log = logging.getLogger("alembic.runtime.migration.0023")


def upgrade() -> None:
    with op.batch_alter_table("palette_entries", schema=None) as batch_op:
        batch_op.drop_index("ix_palette_entries_material_exposure")
        batch_op.alter_column(
            "surface_exposure_index",
            new_column_name="total_exposure_index",
        )
        batch_op.add_column(
            sa.Column("ablation_aggression_index", sa.Float, nullable=True),
        )
        batch_op.add_column(
            sa.Column("delivery_smoothness_index", sa.Float, nullable=True),
        )
        batch_op.create_index(
            "ix_palette_entries_material_total_exposure",
            ["material_id", "total_exposure_index"],
        )
        batch_op.create_index(
            "ix_palette_entries_material_aggression",
            ["material_id", "ablation_aggression_index"],
        )

    # Backfill — best-effort; rows that fail get formula_version=0.
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
        "total_exposure_index=:total_exposure_index, "
        "ablation_aggression_index=:ablation_aggression_index, "
        "delivery_smoothness_index=:delivery_smoothness_index, "
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
                    "total_exposure_index": indices.total_exposure_index,
                    "ablation_aggression_index": indices.ablation_aggression_index,
                    "delivery_smoothness_index": indices.delivery_smoothness_index,
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
            "0023 backfill: %d palette_entries rows could not be computed "
            "(formula_version=0); first few: %s",
            len(skipped), skipped[:5],
        )


def downgrade() -> None:
    """Reverse the rename and drop the new columns/indexes.

    Note: a downgrade leaves the surface_exposure_index column populated
    with what total_exposure_index held (they're the same number). The
    backfill data from 0022 is preserved through the upgrade/downgrade.
    """
    with op.batch_alter_table("palette_entries", schema=None) as batch_op:
        batch_op.drop_index("ix_palette_entries_material_aggression")
        batch_op.drop_index("ix_palette_entries_material_total_exposure")
        batch_op.drop_column("delivery_smoothness_index")
        batch_op.drop_column("ablation_aggression_index")
        batch_op.alter_column(
            "total_exposure_index",
            new_column_name="surface_exposure_index",
        )
        batch_op.create_index(
            "ix_palette_entries_material_exposure",
            ["material_id", "surface_exposure_index"],
        )
```

- [ ] **Step 2: Run the migration locally against a fresh SQLite DB**

```bash
cd /Users/jonzky/Documents/XTools/Reverse
rm -f /tmp/xcs-23-test.db
XCS_GEN_DB_URL="sqlite:////tmp/xcs-23-test.db" uv run --active alembic upgrade head 2>&1 | tail -5
```

Expected: ends at revision `0023`.

- [ ] **Step 3: Verify idempotence**

```bash
XCS_GEN_DB_URL="sqlite:////tmp/xcs-23-test.db" uv run --active alembic upgrade head 2>&1 | tail -3
```

Expected: no migrations run (already at head).

- [ ] **Step 4: Verify reversibility**

```bash
XCS_GEN_DB_URL="sqlite:////tmp/xcs-23-test.db" uv run --active alembic downgrade -1 2>&1 | tail -5
XCS_GEN_DB_URL="sqlite:////tmp/xcs-23-test.db" uv run --active alembic upgrade head 2>&1 | tail -5
```

Expected: both succeed, ending at `0023`.

- [ ] **Step 5: Update CI version assertion**

Edit `.github/workflows/ci.yml`. Find the line `test "$VER" = "0022"` (around line 144) and change to:

```yaml
          test "$VER" = "0023"
```

- [ ] **Step 6: Run alembic tests**

```bash
uv run --active pytest tests/test_alembic.py -v
```

Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add alembic/versions/0023_palette_combined_indices.py .github/workflows/ci.yml
git commit -m "feat(palette): alembic 0023 — combined indices + total_exposure rename

Renames the column surface_exposure_index → total_exposure_index and
the matching composite index. Adds ablation_aggression_index and
delivery_smoothness_index columns + composite index on
(material_id, ablation_aggression_index). Backfill recomputes every
row via xcs_gen.laser_indices.compute_indices, bumping formula
version from 1 to 2. Bumps CI version assertion to 0023."
```

---

## Task 4: Repository helper — `_compute_index_values` + `_REFRESH_COLUMNS` + `_row_to_entry`

**Files:**
- Modify: `src/xcs_gen_web/repositories/palette.py`
- Modify: `tests/test_repo_palette.py`

- [ ] **Step 1: Update repository tests first**

In `tests/test_repo_palette.py`, replace every reference to `surface_exposure_index` with `total_exposure_index` in the existing tests. Then append:

```python
def test_combined_indices_in_repo_output(palette_db) -> None:
    from xcs_gen_web.repositories.palette import insert_bulk, get_by_id

    [eid] = insert_bulk([{
        "test_id": None,
        "material_id": palette_db["material_id"],
        "x_value": 0.0, "y_value": None,
        "hex": "#abcdef",
        "params": {
            "speed": 1000, "power": 50, "density": 100,
            "frequency": 65, "passes": 1, "pulse_width": 200,
        },
        "sigma": 0.0,
        "source": "averaged",
        "source_result_id": None,
        "machine_id": "F2Ultra",
    }])
    out = get_by_id(eid)
    assert out is not None
    idx = out["indices"]
    # total_exposure (renamed) and the two new ones must all be present.
    assert "total_exposure_index" in idx
    assert "ablation_aggression_index" in idx
    assert "delivery_smoothness_index" in idx
    # Math identities.
    aggr = idx["ablation_aggression_index"]
    smooth = idx["delivery_smoothness_index"]
    total = idx["total_exposure_index"]
    pi = idx["pulse_intensity_index"]
    assert aggr == pytest.approx(total * pi)
    assert smooth == pytest.approx(total / pi)
```

- [ ] **Step 2: Run, confirm failure**

```bash
uv run --active pytest tests/test_repo_palette.py -v
```

Expected: tests for `total_exposure_index` fail (still returns `surface_exposure_index`); two new identity tests fail.

- [ ] **Step 3: Update `_compute_index_values`**

In `src/xcs_gen_web/repositories/palette.py`, find the `_compute_index_values` helper. Replace the dict it returns:

```python
def _compute_index_values(params: dict[str, Any]) -> dict[str, Any]:
    """Return the dict of laser-index columns + metadata for a
    palette_entries row, computed from a params_json-shaped dict.
    """
    indices = compute_indices(_processing_params_from_palette_dict(params))
    return {
        "pulse_spacing_mm": indices.pulse_spacing_mm,
        "line_spacing_index": indices.line_spacing_index,
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

- [ ] **Step 4: Update `_REFRESH_COLUMNS`**

Find:

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

Replace with:

```python
_REFRESH_COLUMNS = (
    "hex", "lab_l", "lab_a", "lab_b", "sigma", "params_json",
    "pulse_spacing_mm",
    "line_spacing_index",
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

- [ ] **Step 5: Update `_row_to_entry`**

Find the `_row_to_entry` function. In its `"indices"` nested dict, rename `surface_exposure_index` → `total_exposure_index` and add two new keys:

```python
        "indices": {
            "pulse_spacing_mm": r.pulse_spacing_mm,
            "line_spacing_index": r.line_spacing_index,
            "line_spacing_mm": r.line_spacing_mm,
            "pulse_energy_index": r.pulse_energy_index,
            "pulse_intensity_index": r.pulse_intensity_index,
            "total_exposure_index": r.total_exposure_index,
            "ablation_aggression_index": r.ablation_aggression_index,
            "delivery_smoothness_index": r.delivery_smoothness_index,
            "formula_version": r.indices_formula_version,
            "density_model": r.density_model,
            "power_model": r.power_model,
        },
```

- [ ] **Step 6: Run, confirm pass**

```bash
uv run --active pytest tests/test_repo_palette.py -v
```

Expected: all green.

- [ ] **Step 7: Run the broader palette test suite**

```bash
uv run --active pytest tests/test_repo_palette.py tests/test_palette.py tests/test_ingest_to_palette.py -v
```

Expected: all green.

- [ ] **Step 8: Commit**

```bash
git add src/xcs_gen_web/repositories/palette.py tests/test_repo_palette.py
git commit -m "feat(palette): repo writes & reads combined indices + total_exposure rename

_compute_index_values now produces the dict keyed by total_exposure_index
+ ablation_aggression_index + delivery_smoothness_index. _REFRESH_COLUMNS
extended to refresh all three on re-ingest. _row_to_entry exposes them
in the nested 'indices' dict."
```

---

## Task 5: API schema — `LaserIndicesResponse` + deprecated alias

**Files:**
- Modify: `src/xcs_gen_web/schemas.py`
- Modify: `tests/test_schemas.py`
- Modify: `tests/test_palette_api.py`

- [ ] **Step 1: Write failing tests**

Append to `tests/test_schemas.py`:

```python
def test_laser_indices_response_serialises_both_total_and_alias() -> None:
    from xcs_gen_web.schemas import LaserIndicesResponse

    resp = LaserIndicesResponse(
        pulse_spacing_mm=0.0154,
        line_spacing_index=0.01,
        line_spacing_mm=None,
        pulse_energy_index=0.7692,
        pulse_intensity_index=0.003846,
        total_exposure_index=5.0,
        ablation_aggression_index=0.01923,
        delivery_smoothness_index=1300.0,
        formula_version=2,
        density_model="opaque",
        power_model="controller_percent",
    )
    j = resp.model_dump()
    assert j["total_exposure_index"] == 5.0
    assert j["surface_exposure_index"] == 5.0  # deprecated alias
    assert j["ablation_aggression_index"] == 0.01923
    assert j["delivery_smoothness_index"] == 1300.0
```

Append to `tests/test_palette_api.py`:

```python
def test_get_palette_returns_combined_indices_block(client, palette_seeded) -> None:
    r = client.get("/api/palette")
    assert r.status_code == 200
    entries = r.json()
    assert entries
    for e in entries:
        idx = e["indices"]
        for key in (
            "total_exposure_index",
            "ablation_aggression_index",
            "delivery_smoothness_index",
            "surface_exposure_index",  # deprecated alias still present
        ):
            assert key in idx, f"missing {key} in indices for entry {e['id']}"
        assert idx["formula_version"] == 2
        # alias matches the canonical
        assert idx["surface_exposure_index"] == idx["total_exposure_index"]
```

(Use whatever fixture names `tests/test_palette_api.py` already uses for `client` and `palette_seeded` — match the existing pattern.)

- [ ] **Step 2: Run, confirm failure**

```bash
uv run --active pytest tests/test_schemas.py tests/test_palette_api.py -v -k "combined_indices or alias"
```

Expected: failures.

- [ ] **Step 3: Update the Pydantic model**

Edit `src/xcs_gen_web/schemas.py`. Find the `LaserIndicesResponse` class. Replace it with:

```python
class LaserIndicesResponse(BaseModel):
    """Heuristic exposure indices derived from raw laser params.

    These are NOT calibrated physical quantities. See
    docs/superpowers/specs/2026-05-07-laser-exposure-indices-design.md.
    """

    pulse_spacing_mm: float
    line_spacing_index: float
    line_spacing_mm: float | None
    pulse_energy_index: float
    pulse_intensity_index: float
    total_exposure_index: float
    ablation_aggression_index: float
    delivery_smoothness_index: float
    formula_version: int
    density_model: str
    power_model: str

    @computed_field  # type: ignore[misc]
    @property
    def surface_exposure_index(self) -> float:
        """Deprecated read-side alias for `total_exposure_index`.
        Will be removed in a future formula-version bump."""
        return self.total_exposure_index
```

If `computed_field` isn't already imported from `pydantic`, add it to the imports at the top of the file:

```python
from pydantic import BaseModel, Field, computed_field, field_validator
```

(Match whatever's already there; just add `computed_field` to the existing import line.)

- [ ] **Step 4: Run, confirm pass**

```bash
uv run --active pytest tests/test_schemas.py tests/test_palette_api.py -v
```

Expected: all green.

- [ ] **Step 5: Run the broader API suite**

```bash
uv run --active pytest tests/test_palette_api.py tests/test_api.py tests/test_validation_endpoints.py -v
```

Expected: all green. If any test seeds a `LaserIndicesResponse` directly with the old field name, fix it inline.

- [ ] **Step 6: Commit**

```bash
git add src/xcs_gen_web/schemas.py tests/test_schemas.py tests/test_palette_api.py
git commit -m "feat(palette): expose combined indices + deprecated surface_exposure alias

LaserIndicesResponse renames the canonical field to total_exposure_index
and adds ablation_aggression_index + delivery_smoothness_index. The old
name surface_exposure_index lives on as a Pydantic @computed_field
alias so external consumers that hard-coded the name keep working —
slated for removal at the next formula-version bump (calibration work)."
```

---

## Task 6: Frontend `LaserIndices` interface + `PaletteIndicesChips`

**Files:**
- Modify: `web/src/components/PaletteIndicesChips.tsx`
- Modify: `web/src/components/PaletteIndicesChips.test.tsx`

- [ ] **Step 1: Update the failing test**

In `web/src/components/PaletteIndicesChips.test.tsx`, find the `indices` test fixture. Add the new fields (rename + two new):

```tsx
const indices = {
  pulse_spacing_mm: 0.0154,
  line_spacing_index: 0.01,
  line_spacing_mm: null,
  pulse_energy_index: 0.769,
  pulse_intensity_index: 0.00385,
  total_exposure_index: 5.0,
  ablation_aggression_index: 0.01923,
  delivery_smoothness_index: 1300.0,
  formula_version: 2,
  density_model: "opaque",
  power_model: "controller_percent",
};
```

Update the existing "renders all six chip labels" test to "renders all eight chip labels" and add the two new labels:

```tsx
it("renders all eight chip labels", () => {
  render(<PaletteIndicesChips indices={indices} />);
  expect(screen.getByText(/pulse spacing/i)).toBeInTheDocument();
  expect(screen.getByText(/line spacing index/i)).toBeInTheDocument();
  expect(screen.getByText(/line spacing \(mm\)/i)).toBeInTheDocument();
  expect(screen.getByText(/pulse energy/i)).toBeInTheDocument();
  expect(screen.getByText(/pulse intensity/i)).toBeInTheDocument();
  expect(screen.getByText(/total exposure/i)).toBeInTheDocument();
  expect(screen.getByText(/ablation aggression/i)).toBeInTheDocument();
  expect(screen.getByText(/delivery smoothness/i)).toBeInTheDocument();
});
```

Update the "renders surface_exposure_index value" test → "renders total_exposure_index value" and reference the new field name. Update the "shows the formula version badge" test to expect `v2`:

```tsx
it("shows the formula version badge", () => {
  render(<PaletteIndicesChips indices={indices} />);
  expect(screen.getByText(/v2/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run, confirm failure**

```bash
cd /Users/jonzky/Documents/XTools/Reverse/web
npx vitest run src/components/PaletteIndicesChips.test.tsx
```

Expected: failures.

- [ ] **Step 3: Update the `LaserIndices` interface and the chip strip**

Edit `web/src/components/PaletteIndicesChips.tsx`. Update the exported interface:

```tsx
export interface LaserIndices {
  pulse_spacing_mm: number;
  line_spacing_index: number;
  line_spacing_mm: number | null;
  pulse_energy_index: number;
  pulse_intensity_index: number;
  total_exposure_index: number;
  ablation_aggression_index: number;
  delivery_smoothness_index: number;
  /** @deprecated alias for total_exposure_index — will go away
   *  with the next formula-version bump. New code should not read it. */
  surface_exposure_index?: number;
  formula_version: number;
  density_model: string;
  power_model: string;
}
```

Find the chip-strip render. The component currently renders six chips in a grid. Update them:

- Rename the "Surface exposure" chip → "Total exposure". Bind it to `indices.total_exposure_index`. Keep the log-scaled bar visualisation on it.
- Add two new chips after it:
  ```tsx
  <Chip
    label="Ablation aggression"
    value={fmtNum(indices.ablation_aggression_index)}
    bar={logBar(indices.ablation_aggression_index, 1e-4, 1e2)}
  />
  <Chip
    label="Delivery smoothness"
    value={fmtNum(indices.delivery_smoothness_index)}
    bar={logBar(indices.delivery_smoothness_index, 1e2, 1e7)}
  />
  ```
  The `logBar` ranges given are heuristics — adjust by inspection during the polish pass if needed. Both new indices span orders of magnitude so a log bar is the right call.

If the existing chips render in `grid-cols-2 sm:grid-cols-3`, change to `grid-cols-2 sm:grid-cols-4` so 8 chips fit cleanly (2 rows of 4 at desktop, 4 rows of 2 on mobile).

- [ ] **Step 4: Run, confirm pass**

```bash
npx vitest run src/components/PaletteIndicesChips.test.tsx
```

Expected: all green.

- [ ] **Step 5: Typecheck**

```bash
npx tsc --noEmit
```

Expected: clean. (If the `LaserIndices` interface change breaks any downstream type, fix the consumer — likely the exposure-page tests reference the old field name.)

- [ ] **Step 6: Commit**

```bash
cd /Users/jonzky/Documents/XTools/Reverse
git add web/src/components/PaletteIndicesChips.tsx web/src/components/PaletteIndicesChips.test.tsx
git commit -m "feat(ui): chip strip — rename to total_exposure, add aggression + smoothness

LaserIndices interface gains total_exposure_index, ablation_aggression_index,
delivery_smoothness_index (rename + 2 new). surface_exposure_index is
typed as optional and JSDoc'd as deprecated. Chip strip renders 8 chips
in a 2×4 grid with log-scaled bars on the three magnitude-spanning ones."
```

---

## Task 7: Frontend exposure-page — `INDEX_ROWS` + correlation-matrix labels + focused-card labels

**Files:**
- Modify: `web/src/components/exposure/exposureCorrelations.ts`
- Modify: `web/src/components/exposure/exposureCorrelations.test.ts`
- Modify: `web/src/components/exposure/ExposureCorrelationMatrix.tsx`
- Modify: `web/src/components/exposure/ExposureFocusedCard.tsx`
- Modify: `web/src/pages/ExposurePage.tsx`

- [ ] **Step 1: Update the failing test**

In `web/src/components/exposure/exposureCorrelations.test.ts`, the `dimensions are 5 indices × 5 channels` test needs updating to 7×5. Replace it with:

```typescript
it("dimensions are 7 indices × 5 channels", () => {
  const rows: ExposureRow[] = [row(10, 50, 0, 0), row(20, 40, 0, 0), row(30, 30, 0, 0)];
  const m = buildCorrelationMatrix(rows);
  expect(INDEX_ROWS.length).toBe(7);
  expect(CHANNEL_COLS.length).toBe(5);
  expect(m.length).toBe(7);
  expect(m[0].length).toBe(5);
});
```

Update any other test that references `surface_exposure_index` to `total_exposure_index`.

- [ ] **Step 2: Run, confirm failure**

```bash
cd /Users/jonzky/Documents/XTools/Reverse/web
npx vitest run src/components/exposure/exposureCorrelations.test.ts
```

- [ ] **Step 3: Update `INDEX_ROWS`**

Edit `web/src/components/exposure/exposureCorrelations.ts`. Replace the `INDEX_ROWS` constant:

```typescript
// `line_spacing_mm` is intentionally excluded — it stays NULL while
// density_model="opaque" and is redundant with `line_spacing_index`.
// Adding it here would require null-handling in buildCorrelationMatrix.
export const INDEX_ROWS = [
  "pulse_spacing_mm",
  "line_spacing_index",
  "pulse_energy_index",
  "pulse_intensity_index",
  "total_exposure_index",
  "ablation_aggression_index",
  "delivery_smoothness_index",
] as const satisfies readonly (keyof LaserIndices)[];
export type IndexRow = (typeof INDEX_ROWS)[number];
```

- [ ] **Step 4: Update the correlations matrix row labels**

Edit `web/src/components/exposure/ExposureCorrelationMatrix.tsx`. Find `ROW_LABELS` and update:

```tsx
const ROW_LABELS: Record<IndexRow, string> = {
  pulse_spacing_mm: "PSp",
  line_spacing_index: "LSp",
  pulse_energy_index: "PEn",
  pulse_intensity_index: "PIn",
  total_exposure_index: "TEx",        // was SEx
  ablation_aggression_index: "AAg",   // new
  delivery_smoothness_index: "DSm",   // new
};
```

- [ ] **Step 5: Update the focused-card labels**

Edit `web/src/components/exposure/ExposureFocusedCard.tsx`. Find `INDEX_LABELS` and `INDEX_ORDER` and update:

```tsx
const INDEX_LABELS: Record<IndexRow, string> = {
  total_exposure_index: "TOTAL_EXPOSURE",        // renamed
  ablation_aggression_index: "ABLATION_AGGRESSION",
  delivery_smoothness_index: "DELIVERY_SMOOTHNESS",
  pulse_intensity_index: "PULSE_INTENSITY",
  pulse_energy_index: "PULSE_ENERGY",
  pulse_spacing_mm: "PULSE_SPACING (mm)",
  line_spacing_index: "LINE_SPACING_INDEX",
};

const INDEX_ORDER: IndexRow[] = [
  "total_exposure_index",
  "ablation_aggression_index",
  "delivery_smoothness_index",
  "pulse_intensity_index",
  "pulse_energy_index",
  "pulse_spacing_mm",
  "line_spacing_index",
];
```

- [ ] **Step 6: Update the exposure-page axis dropdowns**

Edit `web/src/pages/ExposurePage.tsx`. Find any dropdown labels keyed off the index name. The axis selector probably maps index keys to display labels in a `Record<IndexRow, string>` or via inline labels in the JSX. Find it (search for `surface_exposure_index` or `Surface Exposure`):

If there's a label map for the axis dropdowns, add the two new keys and rename:

```tsx
const X_AXIS_LABELS: Record<IndexRow, string> = {
  pulse_spacing_mm: "Pulse spacing (mm)",
  line_spacing_index: "Line spacing index",
  pulse_energy_index: "Pulse energy",
  pulse_intensity_index: "Pulse intensity",
  total_exposure_index: "Total exposure",        // was "Surface exposure"
  ablation_aggression_index: "Ablation aggression",
  delivery_smoothness_index: "Delivery smoothness",
};
```

The brush still anchors to `total_exposure_index`. Find any reference like `r.indices.surface_exposure_index` in the page and change to `r.indices.total_exposure_index`.

If `paletteToExposureRow` references `p.indices.surface_exposure_index`, no change needed since the projection just spreads `indices` — but verify.

- [ ] **Step 7: Run vitest + tsc**

```bash
cd /Users/jonzky/Documents/XTools/Reverse/web
npx vitest run src/components/exposure/ src/pages/ExposurePage.test.tsx
npx tsc --noEmit
```

Expected: all green, clean.

- [ ] **Step 8: Build**

```bash
npm run build
```

Expected: clean.

- [ ] **Step 9: Commit**

```bash
cd /Users/jonzky/Documents/XTools/Reverse
git add web/src/components/exposure/ web/src/pages/ExposurePage.tsx
git commit -m "feat(exposure): add combined indices to scatter, matrix, focused card

INDEX_ROWS extended from 5 to 7 — total_exposure (renamed), aggression,
smoothness now selectable as scatter X/Y axes. Correlations matrix is
7×5 (TEx, AAg, DSm row labels). Focused-card INDICES list shows all
seven, ordered by total_exposure first. The exposure brush still
anchors to total_exposure_index (rename only)."
```

---

## Task 8: Manual smoke + frontend-design polish on the new chips

**Files:**
- Possibly: `web/src/components/PaletteIndicesChips.tsx` (polish)
- Possibly: `web/src/components/exposure/ExposureCorrelationMatrix.tsx` (polish — the matrix is now 7 rows tall)

- [ ] **Step 1: Restart the dev server with a fresh DB so the migration runs cleanly**

```bash
cd /Users/jonzky/Documents/XTools/Reverse
# Kill any running server first
lsof -ti:8017 | xargs kill 2>/dev/null
rm -f /tmp/xcs-23-walk.db
XCS_GEN_DB_URL="sqlite:////tmp/xcs-23-walk.db" XCS_GEN_LOG=WARNING uv run --active xcs-gen serve --host 127.0.0.1 --port 8017 &
SERVER_PID=$!
sleep 4
```

Seed some palette entries (use the API or Python) so the page has data to render.

- [ ] **Step 2: Visual smoke**

Open `http://127.0.0.1:8017/#/palette`, expand any entry. Confirm all 8 chips render with the renamed "Total exposure" + the two new chips. Check the `v2` formula version badge.

Open `http://127.0.0.1:8017/#/exposure`. Confirm:
- Left rail X-axis dropdown lists 7 options including the two new ones.
- Y-axis bivariate dropdown lists the 6 (any-but-X) of those 7.
- Correlations matrix is now 7 rows tall.
- Focused-card INDICES section lists 7 indices with `total_exposure_index` highlighted when X = total_exposure.

If anything looks visually off — chip strip wrapping awkwardly, matrix rows too cramped — tighten the styling in this task. The frontend-design polish budget is intentionally part of this task; the integration is small enough not to need a separate full-skill polish pass.

- [ ] **Step 3: Take a screenshot for the changelog asset**

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless --disable-gpu --hide-scrollbars --window-size=1600,1300 \
  --virtual-time-budget=8000 \
  --screenshot=/tmp/exposure-with-combined.png \
  "http://127.0.0.1:8017/#/exposure"

cp /tmp/exposure-with-combined.png changelog/images/combined-indices.png
```

- [ ] **Step 4: Stop the server**

```bash
kill $SERVER_PID 2>/dev/null
```

- [ ] **Step 5: Commit any polish + the screenshot**

```bash
git add web/src/components/PaletteIndicesChips.tsx \
        web/src/components/exposure/ \
        changelog/images/combined-indices.png
git commit -m "polish(exposure): chip strip 8-chip layout + matrix room for 7 rows

Visual touch-ups after combined-indices integration. Plus screenshot
of the live page with all 7 axes visible."
```

(If no polish was needed, commit only the screenshot.)

---

## Task 9: Validation doc update

**Files:**
- Modify: `docs/exposure-page-validation.md`

- [ ] **Step 1: Update §2 (the indices section)**

In `docs/exposure-page-validation.md`, find §2.1 "The formulas". Replace `surface_exposure_index` with `total_exposure_index` everywhere. Add the two new formulas:

```
ablation_aggression_index   = total_exposure × pulse_intensity
                            = P² × D × R / (S × f × τ)

delivery_smoothness_index   = total_exposure / pulse_intensity
                            = D × R × f × τ / S
```

Update §2.2 "Worked example — defaults" — recompute the new values for the defaults:

```
total_exposure_index        = 50 × 100 × 1 / 1000  = 5.0
ablation_aggression_index   = 5.0 × 0.003846       = 0.01923
delivery_smoothness_index   = 5.0 / 0.003846       = 1300
```

Update §2.3 "Worked example — real entry" — add the two new computations.

Add a new sub-section §2.4-style explaining each new index physically — copy from the spec's §3.1 / §3.2 (log-space rotation + power-cancels-in-smoothness).

Update §2.5 — `INDICES_FORMULA_VERSION` is now `2`; the chip strip footer still reads `v2 · heuristic indices, not calibrated values`.

- [ ] **Step 2: Update §9 (validation checklist)**

In §9.1 "Index math", add three new tickbox items:

```markdown
- [ ] Pick any palette entry. Confirm the chip strip shows 8 chips, not 6.
- [ ] Hand-compute `ablation_aggression = total_exposure × pulse_intensity`. Confirm to 4 sig figs.
- [ ] Hand-compute `delivery_smoothness = total_exposure / pulse_intensity`. Confirm to 4 sig figs.
- [ ] Verify the geometric-mean identity: √(aggression × smoothness) ≈ total_exposure (within 0.5%).
```

In §9.2 "Scatter behaviour", add:

```markdown
- [ ] X-axis dropdown lists 7 indices (including the two new ones).
- [ ] Pick `delivery_smoothness_index` on X. Toggle X-scale log/lin. Confirm tick labels reformat readably (no `0.00` collapse).
- [ ] Pick `(total_exposure, pulse_intensity)` in bivariate mode. Then pick `(ablation_aggression, delivery_smoothness)`. The two scatters should look *visually identical except rotated 45°* — confirm the rotation interpretation.
```

In §9.4 "Correlations matrix":

```markdown
- [ ] Matrix is 7 rows × 5 columns (PSp, LSp, PEn, PIn, TEx, AAg, DSm).
- [ ] Click any of the new rows (TEx, AAg, DSm) → scatter axes update.
```

- [ ] **Step 3: Update §10 "Bug/gap queue"**

Update the list:

```markdown
Already shipped:
- ✅ Combined indices: ablation_aggression + delivery_smoothness; total_exposure rename.

Queued for phase 2.5b:
- A — recipe-family trajectories
- C — "filter to this recipe family" on focused entry
- D — link from focused entry to source test
- E — default scatter mode = bivariate
- F — raw-parameter correlation matrix
- G — nearest-neighbour view
```

- [ ] **Step 4: Commit**

```bash
git add docs/exposure-page-validation.md
git commit -m "docs(exposure): validation doc updated for combined indices

Section 2 (formulas) now covers total_exposure_index +
ablation_aggression_index + delivery_smoothness_index, with
worked examples on defaults and on a real stainless entry. Section
9 (validation checklist) gains tickboxes for the new indices.
Section 10 reflects phase-2.5a as shipped."
```

---

## Task 10: Changelog entry

**Files:**
- Create: `changelog/2026-05-09-combined-indices.md`

- [ ] **Step 1: Write the entry**

Create `changelog/2026-05-09-combined-indices.md`:

```markdown
---
id: 2026-05-09-combined-indices
date: 2026-05-09
level: minor
title: Two combined indices — ablation aggression and delivery smoothness
summary: Two more axes for the exposure page that read more directly as physical regimes. Plus a rename — surface_exposure → total_exposure (canonical).
images:
  - src: combined-indices.png
    caption: The exposure page with the two new axes available in the dropdowns.
---

Every palette entry now carries two more derived indices:

- **`ablation_aggression_index`** — `total_exposure × pulse_intensity`. Reads as "how violently the surface was hit per unit area".
- **`delivery_smoothness_index`** — `total_exposure / pulse_intensity`. Reads as "how thoroughly the head blanketed the surface, regardless of how hard each pulse hit".

These aren't new physics — they're a 45° rotation of `(total_exposure, pulse_intensity)` in log-space:

- `geometric_mean(aggression, smoothness) = total_exposure`
- `aggression / smoothness = pulse_intensity²`

The motivation is interpretability. A power sweep at fixed everything-else lands as a vertical trace on `(delivery_smoothness, ablation_aggression)`, because power cancels in smoothness and adds to aggression. That's a clearer read than the same trace on `(total_exposure, pulse_intensity)`.

Existing `surface_exposure_index` is renamed to `total_exposure_index` — it was always the same number, just better named. The old name lives on as a Pydantic deprecated alias for backwards-compat.

The chip strip on every palette entry now shows 8 chips. The exploration page's X/Y dropdowns list 7 indices (the two new ones plus the renamed one), and the correlations matrix is 7×5 instead of 5×5. The exposure brush still anchors to `total_exposure_index` (rename only).

Migration `0023` does the rename + adds the two columns + backfills every row. The formula version bumps `1 → 2`.
```

- [ ] **Step 2: Verify the entry renders**

Restart the dev server and visit `http://127.0.0.1:8017/#/changelog`. Confirm the entry appears at the top.

- [ ] **Step 3: Commit**

```bash
git add changelog/2026-05-09-combined-indices.md
git commit -m "changelog: combined heuristic indices

Minor-level — adds two derived axes + renames surface_exposure to
total_exposure (with deprecated alias). Image already committed in
the polish task."
```

---

## Task 11: Final verification + draft PR

- [ ] **Step 1: Full backend test suite**

```bash
cd /Users/jonzky/Documents/XTools/Reverse
uv run --active pytest tests/ -q 2>&1 | tail -10
```

Expected: same green count as `main` (pre-existing S3 failures may persist; not regressions).

- [ ] **Step 2: Full frontend typecheck + tests + build**

```bash
cd /Users/jonzky/Documents/XTools/Reverse/web
npx tsc --noEmit
npm test -- --run
npm run build
```

Expected: clean tsc, all vitest passing, clean build.

- [ ] **Step 3: Final alembic upgrade against fresh DB**

```bash
cd /Users/jonzky/Documents/XTools/Reverse
rm -f /tmp/xcs-final-23.db
XCS_GEN_DB_URL="sqlite:////tmp/xcs-final-23.db" uv run --active alembic upgrade head 2>&1 | tail -5
XCS_GEN_DB_URL="sqlite:////tmp/xcs-final-23.db" uv run --active alembic upgrade head 2>&1 | tail -3
```

Expected: ends at `0023`; second run is a no-op.

- [ ] **Step 4: Push + ensure PR #78 is up-to-date**

If working on `feat/exposure-indices-exploration` (continuing PR #78), push:

```bash
cd /Users/jonzky/Documents/XTools/Reverse
git push 2>&1 | tail -3
```

The PR will pick up the new commits automatically. Update the PR body to reflect the additions:

```bash
gh pr edit 78 --body "$(cat <<'EOF'
## Summary

- New top-level page at `#/exposure` for material-scoped exploration of laser exposure indices vs palette colour. Configurable scatter (univariate or bivariate), Hue Ribbon, correlations matrix, right-rail Focused card with a*/b* chromaticity disc + crosshair, bottom exposure-range brush.
- **Plus phase 2.5a**: two new combined indices — `ablation_aggression_index` (total × intensity) and `delivery_smoothness_index` (total / intensity). Rename `surface_exposure_index` → `total_exposure_index` (deprecated alias kept). Migration `0023`. `INDICES_FORMULA_VERSION` bumps `1 → 2`. Chip strip is 8 chips; correlations matrix is 7×5.

Specs:
- `docs/superpowers/specs/2026-05-08-exposure-indices-exploration-design.md`
- `docs/superpowers/specs/2026-05-08-combined-indices-design.md`

Plans:
- `docs/superpowers/plans/2026-05-08-exposure-indices-exploration.md`
- `docs/superpowers/plans/2026-05-08-combined-indices.md`

## Test plan

- [ ] `uv run --active pytest tests/ -q` is green (no regressions)
- [ ] `cd web && npx tsc --noEmit && npm test -- --run` is green
- [ ] Manual: full walkthrough of #/exposure including the two new axes, bivariate (aggression × smoothness), correlations matrix click on new rows.
- [ ] `xcs-gen recompute-indices --force` smoke-runs against a populated DB after deploy (formula version bumped 1 → 2).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 5: Confirm CI is running**

```bash
gh pr checks --watch=false 2>&1 | tail -10
```

Don't wait for completion.

---

## Self-review notes

| Spec requirement | Implementing task |
| --- | --- |
| Pure compute module rename + two new indices + version 2 | Task 1 |
| Schema column rename + two new columns + index changes | Task 2 |
| Alembic 0023 migration with backfill | Task 3 |
| Repository helper updates (`_compute_index_values`, `_REFRESH_COLUMNS`, `_row_to_entry`) | Task 4 |
| API schema rename + two new fields + `surface_exposure_index` deprecated alias | Task 5 |
| Frontend `LaserIndices` interface + 8-chip strip | Task 6 |
| Frontend `INDEX_ROWS` 7-tuple + matrix labels + focused-card labels | Task 7 |
| Manual smoke + polish + screenshot | Task 8 |
| Validation doc updated | Task 9 |
| Changelog entry | Task 10 |
| Final verification + PR update | Task 11 |
