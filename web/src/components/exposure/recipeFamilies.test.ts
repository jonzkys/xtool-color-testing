import { describe, it, expect } from "vitest";
import {
  VARYING_AXES,
  buildFamilies,
} from "./recipeFamilies";
import type { ExposureRow } from "./exposureCorrelations";

function row(
  id: number,
  params: { speed: number; power: number; density: number; frequency: number; passes: number; pulse_width: number },
): ExposureRow {
  return {
    id,
    hex: "#aaaaaa",
    lab: [50, 0, 0],
    indices: {
      pulse_spacing_mm: 0.01,
      line_spacing_index: 0.01,
      line_spacing_mm: null,
      pulse_energy_index: 0.7,
      pulse_intensity_index: 0.003,
      total_exposure_index: 100,
      ablation_aggression_index: 0.3,
      delivery_smoothness_index: 33000,
      formula_version: 2,
      density_model: "opaque",
      power_model: "controller_percent",
    },
    params,
  };
}

describe("buildFamilies", () => {
  it("VARYING_AXES enumerates all 6 recipe params", () => {
    expect(VARYING_AXES).toEqual([
      "power", "speed", "frequency", "density", "passes", "pulse_width",
    ]);
  });

  it("returns empty map when no rows", () => {
    expect(buildFamilies([]).size).toBe(0);
  });

  it("returns empty map when no row has 3+ siblings on any axis", () => {
    const rows = [
      row(1, { speed: 800, power: 10, density: 100, frequency: 65, passes: 1, pulse_width: 200 }),
      row(2, { speed: 800, power: 11, density: 100, frequency: 65, passes: 1, pulse_width: 200 }),
    ];
    expect(buildFamilies(rows).size).toBe(0);
  });

  it("detects a 5-member power sweep", () => {
    const rows = [
      row(1, { speed: 800, power: 10, density: 100, frequency: 65, passes: 1, pulse_width: 200 }),
      row(2, { speed: 800, power: 11, density: 100, frequency: 65, passes: 1, pulse_width: 200 }),
      row(3, { speed: 800, power: 12, density: 100, frequency: 65, passes: 1, pulse_width: 200 }),
      row(4, { speed: 800, power: 13, density: 100, frequency: 65, passes: 1, pulse_width: 200 }),
      row(5, { speed: 800, power: 14, density: 100, frequency: 65, passes: 1, pulse_width: 200 }),
    ];
    const fams = buildFamilies(rows);
    expect(fams.size).toBe(1);
    const [[, members]] = Array.from(fams.entries());
    expect(members.length).toBe(5);
    expect(members[0].varyingAxis).toBe("power");
    expect(members.map((m) => m.varyingValue)).toEqual([10, 11, 12, 13, 14]);
  });

  it("orders members ascending by varying value", () => {
    const rows = [
      row(1, { speed: 800, power: 14, density: 100, frequency: 65, passes: 1, pulse_width: 200 }),
      row(2, { speed: 800, power: 10, density: 100, frequency: 65, passes: 1, pulse_width: 200 }),
      row(3, { speed: 800, power: 12, density: 100, frequency: 65, passes: 1, pulse_width: 200 }),
    ];
    const fams = buildFamilies(rows);
    const [[, members]] = Array.from(fams.entries());
    expect(members.map((m) => m.row.id)).toEqual([2, 3, 1]);
  });

  it("a row can belong to multiple families", () => {
    const rows = [
      row(1, { speed: 800, power: 10, density: 100, frequency: 65, passes: 1, pulse_width: 200 }),
      row(2, { speed: 800, power: 11, density: 100, frequency: 65, passes: 1, pulse_width: 200 }),
      row(3, { speed: 800, power: 12, density: 100, frequency: 65, passes: 1, pulse_width: 200 }),
      row(4, { speed: 800, power: 10, density: 200, frequency: 65, passes: 1, pulse_width: 200 }),
      row(5, { speed: 800, power: 10, density: 300, frequency: 65, passes: 1, pulse_width: 200 }),
    ];
    const fams = buildFamilies(rows);
    expect(fams.size).toBe(2);
    const axes = Array.from(fams.values()).map((m) => m[0].varyingAxis).sort();
    expect(axes).toEqual(["density", "power"]);
  });
});
