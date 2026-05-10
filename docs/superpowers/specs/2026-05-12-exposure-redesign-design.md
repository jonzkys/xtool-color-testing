# Exposure page — workbench redesign

**Status:** design
**Date:** 2026-05-12
**Owner:** @jon
**Touches:** `web/src/pages/ExposurePage.tsx`, `web/src/components/exposure/ExposureScatter.tsx`, `web/src/components/exposure/ExposureFocusedCard.tsx`, `web/src/components/exposure/ExposureNeighboursPanel.tsx`, plus four new components.

**Depends on:** PR #82 (exposure-rail-filters) being merged into main. This branch builds directly on top of `feat/exposure-rail-filters` and assumes the `ActiveFilters` reducer, `applyFilters` derivation, URL sync, range sliders, filter pills, and `ExposureFocusedIndices` are all in place.

## Why

The page works but feels cluttered. The current layout (after PR #82) has:
- A 224 px left rail with material picker + X/Y axis pickers,
- A 480 px right rail split into two columns (stats / focused / neighbours / indices on one side; filters on the other),
- The chart squeezed in between with the pill bar above and the hue ribbon / correlations / brush below.

On a 1440 px laptop the chart only gets ~720 px of horizontal space, and the rails carry a lot of static chrome that's referenced occasionally rather than constantly. The user explicitly called out four things to fix:

1. **Material** is a single-select that takes up a full rail section — it should be a dropdown.
2. **Axis pickers** rarely change after the first pick, but they eat permanent rail space — they should live in the toolbar (or on the chart's own axis labels) and open on demand.
3. **Range filters** live in the right rail and dominate it vertically — they should be on-demand too, ideally as a panel that doesn't fully obscure the chart.
4. **Nearest neighbours** is currently five tiny rows of `swatch · ΔE · pwr 14.6 · spd 15…` truncated. Hard to scan, hard to compare. Should be more visual.

Plus: a recipe-row inline filter button so when you see a focused entry's `POWER 14.6%` you can click directly to filter the chart to that power. Today this needs three clicks (open filter panel → find power slider → drag to 14.6).

## Constraints

- **Single PR.** Layout restructure, four new components, modified focused card, and the neighbours rebuild ship together. Splitting would leave the page in awkward intermediate states.
- **Builds on PR #82.** The `ActiveFilters` reducer, `applyFilters`, URL sync, range sliders, pills, and `ExposureFocusedIndices` are reused as-is. This redesign is a layout + presentation pass, not a state-machinery rewrite.
- **Keep below-chart panels.** The hue ribbon, correlations matrix, and range brush stay where they are today (below the scatter card). They just compress slightly because the scatter is wider.
- **No mobile / no <1280 px.** The page was never usable below `xl` and isn't a target for this PR.
- **No new dependencies.** Toolbar pills, popovers, and the filter panel are hand-rolled with the existing `HelpTip` portal infrastructure for click-outside-to-close.

## Architecture

### Page geometry

```
┌─ Top toolbar (~40px) ─────────────────────────────────────────────────────┐
│ MATERIAL ▾  ‖  UNI | BIVAR  ‖  X: TOTAL EXPOSURE ▾   Y: PULSE INTENSITY ▾  │
│                                                                ⚙ FILTERS·3│
├─ Pill bar (auto-height, hidden when no filters) ──────────────────────────┤
│ [POWER 14.6–14.6 ×]  [TEST #42 ×]                       42 entries  Clear │
├─ Body row ────────────────────────────────────────────────────────────────┤
│  ┌─ Chart card (flex) ──┐ ┌─ Filter panel (240px, ┐ ┌─ Right rail (240px) ┐│
│  │                      │ │   conditional)        │ │ Stats               ││
│  │  scatter             │ │ Source / Validated    │ │ Focused             ││
│  │                      │ │ Test                  │ │ Neighbours          ││
│  │                      │ │ Ranges × 6            │ │ Indices             ││
│  └──────────────────────┘ │ Family · Outliers     │ └─────────────────────┘│
│  ┌─ Below-chart panels ─┐ │ Clear all             │                        │
│  │ Hue ribbon           │ └───────────────────────┘                        │
│  │ Correlations matrix  │                                                  │
│  │ Range brush          │                                                  │
│  └──────────────────────┘                                                  │
└────────────────────────────────────────────────────────────────────────────┘
```

The left rail is **deleted entirely**.

### Components

| Component | Status | Responsibility |
|---|---|---|
| `ExposureToolbar.tsx` | new | Top toolbar: Material `<select>` + Mode toggle + X/Y axis pills + Filters button (with active-count chip). |
| `ExposureAxisPicker.tsx` | new | Popover content for axis selection. Used by both the toolbar's X/Y pills AND the SVG axis labels in `ExposureScatter`. Renders the seven-axis radio list + log-scale checkbox. Reuses `HelpTip`'s portal placement infrastructure for positioning + click-outside dismissal. |
| `ExposureNeighboursStrip.tsx` | new | Six-tile horizontal swatch strip: focused entry + 5 nearest neighbours. Tile selection state lives here. Click selects; selected tile gets a primary-coloured border. Focused tile is always rendered (border collapses if a different tile is selected). |
| `ExposureNeighbourDetail.tsx` | new | Detail card for the currently-selected strip tile: hex + ΔE + full recipe with deltas vs focused + Jump-to / Filter-from action buttons. |
| `ExposureScatter.tsx` | modified | X/Y SVG axis labels gain `cursor-pointer` + dotted underline + click-to-open `ExposureAxisPicker`. Existing hover help-card stays (longer hover delay). |
| `ExposureFocusedCard.tsx` | modified | Recipe rows gain a small `⚲` button per row that applies an exact-match range filter on that param. Filtered rows get a subtle background tint. Two new props: `activeParamFilters: Set<FilterableParam>` and `onTogglePerParamFilter(param, value)`. |
| `ExposureNeighboursPanel.tsx` | modified | Keeps the `SIMILAR COLOUR | SIMILAR REGIME` toggle and the sort logic; replaces the 5-row list with `<ExposureNeighboursStrip>` + `<ExposureNeighbourDetail>`. The "currently selected neighbour" state lives here, defaulting to the first neighbour. |
| `ExposurePage.tsx` | modified | Removes the left `<aside>` entirely. Mounts `<ExposureToolbar>` above the pill bar. Restructures the right rail from PR #82's two-column layout back to a single column. Adds a `filtersOpen` boolean and conditionally renders the filter panel between chart and right rail. Wires `handleApplyParamRangeFilter(param, value)` for the focused-card's per-row buttons and `handleApplyRecipeAsFilters(neighbour)` for the neighbour detail's `Filter from` button. |

### `ExposureToolbar`

```tsx
interface Props {
  materials: readonly Material[];
  materialId: number | null;
  onMaterialChange: (id: number) => void;
  mode: ScatterMode;
  onModeChange: (m: ScatterMode) => void;
  xKey: IndexRow;
  yKey: ChannelCol | IndexRow;
  xScale: ScaleKind;
  yScale: ScaleKind;
  onXKeyChange: (k: IndexRow) => void;
  onYKeyChange: (k: ChannelCol | IndexRow) => void;
  onXScaleChange: (s: ScaleKind) => void;
  onYScaleChange: (s: ScaleKind) => void;
  filtersOpen: boolean;
  onToggleFilters: () => void;
  activeFilterCount: number;
}
```

- Material is a vanilla styled `<select>` (~150 px wide). The codebase already has 5 materials max in real data, so no search needed.
- Mode toggle reuses the existing `UNIVARIATE | BIVARIATE` segmented design, just relocated.
- X / Y pills show the current label (e.g. `X: TOTAL EXPOSURE ▾`) with a small `▾` indicator. Click → `<ExposureAxisPicker>` popover. Pill style matches the existing rail picker buttons.
- Filters button: `⚙ FILTERS · N` (N = `activeFilterCount`, 0 hidden). Primary-coloured border when active.

### `ExposureAxisPicker`

The popover is rendered through a portal (matching `HelpTip`) anchored to whatever opened it (toolbar pill OR SVG axis label). Same component, two trigger sites:

```tsx
interface Props {
  axis: "x" | "y";
  mode: ScatterMode;          // determines whether Y picker shows index list or channel list
  currentKey: IndexRow | ChannelCol;
  scale: ScaleKind;
  onKeyChange: (k: IndexRow | ChannelCol) => void;
  onScaleChange: (s: ScaleKind) => void;
  anchor: HTMLElement;        // for placement
  onClose: () => void;
}
```

Behaviour:
- 220 px wide × ~240 px tall.
- Placement: tries below the anchor first, then to the side, then above — same fallback chain as `HelpTip` to avoid covering the chart's data area. Specifically, if the anchor is the SVG X-axis label, the popover prefers ABOVE (so it sits in the gap between the chart and the hue ribbon, NOT over the data).
- Radio list of axis options. In bivariate mode the Y picker shows `INDEX_ROWS`; in univariate it shows `CHANNEL_COLS`.
- Log-scale checkbox at the bottom (only meaningful for index axes — hidden when picking a channel).
- Click outside / Esc / clicking a different axis pill closes.
- **Chart updates live** as the user clicks options. The popover stays open until explicit close.

### Per-row filter buttons on the focused card

`ExposureFocusedCard` currently renders the recipe as 6 rows: `POWER · 14.6%`. Each row gets:
- A right-aligned `⚲` button (filter glyph). Muted by default; primary-coloured on hover.
- When that param is currently filtered to the focused row's value (`paramRanges[k] = { min: v, max: v }` where `v === focused.params[k]`), the button shows a check mark and the row gets a subtle `bg-[color:var(--color-surface-elevated)]` tint.
- Clicking the button toggles: not-filtered → filter-to-this-value, filter-to-this-value → cleared, filter-to-different-value → overwrites.

Behaviour helpers:
```tsx
function isFilteredToValue(filters: ActiveFilters, param: FilterableParam, value: number): boolean {
  const r = filters.paramRanges[param];
  return r != null && r.min === value && r.max === value;
}

function togglePerParamFilter(prev: ActiveFilters, param: FilterableParam, value: number): ActiveFilters {
  if (isFilteredToValue(prev, param, value)) {
    const next = { ...prev.paramRanges };
    delete next[param];
    return { ...prev, paramRanges: next };
  }
  return { ...prev, paramRanges: { ...prev.paramRanges, [param]: { min: value, max: value } } };
}
```

The `ExposurePage` passes `activeParamFilters: Set<FilterableParam>` (computed from `filters.paramRanges` keys) and `onTogglePerParamFilter` to the focused card.

Per the user's call: per-row filter buttons appear ONLY on the focused card. Neighbour detail rows do NOT get them.

### Neighbours strip + detail

#### Strip — `ExposureNeighboursStrip`

```tsx
interface Props {
  focused: ExposureRow | null;
  neighbours: readonly { row: ExposureRow; deltaE: number }[];   // up to 5
  selectedId: number | null;                                       // which tile is selected (focused if null)
  onSelect: (id: number) => void;
}
```

- 6 tiles wide via `flex` (1 + N where N ≤ 5).
- Each tile: full-bleed `background: row.hex`, height 32 px, 1 px gap between.
- The focused entry's tile always shows; primary-coloured 2 px border around it whenever it's the "selected" tile (or default when nothing else is selected).
- Selected tile (any of the 6) gets a primary 2 px border; unselected tiles have no border.
- Hover: small native `title` tooltip with `hex · ΔE 13.5`.
- Click: `onSelect(row.id)`.
- When `focused == null`, the strip renders nothing.

#### Detail — `ExposureNeighbourDetail`

```tsx
interface Props {
  focused: ExposureRow;
  selected: ExposureRow;            // could be focused itself
  deltaE: number | null;            // null if selected === focused
  onJumpTo: (id: number) => void;
  onFilterFrom: (row: ExposureRow) => void;
}
```

Layout:
```
┌──────────────────────────────────────┐
│ #CAC0A9                    ΔE 13.5  │
├──────────────────────────────────────┤
│ POWER 14.6%  ·  SPEED 840 (+5%)     │
│ FREQUENCY 125  ·  PULSE_WIDTH 200   │
│ DENSITY 5000  ·  PASSES 1           │
│                                      │
│ [→ Jump to]  [Filter from]          │
└──────────────────────────────────────┘
```

- Header: hex on left (mono uppercase), ΔE on right (primary, bold).
- Recipe body: 6 params in 3 lines (2 per line). Each value rendered with the existing `PARAM_FIELDS` formatting (e.g. `14.6%`). Differing params get a `+5%` / `−5%` / `+1` delta in primary alongside.
- Action row: `Jump to` calls `onJumpTo(selected.id)`, which the page wires to set the pinned focus. `Filter from` calls `onFilterFrom(selected)`, which on the page sets `paramRanges` to exact-match every numeric param of the neighbour at once.
- When `selected.id === focused.id`, the ΔE label hides and the action buttons disable (you're already there, nothing to do).

#### Helper — `recipeDelta(focused, neighbour)`

```ts
interface Delta {
  value: number | string;
  pct: number | null;       // null when reference value is 0 or non-numeric
  abs: number | null;
}

export function recipeDelta(
  focused: ExposureRow,
  other: ExposureRow,
  param: FilterableParam,
): Delta { ... }
```

Pure function in `web/src/components/exposure/recipeDelta.ts`. The detail card maps `FILTERABLE_PARAMS` over this helper to render the inline diffs.

### Filter panel — pinned column

The filter panel from PR #82 keeps its content (`ExposureFilterPanel`) but its host becomes a third column in the body row, conditional on `filtersOpen`:

```tsx
<div className="flex gap-4 ...">
  <main /* chart card flex-1 */>...</main>

  {filtersOpen && (
    <aside style={{ width: 240 }} className="shrink-0 ...">
      <ExposureFilterPanel ... />
    </aside>
  )}

  <aside style={{ width: 240 }} className="shrink-0 ...">
    {/* Stats / Focused / Neighbours / Indices, single column */}
  </aside>
</div>
```

`filtersOpen` defaults to `false` (chart-first on first load). State persists across material switches. CSS transition: `width 180ms ease-out` on the conditional aside; content removed after transition completes (or via `display: none` toggled with the same timing).

The toolbar's `⚙ FILTERS · N` button is the only opener; the panel's `×` (header close button) and clicking the toolbar button again are the closers. `Esc` while focus is inside the panel also closes.

### Right rail — single column, ~240 px

Sections in order:
1. **Stats** — Pearson r hero + 2×2 sub-stats grid + bivariate caption. Verbatim from PR #82's left column.
2. **Focused / Pinned** — `ExposureFocusedCard` with the new per-row filter buttons. Existing source-test link, family-filter buttons, brush-clear all stay.
3. **Neighbours** — `ExposureNeighboursPanel` with the new strip + detail layout (replaces the 5-row list).
4. **Indices** — `ExposureFocusedIndices` (single-column chip stack), unchanged.

PR #82's two-column right rail collapses back to one column. The single-column form has more vertical room which the new neighbour detail card needs.

### Below-chart panels

Hue ribbon, correlations matrix, range brush stay where they are today (below the scatter card, in their existing flex-row + brush stack). Their dimensions don't change; the chart card just has slightly less horizontal space when the filter panel is open.

## Test plan

**New unit tests:**
- `ExposureToolbar.test.tsx` — material `<select>` change calls `onMaterialChange`; mode buttons call `onModeChange`; X/Y pills render current label and clicking opens picker; FILTERS button shows count and toggles open.
- `ExposureAxisPicker.test.tsx` — radio click calls `onKeyChange`; log toggle calls `onScaleChange`; click outside closes; Esc closes; bivariate shows index list, univariate shows channel list.
- `ExposureNeighboursStrip.test.tsx` — 1+N tiles render; focused tile always present; click on tile calls `onSelect`; selected tile has primary border.
- `ExposureNeighbourDetail.test.tsx` — header shows hex + ΔE; differing params have delta annotations; matching params have none; `Jump to` and `Filter from` buttons fire callbacks; both buttons disable when selected === focused.
- `recipeDelta.test.ts` — pure helper: identity (same param value → 0%), positive/negative deltas, integer params (passes 1→2 → `+1`, no %), non-numeric params unchanged.

**Updated tests:**
- `ExposureFocusedCard.test.tsx` — clicking a row's filter button calls `onTogglePerParamFilter(param, value)`; rows that match `activeParamFilters` show the check + tint; clicking again clears.
- `ExposureNeighboursPanel.test.tsx` — strip + detail render; sort mode toggle still works; selecting the focused tile via the strip disables action buttons.
- `ExposurePage.test.tsx` — toolbar mounts; left rail is gone; opening filter panel adds 240 px column; switching material does NOT close panel; switching does reset filters; clicking a focused-card row's filter button updates the URL hash.

**Browser walkthrough on `#/exposure/1` after seeding prod data:**
1. Page loads with toolbar visible, no filter panel, no pill bar (default state).
2. Click the X axis toolbar pill → popover opens; click a different index → chart updates; click outside → popover closes.
3. Click the SVG X axis label → same popover opens, this time anchored to the chart.
4. Click `⚙ FILTERS` → filter panel slides in between chart and right rail.
5. Drag a slider in the panel → chart updates live; pill appears in the pill bar.
6. Click a focused-card recipe row's filter button → that param adds to the URL; the row gets a check tint.
7. Click again on the same row → filter clears.
8. Click a neighbour tile in the strip → detail card swaps to show that neighbour's recipe + deltas.
9. Click `Jump to` on a neighbour → focused entry updates.
10. Click `Filter from` on a neighbour → all of its params set as filters; pill bar shows 6 pills.
11. Switch material via toolbar dropdown → filters reset, neighbour selection clears, page updates.

## Risks

- **Axis picker / help-card coexistence on the same SVG label.** Both click and hover fire on the same `<text>`. Strategy: click opens picker immediately and dismisses any showing help card; help card has its existing 450 ms hover delay so a click never gets pre-empted by a hover-pop. Confirm this works after refactoring `HelpTip`'s wrapper to also support a click handler that doesn't conflict with its open/close machinery.
- **Chart width on narrow screens with filter panel open.** On a 1280 px laptop with right rail (240) + filter panel (240) + page-level chrome (~16 padding), the chart gets ~750 px. Tight but workable; the slider degenerate-domain fix (already in place from PR #82's polish) handles single-value data ranges.
- **Per-row filter buttons add 6 click targets to the focused card.** Visual register stays clean by keeping them muted by default. Worth checking on a real terminal that they don't visually compete with the source-test link or family-filter buttons.
- **Removing the left rail is a one-way move.** The changelog will explicitly mention "the left rail's contents are now in the toolbar" so users know where things went.
- **Toolbar height adds ~40 px of vertical chrome.** The mode toggle was previously in a separate row above the scatter; now it's in the toolbar. The above-chart toolbar from PR #82 (which had the trim button) is REMOVED — but the mode + bivariate-hint UI moves into the new toolbar.

## Out of scope

- **Drag-to-reposition floating panels.** We have only one floating element (the axis picker popover); positioning is automatic via the portal chain.
- **Material switcher with search.** Vanilla `<select>` is enough for ≤10 materials. If the corpus grows, swap for a combobox in a follow-up.
- **Saved layout presets** (e.g. compare two materials side-by-side, or a "diagnostic" layout that shows the correlation matrix full-screen). Future work.
- **Mobile / sub-1280 px optimisation.** Page was never usable below `xl`; this redesign doesn't change that.
- **Dark-mode adjustments.** All new components inherit existing CSS variables.
- **Animation polish beyond the filter-panel slide.** Tile selection in the neighbours strip is instant; no easing on the swap.

## Decisions captured

- **Layout direction:** option A (top toolbar + slim right rail + on-demand filter panel between chart and rail). Floating-everything (option B) was rejected as too radical for the Workshop Instrument register.
- **Axis pickers:** option C — both toolbar pills AND clickable SVG axis labels open the same popover. Popover sized to keep the chart's data area visible and chart updates live.
- **Filter panel position:** option A — pinned column between chart and right rail, opening pushes chart and rail aside. Predictable position; no overlap with focused/neighbours context.
- **Neighbours redesign:** option C — six-tile horizontal strip + single detail card with full recipe, deltas, Jump-to / Filter-from actions.
- **Per-row filter behaviour:** exact match (`min === max === focused.value`). Toggle off by clicking again.
- **Per-row filter scope:** focused card only. Neighbour detail rows do NOT get per-param buttons (they have whole-row `Filter from` instead).

## Branch hygiene

This work depends on PR #82 (exposure-rail-filters). Branch this work off `feat/exposure-rail-filters` to inherit the new state machinery and components; rebase onto `main` once PR #82 merges. The hue-ribbon vertical-jitter fix (`235cdfe`) lives in PR #82 and naturally rides along.
