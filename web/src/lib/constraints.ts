import type { FieldConstraint, ValidationProfile } from "../types";

/** Snap `v` to the nearest step increment from `min`. */
export function snapToStep(v: number, step: number, min: number): number {
  if (step <= 0) return v;
  return min + Math.round((v - min) / step) * step;
}

/**
 * Coerce one value so it satisfies one constraint. Returns the coerced value.
 * Mirrors the backend's validate_against_profile coercion (xcs_gen.machines):
 *  - range:          clamp to [min,max], snap to step when step >= 1
 *  - stepped:        nearest allowed value (numeric distance), else first
 *  - enum:           value if allowed, else the first allowed value
 *  - not_applicable: value unchanged (callers drop it; see coerceParams)
 */
export function clampToConstraint(
  value: number | string,
  c: FieldConstraint,
): number | string {
  switch (c.kind) {
    case "range": {
      const n = typeof value === "number" ? value : parseFloat(String(value));
      if (!Number.isFinite(n)) return c.min;
      const snapped = c.step && c.step >= 1 ? snapToStep(n, c.step, c.min) : n;
      return Math.max(c.min, Math.min(c.max, snapped));
    }
    case "stepped": {
      if (c.values.some((v) => v === value)) return value;
      const target = typeof value === "number" ? value : parseFloat(String(value));
      if (Number.isFinite(target) && c.values.every((v) => typeof v === "number")) {
        let best = c.values[0] as number;
        let bestDist = Math.abs(target - best);
        for (const v of c.values as number[]) {
          const d = Math.abs(target - v);
          if (d < bestDist) { best = v; bestDist = d; }
        }
        return best;
      }
      return c.values[0];
    }
    case "enum":
      return c.values.some((v) => v === value) ? value : c.values[0];
    case "not_applicable":
      return value;
  }
}

/**
 * Coerce a whole param dict against a profile, mirroring the backend:
 *  - fields the profile marks not_applicable are DROPPED from the output
 *  - fields the profile doesn't mention are passed through unchanged
 *  - everything else is run through clampToConstraint
 * `changed` records field -> [original, coerced] for any value that moved.
 */
export function coerceParams(
  profile: ValidationProfile,
  values: Record<string, number | string>,
): {
  values: Record<string, number | string>;
  changed: Record<string, [number | string, number | string]>;
} {
  const out: Record<string, number | string> = {};
  const changed: Record<string, [number | string, number | string]> = {};
  for (const [field, v] of Object.entries(values)) {
    const c = profile[field];
    if (!c) { out[field] = v; continue; }
    if (c.kind === "not_applicable") continue;
    const coerced = clampToConstraint(v, c);
    out[field] = coerced;
    if (coerced !== v) changed[field] = [v, coerced];
  }
  return { values: out, changed };
}
