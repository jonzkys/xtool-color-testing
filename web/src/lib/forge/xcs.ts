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

interface MutableMap<V> {
  dataType: "Map";
  value: Array<[string, V]>;
}

/**
 * Build a new XCS document: deep-clone the original, REMOVE the source incise
 * display + its device.data entry, and APPEND one new PATH display + INTAGLIO
 * processing entry per generated path (params copied from the source incise
 * object). Emboss + model objects are left untouched. Generated ids are
 * `forge-<operationOrder>` so tests/preview can find them. Returns the new
 * raw JSON object (not yet serialised).
 */
export function buildGeneratedXcs(
  parsed: ParsedXcs,
  inciseId: string,
  paths: GeneratedPath[],
  mmPerUnit: number,
): unknown {
  const raw = JSON.parse(JSON.stringify(parsed.raw)) as {
    canvas: Array<{ displays: RawDisplay[] }>;
    device: { data: MutableMap<RawGroup & { displays: MutableMap<RawEntry & Record<string, unknown>> }> };
  };

  const incise = parsed.objects.find((o) => o.id === inciseId)!;
  const groupKey = incise.groupKey;

  // locate the process group + the source display template
  const groupPair = raw.device.data.value.find(([k]) => k === groupKey);
  const sourceTemplateDisplay = raw.canvas[0].displays.find((d) => d.id === inciseId);
  const sourceEntryPair = groupPair?.[1].displays.value.find(([id]) => id === inciseId);

  // remove source incise from canvas + device.data
  raw.canvas[0].displays = raw.canvas[0].displays.filter((d) => d.id !== inciseId);
  if (groupPair) {
    groupPair[1].displays.value = groupPair[1].displays.value.filter(([id]) => id !== inciseId);
  }

  // append generated displays + processing entries
  for (const path of paths) {
    const id = `forge-${path.operationOrder}`;
    const dPath = contourToDPath(path.points, path.closed, mmPerUnit);

    const display: RawDisplay = {
      ...(sourceTemplateDisplay ?? ({} as RawDisplay)),
      id,
      type: "PATH",
      name: path.groupName,
      dPath,
      isClosePath: path.closed,
    };
    raw.canvas[0].displays.push(display);

    if (groupPair) {
      // clone the source INTAGLIO entry so params/processingType carry over
      const baseEntry = sourceEntryPair
        ? JSON.parse(JSON.stringify(sourceEntryPair[1]))
        : { isFill: true, type: "PATH", processingType: "INTAGLIO" };
      baseEntry.processingType = "INTAGLIO";
      baseEntry.type = "PATH";
      groupPair[1].displays.value.push([id, baseEntry]);
    }
  }

  return raw;
}

/** Serialise a built XCS document to UTF-8 bytes (compact JSON, like write_xcs). */
export function exportXcs(xcs: unknown): ArrayBuffer {
  const text = JSON.stringify(xcs);
  return new TextEncoder().encode(text).buffer;
}
