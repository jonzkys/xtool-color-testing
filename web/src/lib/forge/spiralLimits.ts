// web/src/lib/forge/spiralLimits.ts
// Interpret a machine ValidationProfile for the Spiral Test's sweepable params:
// clamp/snap a fixed value, resolve an axis to its swept values, and expose the
// discrete option list for stepped params (pulse width). Pure. Falls back to the
// param's app-level clamp when a param is unbound (geometry/focus) or the
// registry hasn't loaded yet.
import type { FieldConstraint, ValidationProfile } from "../../types";
import { clampToConstraint } from "../constraints";
import { ALLOWED_PULSE_WIDTHS } from "../../laser/pulseWidths";
import { PARAMS, resolveAxis, type AxisSpec, type ParamKey } from "./spiralParams";

/** The machine constraint for a param, or null when it's unbound (geometry/
 *  focus) or the profile hasn't loaded. */
export function constraintFor(profile: ValidationProfile | null, key: ParamKey): FieldConstraint | null {
  const field = PARAMS[key].profileField;
  if (!profile || !field) return null;
  return profile[field] ?? null;
}

/** Nearest value in `values` by absolute distance (ties → earlier value).
 *  Delegates to the canonical constraint snapper so there's one implementation. */
export function snapStepped(values: number[], v: number): number {
  return clampToConstraint(v, { kind: "stepped", values }) as number;
}

function steppedInRange(values: number[], lo: number, hi: number): number[] {
  const a = Math.min(lo, hi), b = Math.max(lo, hi);
  return values.filter((w) => w >= a && w <= b).sort((x, y) => x - y);
}

/** The discrete value set for a stepped param: the constraint's values, or the
 *  hard-coded pulse-width set as a loading fallback; null for non-stepped. Used
 *  by both resolveAxisValues and steppedValues so they never disagree on the
 *  null-profile (registry-loading) fallback. */
function steppedSetFor(profile: ValidationProfile | null, key: ParamKey): number[] | null {
  const c = constraintFor(profile, key);
  if (c?.kind === "stepped") return c.values as number[];
  if (key === "pulseWidth") return [...ALLOWED_PULSE_WIDTHS];
  return null;
}

/** Clamp/snap a value to the machine constraint, or the param's app clamp when
 *  unbound / loading. Machine constraints are coerced via the canonical
 *  clampToConstraint (range clamp+snap-from-min, stepped nearest) so this never
 *  diverges from the backend's validation. */
export function clampParam(profile: ValidationProfile | null, key: ParamKey, v: number): number {
  const c = constraintFor(profile, key);
  if (c) return clampToConstraint(v, c) as number;
  return PARAMS[key].clamp(v);
}

/** The swept values for an axis, machine-aware. */
export function resolveAxisValues(profile: ValidationProfile | null, key: ParamKey, axis: AxisSpec): number[] {
  const stepped = steppedSetFor(profile, key);
  if (stepped) {
    const inRange = steppedInRange(stepped, axis.min, axis.max);
    return inRange.length > 0 ? inRange : [snapStepped(stepped, (axis.min + axis.max) / 2)];
  }
  return resolveAxis(axis).map((v) => clampParam(profile, key, v));
}

/** Discrete option list for a stepped param (for a <Select>), sorted ascending;
 *  the pulse-width set is the loading fallback; null for non-stepped params. */
export function steppedValues(profile: ValidationProfile | null, key: ParamKey): number[] | null {
  const s = steppedSetFor(profile, key);
  return s ? s.slice().sort((a, b) => a - b) : null;
}
