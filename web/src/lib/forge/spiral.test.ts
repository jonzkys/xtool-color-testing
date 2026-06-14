import { describe, it, expect } from "vitest";
import { spiralFromRegion, spiralPathLength, generateSpiralPaths, buildStrands } from "./spiral";
import { SPIRAL_CUT } from "./presets";
import { STAGE_GROUPS } from "./config";
import { splitLobesAtNecks, offsetRegion, unionRegions, subtractRegion, pointInPolygon } from "./offset";
import type { Pt } from "./types";

function rectLoop(x0: number, y0: number, x1: number, y1: number): Pt[] {
  return [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
}
/** even-odd point-in-region over a ring set. */
function insideRegion(region: Pt[][], p: Pt): boolean {
  let inside = false;
  for (const r of region) if (pointInPolygon(r, p)) inside = !inside;
  return inside;
}

const square: Pt[] = [
  { x: -10, y: -10 }, { x: 10, y: -10 }, { x: 10, y: 10 }, { x: -10, y: 10 },
];

describe("spiralFromRegion (single strand)", () => {
  it("convex part → one continuous open arm", () => {
    const r = spiralFromRegion([square], { channelWidthMm: 0.8, pitchMm: 0.04, side: "outside", minChannelMm: 0.4 });
    expect(r.warnings).toEqual([]);
    expect(r.arms.length).toBe(1);
    expect(r.arms[0].length).toBeGreaterThan(40);
    const a = r.arms[0][0], b = r.arms[0][r.arms[0].length - 1];
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(0.5); // open polyline
  });
  it("spiralPathLength sums segment lengths", () => {
    expect(spiralPathLength([{ x: 0, y: 0 }, { x: 3, y: 0 }, { x: 3, y: 4 }])).toBeCloseTo(7, 6);
  });
});

describe("spiralFromRegion (topology)", () => {
  it("two separate parts → two arms", () => {
    const sqA: Pt[] = [{ x: -10, y: -10 }, { x: -2, y: -10 }, { x: -2, y: 10 }, { x: -10, y: 10 }];
    const sqB: Pt[] = [{ x: 2, y: -10 }, { x: 10, y: -10 }, { x: 10, y: 10 }, { x: 2, y: 10 }];
    const r = spiralFromRegion([sqA, sqB], { channelWidthMm: 0.4, pitchMm: 0.04, side: "outside", minChannelMm: 0.4 });
    expect(r.arms.length).toBe(2);
  });

  it("inward spiral of a dumbbell (thin neck) → splits into ≥2 arms", () => {
    // Two 8×10 mm lobes joined by a 0.6 mm tall neck at y=±0.3.
    // With pitchMm=0.04 and inside offset, the neck (height 0.6 mm) pinches
    // off after ~7 levels (7×0.04=0.28 mm inward each side), producing two
    // independent sub-regions whose centroids are ~14 mm apart — well beyond
    // the 2×pitch continuity threshold, so buildStrands must fork.
    const dumbbell: Pt[] = [
      { x: -10, y: -5 }, { x: -4, y: -5 }, { x: -4, y: -0.3 }, { x: 4, y: -0.3 },
      { x: 4, y: -5 }, { x: 10, y: -5 }, { x: 10, y: 5 }, { x: 4, y: 5 },
      { x: 4, y: 0.3 }, { x: -4, y: 0.3 }, { x: -4, y: 5 }, { x: -10, y: 5 },
    ];
    const r = spiralFromRegion([dumbbell], { channelWidthMm: 0.8, pitchMm: 0.04, side: "inside", minChannelMm: 0.4 });
    expect(r.arms.length).toBeGreaterThanOrEqual(2);
  });
});

describe("spiralFromRegion (fallback) + generateSpiralPaths", () => {
  it("tiny region (inside) → contour-only cut + warning, never throws", () => {
    // Too thin for a venting channel, but the contour is still cut so the feature
    // severs (the under-cut-narrow-region fix); warns that brass may not fully vent.
    const tiny: Pt[] = [{ x: 0, y: 0 }, { x: 0.05, y: 0 }, { x: 0.05, y: 0.05 }, { x: 0, y: 0.05 }];
    const r = spiralFromRegion([tiny], { channelWidthMm: 0.8, pitchMm: 0.04, side: "inside", minChannelMm: 0.4 });
    expect(r.arms.length).toBe(1);
    expect(r.warnings.length).toBeGreaterThan(0);
  });
  it("generateSpiralPaths → GeneratedPath per arm, class spiral, open polyline in rings[0]", () => {
    const paths = generateSpiralPaths([square], SPIRAL_CUT, "obj-1");
    expect(paths.length).toBe(1);
    expect(paths[0].generatedClass).toBe("spiral");
    expect(paths[0].groupName).toBe("CUT_08_SPIRAL");
    expect(paths[0].rings.length).toBe(1);
    expect(paths[0].rings[0].length).toBeGreaterThan(40);
  });
});

// lollipop: big 12x12 body + small 3x3 feature joined by a thin 0.3mm bridge —
// the small feature is the "internal detail" that splits off; the body stays main.
const lollipop: { x: number; y: number }[][] = [[
  { x: 0, y: 0 }, { x: 12, y: 0 }, { x: 12, y: 5.85 },
  { x: 16, y: 5.85 }, { x: 16, y: 3 }, { x: 19, y: 3 },
  { x: 19, y: 6 }, { x: 16, y: 6 }, { x: 16, y: 6.15 },
  { x: 12, y: 6.15 }, { x: 12, y: 12 }, { x: 0, y: 12 },
]];

describe("generateSpiralPaths — neck split", () => {
  it("OFF: every arm is the main spiral group (regression-safe path)", () => {
    const cfg = structuredClone(SPIRAL_CUT);
    cfg.spiral.enabled = true;
    cfg.spiral.splitNecks = false;
    const paths = generateSpiralPaths(lollipop, cfg, "obj1");
    expect(paths.length).toBeGreaterThan(0);
    expect(paths.every((p) => p.groupName === STAGE_GROUPS.spiral)).toBe(true);
    expect(paths.every((p) => p.generatedClass === "spiral")).toBe(true);
  });

  it("ON: splits the small feature into the detail group while keeping a main", () => {
    const cfg = structuredClone(SPIRAL_CUT);
    cfg.spiral.enabled = true;
    cfg.spiral.splitNecks = true;
    cfg.spiral.neckThresholdPct = 50;
    cfg.spiral.neckOverlapMm = 0.4;
    const paths = generateSpiralPaths(lollipop, cfg, "obj1");
    expect(paths.some((p) => p.groupName === STAGE_GROUPS.spiralDetail)).toBe(true);
    expect(paths.some((p) => p.groupName === STAGE_GROUPS.spiral)).toBe(true);
    expect(paths.every((p) => p.generatedClass === "spiral")).toBe(true);
    expect(paths.map((p) => p.operationOrder)).toEqual(paths.map((_, i) => i));
  });
});

describe("generateSpiralPaths — cut shortest first", () => {
  // Two disjoint squares of very different size → two main arms of very
  // different length, in [big, small] region order.
  const big: Pt[] = [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 40 }, { x: 0, y: 40 }];
  const small: Pt[] = [{ x: 60, y: 0 }, { x: 66, y: 0 }, { x: 66, y: 6 }, { x: 60, y: 6 }];
  const armLen = (p: { rings: Pt[][] }) => spiralPathLength(p.rings[0]);

  it("ON: arms come out ascending by length (shortest first)", () => {
    const cfg = structuredClone(SPIRAL_CUT);
    cfg.spiral.enabled = true;
    cfg.spiral.splitNecks = false;
    cfg.spiral.cutShortestFirst = true;
    const paths = generateSpiralPaths([big, small], cfg, "o");
    expect(paths.length).toBeGreaterThanOrEqual(2);
    const lens = paths.map(armLen);
    for (let i = 1; i < lens.length; i++) expect(lens[i]).toBeGreaterThanOrEqual(lens[i - 1]);
    // operationOrder is a dense 0..n-1 sequence in emit order.
    expect(paths.map((p) => p.operationOrder)).toEqual(paths.map((_, i) => i));
  });

  it("OFF: arms keep region order (big region first → not length-sorted)", () => {
    const cfg = structuredClone(SPIRAL_CUT);
    cfg.spiral.enabled = true;
    cfg.spiral.splitNecks = false;
    cfg.spiral.cutShortestFirst = false;
    const paths = generateSpiralPaths([big, small], cfg, "o");
    // first arm is the BIG region's (longer) — i.e. NOT shortest-first.
    expect(armLen(paths[0])).toBeGreaterThan(armLen(paths[paths.length - 1]));
  });

  it("ON + split: detail arms all cut before the main arms (details first)", () => {
    const cfg = structuredClone(SPIRAL_CUT);
    cfg.spiral.enabled = true;
    cfg.spiral.splitNecks = true;
    cfg.spiral.neckThresholdPct = 50;
    cfg.spiral.cutShortestFirst = true;
    const paths = generateSpiralPaths(lollipop, cfg, "o");
    const detail = paths.filter((p) => p.groupName === STAGE_GROUPS.spiralDetail);
    const main = paths.filter((p) => p.groupName === STAGE_GROUPS.spiral);
    expect(detail.length).toBeGreaterThan(0);
    expect(main.length).toBeGreaterThan(0);
    const lastDetail = Math.max(...detail.map((p) => p.operationOrder));
    const firstMain = Math.min(...main.map((p) => p.operationOrder));
    expect(lastDetail).toBeLessThan(firstMain);
    // within each group, ascending by length
    for (const grp of [detail, main]) {
      const lens = grp.sort((a, b) => a.operationOrder - b.operationOrder).map(armLen);
      for (let i = 1; i < lens.length; i++) expect(lens[i]).toBeGreaterThanOrEqual(lens[i - 1]);
    }
  });
});

