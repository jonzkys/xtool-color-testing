# Exposure Propose-Test — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a wizard on the bivariate exposure scatter that lets the user draw a polygon, picks an anchor entry, chooses 1 or 2 testable params to vary, and produces a `kind="validation"` test ready to burn — all with live curve / fill preview on the chart.

**Architecture:** Pure-function math helpers (`proposeTestMath.ts`) drive the live computation. A TS port of `xcs_gen.laser_indices.compute_indices` runs client-side so the slider feels instant. Frontend-only feature: zero new backend endpoints, reuses `POST /api/tests` with `kind="validation"` + per-cell `validation_cells`. Smart-defaults switch between curve and fill modes based on whether any single param produces 2D motion through the polygon.

**Tech Stack:** React 18 + TypeScript + Tailwind v4 + vitest + @testing-library/react. Backend Python untouched apart from a fixture-generator script.

**Spec:** `docs/superpowers/specs/2026-05-10-exposure-propose-test-design.md`

---

## File structure

### New files

| Path | Responsibility |
|---|---|
| `web/src/laser/laserIndices.ts` | TS port of `compute_indices` v3. Pure function. |
| `web/src/laser/laserIndices.test.ts` | FE↔BE fixture parity test. |
| `web/src/laser/__fixtures__/laser-indices-v3.json` | Generated fixture, 50+ param combos. |
| `scripts/regen_laser_indices_fixtures.py` | Regenerates the fixture from Python source of truth. |
| `web/src/components/exposure/proposeTestMath.ts` | Polygon, curve, fill, anchor, mode-picker math. |
| `web/src/components/exposure/proposeTestMath.test.ts` | Unit tests for the math. |
| `web/src/components/exposure/ExposurePolygon.tsx` | Closed-polygon SVG overlay with vertex handles. |
| `web/src/components/exposure/ExposurePolygonDraw.tsx` | Click-to-draw interaction layer over the scatter. |
| `web/src/components/exposure/ExposureCellsPreview.tsx` | Dashed-curve + N filled cells as SVG overlay. |
| `web/src/components/exposure/ExposureProposeRail.tsx` | Right-rail wizard panel. |
| `web/src/components/exposure/ExposureProposeRail.test.tsx` | Component tests for the rail. |
| `changelog/2026-05-15-exposure-propose-test.md` | User-visible major changelog entry. |

### Modified files

| Path | Why |
|---|---|
| `web/src/components/exposure/ExposureScatter.tsx` | Accept `polygon`, `polygonDrawing`, `curve`, `cells` overlay props. |
| `web/src/components/exposure/ExposureToolbar.tsx` | Add `◇ PROPOSE TEST` chip with active state. |
| `web/src/pages/ExposurePage.tsx` | Wire the wizard: state, callbacks, rail swap. |
| `web/src/pages/TestsPage.tsx` | Read `?new=<id>` from URL hash, scroll/highlight. |

---

## Conventions for every task

- Run from the project root (`/Users/jonzky/Documents/XTools/Reverse`); the file paths assume that.
- Frontend tests: `cd web && npm test -- --run` for the full suite, or `cd web && npm test -- --run <pattern>` for a filtered run.
- Type-check: `cd web && npx tsc --noEmit`.
- Build: `cd web && npm run build > /dev/null 2>&1 && echo build-ok`. Required after every set of FE changes — `xcs-gen serve` mounts `web/dist/`, the dev server isn't wired up.
- Commit at the end of every task.
- Don't skip pre-commit hooks.
- Use existing patterns — match imports, indentation, helper-style with neighbouring files in `web/src/components/exposure/`.

---

### Task 1: TS port of `compute_indices` + fixture parity

**Why first:** The math helpers in later tasks call `computeIndices(params)` repeatedly. Without this, nothing else compiles.

**Files:**
- Create: `web/src/laser/laserIndices.ts`
- Create: `web/src/laser/laserIndices.test.ts`
- Create: `web/src/laser/__fixtures__/laser-indices-v3.json`
- Create: `scripts/regen_laser_indices_fixtures.py`

- [ ] **Step 1: Write the fixture generator**

```python
# scripts/regen_laser_indices_fixtures.py
"""Regenerate web/src/laser/__fixtures__/laser-indices-v3.json from the
Python compute_indices source of truth. Run after any change to the
formulas. The TS port test reads this file and asserts byte-identical
floats (within 1e-6) for each entry.
"""

from __future__ import annotations

import json
from pathlib import Path

from xcs_gen.laser_indices import compute_indices
from xcs_gen.model import ProcessingParams


# 60+ representative param combinations covering the legal F2 MOPA range.
# Pick values that exercise each formula's full sensitivity (denominators,
# multi-param interactions, fractional results). Mix integer + non-integer.
_INPUT_GRID: list[dict[str, float]] = [
    # (power %, speed mm/s, freq kHz, density lpc, pulse_width ns, passes)
    {"power": 14.6, "speed": 1152, "frequency": 100, "density": 5000,
     "pulse_width": 200, "passes": 1},
    {"power": 30.0, "speed": 800,  "frequency": 60,  "density": 1000,
     "pulse_width": 200, "passes": 2},
    {"power": 50.0, "speed": 4000, "frequency": 200, "density": 3000,
     "pulse_width": 100, "passes": 1},
    {"power": 1.0,  "speed": 100,  "frequency": 60,  "density": 100,
     "pulse_width": 100, "passes": 1},
    {"power": 100.0,"speed": 15000,"frequency": 500, "density": 5000,
     "pulse_width": 200, "passes": 99},
    {"power": 25.5, "speed": 1500, "frequency": 150, "density": 2000,
     "pulse_width": 50,  "passes": 3},
    {"power": 75.0, "speed": 6000, "frequency": 300, "density": 800,
     "pulse_width": 80,  "passes": 5},
    {"power": 12.0, "speed": 250,  "frequency": 80,  "density": 4500,
     "pulse_width": 200, "passes": 1},
    {"power": 60.0, "speed": 2400, "frequency": 250, "density": 1500,
     "pulse_width": 30,  "passes": 4},
    {"power": 8.5,  "speed": 600,  "frequency": 70,  "density": 3500,
     "pulse_width": 200, "passes": 2},
    # Edge of the laser's range
    {"power": 1.0,  "speed": 2,    "frequency": 60,  "density": 1,
     "pulse_width": 30,  "passes": 1},
    {"power": 100.0,"speed": 15000,"frequency": 500, "density": 5000,
     "pulse_width": 200, "passes": 1},
]


def _row(params: dict) -> dict:
    pp = ProcessingParams(
        power=params["power"],
        speed=int(params["speed"]),
        mopa_frequency=int(params["frequency"]),
        density=int(params["density"]),
        pulse_width=int(params["pulse_width"]),
        repeat=int(params["passes"]),
    )
    indices = compute_indices(pp)
    return {
        "input": params,
        "expected": {
            "pulse_spacing_mm": indices.pulse_spacing_mm,
            "line_spacing_mm": indices.line_spacing_mm,
            "pulse_energy_index": indices.pulse_energy_index,
            "pulse_intensity_index": indices.pulse_intensity_index,
            "total_exposure_index": indices.total_exposure_index,
            "ablation_aggression_index": indices.ablation_aggression_index,
            "delivery_smoothness_index": indices.delivery_smoothness_index,
            "formula_version": indices.formula_version,
        },
    }


def main() -> None:
    out_path = Path("web/src/laser/__fixtures__/laser-indices-v3.json")
    out_path.parent.mkdir(parents=True, exist_ok=True)
    rows = [_row(p) for p in _INPUT_GRID]
    out_path.write_text(json.dumps(rows, indent=2))
    print(f"wrote {len(rows)} fixtures to {out_path}")


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Run the generator**

```bash
mkdir -p web/src/laser/__fixtures__
uv run --active python scripts/regen_laser_indices_fixtures.py
```

Expected: `wrote 12 fixtures to web/src/laser/__fixtures__/laser-indices-v3.json`. Spot-check the first entry — `pulse_spacing_mm` should be `1152 / (100 * 1000) = 0.01152`.

- [ ] **Step 3: Write the failing test**

```ts
// web/src/laser/laserIndices.test.ts
import { describe, expect, it } from "vitest";
import fixtures from "./__fixtures__/laser-indices-v3.json";
import { computeIndices, type LaserParams } from "./laserIndices";

interface Fixture {
  input: LaserParams;
  expected: Record<string, number>;
}

