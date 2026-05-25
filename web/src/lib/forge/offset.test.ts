// web/src/lib/forge/offset.test.ts
import { describe, it, expect } from "vitest";
import { buildPartRegion, bandFromRegion, partOuterLoop } from "./offset";
import { signedArea } from "./contour";
import type { Contour, Pt } from "./types";

/** |signed area| of a single loop (shoelace, sign-agnostic). */
function loopArea(loop: Pt[]): number {
  return Math.abs(signedArea({ points: loop, closed: true }));
}

function bbox(rings: Pt[][]): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const r of rings) for (const p of r) {
    minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
  }
  return { minX, minY, maxX, maxY };
}

function rect(x0: number, y0: number, x1: number, y1: number, ccw: boolean): Contour {
  const pts: Pt[] = ccw
    ? [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }]
    : [{ x: x0, y: y0 }, { x: x0, y: y1 }, { x: x1, y: y1 }, { x: x1, y: y0 }];
  return { points: pts, closed: true };
}

describe("buildPartRegion", () => {
  it("two concentric squares (outer 0..20, inner 5..15, opposite winding) → part is the inner solid", () => {
    // The inner loop's first point sits inside the outer loop → nesting level 1
    // (odd); the outer is level 0. odd=[inner], evenPos=[]; the reconstructed
    // part solid is the inner region (the material bounded by the inner ring).
    const outer = rect(0, 0, 20, 20, true);
    const inner = rect(5, 5, 15, 15, false);
    const part = buildPartRegion([outer, inner]);
    expect(part.length).toBeGreaterThanOrEqual(1);
    // part is the inner 10x10 solid, not the full 20x20 silhouette.
    expect(loopArea(partOuterLoop(part))).toBeCloseTo(100, 0);
    const b = bbox(part);
    expect(b.minX).toBeCloseTo(5, 1);
    expect(b.maxX).toBeCloseTo(15, 1);
  });

  it("a doubled outline (two nested same-direction loops) → part is the inner region", () => {
    // outer 0..20 CCW, inner 4..16 CCW. nesting: inner has level 1 (inside outer).
    // odd-level = [inner], even>0 = []; part = inner solid.
    const outer = rect(0, 0, 20, 20, true);
    const inner = rect(4, 4, 16, 16, true);
    const part = buildPartRegion([outer, inner]);
    expect(part.length).toBeGreaterThanOrEqual(1);
    const b = bbox(part);
    // the part is the inner region (≈4..16), not the full 0..20 silhouette
    expect(b.maxX - b.minX).toBeLessThan(15);
    expect(b.maxX - b.minX).toBeGreaterThan(10);
  });

  it("a single square falls back to even-odd union → solid square", () => {
    const part = buildPartRegion([rect(0, 0, 10, 10, true)]);
    expect(part.length).toBe(1);
    expect(loopArea(part[0])).toBeCloseTo(100, 0);
  });

  it("returns [] for empty input", () => {
    expect(buildPartRegion([])).toEqual([]);
  });
});

describe("bandFromRegion", () => {
  const part = buildPartRegion([rect(0, 0, 10, 10, true)]); // solid 10x10

  it("outside band exceeds the part bbox and contains the part as a hole (≥2 rings)", () => {
    const rings = bandFromRegion(part, 1, "outside");
    expect(rings.length).toBeGreaterThanOrEqual(2);
    const pb = bbox(part);
    const bb = bbox(rings);
    expect(bb.minX).toBeLessThan(pb.minX);
    expect(bb.maxX).toBeGreaterThan(pb.maxX);
    // the band's largest ring encloses more area than the part
    const maxArea = Math.max(...rings.map(loopArea));
    expect(maxArea).toBeGreaterThan(loopArea(part[0]));
    // the part body is present as an inner ring (the hole)
    const minArea = Math.min(...rings.map(loopArea));
    expect(minArea).toBeLessThan(maxArea);
  });

  it("inside band stays within the part bbox (≥2 rings)", () => {
    const rings = bandFromRegion(part, 1, "inside");
    expect(rings.length).toBeGreaterThanOrEqual(2);
    const pb = bbox(part);
    const bb = bbox(rings);
    expect(bb.minX).toBeGreaterThanOrEqual(pb.minX - 1e-6);
    expect(bb.maxX).toBeLessThanOrEqual(pb.maxX + 1e-6);
  });

  it("symmetric band straddles the part edge (≥2 rings, outer larger than part)", () => {
    const rings = bandFromRegion(part, 2, "symmetric");
    expect(rings.length).toBeGreaterThanOrEqual(2);
    const bb = bbox(rings);
    const pb = bbox(part);
    expect(bb.maxX).toBeGreaterThan(pb.maxX);
    expect(bb.minX).toBeLessThan(pb.minX);
  });

  it("returns [] for an empty region or non-positive width", () => {
    expect(bandFromRegion([], 1, "outside")).toEqual([]);
    expect(bandFromRegion(part, 0, "outside")).toEqual([]);
  });
});

describe("partOuterLoop", () => {
  it("returns the largest-area ring of a region with a hole", () => {
    // A genuine frame: a big solid (outer) with a small hole punched out, built
    // directly as two rings — the outer boundary must be the largest by area.
    const big = buildPartRegion([rect(0, 0, 20, 20, true)]);
    const small = buildPartRegion([rect(5, 5, 15, 15, true)]);
    const frame = [...big, ...small.map((r) => [...r].reverse())]; // hole as reversed ring
    const outer = partOuterLoop(frame);
    expect(loopArea(outer)).toBeCloseTo(400, 0);
  });
  it("returns [] for an empty region", () => {
    expect(partOuterLoop([])).toEqual([]);
  });
});
