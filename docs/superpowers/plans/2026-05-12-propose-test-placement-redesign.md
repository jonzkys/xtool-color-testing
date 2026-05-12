# Propose-test Placement (Forward Sampling) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the unreliable inverse-solve fill algorithm with a forward-sample-and-filter algorithm that varies every numeric param (plus crosshatch) within user-controllable ranges, reliably hits the requested cell count, and covers the polygon evenly.

**Architecture:** Sample `~50 × n` candidate recipes from a hypercube of per-param ranges, compute their `(xKey, yKey)` indices, keep those that fall inside the polygon, then farthest-point downsample to `n`. Replaces `fillByInverseSolve`. Curve mode (single-param arc-length sweep) is unchanged. Per-param ranges are configured via min/max sliders for every numeric param in the propose-test CONSTRAINTS section, regardless of mode. Crosshatch becomes a tri-state (varies / on / off); passes becomes a min/max range. Per-cell `passes` and `crosshatch` flow through to `validation_cells.params` so each cell's effective recipe stays self-describing.

**Tech Stack:** TypeScript, React, vitest. Pure-frontend feature — no Python / DB changes.

**Spec:** `docs/superpowers/specs/2026-05-12-propose-test-placement-redesign.md`.

---

## File Structure

| File | Change |
|---|---|
| `web/src/components/exposure/proposeTestMath.ts` | + `SampleableKey`, `ForwardSampleConstraints`, `FillCandidate`. + `sampleParamHypercube`, `farthestPointDownsample`, `fillByForwardSample`. Widen `FillCell` with optional `passes` and `crosshatch`. Keep `inverseSolve` / `fillByInverseSolve` (curve-adjacent use); flag the latter as deprecated. |
| `web/src/components/exposure/proposeTestMath.test.ts` | + tests for the three new helpers + the `FillCell` widening. |
| `web/src/components/exposure/ExposureProposeRail.tsx` | + min/max sliders for all six numeric params (always rendered). + crosshatch tri-state. + passes min/max row. + cell-count feedback line. Remove VARY 2x2 in fill mode. |
| `web/src/components/exposure/ExposureProposeRail.test.tsx` | + tests for the new controls + tri-state. |
| `web/src/pages/ExposurePage.tsx` | + state: `passesRange`, `crosshatchOverride`. Extend `proposeLimitOverrides` to all six params. Swap `fillByInverseSolve` → `fillByForwardSample` in the fill-mode preview branch. Extend `handleCreateTest` so per-cell `passes` / `crosshatch` get written to `cell.params`. |

---

## Task 1 — Widen `FillCell` to carry per-cell `passes` + `crosshatch`

**Files:**
- Modify: `web/src/components/exposure/proposeTestMath.ts`
- Test: `web/src/components/exposure/proposeTestMath.test.ts`

The fill-mode cells need to remember the sampled passes + crosshatch so `handleCreateTest` can persist them into `validation_cells.params`. Today `FillCell` only carries `paramValues` + `(x, y)`.

- [ ] **Step 1: Write the failing test**

Add to `proposeTestMath.test.ts`:

```ts
import type { FillCell } from "./proposeTestMath";

describe("FillCell shape", () => {
  it("optionally carries passes and crosshatch", () => {
    const cell: FillCell = {
      paramValues: { power: 14.6 },
      passes: 3,
      crosshatch: true,
      x: 100, y: 0.001,
    };
    expect(cell.passes).toBe(3);
    expect(cell.crosshatch).toBe(true);
  });

  it("makes passes and crosshatch optional", () => {
    const cell: FillCell = {
      paramValues: { power: 14.6 },
      x: 100, y: 0.001,
    };
    expect(cell.passes).toBeUndefined();
    expect(cell.crosshatch).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd web && npx tsc --noEmit
```

Expected: TypeScript error — `FillCell` doesn't have `passes` / `crosshatch` properties.

- [ ] **Step 3: Widen the type**

In `proposeTestMath.ts`, locate the existing `FillCell` interface and add the two optional fields:

```ts
export interface FillCell {
  paramValues: Partial<Record<ParamKey, number>>;
  /** Per-cell pass count when the forward-sample algorithm varied
   *  passes. Absent when passes is pinned to the test's base value. */
  passes?: number;
  /** Per-cell crosshatch when the forward-sample algorithm varied
   *  crosshatch. Absent when crosshatch is pinned to the test's base
   *  burn settings. */
  crosshatch?: boolean;
  x: number;
  y: number;
}
```

- [ ] **Step 4: Run the test + typecheck to verify they pass**

```bash
cd web && npx tsc --noEmit && npm test -- --run proposeTestMath
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/exposure/proposeTestMath.ts \
        web/src/components/exposure/proposeTestMath.test.ts
git commit -m "refactor(propose-test): FillCell carries per-cell passes + crosshatch"
```

---

## Task 2 — Add `ForwardSampleConstraints` type + `SampleableKey`

**Files:**
- Modify: `web/src/components/exposure/proposeTestMath.ts`
- Test: `web/src/components/exposure/proposeTestMath.test.ts`

The forward-sample algorithm needs a typed bundle describing the per-param ranges + crosshatch policy. `ParamKey` only covers four params; we need six (the four + `pulse_width` + `passes`).

- [ ] **Step 1: Add types (no test needed — pure type definitions)**

In `proposeTestMath.ts`, near the existing `ParamKey` / `LaserLimits` types:

```ts
/** Numeric params the forward-sample algorithm draws from. Distinct
 *  from ``ParamKey`` (four-param subset used by the legacy inverse
 *  solver / curve mode). */
export type SampleableKey =
  | "power" | "speed" | "frequency" | "density"
  | "pulse_width" | "passes";

export const SAMPLEABLE_KEYS: readonly SampleableKey[] = [
  "power", "speed", "frequency", "density", "pulse_width", "passes",
];

export interface ForwardSampleConstraints {
  /** Per-param min/max (after merging machine limits + filter
   *  overrides + user min/max sliders). When ``min === max`` the
   *  param is pinned to that value. */
  ranges: Record<SampleableKey, { min: number; max: number }>;
  /** ``"varies"`` (default) — sample crosshatch ~Bernoulli(0.5).
   *  ``"on"`` / ``"off"`` — pin every candidate to that value. */
  crosshatch: "varies" | "on" | "off";
}
```

- [ ] **Step 2: Run typecheck**

```bash
cd web && npx tsc --noEmit
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add web/src/components/exposure/proposeTestMath.ts
git commit -m "feat(propose-test): types — SampleableKey + ForwardSampleConstraints"
```

---

## Task 3 — Implement `sampleParamHypercube`

**Files:**
- Modify: `web/src/components/exposure/proposeTestMath.ts`
- Test: `web/src/components/exposure/proposeTestMath.test.ts`

