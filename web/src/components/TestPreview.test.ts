import { describe, expect, test } from "vitest";
import { computePreviewGeometry } from "./TestPreview";
import { DEFAULT_SPEC } from "../defaults";
import { normalizeSpec } from "../specUtils";

describe("computePreviewGeometry", () => {
  test("1D 10 steps, rows=1 → one row of 10 cells", () => {
    const g = computePreviewGeometry({ ...DEFAULT_SPEC, x_steps: 10, rows: 1 });
    expect(g.rows).toHaveLength(1);
    expect(g.rows[0].cells).toHaveLength(10);
  });

  test("wrapped 20 steps across 2 rows → 10+10", () => {
    const g = computePreviewGeometry({ ...DEFAULT_SPEC, x_steps: 20, rows: 2 });
    expect(g.rows).toHaveLength(2);
    expect(g.rows.map(r => r.cells.length)).toEqual([10, 10]);
  });

  test("registration markers emit when mode=on", () => {
    const g = computePreviewGeometry(DEFAULT_SPEC);
    expect(g.qr).not.toBeNull();
    expect(g.arucos).toHaveLength(3);
  });

  test("registration markers absent when mode=off", () => {
    const g = computePreviewGeometry({
      ...DEFAULT_SPEC,
      registration: { mode: "off", qr_size_mm: null, aruco_size_mm: null },
    });
    expect(g.qr).toBeNull();
    expect(g.arucos).toHaveLength(0);
  });

  test("square_cells true with wrapped rows produces square cells", () => {
    // 14 steps across 5 rows on a 50mm-wide test → 3 cells per row,
    // each cell width = (50 - 2*0.5)/3 = 16.333.
    // After normalizeSpec, height_mm = 16.333 (per-row cell height).
    // Preview must render cells as squares (w ≈ h).
    const spec = normalizeSpec({
      ...DEFAULT_SPEC, x_steps: 14, rows: 5, width_mm: 50, gap_mm: 0.5,
    });
    const g = computePreviewGeometry(spec);
    const cell = g.rows[0].cells[0];
    expect(cell.w).toBeCloseTo(cell.h, 2);
  });

  test("2D square_cells true produces square cells", () => {
    const spec = normalizeSpec({
      ...DEFAULT_SPEC,
      x_steps: 5, y_param: "power", y_min: 0, y_max: 100, y_steps: 4,
      width_mm: 50, gap_mm: 0.5,
    });
    const g = computePreviewGeometry(spec);
    const cell = g.rows[0].cells[0];
    expect(cell.w).toBeCloseTo(cell.h, 2);
  });

  test("cells carry a row-major flat index", () => {
    // 14 cells across 3 rows of cells_per_row=5 → first two rows have
    // 5 cells each, last row has 4. Flat index runs 0..13 in
    // row-major order (the same order .xcs builder iterates in).
    const g = computePreviewGeometry(
      { ...DEFAULT_SPEC, x_steps: 14, rows: 3 },
      { cellCount: 14, cellsPerRow: 5 },
    );
    expect(g.rows.map((r) => r.cells.length)).toEqual([5, 5, 4]);
    // First cell of each row.
    expect(g.rows[0].cells[0].idx).toBe(0);
    expect(g.rows[1].cells[0].idx).toBe(5);
    expect(g.rows[2].cells[0].idx).toBe(10);
    // Last cell overall.
    const lastRow = g.rows[2].cells;
    expect(lastRow[lastRow.length - 1].idx).toBe(13);
  });
});
