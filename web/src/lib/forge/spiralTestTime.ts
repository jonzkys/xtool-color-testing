// web/src/lib/forge/spiralTestTime.ts
// Ballpark job-time estimate for a Spiral Test sheet: vector spiral cuts +
// raster label fill-engrave. Composes the cuttime models. Pure. Approximate —
// ignores focus-descent Z-moves and inter-cell rapid travel.
import { stageSeconds, vectorCutSeconds, RATE_FALLBACK } from "../cuttime/model";
import { ringsBBox, ringsInkArea, ringsPerimeter } from "../cuttime/geometry";
import { spiralPathLength } from "./spiral";
import type { SpiralTestConfig, SpiralTestResult } from "./spiralTest";

export interface SpiralTestTime {
  cutSeconds: number;
  engraveSeconds: number;
  totalSeconds: number;
}

/** Estimate total job seconds: spiral cuts (vector, per deduped profile) +
 *  label fill-engrave (raster). */
export function estimateSpiralTestSeconds(result: SpiralTestResult, cfg: SpiralTestConfig): SpiralTestTime {
  // Cut: each arm is its own vector cut with its own per-pass overhead (like the
  // Forge estimator's per-path spiral branch). passes/speed come from the arm's
  // deduped CUT_<n> profile in result.stageParams.
  let cutSeconds = 0;
  for (const p of result.cutPaths) {
    const sp = result.stageParams[p.groupName];
    const passes = sp?.passes ?? 1;
    const speed = sp?.speed ?? RATE_FALLBACK.speedMmS;
    const len = p.rings.reduce((s, arm) => s + spiralPathLength(arm), 0);
    cutSeconds += vectorCutSeconds(len, passes, speed);
  }

  // Engrave: per label, a raster sweep at the score (label-engrave) rate.
  let engraveSeconds = 0;
  for (const lbl of result.labelOutlines) {
    if (lbl.rings.length === 0) continue;
    const b = ringsBBox(lbl.rings);
    engraveSeconds += stageSeconds(
      { bboxW: b.w, bboxH: b.h, fillAreaMm2: ringsInkArea(lbl.rings), perimeterMm: ringsPerimeter(lbl.rings) },
      { sliceNumber: 1, repeat: cfg.score.passes, speedMmS: cfg.score.speed, densityLpc: cfg.score.linesPerCm },
    );
  }

  return { cutSeconds, engraveSeconds, totalSeconds: cutSeconds + engraveSeconds };
}
