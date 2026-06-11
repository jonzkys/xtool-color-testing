import { describe, it, expect } from "vitest";
import { spiralFromRegion, spiralPathLength, generateSpiralPaths } from "./spiral";
import { SPIRAL_CUT } from "./presets";
import type { Pt } from "./types";

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
  it("tiny region (inside) → empty arms + warning, never throws", () => {
    const tiny: Pt[] = [{ x: 0, y: 0 }, { x: 0.05, y: 0 }, { x: 0.05, y: 0.05 }, { x: 0, y: 0.05 }];
    const r = spiralFromRegion([tiny], { channelWidthMm: 0.8, pitchMm: 0.04, side: "inside", minChannelMm: 0.4 });
    expect(r.arms.length).toBe(0);
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
