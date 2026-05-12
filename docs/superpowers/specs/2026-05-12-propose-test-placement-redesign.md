# Propose-test placement: forward-sampling redesign

**Date:** 2026-05-12
**Status:** Approved (algorithm + UI shape signed off by user)

## Problem

The Exposure page's propose-test "fill" mode is unreliable: it asks for `n` cells, often returns 30-50% fewer, and clusters samples poorly across the drawn polygon. To work around it, users have to inflate the request count until the actual return hits the desired number.

Root causes in the current `fillByInverseSolve` pipeline:

1. **Rejection-sampling failure.** `samplePolygonArea` picks `n` target points in `(xKey, yKey)` space inside the polygon using a Poisson-disk-ish loop. With a tight budget, anisotropic polygons, or many "known points" to avoid, it exhausts the budget without filling and falls back to a single half-threshold retry.
2. **Newton-Raphson failure.** For each target, `inverseSolve` runs a 2×2 Newton iteration on the chosen `(p1, p2)` pair. When the Jacobian is ill-conditioned (e.g. `(freq, speed)` against `(TEi, PIi)` has `∂PIi/∂speed = 0`), or the step crosses a laser limit, the solve returns null and the cell is dropped.
3. **Two-param ceiling.** The fill mode only varies two parameters. `passes`, `pulse_width`, `crosshatch`, and the other primary params are fixed to the anchor's values, so propose-test can't explore the full recipe space the user wants.

## Goals

- **Reliable cell count.** When the user asks for `n`, the algorithm returns `n` cells whenever the active constraints + polygon permit any valid recipe at all.
- **Full param-space variation.** Every numeric param (`power`, `speed`, `frequency`, `density`, `pulse_width`, `passes`) plus `crosshatch` can vary per cell. The user pins variables via existing CONSTRAINTS (eq filter clauses, min/max overrides).
- **Coverage of the polygon.** Sample positions distribute evenly across the polygon's `(xKey, yKey)` interior rather than clustering.
- **Crosshatch / passes feasibility-aware.** A candidate's crosshatch and passes affect the computed `(xKey, yKey)`. Only accept candidates whose **resulting** `(xKey, yKey)` lands inside the polygon — never apply a varied crosshatch/passes "blind".

Non-goals:

- Replacing curve mode. Curve mode (vary one param along arc-length) is unchanged.
- Persisted preferences for which params to vary. Existing CONSTRAINTS state is enough.
- Multi-objective optimisation (e.g. "spread across polygon AND maximise param diversity"). The downsample step optimises only `(x, y)` coverage.

## Approach: forward-sample → polygon-filter → farthest-point downsample

The redesign inverts the data flow:

```
old:  pick points in (x,y) inside polygon  →  inverse-solve for (p1,p2)
new:  draw params from constraint hypercube → compute (x,y)
       → keep those inside polygon → farthest-point downsample to n
```

### Algorithm steps

1. **Sample `N = max(50 × n, 1000)` candidates** from the param-space hypercube defined by the active constraints:
   - Continuous params (`power`, `speed`, `frequency`, `density`) → uniform on `[effectiveMin, effectiveMax]`, snapped to the param's integer step.
   - `pulse_width` → uniform pick from `ALLOWED_PULSE_WIDTHS.filter(v => v >= effectiveMin && v <= effectiveMax)` (uniform across presets in range, not uniform on the real line then snapped — `ALLOWED_PULSE_WIDTHS` is logarithmic-ish so the latter would over-sample large values).
   - `passes` → uniform integer in `[passesMin, passesMax]` (default `[1, 4]`, surfaced as a slider on the rail).
   - `crosshatch` → Bernoulli(0.5) when "varies"; constant when forced on/off.
   - "Pinned" params (eq filter clauses, or min == max) are constants, not sampling dimensions.
2. **Compute indices and filter to polygon.**
   For each candidate, call `computeIndices(params, { crosshatch })`. Drop the candidate if:
   - `computeIndices` throws (e.g. divide-by-zero with a degenerate param).
   - The candidate's `(xKey, yKey)` is not strictly inside the user's polygon (`pointInPolygon`).
3. **Farthest-point downsample to `n`.**
   Pick the first survivor at random. Iteratively add the survivor whose minimum distance (normalised by polygon bbox) to the already-picked set is largest. Stops after `n` picks. If `survivors < n`, returns all survivors and the page surfaces a feedback message.
4. **Sort by L\* for burn order** (existing behaviour from `handleCreateTest`).

### Cell shape

`FillCell` already carries `paramValues: Partial<Record<ParamKey, number>>` plus `(x, y)`. Widen the type so callers can also persist the per-cell `passes` and `crosshatch`:

```ts
interface FillCell {
  paramValues: Partial<Record<ParamKey, number>>;
  passes?: number;          // present when passes varies per cell
  crosshatch?: boolean;     // present when crosshatch varies per cell
  x: number;
  y: number;
}
```

