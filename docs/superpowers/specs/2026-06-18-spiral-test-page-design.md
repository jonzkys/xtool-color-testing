# Spiral Test — 2D parameter-sweep page

**Date:** 2026-06-18
**Status:** Approved (design)

## Summary

A new support page (`#/spiral-test`) that generates a **2D grid of spiral-cut test
circles** and exports a single `.xs` file. The two grid axes sweep **channel
width** (X) and **pitch** (Y); every cell is the same circle cut with that cell's
channel/pitch geometry. The circle diameter and all laser/focus parameters are
configurable and **fixed across the grid**. Each cell carries a **small engraved
label** showing its swept values, so a cut sheet of N×M test discs is
self-identifying. No automation, no backend, no DB — pure client-side generation
and download, mirroring the existing Spiral page's file-out model.

Purpose: replace the slow loop of hand-generating or hand-editing single
calibration files when dialling in spiral-cut settings for thick material.

## Decisions (from brainstorming)

- **Axes:** X = channel width, Y = pitch. Each axis specified as **min / max /
  steps**, values spaced linearly (`lerp(min, max, i/(steps-1))`; a 1-step axis
  yields just `min`).
- **Circle size:** a **single fixed diameter** for the whole grid (not swept).
- **Labels:** a **per-cell engraved label** beside each circle (e.g.
  `0.80/0.040`), rendered with a built-in single-stroke font and cut as a
  separate low-power **score** operation.
- **Laser params are global, not swept.** Channel width and pitch are *geometry*
  baked into the spiral arms, so every cell shares one laser/focus parameter set
  → one cut operation (not a per-cell parameter sweep). Power/speed/passes/focus
  are set once and seeded from a thickness preset.
- **`side` defaults to `outside`** — the spiral channel sits in the scrap ring
  around each circle, severing the disc while leaving it full-size. Configurable.
- **Output: `.xs` only.** `.xcs` is being retired in xTool Studio. `.xs` is
  produced by `legacyRawToXs(rawDoc, null)`, which synthesizes a complete v2
  bundle (project/canvases/devices/profiles/resources) from the legacy raw model
  — so no `.xs` template file is needed.

## Architecture

Reuse the existing Forge **spiral geometry** (`spiralFromRegion`) and the **`.xs`
synthesis** (`legacyRawToXs`). The grid layout, the label font, and a focused
raw-document assembler are new. The assembler is dedicated rather than a reuse of
`buildGeneratedXcs`, because this page builds a document **from scratch** and
needs **two operations with different processing types** (a `VECTOR_CUTTING` cut
layer + a low-power score layer) — both awkward through `buildGeneratedXcs`, which
is built to replace a single incise object with one cut layer. Lower-level helpers
from `xcs.ts` (polyline→dPath, display/device-map templating) are reused/extracted
rather than duplicated.

### File structure

```
web/src/lib/forge/strokeFont.ts        NEW  single-stroke glyph table + renderLabel()
web/src/lib/forge/spiralTest.ts        NEW  grid model: GridConfig → cut/label paths + cells + footprint
web/src/lib/forge/spiralTestXs.ts      NEW  assemble legacy raw doc (2 ops) → legacyRawToXs(_, null)
web/src/lib/forge/xcs.ts               MOD  extract reusable polyline→dPath + display/device templating helpers (no behaviour change)
web/src/components/spiraltest/SpiralTestControls.tsx   NEW  left/right control panels
web/src/components/spiraltest/SpiralTestPreview.tsx    NEW  centre SVG grid preview
web/src/pages/SpiralTestPage.tsx       NEW  page shell + state + export
web/src/router.ts                      MOD  add { name: "spiral-test" }
web/src/App.tsx                        MOD  lazy import + title + render
web/src/components/TopBar.tsx          MOD  nav entry
```

Tests: `web/src/lib/forge/strokeFont.test.ts`, `spiralTest.test.ts`,
`spiralTestXs.test.ts`, `web/src/components/spiraltest/controls.test.tsx`.

## Data model

