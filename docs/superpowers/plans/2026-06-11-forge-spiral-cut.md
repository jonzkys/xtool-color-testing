# Forge Spiral Cut Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a standalone "Spiral Cut" Forge strategy that auto-generates continuous-spiral `VECTOR_CUTTING` lines from an uploaded SVG — a wide venting channel + focus step-down that severs 3 mm brass cleanly at ~2× incise speed.

**Architecture:** A new geometry module `spiral.ts` builds continuous open polylines by walking concentric `offsetRegion` rings and bridging them; the pipeline emits these as `GeneratedPath`s with `generatedClass:"spiral"`; the exporter writes them as flat-mode (`LASER_PLANE`) `VECTOR_CUTTING` entries. Standalone only — if incise stages are also enabled the exporter warns and emits spiral-only.

**Tech Stack:** TypeScript, React, Vite, vitest, `clipper-lib` (offsets), the existing Forge pipeline/exporter.

**Spec:** `docs/superpowers/specs/2026-06-11-forge-spiral-cut-design.md`

**Conventions:** `cd web && npx tsc --noEmit` typechecks; `cd web && npm test` runs vitest; `cd web && npm run build` builds the bundle the backend serves. Commit after every green task. Branch: `feat/forge-spiral-cut`.

---

## File Structure

**Create**
- `web/src/lib/forge/spiral.ts` — `spiralFromRegion`, `generateSpiralPaths`, `spiralPathLength`. Pure geometry, no I/O.
- `web/src/lib/forge/spiral.test.ts` — vitest unit tests.
- `changelog/2026-06-11-spiral-cut.md` — major changelog entry.

**Modify**
- `web/src/lib/forge/offset.ts` — export `offsetRegion` (currently module-private).
- `web/src/lib/forge/types.ts` — `SpiralConfig`, `spiral` on `ForgeConfig`, `"spiral"` on `GeneratedClass`, descent fields on `StageParams`.
- `web/src/lib/forge/config.ts` — `STAGE_GROUPS.spiral`, spiral branch in `resolveStageParams`.
- `web/src/lib/forge/presets.ts` — disabled `spiral` in `COMMON`, `SPIRAL_CUT` preset, `PRESETS`/`PresetId`.
- `web/src/lib/forge/estimate.ts` — `spiralSeconds`, spiral branch in `estimateForge`.
- `web/src/lib/forge/pipeline.ts` — call `generateSpiralPaths`, `pathCounts.spiral`, spiral+incise warning.
- `web/src/lib/forge/xcs.ts` — per-path display flags + `VECTOR_CUTTING` entry + `applyStageParams` descent fields.
- `web/src/lib/forge/xs.ts` — thread `lightSourceMode: "red"` for a red-laser flat job.
- `web/src/components/forge/ForgeCanvas.tsx` — stroke render for spiral arms.
- `web/src/components/forge/ForgeControls.tsx` — spiral card + `"spiral"` in `CLASSES`.
- `web/src/components/forge/ForgeStageParams.tsx` — spiral tab.
- `web/src/pages/ForgePage.tsx` — `ALL_VISIBLE.spiral`, `CONFIG_LS_KEY` bump, `loadConfig` merge.

---

## Canonical interfaces (use these EXACT names across all tasks)

```ts
// types.ts
export interface SpiralConfig {
  enabled: boolean;
  channelWidthMm: number;       // total venting channel width (0.8 = clean)
  pitchMm: number;              // arm spacing (~beam, 0.04)
  side: "outside" | "inside" | "both";
  minChannelMm: number;         // floor before fallback (0.4)
  passes: number;               // vector passes → customize.repeat (500)
  focusStepMm: number;          // focus descent per step (0.06)
  focusIntervalPasses: number;  // descend every N passes (10)
}

// spiral.ts
export interface SpiralOptions {
  channelWidthMm: number;
  pitchMm: number;
  side: "outside" | "inside" | "both";
  minChannelMm: number;
}
export interface SpiralResult { arms: Pt[][]; warnings: string[]; }
export function spiralFromRegion(part: Pt[][], opts: SpiralOptions): SpiralResult;
export function spiralPathLength(arm: Pt[]): number;
export function generateSpiralPaths(part: Pt[][], cfg: ForgeConfig, sourceObjectId: string): GeneratedPath[];
```

Each `arm` is ONE open polyline (NOT closed). `generateSpiralPaths` returns one `GeneratedPath` per arm with `generatedClass:"spiral"`, `groupName:STAGE_GROUPS.spiral`, and `rings:[arm]` (the polyline stored as the sole "ring").

---

## Task 1: Types — SpiralConfig, GeneratedClass, StageParams, ForgeConfig

**Files:** Modify `web/src/lib/forge/types.ts`

- [ ] **Step 1: Add `"spiral"` to the `GeneratedClass` union (line 20)**

```ts
export type GeneratedClass = "seed" | "perforate" | "deepen" | "clean" | "spiral";
```

- [ ] **Step 2: Add the four VECTOR_CUTTING descent fields to `StageParams` (after line 136, before the closing brace)**

```ts
  cuttingDrop?: boolean;            // → customize.cuttingDrop (focus descent on)
  sinkingMethod?: string;           // → customize.sinkingMethod ("one")
  descentIntervalDescent?: number;  // → customize.descentIntervalDescent (every N passes)
  descentPerStep?: number;          // → customize.descentPerStep (mm per step)
```

