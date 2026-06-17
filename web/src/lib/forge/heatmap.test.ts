import { describe, it, expect } from "vitest";
import { logNormalize, durationColor, HEAT_STOPS, fmtSeconds } from "./heatmap";

describe("logNormalize", () => {
  it("returns [] for empty input", () => {
    expect(logNormalize([])).toEqual([]);
  });

  it("maps all-equal values to 0.5", () => {
    expect(logNormalize([5, 5, 5])).toEqual([0.5, 0.5, 0.5]);
  });

  it("spreads a wide range log-evenly to [0,1]", () => {
    const t = logNormalize([1, 10, 100]); // ln: 0, ln10, 2ln10 → 0, 0.5, 1
    expect(t[0]).toBeCloseTo(0, 6);
    expect(t[1]).toBeCloseTo(0.5, 6);
    expect(t[2]).toBeCloseTo(1, 6);
  });

  it("keeps every result within [0,1]", () => {
    for (const v of logNormalize([0.2, 3, 7, 250, 9000])) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it("clamps zero / negative inputs to finite values without NaN (EPS floor)", () => {
    const t = logNormalize([0, -5, 1]);
    for (const v of t) {
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});

describe("durationColor", () => {
  it("hits the stop hexes exactly at 0, 0.5, 1", () => {
    expect(durationColor(0)).toBe(HEAT_STOPS[0].hex);
    expect(durationColor(0.5)).toBe(HEAT_STOPS[1].hex);
    expect(durationColor(1)).toBe(HEAT_STOPS[2].hex);
  });

  it("clamps out-of-range t to the endpoints", () => {
    expect(durationColor(-3)).toBe(durationColor(0));
    expect(durationColor(9)).toBe(durationColor(1));
  });

  it("interpolates between stops (0.25 differs from both ends of its segment)", () => {
    const c = durationColor(0.25);
    expect(c).not.toBe(HEAT_STOPS[0].hex);
    expect(c).not.toBe(HEAT_STOPS[1].hex);
    expect(c).toMatch(/^#[0-9a-f]{6}$/);
  });
});

describe("fmtSeconds", () => {
  it("keeps 2 decimals under 1s, 1 decimal under 10s, whole above", () => {
    expect(fmtSeconds(0.04)).toBe("0.04s");
    expect(fmtSeconds(0.5)).toBe("0.50s");
    expect(fmtSeconds(1.4)).toBe("1.4s");
    expect(fmtSeconds(14.6)).toBe("15s");
  });

  it("shows sub-10ms as <0.01s rather than a bare 0.00s", () => {
    expect(fmtSeconds(0.004)).toBe("<0.01s");
  });

  it("guards zero / negatives / non-finite", () => {
    expect(fmtSeconds(0)).toBe("0s");
    expect(fmtSeconds(-2)).toBe("0s");
    expect(fmtSeconds(NaN)).toBe("0s");
  });
});
