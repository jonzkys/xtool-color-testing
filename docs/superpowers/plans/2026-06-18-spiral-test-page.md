# Spiral Test Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A new `#/spiral-test` support page that generates a 2D channel-width × pitch grid of spiral-cut test circles (fixed diameter, per-cell engraved labels) and exports a single `.xs` file.

**Architecture:** Pure client-side. New modules build the grid geometry (reusing the Forge `spiralFromRegion` generator) and a small 7-segment stroke font for labels; export reuses the proven `buildGeneratedXcs` + `legacyRawToXs(doc, null)` path by emitting every path (cut arms and label strokes) as `generatedClass:"spiral"` `GeneratedPath`s in two groups (a high-power cut group and a low-power label group), so both survive `buildGeneratedXcs`'s spiral-only filter and Studio shows two operations.

**Tech Stack:** React + TypeScript + Vite + Tailwind v4 (Workshop-Instrument design system); vitest. No backend.

**Spec:** `docs/superpowers/specs/2026-06-18-spiral-test-page-design.md`

**Key facts established from the codebase (do not re-derive):**
- `web/src/lib/forge/spiral.ts` exports `spiralFromRegion(part: Pt[][], opts: SpiralOptions, exclude?): SpiralResult` where `SpiralOptions = { channelWidthMm, pitchMm, side: "outside"|"inside", minChannelMm }` and `SpiralResult = { arms: Pt[][]; armClass; warnings: string[] }`. Arms are OPEN polylines in mm.
- `Pt = { x: number; y: number }` from `web/src/lib/cuttime/geometry.ts`.
- `web/src/lib/forge/types.ts` `GeneratedPath = { sourceObjectId; generatedClass: "seed"|"perforate"|"deepen"|"clean"|"spiral"; groupName; layerStart; layerEnd; widthMultiplier; offsetMm; sideMode; operationOrder; enabled; rings: Pt[][] }`.
- `web/src/lib/forge/xcs.ts` exports `buildGeneratedXcs(parsed, inciseId, paths, mmPerUnit, stageParams={}, scanAngleDeg?, userOrder=false, maxPathPoints=1500, joinStrands=false)`, `parseXcsFile(buf: ArrayBuffer): ParsedXcs`, `contourToDPath(points, closed, mmPerUnit)`, `MAX_PATH_POINTS = 1500`.
- `buildGeneratedXcs` drops every non-`"spiral"` path when ANY `"spiral"` path is present — so labels MUST be `generatedClass:"spiral"` too.
- It chunks only `rings[0]` against the 1500-pt cap — so each spiral ARM must be its own `GeneratedPath` (`rings:[arm]`), not many arms in one path.
- A spiral path's device entry is `VECTOR_CUTTING`; `stageParams[groupName]` overrides its customize (power/speed/passes→repeat/pulseWidth/frequency→mopaFrequency/laser→processingLightSource and focus fields cuttingDrop/sinkingMethod/descentPerStep/descentIntervalDescent/firstCuttingDropValue/cuttingDropValue).
- A source incise display with `scale:{x:1,y:1}`, `offsetX:0`, `offsetY:0` maps dPath-mm 1:1 to canvas-mm; generated displays recompute their own x/y/width/height from the geometry bbox.
- `web/src/lib/forge/xs.ts` exports `xsToLegacyRaw(buf): { raw; bundle }` and `legacyRawToXs(raw, bundle, userOrder=false): ArrayBuffer`. Passing `bundle = null` synthesizes a complete `.xs` from the legacy raw model.
- `classify`: `INTAGLIO`/`VECTOR_CUTTING` → `"incise"` (a forge target).

**Conventions:** Frontend gate before any commit: `cd web && npx tsc --noEmit && npm test -- --run`. After `web/src/**` changes, rebuild for browser testing: `cd web && npm run build`. Never `git commit --no-verify`.

**File structure:**
```
web/src/lib/forge/strokeFont.ts        NEW  7-segment glyphs + renderLabel()
web/src/lib/forge/spiralTest.ts        NEW  resolveAxis, circleRegion, formatLabel, buildSpiralTest()
web/src/lib/forge/spiralTestXs.ts      NEW  buildSpiralTestXs(): template → buildGeneratedXcs → legacyRawToXs(_, null)
web/src/components/spiraltest/SpiralTestControls.tsx   NEW  control panels
web/src/components/spiraltest/SpiralTestPreview.tsx    NEW  SVG grid preview
web/src/pages/SpiralTestPage.tsx       NEW  page shell + state + export
web/src/router.ts                      MOD  route
web/src/App.tsx                        MOD  lazy import + title + render
web/src/components/TopBar.tsx          MOD  nav entry
changelog/2026-06-18-spiral-test.md    NEW
```

---

## Task 1: Single-stroke (7-segment) label font

A compact 7-segment stroke font for the characters labels need (`0-9`, `.`, `/`, `-`, space), rendering open polylines in mm. Legible for engraved numeric labels, trivial to define.

**Files:**
- Create: `web/src/lib/forge/strokeFont.ts`
- Test: `web/src/lib/forge/strokeFont.test.ts`

- [ ] **Step 1: Write the failing test**

