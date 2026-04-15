export type Laser = "red" | "blue";

export const PARAM_NAMES = [
  "speed", "power", "frequency", "density", "passes", "pulse_width",
] as const;

export type ParamName = (typeof PARAM_NAMES)[number];

export interface BaseParams {
  power: number;
  speed: number;
  frequency: number;
  density: number;
  passes: number;
  pulse_width: number;
  laser: Laser;
}

export interface ParamTest {
  id: string;
  name: string;
  x_param: ParamName;
  x_min: number;
  x_max: number;
  x_steps: number;
  y_param?: ParamName | null;
  y_min?: number | null;
  y_max?: number | null;
  y_steps?: number | null;
  rows: number;
  width_mm: number;
  height_mm: number;
  gap_mm: number;
  base_params: BaseParams;

  crosshatch_enabled: boolean;
  crosshatch_passes: number;
  crosshatch_step_deg: number;
}

export interface TestPlacement {
  test: ParamTest;
  row: number;
  col: number;
  col_span: number;
}

export interface Project {
  name: string;
  grid_gap_mm: number;
  tests: TestPlacement[];
}

export interface ValidationIssue {
  field: string;        // dot-path e.g. "tests[0].test.x_min"
  message: string;
  severity: "error" | "warning";
}
