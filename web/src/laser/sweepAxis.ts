import { allowedPulseWidthsInRange, snapPulseWidth } from "./pulseWidths";

/**
 * The concrete per-cell values along a sweep axis — what the generator
 * actually burns into each cell.
 *
 * Most params are a linear ramp from ``lo`` to ``hi``. ``pulse_width``
 * is not: the MOPA only accepts a preset list, so the axis steps through
 * the presets inside ``[lo, hi]`` — the first ``steps`` of them — and
 * can come back shorter than ``steps``.
 *
 * Mirrors ``xcs_gen.generators._axis_values``; keep the two in sync.
 */
export function sweepAxisValues(
  param: string, lo: number, hi: number, steps: number,
): number[] {
  if (param === "pulse_width") {
    const allowed = allowedPulseWidthsInRange(lo, hi);
    if (allowed.length === 0) return [snapPulseWidth(lo)];
    return allowed.slice(0, steps);
  }
  if (steps <= 1) return [lo];
  const step = (hi - lo) / (steps - 1);
  return Array.from({ length: steps }, (_, i) => lo + i * step);
}