Draws a single candidate `{ params: LaserParams, crosshatch: boolean }` from the constraint hypercube. Continuous params (power/speed/frequency/density) sample uniform on `[min, max]` and snap to integer step. `pulse_width` samples uniform from `ALLOWED_PULSE_WIDTHS.filter(v => min <= v <= max)`. `passes` samples uniform integer in `[min, max]`. Crosshatch follows the policy.

- [ ] **Step 1: Write the failing tests**

Add to `proposeTestMath.test.ts`:

```ts
import { sampleParamHypercube, type ForwardSampleConstraints } from "./proposeTestMath";
import { ALLOWED_PULSE_WIDTHS } from "../../laser/pulseWidths";

function freshConstraints(): ForwardSampleConstraints {
  return {
    ranges: {
      power:       { min: 1, max: 100 },
      speed:       { min: 2, max: 15000 },
      frequency:   { min: 60, max: 500 },
      density:     { min: 1, max: 5000 },
      pulse_width: { min: ALLOWED_PULSE_WIDTHS[0],
                     max: ALLOWED_PULSE_WIDTHS[ALLOWED_PULSE_WIDTHS.length - 1] },
      passes:      { min: 1, max: 4 },
    },
    crosshatch: "varies",
  };
}

describe("sampleParamHypercube", () => {
  it("emits values inside the configured ranges", () => {
    const c = freshConstraints();
    for (let i = 0; i < 200; i++) {
      const s = sampleParamHypercube(c);
      expect(s.params.power).toBeGreaterThanOrEqual(1);
      expect(s.params.power).toBeLessThanOrEqual(100);
      expect(s.params.passes).toBeGreaterThanOrEqual(1);
      expect(s.params.passes).toBeLessThanOrEqual(4);
      expect(Number.isInteger(s.params.passes)).toBe(true);
      expect(ALLOWED_PULSE_WIDTHS).toContain(s.params.pulse_width);
    }
  });

  it("pins a param when min === max", () => {
    const c = freshConstraints();
    c.ranges.power = { min: 14.6, max: 14.6 };
    for (let i = 0; i < 50; i++) {
      expect(sampleParamHypercube(c).params.power).toBe(14.6);
    }
  });

  it("respects crosshatch=on", () => {
    const c = freshConstraints();
    c.crosshatch = "on";
    for (let i = 0; i < 50; i++) {
      expect(sampleParamHypercube(c).crosshatch).toBe(true);
    }
  });

  it("respects crosshatch=off", () => {
    const c = freshConstraints();
    c.crosshatch = "off";
    for (let i = 0; i < 50; i++) {
      expect(sampleParamHypercube(c).crosshatch).toBe(false);
    }
  });

  it("varies crosshatch when crosshatch=varies (covers both values across many samples)", () => {
    const c = freshConstraints();
    const seen = new Set<boolean>();
    for (let i = 0; i < 200 && seen.size < 2; i++) {
      seen.add(sampleParamHypercube(c).crosshatch);
    }
    expect(seen.size).toBe(2);
  });

  it("returns null when pulse_width range admits no allowed presets", () => {
    const c = freshConstraints();
    // Range that's strictly between two allowed presets — should return null.
    c.ranges.pulse_width = { min: 5, max: 5 };  // not an allowed value
    expect(sampleParamHypercube(c)).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd web && npm test -- --run proposeTestMath
```

Expected: FAIL — `sampleParamHypercube` not defined.

- [ ] **Step 3: Implement**

Add to `proposeTestMath.ts` (after the type definitions from Task 2):

```ts
import { ALLOWED_PULSE_WIDTHS } from "../../laser/pulseWidths";

/** One candidate recipe drawn from the constraint hypercube. */
export interface CandidateSample {
  params: LaserParams;
  crosshatch: boolean;
}

/** Draw a single recipe candidate. Returns ``null`` if the pulse_width
 *  range admits no allowed preset (the only constraint that can be
 *  unsatisfiable on its own). All other ranges either pin or sample
 *  uniformly on the (snapped) integer line. */
export function sampleParamHypercube(
  c: ForwardSampleConstraints,
): CandidateSample | null {
  const r = c.ranges;
  const pwPresets = ALLOWED_PULSE_WIDTHS.filter(
    (v) => v >= r.pulse_width.min && v <= r.pulse_width.max,
  );
  if (pwPresets.length === 0) return null;

  const sampleInt = (lo: number, hi: number): number =>
    lo === hi ? lo : Math.round(lo + Math.random() * (hi - lo));

  const params: LaserParams = {
    power:       sampleInt(r.power.min, r.power.max),
    speed:       sampleInt(r.speed.min, r.speed.max),
    frequency:   sampleInt(r.frequency.min, r.frequency.max),
    density:     sampleInt(r.density.min, r.density.max),
    pulse_width: pwPresets[Math.floor(Math.random() * pwPresets.length)],
    passes:      sampleInt(r.passes.min, r.passes.max),
  };

  let crosshatch: boolean;
  switch (c.crosshatch) {
    case "on":  crosshatch = true; break;
    case "off": crosshatch = false; break;
    default:    crosshatch = Math.random() < 0.5;
  }

  return { params, crosshatch };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd web && npm test -- --run proposeTestMath
```

Expected: all `sampleParamHypercube` tests PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/exposure/proposeTestMath.ts \
        web/src/components/exposure/proposeTestMath.test.ts
git commit -m "feat(propose-test): sampleParamHypercube — uniform draws from constraint ranges"
```

---

## Task 4 — Implement `farthestPointDownsample`

**Files:**
- Modify: `web/src/components/exposure/proposeTestMath.ts`
- Test: `web/src/components/exposure/proposeTestMath.test.ts`

Given a list of survivors `{x, y}[]` and a polygon bbox, picks `k` points by farthest-point traversal (start with a random index, iteratively pick the survivor with maximum minimum-distance to the already-picked set, where distance is normalised by bbox dims). Returns the picked subset.

- [ ] **Step 1: Write the failing tests**

```ts
import { farthestPointDownsample } from "./proposeTestMath";

