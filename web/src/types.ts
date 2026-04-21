export type Laser = "red" | "blue";

export const PARAM_NAMES = [
  "speed", "power", "frequency", "density", "passes", "pulse_width",
] as const;

export type ParamName = (typeof PARAM_NAMES)[number];

export type RegistrationMode = "on" | "off";

export interface RegistrationConfig {
  mode: RegistrationMode;
  /** Optional override for QR size in mm. */
  qr_size_mm: number | null;
  /** Optional override for ArUco marker size in mm. */
  aruco_size_mm: number | null;
}

export interface BaseParams {
  power: number;
  speed: number;
  frequency: number;
  density: number;
  passes: number;
  pulse_width: number;
  laser: Laser;
  /** Starting scan angle in degrees. 90 = vertical (default); 0 = horizontal. */
  scan_angle: number;
}

export interface ValidationIssue {
  field: string;        // dot-path e.g. "layers[0].hatch_passes"
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
  /** Same semantics as TestSpec.angle_mode. Ignored for HATCHED_LINES. */
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
  /** True when the colour is bright and nearly neutral (min RGB channel
   *  >= 220 AND max-min spread <= 20). Catches pure white plus vtracer
   *  quantization artefacts like #dbdcdd / #f0f0f1 / #faeef0. The
   *  layer-picker hides these by default unless the user ticks "Include
   *  white". Optional on the wire so older backend responses still
   *  validate. */
  is_near_white?: boolean;
}

// ── Server-authoritative types (Tasks 23+) ────────────────────────────────────

export interface TestSpec {
  x_param: ParamName;
  x_min: number; x_max: number; x_steps: number;
  y_param: ParamName | null;
  y_min: number | null; y_max: number | null; y_steps: number | null;
  rows: number;
  width_mm: number; height_mm: number; gap_mm: number;
  cell_shape: "rect" | "circle";
  square_cells: boolean;
  angle_mode: "fixed" | "crosshatch" | "incremental";
  unidirectional: boolean;
  /** When true, per-row tick + numeric axis labels are suppressed on
   *  the generated test. The summary header line is still drawn. */
  hide_axis_labels: boolean;
  base_params: BaseParams;
  registration: RegistrationConfig;
}

export interface TestRecord {
  id: number;
  name: string;
  material_id: number;
  status: "created" | "tested" | "deleted";
  spec: TestSpec;
  notes: string;
  created_at: string;
  updated_at: string;
  locked: boolean;
}

export interface ResultSwatch {
  row: number; col: number;
  x_value: number; y_value: number | null;
  hex: string; lab: number[]; sigma: number;
}

export interface ResultRecord {
  id: number;
  test_id: number;
  uploaded_at: string;
  image_url: string;
  image_sha256: string;
  excluded: boolean;
  notes: string;
  swatches: ResultSwatch[];
}

export interface AveragedSwatch extends ResultSwatch {
  sample_count: number;
  per_result: { result_id: number; hex: string; sigma: number }[];
}

export interface PaletteEntry {
  id: number;
  test_id: number; material_id: number;
  x_value: number | null; y_value: number | null;
  hex: string; lab: number[];
  params: Record<string, string | number>;
  sigma: number;
  source: "averaged" | "single_result";
  source_result_id: number | null;
  notes: string;
  created_at: string;
}

export interface PaletteQueryResult {
  entry: PaletteEntry;
  delta_e: number;
}
