# Exposure page — formula affordances & hover help cards

**Status:** design  
**Date:** 2026-05-09  
**Owner:** @jon  
**Touches:** `web/src/components/exposure/*`, `web/src/components/StabilityHelpTip.tsx`, `web/src/components/PaletteIndicesChips.tsx`, `web/src/pages/ExposurePage.tsx`

## Why

The exposure page exposes seven derived indices (`pulse_spacing_mm`,
`line_spacing_index`, `pulse_energy_index`, `pulse_intensity_index`,
`total_exposure_index`, `ablation_aggression_index`,
`delivery_smoothness_index`). Their names hint at what they measure
but say nothing about what's actually being computed — and the
correlation matrix shows them as 3-letter abbreviations (`TEx`, `AAg`,
`DSm`). A user landing on the page has to read the docs (or guess) to
interpret what they're looking at.

Stability already solved a near-identical problem: a hover-modal
`HelpTip` with `definition` + `guide` ("how to read it") + a small
schematic, fed by a per-axis copy table. We reuse that pattern,
extend it with a `formula` and labelled-`inputs` block, and wire it
into every place the indices appear on the exposure side. We also
add an always-visible "two-line" axis label so a user sees the
formula in plain words without having to fish.

## Constraints

- **Plain words, no Greek**: `power × density × passes ÷ speed`, not
  `P × D × R / S`. The user explicitly asked for full names — single
  letters and `τ` are not acceptable.
- **Don't overwhelm at first glance**: the always-visible second line
  is muted (smaller, subtle ink); rich content (definition, how-to-
  read-it, schematic) lives in the hover card.
- **Match stability's register**: same hover delays, same card width
  (340px), same heading/section typography, same a11y
  (`aria-describedby` while open, Esc closes).
- **No CIELab basics in the formula block**: `L*`, `a*`, `b*`, `h°`,
  `C*` get a thinner card — definition + guide only — because they
  aren't derived.

## Architecture

### Component layout

```
HelpTip.tsx                                ← generic, was StabilityHelpTip
├─ portal logic, hover delays, a11y       ← unchanged from stability
├─ Body: React.ComponentType<{help: H}>   ← supplied by call-site
└─ help: H                                 ← generic payload type

StabilityHelpCardBody.tsx                  ← extracted from current HelpTip
                                              renders AxisHelp (heading,
                                              schematic, definition, guide)

ExposureHelpCardBody.tsx                   ← new — three small body
                                              components for the variants:
  ├─ IndexCardBody    (heading + schematic + definition + guide
  │                     + formula + inputs + unit chip)
  ├─ ChannelCardBody  (heading + schematic + definition + guide)
  └─ RawParamCardBody (heading + definition + unit chip)

exposureHelpCopy.ts                        ← new
├─ ExposureIndexHelp        × 7            ← per-index entries
├─ ExposureChannelHelp      × 5            ← thinner channel entries
│                                             (L, a, b, hue, chroma)
└─ ExposureRawParamHelp     × 6            ← lightest variant
                                              (power, speed, frequency,
                                               density, passes, pulse_width)

ExposureHelpSchematic.tsx                  ← new — 5 family schematics
                                              matching the exposure register
```

`StabilityHelpTip.tsx` becomes a one-line shim re-exporting `HelpTip`
with `StabilityHelpCardBody` pre-bound. Keeps stability's call-sites
untouched.

### `ExposureIndexHelp` shape

```ts
export interface ExposureIndexHelp {
  /** ~3-4 word card heading. Sentence case. */
  heading: string;
  /** Output unit chip rendered after the heading. e.g. "mm", "dimensionless". */
  unit: string;
  /** ONE plain-English sentence: what the index IS. */
  definition: string;
  /** Words formula. Unicode × and ÷, no Greek, no abbreviations. */
  formula: string;
  /** Labelled list of inputs the formula references. */
  inputs: ReadonlyArray<{ name: string; unit: string }>;
  /** 1–3 sentences: how to read it / when it's useful. */
  guide: string;
  /** Family schematic key. */
  schematic: ExposureSchematicId;
}
```

`ExposureChannelHelp` drops `formula`, `inputs`, and `unit` (it's
just CIELab).

### Trigger sites

