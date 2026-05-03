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
      expect(Math.min(...xs)).toBe(s.id === "L" ? 0 : 10);
      expect(Math.max(...xs)).toBe(s.id === "L" ? 10 : 20);
      expect(Math.min(...ys)).toBe(0);
      expect(Math.max(...ys)).toBe(10);
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

  it("preserves ring closure flag round-trip", () => {
    const out = simplifyTopology([
      { id: "open", rings: [{ closed: false, points: [{ x: 0, y: 0 }, { x: 10, y: 0 }] }] },
      { id: "shut", rings: [{ closed: true, points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }] }] },
    ], 0.0);
    expect(out.find((s) => s.id === "open")!.rings[0].closed).toBe(false);
    expect(out.find((s) => s.id === "shut")!.rings[0].closed).toBe(true);
  });
});
