# Spiral Test — selectable X/Y axis parameters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the Spiral Test page sweep any two distinct parameters on its X/Y axes (channel width, pitch, speed, passes, power, frequency, pulse width, focus per-step, focus interval) instead of the fixed channel-width × pitch, with per-cell cut profiles in the `.xs`.

**Architecture:** A pure parameter registry (`spiralParams.ts`) is the single source of truth for each sweepable param's label/unit/precision/clamp/kind and its default fixed value + axis range. `buildSpiralTest` resolves each cell's full param map (`fixed` overridden by the cell's X/Y values), generates geometry from the geometry params, builds a `StageParams` cut profile from the profile params, and **dedupes** profiles into `CUT_<n>` groups — returning a `stageParams` map the export forwards verbatim to the existing `buildGeneratedXcs`. The UI splits into an AXES section (left) and a FIXED-PARAMS section (right).

**Tech Stack:** React + TypeScript + Vite (Workshop-Instrument design system); vitest.

**Spec:** `docs/superpowers/specs/2026-06-18-spiral-test-selectable-axes-design.md`. Builds on the merged Spiral Test page (PR #159).

**Key facts (do not re-derive):**
- `web/src/lib/forge/spiral.ts`: `spiralFromRegion(region: Pt[][], opts: { channelWidthMm, pitchMm, side: "outside"|"inside", minChannelMm }): { arms: Pt[][]; warnings: string[]; ... }`. Geometry depends ONLY on channelWidth/pitch/diameter/side/minChannel.
- `web/src/lib/forge/types.ts` `StageParams` (all optional): `power, speed, passes, pulseWidth, frequency, density, laser, cuttingDrop, sinkingMethod, descentIntervalDescent, descentPerStep, firstCuttingDropValue, cuttingDropValue` (+ z* fields unused here). `GeneratedPath`: `{ sourceObjectId, generatedClass, groupName, layerStart, layerEnd, widthMultiplier, offsetMm, sideMode, operationOrder, enabled, rings }`.
- `web/src/lib/forge/xcs.ts`: `buildGeneratedXcs(parsed, inciseId, paths, mmPerUnit, stageParams: Record<groupName, StageParams>, scanAngle?, userOrder, maxPathPoints, joinStrands)` groups `paths` by `groupName`, applies that group's `StageParams`, and names displays/layers by group. `parseXcsFile`, `ringsToDPath(rings, mmPerUnit)`, `MAX_PATH_POINTS`.
- `web/src/lib/forge/xs.ts`: `legacyRawToXs(doc, null, false)` synthesises a complete `.xs`; profiles dedup on `(processingType, values)`. `xsToLegacyRaw(buf) → { raw }`, `isXsBuffer(buf)`.
- `web/src/lib/forge/textPaths.ts`: `renderText(text, sizeMm, origin): Pt[][]`, `textWidth(text, sizeMm): number`.
- The other "Spiral" files (`SpiralPage`, `SpiralControls`, `SpiralCanvas`, `spiral.ts`, `presets.ts`) are a DIFFERENT feature — do not touch them. `channelWidthMm` there is the `spiralFromRegion` option, unrelated to `SpiralTestConfig`.
- `SpiralTestPreview.tsx` consumes `result.cutPaths` / `result.labelOutlines` / `result.footprintMm` / `result.overBed` only — those field names are UNCHANGED, so the preview needs no edit.

**Conventions:** Frontend gate before a commit: `cd web && npx tsc --noEmit && npm test -- --run`. After `web/src/**` changes rebuild for the browser: `cd web && npm run build`. Never `git commit --no-verify`.

**File structure:**
```
web/src/lib/forge/spiralParams.ts            NEW  registry: ParamKey/ParamDef/PARAMS/PARAM_ORDER, AxisSpec, formatValue, clamps
web/src/lib/forge/spiralParams.test.ts       NEW
web/src/lib/forge/spiralTest.ts              MOD  config reshape, per-cell paramMap, profile dedup, stageParams, composeTitle
web/src/lib/forge/spiralTest.test.ts         MOD
web/src/lib/forge/spiralTestXs.ts            MOD  forward result.stageParams to buildGeneratedXcs (drop cfg.cut)
web/src/lib/forge/spiralTestXs.test.ts       MOD
web/src/components/spiraltest/SpiralTestControls.tsx   MOD  AXES section (X/Y param selects + ranges)
web/src/components/spiraltest/controls.test.tsx        MOD
web/src/components/spiraltest/FixedParams.tsx          NEW  fixed-param grid (on-axis inputs disabled) + initial drop + depth readout
web/src/components/spiraltest/FixedParams.test.tsx     NEW
web/src/pages/SpiralTestPage.tsx             MOD  DEFAULT_CFG, compose AXES + FixedParams, setters
changelog/2026-06-18-spiral-test-axes.md     NEW  minor entry
```

---

## Task 1: Parameter registry (`spiralParams.ts`)

Pure, self-contained. One entry per sweepable param: label/abbrev/unit/precision/kind/clamp + default fixed value + default axis range.

**Files:**
- Create: `web/src/lib/forge/spiralParams.ts`, `web/src/lib/forge/spiralParams.test.ts`

- [ ] **Step 1: Write the failing test** — create `web/src/lib/forge/spiralParams.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { PARAMS, PARAM_ORDER, formatValue, type ParamKey } from "./spiralParams";

describe("spiralParams registry", () => {
  it("has 9 params in a stable order, each fully described", () => {
    expect(PARAM_ORDER).toEqual([
      "channelWidth", "pitch", "speed", "passes", "power",
      "frequency", "pulseWidth", "focusStep", "focusInterval",
    ]);
    for (const k of PARAM_ORDER) {
      const d = PARAMS[k];
      expect(d.key).toBe(k);
      expect(d.label.length).toBeGreaterThan(0);
      expect(d.abbrev.length).toBeGreaterThan(0);
      expect(["geometry", "profile"]).toContain(d.kind);
      expect(Number.isFinite(d.defaultFixed)).toBe(true);
      expect(d.defaultAxis.steps).toBeGreaterThanOrEqual(1);
    }
  });
  it("classifies channel width + pitch as geometry, the rest as profile", () => {
    const geom = PARAM_ORDER.filter((k) => PARAMS[k].kind === "geometry");
    expect(geom).toEqual(["channelWidth", "pitch"]);
  });
  it("formats values at each param's precision", () => {
    expect(formatValue("channelWidth", 0.6)).toBe("0.60");
    expect(formatValue("pitch", 0.03)).toBe("0.030");
    expect(formatValue("speed", 1533.33)).toBe("1533");
    expect(formatValue("focusStep", 0.06)).toBe("0.06");
    expect(formatValue("passes", 250)).toBe("250");
  });
  it("clamps to each param's domain", () => {
    expect(PARAMS.passes.clamp(2.6)).toBe(3);          // round, >= 1
    expect(PARAMS.passes.clamp(0.2)).toBe(1);
    expect(PARAMS.focusInterval.clamp(0)).toBe(1);     // >= 1
    expect(PARAMS.power.clamp(150)).toBe(100);         // 0..100
    expect(PARAMS.power.clamp(-5)).toBe(0);
    expect(PARAMS.pulseWidth.clamp(-3)).toBe(0);       // >= 0
    expect(PARAMS.pitch.clamp(-1)).toBeGreaterThan(0); // > 0
    expect(PARAMS.focusStep.clamp(0)).toBe(0);         // >= 0
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd web && npx vitest run src/lib/forge/spiralParams.test.ts`
Expected: FAIL — cannot find module `./spiralParams`.

- [ ] **Step 3: Implement `spiralParams.ts`** — create `web/src/lib/forge/spiralParams.ts`:

```ts
// web/src/lib/forge/spiralParams.ts
// Registry of the Spiral Test page's sweepable parameters. Single source of
// truth for each param's label/unit/precision, whether it shapes the spiral
// geometry or only the cut profile, how it clamps, and its default fixed value
// + default axis range. Pure data + helpers; no React, no geometry.

export type ParamKey =
  | "channelWidth" | "pitch" | "speed" | "passes" | "power"
  | "frequency" | "pulseWidth" | "focusStep" | "focusInterval";

/** A linearly-spaced sweep: `steps` values over [min, max]. */
export interface AxisSpec { min: number; max: number; steps: number; }

export interface ParamDef {
  key: ParamKey;
  label: string;       // full name, e.g. "Channel width"
  abbrev: string;      // title abbreviation, e.g. "CW"
  unit: string;        // "mm" | "mm/s" | "kHz" | "ns" | "%" | "×" | "passes"
  dp: number;          // decimal places for axis labels + title
  kind: "geometry" | "profile";
  clamp: (v: number) => number;
  defaultFixed: number;   // value used when the param is OFF-axis
  defaultAxis: AxisSpec;  // range applied when the param is moved ONTO an axis
}

const intMin1 = (v: number) => Math.max(1, Math.round(v));
const nonNeg = (v: number) => Math.max(0, v);
const positive = (v: number) => Math.max(1e-4, v);
const pct = (v: number) => Math.max(0, Math.min(100, Math.round(v)));

export const PARAMS: Record<ParamKey, ParamDef> = {
  channelWidth:  { key: "channelWidth",  label: "Channel width", abbrev: "CW", unit: "mm",     dp: 2, kind: "geometry", clamp: positive, defaultFixed: 0.8,  defaultAxis: { min: 0.6,  max: 1.0,  steps: 4 } },
  pitch:         { key: "pitch",         label: "Pitch",         abbrev: "PT", unit: "mm",     dp: 3, kind: "geometry", clamp: positive, defaultFixed: 0.04, defaultAxis: { min: 0.03, max: 0.05, steps: 4 } },
  speed:         { key: "speed",         label: "Speed",         abbrev: "S",  unit: "mm/s",   dp: 0, kind: "profile",  clamp: intMin1,  defaultFixed: 1500, defaultAxis: { min: 1000, max: 2000, steps: 4 } },
  passes:        { key: "passes",        label: "Passes",        abbrev: "PA", unit: "×",      dp: 0, kind: "profile",  clamp: intMin1,  defaultFixed: 250,  defaultAxis: { min: 150,  max: 300,  steps: 4 } },
  power:         { key: "power",         label: "Power",         abbrev: "P",  unit: "%",      dp: 0, kind: "profile",  clamp: pct,      defaultFixed: 100,  defaultAxis: { min: 60,   max: 100,  steps: 4 } },
  frequency:     { key: "frequency",     label: "Frequency",     abbrev: "F",  unit: "kHz",    dp: 0, kind: "profile",  clamp: intMin1,  defaultFixed: 65,   defaultAxis: { min: 30,   max: 80,   steps: 4 } },
  pulseWidth:    { key: "pulseWidth",    label: "Pulse width",   abbrev: "PW", unit: "ns",     dp: 0, kind: "profile",  clamp: nonNeg,   defaultFixed: 80,   defaultAxis: { min: 50,   max: 500,  steps: 4 } },
  focusStep:     { key: "focusStep",     label: "Focus / step",  abbrev: "FS", unit: "mm",     dp: 2, kind: "profile",  clamp: nonNeg,   defaultFixed: 0.06, defaultAxis: { min: 0.04, max: 0.10, steps: 4 } },
  focusInterval: { key: "focusInterval", label: "Focus interval", abbrev: "FI", unit: "passes", dp: 0, kind: "profile", clamp: intMin1,  defaultFixed: 20,   defaultAxis: { min: 10,   max: 30,   steps: 4 } },
};

/** Stable order for selects, the fixed-param grid, and the title summary. */
export const PARAM_ORDER: ParamKey[] = [
  "channelWidth", "pitch", "speed", "passes", "power",
  "frequency", "pulseWidth", "focusStep", "focusInterval",
];

export const PROFILE_KEYS: ParamKey[] = PARAM_ORDER.filter((k) => PARAMS[k].kind === "profile");

/** Format a value at its param's display precision. */
export function formatValue(key: ParamKey, v: number): string {
  return v.toFixed(PARAMS[key].dp);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd web && npx vitest run src/lib/forge/spiralParams.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Typecheck + commit**

Run: `cd web && npx tsc --noEmit` → clean.
```bash
git add web/src/lib/forge/spiralParams.ts web/src/lib/forge/spiralParams.test.ts
git commit -m "feat(spiral-test): parameter registry for selectable axes"
```

---

## Task 2: Config reshape + `buildSpiralTest` + export

Reshape `SpiralTestConfig`, rewrite `buildSpiralTest` (per-cell param map, profile dedup, returned `stageParams`) and `composeTitle`, and point the export at `result.stageParams`. These land together — the config change is cross-cutting and `spiralTestXs.ts` references the removed `cfg.cut`, so the unit must stay tsc-green.

**Files:** Modify `spiralTest.ts`, `spiralTest.test.ts`, `spiralTestXs.ts`, `spiralTestXs.test.ts`.

- [ ] **Step 1: Rewrite `web/src/lib/forge/spiralTest.ts`** — replace the whole file with:

```ts
// web/src/lib/forge/spiralTest.ts
// 2D spiral-test grid with selectable X/Y axis parameters. Each cell's spiral is
// generated and cut with that cell's (x-param, y-param) values; every other
// sweepable param stays fixed. Geometry params (channel width, pitch) shape the
// spiral; profile params (speed/passes/power/frequency/pulse width/focus step/
// focus interval) only change the VECTOR_CUTTING settings. Profiles are deduped
// into CUT_<n> groups so a geometry-only sweep stays one profile. Pure geometry.
import type { GeneratedPath, Pt, StageParams } from "./types";
import { spiralFromRegion } from "./spiral";
import { renderText, textWidth } from "./textPaths";
import { PARAMS, PARAM_ORDER, PROFILE_KEYS, formatValue, type AxisSpec, type ParamKey } from "./spiralParams";

export type { AxisSpec, ParamKey } from "./spiralParams";

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
  xParam: ParamKey;
  yParam: ParamKey;                  // must differ from xParam
  xAxis: AxisSpec;
  yAxis: AxisSpec;
  fixed: Record<ParamKey, number>;   // value used when a param is OFF-axis
  diameterMm: number;
  side: "outside" | "inside";
  minChannelMm: number;
  gapMm: number;
  bedMm: { w: number; h: number };
  focusInitialMm: number;            // fixed initial focus drop (not sweepable)
  laser: "red" | "blue" | "uv";      // cut laser (fixed)
  labels: { show: boolean; titlePrefix: string };
  /** Label engrave op (a FILL_VECTOR_ENGRAVING pass over the real-font glyphs). */
  score: {
    laser: "red" | "blue" | "uv"; power: number; speed: number; passes: number;
    linesPerCm: number; scanMode: "bidirectional" | "unidirectional";
    pulseWidth: number; frequency: number;
  };
}

export interface CellInfo {
  row: number; col: number;
  xValue: number; yValue: number;
  centerMm: { x: number; y: number };
  cut: Pt[][];        // the cell's arms (open polylines), positioned in mm
  groupName: string;  // the CUT_<n> profile group this cell belongs to
  warnings: string[];
}

/** One engraved string (title or an axis value) as filled outline rings. */
export interface LabelOutline { text: string; rings: Pt[][]; }

export interface SpiralTestResult {
  cells: CellInfo[];
  cutPaths: GeneratedPath[];                  // one per arm, groupName = CUT_<n>
  stageParams: Record<string, StageParams>;   // keyed by groupName
  labelOutlines: LabelOutline[];
  footprintMm: { w: number; h: number };
  overBed: boolean;
  warnings: string[];
}

const MARGIN_MM = 5;     // outer page margin
const PAD_MM = 1.2;      // padding between grid and axis labels / title

/** The auto title: optional prefix + the two axis param names + a fixed-param
 *  summary (only the params NOT on an axis; always D + initial drop). */
export function composeTitle(cfg: SpiralTestConfig): string {
  const axisPart = `X:${PARAMS[cfg.xParam].label}  Y:${PARAMS[cfg.yParam].label}`;
  const offAxis = PARAM_ORDER.filter((k) => k !== cfg.xParam && k !== cfg.yParam);
  const fixedPart = [
    `D:${cfg.diameterMm}`, `ID:${cfg.focusInitialMm}`,
    ...offAxis.map((k) => `${PARAMS[k].abbrev}:${formatValue(k, cfg.fixed[k])}`),
  ].join(" ");
  const body = `${axisPart}   ${fixedPart}`;
  const pre = cfg.labels.titlePrefix.trim();
  return pre ? `${pre}  ${body}` : body;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** Bbox of a set of rings; null if empty. */
export function ringsBBox(rings: Pt[][]): { minX: number; minY: number; w: number; h: number } | null {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const r of rings) for (const p of r) {
    if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x;
    if (p.y < y0) y0 = p.y; if (p.y > y1) y1 = p.y;
  }
  if (!Number.isFinite(x0)) return null;
  return { minX: x0, minY: y0, w: x1 - x0, h: y1 - y0 };
}

/** Stable dedup key over the profile-param subset of a resolved cell map. */
function profileKeyOf(map: Record<ParamKey, number>): string {
  return PROFILE_KEYS.map((k) => `${k}:${map[k]}`).join("|");
}

/** Build a VECTOR_CUTTING StageParams from a cell's resolved param map. */
function stageParamsOf(map: Record<ParamKey, number>, cfg: SpiralTestConfig): StageParams {
  return {
    power: map.power, speed: map.speed, passes: map.passes,
    pulseWidth: map.pulseWidth, frequency: map.frequency, laser: cfg.laser,
    cuttingDrop: true, sinkingMethod: "step",
    firstCuttingDropValue: cfg.focusInitialMm, cuttingDropValue: cfg.focusInitialMm,
    descentIntervalDescent: map.focusInterval, descentPerStep: map.focusStep,
  };
}

export function buildSpiralTest(cfg: SpiralTestConfig): SpiralTestResult {
  const xVals = resolveAxis(cfg.xAxis).map((v) => PARAMS[cfg.xParam].clamp(v));
  const yVals = resolveAxis(cfg.yAxis).map((v) => PARAMS[cfg.yParam].clamp(v));
  const show = cfg.labels.show;

  // Channel-width values present anywhere in the grid → max for a uniform cell.
  const channelValues =
    cfg.xParam === "channelWidth" ? xVals
    : cfg.yParam === "channelWidth" ? yVals
    : [cfg.fixed.channelWidth];
  const maxCw = Math.max(...channelValues);

  const cell = cfg.diameterMm + 2 * maxCw + cfg.gapMm;

  const axisTextMm = show ? clamp(cell * 0.22, 1.2, 4) : 0;
  const gridW = xVals.length * cell;
  const gridH = yVals.length * cell;
  const title = composeTitle(cfg);
  const titleTextMm = show ? Math.min(axisTextMm * 1.4, gridW / Math.max(1, textWidth(title, 1))) : 0;

  // Measure the title's true vertical extent so the top band reserves real glyph
  // height (ascent + descent), not just the em.
  const titleProbe = show ? renderText(title, titleTextMm, { x: 0, y: 0 }) : [];
  const titleProbeBox = ringsBBox(titleProbe);
  const titleH = titleProbeBox ? titleProbeBox.h : 0;

  // Left margin holds the Y values (at the Y param's precision); top band the title.
  const yLabelW = show ? Math.max(...yVals.map((v) => textWidth(formatValue(cfg.yParam, v), axisTextMm))) : 0;
  const leftMargin = show ? yLabelW + PAD_MM : 0;
  const topBand = show ? titleH + PAD_MM * 2 : 0;
  const bottomMargin = show ? axisTextMm + PAD_MM * 2 : 0;

  const gridX0 = MARGIN_MM + leftMargin;
  const gridY0 = MARGIN_MM + topBand;

  const cells: CellInfo[] = [];
  const cutPaths: GeneratedPath[] = [];
  const labelOutlines: LabelOutline[] = [];
  const warnSet = new Set<string>();
  const stageParams: Record<string, StageParams> = {};
  const groupByKey = new Map<string, string>(); // profileKey → groupName
  let order = 0;

  for (let row = 0; row < yVals.length; row++) {
    for (let col = 0; col < xVals.length; col++) {
      const paramMap = { ...cfg.fixed, [cfg.xParam]: xVals[col], [cfg.yParam]: yVals[row] } as Record<ParamKey, number>;
      const cx = gridX0 + cell / 2 + col * cell;
      const cy = gridY0 + cell / 2 + row * cell;

      const region = circleRegion(cx, cy, cfg.diameterMm);
      const res = spiralFromRegion(region, {
        channelWidthMm: paramMap.channelWidth, pitchMm: paramMap.pitch,
        side: cfg.side, minChannelMm: cfg.minChannelMm,
      });
      res.warnings.forEach((w) => warnSet.add(w));

      // Resolve (dedup) this cell's cut profile to a CUT_<n> group.
      const pk = profileKeyOf(paramMap);
      let groupName = groupByKey.get(pk);
      if (groupName === undefined) {
        groupName = `CUT_${groupByKey.size}`;
        groupByKey.set(pk, groupName);
        stageParams[groupName] = stageParamsOf(paramMap, cfg);
      }

      for (const arm of res.arms) {
        cutPaths.push({
          sourceObjectId: "spiral-test", generatedClass: "spiral", groupName,
          layerStart: 0, layerEnd: paramMap.passes, widthMultiplier: 1, offsetMm: 0,
          sideMode: cfg.side, operationOrder: order++, enabled: true, rings: [arm],
        });
      }
      cells.push({ row, col, xValue: xVals[col], yValue: yVals[row], centerMm: { x: cx, y: cy }, cut: res.arms, groupName, warnings: res.warnings });
    }
  }

  if (show) {
    // Title — centred over the grid; baseline from the measured ascent.
    const titleBaselineY = MARGIN_MM + (titleProbeBox ? -titleProbeBox.minY : titleTextMm);
    const titleW = textWidth(title, titleTextMm);
    const titleX = gridX0 + Math.max(0, (gridW - titleW) / 2);
    labelOutlines.push({ text: title, rings: renderText(title, titleTextMm, { x: titleX, y: titleBaselineY }) });

    // X axis — value centred under each column, at the X param's precision.
    const xBaselineY = gridY0 + gridH + PAD_MM + axisTextMm;
    for (let col = 0; col < xVals.length; col++) {
      const t = formatValue(cfg.xParam, xVals[col]);
      const w = textWidth(t, axisTextMm);
      const colCx = gridX0 + cell / 2 + col * cell;
      labelOutlines.push({ text: t, rings: renderText(t, axisTextMm, { x: colCx - w / 2, y: xBaselineY }) });
    }

    // Y axis — value right-aligned in the left margin, centred on the row.
    for (let row = 0; row < yVals.length; row++) {
      const t = formatValue(cfg.yParam, yVals[row]);
      const w = textWidth(t, axisTextMm);
      const rowCy = gridY0 + cell / 2 + row * cell;
      labelOutlines.push({ text: t, rings: renderText(t, axisTextMm, { x: gridX0 - PAD_MM - w, y: rowCy + axisTextMm * 0.35 }) });
    }
  }

  const allLabelRings = labelOutlines.flatMap((l) => l.rings);
  const labelBox = ringsBBox(allLabelRings);
  const cutBox = ringsBBox(cutPaths.flatMap((p) => p.rings));
  const right = Math.max(gridX0 + gridW, labelBox ? labelBox.minX + labelBox.w : 0, cutBox ? cutBox.minX + cutBox.w : 0);
  const bottom = Math.max(gridY0 + gridH + bottomMargin, labelBox ? labelBox.minY + labelBox.h : 0);
  const footprintMm = { w: right + MARGIN_MM, h: bottom + MARGIN_MM };

  return {
    cells, cutPaths, stageParams, labelOutlines, footprintMm,
    overBed: footprintMm.w > cfg.bedMm.w || footprintMm.h > cfg.bedMm.h,
    warnings: [...warnSet],
  };
}
```

- [ ] **Step 2: Rewrite `web/src/lib/forge/spiralTest.test.ts`** — replace the whole file with:

```ts
import { describe, it, expect } from "vitest";
import { resolveAxis, circleRegion, composeTitle, buildSpiralTest, type SpiralTestConfig } from "./spiralTest";
import { PARAMS, PARAM_ORDER, type ParamKey } from "./spiralParams";

function baseCfg(over: Partial<SpiralTestConfig> = {}): SpiralTestConfig {
  const fixed = Object.fromEntries(PARAM_ORDER.map((k) => [k, PARAMS[k].defaultFixed])) as Record<ParamKey, number>;
  return {
    xParam: "channelWidth", yParam: "pitch",
    xAxis: { min: 0.6, max: 1.0, steps: 3 }, yAxis: { min: 0.03, max: 0.05, steps: 2 },
    fixed, diameterMm: 10, side: "outside", minChannelMm: 0.4, gapMm: 4, bedMm: { w: 300, h: 300 },
    focusInitialMm: 0.01, laser: "red",
    labels: { show: true, titlePrefix: "" },
    score: { laser: "red", power: 65, speed: 1944, passes: 1, linesPerCm: 300, scanMode: "bidirectional", pulseWidth: 500, frequency: 65 },
    ...over,
  };
}

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
  it("names both axes and lists only off-axis params (+ D, ID)", () => {
    const t = composeTitle(baseCfg());
    expect(t).toContain("X:Channel width");
    expect(t).toContain("Y:Pitch");
    expect(t).toContain("D:10");
    expect(t).toContain("ID:0.01");
    expect(t).toContain("S:1500");   // off-axis speed shown
    expect(t).not.toContain("CW:");  // channel width is on X — not in the fixed list
    expect(t).not.toContain("PT:");  // pitch is on Y
  });
  it("prepends a non-empty prefix", () => {
    expect(composeTitle(baseCfg({ labels: { show: true, titlePrefix: "BRASS" } }))).toMatch(/^BRASS {2}X:Channel width/);
  });
});