| Site | Trigger element | Card variant |
|---|---|---|
| `ExposureScatter` X-axis label | HTML overlay (was SVG `<text>`) | index full |
| `ExposureScatter` Y-axis label, bivariate | HTML overlay | index full |
| `ExposureScatter` Y-axis label, univariate | HTML overlay | channel-only |
| Left-rail `X axis` picker pills | each `RailPickerButton` | index full |
| Left-rail `Y axis` picker pills (bivariate) | each `RailPickerButton` | index full |
| Left-rail `Y axis` picker pills (univariate) | each `RailPickerButton` | channel-only |
| `ExposureCorrelationMatrix` index row labels | each row label `<div>` | index full |
| `ExposureCorrelationMatrix` raw-param row labels | each row label `<div>` | param-light (heading + one-line definition only) |
| `PaletteIndicesChips` (test detail / palette) | each `Chip` | index full |

The matrix cell `title=` native tooltips (showing `r = 0.42`) stay —
they're on the cells, not the labels, so they don't fight.

### The two-line scatter axis label

Currently `ExposureScatter` draws axis titles as SVG `<text>` nodes.
For a clean two-line layout *and* a usable HelpTip wrapper (which is
HTML-only), we replace them with absolutely-positioned HTML overlays:

```
<div className="relative">
  <svg ...>{/* dots, axis ticks */}</svg>

  {/* X-axis label, centered along the bottom */}
  <HelpTip help={xHelp} Body={ExposureHelpCardBody}>
    <div className="absolute left-1/2 -translate-x-1/2 bottom-0 text-center">
      <div className="font-mono uppercase tracking-[0.18em] text-[10px] font-semibold text-[color:var(--color-ink-subtle)]">
        TOTAL EXPOSURE
      </div>
      <div className="font-mono text-[9px] text-[color:var(--color-ink-subtle)] opacity-70">
        power × density × passes ÷ speed
      </div>
    </div>
  </HelpTip>

  {/* Y-axis label, rotated -90° on the left */}
  <HelpTip help={yHelp} Body={ExposureHelpCardBody}>
    <div className="absolute left-0 top-1/2 -translate-y-1/2 -rotate-90 origin-left">
      ...same two-line structure
    </div>
  </HelpTip>
</div>
```

A small `(i)` glyph appears next to the heading on hover — visual
cue that the label is interactive. Below-axis chrome (`PADB`) bumps
by ~14px to make room for the second line so dots aren't pushed.

### Card body layout

Top-to-bottom inside the 340px-wide card:

1. **Header strip** — `HEADING` (mono uppercase tracking-[0.18em]) + a
   small `unit` chip on the right.
2. **Two-column block** — left: 140×80 schematic (`ExposureHelpSchematic`).
   Right: `Definition` label + sentence; below it, `How to read it` +
   1–3 sentences. Same typography as stability.
3. **Formula** — full-width row, monospaced 11.5px medium-weight,
   `text-[color:var(--color-ink)]`. Indented to align with the
   right-column body.
4. **Inputs** — labelled list under the formula. Each row is
   `name · unit` in mono 10.5px. Compact (no bullet points), 4–6 rows.
5. Channel cards skip §3 and §4 entirely.

### `ExposureHelpSchematic` — five families

| Schematic id | Used by | Visual |
|---|---|---|
| `dot_pitch` | pulse_spacing_mm | Discrete dots along a horizontal line. Spacing labelled. |
| `line_pitch` | line_spacing_index | Stacked parallel hatch lines. Vertical pitch labelled. |
| `pulse_shape` | pulse_energy_index, pulse_intensity_index | One pulse waveform. Area shaded for energy variant; peak labelled for intensity variant. |
| `accumulation` | total_exposure_index | Multiple overlapping passes building density. |
| `combination` | ablation_aggression_index, delivery_smoothness_index | Two-arrow split: `×` variant arrows align (multiplicative); `÷` variant arrows oppose (smoothing). |

Same 140×80 viewBox, same stroke colour conventions
(`var(--color-primary)` 80% over `var(--color-border)`) so the visual
register matches stability.

## Copy — the seven entries

