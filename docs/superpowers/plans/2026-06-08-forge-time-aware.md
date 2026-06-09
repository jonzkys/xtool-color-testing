# Forge Time-Aware Estimation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Forge time-aware — estimate per-stage and total cut time, show % overhead vs a plain incise, warn past a configurable budget, fix the slice-inheritance footgun, and ship a lean default strategy (the deep 1/2/4/8 schedule becomes an "Aggressive" preset).

**Architecture:** A reusable, Forge-free cut-time core (`lib/cuttime/`) holds the calibrated model + generic ring geometry helpers. A thin Forge adapter (`lib/forge/estimate.ts`) maps the pipeline's `GeneratedPath[]` into the core's inputs, computes the baseline, and applies the budget. The pipeline attaches a `ForgeEstimate` to `DebugStats`; a new `ForgeEstimatePanel` renders it. The footgun fix lives in `resolveStageParams` (already on the export path). Presets replace the single hard-coded default.

**Tech Stack:** TypeScript, React, Vite, Vitest. Pure functions in `lib/`; the model was calibrated against xTool Studio (F2 Ultra) — see `docs/superpowers/specs/2026-06-08-forge-time-aware-design.md` Appendix A.

**Conventions:** Run `cd web` first for all `npx`/`npm` commands. After any `web/src/**` change that you want to see in the browser, `cd web && npm run build`. Every commit message ends with the `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` trailer (CLAUDE.md). Work on a fresh branch `feat/forge-time-aware` off `main` (see Task 0).

---

## File Structure

**New (reusable core — zero Forge imports):**
- `web/src/lib/cuttime/geometry.ts` — `ringsBBox`, `ringsFillArea`, `ringsPerimeter`.
- `web/src/lib/cuttime/geometry.test.ts`
- `web/src/lib/cuttime/model.ts` — `CutTimeCalibration`, `DEFAULT_CALIBRATION`, `RATE_FALLBACK`, `StageGeom`, `StageRate`, `stageSeconds`, `fmtDuration`.
- `web/src/lib/cuttime/model.test.ts`

**New (Forge adapter + UI + presets):**
- `web/src/lib/forge/estimate.ts` — `StageEstimate`, `ForgeEstimate`, `estimateForge`, `effectiveStageRate`, `baselineEstimate`.
- `web/src/lib/forge/estimate.test.ts`
- `web/src/lib/forge/presets.ts` — `LEAN`, `AGGRESSIVE`, `PRESETS`.
- `web/src/lib/forge/presets.test.ts`
- `web/src/components/forge/ForgeEstimatePanel.tsx`
- `changelog/2026-06-08-forge-time-aware.md`

**Modified:**
- `web/src/lib/forge/types.ts` — `PerforateConfig.layerCount`, `CleanConfig.layerCount`, `ForgeConfig.timeBudgetX`, `ForgeConfig.activePreset`, `DebugStats.estimate`.
- `web/src/lib/forge/stages.ts` — use shared `STAGE_GROUPS` constants.
- `web/src/lib/forge/config.ts` — `STAGE_GROUPS`; `resolveStageParams` sets non-deepen `sliceNumber` from layer counts.
- `web/src/lib/forge/defaults.ts` — `DEFAULT_CONFIG = LEAN`.
- `web/src/lib/forge/pipeline.ts` — compute estimate, attach to stats, push budget warning.
- `web/src/pages/ForgePage.tsx` — mount panel, `v5` key, `loadConfig` merges.
- `web/src/components/forge/ForgeControls.tsx` — preset select, budget select, perforate/clean Layers, deepen relabel.
- `web/src/components/forge/ForgeStageParams.tsx` — non-deepen layer count reads `config.{seed,perforate,clean}.layerCount`.

---

### Task 0: Branch

- [ ] **Step 1: Create the feature branch off main**

The current branch has unrelated staged work — stash nothing of the user's; just branch from `main`'s tip without carrying staged changes. Confirm with the user first if `git status` shows staged changes you don't recognise.

Run:
```bash
git stash push -u -m "wip-before-forge-time-aware" || true
git checkout main && git pull
git checkout -b feat/forge-time-aware
```
Expected: on `feat/forge-time-aware`, clean tree. (If the user wants their staged work kept on its own branch, do that first; then `git stash pop` there.)

---

### Task 1: Reusable ring-geometry helpers

**Files:**
- Create: `web/src/lib/cuttime/geometry.ts`
- Test: `web/src/lib/cuttime/geometry.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// web/src/lib/cuttime/geometry.test.ts
import { describe, it, expect } from "vitest";
import { ringsBBox, ringsFillArea, ringsPerimeter } from "./geometry";

type Pt = { x: number; y: number };
const rect = (x: number, y: number, w: number, h: number): Pt[] => [
  { x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h },
];

describe("ring geometry", () => {
  const band = [rect(0, 0, 30.2, 20.2), rect(0.1, 0.1, 30, 20)]; // 0.1mm kerf band
  const pocket = [rect(0, 0, 0.2, 0.2)];

  it("ringsBBox spans all ring points", () => {
    const b = ringsBBox(band);
    expect(b.w).toBeCloseTo(30.2, 6);
    expect(b.h).toBeCloseTo(20.2, 6);
  });

  it("ringsFillArea = outer minus inner for a band", () => {
    expect(ringsFillArea(band)).toBeCloseTo(30.2 * 20.2 - 30 * 20, 4); // 10.04
  });

  it("ringsFillArea = the loop area for a single-loop pocket", () => {
    expect(ringsFillArea(pocket)).toBeCloseTo(0.04, 6);
  });

  it("ringsPerimeter sums every ring's closed perimeter", () => {
    expect(ringsPerimeter(pocket)).toBeCloseTo(0.8, 6); // 4 * 0.2
  });

  it("empty input is zero, never NaN", () => {
    expect(ringsFillArea([])).toBe(0);
    expect(ringsBBox([])).toEqual({ w: 0, h: 0 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run src/lib/cuttime/geometry.test.ts`
Expected: FAIL — cannot resolve `./geometry`.

- [ ] **Step 3: Write minimal implementation**

```ts
// web/src/lib/cuttime/geometry.ts
// Generic closed-ring geometry summaries. No Forge / domain coupling — any caller
// with `Pt[][]` (a set of closed loops in mm) can use these.
export interface Pt { x: number; y: number }

/** Shoelace signed area of one closed loop (mm²). */
function signedArea(loop: Pt[]): number {
  let a = 0;
  for (let i = 0, n = loop.length; i < n; i++) {
    const p = loop[i];
    const q = loop[(i + 1) % n];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

/** Closed perimeter of one loop (mm). */
function loopPerimeter(loop: Pt[]): number {
  let p = 0;
  for (let i = 0, n = loop.length; i < n; i++) {
    const a = loop[i];
    const b = loop[(i + 1) % n];
    p += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return p;
}

/** Axis-aligned bounding box (width/height in mm) over every point in every ring. */
export function ringsBBox(rings: Pt[][]): { w: number; h: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const ring of rings) {
    for (const p of ring) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
  }
  if (!Number.isFinite(minX)) return { w: 0, h: 0 };
  return { w: maxX - minX, h: maxY - minY };
}

/**
 * Even-odd filled area (mm²). Forge rings are `[outer, inner]` (a band) or a
 * single solid loop (a pocket): area = |outer| − Σ|inner|, clamped ≥ 0.
 */
export function ringsFillArea(rings: Pt[][]): number {
  if (rings.length === 0) return 0;
  const areas = rings.map((r) => Math.abs(signedArea(r)));
  const [outer, ...inner] = areas;
  return Math.max(0, outer - inner.reduce((s, a) => s + a, 0));
}

/** Sum of every ring's closed perimeter (mm). */
export function ringsPerimeter(rings: Pt[][]): number {
  return rings.reduce((s, r) => s + loopPerimeter(r), 0);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run src/lib/cuttime/geometry.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/cuttime/geometry.ts web/src/lib/cuttime/geometry.test.ts
git commit -m "feat(cuttime): generic ring-geometry helpers (bbox/fill-area/perimeter)"
```

