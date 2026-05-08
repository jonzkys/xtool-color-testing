import { describe, it, expect } from "vitest";
import { nearestByDeltaE, nearestByRegime } from "./exposureNeighbours";
import type { ExposureRow } from "./exposureCorrelations";

function row(
  id: number,
  lab: [number, number, number],
  exposure: number = 100,
  intensity: number = 0.001,
): ExposureRow {
  return {
    id,
    hex: "#000000",
    lab,
    indices: {
      pulse_spacing_mm: 0.01,
      line_spacing_index: 0.01,
      line_spacing_mm: null,
      pulse_energy_index: 0.7,
      pulse_intensity_index: intensity,
      total_exposure_index: exposure,
      ablation_aggression_index: exposure * intensity,
      delivery_smoothness_index: exposure / intensity,
      formula_version: 2,
      density_model: "opaque",
      power_model: "controller_percent",
    },
  };
}

describe("nearestByDeltaE", () => {
  it("excludes the anchor itself", () => {
    const anchor = row(1, [50, 0, 0]);
    const others = [row(2, [55, 0, 0]), row(3, [40, 0, 0])];
    const n = nearestByDeltaE(anchor, [anchor, ...others], 5);
    expect(n.find((m) => m.row.id === 1)).toBeUndefined();
  });

  it("returns up to N nearest by ΔE76", () => {
    const anchor = row(1, [50, 0, 0]);
    const others = [
      row(2, [55, 0, 0]),  // ΔE = 5
      row(3, [40, 0, 0]),  // ΔE = 10
      row(4, [50, 5, 0]),  // ΔE = 5
      row(5, [50, 0, 8]),  // ΔE = 8
    ];
    const n = nearestByDeltaE(anchor, [anchor, ...others], 3);
    expect(n.length).toBe(3);
    expect(n[0].distance).toBeCloseTo(5, 4);
    expect(n[2].distance).toBeCloseTo(8, 4);
  });

  it("returns all when fewer than N candidates", () => {
    const anchor = row(1, [50, 0, 0]);
    const n = nearestByDeltaE(anchor, [anchor, row(2, [55, 0, 0])], 5);
    expect(n.length).toBe(1);
  });
});

describe("nearestByRegime", () => {
  it("excludes the anchor itself", () => {
    const anchor = row(1, [0, 0, 0], 100, 0.001);
    const others = [row(2, [0, 0, 0], 200, 0.002)];
    const n = nearestByRegime(anchor, [anchor, ...others], 5);
    expect(n.find((m) => m.row.id === 1)).toBeUndefined();
  });

  it("uses log-space distance in (total_exposure, pulse_intensity)", () => {
    const anchor = row(1, [0, 0, 0], 100, 0.001);
    const close = row(2, [0, 0, 0], 100, 0.001);   // identical regime
    const far = row(3, [0, 0, 0], 10000, 0.1);     // 2 decades away on each axis
    const n = nearestByRegime(anchor, [anchor, close, far], 5);
    expect(n[0].row.id).toBe(2);
    expect(n[0].distance).toBeCloseTo(0, 4);
    expect(n[1].row.id).toBe(3);
    expect(n[1].distance).toBeCloseTo(Math.hypot(2, 2), 4);  // ≈ 2.828
  });
});
