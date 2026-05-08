import { hueDeg, chroma as chromaFn } from "../../color/math";
import { pearson } from "./exposureMath";
import type { LaserIndices } from "../PaletteIndicesChips";

/**
 * Row shape this module consumes. Matches the relevant fields of
 * PaletteEntry; the `id` and `hex` are included so callers can
 * trace cells back to their entry.
 */
export interface ExposureRow {
  id: number;
  hex: string;
  lab: [number, number, number];
  indices: LaserIndices;
  /** The raw laser params from PaletteEntry.params. Optional because
   *  not every consumer of ExposureRow needs them — ExposureFocusedCard
   *  does, the math helpers don't. */
  params?: Record<string, number | string>;
}

// `line_spacing_mm` is intentionally excluded — it stays NULL while
// density_model="opaque" and is redundant with `line_spacing_index`.
// Adding it here would require null-handling in buildCorrelationMatrix.
export const INDEX_ROWS = [
  "pulse_spacing_mm",
  "line_spacing_index",
  "pulse_energy_index",
  "pulse_intensity_index",
  "total_exposure_index",
  "ablation_aggression_index",
  "delivery_smoothness_index",
] as const satisfies readonly (keyof LaserIndices)[];
export type IndexRow = (typeof INDEX_ROWS)[number];

export const CHANNEL_COLS = [
  "L",
  "a",
  "b",
  "hue",
  "chroma",
] as const;
export type ChannelCol = (typeof CHANNEL_COLS)[number];

function channelValue(row: ExposureRow, col: ChannelCol): number {
  const [l, a, b] = row.lab;
  switch (col) {
    case "L":      return l;
    case "a":      return a;
    case "b":      return b;
    case "hue":    return hueDeg(a, b);
    case "chroma": return chromaFn(a, b);
  }
}

/**
 * Build the 7×5 Pearson |r| matrix of (index, channel). Rows with
 * `formula_version=0` are dropped (stale-backfill sentinel). NaN
 * cells indicate insufficient data or zero variance.
 */
export function buildCorrelationMatrix(
  rows: readonly ExposureRow[],
): number[][] {
  const valid = rows.filter((r) => r.indices.formula_version >= 1);
  return INDEX_ROWS.map((indexKey) => {
    const xs = valid.map((r) => (r.indices[indexKey] as number | null) ?? NaN);
    return CHANNEL_COLS.map((col) => {
      const ys = valid.map((r) => channelValue(r, col));
      return pearson(xs, ys);
    });
  });
}
