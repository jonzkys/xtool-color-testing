// web/src/lib/forge/xcs.ts
import type { Contour, GeneratedPath, ParsedXcs, XcsObject } from "./types";
import { flattenDPath, normaliseContour, contourPerimeter, splitSubpaths } from "./contour";

const INCISE_TYPES = new Set(["INTAGLIO", "VECTOR_CUTTING"]);
const EMBOSS_TYPES = new Set(["RELIEF", "VECTOR_ENGRAVING", "FILL_VECTOR_ENGRAVING", "COLOR_FILL_ENGRAVE"]);

function classify(pt: string | null): XcsObject["modeClass"] {
  if (pt && INCISE_TYPES.has(pt)) return "incise";
  if (pt && EMBOSS_TYPES.has(pt)) return "emboss";
  return "other";
}

/** A serialised JS Map: { dataType:"Map", value:[[k,v],…] }. */
interface XcsMap<V> {
  dataType: "Map";
  value: Array<[string, V]>;
}
function isXcsMap(v: unknown): v is XcsMap<unknown> {
  return !!v && typeof v === "object" && (v as { dataType?: string }).dataType === "Map";
}
function mapEntries<V>(m: unknown): Array<[string, V]> {
  return isXcsMap(m) ? (m.value as Array<[string, V]>) : [];
}

interface RawDisplay {
  id: string;
  type: string;
  name?: string | null;
  dPath?: string;
  isClosePath?: boolean;
  isFill?: boolean;
  fillRule?: string;
  layerTag?: string;
  layerColor?: string;
  [key: string]: unknown;
}

interface LayerDataEntry {
  name: string;
  order: number;
  visible: boolean;
}
interface RawEntry {
  type?: string;
  processingType?: string;
}
interface RawGroup {
  mode?: string;
  data?: Record<string, { perimeter?: number }>;
  displays?: unknown;
}

/** Parse raw .xcs JSON bytes into the in-memory model. Throws on bad JSON. */
export function parseXcsFile(buf: ArrayBuffer): ParsedXcs {
  const text = new TextDecoder().decode(buf);
  const raw = JSON.parse(text) as {
    canvas?: Array<{ displays?: RawDisplay[] }>;
    device?: { data?: unknown };
  };
  const displays: RawDisplay[] = raw.canvas?.[0]?.displays ?? [];
  const byId = new Map(displays.map((d) => [d.id, d]));

  // Walk device.data Map → group → displays Map → processing entries.
  const objects: XcsObject[] = [];
  for (const [groupKey, group] of mapEntries<RawGroup>(raw.device?.data)) {
    for (const [displayId, entry] of mapEntries<RawEntry>(group.displays)) {
      const disp = byId.get(displayId);
      const processingType = entry.processingType ?? null;
      objects.push({
        id: displayId,
        type: disp?.type ?? entry.type ?? "UNKNOWN",
        name: disp?.name ?? null,
        processingType,
        modeClass: classify(processingType),
        dPath: disp?.dPath,
        groupKey,
      });
    }
  }

  const parsed: ParsedXcs = {
    raw,
    objects,
    emboss: objects.filter((o) => o.modeClass === "emboss"),
    incise: objects.filter((o) => o.modeClass === "incise"),
  };
  return parsed;
}

export function findEmbossObjects(p: ParsedXcs): XcsObject[] {
  return p.emboss;
}
export function findInciseObjects(p: ParsedXcs): XcsObject[] {
  return p.incise;
}

/** Flatten + normalise the object's dPath into a mm-ish contour (still in path units). */
export function extractContourGeometry(obj: XcsObject): Contour {
  if (!obj.dPath) {
    throw new Error(`object ${obj.id} has no dPath — not a usable vector contour`);
  }
  return normaliseContour(flattenDPath(obj.dPath));
}

/**
 * Split the object's dPath into one Contour per subpath (each M…[Z] group),
 * flattening + normalising each. Returns the same error as extractContourGeometry
 * when dPath is missing.
 */
export function extractContourSubpaths(obj: XcsObject): Contour[] {
  if (!obj.dPath) {
    throw new Error(`object ${obj.id} has no dPath — not a usable vector contour`);
  }
  return splitSubpaths(obj.dPath);
}

export interface Calibration {
  mmPerUnit: number;
  confident: boolean;
}

/**
 * Derive path-units → mm. The RELIEF_PROCESS group records the real-world
 * `perimeter` (mm) of its contour; dividing by the flattened path perimeter
 * (units) gives mm-per-unit. If the field is missing/zero we fall back to 1.0
 * and report not-confident (caller surfaces a warning + manual override).
 */
