# Spiral Test — axis labels + real-font engraving Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Spiral Test page's per-cell engraved labels with an axis layout (auto cut-param title + X channel-width / Y pitch values), engraved with a real font (JetBrains Mono, filled) as a `FILL_VECTOR_ENGRAVING` op, auto-sized to the grid.

**Architecture:** A one-off dev script bakes JetBrains Mono glyph outlines into a committed `glyphTable.json`; a pure `textPaths.ts` renders any string to filled outline rings (reusing `splitSubpaths`). `buildSpiralTest` drops per-cell labels (cells shrink), lays out title + axis values in margins (diameter-aware sizing), and returns `labelOutlines`. The export keeps the spiral `VECTOR_CUTTING` op (via `buildGeneratedXcs`) and appends the labels as filled `FILL_VECTOR_ENGRAVING` displays.

**Tech Stack:** React + TypeScript + Vite (Workshop-Instrument design system); vitest; opentype.js (dev-only, for the bake).

**Spec:** `docs/superpowers/specs/2026-06-18-spiral-test-axis-labels-design.md`. Builds on the Spiral Test page (PR #159, branch `feat/spiral-test`).

**Key facts (do not re-derive):**
- `web/src/lib/forge/contour.ts`: `splitSubpaths(d: string): Contour[]` (splits a dPath on `M` and flattens each subpath's Q/C Béziers to polylines), `Contour = { points: Pt[]; closed: boolean }`.
- `web/src/lib/forge/xcs.ts`: `ringsToDPath(rings, mmPerUnit)` (emits `M…L…Z` per ring), `contourToDPath`, `buildGeneratedXcs(parsed, inciseId, paths, mmPerUnit, stageParams, scanAngleDeg?, userOrder, maxPathPoints, joinStrands)`, `parseXcsFile`, `MAX_PATH_POINTS`. `buildGeneratedXcs` keeps only `generatedClass:"spiral"` paths and emits them as open `VECTOR_CUTTING`.
- `web/src/lib/forge/xs.ts`: `legacyRawToXs(raw, bundle, userOrder)` (bundle=null synthesises a complete `.xs`), `xsToLegacyRaw`, `isXsBuffer`. Profiles dedup on `(processingType, values)`.
- `web/src/lib/forge/depth.ts`: `descentDepthMm(layers, everyN, byMm)`.
- The doc produced by `buildGeneratedXcs` has `doc.canvas[0].displays` (array) + `doc.canvas[0].layerData` (object) + `doc.device.data.value[0][1].displays.value` (array of `[id, entry]`), single group keyed `CANVAS_ID`.
- A real Studio fill-engrave entry (from `demo-files/test-font.xs`): `FILL_VECTOR_ENGRAVING` customize keys: `bitmapEngraveMode:"normal", speed, density, needGapNumDensity:true, dotDuration:100, dpi:500, processingLightSource, power, repeat, defocus:false, defocus_distance:3, bitmapScanMode, pulseWidth, mopaFrequency`. Its `COLOR_FILL_ENGRAVE` used `bitmapScanMode:"zMode"` (= bidirectional zigzag).
- `@fontsource-variable/jetbrains-mono` ships **woff2 only** (opentype.js can't parse woff2). opentype.js is **not** installed.

**Conventions:** Frontend gate before a commit: `cd web && npx tsc --noEmit && npm test -- --run`. After `web/src/**` changes rebuild for the browser: `cd web && npm run build`. Never `git commit --no-verify`.

**File structure:**
```
web/scripts/gen-glyphs.mjs                 NEW  one-off glyph-table generator (opentype.js)
web/src/lib/forge/glyphTable.json          NEW  committed JetBrains Mono glyph outlines (baked)
web/src/lib/forge/textPaths.ts             NEW  renderText / textWidth
web/src/lib/forge/textPaths.test.ts        NEW
web/src/lib/forge/spiralTest.ts            MOD  axis layout, composeTitle, diameter-aware, labelOutlines
web/src/lib/forge/spiralTest.test.ts       MOD
web/src/lib/forge/spiralTestXs.ts          MOD  append FILL_VECTOR_ENGRAVING label displays
web/src/lib/forge/spiralTestXs.test.ts     MOD
web/src/components/spiraltest/SpiralTestControls.tsx   MOD  drop Label size, add Title prefix
web/src/components/spiraltest/controls.test.tsx        MOD
web/src/components/spiraltest/SpiralTestPreview.tsx    MOD  draw filled label outlines
web/src/pages/SpiralTestPage.tsx           MOD  full fill params, title prefix, DEFAULT_CFG
web/src/lib/forge/strokeFont.ts            DEL
web/src/lib/forge/strokeFont.test.ts       DEL
web/package.json                           MOD  opentype.js devDependency
```

---

## Task 1: JetBrains Mono glyph table + `textPaths`

Bake the app font's glyph outlines into a committed table, and a pure renderer that turns any string into filled outline rings.

**Files:**
- Create: `web/scripts/gen-glyphs.mjs`, `web/src/lib/forge/glyphTable.json` (generated), `web/src/lib/forge/textPaths.ts`, `web/src/lib/forge/textPaths.test.ts`
- Modify: `web/package.json` (devDependency)

- [ ] **Step 1: Add opentype.js as a dev dependency**

Run: `cd web && npm install --save-dev opentype.js@^1.3.4`
Expected: `package.json` gains `"opentype.js"` under `devDependencies`; lockfile updates.

- [ ] **Step 2: Write the glyph-table generator** — create `web/scripts/gen-glyphs.mjs`:

```js
// One-off: bake JetBrains Mono glyph outlines into src/lib/forge/glyphTable.json.
// JetBrains Mono is OFL (already bundled via @fontsource); we embed an outline
// subset for engraved labels. Run: node scripts/gen-glyphs.mjs <path-to-JetBrainsMono-Regular.ttf>
import opentype from "opentype.js";
import { readFileSync, writeFileSync } from "node:fs";

const ttfPath = process.argv[2];
if (!ttfPath) throw new Error("usage: node gen-glyphs.mjs <JetBrainsMono-Regular.ttf>");
const buf = readFileSync(ttfPath);
const font = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
const upm = font.unitsPerEm;
const CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ ./-()%:".split("");

const nx = (v) => +(v / upm).toFixed(4);
const ny = (v) => +(-v / upm).toFixed(4); // flip to y-down (mm convention)
const glyphs = {};
for (const ch of CHARS) {
  const g = font.charToGlyph(ch);
  const adv = +(((g.advanceWidth ?? upm) / upm)).toFixed(4);
  const path = g.getPath(0, 0, upm); // baseline at y=0, font units, y-up
  const d = path.commands
    .map((c) => {
      switch (c.type) {
        case "M": return `M${nx(c.x)},${ny(c.y)}`;
        case "L": return `L${nx(c.x)},${ny(c.y)}`;
        case "Q": return `Q${nx(c.x1)},${ny(c.y1)} ${nx(c.x)},${ny(c.y)}`;
        case "C": return `C${nx(c.x1)},${ny(c.y1)} ${nx(c.x2)},${ny(c.y2)} ${nx(c.x)},${ny(c.y)}`;
        case "Z": return "Z";
        default: return "";
      }
    })
    .join(" ");
  glyphs[ch] = { d, adv };
}
const out = { unitsPerEm: 1, ascent: +(font.ascender / upm).toFixed(4), glyphs };
writeFileSync(new URL("../src/lib/forge/glyphTable.json", import.meta.url), JSON.stringify(out));
console.log(`baked ${CHARS.length} glyphs → src/lib/forge/glyphTable.json`);
```

- [ ] **Step 3: Bake the glyph table**

Run (downloads the OFL TTF once, bakes, then discards the TTF — only the JSON is committed):
```bash
cd web
curl -L -o /tmp/JetBrainsMono-Regular.ttf \
  https://github.com/JetBrains/JetBrainsMono/raw/master/fonts/ttf/JetBrainsMono-Regular.ttf
node scripts/gen-glyphs.mjs /tmp/JetBrainsMono-Regular.ttf
```
Expected: prints `baked 44 glyphs → src/lib/forge/glyphTable.json` and the file exists.
Sanity: `node -e 'const g=require("./src/lib/forge/glyphTable.json"); console.log(Object.keys(g.glyphs).length, !!g.glyphs["A"].d, g.glyphs["A"].adv)'` → `44 true <≈0.6>`.
If the download fails, fetch `JetBrainsMono-Regular.ttf` from https://github.com/JetBrains/JetBrainsMono/releases (OFL) by any means and pass its path.

- [ ] **Step 4: Write the failing test** — create `web/src/lib/forge/textPaths.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { renderText, textWidth } from "./textPaths";

describe("textPaths", () => {
  it("renders a digit to >=1 ring of roughly sizeMm height", () => {
    const rings = renderText("0", 4, { x: 0, y: 0 });
    expect(rings.length).toBeGreaterThanOrEqual(1);
    const ys = rings.flat().map((p) => p.y);
    const h = Math.max(...ys) - Math.min(...ys);
    expect(h).toBeGreaterThan(2); // ~cap height of size 4
    expect(h).toBeLessThan(5);
  });
  it("'O' has a counter — at least 2 rings", () => {
    expect(renderText("O", 6, { x: 0, y: 0 }).length).toBeGreaterThanOrEqual(2);
  });
  it("textWidth grows with length and matches the advance sum", () => {
    expect(textWidth("AA", 4)).toBeCloseTo(2 * textWidth("A", 4), 5);
    expect(textWidth("", 4)).toBe(0);
  });
  it("upper-cases input and advances unknown chars", () => {
    expect(renderText("a", 4, { x: 0, y: 0 }).length).toBe(renderText("A", 4, { x: 0, y: 0 }).length);
    expect(textWidth("\t", 4)).toBeGreaterThan(0); // unknown → space advance
  });
});
```

- [ ] **Step 5: Run the test to verify it fails**

Run: `cd web && npx vitest run src/lib/forge/textPaths.test.ts`
Expected: FAIL — cannot find module `./textPaths`.

- [ ] **Step 6: Implement `textPaths.ts`** — create `web/src/lib/forge/textPaths.ts`:

```ts
// web/src/lib/forge/textPaths.ts
// Render a string to filled glyph-outline rings (mm) using a pre-baked
// JetBrains Mono glyph table. Pure + sync. Counters/holes are separate rings
// (use fillRule "nonzero" downstream). Y is down, matching mm canvas space.
import type { Pt } from "./types";
import { splitSubpaths } from "./contour";
import glyphTable from "./glyphTable.json";

const GLYPHS: Record<string, { d: string; adv: number }> = glyphTable.glyphs;
const SPACE_ADV = GLYPHS[" "]?.adv ?? 0.6;

function glyphFor(ch: string): { d: string; adv: number } | null {
  const up = ch.toUpperCase();
  return GLYPHS[up] ?? null;
}

/** Filled outline rings (Pt[][]) for `text`; em scaled to `sizeMm`, the text
 *  baseline at `origin.y`, left edge at `origin.x` (y-down mm). */
export function renderText(text: string, sizeMm: number, origin: Pt): Pt[][] {
  const rings: Pt[][] = [];
  let penX = origin.x;
  for (const ch of text) {
    const g = glyphFor(ch);
    if (!g) { penX += SPACE_ADV * sizeMm; continue; }
    if (g.d) {
      for (const sub of splitSubpaths(g.d)) {
        rings.push(sub.points.map((p) => ({ x: penX + p.x * sizeMm, y: origin.y + p.y * sizeMm })));
      }
    }
    penX += g.adv * sizeMm;
  }
  return rings;
}

/** Total advance width (mm) of `text` at `sizeMm`. */
export function textWidth(text: string, sizeMm: number): number {
  let w = 0;
  for (const ch of text) {
    const g = glyphFor(ch);
    w += (g ? g.adv : SPACE_ADV) * sizeMm;
  }
  return w;
}
```

Note: the JSON import needs `resolveJsonModule` (Vite/tsconfig already allow JSON imports in this repo — `package.json`/other JSON are imported elsewhere; if tsc complains, the repo's `tsconfig` `resolveJsonModule` is already true).

- [ ] **Step 7: Run the test to verify it passes**

Run: `cd web && npx vitest run src/lib/forge/textPaths.test.ts`
Expected: PASS (4 tests). The `'0'` height (~cap height ≈ 0.73·size for a digit) lands in (2, 5) at size 4; `'O'` yields outer + counter rings.

- [ ] **Step 8: Typecheck + commit**

Run: `cd web && npx tsc --noEmit` → clean.
```bash
git add web/scripts/gen-glyphs.mjs web/src/lib/forge/glyphTable.json web/src/lib/forge/textPaths.ts web/src/lib/forge/textPaths.test.ts web/package.json web/package-lock.json
git commit -m "feat(spiral-test): bake JetBrains Mono glyph table + textPaths renderer"
```

---

## Task 2: Axis-label layout, fill-engrave export, and UI

Rework the model, export, controls, preview, and tests together — the `SpiralTestConfig` reshape (`labels`/`score`) is cross-cutting, so this lands as one tsc-green unit. Delete the old 7-segment font.

**Files:** Modify `spiralTest.ts`, `spiralTestXs.ts`, `SpiralTestControls.tsx`, `SpiralTestPage.tsx`, `SpiralTestPreview.tsx`, `spiralTest.test.ts`, `spiralTestXs.test.ts`, `controls.test.tsx`; Delete `strokeFont.ts`, `strokeFont.test.ts`.

- [ ] **Step 1: Rewrite `web/src/lib/forge/spiralTest.ts`**

Replace the whole file with:

```ts
// web/src/lib/forge/spiralTest.ts
// 2D spiral-test grid: a channel-width × pitch sweep of spiral-cut circles, with
// an axis layout — a title (auto cut-param summary) + per-column channel-width
// values (X, bottom) + per-row pitch values (Y, left), engraved as real-font
// filled text. Pure geometry; reuses the Forge spiral generator + font renderer.
import type { GeneratedPath, Pt } from "./types";
import { spiralFromRegion } from "./spiral";
import { renderText, textWidth } from "./textPaths";

export interface AxisSpec { min: number; max: number; steps: number; }

/** `steps` values linearly spaced over [min, max] (steps>=1; 1 → [min]). */
export function resolveAxis(a: AxisSpec): number[] {
  const n = Math.max(1, Math.floor(a.steps));
  if (n === 1) return [a.min];
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(a.min + ((a.max - a.min) * i) / (n - 1));
  return out;
}

/** One closed loop of `segments` points on a circle of diameter `d` at (cx,cy). */
export function circleRegion(cx: number, cy: number, d: number, segments = 96): Pt[][] {
  const r = d / 2;
  const loop: Pt[] = [];
  for (let i = 0; i < segments; i++) {
    const t = (2 * Math.PI * i) / segments;
    loop.push({ x: cx + r * Math.cos(t), y: cy + r * Math.sin(t) });
  }
  return [loop];
}

export interface SpiralTestConfig {
  channelWidth: AxisSpec;   // X axis (mm)
  pitch: AxisSpec;          // Y axis (mm)
  diameterMm: number;
  side: "outside" | "inside";
  minChannelMm: number;
  gapMm: number;
  bedMm: { w: number; h: number };
  labels: { show: boolean; titlePrefix: string };
  cut: {
    passes: number; focusInitialMm: number; focusStepMm: number; focusIntervalPasses: number;
    power: number; speed: number; frequency: number; pulseWidth: number; laser: "red" | "blue" | "uv";
  };
  /** Label engrave op (a FILL_VECTOR_ENGRAVING pass over the real-font glyphs). */
  score: {
    laser: "red" | "blue" | "uv"; power: number; speed: number; passes: number;
    linesPerCm: number; scanMode: "bidirectional" | "unidirectional";
    pulseWidth: number; frequency: number;
  };
}

export interface CellInfo {
  row: number; col: number;
  channelWidthMm: number; pitchMm: number;
  centerMm: { x: number; y: number };
  cut: Pt[][];        // the cell's arms (open polylines), positioned in mm
  warnings: string[];
}

/** One engraved string (title or an axis value) as filled outline rings. */
export interface LabelOutline { text: string; rings: Pt[][]; }

export interface SpiralTestResult {
  cells: CellInfo[];
  cutPaths: GeneratedPath[];     // one per arm, group "CUT_SPIRAL"
  labelOutlines: LabelOutline[]; // title + axis values (filled glyph rings)
  footprintMm: { w: number; h: number };
  overBed: boolean;
  warnings: string[];
}

const MARGIN_MM = 5;     // outer page margin
const PAD_MM = 1.2;      // padding between grid and axis labels / title

/** The auto title: an optional prefix + a fixed-param summary. Stays in sync
 *  with the config so the engraved title is never stale. */
export function composeTitle(cfg: SpiralTestConfig): string {
  const c = cfg.cut;
  const body = `D:${cfg.diameterMm} P:${c.power} F:${c.frequency} PW:${c.pulseWidth} ` +
    `S:${c.speed} ID:${c.focusInitialMm} DI:${c.focusIntervalPasses} DS:${c.focusStepMm}`;
  const pre = cfg.labels.titlePrefix.trim();
  return pre ? `${pre}  ${body}` : body;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** Bbox of a set of rings; null if empty. */
function ringsBBox(rings: Pt[][]): { minX: number; minY: number; w: number; h: number } | null {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const r of rings) for (const p of r) {
    if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x;
    if (p.y < y0) y0 = p.y; if (p.y > y1) y1 = p.y;
  }
  if (!Number.isFinite(x0)) return null;
  return { minX: x0, minY: y0, w: x1 - x0, h: y1 - y0 };
}

export function buildSpiralTest(cfg: SpiralTestConfig): SpiralTestResult {
  const cws = resolveAxis(cfg.channelWidth);
  const pitches = resolveAxis(cfg.pitch);
  const maxCw = Math.max(...cws);
  const show = cfg.labels.show;

  // Cells shrink: just disc + channel ring + gap (no per-cell label band).
  const cell = cfg.diameterMm + 2 * maxCw + cfg.gapMm;

  // Diameter-aware text size, plus the title fitted to the grid width.
  const axisTextMm = show ? clamp(cell * 0.22, 1.2, 4) : 0;
  const gridW = cws.length * cell;
  const gridH = pitches.length * cell;
  const title = composeTitle(cfg);
  const titleTextMm = show ? Math.min(axisTextMm * 1.4, gridW / Math.max(1, textWidth(title, 1))) : 0;

  // Left margin holds the Y (pitch) values; top band holds the title.
  const yLabelW = show ? Math.max(...pitches.map((p) => textWidth(p.toFixed(3), axisTextMm))) : 0;
  const leftMargin = show ? yLabelW + PAD_MM : 0;
  const topBand = show ? titleTextMm + PAD_MM * 2 : 0;
  const bottomMargin = show ? axisTextMm + PAD_MM * 2 : 0;

  const gridX0 = MARGIN_MM + leftMargin;
  const gridY0 = MARGIN_MM + topBand;

  const cells: CellInfo[] = [];
  const cutPaths: GeneratedPath[] = [];
  const labelOutlines: LabelOutline[] = [];
  const warnSet = new Set<string>();
  let order = 0;

  for (let row = 0; row < pitches.length; row++) {
    for (let col = 0; col < cws.length; col++) {
      const channelWidthMm = cws[col];
      const pitchMm = pitches[row];
      const cx = gridX0 + cell / 2 + col * cell;
      const cy = gridY0 + cell / 2 + row * cell;

      const region = circleRegion(cx, cy, cfg.diameterMm);
      const res = spiralFromRegion(region, {
        channelWidthMm, pitchMm, side: cfg.side, minChannelMm: cfg.minChannelMm,
      });
      res.warnings.forEach((w) => warnSet.add(w));

      for (const arm of res.arms) {
        cutPaths.push({
          sourceObjectId: "spiral-test", generatedClass: "spiral", groupName: "CUT_SPIRAL",
          layerStart: 0, layerEnd: cfg.cut.passes, widthMultiplier: 1, offsetMm: 0,
          sideMode: cfg.side, operationOrder: order++, enabled: true, rings: [arm],
        });
      }
      cells.push({ row, col, channelWidthMm, pitchMm, centerMm: { x: cx, y: cy }, cut: res.arms, warnings: res.warnings });
    }
  }

  if (show) {
    // Title — centred over the grid, baseline near the top.
    const titleBaselineY = MARGIN_MM + titleTextMm;
    const titleW = textWidth(title, titleTextMm);
    const titleX = gridX0 + Math.max(0, (gridW - titleW) / 2);
    const tRings = renderText(title, titleTextMm, { x: titleX, y: titleBaselineY });
    labelOutlines.push({ text: title, rings: tRings });

    // X axis — channel-width value centred under each column, in the bottom margin.
    const xBaselineY = gridY0 + gridH + PAD_MM + axisTextMm;
    for (let col = 0; col < cws.length; col++) {
      const t = cws[col].toFixed(2);
      const w = textWidth(t, axisTextMm);
      const colCx = gridX0 + cell / 2 + col * cell;
      labelOutlines.push({ text: t, rings: renderText(t, axisTextMm, { x: colCx - w / 2, y: xBaselineY }) });
    }

    // Y axis — pitch value right-aligned in the left margin, vertically centred on the row.
    for (let row = 0; row < pitches.length; row++) {
      const t = pitches[row].toFixed(3);
      const w = textWidth(t, axisTextMm);
      const rowCy = gridY0 + cell / 2 + row * cell;
      labelOutlines.push({ text: t, rings: renderText(t, axisTextMm, { x: gridX0 - PAD_MM - w, y: rowCy + axisTextMm * 0.35 }) });
    }
  }

  const allLabelRings = labelOutlines.flatMap((l) => l.rings);
  const labelBox = ringsBBox(allLabelRings);
  const cutBox = ringsBBox(cutPaths.flatMap((p) => p.rings));
  // Footprint = everything, padded back to a MARGIN_MM border.
  const right = Math.max(gridX0 + gridW, labelBox ? labelBox.minX + labelBox.w : 0, cutBox ? cutBox.minX + cutBox.w : 0);
  const bottom = Math.max(gridY0 + gridH + bottomMargin, labelBox ? labelBox.minY + labelBox.h : 0);
  const footprintMm = { w: right + MARGIN_MM, h: bottom + MARGIN_MM };

  return {
    cells, cutPaths, labelOutlines, footprintMm,
    overBed: footprintMm.w > cfg.bedMm.w || footprintMm.h > cfg.bedMm.h,
    warnings: [...warnSet],
  };
}
```

- [ ] **Step 2: Rewrite `web/src/lib/forge/spiralTest.test.ts`**

Replace the whole file with:

```ts
import { describe, it, expect } from "vitest";
import { resolveAxis, circleRegion, composeTitle, buildSpiralTest, type SpiralTestConfig } from "./spiralTest";

const CFG: SpiralTestConfig = {
  channelWidth: { min: 0.6, max: 1.0, steps: 3 },
  pitch: { min: 0.03, max: 0.05, steps: 2 },
  diameterMm: 10, side: "outside", minChannelMm: 0.4, gapMm: 4,
  bedMm: { w: 300, h: 300 }, labels: { show: true, titlePrefix: "" },
  cut: { passes: 250, focusInitialMm: 0.01, focusStepMm: 0.06, focusIntervalPasses: 20,
         power: 100, speed: 1500, frequency: 65, pulseWidth: 80, laser: "red" },
  score: { laser: "red", power: 65, speed: 1944, passes: 1, linesPerCm: 300, scanMode: "bidirectional", pulseWidth: 500, frequency: 65 },
};

describe("resolveAxis", () => {
  it("linearly spaces min..max over steps", () => {
    expect(resolveAxis({ min: 0.4, max: 1.0, steps: 4 })).toEqual([0.4, 0.6, 0.8, 1.0]);
  });
  it("steps=1 yields [min]", () => {
    expect(resolveAxis({ min: 0.5, max: 2, steps: 1 })).toEqual([0.5]);
  });
});

describe("circleRegion", () => {
  it("is one loop at radius d/2 around (cx,cy)", () => {
    const loops = circleRegion(10, 20, 8, 32);
    expect(loops[0].length).toBe(32);
    for (const p of loops[0]) expect(Math.hypot(p.x - 10, p.y - 20)).toBeCloseTo(4, 5);
  });
});

describe("composeTitle", () => {
  it("summarises the fixed params (D/P/F/PW/S/ID/DI/DS)", () => {
    expect(composeTitle(CFG)).toBe("D:10 P:100 F:65 PW:80 S:1500 ID:0.01 DI:20 DS:0.06");
  });
  it("prepends a non-empty prefix", () => {
    expect(composeTitle({ ...CFG, labels: { show: true, titlePrefix: "BRASS" } }))
      .toBe("BRASS  D:10 P:100 F:65 PW:80 S:1500 ID:0.01 DI:20 DS:0.06");
  });
});

describe("buildSpiralTest", () => {
  it("produces one cell per (col,row) with the swept values", () => {
    const r = buildSpiralTest(CFG);
    expect(r.cells.length).toBe(6);
    expect(r.cells.find((c) => c.col === 0 && c.row === 0)!.channelWidthMm).toBeCloseTo(0.6, 5);
    expect(r.cells.find((c) => c.col === 2 && c.row === 1)!.pitchMm).toBeCloseTo(0.05, 5);
  });
  it("emits spiral cut paths (one arm per path)", () => {
    const r = buildSpiralTest(CFG);
    expect(r.cutPaths.length).toBeGreaterThanOrEqual(6);
    expect(r.cutPaths.every((p) => p.generatedClass === "spiral" && p.groupName === "CUT_SPIRAL" && p.rings.length === 1)).toBe(true);
  });
  it("emits axis labels: 1 title + cols X-values + rows Y-values", () => {
    const r = buildSpiralTest(CFG);
    expect(r.labelOutlines.length).toBe(1 + 3 + 2); // title + 3 cols + 2 rows
    expect(r.labelOutlines[0].text).toBe(composeTitle(CFG));
    expect(r.labelOutlines.some((l) => l.text === "0.60")).toBe(true); // an X value
    expect(r.labelOutlines.some((l) => l.text === "0.030")).toBe(true); // a Y value
    expect(r.labelOutlines.every((l) => l.rings.length >= 1)).toBe(true);
  });
  it("omits labels when labels.show is false", () => {
    expect(buildSpiralTest({ ...CFG, labels: { show: false, titlePrefix: "" } }).labelOutlines.length).toBe(0);
  });
  it("axis text scales with diameter (diameter-aware)", () => {
    const small = buildSpiralTest({ ...CFG, diameterMm: 4 });
    const big = buildSpiralTest({ ...CFG, diameterMm: 20 });
    // a Y label's height grows with the cell/diameter
    const yH = (res: ReturnType<typeof buildSpiralTest>) => {
      const l = res.labelOutlines.find((o) => o.text === "0.030")!;
      const ys = l.rings.flat().map((p) => p.y);
      return Math.max(...ys) - Math.min(...ys);
    };
    expect(yH(big)).toBeGreaterThan(yH(small));
  });
  it("footprint exceeds a tiny bed", () => {
    expect(buildSpiralTest({ ...CFG, bedMm: { w: 5, h: 5 } }).overBed).toBe(true);
  });
});
```

- [ ] **Step 3: Run the lib tests**

Run: `cd web && npx vitest run src/lib/forge/spiralTest.test.ts`
Expected: PASS. (`composeTitle` uses the default cut → `D:10 P:100 F:65 PW:80 S:1500 ID:0.01 DI:20 DS:0.06`.)

- [ ] **Step 4: Rewrite the label emission in `web/src/lib/forge/spiralTestXs.ts`**

Replace the file's `import` block + everything from `export function buildSpiralTestXs` to the end with:

```ts
import { buildGeneratedXcs, parseXcsFile, ringsToDPath, MAX_PATH_POINTS } from "./xcs";
import { legacyRawToXs } from "./xs";
import type { Pt, StageParams } from "./types";
import type { SpiralTestConfig, SpiralTestResult } from "./spiralTest";
```
(keep `CANVAS_ID`, `templateBytes`, `TEMPLATE_BYTES` as-is), then:

```ts
const LABEL_COLOR = "#0ea5e9"; // distinct layer colour for the engrave op

function ringsBBox(rings: Pt[][]): { minX: number; minY: number; w: number; h: number } {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const r of rings) for (const p of r) {
    if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x;
    if (p.y < y0) y0 = p.y; if (p.y > y1) y1 = p.y;
  }
  return { minX: x0, minY: y0, w: x1 - x0, h: y1 - y0 };
}

/** FILL_VECTOR_ENGRAVING device entry (mirrors a Studio fill-engrave op). */
function fillEngraveEntry(score: SpiralTestConfig["score"]): Record<string, unknown> {
  return {
    isFill: true,
    type: "PATH",
    processingType: "FILL_VECTOR_ENGRAVING",
    data: {
      FILL_VECTOR_ENGRAVING: {
        materialType: "customize",
        planType: "blue",
        parameter: {
          customize: {
            bitmapEngraveMode: "normal",
            speed: score.speed,
            density: score.linesPerCm,
            needGapNumDensity: true,
            dotDuration: 100,
            dpi: 500,
            processingLightSource: score.laser,
            power: score.power,
            repeat: score.passes,
            defocus: false,
            defocus_distance: 3,
            bitmapScanMode: score.scanMode === "bidirectional" ? "zMode" : "nMode",
            pulseWidth: score.pulseWidth,
            mopaFrequency: score.frequency,
          },
        },
      },
    },
    processIgnore: false,
    isWhiteModel: true,
  };
}

export function buildSpiralTestXs(result: SpiralTestResult, cfg: SpiralTestConfig): ArrayBuffer {
  const parsed = parseXcsFile(TEMPLATE_BYTES);
  const inciseId = parsed.targets[0].id;

  const stageParams: Record<string, StageParams> = {
    CUT_SPIRAL: {
      power: cfg.cut.power, speed: cfg.cut.speed, passes: cfg.cut.passes,
      pulseWidth: cfg.cut.pulseWidth, frequency: cfg.cut.frequency, laser: cfg.cut.laser,
      cuttingDrop: true, sinkingMethod: "step",
      firstCuttingDropValue: cfg.cut.focusInitialMm, cuttingDropValue: cfg.cut.focusInitialMm,
      descentIntervalDescent: cfg.cut.focusIntervalPasses, descentPerStep: cfg.cut.focusStepMm,
    },
  };

  // Spiral cut via the proven writer (cut paths only — labels are filled, so
  // they cannot ride the spiral-only / open-path code path).
  const doc = buildGeneratedXcs(
    parsed, inciseId, result.cutPaths, 1 /* mmPerUnit */, stageParams,
    undefined /* scanAngle */, false /* userOrder */, MAX_PATH_POINTS, false /* joinStrands */,
  ) as {
    canvas: Array<{ displays: Array<Record<string, unknown>>; layerData: Record<string, unknown> }>;
    device: { data: { value: Array<[string, { displays: { value: Array<[string, unknown]> } }]> } };
  };

  // Append each label string as a filled PATH display + a FILL_VECTOR_ENGRAVING entry.
  const canvas = doc.canvas[0];
  const entries = doc.device.data.value[0][1].displays.value;
  canvas.layerData[LABEL_COLOR] = { name: "LABEL_ENGRAVE", order: Object.keys(canvas.layerData).length + 1, visible: true };
  result.labelOutlines.forEach((lbl, i) => {
    if (lbl.rings.length === 0) return;
    const b = ringsBBox(lbl.rings);
    const id = `label-${i}`;
    canvas.displays.push({
      id, type: "PATH", name: "LABEL_ENGRAVE",
      dPath: ringsToDPath(lbl.rings, 1),
      isClosePath: true, isFill: true, fillRule: "nonzero",
      layerTag: LABEL_COLOR, layerColor: LABEL_COLOR,
      scale: { x: 1, y: 1 }, angle: 0, pivot: { x: 0, y: 0 },
      offsetX: 0, offsetY: 0, graphicX: 0, graphicY: 0,
      x: b.minX, y: b.minY, width: b.w, height: b.h,
    });
    entries.push([id, fillEngraveEntry(cfg.score)]);
  });

  return legacyRawToXs(doc, null, false);
}
```
Delete the old `engraveEntry` and `retagLabelsAsEngrave` functions. Update the file header comment to: "Spiral cut via buildGeneratedXcs (VECTOR_CUTTING); labels appended as filled FILL_VECTOR_ENGRAVING displays."

- [ ] **Step 5: Rewrite `web/src/lib/forge/spiralTestXs.test.ts`**

Replace the whole file with:

```ts
import { describe, it, expect } from "vitest";
import { buildSpiralTest, type SpiralTestConfig } from "./spiralTest";
import { buildSpiralTestXs } from "./spiralTestXs";
import { isXsBuffer, xsToLegacyRaw } from "./xs";

const CFG: SpiralTestConfig = {
  channelWidth: { min: 0.6, max: 1.0, steps: 2 },
  pitch: { min: 0.03, max: 0.05, steps: 2 },
  diameterMm: 10, side: "outside", minChannelMm: 0.4, gapMm: 4,
  bedMm: { w: 300, h: 300 }, labels: { show: true, titlePrefix: "" },
  cut: { passes: 200, focusInitialMm: 0.01, focusStepMm: 0.06, focusIntervalPasses: 20,
         power: 100, speed: 1500, frequency: 65, pulseWidth: 80, laser: "red" },
  score: { laser: "red", power: 65, speed: 1944, passes: 1, linesPerCm: 300, scanMode: "bidirectional", pulseWidth: 500, frequency: 65 },
};

describe("buildSpiralTestXs", () => {
  it("round-trips with a VECTOR_CUTTING cut op + a FILL_VECTOR_ENGRAVING label op", () => {
    const result = buildSpiralTest(CFG);
    const buf = buildSpiralTestXs(result, CFG);
    expect(isXsBuffer(buf)).toBe(true);

    const { raw } = xsToLegacyRaw(buf);
    const r = raw as { canvas: Array<{ displays: Array<{ id: string; isFill?: boolean; fillRule?: string }> }>;
      device: { data: { value: Array<[string, { displays: { value: Array<[string, { processingType?: string;
        data?: Record<string, { parameter?: { customize?: Record<string, unknown> } }> }]> } }]> } } };

    const entries = r.device.data.value[0][1].displays.value;
    const types = entries.map(([, e]) => e.processingType);
    expect(types).toContain("VECTOR_CUTTING");
    expect(types).toContain("FILL_VECTOR_ENGRAVING");

    const anyFocus = entries.some(([, e]) => {
      const cz = e.data?.VECTOR_CUTTING?.parameter?.customize as Record<string, unknown> | undefined;
      return cz?.cuttingDrop === true && cz?.descentPerStep === 0.06;
    });
    expect(anyFocus).toBe(true);

    const anyFill = entries.some(([, e]) => {
      const cz = e.data?.FILL_VECTOR_ENGRAVING?.parameter?.customize as Record<string, unknown> | undefined;
      return cz?.power === 65 && cz?.speed === 1944 && cz?.density === 300
        && cz?.bitmapScanMode === "zMode" && cz?.processingLightSource === "red";
    });
    expect(anyFill).toBe(true);

    // label displays are filled, nonzero-wound
    const labelDisp = r.canvas[0].displays.filter((d) => d.fillRule === "nonzero");
    expect(labelDisp.length).toBeGreaterThanOrEqual(result.labelOutlines.length);
    expect(labelDisp.every((d) => d.isFill === true)).toBe(true);
  });
});
```

- [ ] **Step 6: Run both lib tests**

Run: `cd web && npx vitest run src/lib/forge/spiralTest.test.ts src/lib/forge/spiralTestXs.test.ts`
Expected: PASS. If `xsToLegacyRaw` drops display fields like `fillRule`/`isFill` on the round-trip, log `JSON.stringify(r.canvas[0].displays[last]).slice(0,400)` and assert on the fields actually retained (production code unchanged) — the FILL_VECTOR_ENGRAVING profile assertion is the primary check.

- [ ] **Step 7: Delete the old font + rewrite the controls** — remove the stroke font, update `SpiralTestControls.tsx`.

```bash
git rm web/src/lib/forge/strokeFont.ts web/src/lib/forge/strokeFont.test.ts
```

In `web/src/components/spiraltest/SpiralTestControls.tsx`: drop the **"Label size (mm)"** `Field` + its `Input` from the "Circle & layout" section, and replace the bare **"Labels"** checkbox label with a **Title prefix** text field + the **Axis labels** toggle. Concretely, replace the `<label … Labels …>` block (the checkbox) and the "Label size (mm)" Field with:

```tsx
          <Field label="Title prefix" className="col-span-2">
            <Input aria-label="title prefix" type="text" value={cfg.labels.titlePrefix}
              onChange={(e) => set("labels", { ...cfg.labels, titlePrefix: e.target.value })} />
          </Field>
          <label className="col-span-2 flex items-center gap-2 text-[12.5px] text-[color:var(--color-ink-muted)] select-none cursor-pointer">
            <input type="checkbox" className="accent-[color:var(--color-primary)]" checked={cfg.labels.show}
              onChange={(e) => set("labels", { ...cfg.labels, show: e.target.checked })} />
            Axis labels
          </label>
```
(`set` is the existing `<K extends keyof SpiralTestConfig>` helper. The footprint readout line stays.)

- [ ] **Step 8: Update `web/src/pages/SpiralTestPage.tsx`** — `DEFAULT_CFG` and the Label-engrave section (full fill params). Keep the `descentDepthMm` import + the Focus-descent readout (unchanged).

(a) `DEFAULT_CFG`: replace the `label`/`score` lines:
```tsx
  bedMm: { w: 300, h: 300 }, labels: { show: true, titlePrefix: "" },
  cut: { passes: 250, focusInitialMm: 0.01, focusStepMm: 0.06, focusIntervalPasses: 20,
         power: 100, speed: 1500, frequency: 65, pulseWidth: 80, laser: "red" },
  // Label engrave — MOPA IR fill-engrave preset.
  score: { laser: "red", power: 65, speed: 1944, passes: 1, linesPerCm: 300, scanMode: "bidirectional", pulseWidth: 500, frequency: 65 },
```

(b) In the **"Label engrave"** `Section`, add two fields after "Pass" (Lines per cm + Engraving mode) and keep the rest; replace the whole grid with:
```tsx
              <div className="grid grid-cols-2 gap-2">
                <Field label="Laser" className="col-span-2">
                  <Select aria-label="label laser" value={cfg.score.laser}
                    onChange={(e) => setScore("laser", e.target.value as SpiralTestConfig["score"]["laser"])}>
                    <option value="red">MOPA IR</option>
                    <option value="blue">Blue</option>
                    <option value="uv">UV</option>
                  </Select>
                </Field>
                <Field label="Power (%)">
                  <Input aria-label="label power" type="number" mono value={cfg.score.power}
                    onChange={(e) => setScore("power", num(e.target.value, cfg.score.power))} />
                </Field>
                <Field label="Speed (mm/s)">
                  <Input aria-label="label speed" type="number" mono value={cfg.score.speed}
                    onChange={(e) => setScore("speed", num(e.target.value, cfg.score.speed))} />
                </Field>
                <Field label="Pass">
                  <Input aria-label="label pass" type="number" mono value={cfg.score.passes}
                    onChange={(e) => setScore("passes", Math.max(1, Math.round(num(e.target.value, cfg.score.passes))))} />
                </Field>
                <Field label="Lines per cm">
                  <Input aria-label="label lines per cm" type="number" mono value={cfg.score.linesPerCm}
                    onChange={(e) => setScore("linesPerCm", num(e.target.value, cfg.score.linesPerCm))} />
                </Field>
                <Field label="Engraving mode" className="col-span-2">
                  <Select aria-label="label engraving mode" value={cfg.score.scanMode}
                    onChange={(e) => setScore("scanMode", e.target.value as SpiralTestConfig["score"]["scanMode"])}>
                    <option value="bidirectional">Bi-directional</option>
                    <option value="unidirectional">Uni-directional</option>
                  </Select>
                </Field>
                <Field label="Pulse width (ns)">
                  <Input aria-label="label pulse width" type="number" mono value={cfg.score.pulseWidth}
                    onChange={(e) => setScore("pulseWidth", num(e.target.value, cfg.score.pulseWidth))} />
                </Field>
                <Field label="Frequency (kHz)">
                  <Input aria-label="label frequency" type="number" mono value={cfg.score.frequency}
                    onChange={(e) => setScore("frequency", num(e.target.value, cfg.score.frequency))} />
                </Field>
              </div>
```
And change the note text from "Vector engrave along the label strokes." to "Real-font fill engrave (title + axis values)."

- [ ] **Step 9: Update `web/src/components/spiraltest/SpiralTestPreview.tsx`** to draw the label outlines filled. Replace the `result.labelPaths.flatMap(...)` block with a `result.labelOutlines` block; keep the cut-arms block. The existing `path(ring)` helper emits `M…L…` with **no** trailing `Z`, so append `Z` per ring and render filled (nonzero) ember:

```tsx
      {result.labelOutlines.map((lbl, i) => (
        <path key={`l${i}`} d={lbl.rings.map((r) => path(r) + "Z").join(" ")}
          fillRule="nonzero" fill="var(--color-primary)" stroke="none" />
      ))}
```

- [ ] **Step 10: Update `web/src/components/spiraltest/controls.test.tsx`** — the CFG fixture `label`→`labels`, `score` shape; and the diameter test stays. Replace the fixture's `label`/`score` lines:
```tsx
  bedMm: { w: 300, h: 300 }, labels: { show: true, titlePrefix: "" },
  cut: { passes: 250, focusInitialMm: 0.01, focusStepMm: 0.06, focusIntervalPasses: 20, power: 100, speed: 1500, frequency: 65, pulseWidth: 80, laser: "red" },
  score: { laser: "red", power: 65, speed: 1944, passes: 1, linesPerCm: 300, scanMode: "bidirectional", pulseWidth: 500, frequency: 65 },
```
Add a test that the Title-prefix field edits `labels.titlePrefix`:
```tsx
  it("edits the title prefix", () => {
    const onChange = vi.fn();
    render(<SpiralTestControls cfg={CFG} onChange={onChange} footprint={{ w: 1, h: 1 }} overBed={false} />);
    fireEvent.change(screen.getByLabelText("title prefix"), { target: { value: "BRASS" } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ labels: expect.objectContaining({ titlePrefix: "BRASS" }) }));
  });
```
(Keep the existing "resolved axis values + footprint" and "diameter" tests — they don't reference labels/score.)

- [ ] **Step 11: Typecheck, test, build**

Run: `cd web && npx tsc --noEmit && npm test -- --run`
Expected: tsc clean; all suites pass (no `strokeFont` references remain). Confirm: `grep -rn "strokeFont\|labelPaths\|label\.sizeMm\|\.score\.passes" web/src` returns only intended refs (no `strokeFont`/`labelPaths`/`label.sizeMm`).
Run: `cd web && npm run build > /dev/null 2>&1 && echo BUILD_OK` → `BUILD_OK`.

- [ ] **Step 12: Commit**

```bash
git add web/src/lib/forge/spiralTest.ts web/src/lib/forge/spiralTest.test.ts \
        web/src/lib/forge/spiralTestXs.ts web/src/lib/forge/spiralTestXs.test.ts \
        web/src/components/spiraltest/SpiralTestControls.tsx web/src/components/spiraltest/controls.test.tsx \
        web/src/components/spiraltest/SpiralTestPreview.tsx web/src/pages/SpiralTestPage.tsx
git commit -m "feat(spiral-test): axis labels + real-font (filled) fill-engrave, diameter-aware"
```

---

## Task 3: Changelog note + browser verification

**Files:** Modify `changelog/2026-06-18-spiral-test.md`.

- [ ] **Step 1: Note the labeling in the changelog** — append to the body of `changelog/2026-06-18-spiral-test.md`:

```markdown

Labels are laid out as axes — a title line summarising the fixed cut params
(`D:… P:… F:…`), channel-width values along the bottom and pitch values down the
left — engraved in JetBrains Mono as a fill operation, auto-sized to the grid.
```

- [ ] **Step 2: Full suites**

Run: `cd web && npx tsc --noEmit && npm test -- --run` → tsc clean; all pass.

- [ ] **Step 3: Browser golden path**

Restart the dev server (serves fresh `web/dist`), open `http://127.0.0.1:8017/#/spiral-test`, and verify:
- The title line reads `D:10 P:100 F:65 PW:80 S:1500 ID:0.01 DI:20 DS:0.06` (real JetBrains Mono, filled), centred above the grid; channel-width values along the bottom; pitch values down the left. No per-cell labels; cells are tighter.
- Set diameter = 2, then 20 — axis/title text stays legible and inside its margins (diameter-aware). Type a Title prefix → it prepends. Toggle Axis labels off → labels disappear.
- Export `.xs`; unzip and confirm two ops: `VECTOR_CUTTING` (focus descent) + `FILL_VECTOR_ENGRAVING` (power 65, speed 1944, density 300, bitmapScanMode zMode). Screenshot and review label legibility critically.

- [ ] **Step 4: Commit**

```bash
git add changelog/2026-06-18-spiral-test.md
git commit -m "docs(spiral-test): changelog note for axis labels"
```

---

## Execution notes

- All work continues on `feat/spiral-test` (PR #159); push when done and let CI re-run.
- `opentype.js` is a **dev**-only dependency (the bake); the runtime ships only `glyphTable.json`. CI uses the committed JSON — no font fetch at build time.
- Deviation to flag in the PR: `bitmapScanMode` for "Uni-directional" is a best-guess (`"nMode"`); the used default Bi-directional (`"zMode"`) is confirmed from `test-font.xs`. Confirm `nMode` against a uni-directional Studio sample if uni is ever used.
- Diameter is prepended to the title (`D:{diameter}`) since it isn't shown on the axes.
```
