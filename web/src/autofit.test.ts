import { describe, expect, it } from "vitest";
import { computeAutoFitGrid, gridHeightToSpecHeight, squareCellAutoFit } from "./autofit";

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

describe("squareCellAutoFit", () => {
  it("single-row 1D — width-limited cells (10 cells in a 17×17 grid)", () => {
    // Repro for the bug the user reported: 40mm circle → ~17.15×17.15
    // grid bounds, x_steps=10, rows=1. Width-derived cell ≈ 1.265mm
    // is the limit, so the grid collapses to a single row of 1.265mm
    // cells instead of 10 narrow tall strips.
    const sq = squareCellAutoFit({
      grid_w: 17.15, grid_h: 17.153,
      x_steps: 10, y_steps: 1, rows: 1,
      gap_mm: 0.5, hide_axis_labels: false, is_2d: false,
    });
    expect(sq).not.toBeNull();
    const cellSide = (17.15 - 9 * 0.5) / 10;
    expect(sq!.width_mm).toBeCloseTo(17.15, 3);
    expect(sq!.height_mm).toBeCloseTo(cellSide, 4);
  });

  it("wrapped 1D — picks the limiting axis", () => {
    // 50mm-wide grid, 20mm tall. x_steps=10 across 4 rows.
    // perRow=3 → cellW = (50 - 2·0.5)/3 = 16.33
    // interRowGap = max(0.5, 2.1) = 2.1 → cellH = (20 - 3·2.1)/4 = 3.425
    // limit = cellH (smaller), so cell side = 3.425.
    const sq = squareCellAutoFit({
      grid_w: 50, grid_h: 20,
      x_steps: 10, y_steps: 1, rows: 4,
      gap_mm: 0.5, hide_axis_labels: false, is_2d: false,
    });
    expect(sq).not.toBeNull();
    const cellH_max = (20 - 3 * 2.1) / 4;
    expect(sq!.height_mm).toBeCloseTo(cellH_max, 4);
    expect(sq!.width_mm).toBeCloseTo(cellH_max * 3 + 2 * 0.5, 4);
  });

  it("2D — picks the smaller of width and height cell sides", () => {
    // 30 wide × 50 tall, 5x4 cells, gap 0.5.
    // cellW_max = (30 - 4·0.5)/5 = 5.6
    // cellH_max = (50 - 3·0.5)/4 = 12.125
    // limit = 5.6
    const sq = squareCellAutoFit({
      grid_w: 30, grid_h: 50,
      x_steps: 5, y_steps: 4, rows: 1,
      gap_mm: 0.5, hide_axis_labels: false, is_2d: true,
    });
    expect(sq).not.toBeNull();
    const cellSide = 5.6;
    expect(sq!.width_mm).toBeCloseTo(cellSide * 5 + 4 * 0.5, 4);
    expect(sq!.height_mm).toBeCloseTo(cellSide * 4 + 3 * 0.5, 4);
  });

  it("returns null when the grid is too small to host even one cell", () => {
    expect(squareCellAutoFit({
      grid_w: 0, grid_h: 0,
      x_steps: 10, y_steps: 1, rows: 1,
      gap_mm: 0.5, hide_axis_labels: false, is_2d: false,
    })).toBeNull();
  });
});