---

### Task 2: Reusable cut-time model

**Files:**
- Create: `web/src/lib/cuttime/model.ts`
- Test: `web/src/lib/cuttime/model.test.ts`

- [ ] **Step 1: Write the failing test** (table-driven over the calibration probes; geometry is a concentric-rectangle band)

```ts
// web/src/lib/cuttime/model.test.ts
import { describe, it, expect } from "vitest";
import { stageSeconds, fmtDuration, DEFAULT_CALIBRATION } from "./model";
import { ringsBBox, ringsFillArea } from "./geometry";

type Pt = { x: number; y: number };
const rect = (x: number, y: number, w: number, h: number): Pt[] => [
  { x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h },
];
// scrap-side band of radial width t around a partW×partH outline
function band(partW: number, partH: number, t: number) {
  return [rect(0, 0, partW + 2 * t, partH + 2 * t), rect(t, t, partW, partH)];
}
function geomOf(rings: Pt[][]) {
  const b = ringsBBox(rings);
  return { bboxW: b.w, bboxH: b.h, fillAreaMm2: ringsFillArea(rings), perimeterMm: 0 };
}

// Studio (F2 Ultra) reported times, in seconds — Appendix A.
const PROBES: Array<{ name: string; partW: number; partH: number; t: number; slice: number; repeat: number; speed: number; density: number; sec: number }> = [
  { name: "p01", partW: 30, partH: 20, t: 0.1, slice: 50, repeat: 1, speed: 300, density: 100, sec: 196 },
  { name: "p03", partW: 30, partH: 20, t: 0.1, slice: 200, repeat: 1, speed: 300, density: 100, sec: 784 },
  { name: "p05", partW: 30, partH: 20, t: 1.0, slice: 50, repeat: 1, speed: 300, density: 100, sec: 365 },
  { name: "p07", partW: 60, partH: 40, t: 0.1, slice: 50, repeat: 1, speed: 300, density: 100, sec: 634 },
  { name: "p09", partW: 30, partH: 20, t: 0.1, slice: 256, repeat: 1, speed: 300, density: 100, sec: 1008 },
  { name: "p10", partW: 30, partH: 20, t: 0.1, slice: 50, repeat: 1, speed: 300, density: 200, sec: 394 },
  { name: "p12", partW: 30, partH: 20, t: 1.0, slice: 50, repeat: 1, speed: 100, density: 100, sec: 724 },
  { name: "p13", partW: 30, partH: 20, t: 0.1, slice: 100, repeat: 1, speed: 200, density: 300, sec: 1232 },
];

describe("cut-time model", () => {
  it.each(PROBES)("predicts $name within 12% of Studio", (p) => {
    const est = stageSeconds(
      geomOf(band(p.partW, p.partH, p.t)),
      { sliceNumber: p.slice, repeat: p.repeat, speedMmS: p.speed, densityLpc: p.density },
      DEFAULT_CALIBRATION,
    );
    expect(Math.abs(est - p.sec) / p.sec).toBeLessThan(0.12);
  });

  it("scales linearly with slices and repeat", () => {
    const g = geomOf(band(30, 20, 0.1));
    const base = stageSeconds(g, { sliceNumber: 50, repeat: 1, speedMmS: 300, densityLpc: 100 });
    const x2s = stageSeconds(g, { sliceNumber: 100, repeat: 1, speedMmS: 300, densityLpc: 100 });
    const x2r = stageSeconds(g, { sliceNumber: 50, repeat: 2, speedMmS: 300, densityLpc: 100 });
    expect(x2s / base).toBeCloseTo(2, 1);
    expect(x2r / base).toBeCloseTo(2, 1);
  });

  it("fmtDuration formats m:ss and h:mm:ss", () => {
    expect(fmtDuration(196)).toBe("3:16");
    expect(fmtDuration(11437)).toBe("3:10:37");
    expect(fmtDuration(0)).toBe("0:00");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run src/lib/cuttime/model.test.ts`
Expected: FAIL — cannot resolve `./model`.

- [ ] **Step 3: Write minimal implementation**

```ts
// web/src/lib/cuttime/model.ts
//
// Calibrated laser engrave/incise cut-time model. Reproduces xTool Studio's
// estimated time for an INTAGLIO area-fill within ~6% across 13 probes
// (F2 Ultra, processAngle ≈ 15°, density 100–300, speed 100–600, slices 50–256,
// band width 0.1–1.0 mm; see specs/2026-06-08-forge-time-aware-design.md §App.A).
//
//   stage_seconds = sliceNumber × repeat ×
//       [ d·(bboxW·bboxH)/V_SCAN  +  d·bboxH·TAU  +  K_BURN·d·fillArea/speed ]
//   d = densityLpc / 10  (lines per mm)
//
// The first two terms (raster sweep over the bounding box + per-line turnaround)
// dominate and are independent of the speed SETTING; the burn term is small for
// thin bands and only matters when a band is both wide and slow.
//
// Generic by design: no Forge / domain imports. Any caller that can summarise a
// pass as { bboxW, bboxH, fillArea } + { slices, repeat, speed, density } gets an
// estimate from `stageSeconds`.

export interface CutTimeCalibration {
  /** Raster sweep rate (mm/s) — NOT the user's speed setting. */
  vScanMmS: number;
  /** Per-scan-line turnaround (s/line). */
  tauSPerLine: number;
  /** Burn coefficient (≈1); burn ≈ scanLength/speed. */
  kBurn: number;
}

/** Calibrated 2026-06 against xTool Studio, F2 Ultra, processAngle ≈ 15°. */
export const DEFAULT_CALIBRATION: CutTimeCalibration = {
  vScanMmS: 2532,
  tauSPerLine: 0.006217,
  kBurn: 0.916,
};

/** Fallback rate when a source supplies no value — the user's measured 3 mm-brass
 *  working regime. Keeps estimates from silently reading as zero. */
export const RATE_FALLBACK = {
  speedMmS: 200,
  densityLpc: 300,
  sliceNumber: 100,
  repeat: 1,
} as const;

/** One pass's geometry summary (mm). `bboxH` is the across-scan extent that sets
 *  the scan-line count; for Forge's ~horizontal scan that is the AABB height. */
export interface StageGeom {
  bboxW: number;
  bboxH: number;
  fillAreaMm2: number;
  perimeterMm: number;
}

/** One pass's laser rate. */
export interface StageRate {
  sliceNumber: number;
  repeat: number;
  speedMmS: number;
  densityLpc: number;
}

/** Estimated laser-on seconds for one stage. */
export function stageSeconds(
  g: StageGeom,
  r: StageRate,
  c: CutTimeCalibration = DEFAULT_CALIBRATION,
): number {
  const d = Math.max(0, r.densityLpc) / 10; // lines per mm
  const speed = Math.max(1, r.speedMmS);
  const perSlice =
    (d * g.bboxW * g.bboxH) / c.vScanMmS +
    d * g.bboxH * c.tauSPerLine +
    (c.kBurn * d * g.fillAreaMm2) / speed;
  return perSlice * Math.max(1, r.sliceNumber) * Math.max(1, r.repeat);
}

/** Format seconds as `m:ss` or `h:mm:ss`. */
export function fmtDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run src/lib/cuttime/model.test.ts`
Expected: PASS (all probes within 12%, linearity, formatting).

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/cuttime/model.ts web/src/lib/cuttime/model.test.ts
git commit -m "feat(cuttime): calibrated laser cut-time model (reusable, Forge-free)"
```

---

### Task 3: Footgun fix — shallow stages stop inheriting deep slices

**Files:**
- Modify: `web/src/lib/forge/types.ts` (add `layerCount` to `PerforateConfig`, `CleanConfig`)
- Modify: `web/src/lib/forge/config.ts:45-56` (`resolveStageParams`) + add `STAGE_GROUPS`
- Modify: `web/src/lib/forge/stages.ts` (use `STAGE_GROUPS` constants)
- Modify: `web/src/lib/forge/defaults.ts` (add the new fields — interim; Task 6 replaces with LEAN)
- Test: `web/src/lib/forge/config.test.ts`

- [ ] **Step 1: Write the failing test** (append to the existing `config.test.ts`; create it if absent)

```ts
// web/src/lib/forge/config.test.ts  (add these cases)
import { describe, it, expect } from "vitest";
import { resolveStageParams, STAGE_GROUPS } from "./config";
import { DEFAULT_CONFIG } from "./defaults";

