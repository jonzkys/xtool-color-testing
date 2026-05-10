# Exposure — Propose Test

**Status:** design / not yet implemented
**Date:** 2026-05-10
**Author:** brainstorming session, executed via `superpowers:brainstorming`

## Goal

Let the user draw a region of interest on the bivariate exposure scatter and have the workbench produce a ready-to-burn validation test that places N cells inside the drawn polygon. The wizard infers everything it can (anchor, varied params, ranges) so the user only adjusts what they care about: the polygon, the varied param(s), and the cell count.

The output is a `kind="validation"` test ready for `.xcs` generation on the tests page. No new database schema; existing `POST /api/tests` endpoint is sufficient.

## Non-goals (v1)

- Univariate scatter mode (Y axis = colour channel). The wizard is bivariate-only.
- Inverse colour modelling (`#hex → params`). v1 only operates in index × index space.
- Cross-test polygons (drawing in test A's scatter to produce a test referencing test B's data).
- Importing a saved polygon for re-running a similar test on different material.
- Editing the polygon after CREATE — the resulting test is independent of the polygon.

## User flow

1. User on `#/exposure/<material>` in **bivariate mode**. The wizard chip is hidden in univariate mode.
2. Toolbar (after the existing FILTERS pill) gains a new pill **`◇ PROPOSE TEST`**.
3. Click → chart enters **draw mode**:
   - Cursor switches to crosshair on the chart.
   - Existing dot hover/click behaviour suspended.
   - Toolbar pills (Material, Mode, Axes, Filters) disabled with reduced opacity.
4. User clicks vertices on the scatter; each click adds a polygon vertex with a draggable handle. Double-click or Enter closes the polygon. Esc cancels and exits draw mode.
5. The instant the polygon closes:
   - Existing right rail (Stats / Focused / Neighbours / Indices) **slides out**.
   - **Propose Test rail** (~300 px wide) **slides in** in its place.
   - The chart gets a polygon overlay (filled, dashed stroke, draggable vertices) and a curve/cell overlay derived from current wizard state.
6. The wizard rail computes everything live as the user adjusts:
   - **Anchor (auto, fixed):** existing palette entry inside polygon closest to polygon centroid (Euclidean in current axis units).
   - **Mode toggle:** `CURVE | FILL`. Smart-defaulted on open. User can override.
   - **VARY chip group:** `POWER` / `SPEED` / `FREQUENCY` / `DENSITY`. Each chip carries a live sub-label noting which axes it moves given the current X/Y axis selection (e.g. `SPEED · moves X`, `POWER · moves both`). In CURVE mode the group is radio (1 selected); in FILL mode it is multi-select clamped to exactly 2.
   - **CELLS slider:** range 2 → 200, default 16. Live updates the cell preview on the chart.
   - **Range readout:** for each varied param, "PARAM · min → max unit" and total cell count.
   - **CREATE TEST button:** primary CTA, disabled with helper text under conditions detailed in Edge cases.
7. Click CREATE → `POST /api/tests` with the validation-cell payload → on success, navigate to `#/tests?new=<id>`.
8. The Tests page reads `new=<id>` from the hash, scrolls the new row into view, and applies a brief highlight (~2 s) before stripping the param.

### Cancel paths

- Esc, click the `◇ PROPOSE TEST` chip again, or click outside the polygon during draw → cancels, polygon clears, rail closes, scatter returns to normal mode.
- Switching scatter mode (univariate ⇄ bivariate), X/Y axis, or material while the rail is open → polygon clears, rail closes. Toast: "Polygon cleared — axes changed." (See Edge cases.)
- Clicking a palette dot while in draw mode → consumed as polygon vertex (does NOT focus the entry).

## Architecture

### Frontend

