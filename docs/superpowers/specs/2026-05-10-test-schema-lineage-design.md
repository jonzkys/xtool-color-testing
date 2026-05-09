# Test schema lineage + line-spacing physical units

**Status:** design  
**Date:** 2026-05-10  
**Owner:** @jon  
**Touches:** `src/xcs_gen/laser_indices.py`, `src/xcs_gen_web/models.py`, `src/xcs_gen_web/schemas.py`, `src/xcs_gen_web/repositories/*.py`, `src/xcs_gen_web/app.py` (validation ingest), `alembic/versions/0024_*.py`, `web/src/components/PaletteIndicesChips.tsx`, `web/src/components/exposure/exposureCorrelations.ts`, `web/src/components/exposure/exposureHelpCopy.ts`, `web/src/components/exposure/ExposurePage.tsx` (chip / matrix / scatter wiring), tests across both halves.

## Why

Today, lineage between tests and palette entries is partly implicit and partly inferable through joins. Specifically:

- **For a validation test**, you can find which sweep produced the source palette by joining `validation_cells.palette_entry_id → palette_entries.test_id`, but the test record itself doesn't say "I'm validating the palette from Test #N." The link is recoverable, not stored.
- **For a palette entry produced by ingesting a cross-material validation result**, there is currently no field that points back at the original entry being validated. The entry has its own `test_id` (pointing to the validation test), but the *upstream* lineage — "I was burned to validate entry #M on Anodised Aluminium" — is buried inside `validation_cells` and not surfaced anywhere in the entry response.
- **Forks/iterations between tests** (e.g. "I copied Test #20 to retry with a wider power range") are not represented at all. `retest_index` only tracks repeated burns of the *same* test.
- **Project-level grouping** ("blues exploration, day 3") is not represented; you'd have to encode it in `notes`.

Separately:

- The exposure page treats `density` as opaque (`density_model="opaque"`, `line_spacing_mm = NULL`) and exposes a derived `line_spacing_index = 1 / density` which on the UI surfaces as e.g. `4.0e-4` instead of the `5000` lines/cm the user actually configured. The codebase has been explicit the whole time (`src/xcs_gen/machines.py:145`: "Stepped LPC values for the STANDARD profile (lines per cm)"), so the opacity hedge is wrong and the displayed number is far less meaningful than the underlying integer.

## Constraints

- **One PR.** Schema additions, formula-version bump, backfill, and frontend updates ship together.
- **Backfill is best-effort.** Pattern matches `0022` and `0023` — failed rows fall back to `formula_version=0` (for indices) or `NULL` (for new FKs). No cascading failures.
- **No UI surfacing of the new lineage fields in this PR.** `tests.source_test_id` etc. land in the API response shape, but the test-detail page and exposure focused card learn to render them in a follow-up. Keeps blast radius contained.
- **Backwards-compatible API.** All new fields are nullable on response schemas; old clients still parse.
- **No skipping pre-commit hooks.** CI's hardcoded alembic-revision check (`.github/workflows/ci.yml::mysql-migration-test::test "$VER" = "0024"`) MUST be updated in the same commit as the migration.
- **MySQL-compatible `alter_column`.** Per the lesson from PR #79 (`9401050`): every `batch_op.alter_column` with a rename uses `existing_type=` + `existing_nullable=`.

## Architecture

### Schema changes — migration `0024`

```
ALTER TABLE tests
  ADD COLUMN source_test_id INTEGER NULL REFERENCES tests(id) ON DELETE SET NULL,
  ADD COLUMN parent_test_id INTEGER NULL REFERENCES tests(id) ON DELETE SET NULL,
  ADD COLUMN tag VARCHAR(64) NULL;
CREATE INDEX ix_tests_source_test_id ON tests(source_test_id);
CREATE INDEX ix_tests_parent_test_id ON tests(parent_test_id);
CREATE INDEX ix_tests_tag ON tests(tag);

ALTER TABLE palette_entries
  ADD COLUMN derived_from_entry_id INTEGER NULL
    REFERENCES palette_entries(id) ON DELETE SET NULL,
  DROP COLUMN line_spacing_index;
CREATE INDEX ix_palette_entries_derived_from
  ON palette_entries(derived_from_entry_id);
```

