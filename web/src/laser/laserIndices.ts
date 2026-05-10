/**
 * Frontend port of xcs_gen.laser_indices.compute_indices (formula v3).
 *
 * Field-naming bridge: BaseParams (web schema) uses `passes` and
 * `pulse_width`; ProcessingParams (xcs_gen domain) uses `repeat` and
 * `pw`. This port operates on the BaseParams shape — its inputs are
 * `power, speed, frequency, density, passes, pulse_width` — and the
 * formulas use those names internally.
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
  formula_version: 3;
}

export const INDICES_FORMULA_VERSION = 3 as const;

export function computeIndices(params: LaserParams): LaserIndices {
  const { power, speed, frequency, density, passes, pulse_width } = params;

  if (speed === 0) throw new Error("speed must be non-zero to compute laser indices");
  if (frequency === 0) throw new Error("frequency must be non-zero to compute laser indices");
  if (density === 0) throw new Error("density must be non-zero to compute laser indices");
  if (pulse_width === 0) throw new Error("pulse_width must be non-zero to compute laser indices");

  const pulse_spacing_mm = speed / (frequency * 1000);
  const line_spacing_mm = 10 / density;
  const pulse_energy_index = power / frequency;
  const pulse_intensity_index = power / (frequency * pulse_width);
  const total_exposure_index = (power * density * passes) / speed;
  const ablation_aggression_index = total_exposure_index * pulse_intensity_index;
  const delivery_smoothness_index = total_exposure_index / pulse_intensity_index;

  return {
    pulse_spacing_mm,
    line_spacing_mm,
    pulse_energy_index,
    pulse_intensity_index,
    total_exposure_index,
    ablation_aggression_index,
    delivery_smoothness_index,
    formula_version: INDICES_FORMULA_VERSION,
  };
}
