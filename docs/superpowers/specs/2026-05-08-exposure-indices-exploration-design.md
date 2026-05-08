# Exposure Indices Exploration Page — Design Spec

**Date:** 2026-05-08
**Status:** Approved (design); awaiting implementation plan
**Branch:** new branch off `main` (separate from any in-flight work)
**Predecessor:** `docs/superpowers/specs/2026-05-07-laser-exposure-indices-design.md` (phase 1 — the indices themselves; landed in PR #77, alembic 0022, available on every palette entry).
**Implementation skill:** `frontend-design` (final visual treatment), `writing-plans` (next).

## Summary

A new top-level page at `#/exposure` that lets the user explore how
the six **laser exposure indices** (`pulse_spacing_mm`,
`line_spacing_index`, `pulse_energy_index`, `pulse_intensity_index`,
`surface_exposure_index`, plus the optional calibrated `line_spacing_mm`)
relate to the colours in their palette, scoped to a single material.
The page asks: *if I change this index, does the colour change?*
And: *do two indices together separate the colour clusters better than
one alone?*

The shape is a Workshop Dashboard — left rail for material + filters
+ axis selectors, a configurable scatter dominating the centre, a Hue
Ribbon and Correlations Matrix below it, and a right rail with a
hero correlation stat plus a Focused-cell card that hosts an a*/b*
chromaticity disc with a crosshair tracking the focused entry. A
bottom exposure-range brush filters every chart.

## Goals

- Material-scoped exploration: user picks one material and the page
  shows only that material's palette entries.
- Configurable scatter: any of the 5 indices on X, either a colour
  channel (univariate mode) or another index (bivariate mode) on Y.
- Visible correlation: a hero `r = …` value, plus a 5×N correlations
  matrix surfacing every (index, channel) pair.
- Visible focused entry: hover or click any dot anywhere on the page
  and the focus propagates — scatter halo, ribbon position marker,
  disc crosshair, full recipe + indices readout in the right rail.
- Visual proof in colour: the Hue Ribbon shows every entry's actual
  swatch in the order of the X axis. Trends in colour read down the
  ribbon at a glance.
- Final visual treatment matches the Workshop Instrument design
  language already in use on Stability, Spectrum, and the palette
  page (light theme, JetBrains Mono numerics, design-token CSS
  variables — same discipline as `PaletteIndicesChips`).

## Non-goals (phase 2)

- **Multi-material comparison.** Single-material focus only.
  Comparing materials side-by-side is its own design (phase 2.5)
  and lands separately. The data layer should not preclude it; the
  UI does not show a second-material picker.
- **Predictive parameter selection.** "Given a target colour, find a
  parameter triple in the same exposure neighbourhood" is phase 3
  and depends on this page existing first.
- **Calibration UI.** This page reads `density_model` /
  `power_model` from the indices block but does not let users
  change them. Calibration lands separately.
- **Saved-spectrum / capture-cell views.** This page reads palette
  entries only. Surfacing indices on saved-spectrum swatches and
  capture cells is mentioned in the phase 1 spec as a separate
  follow-up.
- **3D plots, WebGL, or external chart libraries.** All charts are
  hand-written SVG using the same primitives the Stability page
  uses (`stabilityChartMath`, `stabilityChartLayers`). Stays
  consistent with the codebase's existing chart vocabulary.

## Page route and shell

- New top-level route: `#/exposure` (add to `web/src/router.ts`
  alongside `#/stability`, `#/spectrum`, etc.).
- Optional deep-link form: `#/exposure/<material_id>` to pre-select
  a material from a link (e.g. from a palette entry context menu in
  a future iteration). For phase 2, the page also accepts no
  material id and defaults to the user's most-populated material.
- TopBar already has nav slots; add an "Exposure" link in the same
  group as Stability, Spectrum, Palette.

## Layout

A single-screen, no-scroll layout at typical workbench widths
(≥1280 px). At narrower widths the right rail collapses below the
main column.

```
┌──────────────────────────────────────────────────────────────────┐
│ TOP BAR · "EXPOSURE INDICES · <MATERIAL>"  · N=N entries · v1   │
├────────────┬──────────────────────────────────┬─────────────────┤
│            │                                  │                 │
│  MATERIAL  │  [mode: univariate | bivariate]  │  STATS          │
│  picker    │                                  │  ┌───────────┐  │
│            │  ┌────────────────────────────┐  │  │ r = 0.84  │  │
│  X AXIS    │  │                            │  │  │ ρ = 0.78  │  │
│  ▾ menu    │  │   SCATTER                  │  │  │ slope=…   │  │
│  [lin/log] │  │   X = surface_exposure_idx │  │  │ R² = 0.71 │  │
│            │  │   Y = L*                   │  │  └───────────┘  │
│  Y AXIS    │  │   dots = swatch hex        │  │                 │
│  ▾ menu    │  │   regression line          │  │  FOCUSED        │
│  [lin/log] │  │   focused-cell halo        │  │  ┌─────┬─────┐  │
│            │  │                            │  │  │swatch│disc │  │
│  FILTERS   │  └────────────────────────────┘  │  └─────┴─────┘  │
│  - source  │                                  │                 │
│  - validated │  ┌────────────────┬─────────┐ │  RECIPE         │
│  - formula │  │ HUE RIBBON     │ CORREL  │  │  power · 65%    │
│    version │  │ (ordered by X) │ MATRIX  │  │  speed · 800    │
│            │  └────────────────┴─────────┘  │  …              │
│            │                                  │                 │
│            │                                  │  INDICES        │
│            │                                  │  surface_exp.84 │
│            │                                  │  pulse_int.018  │
│            ├──────────────────────────────────┴─────────────────┤
│            │ EXPOSURE BRUSH · drag handles to filter every chart│
└────────────┴────────────────────────────────────────────────────┘
```

The right rail is fixed-width (~340 px) at desktop sizes; the main
column is fluid. Bottom brush spans the full width minus left rail.

## The five panels

### 1. Main scatter

- SVG scatter, dot per palette entry, dot fill = entry's actual swatch hex.
- White stroke (~0.4 px) around each dot for legibility against
  similarly-coloured neighbours.
- Configurable axes (see *Axis vocabulary* below).
- Default regression overlay: a dashed log-linear fit when the X axis
  is numeric and Y axis is a colour channel (univariate mode). Toggle
  on/off via a small button in the chart toolbar. No fit drawn in
  bivariate mode (would mislead — neither axis is the "outcome").
- Focused-cell decoration: dashed crosshair guides through the
  focused dot's X / Y; halo ring around the dot itself. Mirrors
  Stability's `ScatterFocusHalos` component — reuse where possible.
- Hover-to-inspect tooltip: the same vocabulary as
  `stabilityChartTooltip` — minimal, mono-numeric, hex shown.
- Mode switcher (top of the chart):

  | Mode | X = | Y = | Use |
  |---|---|---|---|
  | **Univariate** | one of 5 indices | a colour channel | "does this index drive this channel?" |
  | **Bivariate** | one of 5 indices | another of 5 indices | "do two indices together separate colour clusters?" |

### 2. Hue Ribbon (centre, below scatter)

- Horizontal strip of every entry's swatch, ordered by the current X axis.
- Dimensions: ~320 × 60 px at default desktop, with each swatch
  rendered as a tile at width = `panel_width / N` (so ribbon scales
  with N).
- Order: **always by the current X axis**, so switching X reorders the ribbon.
  This is the "trend visible in colour" affordance — a successful
  index/colour relationship makes the ribbon read as a smooth
  gradient; a noisy one looks scrambled.
- Focused-cell decoration: vertical orange tick + small "focused"
  label above the focused entry's tile.
- Hover any tile to set transient focus; click to pin (same
  semantics as scatter dots).

### 3. Correlations Matrix (centre, beside ribbon)

- A 5-row × ~6-column heatmap.
- Rows = the 5 indices (`PSp`, `LSp`, `PEn`, `PIn`, `SEx`).
- Columns = the colour channels available as univariate Y (`L*`,
  `a*`, `b*`, `hue`, `chroma`).
- Cell colour = `|r|` (absolute Pearson correlation), mapped on a
  light → dark gradient using the project's amber accent.
- The cell whose (index, channel) corresponds to the current axis
  selection is outlined; clicking another cell switches the scatter
  to that pair.
- Numbers visible only on the cell with `|r| ≥ 0.7` (avoids clutter
  on weak correlations); the rest show colour only, with `|r|` in a
  hover tooltip.

### 4. Right rail — Stats

- Hero stat: a large `r = 0.84` value (Pearson) for the current
  axis pair. Updates as axes change.
- Supporting stats below: Spearman ρ, slope (in `L*` units per decade
  if X is log-scaled, or per unit if linear), R², N (count after
  filters).
- Italic note when bivariate mode is active: "no Y outcome — values
  are colour-cluster coordinates only".

### 5. Right rail — Focused card

- **Idle state** (no hover, no pin): full chromaticity disc with all
  entries plotted as dots in their swatch hex. No crosshair. The
  recipe / indices section below is replaced by a placeholder
  "hover or click any dot to inspect".
- **Active state** (hovered or pinned):
  - Top-left: a 120×120 hex swatch of the focused entry's colour
    with the hex string overlaid.
  - Top-right: an a*/b* chromaticity disc (~160×120 box) showing
    every entry plus a crosshair + outer ring on the focused entry.
    Reveals the focused colour's hue family at a glance.
  - Below: full **Recipe** readout — power, speed, frequency,
    density, passes — and a full **Indices** readout for that entry,
    with the current X-axis index emphasised.

The disc's vertical axis is `+b*` up (yellow), horizontal is `+a*`
right (red). Concentric rings at chroma = 20, 40, 60. Conventional
CIE Lab orientation.

## Axis vocabulary

### X axis (5 options)

| Key | Label | Default scale |
|---|---|---|
| `surface_exposure_index` | Surface exposure | log |
| `pulse_intensity_index` | Pulse intensity | log |
| `pulse_energy_index` | Pulse energy | log |
| `pulse_spacing_mm` | Pulse spacing (mm) | linear |
| `line_spacing_index` | Line spacing index | linear |

Each axis ships with a `lin / log` toggle. Default scale is
log-axis for the three "index"-typed values that span orders of
magnitude in realistic data; linear for the two spatial values.

### Y axis — univariate mode (5 options)

| Key | Label | Default scale |
|---|---|---|
| `lab_l` | L* (lightness) | linear |
| `lab_a` | a* (red ↔ green) | linear |
| `lab_b` | b* (yellow ↔ blue) | linear |
| `hue` | hue (°) | linear, wraps 0–360 |
| `chroma` | chroma (√(a²+b²)) | linear |

The page derives `hue` and `chroma` client-side from `lab_a` /
`lab_b` (no new backend field needed).

### Y axis — bivariate mode (4 options)

When the user toggles **bivariate**, Y becomes one of the 4
remaining indices (whichever one isn't already on X). Same scale
toggle. Dots remain coloured by swatch hex. No regression line.

## Filters (left rail, below axis selectors)

- **Material picker** (the page's primary scope; required).
  Dropdown of every material with at least one palette entry.
  Counts shown beside the name.
- **Source filter** (multi-select): `averaged`, `single_result`,
  `manual`. Default: `averaged + manual` (excludes the noisy
  single-result rows). Stored in localStorage across sessions.
- **Validated only** toggle: when on, only entries with
  `is_validated = true` show. Off by default.
- **Formula version** dropdown: defaults to "v1 (current)". Allows
  filtering to rows at older formula versions if a future
  formula change has happened. Hidden when only one version exists.

## Bottom Exposure Brush

- A wide horizontal strip showing the distribution of every
  entry's `surface_exposure_index` value as a band of swatches —
  a compact view of the same colour-by-exposure ordering as the
  Hue Ribbon, but always anchored to `surface_exposure_index`
  regardless of the X axis selection.
- Drag handles select an `[lo, hi]` range. The whole page filters
  to entries inside this range — scatter, ribbon, correlations
  matrix, stats, disc, all dim outside-range entries to ~15% opacity
  rather than removing them entirely (so the user can still see
  the broader context).
- The selection persists across axis changes but resets on material
  change.

## Interaction model

Mirrors the Stability page's transient/pinned focus pattern:

```
hover any dot/tile → transient focus (cleared on mouse out)
click any dot/tile → pinned focus (sticks until cleared)
click an empty area → clears any pinned focus
click the same dot twice → unpins (transient is then cleared on mouse out)
```

Focus propagates everywhere: scatter halo + crosshair guides, ribbon
position marker, disc crosshair + outer ring, correlations matrix
cell highlight, full focused-card readout in the right rail.

## Component decomposition

All new files live under `web/src/components/exposure/` for clean
boundaries; the page itself in `web/src/pages/`.

| File | Responsibility |
|---|---|
| `web/src/pages/ExposurePage.tsx` | Page shell — material/filter/axis state, fetches data, renders layout |
| `web/src/components/exposure/ExposureScatter.tsx` | The main scatter (univariate + bivariate). Reuses `stabilityChartMath` for axis math. |
| `web/src/components/exposure/ExposureHueRibbon.tsx` | The reordered swatch strip |
| `web/src/components/exposure/ExposureCorrelationMatrix.tsx` | 5×N heatmap of `|r|` per (index, channel) |
| `web/src/components/exposure/ExposureFocusedCard.tsx` | Right-rail focused-cell widget (swatch + disc + recipe + indices) |
| `web/src/components/exposure/ExposureChromaDisc.tsx` | The a*/b* disc — used inside `ExposureFocusedCard`, but factored so a future "compare materials" view can reuse it |
| `web/src/components/exposure/ExposureRangeBrush.tsx` | Bottom exposure-range brush |
| `web/src/components/exposure/exposureMath.ts` | Pure helpers — Pearson, Spearman, log-linear regression, hue/chroma derivation |
| `web/src/components/exposure/exposureMath.test.ts` | Unit tests for the math |
| `web/src/components/exposure/exposureCorrelations.ts` | Builds the 5×N correlation matrix from a list of palette entries |
| `web/src/components/exposure/exposureCorrelations.test.ts` | Unit tests for the matrix builder (dimensions, ordering, NaN handling) |

The page-level state (material, axes, mode, filters, focus) lives in
`ExposurePage.tsx` and is passed down. No global state needed.

## Data layer

### Backend

A new endpoint:

```
GET /api/exposure?material_id={id}
  &source=averaged,manual
  &validated=true|false
  &formula_version=1

→ 200 OK
[
  {
    "id": 42,
    "hex": "#5b3a1f",
    "lab": [28.4, 16.2, 18.8],
    "indices": { ...the same LaserIndicesResponse block ship in PR #77 },
    "params": { speed, power, density, frequency, passes, pulse_width },
    "source": "averaged",
    "is_validated": true,
    "validated_lab": null | [L,a,b],
    "created_at": "..."
  },
  ...
]
```

This is essentially a thin wrapper around `palette_repo.list_all`
filtered by `material_id`, projected to the fields the page needs.
Reusing `GET /api/palette?material_id=...` is also viable (it
returns the full palette response, which already includes
`indices`); the trade-off is the existing endpoint returns more
fields than the page needs. **Recommendation:** reuse
`/api/palette?material_id=` for phase 2 — keeps the API surface
flat. The page projects what it needs client-side. If perf becomes
an issue at large N (e.g. > 500 entries), introduce the slimmer
endpoint then.

### Materials list

Reuse the existing `/api/materials` for the picker. Add a
client-side join with the palette listing to produce per-material
counts so the picker can show "Stainless · 47 entries" etc. (One
extra request per page load.)

## Edge cases

- **Material has 0 entries:** show an empty state in the main column
  with copy like "No palette entries on this material yet — burn a
  test and ingest results to populate." with a link to `#/tests/new`.
- **Material has 1 entry:** scatter renders a single dot. Stats
  panel shows N=1, all correlation values blank with a note "need
  at least 3 entries for correlation". Ribbon, disc, correlations
  matrix all render the single entry.
- **Material has 2 entries:** correlations are degenerate (always
  `|r| = 1.0`) — show a "noisy" caveat on the stats hero.
- **Bivariate mode with same index on both axes:** the page
  collapses Y to the next available index, with a brief toast
  ("X and Y can't be the same index — switched Y to pulse_intensity").
- **Stale formula version (rare):** entries with
  `formula_version != INDICES_FORMULA_VERSION` are excluded from
  correlation calculations by default; user can toggle them in via
  the formula-version filter. The hero stats show `[stale entries
  excluded]` when this happens.
- **No materials at all:** the same EmptyState as PalettePage shows
  ("No materials yet — add one in Library first"), with a button to
  `#/library`.

## Testing

- **Unit tests** (vitest):
  - `exposureMath.test.ts`: Pearson and Spearman implementations
    against a fixed table of expected values; log-linear regression
    against hand-computed slope/intercept; hue/chroma derivation
    matches the existing `color/math` module's vocabulary.
  - `exposureCorrelations.test.ts`: building the 5×N matrix from
    sample data; correct dimensions, correct ordering, NaN
    handling for entries with stale `formula_version`.
  - Component tests for the chip-strip-style discrete pieces:
    `ExposureChromaDisc.test.tsx` (renders all entries; crosshair
    appears for focused entry; respects 0/1/2-entry cases).
- **Integration tests:**
  - `ExposurePage.test.tsx`: page mounts, material selection wires
    through, axis change re-runs the scatter, filter changes
    propagate.
- **Manual Playwright walkthrough** before merge: real browser, real
  data, hover/click/brush across all panels, verify focus
  propagation works in every combination, take screenshot for
  changelog.

## Phase 2.5+ (out of scope, but enabled)

- **Multi-material comparison:** add a "compare with…" picker on the
  left rail; secondary material renders as smaller, lower-opacity
  ghost dots on the scatter and disc.
- **Saved-spectrum trace overlay:** when an entry comes from a saved
  spectrum (axis sweep), connect entries from the same source in
  X-axis order with a thin path. Reveals "this is what the
  parameter sweep traced through colour space".
- **Index isolines:** in bivariate mode, optionally overlay
  isocolour curves (lines of constant L*, or constant chroma) on
  the (index × index) plane. Reveals which colour bands sit at
  which exposure neighbourhoods.
- **Predictive selection:** click anywhere on the scatter and a
  "find recipe near this point" popover proposes parameter triples
  whose indices land close. Becomes phase 3.
- **Export the matrix:** download the correlation matrix as CSV /
  PNG for offline analysis.

## Open questions

None blocking phase 2. Two long-running questions remain — *how
does xTool's `density` map to physical line spacing?* and *how does
`power_percent` map to effective laser output?* — both deferred to
calibration work as in phase 1, with `density_model` /
`power_model` as the seams.
