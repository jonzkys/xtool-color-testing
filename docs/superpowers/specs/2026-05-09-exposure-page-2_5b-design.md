# Exposure Page — Phase 2.5b Enhancements (Design Spec)

**Date:** 2026-05-09
**Status:** Approved (in-conversation); awaiting implementation plan
**Branch:** new branch `feat/exposure-page-2_5b` cut off `feat/exposure-indices-exploration` (or `main` once PR #78 merges).
**Predecessors:**
- Phase 1: `docs/superpowers/specs/2026-05-07-laser-exposure-indices-design.md`
- Phase 2: `docs/superpowers/specs/2026-05-08-exposure-indices-exploration-design.md`
- Phase 2.5a: `docs/superpowers/specs/2026-05-08-combined-indices-design.md`

## Summary

Six enhancements to the exposure exploration page, sequenced so each one is independently shippable but they share infrastructure where it makes sense. Headline change: when a user focuses an entry that came from a parameter sweep, the page now visualises that sweep as a connected trace and offers a one-click filter to "show only this sweep" — turning the dense vertical/horizontal columns flagged in phase 2 review from artefacts into navigable narratives.

The six items, in shipping order:

| Item | Description |
|---|---|
| **D** | Link from focused entry → source test (`#/tests/<id>`) |
| **E** | Default scatter mode → bivariate `(total_exposure × pulse_intensity)` |
| **A** | Recipe-family traces on the scatter (connect dots from one parameter sweep) |
| **C** | "Show only this recipe family" filter on the focused entry |
| **F** | Raw-parameter correlation matrix (toggle alongside the indices matrix) |
| **G** | Nearest-neighbour view (similar colours + similar exposure regimes) |

D and E are trivial; A introduces the **recipe-family** primitive that C reuses; F and G are independent additions that benefit from A's family detection.

## Goals

- A focused entry that came from a parameter sweep visibly belongs to a *trace*, not a static cluster.
- The user can isolate one sweep with one click and see only entries that vary along the sweep's axis.
- The user can jump from a focused entry to its source test page in one click.
- Bivariate mode is the default first impression, since it's the analytically richer view (especially with combined indices on the page).
- The user can answer "is the colour correlated with the raw recipe parameter, beyond what the index already captures?" by switching to a raw-parameter correlation matrix.
- The user can find the closest existing recipe to a target colour, or to a target exposure regime, without clicking through every dot.

## Non-goals

- No new backend endpoints. All six items are frontend-only — they read the same `/api/palette?material_id=` data the page already loads, plus `/api/tests/<id>` for the link target (already exists).
- Phase 3 (calibration) is still deferred. The page makes no claims about physical units beyond what's already framed.
- No multi-material compare. Single-material scope, as in phase 2.
- No "save / pin" persistence for filters or focus. Refresh resets state. (Local-storage persistence is a separate follow-up.)

## D — Link from focused entry → source test

**Surface:** the right-rail Focused card. When the focused entry has a non-null `test_id`, render a small link below the recipe section: `→ Source test #<id>`. Clicking navigates to `#/tests/<id>` via the existing router.

**Empty state:** when `test_id` is null (manual entries), no link renders. Don't show a disabled placeholder — just absent.

**Implementation surface:**
- `ExposureRow` already has `test_id` available indirectly via the API response (`PaletteEntry.test_id`). Add it to the `ExposureRow` interface and project it through `paletteToExposureRow` in `ExposurePage.tsx`.
- `ExposureFocusedCard` gains the link rendering.

## E — Default scatter mode → bivariate

**Change:** in `ExposurePage.tsx`'s state initialisation, set `mode = "bivariate"` (was `"univariate"`), `xKey = "total_exposure_index"`, `yKeyBi = "pulse_intensity_index"`. Keep `xScale = "log"`, add `yScale = "log"` since `pulse_intensity` spans orders of magnitude too.

**Rationale:** the rotated `(total_exposure, pulse_intensity)` axes carry the most information about colour outcomes per phase 2.5a's analysis. New users land on this view and immediately see the cluster structure, then can switch to univariate to drill into specific (index → channel) correlations.

**Stats panel:** the bivariate caveat ("No Y outcome — bivariate r is between two indices, not a fit quality") is already in place.

## A — Recipe-family traces

### A.1 What "recipe family" means

A *recipe family* is a group of palette entries that share **every parameter except one**. The varying axis can be any of: `power`, `speed`, `frequency`, `density`, `passes`, `pulse_width`. A family must have **≥3 members** to render as a trace (fewer is just dots).

A single entry can belong to multiple families (one per varying axis where it has ≥3 siblings). The page is opinionated about which to show — see A.3.

### A.2 Detection algorithm

```typescript
type FamilyKey = `${speed}|${freq}|${density}|${passes}|${pw}`;  // 5 of 6 fixed; varying axis is `power`
// One key per (varying-axis, fixed-tuple) combination.

function buildFamilies(rows: ExposureRow[]): Map<string, FamilyMember[]> {
  // For each row, generate 6 family keys (one per "varying" axis).
  // Group rows by key. Filter to keys with >= 3 members.
  // Return: Map<key, sorted-members-by-varying-value>
}

interface FamilyMember {
  row: ExposureRow;
  varyingAxis: "power" | "speed" | ...;
  varyingValue: number;
}
```

The output is a flat map from family key to ordered members. A row appears in multiple keys (one per axis it has siblings in).

### A.3 Visualisation

**Default state (no focus):** no traces drawn. Just dots. The traces add visual noise in the general overview.

**Focused state (transient or pinned):** find every family the focused entry belongs to. For the **largest** family (most members), draw a thin polyline through the family's points in varying-axis order. Use a 1.2 px stroke in `var(--color-ink-subtle)` at 0.4 opacity — visible enough to read as a line, faint enough to not compete with the dots.

The polyline is rendered *behind* the dots (earlier in SVG document order) so the dots stay legible.

If the focused entry's largest family is < 3 members, no trace draws — focus still works as before.

A small badge appears in the right-rail Focused card under the recipe: `Member of N-entry [Power] sweep` (where `N` is the family size and `[Power]` is the varying axis label). This tells the user a sweep was detected and gives them context for the trace.

### A.4 Edge cases

- **Same row in multiple families:** the page picks the largest. Ties broken by alphabetical varying-axis name (deterministic).
- **Family with only 2 members:** treated as no family. The "varying" axis interpretation is statistically meaningless with 2 points.
- **Family detection cost:** O(N × 6) per material load — N ≈ 1000 entries × 6 axes = 6000 keys, all cheap dict groupings. Memoised on `rows` change.
- **Stale formula version:** rows with `formula_version=0` are still grouped by raw params (the family logic doesn't read indices, only the recipe).

## C — "Show only this recipe family" filter

**Trigger:** in the right-rail Focused card, when a focus is active AND the entry belongs to ≥1 family, show a row of small buttons:

```
FILTER TO SWEEP:  [POWER]  [DENSITY]  [PULSE_WIDTH]
```

(One button per family the focused entry belongs to. Disabled buttons aren't shown.)

**Behaviour:** clicking a button sets a page-state filter `familyFilter = { axis: "power", anchorRowId: focusedId }`. The scatter, hue ribbon, and disc all dim entries that aren't in the filtered family to ~10% opacity (slightly stronger dim than the brush). The correlations matrix recomputes on the visible subset.

**Clear:** a "Clear filter" button replaces the FILTER TO SWEEP row when a filter is active. Clicking it returns to the unfiltered view.

**Material change:** clears the filter (consistent with brush behaviour).

**Interaction with brush:** filter and brush stack — the visible subset is the intersection. Filter is family ∩ brush range.

## F — Raw-parameter correlation matrix

**Surface:** a tab/toggle on top of the existing correlations matrix card:

```
[Indices ⇄ Channels] [Raw params ⇄ Channels]
```

The first tab shows the existing 7×5 matrix (`INDEX_ROWS × CHANNEL_COLS`).

The second tab shows a 6×5 matrix:

| | L\* | a\* | b\* | hue | chroma |
|---|---|---|---|---|---|
| **power** | ... | ... | ... | ... | ... |
| **speed** | ... | ... | ... | ... | ... |
| **frequency** | ... | ... | ... | ... | ... |
| **density** | ... | ... | ... | ... | ... |
| **passes** | ... | ... | ... | ... | ... |
| **pulse_width** | ... | ... | ... | ... | ... |

Same `|r|`-coloured cells, same click-to-set-axes behaviour for the indices matrix; the raw-params matrix's click sets the X axis to a synthetic raw-params source… actually this needs thought — the scatter only knows about indices on its X axis. For phase 2.5b, the raw-params matrix is **read-only**: cells colour by `|r|` and the hover tooltip shows the value, but clicking does nothing. (Phase 2.5c could add a "Plot raw param vs channel" mode if useful.)

**Implementation:**
- New helper `buildRawParamCorrelationMatrix(rows: ExposureRow[]): number[][]` — shape `(6, 5)`. Same Pearson computation, just over raw params instead of indices. Drops rows with `formula_version=0` (consistent with index path).
- New `RAW_PARAM_ROWS = ["power", "speed", "frequency", "density", "passes", "pulse_width"] as const` constant.
- `ExposureCorrelationMatrix` extended to accept either matrix shape and a `rowLabels` prop. The component becomes generic over the row dimension.
- The page owns the tab state (default = "indices").

## G — Nearest-neighbour view

**Surface:** an expandable section under the right-rail Focused card, titled `NEIGHBOURS`. Hidden when no focus.

**Two ranking modes** in tabs:
1. **Similar colour** — ranked by ΔE76 distance in Lab space.
2. **Similar regime** — ranked by log-space distance in `(total_exposure_index, pulse_intensity_index)`.

The same N entries (default N=5) appear in each tab; only the ordering differs.

**Per-row rendering:**

```
[swatch]  #5d2e1f   ΔE 2.3   power 11.2  ...
```

Each row shows: a small 16×16 swatch tile, the hex, the rank metric (ΔE or regime distance), and a one-line recipe summary (`power 11.2  speed 800  freq 125`). The whole row is clickable and clicking navigates the focused state to that entry (replaces the pin).

**Why these two metrics:**
- Similar-colour answers "what other recipes give a colour this close?" — useful for finding alternative recipes for a target colour.
- Similar-regime answers "what other recipes have this energy/intensity profile?" — useful for predicting "if I tweak this recipe slightly, what colours can I expect?".

**Distance formulas:**

```typescript
deltaE76(focused.lab, neighbour.lab)
// = sqrt(ΔL² + Δa² + Δb²)

regimeDistance(focused, neighbour)
// = hypot(
//     log10(focused.indices.total_exposure_index)  - log10(neighbour.indices.total_exposure_index),
//     log10(focused.indices.pulse_intensity_index) - log10(neighbour.indices.pulse_intensity_index)
//   )
```

Both Euclidean. Log-space for regime distance because the indices span orders of magnitude — euclidean in raw space would be dominated by surface_exposure scale.

**Excludes the focused entry itself.** N = 5 by default; might bump to 8 if the rail has room.

## Architecture / file changes

### New files

- `web/src/components/exposure/recipeFamilies.ts` — pure helper. `buildFamilies(rows) → Map<key, FamilyMember[]>`. Plus `RAW_PARAM_ROWS` constant.
- `web/src/components/exposure/recipeFamilies.test.ts` — TDD tests for family detection.
- `web/src/components/exposure/exposureNeighbours.ts` — pure helper. `nearestByDeltaE`, `nearestByRegime`. Reuses `deltaE76` from `web/src/color/math.ts`.
- `web/src/components/exposure/exposureNeighbours.test.ts`
- `web/src/components/exposure/ExposureFamilyTrace.tsx` — SVG polyline component, rendered inside `ExposureScatter` when a focused-entry family is detected.
- `web/src/components/exposure/ExposureNeighboursPanel.tsx` — the right-rail neighbour list with two tabs.

### Modified files

- `web/src/components/exposure/exposureCorrelations.ts` — extend with `RAW_PARAM_ROWS` and `buildRawParamCorrelationMatrix`.
- `web/src/components/exposure/ExposureCorrelationMatrix.tsx` — generalise to accept either index-based or raw-param-based row dimension. Add tab state externally.
- `web/src/components/exposure/ExposureScatter.tsx` — accept an optional `family` prop and render the polyline behind the dots.
- `web/src/components/exposure/ExposureFocusedCard.tsx` — add the source-test link (D) and the family-filter buttons (C). Optionally show "member of N-entry sweep" context.
- `web/src/pages/ExposurePage.tsx` — initial state changes (E), family detection memoised on rows, family filter state, neighbours panel rendering, raw-param matrix toggle.

## Testing

- **Family detection** (`recipeFamilies.test.ts`): empty rows → empty map; rows with no families → empty map; rows with one 5-member power sweep → one family with `varyingAxis="power"`, 5 sorted members; row appearing in two families → both keys present.
- **Neighbour helpers** (`exposureNeighbours.test.ts`): ranks descend from anchor; ΔE excludes the anchor; regime distance uses log-space (hand-computed expected values).
- **Component tests**: family-trace renders polyline when `family` prop is non-empty; neighbour panel renders N rows; family-filter buttons reflect available axes.
- **Integration test on `ExposurePage`**: clicking a sweep button in the focused card sets the page filter; clicking a neighbour row swaps the focus; raw-param toggle changes the matrix to 6×5.
- **Manual Playwright walkthrough**: full flow click-through ending with one family-filtered view, one neighbour-jump, source-test link clicked.

## Open questions

None blocking. Two worth flagging in the plan as small decisions to make during implementation:
- Family-trace ordering for ties (e.g., when the focused entry's two largest families are the same size). Spec says alphabetical varying-axis. Cheap to revisit if it feels arbitrary in use.
- Neighbour count `N=5` vs `N=8`. Pick by visual fit during the polish pass.
