import {
  chroma,
  deltaE76,
  hueDeg,
  pca1,
  wrapHueDelta,
  type Lab,
} from "../color/math";
import type { ResultRecord, ValidationCell } from "../types";

export interface StatsSeriesEntry {
  result: ResultRecord;
  /** Map cell_index → measured Lab so we can re-derive every stat. */
  cells: Map<number, { hex: string; lab: Lab }>;
  /** Display label for the card header. */
  label: string;
}

export interface PerResultStats {
  resultId: number;
  label: string;
  totalCells: number;
  sampleCount: number;
  meanDeltaL: number;
  meanDeltaA: number;
  meanDeltaB: number;
  medianDeltaE: number;
  maxDeltaE: number;
  worstCellIndex: number | null;
  meanDeltaHue: number;
}

export interface AcrossRunsStats {
  medianSigma: number;
  worstSigma: { value: number; cellIndex: number | null };
  topVariable: { cellIndex: number; sigma: number }[];
}

/** Burn vs camera split — the iter-5 view that separates the systematic
 *  burn drift (mean-of-runs vs expected) from the per-cell measurement
 *  noise (spread between runs). Both are aggregated over the cells the
 *  test sampled with at least one run; ``cameraSigma`` math additionally
 *  needs ≥2 runs to mean anything, hence ``cameraSampleCount`` may be
 *  smaller than ``burnSampleCount``. */
export interface BurnVsCameraStats {
  /** Number of cells contributing to the burn-side median. */
  burnSampleCount: number;
  /** Number of cells contributing to the camera-side median (≥2 runs). */
  cameraSampleCount: number;
  /** Per-cell BURN ΔE76 — distance from the per-run-mean Lab to the
   *  expected Lab. Median across all sampled cells. */
  medianBurnDeltaE: number;
  /** Per-cell CAMERA σ — Euclidean ΔE76 spread across runs. Median
   *  across cells with ≥2 runs. */
  medianCameraSigma: number;
  /** ``medianBurnDeltaE / medianCameraSigma`` when both are positive. */
  ratio: number | null;
  /** Cell with the largest BURN ΔE; null when no cells qualify. */
  worstBurn: { cellIndex: number; value: number } | null;
  /** Cell with the largest CAMERA σ; null when no cells have ≥2 runs. */
  worstCamera: { cellIndex: number; value: number } | null;
}

export function computePerResultStats(
  cells: ValidationCell[],
  s: StatsSeriesEntry,
): PerResultStats {
  let dLs = 0, dAs = 0, dBs = 0;
  let dHueAcc = 0;
  let n = 0;
  let maxDE = 0;
  let worstCell: number | null = null;
  const dEs: number[] = [];
  for (const c of cells) {
    const exp = c.expected_lab as Lab | number[];
    if (!Array.isArray(exp) || exp.length !== 3) continue;
    const m = s.cells.get(c.cell_index);
    if (!m) continue;
    const e: Lab = [exp[0], exp[1], exp[2]];
    dLs += m.lab[0] - e[0];
    dAs += m.lab[1] - e[1];
    dBs += m.lab[2] - e[2];
    dHueAcc += wrapHueDelta(
      hueDeg(m.lab[1], m.lab[2]) - hueDeg(e[1], e[2]),
    );
    const dE = deltaE76(e, m.lab);
    dEs.push(dE);
    if (dE > maxDE) {
      maxDE = dE;
      worstCell = c.cell_index;
    }
    n++;
  }
  if (n === 0) {
    return {
      resultId: s.result.id,
      label: s.label,
      totalCells: cells.length,
      sampleCount: 0,
      meanDeltaL: 0,
      meanDeltaA: 0,
      meanDeltaB: 0,
      medianDeltaE: 0,
      maxDeltaE: 0,
      worstCellIndex: null,
      meanDeltaHue: 0,
    };
  }
  return {
    resultId: s.result.id,
    label: s.label,
    totalCells: cells.length,
    sampleCount: n,
    meanDeltaL: dLs / n,
    meanDeltaA: dAs / n,
    meanDeltaB: dBs / n,
    medianDeltaE: median(dEs),
    maxDeltaE: maxDE,
    worstCellIndex: worstCell,
    meanDeltaHue: dHueAcc / n,
  };
}

/** Per-cell σ across runs (RMS Lab deviation from the centroid),
 *  median + worst + top-10 most-variable list. Mirrors the math the
 *  chart uses for its "per-cell σ" axis so chart and stats stay in
 *  lockstep. */