Why each:

- **`tests.source_test_id`** — for `kind=validation` tests, points at the test whose harvested palette is being validated. Discoverable today via `validation_cells.palette_entry_id → palette_entries.test_id`, but storing it explicitly lets the test header render "Validates palette from Test #N" without a join, and survives source-entry deletion (cells go to NULL but the test→test link stays). NULL on `kind=sweep` tests.
- **`tests.parent_test_id`** — fork lineage. NULL by default. Set when a future "Copy this test" UI affordance writes a new test based on an existing one. Distinct from `retest_index`, which is monotonic on the *same* test row.
- **`tests.tag`** — short campaign/grouping label (≤64 chars). Indexed for `WHERE tag = 'blues-exploration'` queries. NULL on existing rows.
- **`palette_entries.derived_from_entry_id`** — direct entry→entry lineage for entries produced by ingesting validation results. Lets a focused entry on the exposure page show "← validated against #M on Material X." Distinct from the existing `validated_test_id` / `validated_cell_index`, which point *downstream* (this entry has been validated by a later test). The two answer mirror-image questions.
- **Drop `palette_entries.line_spacing_index`** — superseded by the now-physical `line_spacing_mm`. Recoverable any time from `params.density` (`= 1 / density`), so dropping is safe.

### Formula change — `INDICES_FORMULA_VERSION` 2 → 3

In `src/xcs_gen/laser_indices.py`:

- The `density_model` parameter on `compute_indices()` defaults to `"lpc"` (was `"opaque"`); `"lpc"` is the only legal value passed for fresh computation. The function raises `ValueError` for any other value, including the now-deprecated `"opaque"`.
- `line_spacing_mm = 10 / density` (1 cm = 10 mm; lines/cm → mm/line). Always populated for successful `compute_indices()` calls.
- `line_spacing_index` field is **removed from the `LaserIndices` dataclass** and from the `_REFRESH_COLUMNS` set in `src/xcs_gen_web/repositories/palette.py`. The DB column drop in migration 0024 means existing repository write paths must drop it too.
- Old rows that *stored* `density_model="opaque"` still deserialise via the response schema (the `Literal["lpc", "opaque"]` union retains the legacy value). They simply don't get re-validated against the input parameter set.

### Pydantic schemas

`LaserIndicesResponse`:
- `line_spacing_index: float` removed.
- `line_spacing_mm: float | None` stays nullable — backfill is best-effort, so rows whose `compute_indices()` raised will land at `formula_version=0` with NULL indices, including this one. Post-migration the field is populated for *most* entries but not guaranteed.
- `density_model: Literal["lpc", "opaque"]` (the `"opaque"` value is retained for legacy rows where backfill failed; new rows are always `"lpc"`).

`TestResponse`:
- `source_test_id: int | None = None`
- `parent_test_id: int | None = None`
- `tag: str | None = None`

`PaletteEntryResponse`:
- `derived_from_entry_id: int | None = None`

`TestUpdate`:
- Add optional `parent_test_id` and `tag` so existing test-edit flows can set them. (`source_test_id` is set at validation-test creation, not edited later.)

### Validation-ingest path — set `derived_from_entry_id` automatically

The `tests_validate` endpoint in `src/xcs_gen_web/app.py` (around line 1990) iterates accepted validation cells and calls `pal_repo.create_validated_entry(...)` for each. We extend that call site so each new entry is persisted with its source entry id alongside the existing `validated_cell_index`. Concretely:

