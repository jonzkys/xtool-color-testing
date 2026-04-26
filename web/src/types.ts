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
  /** Mode the user picked when creating this test. Determines which
   *  validation profile applies. Optional for backwards compat — pre-
   *  multi-machine rows lack the field; the API handler infers a
   *  sensible default from machine_id when it's missing. */
  mode?: ModeId;
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

export interface HatchRampStopSpec {
  /** 0..1 along the ramp axis. */
  position: number;
  value: number;
}

export interface HatchRampSpec {
  param: HatchRampParam;
  axis: HatchRampAxis;
  min: number;
  max: number;
  /** Optional multi-stop override. When present, backend uses
   *  piecewise-linear interpolation of these stops and ignores
   *  min/max. Must include endpoints at position 0 and 1. */
  stops?: HatchRampStopSpec[] | null;
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

export type SampleAggregator =
  | "median"
  | "mean"
  | "saturation_median"
  | "trimmed_mean"
  | "kmeans_dominant";

export interface TestSpec {
  x_param: ParamName;
  x_min: number; x_max: number; x_steps: number;
  y_param: ParamName | null;
  y_min: number | null; y_max: number | null; y_steps: number | null;
  rows: number;
  width_mm: number; height_mm: number; gap_mm: number;
  cell_shape: "rect" | "circle";
  /** Aggregator name from xcs_gen.sampling_aggregators.LEGAL_AGGREGATORS.
   * When undefined, the backend treats it as "saturation_median" for
   * back-compat with tests created before this field existed. */
  sample_aggregator?: SampleAggregator;
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
  machine_id: string;
  name: string;
  material_id: number;
  status: "created" | "tested" | "deleted";
  spec: TestSpec;
  notes: string;
  created_at: string;
  updated_at: string;
  locked: boolean;
  /** Monotonic burn counter — bumped by POST /api/tests/{id}/retest. 0
   *  for newly-created tests; the next Generate stamps the current
   *  value into the XCS's QR payload. */
  retest_index?: number;
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
  /** Copied from the QR on ingest; 0 for pre-retest-era burns. */
  retest_index?: number;
  /** ArUco IDs (subset of {1,2,3}) the pipeline failed to detect on
   *  this photo. Empty/absent when the homography was fully
   *  constrained. UI surfaces this as a warning so users know which
   *  corner's colours may be unreliable. */
  missing_markers?: number[];
}

export interface AveragedSwatch extends ResultSwatch {
  sample_count: number;
  per_result: {
    result_id: number;
    hex: string;
    sigma: number;
    /** Retest the run belongs to. Defaults server-side to 0 for
     *  burns that didn't embed a retest index in their QR. */
    retest_index?: number;
  }[];
}

export interface PaletteEntry {
  id: number;
  machine_id: string;
  test_id: number | null;
  material_id: number;
  x_value: number | null; y_value: number | null;
  hex: string; lab: number[];
  params: Record<string, string | number>;
  sigma: number;
  source: "averaged" | "single_result" | "manual";
  source_result_id: number | null;
  notes: string;
  favorited: boolean;
  created_at: string;
}

export interface PaletteQueryResult {
  entry: PaletteEntry;
  delta_e: number;
}

// ── Machine registry (mirrors xcs_gen.machines.MACHINES + PROFILES) ──────────

export type LaserKind = "fiber" | "blue";
export type LaserName = "red" | "blue";   // wire format used inside .xcs files
export type ModeId = "engrave" | "score" | "cut" | "color_engrave";
export type ProfileId = "STANDARD" | "COLOR_ENGRAVE";

export interface MachineLaser {
  kind: LaserKind;
  wattage: number;
  spot_mm: [number, number];   // [width, height]
}

export interface MachineMode {
  id: ModeId;
  profile: ProfileId;
}

export interface Machine {
  id: string;                  // e.g. "F2Ultra"
  display_name: string;
  ext_id: string;
  ext_name: string;
  image: string;               // absolute URL beginning /static/machines/
  lasers: MachineLaser[];
  modes: MachineMode[];
}

export type FieldConstraint =
  | { kind: "range"; min: number; max: number; step?: number }
  | { kind: "stepped"; values: (number | string)[] }
  | { kind: "not_applicable" }
  | { kind: "enum"; values: (number | string)[] };

export type ValidationProfile = Record<string, FieldConstraint>;

export interface MachinesPayload {
  machines: Machine[];
  profiles: Record<ProfileId, ValidationProfile>;
}

export interface SwatchPreviewResponse {
  aggregator: SampleAggregator;
  swatches: ResultSwatch[];
}

export interface InspectSamplingRegion {
  shape: "circle" | "rect";
  radius_px?: number;
  half_w_px?: number;
  half_h_px?: number;
  center_px: [number, number];
}

export interface InspectCellResponse {
  row: number;
  col: number;
  x_value: number;
  y_value: number | null;
  sigma: number;
  cell_image_b64: string;
  sampling_region: InspectSamplingRegion;
  aggregator_results: Record<SampleAggregator, string>;
}
