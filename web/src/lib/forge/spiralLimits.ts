// web/src/lib/forge/spiralLimits.ts
// Interpret a machine ValidationProfile for the Spiral Test's sweepable params:
// clamp/snap a fixed value, resolve an axis to its swept values, and expose the
// discrete option list for stepped params (pulse width). Pure. Falls back to the
// param's app-level clamp when a param is unbound (geometry/focus) or the
// registry hasn't loaded yet.
import type { FieldConstraint, ValidationProfile } from "../../types";
import { ALLOWED_PULSE_WIDTHS } from "../../laser/pulseWidths";
import { PARAMS, resolveAxis, type AxisSpec, type ParamKey } from "./spiralParams";

const clampN = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** The machine constraint for a param, or null when it's unbound (geometry/
 *  focus) or the profile hasn't loaded. */
export function constraintFor(profile: ValidationProfile | null, key: ParamKey): FieldConstraint | null {
  const field = PARAMS[key].profileField;
  if (!profile || !field) return null;
  return profile[field] ?? null;
}

/** Nearest value in `values` by absolute distance. */
export function snapStepped(values: number[], v: number): number {
  let best = values[0];
  let bestD = Math.abs(v - best);
  for (const w of values) {
    const d = Math.abs(v - w);
    if (d < bestD) { best = w; bestD = d; }
  }
  return best;
}

function steppedInRange(values: number[], lo: number, hi: number): number[] {
  const a = Math.min(lo, hi), b = Math.max(lo, hi);
  return values.filter((w) => w >= a && w <= b).sort((x, y) => x - y);
}

/** Clamp/snap a value to the machine constraint, or the param's app clamp when
 *  unbound / loading. */
export function clampParam(profile: ValidationProfile | null, key: ParamKey, v: number): number {
  const c = constraintFor(profile, key);
  if (c?.kind === "range") {
    const step = c.step && c.step > 0 ? c.step : 1;
    return clampN(Math.round(v / step) * step, c.min, c.max);
  }
  if (c?.kind === "stepped") return snapStepped(c.values as number[], v);
  return PARAMS[key].clamp(v);
}

/** The swept values for an axis, machine-aware. */
export function resolveAxisValues(profile: ValidationProfile | null, key: ParamKey, axis: AxisSpec): number[] {
  const c = constraintFor(profile, key);
  if (c?.kind === "stepped") {
    const vals = c.values as number[];
    const inRange = steppedInRange(vals, axis.min, axis.max);
    return inRange.length > 0 ? inRange : [snapStepped(vals, (axis.min + axis.max) / 2)];
  }
  return resolveAxis(axis).map((v) => clampParam(profile, key, v));
}

/** Discrete option list for a stepped param (for a <Select>), sorted ascending;
 *  the pulse-width set is the loading fallback; null for non-stepped params. */
export function steppedValues(profile: ValidationProfile | null, key: ParamKey): number[] | null {
  const c = constraintFor(profile, key);
  if (c?.kind === "stepped") return (c.values as number[]).slice().sort((a, b) => a - b);
  if (key === "pulseWidth") return [...ALLOWED_PULSE_WIDTHS];
  return null;
}