```
web/src/components/exposure/
  ExposurePolygonDraw.tsx        // capture click-to-draw on scatter; emits polygon vertices in (xKey, yKey) units
  ExposurePolygon.tsx            // renders the closed polygon overlay (fill + dashed stroke + draggable vertices)
  ExposureProposeRail.tsx        // the rail panel: anchor, mode toggle, chip group, slider, ranges, CREATE
  ExposureCellsPreview.tsx       // overlays the curve (if curve mode) and the N proposed cells
  proposeTestMath.ts             // pure functions, exhaustively unit-tested
  proposeTestMath.test.ts
```

`proposeTestMath.ts` exports:

```ts
type RGB = readonly [number, number, number];
type IndexKey = "pulse_spacing_mm" | "line_spacing_mm" | "pulse_energy_index"
              | "pulse_intensity_index" | "total_exposure_index"
              | "ablation_aggression_index" | "delivery_smoothness_index";
type ParamKey = "power" | "speed" | "frequency" | "density";
type Polygon = ReadonlyArray<readonly [number, number]>;

function pointInPolygon(p: readonly [number, number], polygon: Polygon): boolean;

function findAnchor(
  polygon: Polygon, rows: readonly ExposureRow[], xKey: IndexKey, yKey: IndexKey,
): ExposureRow | null;

function computeCurve(
  anchor: ExposureRow, varyParam: ParamKey, xKey: IndexKey, yKey: IndexKey,
  laserLimits: LaserLimits,
): Array<{ paramValue: number; x: number; y: number }>;

function clipPolylineToPolygon(
  polyline: ReadonlyArray<{ x: number; y: number }>,
  polygon: Polygon,
): Array<Array<{ x: number; y: number }>>;

function sampleByArcLength(
  segment: ReadonlyArray<{ x: number; y: number; paramValue: number }>,
  n: number,
): Array<{ paramValue: number; x: number; y: number }>;

function pickModeAndParams(
  anchor: ExposureRow, polygon: Polygon, xKey: IndexKey, yKey: IndexKey,
  laserLimits: LaserLimits,
): { mode: "curve"; varyParam: ParamKey } | { mode: "fill"; varyParams: [ParamKey, ParamKey] };

function fillByForwardGrid(
  anchor: ExposureRow, varyParams: [ParamKey, ParamKey],
  polygon: Polygon, xKey: IndexKey, yKey: IndexKey,
  laserLimits: LaserLimits, n: number,
): Array<{ paramValues: { [k in ParamKey]?: number }; x: number; y: number }>;
```

`ExposureScatter` gets four new optional props:

- `polygon: Polygon | null`
- `polygonDrawing: boolean` (toggles cursor, suppresses dot hover/click)
- `curve: ReadonlyArray<{ x: number; y: number }> | null`
- `cells: ReadonlyArray<{ x: number; y: number; paramValues?: object }> | null`

`ExposureToolbar` gets one new chip: `◇ PROPOSE TEST` with active/inactive states.

`ExposurePage` orchestrates wizard state:

```ts
type ProposeMode = "off" | "drawing" | "panel";
interface ProposeState {
  mode: ProposeMode;
  polygon: Polygon;                            // empty until drawn
  modeOverride: "auto" | "curve" | "fill";     // user toggle in rail
  paramOverride: { mode: "curve"; varyParam: ParamKey }
               | { mode: "fill"; varyParams: [ParamKey, ParamKey] }
               | null;                          // null = use smart default
  cellCount: number;                           // 2..200, default 16
}
```

Right rail content swaps based on `mode`:
- `off` → existing Stats / Focused / Neighbours / Indices.
- `drawing` → existing rail unchanged (no polygon yet).
- `panel` → `ExposureProposeRail`.

### Frontend port of laser-index formulas

`web/src/laser/laserIndices.ts` ports `xcs_gen.laser_indices.compute_indices` to TypeScript. Required because curve / fill computation must run live as the user drags the slider — round-tripping to a backend endpoint per slider tick is unworkable.

The TS port is a near-line-for-line translation of the seven formulas with `formula_version=3` hardcoded. A FE↔BE fixture verification test (`web/src/laser/laserIndices.test.ts`) imports a JSON fixture generated by the Python implementation across a battery of representative param combinations and asserts the TS output matches within `1e-6` per field. The fixture lives in `web/src/laser/__fixtures__/laser-indices-v3.json` and is regenerated by `scripts/regen-laser-indices-fixtures.py` (new) any time the Python formulas change.