```ts
pulse_spacing_mm: {
  heading: "Pulse spacing",
  unit: "mm",
  definition:
    "Physical distance between successive laser pulses along a scan line.",
  formula: "speed ÷ (frequency × 1000)",
  inputs: [
    { name: "speed",      unit: "mm/s" },
    { name: "frequency",  unit: "kHz" },
  ],
  guide:
    "Smaller is denser coverage along the scan direction. Once spacing falls below the spot diameter, pulses start to overlap and the burn behaves as a continuous mark — bigger gains in colour from there usually mean more passes, not denser pulses.",
  schematic: "dot_pitch",
},

line_spacing_index: {
  heading: "Line spacing",
  unit: "dimensionless",
  definition:
    "Inverse of the controller's density setting — how far apart adjacent scan lines sit, in opaque controller units.",
  formula: "1 ÷ density",
  inputs: [
    { name: "density",  unit: "controller value (opaque)" },
  ],
  guide:
    "Higher means lines further apart, lower means denser hatching. xTool's density mapping isn't physical, so this stays opaque — calibration upgrades it to mm later.",
  schematic: "line_pitch",
},

pulse_energy_index: {
  heading: "Pulse energy",
  unit: "dimensionless",
  definition:
    "Energy delivered per pulse — controller power divided by repetition rate.",
  formula: "power ÷ frequency",
  inputs: [
    { name: "power",      unit: "% controller setting" },
    { name: "frequency",  unit: "kHz" },
  ],
  guide:
    "Higher means more energy in each individual pulse. Pair it against L* to see how a single pulse's energy maps to lightness; sustained increase here at fixed total exposure usually means deeper, more thermally-affected marks.",
  schematic: "pulse_shape",
},

pulse_intensity_index: {
  heading: "Pulse intensity",
  unit: "dimensionless",
  definition:
    "Peak intensity of a pulse — energy concentrated by the pulse-width compression.",
  formula: "power ÷ (frequency × pulse_width)",
  inputs: [
    { name: "power",        unit: "% controller setting" },
    { name: "frequency",    unit: "kHz" },
    { name: "pulse_width",  unit: "ns" },
  ],
  guide:
    "Higher intensity ablates rather than heats. The same energy delivered in a shorter pulse hits harder. Plotting against ΔE often separates ablation-driven colours (high here) from thermal-driven ones (low here).",
  schematic: "pulse_shape",
},

total_exposure_index: {
  heading: "Total exposure",
  unit: "dimensionless",
  definition:
    "Cumulative energy delivered per unit area across the burn.",
  formula: "power × density × passes ÷ speed",
  inputs: [
    { name: "power",    unit: "% controller setting" },
    { name: "density",  unit: "controller value (opaque)" },
    { name: "passes",   unit: "count" },
    { name: "speed",    unit: "mm/s" },
  ],
  guide:
    "The dose dial. Plotted against L*, this is usually the cleanest axis — burns get darker as exposure climbs. Plateaus or kinks mark the regime where colour stops responding to more dose and you need to vary something else.",
  schematic: "accumulation",
},

ablation_aggression_index: {
  heading: "Ablation aggression",
  unit: "dimensionless",
  definition:
    "Total exposure scaled by pulse intensity — high when both lots of energy AND sharp peaks are delivered.",
  formula: "(power × density × passes ÷ speed) × (power ÷ (frequency × pulse_width))",
  inputs: [
    { name: "power",        unit: "% controller setting" },
    { name: "density",      unit: "controller value (opaque)" },
    { name: "passes",       unit: "count" },
    { name: "speed",        unit: "mm/s" },
    { name: "frequency",    unit: "kHz" },
    { name: "pulse_width",  unit: "ns" },
  ],
  guide:
    "A combined indicator of how aggressive the burn is. Two recipes can share the same total exposure but differ wildly here — high aggression means the same dose is delivered as fewer, harder hits. Pair it against ΔE or chroma to spot regimes where aggression buys colour.",
  schematic: "combination",
},

delivery_smoothness_index: {
  heading: "Delivery smoothness",
  unit: "dimensionless",
  definition:
    "Total exposure divided by pulse intensity — high when energy is spread across many gentle pulses rather than few sharp ones.",
  formula: "(power × density × passes ÷ speed) ÷ (power ÷ (frequency × pulse_width))",
  inputs: [
    { name: "power",        unit: "% controller setting" },
    { name: "density",      unit: "controller value (opaque)" },
    { name: "passes",       unit: "count" },
    { name: "speed",        unit: "mm/s" },
    { name: "frequency",    unit: "kHz" },
    { name: "pulse_width",  unit: "ns" },
  ],
  guide:
    "Power cancels out, so this captures delivery pattern alone — same dose, smoother or spikier. High smoothness tends toward thermal/diffusion-driven colours; low smoothness toward ablation-driven ones.",
  schematic: "combination",
},
```

