import {
  chroma,
  deltaE76,
  hueDeg,
  wrapHueDelta,
  type Lab,
} from "../color/math";
import {
  burnDeltaE,
  burnDeltaHue,
  cameraSigma,
} from "./stabilityStatsMath";

/* ─── Series palette ──────────────────────────────────────────────────────
 *
 * 8 distinct hues anchored on the Workshop primary so the first series
 * always reads as "the burnt-in headline run". Subsequent slots fan
 * around the wheel; ordering is hand-picked so adjacent series don't
 * collide visually when more than two are loaded at once.
 */
const SERIES_PALETTE: readonly string[] = [
  "#b8410e", // primary ember
  "#1d6b8c", // ink-blue
  "#7c4f00", // ochre
  "#3a8556", // moss
  "#9c3a72", // mulberry
  "#3f4a78", // indigo
  "#a07b1c", // brass
  "#3a3a3a", // graphite
] as const;

export function seriesColour(idx: number): string {
  return SERIES_PALETTE[idx % SERIES_PALETTE.length];
}

/* ─── Axes ──────────────────────────────────────────────────────────────── */

export type XAxis =
  | "expected_hue"
  | "expected_l"
  | "expected_a"
  | "expected_b"
  | "expected_chroma"
  | "cell_index"
  | "burn_delta_e"
  | "burn_delta_hue"
  | "camera_sigma";

export type YAxis =
  | "measured_hue"
  | "measured_l"
  | "measured_a"
  | "measured_b"
  | "measured_chroma"
  | "delta_e"
  | "delta_l"
  | "delta_a"
  | "delta_b"
  | "delta_hue"
  | "delta_from_mean"
  | "per_cell_sigma"
  | "burn_delta_e"
  | "burn_delta_hue";

/** Axes that aggregate per-cell across all selected runs into a single
 *  burn-true value. The scatter collapses its multi-series cloud into
 *  one "burn mean" series when one of these is active; the heatmap
 *  swaps in the burn-aware aggregator. Both views need ≥2 runs for the
 *  numbers to be meaningful (otherwise the mean is just the run). */
export function isBurnAxis(y: YAxis): boolean {
  return y === "burn_delta_e" || y === "burn_delta_hue";
}

/** Computed-per-cell X axes: each cell's X position is one number
 *  derived from all selected runs (burn ΔE vs expected, burn Δh° vs
 *  expected, or camera σ across runs). When active, the scatter
 *  collapses or routes positioning through the cell's computed value
 *  rather than its expected_lab. All three need ≥2 runs to produce a
 *  meaningful number — the X-axis pill mirrors the burn-Y pill's
 *  disabled treatment when only one run is selected. */
export function isComputedXAxis(x: XAxis): boolean {
  return (
    x === "burn_delta_e" ||
    x === "burn_delta_hue" ||
    x === "camera_sigma"
  );
}

/** Y axes that aggregate across runs into one number per cell — the
 *  burn-true axes plus per-cell σ. Used together with
 *  ``isComputedXAxis`` to detect the "both axes are computed" case
 *  where the scatter collapses to one dot per cell and the median-
 *  cross + quadrant labels apply. */
export function isComputedYAxis(y: YAxis): boolean {
  return (
    y === "burn_delta_e" ||
    y === "burn_delta_hue" ||
    y === "per_cell_sigma"
  );
}

/** Y axes that need the per-cell mean Lab computed across all
 *  selected runs but DO NOT collapse the per-run series — every
 *  (run, cell) gets its own dot, the y-value just measures distance
 *  from the cross-run consensus. Used by validation flows where the
 *  user wants to spot which run is the outlier across multiple
 *  captures of the same plate. Needs ≥2 runs to be meaningful. */
export function requiresPerCellMean(y: YAxis): boolean {
  return y === "delta_from_mean";
}

export interface AxisMeta {
  id: XAxis | YAxis;
  label: string;
  short: string;
  unit: string;
}