```ts
// spiralTest.ts
export interface AxisSpec { min: number; max: number; steps: number; } // steps >= 1

export interface SpiralTestConfig {
  channelWidth: AxisSpec;   // X axis (mm)
  pitch: AxisSpec;          // Y axis (mm)
  diameterMm: number;       // fixed disc diameter
  side: "outside" | "inside";
  minChannelMm: number;     // passed to the spiral generator
  gapMm: number;            // blank space between cells
  bedMm: { w: number; h: number };  // working-area guard (default F2 Ultra plane)
  label: { sizeMm: number; show: boolean };
  // laser/focus params, global across the grid (seeded from a thickness preset):
  cut: {
    passes: number; focusInitialMm: number; focusStepMm: number; focusIntervalPasses: number;
    power: number; speed: number; frequency: number; pulseWidth: number; laser: "red" | "blue" | "uv";
  };
  score: { power: number; speed: number; passes: number };  // label engrave op
}

export interface CellInfo {
  row: number; col: number;
  channelWidthMm: number; pitchMm: number;
  centerMm: { x: number; y: number };
  cut: Pt[][];     // the cell's spiral arms (open polylines), positioned in mm
  label: Pt[][];   // the cell's stroke-font label polylines, positioned in mm
  labelText: string;
  warnings: string[];
}

export interface SpiralTestResult {
  cells: CellInfo[];
  footprintMm: { w: number; h: number };
  overBed: boolean;
  warnings: string[];   // de-duped across cells (e.g. "channel too narrow for pitch")
}

export function buildSpiralTest(cfg: SpiralTestConfig): SpiralTestResult;
```

## Grid + geometry (`spiralTest.ts`)

- **Axis resolution:** `resolveAxis(a: AxisSpec): number[]` → `steps` linearly
  spaced values (`steps === 1` → `[min]`). Values clamped to the generator's
  floors (channel ≥ 0.05, pitch ≥ 0.005).
- **Circle region:** `circleRegion(cx, cy, diameterMm, segments = 96): Pt[][]` —
  one closed loop sampled on `x²+y²=r²`. (96 segments keeps the disc smooth at
  test sizes; the generator offsets from it.)
- **Per cell:** for `(col, row)` take `channelWidth = X[col]`, `pitch = Y[row]`;
  build the circle region at the cell centre; call
  `spiralFromRegion(region, { channelWidthMm, pitchMm, side, minChannelMm })`.
  Collect the returned arms as the cell's `cut`. Any generator warning (e.g.
  "scrap too thin for venting channel") is recorded on the cell and surfaced.
- **Uniform cell size:** `cellW = cellH = diameterMm + 2·maxChannelWidth +
  labelBandMm + gapMm`, where `maxChannelWidth = max(resolveAxis(channelWidth))`
  and `labelBandMm` is the vertical room reserved for the label. Uniform sizing
  keeps the grid square regardless of the per-cell channel width.
- **Cell centre:** `originMm + (col·cellW, row·cellH)` plus half-cell. Grid origin
  at a small fixed margin from (0,0).
- **Label:** `formatLabel(channelWidthMm, pitchMm)` → `"0.80/0.040"` (channel 2 dp,
  pitch 3 dp). `renderLabel(text, label.sizeMm, belowCircleOrigin)` → polylines,
  centred under the disc.
- **Footprint:** bounding box of all cells; `overBed = w > bedMm.w || h > bedMm.h`.

`splitNecks`/`joinStrands` are not applicable (circles have no necks) and are not
exposed.

## Single-stroke font (`strokeFont.ts`)

A minimal Hershey-simplex-style glyph table covering the characters the labels
need: digits `0-9`, `.`, `/`, `-`, and space. Each glyph is a list of polylines on
a unit em-box (advance width + stroke paths). Pure and DOM-free.

```ts
export function renderLabel(text: string, sizeMm: number, origin: Pt): Pt[][];
// laid out left-to-right; returns open polylines in mm, baseline at origin.y.
```

Unknown characters render as a blank advance (never throw). Extensible: adding a
glyph is adding one table entry.

## `.xs` export (`spiralTestXs.ts`)

```ts
export function buildSpiralTestXs(result: SpiralTestResult, cfg: SpiralTestConfig): ArrayBuffer;
```

1. Start from a **blank legacy raw document** — a template snapshotted once from a
   *real* minimal xTool export (parse an empty project with `xsToLegacyRaw` and
   capture the raw model as an in-code template / fixture), so it carries exactly
   the canvas/device-map structure `legacyRawToXs` expects rather than a
   hand-crafted shape that might miss a required field. Cleared to one empty
   canvas with empty `displays`/`layerData`/device map, at `mmPerUnit = 1` so
   path-mm map 1:1 to canvas-mm.
