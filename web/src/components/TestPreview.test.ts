import { describe, expect, test } from "vitest";
import { computePreviewGeometry } from "./TestPreview";
import { DEFAULT_SPEC } from "../defaults";

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
});
