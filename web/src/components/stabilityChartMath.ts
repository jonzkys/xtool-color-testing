import {
  chroma,
  deltaE76,
  hueDeg,
  wrapHueDelta,
  type Lab,
} from "../color/math";

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
  | "cell_index";

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
  | "per_cell_sigma";

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
] as const;

export const Y_AXES: readonly AxisMeta[] = [
  { id: "delta_hue", label: "Δ hue", short: "Δh°", unit: "deg" },
  { id: "delta_e", label: "ΔE76", short: "ΔE", unit: "ΔE" },
  { id: "delta_l", label: "ΔL", short: "ΔL", unit: "ΔL" },
  { id: "delta_a", label: "Δa", short: "Δa", unit: "Δa" },
  { id: "delta_b", label: "Δb", short: "Δb", unit: "Δb" },
  { id: "measured_hue", label: "Measured hue", short: "h°", unit: "deg" },
  { id: "measured_l", label: "Measured L*", short: "L*", unit: "L*" },
  { id: "measured_a", label: "Measured a*", short: "a*", unit: "a*" },
  { id: "measured_b", label: "Measured b*", short: "b*", unit: "b*" },
  { id: "measured_chroma", label: "Measured chroma", short: "C*", unit: "C*" },
  { id: "per_cell_sigma", label: "Per-cell σ (across runs)", short: "σ", unit: "ΔE" },
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
  }
}

export function computeYValue(
  axis: YAxis,
  exp: Lab,
  measured: Lab,
  perCellSigma: number,
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
    case "per_cell_sigma":  return perCellSigma;
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
