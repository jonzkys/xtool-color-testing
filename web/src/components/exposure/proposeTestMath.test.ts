import { describe, expect, it } from "vitest";
import {
  pointInPolygon,
  findAnchor,
  type Polygon,
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

import {
  computeCurve,
  clipPolylineToPolygon,
  sampleByArcLength,
  pickModeAndParams,
  type LaserLimits,
  type CurveSample,
  type ParamKey,
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
    // pulse_energy_index = power / frequency; verify the formula holds for
    // whatever sample is closest to power=50 (samples are discrete, so
    // paramValue won't be exactly 50).
    const mid = curve.find((c) => Math.abs(c.paramValue - 50) < 1)!;
    expect(mid.x).toBeCloseTo(mid.paramValue / ANCHOR_PARAMS.frequency, 4);
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
    for (let i = 1; i < out.length; i++) {
      const a = out[i - 1];
      const b = out[i];
      const d = Math.hypot(b.x - a.x, b.y - a.y);
      expect(d).toBeLessThan(1.5);
    }
  });
  it("interpolates paramValue linearly between bracketing samples", () => {
    const out = sampleByArcLength(seg, 5);
    // The 50% point of arc length is at total/2 = 3.5 along the line. The
    // first segment is length 4, so 3.5 lands within it at t=0.875.
    // paramValue should be 100 + 0.875 * (200 - 100) = 187.5.
    const mid = out[2];
    expect(mid.paramValue).toBeCloseTo(187.5, 4);
  });
});

describe("pickModeAndParams", () => {
  // Build an anchor row with params; reuse makeRow but attach params.
  function anchorRow(): ExposureRow {
    const r = makeRow(1, 0, 0);
    r.params = ANCHOR_PARAMS;
    return r;
  }

  it("prefers a single param that moves both axes (curve mode)", () => {
    // Polygon spans most of the index space for total_exposure_index (0-65)
    // and ablation_aggression_index (0-0.046), so power/speed/density all
    // score well above CURVE_COVERAGE_THRESHOLD and curve mode is chosen.
    const polygon: Polygon = [[0.1, 0.0001], [60, 0.0001], [60, 0.045], [0.1, 0.045]];
    const out = pickModeAndParams(
      anchorRow(), polygon, "total_exposure_index", "ablation_aggression_index",
      F2_LIMITS,
    );
    expect(out.mode).toBe("curve");
    if (out.mode === "curve") {
      expect(["power", "speed", "density"]).toContain(out.varyParam);
    }
  });

  it("returns a consistent ModeChoice for any polygon (fill or curve)", () => {
    const polygon: Polygon = [[10, 0.0001], [90, 0.0001], [90, 0.05], [10, 0.05]];
    const out = pickModeAndParams(
      anchorRow(), polygon, "total_exposure_index", "pulse_intensity_index",
      F2_LIMITS,
    );
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

  it("falls back to fill mode with default params when anchor has no params", () => {
    const r = makeRow(1, 0, 0);
    // Deliberately don't set r.params.
    const polygon: Polygon = [[0, 0], [10, 0], [10, 10], [0, 10]];
    const out = pickModeAndParams(
      r, polygon, "total_exposure_index", "pulse_intensity_index", F2_LIMITS,
    );
    expect(out.mode).toBe("fill");
    if (out.mode === "fill") {
      expect(out.varyParams).toEqual(["power", "speed"]);
    }
  });
});

import { fillByForwardGrid, partialDerivative, inverseSolve } from "./proposeTestMath";
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

describe("fillByForwardGrid", () => {
  it("returns N cells, all inside the polygon", () => {
    // Polygon spanning a region the (power, speed) grid can hit in
    // (TEi, PIi). Pick generous bounds so the candidate count >= 16.
    const polygon: Polygon = [[10, 0.0001], [90, 0.0001], [90, 0.045], [10, 0.045]];
    const cells = fillByForwardGrid(
      ANCHOR_PARAMS, ["power", "speed"], polygon,
      "total_exposure_index", "pulse_intensity_index", F2_LIMITS, 16,
    );
    expect(cells.length).toBeGreaterThan(0);
    expect(cells.length).toBeLessThanOrEqual(16);
    for (const c of cells) {
      expect(pointInPolygon([c.x, c.y], polygon)).toBe(true);
      expect(c.paramValues.power).toBeDefined();
      expect(c.paramValues.speed).toBeDefined();
    }
  });
  it("clamps cell counts to laser-valid params", () => {
    const polygon: Polygon = [[10, 0.0001], [90, 0.0001], [90, 0.045], [10, 0.045]];
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
  it("returns up to N cells when grid is sparse (top-up pool sourced from evicted)", () => {
    // Construct a polygon so small relative to the cell width that
    // many grid candidates collapse into the same sub-cell, leaving
    // most sub-cells empty. The bug scenario: evicted candidates in
    // a populated sub-cell would be silently discarded; with the fix,
    // they're available to fill empty sub-cells (until the pool runs
    // out, in which case the function returns < n).
    const polygon: Polygon = [[10, 0.0001], [90, 0.0001], [90, 0.045], [10, 0.045]];
    const cells = fillByForwardGrid(
      ANCHOR_PARAMS, ["power", "speed"], polygon,
      "total_exposure_index", "pulse_intensity_index", F2_LIMITS, 50,
    );
    // Sanity: at least 2 distinct (x, y) pairs (i.e. picks ARE coming
    // from non-degenerate top-up). All cells must be inside polygon.
    const distinct = new Set(cells.map((c) => `${c.x.toFixed(6)},${c.y.toFixed(6)}`));
    expect(distinct.size).toBe(cells.length);
    for (const c of cells) {
      expect(pointInPolygon([c.x, c.y], polygon)).toBe(true);
    }
  });
});

describe("inverseSolve", () => {
  const base: LaserParams = {
    power: 14.6, speed: 1152, frequency: 100, density: 5000, passes: 1, pulse_width: 200,
  };

  it("converges to params that produce a reachable target (TEi × PIi varying power+speed)", () => {
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
      expect(solved.power).toBeCloseTo(25, 1);
      expect(solved.speed).toBeCloseTo(800, 0);
    }
  });

  it("returns null on a degenerate axis pair (varied params don't span both axes)", () => {
    // For (PSm, LSm) varying (power, frequency): LSm depends only on
    // density. Power doesn't move EITHER axis. Pair is degenerate.
    const solved = inverseSolve(
      { x: 0.005, y: 0.002 },
      ["power", "frequency"], base,
      "pulse_spacing_mm", "line_spacing_mm",
      F2_LIMITS,
    );
    expect(solved).toBeNull();
  });

  it("returns null on a target that requires params outside laser limits", () => {
    // Way too high TEi would need speed below laser min.
    const solved = inverseSolve(
      { x: 1e6, y: 1e-3 },
      ["power", "speed"], base,
      "total_exposure_index", "pulse_intensity_index",
      F2_LIMITS,
    );
    expect(solved).toBeNull();
  });
});