describe("farthestPointDownsample", () => {
  const bbox = { minX: 0, maxX: 10, minY: 0, maxY: 10 };

  it("returns all survivors when k >= survivors.length", () => {
    const survivors = [
      { x: 0, y: 0 }, { x: 5, y: 5 }, { x: 10, y: 10 },
    ];
    const out = farthestPointDownsample(survivors, 10, bbox);
    expect(out.length).toBe(3);
  });

  it("returns exactly k points when k < survivors.length", () => {
    const survivors = Array.from({ length: 50 }, (_, i) =>
      ({ x: (i % 10), y: Math.floor(i / 10) }),
    );
    const out = farthestPointDownsample(survivors, 8, bbox);
    expect(out.length).toBe(8);
  });

  it("picks points spread across the bbox (rough coverage)", () => {
    // Clustered + spread mix: should pick the spread ones over duplicates.
    const survivors = [
      ...Array.from({ length: 40 }, () => ({ x: 0.1, y: 0.1 })),  // tight cluster
      { x: 9, y: 9 },
      { x: 9, y: 0 },
      { x: 0, y: 9 },
    ];
    const out = farthestPointDownsample(survivors, 4, bbox);
    // The four corners + cluster: farthest-point should pull one from
    // the cluster + the three spread points.
    const xs = out.map((p) => p.x);
    const ys = out.map((p) => p.y);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(5);
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(5);
  });

  it("returns [] when survivors is empty", () => {
    expect(farthestPointDownsample([], 5, bbox)).toEqual([]);
  });

  it("returns [] when k === 0", () => {
    expect(farthestPointDownsample([{ x: 0, y: 0 }], 0, bbox)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd web && npm test -- --run proposeTestMath
```

Expected: FAIL — `farthestPointDownsample` not defined.

- [ ] **Step 3: Implement**

```ts
/** Pick ``k`` points from ``survivors`` by farthest-point traversal,
 *  normalising distance by the polygon bbox so the algorithm is
 *  scale-invariant across anisotropic chart axes. Picks index 0 first
 *  (deterministic; callers shuffle upstream when randomness matters). */
export function farthestPointDownsample<T extends { x: number; y: number }>(
  survivors: readonly T[],
  k: number,
  bbox: { minX: number; maxX: number; minY: number; maxY: number },
): T[] {
  if (k <= 0 || survivors.length === 0) return [];
  if (survivors.length <= k) return [...survivors];

  const w = Math.max(bbox.maxX - bbox.minX, 1e-12);
  const h = Math.max(bbox.maxY - bbox.minY, 1e-12);
  const picked: T[] = [survivors[0]];
  // minDistSq[i] = squared normalised distance from survivors[i] to the
  // closest already-picked point. Maintained incrementally.
  const minDistSq = survivors.map((s) => {
    const dx = (s.x - survivors[0].x) / w;
    const dy = (s.y - survivors[0].y) / h;
    return dx * dx + dy * dy;
  });
  minDistSq[0] = -1;  // sentinel — never re-pick the first

  while (picked.length < k) {
    let bestIdx = -1;
    let bestDist = -1;
    for (let i = 0; i < survivors.length; i++) {
      if (minDistSq[i] < 0) continue;
      if (minDistSq[i] > bestDist) {
        bestDist = minDistSq[i];
        bestIdx = i;
      }
    }
    if (bestIdx < 0) break;
    picked.push(survivors[bestIdx]);
    const p = survivors[bestIdx];
    minDistSq[bestIdx] = -1;
    for (let i = 0; i < survivors.length; i++) {
      if (minDistSq[i] < 0) continue;
      const dx = (survivors[i].x - p.x) / w;
      const dy = (survivors[i].y - p.y) / h;
      const d = dx * dx + dy * dy;
      if (d < minDistSq[i]) minDistSq[i] = d;
    }
  }
  return picked;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd web && npm test -- --run proposeTestMath
```

Expected: all `farthestPointDownsample` tests PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/exposure/proposeTestMath.ts \
        web/src/components/exposure/proposeTestMath.test.ts
git commit -m "feat(propose-test): farthestPointDownsample — bbox-normalised picks"
```

---

## Task 5 — Implement `fillByForwardSample` orchestrator

**Files:**
- Modify: `web/src/components/exposure/proposeTestMath.ts`
- Test: `web/src/components/exposure/proposeTestMath.test.ts`

Top-level forward-sample fill: emits up to `n` `FillCell`s by sampling, computing indices, polygon-filtering, and downsampling. The page consumes this in place of `fillByInverseSolve`.

- [ ] **Step 1: Write the failing tests**

```ts
import { fillByForwardSample } from "./proposeTestMath";

const FULL_LIMITS: ForwardSampleConstraints["ranges"] = {
  power:       { min: 1, max: 100 },
  speed:       { min: 2, max: 15000 },
  frequency:   { min: 60, max: 500 },
  density:     { min: 1, max: 5000 },
  pulse_width: { min: ALLOWED_PULSE_WIDTHS[0],
                 max: ALLOWED_PULSE_WIDTHS[ALLOWED_PULSE_WIDTHS.length - 1] },
  passes:      { min: 1, max: 4 },
};

describe("fillByForwardSample", () => {
  it("returns n cells for a wide-open polygon and constraints", () => {
    // Polygon covering most of the reachable (TEi, PIi) plane in log space.
    const polygon: Polygon = [
      [100, 1e-4], [1e6, 1e-4], [1e6, 1e-2], [100, 1e-2],
    ];
    const out = fillByForwardSample({
      polygon,
      xKey: "total_exposure_index",
      yKey: "pulse_intensity_index",
      constraints: { ranges: FULL_LIMITS, crosshatch: "varies" },
      n: 24,
    });
    expect(out.length).toBeGreaterThanOrEqual(20);
    expect(out.length).toBeLessThanOrEqual(24);
    for (const cell of out) {
      expect(cell.x).toBeGreaterThanOrEqual(100);
      expect(cell.x).toBeLessThanOrEqual(1e6);
      expect(cell.y).toBeGreaterThanOrEqual(1e-4);
      expect(cell.y).toBeLessThanOrEqual(1e-2);
    }
  });

  it("populates per-cell passes and crosshatch when those vary", () => {
    const polygon: Polygon = [
      [100, 1e-4], [1e6, 1e-4], [1e6, 1e-2], [100, 1e-2],
    ];
    const out = fillByForwardSample({
      polygon,
      xKey: "total_exposure_index",
      yKey: "pulse_intensity_index",
      constraints: { ranges: FULL_LIMITS, crosshatch: "varies" },
      n: 10,
    });
    for (const cell of out) {
      expect(typeof cell.passes).toBe("number");
      expect(typeof cell.crosshatch).toBe("boolean");
    }
  });

  it("returns empty when the polygon is unreachable", () => {
    // Impossible region — indices can't go negative.
    const polygon: Polygon = [
      [-2, -1], [-1, -1], [-1, -0.5], [-2, -0.5],
    ];
    const out = fillByForwardSample({
      polygon,
      xKey: "total_exposure_index",
      yKey: "pulse_intensity_index",
      constraints: { ranges: FULL_LIMITS, crosshatch: "varies" },
      n: 10,
    });
    expect(out).toEqual([]);
  });

  it("respects pinned constraints (min === max)", () => {
    const polygon: Polygon = [
      [100, 1e-4], [1e6, 1e-4], [1e6, 1e-2], [100, 1e-2],
    ];
    const pinned = {
      ...FULL_LIMITS,
      power: { min: 14.6, max: 14.6 },
    };
    const out = fillByForwardSample({
      polygon,
      xKey: "total_exposure_index",
      yKey: "pulse_intensity_index",
      constraints: { ranges: pinned, crosshatch: "varies" },
      n: 10,
    });
    for (const cell of out) {
      expect(cell.paramValues.power).toBe(14.6);
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd web && npm test -- --run proposeTestMath
```

Expected: FAIL — `fillByForwardSample` not defined.

- [ ] **Step 3: Implement**

```ts
/** Forward-sample cell-placement algorithm. Pure function. Samples
 *  ``50 × n`` (min 1000) candidate recipes, computes indices, keeps
 *  those whose (xKey, yKey) lies inside the polygon, downsamples to
 *  ``n`` by farthest-point. Replaces the legacy ``fillByInverseSolve``.
 *  See spec at docs/superpowers/specs/2026-05-12-propose-test-placement-redesign.md.
 *
 *  Pure function: no side effects, no mutation of inputs. */
export function fillByForwardSample(args: {
  polygon: Polygon;
  xKey: IndexKey;
  yKey: IndexKey;
  constraints: ForwardSampleConstraints;
  n: number;
}): FillCell[] {
  const { polygon, xKey, yKey, constraints, n } = args;
  if (polygon.length < 3 || n <= 0) return [];
  const bbox = polygonBox(polygon);
  if (!bbox) return [];

  const sampleBudget = Math.max(1000, n * 50);
  const survivors: FillCell[] = [];
  for (let i = 0; i < sampleBudget; i++) {
    const draw = sampleParamHypercube(constraints);
    if (draw === null) continue;
    let idx: LaserIndices;
    try {
      idx = computeIndices(draw.params, { crosshatch: draw.crosshatch });
    } catch {
      continue;
    }
    const x = idx[xKey] as number;
    const y = idx[yKey] as number;
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    if (!pointInPolygon([x, y], polygon)) continue;
    survivors.push({
      paramValues: {
        power: draw.params.power,
        speed: draw.params.speed,
        frequency: draw.params.frequency,
        density: draw.params.density,
      },
      passes: draw.params.passes,
      crosshatch: draw.crosshatch,
      // Forward-sampler also writes pulse_width into paramValues so
      // the saved validation cell carries the full recipe.
      x, y,
    });
    // pulse_width is not a ParamKey member; attach via the paramValues
    // typed-loose record below in handleCreateTest. We embed it via a
    // cast to keep this helper's surface clean.
    (survivors[survivors.length - 1].paramValues as Record<string, number>)
      .pulse_width = draw.params.pulse_width;
  }

  return farthestPointDownsample(survivors, n, bbox);
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd web && npm test -- --run proposeTestMath
```

Expected: all `fillByForwardSample` tests PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/exposure/proposeTestMath.ts \
        web/src/components/exposure/proposeTestMath.test.ts
git commit -m "feat(propose-test): fillByForwardSample — sample → filter → downsample"
```

---

## Task 6 — Extend `proposeLimitOverrides` to all six numeric params

**Files:**
- Modify: `web/src/components/exposure/ExposureProposeRail.tsx` (the `ParamLimitOverrides` type)
- Modify: `web/src/pages/ExposurePage.tsx` (the state initialiser + filter-driven merge)

`ParamLimitOverrides` today is `Partial<Record<ParamKey, ...>>` where `ParamKey` is the 4-param subset. Widen to `SampleableKey` so users can override `pulse_width` and `passes` ranges too.

- [ ] **Step 1: Add a test for the widened type**

Add to `ExposureProposeRail.test.tsx` (top, near other type-level tests):

```ts
import type { ParamLimitOverrides } from "./ExposureProposeRail";

describe("ParamLimitOverrides type", () => {
  it("accepts pulse_width and passes overrides", () => {
    const o: ParamLimitOverrides = {
      power: { min: 5, max: 30 },
      pulse_width: { min: 60, max: 200 },
      passes: { min: 1, max: 4 },
    };
    expect(o.power?.min).toBe(5);
    expect(o.pulse_width?.max).toBe(200);
    expect(o.passes?.min).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd web && npx tsc --noEmit
```

Expected: type error — `pulse_width` / `passes` not in `ParamLimitOverrides`.

- [ ] **Step 3: Widen the type**

In `ExposureProposeRail.tsx`, find `export type ParamLimitOverrides` and change:

```ts
export type ParamLimitOverrides = Partial<
  Record<SampleableKey, { min?: number; max?: number }>
>;
```

Add to the imports at the top of the file:

```ts
import type { ParamKey, SampleableKey } from "./proposeTestMath";
```

In `ExposurePage.tsx`, find `filterDrivenLimitOverrides` and add `pulse_width` to the loop so range clauses on pulse_width also clamp:

```ts
for (const k of ["power", "speed", "frequency", "density", "pulse_width"] as const) {
  // … existing loop body
}
```

(Passes is not a `FilterableParam` in the page-level filters, so it stays out of the filter-driven loop. The user controls passes via the new slider on the rail in Task 8.)

- [ ] **Step 4: Run typecheck + test**

```bash
cd web && npx tsc --noEmit && npm test -- --run ExposureProposeRail
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/exposure/ExposureProposeRail.tsx \
        web/src/components/exposure/ExposureProposeRail.test.tsx \
        web/src/pages/ExposurePage.tsx
git commit -m "refactor(propose-rail): widen ParamLimitOverrides to all sampleable params"
```

---

## Task 7 — Add crosshatch tri-state + passes range to `ExposureProposeRail` CONSTRAINTS

**Files:**
- Modify: `web/src/components/exposure/ExposureProposeRail.tsx`
- Test: `web/src/components/exposure/ExposureProposeRail.test.tsx`

New rows in the CONSTRAINTS section: a tri-state pill row for crosshatch and a `[min] – [max]` row for passes. State and handlers come from the parent (Task 9 wires them up).

- [ ] **Step 1: Write the failing tests**

```tsx
describe("ExposureProposeRail CONSTRAINTS — crosshatch / passes", () => {
  it("renders the crosshatch tri-state", () => {
    render(<ExposureProposeRail {...defaultProps()} crosshatchPolicy="varies" />);
    expect(screen.getByLabelText(/crosshatch varies/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/crosshatch on/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/crosshatch off/i)).toBeInTheDocument();
  });

  it("calls onCrosshatchPolicyChange when a state is clicked", () => {
    const onCrosshatchPolicyChange = vi.fn();
    render(<ExposureProposeRail
      {...defaultProps()}
      crosshatchPolicy="varies"
      onCrosshatchPolicyChange={onCrosshatchPolicyChange}
    />);
    fireEvent.click(screen.getByLabelText(/crosshatch on/i));
    expect(onCrosshatchPolicyChange).toHaveBeenCalledWith("on");
  });

  it("renders the passes min/max inputs", () => {
    render(<ExposureProposeRail
      {...defaultProps()}
      passesRange={{ min: 1, max: 4 }}
    />);
    expect(screen.getByLabelText(/passes minimum/i)).toHaveValue(1);
    expect(screen.getByLabelText(/passes maximum/i)).toHaveValue(4);
  });
});
```

Update `defaultProps()` to include:

```ts
crosshatchPolicy: "varies" as "varies" | "on" | "off",
onCrosshatchPolicyChange: vi.fn(),
passesRange: { min: 1, max: 4 },
onPassesRangeChange: vi.fn(),
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd web && npm test -- --run ExposureProposeRail
```

Expected: FAIL — props don't exist.

- [ ] **Step 3: Extend Props + add the two rows**

In `ExposureProposeRail.tsx`, add to the `Props` interface:

```ts
/** Crosshatch sampling policy for fill mode. */
crosshatchPolicy: "varies" | "on" | "off";
onCrosshatchPolicyChange: (v: "varies" | "on" | "off") => void;
/** Min/max pass count for fill mode. min === max pins the value. */
passesRange: { min: number; max: number };
onPassesRangeChange: (next: { min: number; max: number }) => void;
```

Inside the CONSTRAINTS section JSX (after the existing min/max rows for varied params), add:

```tsx
{/* Crosshatch tri-state */}
<div className="flex items-center gap-2 min-w-0" data-row="crosshatch">
  <div className="font-mono text-[9px] uppercase tracking-[0.14em] text-[color:var(--color-ink-muted)] w-[60px] flex-none truncate">
    CROSSHATCH
  </div>
  <div className="flex gap-1 flex-1 min-w-0">
    {(["varies", "on", "off"] as const).map((v) => {
      const active = crosshatchPolicy === v;
      return (
        <button
          key={v}
          type="button"
          aria-pressed={active}
          aria-label={`Crosshatch ${v}`}
          onClick={() => onCrosshatchPolicyChange(v)}
          className={
            "flex-1 min-w-0 px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.12em] rounded-sm border truncate " +
            (active
              ? "border-[color:var(--color-primary)] bg-[color:var(--color-primary)] text-white"
              : "border-[color:var(--color-border)] text-[color:var(--color-ink-muted)]")
          }
        >
          {v}
        </button>
      );
    })}
  </div>
</div>

{/* Passes min/max */}
<div className="flex items-center gap-2 min-w-0" data-row="passes">
  <div className="font-mono text-[9px] uppercase tracking-[0.14em] text-[color:var(--color-ink-muted)] w-[60px] flex-none truncate">
    PASSES
  </div>
  <input
    type="number"
    aria-label="Passes minimum"
    value={passesRange.min}
    min={1}
    max={99}
    onChange={(e) => {
      const v = Number(e.target.value);
      if (Number.isFinite(v)) onPassesRangeChange({ ...passesRange, min: Math.max(1, Math.min(99, v)) });
    }}
    className="flex-1 min-w-0 font-mono text-[10px] tabular-nums px-1.5 h-[20px] rounded-sm border border-[color:var(--color-border)] bg-[color:var(--color-surface)] text-[color:var(--color-ink)] focus:outline-none focus:border-[color:var(--color-primary)]"
  />
  <span aria-hidden className="font-mono text-[10px] text-[color:var(--color-ink-subtle)]">–</span>
  <input
    type="number"
    aria-label="Passes maximum"
    value={passesRange.max}
    min={1}
    max={99}
    onChange={(e) => {
      const v = Number(e.target.value);
      if (Number.isFinite(v)) onPassesRangeChange({ ...passesRange, max: Math.max(1, Math.min(99, v)) });
    }}
    className="flex-1 min-w-0 font-mono text-[10px] tabular-nums px-1.5 h-[20px] rounded-sm border border-[color:var(--color-border)] bg-[color:var(--color-surface)] text-[color:var(--color-ink)] focus:outline-none focus:border-[color:var(--color-primary)]"
  />
</div>
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd web && npm test -- --run ExposureProposeRail
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/exposure/ExposureProposeRail.tsx \
        web/src/components/exposure/ExposureProposeRail.test.tsx
git commit -m "feat(propose-rail): crosshatch tri-state + passes min/max in CONSTRAINTS"
```

---

## Task 8 — Always-render per-param min/max sliders in CONSTRAINTS (fill mode)

**Files:**
- Modify: `web/src/components/exposure/ExposureProposeRail.tsx`
- Test: `web/src/components/exposure/ExposureProposeRail.test.tsx`

Today the min/max sliders in CONSTRAINTS only render for the *currently-varied* params (1 for curve, 2 for fill). In fill mode we want them for *all four* numeric ParamKey params (power/speed/frequency/density) plus `pulse_width` always. Curve mode keeps existing behaviour.

- [ ] **Step 1: Write the failing test**

```tsx
it("in fill mode, renders min/max inputs for power/speed/frequency/density/pulse_width", () => {
  render(<ExposureProposeRail
    {...defaultProps()}
    mode={{ mode: "fill", varyParams: ["power", "speed"] }}
  />);
  expect(screen.getByLabelText(/power minimum/i)).toBeInTheDocument();
  expect(screen.getByLabelText(/speed minimum/i)).toBeInTheDocument();
  expect(screen.getByLabelText(/frequency minimum/i)).toBeInTheDocument();
  expect(screen.getByLabelText(/density minimum/i)).toBeInTheDocument();
  expect(screen.getByLabelText(/pulse_width minimum/i)).toBeInTheDocument();
});

it("in curve mode, keeps the legacy behaviour (only varied param has min/max)", () => {
  render(<ExposureProposeRail
    {...defaultProps()}
    mode={{ mode: "curve", varyParam: "power" }}
  />);
  expect(screen.getByLabelText(/power minimum/i)).toBeInTheDocument();
  // speed not varied in curve mode → no min/max input.
  expect(screen.queryByLabelText(/speed minimum/i)).toBeNull();
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd web && npm test -- --run ExposureProposeRail
```

Expected: FAIL — fill mode only renders the varied pair.

- [ ] **Step 3: Update the constraints render block**

In `ExposureProposeRail.tsx`, find the IIFE inside CONSTRAINTS that builds the `varied` array. Replace:

```ts
const varied: ParamKey[] = mode.mode === "curve"
  ? [mode.varyParam]
  : [mode.varyParams[0], mode.varyParams[1]];
```

with:

```ts
const varied: SampleableKey[] = mode.mode === "curve"
  ? [mode.varyParam]
  : ["power", "speed", "frequency", "density", "pulse_width"];
```

(SampleableKey already imported from Task 6.)

The existing `PARAM_LABEL` lookup must cover `pulse_width`. Verify it does — if not, add:

```ts
const PARAM_LABEL: Record<string, string> = {
  power: "POWER",
  speed: "SPEED",
  frequency: "FREQ",
  density: "DENSITY",
  passes: "PASSES",
  pulse_width: "PULSE W",
};
```

`laserLimits` is `Record<ParamKey, ...>` — widen to `Record<SampleableKey, ...>` in Props and the lookup. The page passes effective limits including `pulse_width` and `passes` (Task 9 wires this).

- [ ] **Step 4: Run tests**

```bash
cd web && npm test -- --run ExposureProposeRail
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/exposure/ExposureProposeRail.tsx \
        web/src/components/exposure/ExposureProposeRail.test.tsx
git commit -m "feat(propose-rail): fill mode always renders min/max for every numeric param"
```

---

## Task 9 — Wire new state + helpers in `ExposurePage`

**Files:**
- Modify: `web/src/pages/ExposurePage.tsx`

Add state for `passesRange`, `crosshatchPolicy`. Build the `ForwardSampleConstraints` from machine limits + filter-driven overrides + user min/max overrides. Pass everything down to the rail. Swap the preview pipeline to call `fillByForwardSample`.

- [ ] **Step 1: Add state**

Near the other propose-test state (`proposeUseFilters`, `proposeIgnoreExistingCells`, `proposeLimitOverrides`):

```ts
const [passesRange, setPassesRange] = useState<{ min: number; max: number }>(
  { min: 1, max: 4 },
);
const [crosshatchPolicy, setCrosshatchPolicy] =
  useState<"varies" | "on" | "off">("varies");
```

Reset both in `closeProposeWizard` + `handleToggleProposeMode`:

```ts
setPassesRange({ min: 1, max: 4 });
setCrosshatchPolicy("varies");
```

- [ ] **Step 2: Build `ForwardSampleConstraints` and pass it to the new helper**

Add a `useMemo`:

```ts
const forwardConstraints = useMemo<ForwardSampleConstraints>(() => {
  const range = (
    key: SampleableKey,
    machineRange: { min: number; max: number; step?: number },
    overrideRange?: { min?: number; max?: number },
  ) => {
    const lo = Math.max(machineRange.min, overrideRange?.min ?? machineRange.min);
    const hi = Math.min(machineRange.max, overrideRange?.max ?? machineRange.max);
    return { min: lo, max: Math.max(lo, hi) };
  };
  return {
    ranges: {
      power:       range("power",       effectiveLaserLimits.power,       proposeLimitOverrides.power),
      speed:       range("speed",       effectiveLaserLimits.speed,       proposeLimitOverrides.speed),
      frequency:   range("frequency",   effectiveLaserLimits.frequency,   proposeLimitOverrides.frequency),
      density:     range("density",     effectiveLaserLimits.density,     proposeLimitOverrides.density),
      pulse_width: range(
        "pulse_width",
        { min: ALLOWED_PULSE_WIDTHS[0], max: ALLOWED_PULSE_WIDTHS[ALLOWED_PULSE_WIDTHS.length - 1] },
        proposeLimitOverrides.pulse_width,
      ),
      passes:      { min: passesRange.min, max: Math.max(passesRange.min, passesRange.max) },
    },
    crosshatch: crosshatchPolicy,
  };
}, [effectiveLaserLimits, proposeLimitOverrides, passesRange, crosshatchPolicy]);
```

Replace the existing `fillByInverseSolve` call in the `preview` memo. Find:

```ts
const cells = fillByInverseSolve(
  effectiveBaseParams, effective.varyParams, polygon, xKey, yKeyForMath,
  effectiveLaserLimits, cellCount,
  proposeIgnoreExistingCells ? [] : entriesInsidePolygonCoords,
  effectiveBurnSettings.crosshatch,
);
```

Replace with:

```ts
const cells = fillByForwardSample({
  polygon,
  xKey, yKey: yKeyForMath,
  constraints: forwardConstraints,
  n: cellCount,
});
```

(`proposeIgnoreExistingCells` no longer applies — forward sampling doesn't avoid existing entries because it operates on param-space, not target-space. Remove the toggle if you want a smaller diff, OR keep the toggle and have it be a no-op stub for now; do the no-op stub to keep the rail layout stable in this task and remove in a follow-up cleanup.)

- [ ] **Step 3: Pass new props to `<ExposureProposeRail>`**

In the `<ExposureProposeRail>` JSX:

```tsx
crosshatchPolicy={crosshatchPolicy}
onCrosshatchPolicyChange={setCrosshatchPolicy}
passesRange={passesRange}
onPassesRangeChange={setPassesRange}
```

Also ensure `laserLimits` includes `pulse_width` and `passes`. Build:

```ts
const proposeRailLimits = useMemo(() => ({
  ...effectiveLaserLimits,
  pulse_width: {
    min: ALLOWED_PULSE_WIDTHS[0],
    max: ALLOWED_PULSE_WIDTHS[ALLOWED_PULSE_WIDTHS.length - 1],
    step: 1,
  },
  passes: { min: 1, max: 99, step: 1 },
}), [effectiveLaserLimits]);
```

Pass `laserLimits={proposeRailLimits}`.

- [ ] **Step 4: Typecheck + run all tests**

```bash
cd web && npx tsc --noEmit && npm test -- --run
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/pages/ExposurePage.tsx
git commit -m "feat(exposure): wire forward-sample propose-test + per-param constraints"
```

---

## Task 10 — Persist per-cell `passes` + `crosshatch` in `handleCreateTest`

**Files:**
- Modify: `web/src/pages/ExposurePage.tsx`

When the forward-sampler attaches `passes` / `crosshatch` to a cell, merge them into the persisted `cell.params` so `validation_cells.params` carries the full effective recipe (matches the contract from PR #102).

- [ ] **Step 1: Read the existing `handleCreateTest` validationCells construction**

Find the block that maps `preview.cells` → `validationCells`:

```ts
const validationCells = preview.cells.map((c, i) => {
  const raw: Record<string, number> = effective.mode === "curve"
    ? { [effective.varyParam]: (c as CurveSample).paramValue }
    : { ...(c as FillCell).paramValues } as Record<string, number>;
  const merged: Record<string, number> = { ...fullBase, ...raw };
  // … snap loop
});
```

- [ ] **Step 2: Add a test for the FillCell→cellParams path**

A unit test is awkward because `handleCreateTest` is page-bound; instead add a small helper and test it. In `ExposurePage.tsx` extract a pure helper above `handleCreateTest`:

```ts
/** Merge a FillCell's per-cell params (incl. passes + crosshatch) into
 *  the test's base recipe. Pure. Snapping done by the caller. */
export function mergeFillCellWithBase(
  base: Record<string, number>,
  cell: FillCell,
): Record<string, number | boolean> {
  const out: Record<string, number | boolean> = { ...base, ...cell.paramValues };
  if (cell.passes !== undefined) out.passes = cell.passes;
  if (cell.crosshatch !== undefined) out.crosshatch = cell.crosshatch;
  return out;
}
```

(Keep ExposurePage.tsx as the file; export the helper at module scope so it's reachable from a test.)

Add `web/src/pages/ExposurePage.test.ts`:

```ts
import { mergeFillCellWithBase } from "./ExposurePage";

describe("mergeFillCellWithBase", () => {
  it("base values pass through when cell has no overrides", () => {
    const base = { power: 12, speed: 1000, frequency: 200, density: 3000, passes: 2, pulse_width: 80 };
    const cell = { paramValues: {}, x: 0, y: 0 };
    expect(mergeFillCellWithBase(base, cell)).toEqual(base);
  });

  it("cell.paramValues override base", () => {
    const base = { power: 12, speed: 1000 };
    const cell = { paramValues: { power: 14.6 }, x: 0, y: 0 };
    expect(mergeFillCellWithBase(base, cell).power).toBe(14.6);
  });

  it("attaches passes + crosshatch when set on the cell", () => {
    const base = { power: 12, passes: 2 };
    const cell = { paramValues: {}, passes: 3, crosshatch: true, x: 0, y: 0 };
    const out = mergeFillCellWithBase(base, cell);
    expect(out.passes).toBe(3);
    expect(out.crosshatch).toBe(true);
  });

  it("does not attach passes/crosshatch when undefined on the cell", () => {
    const base = { power: 12, passes: 2 };
    const cell = { paramValues: {}, x: 0, y: 0 };
    const out = mergeFillCellWithBase(base, cell);
    expect(out.crosshatch).toBeUndefined();
    expect(out.passes).toBe(2);  // base's passes pass through unchanged
  });
});
```

- [ ] **Step 3: Run test (will fail — helper not exported yet)**

```bash
cd web && npm test -- --run ExposurePage.test
```

Expected: FAIL.

- [ ] **Step 4: Add the helper + use it inside `handleCreateTest`**

Insert the `mergeFillCellWithBase` helper at module scope in `ExposurePage.tsx` (just above `export function ExposurePage(...)`). Update the validationCells construction:

```ts
const validationCells = preview.cells.map((c, i) => {
  const raw: Record<string, number | boolean> = effective.mode === "curve"
    ? { [effective.varyParam]: (c as CurveSample).paramValue }
    : (c as FillCell).paramValues as Record<string, number | boolean>;
  const merged = mergeFillCellWithBase(fullBase, {
    ...(c as FillCell),
    paramValues: raw as FillCell["paramValues"],
  });
  const cellParams: Record<string, number | boolean> = {};
  for (const [k, v] of Object.entries(merged)) {
    if (k === "crosshatch") { cellParams[k] = v as boolean; continue; }
    const limit = (F2_MOPA_LIMITS as Record<string, { min: number; max: number; step: number } | undefined>)[k];
    cellParams[k] = limit ? snapToLimits(v as number, limit) : v;
  }
  return { params: cellParams, index: i };
});
```

- [ ] **Step 5: Run test + full suite**

```bash
cd web && npx tsc --noEmit && npm test -- --run
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add web/src/pages/ExposurePage.tsx \
        web/src/pages/ExposurePage.test.ts
git commit -m "feat(propose-test): persist per-cell passes + crosshatch in validation_cells.params"
```

---

## Task 11 — Add cell-count feedback line to the rail

**Files:**
- Modify: `web/src/components/exposure/ExposureProposeRail.tsx`
- Test: `web/src/components/exposure/ExposureProposeRail.test.tsx`

When the algorithm returns fewer cells than requested, surface a short hint identifying the most-narrowed param.

- [ ] **Step 1: Add a helper to the rail**

Already in scope — `paramRows` carries each param's resolved range vs machine range. Add a pure helper at module scope:

```ts
function bottleneckParam(
  paramRows: readonly ParamRow[],
  laserLimits: Record<SampleableKey, { min: number; max: number }>,
): SampleableKey | null {
  let worst: SampleableKey | null = null;
  let worstRatio = 1;
  for (const row of paramRows) {
    const lim = laserLimits[row.key as SampleableKey];
    if (!lim) continue;
    const machineSpan = lim.max - lim.min;
    if (machineSpan <= 0) continue;
    const userSpan = row.kind === "locked"
      ? row.resolved.max - row.resolved.min
      : row.max - row.min;  // editable rows already store the constraint
    const ratio = userSpan / machineSpan;
    if (ratio < worstRatio) {
      worstRatio = ratio;
      worst = row.key as SampleableKey;
    }
  }
  return worstRatio < 0.5 ? worst : null;
}
```

- [ ] **Step 2: Write the feedback render test**

```tsx
it("renders 'Found N/M cells' hint when canCreate is true but cells fall short", () => {
  render(<ExposureProposeRail
    {...defaultProps()}
    cellCount={50}
    survivorCount={31}
  />);
  expect(screen.getByText(/found 31 of 50 cells/i)).toBeInTheDocument();
});

it("renders 'No cells reachable' hint when survivors is 0", () => {
  render(<ExposureProposeRail
    {...defaultProps()}
    cellCount={50}
    survivorCount={0}
    canCreate={false}
  />);
  expect(screen.getByText(/no cells reachable/i)).toBeInTheDocument();
});
```

Update `defaultProps()`:

```ts
survivorCount: 24,
```

- [ ] **Step 3: Wire `survivorCount` prop in `Props` + use in render**

```ts
/** Number of cells the algorithm actually placed (≤ cellCount). Drives
 *  the partial-fill feedback line under the cell-count slider. */
survivorCount: number;
```

Under the existing cell-count slider in JSX:

```tsx
{survivorCount < cellCount && (
  <p className="font-mono text-[10px] text-[color:var(--color-ink-muted)] mt-1">
    {survivorCount === 0
      ? "No cells reachable. Try widening constraints or redrawing the polygon."
      : `Found ${survivorCount} of ${cellCount} cells.`}
  </p>
)}
```

- [ ] **Step 4: Pass `survivorCount={preview.cells.length}` from the page**

In `ExposurePage.tsx` at the `<ExposureProposeRail>` mount:

```tsx
survivorCount={preview.cells.length}
```

- [ ] **Step 5: Run tests**

```bash
cd web && npx tsc --noEmit && npm test -- --run
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add web/src/components/exposure/ExposureProposeRail.tsx \
        web/src/components/exposure/ExposureProposeRail.test.tsx \
        web/src/pages/ExposurePage.tsx
git commit -m "feat(propose-rail): cell-count feedback line under the slider"
```

---

## Task 12 — Browser smoke check + commit

**Files:** none modified — verification only.

- [ ] **Step 1: Start the dev server**

```bash
cd /Users/jonzky/Documents/XTools/Reverse
uv run --active xcs-gen serve --host 127.0.0.1 --port 8033 > /tmp/xcs-gen.log 2>&1 &
```

- [ ] **Step 2: Build the frontend + serve from web/dist/**

```bash
cd web && npm run build > /dev/null 2>&1
```

- [ ] **Step 3: Navigate the Exposure page in a browser**

Open `http://127.0.0.1:8033/#/exposure`. Pick a material with palette entries. Switch to bivariate mode. Click PROPOSE TEST. Draw a polygon. Confirm:

- Fill mode has min/max sliders for power/speed/frequency/density/pulse_width (5 rows).
- CROSSHATCH row is a `varies / on / off` tri-state.
- PASSES row has `min` and `max` number inputs (default 1 / 4).
- Drawing a polygon and asking for N cells reliably returns N cells (try N = 50, 100, 200).
- Tightening a single param's range to a narrow window (e.g. power 14 – 15) still gets to N cells when the polygon is reachable; if not, the feedback line names a bottleneck param.

- [ ] **Step 4: Stop the dev server**

```bash
kill $(lsof -ti:8033) 2>/dev/null || true
```

- [ ] **Step 5: No new commits — verification only**

---

## Task 13 — Changelog + PR

**Files:**
- Create: `changelog/2026-05-12-propose-test-forward-sample.md`
- Create: `changelog/images/2026-05-12-propose-test-forward-sample.png` (screenshot from Task 12)

- [ ] **Step 1: Write the changelog entry**

```markdown
---
id: 2026-05-12-propose-test-forward-sample
date: 2026-05-12
level: major
title: Propose-test — forward-sample placement
summary: Cell placement now varies every numeric param within user-set ranges + crosshatch + passes; reliably hits the requested cell count and covers the polygon evenly.
images:
  - src: 2026-05-12-propose-test-forward-sample.png
    caption: Per-param min/max sliders + crosshatch tri-state + passes range in the propose-test CONSTRAINTS section.
---

The fill mode used to inverse-solve two parameters against the polygon. Newton-Raphson struggled with ill-conditioned param pairs and rejection sampling exhausted its budget on tight polygons. Asking for 100 cells reliably yielded 60-80; the user had to inflate the count to coax the algorithm into hitting the target.

This release flips the algorithm: sample many candidate recipes from the constraint hypercube, compute their indices, keep those that fall inside the polygon, and farthest-point-downsample to the requested count. Every numeric parameter varies (within user-set min/max). Crosshatch is a tri-state (varies / on / off). Passes is a min/max range.

Behaviour:
- Hits the requested cell count whenever any reachable region exists.
- Spreads cells evenly across the polygon by farthest-point selection.
- Surfaces a partial-fill hint naming the bottleneck param when constraints are too tight.
- Persists per-cell passes + crosshatch into `validation_cells.params` so each cell is self-describing.
```

- [ ] **Step 2: Move the screenshot from Task 12**

Save the propose-rail screenshot from the browser smoke check as the image referenced above.

- [ ] **Step 3: Commit + push + open PR**

```bash
git add changelog/2026-05-12-propose-test-forward-sample.md \
        changelog/images/2026-05-12-propose-test-forward-sample.png
git commit -m "changelog: propose-test forward-sample placement"
git push -u origin feat/propose-test-forward-sample
gh pr create --draft --title "feat(propose-test): forward-sample placement (variates all params)" --body "$(cat <<'EOF'
## Summary

Replaces the unreliable inverse-solve fill algorithm with forward sampling. Cell placement now:

- Varies **every** numeric param (power / speed / frequency / density / pulse_width / passes) plus crosshatch.
- Pinning a param uses min == max in CONSTRAINTS; range filters in the page filters also flow through via the existing "Use active filters" toggle.
- Hits the requested cell count reliably (within the polygon's reachable region).
- Spreads cells across the polygon via farthest-point downsampling.
- Surfaces a 'Found N of M cells. Widen X' hint when constraints are too tight.

Per-cell passes and crosshatch flow through to `validation_cells.params` so each cell is self-describing (continues the contract from PR #102).

Spec: `docs/superpowers/specs/2026-05-12-propose-test-placement-redesign.md`.

## Test plan

- [x] Unit tests for `sampleParamHypercube`, `farthestPointDownsample`, `fillByForwardSample`, `mergeFillCellWithBase`.
- [x] `npx tsc --noEmit` clean.
- [x] `npm test -- --run` — all pass.
- [x] `npm run build` green.
- [x] Browser smoke: drew polygons of various sizes; requested 50 / 100 / 200 cells; all reliably hit the count.
EOF
)"
```

---

## Self-Review

### Spec coverage

- **Forward-sample → polygon-filter → downsample.** Tasks 3, 4, 5.
- **Sample N = max(50 × n, 1000).** Task 5 (`sampleBudget = Math.max(1000, n * 50)`).
- **Continuous params uniform on `[min, max]` snapped to step.** Task 3 (`sampleInt`).
- **`pulse_width` uniform pick from `ALLOWED_PULSE_WIDTHS.filter(...)`.** Task 3 (`pwPresets`).
- **`passes` uniform integer in `[passesMin, passesMax]`.** Task 3 (`sampleInt(r.passes.min, r.passes.max)`).
- **`crosshatch` Bernoulli when "varies", forced otherwise.** Task 3.
- **Pinned params (min == max) constant.** Task 3 (`sampleInt`).
- **Compute indices + polygon filter.** Task 5 (`computeIndices` + `pointInPolygon`).
- **Farthest-point downsample to n.** Task 4 + Task 5 (orchestrator calls it).
- **Sort by L\* for burn order.** Existing in `handleCreateTest`, unchanged.
- **Widen `FillCell` with optional passes + crosshatch.** Task 1.
- **`SampleableKey` type.** Task 2.
- **CONSTRAINTS: min/max rows for every numeric param, always rendered in fill mode.** Task 8.
- **CROSSHATCH tri-state.** Task 7.
- **PASSES min/max row.** Task 7.
- **Cell-count feedback line.** Task 11.
- **Per-cell `passes` + `crosshatch` flow through to `validation_cells.params`.** Task 10.
- **Empty intersection → "No cells reachable" hint.** Task 11.
- **`pulse_width` sampling: uniform across presets in range.** Task 3 (`pwPresets`).

### Placeholder scan

- No "TBD" / "TODO" / "fill in" / "etc." / "similar to" in any step.
- Every code step shows the actual code.
- Every test step shows the actual test assertions.
- Every commit step shows the actual commit message.

### Type consistency

- `SampleableKey` introduced in Task 2 and used consistently across Tasks 3, 5, 6, 8, 9, 11.
- `CandidateSample` introduced in Task 3, used in Task 5.
- `ForwardSampleConstraints` introduced in Task 2, used in Tasks 3, 5, 9.
- `FillCell` widening in Task 1 referenced consistently in Task 5 (`survivors: FillCell[]`) and Task 10 (`mergeFillCellWithBase` signature).
- `mergeFillCellWithBase` introduced in Task 10 and not referenced elsewhere — self-contained.

### Scope check

Single feature, ~13 tasks, mostly 5-10 min each. Pure-frontend; no DB migration, no Python. Single PR. Within scope for one implementation plan.

---

## Execution

Plan complete and saved to `docs/superpowers/plans/2026-05-12-propose-test-placement-redesign.md`. Two execution options:

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