export function computeAcrossRunsStats(
  cells: ValidationCell[],
  series: StatsSeriesEntry[],
): AcrossRunsStats {
  const perCell: { cellIndex: number; sigma: number }[] = [];
  for (const c of cells) {
    const labs: Lab[] = [];
    for (const s of series) {
      const m = s.cells.get(c.cell_index);
      if (m) labs.push(m.lab);
    }
    if (labs.length < 2) continue;
    let mL = 0, mA = 0, mB = 0;
    for (const l of labs) {
      mL += l[0] / labs.length;
      mA += l[1] / labs.length;
      mB += l[2] / labs.length;
    }
    let v = 0;
    for (const l of labs) {
      v += (l[0] - mL) ** 2 + (l[1] - mA) ** 2 + (l[2] - mB) ** 2;
    }
    perCell.push({
      cellIndex: c.cell_index,
      sigma: Math.sqrt(v / labs.length),
    });
  }
  if (perCell.length === 0) {
    return {
      medianSigma: 0,
      worstSigma: { value: 0, cellIndex: null },
      topVariable: [],
    };
  }
  const sortedDesc = [...perCell].sort((a, b) => b.sigma - a.sigma);
  const sortedSigmas = perCell.map((p) => p.sigma).sort((a, b) => a - b);
  return {
    medianSigma: median(sortedSigmas),
    worstSigma: {
      value: sortedDesc[0].sigma,
      cellIndex: sortedDesc[0].cellIndex,
    },
    topVariable: sortedDesc.slice(0, 10),
  };
}

/* ─── Burn vs camera per-cell helpers ──────────────────────────────────── */

/** Minimum chroma for the per-cell hue rotation to read meaningfully.
 *  Below this, atan2(b*, a*) wobbles with arbitrary noise so we suppress
 *  the value rather than report a phantom rotation. Mirrors the
 *  threshold the validation tooltip uses elsewhere on the page. */
const HUE_CHROMA_THRESHOLD = 3;

/** Best estimate of what the burn produced for this cell, given N
 *  measurements: arithmetic mean Lab. ``null`` if no finite
 *  measurements exist in the input. */
export function meanLab(measurements: readonly Lab[]): Lab | null {
  let n = 0;
  let sL = 0;
  let sA = 0;
  let sB = 0;
  for (const m of measurements) {
    if (!m || m.length !== 3) continue;
    if (!Number.isFinite(m[0]) || !Number.isFinite(m[1]) || !Number.isFinite(m[2])) {
      continue;
    }
    sL += m[0];
    sA += m[1];
    sB += m[2];
    n += 1;
  }
  if (n === 0) return null;
  return [sL / n, sA / n, sB / n];
}

/** Burn-true ΔE76: distance between mean-Lab and expected_Lab. The
 *  systematic, run-averaged error — the best guess at the burn's true
 *  output independent of camera noise. ``null`` when ``meanLab`` is
 *  null. */
export function burnDeltaE(
  measurements: readonly Lab[],
  expected: Lab,
): number | null {
  const m = meanLab(measurements);
  if (m == null) return null;
  return deltaE76(m, expected);
}

/** Camera σ: mean of ``||lab_i − meanLab||`` (Euclidean ΔE76) across
 *  the N measurements. Pure measurement noise — independent of how off
 *  the burn is from expected. ``null`` if N<2 finite measurements. */
export function cameraSigma(measurements: readonly Lab[]): number | null {
  const finite: Lab[] = [];
  for (const m of measurements) {
    if (!m || m.length !== 3) continue;
    if (!Number.isFinite(m[0]) || !Number.isFinite(m[1]) || !Number.isFinite(m[2])) {
      continue;
    }
    finite.push([m[0], m[1], m[2]]);
  }
  if (finite.length < 2) return null;
  const mean = meanLab(finite);
  if (mean == null) return null;
  let acc = 0;
  for (const f of finite) {
    acc += deltaE76(f, mean);
  }
  return acc / finite.length;
}

/** Burn-true signed Δh°: hue rotation from expected to mean-measured,
 *  wrapped to [-180, 180]. ``null`` when mean-measured chroma is too
 *  small to define hue meaningfully. */
