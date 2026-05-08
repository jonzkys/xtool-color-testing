import { describe, it, expect } from "vitest";
import {
  pearson,
  spearman,
  logLinearRegression,
} from "./exposureMath";

describe("pearson", () => {
  it("perfect positive correlation = 1", () => {
    const r = pearson([1, 2, 3, 4, 5], [2, 4, 6, 8, 10]);
    expect(r).toBeCloseTo(1, 6);
  });

  it("perfect negative correlation = -1", () => {
    const r = pearson([1, 2, 3, 4, 5], [10, 8, 6, 4, 2]);
    expect(r).toBeCloseTo(-1, 6);
  });

  it("uncorrelated data is near 0", () => {
    const r = pearson([1, 2, 3, 4, 5], [3, 1, 4, 1, 5]);
    expect(Math.abs(r)).toBeLessThan(0.5);
  });

  it("returns NaN when n < 2", () => {
    expect(Number.isNaN(pearson([1], [2]))).toBe(true);
    expect(Number.isNaN(pearson([], []))).toBe(true);
  });

  it("returns NaN when one series has zero variance", () => {
    expect(Number.isNaN(pearson([1, 1, 1], [2, 4, 6]))).toBe(true);
  });

  it("ignores NaN values in either series", () => {
    const r = pearson([1, 2, NaN, 4, 5], [2, 4, 100, 8, 10]);
    expect(r).toBeCloseTo(1, 6);
  });
});

describe("spearman", () => {
  it("perfect monotonic positive = 1", () => {
    const r = spearman([1, 2, 3, 4, 5], [10, 100, 1000, 10000, 100000]);
    expect(r).toBeCloseTo(1, 6);
  });

  it("perfect monotonic negative = -1", () => {
    const r = spearman([1, 2, 3, 4, 5], [100, 80, 60, 40, 20]);
    expect(r).toBeCloseTo(-1, 6);
  });

  it("handles ties via average rank", () => {
    const r = spearman([1, 1, 2], [1, 2, 3]);
    expect(r).toBeGreaterThan(0);
    expect(r).toBeLessThan(1);
  });
});

describe("logLinearRegression", () => {
  it("fits y = a + b*log10(x) on synthetic data", () => {
    const xs = [1, 10, 100, 1000];
    const ys = xs.map((x) => 5 + 3 * Math.log10(x));
    const fit = logLinearRegression(xs, ys);
    expect(fit.intercept).toBeCloseTo(5, 6);
    expect(fit.slope).toBeCloseTo(3, 6);
    expect(fit.r2).toBeCloseTo(1, 6);
  });

  it("returns NaN slope when n < 2 or x has zero variance", () => {
    const fit = logLinearRegression([10, 10, 10], [1, 2, 3]);
    expect(Number.isNaN(fit.slope)).toBe(true);
  });

  it("ignores non-positive x values (log undefined)", () => {
    const fit = logLinearRegression([0, 1, 10, 100], [99, 5, 8, 11]);
    expect(Number.isNaN(fit.slope)).toBe(false);
    expect(fit.r2).toBeCloseTo(1, 4);
  });
});