describe("buildSpiralTest", () => {
  it("produces one cell per (col,row) with the swept X/Y values", () => {
    const r = buildSpiralTest(baseCfg()); // 3 cols × 2 rows
    expect(r.cells.length).toBe(6);
    expect(r.cells.find((c) => c.col === 0 && c.row === 0)!.xValue).toBeCloseTo(0.6, 5);
    expect(r.cells.find((c) => c.col === 2 && c.row === 1)!.yValue).toBeCloseTo(0.05, 5);
  });
  it("emits spiral cut paths (one arm per path) tagged with a known group", () => {
    const r = buildSpiralTest(baseCfg());
    expect(r.cutPaths.length).toBeGreaterThanOrEqual(6);
    expect(r.cutPaths.every((p) => p.generatedClass === "spiral" && p.rings.length === 1)).toBe(true);
    expect(r.cutPaths.every((p) => p.groupName in r.stageParams)).toBe(true);
  });
  it("dedupes profiles: a geometry-only sweep is ONE cut profile", () => {
    const r = buildSpiralTest(baseCfg()); // channel × pitch — both geometry
    expect(Object.keys(r.stageParams).length).toBe(1);
  });
  it("a profile×profile sweep fans out to N×M profiles", () => {
    const r = buildSpiralTest(baseCfg({
      xParam: "speed", yParam: "passes",
      xAxis: { min: 1000, max: 2000, steps: 2 }, yAxis: { min: 150, max: 300, steps: 2 },
    }));
    expect(Object.keys(r.stageParams).length).toBe(4);
    const speeds = Object.values(r.stageParams).map((s) => s.speed).sort((a, b) => a! - b!);
    expect(speeds).toEqual([1000, 1000, 2000, 2000]);
  });
  it("a mixed sweep (geometry × profile) makes one profile per profile-value", () => {
    const r = buildSpiralTest(baseCfg({
      xParam: "channelWidth", yParam: "speed",
      xAxis: { min: 0.6, max: 1.0, steps: 3 }, yAxis: { min: 1000, max: 2000, steps: 2 },
    }));
    expect(Object.keys(r.stageParams).length).toBe(2); // one per speed
  });
  it("emits axis labels: 1 title + cols X-values + rows Y-values, at param precision", () => {
    const r = buildSpiralTest(baseCfg({
      xParam: "speed", xAxis: { min: 1000, max: 2000, steps: 3 },
    }));
    expect(r.labelOutlines.length).toBe(1 + 3 + 2);
    expect(r.labelOutlines.some((l) => l.text === "1000")).toBe(true); // speed 0dp
    expect(r.labelOutlines.some((l) => l.text === "0.030")).toBe(true); // pitch 3dp
  });
  it("omits labels when labels.show is false", () => {
    expect(buildSpiralTest(baseCfg({ labels: { show: false, titlePrefix: "" } })).labelOutlines.length).toBe(0);
  });
  it("focus-interval/step sweeps land in the cut profile", () => {
    const r = buildSpiralTest(baseCfg({
      xParam: "focusStep", yParam: "focusInterval",
      xAxis: { min: 0.04, max: 0.08, steps: 2 }, yAxis: { min: 10, max: 20, steps: 2 },
    }));
    const steps = new Set(Object.values(r.stageParams).map((s) => s.descentPerStep));
    expect(steps.has(0.04)).toBe(true);
    expect(steps.has(0.08)).toBe(true);
    const intervals = new Set(Object.values(r.stageParams).map((s) => s.descentIntervalDescent));
    expect(intervals.has(10)).toBe(true);
    expect(intervals.has(20)).toBe(true);
  });
  it("footprint exceeds a tiny bed", () => {
    expect(buildSpiralTest(baseCfg({ bedMm: { w: 5, h: 5 } })).overBed).toBe(true);
  });
});
```

- [ ] **Step 3: Run the lib test**

Run: `cd web && npx vitest run src/lib/forge/spiralTest.test.ts`
Expected: PASS.

- [ ] **Step 4: Update `web/src/lib/forge/spiralTestXs.ts`** — forward `result.stageParams`; drop the `cfg.cut`-based block and the now-unused `StageParams` import.

(a) Change the import line (remove `StageParams`):
```ts
import type { SpiralTestConfig, SpiralTestResult } from "./spiralTest";
```
(the line `import type { StageParams } from "./types";` is DELETED.)

(b) Replace the body of `buildSpiralTestXs` from its start through the `buildGeneratedXcs(...)` call with:
```ts
export function buildSpiralTestXs(result: SpiralTestResult, cfg: SpiralTestConfig): ArrayBuffer {
  const parsed = parseXcsFile(TEMPLATE_BYTES);
  const inciseId = parsed.targets[0].id;

  // Spiral cut via the proven writer (cut paths only — labels are filled, so
  // they cannot ride the spiral-only / open-path code path). Per-cell cut
  // profiles arrive pre-grouped as result.stageParams (keyed by groupName).
  const doc = buildGeneratedXcs(
    parsed, inciseId, result.cutPaths, 1 /* mmPerUnit */, result.stageParams,
    undefined /* scanAngle */, false /* userOrder */, MAX_PATH_POINTS, false /* joinStrands */,
  ) as {
    canvas: Array<{ displays: Array<Record<string, unknown>>; layerData: Record<string, unknown> }>;
    device: { data: { value: Array<[string, { displays: { value: Array<[string, unknown]> } }]> } };
  };
```
Everything after this (the label-append loop + `return legacyRawToXs(...)`) stays unchanged. The `cfg` param is still used by `fillEngraveEntry(cfg.score)` in the label loop.

- [ ] **Step 5: Rewrite `web/src/lib/forge/spiralTestXs.test.ts`** — replace the whole file with:

```ts
import { describe, it, expect } from "vitest";
import { buildSpiralTest, type SpiralTestConfig } from "./spiralTest";
import { buildSpiralTestXs } from "./spiralTestXs";
import { isXsBuffer, xsToLegacyRaw } from "./xs";
import { PARAMS, PARAM_ORDER, type ParamKey } from "./spiralParams";

function baseCfg(over: Partial<SpiralTestConfig> = {}): SpiralTestConfig {
  const fixed = Object.fromEntries(PARAM_ORDER.map((k) => [k, PARAMS[k].defaultFixed])) as Record<ParamKey, number>;
  return {
    xParam: "channelWidth", yParam: "pitch",
    xAxis: { min: 0.6, max: 1.0, steps: 2 }, yAxis: { min: 0.03, max: 0.05, steps: 2 },
    fixed, diameterMm: 10, side: "outside", minChannelMm: 0.4, gapMm: 4, bedMm: { w: 300, h: 300 },
    focusInitialMm: 0.01, laser: "red",
    labels: { show: true, titlePrefix: "" },
    score: { laser: "red", power: 65, speed: 1944, passes: 1, linesPerCm: 300, scanMode: "bidirectional", pulseWidth: 500, frequency: 65 },
    ...over,
  };
}

type Raw = {
  device: { data: { value: Array<[string, { displays: { value: Array<[string, {
    processingType?: string;
    data?: Record<string, { parameter?: { customize?: Record<string, unknown> } }>;
  }]> } }]> } };
};

function cutCustomizes(raw: unknown): Record<string, unknown>[] {
  const entries = (raw as Raw).device.data.value[0][1].displays.value;
  return entries
    .filter(([, e]) => e.processingType === "VECTOR_CUTTING")
    .map(([, e]) => e.data!.VECTOR_CUTTING!.parameter!.customize as Record<string, unknown>);
}
function types(raw: unknown): string[] {
  return (raw as Raw).device.data.value[0][1].displays.value.map(([, e]) => e.processingType ?? "");
}

describe("buildSpiralTestXs", () => {
  it("round-trips a geometry sweep to a single VECTOR_CUTTING profile + the FILL_VECTOR_ENGRAVING labels", () => {
    const buf = buildSpiralTestXs(buildSpiralTest(baseCfg()), baseCfg());
    expect(isXsBuffer(buf)).toBe(true);
    const { raw } = xsToLegacyRaw(buf);
    expect(types(raw)).toContain("VECTOR_CUTTING");
    expect(types(raw)).toContain("FILL_VECTOR_ENGRAVING");
    // geometry-only sweep → all cut entries share one speed (one profile)
    const speeds = new Set(cutCustomizes(raw).map((c) => c.speed));
    expect(speeds.size).toBe(1);
    expect([...speeds][0]).toBe(1500);
  });
  it("a speed sweep produces multiple distinct VECTOR_CUTTING speeds", () => {
    const cfg = baseCfg({ xParam: "speed", yParam: "pitch", xAxis: { min: 1000, max: 2000, steps: 2 } });
    const { raw } = xsToLegacyRaw(buildSpiralTestXs(buildSpiralTest(cfg), cfg));
    const speeds = new Set(cutCustomizes(raw).map((c) => c.speed));
    expect(speeds.has(1000)).toBe(true);
    expect(speeds.has(2000)).toBe(true);
  });
  it("a focus-step sweep varies descentPerStep on the cut profiles", () => {
    const cfg = baseCfg({ xParam: "focusStep", yParam: "pitch", xAxis: { min: 0.04, max: 0.08, steps: 2 } });
    const { raw } = xsToLegacyRaw(buildSpiralTestXs(buildSpiralTest(cfg), cfg));
    const steps = new Set(cutCustomizes(raw).map((c) => c.descentPerStep));
    expect(steps.has(0.04)).toBe(true);
    expect(steps.has(0.08)).toBe(true);
  });
  it("carries the MOPA IR fill-engrave label profile", () => {
    const { raw } = xsToLegacyRaw(buildSpiralTestXs(buildSpiralTest(baseCfg()), baseCfg()));
    const entries = (raw as Raw).device.data.value[0][1].displays.value;
    const anyFill = entries.some(([, e]) => {
      const cz = e.data?.FILL_VECTOR_ENGRAVING?.parameter?.customize as Record<string, unknown> | undefined;
      return cz?.power === 65 && cz?.speed === 1944 && cz?.density === 300 && cz?.bitmapScanMode === "zMode";
    });
    expect(anyFill).toBe(true);
  });
});
```

- [ ] **Step 6: Run both lib tests**

Run: `cd web && npx vitest run src/lib/forge/spiralTest.test.ts src/lib/forge/spiralTestXs.test.ts`
Expected: PASS. If `xsToLegacyRaw` exposes the device entries under a slightly different path than the helper assumes, log `JSON.stringify(Object.keys((raw as any).device.data.value[0][1]))` and adjust the helper's access path only (the assertions on speeds/descentPerStep/fill profile are the contract — keep them).

- [ ] **Step 7: Typecheck + commit**

Run: `cd web && npx tsc --noEmit` → clean. Confirm no stale refs: `grep -rn "cfg\.cut\|\.channelWidth\b\|\.pitch\b" web/src/lib/forge/spiralTest*.ts web/src/lib/forge/spiralTestXs*.ts` returns nothing (the geometry uses `paramMap.channelWidth`/`paramMap.pitch`, which are fine — confirm there is no `cfg.channelWidth`/`cfg.cut`).
```bash
git add web/src/lib/forge/spiralTest.ts web/src/lib/forge/spiralTest.test.ts \
        web/src/lib/forge/spiralTestXs.ts web/src/lib/forge/spiralTestXs.test.ts
git commit -m "feat(spiral-test): per-cell param map + deduped cut profiles for selectable axes"
```

---

## Task 3: UI — AXES controls, FIXED PARAMS, page wiring

Add the X/Y param selectors to the left rail, a fixed-params component (on-axis inputs disabled), and wire `DEFAULT_CFG` + setters in the page. The preview needs no change.

**Files:** Modify `SpiralTestControls.tsx`, `controls.test.tsx`, `SpiralTestPage.tsx`; Create `FixedParams.tsx`, `FixedParams.test.tsx`.

- [ ] **Step 1: Rewrite `web/src/components/spiraltest/SpiralTestControls.tsx`** — replace the whole file with:

```tsx
import type { ReactNode } from "react";
import type { SpiralTestConfig } from "../../lib/forge/spiralTest";
import { resolveAxis } from "../../lib/forge/spiralTest";
import { PARAMS, PARAM_ORDER, formatValue, type AxisSpec, type ParamKey } from "../../lib/forge/spiralParams";
import { Field, Input, Section, Select } from "../../ui";

interface Props {
  cfg: SpiralTestConfig;
  onChange: (c: SpiralTestConfig) => void;
  footprint: { w: number; h: number };
  overBed: boolean;
}

/** Parse a numeric field, keeping the prior value on empty/NaN (and NOT
 *  clobbering a valid 0, which `parseFloat(v) || fallback` would). */
function num(v: string, fallback: number): number {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
}

/** Small mono uppercase heading that labels an axis group. */
function AxisHeading({ children }: { children: ReactNode }) {
  return (
    <div className="mb-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-[color:var(--color-ink-subtle)]">
      {children}
    </div>
  );
}

export function SpiralTestControls({ cfg, onChange, footprint, overBed }: Props) {
  const set = <K extends keyof SpiralTestConfig>(k: K, v: SpiralTestConfig[K]) =>
    onChange({ ...cfg, [k]: v });

  // Switching a param onto an axis resets that axis to the param's default range.
  const setXParam = (key: ParamKey) => onChange({ ...cfg, xParam: key, xAxis: { ...PARAMS[key].defaultAxis } });
  const setYParam = (key: ParamKey) => onChange({ ...cfg, yParam: key, yAxis: { ...PARAMS[key].defaultAxis } });

  const xs = resolveAxis(cfg.xAxis).map((v) => formatValue(cfg.xParam, PARAMS[cfg.xParam].clamp(v))).join(", ");
  const ys = resolveAxis(cfg.yAxis).map((v) => formatValue(cfg.yParam, PARAMS[cfg.yParam].clamp(v))).join(", ");

  const axisRange = (
    which: "x" | "y", axis: AxisSpec, set: (a: AxisSpec) => void,
  ) => (
    <div className="grid grid-cols-3 gap-2">
      <Field label="Min">
        <Input aria-label={`${which} min`} type="number" mono value={axis.min}
          onChange={(e) => set({ ...axis, min: num(e.target.value, axis.min) })} />
      </Field>
      <Field label="Max">
        <Input aria-label={`${which} max`} type="number" mono value={axis.max}
          onChange={(e) => set({ ...axis, max: num(e.target.value, axis.max) })} />
      </Field>
      <Field label="Steps">
        <Input aria-label={`${which} steps`} type="number" mono step={1} value={axis.steps}
          onChange={(e) => set({ ...axis, steps: num(e.target.value, axis.steps) })} />
      </Field>
    </div>
  );

  const paramOptions = (exclude: ParamKey) =>
    PARAM_ORDER.filter((k) => k !== exclude).map((k) => (
      <option key={k} value={k}>{PARAMS[k].label} ({PARAMS[k].unit})</option>
    ));

  return (
    <div className="flex flex-col gap-3">
      <Section title="Axes" dense>
        <AxisHeading>X axis</AxisHeading>
        <Field label="Parameter">
          <Select aria-label="x param" value={cfg.xParam}
            onChange={(e) => setXParam(e.target.value as ParamKey)}>
            {paramOptions(cfg.yParam)}
          </Select>
        </Field>
        <div className="mt-2">{axisRange("x", cfg.xAxis, (a) => set("xAxis", a))}</div>
        <p className="mt-1.5 font-mono text-[10px] tabular-nums text-[color:var(--color-ink-muted)]">X: {xs}</p>

        <div aria-hidden className="my-2.5 h-px" style={{ background: "var(--metal-bar-soft)" }} />

        <AxisHeading>Y axis</AxisHeading>
        <Field label="Parameter">
          <Select aria-label="y param" value={cfg.yParam}
            onChange={(e) => setYParam(e.target.value as ParamKey)}>
            {paramOptions(cfg.xParam)}
          </Select>
        </Field>
        <div className="mt-2">{axisRange("y", cfg.yAxis, (a) => set("yAxis", a))}</div>
        <p className="mt-1.5 font-mono text-[10px] tabular-nums text-[color:var(--color-ink-muted)]">Y: {ys}</p>
      </Section>

      <Section title="Circle & layout" dense>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Diameter (mm)">
            <Input aria-label="diameter" type="number" mono step={0.5} value={cfg.diameterMm}
              onChange={(e) => set("diameterMm", num(e.target.value, cfg.diameterMm))} />
          </Field>
          <Field label="Gap (mm)">
            <Input aria-label="gap" type="number" mono step={0.5} value={cfg.gapMm}
              onChange={(e) => set("gapMm", num(e.target.value, cfg.gapMm))} />
          </Field>
          <Field label="Bed W (mm)">
            <Input aria-label="bed width" type="number" mono step={10} value={cfg.bedMm.w}
              onChange={(e) => set("bedMm", { ...cfg.bedMm, w: num(e.target.value, cfg.bedMm.w) })} />
          </Field>
          <Field label="Bed H (mm)">
            <Input aria-label="bed height" type="number" mono step={10} value={cfg.bedMm.h}
              onChange={(e) => set("bedMm", { ...cfg.bedMm, h: num(e.target.value, cfg.bedMm.h) })} />
          </Field>
          <Field label="Title prefix" className="col-span-2">
            <Input aria-label="title prefix" type="text" value={cfg.labels.titlePrefix}
              onChange={(e) => set("labels", { ...cfg.labels, titlePrefix: e.target.value })} />
          </Field>
          <label className="col-span-2 flex items-center gap-2 text-[12.5px] text-[color:var(--color-ink-muted)] select-none cursor-pointer">
            <input type="checkbox" className="accent-[color:var(--color-primary)]" checked={cfg.labels.show}
              onChange={(e) => set("labels", { ...cfg.labels, show: e.target.checked })} />
            Axis labels
          </label>
        </div>
        <p className="mt-1 font-mono text-[11px] tabular-nums"
          style={{ color: overBed ? "var(--color-primary)" : "var(--color-ink-muted)" }}>
          Footprint: {footprint.w.toFixed(0)} × {footprint.h.toFixed(0)} mm{overBed ? " — exceeds bed" : ""}
        </p>
      </Section>
    </div>
  );
}
```

- [ ] **Step 2: Create `web/src/components/spiraltest/FixedParams.tsx`**:

```tsx
import type { SpiralTestConfig } from "../../lib/forge/spiralTest";
import { PARAMS, PARAM_ORDER, type ParamKey } from "../../lib/forge/spiralParams";
import { descentDepthMm } from "../../lib/forge/depth";
import { Field, Input, Section } from "../../ui";

interface Props {
  cfg: SpiralTestConfig;
  onChange: (c: SpiralTestConfig) => void;
}

function num(v: string, fallback: number): number {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
}

/** The non-swept cut parameters. Every sweepable param has an input here; the
 *  two currently on an axis are disabled (their value comes from the axis). */
export function FixedParams({ cfg, onChange }: Props) {
  const setFixed = (k: ParamKey, v: number) =>
    onChange({ ...cfg, fixed: { ...cfg.fixed, [k]: PARAMS[k].clamp(v) } });

  const onAxis = (k: ParamKey): "X" | "Y" | null =>
    k === cfg.xParam ? "X" : k === cfg.yParam ? "Y" : null;

  // Descent depth uses the fixed values; it varies per cell (so reads "—") when
  // any of its inputs (passes / focus step / focus interval) is on an axis.
  const depthVaries = (["passes", "focusStep", "focusInterval"] as ParamKey[]).some((k) => onAxis(k) !== null);
  const depth = descentDepthMm(cfg.fixed.passes, cfg.fixed.focusInterval, cfg.fixed.focusStep);

  return (
    <Section title="Fixed params" dense>
      <div className="grid grid-cols-2 gap-2">
        {PARAM_ORDER.map((k) => {
          const ax = onAxis(k);
          return (
            <Field key={k} label={`${PARAMS[k].label}${ax ? ` (on ${ax})` : ` (${PARAMS[k].unit})`}`}>
              <Input aria-label={`fixed ${k}`} type="number" mono value={cfg.fixed[k]} disabled={ax !== null}
                onChange={(e) => setFixed(k, num(e.target.value, cfg.fixed[k]))} />
            </Field>
          );
        })}
        <Field label="Initial drop (mm)">
          <Input aria-label="focus initial" type="number" mono step={0.01} value={cfg.focusInitialMm}
            onChange={(e) => onChange({ ...cfg, focusInitialMm: Math.max(0, num(e.target.value, cfg.focusInitialMm)) })} />
        </Field>
      </div>
      <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.08em] text-[color:var(--color-ink-subtle)]">
        {depthVaries ? "Descent @ varies: —" : `Descent @ ${cfg.fixed.passes}p: ${depth.toFixed(3)} mm`}
      </p>
    </Section>
  );
}
```

- [ ] **Step 3: Rewrite `web/src/pages/SpiralTestPage.tsx`** — replace the whole file with:

```tsx
import { useMemo, useState } from "react";
import { Button, Card, Field, Input, PageContainer, Section, Select } from "../ui";
import { SpiralTestControls } from "../components/spiraltest/SpiralTestControls";
import { SpiralTestPreview } from "../components/spiraltest/SpiralTestPreview";
import { FixedParams } from "../components/spiraltest/FixedParams";
import { buildSpiralTest, type SpiralTestConfig } from "../lib/forge/spiralTest";
import { buildSpiralTestXs } from "../lib/forge/spiralTestXs";
import { PARAMS, PARAM_ORDER, type ParamKey } from "../lib/forge/spiralParams";