Create `web/src/lib/forge/strokeFont.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { renderLabel, glyphSegments } from "./strokeFont";

describe("glyphSegments", () => {
  it("maps a digit to its 7-segment strokes (1 = two segments)", () => {
    expect(glyphSegments("1").length).toBe(2); // segments b + c
    expect(glyphSegments("8").length).toBe(7); // all 7 segments
  });
  it("space renders nothing; unknown char renders nothing", () => {
    expect(glyphSegments(" ")).toEqual([]);
    expect(glyphSegments("Z")).toEqual([]);
  });
  it("'/' is a single diagonal stroke", () => {
    expect(glyphSegments("/").length).toBe(1);
  });
});

describe("renderLabel", () => {
  it("returns open polylines positioned from the origin, advancing right", () => {
    const polys = renderLabel("1.0", 4, { x: 10, y: 20 });
    expect(polys.length).toBeGreaterThan(0);
    // every segment is a 2-point open polyline
    for (const p of polys) expect(p.length).toBe(2);
    // all points lie at/right of origin.x and within a few glyph widths
    const xs = polys.flat().map((p) => p.x);
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(10 - 1e-9);
    // three glyphs ("1",".","0") advance well past origin
    expect(Math.max(...xs)).toBeGreaterThan(10 + 4);
  });
  it("scales with sizeMm (glyph height ≈ sizeMm)", () => {
    const polys = renderLabel("8", 6, { x: 0, y: 0 });
    const ys = polys.flat().map((p) => p.y);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(6, 5);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd web && npx vitest run src/lib/forge/strokeFont.test.ts`
Expected: FAIL — cannot find module `./strokeFont`.

- [ ] **Step 3: Implement `strokeFont.ts`**

Create `web/src/lib/forge/strokeFont.ts`:

```ts
// web/src/lib/forge/strokeFont.ts
// Minimal 7-segment stroke font for engraved numeric labels. Each glyph is a
// set of open 2-point polylines on a cell of width 0.6·size and height size
// (y grows downward, matching mm canvas space). Only the characters spiral-test
// labels use are defined: digits, '.', '/', '-', space.
import type { Pt } from "./types";

/** 7-segment endpoints on a unit cell [0..W]×[0..H], W = 0.6, H = 1. */
const W = 0.6;
const H = 1;
const TL: Pt = { x: 0, y: 0 };
const TR: Pt = { x: W, y: 0 };
const ML: Pt = { x: 0, y: H / 2 };
const MR: Pt = { x: W, y: H / 2 };
const BL: Pt = { x: 0, y: H };
const BR: Pt = { x: W, y: H };
const SEG: Record<string, [Pt, Pt]> = {
  a: [TL, TR], b: [TR, MR], c: [MR, BR], d: [BL, BR], e: [ML, BL], f: [TL, ML], g: [ML, MR],
};
const DIGIT_SEGS: Record<string, string> = {
  "0": "abcdef", "1": "bc", "2": "abged", "3": "abgcd", "4": "fgbc",
  "5": "afgcd", "6": "afgecd", "7": "abc", "8": "abcdefg", "9": "abcdfg",
};

/** Unit-cell strokes (2-point polylines) for one character; [] if unsupported. */
export function glyphSegments(ch: string): [Pt, Pt][] {
  if (ch in DIGIT_SEGS) return DIGIT_SEGS[ch].split("").map((s) => SEG[s]);
  if (ch === "-") return [SEG.g];
  if (ch === "/") return [[BL, TR]];
  if (ch === ".") return [[{ x: W * 0.35, y: H }, { x: W * 0.65, y: H }]];
  return []; // space + anything else
}

const ADVANCE = W + 0.25; // unit cell advance (monospace + kerning)

/** Render `text` as open polylines (mm), top-left of the first glyph at `origin`,
 *  glyph height = `sizeMm`, laid out left-to-right. */
export function renderLabel(text: string, sizeMm: number, origin: Pt): Pt[][] {
  const out: Pt[][] = [];
  let penX = origin.x;
  for (const ch of text) {
    for (const [a, b] of glyphSegments(ch)) {
      out.push([
        { x: penX + a.x * sizeMm, y: origin.y + a.y * sizeMm },
        { x: penX + b.x * sizeMm, y: origin.y + b.y * sizeMm },
      ]);
    }
    penX += ADVANCE * sizeMm;
  }
  return out;
}

/** Approximate width (mm) of a rendered label. */
export function labelWidth(text: string, sizeMm: number): number {
  return text.length * ADVANCE * sizeMm;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd web && npx vitest run src/lib/forge/strokeFont.test.ts`
Expected: PASS (3 + 2 assertions green). Note the height test: segment `a` is at y=0 and `d` at y=H·size, so for "8" the span is exactly `sizeMm`.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/forge/strokeFont.ts web/src/lib/forge/strokeFont.test.ts
git commit -m "feat(spiral-test): 7-segment stroke font for engraved labels"
```

---

## Task 2: Grid helpers — axis resolution, circle region, label formatting

Small pure helpers for the grid model.

**Files:**
- Create: `web/src/lib/forge/spiralTest.ts`
- Test: `web/src/lib/forge/spiralTest.test.ts`

- [ ] **Step 1: Write the failing test**

Create `web/src/lib/forge/spiralTest.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { resolveAxis, circleRegion, formatLabel } from "./spiralTest";

describe("resolveAxis", () => {
  it("linearly spaces min..max over steps", () => {
    expect(resolveAxis({ min: 0.4, max: 1.0, steps: 4 })).toEqual([0.4, 0.6, 0.8, 1.0]);
  });
  it("steps=1 yields [min]", () => {
    expect(resolveAxis({ min: 0.5, max: 2, steps: 1 })).toEqual([0.5]);
  });
  it("clamps steps to >= 1 and dedupes a zero-span axis", () => {
    expect(resolveAxis({ min: 0.3, max: 0.3, steps: 3 })).toEqual([0.3, 0.3, 0.3]);
  });
});

describe("circleRegion", () => {
  it("is one closed-ish loop of `segments` points centred at (cx,cy) with radius d/2", () => {
    const loops = circleRegion(10, 20, 8, 32);
    expect(loops.length).toBe(1);
    expect(loops[0].length).toBe(32);
    for (const p of loops[0]) {
      expect(Math.hypot(p.x - 10, p.y - 20)).toBeCloseTo(4, 5); // radius 4
    }
  });
});