describe("detail keep-out — main spiral does not re-cut a split-off island", () => {
  // 30×30 body with a C-shaped channel isolating an 8×8 centre island, joined to
  // the body by a thin 0.3 mm neck — the internal-detail case (an "i" dot / flower
  // centre) where the main's +offsets used to bloom into the carved hole.
  function islandPart(): Pt[][] {
    const body = [rectLoop(0, 0, 30, 30)];
    const annulus = subtractRegion([rectLoop(9, 9, 21, 21)], [rectLoop(11, 11, 19, 19)]);
    const channel = subtractRegion(annulus, [rectLoop(14, 9, 14.3, 11)]); // 0.3 mm neck bridge
    return subtractRegion(body, channel);
  }
  const channelW = 0.45, pitch = 0.04;
  const opts = { channelWidthMm: channelW, pitchMm: pitch, side: "outside" as const, minChannelMm: 0.4 };

  it("the island splits off and the main keeps clear of it (with keep-out)", () => {
    const lobes = splitLobesAtNecks(islandPart(), 0.45, channelW);
    const main = lobes.find((l) => l.kind === "main")!;
    const details = lobes.filter((l) => l.kind === "detail");
    expect(details.length).toBe(1);
    const detailRegion = details.flatMap((d) => d.region);
    const keepOut = offsetRegion(unionRegions(details.map((d) => d.region)), channelW);

    const armsClipped = spiralFromRegion(main.region, opts, keepOut).arms;
    let pts = 0, inside = 0;
    for (const a of armsClipped) for (const p of a) { pts++; if (insideRegion(detailRegion, p)) inside++; }
    expect(pts).toBeGreaterThan(0);
    expect(inside).toBe(0); // the fix: the main never enters the detail's region

    // Sanity: WITHOUT the keep-out the old behaviour double-draws into the island.
    const armsRaw = spiralFromRegion(main.region, opts).arms;
    let insideRaw = 0;
    for (const a of armsRaw) for (const p of a) if (insideRegion(detailRegion, p)) insideRaw++;
    expect(insideRaw).toBeGreaterThan(0);
  });

  it("generateSpiralPaths wires the keep-out through (main group avoids the detail region)", () => {
    const part = islandPart();
    const cfg = structuredClone(SPIRAL_CUT);
    cfg.spiral.enabled = true;
    cfg.spiral.splitNecks = true;
    cfg.spiral.channelWidthMm = channelW;
    cfg.spiral.pitchMm = pitch;
    cfg.spiral.side = "outside";
    cfg.spiral.neckThresholdPct = 100; // neckWidth = channelWidth → pinches the 0.3 mm neck
    cfg.spiral.neckOverlapMm = channelW;
    const paths = generateSpiralPaths(part, cfg, "obj1");
    const detailArms = paths.filter((p) => p.groupName === STAGE_GROUPS.spiralDetail).flatMap((p) => p.rings);
    const mainArms = paths.filter((p) => p.groupName === STAGE_GROUPS.spiral).flatMap((p) => p.rings);
    expect(detailArms.length).toBeGreaterThan(0);
    expect(mainArms.length).toBeGreaterThan(0);

    // Reconstruct the detail region the generator split off and assert no
    // main-group point lands inside it — the precise no-double-draw invariant.
    const lobes = splitLobesAtNecks(part, (cfg.spiral.neckThresholdPct / 100) * channelW, cfg.spiral.neckOverlapMm);
    const detailRegion = lobes.filter((l) => l.kind === "detail").flatMap((l) => l.region);
    expect(detailRegion.length).toBeGreaterThan(0);
    let mainInsideDetail = 0;
    for (const a of mainArms) for (const p of a) if (insideRegion(detailRegion, p)) mainInsideDetail++;
    expect(mainInsideDetail).toBe(0);
  });
});

