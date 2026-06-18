# Spiral Test — axis labels + real-font engraving

**Date:** 2026-06-18
**Status:** Approved (design)
**Builds on:** `2026-06-18-spiral-test-page-design.md` (the Spiral Test page; PR #159, unmerged)

## Summary

Replace the Spiral Test page's per-cell engraved labels (which take too much
space) with an **axis layout** like the calibration test pages, and engrave the
text with a **real font (JetBrains Mono), filled** — matching how xTool Studio
renders text (`demo-files/test-font.xs`):

- A single compact **title** line at the top — an auto summary of the fixed cut
  params (`P:… F:… PW:… S:… ID:… DI:… DS:…`), with an optional free-text prefix.
- **X axis** — the channel-width value under each column (bottom edge).
- **Y axis** — the pitch value beside each row (left edge).
- One value per row/column, not a full label per cell, so **cells shrink**.
- Text is **diameter-aware**: it auto-sizes to the cell/grid so it always fits.
- Labels engrave as a **`FILL_VECTOR_ENGRAVING`** op (solid letters), separate
  from the spiral `VECTOR_CUTTING` op.

This supersedes the per-cell 7-segment labels and the manual "Label size" control.

## Decisions (from brainstorming)

- **Axis placement:** X (channel width) along the **bottom**, Y (pitch) down the
  **left** (graph style); title at the top.
- **Font:** a **real font, filled** (JetBrains Mono — the app's own font),
  matching Studio's filled-glyph text. (Studio's native editable TEXT object
  carries a ~28 KB proprietary `fontData` blob that can't be faithfully
  synthesised, so we bake the same filled glyph-outline geometry as engraved
  paths instead — the part that actually marks the brass.)
- **No runtime font dependency:** a one-off dev script bakes the needed glyphs
  into a committed table; the runtime stays sync and dependency-free.
- **Title:** an **auto, live cut-param summary** so each sheet records the fixed
  settings (the axes already show what varies). Format:
  `P:{power} F:{freq} PW:{pulseWidth} S:{speed} ID:{focusInitial} DI:{focusInterval} DS:{focusStep}`
  — composed from `cfg.cut` and kept in sync as the cut params change (so the
  engraved title can never be stale). An optional free-text **prefix** (default
  empty, e.g. a material/date note) is prepended.
- **Sizing:** auto / diameter-aware — replaces the manual "Label size (mm)".
- **Label engrave op:** `FILL_VECTOR_ENGRAVING` with the full fill params from
  the user's reference (Laser MOPA IR, Power, Speed, Pass, Lines per cm,
  Engraving mode, Pulse width, Frequency).

## Font: pre-baked JetBrains Mono glyph table

**Charset:** `0-9`, `A-Z`, space, and `. / - ( ) % :` (titles are upper-cased).
The `:` is needed for the `P:` / `F:` / … param-summary title.

**Generation (one-off, committed output):** `web/scripts/gen-glyphs.mjs` uses
`opentype.js` (a **dev** dependency) + a JetBrains Mono **TTF** (OFL; fetched/
placed for the run, NOT committed). For each char it reads the glyph path at the
font's em, normalises to a unit em, **flips Y to y-down** (mm convention), and
emits `web/src/lib/forge/glyphTable.json`:

```json
{ "unitsPerEm": 1, "glyphs": { "A": { "d": "M… Q… Z", "adv": 0.6 }, "0": { … }, "/": { … } } }
```

`d` is the glyph outline dPath in unit-em, y-down coords (may be multi-subpath:
counters/holes). `adv` is the advance width in em units. Only the committed JSON
is needed at runtime; `opentype.js` and the TTF are build-time only.

**Note:** `@fontsource-variable/jetbrains-mono` ships woff2, which opentype.js
cannot parse — the generator uses a static TTF (downloaded for the run).

## Text rendering — `web/src/lib/forge/textPaths.ts`

Pure, sync, DOM-free. Reuses `splitSubpaths` + `flattenDPath` from
`web/src/lib/forge/contour.ts` (the latter flattens Q/C Béziers at 16 steps).

```ts
import glyphTable from "./glyphTable.json";

/** Filled outline rings (Pt[][]) for `text`, glyph height = sizeMm, the text's
 *  top-left at `origin` (y-down mm). Counters/holes are separate rings (use
 *  fillRule "nonzero" downstream). Unknown chars advance like a space. */
export function renderText(text: string, sizeMm: number, origin: Pt): Pt[][];

/** Total advance width (mm) of `text` at `sizeMm`. */
export function textWidth(text: string, sizeMm: number): number;
```

