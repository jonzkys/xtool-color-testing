import { describe, it, expect } from "vitest";
import { decimateIndices } from "./decimate";

describe("decimateIndices", () => {
  it("keeps all vertices when they're spaced above the threshold", () => {
    // 4 points 10 units apart, scale 1 → 10px gaps, minPx 0.5 → keep all
    const x = new Float32Array([0, 10, 20, 30]);
    const y = new Float32Array([0, 0, 0, 0]);
    expect(decimateIndices(x, y, 4, 1, 0, 0, 0.5)).toEqual([0, 1, 2, 3]);
  });
  it("collapses a dense sub-pixel run, always keeping first + last", () => {
    // 100 points 0.001 units apart, scale 1 → 0.001px gaps, minPx 0.5
    const n = 100;
    const x = new Float32Array(n), y = new Float32Array(n);
    for (let i = 0; i < n; i++) { x[i] = i * 0.001; y[i] = 0; }
    const keep = decimateIndices(x, y, n, 1, 0, 0, 0.5);
    expect(keep[0]).toBe(0);
    expect(keep[keep.length - 1]).toBe(n - 1);
    expect(keep.length).toBeLessThan(5); // collapsed to ~endpoints
  });
  it("respects the scale (same coords, larger scale keeps more)", () => {
    const x = new Float32Array([0, 0.4, 0.8, 1.2]); // 0.4-unit gaps
    const y = new Float32Array([0, 0, 0, 0]);
    // scale 1: each step is 0.4px (< 0.5) so idx 1 is skipped, but drift from
    // the last KEPT vertex (idx 0) reaches 0.8px at idx 2 (≥ 0.5) → idx 2 kept.
    expect(decimateIndices(x, y, 4, 1, 0, 0, 0.5)).toEqual([0, 2, 3]);
    // scale 10 → 4px gaps ≥ 0.5 → keep all
    expect(decimateIndices(x, y, 4, 10, 0, 0, 0.5)).toEqual([0, 1, 2, 3]);
  });
  it("measures drift from the last KEPT vertex, not the previous one", () => {
    // 11 points, each step 0.3 units (sub-pixel at scale 1, minPx 0.5). Drift
    // from the last kept vertex crosses 0.5 every other point → every other
    // vertex is retained. A previous-sequential metric would wrongly collapse
    // a shallow ramp to [0, 10] (a straight line), so this guards the shape.
    const x = new Float32Array([0, 0.3, 0.6, 0.9, 1.2, 1.5, 1.8, 2.1, 2.4, 2.7, 3.0]);
    const y = new Float32Array(11);
    const keep = decimateIndices(x, y, 11, 1, 0, 0, 0.5);
    expect(keep).toEqual([0, 2, 4, 6, 8, 10]);
  });
  it("returns all indices for counts <= 2", () => {
    expect(decimateIndices(new Float32Array([0, 1]), new Float32Array([0, 0]), 2, 1, 0, 0, 0.5)).toEqual([0, 1]);
    expect(decimateIndices(new Float32Array([5]), new Float32Array([5]), 1, 1, 0, 0, 0.5)).toEqual([0]);
  });
});
