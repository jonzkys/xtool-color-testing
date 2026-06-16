import { describe, it, expect } from "vitest";
import { spiralPathDurations, estimateForge } from "./estimate";
import { SPIRAL_CUT } from "./presets";
import { STAGE_GROUPS } from "./config";
import type { ForgeConfig, GeneratedPath, Pt } from "./types";

function mkPath(groupName: string, pts: Pt[]): GeneratedPath {
  return {
    sourceObjectId: "o", generatedClass: "spiral", groupName,
    layerStart: 0, layerEnd: 1, widthMultiplier: 1, offsetMm: 0.8,
    sideMode: "outside", operationOrder: 0, enabled: true, rings: [pts],
  };
}
// A horizontal segment of the given length (so pathLength is exact).
const seg = (len: number): Pt[] => [{ x: 0, y: 0 }, { x: len, y: 0 }];

describe("spiralPathDurations", () => {
  it("computes passes × length / speed (+ per-pass overhead) for a main path", () => {
    const cfg: ForgeConfig = structuredClone(SPIRAL_CUT);
    cfg.spiral.passes = 10;
    cfg.stageParams[STAGE_GROUPS.spiral] = { ...cfg.stageParams[STAGE_GROUPS.spiral], speed: 100 };
    const out = spiralPathDurations([mkPath(STAGE_GROUPS.spiral, seg(50))], cfg, undefined);
    expect(out).toHaveLength(1);
    // 10 × (50/100 + 0.01) = 10 × 0.51 = 5.1
    expect(out[0].seconds).toBeCloseTo(5.1, 6);
  });

  it("resolves detail (CUT_09) speed independently of main (CUT_08)", () => {
    const cfg: ForgeConfig = structuredClone(SPIRAL_CUT);
    cfg.spiral.passes = 10;
    cfg.stageParams[STAGE_GROUPS.spiral] = { ...cfg.stageParams[STAGE_GROUPS.spiral], speed: 100 };
    cfg.stageParams[STAGE_GROUPS.spiralDetail] = { speed: 50 }; // overrides speed only
    const main = spiralPathDurations([mkPath(STAGE_GROUPS.spiral, seg(50))], cfg, undefined)[0];
    const detail = spiralPathDurations([mkPath(STAGE_GROUPS.spiralDetail, seg(50))], cfg, undefined)[0];
    // detail at half the speed → ~double the per-pass cut time. passes=10 is
    // INHERITED from the main spiral group (resolveStageParams spreads CUT_08
    // into CUT_09), since the detail override above sets speed only.
    expect(detail.seconds).toBeGreaterThan(main.seconds);
    expect(detail.seconds).toBeCloseTo(10 * (50 / 50 + 0.01), 6); // 10 × (1 + 0.01) = 10.1
  });

  it("filters to spiral paths only", () => {
    const cfg = structuredClone(SPIRAL_CUT);
    const notSpiral: GeneratedPath = { ...mkPath(STAGE_GROUPS.spiral, seg(10)), generatedClass: "clean" };
    expect(spiralPathDurations([notSpiral], cfg, undefined)).toHaveLength(0);
  });

  it("returns [] for no paths", () => {
    expect(spiralPathDurations([], structuredClone(SPIRAL_CUT), undefined)).toEqual([]);
  });

  it("totals reconcile with the spiral stages in estimateForge", () => {
    const cfg = structuredClone(SPIRAL_CUT);
    cfg.spiral.passes = 7;
    cfg.stageParams[STAGE_GROUPS.spiral] = { ...cfg.stageParams[STAGE_GROUPS.spiral], speed: 120 };
    const paths = [mkPath(STAGE_GROUPS.spiral, seg(80)), mkPath(STAGE_GROUPS.spiralDetail, seg(12))];
    const part: Pt[][] = [[{ x: 0, y: 0 }, { x: 80, y: 0 }, { x: 80, y: 80 }, { x: 0, y: 80 }]];
    const est = estimateForge(paths, part, cfg, undefined);
    const stageSecs = est.stages
      .filter((s) => s.generatedClass === "spiral")
      .reduce((a, s) => a + s.seconds, 0);
    const helperSecs = spiralPathDurations(paths, cfg, undefined).reduce((a, d) => a + d.seconds, 0);
    expect(helperSecs).toBeCloseTo(stageSecs, 6);
  });
});