```python
# Build a lookup once: (test_id, cell_index) → palette_entry_id from validation_cells.
src_entry_by_cell = {
    int(c["cell_index"]): c["palette_entry_id"]
    for c in vc_repo.list_for_test(tid)  # the same source already loaded above
}

# Inside the per-entry loop:
new_entry = pal_repo.create_validated_entry(
    ...,
    validated_cell_index=int(entry["cell_index"]),
    derived_from_entry_id=src_entry_by_cell.get(int(entry["cell_index"])),  # may be NULL
    ...,
)
```

`palette.create_validated_entry` gains a new `derived_from_entry_id: int | None = None` keyword argument and writes it through to the INSERT. The same change applies to the parallel ingest path at line ~2150 (the auto-validate flow). NULL is fine if the source entry has been deleted (the cell's `palette_entry_id` went to NULL via `ON DELETE SET NULL`).

### Validation-test creation path — set `tests.source_test_id` automatically

When a `kind=validation` test is created via `POST /api/tests`, the request includes the source palette entries. Compute the modal `palette_entries.test_id` across those entries and persist it as `tests.source_test_id`. If the source entries span multiple tests (a "synthetic" validation that picks across the corpus) or all source entries are deleted, set `source_test_id` to NULL.

This keeps the link in sync with cell-level lineage but doesn't depend on it post-creation.

### Exposure page — drop the index, surface the mm

`web/src/components/exposure/exposureCorrelations.ts`:
- `INDEX_ROWS` removes `line_spacing_index`. Add `line_spacing_mm` in its place. The 7-row matrix becomes a 7-row matrix with the renamed entry. UI behaves identically to today minus the rename.
- `IndexRow` type union loses `line_spacing_index`, gains `line_spacing_mm`.

`web/src/components/exposure/exposureHelpCopy.ts`:
- Remove the `line_spacing_index` entry from `EXPOSURE_INDEX_HELP`. Add a `line_spacing_mm` entry:
  ```ts
  line_spacing_mm: {
    heading: "Line spacing",
    unit: "mm",
    definition: "Physical distance between adjacent scan lines, derived from the controller's density setting.",
    formula: "10 ÷ density",
    inputs: [
      { name: "density", unit: "lines/cm" },
    ],
    guide:
      "Smaller is denser hatching. Below the spot diameter, lines start to overlap and the burn behaves as a continuous fill — additional density gains then translate into more pulse overlap, not finer hatching.",
    schematic: "line_pitch",
  },
  ```
- Update `EXPOSURE_RAW_PARAM_HELP.density.unit` from `"controller value (opaque)"` to `"lines/cm"`. Update `definition` to drop the "non-physical" hedge.
- Walk every other entry's `inputs[]`: any `{name: "density", unit: "controller value (opaque)"}` becomes `{name: "density", unit: "lines/cm"}`.
- `INDEX_LABELS` (`web/src/pages/ExposurePage.tsx`) and `INDEX_LABELS_MATRIX`: rename `line_spacing_index` → `line_spacing_mm`; matrix abbreviation `LSp` stays.

`web/src/components/PaletteIndicesChips.tsx`:
- Remove the `line_spacing_index` chip. Promote `line_spacing_mm` into the prime grid slot. The chip count drops from 8 to 7. Update the test fixture `CHIP_INDEX_KEY` accordingly (drop the `"Line spacing index"` key).
- The two `Line spacing` chips collapsing into one is fine — the previous design had `Line spacing index` (dimensionless) and `Line spacing (mm)` (always blank because `line_spacing_mm` was NULL). Now we have one `Line spacing` chip in mm, populated.

`PaletteIndicesChips`'s `LaserIndices` interface drops `line_spacing_index?` and makes `line_spacing_mm: number` (was `number | null`).

### Backfill — `0024` `upgrade()`

Two passes:

1. **Tests pass.** For every `tests.kind="validation"` row: compute the modal `validation_cells.palette_entry_id → palette_entries.test_id` across cells where `palette_entry_id IS NOT NULL`. If unique, write to `source_test_id`. If empty/mixed, leave NULL. `parent_test_id` and `tag` stay NULL.
2. **Palette pass.** For every palette entry whose test is `kind="validation"`: look up `validation_cells.palette_entry_id` for the cell that produced it. Best-effort match by `cell_index` derived from `(x_value, y_value)` against the cells' grid layout — NULL when ambiguous. Then recompute indices via `compute_indices(params, density_model="lpc")`, populating `line_spacing_mm` and ignoring the now-dropped `line_spacing_index` column. Write `formula_version=3`. Per-row failure → `formula_version=0`.

The backfill SQL has to drop `line_spacing_index` BEFORE the recompute pass so the UPDATE doesn't reference the dropped column. Migration order:

```python
def upgrade():
    # Phase 1: schema additions + line_spacing_index drop
    with op.batch_alter_table("tests") as batch:
        batch.add_column(Column("source_test_id", Integer, FK("tests.id", ondelete="SET NULL"), nullable=True))
        batch.add_column(Column("parent_test_id", Integer, FK("tests.id", ondelete="SET NULL"), nullable=True))
        batch.add_column(Column("tag", String(64), nullable=True))
        batch.create_index("ix_tests_source_test_id", ["source_test_id"])
        batch.create_index("ix_tests_parent_test_id", ["parent_test_id"])
        batch.create_index("ix_tests_tag", ["tag"])

    with op.batch_alter_table("palette_entries") as batch:
        batch.add_column(Column("derived_from_entry_id", Integer, FK("palette_entries.id", ondelete="SET NULL"), nullable=True))
        batch.drop_column("line_spacing_index")
        batch.create_index("ix_palette_entries_derived_from", ["derived_from_entry_id"])

    # Phase 2: backfill source_test_id on validation tests
    # (validation_cells exists; each row carries palette_entry_id which → palette_entries.test_id)
    backfill_source_test_id(op.get_bind())

    # Phase 3: backfill derived_from_entry_id on validation-produced palette entries
    backfill_derived_from_entry_id(op.get_bind())

    # Phase 4: recompute indices with density_model="lpc"
    recompute_all_indices(op.get_bind())  # bumps formula_version 2 → 3
```

Downgrade reverses: re-adds `line_spacing_index` (recomputed from params.density), drops the new columns. Indices stay with formula_version=3 (the LPC-computed values are correct; downgrade is a structural revert, not a semantic rollback).

### CI guard

`.github/workflows/ci.yml::mysql-migration-test`: change `test "$VER" = "0023"` to `test "$VER" = "0024"`. Same commit as the migration file.

## Test plan

**Backend:**

- `tests/test_db_models.py` — assert presence of new columns, FK directions, index names. Confirm `line_spacing_index` is gone.
- `tests/test_laser_indices.py` — `compute_indices(...)` with `density_model="lpc"` populates `line_spacing_mm = 10/density` and the dataclass has no `line_spacing_index` field. `compute_indices(..., density_model="opaque")` raises `ValueError` (since 0023 we already raised on unknown models; this just narrows the legal set further).
- `tests/test_repo_palette.py` — `_compute_index_values` writes `line_spacing_mm`, no longer references `line_spacing_index`. The `_REFRESH_COLUMNS` set is updated.
- `tests/test_repo_tests.py` (or wherever validation-test creation lives) — creating a `kind=validation` test from a list of palette entries auto-populates `tests.source_test_id` to the modal source test id; mixed-source case sets it to NULL.
- `tests/test_validation_ingest.py` (new or extended) — ingesting validation results writes `palette_entries.derived_from_entry_id` matching the `validation_cells.palette_entry_id` for each cell.
- `tests/test_palette_api.py` / `tests/test_test_api.py` — response schemas surface the new fields with correct nullable semantics.
- `tests/test_schemas.py` — `LaserIndicesResponse` no longer has `line_spacing_index`; `TestResponse` / `PaletteEntryResponse` carry the new fields; `TestUpdate` accepts `parent_test_id` and `tag`.
- Migration round-trip test (already in `0023`'s pattern) — `alembic upgrade head; alembic downgrade -1; alembic upgrade head` against fresh SQLite produces a clean schema.

**Frontend:**

- `web/src/components/PaletteIndicesChips.test.tsx` — chip count drops to 7; `Line spacing` chip shows the populated mm value; the `line_spacing_index` chip is gone. Hover help on `Line spacing` opens the new `line_spacing_mm` card with formula `10 ÷ density`.
- `web/src/components/exposure/exposureHelpCopy.test.ts` — `EXPOSURE_INDEX_HELP` has a `line_spacing_mm` entry; no `line_spacing_index` entry. `EXPOSURE_RAW_PARAM_HELP.density.unit === "lines/cm"`. The cross-reference test (every `inputs[].name` appears in the formula) still passes.
- `web/src/components/exposure/exposureCorrelations.test.ts` — `INDEX_ROWS` contains `line_spacing_mm`, not `line_spacing_index`. Length unchanged at 7.
- `web/src/pages/ExposurePage.test.tsx` — rail picker, scatter, and matrix render with the new key. No regressions on focus/hover/click flows.

## Risks

- **MySQL migration test catches `alter_column` mistakes.** The new migration drops `line_spacing_index` and adds three FK columns to `tests`. Verify locally with `XCS_GEN_DB_URL=mysql+pymysql://...` before pushing — the lesson from PR #79.
- **Backfill silently mismaps `derived_from_entry_id` if cell_index inference is brittle.** Worst case: NULL. Best-effort matches the `0022`/`0023` pattern. The downstream UI treats NULL as "no known source," which is honest.
- **Old API clients receive new fields but don't render them.** Pydantic's default-None serialisation handles this; manual JSON consumers must not be `additionalProperties: false`. (Spot-check the docs/openapi.json ingest helpers.)
- **Renaming `line_spacing_index` → `line_spacing_mm` in `INDEX_ROWS` invalidates any user's saved scatter axis preferences.** None are persisted today, so no migration needed at this layer. If we add preference persistence later, it'll need an entry-key remapping.

## Out of scope

- **UI surfacing of the new lineage fields.** The test-detail page learning to render "Source test #N" and "Forked from Test #M" is a follow-up. Same for the exposure focused card showing `← validated against #X on [material]`.
- **Multi-tag support.** This PR ships a single `tag` column. Promotion to a tags-join-table comes only if it's needed.
- **Calibration of `density_model` for non-STANDARD profiles.** The COLOR_ENGRAVE / TEXT profiles also use LPC, but verifying the conversion across all machine profiles is its own task. The PR ships LPC as the universal `density_model` (single legal value besides legacy `"opaque"`).
- **Removing the `density_model` / `power_model` strings.** They've outlived their original "calibration unknown" purpose, but still have a useful versioning role for future regimes (e.g. `power_model="watts_calibrated"`). Keep them.

## Decisions captured

- **`tests.source_test_id`** stored explicitly, not derived. Survives source-entry deletion via `ON DELETE SET NULL` on the cell-level FK; the test-level FK stays put.
- **`palette_entries.derived_from_entry_id`** is the upstream lineage column for validation-produced entries, distinct from the existing downstream `validated_test_id`/`validated_cell_index`.
- **`parent_test_id` and `tag`** included in the same PR per user direction.
- **Single PR** for schema + formula bump + frontend rename, per user direction.
- **`line_spacing_index` column dropped** rather than left dangling. Recoverable from `params.density` if ever needed.
- **`density_model="lpc"`** becomes the default and only legal value for fresh computation. Legacy `"opaque"` rows still parse; `compute_indices()` no longer accepts `"opaque"` as an argument.
