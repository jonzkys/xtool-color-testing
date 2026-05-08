# Exposure Indices Page — Validation Document

**Audience:** anyone validating that the page does what it claims, that the formulas are right, and that the interactive behaviour matches the design.

**Page location:** `#/exposure` (top-bar nav: Materials → Exposure).

**Source code:**
- Backend math: `src/xcs_gen/laser_indices.py`
- Frontend page: `web/src/pages/ExposurePage.tsx`
- Frontend components: `web/src/components/exposure/`
- Phase-1 spec: `docs/superpowers/specs/2026-05-07-laser-exposure-indices-design.md`
- Phase-2 spec: `docs/superpowers/specs/2026-05-08-exposure-indices-exploration-design.md`

---

## 1. Purpose in one sentence

Given a material's palette of burnt colours, the page lets you ask: **does any of the laser parameters (or any combination of them) explain the colours you got?**

Phase 1 gave each palette entry six derived "exposure indices". Phase 2 (this page) lets you scatter-plot them against the entries' actual colours, scoped to a single material, and read off whatever signal is there.

---

## 2. The indices — formulas and what each means

All five are computed from the raw laser-recipe parameters of a palette entry. The function lives at
`src/xcs_gen/laser_indices.py::compute_indices` and is called once per row at insert time (and re-run on the whole palette by the `0022_palette_exposure_indices` migration's backfill).

**Inputs (raw recipe params):**

| Field | Symbol | Units | Notes |
|---|---|---|---|
| `power` | $P$ | % (controller setting) | xTool exposes this as a percentage; we **do not** trust it as wall-plug watts. Treated as opaque. |
| `speed` | $S$ | mm/s | Trustworthy as physical units (this matches xTool's documented interpretation). |
| `mopa_frequency` | $f$ | kHz | MOPA pulse rate. Trustworthy. |
| `pulse_width` | $\tau$ | ns | Snapped to a fixed preset list (`{2, 4, 6, 9, 13, 20, 30, 45, 60, 80, 100, 150, 200, 250, 350, 500}`). |
| `density` | $D$ | controller setting | xTool's "Density" knob. **We do not** treat it as lines/cm. Treated as opaque. |
| `repeat` | $R$ | passes (integer) | How many times the head crosses the same area. |

### 2.1 The formulas

```
pulse_spacing_mm        = S / (f × 1000)              [real mm]
line_spacing_index      = 1 / D                       [opaque, dimensionless]
line_spacing_mm         = NULL while density_model="opaque"
pulse_energy_index      = P / f                       [opaque]
pulse_intensity_index   = P / (f × τ)                 [opaque]
surface_exposure_index  = P × D × R / S               [opaque]
```

### 2.2 Worked example — `ProcessingParams` defaults

Defaults: `S=1000, P=50, D=100, f=65, τ=200, R=1`.

| Index | Calculation | Value |
|---|---|---|
| `pulse_spacing_mm` | `1000 / (65 × 1000)` | **0.01538 mm** |
| `line_spacing_index` | `1 / 100` | **0.01** |
| `line_spacing_mm` | (null while density_model="opaque") | `null` |
| `pulse_energy_index` | `50 / 65` | **0.7692** |
| `pulse_intensity_index` | `50 / (65 × 200)` | **0.003846** |
| `surface_exposure_index` | `50 × 100 × 1 / 1000` | **5.0** |

You can verify by opening any entry on the page and reading the right-rail INDICES section. The numbers should match the formulas to ~4 significant figures (we round display via `fmtIndexTick` and `fmt`).

### 2.3 Worked example — a real entry from your data

For the focused dot you screenshotted earlier (`#66616B`, `power=10.4, speed=800, frequency=125, density=5000, passes=2, pulse_width=200`):

| Index | Calculation | Expected | Page shows |
|---|---|---|---|
| `pulse_spacing_mm` | `800 / (125 × 1000)` | 0.006400 | 0.006400 ✓ |
| `line_spacing_index` | `1 / 5000` | 2.00e-4 | 2.00e-4 ✓ |
| `pulse_energy_index` | `10.4 / 125` | 0.0832 | 0.0832 ✓ |
| `pulse_intensity_index` | `10.4 / (125 × 200)` | 4.16e-4 | 4.16e-4 ✓ |
| `surface_exposure_index` | `10.4 × 5000 × 2 / 800` | 130.0 | 130.0 ✓ |

If those match on the live page, the math layer is correct.

### 2.4 What each index means physically

#### `pulse_spacing_mm`

The distance the laser head moves between two consecutive pulses, **along the scan direction**.

- Higher `speed` → wider spacing (sparser pulses).
- Higher `frequency` → tighter spacing (denser pulses).
- This is real, calibrated millimetres — both `speed` and `frequency` are trustworthy as physical units.

#### `line_spacing_index`

The reciprocal of the controller's "density" setting, dimensionless.

- xTool's `density` is *probably* lines per cm, but we don't trust it as such (different machines, different conventions). Treating it as opaque keeps us honest.
- `line_spacing_mm` is intentionally `null` on every row — it'll switch on once a calibrated `density_model` is wired in (phase 3).

#### `pulse_energy_index`

`power / frequency`. Captures: at fixed average power, how much energy the controller asks each individual pulse to carry, before the pulse-width spread distributes it over time.

- High power + low frequency → big punchy pulses.
- Low power + high frequency → many small pulses.
- It's the energy-per-pulse stand-in. Not joules — `power` is opaque.

#### `pulse_intensity_index`

`power / (frequency × pulse_width)`. Captures the **peak intensity** during a pulse — energy-per-pulse divided by pulse duration.

- Short pulse + low frequency at the same average power → very high peak intensity → ablation regime (dark/grey).
- Long pulse + high frequency at the same average power → low peak intensity → annealing regime (warm interferential colours).
- This is the axis that distinguishes "violent" pulses from "gentle" pulses **at the same total energy**.

#### `surface_exposure_index`

`power × density × repeat / speed`. Captures the **total exposure delivered per unit area** — a stand-in for fluence (J/cm²), if we trusted `power` and `density` as calibrated values.

- Frequency and pulse width **drop out**: they only redistribute the same total energy among more or fewer pulses; they don't change how much energy reaches each cm² over time.
- Two engravings with different frequencies but identical (`P × D × R / S`) deliver the same bulk energy to the surface — but the per-pulse character is different (see `pulse_intensity_index`).
- This is why on the page, varying frequency moves entries vertically (along `pulse_spacing` or `pulse_intensity` axes) but doesn't move them along `surface_exposure`.

### 2.5 The version stamp

Every row carries:
- `indices_formula_version` (currently `1`)
- `density_model` (currently `"opaque"`)
- `power_model` (currently `"controller_percent"`)

When calibration arrives (e.g. `density_model="lines_per_cm_calibrated"`), the formula version bumps and `xcs-gen recompute-indices` flushes the whole palette to the new version. The footer chip shows `v1 · heuristic indices, not calibrated values` so users don't misread the numbers as joules.

---

## 3. The page

A material-scoped exploration. Pick one material from the left rail, the page draws every palette entry on that material into the panels.

### 3.1 Layout (desktop, ≥ 1280 px)

```
┌──────────────────────────────────────────────────────────────────┐
│ TOP BAR   "How does the burn relate to laser dose?"             │
├────────────┬──────────────────────────────────┬─────────────────┤
│            │ MODE: [univariate | bivariate]   │ STATS           │
│  MATERIAL  │                                  │ ┌─────────────┐ │
│  picker    │    ┌────────────────────────┐    │ │ r = 0.84    │ │
│            │    │                        │    │ │ ρ = 0.78    │ │
│  SOURCES   │    │   SCATTER              │    │ │ slope ...   │ │
│  - average │    │   X = surface_exposure │    │ │ R² = 0.71   │ │
│  - manual  │    │   Y = L*               │    │ │ n = 47      │ │
│  - single  │    │                        │    │ └─────────────┘ │
│            │    │                        │    │                 │
│  X AXIS    │    └────────────────────────┘    │ FOCUSED         │
│            │                                  │ ┌──────┬──────┐ │
│  Y AXIS    │  ┌──────────────┬──────────────┐ │ │swatch│ disc │ │
│            │  │ HUE RIBBON   │ CORRELATIONS │ │ └──────┴──────┘ │
│            │  │ ordered by X │ |r| heatmap  │ │ RECIPE          │
│            │  └──────────────┴──────────────┘ │ power · 65 %    │
│            │                                  │ speed · 800     │
│            │  ┌──────────────────────────────┐│ ...             │
│            │  │ EXPOSURE BRUSH (drag handle) ││                 │
│            │  └──────────────────────────────┘│ INDICES         │
│            │                                  │ surface  130    │
│            │                                  │ pulse_int 4e-4  │
└────────────┴──────────────────────────────────┴─────────────────┘
```

### 3.2 Material scoping

The scope is *always* one material. Switching materials reloads the data, resets the brush, and clears any pinned focus. There's no overlay/compare mode — that's deferred to phase 2.5.

Materials are loaded from `GET /api/materials`. Palette entries are loaded with `GET /api/palette?material_id=<id>` (and the `validated_only=true` flag if the toggle is on). The `source` filter (averaged / single_result / manual) is applied client-side after fetch.

---

## 4. The panels — what they show, what they're for

### 4.1 Main scatter

The hero. One dot per palette entry, **dot fill = entry's actual swatch hex**. White stroke around each dot for legibility.

**X-axis options** (left rail "X AXIS"):
- `pulse_spacing_mm`
- `line_spacing_index`
- `pulse_energy_index`
- `pulse_intensity_index`
- `surface_exposure_index` (default)

Each axis has a `lin / log` toggle. Default is **log** for the three index-typed values that span orders of magnitude (`surface_exposure`, `pulse_intensity`, `pulse_energy`); **linear** for the two spatial values.

**Y-axis options:**
- **Univariate mode** (default): one of `L*`, `a*`, `b*`, `hue (°)`, `chroma`. The chart asks "does this index drive this colour channel?"
- **Bivariate mode**: one of the four other indices. The chart asks "do two indices together separate the colour clusters better than one alone?" Dots remain coloured by swatch hex; no Y-channel meaning.

The mode toggle sits at the top of the chart card.

**Decoration:**
- **Regression overlay** — a dashed amber log-linear fit, rendered only in univariate mode (in bivariate mode neither axis is the "outcome" so a regression would mislead).
- **Focus halo + crosshair guides** — dashed orange lines through the focused dot's X and Y; a 2 px ring around the dot.
- **Brush dim** — entries whose `surface_exposure_index` falls outside the bottom Exposure Brush range render at 15 % opacity.

**5 % bounds margin** — the rendered axis range is padded by 5 % of the data range on each side so dots don't sit on the frame edge. The regression line endpoints still snap to the actual data extent.

### 4.2 Hue Ribbon (centre, below scatter)

A horizontal strip of every entry's swatch, **ordered ascending by the current X axis**. Each entry is one tile, tiles share the panel width equally.

**What success looks like:** if the X axis really drives the colour, the ribbon reads as a smooth gradient. A noisy or unrelated relationship makes the ribbon look scrambled. This is the visual sanity check on the regression line.

**Focus mark** — a thin orange tick + the word "FOCUSED" appears above the focused entry's tile.

**Brush dim** is mirrored from the scatter.

### 4.3 Correlations Matrix (centre, beside ribbon)

A 5 × 5 heatmap of `|r|` between every (`index`, `colour channel`) pair.

- **Rows** are the 5 indices: `PSp` (pulse spacing), `LSp` (line spacing), `PEn` (pulse energy), `PIn` (pulse intensity), `SEx` (surface exposure).
- **Columns** are the 5 channels: `L*`, `a*`, `b*`, `hue`, `chroma`.
- **Cell colour intensity** is proportional to `|r|`, mapped via `color-mix(in oklch, var(--color-ink) <pct>%, var(--color-surface))` so contrast scales smoothly from 0 → 1.
- **Numeric label** appears only on cells with `|r| ≥ 0.7` (avoids clutter at low correlations); the value is rendered as `Math.round(|r| × 100)`.
- **Selected cell** (the one matching the current scatter axes in univariate mode) gets an outlined `var(--color-primary)` border.
- **Click any cell** → switches the scatter's X to that row's index and Y to that column's channel (univariate mode only).

### 4.4 Right rail — Stats

Top of the right rail. The hero is **`r = <value>`** (Pearson) in 28 px bold. Beneath it: Spearman ρ, R², slope, n.

- **Pearson r** uses `pearson(xs, ys)` from `exposureMath.ts`. Drops NaN rows; returns NaN on `n < 2` or zero variance.
- **Spearman ρ** uses `spearman(xs, ys)` — Pearson on average ranks (handles ties).
- **R²** comes from `logLinearRegression(xs, ys).r2` — fitted `y = a + b·log10(x)`. Will be NaN in univariate mode if X has zero variance, and a not-particularly-meaningful number in bivariate mode (the spec adds an italic caveat in that case).
- **Slope** is the same regression's `slope` — units are "Y per decade of X" when log scale on X, or "Y per unit of X" when linear.
- **n** is the count of rows actually used (after NaN scrubbing).

**Important caveat:** stats are computed on **all** in-scope rows, *not* just the brush-visible ones. The brush only dims the visual. Raw data going into the stats is unfiltered by the brush. If you want stats over a brush-restricted subset, that's a phase-2.5 enhancement.

### 4.5 Right rail — Focused card

**Idle state** (no hover, no pin):
- The chromaticity disc fills, with all entries plotted as small swatch-coloured dots.
- "Hover or click any dot to inspect" placeholder where the recipe / indices would go.

**Active state** (hovered or pinned):
- A 120 × 120 swatch tile of the focused entry's hex, with the hex string overlaid.
- The disc, with a crosshair + outer ring on the focused entry's `(a*, b*)` position. The disc is conventional CIE Lab orientation: `+b*` up (yellow), `+a*` right (red), concentric rings at chroma 20/40/60.
- **Recipe** — a vertical list of the entry's raw params (power, speed, frequency, density, passes, pulse_width).
- **Indices** — the same five values you'd see in the chip strip, with the **current X-axis index highlighted** in primary orange.

A **clear** button appears in the rail header when something is focused; clicking it unpins.

### 4.6 Bottom Exposure Brush

A thin tile strip at the bottom of the main column, showing every entry's swatch ordered ascending by `surface_exposure_index` on a **log scale**.

- Two drag handles select an `[lo, hi]` range.
- **Anchor: always `surface_exposure_index`**, regardless of which X axis the scatter is using. This is intentional — the brush is the project's reference axis for "how much energy did this burn get".
- Out-of-range entries dim to 15 % on the scatter, ribbon, and focused-card disc.
- Brush range resets to "all" when the material changes.

---

## 5. Interaction model

```
hover any dot/tile        → transient focus (cleared on mouse-out)
click any dot/tile        → pinned focus  (sticks across mouse-out)
click an empty area       → clears any pinned focus
click the same dot twice  → unpins (toggle)
```

Internally:
- `transientFocusId` is set on hover, cleared on leave/click.
- `pinnedFocusId` is toggled on click.
- The displayed focus is `transientFocusId ?? pinnedFocusId`.

Focus propagates everywhere: scatter halo + crosshair guides, ribbon mark, disc crosshair + outer ring, full focused-card readout.

**One subtle implementation detail:** dot/tile click handlers call `e.stopPropagation()` to prevent the parent panel's "click empty area to clear" handler from running on the same event. Otherwise the click would set the pin and the bubbled background-click would clear it in the same frame.

---

## 6. Filters

| Filter | Where applied | Notes |
|---|---|---|
| **Material** | API (`material_id` query param) | Always exactly one. Required scope. |
| **Source** (averaged/single_result/manual) | Client-side, post-fetch | Stored in component state (not persisted across reloads in phase 2). |
| **Validated only** | API (`validated_only=true`) | Toggle in left rail. |
| **Brush range** | Visual dim only — does NOT filter | Dims the scatter/ribbon/disc; the stats still use the unfiltered set. |

---

## 7. Edge cases the page handles

- **Material has 0 entries:** EmptyState card with copy "No exposure data yet".
- **Material has 1 entry:** scatter renders a single dot; stats panel shows `n=1`, all correlation values are `—`.
- **Material has 2 entries:** correlations are usually degenerate (`|r| = 1.0` for any pair); shown as-is.
- **Bivariate same-index:** if X = Y, the page nudges Y to the next available index (no toast, just silent fix).
- **Stale formula version:** rows with `indices_formula_version=0` are excluded from the correlations matrix. They still render as dots but their indices field will be NaN.

---

## 8. Known limitations / caveats

1. **Pearson r on hue is mathematically wrong but visually instructive.** Hue is *circular* — 4° and 342° are 22° apart, not 338°. Linear correlation doesn't respect this. The `r =` value at the top is reliable for `L*`/`a*`/`b*`/`chroma` but should be read with skepticism on the `hue` axis. Fix queued.

2. **Vertical and horizontal columns** — when a sweep varies one or two parameters at a time (the natural way to test), the OTHER indices stay constant for that whole sweep, producing dense column/line patterns. The chart is being mathematically faithful, but it can hide the analytic signal when one specific param is the variable. Phase-2.5 "recipe-family traces" + "filter to one sweep" address this.

3. **`surface_exposure` doesn't depend on frequency** — by design (frequency cancels in the bulk-fluence formula). This is correct physics but counterintuitive at first glance. Frequency's effect on colour comes through `pulse_intensity_index`, which the bivariate mode + the correlations matrix surface.

4. **Power and density are opaque controller settings.** Calibration is phase 3. Until then, "fluence" is in heuristic units, not joules. The page never claims joules.

5. **Brush doesn't filter the stats**, only dims them visually. Surprising but consistent — the stats describe the whole scope; the brush is a focusing aid, not a slice. If you want stats over a slice, that's queued.

6. **fmtIndexTick** is the new axis-label formatter (introduced in the bug-fix pass). Earlier the chart used `fmtTick` from `stabilityChartMath`, which clamps to 2 decimals — fine for `L*` (0–100) but useless for sub-decimal indices like `pulse_intensity` (~1e-4). The new formatter uses fixed notation in `[1e-3, 1e5]` and exponential outside.

---

## 9. Validation checklist

Run these against the live page (server on port 8017, your local DB):

### 9.1 Index math (Section 2)
- [ ] Pick any palette entry. Read its raw recipe (power, speed, freq, density, passes, pulse_width). Compute the five indices by hand. Confirm the page shows them to 4 sig figs.
- [ ] Repeat for an entry where one index would be very small (e.g., low power on stainless). Confirm `fmtIndexTick` renders it readably (not `0.00`).
- [ ] Confirm `line_spacing_mm` is `—` everywhere (because `density_model="opaque"`).
- [ ] Open the chip-strip footer on any entry — confirm it reads `v1 · heuristic indices, not calibrated values`.

### 9.2 Scatter behaviour (Section 4.1)
- [ ] Switch X through all 5 indices. Confirm `pulse_spacing` is linear by default; the others are log by default.
- [ ] Toggle log → linear and back. Tick labels should reformat.
- [ ] Switch to bivariate. Confirm Y dropdown lists indices, not channels. Confirm the regression line disappears.
- [ ] Confirm dots have ~5% breathing room from the frame on all 4 sides.

### 9.3 Hue ribbon (Section 4.2)
- [ ] Switch X axis. Confirm the ribbon **reorders**.
- [ ] On `surface_exposure` (your default), the ribbon should read as a clean gradient (light → dark) on stainless. If yes, the "exposure drives lightness" claim holds.
- [ ] Hover a tile → the focused-card fills, and a tick marker appears above the same tile.

### 9.4 Correlations matrix (Section 4.3)
- [ ] On stainless, the `(SEx, L*)` cell should be the highest-magnitude `|r|` (your data shows `r = -0.84`, so cell value `84`).
- [ ] Click another cell → scatter axes switch to that pair.
- [ ] Cells with `|r| < 0.7` should render colour only, no number.

### 9.5 Stats (Section 4.4)
- [ ] Hero `r =` updates as you change axes.
- [ ] Bivariate mode shows the italic "No Y outcome" caveat.
- [ ] When `n < 3`, R² should be `—`.

### 9.6 Focused card (Section 4.5)
- [ ] Idle state: disc visible, recipe area shows the placeholder. No swatch tile.
- [ ] Hover a dot → swatch tile + recipe + indices appear.
- [ ] Click a dot → state pins (stays after mouse-out). Hover other dots — the displayed entry temporarily changes (transient overrides pin); on mouse-out, the pinned entry returns.
- [ ] The current X-axis index in the INDICES list is highlighted orange.
- [ ] "Clear" button in the rail header appears when something is focused.

### 9.7 Brush (Section 4.6)
- [ ] Drag the brush handles. Out-of-range entries on the scatter dim to ~15%.
- [ ] Confirm the brush is anchored to `surface_exposure_index` even when X is something else (per design).
- [ ] Confirm the stats hero **does not change** when you brush (brush is dim-only). This is intentional but worth knowing.
- [ ] Click "clear" — brush resets.

### 9.8 Material switch
- [ ] Pick a different material. Brush resets. Pinned focus clears. Data reloads.

### 9.9 Edge cases (Section 7)
- [ ] Pick a material with one entry — confirm correlations show `—`.
- [ ] Pick an empty material — confirm EmptyState renders.

---

## 10. Where the bugs / gaps queue stands

Already shipped fixes:
- ✅ Dot click no longer deselects (event-bubble fix on dots/tiles).
- ✅ Focused card halo is the click target (annular ring fix).
- ✅ Axis tick labels readable for sub-decimal values (`fmtIndexTick`).
- ✅ Dots no longer sit on the frame edge (5 % bounds margin).

Queued for phase 2.5:
- **A** — recipe-family trajectories (connect dots that came from one parameter sweep).
- **C** — "filter to this recipe family" on a focused entry (isolate one sweep).
- **D** — link from a focused entry to its source test page (`#/tests/<id>`).

Queued for further follow-up (no agreed scope yet):
- Circular-aware correlation on hue (instead of plain Pearson).
- Optional brush filtering of stats (vs. dim-only).
- Multi-material compare overlay.
- Saved-spectrum trace overlay (when an entry came from a saved spectrum, draw the path).
- Predictive parameter selection ("given this colour on this material, here's a recipe").