export function calibrateMmPerUnit(p: ParsedXcs, incise: XcsObject): Calibration {
  const raw = p.raw as { device?: { data?: unknown } };
  let perimeterMm = 0;
  for (const [, group] of mapEntries<RawGroup>(raw.device?.data)) {
    if (group.mode && group.data?.[group.mode]?.perimeter) {
      perimeterMm = group.data[group.mode]!.perimeter!;
      break;
    }
  }
  const units = extractContourSubpaths(incise).reduce((sum, c) => sum + contourPerimeter(c), 0);
  if (perimeterMm > 0 && units > 0) {
    return { mmPerUnit: perimeterMm / units, confident: true };
  }
  return { mmPerUnit: 1, confident: false };
}

/** Serialise a mm-space contour back to a dPath string in path units. */
export function contourToDPath(points: { x: number; y: number }[], closed: boolean, mmPerUnit: number): string {
  if (points.length === 0) return "";
  const u = (v: number) => +(v / mmPerUnit).toFixed(4);
  const cmds = points.map((p, i) => `${i === 0 ? "M" : "L"}${u(p.x)},${u(p.y)}`);
  if (closed) cmds.push("Z");
  return cmds.join(" ");
}

/**
 * Serialise a set of closed loops (rings) into one compound dPath: each ring is
 * its own `M…Z` subpath, joined with a space. INTAGLIO fills the compound path
 * with `fillRule: "evenodd"`, so two concentric rings fill only the sliver
 * between them = the kerf.
 */
export function ringsToDPath(rings: { x: number; y: number }[][], mmPerUnit: number): string {
  return rings
    .map((r) => contourToDPath(r, true, mmPerUnit))
    .filter((s) => s.length > 0)
    .join(" ");
}