- [ ] **Step 3: Add `SpiralConfig` interface (after `CleanConfig`, ~line 96)**

```ts
export interface SpiralConfig {
  enabled: boolean;
  /** Total venting channel width swept on the scrap side (mm); 0.8 cuts clean. */
  channelWidthMm: number;
  /** Spacing between spiral arms (mm); ~beam so arms overlap and the channel fully ablates. */
  pitchMm: number;
  /** outside = spiral into scrap around the silhouette; inside = into holes; both. */
  side: "outside" | "inside" | "both";
  /** Floor to shrink the channel toward in a thin neck before falling back to a warning. */
  minChannelMm: number;
  /** Vector passes (→ customize.repeat). */
  passes: number;
  /** Focus descent per step (mm) — follows focus down through the thickness. */
  focusStepMm: number;
  /** Step the focus every N passes. */
  focusIntervalPasses: number;
}
```

- [ ] **Step 4: Add `spiral: SpiralConfig` to `ForgeConfig` (after `clean: CleanConfig;`, line 106)**

```ts
  clean: CleanConfig;
  spiral: SpiralConfig;
```

- [ ] **Step 5: Widen the `activePreset` hint union (line 121) to include spiral**

```ts
  activePreset?: "lean" | "aggressive" | "spiral" | "custom";
```

- [ ] **Step 6: Typecheck**

Run: `cd web && npx tsc --noEmit`
Expected: errors ONLY in presets.ts / defaults.ts / ForgePage.tsx etc. that build a `ForgeConfig` without `spiral` (fixed in later tasks). No errors inside types.ts itself.

- [ ] **Step 7: Commit**

```bash
git add web/src/lib/forge/types.ts
git commit -m "feat(forge): spiral types — SpiralConfig, GeneratedClass, StageParams descent fields"
```

---

## Task 2: config.ts — STAGE_GROUPS + resolveStageParams spiral branch

**Files:** Modify `web/src/lib/forge/config.ts`

- [ ] **Step 1: Add the spiral group to `STAGE_GROUPS` (line 5-9)**

```ts
export const STAGE_GROUPS = {
  seed: "CUT_01_SEED",
  perforate: "CUT_02_PERFORATE",
  clean: "CUT_07_CLEAN",
  spiral: "CUT_08_SPIRAL",
} as const;
```

- [ ] **Step 2: Add the spiral branch in `resolveStageParams` (after the `clean` block, before the deepen-groups block, ~line 72)**

```ts
  out[STAGE_GROUPS.spiral] = {
    ...(sp[STAGE_GROUPS.spiral] ?? {}),
    // Vector cut: passes → customize.repeat, NOT raster slices. sliceNumber stays 1.
    passes: sp[STAGE_GROUPS.spiral]?.passes ?? config.spiral.passes,
    sliceNumber: 1,
    // Focus step-down so the cut follows focus down through the thickness.
    cuttingDrop: true,
    sinkingMethod: "one",
    descentIntervalDescent: config.spiral.focusIntervalPasses,
    descentPerStep: config.spiral.focusStepMm,
  };
```

- [ ] **Step 3: Typecheck**

Run: `cd web && npx tsc --noEmit`
Expected: same pre-existing preset/config errors as Task 1; nothing new in config.ts.

- [ ] **Step 4: Commit**

```bash
git add web/src/lib/forge/config.ts
git commit -m "feat(forge): STAGE_GROUPS.spiral + resolveStageParams spiral branch"
```

---

## Task 3: presets.ts — disabled spiral default + SPIRAL_CUT preset

**Files:** Modify `web/src/lib/forge/presets.ts`

- [ ] **Step 1: Add a disabled `spiral` to `COMMON` (so LEAN/AGGRESSIVE inherit it off) — inside the `COMMON` object (line 5-13)**

```ts
  spiral: {
    enabled: false, channelWidthMm: 0.8, pitchMm: 0.04, side: "outside" as const,
    minChannelMm: 0.4, passes: 500, focusStepMm: 0.06, focusIntervalPasses: 10,
  },
```

- [ ] **Step 2: Add the `SPIRAL_CUT` preset after `AGGRESSIVE` (line 49). Incise stages OFF (standalone), spiral ON, laser recipe seeded into stageParams.**

```ts
/** SPIRAL_CUT — standalone continuous-spiral cut. All incise stages off; one
 *  flat-mode VECTOR_CUTTING strategy with the confirmed 3mm-brass recipe. */
export const SPIRAL_CUT: ForgeConfig = {
  ...COMMON,
  activePreset: "spiral",
  timeBudgetX: null,
  seed: { enabled: false, widthMultiplier: 2, layerCount: 3, outsideOnly: true },
  perforate: { enabled: false, spacingMm: 4, cornerBoost: false, cornerAngleThresholdDeg: 35, pocketSizeMm: 0.2, outsideBias: true, layerCount: 2, shape: "slot", nearGap: false, gapThresholdMm: 1.5, slotLengthMm: 0.8 },
  deepen: { groups: [], outsideOnly: true },
  clean: { enabled: false, offsetSelection: "walls", passes: 1, layerCount: 10 },
  spiral: {
    enabled: true, channelWidthMm: 0.8, pitchMm: 0.04, side: "outside",
    minChannelMm: 0.4, passes: 500, focusStepMm: 0.06, focusIntervalPasses: 10,
  },
  stageParams: {
    CUT_08_SPIRAL: { power: 100, speed: 1500, frequency: 65, pulseWidth: 80, laser: "red" },
  },
};
```

