export type Laser = "red" | "blue";

export const PARAM_NAMES = [
  "speed", "power", "frequency", "density", "passes", "pulse_width",
] as const;

export type ParamName = (typeof PARAM_NAMES)[number];

export type RegistrationMode = "auto" | "compact" | "full" | "off";
export type QrMode = "inline" | "id_only";
export type QrPosition = "top-left" | "top-right" | "bottom-right" | "left-middle";

export interface RegistrationConfig {
  mode: RegistrationMode;
  qr_mode: QrMode;
  qr_position: QrPosition;
  /** Optional override — leave null to use the default for the qr_mode (12mm inline / 7mm id-only). */
  qr_size_mm: number | null;
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

  /** UI-convenience flag: when true, height_mm is auto-computed to keep cells square. */
  square_cells: boolean;
  /** "rect" (default) or "circle" — the latter emits inscribed-circle elements. */
  cell_shape: "rect" | "circle";
  /** Multi-pass angle behaviour; only meaningful when base_params.passes > 1.
   *  - "fixed": every pass at the same scan angle.
   *  - "crosshatch": alternates scan_angle and scan_angle + 90°.
   *  - "incremental": XCS rotates the angle between passes.
   *  Maps to XCS angleType + crossAngle; no rect duplication client-side. */
  angle_mode: "fixed" | "crosshatch" | "incremental";
  registration: RegistrationConfig;
  material_id: string;  // required — palette queries are material-scoped
  /** true → burn one direction only (oneWay). false (default) → bi-directional (zMode). */
  unidirectional: boolean;
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
  /** Material thickness in mm; written to XCS LASER_PLANE.thickness for auto-focus. */
  focus_mm: number;
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
  material_id: string;  // required
  subtract_overlaps: boolean;
}

export interface LayerSpec {
  color: string;
  name: string;
  enabled: boolean;
  processing_type: SvgProcessingType;
  scan_angle: number;
  base_params: BaseParams;
  /** Same semantics as ParamTest.angle_mode. Ignored for HATCHED_LINES. */
  angle_mode: "fixed" | "crosshatch" | "incremental";
  material_id: string | null;   // layer's library-preset origin (optional)
  hatch_passes: HatchPassSpec[];   // non-empty iff processing_type === "HATCHED_LINES"
}

export interface SvgLayersRequest {
  name: string;
  svg_content: string;
  width_mm: number;
  height_mm: number | null;
  start_x: number;
  start_y: number;
  material_id: string;  // required project-level material (substrate)
  layers: LayerSpec[];
  subtract_overlaps: boolean;
}

export interface DetectedLayer {
  color: string;
  shape_count: number;
  is_fill: boolean;
}

export interface CaptureSwatch {
  row: number;
  col: number;
  x_value: number;
  y_value: number | null;
  hex: string;
  sigma: number;
}

export interface CaptureIngestResponse {
  test_id: string;
  kind: "grid" | "gradient";
  material_id: string | null;
  swatches: CaptureSwatch[];
  base_params: BaseParams;
  x_param: string;
  y_param: string | null;
}

export interface PaletteEntry {
  id: string;
  test_id: string;
  material_id: string;
  source: string;
  timestamp: string;
  hex: string;
  lab: number[];
  params: { [k: string]: string | number };
  sigma: number;
  notes: string;
}

export interface PaletteQueryResult {
  entry: PaletteEntry;
  delta_e: number;
}