export function burnDeltaHue(
  measurements: readonly Lab[],
  expected: Lab,
): number | null {
  const m = meanLab(measurements);
  if (m == null) return null;
  if (chroma(m[1], m[2]) < HUE_CHROMA_THRESHOLD) return null;
  return wrapHueDelta(hueDeg(m[1], m[2]) - hueDeg(expected[1], expected[2]));
}

/** Per-cell residual breakdown: signed component-wise distance from
 *  expected to mean-measured Lab plus a hue rotation. Used by the
 *  focused-cell drilldown to show "what direction did this cell drift".
 *  ``deltaHue`` is null when the mean-measured chroma is below the
 *  HUE_CHROMA_THRESHOLD (same gate as ``burnDeltaHue``).
 *  Returns null when there are no finite measurements at all. */
export interface CellResidual {
  deltaL: number;
  deltaA: number;
  deltaB: number;
  deltaE: number;
  deltaHue: number | null;
}

export function cellResidual(
  measurements: readonly Lab[],
  expected: Lab,
): CellResidual | null {
  const m = meanLab(measurements);
  if (m == null) return null;
  const dL = m[0] - expected[0];
  const dA = m[1] - expected[1];
  const dB = m[2] - expected[2];
  const dE = deltaE76(m, expected);
  let dHue: number | null = null;
  if (chroma(m[1], m[2]) >= HUE_CHROMA_THRESHOLD) {
    dHue = wrapHueDelta(
      hueDeg(m[1], m[2]) - hueDeg(expected[1], expected[2]),
    );
  }
  return { deltaL: dL, deltaA: dA, deltaB: dB, deltaE: dE, deltaHue: dHue };
}

/** Compute the BURN vs CAMERA card's content from the same
 *  cells/series pair the rest of the strip consumes. Single-pass over
 *  cells; runs each per-cell helper once and tracks the worst per
 *  metric so the card can wire its cell-link tail. */
export function computeBurnVsCameraStats(
  cells: ValidationCell[],
  series: StatsSeriesEntry[],
): BurnVsCameraStats {
  const burnDeltaEs: number[] = [];
  const cameraSigmas: number[] = [];
  let worstBurn: { cellIndex: number; value: number } | null = null;
  let worstCamera: { cellIndex: number; value: number } | null = null;
  for (const c of cells) {
    const expArr = c.expected_lab as Lab | number[];
    if (!Array.isArray(expArr) || expArr.length !== 3) continue;
    const expected: Lab = [expArr[0], expArr[1], expArr[2]];
    const labs: Lab[] = [];
    for (const s of series) {
      const m = s.cells.get(c.cell_index);
      if (m) labs.push(m.lab);
    }
    const bDE = burnDeltaE(labs, expected);
    if (bDE != null) {
      burnDeltaEs.push(bDE);
      if (worstBurn == null || bDE > worstBurn.value) {
        worstBurn = { cellIndex: c.cell_index, value: bDE };
      }
    }
    const cs = cameraSigma(labs);
    if (cs != null) {
      cameraSigmas.push(cs);
      if (worstCamera == null || cs > worstCamera.value) {
        worstCamera = { cellIndex: c.cell_index, value: cs };
      }
    }
  }
  const medianBurnDeltaE = burnDeltaEs.length > 0 ? median(burnDeltaEs) : 0;
  const medianCameraSigma = cameraSigmas.length > 0 ? median(cameraSigmas) : 0;
  const ratio =
    medianBurnDeltaE > 0 && medianCameraSigma > 0
      ? medianBurnDeltaE / medianCameraSigma
      : null;
  return {
    burnSampleCount: burnDeltaEs.length,
    cameraSampleCount: cameraSigmas.length,
    medianBurnDeltaE,
    medianCameraSigma,
    ratio,
    worstBurn,
    worstCamera,
  };
}

/* ─── Palette residual PC1 ────────────────────────────────────────────── */

/** Output of {@link computePaletteResidualPC1}: the principal direction
 *  along which the palette's per-cell residual vector cloud spreads,
 *  the variance fraction it explains, and a human-readable
 *  interpretation hint (e.g. "warmer + brighter").
 *
 *  PC1 is the burn's "dominant correction direction" — when its
 *  variance ratio is high (≥ ~0.6) the entire palette can usually be
 *  pulled back toward expected by a single Lab translation in this
 *  axis. When it's low (≤ ~0.4) the residuals are diffuse — colour-
 *  dependent drift — and a single global correction won't help. */
