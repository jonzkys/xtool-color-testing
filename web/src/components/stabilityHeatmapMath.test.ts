import { describe, expect, it } from "vitest";
import {
  computeHeatmapRange,
  divergingRampT,
  inferPhysicalRows,
  isDivergingMetric,
  isHeatmapMetric,
  magnitudeRampT,
} from "./stabilityHeatmapMath";

describe("isHeatmapMetric", () => {
  it("accepts the per-cell aggregable metrics", () => {
    expect(isHeatmapMetric("delta_e")).toBe(true);
    expect(isHeatmapMetric("delta_l")).toBe(true);
    expect(isHeatmapMetric("delta_a")).toBe(true);
    expect(isHeatmapMetric("delta_b")).toBe(true);
    expect(isHeatmapMetric("delta_hue")).toBe(true);
    expect(isHeatmapMetric("per_cell_sigma")).toBe(true);
  });
  it("rejects scatter-only Y axes", () => {
    expect(isHeatmapMetric("measured_hue")).toBe(false);
    expect(isHeatmapMetric("measured_l")).toBe(false);
    expect(isHeatmapMetric("measured_chroma")).toBe(false);
  });
});

describe("isDivergingMetric", () => {
  it("flags signed-residual metrics as diverging", () => {
    expect(isDivergingMetric("delta_l")).toBe(true);
    expect(isDivergingMetric("delta_a")).toBe(true);
    expect(isDivergingMetric("delta_b")).toBe(true);
    expect(isDivergingMetric("delta_hue")).toBe(true);
  });
  it("treats magnitude metrics as non-diverging", () => {
    expect(isDivergingMetric("delta_e")).toBe(false);
    expect(isDivergingMetric("per_cell_sigma")).toBe(false);
  });
});

describe("computeHeatmapRange", () => {
  it("anchors a magnitude range at zero with the data max", () => {
    const r = computeHeatmapRange([1, 3, 7, 2], "delta_e", 0);
    expect(r.min).toBe(0);
    expect(r.max).toBe(7);
  });
  it("symmetrises a diverging range so 0 stays the cream centre", () => {
    // Even though the data leans positive, the range straddles zero
    // symmetrically — a +20° max shouldn't collapse the cool half.
    const r = computeHeatmapRange([5, 12, 20, 1], "delta_hue", 0);
    expect(r.min).toBe(-20);
    expect(r.max).toBe(20);
  });
  it("clamps a near-flat dataset to the supplied floor", () => {
    const r = computeHeatmapRange([0.2, 0.4, 0.1], "delta_e", 1);
    expect(r.max).toBe(1);
  });
  it("symmetrises around the floor for diverging metrics on a flat run", () => {
    const r = computeHeatmapRange([0.1, -0.1], "delta_l", 2);
    expect(r.min).toBe(-2);
    expect(r.max).toBe(2);
  });
  it("ignores non-finite values", () => {
    const r = computeHeatmapRange([NaN, Infinity, 5, -3], "delta_a", 0);
    // Diverging — symmetric. Max abs is 5.
    expect(r.min).toBe(-5);
    expect(r.max).toBe(5);
  });
});

describe("magnitudeRampT", () => {
  it("clamps below zero to 0 and above 1 to 1", () => {
    expect(magnitudeRampT(-3, 10)).toBe(0);
    expect(magnitudeRampT(50, 10)).toBe(1);
  });
  it("returns the linear normalised position inside the range", () => {
    expect(magnitudeRampT(2.5, 10)).toBeCloseTo(0.25);
    expect(magnitudeRampT(0, 10)).toBe(0);
  });
  it("returns 0 for non-finite input or zero range", () => {
    expect(magnitudeRampT(NaN, 10)).toBe(0);
    expect(magnitudeRampT(5, 0)).toBe(0);
  });
});

describe("divergingRampT", () => {
  it("returns a signed value clamped to [-1, 1]", () => {
    expect(divergingRampT(5, 10)).toBeCloseTo(0.5);
    expect(divergingRampT(-5, 10)).toBeCloseTo(-0.5);
    expect(divergingRampT(20, 10)).toBe(1);
    expect(divergingRampT(-20, 10)).toBe(-1);
  });
  it("treats a zero range as the neutral centre", () => {
    expect(divergingRampT(5, 0)).toBe(0);
  });
  it("returns 0 for non-finite input", () => {
    expect(divergingRampT(NaN, 10)).toBe(0);
  });
});

describe("inferPhysicalRows", () => {
  it("computes the ceiling of cellCount / cellsPerRow", () => {
    expect(inferPhysicalRows(60, 10)).toBe(6);
    expect(inferPhysicalRows(100, 10)).toBe(10);
    expect(inferPhysicalRows(18, 6)).toBe(3);
  });
  it("rounds up partial trailing rows", () => {
    expect(inferPhysicalRows(13, 6)).toBe(3);
  });
  it("falls back to 1 row for malformed inputs", () => {
    expect(inferPhysicalRows(0, 10)).toBe(1);
    expect(inferPhysicalRows(10, 0)).toBe(1);
  });
});
