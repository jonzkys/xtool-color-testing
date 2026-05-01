import { describe, expect, it } from "vitest";
import {
  cellRectInImagePx,
  imagePxToCell,
  resolveSwatchIndex,
} from "./cellInspectorMath";
import type { GridLayout } from "../types";

const TWO_D: GridLayout = {
  // 60×40 mm grid of 6×4 cells, 10 mm each, no axis gap.
  // QR + ArUco shifted origin to (150, 150) px from top-left.
  image_width_px: 800,
  image_height_px: 600,
  grid_origin_x_px: 150,
  grid_origin_y_px: 150,
  cell_width_px: 100,
  cell_height_px: 100,
  row_stride_px: 100,
  cells_per_physical_row: 6,
  physical_rows: 4,
  is_2d: true,
  px_per_mm: 10,
};

const WRAPPED_1D: GridLayout = {
  // 10 cells wrapped onto 3 rows × 4 cols (last row has 2 cells).
  // Row stride includes a 20-px gap between rows.
  image_width_px: 600,
  image_height_px: 600,
  grid_origin_x_px: 100,
  grid_origin_y_px: 100,
  cell_width_px: 100,
  cell_height_px: 80,
  row_stride_px: 100,  // 80 cell + 20 gap
  cells_per_physical_row: 4,
  physical_rows: 3,
  is_2d: false,
  px_per_mm: 10,
};

describe("imagePxToCell", () => {
  describe("2D", () => {
    it("returns null when outside the grid", () => {
      expect(imagePxToCell(TWO_D, 0, 0)).toBeNull();
      expect(imagePxToCell(TWO_D, 9999, 9999)).toBeNull();
      expect(imagePxToCell(TWO_D, 100, 200)).toBeNull(); // left of grid
    });

    it("hits the centre of (0, 0)", () => {
      const cell = imagePxToCell(TWO_D, 200, 200);
      expect(cell).toEqual({ physicalRow: 0, displayedCol: 0 });
    });

    it("hits a mid-grid cell", () => {
      const cell = imagePxToCell(TWO_D, 460, 380);  // (col=3.1, row=2.3) → (3, 2)
      expect(cell).toEqual({ physicalRow: 2, displayedCol: 3 });
    });

    it("returns null at right edge of last cell + 1px (out of bounds)", () => {
      // Last col bottom-right is at grid_origin + 6 cells * 100 = 750.
      expect(imagePxToCell(TWO_D, 751, 200)).toBeNull();
    });
  });

  describe("wrapped 1D", () => {
    it("returns null when in the inter-row gutter", () => {
      // Row 0 cell ends at y = 100 + 80 = 180; gap occupies 180–200.
      expect(imagePxToCell(WRAPPED_1D, 200, 190)).toBeNull();
    });

    it("hits cells in different physical rows", () => {
      // Physical row 0, col 2:
      expect(imagePxToCell(WRAPPED_1D, 350, 150)).toEqual({
        physicalRow: 0, displayedCol: 2,
      });
      // Physical row 1, col 0 (y in [200, 280]):
      expect(imagePxToCell(WRAPPED_1D, 150, 240)).toEqual({
        physicalRow: 1, displayedCol: 0,
      });
      // Physical row 2, col 1 (y in [300, 380]):
      expect(imagePxToCell(WRAPPED_1D, 250, 350)).toEqual({
        physicalRow: 2, displayedCol: 1,
      });
    });

    it("rejects past-the-edge in last partial row", () => {
      // Last row only has 2 cells (cols 0 and 1) but the math doesn't
      // know that — it's the swatch-lookup that returns null. So this
      // test is for the resolveSwatchIndex helper below.
      expect(imagePxToCell(WRAPPED_1D, 350, 350)).toEqual({
        physicalRow: 2, displayedCol: 2,
      });
    });
  });
});

describe("resolveSwatchIndex", () => {
  it("2D maps physicalRow → row, displayedCol → col", () => {
    const idx = resolveSwatchIndex(TWO_D, { physicalRow: 2, displayedCol: 3 });
    expect(idx).toEqual({ row: 2, col: 3 });
  });

  it("wrapped 1D preserves (physicalRow, displayedCol) — backend stores swatches under that key", () => {
    // Backend convention: for wrapped 1D, swatch i has row=i//per_row,
    // col=i%per_row. The reverse lookup must mirror that exactly so
    // hovers on the second physical row and beyond hit the right swatch.
    expect(
      resolveSwatchIndex(WRAPPED_1D, { physicalRow: 1, displayedCol: 2 }),
    ).toEqual({ row: 1, col: 2 });
    expect(
      resolveSwatchIndex(WRAPPED_1D, { physicalRow: 2, displayedCol: 0 }),
    ).toEqual({ row: 2, col: 0 });
  });

  it("returns null for swatch indices in unused cells of a wrapped tail", () => {
    // 10 cells across 3 rows × 4 cols leaves cells (2,2) and (2,3) unused.
    // The caller passes an x_steps to bound the lookup.
    const idx = resolveSwatchIndex(
      WRAPPED_1D,
      { physicalRow: 2, displayedCol: 2 },
      /*x_steps*/ 10,
    );
    expect(idx).toBeNull();
  });

  it("accepts the last real cell of a wrapped tail", () => {
    const idx = resolveSwatchIndex(
      WRAPPED_1D,
      { physicalRow: 2, displayedCol: 1 },
      /*x_steps*/ 10,
    );
    expect(idx).toEqual({ row: 2, col: 1 });
  });
});

describe("cellRectInImagePx", () => {
  it("forward math agrees with the layout's grid origin + cell size", () => {
    const r = cellRectInImagePx(TWO_D, { physicalRow: 1, displayedCol: 2 });
    // origin (150,150) + col*100 = 350 left; row 1 → top 250
    expect(r).toEqual({
      left: 350, top: 250, width: 100, height: 100,
    });
  });

  it("uses cell_height_px not row_stride_px for height (so the rect doesn't bleed into the gutter)", () => {
    const r = cellRectInImagePx(WRAPPED_1D, { physicalRow: 1, displayedCol: 0 });
    expect(r).toEqual({
      left: 100, top: 200, width: 100, height: 80,  // <- 80, not 100
    });
  });
});
