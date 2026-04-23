/**
 * Variability analysis for tests with multiple uploaded results.
 *
 * Every ``AveragedSwatch`` carries a ``per_result`` array of the
 * individual runs that contributed to the average. This module turns
 * that into per-cell and grid-level spread metrics the Spectrum pages
 * render.
 *
 * Performance note: cells are tight inner-loop work (one pass per
 * frame when dragging a slider). We use ``deltaE76`` (euclidean in
 * Lab) for per-cell spread — it's ~5× faster than ``deltaE2000`` and
 * the rank-ordering of "which cells are unstable" is the same. Reserve
 * ``deltaE2000`` for the single grid-level headline number.
 */

import { deltaE2000, deltaE76, hexToLab, type Lab } from "./math";
import type { AveragedSwatch } from "../types";

/** Per-cell spread report. ``spread`` is the headline; ``maxSpread``
 *  flags outliers; ``centroid`` + ``labSigmas`` drive the glyph viz. */
export interface CellSpread {
  /** Number of results that contributed. ``1`` means no replicate data. */
  n: number;
  /** Mean ΔE76 from each per-result colour to the Lab centroid. */
  spread: number;
  /** Maximum ΔE76 from any per-result colour to the centroid (outlier signal). */
  maxSpread: number;
  /** Arithmetic mean of the per-result Lab values. */
  centroidLab: Lab;
  /** Per-channel standard deviation (L, a, b). Used by glyph sizing. */
  labSigmas: [number, number, number];
  /** Lab values of each per-result sample, in upload order — needed
   *  by the ghost fan + explode strip so they don't re-parse hex. */
  labs: Lab[];
}

/** Spread = 0 fallback for cells with no or one per-result entry. */
const EMPTY_SPREAD: CellSpread = {
  n: 0,
  spread: 0,
  maxSpread: 0,
  centroidLab: [0, 0, 0],
  labSigmas: [0, 0, 0],
  labs: [],
};

export function computeCellSpread(swatch: AveragedSwatch): CellSpread {
  const per = swatch.per_result ?? [];
  if (per.length === 0) return { ...EMPTY_SPREAD };
  const labs = per.map((r) => hexToLab(r.hex));
  const n = labs.length;
  if (n === 1) {
    return {
      n,
      spread: 0,
      maxSpread: 0,
      centroidLab: labs[0],
      labSigmas: [0, 0, 0],
      labs,
    };
  }
  // Centroid = arithmetic mean of Lab samples.
  const centroid: Lab = [0, 0, 0];
  for (const l of labs) {
    centroid[0] += l[0] / n;
    centroid[1] += l[1] / n;
    centroid[2] += l[2] / n;
  }
  // Per-sample ΔE to centroid.
  let sum = 0;
  let maxD = 0;
  for (const l of labs) {
    const d = deltaE76(l, centroid);
    sum += d;
    if (d > maxD) maxD = d;
  }
  // Per-channel stdev (sample, n-1 denominator).
  const denom = Math.max(1, n - 1);
  const varL = labs.reduce((acc, l) => acc + Math.pow(l[0] - centroid[0], 2), 0) / denom;
  const varA = labs.reduce((acc, l) => acc + Math.pow(l[1] - centroid[1], 2), 0) / denom;
  const varB = labs.reduce((acc, l) => acc + Math.pow(l[2] - centroid[2], 2), 0) / denom;
  return {
    n,
    spread: sum / n,
    maxSpread: maxD,
    centroidLab: centroid,
    labSigmas: [Math.sqrt(varL), Math.sqrt(varA), Math.sqrt(varB)],
    labs,
  };
}

/** Cells whose mean-ΔE-to-centroid is above this threshold are
 *  flagged as "unstable" in the header chip and can be jumped to.
 *
 *  ΔE 4 (not 2) because laser-engraved swatches carry natural
 *  burn-to-burn noise from focus / angle / oxidation / camera ICC
 *  variance even when the visual match is excellent. The perceptual
 *  ranges we're borrowing from industrial colour-matching work out to:
 *
 *    ΔE < 2.3  — imperceptible (CIEDE2000 "just noticeable")
 *    ΔE 2.3-4  — perceptible only on close inspection
 *    ΔE > 4    — clearly different burn-to-burn
 *
 *  Using ΔE76 (fast) for the per-cell rank; the absolute numbers
 *  differ slightly from ΔE2000 but the ranking stays the same. */
export const UNSTABLE_SPREAD_THRESHOLD = 4.0;

