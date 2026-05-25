// web/src/lib/forge/offset.test.ts
import { describe, it, expect } from "vitest";
import { offsetContour, generateOffsetStack } from "./offset";
import { signedArea, contourPerimeter } from "./contour";
import type { Contour } from "./types";

const square: Contour = {
  points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }],
  closed: true,
};

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

describe("generateOffsetStack", () => {
  it("1x outside-only yields just the centreline (no extra offsets)", () => {
    const stack = generateOffsetStack(square, 1, 0.05, "outside");
    expect(stack.length).toBe(1); // centreline only at width 1x
  });
  it("4x outside-only yields centreline + multiple outside offsets", () => {
    const stack = generateOffsetStack(square, 4, 0.05, "outside");
    expect(stack.length).toBeGreaterThan(2);
    // every offset ring is on the outside → larger perimeter than centreline
    const base = contourPerimeter(square);
    for (const ring of stack.slice(1)) {
      expect(contourPerimeter(ring)).toBeGreaterThanOrEqual(base);
    }
  });
  it("symmetric splits offsets to both sides", () => {
    const stack = generateOffsetStack(square, 4, 0.05, "symmetric");
    const base = contourPerimeter(square);
    const hasInner = stack.some((r) => contourPerimeter(r) < base);
    const hasOuter = stack.some((r) => contourPerimeter(r) > base);
    expect(hasInner && hasOuter).toBe(true);
  });
});
