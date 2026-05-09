# Exposure page — doubled right rail + advanced filters

**Status:** design
**Date:** 2026-05-11
**Owner:** @jon
**Touches:** `web/src/pages/ExposurePage.tsx`, `web/src/components/exposure/*`, plus a small new helpers module for filter encode/decode and slider math.

## Why

The exposure page mixes "interpretation" controls (axis pickers, mode toggle, scatter) with a thin set of filters bolted onto the left rail (`Sources` checkboxes + `validated only`). The current source/validated wiring has a known bug — the fetch effect deliberately excludes `sourceFilter` from its deps, so toggling source checkboxes doesn't re-derive the row set and the page lies about what it's showing. Beyond the bug, the page has no way to restrict the chart to a comparable subset: no per-test filter, no parameter-range filter, no test-kind filter, and no shared "this is what's active right now" surface.

The previous PR (#81) added the data we need — `tests.source_test_id`, `tests.parent_test_id`, `tests.kind` (already present), `palette_entries.derived_from_entry_id` — but didn't surface any of it. This PR finishes the half: an explicit, prominently-located filter panel that prevents unrelated datasets from muddying the chart and clearly displays which constraints are active.

The right rail also gets the redesign hinted at while planning the previous round: doubled width, two-column composition, indices info promoted out of the focused card.

## Constraints

- **One PR.** Layout change, filter widget, URL persistence, and the source-filter bug fix all ship together. The reducer-style state is shared by everything; splitting would be more work than landing it as one unit.
- **No backend changes.** Every new filter is a client-side derivation from a single canonical entry list. The existing `validated_only` query param on `GET /api/palette` becomes unused on this page (we still fetch the full set per material and filter in-memory). Other pages still use it.
- **No regressions to existing focus / hover / brush / family-trace behaviour.** All five existing filters (`sourceFilter`, `validatedOnly`, `familyFilter`, `brushRange`, `trimOutliers`) keep working — they just live in a unified `ActiveFilters` reducer rather than as separate `useState` hooks.
- **Hash-router compatible.** Active filters round-trip through the URL hash so a teammate can paste a link and see the same filtered chart. The existing `#/exposure/<materialId>` shape stays; filters live in the query string portion of the hash.
- **Don't break narrow viewports.** On <1280px laptops the doubled rail eats horizontal space the chart used to have. The right-rail right column collapses below the left at narrow widths so the chart still has minimum-width breathing room.

## Architecture

### Layout

```
┌── LEFT RAIL (224px) ──┐┌── CHART (flex-1) ──────────┐┌── RIGHT RAIL (480px) ─────────────────┐
│ Material              ││ pill bar (when active)    ││ ┌──── (220) ───┐┌──── (220) ───┐     │
│ X axis                ││ ┌─────────────────────┐    ││ │ Stats        ││ Filters      │     │
│ Y axis                ││ │  scatter             │   ││ │ Pearson r    ││ Source       │     │
│                       ││ │                      │   ││ │ sub-stats    ││ Test         │     │
│                       ││ └─────────────────────┘   ││ │              ││ Range × 6    │     │
│                       ││ Hue ribbon │ Correlations││ │ Focused      ││ Family       │     │
│                       ││            │ matrix      ││ │ Pinned card  ││ Outliers     │     │
│                       ││ Exposure range brush      ││ │ Neighbours   ││ Reset all    │     │
│                       ││                            ││ ├──────────────┤│              │     │
│                       ││                            ││ │ Indices      │└──────────────┘     │
│                       ││                            ││ │ (when entry  │                     │
│                       ││                            ││ │  focused)    │                     │
└───────────────────────┘└────────────────────────────┘└───────────────────────────────────────┘
```

The right rail's outer aside becomes `flex flex-row` with two equal-flex inner columns at ≥1280px viewport width and `flex-col` at narrower widths. Inner columns have `flex-1 min-w-0`. Existing `gap-4 px-4 py-5 border-l ...` chrome on the aside stays.

The left rail's `Sources` section is removed (the controls move to the new filter panel). Material picker, X axis picker, Y axis picker stay where they are.

### State — `ActiveFilters` reducer

`web/src/components/exposure/exposureFilters.ts` declares:

```ts
export type SourceKind = "averaged" | "single_result" | "manual";

export interface ParamRange {
  /** Lower bound, inclusive. NULL = no lower bound. */
  min: number | null;
  /** Upper bound, inclusive. NULL = no upper bound. */
  max: number | null;
}

export type FilterableParam =
  | "power" | "speed" | "frequency"
  | "pulse_width" | "density" | "passes";

export interface ActiveFilters {
  // Existing-but-relocated
  sources: ReadonlySet<SourceKind>;
  validatedOnly: boolean;
  trimOutliers: boolean;
  brushRange: readonly [number, number] | null;
  family: { axis: VaryingAxis; anchorRowId: number } | null;

  // New
  testId: number | null;
  /** Single-step lineage extensions — not transitive. */
  testLineage: ReadonlySet<"source" | "parent">;
  testKind: "sweep" | "validation" | "all";
  paramRanges: Partial<Record<FilterableParam, ParamRange>>;
}

export const DEFAULT_FILTERS: ActiveFilters = {
  sources: new Set(["averaged", "single_result", "manual"]),
  validatedOnly: false,
  trimOutliers: true,
  brushRange: null,
  family: null,
  testId: null,
  testLineage: new Set(),
  testKind: "all",
  paramRanges: {},
};

export function applyFilters(
  rows: readonly PaletteEntry[],
  filters: ActiveFilters,
  testsById: ReadonlyMap<number, TestSummary>,
): ExposureRow[] { /* ... */ }

export function dataRanges(
  rows: readonly PaletteEntry[],
): Record<FilterableParam, { min: number; max: number } | null> { /* ... */ }
```

`applyFilters` walks `rows` once and returns the filtered set in the order:

1. **Drops:** sources / validated / kind / test+lineage. These are explicit "exclude this kind of entry" rules.
2. **Range checks:** for each `paramRanges` entry, drop rows whose `params[k]` is missing or outside `[min, max]`.
3. **Recipe family:** if `family` is set, drop rows that aren't members of the matching sweep.
4. **Brush range:** if `brushRange` is set, drop rows whose `total_exposure_index` falls outside.
5. **Trim outliers:** display-tuning, applied as a pre-bounds filter inside the scatter component (kept as a flag on `ActiveFilters` so the URL captures it, not as a row drop in `applyFilters`).

The function is pure — same `(rows, filters, testsById)` always produces the same `ExposureRow[]`. Everything memoises on the dep set.

### `testsById` — the corpus needed for lineage resolution

When a user selects `testId = 42` and toggles `testLineage += {"source"}`, the filter has to know which test ids satisfy "test 42 + its source test." That's a join through `tests.source_test_id`. To keep `applyFilters` pure, the page provides a `testsById: ReadonlyMap<number, TestSummary>` derived from a sibling fetch:

```ts
interface TestSummary {
  id: number;
  name: string;
  kind: "sweep" | "validation";
  source_test_id: number | null;
  parent_test_id: number | null;
}
```

`useEffect` on `materialId` change fires `listPaletteEntries` AND `listTests({ material_id })` in parallel. Both populate before the page renders the filter panel. The test picker dropdown lists every test in `testsById` that has at least one entry in the rows fetch.

### URL persistence

`web/src/components/exposure/exposureFiltersUrl.ts` implements:

```ts
export function encodeFilters(f: ActiveFilters): string;          // → "p=10..40&d=100..&test=42"
export function decodeFilters(query: string): ActiveFilters;      // ← parses and snaps invalid values to defaults
export function useFiltersUrlSync(
  state: ActiveFilters,
  setState: (f: ActiveFilters) => void,
): void;                                                          // hook
```

URL keys are short to keep links readable:

| Key      | Filter                          | Encoding example                      |
|----------|---------------------------------|---------------------------------------|
| `p`      | `paramRanges.power`             | `p=10..40`, `p=10..`, `p=..40`        |
| `s`      | `paramRanges.speed`             | `s=200..1000`                         |
| `f`      | `paramRanges.frequency`         | `f=30..60`                            |
| `pw`     | `paramRanges.pulse_width`       | `pw=200..200`                         |
| `d`      | `paramRanges.density`           | `d=100..`                             |
| `r`      | `paramRanges.passes`            | `r=2..2`                              |
| `src`    | `sources`                       | `src=averaged,manual` (omit if all)   |
| `val`    | `validatedOnly`                 | `val=1` (omit when false)             |
| `test`   | `testId`                        | `test=42`                             |
| `lin`    | `testLineage`                   | `lin=source,parent`                   |
| `kind`   | `testKind`                      | `kind=validation` (omit when "all")   |
| `fam`    | `family.axis`                   | `fam=power@anchor=247`                |
| `brush`  | `brushRange`                    | `brush=1.2..18`                       |
| `trim`   | `trimOutliers`                  | `trim=0` (omit when default `true`)   |

`useFiltersUrlSync` reads the current hash on mount, merges parsed filters over `DEFAULT_FILTERS`, and on every state change calls `history.replaceState(null, '', '#/exposure/<id>?<encoded>')`. The router doesn't care about the query string portion — `router.ts` parses up to the first `?`.

Decode is liberal: unknown keys are ignored, malformed values snap to the nearest legal (matches the project's existing Pydantic-validator-snaps-to-legal pattern).

### Material change clears all filters

Switching material in the left rail picker resets `ActiveFilters` to `DEFAULT_FILTERS` and rewrites the URL to `#/exposure/<newId>` without the query suffix. Carrying filters across materials feels surprising because the data ranges under each slider depend on the material; an `[10, 40]` power filter on stainless might be `[5, 80]`'s middle on aluminium and the slider would render with nonsense bounds.

### Filter panel composition

`ExposureFilterPanel` (the right-rail right column) renders six logical sections. Each is a `<section>` with the existing right-rail `RailHeading` + `MetalBar` chrome.

1. **Source / validated** — three checkboxes for `sources`, one for `validatedOnly`. Same controls as today's left-rail block; the existing source/validated bug fixes itself because the new shape is a pure derivation, not a fetch-side filter.

2. **Test filter** — three sub-controls:
   - `<select>` (or searchable combobox if the test list is long) — "All tests" (default) or a specific test as `#42 · Second validation pass · validation · 36 entries`. Lists tests from `testsById` that have ≥1 entry in `rows`.
   - Lineage toggle group, only enabled when a test is selected: two checkboxes `+ source test` and `+ parent test` (multi-select). Wire to `testLineage`. Lineage is **single-step**, not transitive — `+ source test` adds the entries from `tests[testId].source_test_id` only, not that test's source's source. Same for `+ parent test`. Going deeper into the chain in this PR adds enough complexity that we punt to a follow-up if anyone asks.
   - Kind toggle: three pill buttons `[sweep] [validation] [all]`. Default `all`.

3. **Range sliders × 6** — one section per param: `power`, `speed`, `frequency`, `pulse_width`, `density`, `passes`. Each renders an `ExposureRangeSlider` (Section "Components" below).

4. **Recipe family status** — read-only display of the active `family` filter, with a clear button. Set elsewhere (focused-card "[POWER]" button); shows here as `Family: power sweep · n entries · ✕`.

5. **Outliers + brush** — a small `Trim outliers` toggle (moved from the above-chart toolbar) and an `Exposure brush` status row (`active: 1.2 → 18 ✕` when set, hidden when null).

6. **Reset all filters** — a single button at the bottom; sets state to `DEFAULT_FILTERS` and clears the URL query.

### Components

**`ExposureRangeSlider.tsx`** — dual-handle slider with click-to-edit numeric labels.

Props:
```ts
interface Props {
  param: FilterableParam;
  /** Slider domain: the data's min..max for the current material. */
  domain: { min: number; max: number };
  /** Current bound. NULLs render as the corresponding edge of the domain. */
  value: ParamRange;
  onChange: (next: ParamRange) => void;
}
```

Behaviour:
- Horizontal track with two handles that drag along the track's pixel width. Handle drag updates state on `pointermove` (throttled via rAF).
- Min and max numeric labels under each handle. Single click on a label converts it to a controlled `<input type="number" inputMode="decimal">`. `Enter` or blur commits and snaps the slider; `Escape` reverts.
- Domain is auto-detected as log-scale if `domain.max / domain.min > 100` AND `domain.min > 0`. Slider math operates on `log10(value)` in that case so density (5 → 5000) doesn't render as a 99% empty track.
- Right-side `×` button collapses both bounds to NULL (= no constraint).
- A muted `data: <min>–<max>` caption below the slider so the user knows the active material's actual range.

**`ExposureFilterPills.tsx`** — pill bar above the scatter.

Pure derivation from `ActiveFilters` + `displayRows.length`. Renders zero pills (and stays hidden) when `filters` equals `DEFAULT_FILTERS`.

Pill formatters:
- `sources` not equal to default → `SOURCE: averaged, manual` (or whatever subset)
- `validatedOnly === true` → `VALIDATED ONLY`
- Each `paramRanges[k]` → `<UPPER_PARAM> <min>–<max>` with `≥` / `≤` shorthand for half-open ranges
- `testId` set → `TEST #N` with optional ` (+source)` / ` (+parent)` suffix from `testLineage`
- `testKind !== "all"` → `<UPPERCASE_KIND>`
- `family` set → `FAMILY: <axis> sweep`
- `brushRange` set → `EXPOSURE <min>–<max>`

Each pill has a trailing `×` button that clears the corresponding dimension. Right side: `<n> entries · Clear all`.

`trimOutliers` is NOT shown as a pill — it's a display-tuning flag, not a content filter.

**`ExposureFocusedIndices.tsx`** — single-column indices chip stack for the right rail's **left** column, sitting under Stats + Focused/Pinned/Neighbours. Indices describe the focused entry, so they belong in the entry-info column rather than the constraint-control column.

Reuses the seven existing chips from `PaletteIndicesChips` re-laid-out in a single-column stack so they fit the ~220px column width (the current 4-up grid is too wide here). Renders a muted `Focus an entry to see its indices` placeholder when `focusedRow === null`.

### Server fetch — material change only

The `useEffect([materialId])` runs `Promise.all([listPaletteEntries({ material_id }), listTests({ material_id })])` and writes both results into state. `validated_only` is no longer in the request — filtering becomes purely client-side.

Other pages still use `validated_only` on the API; only this page stops sending it.

## Test plan

- **`exposureFilters.test.ts`** — `applyFilters` matrix covering: defaults yield all rows, source-only, validated-only, source+validated stacked, single-param range, multi-param range, range with NULL on a manual entry, test-id only, test-id+source, test-id+parent, test-id+source+parent, test-id+kind interaction (e.g. test-id is a sweep but kind=validation), recipe-family stacked with range, brushRange + range. One regression test specifically for the source-filter bug: `applyFilters({ sources: ['averaged'] })` returns averaged-only without re-fetching.

- **`exposureFiltersUrl.test.ts`** — every dimension round-trips: write `ActiveFilters` → encode → decode → assert deep-equal. Plus malformed-input snapping (e.g. `p=invalid` → no power range; `lin=garbage` → empty lineage set).

- **`ExposureRangeSlider.test.tsx`** — drag handles update bounds; clicking a label switches to input mode; Enter commits; Escape reverts; reset clears bounds; log-scale auto-detect kicks in when domain ratio > 100; click-to-edit input rejects NaN.

- **`ExposureFilterPills.test.tsx`** — empty (default filters) → no pills rendered; populated → one pill per dimension; clicking `×` calls `onClearOne(dim)`; `Clear all` calls `onClearAll`.

- **`ExposureFilterPanel.test.tsx`** — renders all six sections; toggling controls calls the right reducer actions; "Reset all" wipes state.

- **`ExposurePage.test.tsx`** updates — switching material clears filter state; URL hash reflects active filters; the page mounts with filters when the URL hash carries them.

- **Visual smoke (manual)** via `scripts/seed_from_prod.py` against the seeded local DB — set `power=10..40` and `density=100..`, switch to bivariate, confirm `displayRows` count drops appropriately, pill bar shows two pills, refresh page, filters survive.

## Risks

- **Big-bang state migration.** The reducer touches every existing on-page interaction. A bug in `applyFilters` breaks the page entirely. Mitigated by extracting `applyFilters` as a pure function with the test matrix above. If a regression slips through, rolling back to the pre-PR state is straightforward (one revert).
- **Slider ergonomics on touch.** Dual-handle sliders are fiddly without a mouse. Click-to-edit numeric input is the fallback. Tested on at least one touch device before declaring done; if bad, slider becomes decorative and numeric inputs become primary.
- **Right rail at <1280px.** Loses chart width. The right-rail collapse to single-column at narrow widths is a stretch goal; if the layout is too messy at narrow widths, fall back to single-column and the right column wraps below.
- **Test list endpoint** adds one HTTP roundtrip on material change. Negligible (small list), but worth measuring.
- **URL length** with many filters set could grow. The short keys keep it manageable; worst-case six param ranges + test + lineage + kind + brush is well under 200 chars.

## Out of scope

- **Tag-based filtering.** Schema added in PR #81; no UI in this PR. Cheap follow-up.
- **`derived_from_entry_id` lineage in the focused card** ("← validated against #M on Material X" link). Schema in place; UI is a separate polish task.
- **Saved filter presets / bookmarks.** URL sharing covers most use cases.
- **Backend `validated_only` deprecation.** Other pages still use it; we stop sending it from `ExposurePage` only.
- **Per-component differential filtering** (e.g. "show full corr matrix even when filters are active"). All three downstream consumers — scatter, hue ribbon, correlation matrix — use the same `displayRows`. Default: filtered everywhere.

## Decisions captured during brainstorming

- Right rail doubles to 480px and splits into two columns. **Left column** holds Stats + Focused/Pinned/Neighbours + the promoted indices chips (so all entry-info sits together); **right column** holds the new filter panel. Decided during the spec self-review — the original verbal walkthrough placed Indices in the right column, but co-locating them with the focused card reads more cleanly.
- Test filter dimensions in this PR: **specific test, lineage chain (source/parent), test kind**. Tags deferred.
- Range filter UX: **dual-handle slider + click-to-edit numeric label**.
- Persistence: **URL hash query params**, surviving reloads and shareable.
- Active context: **pill bar above the chart** with click-to-remove, entry count, Clear all.
- Existing source/validated bug is **fixed as a side effect** of moving filters to a pure client-side derivation (verified by a targeted regression test).
- `trimOutliers` is **not a pill** — it's a display-tuning flag, not a content filter.
