import { describe, it, expect } from "vitest";
import {
  buildCorrelationMatrix,
  INDEX_ROWS,
  CHANNEL_COLS,
  type ExposureRow,
} from "./exposureCorrelations";

function row(
  surface: number,
  l: number,
  a: number,
  b: number,
): ExposureRow {
  return {
    id: 0,
    hex: "#000000",
    lab: [l, a, b],
    indices: {
      pulse_spacing_mm: 0.01,
      line_spacing_index: 0.01,
      line_spacing_mm: null,
      pulse_energy_index: 0.7,
      pulse_intensity_index: 0.003,
      surface_exposure_index: surface,
      total_exposure_index: surface,
      ablation_aggression_index: 0.02,
      delivery_smoothness_index: 1000,
      formula_version: 2,
      density_model: "opaque",
      power_model: "controller_percent",
    },
  };
}

describe("buildCorrelationMatrix", () => {
  it("dimensions are 5 indices × 5 channels", () => {
    const rows: ExposureRow[] = [row(10, 50, 0, 0), row(20, 40, 0, 0), row(30, 30, 0, 0)];
    const m = buildCorrelationMatrix(rows);
    expect(INDEX_ROWS.length).toBe(5);
    expect(CHANNEL_COLS.length).toBe(5);
    expect(m.length).toBe(5);
    expect(m[0].length).toBe(5);
  });

  it("strong negative correlation surface_exposure × L* yields high |r|", () => {
    const rows: ExposureRow[] = [
      row(10, 80, 0, 0),
      row(30, 60, 0, 0),
      row(70, 40, 0, 0),
      row(100, 20, 0, 0),
    ];
    const m = buildCorrelationMatrix(rows);
    const surfaceRow = INDEX_ROWS.indexOf("surface_exposure_index");
    const lCol = CHANNEL_COLS.indexOf("L");
    const r = m[surfaceRow][lCol];
    expect(Math.abs(r)).toBeGreaterThan(0.95);
    expect(r).toBeLessThan(0);
  });

  it("returns NaN cells when fewer than 2 valid rows", () => {
    const m = buildCorrelationMatrix([row(10, 50, 0, 0)]);
    expect(Number.isNaN(m[0][0])).toBe(true);
  });

  it("excludes rows with formula_version=0 by default", () => {
    const a = row(10, 80, 0, 0);
    const b = row(30, 60, 0, 0);
    const c = row(50, 40, 0, 0);
    const stale = { ...row(99, 99, 0, 0) };
    stale.indices = { ...stale.indices, formula_version: 0 };
    const m = buildCorrelationMatrix([a, b, c, stale]);
    const surfaceRow = INDEX_ROWS.indexOf("surface_exposure_index");
    const lCol = CHANNEL_COLS.indexOf("L");
    expect(Math.abs(m[surfaceRow][lCol])).toBeGreaterThan(0.99);
  });

  it("computes hue and chroma columns from a/b", () => {
    const rows = [row(10, 50, 0, 0), row(50, 60, 0, 0)];
    const m = buildCorrelationMatrix(rows);
    const chromaCol = CHANNEL_COLS.indexOf("chroma");
    expect(Number.isNaN(m[0][chromaCol])).toBe(true);
  });
});
