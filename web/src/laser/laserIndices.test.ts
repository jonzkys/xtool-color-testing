import { describe, expect, it } from "vitest";
import fixtures from "./__fixtures__/laser-indices-v4.json";
import { computeIndices, type LaserParams } from "./laserIndices";

interface Fixture {
  input: LaserParams & { crosshatch: boolean };
  expected: Record<string, number>;
}

describe("computeIndices (TS port of compute_indices v4)", () => {
  it("matches the Python source-of-truth fixtures", () => {
    for (const f of fixtures as Fixture[]) {
      const { crosshatch, ...laserParams } = f.input;
      const got = computeIndices(laserParams, { crosshatch });
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

describe("computeIndices crosshatch", () => {
  const base: LaserParams = {
    power: 14.6, speed: 1152, frequency: 100, density: 5000,
    passes: 1, pulse_width: 200,
  };

  it("doubles TEi/AAi/DSi when crosshatch is true", () => {
    const a = computeIndices(base);
    const b = computeIndices(base, { crosshatch: true });
    expect(b.total_exposure_index).toBeCloseTo(a.total_exposure_index * 2, 6);
    expect(b.ablation_aggression_index).toBeCloseTo(a.ablation_aggression_index * 2, 6);
    expect(b.delivery_smoothness_index).toBeCloseTo(a.delivery_smoothness_index * 2, 6);
  });

  it("leaves per-pulse indices unchanged when crosshatch is true", () => {
    const a = computeIndices(base);
    const b = computeIndices(base, { crosshatch: true });
    expect(b.pulse_spacing_mm).toBeCloseTo(a.pulse_spacing_mm, 6);
    expect(b.line_spacing_mm).toBeCloseTo(a.line_spacing_mm, 6);
    expect(b.pulse_energy_index).toBeCloseTo(a.pulse_energy_index, 6);
    expect(b.pulse_intensity_index).toBeCloseTo(a.pulse_intensity_index, 6);
  });

  it("defaults to crosshatch=false when opts not provided", () => {
    const a = computeIndices(base);
    const b = computeIndices(base, { crosshatch: false });
    expect(a).toEqual(b);
  });

  it("reports formula_version = 4", () => {
    expect(computeIndices(base).formula_version).toBe(4);
  });
});
