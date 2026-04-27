# Test detail page redesign

**Date:** 2026-04-27
**Status:** design — pending implementation plan
**Surface area:**
- Frontend: `web/src/pages/TestDetailPage.tsx`,
  `web/src/components/ParamTestEditor.tsx`,
  `web/src/components/TestPreview.tsx`,
  `web/src/components/ResultsPanel.tsx`. New small UI primitive
  `web/src/ui/Tabs.tsx` (or co-located with the page).

## Goal

Today the test detail page stacks three columns vertically and lets
the whole window scroll. On tests with hundreds of results (some 500+),
the right-side palette/results column drives a long page-level scroll
that loses the test's parameters and preview from view. The middle
column (TestPreview) is also large and mostly empty space on most
tests.

Redesign for fixed-page-height with internal scroll regions:
- Wider tabbed parameter editor on the left so all the form sections
  fit without stacking forever.
- A compact preview at the top of the right column (quick visual
  safety check, not a primary content area).
- A scrollable results / palette panel filling the rest of the right
  column — the page itself never scrolls, only this panel does when
  there are many results.

The visual treatment of the new tabs, compact preview, and scroll
affordance is delegated to the **frontend-design** agent at
implementation time.

## Non-goals

- Drag-resizable column split (fixed proportions for now).
- Persisting "last selected tab" across navigations (always default
  to Test).
- Mobile / narrow-viewport adaptation (workbench is desktop-first;
  minimum width assumption ≈ 1280 px).
- Refactoring how the individual fields are implemented — they keep
  using existing `Field` / `Input` / `Select` / `NumberField`
  primitives. Only their grouping and container changes.
- Saving/changing the field-level data model. Tab grouping is purely
  visual.

## Design

### 1. Page-level layout

`TestDetailPage.tsx` switches from "natural-height column grid inside
PageContainer" to "viewport-fitting flex column".