**Field-naming note:** `BaseParams` (web schema) uses `passes` and `pulse_width`; `ProcessingParams` (xcs_gen domain) uses `repeat` and `pw`. The TS port operates on the `BaseParams` shape — its inputs are `power, speed, frequency, density, passes, pulse_width` — and the formulas use those names internally. The cross-language fixture generator emits BaseParams shape on both sides for test-time comparison.

The TS port is the single source of truth for "what's a laser index" on the frontend. Anywhere else that reads pre-computed indices from the backend (e.g. PaletteIndicesChips) keeps using the backend value.

### Backend

No new endpoints. The wizard uses the existing `POST /api/tests` route. The validation-cells path on the backend is already exercised by the existing validation-test creation flow.

The Tests page (`#/tests`) gains one minor capability: read `new=<id>` from the URL hash on mount and scroll/highlight that row briefly. New behaviour, no schema change.

## Data flow

Wizard derivations (recomputed on each render, memoised):

```
polygon + rows + xKey + yKey                    → anchor (ExposureRow | null)
anchor + xKey + yKey + laser limits             → smart-default (mode + varied params)
override + smart-default                        → effective (mode + varied params)
anchor + effective.varyParams                   → curve OR fill grid (forward-computed)
curve + polygon                                 → clippedSegments
clippedSegments + cellCount                     → curve cells (arc-length sampled)
fill grid + polygon + cellCount                 → fill cells (stratified picking)
```

Slider drag re-runs only the last step (`sampleByArcLength` or stratified picking) — O(N) — feels instant. Changing varied param re-runs from `computeCurve` / `fillByForwardGrid` down — still <10 ms for 200 grid samples.

CREATE payload:

```jsonc
POST /api/tests
{
  "name": "Propose · power+density · #cb7983",   // user-editable on next page
  "material_id": <current material>,
  "kind": "validation",
  "spec": {
    "x_param": "power",                          // primary varied param
    "x_min": 12.4,                               // first cell's varied-param value
    "x_max": 18.8,                               // last cell's value
    "x_steps": 16,
    "y_param": null,
    "rows": 1,
    "width_mm": <test-create defaults; user adjustable on test page>,
    "height_mm": <ditto>,
    "base_params": {
      "power": 14.6, "speed": 1152, "frequency": 100,
      "density": 5000, "passes": 1, "pulse_width": 200
    },
    "validation_cells": [
      { "params": { "power": 12.4, "density": 7800 } },
      { "params": { "power": 13.1, "density": 7300 } },
      ...
      { "params": { "power": 18.8, "density": 3000 } }
    ]
  }
}
```

