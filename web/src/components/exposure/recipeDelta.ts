import type { ExposureRow } from "./exposureCorrelations";
import type { FilterableParam } from "./exposureFilters";

export interface Delta {
  /** The neighbour's value of this param (null when missing). */
  value: number | null;
  /** Neighbour − reference, in raw units. NULL when either value is missing. */
  abs: number | null;
  /** Percentage delta vs reference (positive when neighbour is greater).
   *  NULL when reference is 0 or either value is missing. */
  pct: number | null;
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

export function recipeDelta(
  reference: ExposureRow,
  neighbour: ExposureRow,
  param: FilterableParam,
): Delta {
  const ref = num(reference.params?.[param]);
  const val = num(neighbour.params?.[param]);
  if (val == null) return { value: null, abs: null, pct: null };
  if (ref == null) return { value: val, abs: null, pct: null };
  const abs = val - ref;
  const pct = ref === 0 ? null : (abs / ref) * 100;
  return { value: val, abs, pct };
}
