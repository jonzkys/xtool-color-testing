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
  /** Same semantics as TestSpec.angle_mode + TestSpec.crosshatch.
   *  Ignored for HATCHED_LINES. */
  angle_mode: "fixed" | "incremental";
  /** Crosshatch — orthogonal to angle_mode; adds a 90°-rotated
   *  companion stroke per pass (so passes=N + crosshatch = 2N strokes). */
  crosshatch: boolean;
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
  /** Sum of vertices across every shape with this colour. Drives the
   *  "× verts" chip in the layer card so the user can spot which
   *  layers are the candidates for path-simplification. */
  vertex_count: number;
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
  angle_mode: "fixed" | "incremental";
  /** Crosshatch — orthogonal to angle_mode; adds a 90°-rotated
   *  companion stroke per pass (so passes=N + crosshatch = 2N strokes).
   *  Stacks with incremental: rotates AND adds the perpendicular. */
  crosshatch: boolean;
  unidirectional: boolean;
  /** When true, per-row tick + numeric axis labels are suppressed on
   *  the generated test. The summary header line is still drawn. */
  hide_axis_labels: boolean;
  /** Validation tests only — how many cells per physical row on the
   *  burn. Sweep tests ignore this. */
  cells_per_row?: number;
  /** Validation tests only — material to seed the palette picker
   *  from. Defaults to the test's own material when omitted; set to
   *  another material's id to validate "would material A's palette
   *  burn the same on material B?" without re-running every sweep. */
  source_material_id?: number;
  base_params: BaseParams;
  registration: RegistrationConfig;
}

export interface TestRecord {
  id: number;
  machine_id: string;
  name: string;
  material_id: number;
  status: "created" | "tested" | "deleted";
  kind: "sweep" | "validation";
  spec: TestSpec;
  validation_cells: ValidationCell[];
  notes: string;
  created_at: string;
  updated_at: string;
  locked: boolean;
  /** Monotonic burn counter — bumped by POST /api/tests/{id}/retest. 0
   *  for newly-created tests; the next Generate stamps the current
   *  value into the XCS's QR payload. */
  retest_index?: number;
  /** Derived: true when at least one palette entry references this
   *  test_id. Server-side computation; defaults to false on older
   *  API responses that don't carry the field. */
  ingested?: boolean;
}

export interface ValidationCell {
  id: number;
  test_id: number;
  cell_index: number;
  palette_entry_id: number | null;
  expected_hex: string;
  expected_lab: number[];   // [L*, a*, b*]
  params: Record<string, string | number>;
}

export interface ResultSwatch {
  row: number; col: number;
  x_value: number; y_value: number | null;
  hex: string; lab: number[]; sigma: number;
}

/** Pixel-space geometry of a result's warped-image cell grid. Drives
 *  the cell-inspector overlay's mouse → cell math. */
