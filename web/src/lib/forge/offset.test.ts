// web/src/lib/forge/offset.test.ts
import { describe, it, expect } from "vitest";
import { offsetContour, generateBand } from "./offset";
import { signedArea, contourPerimeter } from "./contour";
import type { Contour, Pt } from "./types";

const square: Contour = {
  points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }],
  closed: true,
};

/** |signed area| of a single loop (shoelace, sign-agnostic). */
function loopArea(loop: Pt[]): number {
  return Math.abs(signedArea({ points: loop, closed: true }));
}

describe("offsetContour", () => {
  it("inflates a CCW square outward (larger perimeter) for outsideSign +1, delta>0", () => {
    const ccw = signedArea(square) > 0 ? square : { ...square, points: [...square.points].reverse() };
    const out = offsetContour(ccw, 1, 1); // 1mm outward
    expect(out.length).toBe(1);
    expect(contourPerimeter(out[0])).toBeGreaterThan(contourPerimeter(ccw));
  });
  it("shrinks when offsetting inward (negative effective delta)", () => {
    const ccw = signedArea(square) > 0 ? square : { ...square, points: [...square.points].reverse() };
    const inward = offsetContour(ccw, 1, -1); // inside
    expect(contourPerimeter(inward[0])).toBeLessThan(contourPerimeter(ccw));
  });
});

describe("generateBand", () => {
  it("outside band is ≥2 loops with the outer loop larger than the original", () => {
    const rings = generateBand(square, 1, "outside");
    expect(rings.length).toBeGreaterThanOrEqual(2);
    const original = loopArea(square.points);
    // The outer offset loop encloses more area than the original contour loop.
    const maxArea = Math.max(...rings.map(loopArea));
    expect(maxArea).toBeGreaterThan(original);
    // The original contour loop is present as one of the rings (the inner loop).
    const minArea = Math.min(...rings.map(loopArea));
    expect(minArea).toBeLessThan(maxArea);
  });

  it("inside band exists (≥2 loops, inner smaller than original)", () => {
    const rings = generateBand(square, 1, "inside");
    expect(rings.length).toBeGreaterThanOrEqual(2);
    const original = loopArea(square.points);
    const minArea = Math.min(...rings.map(loopArea));
    expect(minArea).toBeLessThan(original);
  });

  it("symmetric returns loops on both sides of the contour", () => {
    const rings = generateBand(square, 2, "symmetric");
    expect(rings.length).toBeGreaterThanOrEqual(2);
    const original = loopArea(square.points);
    const hasOuter = rings.some((r) => loopArea(r) > original);
    const hasInner = rings.some((r) => loopArea(r) < original);
    expect(hasOuter && hasInner).toBe(true);
  });

  it("flip widens on the opposite side from outside", () => {
    const out = generateBand(square, 1, "outside");
    const flip = generateBand(square, 1, "flip");
    const outerOut = Math.max(...out.map(loopArea));
    const outerFlip = Math.max(...flip.map(loopArea));
    // outside grows the area; flip (inverted sign) does not grow it past original
    expect(outerOut).toBeGreaterThan(loopArea(square.points));
    expect(outerFlip).toBeLessThanOrEqual(loopArea(square.points) + 1e-6);
  });

  it("never returns a single loop and filters degenerate loops", () => {
    const rings = generateBand(square, 0.5, "outside");
    expect(rings.length).toBeGreaterThanOrEqual(2);
    expect(rings.every((r) => r.length >= 3)).toBe(true);
  });
});
