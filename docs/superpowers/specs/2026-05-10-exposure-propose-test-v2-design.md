# Exposure — Propose Test v2

**Status:** design / not yet implemented
**Date:** 2026-05-10
**Predecessor:** `2026-05-10-exposure-propose-test-design.md` (v1, shipped in PR #85)

## Goal

Refine the propose-test wizard so the user can edit *all* base params (not just the varied one), giving them a way to "rotate" the curve or "skew" the test region. Replace the fill-mode's forward-grid sampler with a polygon-area-uniform sampler + numerical inverse-solver so a 16-cell fill actually places 16 cells in a region instead of clustering on the reachable subset of the param grid. Polish two small UX issues from the v1 walkthrough: the toolbar chip should toggle to "CANCEL" while the wizard is open, and the draw-mode hint banner should be clickable to close the polygon once it has 3+ vertices.

## Non-goals (v2)

- 3+ varied params.
- Editing pulse_width / passes as *varied* params (still off the testable list).
- Inverse colour modelling (still bivariate-only, index × index).
- Saved polygon presets / re-running propose-test from an existing test.
- Showing a "reachable region" overlay on the chart (option C in the brainstorm — explicitly deferred to v3 if needed).

## User flow (changes only)

1. **Toolbar chip toggles label.** From the moment the user clicks `◇ PROPOSE TEST`, the chip's text and styling become `× CANCEL` (orange, active). Stays as CANCEL through both `drawing` and `panel` modes. Click CANCEL at any point → discards polygon, exits the wizard.
2. **Draw-mode hint banner is clickable once polygon has 3+ vertices.** Banner text progression:
   - 0 vertices (initial): "Click vertices · ENTER or double-click to close · ESC cancels"
   - 1–2 vertices: "Click N more vertices · ESC cancels"
   - 3+ vertices: "✓ Click here to finish · ENTER or double-click also works · ESC cancels" — pointer cursor, clicking calls `onClose` (same as Enter).
   Below 3 vertices, the banner is non-interactive (cursor: default, slightly dimmed).
3. **Anchor row shows entries-inside-polygon count.** While drawing (3+ vertices) and while the rail is open, the anchor section displays the auto-picked entry's hex AND a count of how many palette entries are inside the polygon. Lets the user see what the fill is aware of.
4. **Wizard rail has a 6-row PARAMS editor.** All laser params (`power, speed, frequency, density, passes, pulse_width`) appear as editable sliders with numeric readouts. The currently-varied param row(s) are visually locked, with the resolved min..max highlighted on the slider track. Non-varied rows are draggable — adjusting them re-runs curve / fill computation live; the curve "rotates" or fill region shifts.
5. **Fill mode produces N evenly-distributed cells in the polygon.** Where v1 produced fewer than N when the (p1, p2) forward grid didn't cover the polygon evenly, v2 samples directly in (x, y) polygon space and inverse-solves the params. Cells are placed to avoid existing palette entries inside the polygon.

## Architecture

### Frontend changes

```
web/src/components/exposure/
  proposeTestMath.ts                     // ADD: partialDerivative, inverseSolve,
                                          //      samplePolygonArea, fillByInverseSolve
  proposeTestMath.test.ts                // ADD: tests for the new helpers
  ExposureProposeRail.tsx                // CHANGE: 6-row PARAMS editor, paramOverrides
                                          //         prop, entriesInsidePolygon prop,
                                          //         lock-the-varied-row UI
  ExposureProposeRail.test.tsx           // ADD: rail-level component tests for the editor
  ExposureToolbar.tsx                    // CHANGE: chip text "PROPOSE TEST" ↔ "CANCEL"
                                          //         based on proposeOpen
```

```
web/src/pages/
  ExposurePage.tsx                       // CHANGE: paramOverrides state, effective params
                                          //         feeding curve/fill, entries-inside count
                                          //         passed to rail, banner click handler
```

`fillByForwardGrid` stays in `proposeTestMath.ts` as legacy (deprecated). The page's call site swaps to `fillByInverseSolve`. We can delete the old function in a follow-up sweep.

### `partialDerivative` (new)

Takes `(indexKey, paramKey, currentParams) → number`. 42 cases — 7 indices × 6 params — most of which are zero (the index doesn't depend on that param). Implement as a switch-table on `indexKey`, with an inner switch on `paramKey`. The non-zero cases are simple ratios derived from the v3 formulas.

Example (TEi = power × density × passes / speed):

```ts
case "total_exposure_index":
  switch (paramKey) {
    case "power":     return density * passes / speed;
    case "density":   return power * passes / speed;
    case "passes":    return power * density / speed;
    case "speed":     return -power * density * passes / (speed * speed);
    case "frequency": return 0;
    case "pulse_width": return 0;
  }
```

Sanity-tested against finite differences (`(I(p+ε) - I(p)) / ε`) within `1e-4`.

### `inverseSolve` (new)

```ts
function inverseSolve(
  target: { x: number; y: number },
  varyParams: readonly [ParamKey, ParamKey],
  baseParams: LaserParams,        // includes anchor's overrides
  xKey: IndexKey,
  yKey: IndexKey,
  laserLimits: LaserLimits,
): LaserParams | null
```

Newton iteration:

```
params = { ...baseParams }
for iter in 0..20:
  current = computeIndices(params)
  residual = (current[xKey] - target.x, current[yKey] - target.y)
  if |residual| < 1e-6: return params
  J = [[∂I_x/∂p1, ∂I_x/∂p2], [∂I_y/∂p1, ∂I_y/∂p2]]
  detJ = J[0][0]*J[1][1] - J[0][1]*J[1][0]
  if |detJ| < 1e-12: return null  // singular — degenerate axis pair
  Jinv = [[J[1][1], -J[0][1]], [-J[1][0], J[0][0]]] / detJ
  delta = Jinv · residual
  params[p1] -= delta[0]; params[p2] -= delta[1]
  if any param out of laserLimits: return null  // unreachable target
return null  // didn't converge
```

After convergence: snap `pulse_width` to its preset list, round `passes` to nearest integer, all clamped to laser limits. If any clamp is non-trivial (i.e. > step away from the snapped value), reject the candidate.

### `samplePolygonArea` (new)

Poisson-disk-style rejection sampling.

```ts
function samplePolygonArea(
  polygon: Polygon,
  n: number,
  knownPoints: ReadonlyArray<{ x: number; y: number }>,
  minDist?: number,                          // optional override
): Array<{ x: number; y: number }>
```

Behaviour:
- Compute polygon bbox.
- Default `minDist = sqrt(polygonArea / (n + knownPoints.length)) × 0.6`. (Empirical — gives clean spacing without rejecting too many.)
- Generate up to `30 × n` candidates via uniform-bbox-rejection. Accept a candidate if:
  - It's inside the polygon (`pointInPolygon`).
  - It's farther than `minDist` from every accepted candidate AND every known point.
- If after the candidate budget we have fewer than n accepted, halve `minDist` and retry once.
- Return what we have (≤ n).

Polygon area via shoelace formula. Uniform random in bbox via `Math.random() * (maxX-minX) + minX` etc.

### `fillByInverseSolve` (new)

Orchestrator. Replaces `fillByForwardGrid` at the page-level call site.

```ts
function fillByInverseSolve(
  baseParams: LaserParams,                       // anchor + paramOverrides
  varyParams: readonly [ParamKey, ParamKey],
  polygon: Polygon,
  xKey: IndexKey,
  yKey: IndexKey,
  laserLimits: LaserLimits,
  n: number,
  knownPoints: ReadonlyArray<{ x: number; y: number }>,
): FillCell[]
```

Flow:
1. `targets = samplePolygonArea(polygon, n, knownPoints)` — gets up to n candidate (x, y).
2. For each `target` in `targets`:
   ```
   solved = inverseSolve(target, varyParams, baseParams, xKey, yKey, laserLimits)
   if solved is null: continue
   actual = computeIndices(solved)  // double-check params land near target
   cell = { paramValues: { [p1]: solved[p1], [p2]: solved[p2] }, x: actual[xKey], y: actual[yKey] }
   accept cell
   ```
3. Return the accepted cells. The cell's `(x, y)` is the actually-resolved location after rounding/snapping, not the originally-sampled target. Visually this is fine since it's within rounding of target.

If `n` cells accepted: done. Otherwise return what fits — the rail surfaces the partial fill via `helperText`.

### `ExposureProposeRail` PARAMS editor

The 6 rows replace the previous slim "Cells · N" + "Range" sections:

```
PARAMS
  POWER       [▒░░░░░░░░░░ 14.6 %]   ← editable slider, 1-100
  SPEED       [▒░░░░░░░░░░ 1152 mm/s] ← editable slider, 2-15000
  FREQ        [▒░░░░░░░░░░ 113 kHz]   ← editable slider, 60-500
  DENSITY     [▒░░░░░░░░░░ 5000 lpc]  ← editable slider, 1-5000
  PASSES      [▒░░░░░░░░░░ 1]         ← editable, integer step, 1-99
  PULSE_W     [▒░░░░░░░░░░ 200 ns]    ← editable, snaps to ALLOWED_PULSE_WIDTHS
```

When a row is the *varied* param (curve mode) or one of the *varied pair* (fill mode):
- Slider thumb hidden.
- Track shows the resolved min..max as a coloured band (visual highlight only).
- Value shows "min → max unit" instead of a single value.
- `aria-disabled="true"`.

Cell count slider stays — placed below the PARAMS section.

### `ExposureToolbar` chip toggle

Existing prop `proposeOpen: boolean` already drives active styling. Extension: when `proposeOpen` is true, also flip the chip's text:
- `proposeOpen === false`: `◇ PROPOSE TEST`
- `proposeOpen === true`: `× CANCEL`

Disabled-because-univariate state stays unchanged (overridden tooltip).

## Data flow

```
polygon + entries → entriesInsidePolygon (live derivation, used by both anchor display + fill knownPoints)
anchor + paramOverrides → effectiveParams (live derivation, fed to curve/fill math)
varyParams + effectiveParams + polygon + entriesInsidePolygon → preview cells
```

`paramOverrides` is a `Partial<Record<ParamKey, number>>` on the page state. Empty by default. The rail's PARAMS editor calls `onParamOverrideChange(paramKey, value)` which sets/clears entries. Resetting via the wizard's CANCEL clears `paramOverrides`. Switching the varied param chip clears any override on the now-varied row (a varied row's value is dictated by sampling, not user-set).

The CREATE payload uses `effectiveParams` as `base_params`, with the varied-param's per-cell value overridden in `validation_cells`. Same shape as v1.

## Edge cases

| Case | Handling |
|---|---|
| User adjusts a param while the curve/fill is computing | Memoised pure-function chain re-runs only what's downstream of the changed input. Instant feedback. |
| User edits the varied param's row (locked) | The slider has `aria-disabled` + hidden thumb. The change handler is unbound. Defensive: if somehow called, ignored. |
| User flips the varied param chip | The previously-varied row becomes editable, restored to the anchor's value (or the override if user previously set one). The newly-varied row becomes locked. |
| Polygon < 3 vertices | Rail content + curve/fill not computed (same as v1). Banner is non-interactive (cursor: default). |
| Polygon has 0 entries inside | `entriesInsidePolygon = []`. Anchor row shows "0 entries inside polygon". CREATE disabled with "Polygon contains no entries — draw around at least one." (same as v1). |
| Inverse-solve fails to converge for a sampled point | Discard, sample another. If too many failures (e.g. < N converge after sampling 30 × N candidates), return what fits with partial-fill helper text. |
| Inverse-solve produces params outside laser limits | Discard, sample another. |
| Param edit pushes computed indices through a zero-divisor in `computeIndices` | The TS port already throws, caught at the call site (`continue`). User sees the cells re-render without that target. |
| Pulse_width edited to a non-preset value | Slider snaps to nearest preset on commit. |
| User cancels mid-edit | All wizard state (polygon, paramOverrides, varyParams override, cellCount) cleared. |
| `entriesInsidePolygon` recomputes on each render | Memoised on `[polygon, displayRows, xKey, yKey]`. |

## Testing strategy

### Unit tests (proposeTestMath.test.ts)

```
partialDerivative
  - matches finite-difference numerical derivative within 1e-4 for all 42 (idx, param) pairs over a battery of param combos
  - returns 0 for params the index doesn't depend on (PSm × power → 0, LSm × speed → 0, etc.)

inverseSolve
  - varying (power, speed) targeting a reachable (TEi, PIi) → converges to params that produce the target within 1e-6
  - degenerate pair (same param affects only one axis) → returns null
  - unreachable target (would need speed > 15000) → returns null after one of the iterations clamps fail
  - 20-iter cap → returns null when residual stays large

samplePolygonArea
  - returns ≤ n points, all inside the polygon
  - all points respect minDist from each other AND from knownPoints
  - sparse polygon (n too large) → relaxes threshold once, returns < n
  - empty knownPoints works
  - convex/concave polygons both supported

fillByInverseSolve
  - returns up to n cells, all inside the polygon, with valid params
  - knownPoints (existing entries) are avoided
  - degenerate pair (e.g. (speed, density) targeting (PSm × LSm)) → returns subset / empty (depending on polygon)
  - matches forward indices: for each returned cell, computeIndices(cell.paramValues + base) ≈ (cell.x, cell.y)
```

### Component tests (ExposureProposeRail.test.tsx)

```
- renders 6 PARAMS rows with slider + value
- varied-param row is aria-disabled, shows min → max range
- adjusting a non-varied row calls onParamOverrideChange with new value
- pulse_width slider snaps to ALLOWED_PULSE_WIDTHS preset values
- passes slider snaps to integers
- entriesInsidePolygon count is displayed in the Anchor section
- existing tests (mode toggle, chip group, CREATE/CANCEL) still pass
```

### Browser walkthrough

```
- Click ◇ PROPOSE TEST → chip becomes × CANCEL (visual)
- Draw 4 vertices → banner progresses 4→3→2→1→"Click here to finish"
- Click banner → wizard rail opens (matches Enter behaviour)
- Verify all 6 PARAMS rows visible; varied row (e.g. POWER) locked with range band
- Drag SPEED slider → curve cells re-render in real time
- Drag DENSITY slider → curve "rotates" through different region
- Switch to FILL mode (2 chips) → 16 cells appear filling the polygon
- Verify cells avoid existing palette entries (visually distinct)
- Move PASSES slider → cell positions shift live
- Click CREATE TEST → test created, navigate to /tests with new test
- Reload, click PROPOSE again → chip cycle works, no stale state
```

## Out of scope (deferred to v3)

- Reachable-region overlay on the chart.
- Multi-anchor support (currently one auto-picked centroid-nearest entry).
- Exporting / saving polygon as a reusable selection.
- Inverse modelling for univariate (colour-target) mode.
