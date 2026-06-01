import { describe, it, expect } from "vitest";
import { clampToConstraint, coerceParams } from "./constraints";
import type { FieldConstraint, ValidationProfile } from "../types";

const range = (min: number, max: number, step?: number): FieldConstraint =>
  ({ kind: "range", min, max, step });

describe("clampToConstraint", () => {
  it("clamps a range to [min,max]", () => {
    expect(clampToConstraint(999, range(1, 100))).toBe(100);
    expect(clampToConstraint(-5, range(1, 100))).toBe(1);
    expect(clampToConstraint(50, range(1, 100))).toBe(50);
  });

  it("snaps a range to its step when step >= 1", () => {
    expect(clampToConstraint(13, range(0, 100, 10))).toBe(10);
    expect(clampToConstraint(16, range(0, 100, 10))).toBe(20);
  });

  it("does not step-snap when step < 1", () => {
    expect(clampToConstraint(14.6, range(0, 100, 0.1))).toBe(14.6);
  });

  it("returns min for a non-finite range value", () => {
    expect(clampToConstraint("abc", range(1, 100))).toBe(1);
  });

  it("snaps stepped numeric values to the nearest allowed", () => {
    const c: FieldConstraint = { kind: "stepped", values: [2, 6, 13, 60, 500] };
    expect(clampToConstraint(7, c)).toBe(6);
    expect(clampToConstraint(40, c)).toBe(60);
    expect(clampToConstraint(6, c)).toBe(6);
  });

  it("keeps an in-set enum value, else returns the first", () => {
    const c: FieldConstraint = { kind: "enum", values: ["red", "blue"] };
    expect(clampToConstraint("blue", c)).toBe("blue");
    expect(clampToConstraint("uv", c)).toBe("red");
  });

  it("passes through a not_applicable value unchanged", () => {
    expect(clampToConstraint(42, { kind: "not_applicable" })).toBe(42);
  });
});

describe("coerceParams", () => {
  const profile: ValidationProfile = {
    power: range(1, 100),
    pulse_width: { kind: "stepped", values: [2, 6, 60, 500] },
    density: { kind: "not_applicable" },
    laser: { kind: "enum", values: ["red", "blue"] },
  };

  it("clamps/snaps fields, drops not_applicable, records changes, passes through unknown fields", () => {
    const { values, changed } = coerceParams(profile, {
      power: 999, pulse_width: 7, density: 120, laser: "blue", scan_angle: 45,
    });
    expect(values).toEqual({ power: 100, pulse_width: 6, laser: "blue", scan_angle: 45 });
    expect(values.density).toBeUndefined();
    expect(changed).toEqual({ power: [999, 100], pulse_width: [7, 6] });
  });

  it("leaves an already-valid dict unchanged (no changed entries)", () => {
    const { values, changed } = coerceParams(profile, { power: 50, pulse_width: 60, laser: "red" });
    expect(values).toEqual({ power: 50, pulse_width: 60, laser: "red" });
    expect(changed).toEqual({});
  });
});
