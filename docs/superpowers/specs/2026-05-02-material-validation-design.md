# Material palette validation — Design

## What this is

A new test **kind** that validates whether a material's existing palette
reproduces correctly. Today every record in `tests` is a *parameter
sweep*: pick X (and optionally Y) parameters, sweep across them, see
what colours emerge, ingest the survivors into the material's palette.
Validation is the inverse: given a palette that's already been ingested,
generate a burn that re-uses each picked palette swatch's stored params,
photograph it, measure each cell, and compare ΔE against the swatch's
stored Lab. The goal is "did this palette actually reproduce on the
machine again?", not "find new colours".

This is **stage 1**. A future *material test* feature — generating a
brand-new palette from scratch by sweeping a material — is out of scope
here.

## Where it lives

A new value `kind = 'validation'` on `tests` (default `'sweep'` for
existing rows). The tests list, the test-detail page, the upload flow,
the result-detail dialog, and the ingest pipeline all stay; they get
small `kind`-aware branches.

The test-detail form (`ParamTestEditor.tsx`) currently has tabs
`test | sweep | base | registration`. For `kind === 'validation'` the
**`sweep` tab is replaced by a `palette` tab** with the picker; the
other three tabs render unchanged. Existing sweep tests are
untouched (their `kind` defaults to `'sweep'`).

## Algorithm: how N cells get picked

**Farthest-point sampling in 3D Lab space.** Given a palette with M
swatches and a target N:

1. Seed: pick the swatch with maximum L*-difference-from-mean (most
   extreme on the lightness axis). Deterministic, doesn't depend on
   palette ordering.
2. Iterate: pick the swatch maximising the minimum ΔE76 to the
   already-picked set. Stop at N.

ΔE76 (Euclidean Lab) is fast and good enough for a "spread out"
heuristic; ΔE2000 isn't worth the complexity here.

N is a *seed*, not a cap. After auto-pick the user can toggle any tile
on/off; the xcs is generated from whatever's currently selected at
"Generate .xcs" time. Empty selection → button disabled.

## Cell layout

**Wrapped 1D, ordered by L\* (ascending — darkest first).** Reuses the
existing wrapped-1D capture path with `hide_axis_labels=true` (no
parameter to plot — the cells aren't a sweep). The grid layout solver
takes:

- `width_mm`, `height_mm` (per-row), and `gap_mm` from existing test
  fields, exactly as wrapped 1D does today.
- `cells_per_row` is a new validation-only field on the form, defaulting
  to a value that produces ~roughly-square cells given the row height
  (e.g. `round(width_mm / height_mm)` clamped to ≥ 1).
- `rows = ceil(N / cells_per_row)`, computed at xcs-generation time.
- Cell-shape (rect / circle) reuses the existing test field.

Sorting by L* turns the burn into a luminance ramp visible at a glance —
a dark cell that comes out light reads instantly as a failure.

## Picker UI

A single panel in the test-detail form when `kind === 'validation'`,
two-up:

- **Left: swatch grid.** Mirrors the result-detail modal's
  `displayedSwatches` grid — every palette entry as a tile (hex + L*
  pip + tiny `n=` source-result count badge). Selected tiles get a
  primary-colour ring + ✓ corner glyph; unselected tiles dim to ~55%
  opacity. Click toggles. Header strip shows `selected: N / M`,
  `auto-pick (N=…)` button, `clear` button.
- **Right: a\*/b\* scatter mini-map.** Reuses
  `ResultDetailDialog.LabScatter`'s SVG body. All M swatches as small
  filled dots; selected ones get a ring. Hovering a dot in either
  view highlights its twin in the other.

The picker scrolls within the form's existing left column.

## Data flow

**Test creation:**
1. User chooses material (gates the palette).
2. UI calls `GET /api/palette/list?material_id=…&owner_id=…` → fills
   the picker.
3. User adjusts size / N / cells-per-row / cell shape / gap.
4. Auto-pick on first material-load AND whenever user clicks
   "auto-pick"; otherwise the picker is whatever the user left it as.
5. POST creates a `tests` row with `kind=validation` and the existing
   shape, plus a new `validation_cells_json` column listing
   `[{ palette_entry_id, expected_hex, expected_lab, params }, …]`
   in the order they will burn (= L*-sorted).

**xcs generation:**
1. Builder reads `kind`. If `validation`, it iterates
   `validation_cells_json` instead of doing the sweep math.
2. Each cell gets the entry's stored `params_json` (power, speed,
   freq, pulse_width, density, passes) — same shape the sweep uses,
   just per-cell instead of per-axis.
3. Output is a single `.xcs` with N cells, fiducials, axis-label
   suppressed (no axis to label).

**Photo upload + ingest:**
1. Existing capture pipeline runs unchanged — fiducials → homography →
   warped → cell extraction → aggregator.
