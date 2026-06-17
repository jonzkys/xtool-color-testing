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
  it("computes single-pass length / speed (NOT multiplied by passes)", () => {
    const cfg: ForgeConfig = structuredClone(SPIRAL_CUT);
    cfg.spiral.passes = 10; // must NOT affect a single-pass time
    cfg.stageParams[STAGE_GROUPS.spiral] = { ...cfg.stageParams[STAGE_GROUPS.spiral], speed: 100 };
    const out = spiralPathDurations([mkPath(STAGE_GROUPS.spiral, seg(50))], cfg, undefined);
    expect(out).toHaveLength(1);
    expect(out[0].seconds).toBeCloseTo(50 / 100, 6); // 0.5s — one pass
  });

  it("is independent of the pass count", () => {
    const lo: ForgeConfig = structuredClone(SPIRAL_CUT);
    lo.spiral.passes = 5;
    lo.stageParams[STAGE_GROUPS.spiral] = { ...lo.stageParams[STAGE_GROUPS.spiral], speed: 120 };
    const hi: ForgeConfig = structuredClone(SPIRAL_CUT);
    hi.spiral.passes = 500;
    hi.stageParams[STAGE_GROUPS.spiral] = { ...hi.stageParams[STAGE_GROUPS.spiral], speed: 120 };
    const path = mkPath(STAGE_GROUPS.spiral, seg(60));
    const sLo = spiralPathDurations([path], lo, undefined)[0].seconds;
    const sHi = spiralPathDurations([path], hi, undefined)[0].seconds;
    expect(sLo).toBeCloseTo(60 / 120, 6); // 0.5s
    expect(sHi).toBeCloseTo(sLo, 6);       // pass count doesn't change it
  });

  it("resolves detail (CUT_09) speed independently of main (CUT_08)", () => {
    const cfg: ForgeConfig = structuredClone(SPIRAL_CUT);
    cfg.stageParams[STAGE_GROUPS.spiral] = { ...cfg.stageParams[STAGE_GROUPS.spiral], speed: 100 };
    cfg.stageParams[STAGE_GROUPS.spiralDetail] = { speed: 50 }; // overrides speed only
    const main = spiralPathDurations([mkPath(STAGE_GROUPS.spiral, seg(50))], cfg, undefined)[0];
    const detail = spiralPathDurations([mkPath(STAGE_GROUPS.spiralDetail, seg(50))], cfg, undefined)[0];
    expect(detail.seconds).toBeGreaterThan(main.seconds); // half the speed → double the time
    expect(main.seconds).toBeCloseTo(0.5, 6);
    expect(detail.seconds).toBeCloseTo(1.0, 6);
  });

  it("filters to spiral paths only", () => {
    const cfg = structuredClone(SPIRAL_CUT);
    const notSpiral: GeneratedPath = { ...mkPath(STAGE_GROUPS.spiral, seg(10)), generatedClass: "clean" };
    expect(spiralPathDurations([notSpiral], cfg, undefined)).toHaveLength(0);
  });

  it("returns [] for no paths", () => {
    expect(spiralPathDurations([], structuredClone(SPIRAL_CUT), undefined)).toEqual([]);
  });

  it("ties to the estimate: stage seconds ≈ passes × (per-pass + overhead)", () => {
    // The heatmap shows a single pass; the headline estimate is the total. They
    // share the same speed resolution, so total = passes × (per-pass + the
    // estimator's per-pass overhead). One path so the stage equals the path.
    const cfg = structuredClone(SPIRAL_CUT);
    cfg.spiral.passes = 7;
    cfg.stageParams[STAGE_GROUPS.spiral] = { ...cfg.stageParams[STAGE_GROUPS.spiral], speed: 120 };
    const path = mkPath(STAGE_GROUPS.spiral, seg(80));
    const part: Pt[][] = [[{ x: 0, y: 0 }, { x: 80, y: 0 }, { x: 80, y: 80 }, { x: 0, y: 80 }]];
    const stageSecs = estimateForge([path], part, cfg, undefined).stages
      .filter((s) => s.generatedClass === "spiral")
      .reduce((a, s) => a + s.seconds, 0);
    const perPass = spiralPathDurations([path], cfg, undefined)[0].seconds;
    const PER_PASS_OVERHEAD_S = 0.01; // mirrors estimate.ts spiralSeconds
    expect(stageSecs).toBeCloseTo(7 * (perPass + PER_PASS_OVERHEAD_S), 6);
  });
});
