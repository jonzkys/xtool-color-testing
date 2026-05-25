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

import { signedArea, inferWindingAndOutside } from "./contour";

describe("signedArea / winding", () => {
  it("is positive for CCW, negative for CW (screen coords, y-down)", () => {
    const ccw = { points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }], closed: true };
    const cw = { points: [...ccw.points].reverse(), closed: true };
    expect(Math.sign(signedArea(ccw))).toBe(1);
    expect(Math.sign(signedArea(cw))).toBe(-1);
  });
});

describe("inferWindingAndOutside", () => {
  it("is confident for a clean closed polygon", () => {
    const sq = { points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }], closed: true };
    const r = inferWindingAndOutside(sq);
    expect(r.confident).toBe(true);
    // outsideSign is +1 or -1, the delta sign that inflates away from the interior
    expect(Math.abs(r.outsideSign)).toBe(1);
  });
  it("is not confident for an open contour", () => {
    const open = { points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }], closed: false };
    expect(inferWindingAndOutside(open).confident).toBe(false);
  });
});

import { segmentContour, detectCorners, resampleByArcLength, splitSubpaths } from "./contour";
import type { Pt } from "./types";

describe("resampleByArcLength", () => {
  it("places points every step along a straight line", () => {
    const line = { points: [{ x: 0, y: 0 }, { x: 10, y: 0 }], closed: false };
    const r = resampleByArcLength(line, 2);
    expect(r.length).toBe(6); // 0,2,4,6,8,10
    expect(r[3]).toEqual({ x: 6, y: 0 });
  });
});

describe("segmentContour", () => {
  it("splits a 40mm closed square into ~4 segments of 10mm at segLen=10", () => {
    const sq = { points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }], closed: true };
    const segs = segmentContour(sq, 10);
    expect(segs.length).toBe(4);
    // each segment is a short polyline
    expect(segs[0].points.length).toBeGreaterThanOrEqual(2);
  });
  it("covers the whole perimeter (segment lengths sum ≈ perimeter)", () => {
    const sq = { points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }], closed: true };
    const segs = segmentContour(sq, 7);
    const total = segs.reduce((s, seg) => s + contourPerimeter({ points: seg.points, closed: false }), 0);
    expect(total).toBeCloseTo(40, 2);
  });
});

describe("detectCorners", () => {
  it("flags the 4 corners of a square above a 45° threshold", () => {
    const sq = { points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }], closed: true };
    const idx = detectCorners(sq, 45);
    expect(idx.sort((a, b) => a - b)).toEqual([0, 1, 2, 3]);
  });
  it("flags nothing on a gently sampled circle at a high threshold", () => {
    const pts: Pt[] = [];
    for (let i = 0; i < 64; i++) {
      const t = (i / 64) * Math.PI * 2;
      pts.push({ x: Math.cos(t) * 10, y: Math.sin(t) * 10 });
    }
    expect(detectCorners({ points: pts, closed: true }, 45)).toEqual([]);
  });
});

describe("splitSubpaths", () => {
  // Two separate squares as a compound path (M…Z M…Z)
  const TWO_SQUARES =
    "M0,0 L10,0 L10,10 L0,10 Z M20,0 L30,0 L30,10 L20,10 Z";
  const ONE_SQUARE = "M0,0 L10,0 L10,10 L0,10 Z";

  it("returns 2 contours for a 2-subpath compound path", () => {
    const result = splitSubpaths(TWO_SQUARES);
    expect(result.length).toBe(2);
  });

  it("each subpath is closed and has the right points", () => {
    const result = splitSubpaths(TWO_SQUARES);
    // both are closed squares with 4 distinct points (normaliseContour removes the closing dup)
    expect(result[0].closed).toBe(true);
    expect(result[0].points.length).toBe(4);
    expect(result[1].closed).toBe(true);
    expect(result[1].points.length).toBe(4);
    // first subpath anchored at (0,0)
    expect(result[0].points[0]).toEqual({ x: 0, y: 0 });
    // second subpath anchored at (20,0)
    expect(result[1].points[0]).toEqual({ x: 20, y: 0 });
  });

  it("returns 1 contour for a single-subpath path", () => {
    const result = splitSubpaths(ONE_SQUARE);
    expect(result.length).toBe(1);
    expect(result[0].closed).toBe(true);
    expect(result[0].points.length).toBe(4);
  });

  it("drops degenerate subpaths with fewer than 3 points", () => {
    // A compound path where second subpath has only 2 points (a line, not a polygon)
    const degenerate = "M0,0 L10,0 L10,10 L0,10 Z M50,50 L60,60";
    const result = splitSubpaths(degenerate);
    expect(result.length).toBe(1);
    expect(result[0].points[0]).toEqual({ x: 0, y: 0 });
  });
});