2. The result endpoint joins each measured cell back to its
   `palette_entry_id` (cell index → `validation_cells_json[i]`) and
   computes `delta_e_76(measured_lab, expected_lab)`.
3. `result_swatches` rows gain new nullable columns
   (`expected_lab_l/a/b`, `delta_e`, `palette_entry_id`). The hex
   form of the expected colour is derivable on the frontend from
   `expected_lab_*`; we don't store it twice. For sweep tests these
   columns stay null.

ΔE is computed with **ΔE76** (Euclidean Lab) for both selection and
report. Cheap, deterministic, consistent across the two surfaces;
matches the threshold defaults the user sees ("3.0 ΔE = noticeable").

**Result modal (kind-aware):**
- Top instrument strip gains a fourth readout: `median ΔE`.
- Each `SwatchTile` becomes a *paired* tile when `expected_hex` is
  present: split horizontally — top half measured, bottom half
  expected — with `ΔE` printed in the caption strip and a coloured
  ring when it crosses the threshold.
- A summary line above the grid: `12 cells · median ΔE 1.4 · 2 over
  threshold (>3.0)` and a slider to adjust the threshold live (UI
  only — no recompute).

## Database changes

Per CLAUDE.md the SQLAlchemy models in `src/xcs_gen_web/models.py` are
the source of truth; `alembic revision --autogenerate` produces the
migration. The model edits are:

`Test` gains:
- `kind: Mapped[str]` — server-default `'sweep'`, NOT NULL
- `validation_cells_json: Mapped[str | None]` — nullable text

`ResultSwatch` gains (all nullable, populated only on
`kind='validation'` results):
- `palette_entry_id: Mapped[int | None]` — FK to `palette_entries.id`,
  ON DELETE SET NULL (palette entries can be removed without
  cascading the validation history)
- `expected_lab_l/a/b: Mapped[float | None]`
- `delta_e: Mapped[float | None]`

`validation_cells_json` is a small list — at most a hundred entries —
so JSON is a fine fit (legacy precedent in `params_json`). Per the
"avoid JSON blobs in SQL" guidance: this is a frozen snapshot read
back together as a unit, never queried column-wise, so JSON is
appropriate. A normalised `validation_cells` table would buy us
nothing.

**CI:** the migration's revision number must be hardcoded into the
matching CI assertion in `.github/workflows/ci.yml` in the same
commit (per CLAUDE.md).

## Components touched

- `src/xcs_gen_web/models.py` — new columns
- `alembic/versions/NNNN_validation_kind.py` — schema migration
- `src/xcs_gen_web/repositories/tests.py` — kind-aware create / get
- `src/xcs_gen_web/services/xcs.py` — branch on `kind` for cell list
- `src/xcs_gen_web/services/capture.py` — populate validation columns
  on swatch insert when source test is `kind=validation`
- `src/xcs_gen_web/app.py` — endpoint surface unchanged; expose `kind`
  in test responses
- `web/src/types.ts` — `kind`, `validation_cells`, expected/delta
  fields on swatch
- `web/src/components/MaterialPalettePicker.tsx` — new (grid +
  scatter)
- `web/src/components/ParamTestEditor.tsx` — `kind`-aware tab list:
  `palette` replaces `sweep` when `kind === 'validation'`
- `web/src/pages/TestDetailPage.tsx` — surface a `kind` selector
  (probably top-of-page, alongside the existing locked / status
  badges) on a fresh test
- `web/src/pages/TestsPage.tsx` — "New test" → choose kind first
- `web/src/components/ResultDetailDialog.tsx` — kind-aware tile +
  summary
- `web/src/svg/colorSelection.ts` — new module: pure FPS implementation
  on Lab arrays; unit-testable without DOM

## Out of scope (stage 1)

- Generating a NEW palette from scratch (the "material test" the user
  mentioned — that's stage 2)
- ΔE2000 calculation
- Validation runs on a *subset* of palette swatches that don't all
  share a material (cross-material checks)
- Auto-recommending which palette swatches to drop based on
  validation failures
- "Pin to validation result X" workflow that ties a palette state to
  a known-good measurement

## Open trade-offs accepted

- The picker shows L* via the swatch tile's own colour (it IS the
  swatch). Not a separate L* badge. If two near-identical-hue swatches
  at very different L* both get auto-picked, the scatter dots overlap;
  the grid still distinguishes them. Acceptable.
- Validation tests can be retested (new burn, new upload) like any
  other test. The "expected" stays the same (it's the palette
  snapshot at validation-creation time, not live-updating). If the
  palette gets re-ingested between validation runs, validation #2
  still compares against the originally-frozen expected. This is
  intentional — re-ingesting the palette mid-validation would
  invalidate the comparison.
