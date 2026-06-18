import { describe, it, expect } from "vitest";
import { resolveAxis, circleRegion, formatLabel } from "./spiralTest";

describe("resolveAxis", () => {
  it("linearly spaces min..max over steps", () => {
    expect(resolveAxis({ min: 0.4, max: 1.0, steps: 4 })).toEqual([0.4, 0.6, 0.8, 1.0]);
  });
  it("steps=1 yields [min]", () => {
    expect(resolveAxis({ min: 0.5, max: 2, steps: 1 })).toEqual([0.5]);
  });
  it("clamps steps to >= 1 and dedupes a zero-span axis", () => {
    expect(resolveAxis({ min: 0.3, max: 0.3, steps: 3 })).toEqual([0.3, 0.3, 0.3]);
  });
});

describe("circleRegion", () => {
  it("is one closed-ish loop of `segments` points centred at (cx,cy) with radius d/2", () => {
    const loops = circleRegion(10, 20, 8, 32);
    expect(loops.length).toBe(1);
    expect(loops[0].length).toBe(32);
    for (const p of loops[0]) {
      expect(Math.hypot(p.x - 10, p.y - 20)).toBeCloseTo(4, 5); // radius 4
    }
  });
});

describe("formatLabel", () => {
  it("renders channel/pitch as cw(2dp)/pitch(3dp)", () => {
    expect(formatLabel(0.8, 0.04)).toBe("0.80/0.040");
    expect(formatLabel(1, 0.035)).toBe("1.00/0.035");
  });
});
