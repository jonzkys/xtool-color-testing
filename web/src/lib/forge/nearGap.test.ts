import { describe, it, expect } from "vitest";
import { inPart, detectNearGaps, buildSlotRect, slotInScrap } from "./nearGap";
import type { Pt } from "./types";

const rect = (x: number, y: number, w: number, h: number): Pt[] => [
  { x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h },
];

describe("inPart (count-based even-odd)", () => {
  const ring = [rect(0, 0, 20, 20), rect(6, 6, 8, 8)]; // outer + hole
  it("is inside the ring wall, outside the ring hole", () => {
    expect(inPart(ring, { x: 2, y: 10 })).toBe(true);
    expect(inPart(ring, { x: 10, y: 10 })).toBe(false);
    expect(inPart(ring, { x: -5, y: 10 })).toBe(false);
  });
});

describe("detectNearGaps", () => {
  it("finds the scrap neck between two near-touching bars", () => {
    const part = [rect(0, 0, 10, 2), rect(0, 2.6, 10, 2)];
    const anchors = detectNearGaps(part, 1.5);
    expect(anchors.length).toBeGreaterThan(0);
    const a = anchors[0];
    expect(a.pt.y).toBeGreaterThan(1.8);
    expect(a.pt.y).toBeLessThan(2.8);
    expect(inPart(part, a.pt)).toBe(false);
    expect(Math.abs(a.dirX)).toBeGreaterThan(Math.abs(a.dirY));
  });

  it("does NOT flag a lone convex square (no neck)", () => {
    expect(detectNearGaps([rect(0, 0, 10, 10)], 1.5)).toHaveLength(0);
  });

  it("flags the annular scrap of a ring+dot", () => {
    const part = [rect(0, 0, 20, 20), rect(4, 4, 12, 12), rect(9, 9, 2, 2)];
    const anchors = detectNearGaps(part, 2.5);
    expect(anchors.length).toBeGreaterThan(0);
    expect(anchors.every((a) => inPart(part, a.pt) === false)).toBe(true);
  });
});

describe("slot geometry + guard", () => {
  const part = [rect(0, 0, 10, 10)];
  it("buildSlotRect returns a 4-corner kerf-wide rectangle along dir", () => {
    const r = buildSlotRect({ x: 12, y: 5 }, 1, 0, 1.0, 0.06);
    expect(r).toHaveLength(4);
    const xs = r.map((p) => p.x), ys = r.map((p) => p.y);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(1.0, 3);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(0.06, 3);
  });
  it("slotInScrap is true fully outside the part, false when it crosses in", () => {
    const outside = buildSlotRect({ x: 12, y: 5 }, 1, 0, 1.0, 0.06);
    expect(slotInScrap(outside, { x: 12, y: 5 }, 1, 0, 1.0, part)).toBe(true);
    const crossing = buildSlotRect({ x: 9.7, y: 5 }, 1, 0, 1.0, 0.06);
    expect(slotInScrap(crossing, { x: 9.7, y: 5 }, 1, 0, 1.0, part)).toBe(false);
  });
});
