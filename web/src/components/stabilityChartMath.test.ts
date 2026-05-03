import { describe, expect, it } from "vitest";
import {
  binHistogram,
  binnedMean,
  cellIndexToRowCol,
  seriesMeanY,
} from "./stabilityChartMath";

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

describe("seriesMeanY", () => {
  it("returns null for empty, all-NaN, or single-element input", () => {
    expect(seriesMeanY([])).toBeNull();
    expect(seriesMeanY([NaN, NaN])).toBeNull();
    expect(seriesMeanY([5])).toBeNull();
    // Two finite values still aren't enough to draw confidently.
    expect(seriesMeanY([1, 2])).toBeNull();
  });

  it("returns the arithmetic mean of finite values for normal input", () => {
    expect(seriesMeanY([1, 2, 3])).toBeCloseTo(2);
    expect(seriesMeanY([10, 20, 30, 40])).toBeCloseTo(25);
    // NaN is skipped, not propagated.
    expect(seriesMeanY([1, NaN, 2, 3])).toBeCloseTo(2);
  });
});

describe("cellIndexToRowCol", () => {
  it("maps the iter-1 σ-list anchors to their visual ladder positions", () => {
    // Ladder #51, #41, #43, #54 on a 10-wide grid land at r5/c1, r4/c1,
    // r4/c3, r5/c4 — same physical positions across all three views, so
    // the unified focus signal lights the same cell across stats /
    // scatter / heatmap.
    expect(cellIndexToRowCol(51, 10)).toEqual({ row: 5, col: 1 });
    expect(cellIndexToRowCol(41, 10)).toEqual({ row: 4, col: 1 });
    expect(cellIndexToRowCol(43, 10)).toEqual({ row: 4, col: 3 });
    expect(cellIndexToRowCol(54, 10)).toEqual({ row: 5, col: 4 });
  });

  it("handles the first row + the row boundary correctly", () => {
    expect(cellIndexToRowCol(0, 10)).toEqual({ row: 0, col: 0 });
    expect(cellIndexToRowCol(9, 10)).toEqual({ row: 0, col: 9 });
    expect(cellIndexToRowCol(10, 10)).toEqual({ row: 1, col: 0 });
  });

  it("returns null for invalid inputs", () => {
    expect(cellIndexToRowCol(-1, 10)).toBeNull();
    expect(cellIndexToRowCol(NaN, 10)).toBeNull();
    expect(cellIndexToRowCol(5, 0)).toBeNull();
    expect(cellIndexToRowCol(5, -2)).toBeNull();
    expect(cellIndexToRowCol(5, NaN)).toBeNull();
  });
});

describe("binnedMean", () => {
  it("places each point at its bin's centre", () => {
    // Range [0, 10], 5 bins of width 2 → centres at 1, 3, 5, 7, 9.
    const bins = binnedMean(
      [
        { x: 0.5, y: 1 },
        { x: 1.5, y: 3 },
        { x: 2.5, y: 10 },
        { x: 3.5, y: 20 },
        { x: 8.5, y: 100 },
        { x: 9.5, y: 200 },
      ],
      0,
      10,
      5,
    );
    expect(bins.map((b) => b.center)).toEqual([1, 3, 5, 7, 9]);
    expect(bins[0].n).toBe(2);
    expect(bins[0].mean).toBeCloseTo(2);
    expect(bins[1].n).toBe(2);
    expect(bins[1].mean).toBeCloseTo(15);
    expect(bins[4].n).toBe(2);
    expect(bins[4].mean).toBeCloseTo(150);
  });

  it("collapses to NaN mean for empty bins (and bins with a single point)", () => {
    const bins = binnedMean(
      [
        { x: 1, y: 5 },
        { x: 5, y: 5 }, // alone in its bin
      ],
      0,
      10,
      5,
    );
    // Bin 0: 2 points required → NaN since only 1 sits there.
    expect(bins[0].n).toBe(1);
    expect(Number.isNaN(bins[0].mean)).toBe(true);
    // Bins 1, 3, 4 are entirely empty.
    expect(bins[1].n).toBe(0);
    expect(Number.isNaN(bins[1].mean)).toBe(true);
    expect(bins[3].n).toBe(0);
    expect(Number.isNaN(bins[3].mean)).toBe(true);
  });
});
