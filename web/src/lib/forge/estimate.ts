//
// Forge adapter over the reusable cuttime core. Maps the pipeline's
// GeneratedPath[] + part region + config into per-stage StageGeom/StageRate,
// computes the baseline (the part cut as one 1×-beam kerf band at the source
// rate), applies the budget, and returns a ForgeEstimate for the panel + warnings.
import {
  stageSeconds, fmtDuration, DEFAULT_CALIBRATION, RATE_FALLBACK,
  type CutTimeCalibration, type StageRate,
} from "../cuttime/model";
import { ringsBBox, ringsFillArea, ringsPerimeter } from "../cuttime/geometry";
import { resolveStageParams } from "./config";
import { bandFromRegion } from "./offset";
import { spiralPathLength } from "./spiral";
import type { ForgeConfig, GeneratedClass, GeneratedPath, Pt, StageParams } from "./types";

export interface StageEstimate {
  groupName: string;
  generatedClass: GeneratedClass;
  pathCount: number;
  sliceNumber: number;
  repeat: number;
  speedMmS: number;
  densityLpc: number;
  perimeterMm: number;
  fillAreaMm2: number;
  seconds: number;
  pierces: number;
}

export interface ForgeEstimate {
  stages: StageEstimate[];
  totalSeconds: number;
  baselineSeconds: number;
  overheadPct: number;
  pierces: number;
  pocketCount: number;
  bandCount: number;
  budgetX: number | null;
  overBudget: boolean;
  worst: Array<{ groupName: string; seconds: number; pct: number }>;
}

/** Resolve the rate a stage will actually export with: resolveStageParams over
 *  the source incise's params, falling back to the measured working regime. */
function effectiveRate(
  resolved: StageParams | undefined,
  source: StageParams | undefined,
): StageRate {
  const pick = <K extends keyof StageParams>(k: K) => resolved?.[k] ?? source?.[k];
  return {
    sliceNumber: (pick("sliceNumber") as number) ?? RATE_FALLBACK.sliceNumber,
    repeat: (pick("passes") as number) ?? RATE_FALLBACK.repeat,
    speedMmS: (pick("speed") as number) ?? RATE_FALLBACK.speedMmS,
    densityLpc: (pick("density") as number) ?? RATE_FALLBACK.densityLpc,
  };
}

/** Linear vector cut time: passes × Σ(pathLength)/speed (+ tiny per-pass overhead). */
function spiralSeconds(path: GeneratedPath, passes: number, speedMmS: number): number {
  const len = path.rings.reduce((s, arm) => s + spiralPathLength(arm), 0);
  const PER_PASS_OVERHEAD_S = 0.01;
  return passes * (len / Math.max(1, speedMmS) + PER_PASS_OVERHEAD_S);
}

function geomOf(rings: Pt[][]) {
  const b = ringsBBox(rings);
  return { bboxW: b.w, bboxH: b.h, fillAreaMm2: ringsFillArea(rings), perimeterMm: ringsPerimeter(rings) };
}

/** The part cut as a single 1×-beam kerf band at the source incise's rate —
 *  "cut the outline once, un-staged" — the denominator for % overhead. */
function baselineSeconds(
  part: Pt[][], config: ForgeConfig, source: StageParams | undefined,
  calib: CutTimeCalibration,
): number {
  const rings = bandFromRegion(part, config.beamWidthMm, config.sideMode);
  if (rings.length < 2) return 0;
  // The baseline incise is per brass thickness (config.spiral.baselineIncise).
  // FULLY specify the rate so it does NOT inherit the spiral-source object's
  // params: that source is a VECTOR_CUTTING contour whose `density` is a
  // meaningless placeholder (e.g. 5000 lines/cm from an SVG import) that would
  // inflate this raster model ~16×. The baseline models the Studio INCISE at the
  // calibrated reference density (300 lines/cm), `layers` deep, at a single repeat
  // (passes = 1) — so the time scales LINEARLY with layers. (Mapping layers to
  // `passes`/repeat instead would multiply on top of the default sliceNumber.)
  const bi = config.spiral.baselineIncise;
  const baselineParams: StageParams = {
    speed: bi.speed,
    sliceNumber: bi.layers,
    passes: 1,
    density: RATE_FALLBACK.densityLpc,
  };
  const rate = effectiveRate(baselineParams, source);
  return stageSeconds(geomOf(rings), rate, calib);
}

export function estimateForge(
  paths: GeneratedPath[],
  part: Pt[][],
  config: ForgeConfig,
  source: StageParams | undefined,
  calib: CutTimeCalibration = DEFAULT_CALIBRATION,
): ForgeEstimate {
  const resolved = resolveStageParams(config);

  // Group paths by groupName, preserving first-seen (process) order.
  const order: string[] = [];
  const byGroup = new Map<string, GeneratedPath[]>();
  for (const p of paths) {
    if (!byGroup.has(p.groupName)) { byGroup.set(p.groupName, []); order.push(p.groupName); }
    byGroup.get(p.groupName)!.push(p);
  }

  const stages: StageEstimate[] = order.map((group) => {
    const ps = byGroup.get(group)!;
    const rate = effectiveRate(resolved[group], source);
    let seconds = 0, fill = 0, perim = 0;
    for (const p of ps) {
      if (p.generatedClass === "spiral") {
        const sp = resolved[p.groupName] ?? {};
        seconds += spiralSeconds(p, (sp.passes as number | undefined) ?? rate.repeat, (sp.speed as number | undefined) ?? rate.speedMmS);
        continue; // skip the raster model for spiral
      }
      const g = geomOf(p.rings);
      seconds += stageSeconds(g, rate, calib);
      fill += g.fillAreaMm2;
      perim += g.perimeterMm;
    }
    return {
      groupName: group,
      generatedClass: ps[0].generatedClass,
      pathCount: ps.length,
      sliceNumber: rate.sliceNumber,
      repeat: rate.repeat,
      speedMmS: rate.speedMmS,
      densityLpc: rate.densityLpc,
      perimeterMm: perim,
      fillAreaMm2: fill,
      seconds,
      pierces: ps.length,
    };
  });

  const totalSeconds = stages.reduce((s, x) => s + x.seconds, 0);
  const baseline = baselineSeconds(part, config, source, calib);
  const overheadPct = baseline > 0 ? (totalSeconds / baseline) * 100 : 0;
  const budgetX = config.timeBudgetX ?? null;
  const overBudget = budgetX != null && baseline > 0 && totalSeconds / baseline > budgetX;
  const worst = [...stages]
    .sort((a, b) => b.seconds - a.seconds)
    .slice(0, 3)
    .map((s) => ({ groupName: s.groupName, seconds: s.seconds, pct: totalSeconds > 0 ? (s.seconds / totalSeconds) * 100 : 0 }));

  return {
    stages,
    totalSeconds,
    baselineSeconds: baseline,
    overheadPct,
    pierces: paths.length,
    pocketCount: stages.filter((s) => s.generatedClass === "perforate").reduce((n, s) => n + s.pathCount, 0),
    bandCount: stages.filter((s) => s.generatedClass !== "perforate").reduce((n, s) => n + s.pathCount, 0),
    budgetX,
    overBudget,
    worst,
  };
}

export { fmtDuration };
