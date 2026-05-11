/**
 * Frontend port of xcs_gen.laser_indices.compute_indices (formula v6).
 *
 * Field-naming bridge: BaseParams (web schema) uses `passes` and
 * `pulse_width`; ProcessingParams (xcs_gen domain) uses `repeat` and
 * `pw`. This port operates on the BaseParams shape — its inputs are
 * `power, speed, frequency, density, passes, pulse_width` — and the
 * formulas use those names internally.
 *
 * v6 change vs. v5: new `duty_cycle_index` = `frequency × pulse_width
 * ÷ 10000`, expressed as a percentage 0–100 (= laser-on time ÷ pulse
 * period). Pure (freq, pw) function — independent of power calibration.
 *
 * v5 change vs. v4: `total_exposure_index` now factors `frequency`
 * linearly — `power * freq * density * effectivePasses / speed`. On
 * MOPA at fixed controller-%, avg optical power scales with pulse
 * rate, so total delivered energy per cell scales with freq.
 * `ablation_aggression_index` and `delivery_smoothness_index` inherit
 * the change because they're derived from TEi. Per-pulse indices are
 * unaffected.
 *
 * v4 change vs. v3: ``crosshatch=true`` doubles the effective passes
 * fed into the three pass-dependent indices (TEi, AAi, DSi).
 */

export interface LaserParams {
  power: number;        // controller %, 0-100
  speed: number;        // mm/s
  frequency: number;    // kHz (mopa_frequency)
  density: number;      // lines per cm (lpc)
  passes: number;       // ProcessingParams.repeat
  pulse_width: number;  // ns (ProcessingParams.pw)
}

export interface LaserIndices {
  pulse_spacing_mm: number;
  line_spacing_mm: number;
  pulse_energy_index: number;
  pulse_intensity_index: number;
  total_exposure_index: number;
  ablation_aggression_index: number;
  delivery_smoothness_index: number;
  duty_cycle_index: number;
  formula_version: 6;
}

export interface ComputeIndicesOptions {
  /** Set true when the burning test had ``crosshatch`` enabled.
   *  Effective passes = passes × 2; affects TEi, AAi, DSi only. */
  crosshatch?: boolean;
}

export const INDICES_FORMULA_VERSION = 6 as const;

export function computeIndices(
  params: LaserParams,
  opts?: ComputeIndicesOptions,
): LaserIndices {
  const { power, speed, frequency, density, passes, pulse_width } = params;

  if (speed === 0) throw new Error("speed must be non-zero to compute laser indices");
  if (frequency === 0) throw new Error("frequency must be non-zero to compute laser indices");
  if (density === 0) throw new Error("density must be non-zero to compute laser indices");
  if (pulse_width === 0) throw new Error("pulse_width must be non-zero to compute laser indices");

  const effectivePasses = passes * (opts?.crosshatch ? 2 : 1);

  const pulse_spacing_mm = speed / (frequency * 1000);
  const line_spacing_mm = 10 / density;
  const pulse_energy_index = power / frequency;
  const pulse_intensity_index = power / (frequency * pulse_width);
  const total_exposure_index =
    (power * frequency * density * effectivePasses) / speed;
  const ablation_aggression_index = total_exposure_index * pulse_intensity_index;
  const delivery_smoothness_index = total_exposure_index / pulse_intensity_index;
  // freq is kHz, pw is ns; product is dimensionless × 1e-6.
  // Multiply by 100 to express as a percentage 0–100.
  const duty_cycle_index = (frequency * pulse_width) / 10_000;

  return {
    pulse_spacing_mm,
    line_spacing_mm,
    pulse_energy_index,
    pulse_intensity_index,
    total_exposure_index,
    ablation_aggression_index,
    delivery_smoothness_index,
    duty_cycle_index,
    formula_version: INDICES_FORMULA_VERSION,
  };
}
