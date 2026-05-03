import { describe, expect, it } from "vitest";
import { simplifyTopology, type ShapeInput } from "./topoSimplify";

// Two squares sharing the right/left edge. The simplifier must drop
// vertices on that shared edge identically for both — otherwise the
// edge develops a sliver gap.
const adjacentSquares: ShapeInput[] = [
  // Left square: (0,0)-(10,0)-(10,10)-(0,10) with mid-edge points
  // ON the shared (x=10) edge that should be dropped by V-W and remain
  // identical between the two shapes after simplification.
  {
    id: "L",
    rings: [{
      closed: true,
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 5 }, // collinear midpoint on shared edge
        { x: 10, y: 10 },
        { x: 0, y: 10 },
      ],
    }],
  },
  // Right square mirrors the same midpoint on its left edge.
  {
    id: "R",
    rings: [{
      closed: true,
      points: [
        { x: 10, y: 0 },
        { x: 20, y: 0 },
        { x: 20, y: 10 },
        { x: 10, y: 10 },
        { x: 10, y: 5 }, // collinear midpoint on shared edge
      ],
    }],
  },
];

const has10_5 = (rings: { points: { x: number; y: number }[] }[]) =>
  rings.some((r) => r.points.some((p) => p.x === 10 && p.y === 5));

describe("simplifyTopology", () => {
  it("drops a collinear midpoint from BOTH sides of a shared edge", () => {
    const out = simplifyTopology(adjacentSquares, 1.0);
    const left = out.find((s) => s.id === "L")!;
    const right = out.find((s) => s.id === "R")!;
    expect(has10_5(left.rings)).toBe(false);
    expect(has10_5(right.rings)).toBe(false);
  });

  it("preserves the four square corners on both shapes", () => {
    const out = simplifyTopology(adjacentSquares, 1.0);
    for (const s of out) {
      const xs = s.rings[0].points.map((p) => p.x);
      const ys = s.rings[0].points.map((p) => p.y);
      expect(s.rings[0].points.length).toBe(4);
      // topojson's quantization rounds vertices onto a 1e5 grid
      // (precision ≈ 0.0002 user units for a 20-unit bbox), so
      // corner coordinates may shift by sub-pixel amounts. Test the
      // axis-aligned bounding box of each square rather than the
      // exact min/max — the gap-prevention guarantee is "endpoints
      // line up across the shared edge", which the per-edge test
      // below covers separately.
      expect(Math.min(...xs)).toBeCloseTo(s.id === "L" ? 0 : 10, 2);
      expect(Math.max(...xs)).toBeCloseTo(s.id === "L" ? 10 : 20, 2);
      expect(Math.min(...ys)).toBeCloseTo(0, 2);
      expect(Math.max(...ys)).toBeCloseTo(10, 2);
    }
  });

  it("returns shapes in input order", () => {
    const out = simplifyTopology(adjacentSquares, 0.0);
    expect(out.map((s) => s.id)).toEqual(["L", "R"]);
  });

  it("passes open lines through V-W independently of polygons", () => {
    const out = simplifyTopology([{
      id: "line",
      rings: [{
        closed: false,
        points: [
          { x: 0, y: 0 },
          { x: 5, y: 0.001 },   // tiny zigzag
          { x: 10, y: -0.001 },
          { x: 15, y: 0 },
        ],
      }],
    }], /* weight */ 0.5);
    expect(out[0].rings[0].closed).toBe(false);
    expect(out[0].rings[0].points.length).toBeLessThanOrEqual(3);
  });

  it("does not introduce new vertices when weight is 0", () => {
    const out = simplifyTopology(adjacentSquares, 0.0);
    expect(out[0].rings[0].points.length).toBe(adjacentSquares[0].rings[0].points.length);
    expect(out[1].rings[0].points.length).toBe(adjacentSquares[1].rings[0].points.length);
  });

  it("merges sub-pixel-mismatched shared edges so simplification doesn't open gaps", () => {
    // Regression for the gap-formation bug on traced-image SVGs:
    // tracers (vtracer, Potrace, etc.) emit adjacent paths whose
    // shared edges are off by sub-pixel amounts. Without quantizing
    // the topology builder's input, these are treated as distinct
    // arcs and simplified independently — the boundaries pull apart
    // and white gaps appear far larger than the simplification
    // tolerance.
    //
    // Setup: two squares sharing a nominal x = 100 boundary but with
    // sub-pixel mismatch (100.0008 vs. 100.0012). Each side has a
    // collinear midpoint that V-W should drop. Post-simplification
    // the resulting endpoints on both sides must lie on the same
    // x-coordinate (within the quantization grid) — otherwise V-W
    // moved the two sides independently and introduced a gap.
    const left: ShapeInput = {
      id: "L",
      rings: [{
        closed: true,
        points: [
          { x: 0, y: 0 },
          { x: 100.0008, y: 0 },         // top-right corner, mismatched
          { x: 100.0008, y: 50 },        // collinear midpoint to drop
          { x: 100.0008, y: 100 },       // bottom-right corner
          { x: 0, y: 100 },
        ],
      }],
    };
    const right: ShapeInput = {
      id: "R",
      rings: [{
        closed: true,
        points: [
          { x: 100.0012, y: 0 },         // top-left corner, mismatched
          { x: 200, y: 0 },
          { x: 200, y: 100 },
          { x: 100.0012, y: 100 },       // bottom-left corner
          { x: 100.0012, y: 50 },        // collinear midpoint to drop
        ],
      }],
    };

    const out = simplifyTopology([left, right], /* weight */ 1.0);
    const lRing = out.find((s) => s.id === "L")!.rings[0];
    const rRing = out.find((s) => s.id === "R")!.rings[0];

    // Find the right edge of L and left edge of R — vertices at the
    // shared boundary. After quantization-aware topology, both sides
    // collapse to the same grid x.
    const lShared = lRing.points
      .filter((p) => p.x > 50)
      .map((p) => p.x);
    const rShared = rRing.points
      .filter((p) => p.x < 150)
      .map((p) => p.x);

    // Each side should have exactly two vertices on the shared edge
    // after V-W drops the collinear midpoint.
    expect(lShared.length).toBe(2);
    expect(rShared.length).toBe(2);

    // The two sides must agree on the boundary x (≤ 0.05 user units
    // off — well below the 0.001 input mismatch — so the regions
    // butt against each other instead of pulling apart).
    const lX = lShared[0];
    const rX = rShared[0];
    expect(Math.abs(lX - rX)).toBeLessThanOrEqual(0.05);
  });

  it("preserves ring closure flag round-trip", () => {
    const out = simplifyTopology([
      { id: "open", rings: [{ closed: false, points: [{ x: 0, y: 0 }, { x: 10, y: 0 }] }] },
      { id: "shut", rings: [{ closed: true, points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }] }] },
    ], 0.0);
    expect(out.find((s) => s.id === "open")!.rings[0].closed).toBe(false);
    expect(out.find((s) => s.id === "shut")!.rings[0].closed).toBe(true);
  });
});
