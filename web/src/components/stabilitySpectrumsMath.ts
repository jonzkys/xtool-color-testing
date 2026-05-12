import { chroma, circularStatsDeg, hueDeg, labToHex, type Lab } from "../color/math";
import type { ValidationCell } from "../types";
import {
  computeComputedXValue,
  computeYValue,
  isComputedYAxis,
  perCellSigmaFor,
  type SeriesInput,
  type YAxis,
} from "./stabilityChartMath";

/* ─── Spectrums-mode math ────────────────────────────────────────────────
 *
 * Per-cell {min, max, mean, expected} for the SPECTRUMS view. Each cell
 * gets a vertical mini-spectrum drawn from `min` to `max` with a dot at
 * `mean`; computed-per-cell metrics (BURN ΔE, BURN Δh°, CAMERA σ)
 * collapse to a single value (mean only — min/max equal mean).
 */

export type SpectrumOrder =
  | "expected_hue"
  | "expected_l"
  | "expected_chroma"
  | "cell_index"
  | "range";

export interface SpectrumOrderMeta {
  id: SpectrumOrder;
  /** Pill label, mono-uppercase. */
  short: string;
  /** Long-form heading for axis-label band. */
  label: string;
}

export const SPECTRUM_ORDERS: readonly SpectrumOrderMeta[] = [
  { id: "expected_hue", short: "EXP h°", label: "Expected hue" },
  { id: "expected_l", short: "EXP L*", label: "Expected L*" },
  { id: "expected_chroma", short: "EXP C*", label: "Expected chroma" },
  { id: "cell_index", short: "CELL #", label: "Cell index" },
  { id: "range", short: "RANGE", label: "Range (max − min)" },
] as const;

/** Per-cell summary for one entry on the spectrums strip. ``null`` fields
 *  mean we couldn't produce a finite value (e.g. burn-Δh° below the
 *  chroma gate, σ with <2 runs). The renderer treats null as a hidden
 *  bar / dot rather than a phantom dot at zero. */
export interface CellSpectrum {
  cellIndex: number;
  expectedLab: Lab;
  expectedHex: string;
  /** The cell's expected value for the active metric. ``null`` for
   *  metrics that aren't expected-comparable (e.g. CAMERA σ has no
   *  expected). */
  expected: number | null;
  /** Range across selected runs. Equal to ``mean`` when the metric is
   *  computed-per-cell (BURN ΔE, BURN Δh°, CAMERA σ). */
  min: number | null;
  max: number | null;
  /** Centroid of the per-run measurements at this cell, or the single
   *  computed value for computed metrics. */
  mean: number | null;
  /** Number of finite per-run measurements that contributed. */
  count: number;
  /** σ across runs (RMS Lab distance from centroid). Cached for the
   *  hover card. */
  sigma: number;
  /** Mean Lab across the selected runs (one entry per cell). ``null``
   *  when no runs are selected or none had a measurement for this
   *  cell. Computed regardless of the active metric so propose-test
   *  visuals can swap from the (anchor-coloured) expected swatch to
   *  the measured-mean swatch. */
  meanLab: Lab | null;
  /** Hex form of ``meanLab`` for convenient swatch rendering. ``null``
   *  when ``meanLab`` is null. */
  meanHex: string | null;
}

export interface SortKey {
  /** Numeric key the renderer sorts by; cells with non-finite keys land
   *  at the end so they don't collapse the live cells' positions. */
  key: number;
  /** Stable tie-breaker. */
  cellIndex: number;
}

/** Produce the per-cell summary for every supplied validation cell.
 *  Cells whose expected_lab is malformed are skipped (matches the
 *  scatter / heatmap behaviour). */
