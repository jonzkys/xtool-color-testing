// web/src/lib/forge/xcs.ts
import type { Contour, GeneratedPath, ParsedXcs, XcsObject } from "./types";
import { flattenDPath, normaliseContour, splitSubpaths } from "./contour";

const INCISE_TYPES = new Set(["INTAGLIO", "VECTOR_CUTTING"]);
const EMBOSS_TYPES = new Set(["RELIEF"]);
const SCORE_TYPES = new Set([
  "VECTOR_ENGRAVING",
  "FILL_VECTOR_ENGRAVING",
  "COLOR_FILL_ENGRAVE",
]);

/** Map an INTAGLIO `customize` block to the StageParams we expose.
 *  Reads from the `INTAGLIO` customize block; VECTOR_CUTTING incise targets
 *  (not used in the current F2 Ultra Embossment workflow) would yield `undefined`. */
function readStageParams(customize: Record<string, unknown> | undefined): import("./types").StageParams | undefined {
  if (!customize) return undefined;
  const num = (k: string) => (typeof customize[k] === "number" ? (customize[k] as number) : undefined);
  const laser = customize.processingLightSource;
  return {
    power: num("power"),
    speed: num("speed"),
    passes: num("repeat"),
    pulseWidth: num("pulseWidth"),
    frequency: num("mopaFrequency"),
    density: num("density"),
    laser: laser === "red" || laser === "blue" ? laser : undefined,
    zAxisMove: typeof customize.zAxisMove === "boolean" ? customize.zAxisMove : undefined,
    zLayers: num("zLayers"),
    zDecline: num("zDecline"),
    sliceNumber: num("sliceNumber"),
  };
}

const KAPPA = 0.5522847498307936; // bezier circle constant
const fmtNum = (v: number) => String(Number(v.toFixed(4)));

/**
 * Synthesize a closed dPath (in the display's path-unit space) for primitive
 * shapes (RECT / CIRCLE / ELLIPSE) that carry no `dPath`. The pipeline treats
 * a dPath as path-units that get multiplied by the display's `scale.x` to
 * reach canvas-mm (`canvasX = unit·scale.x + offsetX`). `width`/`height` are
 * canvas-mm (post-scale), so the synthesized path must be authored in
 * path-units = canvas-mm ÷ scale. Returns undefined for unknown / zero-size shapes.
 * NOTE: circle/ellipse use the width/height bounding box (inferred — no sample
 * to verify against yet); rotation (`angle`) is not applied (a known limit,
 * same as for PATH displays).
 */
export function primitiveDPath(disp: RawDisplay): string | undefined {
  const wMm = typeof disp.width === "number" ? disp.width : 0;
  const hMm = typeof disp.height === "number" ? disp.height : 0;
  if (!(wMm > 0) || !(hMm > 0)) return undefined;
  // width/height/radius are canvas-mm (post-scale); the pipeline treats a dPath
  // as path-units multiplied by the display's scale to reach mm. So author the
  // synthesized path in path-units = canvas-mm / scale.
  const sc = disp.scale as { x?: number; y?: number } | undefined;
  const sx = typeof sc?.x === "number" && sc.x !== 0 ? sc.x : 1;
  const sy = typeof sc?.y === "number" && sc.y !== 0 ? sc.y : 1;
  const w = wMm / sx;
  const h = hMm / sy;
  const type = (disp.type ?? "").toUpperCase();
  const f = fmtNum;
  if (type === "RECT") {
    let r = typeof disp.radius === "number" ? disp.radius / sx : 0;
    r = Math.max(0, Math.min(r, Math.min(w, h) / 2));
    if (r <= 0) return `M0,0 L${f(w)},0 L${f(w)},${f(h)} L0,${f(h)} Z`;
    const k = r * KAPPA;
    return [
      `M${f(r)},0`,
      `L${f(w - r)},0`,
      `C${f(w - r + k)},0 ${f(w)},${f(r - k)} ${f(w)},${f(r)}`,
      `L${f(w)},${f(h - r)}`,
      `C${f(w)},${f(h - r + k)} ${f(w - r + k)},${f(h)} ${f(w - r)},${f(h)}`,
      `L${f(r)},${f(h)}`,
      `C${f(r - k)},${f(h)} 0,${f(h - r + k)} 0,${f(h - r)}`,
      `L0,${f(r)}`,
      `C0,${f(r - k)} ${f(r - k)},0 ${f(r)},0`,
      "Z",
    ].join(" ");
  }
  if (type === "CIRCLE" || type === "ELLIPSE") {
    const rx = w / 2, ry = h / 2, kx = (w / 2) * KAPPA, ky = (h / 2) * KAPPA;
    return [
      `M${f(rx)},0`,
      `C${f(rx + kx)},0 ${f(w)},${f(ry - ky)} ${f(w)},${f(ry)}`,
      `C${f(w)},${f(ry + ky)} ${f(rx + kx)},${f(h)} ${f(rx)},${f(h)}`,
      `C${f(rx - kx)},${f(h)} 0,${f(ry + ky)} 0,${f(ry)}`,
      `C0,${f(ry - ky)} ${f(rx - kx)},0 ${f(rx)},0`,
      "Z",
    ].join(" ");
  }
  return undefined;
}