export const X_AXES: readonly AxisMeta[] = [
  { id: "expected_hue", label: "Expected hue", short: "EXP h°", unit: "deg" },
  { id: "expected_l", label: "Expected L*", short: "EXP L*", unit: "L*" },
  { id: "expected_a", label: "Expected a*", short: "EXP a*", unit: "a*" },
  { id: "expected_b", label: "Expected b*", short: "EXP b*", unit: "b*" },
  { id: "expected_chroma", label: "Expected chroma", short: "EXP C*", unit: "C*" },
  { id: "cell_index", label: "Cell index", short: "CELL #", unit: "n" },
  { id: "burn_delta_e", label: "Burn ΔE (run-mean)", short: "BURN ΔE", unit: "ΔE" },
  { id: "burn_delta_hue", label: "Burn Δh° (run-mean)", short: "BURN Δh°", unit: "deg" },
  { id: "camera_sigma", label: "Camera σ (across runs)", short: "CAMERA σ", unit: "ΔE" },
] as const;

export const Y_AXES: readonly AxisMeta[] = [
  { id: "delta_from_mean", label: "ΔE from cross-run mean", short: "Δ FROM MEAN", unit: "ΔE" },
  { id: "delta_hue", label: "Δ hue", short: "Δh°", unit: "deg" },
  { id: "delta_e", label: "ΔE76", short: "ΔE", unit: "ΔE" },
  { id: "delta_l", label: "ΔL", short: "ΔL", unit: "ΔL" },
  { id: "delta_a", label: "Δa", short: "Δa", unit: "Δa" },
  { id: "delta_b", label: "Δb", short: "Δb", unit: "Δb" },
  { id: "burn_delta_e", label: "Burn ΔE (run-mean)", short: "BURN ΔE", unit: "ΔE" },
  { id: "burn_delta_hue", label: "Burn Δh° (run-mean)", short: "BURN Δh°", unit: "deg" },
  { id: "measured_hue", label: "Measured hue", short: "h°", unit: "deg" },
  { id: "measured_l", label: "Measured L*", short: "L*", unit: "L*" },
  { id: "measured_a", label: "Measured a*", short: "a*", unit: "a*" },
  { id: "measured_b", label: "Measured b*", short: "b*", unit: "b*" },
  { id: "measured_chroma", label: "Measured chroma", short: "C*", unit: "C*" },
  { id: "per_cell_sigma", label: "Camera σ (across runs)", short: "CAMERA σ", unit: "ΔE" },
] as const;

/** A series carries one selected result's measured cells, labelled by
 *  cell_index (matches the base test's ValidationCell). */
export interface SeriesInput {
  resultId: number;
  /** Display label for the chart legend / tooltip. */
  label: string;
  /** Map cell_index → measured Lab + measured hex for that cell. Cells
   *  the result didn't sample (e.g. excluded) are simply absent. */
  cells: Map<number, { hex: string; lab: Lab }>;
}

export function isDeltaAxis(y: YAxis): boolean {
  return (
    y === "delta_l" ||
    y === "delta_a" ||
    y === "delta_b" ||
    y === "delta_hue"
  );
}

export function computeXValue(axis: XAxis, cellIndex: number, exp: Lab): number {
  switch (axis) {
    case "expected_hue":    return hueDeg(exp[1], exp[2]);
    case "expected_l":      return exp[0];
    case "expected_a":      return exp[1];
    case "expected_b":      return exp[2];
    case "expected_chroma": return chroma(exp[1], exp[2]);
    case "cell_index":      return cellIndex;
    // Computed X axes are derived from all selected runs at this cell.
    // Callers should route those through ``computeComputedXValue`` so
    // they can pass the per-run measurements; falling through here
    // returns NaN so the dot is filtered out rather than landing at 0.
    case "burn_delta_e":
    case "burn_delta_hue":
    case "camera_sigma":
      return Number.NaN;
  }
}

