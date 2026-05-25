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
  fromLayer: number;
  toLayer: number;
  widthMultiplier: number;
  enabled: boolean;
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
  /** Manual unit override; null = use perimeter-derived calibration. */
  mmPerUnitOverride: number | null;
  seed: SeedConfig;
  perforate: PerforateConfig;
  deepen: DeepenConfig;
  clean: CleanConfig;
}

/** One object detected inside the uploaded XCS. */
export interface XcsObject {
  id: string;
  type: string; // PATH | BITMAP | CIRCLE | ...
  name: string | null;
  processingType: string | null; // INTAGLIO | RELIEF | VECTOR_CUTTING | ...
  modeClass: "incise" | "emboss" | "other";
  dPath?: string;
  /** id of the device.data process group this object belongs to. */
  groupKey: string;
}

/** Result of parsing an uploaded .xcs. `raw` is the full JSON document. */
export interface ParsedXcs {
  raw: unknown;
  objects: XcsObject[];
  emboss: XcsObject[];
  incise: XcsObject[];
}

/** Stats + warnings surfaced in the debug panel. */
export interface DebugStats {
  mmPerUnit: number;
  mmPerUnitConfident: boolean;
  pathCounts: Record<GeneratedClass, number>;
  totalPaths: number;
  warnings: string[];
}

export interface PipelineResult {
  paths: GeneratedPath[];
  stats: DebugStats;
}