Per char: look up the glyph (upper-cased), `splitSubpaths(glyph.d)` →
`flattenDPath` each subpath → scale each point by `sizeMm`, translate by
(`origin.x + penX`, `origin.y`), push as a ring; advance `penX += glyph.adv *
sizeMm`. The em is unit-height, so glyph height ≈ `sizeMm`.

## Layout — `buildSpiralTest` (`web/src/lib/forge/spiralTest.ts`)

**Cells shrink** — no per-cell label band: `cell = diameterMm + 2·maxChannelMm +
gapMm` (square, uniform). (`maxLabelW` cell-widening from the old per-cell labels
is removed.)

**Grid origin** is offset by a **left margin** (Y-axis labels) and a **top band**
(title); a **bottom margin** holds the X-axis labels.

**Diameter-aware text size:** `axisTextMm = clamp(cell · 0.22, 1.2, 4)`.
Title size: `titleTextMm = min(axisTextMm · 1.4, gridWidthMm / textWidth(title, 1))`
so the title never overflows the grid width.

**Title text** is composed live from the cut params:
`titleText = (labels.titlePrefix ? labels.titlePrefix + "  " : "") +
"P:" + cut.power + " F:" + cut.frequency + " PW:" + cut.pulseWidth +
" S:" + cut.speed + " ID:" + cut.focusInitialMm + " DI:" + cut.focusIntervalPasses +
" DS:" + cut.focusStepMm` (a small `composeTitle(cfg)` helper).

**Label geometry (real-font outlines):**
- **Title:** `renderText(titleText, titleTextMm, …)` centred over the grid in the
  top band.
- **X axis:** for each column, `renderText(channelWidth.toFixed(2), axisTextMm, …)`
  centred under the column in the bottom margin.
- **Y axis:** for each row, `renderText(pitch.toFixed(3), axisTextMm, …)`
  right-aligned in the left margin, vertically centred on the row.

**Margins:** `leftMargin = max Y-label width + pad`; `bottomMargin = axisTextMm +
pad`; `topMargin = titleTextMm + pad`. `footprintMm = grid + margins`.
`overBed` unchanged.

**Result shape:**
```ts
export interface SpiralTestResult {
  cells: CellInfo[];          // row/col/channelWidthMm/pitchMm/centerMm/cut (arms)
  cutPaths: GeneratedPath[];  // spiral arms, group CUT_SPIRAL (unchanged)
  labelOutlines: Array<{ text: string; rings: Pt[][] }>;  // title + axis values
  footprintMm: { w: number; h: number };
  overBed: boolean;
  warnings: string[];
}
```
`labelOutlines` is one entry per engraved string (title, each X value, each Y
value) — kept separate so the export can emit one display per string (under the
1500-pt cap) and the preview can draw them. `CellInfo` drops its per-cell
`label`/`labelText` fields.

## Export — `web/src/lib/forge/spiralTestXs.ts`

`buildGeneratedXcs` receives **only `cutPaths`** (spiral-class → `VECTOR_CUTTING`,
focus descent, retained) — labels are no longer passed to it. Filled label
outlines **cannot** ride that path (it forces *open* `VECTOR_CUTTING` and drops
non-spiral paths), so after `buildGeneratedXcs`:

