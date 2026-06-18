import { describe, it, expect } from "vitest";
import { shapeRegion, circleRegion, type CellShape } from "./spiralShapes";

const SHAPES: CellShape[] = ["circle", "square", "diamond", "hexagon", "octagon", "star", "letterJ"];

function span(rings: { x: number; y: number }[][]) {
  const pts = rings.flat();
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  return { w: maxX - minX, h: maxY - minY, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, n: pts.length };
}

describe("shapeRegion", () => {
  it("every shape is ≥1 closed loop, centred at (cx,cy), bounded by ~sizeMm", () => {
    for (const shape of SHAPES) {
      const rings = shapeRegion(shape, 50, 50, 10);
      expect(rings.length).toBeGreaterThanOrEqual(1);
      const s = span(rings);
      expect(s.n).toBeGreaterThanOrEqual(3);
      expect(Math.max(s.w, s.h)).toBeGreaterThan(4);
      expect(Math.max(s.w, s.h)).toBeLessThanOrEqual(10.01);
      expect(Math.abs(s.cx - 50)).toBeLessThan(0.6);
      expect(Math.abs(s.cy - 50)).toBeLessThan(0.6);
    }
  });
  it("polygons are far fewer region points than a circle", () => {
    const circlePts = circleRegion(50, 50, 10)[0].length; // 96
    for (const shape of ["square", "diamond", "hexagon", "octagon"] as CellShape[]) {
      expect(shapeRegion(shape, 50, 50, 10)[0].length).toBeLessThan(circlePts);
    }
  });
  it("letterJ scales its larger dimension to ~sizeMm", () => {
    const s = span(shapeRegion("letterJ", 50, 50, 10));
    expect(Math.max(s.w, s.h)).toBeCloseTo(10, 1);
  });
});