`handleCreateTest` already merges `cell.paramValues` into the full recipe; extend the merge to include `passes` and `crosshatch` when present. The validation-cells API already takes arbitrary `{[k]: v}` for `params`, so the schema is a no-op.

## UI changes (`ExposureProposeRail.tsx`)

### Mode toggle

- **Curve** — unchanged: vary one param along the polygon's arc-length.
- **Fill** — new behaviour: forward sample. The current 2x2 VARY pill grid gets removed in this mode; per-param pinning happens via CONSTRAINTS (existing surface).

### New crosshatch / passes controls inside CONSTRAINTS

Two new rows in the CONSTRAINTS section:

```
CROSSHATCH      [varies] [on] [off]      tri-state pill
PASSES          [min □] – [max □]        2 number inputs
```

Defaults: crosshatch `varies`, passes `1 – 4`. When passes `min == max`, passes is pinned. When crosshatch is forced on/off, it's pinned.

### Cell-count feedback

Below the existing cell-count slider, a status line:

- All `n` placed: nothing extra.
- Partial (`survivors < n`): `Found {survivors}/{n} cells. Widen {paramName} to reach more.` Picks the param whose effective range is narrowest relative to its machine limit.
- Empty (`survivors == 0`): `No cells reachable. Try widening constraints or redrawing the polygon.`

The hint never lies — it computes from the actual sample, not assumed bottlenecks.

### Optional: rejected-sample overlay

Off by default. When toggled on, the chart paints rejected candidates as muted grey dots — gives immediate visual feedback that the param space is mapping to a non-polygon region.

## File layout

| File | Change |
|---|---|
| `web/src/components/exposure/proposeTestMath.ts` | New: `sampleParamHypercube`, `farthestPointDownsample`, `fillByForwardSample`. Keep `inverseSolve` and `fillByInverseSolve` for curve-mode adjacent use (delete in a later cleanup PR). |
| `web/src/components/exposure/ExposureProposeRail.tsx` | New crosshatch tri-state + passes range inside CONSTRAINTS. Remove the four VARY pills in fill mode (or repurpose as "pin to anchor"; default is delete). Cell-count feedback line. |
| `web/src/pages/ExposurePage.tsx` | Swap `fillByInverseSolve` → `fillByForwardSample` in the preview pipeline. State for `passesMin`, `passesMax`, `crosshatchOverride: "varies" \| "on" \| "off"`. Plumb through to the rail + the algorithm. |
| `web/src/components/exposure/proposeTestMath.test.ts` | New tests for the three helpers. |
| `web/src/components/exposure/ExposureProposeRail.test.tsx` | Update to test the new controls. |

## Tests

- **`sampleParamHypercube`** — respects step/preset for each param; honours min == max as a pinned constant; emits the right shape (`{params, passes, crosshatch}`); when crosshatch is forced, every sample has the same value.
- **`farthestPointDownsample`** — pure helper, easy to test on synthetic point clouds: K of N points returned, first pick is deterministic given a seed, distance is bbox-normalised.
- **`fillByForwardSample`** — given a fixture polygon (a simple rectangle in `(TEi, PIi)` space, machine limits as constraints), returns `n` cells when achievable; the resulting `(x, y)` points have spread ≥ 80% of the polygon's bbox extent on each axis after farthest-point downsampling.
- **End-to-end on a degenerate polygon** (tiny region near a corner of the param space) — algorithm returns survivors < n and reports the bottleneck param.

## Edge cases

- **`pulse_width` collisions.** Two samples may snap to the same preset. The downsample step picks one survivor per `(x, y)` cluster, so duplicates wash out naturally.
- **Empty intersection.** Zero survivors → `ExposurePage` shows the "No cells reachable" feedback line; cell preview stays empty; `Create test` button stays disabled (matches today's behaviour via `canCreate`).
- **Crosshatch interaction.** `computeIndices` already factors crosshatch into `TEi`, `AAi`, `DSi` (doubled effective passes). The forward-sample loop passes `{ crosshatch }` to `computeIndices` directly; no extra accounting needed.
- **Passes range bounds.** Default `[1, 4]` keeps the sampling bias tight. The slider's max is `99` (machine limit); users widen explicitly.
- **MRU integration.** Existing exposure-filter MRU continues to feed CONSTRAINTS when "Use active filters" is on; no change.

## Migration

No persisted-state migration needed. CONSTRAINTS shape is the same; only the consumer (the algorithm) changes. Curve mode is untouched. Validation cells created by the new algorithm carry full recipes already (from the earlier per-cell-recipe PR), so test detail / .xcs generation downstream is unaffected.

## Out of scope

- Auto-picking the "best" two params for ill-conditioned axes. The forward-sample approach makes this moot.
- Surfacing `pulse_width` overrides on the rail. Pulse width pins via the existing min/max inputs already.
- Reworking curve mode.
