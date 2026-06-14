// web/src/lib/forge/offset.test.ts
import { describe, it, expect } from "vitest";
import { buildPartRegion, buildFillRegion, bandFromRegion, partOuterLoop, regionComponents, splitLobesAtNecks } from "./offset";
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

describe("buildFillRegion (canonical even-odd shape fill — the spiral target)", () => {
  it("KEEPS the outer boundary of a holed shape (the regression: outer+counter → outer with a hole, not the counter)", () => {
    // A letter-like shape: outer outline (0..20) with a counter (5..15).
    const outer = rect(0, 0, 20, 20, true);
    const counter = rect(5, 5, 15, 15, false);
    const region = buildFillRegion([outer, counter]);
    // The largest ring is the OUTER outline (≈20×20), NOT the 10×10 counter.
    const outerLoop = partOuterLoop(region);
    expect(loopArea(outerLoop)).toBeCloseTo(400, 0);
    const b = bbox(region);
    expect(b.minX).toBeCloseTo(0, 1);
    expect(b.maxX).toBeCloseTo(20, 1);
    // The counter survives as a hole (≥2 rings, and total solid area = 400-100).
    expect(region.length).toBeGreaterThanOrEqual(2);

    // Contrast: buildPartRegion (incise, doubled-wall) drops the outer → inner solid.
    const incise = buildPartRegion([outer, counter]);
    expect(bbox(incise).maxX - bbox(incise).minX).toBeLessThan(15);
  });

  it("a single loop yields the solid (same as buildPartRegion's union branch)", () => {
    const region = buildFillRegion([rect(0, 0, 10, 10, true)]);
    expect(region.length).toBe(1);
    expect(loopArea(region[0])).toBeCloseTo(100, 0);
  });

  it("is winding-independent (counter wound the same way as the outer still cuts a hole)", () => {
    const region = buildFillRegion([rect(0, 0, 20, 20, true), rect(5, 5, 15, 15, true)]);
    expect(bbox(region).maxX).toBeCloseTo(20, 1); // outer preserved regardless of winding
    expect(region.length).toBeGreaterThanOrEqual(2);
  });

  it("returns [] for empty input", () => {
    expect(buildFillRegion([])).toEqual([]);
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

describe("splitLobesAtNecks", () => {
  // lollipop: big 12x12 body + small 3x3 feature joined by a thin 0.3mm bridge.
  const lollipop: { x: number; y: number }[][] = [[
    { x: 0, y: 0 }, { x: 12, y: 0 }, { x: 12, y: 5.85 },
    { x: 16, y: 5.85 }, { x: 16, y: 3 }, { x: 19, y: 3 },
    { x: 19, y: 6 }, { x: 16, y: 6 }, { x: 16, y: 6.15 },
    { x: 12, y: 6.15 }, { x: 12, y: 12 }, { x: 0, y: 12 },
  ]];
  // even dumbbell: two CO-EQUAL 10x10 squares joined by a thin bridge.
  const dumbbell: { x: number; y: number }[][] = [[
    { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 4.85 },
    { x: 14, y: 4.85 }, { x: 14, y: 0 }, { x: 24, y: 0 },
    { x: 24, y: 10 }, { x: 14, y: 10 }, { x: 14, y: 5.15 },
    { x: 10, y: 5.15 }, { x: 10, y: 10 }, { x: 0, y: 10 },
  ]];

  it("keeps the big body as ONE main and splits the small feature off as detail", () => {
    const lobes = splitLobesAtNecks(lollipop, 1.0, 0.4);
    const mains = lobes.filter((l) => l.kind === "main");
    const details = lobes.filter((l) => l.kind === "detail");
    expect(mains.length).toBe(1);   // the big body stays one main, not fragmented
    expect(details.length).toBe(1); // only the small feature splits off
    // the small feature (out to x=19) is carved off the main; the main is the
    // big body (+ the connecting bridge), well short of the full 19mm span.
    expect(bbox(mains[0].region).maxX).toBeLessThan(17);
  });

  it("two co-equal bodies both stay in the main (neither is 'small' detail)", () => {
    const lobes = splitLobesAtNecks(dumbbell, 1.0, 0.4);
    expect(lobes.every((l) => l.kind === "main")).toBe(true);
  });

  it("leaves a solid square as a single main lobe", () => {
    const lobes = splitLobesAtNecks([rect(0, 0, 10, 10, true).points], 1.0, 0.4);
    expect(lobes.length).toBe(1);
    expect(lobes[0].kind).toBe("main");
  });

  it("returns the part unsplit when neckWidth is non-positive", () => {
    const lobes = splitLobesAtNecks([rect(0, 0, 10, 10, true).points], 0, 0.4);
    expect(lobes.length).toBe(1);
    expect(lobes[0].kind).toBe("main");
  });

  it("returns whole (single main) when the entire part is narrower than neckWidth", () => {
    // 20 × 0.5 mm bar — thinner than neckWidth 1.0 everywhere, so no neck
    const bar = [[
      { x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 0.5 }, { x: 0, y: 0.5 },
    ]];
    const lobes = splitLobesAtNecks(bar, 1.0, 0.4);
    expect(lobes.length).toBe(1);
    expect(lobes[0].kind).toBe("main");
  });
});

describe("regionComponents", () => {
  it("groups two disjoint squares into two components", () => {
    const comps = regionComponents([
      rect(0, 0, 10, 10, true).points,
      rect(20, 0, 30, 10, true).points,
    ]);
    expect(comps.length).toBe(2);
    expect(comps.every((c) => c.length === 1)).toBe(true); // each: one outer, no holes
  });

  it("attaches a hole to its containing outer (one component with 2 rings)", () => {
    const comps = regionComponents([
      rect(0, 0, 20, 20, true).points,   // outer
      rect(5, 5, 15, 15, false).points,  // hole (opposite winding)
    ]);
    expect(comps.length).toBe(1);
    expect(comps[0].length).toBe(2);
  });
});
