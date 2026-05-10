import { describe, expect, it } from "vitest";
import { recipeDelta } from "./recipeDelta";
import type { ExposureRow } from "./exposureCorrelations";

function row(params: Record<string, number | string>): ExposureRow {
  return {
    id: 0, hex: "#000", lab: [0, 0, 0],
    indices: {
      pulse_spacing_mm: 0, line_spacing_mm: 0,
      pulse_energy_index: 0, pulse_intensity_index: 0,
      total_exposure_index: 0, ablation_aggression_index: 0,
      delivery_smoothness_index: 0,
      formula_version: 3, density_model: "lpc",
      power_model: "controller_percent",
    },
    params,
  };
}

describe("recipeDelta", () => {
  it("returns null pct for identical values", () => {
    const a = row({ power: 14.6 });
    const b = row({ power: 14.6 });
    expect(recipeDelta(a, b, "power")).toEqual({
      value: 14.6, pct: 0, abs: 0,
    });
  });

  it("returns positive pct when neighbour is greater", () => {
    const a = row({ speed: 800 });
    const b = row({ speed: 840 });
    const d = recipeDelta(a, b, "speed");
    expect(d.value).toBe(840);
    expect(d.abs).toBe(40);
    expect(d.pct).toBeCloseTo(5, 1);
  });

  it("returns negative pct when neighbour is smaller", () => {
    const a = row({ frequency: 100 });
    const b = row({ frequency: 90 });
    const d = recipeDelta(a, b, "frequency");
    expect(d.pct).toBeCloseTo(-10, 1);
  });

  it("returns null pct when reference is 0", () => {
    const a = row({ passes: 0 });
    const b = row({ passes: 1 });
    const d = recipeDelta(a, b, "passes");
    expect(d.value).toBe(1);
    expect(d.abs).toBe(1);
    expect(d.pct).toBeNull();
  });

  it("returns null pct + null abs when neighbour value is missing", () => {
    const a = row({ power: 14.6 });
    const b = row({});
    const d = recipeDelta(a, b, "power");
    expect(d.value).toBeNull();
    expect(d.abs).toBeNull();
    expect(d.pct).toBeNull();
  });

  it("returns null pct + null abs when reference value is missing", () => {
    const a = row({});
    const b = row({ power: 14.6 });
    const d = recipeDelta(a, b, "power");
    expect(d.value).toBe(14.6);
    expect(d.abs).toBeNull();
    expect(d.pct).toBeNull();
  });
});
