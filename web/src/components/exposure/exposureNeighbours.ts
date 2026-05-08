import { deltaE76 } from "../../color/math";
import type { ExposureRow } from "./exposureCorrelations";

export interface Neighbour {
  row: ExposureRow;
  distance: number;
}

/**
 * Return the N nearest palette entries to `anchor` by ΔE76 colour distance
 * (Euclidean distance in Lab space). The anchor itself is excluded even if
 * it appears in `candidates`.
 */
export function nearestByDeltaE(
  anchor: ExposureRow,
  candidates: readonly ExposureRow[],
  n: number,
): Neighbour[] {
  const others = candidates.filter((r) => r.id !== anchor.id);
  const scored = others.map((r) => ({
    row: r,
    distance: deltaE76(anchor.lab, r.lab),
  }));
  scored.sort((a, b) => a.distance - b.distance);
  return scored.slice(0, n);
}

/**
 * Return the N nearest palette entries to `anchor` by log-space distance in
 * (total_exposure_index, pulse_intensity_index). Distances in log₁₀ decades
 * so one decade on each axis = distance √2. The anchor itself is excluded
 * even if it appears in `candidates`.
 */
export function nearestByRegime(
  anchor: ExposureRow,
  candidates: readonly ExposureRow[],
  n: number,
): Neighbour[] {
  const others = candidates.filter((r) => r.id !== anchor.id);
  const ax = Math.log10(Math.max(1e-9, anchor.indices.total_exposure_index));
  const ay = Math.log10(Math.max(1e-9, anchor.indices.pulse_intensity_index));
  const scored = others.map((r) => {
    const x = Math.log10(Math.max(1e-9, r.indices.total_exposure_index));
    const y = Math.log10(Math.max(1e-9, r.indices.pulse_intensity_index));
    const distance = Math.hypot(x - ax, y - ay);
    return { row: r, distance };
  });
  scored.sort((a, b) => a.distance - b.distance);
  return scored.slice(0, n);
}
