import { describe, it, expect } from "vitest";
import { estimateForge } from "./estimate";
import { DEFAULT_CONFIG } from "./defaults";
import { SPIRAL_CUT } from "./presets";
import { generateSpiralPaths } from "./spiral";
import type { GeneratedPath, Pt } from "./types";

const rect = (x: number, y: number, w: number, h: number): Pt[] => [
  { x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h },
];
const band = (t: number): Pt[][] => [rect(0, 0, 30 + 2 * t, 20 + 2 * t), rect(t, t, 30, 20)];
const part = [rect(0, 0, 30, 20)];

function mkPath(p: Partial<GeneratedPath>): GeneratedPath {
  return {
    sourceObjectId: "s", generatedClass: "deepen", groupName: "CUT_03_DEEPEN_A_50_1X",
    layerStart: 0, layerEnd: 50, widthMultiplier: 1, offsetMm: 0.03, sideMode: "outside",
    operationOrder: 0, enabled: true, rings: band(0.03), ...p,
  };
}

describe("estimateForge", () => {
  const source = { speed: 300, density: 100, sliceNumber: 100, passes: 1 };

  it("totals = sum of stage seconds and counts pierces/bands", () => {
    const paths = [
      mkPath({ generatedClass: "seed", groupName: "CUT_01_SEED", rings: band(0.06) }),
      mkPath({ generatedClass: "deepen", groupName: "CUT_03_DEEPEN_A_50_1X", layerEnd: 50 }),
    ];
    const est = estimateForge(paths, part, DEFAULT_CONFIG, source);
    expect(est.totalSeconds).toBeCloseTo(est.stages.reduce((s, x) => s + x.seconds, 0), 6);
    expect(est.pierces).toBe(2);
    expect(est.bandCount).toBe(2);
    expect(est.baselineSeconds).toBeGreaterThan(0);
    expect(est.overheadPct).toBeCloseTo((est.totalSeconds / est.baselineSeconds) * 100, 4);
  });

  it("aggregates perforation pockets into one stage with pathCount = pocket count", () => {
    const paths = [0, 1, 2].map((i) =>
      mkPath({ generatedClass: "perforate", groupName: "CUT_02_PERFORATE", rings: [rect(i, 0, 0.2, 0.2)], operationOrder: i }),
    );
    const est = estimateForge(paths, part, DEFAULT_CONFIG, source);
    const perf = est.stages.find((s) => s.generatedClass === "perforate")!;
    expect(perf.pathCount).toBe(3);
    expect(est.pocketCount).toBe(3);
  });

  it("flags over-budget against the configured multiplier", () => {
    const heavy = [mkPath({ groupName: "CUT_06_DEEPEN_D_256_8X", layerEnd: 256, rings: band(0.24) })];
    const cfg = { ...DEFAULT_CONFIG, timeBudgetX: 1.5 };
    const est = estimateForge(heavy, part, cfg, source);
    expect(est.baselineSeconds).toBeGreaterThan(0);
    expect(est.overBudget).toBe(est.overheadPct / 100 > 1.5);
  });

  it("returns finite zeros for empty paths", () => {
    const est = estimateForge([], part, DEFAULT_CONFIG, source);
    expect(est.stages).toHaveLength(0);
    expect(est.totalSeconds).toBe(0);
    expect(est.overBudget).toBe(false);
    expect(est.worst).toHaveLength(0);
  });

  it("uses RATE_FALLBACK when the source has no params", () => {
    const est = estimateForge([mkPath({})], part, DEFAULT_CONFIG, undefined);
    expect(est.baselineSeconds).toBeGreaterThan(0);
    expect(Number.isFinite(est.totalSeconds)).toBe(true);
  });

  it("spiral path uses vector model: estimated seconds > 0 and finite", () => {
    // A 20×100 mm open polyline (spiralish arm) as a spiral path
    const arm: Pt[] = [
      { x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 20 }, { x: 0, y: 20 },
      { x: 0, y: 10 }, { x: 80, y: 10 },
    ];
    const spiralPath = mkPath({
      generatedClass: "spiral",
      groupName: "CUT_08_SPIRAL",
      rings: [arm],
    });
    const est = estimateForge([spiralPath], part, SPIRAL_CUT, undefined);
    expect(est.stages).toHaveLength(1);
    expect(est.stages[0].generatedClass).toBe("spiral");
    expect(est.stages[0].seconds).toBeGreaterThan(0);
    expect(Number.isFinite(est.stages[0].seconds)).toBe(true);
    expect(est.totalSeconds).toBeGreaterThan(0);
    expect(Number.isFinite(est.totalSeconds)).toBe(true);
  });
});

describe("baseline is thickness-aware (baselineIncise)", () => {
  const sq = [[{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 20 }, { x: 0, y: 20 }]];

  it("a slower baseline incise yields a larger baselineSeconds + smaller overheadPct", () => {
    const spiralPaths = generateSpiralPaths(sq, SPIRAL_CUT, "o");
    const fast = structuredClone(SPIRAL_CUT);
    fast.spiral.baselineIncise = { speed: 2000, layers: 100 };
    const slow = structuredClone(SPIRAL_CUT);
    slow.spiral.baselineIncise = { speed: 200, layers: 100 };
    const eFast = estimateForge(spiralPaths, sq, fast, undefined);
    const eSlow = estimateForge(spiralPaths, sq, slow, undefined);
    expect(eSlow.baselineSeconds).toBeGreaterThan(eFast.baselineSeconds);
    expect(eSlow.overheadPct).toBeLessThan(eFast.overheadPct);
  });

  it("baselineSeconds scales LINEARLY with layers (no spurious ×sliceNumber blow-up)", () => {
    const spiralPaths = generateSpiralPaths(sq, SPIRAL_CUT, "o");
    const c100 = structuredClone(SPIRAL_CUT);
    c100.spiral.baselineIncise = { speed: 1500, layers: 100 };
    const c200 = structuredClone(SPIRAL_CUT);
    c200.spiral.baselineIncise = { speed: 1500, layers: 200 };
    const e100 = estimateForge(spiralPaths, sq, c100, undefined);
    const e200 = estimateForge(spiralPaths, sq, c200, undefined);
    // doubling layers ~doubles the baseline; the regression bug multiplied each
    // layer by the default sliceNumber (100), so 200 layers blew up ~100×, not 2×.
    expect(e200.baselineSeconds / e100.baselineSeconds).toBeCloseTo(2, 1);
  });
});
