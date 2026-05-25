// web/src/lib/forge/contour.test.ts
import { describe, it, expect } from "vitest";
import {
  flattenDPath,
  normaliseContour,
  detectClosedContour,
  contourPerimeter,
} from "./contour";

describe("flattenDPath", () => {
  it("flattens M/L/Z into a closed polyline", () => {
    const c = flattenDPath("M0,0 L10,0 L10,10 L0,10 Z");
    expect(c.closed).toBe(true);
    expect(c.points[0]).toEqual({ x: 0, y: 0 });
    expect(c.points).toContainEqual({ x: 10, y: 10 });
  });

  it("flattens a quadratic bezier (Q) into multiple points", () => {
    const c = flattenDPath("M0,0 Q5,10 10,0");
    expect(c.points.length).toBeGreaterThan(3); // subdivided
    expect(c.points[0]).toEqual({ x: 0, y: 0 });
    const last = c.points[c.points.length - 1];
    expect(last.x).toBeCloseTo(10, 3);
    expect(last.y).toBeCloseTo(0, 3);
  });

  it("flattens a cubic bezier (C)", () => {
    const c = flattenDPath("M0,0 C0,10 10,10 10,0");
    expect(c.points.length).toBeGreaterThan(3);
    expect(c.points[c.points.length - 1].x).toBeCloseTo(10, 3);
  });

  it("supports comma- and space-separated coords", () => {
    const a = flattenDPath("M0 0 L10 0");
    const b = flattenDPath("M0,0L10,0");
    expect(a.points).toEqual(b.points);
  });
});

describe("detectClosedContour", () => {
  it("detects an explicitly closed path", () => {
    expect(detectClosedContour(flattenDPath("M0,0 L10,0 L0,10 Z"))).toBe(true);
  });
  it("treats first≈last as closed even without Z", () => {
    const c = { points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 0 }], closed: false };
    expect(detectClosedContour(c)).toBe(true);
  });
  it("reports open for a non-returning polyline", () => {
    const c = { points: [{ x: 0, y: 0 }, { x: 10, y: 0 }], closed: false };
    expect(detectClosedContour(c)).toBe(false);
  });
});

describe("normaliseContour", () => {
  it("drops duplicate consecutive points and a closing dupe", () => {
    const c = normaliseContour({
      points: [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 0 }],
      closed: true,
    });
    // closing duplicate removed, interior dupe collapsed
    expect(c.points).toEqual([{ x: 0, y: 0 }, { x: 10, y: 0 }]);
    expect(c.closed).toBe(true);
  });
});

describe("contourPerimeter", () => {
  it("measures a closed unit square as 4", () => {
    const sq = flattenDPath("M0,0 L1,0 L1,1 L0,1 Z");
    expect(contourPerimeter(sq)).toBeCloseTo(4, 6);
  });
});
