import type { BaseParams, HatchPassSpec, TestSpec, ValidationProfile } from "./types";

/** Pick a default value for one constraint that's guaranteed valid. */
function defaultForConstraint(
  _name: string,
  c: ValidationProfile[string] | undefined,
  fallback: number | string,
): number | string {
  if (!c) return fallback;
  switch (c.kind) {
    case "range": {
      if (typeof fallback === "number" && fallback >= c.min && fallback <= c.max) return fallback;
      return Math.round((c.min + c.max) / 2);
    }
    case "stepped": {
      if (c.values.includes(fallback)) return fallback;
      return c.values[Math.floor(c.values.length / 2)];
    }
    case "enum": {
      if (c.values.includes(fallback)) return fallback;
      return c.values[0];
    }
    case "not_applicable":
      // The form will hide the field; the value is irrelevant.
      return fallback;
  }
}

/** Default base params, optionally clamped to a validation profile.
 *  Without a profile (legacy callers), returns the historical defaults. */
export function defaultBaseParams(profile?: ValidationProfile): BaseParams {
  const legacyBase: BaseParams = {
    power: 14.6,
    speed: 1000,
    frequency: 125,
    density: 5000,
    passes: 1,
    pulse_width: 200,
    laser: "red",
    scan_angle: 90,
  };
  if (!profile) return legacyBase;
  return {
    power:       defaultForConstraint("power",       profile.power,       legacyBase.power)       as number,
    speed:       defaultForConstraint("speed",       profile.speed,       legacyBase.speed)       as number,
    frequency:   defaultForConstraint("frequency",   profile.frequency,   legacyBase.frequency)   as number,
    density:     defaultForConstraint("density",     profile.density,     legacyBase.density)     as number,
    passes:      defaultForConstraint("passes",      profile.passes,      legacyBase.passes)      as number,
    pulse_width: defaultForConstraint("pulse_width", profile.pulse_width, legacyBase.pulse_width) as number,
    laser:       defaultForConstraint("laser",       profile.laser,       legacyBase.laser)       as "red" | "blue",
    scan_angle:  90,
  };
}

export function defaultSpec(profile?: ValidationProfile): TestSpec {
  return {
    x_param: "speed", x_min: 500, x_max: 3000, x_steps: 10,
    y_param: null, y_min: null, y_max: null, y_steps: null,
    rows: 1, width_mm: 50, height_mm: 10, gap_mm: 0.5,
    cell_shape: "rect", square_cells: true, angle_mode: "fixed",
    unidirectional: false,
    hide_axis_labels: false,
    base_params: defaultBaseParams(profile),
    registration: { mode: "on", qr_size_mm: null, aruco_size_mm: null },
  };
}

// Keep DEFAULT_SPEC for legacy callers that don't have a profile yet.
export const DEFAULT_SPEC: TestSpec = defaultSpec();

export function defaultHatchPass(angle = 0): HatchPassSpec {
  // Default spacing = thickness so the hatched output is a continuous fill
  // out of the box. Increase spacing > thickness for visible gaps.
  return { angle, spacing: 0.1, thickness: 0.1, ramps: [] };
}