describe("resolveStageParams — footgun fix", () => {
  it("seed/perforate/clean get a sliceNumber from their layerCount (not the source's deep value)", () => {
    const cfg = { ...DEFAULT_CONFIG };
    const r = resolveStageParams(cfg);
    expect(r[STAGE_GROUPS.seed].sliceNumber).toBe(cfg.seed.layerCount);
    expect(r[STAGE_GROUPS.perforate].sliceNumber).toBe(cfg.perforate.layerCount);
    expect(r[STAGE_GROUPS.clean].sliceNumber).toBe(cfg.clean.layerCount);
  });

  it("clean.passes flows through as a passes override (→ customize.repeat on export)", () => {
    const cfg = { ...DEFAULT_CONFIG, clean: { ...DEFAULT_CONFIG.clean, passes: 3 } };
    expect(resolveStageParams(cfg)[STAGE_GROUPS.clean].passes).toBe(3);
  });

  it("an explicit per-stage sliceNumber override still wins", () => {
    const cfg = {
      ...DEFAULT_CONFIG,
      stageParams: { [STAGE_GROUPS.seed]: { sliceNumber: 7 } },
    };
    expect(resolveStageParams(cfg)[STAGE_GROUPS.seed].sliceNumber).toBe(7);
  });

  it("each deepen group's sliceNumber is still its own toLayer", () => {
    const r = resolveStageParams(DEFAULT_CONFIG);
    for (const g of DEFAULT_CONFIG.deepen.groups) {
      expect(r[g.name].sliceNumber).toBe(g.toLayer);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run src/lib/forge/config.test.ts`
Expected: FAIL — `STAGE_GROUPS` not exported; `layerCount` undefined on perforate/clean.

- [ ] **Step 3a: Add `layerCount` to the configs** — `web/src/lib/forge/types.ts`

In `PerforateConfig` (after `outsideBias`):
```ts
  /** Slice count this stage exports (shallow — starter pockets, not a deep cut). */
  layerCount: number;
```
In `CleanConfig` (after `passes`):
```ts
  /** Slice count this stage exports (shallow wall clean-up). */
  layerCount: number;
```
In `ForgeConfig` (after `manualScanAngleDeg`) — added here because the estimator
(Task 4) reads them:
```ts
  /** Warn when estimated time exceeds this multiple of a plain incise. null = off. */
  timeBudgetX?: number | null;
  /** Which preset the staged config currently matches (UI hint). */
  activePreset?: "lean" | "aggressive" | "custom";
```

- [ ] **Step 3b: Add the fields to `DEFAULT_CONFIG`** — `web/src/lib/forge/defaults.ts`

In `perforate: { … }` add `layerCount: 2,`. In `clean: { … }` add `layerCount: 10,`.

- [ ] **Step 3c: Add `STAGE_GROUPS` + extend `resolveStageParams`** — `web/src/lib/forge/config.ts`

At the top (after the import):
```ts
/** Canonical group names for the fixed (non-deepen) stages — the single source
 *  of truth shared by the generators, the exporter and the estimator. */
export const STAGE_GROUPS = {
  seed: "CUT_01_SEED",
  perforate: "CUT_02_PERFORATE",
  clean: "CUT_07_CLEAN",
} as const;
```
Replace the body of `resolveStageParams` so the three fixed stages also get a
`sliceNumber` (from their layer counts; explicit override wins) and clean's
`passes` becomes `repeat`:
```ts
export function resolveStageParams(config: ForgeConfig): Record<string, StageParams> {
  const sp = config.stageParams;
  const out: Record<string, StageParams> = { ...sp };

  // Fixed stages: a shallow, explicit sliceNumber so they never inherit the
  // source incise's deep slice count (the footgun). Explicit override wins.
  out[STAGE_GROUPS.seed] = {
    ...(sp[STAGE_GROUPS.seed] ?? {}),
    sliceNumber: sp[STAGE_GROUPS.seed]?.sliceNumber ?? config.seed.layerCount,
  };
  out[STAGE_GROUPS.perforate] = {
    ...(sp[STAGE_GROUPS.perforate] ?? {}),
    sliceNumber: sp[STAGE_GROUPS.perforate]?.sliceNumber ?? config.perforate.layerCount,
  };
  out[STAGE_GROUPS.clean] = {
    ...(sp[STAGE_GROUPS.clean] ?? {}),
    sliceNumber: sp[STAGE_GROUPS.clean]?.sliceNumber ?? config.clean.layerCount,
    // `passes` is the StageParams field; applyStageParams maps it → customize.repeat.
    passes: sp[STAGE_GROUPS.clean]?.passes ?? config.clean.passes,
  };

  // Deepen groups: linking + each group's own toLayer as sliceNumber (unchanged).
  const groups = config.deepen.groups;
  if (groups.length > 0) {
    const firstName = groups[0].name;
    groups.forEach((g, i) => {
      const linked = i > 0 && (g.copyParamsFromFirst ?? true);
      const base = linked ? sp[firstName] ?? {} : sp[g.name] ?? {};
      out[g.name] = { ...base, sliceNumber: g.toLayer };
    });
  }
  return out;
}
```

- [ ] **Step 3d: Use `STAGE_GROUPS` in the generators** — `web/src/lib/forge/stages.ts`

Add to the imports: `import { STAGE_GROUPS } from "./config";` and replace the literal `groupName` strings: `"CUT_01_SEED"` → `STAGE_GROUPS.seed` (seed), `"CUT_02_PERFORATE"` → `STAGE_GROUPS.perforate` (perforate), `"CUT_07_CLEAN"` → `STAGE_GROUPS.clean` (clean). (Deepen groups keep `group.name`.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run src/lib/forge/config.test.ts`
Expected: PASS.

- [ ] **Step 5: Guard the export end-to-end** — run the existing round-trip suite to confirm nothing else broke.

Run: `cd web && npx vitest run src/lib/forge/`
Expected: PASS (or only the known default-shape assertions, fixed in Task 6).

- [ ] **Step 6: Commit**

```bash
git add web/src/lib/forge/types.ts web/src/lib/forge/config.ts web/src/lib/forge/stages.ts web/src/lib/forge/defaults.ts web/src/lib/forge/config.test.ts
git commit -m "fix(forge): shallow stages export their own slice count, not the source's deep one"
```

---

### Task 4: Forge estimate adapter

**Files:**
- Create: `web/src/lib/forge/estimate.ts`
- Test: `web/src/lib/forge/estimate.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// web/src/lib/forge/estimate.test.ts
import { describe, it, expect } from "vitest";
import { estimateForge } from "./estimate";
import { DEFAULT_CONFIG } from "./defaults";
import type { GeneratedPath, Pt } from "./types";

const rect = (x: number, y: number, w: number, h: number): Pt[] => [
  { x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h },
];
const band = (t: number): Pt[][] => [rect(0, 0, 30 + 2 * t, 20 + 2 * t), rect(t, t, 30, 20)];
const part = [rect(0, 0, 30, 20)];

function mkPath(p: Partial<GeneratedPath>): GeneratedPath {
  return {
    sourceObjectId: "s", generatedClass: "deepen", groupName: "CUT_03_DEEPEN_A_50_1X",
    layerStart: 0, layerEnd: 50, widthMultiplier: 1, offsetMm: 0.03, sideMode: "outside",
    operationOrder: 0, enabled: true, rings: band(0.03), ...p,
  };
}

describe("estimateForge", () => {
  const source = { speed: 300, density: 100, sliceNumber: 100, passes: 1 };

  it("totals = sum of stage seconds and counts pierces/bands", () => {
    const paths = [
      mkPath({ generatedClass: "seed", groupName: "CUT_01_SEED", rings: band(0.06) }),
      mkPath({ generatedClass: "deepen", groupName: "CUT_03_DEEPEN_A_50_1X", layerEnd: 50 }),
    ];
    const est = estimateForge(paths, part, DEFAULT_CONFIG, source);
    expect(est.totalSeconds).toBeCloseTo(est.stages.reduce((s, x) => s + x.seconds, 0), 6);
    expect(est.pierces).toBe(2);
    expect(est.bandCount).toBe(2);
    expect(est.baselineSeconds).toBeGreaterThan(0);
    expect(est.overheadPct).toBeCloseTo((est.totalSeconds / est.baselineSeconds) * 100, 4);
  });

  it("aggregates perforation pockets into one stage with pathCount = pocket count", () => {
    const paths = [0, 1, 2].map((i) =>
      mkPath({ generatedClass: "perforate", groupName: "CUT_02_PERFORATE", rings: [rect(i, 0, 0.2, 0.2)], operationOrder: i }),
    );
    const est = estimateForge(paths, part, DEFAULT_CONFIG, source);
    const perf = est.stages.find((s) => s.generatedClass === "perforate")!;
    expect(perf.pathCount).toBe(3);
    expect(est.pocketCount).toBe(3);
  });

  it("flags over-budget against the configured multiplier", () => {
    const heavy = [mkPath({ groupName: "CUT_06_DEEPEN_D_256_8X", layerEnd: 256, rings: band(0.24) })];
    const cfg = { ...DEFAULT_CONFIG, timeBudgetX: 1.5 };
    const est = estimateForge(heavy, part, cfg, source);
    expect(est.overBudget).toBe(est.overheadPct / 100 > 1.5);
  });

  it("uses RATE_FALLBACK when the source has no params", () => {
    const est = estimateForge([mkPath({})], part, DEFAULT_CONFIG, undefined);
    expect(est.baselineSeconds).toBeGreaterThan(0);
    expect(Number.isFinite(est.totalSeconds)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run src/lib/forge/estimate.test.ts`
Expected: FAIL — cannot resolve `./estimate`.

- [ ] **Step 3: Write minimal implementation**

```ts
// web/src/lib/forge/estimate.ts
//
// Forge adapter over the reusable cuttime core. Maps the pipeline's
// GeneratedPath[] + part region + config into per-stage StageGeom/StageRate,
// computes the baseline (the part cut as one 1×-beam kerf at the source rate),
// applies the budget, and returns a ForgeEstimate for the panel + warnings.
import {
  stageSeconds, fmtDuration, DEFAULT_CALIBRATION, RATE_FALLBACK,
  type CutTimeCalibration, type StageRate,
} from "../cuttime/model";
import { ringsBBox, ringsFillArea, ringsPerimeter } from "../cuttime/geometry";
import { resolveStageParams } from "./config";
import { bandFromRegion } from "./offset";
import type { ForgeConfig, GeneratedClass, GeneratedPath, Pt, StageParams } from "./types";

export interface StageEstimate {
  groupName: string;
  generatedClass: GeneratedClass;
  pathCount: number;
  sliceNumber: number;
  repeat: number;
  speedMmS: number;
  densityLpc: number;
  perimeterMm: number;
  fillAreaMm2: number;
  seconds: number;
  pierces: number;
}

export interface ForgeEstimate {
  stages: StageEstimate[];
  totalSeconds: number;
  baselineSeconds: number;
  overheadPct: number;
  pierces: number;
  pocketCount: number;
  bandCount: number;
  budgetX: number | null;
  overBudget: boolean;
  worst: Array<{ groupName: string; seconds: number; pct: number }>;
}

/** Resolve the rate a stage will actually export with: resolveStageParams over
 *  the source incise's params, falling back to the measured working regime. */
function effectiveRate(
  resolved: StageParams | undefined,
  source: StageParams | undefined,
): StageRate {
  const pick = <K extends keyof StageParams>(k: K) => resolved?.[k] ?? source?.[k];
  return {
    sliceNumber: (pick("sliceNumber") as number) ?? RATE_FALLBACK.sliceNumber,
    repeat: (pick("passes") as number) ?? RATE_FALLBACK.repeat,
    speedMmS: (pick("speed") as number) ?? RATE_FALLBACK.speedMmS,
    densityLpc: (pick("density") as number) ?? RATE_FALLBACK.densityLpc,
  };
}

function geomOf(rings: Pt[][]) {
  const b = ringsBBox(rings);
  return { bboxW: b.w, bboxH: b.h, fillAreaMm2: ringsFillArea(rings), perimeterMm: ringsPerimeter(rings) };
}

/** The part cut as a single 1×-beam kerf band at the source incise's rate —
 *  "cut the outline once, un-staged" — the denominator for % overhead. */
function baselineSeconds(
  part: Pt[][], config: ForgeConfig, source: StageParams | undefined,
  calib: CutTimeCalibration,
): number {
  const rings = bandFromRegion(part, config.beamWidthMm, config.sideMode);
  if (rings.length < 2) return 0;
  const rate: StageRate = {
    sliceNumber: (source?.sliceNumber as number) ?? RATE_FALLBACK.sliceNumber,
    repeat: (source?.passes as number) ?? RATE_FALLBACK.repeat,
    speedMmS: (source?.speed as number) ?? RATE_FALLBACK.speedMmS,
    densityLpc: (source?.density as number) ?? RATE_FALLBACK.densityLpc,
  };
  return stageSeconds(geomOf(rings), rate, calib);
}

export function estimateForge(
  paths: GeneratedPath[],
  part: Pt[][],
  config: ForgeConfig,
  source: StageParams | undefined,
  calib: CutTimeCalibration = DEFAULT_CALIBRATION,
): ForgeEstimate {
  const resolved = resolveStageParams(config);

  // Group paths by groupName, preserving first-seen (process) order.
  const order: string[] = [];
  const byGroup = new Map<string, GeneratedPath[]>();
  for (const p of paths) {
    if (!byGroup.has(p.groupName)) { byGroup.set(p.groupName, []); order.push(p.groupName); }
    byGroup.get(p.groupName)!.push(p);
  }

  const stages: StageEstimate[] = order.map((group) => {
    const ps = byGroup.get(group)!;
    const rate = effectiveRate(resolved[group], source);
    // Per-path geometry summed (pockets are many small paths in one stage).
    let seconds = 0, fill = 0, perim = 0;
    for (const p of ps) {
      const g = geomOf(p.rings);
      seconds += stageSeconds(g, rate, calib);
      fill += g.fillAreaMm2;
      perim += g.perimeterMm;
    }
    return {
      groupName: group,
      generatedClass: ps[0].generatedClass,
      pathCount: ps.length,
      sliceNumber: rate.sliceNumber,
      repeat: rate.repeat,
      speedMmS: rate.speedMmS,
      densityLpc: rate.densityLpc,
      perimeterMm: perim,
      fillAreaMm2: fill,
      seconds,
      pierces: ps.length,
    };
  });

  const totalSeconds = stages.reduce((s, x) => s + x.seconds, 0);
  const baseline = baselineSeconds(part, config, source, calib);
  const overheadPct = baseline > 0 ? (totalSeconds / baseline) * 100 : 0;
  const budgetX = config.timeBudgetX ?? null;
  const overBudget = budgetX != null && baseline > 0 && totalSeconds / baseline > budgetX;
  const worst = [...stages]
    .sort((a, b) => b.seconds - a.seconds)
    .slice(0, 3)
    .map((s) => ({ groupName: s.groupName, seconds: s.seconds, pct: totalSeconds > 0 ? (s.seconds / totalSeconds) * 100 : 0 }));

  return {
    stages,
    totalSeconds,
    baselineSeconds: baseline,
    overheadPct,
    pierces: paths.length,
    pocketCount: stages.filter((s) => s.generatedClass === "perforate").reduce((n, s) => n + s.pathCount, 0),
    bandCount: stages.filter((s) => s.generatedClass !== "perforate").reduce((n, s) => n + s.pathCount, 0),
    budgetX,
    overBudget,
    worst,
  };
}

export { fmtDuration };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run src/lib/forge/estimate.test.ts`
Expected: PASS (4 tests). (`ForgeConfig.timeBudgetX`/`activePreset` were added in Task 3.)

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/forge/estimate.ts web/src/lib/forge/estimate.test.ts
git commit -m "feat(forge): cut-time estimator adapter (per-stage, baseline, budget)"
```

---

### Task 5: Wire the estimate + budget warning into the pipeline

**Files:**
- Modify: `web/src/lib/forge/types.ts` (`DebugStats.estimate`, `ForgeConfig.timeBudgetX`, `ForgeConfig.activePreset`)
- Modify: `web/src/lib/forge/pipeline.ts`
- Test: `web/src/lib/forge/pipeline.test.ts`

- [ ] **Step 1: Write the failing test** (add to `pipeline.test.ts`)

```ts
// web/src/lib/forge/pipeline.test.ts  (add)
import { describe, it, expect } from "vitest";
import { runPipeline } from "./pipeline";
import { parseXcsFile } from "./xcs";
import { DEFAULT_CONFIG } from "./defaults";
import { readFileSync } from "node:fs";

function parsed() {
  const buf = readFileSync("samples/xcs/test-text.xcs");
  return parseXcsFile(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
}

describe("pipeline estimate", () => {
  it("attaches a ForgeEstimate with a positive total + baseline", () => {
    const p = parsed();
    const r = runPipeline(p, p.targets[0].id, DEFAULT_CONFIG);
    expect(r.stats.estimate.totalSeconds).toBeGreaterThan(0);
    expect(r.stats.estimate.baselineSeconds).toBeGreaterThan(0);
    expect(r.stats.estimate.stages.length).toBe(r.stats.estimate.stages.length); // shape exists
  });

  it("pushes a budget warning when over the threshold", () => {
    const p = parsed();
    const cfg = { ...DEFAULT_CONFIG, timeBudgetX: 0.01 }; // force over-budget
    const r = runPipeline(p, p.targets[0].id, cfg);
    expect(r.stats.warnings.some((w) => /budget|incise|×/i.test(w))).toBe(true);
  });
});
```

(Sample-loading note: `xcs.test.ts`/`pipeline.test.ts` already load `samples/xcs/*` — **copy their exact loading idiom and relative path** rather than the `readFileSync` sketch above, so this test resolves the fixture the same way the suite already does. If no forge test loads a sample yet, verify the path with `ls` from the vitest root first.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run src/lib/forge/pipeline.test.ts`
Expected: FAIL — `stats.estimate` undefined.

- [ ] **Step 3a: Extend `DebugStats`** — `web/src/lib/forge/types.ts`

(`ForgeConfig.timeBudgetX`/`activePreset` were already added in Task 3.) Add to
`DebugStats` (after `scanAngleReductionPct`):
```ts
  /** Cut-time estimate for the generated strategy. */
  estimate: ForgeEstimate;
```
At the top of `types.ts` add: `import type { ForgeEstimate } from "./estimate";`
(`ForgeEstimate` is a type-only import, so there is no runtime cycle.)

- [ ] **Step 3b: Compute + attach the estimate and budget warning** — `web/src/lib/forge/pipeline.ts`

Add import: `import { estimateForge } from "./estimate";` and `import { fmtDuration } from "../cuttime/model";`

In the empty-region early return, set `estimate` to a zeroed value:
```ts
      stats: {
        // …existing fields…
        scanAngleReductionPct,
        estimate: {
          stages: [], totalSeconds: 0, baselineSeconds: 0, overheadPct: 0,
          pierces: 0, pocketCount: 0, bandCount: 0,
          budgetX: cfg.timeBudgetX ?? null, overBudget: false, worst: [],
        },
      },
```

After `ordered.forEach(...)` and before building `stats`, add:
```ts
  const estimate = estimateForge(ordered, part, cfg, obj.params);
  if (estimate.overBudget) {
    const worst = estimate.worst
      .map((w) => `${w.groupName.replace(/^CUT_\d+_/, "")} ${fmtDuration(w.seconds)}`)
      .join(", ");
    warnings.push(
      `Estimated cut ${fmtDuration(estimate.totalSeconds)} ≈ ` +
      `${(estimate.overheadPct / 100).toFixed(1)}× a plain incise ` +
      `(budget ${estimate.budgetX}×). Biggest: ${worst}. ` +
      `Reduce slices/width, clean passes, or perforation density.`,
    );
  }
```
Then add `estimate,` to the returned `stats` object.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run src/lib/forge/pipeline.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/forge/types.ts web/src/lib/forge/pipeline.ts web/src/lib/forge/pipeline.test.ts
git commit -m "feat(forge): attach cut-time estimate to stats + over-budget warning"
```

---

### Task 6: Presets — Lean default, Aggressive preserved

**Files:**
- Create: `web/src/lib/forge/presets.ts`
- Test: `web/src/lib/forge/presets.test.ts`
- Modify: `web/src/lib/forge/defaults.ts` (`DEFAULT_CONFIG = LEAN`)

- [ ] **Step 1: Write the failing test**

```ts
// web/src/lib/forge/presets.test.ts
import { describe, it, expect } from "vitest";
import { LEAN, AGGRESSIVE, PRESETS } from "./presets";

describe("forge presets", () => {
  it("AGGRESSIVE keeps the 1/2/4/8 × 50/100/200/256 deepen schedule", () => {
    expect(AGGRESSIVE.deepen.groups.map((g) => [g.toLayer, g.widthMultiplier])).toEqual([
      [50, 1], [100, 2], [200, 4], [256, 8],
    ]);
    expect(AGGRESSIVE.activePreset).toBe("aggressive");
  });

  it("LEAN is one main full-depth group + a disabled relief group, sparse perforation", () => {
    const enabled = LEAN.deepen.groups.filter((g) => g.enabled);
    expect(enabled).toHaveLength(1);
    expect(enabled[0].widthMultiplier).toBe(1);
    expect(LEAN.perforate.spacingMm).toBeGreaterThanOrEqual(4);
    expect(LEAN.seed.layerCount).toBeLessThanOrEqual(5);
    expect(LEAN.activePreset).toBe("lean");
  });

  it("PRESETS is keyed by id", () => {
    expect(PRESETS.lean).toBe(LEAN);
    expect(PRESETS.aggressive).toBe(AGGRESSIVE);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run src/lib/forge/presets.test.ts`
Expected: FAIL — cannot resolve `./presets`.

- [ ] **Step 3: Write the presets** — `web/src/lib/forge/presets.ts`

```ts
// web/src/lib/forge/presets.ts
// Named staged-strategy presets. LEAN ships as the default (lib/forge/defaults.ts);
// AGGRESSIVE preserves the original deep 1/2/4/8 schedule verbatim.
import type { ForgeConfig } from "./types";

const COMMON = {
  beamWidthMm: 0.03,
  sideMode: "outside" as const,
  mmPerUnitOverride: null,
  stageParams: {},
  optimizeScanAngle: false,
  manualScanAngleDeg: null,
  timeBudgetX: 1.5,
};

/** LEAN — one main full-depth incise + shallow seed/clean, sparse perforation,
 *  with a one-click disabled relief group. Targets ≈ 1.1–1.4× a plain incise. */
export const LEAN: ForgeConfig = {
  ...COMMON,
  activePreset: "lean",
  seed: { enabled: true, widthMultiplier: 2, layerCount: 3, outsideOnly: true },
  perforate: { enabled: true, spacingMm: 4, cornerBoost: true, cornerAngleThresholdDeg: 35, pocketSizeMm: 0.2, outsideBias: true, layerCount: 2 },
  deepen: {
    groups: [
      { name: "CUT_03_MAIN", toLayer: 256, widthMultiplier: 1, enabled: true },
      { name: "CUT_04_RELIEF", toLayer: 64, widthMultiplier: 2, enabled: false, copyParamsFromFirst: true },
    ],
    outsideOnly: true,
  },
  clean: { enabled: true, offsetSelection: "walls", passes: 1, layerCount: 10 },
};

/** AGGRESSIVE — the original deep, progressively-widening schedule. */
export const AGGRESSIVE: ForgeConfig = {
  ...COMMON,
  activePreset: "aggressive",
  seed: { enabled: true, widthMultiplier: 2, layerCount: 3, outsideOnly: true },
  perforate: { enabled: true, spacingMm: 2, cornerBoost: true, cornerAngleThresholdDeg: 35, pocketSizeMm: 0.2, outsideBias: true, layerCount: 2 },
  deepen: {
    groups: [
      { name: "CUT_03_DEEPEN_A_50_1X", toLayer: 50, widthMultiplier: 1, enabled: true },
      { name: "CUT_04_DEEPEN_B_100_2X", toLayer: 100, widthMultiplier: 2, enabled: true, copyParamsFromFirst: true },
      { name: "CUT_05_DEEPEN_C_200_4X", toLayer: 200, widthMultiplier: 4, enabled: true, copyParamsFromFirst: true },
      { name: "CUT_06_DEEPEN_D_256_8X", toLayer: 256, widthMultiplier: 8, enabled: true, copyParamsFromFirst: true },
    ],
    outsideOnly: true,
  },
  clean: { enabled: true, offsetSelection: "walls", passes: 1, layerCount: 10 },
};

export const PRESETS = { lean: LEAN, aggressive: AGGRESSIVE } as const;
export type PresetId = keyof typeof PRESETS;
```

- [ ] **Step 4a: Make LEAN the default** — `web/src/lib/forge/defaults.ts`

Replace the whole file body with:
```ts
// web/src/lib/forge/defaults.ts
import type { ForgeConfig } from "./types";
import { LEAN } from "./presets";

/** Shipped default = the LEAN preset (time-aware; the deep 1/2/4/8 schedule is
 *  the AGGRESSIVE preset). */
export const DEFAULT_CONFIG: ForgeConfig = LEAN;
```

- [ ] **Step 4b: Run the preset test**

Run: `cd web && npx vitest run src/lib/forge/presets.test.ts`
Expected: PASS.

- [ ] **Step 5: Fix default-shape fallout in existing tests**

Run: `cd web && npx vitest run src/lib/forge/`
For any test that assumed the old 4-group default (e.g. counts of deepen groups, group names like `CUT_06_DEEPEN_D_256_8X`, or `pathCounts.deepen === 4`), import `AGGRESSIVE` from `./presets` and use it as the config for that assertion, OR assert against `LEAN`'s shape. Do **not** weaken a real behavioural assertion — switch its config to the preset that matches the intent. Re-run until green.

- [ ] **Step 6: Commit**

```bash
git add web/src/lib/forge/presets.ts web/src/lib/forge/presets.test.ts web/src/lib/forge/defaults.ts web/src/lib/forge/*.test.ts
git commit -m "feat(forge): Lean default preset; Aggressive preset preserves 1/2/4/8 schedule"
```

---

### Task 7: Estimate panel

**Files:**
- Create: `web/src/components/forge/ForgeEstimatePanel.tsx`
- Modify: `web/src/pages/ForgePage.tsx` (mount it above the Debug panel)

- [ ] **Step 1: Write the component** (no unit test — it's presentational; verified in the browser check, Task 11)

```tsx
// web/src/components/forge/ForgeEstimatePanel.tsx
import { Badge, Card, CardHeader, CardTitle } from "../../ui";
import type { ForgeEstimate } from "../../lib/forge/estimate";
import { fmtDuration } from "../../lib/cuttime/model";

const label = (group: string) => group.replace(/^CUT_\d+_/, "").replace(/_/g, " ");

export function ForgeEstimatePanel({ estimate }: { estimate: ForgeEstimate | null }) {
  if (!estimate || estimate.stages.length === 0) return null;
  const { totalSeconds, baselineSeconds, overheadPct, overBudget, budgetX } = estimate;
  const pctText = overheadPct ? `${Math.round(overheadPct)}% of incise` : "—";
  return (
    <Card>
      <CardHeader><CardTitle>Estimated cut time</CardTitle></CardHeader>
      <div className="p-2 font-mono text-[11px] flex flex-col gap-2">
        <div className="flex items-baseline justify-between">
          <span className="text-[var(--color-ink)] text-sm tabular-nums">{fmtDuration(totalSeconds)}</span>
          {/* Only the confirmed `warning` variant is used (matches ForgeDebugPanel);
              the neutral case is a plain muted span. */}
          {overBudget
            ? <Badge variant="warning">{pctText}</Badge>
            : <span className="text-[var(--color-ink-muted)] tabular-nums">{pctText}</span>}
        </div>
        <table className="w-full table-fixed">
          <colgroup><col /><col className="w-14" /><col className="w-10" /><col className="w-12" /></colgroup>
          <thead>
            <tr className="text-left text-[var(--color-ink-muted)]">
              <th>stage</th><th className="text-right">time</th><th className="text-right">%</th><th className="text-right">sl×rp</th>
            </tr>
          </thead>
          <tbody>
            {estimate.stages.map((s) => (
              <tr key={s.groupName}>
                <td className="truncate">{label(s.groupName)}{s.pathCount > 1 ? ` ×${s.pathCount}` : ""}</td>
                <td className="text-right tabular-nums">{fmtDuration(s.seconds)}</td>
                <td className="text-right tabular-nums">{totalSeconds ? Math.round((s.seconds / totalSeconds) * 100) : 0}</td>
                <td className="text-right tabular-nums">{s.sliceNumber}×{s.repeat}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="text-[10px] text-[var(--color-ink-subtle)] flex flex-wrap gap-x-3 gap-y-0.5">
          <span>baseline incise {fmtDuration(baselineSeconds)}</span>
          <span>pierces {estimate.pierces}</span>
          <span>pockets {estimate.pocketCount}</span>
          <span>bands {estimate.bandCount}</span>
          {budgetX != null && <span>budget {budgetX}×</span>}
        </div>
      </div>
    </Card>
  );
}
```

- [ ] **Step 2: Mount it in the right column** — `web/src/pages/ForgePage.tsx`

Add the import near the other forge components:
```tsx
import { ForgeEstimatePanel } from "../components/forge/ForgeEstimatePanel";
```
In the right-column JSX, render it directly **above** `<ForgeDebugPanel … />`:
```tsx
<ForgeEstimatePanel estimate={result?.stats.estimate ?? null} />
<ForgeDebugPanel stats={result?.stats ?? null} optimizeScanAngle={config.optimizeScanAngle} />
```
(Use the same `result` the Debug panel already reads.)

- [ ] **Step 3: Typecheck + build**

Run: `cd web && npx tsc --noEmit`
Expected: no errors.
Run: `cd web && npm run build`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add web/src/components/forge/ForgeEstimatePanel.tsx web/src/pages/ForgePage.tsx
git commit -m "feat(forge): estimate panel — per-stage time, % vs incise, pierce/pocket/band counts"
```

---

### Task 8: ForgeControls — preset select, budget select, perforate/clean layers, deepen relabel

**Files:**
- Modify: `web/src/components/forge/ForgeControls.tsx`

- [ ] **Step 1: Add a preset + budget row to the Global card**

Add imports at the top:
```tsx
import { PRESETS, type PresetId } from "../../lib/forge/presets";
```
Inside the **Global** card's grid (after the Optimize-scan-angle label), add:
```tsx
<Field label="Strategy preset">
  <Select
    value={config.activePreset ?? "custom"}
    onChange={(e) => {
      const id = e.target.value as PresetId | "custom";
      if (id === "custom") return;
      onChange({ ...PRESETS[id] });
    }}
  >
    <option value="lean">Lean (fast)</option>
    <option value="aggressive">Aggressive (deep 1/2/4/8)</option>
    <option value="custom">Custom</option>
  </Select>
</Field>
<Field label="Time budget (× incise)">
  <Select
    value={String(config.timeBudgetX ?? "off")}
    onChange={(e) => {
      const v = e.target.value;
      patch({ timeBudgetX: v === "off" ? null : Number(v) });
    }}
  >
    <option value="off">off</option>
    <option value="1.25">1.25×</option>
    <option value="1.5">1.5×</option>
    <option value="2">2×</option>
    <option value="3">3×</option>
  </Select>
</Field>
```

- [ ] **Step 2: Flip `activePreset` to "custom" on any manual edit**

Change the `patch` helper so edits mark the config custom:
```tsx
const patch = (p: Partial<ForgeConfig>) =>
  onChange({ ...config, ...p, activePreset: "custom" });
```
And in `setGroup`, include `activePreset: "custom"` in the patched config:
```tsx
const setGroup = (i: number, g: Partial<DeepenGroup>) => {
  const groups = config.deepen.groups.map((row, idx) => (idx === i ? { ...row, ...g } : row));
  patch({ deepen: { ...config.deepen, groups } });
};
```
(The preset `Select` calls `onChange` directly with the full preset, so it keeps the preset's own `activePreset`; the `renameDeepenGroup` call should also be wrapped — change that `onChange(renameDeepenGroup(...))` to `onChange({ ...renameDeepenGroup(config, i, e.target.value), activePreset: "custom" })`.)

- [ ] **Step 3: Add Layers fields to Perforate and Clean**

In the **Perforate** grid, add:
```tsx
<Field label="Layers">
  <NumberField value={config.perforate.layerCount} step={1} min={1}
    onChange={(v) => patch({ perforate: { ...config.perforate, layerCount: Math.max(1, v) } })} />
</Field>
```
In the **Clean** grid, add:
```tsx
<Field label="Layers">
  <NumberField value={config.clean.layerCount} step={1} min={1}
    onChange={(v) => patch({ clean: { ...config.clean, layerCount: Math.max(1, v) } })} />
</Field>
```

- [ ] **Step 4: Relabel the Deepen table for cumulative layers**

Change the table header cell `<th className="text-right pr-1">to</th>` to `<th className="text-right pr-1">cum. layers</th>`, and add a one-line note under the table (after the `<table>`):
```tsx
<p className="mt-1 text-[10px] text-[var(--color-ink-subtle)]">
  each group re-engraves from the surface (0) to this depth.
</p>
```

- [ ] **Step 5: Typecheck + build**

Run: `cd web && npx tsc --noEmit && npm run build`
Expected: no errors; build succeeds.

- [ ] **Step 6: Commit**

```bash
git add web/src/components/forge/ForgeControls.tsx
git commit -m "feat(forge): preset + time-budget selectors, perforate/clean layers, cumulative-layer labels"
```

---

### Task 9: ForgeStageParams — non-deepen layer count from config (remove the footgun pre-fill)

**Files:**
- Modify: `web/src/components/forge/ForgeStageParams.tsx`

- [ ] **Step 1: Resolve the non-deepen layer count from config, not source/256**

Add import: `import { STAGE_GROUPS } from "../../lib/forge/config";`

Replace the `sliceNumber` / `depthLayers` block (lines ~153-156) with a config-derived layer count:
```tsx
  // Effective layer count for this stage:
  //  - deepen groups → their toLayer (0→toLayer);
  //  - seed/perforate/clean → their config layerCount (the value that actually
  //    exports now — no longer the source incise's deep sliceNumber).
  const nonDeepenLayerCount =
    current.group === STAGE_GROUPS.seed ? config.seed.layerCount
    : current.group === STAGE_GROUPS.perforate ? config.perforate.layerCount
    : current.group === STAGE_GROUPS.clean ? config.clean.layerCount
    : Z_DEFAULTS.sliceNumber;
  const depthLayers = isDeepen
    ? Math.max(1, config.deepen.groups[deepenIdx].toLayer)
    : nonDeepenLayerCount;
  const totalDepth = descentDepthMm(depthLayers, zLayers, zDecline);
  const depthAt256 = descentDepthMm(256, zLayers, zDecline);
```
Delete the old `const sliceNumber = override.sliceNumber ?? sourceParams?.sliceNumber ?? Z_DEFAULTS.sliceNumber;` line.

- [ ] **Step 2: Replace the non-deepen "Layer count" field so it edits the stage's config layerCount**

Replace the `{!isDeepen && ( … Layer count … )}` block (lines ~292-304) with one that writes the stage's config layer count (single source of truth) — the panel where shallow stages get their depth:
```tsx
        {!isDeepen && (
          <div className="mt-3 grid grid-cols-3 gap-2">
            <Field label="Layer count">
              <NumberField
                value={nonDeepenLayerCount}
                min={1}
                step={1}
                integer
                onChange={(v) => {
                  const n = Math.max(1, v);
                  if (current.group === STAGE_GROUPS.seed) onChange({ ...config, seed: { ...config.seed, layerCount: n }, activePreset: "custom" });
                  else if (current.group === STAGE_GROUPS.perforate) onChange({ ...config, perforate: { ...config.perforate, layerCount: n }, activePreset: "custom" });
                  else if (current.group === STAGE_GROUPS.clean) onChange({ ...config, clean: { ...config.clean, layerCount: n }, activePreset: "custom" });
                }}
              />
            </Field>
          </div>
        )}
```

- [ ] **Step 3: Typecheck + build**

Run: `cd web && npx tsc --noEmit && npm run build`
Expected: no errors. (If `setParam("sliceNumber", …)` is now unused, leaving it is fine — it still serves explicit advanced overrides via stageParams; no dead-code error since `setParam` is used elsewhere.)

- [ ] **Step 4: Commit**

```bash
git add web/src/components/forge/ForgeStageParams.tsx
git commit -m "fix(forge): stage Layer count edits the stage's own layerCount (kills source-slice footgun in the UI)"
```

---

### Task 10: Config persistence — v5 key + merges

**Files:**
- Modify: `web/src/pages/ForgePage.tsx`

- [ ] **Step 1: Bump the key and add merges for the new fields**

Change the key:
```tsx
const CONFIG_LS_KEY = "forge.config.v5"; // v4→v5: Lean default + layerCount/timeBudget/activePreset
```
In `loadConfig`, the per-section spreads already cover `seed`/`perforate`/`deepen`/`clean` (so `perforate.layerCount` and `clean.layerCount` pick up defaults). Add the two new top-level fields to the returned object (after `stageParams`):
```tsx
      timeBudgetX: p.timeBudgetX ?? DEFAULT_CONFIG.timeBudgetX,
      activePreset: p.activePreset ?? DEFAULT_CONFIG.activePreset,
```

- [ ] **Step 2: Typecheck + build**

Run: `cd web && npx tsc --noEmit && npm run build`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add web/src/pages/ForgePage.tsx
git commit -m "chore(forge): config v5 — discard stale saves, land on Lean default"
```

---

### Task 11: Changelog

**Files:**
- Create: `changelog/2026-06-08-forge-time-aware.md`

- [ ] **Step 1: Write the entry**

```markdown
---
id: 2026-06-08-forge-time-aware
date: 2026-06-08
level: major
title: Forge — time-aware cutting
summary: Forge now estimates cut time per stage, shows how it compares to a plain incise, warns before a strategy gets slow, and defaults to a lean strategy.
images:
  - src: forge-estimate-panel.png
    caption: Per-stage time, total, and % of a plain incise.
---

Forge used to happily generate a beautiful, staged cut that took hours longer
than a plain incise — and showed you nothing about it until the laser was
running. No more.

**Cut-time estimates.** Every regenerate now shows estimated laser-on time per
stage and for the whole job, plus how that compares to cutting the outline once
("% of incise"). The numbers come from a model calibrated against xTool Studio
on the F2 Ultra: cut time is linear in slices and passes and in line density,
weakly dependent on speed, and sub-linear in band width — so the cost is
cumulative depth × area, not the headline width multiplier.

**A budget warning.** Set a time budget (default 1.5× a plain incise) and Forge
warns — never blocks — when a strategy blows past it, naming the worst stages
and what to trim.

**A lean default.** The new default does the depth work in one main incise with
a shallow seed, sparse perforation and a light wall-clean — typically a small
fraction over a plain cut. The old deep 1×/2×/4×/8× progressive schedule is one
click away as the **Aggressive** preset.

**A quiet but important fix.** Seed, perforation and clean stages used to
silently inherit the source cut's deep layer count, so a "3-layer seed" could
secretly run hundreds of layers. They now export their own shallow depth.

Re-verify your recipes against the new estimates and the corrected shallow
stages before committing brass.
```

- [ ] **Step 2: Capture the screenshot** (during the browser check, Task 12) and save to `changelog/images/forge-estimate-panel.png`.

- [ ] **Step 3: Commit**

```bash
git add changelog/2026-06-08-forge-time-aware.md
git commit -m "docs(changelog): Forge time-aware cutting"
```

---

### Task 12: Full verification + browser check + empirical validation

**Files:** none (verification only)

- [ ] **Step 1: Whole suite + typecheck + build**

Run: `cd web && npx tsc --noEmit && npm test && npm run build`
Expected: typecheck clean, all vitest green, build succeeds.

- [ ] **Step 2: Backend tests unaffected** (the model change is frontend-only, but the machine_profiles round-trip touches Forge concepts)

Run: `uv run --active pytest tests/ -q`
Expected: PASS.

- [ ] **Step 3: Browser check (Chrome MCP / Playwright)** — per CLAUDE.md, UI isn't done at green tests.

1. Serve: `uv run --active xcs-gen serve --host 127.0.0.1 --port 8017` (after the `npm run build` in Step 1).
2. Open `http://127.0.0.1:8017/#/forge`, upload `samples/xcs/test-text.xcs`.
3. Confirm the **Estimated cut time** panel shows per-stage times, a total, and "% of incise"; the badge is neutral on **Lean**.
4. Switch the Strategy preset to **Aggressive**: the total jumps, "% of incise" rises, and an over-budget warning appears (Lean default budget 1.5×). Switch back to Lean.
5. Confirm the Deepen table header reads "cum. layers" with the 0→depth note; confirm Perforate/Clean have Layers fields.
6. Screenshot the panel on a representative job → `changelog/images/forge-estimate-panel.png`; read it critically (legible, numbers sane).

- [ ] **Step 4: Empirical end-to-end validation** (the model is locked; this guards the summation + footgun fix end-to-end)

1. In the Forge UI, export the **Lean** default and the **Aggressive** preset for a representative part as `.xs`.
2. Open both in xTool Studio (F2 Ultra) and read the estimated times.
3. Compare to the panel's totals — expect within ~10–15%. If a stage is off by more, check that the exported `customize.sliceNumber` for seed/perforate/clean is the shallow value (footgun fix), not the source's deep one, before adjusting calibration constants in `lib/cuttime/model.ts`.

- [ ] **Step 5: Open the PR**

```bash
git push -u origin feat/forge-time-aware
gh pr create --draft --title "Forge: time-aware estimation, budget warning, lean default" --body "$(cat <<'EOF'
Implements docs/superpowers/specs/2026-06-08-forge-time-aware-design.md.

- Reusable cut-time model (lib/cuttime/) calibrated to xTool Studio (F2 Ultra), within ~6% across 13 probes.
- Forge estimate adapter + per-stage Estimate panel; % vs a plain incise; pierce/pocket/band counts.
- Over-budget warning (default 1.5×, warn-only, configurable).
- Footgun fix: seed/perforate/clean export their own shallow slice count instead of inheriting the source's deep one.
- Lean default preset; Aggressive preset preserves the 1/2/4/8 schedule. Config bumped to v5.

Follow-up (separate): scrap-side relief vents / partial selective relief (options 3 & 6) and an A/B/C/D comparison mode (option 7).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```
Then `gh pr ready` once CI is green.

---

## Notes for the implementer

- **Spec:** `docs/superpowers/specs/2026-06-08-forge-time-aware-design.md` (model derivation + calibration data in Appendix A).
- **Calibration harness** (reproduce/extend probes): `/Users/jonzky/Documents/XTools/forge-cal/gen_probes*.py`, run via `cd <repo> && PYTHONPATH=/Users/jonzky/Documents/XTools/forge-cal uv run --active python <script>`.
- **Reusability invariant:** `lib/cuttime/**` must never import from `lib/forge/**` (other pages reuse it). The model test lives under `lib/cuttime/` and imports only the core.
- **Follow-up (not this plan):** scrap-side relief vents / partial selective relief (spec §Out-of-scope, options 3 & 6) and the A/B/C/D comparison mode (option 7).