const DEFAULT_CFG: SpiralTestConfig = {
  xParam: "channelWidth", yParam: "pitch",
  xAxis: { ...PARAMS.channelWidth.defaultAxis }, yAxis: { ...PARAMS.pitch.defaultAxis },
  fixed: Object.fromEntries(PARAM_ORDER.map((k) => [k, PARAMS[k].defaultFixed])) as Record<ParamKey, number>,
  diameterMm: 10, side: "outside", minChannelMm: 0.4, gapMm: 4, bedMm: { w: 300, h: 300 },
  focusInitialMm: 0.01, laser: "red",
  labels: { show: true, titlePrefix: "" },
  // Label engrave — MOPA IR fill-engrave preset.
  score: { laser: "red", power: 65, speed: 1944, passes: 1, linesPerCm: 300, scanMode: "bidirectional", pulseWidth: 500, frequency: 65 },
};

/** Parse a numeric field, keeping the prior value on empty/NaN — and NOT
 *  clobbering a valid 0 (which `parseFloat(v) || fallback` would). */
function num(v: string, fallback: number): number {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
}

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

  const setScore = <K extends keyof SpiralTestConfig["score"]>(k: K, v: SpiralTestConfig["score"][K]) =>
    setCfg({ ...cfg, score: { ...cfg.score, [k]: v } });

  return (
    <div className="relative flex flex-col" style={{ height: "calc(100dvh - 56px)" }}>
      <PageContainer maxWidth="wide" className="relative flex min-h-0 flex-1 flex-col overflow-hidden pt-3 pb-3">
        <div className="flex shrink-0 items-baseline gap-3 pb-1">
          <h1 className="font-mono text-[11px] font-semibold uppercase tracking-[0.22em] text-[var(--color-ink-subtle)]">
            Spiral Test
          </h1>
          <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-[color:var(--color-ink-subtle)]/70">
            parameter sweep
          </span>
          <span className="ml-auto font-mono text-[11px] tabular-nums"
            style={{ color: result.overBed ? "var(--color-primary)" : "var(--color-ink-muted)" }}>
            {result.cells.length} cells · {result.footprintMm.w.toFixed(0)}×{result.footprintMm.h.toFixed(0)} mm
            {result.overBed ? " · exceeds bed" : ""}
          </span>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-[272px_minmax(0,1fr)_248px] grid-rows-[minmax(0,1fr)] items-stretch gap-3 pt-3">
          <div className="flex min-h-0 flex-col gap-3 overflow-y-auto pr-1 [&>*]:shrink-0">
            <SpiralTestControls cfg={cfg} onChange={setCfg} footprint={result.footprintMm} overBed={result.overBed} />
          </div>

          <Card padded={false} className="flex min-h-0 min-w-0 p-3">
            <SpiralTestPreview result={result} />
          </Card>

          <div className="flex min-h-0 flex-col gap-3 overflow-y-auto pl-1 [&>*]:shrink-0">
            <FixedParams cfg={cfg} onChange={setCfg} />

            <Section title="Label engrave" dense>
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
              <p className="mt-1.5 font-mono text-[10px] leading-relaxed text-[color:var(--color-ink-subtle)]">
                Real-font fill engrave (title + axis values).
              </p>
            </Section>

            <Section title="Export" dense>
              <Button variant="primary" size="sm" className="w-full" onClick={onExport}>
                Export .xs
              </Button>
              <p className="mt-2 font-mono text-[10px] leading-relaxed text-[color:var(--color-ink-subtle)]">
                One .xs: spiral cuts + engraved labels as two operations.
              </p>
            </Section>
          </div>
        </div>
      </PageContainer>
    </div>
  );
}
```

- [ ] **Step 4: Rewrite `web/src/components/spiraltest/controls.test.tsx`** — replace the whole file with:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { SpiralTestControls } from "./SpiralTestControls";
import type { SpiralTestConfig } from "../../lib/forge/spiralTest";
import { PARAMS, PARAM_ORDER, type ParamKey } from "../../lib/forge/spiralParams";

function baseCfg(over: Partial<SpiralTestConfig> = {}): SpiralTestConfig {
  const fixed = Object.fromEntries(PARAM_ORDER.map((k) => [k, PARAMS[k].defaultFixed])) as Record<ParamKey, number>;
  return {
    xParam: "channelWidth", yParam: "pitch",
    xAxis: { min: 0.6, max: 1.0, steps: 4 }, yAxis: { min: 0.03, max: 0.05, steps: 4 },
    fixed, diameterMm: 10, side: "outside", minChannelMm: 0.4, gapMm: 4, bedMm: { w: 300, h: 300 },
    focusInitialMm: 0.01, laser: "red",
    labels: { show: true, titlePrefix: "" },
    score: { laser: "red", power: 65, speed: 1944, passes: 1, linesPerCm: 300, scanMode: "bidirectional", pulseWidth: 500, frequency: 65 },
    ...over,
  };
}

describe("SpiralTestControls", () => {
  it("shows resolved axis values and footprint", () => {
    render(<SpiralTestControls cfg={baseCfg()} onChange={() => {}} footprint={{ w: 120, h: 120 }} overBed={false} />);
    expect(screen.getByText(/0\.60, 0\.73, 0\.87, 1\.00/)).toBeInTheDocument(); // X channel width
    expect(screen.getByText(/0\.030, 0\.037, 0\.043, 0\.050/)).toBeInTheDocument(); // Y pitch
    expect(screen.getByText(/120 × 120 mm/)).toBeInTheDocument();
  });
  it("changing the X param emits xParam + a reset xAxis range", () => {
    const onChange = vi.fn();
    render(<SpiralTestControls cfg={baseCfg()} onChange={onChange} footprint={{ w: 1, h: 1 }} overBed={false} />);
    fireEvent.change(screen.getByLabelText("x param"), { target: { value: "speed" } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
      xParam: "speed", xAxis: PARAMS.speed.defaultAxis,
    }));
  });
  it("the X param select cannot pick the param already on Y", () => {
    render(<SpiralTestControls cfg={baseCfg()} onChange={() => {}} footprint={{ w: 1, h: 1 }} overBed={false} />);
    const xSelect = screen.getByLabelText("x param");
    // yParam is "pitch" → not offered in the X select
    expect(within(xSelect).queryByRole("option", { name: /Pitch/ })).toBeNull();
  });
  it("emits a changed diameter", () => {
    const onChange = vi.fn();
    render(<SpiralTestControls cfg={baseCfg()} onChange={onChange} footprint={{ w: 1, h: 1 }} overBed={false} />);
    fireEvent.change(screen.getByLabelText("diameter"), { target: { value: "12" } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ diameterMm: 12 }));
  });
  it("edits the title prefix", () => {
    const onChange = vi.fn();
    render(<SpiralTestControls cfg={baseCfg()} onChange={onChange} footprint={{ w: 1, h: 1 }} overBed={false} />);
    fireEvent.change(screen.getByLabelText("title prefix"), { target: { value: "BRASS" } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ labels: expect.objectContaining({ titlePrefix: "BRASS" }) }));
  });
});
```

