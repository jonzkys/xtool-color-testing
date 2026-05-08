# Combined Heuristic Indices — Design Spec (Phase 2.5a)

**Date:** 2026-05-08
**Status:** Approved (in-conversation); awaiting implementation plan
**Branch:** new branch `feat/combined-indices` cut off `main` once `feat/exposure-indices-exploration` (PR #78) merges. If PR #78 hasn't merged yet, branch off `feat/exposure-indices-exploration` and rebase later.
**Predecessors:**
- Phase 1: `docs/superpowers/specs/2026-05-07-laser-exposure-indices-design.md` (PR #77, alembic `0022`)
- Phase 2: `docs/superpowers/specs/2026-05-08-exposure-indices-exploration-design.md` (PR #78)
**Implementation skill:** `writing-plans` next.

## Summary

Add two **combined heuristic indices** that present the same `(total_exposure, pulse_intensity)` information on rotated, more physically-interpretable axes — plus rename the canonical index from `surface_exposure_index` to `total_exposure_index`. Structurally a phase-1-style cycle: pure compute module gains two formulas, schema gains two columns and renames one, alembic backfill recomputes everything, frontend chip strip + exploration-page axis list pick up the new options for free.

The new indices are not new physics — they're a 45° rotation of the existing pair in log-space. The motivation is interpretability: `ablation_aggression` reads as "how violently the surface was hit", and `delivery_smoothness` reads as "how thoroughly the head blanketed the surface" (and is power-independent — see §3).

## Goals

- Rename `surface_exposure_index` → `total_exposure_index` (single source of truth in storage; API serves both names so any external consumer keeps working).
- Add `ablation_aggression_index = total_exposure × pulse_intensity` to every palette entry.
- Add `delivery_smoothness_index = total_exposure / pulse_intensity` to every palette entry.
- Backfill via the existing `_compute_index_values` helper + a `0023` alembic migration; bump `INDICES_FORMULA_VERSION` to `2`.
- Surface the three changes in the chip strip (`PaletteIndicesChips`) and the exploration page's axis selectors (the `INDEX_ROWS` constant in `exposureCorrelations.ts`).
- Update the validation document (`docs/exposure-page-validation.md`) with the new formulas and worked examples.

## Non-goals (Phase 2.5a)

- Phase 2.5b items (recipe-family traces, recipe-family filter, link-to-test, default-mode change, raw-parameter correlation matrix, nearest-neighbour view) are explicitly out of scope. They land after this in their own spec.
- Calibration. Power, density still treated as opaque controller settings.
- Removing `surface_exposure_index`. The deprecation is read-side only — old reads keep working. Removal is a future formula-version bump.

## The two new formulas

```
ablation_aggression_index   = total_exposure × pulse_intensity
                            = P² × D × R / (S × f × τ)

delivery_smoothness_index   = total_exposure / pulse_intensity
                            = D × R × f × τ / S
```

where `P=power`, `S=speed`, `D=density`, `R=repeat`, `f=mopa_frequency`, `τ=pulse_width`.

### 3.1 Mathematical properties (worth knowing)

In log-space the new pair is a clean rotation of `(total_exposure, pulse_intensity)`:

```
log(aggression)  = log(total_exposure) + log(pulse_intensity)
log(smoothness)  = log(total_exposure) − log(pulse_intensity)
```

Therefore:
- `geometric_mean(aggression, smoothness) = total_exposure`
- `aggression / smoothness = pulse_intensity²`

The pair carries the same information as `(total_exposure, pulse_intensity)` — but on axes that read more directly as physical regimes.

### 3.2 The "power cancels in smoothness" point

`delivery_smoothness = D × R × f × τ / S`. Power genuinely does not appear. Physically: smoothness describes how thoroughly the head paints the surface (density × passes × duty-cycle / speed), regardless of how hard each pulse hits. This makes it a candidate for predicting *colour family* across power sweeps (where colour shifts but smoothness is constant).

### 3.3 Worked example

For `P=10.4, S=800, f=125, D=5000, τ=200, R=2` (matches a real entry on stainless):

```
total_exposure        = 10.4 × 5000 × 2 / 800              = 130.0
pulse_intensity       = 10.4 / (125 × 200)                 = 4.16e-4
ablation_aggression   = 130.0 × 4.16e-4                    = 0.05408
delivery_smoothness   = 130.0 / 4.16e-4                    = 312500.0

geometric_mean(aggression, smoothness)
                      = √(0.05408 × 312500)
                      = √16900.0                           = 130.0  ✓ matches total_exposure
aggression / smoothness
                      = 0.05408 / 312500
                      = 1.731e-7                           ≈ pulse_intensity²  ✓
```

## Architecture

### 4.1 Pure compute module — `src/xcs_gen/laser_indices.py`

`LaserIndices` dataclass gains:

```python
@dataclass(frozen=True)
class LaserIndices:
    pulse_spacing_mm: float
    line_spacing_index: float
    line_spacing_mm: float | None
    pulse_energy_index: float
    pulse_intensity_index: float
    total_exposure_index: float          # renamed from surface_exposure_index
    ablation_aggression_index: float     # new
    delivery_smoothness_index: float     # new
    formula_version: int
    density_model: str
    power_model: str
```

`compute_indices` adds:

```python
total_exposure_index = power * density * repeat / speed
ablation_aggression_index = total_exposure_index * pulse_intensity_index
delivery_smoothness_index = total_exposure_index / pulse_intensity_index
```

`INDICES_FORMULA_VERSION = 2`. The bump is what `xcs-gen recompute-indices --force` keys off after deploy.

### 4.2 Schema — `palette_entries` (alembic `0023_palette_combined_indices`)

The migration:

1. **Rename** column `surface_exposure_index` → `total_exposure_index`.
2. **Rename** index `ix_palette_entries_material_exposure` → `ix_palette_entries_material_total_exposure` (which references the new column name automatically).
3. **Add** column `ablation_aggression_index FLOAT NULL`.
4. **Add** column `delivery_smoothness_index FLOAT NULL`.
5. **Add** index `ix_palette_entries_material_aggression` on `(material_id, ablation_aggression_index)`.
6. **Backfill**: walk every row, parse `params_json`, call `_compute_index_values` (already updated to produce the new column dict), `UPDATE` all three columns.
7. Bump CI version assertion: `0022` → `0023` in `.github/workflows/ci.yml`.

Use `op.batch_alter_table` for cross-dialect (SQLite + MySQL) compatibility — the same pattern phase-1's migration `0022` settled on.

### 4.3 Repository write/read paths

`_compute_index_values` (in `src/xcs_gen_web/repositories/palette.py`) gains the three new keys and renames the existing one. All four call sites (`_build_row`, `update_entry`, `create_validated_entry`, `recompute_indices`) pick this up for free, because each one spreads the helper's dict directly into row values.

`_row_to_entry`'s nested `indices` dict adds the three new keys.

### 4.4 API schema — `LaserIndicesResponse`

The Pydantic model is updated:

```python
class LaserIndicesResponse(BaseModel):
    pulse_spacing_mm: float
    line_spacing_index: float
    line_spacing_mm: float | None
    pulse_energy_index: float
    pulse_intensity_index: float
    total_exposure_index: float          # renamed
    ablation_aggression_index: float     # new
    delivery_smoothness_index: float     # new
    formula_version: int
    density_model: str
    power_model: str

    @computed_field
    @property
    def surface_exposure_index(self) -> float:
        """Deprecated read-side alias for `total_exposure_index`.
        Kept for any external consumer that hard-coded the old name.
        Will be removed in a future formula-version bump."""
        return self.total_exposure_index
```

Pydantic v2's `@computed_field` decorator emits the property in serialization, so the API response carries both keys with identical values. Internal code uses the canonical `total_exposure_index`.

### 4.5 Frontend — `LaserIndices` interface

In `web/src/components/PaletteIndicesChips.tsx`, the exported `LaserIndices` interface gains the new fields and treats the alias as optional:

```typescript
export interface LaserIndices {
  pulse_spacing_mm: number;
  line_spacing_index: number;
  line_spacing_mm: number | null;
  pulse_energy_index: number;
  pulse_intensity_index: number;
  total_exposure_index: number;             // new canonical
  ablation_aggression_index: number;        // new
  delivery_smoothness_index: number;        // new
  /** @deprecated use total_exposure_index */
  surface_exposure_index?: number;
  formula_version: number;
  density_model: string;
  power_model: string;
}
```

### 4.6 Frontend — `PaletteIndicesChips`

The chip strip currently renders six chips. After this lands it renders eight:

| Chip | Value |
|---|---|
| Pulse spacing (mm) | `pulse_spacing_mm` |
| Line spacing | `line_spacing_index` |
| Line spacing (mm) | `line_spacing_mm` (still `—` while density_model="opaque") |
| Pulse energy | `pulse_energy_index` |
| Pulse intensity | `pulse_intensity_index` |
| Total exposure | `total_exposure_index` (was "Surface exposure") |
| Ablation aggression | `ablation_aggression_index` (new) |
| Delivery smoothness | `delivery_smoothness_index` (new) |

Layout: still a responsive grid; eight chips at narrow widths flow to two rows. The log-scaled bar treatment currently on `surface_exposure_index` follows the rename to `total_exposure_index`. Optionally, `ablation_aggression_index` also gets a log-scaled bar (it spans even wider — orders of magnitude). Implementation note: bar discrimination tuning can be done during the polish pass.

### 4.7 Frontend — Exposure page axis selectors

`web/src/components/exposure/exposureCorrelations.ts`'s `INDEX_ROWS` becomes a 7-tuple:

```typescript
export const INDEX_ROWS = [
  "pulse_spacing_mm",
  "line_spacing_index",
  "pulse_energy_index",
  "pulse_intensity_index",
  "total_exposure_index",
  "ablation_aggression_index",
  "delivery_smoothness_index",
] as const satisfies readonly (keyof LaserIndices)[];
```

The scatter's X/Y axis dropdowns, the exposure brush (still anchored to `total_exposure_index`), the correlations matrix's row dimension, and the focused card's INDEX list all derive from this constant. They light up automatically.

The correlations matrix becomes 7 × 5 instead of 5 × 5 — taller, but otherwise the same layout. The previously-named "SEx" row label becomes "TEx" (or full "Total exposure"); two new rows "AAg" + "DSm" join.

The exposure-range brush continues to filter by `total_exposure_index` (the rename is purely cosmetic — `surface_exposure_index` was identical).

### 4.8 Validation document update

`docs/exposure-page-validation.md` is updated:
- §2 (the indices section) renames `surface_exposure_index` → `total_exposure_index` and adds two new sub-sections explaining `ablation_aggression_index` + `delivery_smoothness_index` with their physical interpretation.
- The worked examples show the new values.
- §9 (validation checklist) gains 2-3 new tickbox items.
- The 8-chip footer reflects the new chip count.

## Migration safety

- **Cross-dialect rename.** `op.batch_alter_table("palette_entries") as batch_op:` then `batch_op.alter_column("surface_exposure_index", new_column_name="total_exposure_index")`. Works on SQLite (via batch) and MySQL (native).
- **Index rename.** The composite index `ix_palette_entries_material_exposure` references the old column name. Drop + recreate inside the same batch under the new name `ix_palette_entries_material_total_exposure`.
- **Backfill failure isolation.** The same per-row try/except pattern from `0022` — rows that fail to parse get `formula_version=0` (unchanged sentinel).
- **Idempotence.** Re-running `alembic upgrade head` is a no-op (existing convention).
- **Reversibility.** `downgrade()` reverses the rename + drops the new columns/indexes. Backfill on downgrade fills `surface_exposure_index` from `total_exposure_index` then drops the new columns; the original phase-1 backfill data is preserved.

## Testing

- **Unit tests** (`tests/test_laser_indices.py`):
  - Hand-computed `total_exposure_index` matches the existing surface_exposure value (renamed, same number).
  - `ablation_aggression_index = total_exposure × pulse_intensity`. Confirm on the defaults (`= 5.0 × 0.003846 = 0.01923`) and on the stainless example (`= 130.0 × 4.16e-4 = 0.05408`).
  - `delivery_smoothness_index = total_exposure / pulse_intensity`. Confirm on the same cases.
  - `INDICES_FORMULA_VERSION == 2`.
  - The geometric-mean and ratio identities hold (`√(aggr × smooth) ≈ total_exposure`, `aggr / smooth ≈ pulse_intensity²`).

- **Migration test** (`tests/test_alembic.py`): the existing harness picks up the new revision automatically; the CI version-assertion bump is the only manual edit.

- **Repository tests** (`tests/test_repo_palette.py`): inserts produce the three new index columns; reads expose them; `recompute_indices --force` after an `INDICES_FORMULA_VERSION` bump rewrites every row.

- **API tests** (`tests/test_palette_api.py` + `tests/test_schemas.py`): GET responses include both `total_exposure_index` and the deprecated `surface_exposure_index`, identical values.

- **Frontend** (`web/src/components/exposure/exposureCorrelations.test.ts` + the chip-strip vitest): correlations matrix has 7 rows; chip strip has 8 chips.

- **Manual Playwright walkthrough**: chip strip on a palette entry shows all 8 chips; exposure page's X/Y dropdowns list 7 indices; correlations matrix is 7 rows tall; clicking the new rows changes the scatter axes correctly.

## Phase 2.5b deliverable preview (for context, not in scope here)

After H ships:

| | |
|---|---|
| A | Recipe-family **traces** on the scatter |
| C | "Show only this recipe family" filter on the focused entry |
| D | Link from focused entry to its source test |
| E | Default-mode change → bivariate `(total_exposure × pulse_intensity)` or `(delivery_smoothness × ablation_aggression)` |
| F | Raw-parameter correlation matrix (toggle alongside indices) |
| G | Nearest-neighbour view (ΔE-similar + similar exposure regime) |

## Open questions

None blocking implementation. One worth flagging — the `surface_exposure_index` alias should have a planned removal date (e.g., when `INDICES_FORMULA_VERSION` reaches `3` from calibration work). Capturing that in a follow-up would prevent the alias becoming permanent debt.
