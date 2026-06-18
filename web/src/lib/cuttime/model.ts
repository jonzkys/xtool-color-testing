//
// Calibrated laser engrave/incise cut-time model. Reproduces xTool Studio's
// estimated time for an INTAGLIO area-fill within ~6% across 13 probes
// (F2 Ultra, processAngle ≈ 15°, density 100–300, speed 100–600, slices 50–256,
// band width 0.1–1.0 mm; see specs/2026-06-08-forge-time-aware-design.md §App.A).
//
//   stage_seconds = sliceNumber × repeat ×
//       [ d·(bboxW·bboxH)/V_SCAN  +  d·bboxH·TAU  +  K_BURN·d·fillArea/speed ]
//   d = densityLpc / 10  (lines per mm)
//
// The first two terms (raster sweep over the bounding box + per-line turnaround)
// dominate and are independent of the speed SETTING; the burn term is small for
// thin bands and only matters when a band is both wide and slow.
//
// Generic by design: no Forge / domain imports. Any caller that can summarise a
// pass as { bboxW, bboxH, fillArea } + { slices, repeat, speed, density } gets an
// estimate from `stageSeconds`.

export interface CutTimeCalibration {
  /** Raster sweep rate (mm/s) — NOT the user's speed setting. */
  vScanMmS: number;
  /** Per-scan-line turnaround (s/line). */
  tauSPerLine: number;
  /** Burn coefficient (≈1); burn ≈ scanLength/speed. */
  kBurn: number;
}

/** Calibrated 2026-06 against xTool Studio, F2 Ultra, processAngle ≈ 15°. */
export const DEFAULT_CALIBRATION: CutTimeCalibration = {
  vScanMmS: 2532,
  tauSPerLine: 0.006217,
  kBurn: 0.916,
};

/** Fallback rate when a source supplies no value — the user's measured 3 mm-brass
 *  working regime. Keeps estimates from silently reading as zero. */
export const RATE_FALLBACK = {
  speedMmS: 200,
  densityLpc: 300,
  sliceNumber: 100,
  repeat: 1,
} as const;

/** One pass's geometry summary (mm). `bboxH` is the across-scan extent that sets
 *  the scan-line count; for Forge's ~horizontal scan that is the AABB height. */
export interface StageGeom {
  bboxW: number;
  bboxH: number;
  fillAreaMm2: number;
  perimeterMm: number;
}

/** One pass's laser rate. */
export interface StageRate {
  sliceNumber: number;
  repeat: number;
  speedMmS: number;
  densityLpc: number;
}

/** Estimated laser-on seconds for one stage. */
export function stageSeconds(
  g: StageGeom,
  r: StageRate,
  c: CutTimeCalibration = DEFAULT_CALIBRATION,
): number {
  const d = Math.max(0, r.densityLpc) / 10; // lines per mm
  const speed = Math.max(1, r.speedMmS);
  const perSlice =
    (d * g.bboxW * g.bboxH) / c.vScanMmS +
    d * g.bboxH * c.tauSPerLine +
    (c.kBurn * d * g.fillAreaMm2) / speed;
  return perSlice * Math.max(1, r.sliceNumber) * Math.max(1, r.repeat);
}

/** Format seconds as `m:ss` or `h:mm:ss`. */
export function fmtDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

/** Linear vector-cut seconds: passes × (length/speed) + a tiny per-pass
 *  overhead. Mirrors the Forge estimator's spiral branch; speed/passes floored
 *  at 1. The companion to stageSeconds (raster) for length-based cuts. */
export function vectorCutSeconds(lengthMm: number, passes: number, speedMmS: number): number {
  const PER_PASS_OVERHEAD_S = 0.01;
  const p = Math.max(1, passes);
  return p * (Math.max(0, lengthMm) / Math.max(1, speedMmS) + PER_PASS_OVERHEAD_S);
}