1. **Append label displays** — for each `labelOutlines` entry, add a canvas PATH
   display: `type "PATH"`, `isFill true`, `isClosePath true`, `fillRule
   "nonzero"`, `scale {x:1,y:1}`, `offsetX/Y 0`, `x/y/width/height` from the
   entry's ring bbox, `dPath = ringsToDPath(rings)` (closed subpaths), `name
   "LABEL_ENGRAVE"`, a distinct `layerTag`/`layerColor`. (Mirror the writer's own
   filled-PATH display shape.)
2. **Append device entries** — one `FILL_VECTOR_ENGRAVING` entry per label
   display, all sharing identical customize (so `legacyRawToXs` dedups them to a
   single profile/op), mirroring `test-font.xs`'s `FILL_VECTOR_ENGRAVING` block:
   `{ bitmapEngraveMode:"normal", speed, density, dpi:500, dotDuration:100,
   processingLightSource: laser, power, repeat: passes, pulseWidth,
   mopaFrequency: frequency, bitmapScanMode: <bi-directional>, needGapNumDensity:
   true, defocus:false, … }`, where **`density` = `score.linesPerCm`** (lines/cm).
   The exact `bitmapScanMode` value for "Bi-directional" is taken from a Studio
   fill sample (`test-font.xs` / `eng-angle.xcs`).
3. `legacyRawToXs(doc, null)` → `.xs`. Result: **two ops** — spiral
   `VECTOR_CUTTING` + label `FILL_VECTOR_ENGRAVING`.

`retagLabelsAsEngrave` (the prior VECTOR_ENGRAVING retag) is removed — labels are
now appended directly as filled fill-engrave displays.

## Controls / preview / config (`web/src/...`)

**Config:** `label: { sizeMm, show }` → `labels: { show: boolean; titlePrefix: string }`
(the title body is auto-derived from `cut`, not stored; `titlePrefix` defaults to `""`).
`score` expands to the fill param set:
```ts
score: {
  laser: "red" | "blue" | "uv"; power: number; speed: number; passes: number;
  linesPerCm: number; scanMode: "bidirectional" | "unidirectional";
  pulseWidth: number; frequency: number;
};
```
Defaults: `laser "red"` (MOPA IR), `power 65`, `speed 1944`, `passes 1`,
`linesPerCm 300`, `scanMode "bidirectional"`, `pulseWidth 500`, `frequency 65`.
`labels.titlePrefix` defaults to `""` (the title body auto-derives from `cut`).

**SpiralTestControls:** remove the "Label size (mm)" field; add a **Title prefix**
text `Input` (aria-label "title prefix", optional note prepended to the auto
param summary); keep the **Axis labels** (`labels.show`) toggle.

**SpiralTestPage right rail — "Label engrave" section** expands to the full fill
panel: Laser (MOPA IR select), Power (%), Speed (mm/s), Pass, **Lines per cm**,
**Engraving mode** (Bi-directional / Uni-directional select), Pulse width (ns),
Frequency (kHz).

**SpiralTestPreview:** draws the spiral arms (as now) plus the `labelOutlines`
rings **filled** (ember) — title at top, X under columns, Y down the left — so the
on-screen preview reads as solid text matching the engrave.

## Testing

**Unit**
- `textPaths`: `renderText("0", s)` → ≥1 ring within ~`s` height; `"O"` → 2 rings
  (counter); `"AB"` width ≈ `textWidth("AB", s)`; unknown char advances; upper-cases.
- `buildSpiralTest`: `labelOutlines.length === cols + rows + 1` (title); cells are
  `diameter + 2·maxCw + gap` (no label band); footprint includes margins; a larger
  diameter yields larger `axisTextMm` (diameter-aware); `labels.show:false` → no
  `labelOutlines`.
- `spiralTestXs`: round-trip via `xsToLegacyRaw` — a `VECTOR_CUTTING` cut op
  (focus descent on) **and** a `FILL_VECTOR_ENGRAVING` label op carrying the fill
  params (power/speed/density/scanMode/laser); label displays are `isFill:true`,
  `fillRule:"nonzero"`; `isXsBuffer` true.
- `composeTitle`: with `titlePrefix ""` → `"P:100 F:65 PW:80 S:1500 ID:0.01 DI:20 DS:0.06"`
  for the default cut; a non-empty prefix is prepended.
- Controls: Title-prefix field edits `labels.titlePrefix`; Axis-labels toggle; the
  fill params edit `score`.

**Browser (golden path)**
- Render at small (e.g. 2 mm) and large (e.g. 20 mm) diameters — axis values and
  title stay legible and inside their margins (diameter-aware). Toggle labels off.
  Export and validate the `.xs` has the cut + `FILL_VECTOR_ENGRAVING` ops with the
  set params. Review the engraved-text legibility critically.

## File structure

```
web/scripts/gen-glyphs.mjs                 NEW  one-off glyph-table generator (opentype.js devDep)
web/src/lib/forge/glyphTable.json          NEW  committed JetBrains Mono glyph outlines
web/src/lib/forge/textPaths.ts             NEW  renderText / textWidth
web/src/lib/forge/spiralTest.ts            MOD  axis layout, diameter-aware sizing, labelOutlines
web/src/lib/forge/spiralTestXs.ts          MOD  append FILL_VECTOR_ENGRAVING label displays
web/src/pages/SpiralTestPage.tsx           MOD  Title field, full fill-engrave params, preview wiring
web/src/components/spiraltest/SpiralTestControls.tsx   MOD  drop Label size, add Title
web/src/components/spiraltest/SpiralTestPreview.tsx    MOD  draw filled label outlines + axis/title
web/src/lib/forge/strokeFont.ts            DEL  replaced by textPaths.ts (+ its test)
web/package.json                           MOD  add opentype.js as a devDependency
```
Tests: `textPaths.test.ts`, updated `spiralTest.test.ts` / `spiralTestXs.test.ts`
/ `controls.test.tsx`; remove `strokeFont.test.ts`.

## Out of scope (YAGNI)

- A native, *editable* Studio TEXT object (proprietary `fontData` — impractical).
- Lowercase glyphs (titles are upper-cased).
- Runtime font loading / opentype.js in the shipped bundle.
- Per-cell labels (removed).
