import {
  circularStatsDeg,
  deltaE76,
  hueDeg,
  wrapHueDelta,
  type Lab,
} from "../color/math";
import type { ValidationCell } from "../types";
import {
  perCellSigmaFor,
  type SeriesInput,
  type YAxis,
} from "./stabilityChartMath";
import { burnDeltaE, burnDeltaHue } from "./stabilityStatsMath";

/* ─── Heatmap metric vocabulary ────────────────────────────────────────── */

/** Subset of YAxis values that render meaningfully on a per-cell heatmap.
 *  Reuses YAxis IDs so the page can share state between scatter + spatial
 *  modes without translating. Diverging metrics (ΔL/Δa/Δb/Δh°) anchor at
 *  zero and use a cool→cream→warm ramp; magnitude metrics (ΔE, σ) use a
 *  cream→amber→destructive ramp. */
export type HeatmapMetric =
  | "delta_e"
  | "delta_l"
  | "delta_a"
  | "delta_b"
  | "delta_hue"
  | "per_cell_sigma"
  | "burn_delta_e"
  | "burn_delta_hue";

const HEATMAP_METRIC_SET: ReadonlySet<HeatmapMetric> = new Set<HeatmapMetric>([
  "delta_e",
  "delta_l",
  "delta_a",
  "delta_b",
  "delta_hue",
  "per_cell_sigma",
  "burn_delta_e",
  "burn_delta_hue",
]);

/** Burn-aware metrics need ≥2 runs to be meaningful (the per-cell mean
 *  is the burn-true estimate; with one run there's nothing to average).
 *  ``per_cell_sigma`` is the existing tenant of the same constraint. */
export function requiresMultiRun(metric: HeatmapMetric): boolean {
  return (
    metric === "per_cell_sigma" ||
    metric === "burn_delta_e" ||
    metric === "burn_delta_hue"
  );
}

/** Filter the scatter's full Y-axis list down to metrics meaningful on
 *  a heatmap. The rest (measured channel positions, etc.) make no sense
 *  per-cell since each cell already has one expected value — there's
 *  nothing to compare across. */
export function isHeatmapMetric(y: YAxis): y is HeatmapMetric {
  return HEATMAP_METRIC_SET.has(y as HeatmapMetric);
}

/** Diverging metrics centre on zero (negative = cool, positive = warm).
 *  Magnitude metrics ramp cream → amber → destructive. Driver for ramp
 *  selection in `cellTint`. */
export function isDivergingMetric(metric: HeatmapMetric): boolean {
  return (
    metric === "delta_l" ||
    metric === "delta_a" ||
    metric === "delta_b" ||
    metric === "delta_hue" ||
    metric === "burn_delta_hue"
  );
}

/* ─── Per-cell aggregation ─────────────────────────────────────────────── */

/** Per-grid-position summary used by the heatmap. `value` is the chosen
 *  metric averaged across the selected runs (signed for diverging
 *  metrics, magnitude otherwise); `null` when no run sampled the cell or
 *  the metric requires ≥2 runs and we have fewer. */
export interface HeatmapCell {
  cellIndex: number;
  row: number;
  col: number;
  expectedHex: string;
  expectedLab: Lab;
  /** Per-result measured Lab + hex aligned with `series` order. `null`
   *  for runs that didn't sample this cell. */
  measured: ({ hex: string; lab: Lab } | null)[];
  /** Aggregated metric value to colour the cell by. NaN when the metric
   *  can't be computed (e.g. σ with <2 runs or no measurements). */
  value: number;
  /** σ across runs; cached on every cell so the tooltip can show it
   *  alongside the metric without recomputing. */
  sigma: number;
}

/** Build one entry per validation cell. Empty grid positions (when
 *  cell_count < rows × cols) are simply absent — the renderer hatches
 *  any (row, col) without an entry. */
