// web/src/lib/forge/types.ts
// Shared types for the Contour Forge feature. All geometry is in mm space.

// Canonical Pt lives in the reusable cuttime core; re-export so forge code
// keeps importing it from here while the two modules share one definition.
import type { Pt } from "../cuttime/geometry";
export type { Pt };
import type { ForgeEstimate } from "./estimate";

/** A polyline contour in mm space. `closed` means the last point joins the first. */
export interface Contour {
  points: Pt[];
  closed: boolean;
}

/** Which side of the contour widening is biased toward. */
export type SideMode = "outside" | "inside" | "symmetric" | "flip";

/** Brass thicknesses (mm) the Spiral Cut page offers as presets. */
export type MaterialThicknessMm = 1 | 1.5 | 2 | 3 | 4;
export const MATERIAL_THICKNESSES_MM: MaterialThicknessMm[] = [1, 1.5, 2, 3, 4];

/** The four functional path classes the tool emits. */
export type GeneratedClass = "seed" | "perforate" | "deepen" | "clean" | "spiral";

/**
 * One generated path with full provenance metadata. Kept internally for
 * preview/debug even where the .xcs format cannot represent every field.
 *
 * Geometry is a set of closed loops (`rings`) in mm space. Even-odd across the
 * rings defines the filled region: a band is two concentric loops (the sliver
 * between them = the kerf); a perforation pocket is a single solid loop.
 */
export interface GeneratedPath {
  sourceObjectId: string;
  generatedClass: GeneratedClass;
  groupName: string;
  layerStart: number;
  layerEnd: number;
  widthMultiplier: number;
  offsetMm: number;
  sideMode: SideMode;
  operationOrder: number;
  enabled: boolean;
  /** Closed loops in mm space; even-odd fill defines the engraved region. */
  rings: Pt[][];
}

/** One editable deepen pass-group row. */
export interface DeepenGroup {
  name: string;
  /** End depth of this deepen pass (0..256). Deepen passes always start at the
   *  surface (0), so there is no `fromLayer`. */
  toLayer: number;
  widthMultiplier: number;
  enabled: boolean;
  /** Deepen groups after the first default to copying the first group's
   *  laser params; undefined is treated as true for non-first groups. */
  copyParamsFromFirst?: boolean;
}

export interface SeedConfig {
  enabled: boolean;
  widthMultiplier: number;
  layerCount: number;
  outsideOnly: boolean;
}

export interface PerforateConfig {
  enabled: boolean;
  spacingMm: number;
  cornerBoost: boolean;
  cornerAngleThresholdDeg: number;
  pocketSizeMm: number;
  outsideBias: boolean;
  /** Slice count this stage exports (shallow — starter pockets, not a deep cut). */
  layerCount: number;
  /** Pocket (square at intervals) or slot (outward/channel-aligned relief tick). */
  shape: "pocket" | "slot";
  /** Place extra vents at scrap necks (near-touching edges / ring+dot / i-j dots). */
  nearGap: boolean;
  /** Max scrap-neck width to vent (mm). */
  gapThresholdMm: number;
  /** Slot length (mm) when shape === "slot". */
  slotLengthMm: number;
}

export interface DeepenConfig {
  groups: DeepenGroup[];
  outsideOnly: boolean;
}

export interface CleanConfig {
  enabled: boolean;
  /** Which walls to follow. */
  offsetSelection: "walls" | "outer" | "inner";
  passes: number;
  /** Slice count this stage exports (shallow wall clean-up). */
  layerCount: number;
}

export interface SpiralConfig {
  enabled: boolean;
  /** Total venting channel width swept on the scrap side (mm); 0.8 cuts clean. */
  channelWidthMm: number;
  /** Spacing between spiral arms (mm); ~beam so arms overlap and the channel fully ablates. */
  pitchMm: number;
  /** outside = spiral into scrap around the silhouette; inside = into holes. */
  side: "outside" | "inside";
  /** Floor to shrink the channel toward in a thin neck before falling back to a warning. */
  minChannelMm: number;
  /** Vector passes (→ customize.repeat). */
  passes: number;
  /** Focus descent per step (mm) — follows focus down through the thickness. */
  focusStepMm: number;
  /** Step the focus every N passes. */
  focusIntervalPasses: number;
  /** Initial focus drop (mm) applied before the stepwise descent begins. */
  focusInitialMm: number;
  /** Split thin features off the perimeter spiral into their own arms. */
  splitNecks: boolean;
  /** A location counts as a neck when local width < this % of channel width. */
  neckThresholdPct: number;
  /** Overlap (mm) each split arm shares with its neighbour at the neck. */
  neckOverlapMm: number;
  /** Cut the smallest paths first (detail features, then main — each ascending
   *  by length) so small punch-throughs vent and relieve the longer passes.
   *  Exports the job with user-defined path planning so the machine honours the
   *  order instead of auto-optimising it. */
  cutShortestFirst: boolean;
  /** Internal reference for the "% of incise" baseline comparison (NOT user-
   *  editable — set per brass thickness in code). `layers` = Studio "Number of
   *  layers" and maps to the cut-time model's `sliceNumber` (the depth axis); the
   *  baseline runs at a single repeat (passes = 1), so the time scales linearly
   *  with `layers` instead of multiplying on top of the default slice count. */
  baselineIncise: { speed: number; layers: number };
}

