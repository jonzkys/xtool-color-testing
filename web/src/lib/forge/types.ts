// web/src/lib/forge/types.ts
// Shared types for the Contour Forge feature. All geometry is in mm space.

/** A 2D point in millimetres. */
export interface Pt {
  x: number;
  y: number;
}

/** A polyline contour in mm space. `closed` means the last point joins the first. */
export interface Contour {
  points: Pt[];
  closed: boolean;
}

/** Which side of the contour widening is biased toward. */
export type SideMode = "outside" | "inside" | "symmetric" | "flip";

/** The four functional path classes the tool emits. */
export type GeneratedClass = "seed" | "perforate" | "deepen" | "clean";

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
  /** Per-stage laser-param overrides, keyed by groupName (e.g. CUT_01_SEED).
   *  Any field left undefined inherits the source incise object's value. */
  stageParams: Record<string, StageParams>;
  /** When true, write the speed-optimal raster scan angle to each generated
   *  INTAGLIO entry's `customize.processAngle` on export. Opt-in (experimental
   *  — the exact processAngle convention is xTool's). */
  optimizeScanAngle: boolean;
}

/** Rough per-stage laser params. All optional — undefined = inherit source. */
export interface StageParams {
  power?: number; // %
  speed?: number; // mm/s
  passes?: number; // → customize.repeat
  pulseWidth?: number; // ns (MOPA)
  frequency?: number; // kHz (→ customize.mopaFrequency)
  density?: number; // lines/cm (→ customize.density)
  laser?: "red" | "blue"; // → customize.processingLightSource
  zAxisMove?: boolean; // "Descend at Z-axis" (→ customize.zAxisMove)
  zLayers?: number; // descend every N layers (→ customize.zLayers)
  zDecline?: number; // mm per descent step (→ customize.zDecline)
  sliceNumber?: number; // total layers/slices (→ customize.sliceNumber)
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
}

export interface PipelineResult {
  paths: GeneratedPath[];
  stats: DebugStats;
}