2. **Cut operation:** for each cell, append **one** PATH display whose dPath is the
   cell's arms (open subpaths, no `Z`), positioned by the cell's mm coordinates.
   All cut displays share one group → one `VECTOR_CUTTING` operation with the
   global `cut` params, including focus step-down
   (`cuttingDrop`/`sinkingMethod:"step"`/`descentPerStep`/`descentIntervalDescent`/
   `firstCuttingDropValue`). Reuse Forge's `resolveStageParams`-style mapping for
   the customize block so it matches the Spiral page's proven cut settings.
3. **Score operation:** for each cell with a label, append one PATH display of the
   label polylines. All label displays share a second group → a low-power
   **vector line-engrave / score** operation with the `score` params. The exact
   processing-type enum is confirmed against a Studio `.xs` sample during
   implementation; the fallback, if a dedicated vector-engrave type proves
   troublesome, is a second `VECTOR_CUTTING` layer at low power / single pass so
   the labels mark rather than sever.
4. Two distinct layer colours (one per operation) so Studio lists "cut" and
   "labels" as separate operation rows.
5. `legacyRawToXs(rawDoc, null)` → `.xs` `ArrayBuffer`. Passing `null` triggers the
   from-scratch bundle synthesis (profiles/bindings/resources derived from the raw
   device map), as the existing `.xcs`→`.xs` path already does.

One PATH display per cell per operation (the cell's arms merged into a single
multi-subpath object) keeps Studio's object list to N cut + N label objects rather
than one-per-arm.

## Page & UI (`SpiralTestPage.tsx` + components)

Registered like every page (`router.ts` route, `App.tsx` lazy import + title +
render, `TopBar.tsx` nav entry under the experimental/support group). Three-column
layout matching the Spiral page:

- **Left — Grid:** channel-width axis (min/max/steps), pitch axis (min/max/steps),
  circle diameter, side, gap, bed W×H, label size + show toggle. Live readouts of
  the resolved axis values and the **footprint (W×H mm)** with a **bed-exceeded
  warning**.
- **Centre — Preview:** `SpiralTestPreview` draws one SVG of the whole grid from
  the generated geometry — each disc's spiral arms + its label + a per-cell
  bounding cell, with the footprint box and an over-bed tint. (On-screen text may
  use SVG `<text>` for legibility; the *exported* labels always use the stroke
  font.)
- **Right — Cut params + export:** thickness-preset dropdown (seeds `cut`/spiral
  defaults from `presets.ts`), passes, focus initial/step/interval, power, speed,
  frequency, pulse width, laser; the `score` (label) power/speed/passes; and the
  **Export `.xs`** button (downloads `spiral-test.xs`). Reuse the Workshop-
  Instrument UI primitives (`Section`, `Field`/`NumberField`, `Select`, `Button`,
  sliders) and the Forge control idioms.

Generation runs synchronously on the main thread (a modest grid is cheap); if a
large grid is sluggish, debounce the preview rebuild (the Forge worker is not
required for v1).

## Testing

**Unit**
- `resolveAxis`: 5-step linear values; `steps=1` → `[min]`; floors clamped.
- `circleRegion`: closed loop, correct radius/centre, segment count.
- `strokeFont`: a known glyph (e.g. `"0"`, `"/"`) → expected polyline count /
  bounds; label advance accumulates; unknown char → blank advance, no throw.
- `formatLabel`: `(0.8, 0.04)` → `"0.80/0.040"`.
- `buildSpiralTest`: a 3×2 config → 6 cells with the right channel/pitch per cell,
  uniform cell spacing, footprint = expected, `overBed` true when the grid exceeds
  `bedMm`; a too-narrow channel/pitch surfaces the generator warning.

**Export**
- `buildSpiralTestXs` on a 2×2 grid → parse the emitted `.xs` back (via
  `xsToLegacyRaw`) and assert: 4 cut PATH displays + 4 label PATH displays, two
  distinct operation groups/processing types, the cut group carries the focus
  step-down customize fields, positions match the cell centres, and the buffer is
  a valid `.xs` (`isXsBuffer`).

**Browser (golden path)**
- Configure a 3×3 grid; preview shows 9 discs with spiral channels + labels and a
  footprint readout; set a tiny bed to confirm the over-bed warning; export
  `spiral-test.xs`; re-import it on the Spiral page (or confirm `xsToLegacyRaw`
  parses it) to confirm it opens with the cut + label operations intact.

## Out of scope (YAGNI)

- `.xcs` / `.svg` export (xs only).
- Sweeping circle size or any laser parameter as a third dimension.
- Automation, photographing, measurement, or DB persistence.
- Neck-splitting / strand-joining controls (not meaningful for circles).
- Live 3D preview.