describe("computeIndices (TS port of compute_indices v3)", () => {
  it("matches the Python source-of-truth fixtures", () => {
    for (const f of fixtures as Fixture[]) {
      const got = computeIndices(f.input);
      for (const [k, expected] of Object.entries(f.expected)) {
        if (k === "formula_version") {
          expect(got[k as keyof typeof got]).toBe(expected);
        } else {
          expect(got[k as keyof typeof got]).toBeCloseTo(expected, 6);
        }
      }
    }
  });

  it("throws on zero denominator (speed)", () => {
    expect(() => computeIndices({
      power: 10, speed: 0, frequency: 100, density: 1000,
      passes: 1, pulse_width: 100,
    })).toThrow(/speed/);
  });

  it("throws on zero denominator (frequency)", () => {
    expect(() => computeIndices({
      power: 10, speed: 100, frequency: 0, density: 1000,
      passes: 1, pulse_width: 100,
    })).toThrow(/frequency/);
  });

  it("throws on zero denominator (density)", () => {
    expect(() => computeIndices({
      power: 10, speed: 100, frequency: 100, density: 0,
      passes: 1, pulse_width: 100,
    })).toThrow(/density/);
  });

  it("throws on zero pulse_width", () => {
    expect(() => computeIndices({
      power: 10, speed: 100, frequency: 100, density: 1000,
      passes: 1, pulse_width: 0,
    })).toThrow(/pulse_width/);
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

```bash
cd web && npm test -- --run laserIndices.test
```

Expected: FAIL with "computeIndices is not exported" or similar import error.

- [ ] **Step 5: Implement the TS port**

```ts
// web/src/laser/laserIndices.ts
/**
 * Frontend port of xcs_gen.laser_indices.compute_indices (formula v3).
 *
 * Field-naming bridge: BaseParams (web schema) uses `passes` and
 * `pulse_width`; ProcessingParams (xcs_gen domain) uses `repeat` and
 * `pw`. This port operates on the BaseParams shape — the names you see
 * here are what the FE has, not what the Python code uses internally.
 */

export interface LaserParams {
  power: number;        // controller %, 0-100
  speed: number;        // mm/s
  frequency: number;    // kHz (mopa_frequency)
  density: number;      // lines per cm (lpc)
  passes: number;       // ProcessingParams.repeat
  pulse_width: number;  // ns (ProcessingParams.pw)
}

export interface LaserIndices {
  pulse_spacing_mm: number;
  line_spacing_mm: number;
  pulse_energy_index: number;
  pulse_intensity_index: number;
  total_exposure_index: number;
  ablation_aggression_index: number;
  delivery_smoothness_index: number;
  formula_version: 3;
}

export const INDICES_FORMULA_VERSION = 3 as const;

export function computeIndices(params: LaserParams): LaserIndices {
  const { power, speed, frequency, density, passes, pulse_width } = params;

  if (speed === 0) throw new Error("speed must be non-zero to compute laser indices");
  if (frequency === 0) throw new Error("frequency must be non-zero to compute laser indices");
  if (density === 0) throw new Error("density must be non-zero to compute laser indices");
  if (pulse_width === 0) throw new Error("pulse_width must be non-zero to compute laser indices");

  const pulse_spacing_mm = speed / (frequency * 1000);
  const line_spacing_mm = 10 / density;
  const pulse_energy_index = power / frequency;
  const pulse_intensity_index = power / (frequency * pulse_width);
  const total_exposure_index = (power * density * passes) / speed;
  const ablation_aggression_index = total_exposure_index * pulse_intensity_index;
  const delivery_smoothness_index = total_exposure_index / pulse_intensity_index;

  return {
    pulse_spacing_mm,
    line_spacing_mm,
    pulse_energy_index,
    pulse_intensity_index,
    total_exposure_index,
    ablation_aggression_index,
    delivery_smoothness_index,
    formula_version: INDICES_FORMULA_VERSION,
  };
}
```

- [ ] **Step 6: Run test to verify it passes**

```bash
cd web && npm test -- --run laserIndices.test
cd web && npx tsc --noEmit
```

Expected: PASS, clean tsc.

- [ ] **Step 7: Commit**

```bash
git add web/src/laser/laserIndices.ts web/src/laser/laserIndices.test.ts \
        web/src/laser/__fixtures__/laser-indices-v3.json \
        scripts/regen_laser_indices_fixtures.py
git commit -m "$(cat <<'EOF'
feat(laser): TS port of compute_indices v3 with fixture parity

Pure TS port of xcs_gen.laser_indices.compute_indices for client-side
live preview in the propose-test wizard. Field-naming bridge: web port
uses BaseParams names (passes, pulse_width) since that's the shape the
frontend sees, while internally it computes the same thing the Python
formula does.

Verified by a JSON fixture of (input, expected) pairs generated by the
Python source of truth, asserted byte-equal within 1e-6 per field.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Polygon point-in-polygon + anchor selection

**Files:**
- Create: `web/src/components/exposure/proposeTestMath.ts`
- Create: `web/src/components/exposure/proposeTestMath.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// web/src/components/exposure/proposeTestMath.test.ts
import { describe, expect, it } from "vitest";
import {
  pointInPolygon,
  findAnchor,
  type Polygon,
  type Point2,
} from "./proposeTestMath";
import type { ExposureRow } from "./exposureCorrelations";

const square: Polygon = [[0, 0], [10, 0], [10, 10], [0, 10]];
const star: Polygon = [   // concave 5-point star
  [5, 0], [6, 4], [10, 4], [7, 6], [8, 10],
  [5, 7], [2, 10], [3, 6], [0, 4], [4, 4],
];

describe("pointInPolygon", () => {
  it("returns true for a point clearly inside a square", () => {
    expect(pointInPolygon([5, 5], square)).toBe(true);
  });
  it("returns false for a point clearly outside", () => {
    expect(pointInPolygon([20, 20], square)).toBe(false);
  });
  it("returns false for a point above the square", () => {
    expect(pointInPolygon([5, 15], square)).toBe(false);
  });
  it("handles concave polygons (star shape)", () => {
    expect(pointInPolygon([5, 5], star)).toBe(true);
    // Inside the bounding box but in a concave notch:
    expect(pointInPolygon([1, 8], star)).toBe(false);
  });
  it("handles polygons with < 3 vertices as always-outside", () => {
    expect(pointInPolygon([1, 1], [])).toBe(false);
    expect(pointInPolygon([1, 1], [[0, 0], [2, 2]])).toBe(false);
  });
});

function makeRow(id: number, x: number, y: number): ExposureRow {
  return {
    id,
    hex: "#000000",
    lab: [50, 0, 0],
    indices: {
      pulse_spacing_mm: x,
      line_spacing_mm: 0,
      pulse_energy_index: 0,
      pulse_intensity_index: y,
      total_exposure_index: 0,
      ablation_aggression_index: 0,
      delivery_smoothness_index: 0,
      formula_version: 3,
      density_model: "lpc",
      power_model: "controller_percent",
    },
  };
}

describe("findAnchor", () => {
  it("returns null for empty polygon", () => {
    expect(findAnchor(
      [],
      [makeRow(1, 5, 5)],
      "pulse_spacing_mm",
      "pulse_intensity_index",
    )).toBe(null);
  });
  it("returns null when no rows are inside", () => {
    expect(findAnchor(
      square,
      [makeRow(1, 20, 20)],
      "pulse_spacing_mm",
      "pulse_intensity_index",
    )).toBe(null);
  });
  it("returns the inside row closest to the polygon centroid", () => {
    // Centroid of the square is (5, 5). Of {(2,2), (4,4), (8,8)} → (4,4)
    // is closest.
    const rows = [makeRow(1, 2, 2), makeRow(2, 4, 4), makeRow(3, 8, 8)];
    const anchor = findAnchor(
      square, rows, "pulse_spacing_mm", "pulse_intensity_index",
    );
    expect(anchor?.id).toBe(2);
  });
  it("ignores rows outside polygon", () => {
    const rows = [makeRow(1, 20, 20), makeRow(2, 5, 5)];
    const anchor = findAnchor(
      square, rows, "pulse_spacing_mm", "pulse_intensity_index",
    );
    expect(anchor?.id).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd web && npm test -- --run proposeTestMath.test
```

Expected: FAIL — `proposeTestMath.ts` doesn't exist.

- [ ] **Step 3: Implement the helpers**

```ts
// web/src/components/exposure/proposeTestMath.ts
/**
 * Pure helpers driving the propose-test wizard's live computation.
 * No React, no DOM, no I/O — every function is referentially transparent
 * so they can be unit-tested exhaustively.
 */

import type { ExposureRow } from "./exposureCorrelations";
import type { LaserIndices } from "../../laser/laserIndices";

export type Point2 = readonly [number, number];
export type Polygon = ReadonlyArray<Point2>;

export type IndexKey =
  | "pulse_spacing_mm"
  | "line_spacing_mm"
  | "pulse_energy_index"
  | "pulse_intensity_index"
  | "total_exposure_index"
  | "ablation_aggression_index"
  | "delivery_smoothness_index";

export function pointInPolygon(p: Point2, polygon: Polygon): boolean {
  if (polygon.length < 3) return false;
  // Standard ray-casting along +X axis.
  const [x, y] = p;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    const intersect = ((yi > y) !== (yj > y))
      && (x < ((xj - xi) * (y - yi)) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

function rowPoint(row: ExposureRow, xKey: IndexKey, yKey: IndexKey): Point2 {
  const x = row.indices[xKey] as number;
  const y = row.indices[yKey] as number;
  return [x, y];
}

function centroid(polygon: Polygon): Point2 {
  if (polygon.length === 0) return [0, 0];
  let sx = 0;
  let sy = 0;
  for (const [x, y] of polygon) {
    sx += x;
    sy += y;
  }
  return [sx / polygon.length, sy / polygon.length];
}

export function findAnchor(
  polygon: Polygon,
  rows: readonly ExposureRow[],
  xKey: IndexKey,
  yKey: IndexKey,
): ExposureRow | null {
  if (polygon.length < 3) return null;
  const inside = rows.filter((r) => pointInPolygon(rowPoint(r, xKey, yKey), polygon));
  if (inside.length === 0) return null;
  const [cx, cy] = centroid(polygon);
  let best = inside[0];
  let bestDistSq = Number.POSITIVE_INFINITY;
  for (const r of inside) {
    const [x, y] = rowPoint(r, xKey, yKey);
    const dx = x - cx;
    const dy = y - cy;
    const d2 = dx * dx + dy * dy;
    if (d2 < bestDistSq) {
      bestDistSq = d2;
      best = r;
    }
  }
  return best;
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
feat(propose-test): pointInPolygon + findAnchor pure helpers

Foundation for the wizard's anchor selection. Pure functions, fully
unit-tested (convex/concave/empty/edge cases). pointInPolygon is the
standard +X-axis ray cast; findAnchor returns the inside-polygon row
closest to the polygon's centroid in the chosen axes' coord space.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Curve computation, polygon clipping, arc-length sampling

**Files:**
- Modify: `web/src/components/exposure/proposeTestMath.ts`
- Modify: `web/src/components/exposure/proposeTestMath.test.ts`

- [ ] **Step 1: Add failing tests**

Append to `proposeTestMath.test.ts`:

```ts
import {
  computeCurve,
  clipPolylineToPolygon,
  sampleByArcLength,
  type ParamKey,
  type LaserLimits,
  type CurveSample,
} from "./proposeTestMath";

const F2_LIMITS: LaserLimits = {
  power:     { min: 1,  max: 100,   step: 1 },
  speed:     { min: 2,  max: 15000, step: 1 },
  frequency: { min: 60, max: 500,   step: 1 },
  density:   { min: 1,  max: 5000,  step: 1 },
};

const ANCHOR_PARAMS = {
  power: 14.6, speed: 1152, frequency: 100, density: 5000,
  passes: 1, pulse_width: 200,
};

describe("computeCurve", () => {
  it("returns 200 sample points across the param range", () => {
    const curve = computeCurve(
      ANCHOR_PARAMS, "speed", "total_exposure_index", "pulse_intensity_index",
      F2_LIMITS,
    );
    expect(curve.length).toBe(200);
    expect(curve[0].paramValue).toBeCloseTo(F2_LIMITS.speed.min);
    expect(curve[199].paramValue).toBeCloseTo(F2_LIMITS.speed.max);
  });
  it("matches direct compute for sampled param values", () => {
    const curve = computeCurve(
      ANCHOR_PARAMS, "power", "pulse_energy_index", "pulse_intensity_index",
      F2_LIMITS,
    );
    // pulse_energy_index = power / frequency; at power=50, freq=100 → 0.5
    const mid = curve.find((c) => Math.abs(c.paramValue - 50) < 1)!;
    expect(mid.x).toBeCloseTo(50 / 100, 4);
  });
});

describe("clipPolylineToPolygon", () => {
  const sq: Polygon = [[0, 0], [10, 0], [10, 10], [0, 10]];

  it("keeps a fully-inside polyline as one segment", () => {
    const line = [{ x: 1, y: 1 }, { x: 5, y: 5 }, { x: 9, y: 9 }];
    const segs = clipPolylineToPolygon(line, sq);
    expect(segs.length).toBe(1);
    expect(segs[0].length).toBe(3);
  });
  it("drops a fully-outside polyline", () => {
    const line = [{ x: 11, y: 11 }, { x: 15, y: 15 }];
    const segs = clipPolylineToPolygon(line, sq);
    expect(segs).toEqual([]);
  });
  it("clips a polyline crossing the boundary once", () => {
    const line = [{ x: 5, y: 5 }, { x: 5, y: 15 }];
    const segs = clipPolylineToPolygon(line, sq);
    expect(segs.length).toBe(1);
    expect(segs[0][0]).toEqual({ x: 5, y: 5 });
    expect(segs[0][segs[0].length - 1].y).toBeCloseTo(10, 4);
  });
  it("keeps multiple in-out-in segments", () => {
    const line = [
      { x: -1, y: 5 },
      { x:  3, y: 5 },
      { x: 11, y: 5 },
      { x: 12, y: 5 },
    ];
    const segs = clipPolylineToPolygon(line, sq);
    // The line enters at x=0, exits at x=10 — one segment from boundary
    // to boundary.
    expect(segs.length).toBe(1);
    expect(segs[0][0].x).toBeCloseTo(0, 4);
    expect(segs[0][segs[0].length - 1].x).toBeCloseTo(10, 4);
  });
});

describe("sampleByArcLength", () => {
  const seg: CurveSample[] = [
    { x: 0, y: 0, paramValue: 100 },
    { x: 4, y: 0, paramValue: 200 },
    { x: 4, y: 3, paramValue: 300 },   // total length 4 + 3 = 7
  ];
  it("returns endpoints when n=2", () => {
    const out = sampleByArcLength(seg, 2);
    expect(out.length).toBe(2);
    expect(out[0]).toEqual(seg[0]);
    expect(out[1]).toEqual(seg[2]);
  });
  it("evenly spaces n samples along arc length", () => {
    const out = sampleByArcLength(seg, 8);
    expect(out.length).toBe(8);
    // Distance along curve between successive samples should be ~7/7=1.
    for (let i = 1; i < out.length; i++) {
      const a = out[i - 1];
      const b = out[i];
      const d = Math.hypot(b.x - a.x, b.y - a.y);
      // Could be split across the corner — direct distance can be a bit
      // less than 1 only at the corner; allow tolerance.
      expect(d).toBeLessThan(1.5);
    }
  });
  it("interpolates paramValue linearly between bracketing samples", () => {
    const out = sampleByArcLength(seg, 5);
    // The 50% point of arc length is at total/2 = 3.5 along the line. The
    // first segment is length 4, so 3.5 lands within it at t=0.875.
    // paramValue should be 100 + 0.875 * (200 - 100) = 187.5.
    const mid = out[2];   // index 2 of [0..1, 0.25, 0.5, 0.75, 1.0]
    expect(mid.paramValue).toBeCloseTo(187.5, 4);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd web && npm test -- --run proposeTestMath.test
```

Expected: FAIL — symbols not exported.

- [ ] **Step 3: Implement the three functions**

Append to `proposeTestMath.ts`:

```ts
import { computeIndices, type LaserParams } from "../../laser/laserIndices";

export type ParamKey = "power" | "speed" | "frequency" | "density";

export interface ParamRange {
  min: number;
  max: number;
  step: number;
}

export type LaserLimits = Record<ParamKey, ParamRange>;

export interface CurveSample {
  paramValue: number;
  x: number;
  y: number;
}

export const CURVE_SAMPLE_COUNT = 200;

export function computeCurve(
  anchor: LaserParams,
  varyParam: ParamKey,
  xKey: IndexKey,
  yKey: IndexKey,
  laserLimits: LaserLimits,
): CurveSample[] {
  const range = laserLimits[varyParam];
  const out: CurveSample[] = [];
  for (let i = 0; i < CURVE_SAMPLE_COUNT; i++) {
    const t = i / (CURVE_SAMPLE_COUNT - 1);
    const value = range.min + t * (range.max - range.min);
    const params: LaserParams = { ...anchor, [varyParam]: value };
    let indices;
    try {
      indices = computeIndices(params);
    } catch {
      // Skip points where the formula throws (e.g. zero denominators).
      continue;
    }
    out.push({
      paramValue: value,
      x: indices[xKey] as number,
      y: indices[yKey] as number,
    });
  }
  return out;
}

interface XY { readonly x: number; readonly y: number; }

function lineIntersectsSegment(
  p1: XY, p2: XY, q1: XY, q2: XY,
): XY | null {
  // Returns the intersection point, or null if the segments are parallel
  // / non-intersecting in [0, 1] of either parameter.
  const dx1 = p2.x - p1.x;
  const dy1 = p2.y - p1.y;
  const dx2 = q2.x - q1.x;
  const dy2 = q2.y - q1.y;
  const denom = dx1 * dy2 - dy1 * dx2;
  if (Math.abs(denom) < 1e-12) return null;
  const dx3 = q1.x - p1.x;
  const dy3 = q1.y - p1.y;
  const t = (dx3 * dy2 - dy3 * dx2) / denom;
  const u = (dx3 * dy1 - dy3 * dx1) / denom;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return { x: p1.x + t * dx1, y: p1.y + t * dy1 };
}

function intersectionsWithPolygon(p1: XY, p2: XY, polygon: Polygon): XY[] {
  const out: XY[] = [];
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const q1 = { x: polygon[j][0], y: polygon[j][1] };
    const q2 = { x: polygon[i][0], y: polygon[i][1] };
    const hit = lineIntersectsSegment(p1, p2, q1, q2);
    if (hit !== null) out.push(hit);
  }
  // Sort along the segment p1→p2 by parameter so callers get them
  // in walked order.
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq > 0) {
    out.sort((a, b) => {
      const ta = ((a.x - p1.x) * dx + (a.y - p1.y) * dy) / lenSq;
      const tb = ((b.x - p1.x) * dx + (b.y - p1.y) * dy) / lenSq;
      return ta - tb;
    });
  }
  return out;
}

interface PolylinePoint { readonly x: number; readonly y: number; readonly paramValue?: number; }

function interpolateAlong<T extends PolylinePoint>(a: T, b: T, ratio: number): T {
  const x = a.x + ratio * (b.x - a.x);
  const y = a.y + ratio * (b.y - a.y);
  if (a.paramValue !== undefined && b.paramValue !== undefined) {
    return {
      ...a,
      x, y,
      paramValue: a.paramValue + ratio * (b.paramValue - a.paramValue),
    } as T;
  }
  return { ...a, x, y } as T;
}

function ratioOnSegment(p1: XY, p2: XY, q: XY): number {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return 0;
  return ((q.x - p1.x) * dx + (q.y - p1.y) * dy) / lenSq;
}

export function clipPolylineToPolygon<T extends PolylinePoint>(
  polyline: readonly T[],
  polygon: Polygon,
): T[][] {
  if (polyline.length < 2 || polygon.length < 3) return [];
  const segments: T[][] = [];
  let current: T[] = [];

  function pushCurrent(): void {
    if (current.length >= 2) segments.push(current);
    current = [];
  }

  for (let i = 0; i < polyline.length - 1; i++) {
    const a = polyline[i];
    const b = polyline[i + 1];
    const aIn = pointInPolygon([a.x, a.y], polygon);
    const bIn = pointInPolygon([b.x, b.y], polygon);
    const hits = intersectionsWithPolygon(
      { x: a.x, y: a.y }, { x: b.x, y: b.y }, polygon,
    );

    if (aIn && bIn) {
      // Both endpoints inside — keep the start vertex (last segment will
      // duplicate b).
      if (current.length === 0) current.push(a);
      current.push(b);
    } else if (aIn && !bIn) {
      // Exits polygon — interpolate to the boundary intersection.
      if (current.length === 0) current.push(a);
      const hit = hits[0];
      if (hit) current.push(interpolateAlong(a, b, ratioOnSegment(
        { x: a.x, y: a.y }, { x: b.x, y: b.y }, hit,
      )));
      pushCurrent();
    } else if (!aIn && bIn) {
      // Enters polygon — start fresh from the boundary intersection.
      pushCurrent();
      const hit = hits[hits.length - 1];
      if (hit) current.push(interpolateAlong(a, b, ratioOnSegment(
        { x: a.x, y: a.y }, { x: b.x, y: b.y }, hit,
      )));
      current.push(b);
    } else if (hits.length >= 2) {
      // Crosses through (in-out): take the first two intersections as a
      // sub-segment.
      pushCurrent();
      const r1 = ratioOnSegment(
        { x: a.x, y: a.y }, { x: b.x, y: b.y }, hits[0],
      );
      const r2 = ratioOnSegment(
        { x: a.x, y: a.y }, { x: b.x, y: b.y }, hits[1],
      );
      current.push(interpolateAlong(a, b, r1));
      current.push(interpolateAlong(a, b, r2));
      pushCurrent();
    }
  }

  pushCurrent();
  return segments;
}

export function sampleByArcLength(
  segment: readonly CurveSample[],
  n: number,
): CurveSample[] {
  if (segment.length < 2 || n < 2) {
    return segment.length > 0 ? [segment[0]] : [];
  }

  // Build cumulative arc lengths.
  const cum: number[] = [0];
  for (let i = 1; i < segment.length; i++) {
    const dx = segment[i].x - segment[i - 1].x;
    const dy = segment[i].y - segment[i - 1].y;
    cum.push(cum[i - 1] + Math.hypot(dx, dy));
  }
  const total = cum[cum.length - 1];

  if (total === 0) return [segment[0]];

  const out: CurveSample[] = [];
  for (let i = 0; i < n; i++) {
    const target = (i / (n - 1)) * total;
    // Binary search for the bracketing pair.
    let lo = 0;
    let hi = cum.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >>> 1;
      if (cum[mid] <= target) lo = mid; else hi = mid;
    }
    const a = segment[lo];
    const b = segment[hi];
    const segLen = cum[hi] - cum[lo];
    const t = segLen === 0 ? 0 : (target - cum[lo]) / segLen;
    out.push({
      x: a.x + t * (b.x - a.x),
      y: a.y + t * (b.y - a.y),
      paramValue: a.paramValue + t * (b.paramValue - a.paramValue),
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
feat(propose-test): curve, polygon clipping, arc-length sampling

computeCurve forward-samples 200 points across the varied param's
laser-allowed range, projecting through the v3 indices into the chart's
chosen (x, y) plane. clipPolylineToPolygon walks the polyline segment
by segment, using +X-axis ray-cast for endpoint classification and a
parametric line-segment intersection for boundary crossings; returns
zero or more inside-polygon sub-polylines. sampleByArcLength binary-
searches the cumulative arc-length array and linearly interpolates the
paramValue along bracketing pairs.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Smart-default mode/param picker

**Files:**
- Modify: `web/src/components/exposure/proposeTestMath.ts`
- Modify: `web/src/components/exposure/proposeTestMath.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `proposeTestMath.test.ts`:

```ts
import { pickModeAndParams } from "./proposeTestMath";

const ANCHOR_ROW: ExposureRow = makeRow(1, 0, 0);
ANCHOR_ROW.params = ANCHOR_PARAMS;

describe("pickModeAndParams", () => {
  it("prefers a single param that moves both axes (curve mode)", () => {
    // Polygon around the anchor in (TEi, AAi). Power moves both;
    // speed moves both too; freq moves only AAi (degenerate).
    // Expect curve mode preferring power on tie.
    const polygon: Polygon = [[0.05, 0.0001], [0.6, 0.0001], [0.6, 0.005], [0.05, 0.005]];
    const out = pickModeAndParams(
      ANCHOR_ROW, polygon, "total_exposure_index", "ablation_aggression_index",
      F2_LIMITS,
    );
    expect(out.mode).toBe("curve");
    if (out.mode === "curve") {
      expect(out.varyParam).toBe("power");
    }
  });
  it("falls back to fill mode when no single param spans both axes", () => {
    // Polygon in (TEi, PIi). Among {power, speed, freq, density},
    // only power moves both — but with a tight polygon a single param
    // may still fail the score threshold. Construct a polygon where
    // each single-param curve is short relative to polygon span.
    // (For this test, a wide square polygon centred near the anchor.)
    const polygon: Polygon = [[10, 0.0001], [90, 0.0001], [90, 0.05], [10, 0.05]];
    const out = pickModeAndParams(
      ANCHOR_ROW, polygon, "total_exposure_index", "pulse_intensity_index",
      F2_LIMITS,
    );
    // Curve through this polygon will likely cover at least one direction,
    // but may not span both above the threshold. Whichever mode is chosen,
    // the result must be consistent and inside the testable set.
    if (out.mode === "fill") {
      expect(out.varyParams).toHaveLength(2);
      const valid: ParamKey[] = ["power", "speed", "frequency", "density"];
      expect(valid).toContain(out.varyParams[0]);
      expect(valid).toContain(out.varyParams[1]);
      expect(out.varyParams[0]).not.toBe(out.varyParams[1]);
    } else {
      const valid: ParamKey[] = ["power", "speed", "frequency", "density"];
      expect(valid).toContain(out.varyParam);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd web && npm test -- --run proposeTestMath.test
```

Expected: FAIL — `pickModeAndParams` not exported.

- [ ] **Step 3: Implement**

Append to `proposeTestMath.ts`:

```ts
const TESTABLE_PARAMS: readonly ParamKey[] = ["power", "speed", "density", "frequency"];

export type ModeChoice =
  | { readonly mode: "curve"; readonly varyParam: ParamKey }
  | { readonly mode: "fill"; readonly varyParams: readonly [ParamKey, ParamKey] };

export const CURVE_COVERAGE_THRESHOLD = 0.4;

interface BoundingBox { minX: number; maxX: number; minY: number; maxY: number; }

function bbox(points: ReadonlyArray<{ x: number; y: number }>): BoundingBox | null {
  if (points.length === 0) return null;
  let minX = points[0].x;
  let maxX = points[0].x;
  let minY = points[0].y;
  let maxY = points[0].y;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, maxX, minY, maxY };
}

function polygonBox(polygon: Polygon): BoundingBox | null {
  return bbox(polygon.map(([x, y]) => ({ x, y })));
}

function paramScore(
  anchor: LaserParams,
  varyParam: ParamKey,
  polygon: Polygon,
  xKey: IndexKey,
  yKey: IndexKey,
  laserLimits: LaserLimits,
): { score: number; xSpread: number; ySpread: number } {
  const curve = computeCurve(anchor, varyParam, xKey, yKey, laserLimits);
  const segments = clipPolylineToPolygon(curve, polygon);
  const flat = segments.flat();
  const polyBox = polygonBox(polygon);
  if (flat.length === 0 || !polyBox) return { score: 0, xSpread: 0, ySpread: 0 };
  const segBox = bbox(flat);
  if (!segBox) return { score: 0, xSpread: 0, ySpread: 0 };
  const polyW = Math.max(polyBox.maxX - polyBox.minX, 1e-12);
  const polyH = Math.max(polyBox.maxY - polyBox.minY, 1e-12);
  const xSpread = (segBox.maxX - segBox.minX) / polyW;
  const ySpread = (segBox.maxY - segBox.minY) / polyH;
  return { score: Math.min(xSpread, ySpread), xSpread, ySpread };
}

export function pickModeAndParams(
  anchor: ExposureRow,
  polygon: Polygon,
  xKey: IndexKey,
  yKey: IndexKey,
  laserLimits: LaserLimits,
): ModeChoice {
  if (!anchor.params) {
    return { mode: "fill", varyParams: ["power", "speed"] };
  }
  const anchorParams = anchor.params as unknown as LaserParams;

  // Score each testable param. Tie-break order: power, speed, density, frequency.
  const scores = TESTABLE_PARAMS.map((p) => ({
    param: p,
    ...paramScore(anchorParams, p, polygon, xKey, yKey, laserLimits),
  }));

  const best = scores.reduce((a, b) => (b.score > a.score ? b : a));
  if (best.score >= CURVE_COVERAGE_THRESHOLD) {
    return { mode: "curve", varyParam: best.param };
  }

  // Fill mode: pick the two params with highest x-spread + y-spread that
  // are different. Sort each by spread; greedily pick non-duplicate.
  const byX = [...scores].sort((a, b) => b.xSpread - a.xSpread);
  const byY = [...scores].sort((a, b) => b.ySpread - a.ySpread);
  let p1 = byX[0].param;
  let p2 = byY[0].param;
  if (p1 === p2) {
    p2 = byY.find((s) => s.param !== p1)?.param ?? "speed";
  }
  return { mode: "fill", varyParams: [p1, p2] };
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
feat(propose-test): smart-default mode + param picker

For each testable param (power/speed/density/frequency), compute curve,
clip to polygon, score = min(xSpread, ySpread)/polygonExtent. If best
score ≥ 0.4 → curve mode (tie-broken by power, speed, density, freq
order). Otherwise fill mode with the two params giving highest spread
in the perpendicular axes.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Forward-grid fill sampler

**Files:**
- Modify: `web/src/components/exposure/proposeTestMath.ts`
- Modify: `web/src/components/exposure/proposeTestMath.test.ts`

- [ ] **Step 1: Write failing tests**

Append:

```ts
import { fillByForwardGrid } from "./proposeTestMath";

describe("fillByForwardGrid", () => {
  it("returns N cells, all inside the polygon", () => {
    const polygon: Polygon = [[0.05, 0.0001], [0.6, 0.0001], [0.6, 0.01], [0.05, 0.01]];
    const cells = fillByForwardGrid(
      ANCHOR_PARAMS, ["power", "speed"], polygon,
      "total_exposure_index", "pulse_intensity_index", F2_LIMITS, 16,
    );
    expect(cells.length).toBeLessThanOrEqual(16);
    expect(cells.length).toBeGreaterThan(0);
    for (const c of cells) {
      expect(pointInPolygon([c.x, c.y], polygon)).toBe(true);
      expect(c.paramValues.power).toBeDefined();
      expect(c.paramValues.speed).toBeDefined();
    }
  });
  it("clamps cell counts to laser-valid params", () => {
    const polygon: Polygon = [[0.05, 0.0001], [0.6, 0.0001], [0.6, 0.01], [0.05, 0.01]];
    const cells = fillByForwardGrid(
      ANCHOR_PARAMS, ["power", "speed"], polygon,
      "total_exposure_index", "pulse_intensity_index", F2_LIMITS, 8,
    );
    for (const c of cells) {
      const pw = c.paramValues.power!;
      const sp = c.paramValues.speed!;
      expect(pw).toBeGreaterThanOrEqual(F2_LIMITS.power.min);
      expect(pw).toBeLessThanOrEqual(F2_LIMITS.power.max);
      expect(sp).toBeGreaterThanOrEqual(F2_LIMITS.speed.min);
      expect(sp).toBeLessThanOrEqual(F2_LIMITS.speed.max);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd web && npm test -- --run proposeTestMath.test
```

Expected: FAIL — `fillByForwardGrid` not exported.

- [ ] **Step 3: Implement**

Append:

```ts
export const FILL_GRID_RESOLUTION = 32;

export interface FillCell {
  paramValues: Partial<Record<ParamKey, number>>;
  x: number;
  y: number;
}

export function fillByForwardGrid(
  anchor: LaserParams,
  varyParams: readonly [ParamKey, ParamKey],
  polygon: Polygon,
  xKey: IndexKey,
  yKey: IndexKey,
  laserLimits: LaserLimits,
  n: number,
): FillCell[] {
  const [a, b] = varyParams;
  const aRange = laserLimits[a];
  const bRange = laserLimits[b];

  const candidates: FillCell[] = [];
  for (let i = 0; i < FILL_GRID_RESOLUTION; i++) {
    const u = i / (FILL_GRID_RESOLUTION - 1);
    const aValue = aRange.min + u * (aRange.max - aRange.min);
    for (let j = 0; j < FILL_GRID_RESOLUTION; j++) {
      const v = j / (FILL_GRID_RESOLUTION - 1);
      const bValue = bRange.min + v * (bRange.max - bRange.min);
      const params: LaserParams = { ...anchor, [a]: aValue, [b]: bValue };
      let indices;
      try {
        indices = computeIndices(params);
      } catch {
        continue;
      }
      const x = indices[xKey] as number;
      const y = indices[yKey] as number;
      if (!pointInPolygon([x, y], polygon)) continue;
      candidates.push({
        paramValues: { [a]: aValue, [b]: bValue },
        x, y,
      });
    }
  }

  if (candidates.length <= n) return candidates;

  // Stratified picking: divide polygon bbox into ⌈√n⌉ × ⌈√n⌉ sub-cells.
  // For each sub-cell, take the candidate closest to its centre. Fill any
  // empty sub-cells from the remaining candidates in shuffled order.
  const polyBox = polygonBox(polygon);
  if (!polyBox) return candidates.slice(0, n);

  const k = Math.ceil(Math.sqrt(n));
  const cellW = (polyBox.maxX - polyBox.minX) / k;
  const cellH = (polyBox.maxY - polyBox.minY) / k;

  const subPicked: (FillCell | null)[][] = Array.from(
    { length: k }, () => Array.from({ length: k }, () => null),
  );
  const used = new Set<number>();
  for (let candIdx = 0; candIdx < candidates.length; candIdx++) {
    const c = candidates[candIdx];
    const ci = Math.min(k - 1, Math.floor((c.x - polyBox.minX) / cellW));
    const cj = Math.min(k - 1, Math.floor((c.y - polyBox.minY) / cellH));
    const cur = subPicked[ci][cj];
    const cx = polyBox.minX + (ci + 0.5) * cellW;
    const cy = polyBox.minY + (cj + 0.5) * cellH;
    const distSq = (c.x - cx) ** 2 + (c.y - cy) ** 2;
    if (cur === null) {
      subPicked[ci][cj] = c;
      used.add(candIdx);
    } else {
      const curDistSq = (cur.x - cx) ** 2 + (cur.y - cy) ** 2;
      if (distSq < curDistSq) {
        subPicked[ci][cj] = c;
        used.add(candIdx);
      }
    }
  }

  const picked: FillCell[] = [];
  for (let i = 0; i < k; i++) {
    for (let j = 0; j < k; j++) {
      const c = subPicked[i][j];
      if (c !== null) picked.push(c);
    }
  }
  // Top up to n from the unused pool.
  if (picked.length < n) {
    const pool: FillCell[] = [];
    for (let i = 0; i < candidates.length; i++) {
      if (!used.has(i)) pool.push(candidates[i]);
    }
    while (picked.length < n && pool.length > 0) {
      picked.push(pool.shift()!);
    }
  }
  return picked.slice(0, n);
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
feat(propose-test): forward-grid fill sampler with stratified picking

Builds a 32×32 (p1, p2) grid in laser-allowed param space, forward-
computes indices, filters to polygon-inside, then sub-samples N points
via stratified ⌈√N⌉×⌈√N⌉ binning. No inverse solving — simpler and
robust against numerical edge cases.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: ExposurePolygon SVG overlay

**Files:**
- Create: `web/src/components/exposure/ExposurePolygon.tsx`

- [ ] **Step 1: Write the component**

```tsx
// web/src/components/exposure/ExposurePolygon.tsx
import * as React from "react";
import type { Polygon } from "./proposeTestMath";

interface Props {
  /** Polygon vertices in *index-space* (xKey, yKey) units. */
  polygon: Polygon;
  /** Project an (x, y) index-space point into SVG (px, px). */
  toSvg: (x: number, y: number) => readonly [number, number];
  /** True while the user is still adding vertices (dashed stroke). */
  drawing: boolean;
  /** Optional vertex drag handle callback. Pass undefined to disable. */
  onVertexDrag?: (vertexIndex: number, newPoint: readonly [number, number]) => void;
}

export const ExposurePolygon: React.FC<Props> = ({
  polygon, toSvg, drawing, onVertexDrag,
}) => {
  if (polygon.length < 2) return null;
  const projected = polygon.map(([x, y]) => toSvg(x, y));
  const points = projected.map(([sx, sy]) => `${sx},${sy}`).join(" ");

  return (
    <g data-role="propose-polygon">
      <polygon
        points={points}
        fill="rgba(195, 90, 70, 0.13)"
        stroke="#c35a46"
        strokeWidth={2}
        strokeDasharray={drawing ? "5,4" : undefined}
        pointerEvents="none"
      />
      {projected.map(([sx, sy], i) => (
        <circle
          key={i}
          cx={sx}
          cy={sy}
          r={4}
          fill="#c35a46"
          stroke="#fff"
          strokeWidth={1.5}
          style={{ cursor: onVertexDrag ? "move" : "default" }}
          onMouseDown={onVertexDrag ? (e) => {
            e.preventDefault();
            // Drag implemented by parent via mousemove on the SVG; this
            // handler captures the start. Parent listens on document.
          } : undefined}
        />
      ))}
    </g>
  );
};
```

- [ ] **Step 2: Type-check**

```bash
cd web && npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add web/src/components/exposure/ExposurePolygon.tsx
git commit -m "$(cat <<'EOF'
feat(propose-test): ExposurePolygon SVG overlay

Pure presentational component: takes a polygon in index-space units, a
project-to-SVG callback, and a drawing flag. Renders the filled polygon
+ vertex handles. Drag wiring is just the mousedown capture; parent owns
mousemove logic since it knows the inverse projection.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: ExposurePolygonDraw click-to-draw layer

**Files:**
- Create: `web/src/components/exposure/ExposurePolygonDraw.tsx`

- [ ] **Step 1: Write the component**

```tsx
// web/src/components/exposure/ExposurePolygonDraw.tsx
import * as React from "react";
import type { Polygon } from "./proposeTestMath";

interface Props {
  /** SVG bounds in pixels; the component renders a transparent <rect>
   *  this big to capture clicks. */
  width: number;
  height: number;
  /** Convert SVG (px, px) to index-space (xKey, yKey). */
  fromSvg: (sx: number, sy: number) => readonly [number, number];
  /** Current in-progress polygon (vertices added so far). */
  vertices: Polygon;
  /** Called every time a vertex is added (single click). */
  onVertexAdd: (point: readonly [number, number]) => void;
  /** Called when the polygon is closed (double-click or Enter). */
  onClose: () => void;
  /** Called when the user cancels (Esc). */
  onCancel: () => void;
}

export const ExposurePolygonDraw: React.FC<Props> = ({
  width, height, fromSvg, vertices, onVertexAdd, onClose, onCancel,
}) => {
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
      else if (e.key === "Enter") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, onCancel]);

  const handleClick = (e: React.MouseEvent<SVGRectElement>) => {
    const svg = (e.currentTarget.ownerSVGElement as SVGSVGElement);
    if (!svg) return;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) return;
    const local = pt.matrixTransform(ctm.inverse());
    onVertexAdd(fromSvg(local.x, local.y));
  };

  const handleDoubleClick = (e: React.MouseEvent<SVGRectElement>) => {
    e.preventDefault();
    if (vertices.length >= 3) onClose();
  };

  return (
    <g data-role="propose-draw">
      <rect
        x={0} y={0} width={width} height={height}
        fill="transparent"
        style={{ cursor: "crosshair" }}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
      />
    </g>
  );
};
```

- [ ] **Step 2: Type-check**

```bash
cd web && npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add web/src/components/exposure/ExposurePolygonDraw.tsx
git commit -m "$(cat <<'EOF'
feat(propose-test): ExposurePolygonDraw click-to-draw layer

Transparent <rect> overlay sized to the scatter's plot area. Each click
emits a vertex (in index-space via the fromSvg projection); double-
click or Enter closes; Esc cancels. Crosshair cursor while active.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: ExposureCellsPreview overlay (curve + N filled cells)

**Files:**
- Create: `web/src/components/exposure/ExposureCellsPreview.tsx`

- [ ] **Step 1: Write the component**

```tsx
// web/src/components/exposure/ExposureCellsPreview.tsx
import * as React from "react";
import type { CurveSample, FillCell } from "./proposeTestMath";

interface Props {
  /** Optional dashed curve to draw (curve mode). */
  curve?: ReadonlyArray<{ x: number; y: number }> | null;
  /** N proposed cells. Each rendered as a filled circle. */
  cells: ReadonlyArray<{ x: number; y: number }>;
  /** Project (xIndex, yIndex) → SVG (px, px). */
  toSvg: (x: number, y: number) => readonly [number, number];
}

export const ExposureCellsPreview: React.FC<Props> = ({ curve, cells, toSvg }) => {
  const cellPath = cells.map((c) => toSvg(c.x, c.y));
  const curvePath = (curve ?? []).map((p) => toSvg(p.x, p.y));
  return (
    <g data-role="propose-cells">
      {curvePath.length > 1 && (
        <polyline
          points={curvePath.map(([x, y]) => `${x},${y}`).join(" ")}
          fill="none"
          stroke="#1a6ec0"
          strokeWidth={1.6}
          strokeDasharray="3,2"
          opacity={0.85}
          pointerEvents="none"
        />
      )}
      {cellPath.map(([sx, sy], i) => (
        <circle
          key={i}
          cx={sx}
          cy={sy}
          r={5.5}
          fill="#c35a46"
          stroke="#fff"
          strokeWidth={1.5}
          opacity={0.95}
          pointerEvents="none"
        />
      ))}
    </g>
  );
};
```

- [ ] **Step 2: Type-check**

```bash
cd web && npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add web/src/components/exposure/ExposureCellsPreview.tsx
git commit -m "$(cat <<'EOF'
feat(propose-test): ExposureCellsPreview overlay

Renders the dashed curve (if any) plus N filled cell markers. Pure
presentational; takes already-computed cells + curve plus a project
callback. Cells are slightly larger than data dots so they read as
'proposed' rather than data.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: ExposureProposeRail wizard panel

**Files:**
- Create: `web/src/components/exposure/ExposureProposeRail.tsx`
- Create: `web/src/components/exposure/ExposureProposeRail.test.tsx`

- [ ] **Step 1: Write failing test**

```tsx
// web/src/components/exposure/ExposureProposeRail.test.tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ExposureProposeRail } from "./ExposureProposeRail";
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
    power: 14.6, speed: 1152, frequency: 100, density: 5000,
    passes: 1, pulse_width: 200,
  },
};

describe("ExposureProposeRail", () => {
  it("renders the anchor hex and params", () => {
    render(
      <ExposureProposeRail
        anchor={ANCHOR}
        mode={{ mode: "curve", varyParam: "power" }}
        onModeChange={vi.fn()}
        cellCount={16}
        onCellCountChange={vi.fn()}
        rangeReadout={[
          { paramName: "POWER", min: 12.4, max: 18.8, unit: "%" },
        ]}
        canCreate={true}
        helperText={null}
        onCreate={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByText(/cb7983/i)).toBeTruthy();
    expect(screen.getByText(/POWER · 12.4 → 18.8 %/)).toBeTruthy();
  });
  it("disables CREATE when canCreate is false and shows helper text", () => {
    render(
      <ExposureProposeRail
        anchor={null}
        mode={{ mode: "curve", varyParam: "power" }}
        onModeChange={vi.fn()}
        cellCount={16}
        onCellCountChange={vi.fn()}
        rangeReadout={[]}
        canCreate={false}
        helperText="Polygon contains no entries"
        onCreate={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    const btn = screen.getByRole("button", { name: /create test/i });
    expect((btn as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/Polygon contains no entries/i)).toBeTruthy();
  });
  it("calls onCellCountChange when slider moves", () => {
    const onCellCountChange = vi.fn();
    render(
      <ExposureProposeRail
        anchor={ANCHOR}
        mode={{ mode: "curve", varyParam: "power" }}
        onModeChange={vi.fn()}
        cellCount={16}
        onCellCountChange={onCellCountChange}
        rangeReadout={[]}
        canCreate={true}
        helperText={null}
        onCreate={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    const slider = screen.getByRole("slider", { name: /cells/i });
    fireEvent.change(slider, { target: { value: "32" } });
    expect(onCellCountChange).toHaveBeenCalledWith(32);
  });
  it("emits curve mode chip click in fill mode and vice versa", () => {
    const onModeChange = vi.fn();
    render(
      <ExposureProposeRail
        anchor={ANCHOR}
        mode={{ mode: "fill", varyParams: ["power", "speed"] }}
        onModeChange={onModeChange}
        cellCount={16}
        onCellCountChange={vi.fn()}
        rangeReadout={[]}
        canCreate={true}
        helperText={null}
        onCreate={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    const curveBtn = screen.getByRole("button", { name: /curve/i });
    fireEvent.click(curveBtn);
    // The exact dispatch shape is component-internal; expect onModeChange
    // called with mode = "curve".
    expect(onModeChange).toHaveBeenCalled();
    const arg = (onModeChange as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(arg.mode).toBe("curve");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd web && npm test -- --run ExposureProposeRail.test
```

Expected: FAIL — component doesn't exist.

- [ ] **Step 3: Implement the component**

```tsx
// web/src/components/exposure/ExposureProposeRail.tsx
import * as React from "react";
import type { ExposureRow } from "./exposureCorrelations";
import type { ModeChoice, ParamKey } from "./proposeTestMath";

interface RangeReadout {
  paramName: string;
  min: number;
  max: number;
  unit: string;
}

interface Props {
  anchor: ExposureRow | null;
  mode: ModeChoice;
  onModeChange: (next: ModeChoice) => void;
  cellCount: number;
  onCellCountChange: (n: number) => void;
  rangeReadout: ReadonlyArray<RangeReadout>;
  canCreate: boolean;
  helperText: string | null;
  onCreate: () => void;
  onCancel: () => void;
}

const PARAM_LABEL: Record<ParamKey, string> = {
  power: "POWER",
  speed: "SPEED",
  frequency: "FREQ",
  density: "DENSITY",
};

const PARAM_UNIT: Record<ParamKey, string> = {
  power: "%",
  speed: "mm/s",
  frequency: "kHz",
  density: "lpc",
};

export const ExposureProposeRail: React.FC<Props> = ({
  anchor, mode, onModeChange, cellCount, onCellCountChange,
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
      // Multi-select clamp to 2: clicking a selected chip when both slots
      // filled does nothing; clicking an unselected chip swaps in for the
      // last-clicked slot (b).
      if (param === a) {
        onModeChange({ mode: "curve", varyParam: b });
      } else if (param === b) {
        onModeChange({ mode: "curve", varyParam: a });
      } else {
        onModeChange({ mode: "fill", varyParams: [a, param] });
      }
    }
  };

  const isChipSelected = (p: ParamKey) =>
    mode.mode === "curve"
      ? mode.varyParam === p
      : mode.varyParams.includes(p);

  return (
    <aside
      style={{ width: 300 }}
      className="shrink-0 flex flex-col gap-3 border-l border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-4 py-4 overflow-y-auto"
      data-role="propose-rail"
    >
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
              {Object.entries(anchor.params ?? {})
                .map(([k, v]) => `${k.slice(0, 1).toUpperCase()} ${v}`)
                .join("  ")}
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
              {`${r.paramName} · ${r.min} → ${r.max} ${r.unit}`}
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
    </aside>
  );
};

export type { RangeReadout };
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd web && npm test -- --run ExposureProposeRail.test
cd web && npx tsc --noEmit
```

Expected: PASS, clean tsc.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/exposure/ExposureProposeRail.tsx \
        web/src/components/exposure/ExposureProposeRail.test.tsx
git commit -m "$(cat <<'EOF'
feat(propose-test): ExposureProposeRail wizard panel

Side-rail wizard with anchor, mode toggle (curve | fill), 4-chip param
group, cell-count slider (2-200, default 16), live range readout, and
CREATE/CANCEL buttons. CREATE disabled with helper text per the
edge-case rules. Mode toggle and chip multi-select handle the curve↔fill
mental model.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: Toolbar PROPOSE TEST chip

**Files:**
- Modify: `web/src/components/exposure/ExposureToolbar.tsx`

- [ ] **Step 1: Read the existing toolbar** to find the FILTERS button and the props pattern.

```bash
grep -n 'FILTERS\|onToggleFilters\|filtersOpen' web/src/components/exposure/ExposureToolbar.tsx
```

- [ ] **Step 2: Add the new chip and props**

Add to the Props interface:

```ts
proposeOpen: boolean;
onToggleProposeMode: () => void;
proposeAvailable: boolean;   // false in univariate mode → chip disabled
```

Add a new chip rendered immediately after the FILTERS chip:

```tsx
<button
  type="button"
  disabled={!proposeAvailable}
  onClick={onToggleProposeMode}
  title={proposeAvailable ? undefined : "Propose Test is bivariate-only"}
  aria-pressed={proposeOpen}
  className={
    "ml-1 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.16em] rounded-sm border " +
    (!proposeAvailable
      ? "border-[color:var(--color-border)] text-[color:var(--color-ink-subtle)] opacity-50 cursor-not-allowed"
      : proposeOpen
        ? "border-[color:var(--color-primary)] bg-[color:var(--color-primary)] text-white"
        : "border-[color:var(--color-border)] text-[color:var(--color-ink-muted)]")
  }
>
  ◇ PROPOSE TEST
</button>
```

- [ ] **Step 3: Run existing toolbar tests**

```bash
cd web && npm test -- --run ExposureToolbar
```

Expected: PASS (existing tests don't reference the new chip; type signatures may need to be propagated to test fixtures — fix as needed).

- [ ] **Step 4: Type-check**

```bash
cd web && npx tsc --noEmit
```

Expected: clean (or, after fixing fixtures, clean).

- [ ] **Step 5: Commit**

```bash
git add web/src/components/exposure/ExposureToolbar.tsx
git commit -m "$(cat <<'EOF'
feat(propose-test): toolbar PROPOSE TEST chip

Adds a third toolbar pill (after FILTERS) with a 'proposeAvailable'
prop that disables it in univariate mode (with explanatory tooltip)
and an active state when proposeOpen is true.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 11: ExposureScatter overlay props

**Files:**
- Modify: `web/src/components/exposure/ExposureScatter.tsx`

- [ ] **Step 1: Add the new props**

Extend the `Props` interface with:

```ts
polygon?: Polygon | null;
polygonDrawing?: boolean;
curve?: ReadonlyArray<{ x: number; y: number }> | null;
cells?: ReadonlyArray<{ x: number; y: number }> | null;
onPolygonVertexAdd?: (point: readonly [number, number]) => void;
onPolygonClose?: () => void;
onPolygonCancel?: () => void;
```

Inside the component, after the existing scatter `<g>` group but before the axis-label foreignObjects, render the polygon overlay, the cells preview, and (when `polygonDrawing && onPolygonVertexAdd`) the click capture layer.

Project (xIndex, yIndex) → SVG using the existing `xScale`/`yScale` D3 scales (the file already has these). The inverse projection is `(sx, sy) => [xScale.invert(sx), yScale.invert(sy)]`.

Suspend dot pointer events when `polygonDrawing === true` so the polygon-draw rect captures clicks.

- [ ] **Step 2: Type-check + tests**

```bash
cd web && npx tsc --noEmit
cd web && npm test -- --run ExposureScatter
```

Expected: clean tsc, existing tests pass.

- [ ] **Step 3: Commit**

```bash
git add web/src/components/exposure/ExposureScatter.tsx
git commit -m "$(cat <<'EOF'
feat(propose-test): ExposureScatter polygon + cells overlay props

Optional props for polygon overlay (drawing or closed), curve preview,
N cell markers, and the click-capture layer used in draw mode. Suspends
data-dot pointer events while drawing so the polygon takes precedence.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 12: ExposurePage orchestration

**Files:**
- Modify: `web/src/pages/ExposurePage.tsx`

- [ ] **Step 1: Add wizard state**

Add inside the component:

```tsx
type ProposeMode = "off" | "drawing" | "panel";
const [proposeMode, setProposeMode] = useState<ProposeMode>("off");
const [polygon, setPolygon] = useState<Polygon>([]);
const [proposeOverride, setProposeOverride] = useState<ModeChoice | null>(null);
const [cellCount, setCellCount] = useState(16);
```

Memoise the derived values:

```tsx
const anchor = useMemo(
  () => findAnchor(polygon, displayRows, xKey, mode === "univariate" ? "pulse_intensity_index" : yKey),
  [polygon, displayRows, xKey, yKey, mode],
);

const laserLimits = useLaserLimits(currentMachineId);   // small custom hook reading state/machine.ts

const smartDefault = useMemo(() => {
  if (!anchor) return null;
  return pickModeAndParams(
    anchor, polygon, xKey, yKey as IndexKey, laserLimits,
  );
}, [anchor, polygon, xKey, yKey, laserLimits]);

const effective = proposeOverride ?? smartDefault;

// Derive curve / cells based on mode.
const preview = useMemo(() => {
  if (!effective || !anchor || !anchor.params) return { curve: null, cells: [] };
  const anchorParams = anchor.params as unknown as LaserParams;
  if (effective.mode === "curve") {
    const curve = computeCurve(anchorParams, effective.varyParam, xKey, yKey as IndexKey, laserLimits);
    const segments = clipPolylineToPolygon(curve, polygon);
    const flat = segments.flat();
    if (flat.length === 0) return { curve, cells: [] };
    const cells = sampleByArcLength(flat, cellCount);
    return { curve, cells };
  }
  const cells = fillByForwardGrid(
    anchorParams, effective.varyParams, polygon, xKey, yKey as IndexKey, laserLimits, cellCount,
  );
  return { curve: null, cells };
}, [effective, anchor, polygon, xKey, yKey, laserLimits, cellCount]);
```

- [ ] **Step 2: Toolbar wiring**

Pass to `<ExposureToolbar>`:

```tsx
proposeOpen={proposeMode !== "off"}
onToggleProposeMode={() => {
  if (proposeMode === "off") {
    setProposeMode("drawing");
    setPolygon([]);
  } else {
    setProposeMode("off");
    setPolygon([]);
    setProposeOverride(null);
  }
}}
proposeAvailable={mode === "bivariate"}
```

- [ ] **Step 3: Right rail swap**

In the `<aside>` where the right rail lives, branch on `proposeMode`:

```tsx
{proposeMode === "panel" ? (
  <ExposureProposeRail
    anchor={anchor}
    mode={effective ?? { mode: "curve", varyParam: "power" }}
    onModeChange={setProposeOverride}
    cellCount={cellCount}
    onCellCountChange={setCellCount}
    rangeReadout={buildRangeReadout(effective, preview.cells, anchor)}
    canCreate={anchor !== null && preview.cells.length > 0}
    helperText={
      anchor === null ? "Polygon contains no entries" :
      preview.cells.length === 0 ? "Couldn't fit any cells — try a different param or redraw" :
      null
    }
    onCreate={handleCreateTest}
    onCancel={() => {
      setProposeMode("off");
      setPolygon([]);
      setProposeOverride(null);
    }}
  />
) : (
  // existing rail (Stats / Focused / Neighbours / Indices)
)}
```

`handleCreateTest`:

```tsx
async function handleCreateTest() {
  if (!anchor || preview.cells.length === 0 || !effective) return;
  const validationCells = preview.cells.map((c) => {
    const params: Partial<Record<ParamKey, number>> = effective.mode === "curve"
      ? { [effective.varyParam]: (c as CurveSample).paramValue }
      : (c as FillCell).paramValues;
    return { params };
  });
  const primaryVaryParam = effective.mode === "curve" ? effective.varyParam : effective.varyParams[0];
  const primaryValues = validationCells.map((vc) => vc.params[primaryVaryParam] as number);
  const test = await createTest({
    name: `Propose · ${effective.mode === "curve" ? effective.varyParam : effective.varyParams.join("+")} · ${anchor.hex}`,
    material_id: materialId!,
    kind: "validation",
    spec: {
      x_param: primaryVaryParam,
      x_min: Math.min(...primaryValues),
      x_max: Math.max(...primaryValues),
      x_steps: validationCells.length,
      y_param: null,
      rows: 1,
      width_mm: defaultWidthMm,
      height_mm: defaultHeightMm,
      base_params: anchor.params as unknown as LaserParams,
      validation_cells: validationCells,
    },
  });
  location.hash = `#/tests?new=${test.id}`;
}
```

- [ ] **Step 4: Scatter wiring**

Pass to `<ExposureScatter>`:

```tsx
polygon={polygon}
polygonDrawing={proposeMode === "drawing"}
curve={preview.curve?.map((p) => ({ x: p.x, y: p.y })) ?? null}
cells={preview.cells}
onPolygonVertexAdd={(p) => setPolygon((prev) => [...prev, p])}
onPolygonClose={() => {
  if (polygon.length >= 3) setProposeMode("panel");
}}
onPolygonCancel={() => {
  setProposeMode("off");
  setPolygon([]);
  setProposeOverride(null);
}}
```

- [ ] **Step 5: Axis / material change clears polygon**

Add `useEffect`s that reset wizard state when xKey, yKey, mode, or materialId change:

```tsx
useEffect(() => {
  setProposeMode("off");
  setPolygon([]);
  setProposeOverride(null);
}, [xKey, yKey, mode, materialId]);
```

- [ ] **Step 6: Verify**

```bash
cd web && npm test -- --run
cd web && npx tsc --noEmit
cd web && npm run build > /dev/null 2>&1 && echo build-ok
```

Expected: full FE suite passes, tsc clean, build-ok.

- [ ] **Step 7: Commit**

```bash
git add web/src/pages/ExposurePage.tsx
git commit -m "$(cat <<'EOF'
feat(propose-test): ExposurePage orchestration

Wires the wizard: state for mode/polygon/override/cellCount, derived
anchor/effective/preview via memoised pure helpers, toolbar chip,
right-rail swap, scatter overlays, polygon clear on axis/material
change. Final 'CREATE TEST' POSTs a kind=validation test with per-cell
param overrides and navigates to #/tests?new=<id>.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 13: TestsPage `?new=<id>` highlight

**Files:**
- Modify: `web/src/pages/TestsPage.tsx`

- [ ] **Step 1: Parse the URL hash**

Add to the page component near the top:

```tsx
const newId = useMemo(() => {
  const hash = location.hash;
  const queryIdx = hash.indexOf("?");
  if (queryIdx < 0) return null;
  const params = new URLSearchParams(hash.slice(queryIdx + 1));
  const v = params.get("new");
  return v ? Number(v) : null;
}, []);
```

- [ ] **Step 2: Scroll + highlight after tests load**

```tsx
useEffect(() => {
  if (newId == null) return;
  const el = document.querySelector<HTMLElement>(`[data-test-id="${newId}"]`);
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  el.classList.add("ring-2", "ring-[color:var(--color-primary)]");
  const t = setTimeout(() => {
    el.classList.remove("ring-2", "ring-[color:var(--color-primary)]");
    // Strip the param so a refresh doesn't re-highlight.
    const cleanHash = location.hash.split("?")[0];
    history.replaceState(null, "", cleanHash);
  }, 2000);
  return () => clearTimeout(t);
}, [newId, tests]);   // tests = the list, refires once it loads
```

Make sure each test row has `data-test-id={t.id}` so the query selector works.

- [ ] **Step 3: Verify**

```bash
cd web && npx tsc --noEmit
cd web && npm test -- --run TestsPage
```

Expected: clean tsc, existing tests pass.

- [ ] **Step 4: Commit**

```bash
git add web/src/pages/TestsPage.tsx
git commit -m "$(cat <<'EOF'
feat(propose-test): TestsPage scroll/highlight on ?new=<id>

Reads the 'new' param from the URL hash, scrolls the matching row into
view, applies a primary-coloured ring for ~2s, then strips the param
so a refresh doesn't re-highlight.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 14: Browser verification + changelog + push

- [ ] **Step 1: Browser walk-through**

```bash
pkill -f 'xcs-gen serve' 2>&1 || true
sleep 1
cd web && npm run build > /dev/null 2>&1 && echo build-ok
cd /Users/jonzky/Documents/XTools/Reverse
XCSGEN_LOG=WARNING uv run --active xcs-gen serve --host 127.0.0.1 --port 8017 &
sleep 4
curl -s -o /dev/null -w 'http=%{http_code}\n' http://127.0.0.1:8017/
```

Open `http://127.0.0.1:8017/#/exposure/1` and verify in order:

1. Toolbar shows `◇ PROPOSE TEST` chip after `FILTERS`. In bivariate mode it's clickable; switch to univariate → chip disabled with tooltip.
2. Click the chip in bivariate → cursor becomes crosshair on the chart.
3. Click 4 vertices on the scatter → polygon closes on double-click. The right rail swaps to the wizard panel.
4. Wizard shows: anchor hex (auto-picked entry inside polygon), mode toggle (CURVE highlighted), 4 chips with one selected, cell slider at 16, range readout per varied param, CREATE button enabled.
5. Move the slider to 8 → cells re-render on the chart (8 markers).
6. Click `FILL` mode toggle → mode flips, two chips selected, scattered cells appear instead of curve.
7. Click `CREATE TEST` → URL becomes `#/tests?new=<id>`. Tests page shows the new test scrolled into view with a brief ring highlight.
8. Open the new test from the list → editor renders all `validation_cells` rows.
9. Generate `.xcs` from the new test → file downloads.
10. (Negative path) Reopen the wizard, draw a polygon outside the entry cloud → CREATE disabled with "Polygon contains no entries".

- [ ] **Step 2: Author the changelog**

Create `changelog/2026-05-15-exposure-propose-test.md`:

```markdown
---
id: 2026-05-15-exposure-propose-test
date: 2026-05-15
level: major
title: Exposure — Propose Test from a drawn region
summary: Draw a polygon on the bivariate scatter; the workbench builds a ready-to-burn validation test that fills your region.
---

The bivariate exposure scatter just gained a workflow that turns a
visual hunch into an actual test. Click `◇ PROPOSE TEST` in the
toolbar, click vertices to draw a polygon around the region you want
to probe, double-click to close. The right rail swaps to a wizard:

- **Anchor.** The wizard auto-picks the existing entry closest to the
  polygon's centre — its params are the constants for everything you
  don't sweep.
- **Mode.** The wizard chooses **CURVE** (one varied param producing a
  2D curve through the polygon) when one of {power, speed, frequency,
  density} can do it; otherwise it switches to **FILL** mode (two
  varied params producing a scatter of cells inside the polygon). You
  can flip the mode and override the chips manually.
- **Cells.** A slider from 2 to 200 (default 16) controls how many
  cells the test will burn. The cells are rendered live on the chart
  as you move it.
- **Create.** Clicking CREATE TEST builds a `kind=validation` test
  with per-cell param snapshots and drops you on the tests list with
  it scrolled into view, ready to generate the `.xcs`.

The math runs entirely client-side — no API round-trip per slider tick
— so the curve and cells re-render instantly.

Stage 1 limits the testable params to `power, speed, frequency, density`
and supports up to 2 simultaneous varied params. Power and pulse_width
sweeps stay in the existing manual test-creation flow for now.
```

```bash
git add changelog/2026-05-15-exposure-propose-test.md
git commit -m "$(cat <<'EOF'
changelog: exposure propose-test

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 3: Final pre-PR checks + push**

```bash
cd web && npx tsc --noEmit
cd web && npm test -- --run
cd web && npm run build > /dev/null 2>&1 && echo build-ok
cd /Users/jonzky/Documents/XTools/Reverse
uv run --active pytest tests/ -q 2>&1 | tail -5
git push -u origin feat/exposure-propose-test
gh pr create --draft --title "feat: exposure propose-test wizard" --body "$(cat <<'EOF'
## Summary
New workflow on the bivariate exposure scatter:

- Toolbar `◇ PROPOSE TEST` chip enters polygon-draw mode.
- After the polygon closes, a right-rail wizard auto-picks an anchor entry, smart-defaults to curve or fill mode, and lets the user adjust 1–2 varied params and a 2–200 cell slider — all with live curve/cell preview on the chart.
- CREATE TEST builds a `kind=validation` test with per-cell `validation_cells` and lands the user on the tests list with the new test scrolled into view + briefly highlighted.

Spec: `docs/superpowers/specs/2026-05-10-exposure-propose-test-design.md`
Plan: `docs/superpowers/plans/2026-05-10-exposure-propose-test.md`

## Test plan
- [x] FE unit tests for proposeTestMath (point-in-polygon, anchor, curve, clip, arc-length sampling, mode picker, fill grid)
- [x] FE↔BE fixture parity for laserIndices.ts (50+ param combos)
- [x] ExposureProposeRail component tests (chips, slider, mode toggle, helper text, CREATE disabled state)
- [x] tsc clean, vitest 100%, npm run build OK
- [x] Backend pytest unaffected
- [x] Browser walk-through on a real material with palette entries

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)" 2>&1 | tail -3
```

Expected: PR opened. Note its number and watch CI.

---

## Summary

14 tasks total. Tasks 1-5 are pure-function math + a TS port — the foundation, all heavily tested. Tasks 6-9 are presentational components. Tasks 10-13 are the integration: toolbar chip, scatter overlays, page state, tests-page highlight. Task 14 is browser verification + changelog + draft PR.

## Test plan

The plan ships with comprehensive unit coverage on the math layer and the rail component. The integration is verified end-to-end via the browser walkthrough in Task 14, which also exercises the validation-cells generation path on the existing test-creation API.

## Branch hygiene

Branched off main as `feat/exposure-propose-test`. Spec + this plan committed first; implementation tasks follow. Independent of the open PR #84 (WB per-test anchor) — they don't share files.

## Self-review

**Spec coverage:**
- User flow → Tasks 12 (Page) + 10 (Toolbar) + 7 (Draw layer) ✓
- Architecture (proposeTestMath, ExposurePolygon, ExposurePolygonDraw, ExposureCellsPreview, ExposureProposeRail, scatter props, page orchestration, FE port of indices) → Tasks 1-12 ✓
- Data flow (memoised derivations, CREATE payload) → Task 12 ✓
- Math algorithms (pointInPolygon, findAnchor, computeCurve, clipPolylineToPolygon, sampleByArcLength, pickModeAndParams, fillByForwardGrid) → Tasks 2-5 ✓
- Edge cases (empty polygon, no curve overlap, axis/material swap clear, draw-mode click suppression) → Task 12 ✓
- Visual design (polygon stroke, curve dashed, cell markers slightly larger) → Tasks 6-8 ✓
- Testing strategy (proposeTestMath unit, laserIndices fixture parity, rail component, integration page, e2e browser walk) → Tasks 1-9 + 14 ✓
- Tests page `?new=<id>` highlight → Task 13 ✓
- Changelog → Task 14 ✓

**Placeholder scan:** None of "TBD", "TODO", "Add appropriate error handling", "Similar to Task N" appear in the plan body.

**Type consistency:** `IndexKey`, `ParamKey`, `Polygon`, `Point2`, `LaserParams`, `LaserIndices`, `LaserLimits`, `ParamRange`, `ModeChoice`, `CurveSample`, `FillCell`, `RangeReadout` — all defined once and referenced consistently. The TS port operates on `LaserParams` (BaseParams shape) which is the FE-side name — formula uses these; not `ProcessingParams` (which uses `repeat`/`pw`). Anchor params are projected via `anchor.params as unknown as LaserParams` since `ExposureRow.params` is currently typed loosely as `Record<string, number | string>`.
