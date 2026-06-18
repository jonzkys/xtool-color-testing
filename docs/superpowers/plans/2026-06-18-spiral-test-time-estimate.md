# Spiral Test — job time estimate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a ballpark total job time (spiral cuts + label fill-engrave) in the Spiral Test page header, e.g. `16 cells · 86×84 mm · ~4:30`.

**Architecture:** A pure `spiralTestTime.ts` composes two existing cut-time models — the vector-cut approximation (per cut group: `passes × Σ arm-length / speed`, via `spiralPathLength`) and the calibrated raster engrave (`stageSeconds`, per label). Two tiny generic helpers are added to `cuttime/` (`vectorCutSeconds`, `ringsInkArea`). The page memoizes the total off the debounced config and appends it to the header via `fmtDuration`.

**Tech Stack:** TypeScript + React + Vite; vitest. Pure functions; no new deps.

**Spec:** `docs/superpowers/specs/2026-06-18-spiral-test-time-estimate-design.md`. On `main` (incl. PR #160 selectable axes + #161 machine limits).

**Key facts (verified):**
- `web/src/lib/cuttime/model.ts` exports `stageSeconds(g: StageGeom, r: StageRate, c?)`, `fmtDuration(seconds)`, `RATE_FALLBACK` (`{ speedMmS:200, densityLpc:300, sliceNumber:100, repeat:1 }`), `StageGeom = {bboxW,bboxH,fillAreaMm2,perimeterMm}`, `StageRate = {sliceNumber,repeat,speedMmS,densityLpc}`.
- `web/src/lib/cuttime/geometry.ts` exports `Pt`, `ringsBBox(rings): {w,h}`, `ringsFillArea`, `ringsPerimeter`; has a file-private `signedArea(loop)`.
- `web/src/lib/forge/spiral.ts` exports `spiralPathLength(arm: Pt[]): number` (open polyline length).
- `web/src/lib/forge/spiralTest.ts`: `SpiralTestResult = { cells, cutPaths: GeneratedPath[], stageParams: Record<string, StageParams>, labelOutlines: { text; rings: Pt[][] }[], footprintMm, overBed, warnings }`; `SpiralTestConfig.score = { …, speed: number, passes: number, linesPerCm: number, … }`. `GeneratedPath.rings: Pt[][]`, `.groupName: string`. `StageParams` has optional `passes`, `speed`.
- The `cuttime` `Pt` and `forge` `Pt` are both `{x,y}` — structurally compatible (estimate.ts already passes forge rings to `ringsBBox`).
- `web/src/pages/SpiralTestPage.tsx`: has `const result = useMemo(() => buildSpiralTest(debouncedCfg, profile), [debouncedCfg, profile]);` (line ~39); the header status `<span>` (lines ~64–68) reads `{result.cells.length} cells · {W}×{H} mm{result.overBed ? " · exceeds bed" : ""}`.

**Conventions:** Gate before commit: `cd web && npx tsc --noEmit && npm test -- --run`. Rebuild for the browser: `cd web && npm run build`. Never `git commit --no-verify`.

**File structure:**
```
web/src/lib/cuttime/model.ts             MOD  add vectorCutSeconds
web/src/lib/cuttime/model.test.ts        MOD
web/src/lib/cuttime/geometry.ts          MOD  add ringsInkArea
web/src/lib/cuttime/geometry.test.ts     MOD
web/src/lib/forge/spiralTestTime.ts      NEW  estimateSpiralTestSeconds
web/src/lib/forge/spiralTestTime.test.ts NEW
web/src/pages/SpiralTestPage.tsx         MOD  memoize estimate, append to header
changelog/2026-06-18-spiral-test-time-estimate.md  NEW  minor entry
```

---

## Task 1: cuttime primitives (`vectorCutSeconds`, `ringsInkArea`)

Two generic, tested helpers. Self-contained.

**Files:** Modify `cuttime/model.ts`, `cuttime/model.test.ts`, `cuttime/geometry.ts`, `cuttime/geometry.test.ts`.

- [ ] **Step 1: Write the failing tests.**

In `web/src/lib/cuttime/model.test.ts`, add (merge the import if `vitest`/`./model` are already imported at the top):
```ts
import { vectorCutSeconds } from "./model";

describe("vectorCutSeconds", () => {
  it("is passes × (length/speed) + a per-pass overhead", () => {
    expect(vectorCutSeconds(1000, 2, 500)).toBeCloseTo(4.02, 6); // 2 × (1000/500 + 0.01)
  });
  it("floors passes and speed at 1", () => {
    expect(vectorCutSeconds(100, 0, 0)).toBeCloseTo(100 / 1 + 0.01, 6); // passes→1, speed→1
  });
  it("zero length → just the per-pass overhead", () => {
    expect(vectorCutSeconds(0, 3, 500)).toBeCloseTo(3 * 0.01, 6);
  });
});
```

In `web/src/lib/cuttime/geometry.test.ts`, add:
```ts
import { ringsInkArea } from "./geometry";

describe("ringsInkArea", () => {
  const sq = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
  it("sums |area| over all rings (adds — unlike ringsFillArea's outer-minus-holes)", () => {
    expect(ringsInkArea([sq])).toBeCloseTo(1, 6);
    expect(ringsInkArea([sq, sq])).toBeCloseTo(2, 6);
  });
  it("is zero for no rings", () => {
    expect(ringsInkArea([])).toBe(0);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd web && npx vitest run src/lib/cuttime/model.test.ts src/lib/cuttime/geometry.test.ts`
Expected: FAIL — `vectorCutSeconds` / `ringsInkArea` not exported.

- [ ] **Step 3: Implement `vectorCutSeconds`** — append to `web/src/lib/cuttime/model.ts`:
```ts
/** Linear vector-cut seconds: passes × (length/speed) + a tiny per-pass
 *  overhead. Mirrors the Forge estimator's spiral branch; speed/passes floored
 *  at 1. The companion to stageSeconds (raster) for length-based cuts. */
export function vectorCutSeconds(lengthMm: number, passes: number, speedMmS: number): number {
  const PER_PASS_OVERHEAD_S = 0.01;
  const p = Math.max(1, passes);
  return p * (Math.max(0, lengthMm) / Math.max(1, speedMmS) + PER_PASS_OVERHEAD_S);
}
```

- [ ] **Step 4: Implement `ringsInkArea`** — append to `web/src/lib/cuttime/geometry.ts` (it uses the file-private `signedArea` already defined at the top):
```ts
/** Sum of |signed area| over all rings (mm²). Unlike ringsFillArea (outer minus
 *  holes), this ADDS every ring — correct for a flat list of independent filled
 *  shapes such as a multi-glyph label. (Over-counts glyph counters slightly,
 *  which only feed the minor burn term in stageSeconds.) */
export function ringsInkArea(rings: Pt[][]): number {
  return rings.reduce((s, r) => s + Math.abs(signedArea(r)), 0);
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd web && npx vitest run src/lib/cuttime/model.test.ts src/lib/cuttime/geometry.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck + commit**

Run: `cd web && npx tsc --noEmit` → clean.
```bash
git add web/src/lib/cuttime/model.ts web/src/lib/cuttime/model.test.ts \
        web/src/lib/cuttime/geometry.ts web/src/lib/cuttime/geometry.test.ts
git commit -m "feat(cuttime): vectorCutSeconds + ringsInkArea primitives"
```

---

## Task 2: the estimator (`spiralTestTime.ts`)

A pure estimator composing the two models over a `SpiralTestResult`.

**Files:** Create `web/src/lib/forge/spiralTestTime.ts`, `web/src/lib/forge/spiralTestTime.test.ts`.

- [ ] **Step 1: Write the failing test** — create `web/src/lib/forge/spiralTestTime.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { buildSpiralTest, type SpiralTestConfig } from "./spiralTest";
import { estimateSpiralTestSeconds } from "./spiralTestTime";
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

describe("estimateSpiralTestSeconds", () => {
  it("cut-only when labels are off; total === cut", () => {
    const cfg = baseCfg({ labels: { show: false, titlePrefix: "" } });
    const r = estimateSpiralTestSeconds(buildSpiralTest(cfg), cfg);
    expect(r.cutSeconds).toBeGreaterThan(0);
    expect(r.engraveSeconds).toBe(0);
    expect(r.totalSeconds).toBeCloseTo(r.cutSeconds, 6);
  });
  it("labels add engrave time; total = cut + engrave", () => {
    const cfg = baseCfg();
    const r = estimateSpiralTestSeconds(buildSpiralTest(cfg), cfg);
    expect(r.engraveSeconds).toBeGreaterThan(0);
    expect(r.totalSeconds).toBeCloseTo(r.cutSeconds + r.engraveSeconds, 6);
  });
  it("doubling fixed passes ~doubles cut time", () => {
    const lo = baseCfg({ fixed: { ...baseCfg().fixed, passes: 100 }, labels: { show: false, titlePrefix: "" } });
    const hi = baseCfg({ fixed: { ...baseCfg().fixed, passes: 200 }, labels: { show: false, titlePrefix: "" } });
    const ratio = estimateSpiralTestSeconds(buildSpiralTest(hi), hi).cutSeconds
      / estimateSpiralTestSeconds(buildSpiralTest(lo), lo).cutSeconds;
    expect(ratio).toBeGreaterThan(1.9);
    expect(ratio).toBeLessThan(2.1);
  });
  it("doubling fixed speed ~halves cut time", () => {
    const slow = baseCfg({ fixed: { ...baseCfg().fixed, speed: 1000 }, labels: { show: false, titlePrefix: "" } });
    const fast = baseCfg({ fixed: { ...baseCfg().fixed, speed: 2000 }, labels: { show: false, titlePrefix: "" } });
    const ratio = estimateSpiralTestSeconds(buildSpiralTest(slow), slow).cutSeconds
      / estimateSpiralTestSeconds(buildSpiralTest(fast), fast).cutSeconds;
    expect(ratio).toBeGreaterThan(1.8);
    expect(ratio).toBeLessThan(2.1);
  });
  it("a larger grid takes longer", () => {
    const small = baseCfg();
    const big = baseCfg({ xAxis: { min: 0.6, max: 1.0, steps: 4 }, yAxis: { min: 0.03, max: 0.05, steps: 4 } });
    expect(estimateSpiralTestSeconds(buildSpiralTest(big), big).totalSeconds)
      .toBeGreaterThan(estimateSpiralTestSeconds(buildSpiralTest(small), small).totalSeconds);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd web && npx vitest run src/lib/forge/spiralTestTime.test.ts`
Expected: FAIL — cannot find module `./spiralTestTime`.

- [ ] **Step 3: Implement `web/src/lib/forge/spiralTestTime.ts`**:
```ts
// web/src/lib/forge/spiralTestTime.ts
// Ballpark job-time estimate for a Spiral Test sheet: vector spiral cuts +
// raster label fill-engrave. Composes the cuttime models. Pure. Approximate —
// ignores focus-descent Z-moves and inter-cell rapid travel.
import { stageSeconds, vectorCutSeconds, RATE_FALLBACK } from "../cuttime/model";
import { ringsBBox, ringsInkArea, ringsPerimeter } from "../cuttime/geometry";
import { spiralPathLength } from "./spiral";
import type { SpiralTestConfig, SpiralTestResult } from "./spiralTest";

export interface SpiralTestTime {
  cutSeconds: number;
  engraveSeconds: number;
  totalSeconds: number;
}

/** Estimate total job seconds: spiral cuts (vector, per deduped profile) +
 *  label fill-engrave (raster). */
export function estimateSpiralTestSeconds(result: SpiralTestResult, cfg: SpiralTestConfig): SpiralTestTime {
  // Cut: per group, passes × Σ(arm length) / speed. Group params carry the
  // per-cell swept passes/speed (deduped into result.stageParams).
  const lenByGroup = new Map<string, number>();
  for (const p of result.cutPaths) {
    const len = p.rings.reduce((s, arm) => s + spiralPathLength(arm), 0);
    lenByGroup.set(p.groupName, (lenByGroup.get(p.groupName) ?? 0) + len);
  }
  let cutSeconds = 0;
  for (const [group, len] of lenByGroup) {
    const sp = result.stageParams[group];
    const passes = sp?.passes ?? 1;
    const speed = sp?.speed ?? RATE_FALLBACK.speedMmS;
    cutSeconds += vectorCutSeconds(len, passes, speed);
  }

  // Engrave: per label, a raster sweep at the score (label-engrave) rate.
  let engraveSeconds = 0;
  for (const lbl of result.labelOutlines) {
    if (lbl.rings.length === 0) continue;
    const b = ringsBBox(lbl.rings);
    engraveSeconds += stageSeconds(
      { bboxW: b.w, bboxH: b.h, fillAreaMm2: ringsInkArea(lbl.rings), perimeterMm: ringsPerimeter(lbl.rings) },
      { sliceNumber: 1, repeat: cfg.score.passes, speedMmS: cfg.score.speed, densityLpc: cfg.score.linesPerCm },
    );
  }

  return { cutSeconds, engraveSeconds, totalSeconds: cutSeconds + engraveSeconds };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd web && npx vitest run src/lib/forge/spiralTestTime.test.ts`
Expected: PASS. (If the speed-ratio test lands just outside `1.8–2.1`, the geometry's total cut length per the default fixture makes the per-pass `0.01` overhead non-negligible — do NOT loosen blindly; first log `estimateSpiralTestSeconds(...).cutSeconds` for both and confirm the ratio trends ~2; only then widen the bound minimally with a comment.)

- [ ] **Step 5: Typecheck + commit**

Run: `cd web && npx tsc --noEmit && npm test -- --run` → clean; all pass.
```bash
git add web/src/lib/forge/spiralTestTime.ts web/src/lib/forge/spiralTestTime.test.ts
git commit -m "feat(spiral-test): estimateSpiralTestSeconds (cut + engrave job-time)"
```

---

## Task 3: header readout + changelog + browser verification

**Files:** Modify `web/src/pages/SpiralTestPage.tsx`; Create `changelog/2026-06-18-spiral-test-time-estimate.md`.

- [ ] **Step 1: Wire the estimate into the page.**

(a) Add imports (with the other imports at the top of `SpiralTestPage.tsx`):
```tsx
import { estimateSpiralTestSeconds } from "../lib/forge/spiralTestTime";
import { fmtDuration } from "../lib/cuttime/model";
```

(b) After the `result` memo (`const result = useMemo(() => buildSpiralTest(debouncedCfg, profile), [debouncedCfg, profile]);`), add:
```tsx
  // Ballpark job time (cut + label engrave); tracks the debounced preview.
  const estSeconds = useMemo(() => estimateSpiralTestSeconds(result, debouncedCfg).totalSeconds, [result, debouncedCfg]);
```

(c) In the header status `<span>`, insert the time after the footprint and before the over-bed clause. Replace:
```tsx
            {result.cells.length} cells · {result.footprintMm.w.toFixed(0)}×{result.footprintMm.h.toFixed(0)} mm
            {result.overBed ? " · exceeds bed" : ""}
```
with:
```tsx
            {result.cells.length} cells · {result.footprintMm.w.toFixed(0)}×{result.footprintMm.h.toFixed(0)} mm
            {" "}· ~{fmtDuration(estSeconds)}
            {result.overBed ? " · exceeds bed" : ""}
```

- [ ] **Step 2: Typecheck, test, build**

Run: `cd web && npx tsc --noEmit && npm test -- --run` → tsc clean; all pass.
Run: `cd web && npm run build > /dev/null 2>&1 && echo BUILD_OK` → `BUILD_OK`.

- [ ] **Step 3: Write the changelog** — create `changelog/2026-06-18-spiral-test-time-estimate.md`:
```markdown
---
id: 2026-06-18-spiral-test-time-estimate
date: 2026-06-18
level: minor
title: Spiral Test — job time estimate
summary: The header now shows a ballpark total burn time (spiral cuts + label engrave), e.g. "16 cells · 86×84 mm · ~4:30", so you can gauge a sweep before exporting.
---
```

- [ ] **Step 4: Browser golden path**

Restart/refresh the dev server, open `http://127.0.0.1:8017/#/spiral-test`, and verify:
- The header reads e.g. `16 cells · 86×84 mm · ~M:SS` with a sane non-zero time.
- Raising fixed **Passes** (e.g. 250 → 500) roughly doubles the time; raising **Speed** lowers it.
- Toggling **Axis labels** off drops the (small) engrave contribution; the time stays sensible.
- A bigger grid (more steps) increases the time. Screenshot and read it critically.

- [ ] **Step 5: Commit**

```bash
git add web/src/pages/SpiralTestPage.tsx changelog/2026-06-18-spiral-test-time-estimate.md
git commit -m "feat(spiral-test): show ballpark job-time estimate in the header"
```

---

## Execution notes

- Branch: `feat/spiral-test-time-estimate` (off `main`, incl. #160 + #161). Push + draft PR when done; ready when CI is green.
- Pure-function estimator + two generic cuttime helpers; no new deps, no backend changes.
- The estimate is a ballpark (Forge's vector-cut approximation + the calibrated raster engrave); it ignores focus-descent Z-moves and inter-cell travel — the `~` prefix signals that.
- Do NOT touch the other Spiral feature (`SpiralPage`/`SpiralControls`/`SpiralCanvas`/`spiral.ts`/`presets.ts`) or Forge's `estimate.ts` (its local `spiralSeconds` stays as-is).
```