/** Bounding box (in path units) of all rings, after the mm→units conversion. */
function ringsBoundsUnits(
  rings: { x: number; y: number }[][],
  mmPerUnit: number,
): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const r of rings) {
    for (const p of r) {
      const x = p.x / mmPerUnit;
      const y = p.y / mmPerUnit;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  if (!isFinite(minX)) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  return { minX, minY, maxX, maxY };
}

/**
 * Per-stage layer colour palette, keyed by groupName in first-seen order. xTool
 * uses the colour string itself as the layerTag, so each distinct stage becomes
 * a separate operation in the Settings overview. Cycles if a run produces more
 * distinct stage names than palette entries.
 */
const STAGE_PALETTE = [
  "#38bdf8", // seed
  "#f59e0b", // perforate
  "#fb923c", // deepen A
  "#f97316", // deepen B
  "#ea580c", // deepen C
  "#c2410c", // deepen D
  "#84cc16", // clean
];

interface MutableMap<V> {
  dataType: "Map";
  value: Array<[string, V]>;
}

/**
 * Build a new XCS document: deep-clone the original, REMOVE the source incise
 * display + its device.data entry, and APPEND one new PATH display + INTAGLIO
 * processing entry per generated path. Each generated display is a compound
 * even-odd sliver-band (or solid pocket) emitted with `isFill: true`,
 * `fillRule: "evenodd"`, so INTAGLIO fills only the kerf.
 *
 * Each distinct stage groupName becomes its own xTool layer/operation: it gets
 * a stable colour from STAGE_PALETTE (keyed by groupName, first-seen order), a
 * matching `canvas.layerData` entry, and the display's `layerTag`/`layerColor`
 * are set to that colour. The existing `#00befe` layerData entry is preserved
 * (the emboss BITMAP still uses it). Params/processingType are copied from the
 * source incise entry. Emboss + model objects are left untouched. Generated ids
 * are `forge-<operationOrder>`. Returns the new raw JSON object (not serialised).
 */
export function buildGeneratedXcs(
  parsed: ParsedXcs,
  inciseId: string,
  paths: GeneratedPath[],
  mmPerUnit: number,
  stageParams: Record<string, import("./types").StageParams> = {},
): unknown {
  const raw = JSON.parse(JSON.stringify(parsed.raw)) as {
    canvas: Array<{ displays: RawDisplay[]; layerData?: Record<string, LayerDataEntry> }>;
    device: { data: MutableMap<RawGroup & { displays: MutableMap<RawEntry & Record<string, unknown>> }> };
  };

  const incise = parsed.objects.find((o) => o.id === inciseId)!;
  const groupKey = incise.groupKey;
  const canvas = raw.canvas[0];

  // locate the process group + the source display template
  const groupPair = raw.device.data.value.find(([k]) => k === groupKey);
  const sourceTemplateDisplay = canvas.displays.find((d) => d.id === inciseId);
  const sourceEntryPair = groupPair?.[1].displays.value.find(([id]) => id === inciseId);

  // The source display defines the dPath-units → canvas mapping:
  //   canvasX = dPathX * scale.x + offsetX,  canvasY = dPathY * scale.y + offsetY
  // We reuse that exact mapping (scale + offset) for every generated display so
  // geometry lands in the same place, then recompute each display's own
  // x/y/width/height from its geometry bbox. Cloning the source's full-pendant
  // bbox (the previous behaviour) made tiny pockets get fitted into a 26×33mm
  // box → blown up / misplaced, and shifted the bands.
  const srcT = (sourceTemplateDisplay ?? {}) as Record<string, unknown>;
  const srcScale =
    srcT.scale && typeof srcT.scale === "object"
      ? (srcT.scale as { x: number; y: number })
      : { x: 1, y: 1 };
  const offX = typeof srcT.offsetX === "number" ? srcT.offsetX : 0;
  const offY = typeof srcT.offsetY === "number" ? srcT.offsetY : 0;
  const gX = typeof srcT.graphicX === "number" ? srcT.graphicX : offX;
  const gY = typeof srcT.graphicY === "number" ? srcT.graphicY : offY;

  // remove source incise from canvas + device.data
  canvas.displays = canvas.displays.filter((d) => d.id !== inciseId);
  if (groupPair) {
    groupPair[1].displays.value = groupPair[1].displays.value.filter(([id]) => id !== inciseId);
  }

  // assign a stable colour per distinct stage groupName (first-seen order) and
  // register it as its own layer. Keep the existing #00befe entry (emboss).
  canvas.layerData = canvas.layerData ?? {};
  const existingLayers = Object.keys(canvas.layerData).length;
  const tagFor = new Map<string, string>();
  let nextLayerOrder = existingLayers;
  const layerTagForGroup = (groupName: string): string => {
    const existing = tagFor.get(groupName);
    if (existing) return existing;
    const tag = STAGE_PALETTE[tagFor.size % STAGE_PALETTE.length];
    tagFor.set(groupName, tag);
    canvas.layerData![tag] = { name: groupName, order: ++nextLayerOrder, visible: true };
    return tag;
  };

  // append generated displays + processing entries
  for (const path of paths) {
    const id = `forge-${path.operationOrder}`;
    const dPath = ringsToDPath(path.rings, mmPerUnit);
    const tag = layerTagForGroup(path.groupName);

    // Recompute this display's own canvas bbox from its geometry, reusing the
    // source's scale + offset mapping so it stays aligned with the emboss.
    const b = ringsBoundsUnits(path.rings, mmPerUnit);
    const display: RawDisplay = {
      ...(sourceTemplateDisplay ?? ({} as RawDisplay)),
      id,
      type: "PATH",
      name: path.groupName,
      dPath,
      isClosePath: true,
      isFill: true,
      fillRule: "evenodd",
      layerTag: tag,
      layerColor: tag,
      scale: srcScale,
      angle: 0,
      pivot: { x: 0, y: 0 },
      offsetX: offX,
      offsetY: offY,
      graphicX: gX,
      graphicY: gY,
      x: b.minX * srcScale.x + offX,
      y: b.minY * srcScale.y + offY,
      width: (b.maxX - b.minX) * srcScale.x,
      height: (b.maxY - b.minY) * srcScale.y,
    };
    canvas.displays.push(display);

    if (groupPair) {
      // clone the source INTAGLIO entry so params/processingType carry over
      const baseEntry = sourceEntryPair
        ? JSON.parse(JSON.stringify(sourceEntryPair[1]))
        : { isFill: true, type: "PATH", processingType: "INTAGLIO" };
      baseEntry.processingType = "INTAGLIO";
      baseEntry.type = "PATH";
      baseEntry.isFill = true;
      applyStageParams(baseEntry, stageParams[path.groupName]);
      groupPair[1].displays.value.push([id, baseEntry]);
    }
  }

  return raw;
}

/** Apply per-stage param overrides onto a cloned INTAGLIO entry's customize
 *  block. Undefined fields are left at the source value. */
function applyStageParams(
  entry: Record<string, unknown>,
  params: import("./types").StageParams | undefined,
): void {
  if (!params) return;
  const data = entry.data as Record<string, { parameter?: { customize?: Record<string, unknown> } }> | undefined;
  const customize = data?.INTAGLIO?.parameter?.customize;
  if (!customize) return;
  const set = (key: string, v: number | undefined) => {
    if (typeof v === "number" && Number.isFinite(v)) customize[key] = v;
  };
  set("power", params.power);
  set("speed", params.speed);
  set("repeat", params.passes);
  set("zLayers", params.zLayers);
  set("pulseWidth", params.pulseWidth);
  set("mopaFrequency", params.frequency);
}

/** Serialise a built XCS document to UTF-8 bytes (compact JSON, like write_xcs). */
export function exportXcs(xcs: unknown): ArrayBuffer {
  const text = JSON.stringify(xcs);
  return new TextEncoder().encode(text).buffer;
}