export function buildHeatmapCells(
  cells: ValidationCell[],
  series: SeriesInput[],
  metric: HeatmapMetric,
  cellsPerRow: number,
): HeatmapCell[] {
  const out: HeatmapCell[] = [];
  for (const c of cells) {
    const expArr = c.expected_lab;
    if (!Array.isArray(expArr) || expArr.length !== 3) continue;
    const expected: Lab = [expArr[0], expArr[1], expArr[2]];
    const measured = series.map((s) => s.cells.get(c.cell_index) ?? null);

    const sigma = perCellSigmaFor(c.cell_index, series);
    const value = aggregateMetric(metric, expected, measured, sigma);

    out.push({
      cellIndex: c.cell_index,
      row: Math.floor(c.cell_index / cellsPerRow),
      col: c.cell_index % cellsPerRow,
      expectedHex: c.expected_hex,
      expectedLab: expected,
      measured,
      value,
      sigma,
    });
  }
  return out;
}

function aggregateMetric(
  metric: HeatmapMetric,
  expected: Lab,
  measured: ({ hex: string; lab: Lab } | null)[],
  sigma: number,
): number {
  if (metric === "per_cell_sigma") {
    // σ is meaningful only when ≥2 runs sampled the cell.
    let n = 0;
    for (const m of measured) if (m) n++;
    return n >= 2 ? sigma : NaN;
  }
  if (metric === "burn_delta_e" || metric === "burn_delta_hue") {
    // Burn-true axes need ≥2 runs to be a real estimate of the burn —
    // a single run still falls under the per-run aggregator below
    // (which would just echo that one ΔE / Δh°).
    let n = 0;
    const labs: Lab[] = [];
    for (const m of measured) {
      if (!m) continue;
      labs.push(m.lab);
      n += 1;
    }
    if (n < 2) return NaN;
    const v =
      metric === "burn_delta_e"
        ? burnDeltaE(labs, expected)
        : burnDeltaHue(labs, expected);
    return v == null ? NaN : v;
  }
  // Mean across runs that sampled this cell. Hue is cyclic: a run pair
  // straddling the seam (e.g. [+179, -179]) is visually identical, but
  // arithmetic mean would land at 0 and lie about how off-target the
  // cell is. Route delta_hue through the circular mean.
  const vals: number[] = [];
  for (const m of measured) {
    if (!m) continue;
    const v = singleResultMetric(metric, expected, m.lab);
    if (Number.isFinite(v)) vals.push(v);
  }
  if (vals.length === 0) return NaN;
  if (metric === "delta_hue") {
    const stats = circularStatsDeg(vals, true);
    return stats ? stats.mean : NaN;
  }
  let acc = 0;
  for (const v of vals) acc += v;
  return acc / vals.length;
}

function singleResultMetric(
  metric: HeatmapMetric,
  exp: Lab,
  measured: Lab,
): number {
  switch (metric) {
    case "delta_e":
      return deltaE76(exp, measured);
    case "delta_l":
      return measured[0] - exp[0];
    case "delta_a":
      return measured[1] - exp[1];
    case "delta_b":
      return measured[2] - exp[2];
    case "delta_hue":
      return wrapHueDelta(
        hueDeg(measured[1], measured[2]) - hueDeg(exp[1], exp[2]),
      );
    case "per_cell_sigma":
    case "burn_delta_e":
    case "burn_delta_hue":
      // The aggregator owns these — σ is a series-level value, burn-*
      // are over the per-cell mean.
      return NaN;
  }
}

/* ─── Range computation ────────────────────────────────────────────────── */

export interface HeatmapRange {
  /** Symmetric magnitude for diverging metrics (so 0 stays cream).
   *  For magnitude metrics, the chart-side max. */
  max: number;
  /** Always 0 for magnitude metrics; -max for diverging. */
  min: number;
}

/** Compute the colour-ramp domain. Diverging metrics symmetrise around 0
 *  so the cream anchor stays put even when the data leans one way (e.g.
 *  every cell has a positive Δh°). Magnitude metrics anchor at 0. The
 *  caller passes a sensible floor so a near-flat dataset still has a
 *  visible spread instead of one near-saturated cell. */
export function computeHeatmapRange(
  values: number[],
  metric: HeatmapMetric,
  floor: number,
): HeatmapRange {
  let max = 0;
  for (const v of values) {
    if (!Number.isFinite(v)) continue;
    const abs = Math.abs(v);
    if (abs > max) max = abs;
  }
  if (max < floor) max = floor;
  if (isDivergingMetric(metric)) {
    return { min: -max, max };
  }
  return { min: 0, max };
}

/** Reasonable display floors per metric so the ramp never collapses to a
 *  single colour on near-perfect runs. ΔE 1 is "barely perceptible";
 *  Δh° 5° is the threshold a casual eye picks up. */