export function computeYValue(
  axis: YAxis,
  exp: Lab,
  measured: Lab,
  perCellSigma: number,
  /** Per-cell mean Lab across all selected runs. Required by the
   *  "delta_from_mean" axis; ignored otherwise. ``null`` when the
   *  cell only has one run's measurement (the mean is undefined for a
   *  single observation), in which case the axis returns NaN and the
   *  dot drops out of the scatter. */
  meanLab: Lab | null = null,
): number {
  switch (axis) {
    case "measured_l":      return measured[0];
    case "measured_a":      return measured[1];
    case "measured_b":      return measured[2];
    case "measured_chroma": return chroma(measured[1], measured[2]);
    case "measured_hue":    return hueDeg(measured[1], measured[2]);
    case "delta_e":         return deltaE76(exp, measured);
    case "delta_l":         return measured[0] - exp[0];
    case "delta_a":         return measured[1] - exp[1];
    case "delta_b":         return measured[2] - exp[2];
    case "delta_hue":
      return wrapHueDelta(
        hueDeg(measured[1], measured[2]) - hueDeg(exp[1], exp[2]),
      );
    case "delta_from_mean":
      // Each (run, cell) measures distance from the per-cell consensus.
      // High y = this run is an outlier vs. its peers at this cell.
      if (meanLab == null) return Number.NaN;
      return deltaE76(measured, meanLab);
    case "per_cell_sigma":  return perCellSigma;
    case "burn_delta_e":
      // The chart collapses ``series`` to a synthetic single "burn
      // mean" entry whose ``measured`` is the per-cell mean Lab —
      // ``measured`` arriving here is therefore that mean, and the
      // burn ΔE is simply ΔE76 against expected.
      return deltaE76(exp, measured);
    case "burn_delta_hue": {
      // Same trick: ``measured`` is the per-cell mean. Suppress the
      // value when the mean's chroma is too small for hue to read
      // meaningfully (chart paints NaN as a missing dot).
      if (chroma(measured[1], measured[2]) < BURN_HUE_CHROMA_THRESHOLD) {
        return Number.NaN;
      }
      return wrapHueDelta(
        hueDeg(measured[1], measured[2]) - hueDeg(exp[1], exp[2]),
      );
    }
  }
}

/** Match the per-cell helper in ``stabilityStatsMath.ts``. Cells whose
 *  mean-measured chroma sits below this threshold render as gaps on the
 *  burn-Δh° axis — hue-rotation can't be defined for a near-neutral
 *  patch without amplifying noise. */
const BURN_HUE_CHROMA_THRESHOLD = 3;

/** Computed-X projection. Returns ``null`` when the axis can't produce
 *  a value for this cell (low-chroma gating on ``burn_delta_hue``;
 *  fewer than 2 finite measurements for ``camera_sigma``); the scatter
 *  treats null as a missing dot. Routed through the existing
 *  ``stabilityStatsMath`` helpers so the X-axis projection and the
 *  BURN-vs-CAMERA stats card stay in lockstep. */
export function computeComputedXValue(
  axis: XAxis,
  expected: Lab,
  measurements: readonly Lab[],
): number | null {
  switch (axis) {
    case "burn_delta_e":   return burnDeltaE(measurements, expected);
    case "burn_delta_hue": return burnDeltaHue(measurements, expected);
    case "camera_sigma":   return cameraSigma(measurements);
    default:               return null;
  }
}

/** Standard deviation (RMS Lab distance from the centroid) of measured
 *  values across the selected runs at this cell. Collapses each cell
 *  into one number that reflects how much the runs disagree. Falls
 *  back to 0 when fewer than 2 runs sampled the cell. */
export function perCellSigmaFor(
  cellIndex: number,
  series: SeriesInput[],
): number {
  const labs: Lab[] = [];
  for (const s of series) {
    const m = s.cells.get(cellIndex);
    if (m) labs.push(m.lab);
  }
  if (labs.length < 2) return 0;
  const n = labs.length;
  let mL = 0, mA = 0, mB = 0;
  for (const l of labs) {
    mL += l[0] / n;
    mA += l[1] / n;
    mB += l[2] / n;
  }
  let v = 0;
  for (const l of labs) {
    v += (l[0] - mL) ** 2 + (l[1] - mA) ** 2 + (l[2] - mB) ** 2;
  }
  // Use population variance (N rather than N-1) — small samples,
  // stable comparisons matter more than statistical purity.
  return Math.sqrt(v / n);
}

/** Compute axis bounds. ``preferred`` is an externally supplied fallback
 *  (e.g. [0, 360] for hue) that we honour when no data falls outside it. */
