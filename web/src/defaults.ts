import type { BaseParams, HatchPassSpec, TestSpec } from "./types";

export function defaultBaseParams(): BaseParams {
  return {
    power: 14.6,
    speed: 1000,
    frequency: 125,
    density: 5000,
    passes: 1,
    pulse_width: 200,
    laser: "red",
    scan_angle: 90,
  };
}

export const DEFAULT_SPEC: TestSpec = {
  x_param: "speed", x_min: 500, x_max: 3000, x_steps: 10,
  y_param: null, y_min: null, y_max: null, y_steps: null,
  rows: 1, width_mm: 50, height_mm: 10, gap_mm: 0.5,
  cell_shape: "rect", square_cells: true, angle_mode: "fixed",
  unidirectional: false,
  hide_axis_labels: false,
  base_params: defaultBaseParams(),
  registration: { mode: "on", qr_size_mm: null, aruco_size_mm: null },
};

export function defaultHatchPass(angle = 0): HatchPassSpec {
  // Default spacing = thickness so the hatched output is a continuous fill
  // out of the box. Increase spacing > thickness for visible gaps.
  return { angle, spacing: 0.1, thickness: 0.1, ramps: [] };
}
