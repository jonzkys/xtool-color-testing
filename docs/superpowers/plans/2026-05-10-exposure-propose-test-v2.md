# Exposure Propose-Test v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refine the propose-test wizard with all-params editing in the rail, an inverse-solving fill algorithm that actually fills the polygon evenly, and a small toolbar/banner UX polish from the v1 walkthrough.

**Architecture:** New pure-function helpers in `proposeTestMath.ts` (`partialDerivative`, `inverseSolve`, `samplePolygonArea`, `fillByInverseSolve`) drive the live computation. The wizard rail gains a 6-row PARAMS editor that drives a `paramOverrides` state on the page, fed back into curve/fill computation. The toolbar chip and the draw-mode hint banner gain interactive text/click states. Frontend-only — no backend changes.

**Tech Stack:** React 18 + TypeScript + Tailwind v4 + vitest + @testing-library/react.

**Spec:** `docs/superpowers/specs/2026-05-10-exposure-propose-test-v2-design.md`

---

## File structure

### Modified files

| Path | Why |
|---|---|
| `web/src/components/exposure/proposeTestMath.ts` | Add `partialDerivative`, `inverseSolve`, `samplePolygonArea`, `fillByInverseSolve`. Keep `fillByForwardGrid` (deprecated). |
| `web/src/components/exposure/proposeTestMath.test.ts` | Add tests for the four new helpers. |
| `web/src/components/exposure/ExposureProposeRail.tsx` | New 6-row PARAMS editor. New `paramOverrides`, `onParamOverrideChange`, `entriesInsidePolygon`, `paramRows` props. Existing chip group + cells slider stay. |
| `web/src/components/exposure/ExposureProposeRail.test.tsx` | Add tests for the editor (slider drag fires callback; varied row aria-disabled; pulse_width snaps; entries count rendered). |
| `web/src/components/exposure/ExposureToolbar.tsx` | Toggle chip text `◇ PROPOSE TEST` ↔ `× CANCEL` based on `proposeOpen`. |
| `web/src/pages/ExposurePage.tsx` | New `paramOverrides` state, `entriesInsidePolygon` derivation, banner click handler, switch fill call to `fillByInverseSolve`. Pass `paramRows` to rail. |
| `changelog/2026-05-XX-exposure-propose-test-v2.md` | New minor changelog entry. |

### New files

None — everything fits in the existing module structure.

---

## Conventions for every task

- Run from project root (`/Users/jonzky/Documents/XTools/Reverse`); paths in this plan assume that.
- Frontend tests: `cd web && npm test -- --run` for the full suite, or `cd web && npm test -- --run <pattern>` for a filtered run.
- Type-check: `cd web && npx tsc --noEmit`.
- Build: `cd web && npm run build > /dev/null 2>&1 && echo build-ok`.
- The TS port of `compute_indices` lives at `web/src/laser/laserIndices.ts` — already imported by `proposeTestMath.ts`. Don't re-import it elsewhere; consume it via the helpers.
- `ALLOWED_PULSE_WIDTHS` is a Python-side constant; the TS-side equivalent is hardcoded in this plan as `[2, 4, 8, 30, 60, 80, 100, 200]` (matches `src/xcs_gen/pulse_width.py` at the time of writing — verify in the actual file before committing). One source of truth per task.
- Commit at the end of every task. Don't skip pre-commit hooks.

---

### Task 1: `partialDerivative` — Jacobian entries

**Why first:** `inverseSolve` (Task 2) needs the Jacobian. Stand-alone pure function; easy to test against finite differences.

**Files:**
- Modify: `web/src/components/exposure/proposeTestMath.ts`
- Modify: `web/src/components/exposure/proposeTestMath.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `web/src/components/exposure/proposeTestMath.test.ts`:

```ts
import { partialDerivative } from "./proposeTestMath";
import { computeIndices, type LaserParams } from "../../laser/laserIndices";

const SAMPLE_PARAMS: LaserParams[] = [
  { power: 14.6, speed: 1152, frequency: 100, density: 5000, passes: 1, pulse_width: 200 },
  { power: 50,   speed: 4000, frequency: 200, density: 3000, passes: 2, pulse_width: 100 },
  { power: 80,   speed: 8000, frequency: 400, density: 1500, passes: 4, pulse_width: 50  },
];