/** Classify a layer by its device-map processingType. Exported for testing. */
export function classify(pt: string | null): XcsObject["modeClass"] {
  if (pt && INCISE_TYPES.has(pt)) return "incise";
  if (pt && EMBOSS_TYPES.has(pt)) return "emboss";
  if (pt && SCORE_TYPES.has(pt)) return "score";
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
      // Device-map entries can reference displays that no longer exist on the
      // canvas (orphan sub-entries of a compound path). They carry no geometry
      // and can be neither a cut target nor a visible layer — skip them. They
      // remain byte-intact in `raw`, so export still preserves them.
      if (!disp) continue;
      const processingType = entry.processingType ?? null;
      const modeClass = classify(processingType);
      const entryData = (entry as { data?: Record<string, { parameter?: { customize?: Record<string, unknown> } }> }).data;
      const customize = entryData?.INTAGLIO?.parameter?.customize;
      const params = modeClass === "incise" ? readStageParams(customize) : undefined;
      const sourceScanAngleDeg =
        modeClass === "incise" && typeof customize?.processAngle === "number"
          ? (customize.processAngle as number)
          : undefined;
      const dPath = disp.dPath ?? primitiveDPath(disp);
      objects.push({
        id: displayId,
        type: disp.type ?? entry.type ?? "UNKNOWN",
        name: disp.name ?? null,
        processingType,
        modeClass,
        dPath,
        hasGeometry: !!dPath,
        params,
        sourceScanAngleDeg,
        groupKey,
      });
    }
  }

  const parsed: ParsedXcs = {
    raw,
    objects,
    emboss: objects.filter((o) => o.modeClass === "emboss"),
    incise: objects.filter((o) => o.modeClass === "incise"),
    targets: objects.filter((o) => o.modeClass === "incise" && o.hasGeometry),
    preserved: objects.filter((o) => o.modeClass !== "incise"),
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
 * Derive path-units → mm for the selected incise contour.
 *
 * The xTool canvas is in millimetres and a display maps its path units to the
 * canvas via `canvasX = unit·scale.x + offsetX` — so the display's own
 * `scale.x` IS the units→mm factor (cross-checked by `width / bbox-width`).
 * The old `RELIEF_PROCESS.perimeter` method was wrong: that perimeter
 * describes the emboss, not the incise contour, and made kerf bands ~3.57×
 * too wide. Falls back to 1.0 + not-confident only when neither scale nor
 * width is available (caller surfaces a warning + manual override).
 */
export function calibrateMmPerUnit(p: ParsedXcs, incise: XcsObject): Calibration {
  const raw = p.raw as { canvas?: Array<{ displays?: Array<Record<string, unknown>> }> };
  const disp = (raw.canvas?.[0]?.displays ?? []).find((d) => d.id === incise.id) as
    | { scale?: { x?: number; y?: number }; width?: number }
    | undefined;

  // 1. Uniform display scale = path-units → bed-mm. Authoritative.
  const sx = disp?.scale?.x;
  const sy = disp?.scale?.y;
  if (typeof sx === "number" && sx > 0 && (typeof sy !== "number" || Math.abs(sx - sy) < 1e-6)) {
    return { mmPerUnit: sx, confident: true };
  }

  // 2. Real-world width ÷ flattened-bbox width (missing/anisotropic scale).
  const w = disp?.width;
  if (typeof w === "number" && w > 0) {
    let minX = Infinity;
    let maxX = -Infinity;
    for (const c of extractContourSubpaths(incise)) {
      for (const pt of c.points) {
        if (pt.x < minX) minX = pt.x;
        if (pt.x > maxX) maxX = pt.x;
      }
    }
    const bboxW = maxX - minX;
    if (Number.isFinite(bboxW) && bboxW > 0) return { mmPerUnit: w / bboxW, confident: true };
  }

  // 3. No usable signal.
  return { mmPerUnit: 1, confident: false };
}

/** Serialise a mm-space contour back to a dPath string in path units. */
export function contourToDPath(points: { x: number; y: number }[], closed: boolean, mmPerUnit: number): string {
  if (points.length === 0) return "";
  const m = mmPerUnit > 0 ? mmPerUnit : 1; // non-positive would divide to Infinity
  const u = (v: number) => +(v / m).toFixed(4);
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

/**
 * xTool Studio silently drops a single vector path above ~1570 coordinate
 * pairs on import (its own exporter never emits more — see samples/Pikachu2).
 * A long continuous spiral easily exceeds that, so a polyline over the cap is
 * split into contiguous chunks before export. Each chunk overlaps its
 * neighbour by one point, so the laser re-enters exactly where it left off and
 * the channel stays continuous across the (negligible) lift.
 */
export const MAX_PATH_POINTS = 1500;

function chunkPolyline(pts: { x: number; y: number }[], max: number): { x: number; y: number }[][] {
  if (pts.length <= max) return [pts];
  const chunks: { x: number; y: number }[][] = [];
  for (let start = 0; start < pts.length - 1; ) {
    const end = Math.min(start + max, pts.length);
    chunks.push(pts.slice(start, end));
    start = end - 1; // share the seam vertex with the next chunk
  }
  return chunks;
}

/** How many chunks a polyline of `n` points splits into at cap `max` — kept in
 *  lockstep with `chunkPolyline` (verified by test) so the UI can predict the
 *  export object count without building the chunks. */
export function chunkCount(n: number, max: number): number {
  const cap = max > 0 ? max : MAX_PATH_POINTS;
  if (n <= cap) return 1;
  return Math.ceil((n - 1) / (cap - 1));
}

/** Whether all spiral strands (their point counts) fit in one joined cut object
 *  at cap `max` — i.e. the total is within the per-path cap so joining is possible. */
export function spiralStrandsJoinable(pointCounts: number[], max: number): boolean {
  const cap = max > 0 ? max : MAX_PATH_POINTS;
  const total = pointCounts.reduce((a, b) => a + b, 0);
  return total > 0 && total <= cap;
}

/** Predicted number of exported spiral cut objects for the readout, matching
 *  buildGeneratedXcs: one object when joining and the strands fit the cap;
 *  otherwise the sum of per-strand chunks. */
export function spiralExportObjectCount(pointCounts: number[], max: number, joinStrands: boolean): number {
  if (joinStrands && spiralStrandsJoinable(pointCounts, max)) return 1;
  return pointCounts.reduce((s, n) => s + chunkCount(n, max), 0);
}

/** Bounding box (in path units) of all rings, after the mm→units conversion. */
function ringsBoundsUnits(
  rings: { x: number; y: number }[][],
  mmPerUnit: number,
): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const m = mmPerUnit > 0 ? mmPerUnit : 1; // non-positive would divide to Infinity
  for (const r of rings) {
    for (const p of r) {
      const x = p.x / m;
      const y = p.y / m;
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
 * are set to that colour. Any pre-existing layerData entries (e.g. an emboss
 * BITMAP's `#00befe`) are preserved if present. Params/processingType are
 * copied from the
 * source incise entry. Emboss + model objects are left untouched. Generated ids
 * are `forge-<operationOrder>`. Returns the new raw JSON object (not serialised).
 */
export function buildGeneratedXcs(
  parsed: ParsedXcs,
  inciseId: string,
  paths: GeneratedPath[],
  mmPerUnit: number,
  stageParams: Record<string, import("./types").StageParams> = {},
  scanAngleDeg?: number,
  userOrder = false,
  maxPathPoints: number = MAX_PATH_POINTS,
  joinStrands = false,
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

  // A1: If any path is a spiral, export ONLY spiral paths (drop the rest) so the
  // job stays flat LASER_PLANE mode; mixed jobs become spiral-only, matching the
  // pipeline's standalone warning.
  const gen = paths.some((p) => p.generatedClass === "spiral")
    ? paths.filter((p) => p.generatedClass === "spiral")
    : paths;

  // Split any spiral arm that would exceed the Studio per-path cap into
  // contiguous chunks. Chunk 0 keeps the plain `forge-N` id so output for
  // arms that fit is byte-identical; overflow chunks get `forge-N-k`.
  const cap = maxPathPoints > 0 ? maxPathPoints : MAX_PATH_POINTS;
  const spiralGen = gen.filter((p) => p.generatedClass === "spiral");
  const joinable =
    joinStrands && spiralStrandsJoinable(spiralGen.map((p) => p.rings[0]?.length ?? 0), cap);
  const genExpanded: Array<{ path: GeneratedPath; chunkIndex: number }> = [];
  if (joinable) {
    // Merge every spiral strand into ONE display: a multi-subpath polyline (the
    // laser lifts between disconnected strands). One cut object → continuous
    // focus descent across all pieces. rings = all strand polylines.
    genExpanded.push({
      path: { ...spiralGen[0], rings: spiralGen.map((p) => p.rings[0] ?? []) },
      chunkIndex: 0,
    });
  } else {
    for (const path of gen) {
      if (path.generatedClass === "spiral" && (path.rings[0]?.length ?? 0) > cap) {
        chunkPolyline(path.rings[0], cap).forEach((chunk, i) =>
          genExpanded.push({ path: { ...path, rings: [chunk] }, chunkIndex: i }),
        );
      } else {
        genExpanded.push({ path, chunkIndex: 0 });
      }
    }
  }

  // append generated displays + processing entries
  for (const { path, chunkIndex } of genExpanded) {
    const id = chunkIndex === 0 ? `forge-${path.operationOrder}` : `forge-${path.operationOrder}-${chunkIndex}`;
    const isSpiral = path.generatedClass === "spiral";
    const tag = layerTagForGroup(path.groupName);

    let dPath: string;
    let display: RawDisplay;
    let baseEntry: Record<string, unknown>;

    if (isSpiral) {
      // A2: Spiral path — open polyline, no fill, no fillRule. One ring normally;
      // a joined strand-set emits each ring as its own subpath (M…), so the laser
      // lifts between disconnected strands within the single cut object.
      dPath = path.rings.map((r) => contourToDPath(r ?? [], false, mmPerUnit)).join(" ");
      const b = ringsBoundsUnits(path.rings, mmPerUnit);
      display = {
        ...(sourceTemplateDisplay ?? ({} as RawDisplay)),
        id,
        type: "PATH",
        name: path.groupName,
        dPath,
        isClosePath: false,
        isFill: false,
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
      // Strip fillRule if it was carried over from the template.
      delete display.fillRule;

      // A3: Fresh VECTOR_CUTTING entry with flat-mode defaults.
      const vc_customize: Record<string, unknown> = {
        processingLightSource: "red",
        power: 100,
        speed: 1500,
        repeat: path.layerEnd, // = cfg.spiral.passes; applyStageParams may override
        pulseWidth: 80,
        mopaFrequency: 65,
        cuttingDrop: true,
        // "step" = stepwise descent (descentPerStep every descentIntervalDescent
        // passes). resolveStageParams overrides these with the live config; this
        // is just the standalone default. (Studio enum: J.ONE="one"/J.STEP="step".)
        sinkingMethod: "step",
        firstCuttingDropValue: 0.01, // initial focus drop; resolveStageParams overrides
        cuttingDropValue: 0.01,
        descentIntervalDescent: 10,
        descentPerStep: 0.06,
        enableKerf: false,
        kerfDistance: 0,
        enableBreakPoint: false,
        breakPointGenMode: "auto",
        breakPointSize: 0.5,
        breakPointCount: 2,
        breakPointMode: "count",
        breakPointDistance: 100,
        breakPointPower: 0,
        wobbleEnable: false,
        wobbleDiameter: 0.05,
        wobbleSpacing: 0.015,
      };
      baseEntry = {
        isFill: false,
        type: "PATH",
        processingType: "VECTOR_CUTTING",
        data: {
          VECTOR_CUTTING: {
            materialType: "customize",
            planType: "blue",
            parameter: { customize: vc_customize },
          },
        },
        processIgnore: false,
        isWhiteModel: true,
      };
    } else {
      // Non-spiral path — keep existing INTAGLIO/closed-fill behaviour.
      dPath = ringsToDPath(path.rings, mmPerUnit);
      const b = ringsBoundsUnits(path.rings, mmPerUnit);
      display = {
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
      // clone the source INTAGLIO entry so params/processingType carry over
      baseEntry = sourceEntryPair
        ? JSON.parse(JSON.stringify(sourceEntryPair[1]))
        : { isFill: true, type: "PATH", processingType: "INTAGLIO" };
      baseEntry.processingType = "INTAGLIO";
      baseEntry.type = "PATH";
      baseEntry.isFill = true;
    }

    canvas.displays.push(display);

    if (groupPair) {
      // A4: apply stage param overrides (handles both INTAGLIO and VECTOR_CUTTING).
      applyStageParams(baseEntry, stageParams[path.groupName]);
      // Global speed-optimal scan angle (INTAGLIO only — VECTOR_CUTTING has no processAngle).
      if (!isSpiral && typeof scanAngleDeg === "number" && Number.isFinite(scanAngleDeg)) {
        const customize = (baseEntry.data as Record<string, { parameter?: { customize?: Record<string, unknown> } }> | undefined)
          ?.INTAGLIO?.parameter?.customize;
        if (customize) customize.processAngle = Math.round(scanAngleDeg);
      }
      groupPair[1].displays.value.push([id, baseEntry]);
    }
  }

  // Spiral cut is a flat-mode (LASER_PLANE) job: any remaining INTAGLIO/RELIEF
  // (incise/emboss) object would force the whole job into Embossment mode, where
  // VECTOR_CUTTING is "Not supported". Drop those device entries + their canvas
  // displays so the cut opens correctly; emboss/incise run as a separate job.
  if (paths.some((p) => p.generatedClass === "spiral")) {
    const EMBOSSMENT_TYPES = new Set(["INTAGLIO", "RELIEF"]);
    const droppedIds = new Set<string>();
    for (const [, grp] of raw.device.data.value) {
      grp.displays.value = grp.displays.value.filter(([id, entry]) => {
        const pt = (entry as { processingType?: string }).processingType ?? "";
        if (EMBOSSMENT_TYPES.has(pt)) {
          droppedIds.add(id);
          return false;
        }
        return true;
      });
    }
    if (droppedIds.size > 0) {
      canvas.displays = canvas.displays.filter((d) => !droppedIds.has(d.id));
    }
  }

  // Planning flags (legacy .xcs mode block): cut-shortest-first needs the machine
  // to honour the authored display order — By Layer + user-defined ("custom")
  // planning — instead of optimising it. Forge owns these flags, so set them
  // deterministically on every mode block. .xs-sourced raws carry no group-level
  // data block ({mode, displays} only), so synthesize a minimal one keyed by the
  // group's mode — but ONLY when the flags are needed, so an off export leaves
  // the prior .xs→.xcs output unchanged.
  for (const [, grp] of raw.device.data.value) {
    const g = grp as { mode?: string; data?: Record<string, unknown> };
    let data = g.data;
    if (!data || typeof data !== "object") {
      if (!userOrder) continue;
      data = { [g.mode ?? "LASER_PLANE"]: {} };
      g.data = data;
    }
    for (const modeKey of Object.keys(data)) {
      const block = data[modeKey];
      if (block && typeof block === "object") {
        (block as Record<string, unknown>).isProcessByLayer = userOrder;
        (block as Record<string, unknown>).pathPlanning = userOrder ? "custom" : "auto";
      }
    }
  }

  // Layer cut order. The machine processes layers in DESCENDING layerData.order
  // (verified on hardware: a By-Layer job with internal=order 1 / external=order 2
  // cut the EXTERNAL layer first). Arms are emitted in intended cut order, so the
  // first-seen group must get the HIGHEST order to cut first. layerTagForGroup
  // assigns ascending (first-seen lowest), so flip the generated layers when we
  // own the order (userOrder). Off → leave ascending (auto planning ignores it).
  if (userOrder) {
    const tags = [...tagFor.values()]; // first-seen order
    const n = tags.length;
    tags.forEach((tag, i) => {
      const ld = canvas.layerData![tag] as LayerDataEntry | undefined;
      if (ld) ld.order = existingLayers + (n - i); // first-seen (i=0) → highest
    });
  }

  return raw;
}

/** Apply per-stage param overrides onto a cloned entry's customize block.
 *  Supports both INTAGLIO and VECTOR_CUTTING entries (looks up whichever mode
 *  key is present). Undefined fields are left at the source value. */
function applyStageParams(
  entry: Record<string, unknown>,
  params: import("./types").StageParams | undefined,
): void {
  if (!params) return;
  const data = entry.data as Record<string, { parameter?: { customize?: Record<string, unknown> } }> | undefined;
  // Resolve customize from whichever mode key is present (INTAGLIO or VECTOR_CUTTING).
  const customize =
    data?.INTAGLIO?.parameter?.customize ??
    data?.VECTOR_CUTTING?.parameter?.customize;
  if (!customize) return;
  const set = (key: string, v: number | undefined) => {
    if (typeof v === "number" && Number.isFinite(v)) customize[key] = v;
  };
  const setStr = (key: string, v: string | undefined) => {
    if (typeof v === "string" && v) customize[key] = v;
  };
  const setBool = (key: string, v: boolean | undefined) => {
    if (typeof v === "boolean") customize[key] = v;
  };
  set("power", params.power);
  set("speed", params.speed);
  set("repeat", params.passes);
  set("pulseWidth", params.pulseWidth);
  set("mopaFrequency", params.frequency);
  set("density", params.density);
  setStr("processingLightSource", params.laser);
  setBool("zAxisMove", params.zAxisMove);
  set("zLayers", params.zLayers);
  set("zDecline", params.zDecline);
  set("sliceNumber", params.sliceNumber);
  // VECTOR_CUTTING focus-step fields (spiral job).
  setBool("cuttingDrop", params.cuttingDrop);
  setStr("sinkingMethod", params.sinkingMethod);
  set("descentIntervalDescent", params.descentIntervalDescent);
  set("descentPerStep", params.descentPerStep);
  set("firstCuttingDropValue", params.firstCuttingDropValue);
  set("cuttingDropValue", params.cuttingDropValue);
}

/** Serialise a built XCS document to UTF-8 bytes (compact JSON, like write_xcs). */
export function exportXcs(xcs: unknown): ArrayBuffer {
  const text = JSON.stringify(xcs);
  return new TextEncoder().encode(text).buffer;
}