export interface ForgeConfig {
  beamWidthMm: number;
  sideMode: SideMode;
  /** Manual unit override; null = use the display-scale calibration. */
  mmPerUnitOverride: number | null;
  seed: SeedConfig;
  perforate: PerforateConfig;
  deepen: DeepenConfig;
  clean: CleanConfig;
  spiral: SpiralConfig;
  /** Per-stage laser-param overrides, keyed by groupName (e.g. CUT_01_SEED).
   *  Any field left undefined inherits the source incise object's value. */
  stageParams: Record<string, StageParams>;
  /** When true, write the speed-optimal raster scan angle to each generated
   *  INTAGLIO entry's `customize.processAngle` on export. Opt-in (experimental
   *  — the exact processAngle convention is xTool's). */
  optimizeScanAngle: boolean;
  /** Manual scan-angle override (deg) written to `customize.processAngle` on
   *  export. null = inherit the source value. Ignored while `optimizeScanAngle`
   *  is on (that takes precedence). */
  manualScanAngleDeg: number | null;
  /** Warn when estimated time exceeds this multiple of a plain incise. null = off. */
  timeBudgetX?: number | null;
  /** Which preset the staged config currently matches (UI hint). */
  activePreset?: "lean" | "aggressive" | "spiral" | "custom";
}

/** Rough per-stage laser params. All optional — undefined = inherit source. */
export interface StageParams {
  power?: number; // %
  speed?: number; // mm/s
  passes?: number; // → customize.repeat
  pulseWidth?: number; // ns (MOPA)
  frequency?: number; // kHz (→ customize.mopaFrequency)
  density?: number; // lines/cm (→ customize.density)
  laser?: "red" | "blue" | "uv"; // → customize.processingLightSource
  zAxisMove?: boolean; // "Descend at Z-axis" (→ customize.zAxisMove)
  zLayers?: number; // descend every N layers (→ customize.zLayers)
  zDecline?: number; // mm per descent step (→ customize.zDecline)
  sliceNumber?: number; // total layers/slices (→ customize.sliceNumber)
  cuttingDrop?: boolean;            // → customize.cuttingDrop (focus descent on)
  sinkingMethod?: string;           // → customize.sinkingMethod ("one" single | "step" stepwise)
  descentIntervalDescent?: number;  // → customize.descentIntervalDescent (every N passes)
  descentPerStep?: number;          // → customize.descentPerStep (mm per step)
  firstCuttingDropValue?: number;   // → customize.firstCuttingDropValue (initial focus drop, mm)
  cuttingDropValue?: number;        // → customize.cuttingDropValue (mirrors initial focus drop)
}

/** One object detected inside the uploaded XCS. */
export interface XcsObject {
  id: string;
  type: string; // PATH | BITMAP | CIRCLE | ...
  name: string | null;
  processingType: string | null; // INTAGLIO | RELIEF | VECTOR_CUTTING | ...
  modeClass: "incise" | "emboss" | "score" | "other";
  dPath?: string;
  /** True when this object carries a vector path (a forge-able contour). */
  hasGeometry: boolean;
  /** Source laser params read from this object's INTAGLIO customize (cut
   *  targets only); used to pre-fill the per-stage param widgets. */
  params?: StageParams;
  /** Source `processAngle` from this object's INTAGLIO customize — the
   *  baseline the optimizer improves on. */
  sourceScanAngleDeg?: number;
  /** id of the device.data process group this object belongs to. */
  groupKey: string;
}

/** Result of parsing an uploaded .xcs. `raw` is the full JSON document. */
export interface ParsedXcs {
  raw: unknown;
  objects: XcsObject[];
  emboss: XcsObject[];
  incise: XcsObject[];
  /** Incise objects with usable geometry — the forge-able cut targets. */
  targets: XcsObject[];
  /** Real non-incise objects (emboss / score / other) preserved untouched. */
  preserved: XcsObject[];
}

/** Stats + warnings surfaced in the debug panel. */
export interface DebugStats {
  mmPerUnit: number;
  mmPerUnitConfident: boolean;
  pathCounts: Record<GeneratedClass, number>;
  totalPaths: number;
  warnings: string[];
  /** Speed-optimal raster scan angle (deg) computed from the source contour;
   *  written to `processAngle` on export only when `optimizeScanAngle` is on. */
  scanAngleDeg: number;
  /** The source object's `processAngle` — the baseline the optimizer compares against. */
  scanAngleBaselineDeg?: number;
  /** Percentage reduction in scan lines from using the optimal angle vs the
   *  source angle (0–100). Undefined when the source angle is not known. */
  scanAngleReductionPct?: number;
  /** Cut-time estimate for the generated strategy. */
  estimate: ForgeEstimate;
}

export interface PipelineResult {
  paths: GeneratedPath[];
  stats: DebugStats;
}