describe("partialDerivative", () => {
  it("matches finite-difference numerical derivative within 1e-3 for every (idx, param) pair", () => {
    const indexKeys = [
      "pulse_spacing_mm", "line_spacing_mm",
      "pulse_energy_index", "pulse_intensity_index",
      "total_exposure_index", "ablation_aggression_index",
      "delivery_smoothness_index",
    ] as const;
    const paramKeys = [
      "power", "speed", "frequency", "density", "passes", "pulse_width",
    ] as const;
    for (const params of SAMPLE_PARAMS) {
      for (const idxKey of indexKeys) {
        for (const paramKey of paramKeys) {
          const epsilon = Math.max(1, Math.abs(params[paramKey])) * 1e-5;
          const plus = computeIndices({ ...params, [paramKey]: params[paramKey] + epsilon });
          const minus = computeIndices({ ...params, [paramKey]: params[paramKey] - epsilon });
          const numerical = (plus[idxKey] - minus[idxKey]) / (2 * epsilon);
          const analytical = partialDerivative(idxKey, paramKey, params);
          // Tolerate larger rel-error for indices that produce huge values
          // (delivery_smoothness can reach ~1e5).
          const tolerance = Math.max(1e-3, Math.abs(numerical) * 1e-4);
          expect(Math.abs(analytical - numerical)).toBeLessThan(tolerance);
        }
      }
    }
  });

  it("returns 0 when the index doesn't depend on the param", () => {
    const params = SAMPLE_PARAMS[0];
    expect(partialDerivative("pulse_spacing_mm", "power", params)).toBe(0);
    expect(partialDerivative("pulse_spacing_mm", "density", params)).toBe(0);
    expect(partialDerivative("line_spacing_mm", "speed", params)).toBe(0);
    expect(partialDerivative("pulse_energy_index", "speed", params)).toBe(0);
    expect(partialDerivative("pulse_energy_index", "pulse_width", params)).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npm test -- --run proposeTestMath.test`
Expected: FAIL — `partialDerivative` is not exported.

- [ ] **Step 3: Implement the function**

Append to `web/src/components/exposure/proposeTestMath.ts`:

```ts
export function partialDerivative(
  indexKey: IndexKey,
  paramKey: ParamKey | "passes" | "pulse_width",
  params: LaserParams,
): number {
  const { power, speed, frequency, density, passes, pulse_width } = params;

  switch (indexKey) {
    case "pulse_spacing_mm": {
      // PSm = speed / (frequency * 1000)
      switch (paramKey) {
        case "speed":     return 1 / (frequency * 1000);
        case "frequency": return -speed / (frequency * frequency * 1000);
        default: return 0;
      }
    }
    case "line_spacing_mm": {
      // LSm = 10 / density
      switch (paramKey) {
        case "density": return -10 / (density * density);
        default: return 0;
      }
    }
    case "pulse_energy_index": {
      // PEi = power / frequency
      switch (paramKey) {
        case "power":     return 1 / frequency;
        case "frequency": return -power / (frequency * frequency);
        default: return 0;
      }
    }
    case "pulse_intensity_index": {
      // PIi = power / (frequency * pulse_width)
      switch (paramKey) {
        case "power":       return 1 / (frequency * pulse_width);
        case "frequency":   return -power / (frequency * frequency * pulse_width);
        case "pulse_width": return -power / (frequency * pulse_width * pulse_width);
        default: return 0;
      }
    }
    case "total_exposure_index": {
      // TEi = power * density * passes / speed
      switch (paramKey) {
        case "power":   return density * passes / speed;
        case "density": return power * passes / speed;
        case "passes":  return power * density / speed;
        case "speed":   return -power * density * passes / (speed * speed);
        default: return 0;
      }
    }
    case "ablation_aggression_index": {
      // AAi = TEi * PIi = power² * density * passes / (speed * frequency * pulse_width)
      const denom = speed * frequency * pulse_width;
      switch (paramKey) {
        case "power":       return 2 * power * density * passes / denom;
        case "density":     return power * power * passes / denom;
        case "passes":      return power * power * density / denom;
        case "speed":       return -power * power * density * passes / (speed * denom);
        case "frequency":   return -power * power * density * passes / (frequency * denom);
        case "pulse_width": return -power * power * density * passes / (pulse_width * denom);
        default: return 0;
      }
    }
    case "delivery_smoothness_index": {
      // DSi = TEi / PIi = density * passes * frequency * pulse_width / speed
      switch (paramKey) {
        case "density":     return passes * frequency * pulse_width / speed;
        case "passes":      return density * frequency * pulse_width / speed;
        case "frequency":   return density * passes * pulse_width / speed;
        case "pulse_width": return density * passes * frequency / speed;
        case "speed":       return -density * passes * frequency * pulse_width / (speed * speed);
        default: return 0;
      }
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npm test -- --run proposeTestMath.test`
Expected: PASS (all existing tests + 2 new ones).

- [ ] **Step 5: Type-check**

Run: `cd web && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add web/src/components/exposure/proposeTestMath.ts \
        web/src/components/exposure/proposeTestMath.test.ts
git commit -m "$(cat <<'EOF'
feat(propose-test v2): partialDerivative for laser index Jacobian

Pure 7×6 switch-table giving ∂I/∂p for every (index, param) pair from
the v3 formulas. Verified against finite-difference numerical
derivatives on a battery of param combos to within 1e-3. Foundation
for the Newton-based inverse solver that lands next.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: `inverseSolve` — Newton iteration for params from target indices

**Files:**
- Modify: `web/src/components/exposure/proposeTestMath.ts`
- Modify: `web/src/components/exposure/proposeTestMath.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `proposeTestMath.test.ts`:

```ts
import { inverseSolve, type Point2 as Pt } from "./proposeTestMath";

describe("inverseSolve", () => {
  const base: LaserParams = {
    power: 14.6, speed: 1152, frequency: 100, density: 5000, passes: 1, pulse_width: 200,
  };

  it("converges to params that produce a reachable target (TEi × PIi varying power+speed)", () => {
    // Pick a known-reachable target by computing indices for some other params.
    const target = computeIndices({ ...base, power: 25, speed: 800 });
    const solved = inverseSolve(
      { x: target.total_exposure_index, y: target.pulse_intensity_index },
      ["power", "speed"], base,
      "total_exposure_index", "pulse_intensity_index",
      F2_LIMITS,
    );
    expect(solved).not.toBeNull();
    if (solved !== null) {
      const verify = computeIndices(solved);
      expect(verify.total_exposure_index).toBeCloseTo(target.total_exposure_index, 4);
      expect(verify.pulse_intensity_index).toBeCloseTo(target.pulse_intensity_index, 6);
      // power and speed should land near 25 and 800 respectively.
      expect(solved.power).toBeCloseTo(25, 1);
      expect(solved.speed).toBeCloseTo(800, 0);
    }
  });

  it("returns null on a degenerate axis pair (varied params don't span both axes)", () => {
    // For (PSm, LSm) varying (power, frequency): PSm depends on freq but
    // LSm depends only on density. Power doesn't move EITHER axis. Pair
    // is degenerate.
    const solved = inverseSolve(
      { x: 0.005, y: 0.002 },
      ["power", "frequency"], base,
      "pulse_spacing_mm", "line_spacing_mm",
      F2_LIMITS,
    );
    expect(solved).toBeNull();
  });

  it("returns null on a target that requires params outside laser limits", () => {
    // TEi ≈ 1000 with these constants would require speed ≈ 0.07 — way
    // below the 2 mm/s minimum.
    const solved = inverseSolve(
      { x: 1e6, y: 1e-3 },
      ["power", "speed"], base,
      "total_exposure_index", "pulse_intensity_index",
      F2_LIMITS,
    );
    expect(solved).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npm test -- --run proposeTestMath.test`
Expected: FAIL — `inverseSolve` not exported.

- [ ] **Step 3: Implement the function**

Append to `proposeTestMath.ts`:

```ts
const INVERSE_SOLVE_MAX_ITERS = 20;
const INVERSE_SOLVE_RESIDUAL_EPS = 1e-6;
const INVERSE_SOLVE_DET_EPS = 1e-12;

export function inverseSolve(
  target: { x: number; y: number },
  varyParams: readonly [ParamKey, ParamKey],
  baseParams: LaserParams,
  xKey: IndexKey,
  yKey: IndexKey,
  laserLimits: LaserLimits,
): LaserParams | null {
  const [p1, p2] = varyParams;
  const params: LaserParams = { ...baseParams };

  for (let iter = 0; iter < INVERSE_SOLVE_MAX_ITERS; iter++) {
    let current: LaserIndices;
    try {
      current = computeIndices(params);
    } catch {
      return null;   // hit a zero-divisor mid-iteration
    }
    const rx = (current[xKey] as number) - target.x;
    const ry = (current[yKey] as number) - target.y;
    if (Math.abs(rx) < INVERSE_SOLVE_RESIDUAL_EPS && Math.abs(ry) < INVERSE_SOLVE_RESIDUAL_EPS) {
      return params;
    }

    const j00 = partialDerivative(xKey, p1, params);
    const j01 = partialDerivative(xKey, p2, params);
    const j10 = partialDerivative(yKey, p1, params);
    const j11 = partialDerivative(yKey, p2, params);
    const det = j00 * j11 - j01 * j10;
    if (Math.abs(det) < INVERSE_SOLVE_DET_EPS) {
      return null;   // singular — degenerate pair for this axes
    }

    const dp1 = (j11 * rx - j01 * ry) / det;
    const dp2 = (-j10 * rx + j00 * ry) / det;
    params[p1] -= dp1;
    params[p2] -= dp2;

    // Reject when params escape laser limits — target is unreachable
    // with this base + axes.
    if (params[p1] < laserLimits[p1].min || params[p1] > laserLimits[p1].max) return null;
    if (params[p2] < laserLimits[p2].min || params[p2] > laserLimits[p2].max) return null;
  }
  return null;   // didn't converge
}

// LaserIndices type re-imported from laserIndices.ts (already available
// in this module via computeIndices's return type — no extra import needed).
```

If `LaserIndices` isn't already in scope in `proposeTestMath.ts`, add to the existing import:

```ts
import { computeIndices, type LaserParams, type LaserIndices } from "../../laser/laserIndices";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npm test -- --run proposeTestMath.test`
Expected: PASS.

- [ ] **Step 5: Type-check + full suite**

```bash
cd web && npx tsc --noEmit
cd web && npm test -- --run
```

Expected: clean tsc, full suite passes.

- [ ] **Step 6: Commit**

```bash
git add web/src/components/exposure/proposeTestMath.ts \
        web/src/components/exposure/proposeTestMath.test.ts
git commit -m "$(cat <<'EOF'
feat(propose-test v2): Newton-based inverseSolve

Solves for the two varied params that produce a target (x, y) in index
space. 20-iter cap, 1e-6 residual epsilon. Returns null on degenerate
axis pairs (singular Jacobian) or when iteration leaves laser limits.
Used by fillByInverseSolve to convert polygon-area-uniform samples
into per-cell param snapshots.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: `samplePolygonArea` — Poisson-disk-style rejection sampling

**Files:**
- Modify: `web/src/components/exposure/proposeTestMath.ts`
- Modify: `web/src/components/exposure/proposeTestMath.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `proposeTestMath.test.ts`:

```ts
import { samplePolygonArea } from "./proposeTestMath";

describe("samplePolygonArea", () => {
  const square: Polygon = [[0, 0], [10, 0], [10, 10], [0, 10]];

  it("returns up to N points all inside the polygon", () => {
    const points = samplePolygonArea(square, 16, []);
    expect(points.length).toBeGreaterThan(0);
    expect(points.length).toBeLessThanOrEqual(16);
    for (const p of points) {
      expect(pointInPolygon([p.x, p.y], square)).toBe(true);
    }
  });

  it("avoids existing known points within minDist", () => {
    const known = [{ x: 5, y: 5 }, { x: 2, y: 2 }];
    const points = samplePolygonArea(square, 16, known);
    for (const p of points) {
      for (const k of known) {
        const d = Math.hypot(p.x - k.x, p.y - k.y);
        // minDist = sqrt(area / (n + known.length)) * 0.6 = sqrt(100/18) * 0.6 ≈ 1.41
        expect(d).toBeGreaterThan(1.0);
      }
    }
  });

  it("respects min-distance between accepted points", () => {
    const points = samplePolygonArea(square, 16, []);
    for (let i = 0; i < points.length; i++) {
      for (let j = i + 1; j < points.length; j++) {
        const d = Math.hypot(points[i].x - points[j].x, points[i].y - points[j].y);
        // After one threshold halving, minDist could be ~half, so be lenient.
        expect(d).toBeGreaterThan(0.5);
      }
    }
  });

  it("relaxes threshold and returns < n when polygon too dense", () => {
    // n=200 points in a 10x10 polygon: way more than fits cleanly. The
    // relaxation pass should still return SOME points without throwing.
    const points = samplePolygonArea(square, 200, []);
    expect(points.length).toBeGreaterThan(0);
    expect(points.length).toBeLessThanOrEqual(200);
    for (const p of points) {
      expect(pointInPolygon([p.x, p.y], square)).toBe(true);
    }
  });

  it("works with empty knownPoints and concave polygons", () => {
    const concave: Polygon = [
      [0, 0], [10, 0], [10, 10], [5, 5], [0, 10],
    ];
    const points = samplePolygonArea(concave, 8, []);
    expect(points.length).toBeGreaterThan(0);
    for (const p of points) {
      expect(pointInPolygon([p.x, p.y], concave)).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npm test -- --run proposeTestMath.test`
Expected: FAIL — `samplePolygonArea` not exported.

- [ ] **Step 3: Implement the function**

Append to `proposeTestMath.ts`:

```ts
function polygonArea(polygon: Polygon): number {
  if (polygon.length < 3) return 0;
  let s = 0;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    s += (polygon[j][0] + polygon[i][0]) * (polygon[j][1] - polygon[i][1]);
  }
  return Math.abs(s) / 2;
}

export const SAMPLE_BUDGET_PER_POINT = 30;
export const MIN_DIST_FACTOR = 0.6;

export function samplePolygonArea(
  polygon: Polygon,
  n: number,
  knownPoints: ReadonlyArray<{ x: number; y: number }>,
  minDistOverride?: number,
): Array<{ x: number; y: number }> {
  if (polygon.length < 3 || n <= 0) return [];
  const box = polygonBox(polygon);
  if (!box) return [];
  const area = polygonArea(polygon);
  if (area === 0) return [];

  const initialMinDist = minDistOverride ?? (
    Math.sqrt(area / (n + knownPoints.length)) * MIN_DIST_FACTOR
  );
  const budget = SAMPLE_BUDGET_PER_POINT * n;

  function tryWith(minDist: number): Array<{ x: number; y: number }> {
    const accepted: Array<{ x: number; y: number }> = [];
    const minDistSq = minDist * minDist;
    let attempts = 0;
    while (accepted.length < n && attempts < budget) {
      attempts++;
      const x = box.minX + Math.random() * (box.maxX - box.minX);
      const y = box.minY + Math.random() * (box.maxY - box.minY);
      if (!pointInPolygon([x, y], polygon)) continue;
      let ok = true;
      for (const k of knownPoints) {
        if ((k.x - x) ** 2 + (k.y - y) ** 2 < minDistSq) { ok = false; break; }
      }
      if (!ok) continue;
      for (const p of accepted) {
        if ((p.x - x) ** 2 + (p.y - y) ** 2 < minDistSq) { ok = false; break; }
      }
      if (!ok) continue;
      accepted.push({ x, y });
    }
    return accepted;
  }

  let result = tryWith(initialMinDist);
  if (result.length < n) {
    // Single relaxation pass with half the threshold.
    result = tryWith(initialMinDist * 0.5);
  }
  return result;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npm test -- --run proposeTestMath.test`
Expected: PASS. (Note: the random nature of sampling means tests are technically non-deterministic — but with `n=16` in a 10×10 square the results are reliable across machines.)

- [ ] **Step 5: Commit**

```bash
git add web/src/components/exposure/proposeTestMath.ts \
        web/src/components/exposure/proposeTestMath.test.ts
git commit -m "$(cat <<'EOF'
feat(propose-test v2): samplePolygonArea Poisson-disk rejection sampler

Uniform-in-bbox candidate generation, polygon-inclusion + min-distance
acceptance, single relaxation pass to half the threshold when the
budget is exhausted before N points are collected. Default min-distance
sqrt(area / (n + known)) * 0.6 gives a clean visual spread without
rejecting too aggressively. Used by fillByInverseSolve to pick (x, y)
targets in the polygon area.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: `fillByInverseSolve` orchestrator

**Files:**
- Modify: `web/src/components/exposure/proposeTestMath.ts`
- Modify: `web/src/components/exposure/proposeTestMath.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `proposeTestMath.test.ts`:

```ts
import { fillByInverseSolve } from "./proposeTestMath";

describe("fillByInverseSolve", () => {
  const base: LaserParams = {
    power: 14.6, speed: 1152, frequency: 100, density: 5000, passes: 1, pulse_width: 200,
  };

  it("returns ≤ N cells, all inside the polygon, with valid laser-range params", () => {
    const polygon: Polygon = [
      [10, 0.0001], [90, 0.0001], [90, 0.045], [10, 0.045],
    ];
    const cells = fillByInverseSolve(
      base, ["power", "speed"], polygon,
      "total_exposure_index", "pulse_intensity_index",
      F2_LIMITS, 16, [],
    );
    expect(cells.length).toBeGreaterThan(0);
    expect(cells.length).toBeLessThanOrEqual(16);
    for (const c of cells) {
      expect(pointInPolygon([c.x, c.y], polygon)).toBe(true);
      const pw = c.paramValues.power!;
      const sp = c.paramValues.speed!;
      expect(pw).toBeGreaterThanOrEqual(F2_LIMITS.power.min);
      expect(pw).toBeLessThanOrEqual(F2_LIMITS.power.max);
      expect(sp).toBeGreaterThanOrEqual(F2_LIMITS.speed.min);
      expect(sp).toBeLessThanOrEqual(F2_LIMITS.speed.max);
    }
  });

  it("avoids known points (existing palette entries inside polygon)", () => {
    const polygon: Polygon = [
      [10, 0.0001], [90, 0.0001], [90, 0.045], [10, 0.045],
    ];
    const known = [{ x: 50, y: 0.022 }, { x: 30, y: 0.01 }];
    const cells = fillByInverseSolve(
      base, ["power", "speed"], polygon,
      "total_exposure_index", "pulse_intensity_index",
      F2_LIMITS, 8, known,
    );
    for (const c of cells) {
      for (const k of known) {
        const d = Math.hypot(c.x - k.x, c.y - k.y);
        expect(d).toBeGreaterThan(0.5);   // min-dist threshold
      }
    }
  });

  it("matches forward indices: each returned cell's params produce its (x, y)", () => {
    const polygon: Polygon = [
      [10, 0.0001], [90, 0.0001], [90, 0.045], [10, 0.045],
    ];
    const cells = fillByInverseSolve(
      base, ["power", "speed"], polygon,
      "total_exposure_index", "pulse_intensity_index",
      F2_LIMITS, 8, [],
    );
    for (const c of cells) {
      const verify = computeIndices({
        ...base,
        power: c.paramValues.power!,
        speed: c.paramValues.speed!,
      });
      expect(verify.total_exposure_index).toBeCloseTo(c.x, 4);
      expect(verify.pulse_intensity_index).toBeCloseTo(c.y, 6);
    }
  });

  it("returns empty for a degenerate axis pair", () => {
    // (PSm, LSm) varying (power, frequency) — power affects neither
    const polygon: Polygon = [[0.001, 0.001], [0.05, 0.001], [0.05, 0.05], [0.001, 0.05]];
    const cells = fillByInverseSolve(
      base, ["power", "frequency"], polygon,
      "pulse_spacing_mm", "line_spacing_mm",
      F2_LIMITS, 8, [],
    );
    expect(cells.length).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npm test -- --run proposeTestMath.test`
Expected: FAIL — `fillByInverseSolve` not exported.

- [ ] **Step 3: Implement the orchestrator**

Append to `proposeTestMath.ts`:

```ts
export function fillByInverseSolve(
  baseParams: LaserParams,
  varyParams: readonly [ParamKey, ParamKey],
  polygon: Polygon,
  xKey: IndexKey,
  yKey: IndexKey,
  laserLimits: LaserLimits,
  n: number,
  knownPoints: ReadonlyArray<{ x: number; y: number }>,
): FillCell[] {
  const targets = samplePolygonArea(polygon, n, knownPoints);
  const [p1, p2] = varyParams;
  const out: FillCell[] = [];

  for (const t of targets) {
    const solved = inverseSolve(t, varyParams, baseParams, xKey, yKey, laserLimits);
    if (solved === null) continue;

    // Verify the solve actually lands at the target — clamp + snap could
    // have moved us away. (Currently we don't snap pulse_width / passes
    // here because those aren't in the testable set; we keep them for
    // future-proofing if v3 adds them.)
    let verify: LaserIndices;
    try {
      verify = computeIndices(solved);
    } catch {
      continue;
    }
    out.push({
      paramValues: { [p1]: solved[p1], [p2]: solved[p2] },
      x: verify[xKey] as number,
      y: verify[yKey] as number,
    });
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd web && npm test -- --run proposeTestMath.test
cd web && npx tsc --noEmit
```

Expected: PASS, clean tsc.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/exposure/proposeTestMath.ts \
        web/src/components/exposure/proposeTestMath.test.ts
git commit -m "$(cat <<'EOF'
feat(propose-test v2): fillByInverseSolve orchestrator

Pulls together samplePolygonArea + inverseSolve into a single fill-mode
entry point. For each polygon-area sample, Newton-iterates to the
varied params that produce that (x, y); discards on convergence
failure or laser-limit violation. Existing palette entries inside the
polygon are passed as knownPoints so new cells don't sit on top of them.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: `ExposureProposeRail` — 6-row PARAMS editor

**Files:**
- Modify: `web/src/components/exposure/ExposureProposeRail.tsx`
- Modify: `web/src/components/exposure/ExposureProposeRail.test.tsx`

- [ ] **Step 1: Read current rail to find seam**

```bash
grep -n 'rangeReadout\|onCellCountChange\|<input type="range"' web/src/components/exposure/ExposureProposeRail.tsx | head
```

- [ ] **Step 2: Update Props + add the editor section**

Replace the entire props interface and append an editor render. Update `web/src/components/exposure/ExposureProposeRail.tsx`:

```tsx
import * as React from "react";
import type { ExposureRow } from "./exposureCorrelations";
import type { ModeChoice, ParamKey } from "./proposeTestMath";

interface RangeReadout {
  paramName: string;
  min: number;
  max: number;
  unit: string;
}

export type ParamRow =
  | {
      key: ParamKey | "passes" | "pulse_width";
      kind: "editable";
      value: number;
      min: number;
      max: number;
      step: number;
      unit: string;
      presets?: readonly number[];
    }
  | {
      key: ParamKey | "passes" | "pulse_width";
      kind: "locked";
      resolved: { min: number; max: number };
      anchorValue: number;
      unit: string;
    };

interface Props {
  anchor: ExposureRow | null;
  entriesInsidePolygon: number;
  mode: ModeChoice;
  onModeChange: (next: ModeChoice) => void;
  cellCount: number;
  onCellCountChange: (n: number) => void;
  paramRows: ReadonlyArray<ParamRow>;
  onParamOverrideChange: (param: ParamKey | "passes" | "pulse_width", value: number) => void;
  rangeReadout: ReadonlyArray<RangeReadout>;
  canCreate: boolean;
  helperText: string | null;
  onCreate: () => void;
  onCancel: () => void;
}

const PARAM_LABEL: Record<string, string> = {
  power: "POWER",
  speed: "SPEED",
  frequency: "FREQ",
  density: "DENSITY",
  passes: "PASSES",
  pulse_width: "PULSE W",
};

function formatValue(v: number, unit: string): string {
  // Round integers to 0dp, fractional to 2dp, large numbers to 0dp.
  if (Math.abs(v) >= 1000) return `${Math.round(v)} ${unit}`.trim();
  if (Math.abs(v) >= 100) return `${v.toFixed(0)} ${unit}`.trim();
  if (Math.abs(v) >= 10) return `${v.toFixed(1)} ${unit}`.trim();
  if (Number.isInteger(v)) return `${v} ${unit}`.trim();
  return `${v.toFixed(2)} ${unit}`.trim();
}

export const ExposureProposeRail: React.FC<Props> = ({
  anchor, entriesInsidePolygon, mode, onModeChange, cellCount, onCellCountChange,
  paramRows, onParamOverrideChange,
  rangeReadout, canCreate, helperText, onCreate, onCancel,
}) => {
  const isFill = mode.mode === "fill";

  const toggleMode = (next: "curve" | "fill") => {
    if (next === mode.mode) return;
    if (next === "curve") {
      const param: ParamKey = isFill ? mode.varyParams[0] : mode.varyParam;
      onModeChange({ mode: "curve", varyParam: param });
    } else {
      const first: ParamKey = isFill ? mode.varyParams[0] : mode.varyParam;
      const second: ParamKey = first === "power" ? "speed" : "power";
      onModeChange({ mode: "fill", varyParams: [first, second] });
    }
  };

  const toggleChip = (param: ParamKey) => {
    if (mode.mode === "curve") {
      onModeChange({ mode: "curve", varyParam: param });
    } else {
      const [a, b] = mode.varyParams;
      if (param === a) onModeChange({ mode: "curve", varyParam: b });
      else if (param === b) onModeChange({ mode: "curve", varyParam: a });
      else onModeChange({ mode: "fill", varyParams: [a, param] });
    }
  };

  const isChipSelected = (p: ParamKey) =>
    mode.mode === "curve" ? mode.varyParam === p : mode.varyParams.includes(p);

  return (
    <div className="flex flex-col gap-3 h-full" data-role="propose-rail">
      <div className="flex items-center justify-between">
        <div className="font-mono text-[10px] uppercase tracking-[0.18em] font-semibold text-[color:var(--color-primary)]">
          Propose Test
        </div>
        <div className="flex gap-1">
          <button
            type="button"
            onClick={() => toggleMode("curve")}
            className={
              "px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.16em] rounded-sm border " +
              (mode.mode === "curve"
                ? "border-[color:var(--color-primary)] text-[color:var(--color-primary)]"
                : "border-[color:var(--color-border)] text-[color:var(--color-ink-muted)]")
            }
          >
            curve
          </button>
          <button
            type="button"
            onClick={() => toggleMode("fill")}
            className={
              "px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.16em] rounded-sm border " +
              (mode.mode === "fill"
                ? "border-[color:var(--color-primary)] text-[color:var(--color-primary)]"
                : "border-[color:var(--color-border)] text-[color:var(--color-ink-muted)]")
            }
          >
            fill
          </button>
        </div>
      </div>

      <div className="h-px bg-[color:var(--color-border)]" />

      <section>
        <div className="font-mono text-[9px] uppercase tracking-[0.16em] text-[color:var(--color-ink-subtle)] mb-1">
          Anchor
        </div>
        {anchor ? (
          <>
            <div className="font-mono text-[12px] text-[color:var(--color-ink)]">
              {anchor.hex}
            </div>
            <div className="font-mono text-[10px] text-[color:var(--color-ink-muted)] mt-1">
              {entriesInsidePolygon} entries inside polygon
            </div>
          </>
        ) : (
          <div className="font-mono text-[10px] italic text-[color:var(--color-ink-subtle)]">
            No entries inside polygon yet.
          </div>
        )}
      </section>

      <section>
        <div className="font-mono text-[9px] uppercase tracking-[0.16em] text-[color:var(--color-ink-subtle)] mb-2">
          Vary
        </div>
        <div className="grid grid-cols-2 gap-1">
          {(["power", "speed", "frequency", "density"] as ParamKey[]).map((p) => (
            <button
              key={p}
              type="button"
              aria-pressed={isChipSelected(p)}
              onClick={() => toggleChip(p)}
              className={
                "px-2 py-1.5 font-mono text-[10px] uppercase tracking-[0.16em] rounded-sm border " +
                (isChipSelected(p)
                  ? "border-[color:var(--color-primary)] bg-[color:var(--color-primary)] text-white"
                  : "border-[color:var(--color-border)] text-[color:var(--color-ink-muted)]")
              }
            >
              {PARAM_LABEL[p]}
            </button>
          ))}
        </div>
      </section>

      <section data-role="propose-params-editor">
        <div className="font-mono text-[9px] uppercase tracking-[0.16em] text-[color:var(--color-ink-subtle)] mb-2">
          Params
        </div>
        <div className="flex flex-col gap-1.5">
          {paramRows.map((row) => (
            <div key={row.key} className="flex items-center gap-2" data-row={row.key}>
              <div className="font-mono text-[9px] uppercase tracking-[0.14em] text-[color:var(--color-ink-muted)] w-[68px] flex-none">
                {PARAM_LABEL[row.key as string]}
              </div>
              {row.kind === "editable" ? (
                <>
                  <input
                    type="range"
                    min={row.min}
                    max={row.max}
                    step={row.step}
                    value={row.value}
                    onChange={(e) => {
                      const raw = Number(e.target.value);
                      const snapped = row.presets
                        ? row.presets.reduce((a, b) =>
                            Math.abs(b - raw) < Math.abs(a - raw) ? b : a
                          )
                        : raw;
                      onParamOverrideChange(row.key, snapped);
                    }}
                    aria-label={`${PARAM_LABEL[row.key as string]} value`}
                    className="flex-1"
                  />
                  <div className="font-mono text-[10px] text-[color:var(--color-ink)] tabular-nums w-[80px] flex-none text-right">
                    {formatValue(row.value, row.unit)}
                  </div>
                </>
              ) : (
                <>
                  <div
                    aria-disabled="true"
                    className="flex-1 h-1.5 rounded-full bg-[color:var(--color-border)] relative overflow-hidden"
                    title={`Locked — varied param. Range ${row.resolved.min}..${row.resolved.max}`}
                  >
                    {/* The resolved range as a track band. We approximate
                        the band using the anchor as the centre. The page
                        passes the resolved [min, max] in the SAME UNIT as
                        the slider, so positioning is min/max relative to
                        the row's own param domain. */}
                    <div
                      className="absolute top-0 bottom-0 bg-[color:var(--color-primary)]/40"
                      style={{
                        left: `${0}%`,
                        right: `${0}%`,
                      }}
                    />
                  </div>
                  <div className="font-mono text-[10px] text-[color:var(--color-primary)] tabular-nums w-[120px] flex-none text-right">
                    {formatValue(row.resolved.min, row.unit)} → {formatValue(row.resolved.max, row.unit)}
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      </section>

      <section>
        <div className="flex items-center justify-between mb-1">
          <div className="font-mono text-[9px] uppercase tracking-[0.16em] text-[color:var(--color-ink-subtle)]">
            Cells · {cellCount}
          </div>
        </div>
        <input
          type="range"
          min={2}
          max={200}
          step={1}
          value={cellCount}
          onChange={(e) => onCellCountChange(Number(e.target.value))}
          aria-label="Cells"
          className="w-full"
        />
        <div className="flex justify-between font-mono text-[8px] text-[color:var(--color-ink-subtle)]">
          <span>2</span>
          <span>200</span>
        </div>
      </section>

      <section>
        <div className="font-mono text-[9px] uppercase tracking-[0.16em] text-[color:var(--color-ink-subtle)] mb-1">
          Range
        </div>
        {rangeReadout.length === 0 ? (
          <div className="font-mono text-[10px] italic text-[color:var(--color-ink-subtle)]">—</div>
        ) : (
          rangeReadout.map((r) => (
            <div key={r.paramName} className="font-mono text-[11px] text-[color:var(--color-ink)]">
              {`${r.paramName} · ${formatValue(r.min, "")} → ${formatValue(r.max, "")} ${r.unit}`}
            </div>
          ))
        )}
      </section>

      <div className="flex-1" />

      {helperText && (
        <div className="font-mono text-[10px] text-[color:var(--color-ink-muted)] italic">
          {helperText}
        </div>
      )}

      <button
        type="button"
        disabled={!canCreate}
        onClick={onCreate}
        className={
          "px-3 py-2.5 font-mono text-[11px] uppercase tracking-[0.16em] font-semibold rounded-sm " +
          (canCreate
            ? "bg-[color:var(--color-primary)] text-white"
            : "bg-[color:var(--color-border)] text-[color:var(--color-ink-subtle)] cursor-not-allowed")
        }
      >
        Create Test →
      </button>
      <button
        type="button"
        onClick={onCancel}
        className="px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-[color:var(--color-ink-muted)] border border-[color:var(--color-border)] rounded-sm"
      >
        Cancel
      </button>
    </div>
  );
};

export type { RangeReadout };
```

NOTE: drop the existing inline `formatRange` helper in favour of the module-level `formatValue`. Audit the file for any leftover references — there shouldn't be any after this rewrite.

- [ ] **Step 3: Update existing tests + add new ones**

Update `web/src/components/exposure/ExposureProposeRail.test.tsx`. Replace the existing test fixture's prop set with one that includes the new fields. Add tests for the editor:

```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ExposureProposeRail, type ParamRow } from "./ExposureProposeRail";
import type { ExposureRow } from "./exposureCorrelations";

const ANCHOR: ExposureRow = {
  id: 1,
  hex: "#cb7983",
  lab: [50, 20, 5],
  indices: {
    pulse_spacing_mm: 0.01, line_spacing_mm: 0.002,
    pulse_energy_index: 0.15, pulse_intensity_index: 0.0008,
    total_exposure_index: 65, ablation_aggression_index: 0.05,
    delivery_smoothness_index: 81000,
    formula_version: 3,
    density_model: "lpc",
    power_model: "controller_percent",
  },
  params: {
    power: 14.6, speed: 1152, frequency: 100, density: 5000, passes: 1, pulse_width: 200,
  },
};

const DEFAULT_PARAM_ROWS: ParamRow[] = [
  { key: "power", kind: "locked", resolved: { min: 12.4, max: 17.6 }, anchorValue: 14.6, unit: "%" },
  { key: "speed", kind: "editable", value: 1152, min: 2, max: 15000, step: 1, unit: "mm/s" },
  { key: "frequency", kind: "editable", value: 100, min: 60, max: 500, step: 1, unit: "kHz" },
  { key: "density", kind: "editable", value: 5000, min: 1, max: 5000, step: 1, unit: "lpc" },
  { key: "passes", kind: "editable", value: 1, min: 1, max: 99, step: 1, unit: "" },
  { key: "pulse_width", kind: "editable", value: 200, min: 2, max: 200, step: 1, unit: "ns",
    presets: [2, 4, 8, 30, 60, 80, 100, 200] },
];

const DEFAULT_PROPS = {
  anchor: ANCHOR,
  entriesInsidePolygon: 3,
  mode: { mode: "curve" as const, varyParam: "power" as const },
  onModeChange: vi.fn(),
  cellCount: 16,
  onCellCountChange: vi.fn(),
  paramRows: DEFAULT_PARAM_ROWS,
  onParamOverrideChange: vi.fn(),
  rangeReadout: [],
  canCreate: true,
  helperText: null,
  onCreate: vi.fn(),
  onCancel: vi.fn(),
};

describe("ExposureProposeRail editor", () => {
  it("renders a row per param", () => {
    render(<ExposureProposeRail {...DEFAULT_PROPS} />);
    expect(screen.getByText(/^POWER$/)).toBeTruthy();
    expect(screen.getByText(/^SPEED$/)).toBeTruthy();
    expect(screen.getByText(/^FREQ$/)).toBeTruthy();
    expect(screen.getByText(/^DENSITY$/)).toBeTruthy();
    expect(screen.getByText(/^PASSES$/)).toBeTruthy();
    expect(screen.getByText(/^PULSE W$/)).toBeTruthy();
  });

  it("renders the locked row with resolved min → max readout (no slider thumb)", () => {
    render(<ExposureProposeRail {...DEFAULT_PROPS} />);
    expect(screen.getByText(/12.4 → 17.6 %/)).toBeTruthy();
  });

  it("calls onParamOverrideChange when an editable slider moves", () => {
    const onParamOverrideChange = vi.fn();
    render(<ExposureProposeRail {...DEFAULT_PROPS} onParamOverrideChange={onParamOverrideChange} />);
    const slider = screen.getByLabelText(/SPEED value/);
    fireEvent.change(slider, { target: { value: "2000" } });
    expect(onParamOverrideChange).toHaveBeenCalledWith("speed", 2000);
  });

  it("snaps pulse_width to the nearest preset value", () => {
    const onParamOverrideChange = vi.fn();
    render(<ExposureProposeRail {...DEFAULT_PROPS} onParamOverrideChange={onParamOverrideChange} />);
    const slider = screen.getByLabelText(/PULSE W value/);
    // Drag to 90 → nearest preset is 80.
    fireEvent.change(slider, { target: { value: "90" } });
    expect(onParamOverrideChange).toHaveBeenCalledWith("pulse_width", 80);
  });

  it("displays the entries-inside-polygon count in the Anchor section", () => {
    render(<ExposureProposeRail {...DEFAULT_PROPS} entriesInsidePolygon={5} />);
    expect(screen.getByText(/5 entries inside polygon/i)).toBeTruthy();
  });
});
```

- [ ] **Step 4: Run tests**

```bash
cd web && npm test -- --run ExposureProposeRail
cd web && npx tsc --noEmit
```

Expected: PASS, clean tsc.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/exposure/ExposureProposeRail.tsx \
        web/src/components/exposure/ExposureProposeRail.test.tsx
git commit -m "$(cat <<'EOF'
feat(propose-test v2): rail PARAMS editor with locked-when-varied rows

Six new rows in the wizard rail, one per laser param. Editable rows
have a slider + numeric readout; pulse_width snaps to its preset list,
passes snaps to integer. Varied param rows are locked (aria-disabled,
no thumb) and show the resolved min → max as a coloured track band +
range readout. Anchor section now also shows 'N entries inside polygon'
so the user can see what the fill is aware of.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: `ExposureToolbar` — chip text toggle

**Files:**
- Modify: `web/src/components/exposure/ExposureToolbar.tsx`

- [ ] **Step 1: Find the existing chip render**

```bash
grep -n '"PROPOSE TEST"\|◇ PROPOSE TEST\|proposeOpen' web/src/components/exposure/ExposureToolbar.tsx
```

- [ ] **Step 2: Toggle the chip text**

In the chip JSX, replace the literal `"◇ PROPOSE TEST"` with:

```tsx
{proposeOpen ? "× CANCEL" : "◇ PROPOSE TEST"}
```

The existing `proposeOpen ? primary-active : neutral` styling stays — the active variant is already orange/primary, which works for the CANCEL state.

- [ ] **Step 3: Run existing toolbar tests**

```bash
cd web && npm test -- --run ExposureToolbar
cd web && npx tsc --noEmit
```

Expected: PASS, clean tsc. Existing tests should still match because they query by partial text "PROPOSE TEST" — if any test queries for the exact label, update to handle both states.

- [ ] **Step 4: Commit**

```bash
git add web/src/components/exposure/ExposureToolbar.tsx
git commit -m "$(cat <<'EOF'
feat(propose-test v2): toolbar chip toggles to × CANCEL while wizard is active

The chip's text flips between '◇ PROPOSE TEST' and '× CANCEL' based
on proposeOpen. Same orange/primary active styling for CANCEL — no new
classes needed. Click in either state cancels-or-enters as before.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: `ExposurePage` — paramOverrides, banner click, fillByInverseSolve

**Files:**
- Modify: `web/src/pages/ExposurePage.tsx`

- [ ] **Step 1: Find current state declarations**

```bash
grep -n 'proposeMode\|proposeOverride\|fillByForwardGrid\|paramOverrides' web/src/pages/ExposurePage.tsx | head
```

- [ ] **Step 2: Add `paramOverrides` state and effective-params memo**

Below the existing `[proposeOverride, setProposeOverride]` state, add:

```tsx
const [paramOverrides, setParamOverrides] = useState<Partial<Record<"power" | "speed" | "frequency" | "density" | "passes" | "pulse_width", number>>>({});

const effectiveBaseParams = useMemo<LaserParams | null>(() => {
  if (!anchor || !anchor.params) return null;
  const base = anchor.params as unknown as LaserParams;
  return { ...base, ...paramOverrides } as LaserParams;
}, [anchor, paramOverrides]);
```

(Make sure `LaserParams` is imported from `../laser/laserIndices` — it already is.)

- [ ] **Step 3: Compute `entriesInsidePolygon`**

Below the `anchor` memo:

```tsx
const entriesInsidePolygon = useMemo<readonly { x: number; y: number }[]>(() => {
  if (polygon.length < 3) return [];
  return displayRows
    .filter((r) => pointInPolygon([
      r.indices[xKey] as number,
      r.indices[yKeyForMath] as number,
    ], polygon))
    .map((r) => ({
      x: r.indices[xKey] as number,
      y: r.indices[yKeyForMath] as number,
    }));
}, [polygon, displayRows, xKey, yKeyForMath]);
```

(Imports needed: `pointInPolygon` from `proposeTestMath` — already imported.)

- [ ] **Step 4: Switch fill computation to `fillByInverseSolve`**

Replace the existing `fillByForwardGrid` call inside the preview memo with:

```tsx
const cells = fillByInverseSolve(
  effectiveBaseParams!, effective.varyParams, polygon, xKey, yKeyForMath as IndexKey,
  F2_MOPA_LIMITS, cellCount, entriesInsidePolygon,
);
```

Update the imports at the top:

```tsx
import {
  findAnchor, pickModeAndParams, computeCurve, clipPolylineToPolygon,
  sampleByArcLength, fillByInverseSolve, pointInPolygon,
  type Polygon, type ParamKey, type ModeChoice, type LaserLimits,
  type CurveSample, type FillCell,
} from "../components/exposure/proposeTestMath";
```

(Drop `fillByForwardGrid` from the import list.)

The curve-mode branch keeps using `effectiveBaseParams` instead of `anchor.params`:

```tsx
if (effective.mode === "curve") {
  const curve = computeCurve(effectiveBaseParams!, effective.varyParam, xKey, yKeyForMath as IndexKey, F2_MOPA_LIMITS);
  // ...rest unchanged
}
```

Make the preview memo's deps include `effectiveBaseParams` and `entriesInsidePolygon`:

```tsx
}, [effective, effectiveBaseParams, polygon, xKey, yKeyForMath, cellCount, entriesInsidePolygon]);
```

- [ ] **Step 5: Build paramRows for the rail**

Above the `<ExposureProposeRail>` callsite, derive `paramRows`:

```tsx
type ParamRowKey = "power" | "speed" | "frequency" | "density" | "passes" | "pulse_width";
const ALLOWED_PULSE_WIDTHS = [2, 4, 8, 30, 60, 80, 100, 200] as const;

function buildParamRows(
  base: LaserParams | null,
  effective: ModeChoice | null,
  preview: { cells: ReadonlyArray<{ paramValues?: { [k in ParamKey]?: number }; paramValue?: number }> },
): ReadonlyArray<import("../components/exposure/ExposureProposeRail").ParamRow> {
  if (!base) return [];
  const PARAM_DOMAIN: Record<ParamRowKey, { min: number; max: number; step: number; unit: string; presets?: readonly number[] }> = {
    power:       { min: 1,  max: 100,   step: 1,  unit: "%" },
    speed:       { min: 2,  max: 15000, step: 1,  unit: "mm/s" },
    frequency:   { min: 60, max: 500,   step: 1,  unit: "kHz" },
    density:     { min: 1,  max: 5000,  step: 1,  unit: "lpc" },
    passes:      { min: 1,  max: 99,    step: 1,  unit: "" },
    pulse_width: { min: 2,  max: 200,   step: 1,  unit: "ns", presets: ALLOWED_PULSE_WIDTHS },
  };
  const variedSet: Set<string> = new Set(
    effective ? (effective.mode === "curve" ? [effective.varyParam] : effective.varyParams) : [],
  );
  return (Object.keys(PARAM_DOMAIN) as ParamRowKey[]).map((key) => {
    const domain = PARAM_DOMAIN[key];
    const anchorValue = base[key as keyof LaserParams] as number;
    if (variedSet.has(key)) {
      // Resolved range comes from preview cells' varied param values.
      const values = preview.cells
        .map((c) => {
          if (c.paramValues && key in c.paramValues) return (c.paramValues as Record<string, number>)[key];
          if (c.paramValue !== undefined && effective?.mode === "curve" && effective.varyParam === key) return c.paramValue;
          return null;
        })
        .filter((v): v is number => typeof v === "number");
      const min = values.length ? Math.min(...values) : anchorValue;
      const max = values.length ? Math.max(...values) : anchorValue;
      return { key, kind: "locked", resolved: { min, max }, anchorValue, unit: domain.unit };
    }
    return {
      key, kind: "editable", value: anchorValue,
      min: domain.min, max: domain.max, step: domain.step,
      unit: domain.unit, presets: domain.presets,
    };
  });
}

const paramRows = useMemo(
  () => buildParamRows(effectiveBaseParams, effective, preview),
  [effectiveBaseParams, effective, preview],
);
```

- [ ] **Step 6: Wire the new props to `<ExposureProposeRail>`**

Replace the existing `<ExposureProposeRail ...>` props block. Add:

```tsx
entriesInsidePolygon={entriesInsidePolygon.length}
paramRows={paramRows}
onParamOverrideChange={(key, value) => {
  setParamOverrides((prev) => ({ ...prev, [key]: value }));
}}
```

Keep the rest. Note `paramOverrides` does NOT clear when the varied chip changes — the user's intent to override speed=2000 still applies even if they swap the varied chip from power to density. Only the `closeProposeWizard` cleanup clears it.

- [ ] **Step 7: Update `closeProposeWizard` to clear param overrides**

Find the existing `closeProposeWizard` function (probably a `useCallback`). Add:

```tsx
setParamOverrides({});
```

next to the existing `setProposeMode("off")` / `setPolygon([])` / `setProposeOverride(null)`.

- [ ] **Step 8: Add banner click handler + change banner text/cursor**

Find the draw-mode hint banner JSX (search for "Click vertices" in the file). Replace it with:

```tsx
{proposeMode === "drawing" && (
  <div
    className={
      "absolute top-3 left-1/2 -translate-x-1/2 z-10 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-white rounded-sm shadow-md " +
      (polygon.length >= 3
        ? "bg-[color:var(--color-primary)] cursor-pointer"
        : "bg-[color:var(--color-primary)]/70 pointer-events-none")
    }
    onClick={polygon.length >= 3
      ? () => { if (polygon.length >= 3) setProposeMode("panel"); }
      : undefined}
    role={polygon.length >= 3 ? "button" : undefined}
  >
    {polygon.length === 0
      ? "Click vertices · ENTER or double-click to close · ESC cancels"
      : polygon.length < 3
        ? `Click ${3 - polygon.length} more vertices · ESC cancels`
        : `✓ Click here to finish · ENTER or double-click also works · ESC cancels`}
  </div>
)}
```

- [ ] **Step 9: Build + tests + tsc**

```bash
cd web && npx tsc --noEmit
cd web && npm test -- --run
cd web && npm run build > /dev/null 2>&1 && echo build-ok
```

Expected: clean tsc, full FE suite passes (560+ now), build-ok.

- [ ] **Step 10: Commit**

```bash
git add web/src/pages/ExposurePage.tsx
git commit -m "$(cat <<'EOF'
feat(propose-test v2): page wires PARAMS editor, banner click, inverse fill

- New paramOverrides state. effectiveBaseParams = anchor.params merged
  with overrides. Curve and fill computation both consume the merged
  values, so editing a non-varied param 'rotates' the curve / shifts
  the fill region live.
- buildParamRows() derives the rail's 6-row PARAMS editor data: editable
  rows for non-varied params (slider domain from F2 MOPA limits, presets
  for pulse_width), locked rows for the varied param(s) with resolved
  min/max from the preview cells.
- entriesInsidePolygon: live derivation of palette entries inside the
  current polygon. Count goes to the rail's anchor section; coordinate
  list goes to fillByInverseSolve as knownPoints so new cells avoid
  existing ones.
- Fill computation now calls fillByInverseSolve (samples polygon area
  uniformly + Newton-iterates per target). fillByForwardGrid stays in
  the math module for now but is no longer called.
- Draw-mode hint banner is clickable to close the polygon once it has
  3+ vertices. Text progresses 0 → < 3 → 3+ to reflect the requirement.
- closeProposeWizard now clears paramOverrides.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Browser walkthrough + changelog + push PR

- [ ] **Step 1: Restart dev server with the new bundle**

```bash
pkill -f 'xcs-gen serve' 2>&1 || true
sleep 1
cd web && npm run build > /dev/null 2>&1 && echo build-ok
cd /Users/jonzky/Documents/XTools/Reverse
XCSGEN_LOG=WARNING uv run --active xcs-gen serve --host 127.0.0.1 --port 8017 &
sleep 4
curl -s -o /dev/null -w 'http=%{http_code}\n' http://127.0.0.1:8017/
```

- [ ] **Step 2: Browser walk-through on `#/exposure/1`**

Open `http://127.0.0.1:8017/?cb=1#/exposure/1` and confirm in order:

1. Toolbar chip reads `◇ PROPOSE TEST`. Click it → chip becomes `× CANCEL` (orange).
2. Banner above chart: "Click vertices · ENTER or double-click to close · ESC cancels". Click 1 vertex → "Click 2 more vertices · ESC cancels". Click 2 → "Click 1 more vertices · ESC cancels". Click 3rd vertex → banner becomes "✓ Click here to finish · ENTER or double-click also works · ESC cancels" (full primary colour, pointer cursor).
3. Click the banner → wizard rail opens.
4. Rail shows: PROPOSE TEST | CURVE | FILL toggle. Anchor row: hex + "N entries inside polygon".
5. PARAMS section shows 6 rows. The varied param (POWER by default if curve-mode-armed) is locked: thumb hidden, track shows a faint band, value displays as "min → max %". The other 5 are editable sliders with values.
6. Drag SPEED slider → curve cells visibly shift on the chart (the curve is the same shape but anchored at a different baseline → cell positions move).
7. Drag DENSITY slider → curve "rotates" (passes through different (x, y) regions).
8. Click `FILL` mode toggle → mode flips. Two chips selected. The chart shows N filled cells distributed across the polygon area (not clustered on one curve).
9. Drag CELLS slider 16 → 32. Cells re-render live; spacing tightens.
10. Drag a non-varied param (e.g. PULSE_W) → cell positions shift live (proves the inverse-solve uses the merged base).
11. Click PASSES slider → snaps to integers (1, 2, 3, ... visible).
12. Click PULSE_W slider → snaps to preset values (e.g. drag toward 90 → snaps to 80).
13. Click `CREATE TEST` → test created, navigates to `#/tests?new=<id>`.
14. Verify test detail shows the validation_cells with the right per-cell varied-param values + the user-edited overrides as base_params.

If any step fails, fix and re-verify.

- [ ] **Step 3: Author the changelog**

Create `changelog/2026-05-18-exposure-propose-test-v2.md`:

```markdown
---
id: 2026-05-18-exposure-propose-test-v2
date: 2026-05-18
level: minor
title: Propose Test — all-params editor + true area fill
summary: The wizard now lets you adjust all 6 params live (rotating the curve / shifting the fill), and Fill mode actually fills the polygon evenly.
---

Two refinements to the propose-test wizard from last week:

- **Edit any param.** All six base params (power, speed, frequency,
  density, passes, pulse_width) now appear as editable sliders in the
  rail. The currently-varied param row is locked and shows the resolved
  min → max as a band; everything else is draggable. Adjusting a
  non-varied param re-runs the curve/fill live, letting you "rotate"
  the curve through a different region or shift where the fill cells
  land.
- **Better fill.** Fill mode used to forward-sample a (p1, p2) param
  grid and filter to polygon-inside; if the grid didn't cover the
  polygon evenly, you'd see fewer cells than asked for. Now the
  algorithm samples N points evenly distributed in the polygon area
  itself (Poisson-disk-style) and inverse-solves the params for each
  target. Existing palette entries inside the polygon are treated as
  "known points" — new cells avoid sitting on top of them.

Smaller polish:

- The toolbar chip reads `× CANCEL` while the wizard is active.
- The hint banner above the chart is clickable once the polygon has
  3+ vertices: "✓ Click here to finish".
- The Anchor section shows how many entries are inside the polygon.
```

```bash
git add changelog/2026-05-18-exposure-propose-test-v2.md
git commit -m "$(cat <<'EOF'
changelog: propose-test v2 — all-params editor + area-uniform fill

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 4: Final pre-PR checks + push**

```bash
cd web && npx tsc --noEmit
cd web && npm test -- --run
cd web && npm run build > /dev/null 2>&1 && echo build-ok
cd /Users/jonzky/Documents/XTools/Reverse
uv run --active pytest tests/ -q --ignore=tests/test_storage_s3.py 2>&1 | tail -5
git push -u origin feat/exposure-propose-test-v2
gh pr create --draft --title "feat: propose-test v2 — all-params editor + area-uniform fill" --body "$(cat <<'EOF'
## Summary
Refines the propose-test wizard from PR #85:

- Wizard rail now shows all 6 base params as sliders. Varied param row(s) are locked with the resolved min..max highlighted; everything else is editable. Adjusting a non-varied param re-runs the curve/fill live (\"rotate\" the curve, shift the fill region).
- Fill mode replaces the forward (p1,p2) grid + polygon-filter with a polygon-area-uniform Poisson-disk-style sampler + Newton-based inverse-solver per target. Cells now actually fill the polygon. Existing palette entries inside the polygon act as known points — new cells avoid them.
- Toolbar chip toggles to \`× CANCEL\` while the wizard is active.
- Hint banner is clickable to close polygon once it has 3+ vertices.
- Anchor section shows how many entries are inside the polygon.

Spec: \`docs/superpowers/specs/2026-05-10-exposure-propose-test-v2-design.md\`
Plan: \`docs/superpowers/plans/2026-05-10-exposure-propose-test-v2.md\`

## Test plan
- [x] FE unit tests for partialDerivative (vs finite-difference, all 42 cases)
- [x] FE unit tests for inverseSolve (convergence, singular Jacobian, out-of-limits)
- [x] FE unit tests for samplePolygonArea (count, all-inside, min-distance, known-point avoidance, sparse degrade, concave)
- [x] FE unit tests for fillByInverseSolve (round-trip params↔indices, knownPoints respected, degenerate pair returns empty)
- [x] Component tests for the rail's 6-row editor (slider drag, locked row, pulse_width preset snap)
- [x] tsc clean, vitest 100%, npm run build OK
- [x] Backend pytest unaffected
- [x] Browser walkthrough on real material with palette entries

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)" 2>&1 | tail -3
```

Expected: PR opened. Note number, watch CI.

---

## Self-review

**Spec coverage:**

| Spec section | Task |
|---|---|
| User flow — toolbar chip toggle | T6 |
| User flow — banner clickable when 3+ vertices | T7 |
| User flow — anchor entries-inside count | T7 (derivation), T5 (display) |
| User flow — 6-row PARAMS editor | T5 (rail) + T7 (paramRows derivation) |
| User flow — fill produces N cells | T3 + T4 (math), T7 (call site) |
| Architecture — partialDerivative | T1 |
| Architecture — inverseSolve | T2 |
| Architecture — samplePolygonArea | T3 |
| Architecture — fillByInverseSolve | T4 |
| Architecture — rail editor structure | T5 |
| Architecture — toolbar chip toggle | T6 |
| Data flow — paramOverrides → effectiveBaseParams → preview | T7 |
| Edge cases — out-of-limits inverse-solve | T2 (returns null) |
| Edge cases — degenerate axis pair | T2 (singular Jacobian → null) |
| Edge cases — pulse_width snap to preset | T5 (rail), T7 (paramRows presets) |
| Edge cases — passes integer step | T5 (paramRow `step: 1` + integer slider) |
| Edge cases — sparse polygon partial fill | T3 (relax threshold), helperText surfaces in T7 |
| Testing — unit tests | T1-T4 |
| Testing — component tests | T5 |
| Testing — browser walkthrough | T8 |

**Placeholder scan:** No "TBD" / "TODO" / "Add appropriate error handling" patterns in the body. The plan-level note about `ALLOWED_PULSE_WIDTHS` says "verify in the actual file before committing" — that's a sanity-check, not a placeholder; the value `[2, 4, 8, 30, 60, 80, 100, 200]` is explicitly provided.

**Type consistency:**
- `ParamKey` is the v1 union `"power" | "speed" | "frequency" | "density"` (testable set). For PARAMS rows the key extends to include `"passes"` and `"pulse_width"` — this is captured in T5's `ParamRow` type and T7's `ParamRowKey`. Care taken in T1's `partialDerivative` signature to accept the wider key set (`ParamKey | "passes" | "pulse_width"`).
- `LaserParams` is consistent: `{ power, speed, frequency, density, passes, pulse_width }`.
- `LaserIndices` from `laserIndices.ts` is reused everywhere.
- `Polygon`, `IndexKey`, `LaserLimits`, `ParamRange` come from v1's `proposeTestMath.ts` unchanged.
- `ModeChoice` from v1's union: curve `{ mode, varyParam }` or fill `{ mode, varyParams }`. Unchanged.
- `FillCell` from v1: `{ paramValues: Partial<Record<ParamKey, number>>; x; y }`. Unchanged.
- `RangeReadout` and `ParamRow` are new in this plan, defined in T5, consumed in T7.