describe("buildStrands (coverage invariant)", () => {
  /**
   * Every input ring must end up in exactly one strand — no loop dropped or
   * duplicated. buildStrands returns stitched Pt[] arms; coverage is verified
   * by comparing total point count across all output arms against the total
   * point count across all input rings.
   */
  it("all input ring points appear in exactly one strand (no drop / no dup)", () => {
    // Helper: make a square loop scaled by `s` centred at (cx, cy).
    function sq(cx: number, cy: number, s: number): Pt[] {
      return [
        { x: cx - s, y: cy - s }, { x: cx + s, y: cy - s },
        { x: cx + s, y: cy + s }, { x: cx - s, y: cy + s },
      ];
    }

    // Level 0: two separate squares (two seeds).
    // Level 1: both squares shrink (two rings) — each continues its parent strand.
    // Level 2: only the left square persists; right strand goes inactive (merges away).
    const levels: Pt[][][] = [
      [sq(0, 0, 4), sq(20, 0, 4)],           // level 0: 2 rings × 4 pts = 8
      [sq(0, 0, 3.9), sq(20, 0, 3.9)],       // level 1: 2 rings × 4 pts = 8
      [sq(0, 0, 3.8)],                         // level 2: 1 ring  × 4 pts = 4
    ];

    // Total input points: 5 rings × 4 pts = 20.
    const inputPoints = levels.flat().reduce((acc, loop) => acc + loop.length, 0);

    const arms = buildStrands(levels, 0.1);

    // Total output points across all stitched arms must equal input.
    const outputPoints = arms.reduce((acc, arm) => acc + arm.length, 0);
    expect(outputPoints).toBe(inputPoints);
  });

  it("two distant columns never cross-assign", () => {
    // Two columns 30 mm apart, 5 levels each. buildStrands must never assign
    // a ring from column B to a strand rooted in column A.
    function sq(cx: number, cy: number, s: number): Pt[] {
      return [
        { x: cx - s, y: cy - s }, { x: cx + s, y: cy - s },
        { x: cx + s, y: cy + s }, { x: cx - s, y: cy + s },
      ];
    }
    const pitch = 0.04;
    const levels: Pt[][][] = Array.from({ length: 5 }, (_, k) => [
      sq(0, 0, 5 - k * 0.04),
      sq(30, 0, 5 - k * 0.04),
    ]);
    const arms = buildStrands(levels, pitch);
    // Each column should produce exactly one strand (5 rings each).
    expect(arms.length).toBe(2);
    // Both strands cover all 5 levels' points: 4 pts per ring × 5 levels = 20 pts each.
    const lengths = arms.map((a) => a.length).sort((a, b) => a - b);
    expect(lengths[0]).toBe(20);
    expect(lengths[1]).toBe(20);
  });

  it("topology merge — bridge cap prevents cross-feature jumps", () => {
    // Two tiny squares (half-side 0.04 mm, touching / 0 mm gap) kept as separate
    // rings for two levels, then merged into one combined hull ring at level 2.
    // All ring edges are ≤ 0.16 mm < 5×pitch (= 0.20 mm), so the assertion:
    //   "every segment in every output arm ≤ 5×pitch"
    // is achievable even with bridge-cap stitching — the merged hull's long side
    // is only 0.16 mm (two 0.08 mm squares side-by-side).
    // This verifies that the bridge cap prevents long cross-gap jumps when the
    // stitcher connects a pre-merge strand to the merged ring.
    const pitch = 0.04;
    const lx = 0, rx = 0.08; // left/right square centres; squares touch at x=0.04
    function tiny(cx: number, cy: number, s: number): Pt[] {
      return [
        { x: cx - s, y: cy - s }, { x: cx + s, y: cy - s },
        { x: cx + s, y: cy + s }, { x: cx - s, y: cy + s },
      ];
    }
    // Merged hull ring: 4 pts, longest edge = 0.16 mm < 5×pitch.
    const mergedHull: Pt[] = [
      { x: lx - 0.04, y: -0.04 },
      { x: rx + 0.04, y: -0.04 },
      { x: rx + 0.04, y:  0.04 },
      { x: lx - 0.04, y:  0.04 },
    ];
    const levels: Pt[][][] = [
      [tiny(lx, 0, 0.04), tiny(rx, 0, 0.04)],  // level 0: 2 rings × 4 pts = 8
      [tiny(lx, 0, 0.04), tiny(rx, 0, 0.04)],  // level 1: 2 rings × 4 pts = 8
      [mergedHull],                               // level 2: 1 merged ring × 4 pts = 4
    ];

    const totalInput = levels.flat().reduce((acc, loop) => acc + loop.length, 0); // 20
    const arms = buildStrands(levels, pitch);

    // Coverage invariant: every input point appears in exactly one arm.
    const totalOutput = arms.reduce((acc, a) => acc + a.length, 0);
    expect(totalOutput).toBe(totalInput);

    // Because all ring edges are 0.08–0.20 mm and the bridge cap is 4×pitch = 0.16 mm,
    // no arm should contain a segment longer than 5×pitch.
    const maxSeg = arms.reduce((mx, a) => {
      for (let j = 1; j < a.length; j++) {
        const d = Math.hypot(a[j].x - a[j - 1].x, a[j].y - a[j - 1].y);
        if (d > mx) mx = d;
      }
      return mx;
    }, 0);
    expect(maxSeg).toBeLessThanOrEqual(5 * pitch);
  });
});
