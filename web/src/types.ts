export type Laser = "red" | "blue";

export const PARAM_NAMES = [
  "speed", "power", "frequency", "density", "passes", "pulse_width",
] as const;

export type ParamName = (typeof PARAM_NAMES)[number];

export type RegistrationMode = "auto" | "compact" | "full" | "off";
export type QrMode = "inline" | "id_only";

export interface RegistrationConfig {
  mode: RegistrationMode;
  qr_mode: QrMode;
}

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
  registration: RegistrationConfig;
  material_id: string | null;
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

export type SvgProcessingType =
  | "COLOR_FILL_ENGRAVE"
  | "FILL_VECTOR_ENGRAVING"
  | "VECTOR_ENGRAVING"
  | "VECTOR_CUTTING"
  | "HATCHED_LINES";

export type HatchRampParam =
  | "power"
  | "speed"
  | "frequency"
  | "density"
  | "passes"
  | "pulse_width"
  | "spacing";

export type HatchRampAxis = "perp" | "parallel" | "x" | "y";

export interface HatchRampSpec {
  param: HatchRampParam;
  axis: HatchRampAxis;
  min: number;
  max: number;
}

export interface HatchPassSpec {
  angle: number;       // degrees, 0 = horizontal
  spacing: number;     // mm between hatch line centers
  thickness: number;   // mm; height of each hatch line's filled rect
  ramps: HatchRampSpec[];
}

export interface SvgStackRequest {
  name: string;
  svg_content: string;
  width_mm: number;
  height_mm: number | null;
  start_x: number;
  start_y: number;
  base_params: BaseParams;
  processing_type: SvgProcessingType;
  scan_angle: number;
  stack_passes: number;
  stack_step_deg: number;
  material_id: string | null;
  subtract_overlaps: boolean;
}

export interface LayerSpec {
  color: string;
  name: string;
  enabled: boolean;
  processing_type: SvgProcessingType;
  scan_angle: number;
  base_params: BaseParams;
  crosshatch_enabled: boolean;
  crosshatch_passes: number;
  crosshatch_step_deg: number;
  material_id: string | null;
  hatch_passes: HatchPassSpec[];   // non-empty iff processing_type === "HATCHED_LINES"
}

export interface SvgLayersRequest {
  name: string;
  svg_content: string;
  width_mm: number;
  height_mm: number | null;
  start_x: number;
  start_y: number;
  layers: LayerSpec[];
  subtract_overlaps: boolean;
}

export interface DetectedLayer {
  color: string;
  shape_count: number;
  is_fill: boolean;
}