export function defaultFloor(metric: HeatmapMetric): number {
  switch (metric) {
    case "delta_e":
    case "burn_delta_e":
      return 1;
    case "delta_l":
    case "delta_a":
    case "delta_b":
      return 2;
    case "delta_hue":
    case "burn_delta_hue":
      return 5;
    case "per_cell_sigma":
      return 1;
  }
}

/* ─── Colour ramps ─────────────────────────────────────────────────────── */

/** Magnitude ramp: low (cream) → mid (warning amber) → high (destructive
 *  red). Anchors are CSS variables so dark mode flips automatically.
 *  Returns a `var(...)` mix or a fixed CSS variable reference; never a
 *  raw colour, so the surface stays cohesive with the rest of the page.
 *
 *  `t` is clamped to [0, 1]. We use `color-mix` so the gradient breathes
 *  rather than picking discrete stops — three CSS-variable anchors give
 *  the ramp two halves: cream→amber for the low half, amber→red for the
 *  high half. */
export function magnitudeRampCss(t: number): string {
  const c = clamp01(t);
  if (c <= 0.5) {
    const sub = c * 2 * 100;
    return `color-mix(in srgb, var(--color-surface) ${(100 - sub).toFixed(2)}%, var(--color-warning) ${sub.toFixed(2)}%)`;
  }
  const sub = (c - 0.5) * 2 * 100;
  return `color-mix(in srgb, var(--color-warning) ${(100 - sub).toFixed(2)}%, var(--color-destructive) ${sub.toFixed(2)}%)`;
}

/** Diverging ramp: cool (secondary blue) at -1, cream (surface) at 0,
 *  warm (warning amber) at +1. `t` is the signed normalised value
 *  clamped to [-1, 1]. The cream centre lets the user's eye pick "this
 *  cell is roughly perfect" out of the grid without thinking. */
export function divergingRampCss(t: number): string {
  const c = clampSigned(t);
  if (c <= 0) {
    const sub = (-c) * 100;
    return `color-mix(in srgb, var(--color-surface) ${(100 - sub).toFixed(2)}%, var(--color-secondary) ${sub.toFixed(2)}%)`;
  }
  const sub = c * 100;
  return `color-mix(in srgb, var(--color-surface) ${(100 - sub).toFixed(2)}%, var(--color-warning) ${sub.toFixed(2)}%)`;
}

/** Resolve a cell's tint string given the metric, value, and computed
 *  range. Returns a CSS colour expression or `null` when the value is
 *  not finite (caller renders the unsampled hatch instead). */
export function cellTintCss(
  metric: HeatmapMetric,
  value: number,
  range: HeatmapRange,
): string | null {
  if (!Number.isFinite(value)) return null;
  if (isDivergingMetric(metric)) {
    if (range.max <= 0) return divergingRampCss(0);
    return divergingRampCss(value / range.max);
  }
  if (range.max <= 0) return magnitudeRampCss(0);
  return magnitudeRampCss(value / range.max);
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  if (v <= 0) return 0;
  if (v >= 1) return 1;
  return v;
}

function clampSigned(v: number): number {
  if (!Number.isFinite(v)) return 0;
  if (v <= -1) return -1;
  if (v >= 1) return 1;
  return v;
}

/** Normalised (clamped) [0, 1] position on the magnitude ramp; useful
 *  for tests that don't want to parse a CSS string. */
export function magnitudeRampT(value: number, max: number): number {
  if (!Number.isFinite(value) || max <= 0) return 0;
  return clamp01(value / max);
}

/** Normalised (clamped) [-1, 1] position on the diverging ramp; useful
 *  for tests. */
export function divergingRampT(value: number, max: number): number {
  if (!Number.isFinite(value) || max <= 0) return 0;
  return clampSigned(value / max);
}

/* ─── Grid sizing ──────────────────────────────────────────────────────── */

/** Number of physical rows required to hold every cell index. Falls back
 *  to 1 when the test has no cells. */
export function inferPhysicalRows(
  cellCount: number,
  cellsPerRow: number,
): number {
  if (cellsPerRow <= 0) return 1;
  if (cellCount <= 0) return 1;
  return Math.ceil(cellCount / cellsPerRow);
}
