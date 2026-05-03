import { describe, expect, it } from "vitest";
import { binHistogram } from "./stabilityChartMath";

describe("binHistogram", () => {
  it("buckets a small known input into the expected counts", () => {
    // Range [0, 10] split into 5 bins of width 2:
    //   bin 0 [0,2)   → 0, 1     (2)
    //   bin 1 [2,4)   → 2, 3     (2)
    //   bin 2 [4,6)   → 4, 5     (2)
    //   bin 3 [6,8)   → 6, 7     (2)
    //   bin 4 [8,10]  → 8, 9, 10 (3, closed right edge)
    const values = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const h = binHistogram(values, 0, 10, 5);
    expect(h.counts).toEqual([2, 2, 2, 2, 3]);
    expect(h.binWidth).toBe(2);
    expect(h.maxCount).toBe(3);
  });

  it("places the max value in the last bin (closed right edge)", () => {
    const h = binHistogram([0, 5, 10], 0, 10, 2);
    expect(h.counts).toEqual([1, 2]);
  });

  it("ignores non-finite values and out-of-range entries", () => {
    const h = binHistogram(
      [NaN, Infinity, -Infinity, -1, 11, 5],
      0,
      10,
      4,
    );
    expect(h.counts.reduce((a, b) => a + b, 0)).toBe(1);
  });

  it("returns zero counts for an empty input but the right shape", () => {
    const h = binHistogram([], 0, 10, 6);
    expect(h.counts).toEqual([0, 0, 0, 0, 0, 0]);
    expect(h.binWidth).toBe(10 / 6);
    expect(h.maxCount).toBe(0);
  });

  it("returns an empty result for a degenerate range", () => {
    const h = binHistogram([1, 2, 3], 5, 5, 4);
    expect(h.binWidth).toBe(0);
    expect(h.maxCount).toBe(0);
    expect(h.counts).toEqual([0, 0, 0, 0]);
  });

  it("handles a non-zero min cleanly", () => {
    // Range [10, 20], 4 bins of width 2.5:
    //   bin 0 [10, 12.5)
    //   bin 1 [12.5, 15)
    //   bin 2 [15, 17.5)
    //   bin 3 [17.5, 20]
    const h = binHistogram([10, 12.5, 14, 19, 20], 10, 20, 4);
    expect(h.counts).toEqual([1, 2, 0, 2]);
    expect(h.binWidth).toBeCloseTo(2.5);
  });
});