export interface PaletteResidualPC1 {
  /** Number of cells contributing (need ≥ 3 for the math to mean
   *  anything; below that we still emit zeros for stable rendering). */
  sampleCount: number;
  /** Mean residual vector (cloud centroid). Lab units. */
  meanDelta: { L: number; a: number; b: number };
  /** Unit-length first principal axis in (ΔL, Δa, Δb). Sign is chosen
   *  so the projection of the centroid onto the axis is non-negative —
   *  i.e. the axis points the same way the mean residual does, so the
   *  interpretation hint reads consistently with the centroid's sign. */
  axis: { L: number; a: number; b: number };
  /** Fraction of total residual variance captured by this axis,
   *  ∈ [0, 1]. */
  varianceRatio: number;
  /** Magnitude of the centroid projected onto the axis (Lab units).
   *  Tells you "how much" of the residual is along PC1 on average. */
  projectedMean: number;
}

export function computePaletteResidualPC1(
  cells: ValidationCell[],
  series: StatsSeriesEntry[],
): PaletteResidualPC1 {
  const residuals: Lab[] = [];
  for (const c of cells) {
    const expArr = c.expected_lab as Lab | number[];
    if (!Array.isArray(expArr) || expArr.length !== 3) continue;
    const expected: Lab = [expArr[0], expArr[1], expArr[2]];
    // Per-cell measurement: average across runs that hit this cell so
    // PC1 sees the burn-mean residual, not per-run noise.
    const labs: Lab[] = [];
    for (const s of series) {
      const m = s.cells.get(c.cell_index);
      if (m) labs.push(m.lab);
    }
    if (labs.length === 0) continue;
    const cellMean = meanLab(labs);
    if (cellMean == null) continue;
    residuals.push([
      cellMean[0] - expected[0],
      cellMean[1] - expected[1],
      cellMean[2] - expected[2],
    ]);
  }
  if (residuals.length < 3) {
    return {
      sampleCount: residuals.length,
      meanDelta: { L: 0, a: 0, b: 0 },
      axis: { L: 0, a: 0, b: 0 },
      varianceRatio: 0,
      projectedMean: 0,
    };
  }
  const pca = pca1(residuals);
  // Sign convention: flip the axis so the centroid projects positively
  // onto it. PCA itself doesn't fix the axis sign, so without this the
  // interpretation ("warmer/cooler") flips run-to-run.
  let [aL, aA, aB] = pca.axis;
  const meanL = pca.mean[0];
  const meanA = pca.mean[1];
  const meanB = pca.mean[2];
  const projMean = meanL * aL + meanA * aA + meanB * aB;
  if (projMean < 0) {
    aL = -aL;
    aA = -aA;
    aB = -aB;
  }
  return {
    sampleCount: residuals.length,
    meanDelta: { L: meanL, a: meanA, b: meanB },
    axis: { L: aL, a: aA, b: aB },
    varianceRatio: pca.variance_ratio,
    projectedMean: Math.abs(projMean),
  };
}

/** Phrase the dominant axis as a short interpretation hint, e.g.
 *  "warmer + brighter" or "blue-shifted". Picks the two Lab
 *  components with the largest absolute weights in the axis and
 *  labels each as a perceptual direction. Returns ``null`` when the
 *  axis is zero (not enough samples). */
export function describePc1Axis(
  pc1: PaletteResidualPC1,
): string | null {
  const a = pc1.axis;
  const mag = Math.hypot(a.L, a.a, a.b);
  if (mag < 1e-6) return null;
  const components: { label: string; weight: number }[] = [
    { label: a.L > 0 ? "brighter" : "darker", weight: Math.abs(a.L) },
    { label: a.a > 0 ? "warmer" : "greener", weight: Math.abs(a.a) },
    { label: a.b > 0 ? "yellower" : "bluer", weight: Math.abs(a.b) },
  ];
  components.sort((x, y) => y.weight - x.weight);
  // Only include the second component if its weight is at least half
  // the first's — otherwise the hint reads as misleadingly equal.
  const primary = components[0];
  const secondary = components[1];
  if (secondary.weight >= primary.weight * 0.5) {
    return `${primary.label} + ${secondary.label}`;
  }
  return primary.label;
}

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

export function signedNum(v: number, decimals = 1): string {
  const sign = v > 0 ? "+" : "";
  const decs = Math.abs(v) >= 100 ? 0 : decimals;
  return `${sign}${v.toFixed(decs)}`;
}