### Channel entries (5)

```ts
L: {
  heading: "Lightness L*",
  definition: "CIE Lab lightness — 0 black, 100 white.",
  guide:
    "The cleanest axis to plot against total exposure. A monotonic descent says dose translates straight into darkness; a knee or plateau marks the regime where the burn stops responding.",
  schematic: "residual",
},
a: {
  heading: "Red–green a*",
  definition: "CIE Lab red–green axis — positive is red, negative is green.",
  guide:
    "On stainless burns, sustained positive a* across a sweep often means a warm cast. Pair it against pulse intensity to see whether the warmth is energy-driven or delivery-driven.",
  schematic: "residual",
},
b: {
  heading: "Yellow–blue b*",
  definition: "CIE Lab yellow–blue axis — positive is yellow, negative is blue.",
  guide:
    "Char and scorching usually push b* positive. A diagonal trend against pulse energy often points at the regime where blues drop off the palette.",
  schematic: "residual",
},
hue: {
  heading: "Hue h°",
  definition: "Hue angle of the measured colour, 0–360°.",
  guide:
    "Plot hue against an exposure index to see how dose rotates the palette. Stable bands across the sweep mark hues your burn delivers reliably.",
  schematic: "wheel",
},
chroma: {
  heading: "Chroma C*",
  definition: "Distance from the neutral axis in CIE Lab — saturation.",
  guide:
    "High chroma with low total exposure flags efficient colour-per-dose; low chroma at high exposure usually means the burn has saturated to grey.",
  schematic: "magnitude",
},
```

Both `wheel` and `magnitude` are existing stability schematics. We
import them directly from `StabilityHelpSchematic` for the channel
cards rather than re-author them in `ExposureHelpSchematic`. The
`SchematicId` type for channel cards therefore aliases to
`stabilityHelpCopy.SchematicId`; index cards use the new
`ExposureSchematicId` type. This keeps the two card-body components
decoupled while sharing the schematic library.

### Raw-param entries (6)

The lightest variant — heading + one-line definition + unit only.
No formula, no inputs, no schematic. Used by the raw-param matrix
row labels (`PWR`, `SPD`, `FRQ`, `DEN`, `PSS`, `PWD`).

```ts
power: {
  heading: "Power",
  unit: "% controller setting",
  definition:
    "Controller power percentage. Maps to wall-plug watts in an opaque, model-specific way.",
},
speed: {
  heading: "Speed",
  unit: "mm/s",
  definition: "Linear speed of the laser head along a scan line.",
},
frequency: {
  heading: "Frequency",
  unit: "kHz",
  definition: "MOPA pulse repetition rate.",
},
density: {
  heading: "Density",
  unit: "controller value (opaque)",
  definition:
    "Controller density setting. Inversely related to scan-line spacing; mapping is non-physical.",
},
passes: {
  heading: "Passes",
  unit: "count",
  definition: "Number of times the burn pattern is repeated over the same area.",
},
pulse_width: {
  heading: "Pulse width",
  unit: "ns",
  definition: "Duration of each laser pulse, in nanoseconds.",
},
```

`ExposureRawParamHelp` shape:

```ts
export interface ExposureRawParamHelp {
  heading: string;
  unit: string;
  definition: string;
}
```

## Files touched

**New:**
- `web/src/components/HelpTip.tsx` (generic, refactored from `StabilityHelpTip.tsx`)
- `web/src/components/StabilityHelpCardBody.tsx` (extracted from current `StabilityHelpTip`)
- `web/src/components/exposure/exposureHelpCopy.ts`
- `web/src/components/exposure/ExposureHelpSchematic.tsx`
- `web/src/components/exposure/ExposureHelpCardBody.tsx` (exports `IndexCardBody`, `ChannelCardBody`, `RawParamCardBody`)
- Tests for each of the above.

