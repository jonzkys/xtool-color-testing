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
  // Cut: per group, passes × Σ(arm length) / speed. Group params carry the
  // per-cell swept passes/speed (deduped into result.stageParams).
  const lenByGroup = new Map<string, number>();
  for (const p of result.cutPaths) {
    const len = p.rings.reduce((s, arm) => s + spiralPathLength(arm), 0);
    lenByGroup.set(p.groupName, (lenByGroup.get(p.groupName) ?? 0) + len);
  }
  let cutSeconds = 0;
  for (const [group, len] of lenByGroup) {
    const sp = result.stageParams[group];
    const passes = sp?.passes ?? 1;
    const speed = sp?.speed ?? RATE_FALLBACK.speedMmS;
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