export function perCellRange(
  cells: ValidationCell[],
  series: SeriesInput[],
  metric: YAxis,
): CellSpectrum[] {
  const out: CellSpectrum[] = [];
  const computed = isComputedYAxis(metric);
  for (const c of cells) {
    const expArr = c.expected_lab as Lab | number[];
    if (!Array.isArray(expArr) || expArr.length !== 3) continue;
    const expected: Lab = [expArr[0], expArr[1], expArr[2]];

    const labs: Lab[] = [];
    for (const s of series) {
      const m = s.cells.get(c.cell_index);
      if (m) labs.push(m.lab);
    }

    const sigma = perCellSigmaFor(c.cell_index, series);

    let min: number | null = null;
    let max: number | null = null;
    let mean: number | null = null;
    let count = 0;

    if (computed) {
      // BURN ΔE / BURN Δh° / CAMERA σ — one number per cell. Route via
      // the shared ``computeComputedXValue`` helper so the spectrums
      // view uses the exact same math as the scatter's computed-X axis.
      let v: number | null;
      if (metric === "per_cell_sigma") {
        v = labs.length >= 2 ? sigma : null;
      } else if (metric === "burn_delta_e") {
        v = computeComputedXValue("burn_delta_e", expected, labs);
      } else {
        v = computeComputedXValue("burn_delta_hue", expected, labs);
      }
      if (v != null && Number.isFinite(v)) {
        mean = v;
        min = v;
        max = v;
        count = labs.length;
      } else {
        count = labs.length;
      }
    } else {
      // Per-run metric — gather one value per run and compute min/max/mean.
      const ys: number[] = [];
      for (const lab of labs) {
        const y = computeYValue(metric, expected, lab, sigma);
        if (Number.isFinite(y)) ys.push(y);
      }
      count = ys.length;
      if (ys.length > 0) {
        // Hue is cyclic: a run pair straddling the seam (e.g. [+179,
        // -179]) is *visually identical*, but arithmetic mean/min/max
        // would report mean=0 and a bar that spans the whole axis.
        // Route hue-cyclic metrics through circular statistics; every
        // other metric uses straight arithmetic.
        const cyclic = metric === "delta_hue" || metric === "measured_hue";
        if (cyclic) {
          const stats = circularStatsDeg(
            ys,
            metric === "delta_hue",  // signed for Δ, unsigned [0,360) for raw hue
          );
          if (stats) {
            mean = stats.mean;
            min = stats.min;
            max = stats.max;
          }
        } else {
          let lo = Infinity;
          let hi = -Infinity;
          let sum = 0;
          for (const y of ys) {
            if (y < lo) lo = y;
            if (y > hi) hi = y;
            sum += y;
          }
          min = lo;
          max = hi;
          mean = sum / ys.length;
        }
      }
    }

    const expectedValue = expectedFor(metric, expected);

    // Per-cell mean Lab — computed once across the gathered measurements
    // regardless of the active metric. Lets the visual swatch swap from
    // anchor-coloured ``expected_hex`` to the actual measured-mean
    // swatch for propose-test entries where every cell shares the
    // anchor's expected. Requires at least one finite Lab.
    let meanLab: Lab | null = null;
    let meanHex: string | null = null;
    if (labs.length > 0) {
      let sl = 0, sa = 0, sb = 0;
      for (const lab of labs) { sl += lab[0]; sa += lab[1]; sb += lab[2]; }
      meanLab = [sl / labs.length, sa / labs.length, sb / labs.length];
      meanHex = labToHex(meanLab);
    }

    out.push({
      cellIndex: c.cell_index,
      expectedLab: expected,
      expectedHex: c.expected_hex,
      expected: expectedValue,
      min,
      max,
      mean,
      count,
      sigma,
      meanLab,
      meanHex,
    });
  }
  return out;
}

/** Sort the per-cell spectrums by the chosen ordering. Returns a copy;
 *  caller keeps the original around for cross-reference. Cells whose
 *  sort key is non-finite (e.g. range-by-bar but no measurements) sift
 *  to the end so the live ones cluster on the chosen end. */
export function sortSpectrums(
  spectrums: readonly CellSpectrum[],
  order: SpectrumOrder,
): CellSpectrum[] {
  const keyed: { spectrum: CellSpectrum; key: SortKey }[] = spectrums.map(
    (s) => ({ spectrum: s, key: { key: sortKey(order, s), cellIndex: s.cellIndex } }),
  );
  keyed.sort((a, b) => {
    const aFinite = Number.isFinite(a.key.key);
    const bFinite = Number.isFinite(b.key.key);
    if (aFinite && !bFinite) return -1;
    if (!aFinite && bFinite) return 1;
    if (aFinite && bFinite && a.key.key !== b.key.key) {
      return a.key.key - b.key.key;
    }
    return a.key.cellIndex - b.key.cellIndex;
  });
  return keyed.map((k) => k.spectrum);
}

function sortKey(order: SpectrumOrder, s: CellSpectrum): number {
  switch (order) {
    case "expected_hue":
      return hueDeg(s.expectedLab[1], s.expectedLab[2]);
    case "expected_l":
      return s.expectedLab[0];
    case "expected_chroma":
      return chroma(s.expectedLab[1], s.expectedLab[2]);
    case "cell_index":
      return s.cellIndex;
    case "range": {
      if (s.min == null || s.max == null) return Number.NaN;
      return s.max - s.min;
    }
  }
}

/** The cell's expected value for the active metric. Returns ``null``
 *  for metrics whose expected position is "perfect" (every Δ-axis is
 *  zero) — the renderer draws the expected tick at zero in that case
 *  via a separate path so this value can stay semantically clean. */
function expectedFor(metric: YAxis, expected: Lab): number | null {
  switch (metric) {
    case "delta_e":
    case "delta_l":
    case "delta_a":
    case "delta_b":
    case "delta_hue":
    case "delta_from_mean":
    case "burn_delta_e":
    case "burn_delta_hue":
      // Every Δ-axis has expected = 0 by definition.
      return 0;
    case "per_cell_sigma":
      // σ across runs has no "expected" — perfect repeatability is 0 σ.
      return 0;
    case "measured_l":
      return expected[0];
    case "measured_a":
      return expected[1];
    case "measured_b":
      return expected[2];
    case "measured_chroma":
      return chroma(expected[1], expected[2]);
    case "measured_hue":
      return hueDeg(expected[1], expected[2]);
  }
}

/** Compute axis bounds across the populated spectrums. Honours a
 *  preferred range (e.g. [0, 360] for hue). Returns ``null`` when no
 *  cell has data at all. The renderer routes this into the same
 *  ``niceBounds`` register the scatter uses, but for the SPECTRUMS view
 *  we need to consider min/max/mean/expected together, so this helper
 *  walks every observable point per cell. */
export function spectrumValueExtent(
  spectrums: readonly CellSpectrum[],
): { min: number; max: number } | null {
  let lo = Infinity;
  let hi = -Infinity;
  for (const s of spectrums) {
    for (const v of [s.min, s.max, s.mean, s.expected]) {
      if (v == null || !Number.isFinite(v)) continue;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return null;
  return { min: lo, max: hi };
}
