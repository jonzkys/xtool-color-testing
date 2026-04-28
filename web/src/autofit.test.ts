import { describe, expect, it } from "vitest";
import { computeAutoFitGrid, gridHeightToSpecHeight } from "./autofit";

const MARGIN = 1.5;
const QR = 5;
const ARU = 2;
const X_CHROME = Math.max(QR, ARU) + MARGIN + (ARU + MARGIN); // 10
const Y_CHROME = X_CHROME;

describe("computeAutoFitGrid", () => {
  it("rect material with no buffer subtracts only marker chrome", () => {
    const grid = computeAutoFitGrid({
      shape: "rect",
      diameter_mm: null,
      width_mm: 50,
      height_mm: 50,
      buffer_pct: 0,
    });
    expect(grid).not.toBeNull();
    expect(grid!.grid_w).toBeCloseTo(50 - X_CHROME, 5);
    expect(grid!.grid_h).toBeCloseTo(50 - Y_CHROME, 5);
    expect(grid!.inscribed_square).toBe(false);
  });

  it("rect material with 2% buffer subtracts buffer from each dim before chrome", () => {
    const grid = computeAutoFitGrid({
      shape: "rect",
      diameter_mm: null,
      width_mm: 100,
      height_mm: 60,
      buffer_pct: 2,
    });
    expect(grid).not.toBeNull();
    // (100 × 0.96) - 10 = 86
    expect(grid!.grid_w).toBeCloseTo(100 * 0.96 - X_CHROME, 5);
    expect(grid!.grid_h).toBeCloseTo(60 * 0.96 - Y_CHROME, 5);
  });

  it("circle material inscribes a square minus buffer", () => {
    const grid = computeAutoFitGrid({
      shape: "circle",
      diameter_mm: 50,
      width_mm: null, height_mm: null,
      buffer_pct: 2,
    });
    expect(grid).not.toBeNull();
    // (50 × 0.96) / sqrt(2) - 10 ≈ 23.94
    const expected = (50 * 0.96) / Math.SQRT2 - X_CHROME;
    expect(grid!.grid_w).toBeCloseTo(expected, 4);
    expect(grid!.grid_h).toBeCloseTo(expected, 4);
    expect(grid!.inscribed_square).toBe(true);
  });

  it("returns null when shape is unset", () => {
    expect(computeAutoFitGrid({
      shape: null, diameter_mm: null, width_mm: null, height_mm: null,
      buffer_pct: 2,
    })).toBeNull();
  });

  it("returns null when material is too small to host the markers", () => {
    expect(computeAutoFitGrid({
      shape: "rect", diameter_mm: null,
      width_mm: 5, height_mm: 5,  // smaller than chrome
      buffer_pct: 0,
    })).toBeNull();
  });

  it("registration_on=false drops the chrome subtraction", () => {
    const grid = computeAutoFitGrid({
      shape: "rect", diameter_mm: null,
      width_mm: 30, height_mm: 30,
      buffer_pct: 0,
      registration_on: false,
    });
    expect(grid).not.toBeNull();
    expect(grid!.grid_w).toBeCloseTo(30, 5);
    expect(grid!.grid_h).toBeCloseTo(30, 5);
  });
});

describe("gridHeightToSpecHeight", () => {
  it("2D test → spec.height is total grid height", () => {
    const h = gridHeightToSpecHeight({
      grid_h: 30, rows: 5, gap_mm: 0.5, hide_axis_labels: false, is_2d: true,
    });
    expect(h).toBe(30);
  });

  it("single-row 1D → spec.height is the same as grid_h", () => {
    const h = gridHeightToSpecHeight({
      grid_h: 10, rows: 1, gap_mm: 0.5, hide_axis_labels: false, is_2d: false,
    });
    expect(h).toBe(10);
  });

  it("wrapped 1D with axis labels reserves the annotation gap", () => {
    // ROW_ANNOTATION_MM ≈ 2.1 (TICK 0.5 + 0.1 + LABEL 1.4 + 0.1)
    // total = 5 cells × cell_h + 4 × 2.1 = 5h + 8.4 → cell_h = (g - 8.4) / 5
    const h = gridHeightToSpecHeight({
      grid_h: 30, rows: 5, gap_mm: 0.5, hide_axis_labels: false, is_2d: false,
    });
    expect(h).toBeCloseTo((30 - 4 * 2.1) / 5, 4);
  });

  it("wrapped 1D with axis labels off uses gap_mm directly", () => {
    const h = gridHeightToSpecHeight({
      grid_h: 30, rows: 5, gap_mm: 0.5, hide_axis_labels: true, is_2d: false,
    });
    expect(h).toBeCloseTo((30 - 4 * 0.5) / 5, 4);
  });
});