export function niceBounds(
  values: number[],
  preferred: [number, number] | null,
): { min: number; max: number } {
  if (values.length === 0) {
    return preferred
      ? { min: preferred[0], max: preferred[1] }
      : { min: 0, max: 1 };
  }
  let min = Infinity;
  let max = -Infinity;
  for (const v of values) {
    if (!Number.isFinite(v)) continue;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (preferred) {
    min = Math.min(min, preferred[0]);
    max = Math.max(max, preferred[1]);
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return preferred
      ? { min: preferred[0], max: preferred[1] }
      : { min: 0, max: 1 };
  }
  return { min, max };
}

export function niceTicks(min: number, max: number, count: number): number[] {
  const range = max - min;
  if (range <= 0) return [min];
  const rough = range / count;
  const pow = Math.pow(10, Math.floor(Math.log10(rough)));
  const n = rough / pow;
  const step = (n >= 7.5 ? 10 : n >= 3 ? 5 : n >= 1.5 ? 2 : 1) * pow;
  const first = Math.ceil(min / step) * step;
  const out: number[] = [];
  for (let v = first; v <= max + step * 0.0001; v += step) out.push(v);
  return out;
}

/* ─── Grid index helpers ──────────────────────────────────────────────────
 *
 * The Stability page projects a 1-D `cell_index` (the canonical key on
 * every result swatch and validation cell) onto a 2-D grid for the
 * heatmap, and back again for click-targets. Centralised here so the
 * scatter, heatmap, and stats list can all share the same arithmetic
 * when wiring focus state without redoing it inline.
 */

/** Map a flat cell index to its (row, col) on the workpiece grid given
 *  `cellsPerRow`. Mirrors the convention used everywhere else on the
 *  page: row-major with the swatch's `row * cellsPerRow + col`. Returns
 *  `null` for non-finite or negative indices, or when `cellsPerRow` is
 *  not a positive integer. */
export function cellIndexToRowCol(
  cellIndex: number,
  cellsPerRow: number,
): { row: number; col: number } | null {
  if (!Number.isFinite(cellIndex) || cellIndex < 0) return null;
  if (!Number.isFinite(cellsPerRow) || cellsPerRow <= 0) return null;
  const ci = Math.floor(cellIndex);
  const cpr = Math.floor(cellsPerRow);
  return { row: Math.floor(ci / cpr), col: ci % cpr };
}

export function fmtTick(v: number): string {
  if (!Number.isFinite(v)) return "—";
  const abs = Math.abs(v);
  if (abs >= 100) return v.toFixed(0);
  if (abs >= 10) return v.toFixed(1);
  return v.toFixed(2);
}

export function formatYValue(v: number, unit: string): string {
  if (!Number.isFinite(v)) return "—";
  const abs = Math.abs(v);
  const decimals = abs >= 100 ? 1 : abs >= 10 ? 2 : 2;
  const sign = v > 0 ? "+" : "";
  const isAngle = unit === "deg";
  return `${sign}${v.toFixed(decimals)}${isAngle ? "°" : ""}`;
}

/* ─── Marginal histograms ─────────────────────────────────────────────────
 *
 * Build a fixed-bin density histogram across a numeric range. Used by the
 * scatter's bottom/right marginal strips to show where cells cluster on
 * each axis. Pure: takes the same axis bounds the chart already nicened
 * so bars line up with the plot area.
 */

export interface HistogramResult {
  /** One count per bin, length === binCount. */
  counts: number[];
  /** Bin width in axis units (max - min) / binCount. */
  binWidth: number;
  /** Largest count across all bins; useful for normalising bar heights. */
  maxCount: number;
}

/** Bin a stream of finite numbers into `binCount` equal-width buckets
 *  spanning `[min, max]`. Values exactly at `max` land in the last bin
 *  (closed-right edge). NaN/±Infinity entries are silently skipped so
 *  callers can pass the same un-filtered arrays the chart consumes.
 *  Values outside the range are also skipped — they shouldn't exist in
 *  practice (axis bounds enclose all plotted points), but this keeps
 *  the function defensive without polluting the edge bins. */
export function binHistogram(
  values: number[],
  min: number,
  max: number,
  binCount: number,
): HistogramResult {
  if (!Number.isFinite(min) || !Number.isFinite(max) || binCount <= 0) {
    return { counts: [], binWidth: 0, maxCount: 0 };
  }
  const counts = new Array<number>(binCount).fill(0);
  const range = max - min;
  if (range <= 0) {
    return { counts, binWidth: 0, maxCount: 0 };
  }
  const binWidth = range / binCount;
  for (const v of values) {
    if (!Number.isFinite(v)) continue;
    if (v < min || v > max) continue;
    let idx = Math.floor((v - min) / binWidth);
    if (idx >= binCount) idx = binCount - 1; // close the right edge
    if (idx < 0) idx = 0;
    counts[idx] += 1;
  }
  let maxCount = 0;
  for (const c of counts) if (c > maxCount) maxCount = c;
  return { counts, binWidth, maxCount };
}

/* ─── Reference lines (mean + binned trend) ───────────────────────────────
 *
 * Two summaries we draw on top of the dot cloud:
 *  - `seriesMeanY` collapses a series to one horizontal line so users can
 *    eyeball the systematic per-run shift (run 1 ran +10° hot, run 2 +8°).
 *  - `binnedMean` slices the X axis into equal-width buckets and averages
 *    Y inside each, producing a per-run trend trace. Bins with too few
 *    samples are returned with NaN so the renderer can break the line.
 */

/** Series mean Y. Skips NaN. Returns null if < 3 finite values — the
 *  caller treats that as "too noisy to draw confidently". */
export function seriesMeanY(values: number[]): number | null {
  let n = 0;
  let s = 0;
  for (const v of values) {
    if (!Number.isFinite(v)) continue;
    s += v;
    n += 1;
  }
  if (n < 3) return null;
  return s / n;
}

/** One bin in a binned-mean trend line. */
export interface BinnedMeanBin {
  /** Bin centre in axis units. */
  center: number;
  /** Number of points contributed to this bin. */
  n: number;
  /** Mean Y of the bin's points; NaN when n < 2 so the polyline can
   *  break across sparse regions instead of extrapolating. */
  mean: number;
}

/** Bin `(x, y)` pairs by X into `binCount` equal-width buckets spanning
 *  `[xMin, xMax]`. Returns one entry per bin in left-to-right order.
 *  Bins with fewer than 2 contributing points carry `mean = NaN` so the
 *  renderer can break the trend line across them; bins with no points
 *  also report `n = 0`. NaN coordinates and out-of-range X are skipped.
 *  Values exactly at `xMax` land in the last bin (closed-right edge). */
export function binnedMean(
  points: { x: number; y: number }[],
  xMin: number,
  xMax: number,
  binCount: number,
): BinnedMeanBin[] {
  if (!Number.isFinite(xMin) || !Number.isFinite(xMax) || binCount <= 0) {
    return [];
  }
  const range = xMax - xMin;
  if (range <= 0) return [];
  const binWidth = range / binCount;
  const sums = new Array<number>(binCount).fill(0);
  const counts = new Array<number>(binCount).fill(0);
  for (const p of points) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    if (p.x < xMin || p.x > xMax) continue;
    let idx = Math.floor((p.x - xMin) / binWidth);
    if (idx >= binCount) idx = binCount - 1;
    if (idx < 0) idx = 0;
    sums[idx] += p.y;
    counts[idx] += 1;
  }
  const out: BinnedMeanBin[] = [];
  for (let i = 0; i < binCount; i++) {
    const center = xMin + (i + 0.5) * binWidth;
    const n = counts[i];
    out.push({ center, n, mean: n < 2 ? NaN : sums[i] / n });
  }
  return out;
}