For curve-mode tests, each cell has one varied-param entry; for fill-mode, each has two. Other params come from `base_params` (the anchor's snapshot).

The `x_param`/`x_min`/`x_max`/`x_steps` fields stay populated so the existing capture / sampling layout code (which reads `spec["x_param"]` / `x_min` / `x_max`) doesn't trip on missing values. They describe the primary varied param's range; the secondary varied param (fill mode only) lives only in `validation_cells`.

## Math / algorithms

### `findAnchor`

1. For each row in `rows`, test `pointInPolygon((row.indices[xKey], row.indices[yKey]), polygon)`.
2. If zero rows pass → return `null`.
3. Compute polygon centroid (mean of vertices) in (xKey, yKey) coordinates.
4. Return the inside-polygon row with smallest Euclidean distance to centroid.

### `computeCurve(anchor, varyParam, xKey, yKey, laserLimits)`

1. Determine the param's allowed range from `laserLimits` (e.g. `power: [0, 100]`, `speed: [50, 4000]`, `frequency: [20, 4000]`, `density: [100, 10000]`).
2. Sample 200 equally-spaced points across that range.
3. For each sample, build a `ProcessingParams` from the anchor's params with `varyParam` overridden, and call `computeIndices` (TS port).
4. Project each result to `(x = indices[xKey], y = indices[yKey])`. Skip samples that throw (rare — only when a denominator is zero, which the laser limits already exclude).
5. Return the polyline.

### `clipPolylineToPolygon(polyline, polygon)`

Walk the polyline segment by segment. For each segment, classify both endpoints as `inside` / `outside` via `pointInPolygon`:

- inside-inside → keep entire segment.
- outside-outside → may still cross polygon — find all intersection pairs and keep the inside portions.
- inside-outside or outside-inside → find the single boundary intersection and keep the inside half.

The clipping function returns an array of polyline segments (zero or more), each one entirely inside the polygon.

### `sampleByArcLength(segment, n)`

1. Compute cumulative arc length along the segment (sum of Euclidean distances between successive points).
2. Total length L. Sample at arc-lengths `i/(n-1) * L` for `i ∈ [0, n-1]`.
3. For each target arc-length, linearly interpolate between bracketing polyline points to get `(x, y)` and the corresponding `paramValue`.

### `pickModeAndParams(anchor, polygon, xKey, yKey, laserLimits)`

For each of the 4 testable params:

1. Compute the curve (`computeCurve`).
2. Clip to polygon.
3. Compute the bounding box of the clipped segments in (x, y) space.
4. Score: `min(bbox.width / polygonWidth, bbox.height / polygonHeight)`. A perfect curve through the polygon gives ~1; a degenerate horizontal line gives 0 vertically.

If any param scores ≥ 0.4 → curve mode, that param. (Ties broken in order: power, speed, density, frequency.)

If none → fill mode. Pick two params: one with highest x-spread (axis movement), one with highest y-spread, ensuring they're different. Fall back to (power, speed) as a last resort if no decent pair exists.

### `fillByForwardGrid(anchor, varyParams, polygon, xKey, yKey, laserLimits, n)`

1. Build a 32×32 grid in (varyParams[0], varyParams[1]) space across each param's laser-allowed range.
2. For each grid point, compute (x, y) via the TS port.
3. Filter to those inside the polygon.
4. If filtered count < n → return all of them with a warning to the rail ("Only K cells fit; reduce N or expand polygon").
5. Otherwise sub-sample N via stratified picking: divide the polygon's bbox into ⌈√N⌉ × ⌈√N⌉ sub-cells, pick the candidate closest to the center of each sub-cell, fill any empty sub-cells from a randomised pool of remaining candidates.

This is forward-only (no inverse solving) and produces well-spread cells without numerical fragility.

## Edge cases

| Case | Handling |
|---|---|
| Polygon < 3 vertices (still drawing) | Draw mode stays active; no rail panel yet. |
| Polygon contains 0 palette entries | `findAnchor` returns `null`. Rail renders with CREATE disabled and helper text "Polygon contains no entries — draw around at least one." |
| Anchor's curve / fill grid produces no points inside polygon | Rail shows `RANGE: —` and CREATE disabled with text "Couldn't fit any cells — try a different param or redraw." |
| Selected varied param has zero effect on either chosen axis | Chip greyed with sub-label "no effect on selected axes". Smart default skips it. |
| Curve / fill hits laser limit (computed param out of range) | Param values are pre-clamped to `laserLimits` before forward-computing. Polygon clip happens after. Empty resulting set → as above. |
| User swaps X/Y axis or scatter mode | Polygon coords are in axis-specific units; clearing prevents misrendering. Wizard closes, polygon clears, toast: "Polygon cleared — axes changed." |
| User swaps material | Same — polygon + wizard cleared. |
| User clicks an entry on chart while in draw mode | Click is consumed as polygon vertex. Entry hover/focus suppressed. |
| User Esc / clicks PROPOSE TEST chip again | Cancels, polygon clears, scatter returns to normal mode. |
| User clicks CREATE → backend rejects | Rail stays open, error displayed inline at top with retry button. Polygon preserved. |
| User in fill mode picks two params that are collinear in their effect (e.g. density + passes both X-only) | Smart default avoids this; if user manually selects → fill grid produces a line, not a 2D scatter. Cells still placed honestly. Sub-label warns "selected pair is collinear". |
| Polygon contains 1 entry, fill mode | Anchor = that entry. Fill grid still computes (it's based on params, not on existing entries). |

## Visual design

- Polygon stroke: workshop-instrument primary (red-ish), 2px dashed `4,3` while drawing → solid 2px after close.
- Polygon fill: primary at 13–18% opacity.
- Curve overlay (curve mode): dashed cyan-ish (`stroke-dasharray="3,2"`), 1.4–1.8px.
- Cell markers: filled circles, primary colour, ~5–6px radius (slightly larger than data dots so they read as proposed-cells).
- Hover on a cell marker: tooltip showing the cell's param values (live preview of what's about to be created).
- Polygon vertices: small filled circles, dragging shows a hover indicator.

## Testing strategy

### Unit (`proposeTestMath.test.ts`, `laserIndices.test.ts`)

```
proposeTestMath.test.ts
  pointInPolygon
    - convex polygon, on-edge, outside
    - concave (star-shaped) polygon
  findAnchor
    - multiple inside, picks centroid-nearest
    - 0 inside → null
    - polygon < 3 vertices → null
  computeCurve
    - varies one param, holds others
    - matches Python formula fixture for 20+ param combos
    - clamps to laserLimits
  clipPolylineToPolygon
    - fully inside / fully outside / partial
    - multi-segment (curve enters and exits twice)
  sampleByArcLength
    - even visual spacing on a non-uniform polyline
    - n=2 returns endpoints
    - n=N preserves endpoint values exactly
  pickModeAndParams
    - prefers single-param when one moves both axes ≥0.4
    - prefers power on ties
    - falls back to fill when no single param suffices
    - in fill mode, picks two perpendicular-effect params
  fillByForwardGrid
    - returns N cells inside polygon when grid sufficient
    - returns < N with warning when grid insufficient
    - cells stay within laser limits
    - stratified picking spreads cells across polygon bbox

laserIndices.test.ts
  - matches Python formula fixture line for line for 50+ param combos
  - throws on zero divisors (matches Python error names)
  - formula_version is 3
```

### Component (`ExposureProposeRail.test.tsx`, `ExposurePolygonDraw.test.tsx`)

- Rail renders correct chip group, slider, range readout per state.
- Chip click updates state; mode toggle switches CURVE↔FILL.
- CREATE disabled per edge-case rules with correct helper text.
- Slider drag updates cell count → preview cells in DOM.
- Polygon-draw click sequence emits expected polygon; double-click closes.

### Integration (`ExposurePage.test.tsx`)

- PROPOSE TEST chip toggles draw mode.
- Drawing polygon swaps right rail to wizard panel.
- CREATE click → mocked POST returns id → asserts location.hash becomes `#/tests?new=<id>`.
- Esc / cancel resets all state.

### E2E (Playwright)

```
test "Propose Test happy path"
  navigate #/exposure/1
  click PROPOSE TEST chip → cursor crosshair
  click 4 vertices on scatter → polygon closes
  rail panel visible, anchor populated
  click power chip → curve renders
  drag slider to 24 → 24 cells visible on chart
  click CREATE TEST
  expect URL to be /#/tests?new=<id>
  expect new test row highlighted
  click new test → tests page detail loads
```

## Future directions (out of scope for v1)

- 3-param fill (rare; dramatically more complex inversion).
- Save / load polygon presets as part of the test record.
- "Re-propose" — open the wizard pre-filled from an existing test's params.
- Inverse colour-target mode (univariate, target colour region in L*a*b*).
- Showing predicted (Lab, hex) per cell using the existing palette as a regression source.
- Heat-map of "predicted cell quality" (e.g. mark cells that are far from any existing entry, hence highly extrapolated).