describe("formatLabel", () => {
  it("renders channel/pitch as cw(2dp)/pitch(3dp)", () => {
    expect(formatLabel(0.8, 0.04)).toBe("0.80/0.040");
    expect(formatLabel(1, 0.035)).toBe("1.00/0.035");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd web && npx vitest run src/lib/forge/spiralTest.test.ts`
Expected: FAIL — cannot find module `./spiralTest`.

- [ ] **Step 3: Implement the helpers**

Create `web/src/lib/forge/spiralTest.ts` (the rest of the module — `SpiralTestConfig`, `buildSpiralTest` — is added in Task 3; this step adds only the imports + these three helpers):

```ts
// web/src/lib/forge/spiralTest.ts
// 2D spiral-test grid: a channel-width × pitch sweep of spiral-cut circles with
// engraved per-cell labels. Pure geometry; reuses the Forge spiral generator.
import type { Pt } from "./types";

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

/** Per-cell label text: channel width (2 dp) / pitch (3 dp). */
export function formatLabel(channelWidthMm: number, pitchMm: number): string {
  return `${channelWidthMm.toFixed(2)}/${pitchMm.toFixed(3)}`;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd web && npx vitest run src/lib/forge/spiralTest.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/forge/spiralTest.ts web/src/lib/forge/spiralTest.test.ts
git commit -m "feat(spiral-test): axis/circle/label grid helpers"
```

---

## Task 3: `buildSpiralTest` — the grid model

Assemble the cells: one circle per (col,row), its spiral arms (via `spiralFromRegion`) as cut `GeneratedPath`s and its label strokes as a score `GeneratedPath`, plus footprint + over-bed flag + de-duped warnings.

**Files:**
- Modify: `web/src/lib/forge/spiralTest.ts`
- Test: `web/src/lib/forge/spiralTest.test.ts`

- [ ] **Step 1: Write the failing test** — append to `web/src/lib/forge/spiralTest.test.ts`:

```ts
import { buildSpiralTest, type SpiralTestConfig } from "./spiralTest";

const CFG: SpiralTestConfig = {
  channelWidth: { min: 0.6, max: 1.0, steps: 3 }, // 3 cols
  pitch: { min: 0.03, max: 0.05, steps: 2 },       // 2 rows
  diameterMm: 8,
  side: "outside",
  minChannelMm: 0.4,
  gapMm: 4,
  bedMm: { w: 300, h: 300 },
  label: { sizeMm: 2.5, show: true },
  cut: { passes: 200, focusInitialMm: 0.01, focusStepMm: 0.06, focusIntervalPasses: 20,
         power: 100, speed: 1500, frequency: 65, pulseWidth: 80, laser: "red" },
  score: { power: 8, speed: 300, passes: 1 },
};

describe("buildSpiralTest", () => {
  it("produces one cell per (col,row) with the swept channel/pitch", () => {
    const r = buildSpiralTest(CFG);
    expect(r.cells.length).toBe(6); // 3 × 2
    const c00 = r.cells.find((c) => c.col === 0 && c.row === 0)!;
    expect(c00.channelWidthMm).toBeCloseTo(0.6, 5);
    expect(c00.pitchMm).toBeCloseTo(0.03, 5);
    const c21 = r.cells.find((c) => c.col === 2 && c.row === 1)!;
    expect(c21.channelWidthMm).toBeCloseTo(1.0, 5);
    expect(c21.pitchMm).toBeCloseTo(0.05, 5);
  });
  it("emits cut GeneratedPaths (spiral class) plus one score path per cell", () => {
    const r = buildSpiralTest(CFG);
    expect(r.cutPaths.length).toBeGreaterThanOrEqual(6); // >=1 arm per cell
    expect(r.cutPaths.every((p) => p.generatedClass === "spiral")).toBe(true);
    expect(r.cutPaths.every((p) => p.groupName === "CUT_SPIRAL")).toBe(true);
    expect(r.cutPaths.every((p) => p.rings.length === 1)).toBe(true); // one arm per path
    expect(r.labelPaths.length).toBe(6);
    expect(r.labelPaths.every((p) => p.generatedClass === "spiral")).toBe(true);
    expect(r.labelPaths.every((p) => p.groupName === "SCORE_LABEL")).toBe(true);
  });
  it("computes footprint and over-bed flag", () => {
    const r = buildSpiralTest(CFG);
    expect(r.footprintMm.w).toBeGreaterThan(0);
    expect(r.footprintMm.h).toBeGreaterThan(0);
    expect(r.overBed).toBe(false);
    const tiny = buildSpiralTest({ ...CFG, bedMm: { w: 5, h: 5 } });
    expect(tiny.overBed).toBe(true);
  });
  it("omits labels when label.show is false", () => {
    const r = buildSpiralTest({ ...CFG, label: { sizeMm: 2.5, show: false } });
    expect(r.labelPaths.length).toBe(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd web && npx vitest run src/lib/forge/spiralTest.test.ts`
Expected: FAIL — `buildSpiralTest` / `SpiralTestConfig` not exported.

- [ ] **Step 3: Implement `buildSpiralTest`** — append to `web/src/lib/forge/spiralTest.ts`:

```ts
import { spiralFromRegion } from "./spiral";
import { renderLabel, labelWidth } from "./strokeFont";
import type { GeneratedPath } from "./types";

export interface SpiralTestConfig {
  channelWidth: AxisSpec;   // X axis (mm)
  pitch: AxisSpec;          // Y axis (mm)
  diameterMm: number;
  side: "outside" | "inside";
  minChannelMm: number;
  gapMm: number;
  bedMm: { w: number; h: number };
  label: { sizeMm: number; show: boolean };
  cut: {
    passes: number; focusInitialMm: number; focusStepMm: number; focusIntervalPasses: number;
    power: number; speed: number; frequency: number; pulseWidth: number; laser: "red" | "blue" | "uv";
  };
  score: { power: number; speed: number; passes: number };
}

export interface CellInfo {
  row: number; col: number;
  channelWidthMm: number; pitchMm: number;
  centerMm: { x: number; y: number };
  cut: Pt[][];        // the cell's arms (open polylines), positioned in mm
  label: Pt[][];      // the cell's label strokes, positioned in mm
  labelText: string;
  warnings: string[];
}

export interface SpiralTestResult {
  cells: CellInfo[];
  cutPaths: GeneratedPath[];   // one per arm, group "CUT_SPIRAL"
  labelPaths: GeneratedPath[]; // one per cell, group "SCORE_LABEL"
  footprintMm: { w: number; h: number };
  overBed: boolean;
  warnings: string[];
}

const MARGIN_MM = 5; // grid origin offset from (0,0)

export function buildSpiralTest(cfg: SpiralTestConfig): SpiralTestResult {
  const cws = resolveAxis(cfg.channelWidth);
  const pitches = resolveAxis(cfg.pitch);
  const maxCw = Math.max(...cws);
  const r = cfg.diameterMm / 2;
  const labelBand = cfg.label.show ? cfg.label.sizeMm + 1.5 : 0;
  // Uniform cell box: disc + channel ring (max) + label band + gap.
  const cell = cfg.diameterMm + 2 * maxCw + labelBand + cfg.gapMm;

  const cells: CellInfo[] = [];
  const cutPaths: GeneratedPath[] = [];
  const labelPaths: GeneratedPath[] = [];
  const warnSet = new Set<string>();
  let order = 0;

  for (let row = 0; row < pitches.length; row++) {
    for (let col = 0; col < cws.length; col++) {
      const channelWidthMm = cws[col];
      const pitchMm = pitches[row];
      const cx = MARGIN_MM + cell / 2 + col * cell;
      const cy = MARGIN_MM + cell / 2 + row * cell;

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

      const labelText = formatLabel(channelWidthMm, pitchMm);
      let labelStrokes: Pt[][] = [];
      if (cfg.label.show) {
        const w = labelWidth(labelText, cfg.label.sizeMm);
        const lx = cx - w / 2;                       // centred under the disc
        const ly = cy + r + maxCw + 1.0;             // just below the widest channel ring
        labelStrokes = renderLabel(labelText, cfg.label.sizeMm, { x: lx, y: ly });
        labelPaths.push({
          sourceObjectId: "spiral-test", generatedClass: "spiral", groupName: "SCORE_LABEL",
          layerStart: 0, layerEnd: cfg.score.passes, widthMultiplier: 1, offsetMm: 0,
          sideMode: "outside", operationOrder: order++, enabled: true, rings: labelStrokes,
        });
      }

      cells.push({
        row, col, channelWidthMm, pitchMm, centerMm: { x: cx, y: cy },
        cut: res.arms, label: labelStrokes, labelText, warnings: res.warnings,
      });
    }
  }

  const footprintMm = {
    w: 2 * MARGIN_MM + cws.length * cell,
    h: 2 * MARGIN_MM + pitches.length * cell,
  };
  return {
    cells, cutPaths, labelPaths, footprintMm,
    overBed: footprintMm.w > cfg.bedMm.w || footprintMm.h > cfg.bedMm.h,
    warnings: [...warnSet],
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd web && npx vitest run src/lib/forge/spiralTest.test.ts`
Expected: PASS (all describe blocks). If `spiralFromRegion` returns zero arms for the tiny test geometry, increase `diameterMm` in the fixture — at d=8mm with channel 0.6–1.0 it produces multiple arms.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/forge/spiralTest.ts web/src/lib/forge/spiralTest.test.ts
git commit -m "feat(spiral-test): grid model — cells, cut + label paths, footprint"
```

---

## Task 4: `.xs` export — `buildSpiralTestXs`

Assemble a single `.xs` from the grid paths by reusing `buildGeneratedXcs` (against a minimal in-code INTAGLIO template) + `legacyRawToXs(doc, null)`. The label group's `stageParams` set low power / single pass / no focus drop.

**Files:**
- Create: `web/src/lib/forge/spiralTestXs.ts`
- Test: `web/src/lib/forge/spiralTestXs.test.ts`

- [ ] **Step 1: Write the failing test**

Create `web/src/lib/forge/spiralTestXs.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildSpiralTest, type SpiralTestConfig } from "./spiralTest";
import { buildSpiralTestXs } from "./spiralTestXs";
import { isXsBuffer, xsToLegacyRaw } from "./xs";

const CFG: SpiralTestConfig = {
  channelWidth: { min: 0.6, max: 1.0, steps: 2 },
  pitch: { min: 0.03, max: 0.05, steps: 2 },
  diameterMm: 8, side: "outside", minChannelMm: 0.4, gapMm: 4,
  bedMm: { w: 300, h: 300 }, label: { sizeMm: 2.5, show: true },
  cut: { passes: 200, focusInitialMm: 0.01, focusStepMm: 0.06, focusIntervalPasses: 20,
         power: 100, speed: 1500, frequency: 65, pulseWidth: 80, laser: "red" },
  score: { power: 8, speed: 300, passes: 1 },
};

describe("buildSpiralTestXs", () => {
  it("emits a valid .xs that round-trips with both cut and score operations", () => {
    const result = buildSpiralTest(CFG);
    const buf = buildSpiralTestXs(result, CFG);
    expect(isXsBuffer(buf)).toBe(true);

    const { raw } = xsToLegacyRaw(buf);
    const r = raw as { canvas: Array<{ displays: Array<{ id: string }> }>;
      device: { data: { value: Array<[string, { displays: { value: Array<[string, { processingType?: string;
        data?: Record<string, { parameter?: { customize?: Record<string, unknown> } }> }]> } }]> } } };

    // displays: one per cut arm + one per label
    expect(r.canvas[0].displays.length).toBe(result.cutPaths.length + result.labelPaths.length);

    const entries = r.device.data.value[0][1].displays.value;
    const types = entries.map(([, e]) => e.processingType);
    // every generated path is VECTOR_CUTTING (labels are low-power single-pass cuts)
    expect(types.every((t) => t === "VECTOR_CUTTING")).toBe(true);

    // the cut group carries focus step-down; at least one entry has it on
    const anyFocus = entries.some(([, e]) => {
      const cz = e.data?.VECTOR_CUTTING?.parameter?.customize as Record<string, unknown> | undefined;
      return cz?.cuttingDrop === true && cz?.descentPerStep === 0.06;
    });
    expect(anyFocus).toBe(true);
    // at least one entry is the low-power label op (power 8, no descent)
    const anyLabel = entries.some(([, e]) => {
      const cz = e.data?.VECTOR_CUTTING?.parameter?.customize as Record<string, unknown> | undefined;
      return cz?.power === 8 && cz?.cuttingDrop === false;
    });
    expect(anyLabel).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd web && npx vitest run src/lib/forge/spiralTestXs.test.ts`
Expected: FAIL — cannot find module `./spiralTestXs`.

- [ ] **Step 3: Implement `spiralTestXs.ts`**

Create `web/src/lib/forge/spiralTestXs.ts`:

```ts
// web/src/lib/forge/spiralTestXs.ts
// Assemble a spiral-test grid into a single .xs file. Reuses the proven
// buildGeneratedXcs path (all paths emitted as spiral VECTOR_CUTTING in two
// groups) + the .xcs→.xs synthesis (legacyRawToXs(doc, null)). The label group
// is a low-power single-pass cut (it marks rather than severs) — the spec's
// sanctioned fallback, chosen so the whole job stays one VECTOR_CUTTING pipeline.
import { buildGeneratedXcs, parseXcsFile, MAX_PATH_POINTS } from "./xcs";
import { legacyRawToXs } from "./xs";
import type { StageParams } from "./types";
import type { SpiralTestConfig, SpiralTestResult } from "./spiralTest";

const CANVAS_ID = "00000000-0000-4000-8000-0000000000aa";

/** Minimal legacy-raw .xcs doc with ONE INTAGLIO incise display at scale 1 /
 *  offset 0, so buildGeneratedXcs reuses a 1:1 mm→canvas mapping and strips it. */
function templateBytes(): ArrayBuffer {
  const doc = {
    canvas: [
      {
        displays: [
          {
            id: "tpl-incise", type: "PATH", name: "tpl",
            dPath: "M0,0 L1,0 L1,1 L0,1 Z",
            isClosePath: true, isFill: true,
            scale: { x: 1, y: 1 }, offsetX: 0, offsetY: 0,
            x: 0, y: 0, width: 1, height: 1, angle: 0, pivot: { x: 0, y: 0 },
          },
        ],
        layerData: {},
      },
    ],
    device: {
      data: {
        dataType: "Map",
        value: [
          [
            CANVAS_ID,
            {
              mode: "LASER_PLANE",
              displays: {
                dataType: "Map",
                value: [
                  [
                    "tpl-incise",
                    {
                      type: "PATH", processingType: "INTAGLIO", isFill: true,
                      data: { INTAGLIO: { materialType: "customize", parameter: { customize: {} } } },
                    },
                  ],
                ],
              },
            },
          ],
        ],
      },
    },
  };
  return new TextEncoder().encode(JSON.stringify(doc)).buffer;
}

export function buildSpiralTestXs(result: SpiralTestResult, cfg: SpiralTestConfig): ArrayBuffer {
  const parsed = parseXcsFile(templateBytes());
  const inciseId = parsed.targets[0].id;

  const stageParams: Record<string, StageParams> = {
    CUT_SPIRAL: {
      power: cfg.cut.power, speed: cfg.cut.speed, passes: cfg.cut.passes,
      pulseWidth: cfg.cut.pulseWidth, frequency: cfg.cut.frequency, laser: cfg.cut.laser,
      cuttingDrop: true, sinkingMethod: "step",
      firstCuttingDropValue: cfg.cut.focusInitialMm, cuttingDropValue: cfg.cut.focusInitialMm,
      descentIntervalDescent: cfg.cut.focusIntervalPasses, descentPerStep: cfg.cut.focusStepMm,
    },
    SCORE_LABEL: {
      power: cfg.score.power, speed: cfg.score.speed, passes: cfg.score.passes,
      laser: "red", cuttingDrop: false,
    },
  };

  const allPaths = [...result.cutPaths, ...result.labelPaths];
  const doc = buildGeneratedXcs(
    parsed, inciseId, allPaths, 1 /* mmPerUnit */, stageParams,
    undefined /* scanAngle */, false /* userOrder */, MAX_PATH_POINTS, false /* joinStrands */,
  );
  return legacyRawToXs(doc, null, false);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd web && npx vitest run src/lib/forge/spiralTestXs.test.ts`
Expected: PASS. If `applyStageParams` does not map `passes`→`repeat` (so the label `repeat` is wrong), the assertions on `power`/`cuttingDrop` still hold; only adjust if a `repeat` assertion is added. If the round-trip `device.data.value[0]` shape differs, log `JSON.stringify(raw).slice(0,400)` to confirm the group key path and adjust the test's accessor (the production code is unaffected).

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/forge/spiralTestXs.ts web/src/lib/forge/spiralTestXs.test.ts
git commit -m "feat(spiral-test): assemble grid into a single .xs (cut + score ops)"
```

---

## Task 5: Page, controls, preview + registration

The UI: a three-column page (grid config / SVG preview / cut params + export), wired into the router/nav. Generation runs synchronously on change.

**Files:**
- Create: `web/src/components/spiraltest/SpiralTestControls.tsx`, `web/src/components/spiraltest/SpiralTestPreview.tsx`, `web/src/pages/SpiralTestPage.tsx`
- Modify: `web/src/router.ts`, `web/src/App.tsx`, `web/src/components/TopBar.tsx`
- Test: `web/src/components/spiraltest/controls.test.tsx`

- [ ] **Step 1: Register the route** — `web/src/router.ts`:

In the `Route` union (after the `| { name: "spiral" }` line) add:
```ts
  | { name: "spiral-test" }
```
In `parseRoute`, beside the `spiral` handling add:
```ts
  if (h === "spiral-test") return { name: "spiral-test" };
```
In `formatRoute`, add a case mirroring the others:
```ts
    case "spiral-test": return "#/spiral-test";
```
(If `formatRoute` is a switch on `route.name`; otherwise add the matching branch in the same style as the existing `"spiral"` entry.)

- [ ] **Step 2: Build the controls component** — create `web/src/components/spiraltest/SpiralTestControls.tsx`:

```tsx
import type { SpiralTestConfig } from "../../lib/forge/spiralTest";
import { resolveAxis } from "../../lib/forge/spiralTest";
import { Field, Section } from "../../ui";

interface Props {
  cfg: SpiralTestConfig;
  onChange: (c: SpiralTestConfig) => void;
  footprint: { w: number; h: number };
  overBed: boolean;
}

function num(v: string, fallback: number): number {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
}

export function SpiralTestControls({ cfg, onChange, footprint, overBed }: Props) {
  const set = <K extends keyof SpiralTestConfig>(k: K, v: SpiralTestConfig[K]) =>
    onChange({ ...cfg, [k]: v });
  const xs = resolveAxis(cfg.channelWidth).map((v) => v.toFixed(2)).join(", ");
  const ys = resolveAxis(cfg.pitch).map((v) => v.toFixed(3)).join(", ");

  return (
    <div className="flex flex-col gap-4">
      <Section title="Grid" dense>
        <div className="grid grid-cols-3 gap-2">
          <Field label="CW min"><input aria-label="channel width min" type="number" step="0.05" value={cfg.channelWidth.min}
            onChange={(e) => set("channelWidth", { ...cfg.channelWidth, min: num(e.target.value, cfg.channelWidth.min) })} /></Field>
          <Field label="CW max"><input aria-label="channel width max" type="number" step="0.05" value={cfg.channelWidth.max}
            onChange={(e) => set("channelWidth", { ...cfg.channelWidth, max: num(e.target.value, cfg.channelWidth.max) })} /></Field>
          <Field label="CW steps"><input aria-label="channel width steps" type="number" step="1" value={cfg.channelWidth.steps}
            onChange={(e) => set("channelWidth", { ...cfg.channelWidth, steps: num(e.target.value, cfg.channelWidth.steps) })} /></Field>
          <Field label="Pitch min"><input aria-label="pitch min" type="number" step="0.005" value={cfg.pitch.min}
            onChange={(e) => set("pitch", { ...cfg.pitch, min: num(e.target.value, cfg.pitch.min) })} /></Field>
          <Field label="Pitch max"><input aria-label="pitch max" type="number" step="0.005" value={cfg.pitch.max}
            onChange={(e) => set("pitch", { ...cfg.pitch, max: num(e.target.value, cfg.pitch.max) })} /></Field>
          <Field label="Pitch steps"><input aria-label="pitch steps" type="number" step="1" value={cfg.pitch.steps}
            onChange={(e) => set("pitch", { ...cfg.pitch, steps: num(e.target.value, cfg.pitch.steps) })} /></Field>
        </div>
        <p className="mt-1 font-mono text-[10px] text-[color:var(--color-ink-muted)]">CW: {xs}</p>
        <p className="font-mono text-[10px] text-[color:var(--color-ink-muted)]">Pitch: {ys}</p>
      </Section>

      <Section title="Circle & layout" dense>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Diameter (mm)"><input aria-label="diameter" type="number" step="0.5" value={cfg.diameterMm}
            onChange={(e) => set("diameterMm", num(e.target.value, cfg.diameterMm))} /></Field>
          <Field label="Gap (mm)"><input aria-label="gap" type="number" step="0.5" value={cfg.gapMm}
            onChange={(e) => set("gapMm", num(e.target.value, cfg.gapMm))} /></Field>
          <Field label="Bed W (mm)"><input aria-label="bed width" type="number" step="10" value={cfg.bedMm.w}
            onChange={(e) => set("bedMm", { ...cfg.bedMm, w: num(e.target.value, cfg.bedMm.w) })} /></Field>
          <Field label="Bed H (mm)"><input aria-label="bed height" type="number" step="10" value={cfg.bedMm.h}
            onChange={(e) => set("bedMm", { ...cfg.bedMm, h: num(e.target.value, cfg.bedMm.h) })} /></Field>
          <Field label="Label size (mm)"><input aria-label="label size" type="number" step="0.5" value={cfg.label.sizeMm}
            onChange={(e) => set("label", { ...cfg.label, sizeMm: num(e.target.value, cfg.label.sizeMm) })} /></Field>
          <label className="flex items-center gap-2 text-[12.5px] text-[color:var(--color-ink-muted)]">
            <input type="checkbox" checked={cfg.label.show}
              onChange={(e) => set("label", { ...cfg.label, show: e.target.checked })} /> Labels
          </label>
        </div>
        <p className="mt-1 font-mono text-[11px]" style={{ color: overBed ? "var(--color-primary)" : "var(--color-ink)" }}>
          Footprint: {footprint.w.toFixed(0)} × {footprint.h.toFixed(0)} mm{overBed ? " — exceeds bed" : ""}
        </p>
      </Section>
    </div>
  );
}
```

- [ ] **Step 3: Build the preview component** — create `web/src/components/spiraltest/SpiralTestPreview.tsx`:

```tsx
import type { SpiralTestResult } from "../../lib/forge/spiralTest";

interface Props { result: SpiralTestResult; }

/** Draw the generated cut arms (dark) + label strokes (ember) + footprint box. */
export function SpiralTestPreview({ result }: Props) {
  const { footprintMm: f } = result;
  const path = (poly: { x: number; y: number }[]) =>
    poly.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${f.w} ${f.h}`} className="h-full w-full" style={{ background: "var(--color-surface)" }}>
      <rect x={0} y={0} width={f.w} height={f.h} fill="none"
        stroke={result.overBed ? "var(--color-primary)" : "var(--color-border)"} strokeWidth={0.3} />
      {result.cutPaths.map((p, i) =>
        p.rings.map((ring, j) => (
          <path key={`c${i}-${j}`} d={path(ring)} fill="none" stroke="var(--color-ink)" strokeWidth={0.15} opacity={0.7} />
        )),
      )}
      {result.labelPaths.flatMap((p, i) =>
        p.rings.map((ring, j) => (
          <path key={`l${i}-${j}`} d={path(ring)} fill="none" stroke="var(--color-primary)" strokeWidth={0.25} />
        )),
      )}
    </svg>
  );
}
```

- [ ] **Step 4: Build the page** — create `web/src/pages/SpiralTestPage.tsx`:

```tsx
import { useMemo, useState } from "react";
import { Button, Card, PageContainer, Section } from "../ui";
import { SpiralTestControls } from "../components/spiraltest/SpiralTestControls";
import { SpiralTestPreview } from "../components/spiraltest/SpiralTestPreview";
import { buildSpiralTest, type SpiralTestConfig } from "../lib/forge/spiralTest";
import { buildSpiralTestXs } from "../lib/forge/spiralTestXs";

const DEFAULT_CFG: SpiralTestConfig = {
  channelWidth: { min: 0.6, max: 1.0, steps: 4 },
  pitch: { min: 0.03, max: 0.05, steps: 4 },
  diameterMm: 10, side: "outside", minChannelMm: 0.4, gapMm: 4,
  bedMm: { w: 300, h: 300 }, label: { sizeMm: 2.5, show: true },
  cut: { passes: 250, focusInitialMm: 0.01, focusStepMm: 0.06, focusIntervalPasses: 20,
         power: 100, speed: 1500, frequency: 65, pulseWidth: 80, laser: "red" },
  score: { power: 8, speed: 300, passes: 1 },
};

export function SpiralTestPage() {
  const [cfg, setCfg] = useState<SpiralTestConfig>(DEFAULT_CFG);
  const result = useMemo(() => buildSpiralTest(cfg), [cfg]);

  const onExport = () => {
    const buf = buildSpiralTestXs(result, cfg);
    const url = URL.createObjectURL(new Blob([buf], { type: "application/octet-stream" }));
    const a = document.createElement("a");
    a.href = url; a.download = "spiral-test.xs"; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <PageContainer>
      <div className="grid min-h-0 flex-1 grid-cols-[300px_minmax(0,1fr)_280px] items-stretch gap-4">
        <div className="overflow-y-auto pr-1">
          <SpiralTestControls cfg={cfg} onChange={setCfg} footprint={result.footprintMm} overBed={result.overBed} />
        </div>
        <Card padded={false} className="flex min-h-0 flex-1 p-3">
          <SpiralTestPreview result={result} />
        </Card>
        <div className="flex flex-col gap-4 overflow-y-auto pl-1">
          <Section title="Cut params" dense>
            <div className="grid grid-cols-2 gap-2">
              <label className="text-[11px]">Passes<input aria-label="passes" type="number" value={cfg.cut.passes}
                onChange={(e) => setCfg({ ...cfg, cut: { ...cfg.cut, passes: parseFloat(e.target.value) || cfg.cut.passes } })} /></label>
              <label className="text-[11px]">Power<input aria-label="power" type="number" value={cfg.cut.power}
                onChange={(e) => setCfg({ ...cfg, cut: { ...cfg.cut, power: parseFloat(e.target.value) || cfg.cut.power } })} /></label>
              <label className="text-[11px]">Speed<input aria-label="speed" type="number" value={cfg.cut.speed}
                onChange={(e) => setCfg({ ...cfg, cut: { ...cfg.cut, speed: parseFloat(e.target.value) || cfg.cut.speed } })} /></label>
              <label className="text-[11px]">Focus step<input aria-label="focus step" type="number" step="0.01" value={cfg.cut.focusStepMm}
                onChange={(e) => setCfg({ ...cfg, cut: { ...cfg.cut, focusStepMm: parseFloat(e.target.value) || cfg.cut.focusStepMm } })} /></label>
            </div>
          </Section>
          <Section title="Export" dense>
            <Button variant="primary" size="sm" className="w-full" onClick={onExport}>Export .xs</Button>
          </Section>
        </div>
      </div>
    </PageContainer>
  );
}
```

- [ ] **Step 5: Wire into `App.tsx`** — add the lazy import beside `SpiralPage` (line ~59):
```tsx
const SpiralTestPage = lazy(() =>
  import("./pages/SpiralTestPage").then((m) => ({ default: m.SpiralTestPage })),
);
```
In the title cascade (after the `"spiral"` entry, ~line 195):
```tsx
    : route.name === "spiral-test" ? "Spiral Test"
```
In the Suspense render block (where other routes render conditionally), add:
```tsx
{route.name === "spiral-test" && <SpiralTestPage />}
```
(Match the exact rendering style used for the adjacent `"spiral"` route — same gate/Suspense wrapper.)

- [ ] **Step 6: Wire into `TopBar.tsx`** — add `"spiral-test"` to the `NavRouteName` union (beside `"spiral"`), and add a child to the "Cut" group (after the Spiral entry, ~line 86):
```tsx
      { label: "Spiral Test", route: "spiral-test" },
```
If `activeNavRoute`/`toRoute` switch on names, add a `case "spiral-test":` returning `{ name: "spiral-test" }` / its own name in the same style as `"spiral"`.

- [ ] **Step 7: Write the controls test** — create `web/src/components/spiraltest/controls.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SpiralTestControls } from "./SpiralTestControls";
import type { SpiralTestConfig } from "../../lib/forge/spiralTest";

const CFG: SpiralTestConfig = {
  channelWidth: { min: 0.6, max: 1.0, steps: 4 }, pitch: { min: 0.03, max: 0.05, steps: 4 },
  diameterMm: 10, side: "outside", minChannelMm: 0.4, gapMm: 4, bedMm: { w: 300, h: 300 },
  label: { sizeMm: 2.5, show: true },
  cut: { passes: 250, focusInitialMm: 0.01, focusStepMm: 0.06, focusIntervalPasses: 20, power: 100, speed: 1500, frequency: 65, pulseWidth: 80, laser: "red" },
  score: { power: 8, speed: 300, passes: 1 },
};

describe("SpiralTestControls", () => {
  it("shows resolved axis values and footprint", () => {
    render(<SpiralTestControls cfg={CFG} onChange={() => {}} footprint={{ w: 120, h: 120 }} overBed={false} />);
    expect(screen.getByText(/0\.60, 0\.73, 0\.87, 1\.00/)).toBeInTheDocument();
    expect(screen.getByText(/120 × 120 mm/)).toBeInTheDocument();
  });
  it("emits a changed diameter", () => {
    const onChange = vi.fn();
    render(<SpiralTestControls cfg={CFG} onChange={onChange} footprint={{ w: 1, h: 1 }} overBed={false} />);
    fireEvent.change(screen.getByLabelText("diameter"), { target: { value: "12" } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ diameterMm: 12 }));
  });
});
```

- [ ] **Step 8: Typecheck, test, build**

Run: `cd web && npx tsc --noEmit && npm test -- --run`
Expected: tsc clean; all suites pass (incl. the new spiral-test ones).
Run: `cd web && npm run build > /dev/null 2>&1 && echo BUILD_OK`
Expected: `BUILD_OK`.

- [ ] **Step 9: Commit**

```bash
git add web/src/components/spiraltest/ web/src/pages/SpiralTestPage.tsx \
        web/src/router.ts web/src/App.tsx web/src/components/TopBar.tsx
git commit -m "feat(spiral-test): page, controls, SVG preview + nav registration"
```

---

## Task 6: Changelog + full verification (browser golden path)

**Files:**
- Create: `changelog/2026-06-18-spiral-test.md`

- [ ] **Step 1: Write the changelog entry** — create `changelog/2026-06-18-spiral-test.md`:

```markdown
---
id: 2026-06-18-spiral-test
date: 2026-06-18
level: major
title: Spiral Test — 2D parameter-sweep cut grid
summary: A new support page that lays out a grid of spiral-cut test circles sweeping channel width (X) against pitch (Y), with a fixed circle size and your usual cut/focus params, an engraved label on every cell, and a one-click .xs export. Dial in spiral-cut settings in a single burn instead of generating or hand-editing files one at a time.
---

The Spiral Test page builds a channel-width × pitch grid of identical test
circles, each cut with that cell's geometry and labelled with its values, then
exports the whole sheet as a single `.xs`. Set the two axes (min / max / steps),
the circle diameter, and the cut + focus parameters; the live preview shows the
grid and its footprint against the bed.
```

- [ ] **Step 2: Run the full suites**

Run: `cd web && npx tsc --noEmit && npm test -- --run`
Expected: tsc clean; all suites pass.

- [ ] **Step 3: Browser golden path**

Start the dev server (`uv run --active xcs-gen serve --host 127.0.0.1 --port 8017` — restart it so it serves the freshly built `web/dist`), open `http://127.0.0.1:8017/#/spiral-test`, and verify:
- The page renders three columns; the preview shows a 4×4 grid of circles with spiral channels and a `0.80/0.040`-style label under each.
- Editing CW/pitch min/max/steps and diameter updates the grid live; the resolved-values readout and footprint update; shrinking the bed flips the footprint readout to "exceeds bed".
- Click **Export .xs** → `spiral-test.xs` downloads.
- Confirm the file is valid: either re-open it on the Spiral page, or in a node/vitest scratch assert `isXsBuffer(buf)` and that `xsToLegacyRaw` yields the expected cut + label displays.
Screenshot the preview and review it critically before reporting complete.

- [ ] **Step 4: Commit**

```bash
git add changelog/2026-06-18-spiral-test.md
git commit -m "docs(spiral-test): changelog for the 2D spiral-test page"
```

---

## Execution notes

- After all tasks: push `feat/spiral-test`, open a draft PR, flip to ready when CI is green (per CLAUDE.md). Independent of the open relief PR #158.
- No backend/DB/alembic changes — the CI migration-revision gotcha does not apply.
- Deviation from the spec worth noting in the PR: labels are emitted as a low-power single-pass `VECTOR_CUTTING` operation (the spec's documented fallback) rather than a distinct vector-engrave processing type — chosen because it reuses `buildGeneratedXcs` wholesale and keeps the job a single laser pipeline. If a true engrave layer is wanted later, it's a follow-up that swaps the `SCORE_LABEL` group's device entry to `VECTOR_ENGRAVING`.
- Export base: rather than bundling a real blank `.xs` (spec's snapshot idea), the plan builds a minimal in-code INTAGLIO template and runs it through `buildGeneratedXcs`, so every emitted display is Studio-shaped by the proven writer (no hand-authored `graphicX/graphicY` etc.). Same end result, lower risk.
- **Deliberate v1 scope reductions** (extend later, same patterns): (1) the **thickness-preset dropdown** that seeds `cfg.cut` from `presets.ts` is deferred — `DEFAULT_CFG` encodes sensible brass defaults the user edits directly; (2) the right-panel exposes the high-traffic cut fields (passes / power / speed / focus step) only — the remaining cut fields (focus initial/interval, frequency, pulse width, laser) and the `score` power/speed/passes take their `DEFAULT_CFG` values for v1 and are added as more `Field`s in the same Task-5 pattern when wanted. Neither affects the generated `.xs` (all params flow through `cfg`).
```
