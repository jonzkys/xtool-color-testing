import { describe, expect, it } from "vitest";
import fixtures from "./__fixtures__/laser-indices-v3.json";
import { computeIndices, type LaserParams } from "./laserIndices";

interface Fixture {
  input: LaserParams;
  expected: Record<string, number>;
}

describe("computeIndices (TS port of compute_indices v3)", () => {
  it("matches the Python source-of-truth fixtures", () => {
    for (const f of fixtures as Fixture[]) {
      const got = computeIndices(f.input);
      for (const [k, expected] of Object.entries(f.expected)) {
        if (k === "formula_version") {
          expect(got[k as keyof typeof got]).toBe(expected);
        } else {
          expect(got[k as keyof typeof got]).toBeCloseTo(expected, 6);
        }
      }
    }
  });

  it("throws on zero denominator (speed)", () => {
    expect(() => computeIndices({
      power: 10, speed: 0, frequency: 100, density: 1000,
      passes: 1, pulse_width: 100,
    })).toThrow(/speed/);
  });

  it("throws on zero denominator (frequency)", () => {
    expect(() => computeIndices({
      power: 10, speed: 100, frequency: 0, density: 1000,
      passes: 1, pulse_width: 100,
    })).toThrow(/frequency/);
  });

  it("throws on zero denominator (density)", () => {
    expect(() => computeIndices({
      power: 10, speed: 100, frequency: 100, density: 0,
      passes: 1, pulse_width: 100,
    })).toThrow(/density/);
  });

  it("throws on zero pulse_width", () => {
    expect(() => computeIndices({
      power: 10, speed: 100, frequency: 100, density: 1000,
      passes: 1, pulse_width: 0,
    })).toThrow(/pulse_width/);
  });
});