**Modified:**
- `web/src/components/StabilityHelpTip.tsx` → one-line shim re-exporting `HelpTip<AxisHelp>` with `StabilityHelpCardBody` pre-bound. All existing stability call-sites unchanged.
- `web/src/components/exposure/ExposureScatter.tsx` — axis labels move from SVG `<text>` to absolutely-positioned HTML overlays; `PADB` bumps by ~14px.
- `web/src/pages/ExposurePage.tsx` — wraps left-rail picker buttons in `HelpTip`.
- `web/src/components/exposure/ExposureCorrelationMatrix.tsx` — row label `<div>`s become `HelpTip` wrappers (different card variant for index rows vs raw-param rows).
- `web/src/components/PaletteIndicesChips.tsx` — wraps each `Chip` in `HelpTip`.

## Test plan

- `HelpTip.test.tsx` — pre-existing stability tests run against the
  generalised component; one new test for the `Body` prop.
- `exposureHelpCopy.test.ts` — every `IndexRow`, channel key, and
  `RawParamRow` from `exposureCorrelations.ts` has a matching entry;
  all `inputs[].name` appear in the corresponding `formula` string;
  no entry uses single-letter input names.
- `ExposureHelpSchematic.test.tsx` — each schematic id renders an
  `<svg>` of the right viewBox; `aria-hidden` is set.
- `ExposureHelpCardBody.test.tsx` — `IndexCardBody` renders heading,
  unit chip, definition, guide, formula, and inputs in the right
  order; `ChannelCardBody` omits formula/inputs; `RawParamCardBody`
  omits the schematic and the formula/inputs blocks.
- `ExposureScatter.test.tsx` — axis-label `getByText('TOTAL EXPOSURE')`
  resolves against HTML now; second line `getByText('power × density × passes ÷ speed')` is present.
- `ExposurePage.test.tsx` — rail picker buttons have
  `role="tooltip"` accessible via the help-tip portal after hover (or
  programmatic focus).
- `PaletteIndicesChips.test.tsx` — chips wrap in HelpTip; clicking
  passes through (no regression on selection behaviour).

Hover-delay timing tests reuse the existing pattern from
`StabilityHelpTip.test.tsx` (`vi.useFakeTimers`, advance by
`OPEN_DELAY_MS`).

## Risks

- **Axis-label overlay alignment.** The chart uses fixed `W`/`H`
  constants, so absolute positioning is deterministic. If we ever
  switch to a responsive width, this becomes a measure-then-position
  job. Out of scope.
- **Card layered above the chart card border.** HelpTip portals to
  `document.body`, so it never clips against the scatter card or
  page rails.
- **Tab-key a11y on rotated Y label.** The `transform: rotate(-90deg)`
  div is still focusable; its bounding box is just wider-than-tall.
  Existing stability behaviour confirms this works.
- **Bundle weight.** Five small SVG schematics + ~12 copy entries =
  ~3 KB gzip. Negligible.

## Out of scope

- Calibration / non-opaque density-model branches — phase 3, separate
  spec.
- Brush-to-zoom on the scatter — already-queued enhancement.
- Configurable `n` for the neighbours panel — already-queued.
- Hover cards on the Hue Ribbon's bars (no per-bar anchor that maps
  back to a single index — they're sorted by index, not labelled).

## Decisions captured during brainstorming

- **Always-visible formula style: two-line axis label.** Index name on
  top, formula in plain words on a quieter second line. User chose
  this over a strip-below-chart approach because it keeps the formula
  bound to the axis it describes.
- **Hover depth: match stability fully.** Heading + definition +
  formula + how-to-read + schematic. User explicitly chose the rich
  variant.
- **Trigger scope.** Scatter axis labels, left-rail picker buttons,
  index chips on test/palette pages, correlation matrix index row
  labels. Raw-param matrix labels also get a lighter card (heading +
  one-line definition only) because they're already wired to the same
  matrix UI.
- **Plain-words formulas, no Greek.** `pulse_width`, not `τ`;
  `frequency`, not `f`. Per user's explicit request during
  clarification.