- [ ] **Step 5: Create `web/src/components/spiraltest/FixedParams.test.tsx`**:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { FixedParams } from "./FixedParams";
import type { SpiralTestConfig } from "../../lib/forge/spiralTest";
import { PARAMS, PARAM_ORDER, type ParamKey } from "../../lib/forge/spiralParams";

function baseCfg(over: Partial<SpiralTestConfig> = {}): SpiralTestConfig {
  const fixed = Object.fromEntries(PARAM_ORDER.map((k) => [k, PARAMS[k].defaultFixed])) as Record<ParamKey, number>;
  return {
    xParam: "channelWidth", yParam: "pitch",
    xAxis: { min: 0.6, max: 1.0, steps: 4 }, yAxis: { min: 0.03, max: 0.05, steps: 4 },
    fixed, diameterMm: 10, side: "outside", minChannelMm: 0.4, gapMm: 4, bedMm: { w: 300, h: 300 },
    focusInitialMm: 0.01, laser: "red",
    labels: { show: true, titlePrefix: "" },
    score: { laser: "red", power: 65, speed: 1944, passes: 1, linesPerCm: 300, scanMode: "bidirectional", pulseWidth: 500, frequency: 65 },
    ...over,
  };
}

describe("FixedParams", () => {
  it("renders an input for every sweepable param", () => {
    render(<FixedParams cfg={baseCfg()} onChange={() => {}} />);
    for (const k of PARAM_ORDER) expect(screen.getByLabelText(`fixed ${k}`)).toBeInTheDocument();
  });
  it("disables the inputs for the params currently on an axis", () => {
    render(<FixedParams cfg={baseCfg()} onChange={() => {}} />);
    expect(screen.getByLabelText("fixed channelWidth")).toBeDisabled(); // on X
    expect(screen.getByLabelText("fixed pitch")).toBeDisabled();        // on Y
    expect(screen.getByLabelText("fixed speed")).not.toBeDisabled();
  });
  it("editing an off-axis fixed value emits the clamped change", () => {
    const onChange = vi.fn();
    render(<FixedParams cfg={baseCfg()} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("fixed speed"), { target: { value: "1800" } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ fixed: expect.objectContaining({ speed: 1800 }) }));
  });
  it("shows the descent depth, and 'varies' when a focus input is on an axis", () => {
    const { rerender } = render(<FixedParams cfg={baseCfg()} onChange={() => {}} />);
    expect(screen.getByText(/Descent @ 250p: 0\.750 mm/)).toBeInTheDocument();
    rerender(<FixedParams cfg={baseCfg({ xParam: "focusStep", xAxis: PARAMS.focusStep.defaultAxis })} onChange={() => {}} />);
    expect(screen.getByText(/Descent @ varies: —/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 6: Typecheck, test, build**

Run: `cd web && npx tsc --noEmit && npm test -- --run`
Expected: tsc clean; all suites pass. Confirm no stale refs: `grep -rn "cfg\.cut\|\.channelWidth\.\|setCut\|label\.sizeMm\|labelPaths" web/src` returns nothing.
Run: `cd web && npm run build > /dev/null 2>&1 && echo BUILD_OK` → `BUILD_OK`.

- [ ] **Step 7: Commit**

```bash
git add web/src/components/spiraltest/SpiralTestControls.tsx web/src/components/spiraltest/controls.test.tsx \
        web/src/components/spiraltest/FixedParams.tsx web/src/components/spiraltest/FixedParams.test.tsx \
        web/src/pages/SpiralTestPage.tsx
git commit -m "feat(spiral-test): AXES selectors + FIXED PARAMS panel for selectable axes"
```

---

## Task 4: Changelog + browser verification

**Files:** Create `changelog/2026-06-18-spiral-test-axes.md`.

- [ ] **Step 1: Write the changelog entry** — create `changelog/2026-06-18-spiral-test-axes.md`:

```markdown
---
id: 2026-06-18-spiral-test-axes
date: 2026-06-18
level: minor
title: Spiral Test — selectable axis parameters
summary: Put any two parameters on the X/Y axes — channel width, pitch, speed, passes, power, frequency, pulse width, or focus descent (step + interval) — not just channel width × pitch.
---
```

- [ ] **Step 2: Full suites**

Run: `cd web && npx tsc --noEmit && npm test -- --run` → tsc clean; all pass.

- [ ] **Step 3: Browser golden path**

Restart/refresh the dev server (serves fresh `web/dist`), open `http://127.0.0.1:8017/#/spiral-test`, and verify:
- Default view matches today: X = channel width (`0.60 0.73 0.87 1.00`), Y = pitch (`0.030 …`), title `X:Channel width  Y:Pitch  D:10 ID:0.01 S:1500 PA:250 P:100 F:65 PW:80 FS:0.06 FI:20`.
- Set X param = Speed → the X axis values become integer mm/s; the title drops `S:` from its fixed list and shows `X:Speed`; the FIXED PARAMS "Speed" input becomes disabled with an "(on X)" tag. The discs stay geometrically identical across columns (only the cut profile differs) — expected.
- Set Y param = Focus / step → Y values show 2dp mm; the descent-depth readout shows "—".
- The X select does not offer the param chosen on Y (and vice versa).
- Export `.xs` for a speed sweep; unzip and confirm multiple `VECTOR_CUTTING` profiles with distinct speeds + the `FILL_VECTOR_ENGRAVING` label op. For a channel×pitch sweep confirm a single `VECTOR_CUTTING` profile. Screenshot and review legibility/layout critically.

- [ ] **Step 4: Commit**

```bash
git add changelog/2026-06-18-spiral-test-axes.md
git commit -m "docs(spiral-test): changelog for selectable axis parameters"
```

---

## Execution notes

- Branch: `feat/spiral-test-axes` (off `main`). Push + open a draft PR when done; flip to ready when CI is green.
- No persistence/migration: config lives in `useState`, so only `DEFAULT_CFG` changes (and it reproduces today's channel×pitch default).
- `.xs` exports can now contain many `VECTOR_CUTTING` profiles (one per distinct cut setting) — intended, matching Studio; dedup keeps geometry-only sweeps to one profile.
- The cut `laser` stays fixed (`red`/MOPA IR), not a sweepable axis (per the approved scope).
- Do NOT touch the other Spiral feature files (`SpiralPage`, `SpiralControls`, `SpiralCanvas`, `spiral.ts`, `presets.ts`).
```