export interface GridStability {
  /** Total number of swatches considered. */
  cellCount: number;
  /** Cells with at least 2 per-result entries. The rest contribute
   *  nothing to the stability metrics. */
  cellsWithReplicates: number;
  /** Number of distinct ``result_id`` values across all per_result entries. */
  resultCount: number;
  /** Grid-mean of per-cell ΔE2000 between the centroid colour and each
   *  result's colour. Single headline number for the stability chip. */
  meanSpread: number;
  /** Worst-case ΔE2000 across all (cell, result) pairs. */
  maxSpread: number;
  /** Count of cells with ``spread > UNSTABLE_SPREAD_THRESHOLD`` (using
   *  the fast ΔE76 cell metric for consistency with drill-down). */
  unstableCount: number;
  /** Cells flagged as unstable, in the caller's original order. Useful
   *  for a "jump to first unstable" interaction. */
  unstableSwatches: AveragedSwatch[];
}

/** Grid-level stability summary. Cheap enough to recompute on every
 *  swatch update; memoize on the caller's side if the array identity
 *  is stable. */
export function computeGridStability(swatches: AveragedSwatch[]): GridStability {
  const resultIds = new Set<number>();
  let cellsWithReplicates = 0;
  let perCellDeltaSum = 0;
  let perCellDeltaCount = 0;
  let maxSpread = 0;
  let unstableCount = 0;
  const unstableSwatches: AveragedSwatch[] = [];

  for (const s of swatches) {
    const per = s.per_result ?? [];
    for (const r of per) resultIds.add(r.result_id);
    if (per.length < 2) continue;
    cellsWithReplicates += 1;

    // Centroid in Lab.
    const labs = per.map((r) => hexToLab(r.hex));
    const centroid: Lab = [0, 0, 0];
    for (const l of labs) {
      centroid[0] += l[0] / labs.length;
      centroid[1] += l[1] / labs.length;
      centroid[2] += l[2] / labs.length;
    }
    // ΔE76 for the cell's own spread (used for unstable flag — ranks
    // the same way the drill-down will).
    let cellSpread76 = 0;
    let cellMax76 = 0;
    for (const l of labs) {
      const d = deltaE76(l, centroid);
      cellSpread76 += d;
      if (d > cellMax76) cellMax76 = d;
    }
    cellSpread76 /= labs.length;

    // ΔE2000 for the grid-level headline — more perceptually honest
    // but expensive, so only at aggregate level.
    for (const l of labs) {
      const d2k = deltaE2000(l, centroid);
      perCellDeltaSum += d2k;
      perCellDeltaCount += 1;
      if (d2k > maxSpread) maxSpread = d2k;
    }

    if (cellSpread76 > UNSTABLE_SPREAD_THRESHOLD) {
      unstableCount += 1;
      unstableSwatches.push(s);
    }
  }

  return {
    cellCount: swatches.length,
    cellsWithReplicates,
    resultCount: resultIds.size,
    meanSpread: perCellDeltaCount > 0 ? perCellDeltaSum / perCellDeltaCount : 0,
    maxSpread,
    unstableCount,
    unstableSwatches,
  };
}

/** Global constellation scale = ``cell_px / (2 × quantile95(maxSpread))``.
 *  Shared across every cell in a 2-D grid so visual dot-cloud size
 *  compares honestly. */
export function computeConstellationScale(
  swatches: AveragedSwatch[],
  cellPx: number,
): number {
  const maxes: number[] = [];
  for (const s of swatches) {
    if (!s.per_result || s.per_result.length < 2) continue;
    const labs = s.per_result.map((r) => hexToLab(r.hex));
    const c: Lab = [0, 0, 0];
    for (const l of labs) {
      c[0] += l[0] / labs.length;
      c[1] += l[1] / labs.length;
      c[2] += l[2] / labs.length;
    }
    let m = 0;
    for (const l of labs) {
      // a/b plane only — L becomes cell-background treatment.
      const d = Math.hypot(l[1] - c[1], l[2] - c[2]);
      if (d > m) m = d;
    }
    if (m > 0) maxes.push(m);
  }
  if (maxes.length === 0) return 0;
  maxes.sort((a, b) => a - b);
  const q95 = maxes[Math.min(maxes.length - 1, Math.floor(maxes.length * 0.95))];
  if (q95 <= 0) return 0;
  // Shrink to 80% of half-cell so the scalebar cross doesn't kiss the cell edge.
  return (cellPx * 0.8) / (2 * q95);
}
