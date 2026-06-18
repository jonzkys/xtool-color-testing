import { describe, it, expect } from "vitest";
import { renderLabel, glyphSegments, labelWidth } from "./strokeFont";

describe("glyphSegments", () => {
  it("maps a digit to its 7-segment strokes (1 = two segments)", () => {
    expect(glyphSegments("1").length).toBe(2); // segments b + c
    expect(glyphSegments("8").length).toBe(7); // all 7 segments
  });
  it("space renders nothing; unknown char renders nothing", () => {
    expect(glyphSegments(" ")).toEqual([]);
    expect(glyphSegments("Z")).toEqual([]);
  });
  it("'/' is a single diagonal stroke", () => {
    expect(glyphSegments("/").length).toBe(1);
  });
  it("'.' is a small closed box (4 strokes), so the decimal point engraves legibly", () => {
    expect(glyphSegments(".").length).toBe(4);
  });
});

describe("labelWidth", () => {
  it("is tight: (N-1) advances + one glyph cell, no trailing gap", () => {
    // ADVANCE = 0.85, W = 0.6; one glyph occupies exactly W·size
    expect(labelWidth("1", 4)).toBeCloseTo(0.6 * 4, 5);
    // "1.0" = 2·0.85 + 0.6 = 2.3 cells
    expect(labelWidth("1.0", 4)).toBeCloseTo((2 * 0.85 + 0.6) * 4, 5);
    expect(labelWidth("", 4)).toBe(0);
  });
});

describe("renderLabel", () => {
  it("returns open polylines positioned from the origin, advancing right", () => {
    const polys = renderLabel("1.0", 4, { x: 10, y: 20 });
    expect(polys.length).toBeGreaterThan(0);
    // every segment is a 2-point open polyline
    for (const p of polys) expect(p.length).toBe(2);
    // all points lie at/right of origin.x and within a few glyph widths
    const xs = polys.flat().map((p) => p.x);
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(10 - 1e-9);
    // three glyphs ("1",".","0") advance well past origin
    expect(Math.max(...xs)).toBeGreaterThan(10 + 4);
  });
  it("scales with sizeMm (glyph height ≈ sizeMm)", () => {
    const polys = renderLabel("8", 6, { x: 0, y: 0 });
    const ys = polys.flat().map((p) => p.y);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(6, 5);
  });
});