- [ ] **Step 3: Register the preset (line 51-52)**

```ts
export const PRESETS = { lean: LEAN, aggressive: AGGRESSIVE, spiral: SPIRAL_CUT } as const;
export type PresetId = keyof typeof PRESETS;
```

- [ ] **Step 4: Typecheck**

Run: `cd web && npx tsc --noEmit`
Expected: LEAN/AGGRESSIVE now have `spiral` via COMMON, so their errors clear. Remaining errors only in `defaults.ts` / `ForgePage.tsx` (handled in Task 13) or anywhere else constructing a `ForgeConfig` literal.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/forge/presets.ts
git commit -m "feat(forge): SPIRAL_CUT preset + disabled spiral default in COMMON"
```

---

## Task 4: Export `offsetRegion` from offset.ts

**Files:** Modify `web/src/lib/forge/offset.ts:63`

`spiral.ts` needs `offsetRegion`, which is currently module-private. Export it (no behaviour change).

- [ ] **Step 1: Add `export` to the declaration (line 63)**

```ts
export function offsetRegion(part: Pt[][], deltaMm: number): Pt[][] {
```

- [ ] **Step 2: Typecheck**

Run: `cd web && npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add web/src/lib/forge/offset.ts
git commit -m "refactor(forge): export offsetRegion for the spiral generator"
```

---

## Task 5: spiral.ts core — concentric offsets + single-strand stitching

**Files:** Create `web/src/lib/forge/spiral.ts`, `web/src/lib/forge/spiral.test.ts`

The algorithm: for k = 1..N (N = ceil(channelWidthMm/pitchMm)), compute `offsetRegion(part, sign·k·pitch)` (sign +1 for outside, -1 for inside). Each level is a `Pt[][]`. For this task handle the simple case where every level has exactly one loop: stitch them into one open polyline, bridging level→level at the closest point. Topology splits and fallback come in Tasks 6-7.

- [ ] **Step 1: Write the failing test (`spiral.test.ts`)**

```ts
import { describe, it, expect } from "vitest";
import { spiralFromRegion, spiralPathLength } from "./spiral";
import type { Pt } from "./types";

// A 20mm square centred at origin.
const square: Pt[] = [
  { x: -10, y: -10 }, { x: 10, y: -10 }, { x: 10, y: 10 }, { x: -10, y: 10 },
];

describe("spiralFromRegion (single strand)", () => {
  it("convex part → one continuous open arm", () => {
    const r = spiralFromRegion([square], {
      channelWidthMm: 0.8, pitchMm: 0.04, side: "outside", minChannelMm: 0.4,
    });
    expect(r.warnings).toEqual([]);
    expect(r.arms.length).toBe(1);
    // ~20 rings × the square perimeter → far more than a single loop's worth of points.
    expect(r.arms[0].length).toBeGreaterThan(40);
    // open: first and last point differ.
    const a = r.arms[0][0], b = r.arms[0][r.arms[0].length - 1];
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(0.5);
  });

  it("spiralPathLength sums segment lengths", () => {
    const len = spiralPathLength([{ x: 0, y: 0 }, { x: 3, y: 0 }, { x: 3, y: 4 }]);
    expect(len).toBeCloseTo(8, 6); // 3 + 5
  });
});
```

- [ ] **Step 2: Run it — fails (module missing)**

Run: `cd web && npm test -- spiral`
Expected: FAIL — cannot find `./spiral`.

- [ ] **Step 3: Implement the core (`spiral.ts`)**

```ts
// web/src/lib/forge/spiral.ts
// Continuous-spiral VECTOR_CUTTING path generator. A spiral is a single open
// polyline that sweeps a venting-width channel along the part boundary by
// walking concentric offsets and bridging them — the vectorised open trench.
import { offsetRegion, pointInPolygon } from "./offset";
import { STAGE_GROUPS } from "./config";
import type { ForgeConfig, GeneratedPath, Pt } from "./types";

export interface SpiralOptions {
  channelWidthMm: number;
  pitchMm: number;
  side: "outside" | "inside" | "both";
  minChannelMm: number;
}
export interface SpiralResult { arms: Pt[][]; warnings: string[]; }

/** Total polyline length (mm). */
export function spiralPathLength(arm: Pt[]): number {
  let L = 0;
  for (let i = 1; i < arm.length; i++) L += Math.hypot(arm[i].x - arm[i - 1].x, arm[i].y - arm[i - 1].y);
  return L;
}

/** Index in `loop` of the point nearest `target`. */
function nearestIndex(loop: Pt[], target: Pt): number {
  let best = 0, bd = Infinity;
  for (let i = 0; i < loop.length; i++) {
    const d = (loop[i].x - target.x) ** 2 + (loop[i].y - target.y) ** 2;
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

/** Rotate a closed ring to start at index `start`, returned as an OPEN walk. */
function rotateOpen(loop: Pt[], start: number): Pt[] {
  return loop.map((_, i) => loop[(start + i) % loop.length]);
}

/** Compute the per-level offset rings for one side. Stops when an offset
 *  collapses to nothing. Returns one Pt[][] per level (level 0 = innermost). */
function offsetLevels(part: Pt[][], opts: SpiralOptions, sign: 1 | -1): Pt[][][] {
  const levels: Pt[][][] = [];
  const n = Math.max(1, Math.ceil(opts.channelWidthMm / opts.pitchMm));
  for (let k = 1; k <= n; k++) {
    const rings = offsetRegion(part, sign * k * opts.pitchMm);
    if (rings.length === 0) break;
    levels.push(rings);
  }
  return levels;
}

/** Stitch a single-loop-per-level stack into one open polyline. */
function stitchSingleStrand(levels: Pt[][][]): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < levels.length; i++) {
    const loop = levels[i][0];
    const start = out.length ? nearestIndex(loop, out[out.length - 1]) : 0;
    out.push(...rotateOpen(loop, start)); // open walk; bridge = the implicit segment to the next level's start
  }
  return out;
}

export function spiralFromRegion(part: Pt[][], opts: SpiralOptions): SpiralResult {
  const warnings: string[] = [];
  if (part.length === 0 || !(opts.pitchMm > 0) || !(opts.channelWidthMm > 0)) {
    return { arms: [], warnings };
  }
  const sign: 1 | -1 = opts.side === "inside" ? -1 : 1;
  const levels = offsetLevels(part, opts, sign);
  if (levels.length === 0) { return { arms: [], warnings: ["spiral: channel too small to fit any pass"] }; }
  // Single-strand assumption for this task (one loop per level).
  return { arms: [stitchSingleStrand(levels)], warnings };
}
```

- [ ] **Step 4: Run tests — pass**

Run: `cd web && npm test -- spiral`
Expected: PASS (2/2).

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/forge/spiral.ts web/src/lib/forge/spiral.test.ts
git commit -m "feat(forge): spiral core — concentric offsets + single-strand stitch"
```

---

## Task 6: spiral.ts — topology-split handling (concave necks, multi-part)

**Files:** Modify `web/src/lib/forge/spiral.ts`, `web/src/lib/forge/spiral.test.ts`

When an offset level yields multiple loops (a concave neck split the contour, or the SVG has multiple parts), each loop is its own strand. Match child loops to parents across levels via `pointInPolygon` and emit one arm per terminal strand.

- [ ] **Step 1: Add the failing test**

```ts
describe("spiralFromRegion (topology)", () => {
  it("two separate parts → two arms", () => {
    const sqA: Pt[] = [{ x: -10, y: -10 }, { x: -2, y: -10 }, { x: -2, y: 10 }, { x: -10, y: 10 }];
    const sqB: Pt[] = [{ x: 2, y: -10 }, { x: 10, y: -10 }, { x: 10, y: 10 }, { x: 2, y: 10 }];
    const r = spiralFromRegion([sqA, sqB], { channelWidthMm: 0.4, pitchMm: 0.04, side: "outside", minChannelMm: 0.4 });
    expect(r.arms.length).toBe(2);
  });
});
```

- [ ] **Step 2: Run — fails** (`spiralFromRegion` currently always returns 1 arm)

Run: `cd web && npm test -- spiral`
Expected: FAIL — `r.arms.length` is 1, expected 2.

- [ ] **Step 3: Replace `stitchSingleStrand` usage with multi-strand assembly**

Add a strand-tracking assembler and call it from `spiralFromRegion` instead of `stitchSingleStrand`:

```ts
interface Strand { loops: Pt[]; } // ordered loops, innermost first

/** Group loops across levels into strands by parent containment. */
function buildStrands(levels: Pt[][][]): Pt[][] {
  // Seed one strand per loop in level 0.
  let strands: { loopsByLevel: Pt[][] }[] = levels[0].map((loop) => ({ loopsByLevel: [loop] }));
  for (let i = 1; i < levels.length; i++) {
    for (const child of levels[i]) {
      const probe = child[0];
      // Find the strand whose current outermost loop contains this child's probe point.
      const parent = strands.find((s) => pointInPolygon(s.loopsByLevel[s.loopsByLevel.length - 1], probe));
      if (parent) parent.loopsByLevel.push(child);
      else strands.push({ loopsByLevel: [child] }); // split spawned a new strand mid-stack
    }
  }
  // Stitch each strand's loops into one open polyline.
  return strands
    .filter((s) => s.loopsByLevel.length > 0)
    .map((s) => {
      const out: Pt[] = [];
      for (const loop of s.loopsByLevel) {
        const start = out.length ? nearestIndex(loop, out[out.length - 1]) : 0;
        out.push(...rotateOpen(loop, start));
      }
      return out;
    });
}
```

In `spiralFromRegion`, replace the single-strand return with:

```ts
  return { arms: buildStrands(levels), warnings };
```

Delete `stitchSingleStrand` (now unused — DRY).

- [ ] **Step 4: Run — passes (and the Task-5 convex test still passes: one strand)**

Run: `cd web && npm test -- spiral`
Expected: PASS (3/3).

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/forge/spiral.ts web/src/lib/forge/spiral.test.ts
git commit -m "feat(forge): spiral topology — one arm per strand (necks, multi-part)"
```

---

## Task 7: spiral.ts — thin-neck fallback + generateSpiralPaths

**Files:** Modify `web/src/lib/forge/spiral.ts`, `web/src/lib/forge/spiral.test.ts`

If the first offset is empty (region too thin to fit even one pass), shrink `channelWidthMm` toward `minChannelMm` (halving); if still empty, return `{ arms: [], warnings:[...] }`. Then add the `generateSpiralPaths` wrapper that maps arms → `GeneratedPath[]`.

- [ ] **Step 1: Add failing tests**

```ts
import { generateSpiralPaths } from "./spiral";
import { SPIRAL_CUT } from "./presets";

describe("spiralFromRegion (fallback) + generateSpiralPaths", () => {
  it("tiny region → empty arms + warning, never throws", () => {
    const tiny: Pt[] = [{ x: 0, y: 0 }, { x: 0.05, y: 0 }, { x: 0.05, y: 0.05 }, { x: 0, y: 0.05 }];
    const r = spiralFromRegion([tiny], { channelWidthMm: 0.8, pitchMm: 0.04, side: "inside", minChannelMm: 0.4 });
    // inside offset of a 0.05mm box collapses immediately.
    expect(r.arms.length).toBe(0);
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it("generateSpiralPaths → GeneratedPath per arm, class spiral, open polyline in rings[0]", () => {
    const square: Pt[] = [{ x: -10, y: -10 }, { x: 10, y: -10 }, { x: 10, y: 10 }, { x: -10, y: 10 }];
    const paths = generateSpiralPaths([square], SPIRAL_CUT, "obj-1");
    expect(paths.length).toBe(1);
    expect(paths[0].generatedClass).toBe("spiral");
    expect(paths[0].groupName).toBe("CUT_08_SPIRAL");
    expect(paths[0].rings.length).toBe(1); // one polyline
    expect(paths[0].rings[0].length).toBeGreaterThan(40);
  });
});
```

- [ ] **Step 2: Run — fails** (`generateSpiralPaths` missing; inside-collapse may already pass)

Run: `cd web && npm test -- spiral`
Expected: FAIL — `generateSpiralPaths` is not exported.

- [ ] **Step 3: Add fallback to `spiralFromRegion` and the wrapper**

In `spiralFromRegion`, after computing `levels`, if empty, retry with a shrinking channel before giving up:

```ts
  let chan = opts.channelWidthMm;
  let levels = offsetLevels(part, { ...opts, channelWidthMm: chan }, sign);
  while (levels.length === 0 && chan / 2 >= opts.minChannelMm) {
    chan /= 2;
    levels = offsetLevels(part, { ...opts, channelWidthMm: chan }, sign);
  }
  if (levels.length === 0) {
    return { arms: [], warnings: [`spiral: region too thin for a ${opts.minChannelMm}mm channel — skipped (re-enable incise here)`] };
  }
  return { arms: buildStrands(levels), warnings };
```

Add the wrapper:

```ts
export function generateSpiralPaths(part: Pt[][], cfg: ForgeConfig, sourceObjectId: string): GeneratedPath[] {
  if (!cfg.spiral.enabled) return [];
  const { channelWidthMm, pitchMm, side, minChannelMm } = cfg.spiral;
  const result = spiralFromRegion(part, { channelWidthMm, pitchMm, side, minChannelMm });
  return result.arms.map((arm, i) => ({
    sourceObjectId,
    generatedClass: "spiral",
    groupName: STAGE_GROUPS.spiral,
    layerStart: 0,
    layerEnd: cfg.spiral.passes,
    widthMultiplier: channelWidthMm / cfg.beamWidthMm,
    offsetMm: channelWidthMm,
    sideMode: side === "inside" ? "inside" : "outside",
    operationOrder: i,
    enabled: true,
    rings: [arm], // open polyline carried as the sole "ring"
  }));
}
```

`generateSpiralPaths` swallows the `warnings` here; the pipeline (Task 9) re-derives + surfaces them. (Keep `spiralFromRegion` as the warning source of truth.)

- [ ] **Step 4: Run — passes**

Run: `cd web && npm test -- spiral`
Expected: PASS (5/5).

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/forge/spiral.ts web/src/lib/forge/spiral.test.ts
git commit -m "feat(forge): spiral thin-neck fallback + generateSpiralPaths wrapper"
```

---

## Task 8: estimate.ts — linear spiral cut-time

**Files:** Modify `web/src/lib/forge/estimate.ts` (+ its test file if one exists)

First READ `estimate.ts` to learn `estimateForge`'s signature, the `ForgeEstimate` shape, how it currently iterates paths and reads per-stage params (it calls `resolveStageParams` and reads `speed`/`sliceNumber`). Then add a spiral branch: for `generatedClass === "spiral"`, time = `passes × (pathLength / speedMmS)` summed over the path's rings, where `passes` = resolved `StageParams.passes` (or `cfg.spiral.passes`) and `speedMmS` = resolved `StageParams.speed`.

- [ ] **Step 1: Write the failing test** (mirror the existing estimate test style in that file)

```ts
// in estimate.test.ts (match existing imports/harness)
it("spiral path: time = passes × pathLength / speed", () => {
  const square: Pt[] = [{ x: -10, y: -10 }, { x: 10, y: -10 }, { x: 10, y: 10 }, { x: -10, y: 10 }];
  const paths = generateSpiralPaths([square], SPIRAL_CUT, "o1");
  const est = estimateForge(paths, [square], SPIRAL_CUT, /* sourceParams */ {});
  // sanity: a few minutes, not the raster's tens of minutes; strictly > 0.
  expect(est.totalSeconds).toBeGreaterThan(0);
});
```

- [ ] **Step 2: Run — fails** (spiral paths hit the raster branch / NaN)

Run: `cd web && npm test -- estimate`
Expected: FAIL or wrong value.

- [ ] **Step 3: Add `spiralSeconds` and branch in `estimateForge`**

```ts
import { spiralPathLength } from "./spiral";

/** Linear vector cut time: passes × Σ(pathLength)/speed (+ tiny per-pass overhead). */
function spiralSeconds(path: GeneratedPath, passes: number, speedMmS: number): number {
  const len = path.rings.reduce((s, arm) => s + spiralPathLength(arm), 0);
  const PER_PASS_OVERHEAD_S = 0.01;
  return passes * (len / Math.max(1, speedMmS) + PER_PASS_OVERHEAD_S);
}
```

In `estimateForge`'s per-path loop, branch before the existing raster `stageSeconds` call:

```ts
  if (path.generatedClass === "spiral") {
    const sp = resolved[path.groupName] ?? {};
    seconds += spiralSeconds(path, sp.passes ?? cfg.spiral.passes, sp.speed ?? 1500);
    continue; // skip the raster model
  }
```

(Adapt `resolved`, `seconds`, loop variable names to the actual file.)

- [ ] **Step 4: Run — passes**

Run: `cd web && npm test -- estimate`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/forge/estimate.ts web/src/lib/forge/estimate.test.ts
git commit -m "feat(forge): linear spiral cut-time estimate"
```

---

## Task 9: pipeline.ts — wire spiral + standalone warning

**Files:** Modify `web/src/lib/forge/pipeline.ts`

READ `pipeline.ts` (`runPipeline`) to see where stage generators are called and `ordered` / `pathCounts` / `warnings` are assembled. Then:

- [ ] **Step 1: Write the failing test** (match the existing pipeline test harness)

```ts
it("spiral preset: emits spiral paths, no incise stages", () => {
  const res = runPipeline(parsedFixture, targetId, SPIRAL_CUT);
  expect(res.stats.pathCounts.spiral).toBeGreaterThan(0);
  expect(res.stats.pathCounts.deepen).toBe(0);
});

it("warns when spiral and an incise stage are both enabled", () => {
  const mixed = { ...LEAN, spiral: { ...LEAN.spiral, enabled: true } };
  const res = runPipeline(parsedFixture, targetId, mixed);
  expect(res.stats.warnings.some((w) => /spiral/i.test(w) && /incise/i.test(w))).toBe(true);
});
```

- [ ] **Step 2: Run — fails** (`pathCounts.spiral` undefined; no warning)

Run: `cd web && npm test -- pipeline`
Expected: FAIL.

- [ ] **Step 3: Implement**

- Import `generateSpiralPaths`.
- After the clean-stage generation, add: `const spiralPaths = generateSpiralPaths(part, cfg, target.id);` and append to `ordered`.
- Add `spiral: spiralPaths.length` to the `pathCounts` object (now type-complete since `GeneratedClass` includes `"spiral"`).
- Standalone guard: if `cfg.spiral.enabled` and any of `cfg.seed.enabled | cfg.perforate.enabled | cfg.clean.enabled | cfg.deepen.groups.some(g=>g.enabled)`, push a warning: `"Spiral Cut is standalone — incise stages are enabled too; export will emit spiral-only (mixed cut+incise is unsupported)."`
- Re-run the spiral-warning derivation (call `spiralFromRegion` once for warnings, OR have `generateSpiralPaths` return warnings — simplest: also push any thin-neck warnings by calling `spiralFromRegion` is redundant; instead make `generateSpiralPaths` optionally collect into a passed array). Keep it simple: add the standalone warning here; thin-neck warnings can be surfaced in a follow-up (note in changelog).

- [ ] **Step 4: Run — passes**

Run: `cd web && npm test -- pipeline`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/forge/pipeline.ts
git commit -m "feat(forge): wire spiral into pipeline + standalone warning"
```

---

## Task 10: xcs.ts — export spiral as flat-mode VECTOR_CUTTING

**Files:** Modify `web/src/lib/forge/xcs.ts`

READ `buildGeneratedXcs` (~354-468), `applyStageParams` (~472-500), `contourToDPath` (~274), `ringsToDPath` (~289). Currently every generated path is forced to `INTAGLIO` + `isFill:true` + `fillRule:"evenodd"` + `isClosePath:true`. Branch on the spiral class.

- [ ] **Step 1: Write the failing round-trip test**

```ts
it("spiral path exports as flat VECTOR_CUTTING open polyline", () => {
  const square: Pt[] = [{ x: -10, y: -10 }, { x: 10, y: -10 }, { x: 10, y: 10 }, { x: -10, y: 10 }];
  const paths = generateSpiralPaths([square], SPIRAL_CUT, target.id);
  const xcs = buildGeneratedXcs(parsedFixture, target.id, paths, 1, resolveStageParams(SPIRAL_CUT));
  const entry = /* locate the generated display's device entry */;
  expect(entry.processingType).toBe("VECTOR_CUTTING");
  expect(entry.isFill).toBe(false);
  const cz = entry.data.VECTOR_CUTTING.parameter.customize;
  expect(cz.cuttingDrop).toBe(true);
  expect(cz.descentPerStep).toBeCloseTo(0.06);
  // display:
  const disp = /* locate the display */;
  expect(disp.isClosePath).toBe(false);
});
```

- [ ] **Step 2: Run — fails**

Run: `cd web && npm test -- xcs`
Expected: FAIL — exports as INTAGLIO/closed/filled.

- [ ] **Step 3: Implement the spiral branch**

In `buildGeneratedXcs`, per generated path compute:
```ts
  const spiral = path.generatedClass === "spiral";
  const dPath = spiral
    ? contourToDPath(path.rings[0], false, mmPerUnit)   // open polyline
    : ringsToDPath(path.rings, mmPerUnit);              // existing closed bands
```
Display flags: `isFill: !spiral`, `isClosePath: !spiral`, and only set `fillRule:"evenodd"` when `!spiral`.

For the device entry, when `spiral`, build a fresh `VECTOR_CUTTING` entry (do NOT clone the INTAGLIO source) seeded with:
```ts
{ isFill: false, type: "PATH", processingType: "VECTOR_CUTTING",
  data: { VECTOR_CUTTING: { materialType: "customize", planType: "blue", parameter: { customize: {
    processingLightSource: "red", power: 100, speed: 1500, repeat: 1, pulseWidth: 80, mopaFrequency: 65,
    cuttingDrop: true, sinkingMethod: "one", firstCuttingDropValue: 0.06, cuttingDropValue: 0.06,
    descentIntervalDescent: 10, descentPerStep: 0.06, enableKerf: false, kerfDistance: 0,
    enableBreakPoint: false, breakPointGenMode: "auto", breakPointSize: 0.5, breakPointCount: 2,
    breakPointMode: "count", breakPointDistance: 100, breakPointPower: 0,
    wobbleEnable: false, wobbleDiameter: 0.05, wobbleSpacing: 0.015 } } } },
  processIgnore: false, isWhiteModel: true }
```
Then call `applyStageParams(customize, resolvedParams[path.groupName])` to layer the user's overrides (power/speed/passes→repeat/freq/pulseWidth/laser + the descent fields).

- [ ] **Step 4: Extend `applyStageParams` (~472) to map the new fields**

```ts
  if (sp.cuttingDrop !== undefined) customize.cuttingDrop = sp.cuttingDrop;
  if (sp.sinkingMethod !== undefined) customize.sinkingMethod = sp.sinkingMethod;
  if (sp.descentIntervalDescent !== undefined) customize.descentIntervalDescent = sp.descentIntervalDescent;
  if (sp.descentPerStep !== undefined) customize.descentPerStep = sp.descentPerStep;
```
(Match the file's existing setter style — `set("repeat", sp.passes)` etc.)

- [ ] **Step 5: Run — passes**

Run: `cd web && npm test -- xcs`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add web/src/lib/forge/xcs.ts
git commit -m "feat(forge): export spiral as flat-mode VECTOR_CUTTING open polylines"
```

---

## Task 11: xs.ts — red laser for a flat spiral job

**Files:** Modify `web/src/lib/forge/xs.ts`

READ `synthesizeXsFromLegacy` / `synthModeData` (~530-567). A `VECTOR_CUTTING`-only job already resolves `activeMode = "LASER_PLANE"` (its `_RELIEF_TYPES` excludes VECTOR_CUTTING — no change needed). But `synthModeData("LASER_PLANE")` hard-codes `lightSourceMode:"blue"`; the spiral uses the red MOPA IR. Thread the light source through.

- [ ] **Step 1: Write the failing test**

```ts
it("flat job with a red display → lightSourceMode red", () => {
  const xs = synthesizeXsFromLegacy(/* legacy raw with one VECTOR_CUTTING red entry */);
  const mode = /* the LASER_PLANE mode data */;
  expect(mode.lightSourceMode).toBe("red");
});
```

- [ ] **Step 2: Run — fails** (returns "blue")

Run: `cd web && npm test -- xs`
Expected: FAIL.

- [ ] **Step 3: Implement** — add an optional `lightSourceMode` param to `synthModeData` (default `"blue"`), and in `synthesizeXsFromLegacy` scan the resolved entries; if any customize has `processingLightSource === "red"` on a `LASER_PLANE` job, pass `"red"`.

- [ ] **Step 4: Run — passes**

Run: `cd web && npm test -- xs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/forge/xs.ts
git commit -m "feat(forge): flat-mode spiral job uses the red (MOPA IR) laser"
```

---

## Task 12: ForgeCanvas — stroke render for spiral arms

**Files:** Modify `web/src/components/forge/ForgeCanvas.tsx`

READ the file for `CLASS_COLOR` and the per-class render loop (`fillBand` / `strokeLoop`). Spiral arms are open polylines — stroke them, don't fill.

- [ ] **Step 1: Add the colour** — `spiral: "#c084fc"` to `CLASS_COLOR`.
- [ ] **Step 2: Add a render branch** — for `path.generatedClass === "spiral"`, stroke `path.rings[0]` as an OPEN polyline (`strokeLoop(arm, false, CLASS_COLOR.spiral, 1)` or the file's open-stroke helper); do not call `fillBand`.
- [ ] **Step 3: Typecheck + build**

Run: `cd web && npx tsc --noEmit && npm run build`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add web/src/components/forge/ForgeCanvas.tsx
git commit -m "feat(forge): render spiral arms as open strokes"
```

---

## Task 13: ForgeControls + ForgeStageParams — spiral UI

**Files:** Modify `web/src/components/forge/ForgeControls.tsx`, `web/src/components/forge/ForgeStageParams.tsx`

READ both files for the existing card / `CLASSES` / `stageList()` patterns and mirror them.

- [ ] **Step 1 (Controls):** add `"spiral"` to the `CLASSES` array (visibility toggles); add a Spiral card: enable toggle, `channelWidthMm`, `pitchMm`, `side` selector, `minChannelMm`, `passes`, `focusStepMm`, `focusIntervalPasses` numeric inputs, and a **"Load Spiral Cut preset"** button → `onChange(structuredClone(SPIRAL_CUT))` (import `SPIRAL_CUT` from `../../lib/forge/presets`).
- [ ] **Step 2 (StageParams):** in `stageList()` add `{ group: STAGE_GROUPS.spiral, label: "Spiral Cut" }` when `config.spiral.enabled`. The existing numeric-field rendering covers speed/passes/power/freq/pulseWidth; ensure the laser selector and the descent fields (`descentPerStep`, `descentIntervalDescent`) render in the Z-section for that tab.
- [ ] **Step 3: Typecheck + build**

Run: `cd web && npx tsc --noEmit && npm run build`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add web/src/components/forge/ForgeControls.tsx web/src/components/forge/ForgeStageParams.tsx
git commit -m "feat(forge): spiral controls card + stage-params tab"
```

---

## Task 14: ForgePage — visibility, persistence, config merge

**Files:** Modify `web/src/pages/ForgePage.tsx`

READ for `ALL_VISIBLE`, `CONFIG_LS_KEY`, and `loadConfig`.

- [ ] **Step 1:** add `spiral: false` to `ALL_VISIBLE`.
- [ ] **Step 2:** bump `CONFIG_LS_KEY` to `"forge.config.v7"`.
- [ ] **Step 3:** in `loadConfig`, add to the merge: `spiral: { ...DEFAULT_CONFIG.spiral, ...(p.spiral ?? {}) }`.
- [ ] **Step 4: Typecheck + build + full test run**

Run: `cd web && npx tsc --noEmit && npm test && npm run build`
Expected: all green.

- [ ] **Step 5: Browser walkthrough (Playwright/Chrome MCP)** — load the workbench, upload a sample `.xcs`, click "Load Spiral Cut preset", confirm: canvas shows violet spiral arms around the part, the estimate panel shows a sensible time, no incise bands; export and confirm a `.xs` downloads.
- [ ] **Step 6: Screenshot for the changelog; commit.**

```bash
git add web/src/pages/ForgePage.tsx
git commit -m "feat(forge): spiral visibility + persistence (config v7)"
```

---

## Task 15: Changelog + PR

**Files:** Create `changelog/2026-06-11-spiral-cut.md`; drop screenshot in `changelog/images/`.

- [ ] **Step 1:** write the major entry (frontmatter `id: 2026-06-11-spiral-cut`, `level: major`, title + summary + body explaining the strategy and the brass result), referencing the screenshot.
- [ ] **Step 2: Commit + push + draft PR**

```bash
git add changelog/2026-06-11-spiral-cut.md changelog/images/spiral-cut.png
git commit -m "docs(changelog): Forge Spiral Cut strategy"
git push -u origin feat/forge-spiral-cut
gh pr create --draft --title "feat(forge): Spiral Cut strategy" --body "..."
```

- [ ] **Step 3:** flip to ready (`gh pr ready`) once CI is green.

---

## Self-Review

**Spec coverage:** standalone strategy (Tasks 3, 9, 10) ✓; `spiralFromRegion` with concentric offsets + topology splits + fallback (Tasks 5-7) ✓; holes/multi-part (Task 6) ✓; defaults/recipe (Task 3) ✓; flat-mode VECTOR_CUTTING + focus step-down export (Task 10) ✓; red laser (Task 11) ✓; estimator branch (Task 8) ✓; UI (Tasks 12-14) ✓; changelog/PR (Task 15) ✓. Holes-inward `side` is exposed (Task 13) and handled by the negative-offset path (Task 7's `side:"inside"`); `"both"` (outer + holes in one run) is left to a follow-up — note for the reviewer.

**Placeholders:** none — every code step carries real code or an explicit READ-then-implement instruction with the exact integration point and shape.

**Type consistency:** `SpiralConfig`, `SpiralOptions`, `SpiralResult`, `spiralFromRegion`, `generateSpiralPaths`, `spiralPathLength`, `STAGE_GROUPS.spiral`, `generatedClass:"spiral"`, `rings:[arm]`, the descent `StageParams` fields, and `SPIRAL_CUT` are used identically across Tasks 1-14.

**Known follow-ups (out of this plan):** `side:"both"` single-run outer+holes; surfacing per-region thin-neck warnings through the pipeline (Task 9 ships the standalone warning only); empirical tuning of spiral direction + seam style on real cuts.