/* ─── Quadrant median-cross ───────────────────────────────────────────────
 *
 * When both axes are computed-per-cell metrics, the scatter draws faint
 * dashed reference lines at the median X and median Y across the
 * plotted points so the user can read each cell's quadrant at a
 * glance. Hidden below the minimum cell count to avoid wobbly lines.
 */

/** Minimum plotted-point count before the median-cross renders. Below
 *  this, the median is too noisy to anchor a reference line. */
export const MEDIAN_CROSS_MIN_POINTS = 4;

export interface MedianCrossResult {
  /** ``null`` when the input has fewer than ``MEDIAN_CROSS_MIN_POINTS``
   *  finite-on-both pairs — the caller hides the layer. */
  medianX: number | null;
  medianY: number | null;
  count: number;
}

/** Compute median X / median Y across (x, y) pairs, ignoring entries
 *  with non-finite coordinates. Returns ``null`` medians when fewer
 *  than ``MEDIAN_CROSS_MIN_POINTS`` pairs survive the finite filter so
 *  the scatter can hide the cross. Uses the lower-mid for even-length
 *  inputs (matches the existing ``median`` helper in
 *  ``stabilityStatsMath`` so chart and stats agree on the bisector). */
export function medianCross(
  pairs: readonly { x: number; y: number }[],
): MedianCrossResult {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const p of pairs) {
    if (Number.isFinite(p.x) && Number.isFinite(p.y)) {
      xs.push(p.x);
      ys.push(p.y);
    }
  }
  if (xs.length < MEDIAN_CROSS_MIN_POINTS) {
    return { medianX: null, medianY: null, count: xs.length };
  }
  return {
    medianX: medianOf(xs),
    medianY: medianOf(ys),
    count: xs.length,
  };
}

function medianOf(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}