export interface GridLayout {
  image_width_px: number;
  image_height_px: number;
  grid_origin_x_px: number;
  grid_origin_y_px: number;
  cell_width_px: number;
  cell_height_px: number;
  row_stride_px: number;
  /** Always populated; ``ceil(x_steps / rows)`` for wrapped 1D. */
  cells_per_physical_row: number;
  physical_rows: number;
  /** ``true`` when the test has both axes; ``false`` for 1D
   *  (single-row or wrapped). Drives swatch-index resolution. */
  is_2d: boolean;
  px_per_mm: number;
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
  /** WB flat-field calibration state — populated by the capture
   *  pipeline. ``null`` for older results captured before the WB
   *  flat-field feature shipped. */
  wb?: ResultWBState | null;
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
  /** Validated state — populated by the validation flow on the
   *  Stability page or by per-entry validate. ``is_validated`` is the
   *  filter the auto-match's "Prefer validated" toggle uses. The
   *  ``validated_*`` columns describe the validation event:
   *  ``validated_test_id`` + ``validated_cell_index`` pinpoint the
   *  source cell so the palette UI can deep-link "this entry → that
   *  cell". For entries created by the batch-validate route the
   *  primary ``lab`` IS the validated value (validated_lab mirrors
   *  it); for entries that were validated in place via the per-entry
   *  route the two can differ. ``validated_residual_de`` carries the
   *  cross-run stability ΔE (i.e. how tight the consensus was). */
  is_validated?: boolean;
  validated_at?: string | null;
  validated_test_id?: number | null;
  validated_cell_index?: number | null;
  validated_lab?: number[] | null;
  validated_run_count?: number | null;
  validated_residual_de?: number | null;
  /** Derived: this entry has been used as a target in a validation
   *  test that has at least one non-excluded result — i.e. the user
   *  has tried this colour at least once. Distinct from
   *  ``is_validated`` (which means the explicit batch validate flow
   *  flipped the flag). The picker's autopick uses it to skip
   *  colours the user has already burned, so subsequent validation
   *  tests cover new ground. */
  original_validated?: boolean;
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
  /** Human-readable label of the sampling fraction (e.g. "30%" for the
   *  rect mask, "50% Ø" for the inscribed circle). Travels with the
   *  data so the UI annotation can't drift from the backend constant. */
  fraction_label: string;
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

// Saved Spectrums (stage 1) ───────────────────────────────────────────────

export interface SavedSpectrumSwatch {
  swatch_row: number;
  swatch_col: number;
  x_value: number;
  hex: string;
  lab: [number, number, number];
}

/** Per-channel polynomial coefficient list for a saved spectrum. Each
 *  list is ordered c0, c1, c2, ... and length === fit_degree + 1. */
export type SavedSpectrumCoefficients = {
  l: number[];
  a: number[];
  b: number[];
};

export interface SavedSpectrum {
  id: number;
  name: string;
  source_test_id: number | null;
  machine_id: string;
  material_id: number | null;
  owner_id: number;
  axis_param: string;
  axis_min: number;
  axis_max: number;
  fit_form: "polynomial";
  fit_degree: 1 | 2 | 3;
  fit_coefficients: SavedSpectrumCoefficients;
  fit_r2: { l: number; a: number; b: number };
  fit_r2_min: number;
  displayed_projection: string;
  lab_l_min: number; lab_l_max: number;
  lab_a_min: number; lab_a_max: number;
  lab_b_min: number; lab_b_max: number;
  lab_l_centroid: number;
  lab_a_centroid: number;
  lab_b_centroid: number;
  swatches: SavedSpectrumSwatch[];
  created_at: string;
}

export interface SavedSpectrumCreate {
  name: string;
  source_test_id: number;
  axis_param: string;
  axis_min: number;
  axis_max: number;
  fit_form: "polynomial";
  fit_degree: 1 | 2 | 3;
  fit_coefficients: SavedSpectrumCoefficients;
  fit_r2: { l: number; a: number; b: number };
  displayed_projection: string;
  swatches: SavedSpectrumSwatch[];
}

// ── Text/registration default ProcessingParams ───────────────────────────────
//
// Mirrors the seven-field ProcessingParams shape the .xcs renderer reads
// for QR + ArUco fiducials, axis ticks/labels, and the summary text strip.
// The persisted rows extend with id/timestamps; the resolver tags the
// effective triple with which layer it came from.

/** Wire shape for `PUT /api/text-registration-defaults/...` request body
 *  and the seven-field common subset of every persisted row. */
export interface TextRegParamsBody {
  speed: number;
  power: number;
  density: number;
  repeat: number;
  pulse_width: number;
  mopa_frequency: number;
  processing_light_source: string;
}

export interface TextRegMachineDefault extends TextRegParamsBody {
  id: number;
  machine_id: string;
  created_at: string;
  updated_at: string;
}

export interface TextRegMaterialDefault extends TextRegParamsBody {
  id: number;
  machine_id: string;
  material_id: number;
  created_at: string;
  updated_at: string;
}

export type TextRegSource = "material" | "machine" | "fallback";

export interface TextRegResolveResponse extends TextRegParamsBody {
  source: TextRegSource;
}

// ---------------------------------------------------------------------------
// Pixel Art (mirrors src/xcs_gen_web/schemas.py).
// ---------------------------------------------------------------------------

export interface PixelArtLayerSpec {
  color: string;
  enabled: boolean;
  base_params: BaseParams;
  material_id: string | null;
  palette_entry_id: number | null;
}

export interface PixelArtRectSpec {
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
}

export interface PixelArtRequest {
  name: string;
  material_id: string;
  width_mm: number;
  height_mm: number;
  start_x: number;
  start_y: number;
  cell_mm: number;
  rects: PixelArtRectSpec[];
  layers: PixelArtLayerSpec[];
}

// ---------------------------------------------------------------------------
// WB flat-field calibration (mirrors src/xcs_gen_web/schemas.py).
// ---------------------------------------------------------------------------

export interface MaterialCalibrationConfig {
  wb_supported: boolean;
  clean_pass_params: BaseParams | null;
}

export interface ResultWBState {
  mode: "flatfield" | "chromaticity" | "skipped" | "disabled" | null;
  /** flat-field: list of 4 [R, G, B] (top, right, bottom, left).
   *  chromaticity: single [R, G, B]. */
  anchor_rgb: [number, number, number] | [number, number, number][] | null;
  /** flat-field: list of 4 {side, x_mm, y_mm, R, G, B}.
   *  chromaticity: per-channel [sR, sG, sB]. */
  correction: number[] | Array<Record<string, number | string>> | null;
  canonical_id: string | null;
}