```
┌─────────────────────────────────────────────────────────────────┐
│ TopBar (existing app chrome — already there)                    │
├─────────────────────────────────────────────────────────────────┤
│ HEADER (sticky, ~70px)                                          │
│   [Test name input] [status badges] [Save·Generate·Retest…]    │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  LEFT COLUMN (~58%)            RIGHT COLUMN (~42%)              │
│  ┌─────────────────────┐       ┌─────────────────────────────┐  │
│  │ Tab bar             │       │ TestPreview                 │  │
│  │ [Test|Sweep|Base|…] │       │ (full width × ~160 px tall) │  │
│  │ ─────────────────── │       └─────────────────────────────┘  │
│  │                     │       ┌─────────────────────────────┐  │
│  │ Active tab content  │       │ ResultsPanel                │  │
│  │ (overflow-y: auto   │       │ (overflow-y: auto)          │  │
│  │ if needed)          │       │                             │  │
│  │                     │       │   [scrollable list of       │  │
│  │                     │       │    results + averaged       │  │
│  │                     │       │    swatches sub-section]    │  │
│  └─────────────────────┘       └─────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

Page wrapper: `<div className="h-[calc(100vh-<topbar>)] flex flex-col">`
or equivalent. Header: fixed height. Body: `flex-1` 2-column grid that
fills remaining height. Left + right column heights both equal the
body's flex height; internal scrolling absorbs overflow.

### 2. Header (unchanged content, refined behaviour)

- **Test name** input (existing component) on the left.
- **Status badges**: `status` (created / tested / deleted),
  `locked` if applicable. Existing badges, unchanged.
- **Action buttons** on the right: Save · Generate .xcs (with retest
  index) · Retest · Duplicate · Delete. Existing components,
  unchanged behaviour.
- Material is **not** in the header — it moves into the Test tab.
- Header does NOT scroll with the body. Sticky at the top of the
  page-flex-column.

### 3. Left column — tabbed parameter editor

Four tabs. Sticky tab bar at the top of the column. Active tab
content fills the rest of the column; if a tab's content overflows
it scrolls inside the column (rare in practice — most tabs fit in a
typical desktop viewport).

Default tab on open: **Test**. Tab selection state lives in
`TestDetailPage`, not URL — switching tabs doesn't change the URL.

| # | Tab | Fields (existing field components, just regrouped) |
|---|---|---|
| 1 | **Test** | Material · Width (mm) · Height (mm) · Gap (mm) · Cell shape · Square cells · Hide axis labels · Aggregator + sampling caption |
| 2 | **Sweep** | X axis (param + min + max + steps) · Y axis (param + min + max + steps) · Rows |
| 3 | **Base params** | Power · Speed · Frequency · Density · Passes · Pulse width · Laser · Scan angle · Engraving direction (unidirectional) · Passes multi-pass angle mode |
| 4 | **Registration** | Mode (on / off) · QR size · ArUco size |

The "Base params" tab consolidates the existing **Engraving direction**
and **Passes (multi-pass angle)** sections into the same tab as the
recipe values, since they're all "burn behaviour" config.

#### 3a. Disabled-when-swept fields in Base params

If `spec.x_param === "power"` (or whatever value), the Power field in
the Base params tab renders **disabled** with a small caption /
tooltip: `"Overridden by X-axis sweep"`. Same logic for `y_param`. The
visual treatment is a greyed input with an explanatory hint underneath
(or a `title` attribute, depending on what frontend-design recommends).

This applies to all swept-able fields: power, speed, frequency,
density, passes, pulse_width, scan_angle. (`laser` is not swept.)

The disabled state is **visual only** — the spec still stores a
base value for that field; the backend uses it as fallback if the
sweep range somehow excludes a cell, and it's needed for the
preview / generate paths. Disabling just blocks the user from
editing a value that won't take effect on burn cells.

### 4. Right column — preview + results

#### 4a. Top: TestPreview (compact)

- **Container**: full width of the right column, **~160 px tall**.
- **Content**: existing `TestPreview` component, scaled to fit via
  object-contain. Most tests are wider than tall in burn space, so
  most will fill the width with vertical letterboxing inside the
  160 px box.
- **Frame**: keeps the existing border + lab-notebook crop marks
  treatment so it still reads as the "blueprint" preview.
- **Purpose**: at-a-glance "yes this is the layout I expect" check —
  not the place to inspect the test in detail. (The Loom and
  full-detail viewers exist elsewhere if needed.)

#### 4b. Bottom: ResultsPanel (scrollable)

- **Container**: `flex-1` below the preview, with `overflow-y: auto`
  on the inner content wrapper.
- **Content**: existing `ResultsPanel` component, no behaviour
  changes. The internal sections (uploads list with ⚠ pill / ↻
  Reingest / exclude / delete; averaged swatches sub-section with
  selection + Ingest button) all stay as-is.
- **Scroll**: only the results panel scrolls. The preview stays
  pinned above it, the header stays pinned at the top, and the page
  itself never scrolls.
- **Custom scrollbar styling** (delegated to frontend-design) so the
  scroll affordance matches the workshop-instrument register
  rather than the browser default.

### 5. Frontend-design treatment

The new tabs, compact preview frame, and scroll affordance get
designed via the `frontend-design` agent at implementation time.
Brief for the agent:

- **Tab bar**: workshop-instrument vocabulary. JetBrains Mono labels,
  tracking-tight uppercase, MetalBar-style underline on the active
  tab. Hover states. Should feel like the toggle pills in TopBar
  (Guide / Log / Upload) — that's the right register reference.
- **Preview frame**: keep the existing lab-notebook crop marks and
  border treatment, just compact. Possibly add a subtle "scaled
  preview" caption/annotation so users understand it's not full
  size.
- **Scroll affordance** on the results panel: thin custom
  scrollbar matching the border colour palette, not the browser
  default. A subtle "fade" gradient at the top + bottom of the
  scroll region so users see content extends.
- **Disabled-when-swept** field in Base params: greyed background +
  muted text + a small inline caption "Overridden by X-axis sweep"
  in the muted-foreground colour. Don't hide the value — show what
  the base would be if the sweep weren't active.

### 6. Components

| File | Action | Responsibility |
|---|---|---|
| `web/src/pages/TestDetailPage.tsx` | **Refactor** | Switch from PageContainer + 3-column grid to viewport-flex-column with 2-column body grid. Lift tab-selection state. Remove the Material `<Field>` from above the editor. |
| `web/src/components/ParamTestEditor.tsx` | **Refactor** | Take a new `tab` prop and render only that tab's fields. Existing per-section JSX gets reorganised into 4 tab branches. Material gets moved IN as a new field. Disabled-when-swept treatment added to Base params fields. |
| `web/src/components/TestPreview.tsx` | **Modify** | Accept a `compact` boolean (or just always run in fixed-160-tall mode here). The component already does object-contain scaling; the change is sizing only. |
| `web/src/components/ResultsPanel.tsx` | **Modify** | Wrap existing content in a flex-grow + overflow-y: auto container. Keep all behaviour identical otherwise. |
| `web/src/ui/Tabs.tsx` (or co-located) | **Create** | Small headless tabs primitive: `<Tabs value, onChange, items: { id, label }[]>` rendering the bar; the active tab's content is rendered by the parent. Visual treatment from frontend-design. |

### 7. Data flow

Unchanged. The redesign is purely presentational:

- Spec / test / materials / presets fetched the same way in
  `TestDetailPage`.
- `ParamTestEditor` still calls `updateSpec` for any field change.
- `TestPreview` still consumes `spec` + `testId`.
- `ResultsPanel` still calls `listResults` / `previewSwatches` /
  `inspectCell` / etc. Its internal scrolling doesn't affect the
  data model.

The only "new" derived state: which tab is active. Default `"test"`,
lives in `TestDetailPage` local state, no persistence.

### 8. Error handling

Unchanged from today. Existing error banner above the body grid
(`error` state at the top of `TestDetailPage`) renders the same way;
it stays inside the page-flex-column above the body grid. If the
banner pushes content slightly, that's fine — the body grid uses
remaining height.

### 9. Testing

- **Vitest**: a small render test for the new `Tabs` primitive
  (renders all tabs, calls `onChange` on click, applies an
  active class to the selected tab).
- **Vitest**: a render test for `TestDetailPage` — confirms only the
  Test tab's content is rendered initially, switching tab swaps the
  content.
- **Vitest**: ParamTestEditor — when `spec.x_param === "power"` is
  set, the Power field in the Base params tab is disabled. This is
  a small targeted test that protects the disabled-when-swept logic.
- **Manual**: open a test with 500+ results. Confirm the page
  doesn't scroll, only the results panel does. Confirm the preview
  + tab editor stay pinned in view.
- **Manual**: switch through all 4 tabs. Confirm the active tab's
  content matches the spec's mapping.
- **Manual**: change x_param to "power"; confirm the Power input in
  Base params reads disabled with the explanatory caption.

### 10. Files touched

| Path | Action |
|---|---|
| `web/src/pages/TestDetailPage.tsx` | Refactor layout. |
| `web/src/components/ParamTestEditor.tsx` | Reorganise into 4 tab branches; absorb Material; add disabled-when-swept logic. |
| `web/src/components/TestPreview.tsx` | Compact mode (fixed ~160 px height). |
| `web/src/components/ResultsPanel.tsx` | Wrap content in scrollable flex container. |
| `web/src/ui/Tabs.tsx` (new) | Headless tabs primitive. |
| `web/src/ui/index.ts` | Export Tabs. |
| Tests for above | New / extended vitest coverage per Section 9. |

No backend changes. No alembic migration. No API changes.

## Risks / open questions

- **Existing visual register lives in many places.** The new tabs need
  to feel native — frontend-design needs to study the existing
  TopBar pills, ResultDetailDialog's AggregatorControlBar, and the
  ChartLabel pattern to land in the right place.
- **The compact preview may be too small for tests with very dense
  grids.** A 9×9 colour-engrave grid scaled into 160px tall × ~480px
  wide gives ~17×17px per cell — readable. A 200-cell sweep would
  give ~2px per cell — useless. That's the trade-off; user explicitly
  framed the preview as a "quick visual safety check", not a detail
  view. If detail is needed, the existing TestPreview popup / Loom
  page covers it.
- **Locked tests** — the existing `locked` flag should still disable
  all tab fields except the always-editable Material and the test
  Name. Existing per-field `disabled` props handle this; the tab
  layout doesn't change locked behaviour.
- **TopBar height variability.** The page uses `h-[calc(100vh-Npx)]`
  where N depends on TopBar height. If TopBar height changes in the
  future, this needs revisiting. Implementation should pull the
  TopBar height from a known constant or use `flex-1` inside an
  outer screen-height flex.

## Out of scope follow-ups (parking lot)

- Drag-resizable column split.
- Persist last-selected tab in localStorage or URL.
- Tab keyboard navigation (arrow keys to move between tabs).
- A dedicated "scaled preview" mode for very-dense grids that shows
  a colour-only minimap (no labels / borders) so individual cells
  remain visually distinct at small sizes.
- Mobile / narrow-viewport responsive layout (today's design assumes
  ≥ 1280 px).
