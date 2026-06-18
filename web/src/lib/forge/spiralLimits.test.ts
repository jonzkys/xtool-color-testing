import { describe, it, expect } from "vitest";
import type { ValidationProfile } from "../../types";
import { clampParam, resolveAxisValues, steppedValues, snapStepped } from "./spiralLimits";

const PROFILE: ValidationProfile = {
  power: { kind: "range", min: 1, max: 100, step: 1 },
  speed: { kind: "range", min: 2, max: 10000, step: 1 },
  frequency: { kind: "range", min: 1, max: 4000, step: 1 },
  passes: { kind: "range", min: 1, max: 300, step: 1 },
  pulse_width: { kind: "stepped", values: [2, 4, 6, 9, 13, 20, 30, 45, 60, 80, 100, 150, 200, 250, 350, 500] },
  laser: { kind: "enum", values: ["red", "blue"] },
};

describe("snapStepped", () => {
  it("returns the nearest value by absolute distance", () => {
    expect(snapStepped([2, 4, 6, 9], 5)).toBe(4); // 5 is equidistant to 4 and 6; earlier (4) wins via strict <
    expect(snapStepped([60, 80, 100], 83)).toBe(80);
  });
});

describe("clampParam", () => {
  it("range params clamp to [min,max] and round to step", () => {
    expect(clampParam(PROFILE, "speed", 99999)).toBe(10000);
    expect(clampParam(PROFILE, "speed", 1.4)).toBe(2);
    expect(clampParam(PROFILE, "power", 150)).toBe(100);
    expect(clampParam(PROFILE, "passes", 999)).toBe(300);
  });
  it("stepped params snap to the nearest allowed value", () => {
    expect(clampParam(PROFILE, "pulseWidth", 83)).toBe(80);
    expect(clampParam(PROFILE, "pulseWidth", 7)).toBe(6);
  });
  it("unbound params fall back to the app clamp", () => {
    expect(clampParam(PROFILE, "pitch", -1)).toBe(0.01); // pitch app floor
    expect(clampParam(PROFILE, "channelWidth", -1)).toBeGreaterThan(0);
  });
  it("null profile falls back to the app clamp even for machine-bound params", () => {
    expect(clampParam(null, "speed", 1.4)).toBe(1); // app intMin1 (round, >=1)
  });
});

describe("resolveAxisValues", () => {
  it("range params linspace then clamp", () => {
    expect(resolveAxisValues(PROFILE, "speed", { min: 1000, max: 2000, steps: 3 })).toEqual([1000, 1500, 2000]);
  });
  it("stepped params yield the allowed values in range (steps ignored)", () => {
    expect(resolveAxisValues(PROFILE, "pulseWidth", { min: 60, max: 150, steps: 99 })).toEqual([60, 80, 100, 150]);
  });
  it("a stepped range containing no allowed value falls back to the single nearest", () => {
    expect(resolveAxisValues(PROFILE, "pulseWidth", { min: 7, max: 8, steps: 4 })).toEqual([6]);
  });
  it("null profile uses the app linspace+clamp path", () => {
    expect(resolveAxisValues(null, "speed", { min: 1000, max: 2000, steps: 2 })).toEqual([1000, 2000]);
  });
});

describe("steppedValues", () => {
  it("returns the stepped option list for a stepped param", () => {
    expect(steppedValues(PROFILE, "pulseWidth")).toEqual([2, 4, 6, 9, 13, 20, 30, 45, 60, 80, 100, 150, 200, 250, 350, 500]);
  });
  it("falls back to ALLOWED_PULSE_WIDTHS for pulseWidth when the profile is null", () => {
    expect(steppedValues(null, "pulseWidth")).toContain(500);
    expect(steppedValues(null, "pulseWidth")!.length).toBe(16);
  });
  it("returns null for a non-stepped param", () => {
    expect(steppedValues(PROFILE, "speed")).toBeNull();
  });
});
