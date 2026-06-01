// web/src/lib/forge/xs.ts
//
// xcs-workspace-v2 (`.xs`) bundle support for Contour Forge.
//
// The whole Forge pipeline (contour / pipeline / config / xcs.ts) operates on a
// LEGACY-shaped `raw` object: `{canvas:[{displays, layerData}], device:{data:
// <Map>}}`. To support `.xs` without rewriting any of that, this module is a
// pure adapter:
//
//   read:  xsToLegacyRaw(buf) -> { raw: <legacy-shaped>, bundle: <members> }
//   write: legacyRawToXs(raw, bundle) -> ArrayBuffer (a v2 ZIP)
//
// The v2 bundle stores GEOMETRY in `canvases/<cid>/displays-0.json` and laser
// PARAMS in the device file's binding/patch graph (displayId -> binding ->
// patch.overrides). We flatten that two-hop graph into the legacy device.data
// Map shape that `parseXcsFile` already reads, resolve each PATH's geometry to
// an inline `dPath`, and keep every original member so export can repack
// faithfully (resources, cover, meta, project.json, untouched displays).
//
// The python emitter at src/xcs_gen/xcs_v2/{writer,devices,profiles,displays,
// vectors}.py is the authoritative producer of this structure; the field names
// and shapes here mirror it. Verified against samples/xcs/incise_emboss.xs
// (RELIEF_PROCESS: an INTAGLIO contour + a RELIEF heightmap).

import { unzipSync, zipSync, strToU8, strFromU8 } from "fflate";
import { sha256Hex, sha256Bytes } from "./sha256";

/** A retained set of original ZIP members (member name -> raw bytes). */
export type Bundle = Record<string, Uint8Array>;

const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04]; // "PK\x03\x04"

/** True when `buf` looks like a `.xs` (v2 ZIP) bundle rather than legacy JSON.
 *  Detects the ZIP local-file-header magic; a legacy `.xcs` is plain JSON text
 *  (starts with `{`) so this is unambiguous. */
export function isXsBuffer(buf: ArrayBuffer): boolean {
  const bytes = new Uint8Array(buf);
  if (bytes.length < 4) return false;
  for (let i = 0; i < 4; i++) if (bytes[i] !== ZIP_MAGIC[i]) return false;
  // It's a ZIP. Confirm it's a v2 workspace by checking the `.format` member.
  try {
    const members = unzipSync(bytes);
    const fmt = members[".format"];
    if (fmt) return strFromU8(fmt).trim() === "v2";
    // No `.format` but it is a ZIP — accept if it carries the v2 marker files.
    return ".format" in members || "project.json" in members;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// v2 member shapes (only the fields we read/write).
// ---------------------------------------------------------------------------

interface V2Display {
  id: string;
  type: string;
  name?: string | null;
  dPath?: string;
  vectorRef?: { vectorHash: string; bucketType?: string; originalField?: string };
  resourcePath?: string;
  layerColor?: string;
  layerTag?: string;
  [k: string]: unknown;
}
interface V2DisplaysChunk {
  canvasId: string;
  chunkIndex: number;
  displays: V2Display[];
}
interface V2Profile {
  id: string;
  processingType: string;
  values: Record<string, unknown>;
}
interface V2Patch {
  id: string;
  profileId: string;
  overrides?: Record<string, unknown>;
  [k: string]: unknown;
}
interface V2Binding {
  bindingId: string;
  baseProfileId: string;
  patchIds?: string[];
  displayIds?: string[];
  canvasId?: string;
  mode?: string;
  [k: string]: unknown;
}
interface V2Mode {
  ignoredDisplayIds?: string[];
  data?: Record<string, unknown>;
  profileRefs?: string[];
  patches?: Record<string, V2Patch>;
  bindings?: V2Binding[];
}
interface V2DeviceProcessing {
  id: string;
  activeMode: string;
  modes: Record<string, V2Mode>;
}
interface V2Device {
  id: string;
  processing: Record<string, V2DeviceProcessing>;
  [k: string]: unknown;
}

// ---------------------------------------------------------------------------
// Read: .xs -> legacy-shaped raw.
// ---------------------------------------------------------------------------

function decodeJson<T>(bundle: Bundle, name: string): T | undefined {
  const m = bundle[name];
  if (!m) return undefined;
  return JSON.parse(strFromU8(m)) as T;
}

/** Find the single device member name (`devices/device-*.json`). */
function deviceMemberName(bundle: Bundle): string | undefined {
  return Object.keys(bundle).find(
    (k) => k.startsWith("devices/") && k.endsWith(".json"),
  );
}

/** The displays chunk member for a canvas id (chunk 0 only — Forge projects are
 *  single-chunk; the python emitter writes exactly `displays-0.json`). */
function displaysMemberName(canvasId: string): string {
  return `canvases/${canvasId}/displays-0.json`;
}

/** Resolve a display id -> its (processingType, customize-block) by walking the
 *  device binding/patch graph: displayId is found in a binding's displayIds; the
 *  binding's patch `overrides` (falling back to the profile `values`) is the
 *  processing param block. Mirrors devices.py's two-hop resolution. */
function buildDisplayParamIndex(
  device: V2Device | undefined,
  profiles: Record<string, V2Profile>,
): Map<string, { processingType: string; customize: Record<string, unknown> }> {
  const index = new Map<string, { processingType: string; customize: Record<string, unknown> }>();
  if (!device) return index;
  for (const proc of Object.values(device.processing ?? {})) {
    for (const mode of Object.values(proc.modes ?? {})) {
      const patches = mode.patches ?? {};
      for (const binding of mode.bindings ?? []) {
        const profile = profiles[binding.baseProfileId];
        // Prefer the patch overrides (the fully-resolved param set); fall back
        // to the profile values. Both carry the customize block + a trailing
        // `processingType` key.
        const patchId = binding.patchIds?.[0];
        const overrides = patchId ? patches[patchId]?.overrides : undefined;
        const customize = overrides ?? profile?.values ?? {};
        const processingType =
          (customize.processingType as string | undefined) ??
          profile?.processingType ??
          "UNKNOWN";
        for (const did of binding.displayIds ?? []) {
          index.set(did, { processingType, customize: { ...customize } });
        }
      }
    }
  }
  return index;
}

/** Reconstruct the legacy device.data Map from the per-display param index.
 *  Legacy shape: `{dataType:"Map", value:[[canvasId, {mode, displays:{dataType:
 *  "Map", value:[[displayId, entry]]}}]]}` where each entry carries
 *  `{type, processingType, isFill, data:{<MODE>:{parameter:{customize}}}}`.
 *  parseXcsFile reads `entry.data.INTAGLIO.parameter.customize`, so the MODE key
 *  inside `data` must be the processingType (not the device's RELIEF_PROCESS
 *  envelope mode). */
function legacyDeviceData(
  canvasId: string,
  activeMode: string,
  displays: V2Display[],
  paramIndex: Map<string, { processingType: string; customize: Record<string, unknown> }>,
): unknown {
  const displayEntries: Array<[string, unknown]> = [];
  for (const disp of displays) {
    const resolved = paramIndex.get(disp.id);
    if (!resolved) continue; // display with no binding carries no params
    const { processingType, customize } = resolved;
    const isFill = typeof disp.isFill === "boolean" ? disp.isFill : false;
    displayEntries.push([
      disp.id,
      {
        type: disp.type,
        processingType,
        isFill,
        data: {
          [processingType]: { parameter: { customize } },
        },
      },
    ]);
  }
  return {
    dataType: "Map",
    value: [
      [
        canvasId,
        {
          mode: activeMode,
          displays: { dataType: "Map", value: displayEntries },
        },
      ],
    ],
  };
}

/** Resolve a v2 display's geometry to an inline `dPath` string (or undefined for
 *  non-PATH / param-only displays). Inline dPath wins; else look up
 *  `vectorRef.vectorHash` in vectors/svg/data-0.json. */
function resolveDPath(
  disp: V2Display,
  vectorEntries: Record<string, string>,
): string | undefined {
  if (typeof disp.dPath === "string" && disp.dPath.length > 0) return disp.dPath;
  if (disp.vectorRef?.vectorHash) return vectorEntries[disp.vectorRef.vectorHash];
  return undefined;
}

/** Parse a `.xs` bundle into a legacy-shaped `raw` object + the retained member
 *  set (so export can repack faithfully). */
export function xsToLegacyRaw(buf: ArrayBuffer): { raw: unknown; bundle: Bundle } {
  const bundle: Bundle = unzipSync(new Uint8Array(buf));

  const project = decodeJson<{ activeCanvasId?: string }>(bundle, "project.json");
  const deviceName = deviceMemberName(bundle);
  const device = deviceName ? decodeJson<V2Device>(bundle, deviceName) : undefined;
  const profilesDoc = decodeJson<{ profiles?: Record<string, V2Profile> }>(
    bundle,
    "profiles.json",
  );
  const profiles = profilesDoc?.profiles ?? {};

  // Determine the active canvas id (from project.json, else the device, else
  // the only displays-* member present).
  let canvasId = project?.activeCanvasId;
  if (!canvasId && device) canvasId = Object.keys(device.processing ?? {})[0];
  if (!canvasId) {
    const dispKey = Object.keys(bundle).find((k) => k.endsWith("/displays-0.json"));
    canvasId = dispKey?.split("/")[1];
  }
  if (!canvasId) throw new Error("xs bundle has no resolvable canvas id");

  const displaysChunk = decodeJson<V2DisplaysChunk>(
    bundle,
    displaysMemberName(canvasId),
  );
  const v2Displays = displaysChunk?.displays ?? [];

  // Externalized path geometry (only present when some dPath repeats).
  const vectorData = decodeJson<{ entries?: Record<string, string> }>(
    bundle,
    "vectors/svg/data-0.json",
  );
  const vectorEntries = vectorData?.entries ?? {};

  // canvas.layerData (for the legacy canvas object).
  const canvasDoc = decodeJson<{ layerData?: Record<string, unknown> }>(
    bundle,
    `canvases/${canvasId}.json`,
  );

  // Build legacy displays: copy each v2 display, ensure an inline `dPath` for
  // PATHs (so parseXcsFile + the pipeline can read geometry).
  const legacyDisplays = v2Displays.map((disp) => {
    const out: V2Display = { ...disp };
    const dPath = resolveDPath(disp, vectorEntries);
    if (dPath !== undefined) {
      out.dPath = dPath;
      delete out.vectorRef;
    }
    return out;
  });

  const activeMode = device
    ? device.processing[canvasId]?.activeMode ?? "RELIEF_PROCESS"
    : "RELIEF_PROCESS";
  const paramIndex = buildDisplayParamIndex(device, profiles);

  const raw = {
    canvas: [
      {
        displays: legacyDisplays,
        layerData: canvasDoc?.layerData ?? {},
      },
    ],
    device: {
      data: legacyDeviceData(canvasId, activeMode, v2Displays, paramIndex),
    },
    // Sidecar so legacyRawToXs can rebuild the bundle without re-deriving ids.
    __xsMeta: { canvasId, deviceName, activeMode },
  };
  return { raw, bundle };
}

// ---------------------------------------------------------------------------
// Write: legacy-shaped raw + retained bundle -> .xs.
// ---------------------------------------------------------------------------

interface LegacyRaw {
  canvas?: Array<{ displays?: V2Display[]; layerData?: Record<string, unknown> }>;
  device?: { data?: LegacyDeviceData };
  __xsMeta?: { canvasId: string; deviceName?: string; activeMode: string };
}
interface LegacyDeviceData {
  dataType?: string;
  value?: Array<[string, LegacyGroup]>;
}
interface LegacyGroup {
  mode?: string;
  displays?: { dataType?: string; value?: Array<[string, LegacyEntry]> };
}
interface LegacyEntry {
  type?: string;
  processingType?: string;
  isFill?: boolean;
  data?: Record<string, { parameter?: { customize?: Record<string, unknown> } }>;
}

const PROFILE_PREFIX = "profile_";
const PATCH_PREFIX = "patch_";
const BINDING_PREFIX = "binding_";

/** Deterministic short id (8 hex of sha256) matching devices.py / profiles.py. */
function shortId(prefix: string, ...parts: string[]): string {
  return prefix + sha256Hex(parts.join("|")).slice(0, 8);
}

/** profiles.py: profile id = sha256([processingType, values]) sorted-keys JSON. */
function profileId(processingType: string, values: Record<string, unknown>): string {
  const payload = stableJson([processingType, values]);
  return PROFILE_PREFIX + sha256Hex(payload).slice(0, 8);
}

/** JSON with object keys sorted recursively + compact separators — matches
 *  python's `json.dumps(..., sort_keys=True, separators=(",",":"))`. */
function stableJson(v: unknown): string {
  if (Array.isArray(v)) return "[" + v.map(stableJson).join(",") + "]";
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    const keys = Object.keys(o).sort();
    return "{" + keys.map((k) => JSON.stringify(k) + ":" + stableJson(o[k])).join(",") + "}";
  }
  return JSON.stringify(v);
}

const compact = (v: unknown): Uint8Array => strToU8(JSON.stringify(v));

/** Strip the legacy display down to the v2 scene-node shape: inline dPath is
 *  valid (the python emitter inlines single-use paths), so we just drop any
 *  legacy-only sidecar and ensure no stray vectorRef remains. zOrder is
 *  reassigned by index for stable stacking. */
function toV2Display(disp: V2Display, index: number): V2Display {
  const out: V2Display = { ...disp };
  delete out.vectorRef; // we inline dPath
  out.zOrder = index;
  return out;
}

/** Rebuild the device file's binding/patch/profile graph from the legacy
 *  device.data Map. Each display's resolved customize block becomes a profile
 *  `values` + a patch `overrides` + a binding referencing it by displayId.
 *  Mirrors devices.py: profiles dedup on (processingType, values); ids are
 *  content hashes. */
function rebuildDeviceAndProfiles(
  baseDevice: V2Device,
  canvasId: string,
  activeMode: string,
  legacyData: LegacyDeviceData,
): { device: V2Device; profiles: Record<string, V2Profile> } {
  const profiles: Record<string, V2Profile> = {};
  const patches: Record<string, V2Patch> = {};
  const bindingByProfile = new Map<string, V2Binding>();
  const profileOrder: string[] = [];

  const deviceId = baseDevice.id;
  const baseMode: V2Mode =
    baseDevice.processing?.[canvasId]?.modes?.[activeMode] ?? {};
  const modeData = baseMode.data ?? {};
  const planType = (modeData.lightSourceMode as string) === "red" ? "red" : "blue";

  const group = legacyData.value?.find(([k]) => k === canvasId)?.[1];
  const entries = group?.displays?.value ?? [];

  for (const [displayId, entry] of entries) {
    const processingType = entry.processingType ?? "UNKNOWN";
    const customizeRaw =
      entry.data?.[processingType]?.parameter?.customize ?? ({} as Record<string, unknown>);
    // The v2 profile `values` block carries a trailing `processingType` key.
    const values: Record<string, unknown> = { ...customizeRaw };
    if (values.processingType === undefined) values.processingType = processingType;

    const pid = profileId(processingType, values);
    if (!profiles[pid]) {
      profiles[pid] = { id: pid, processingType, values };
      profileOrder.push(pid);
    }

    let binding = bindingByProfile.get(pid);
    if (!binding) {
      const patchId = shortId(PATCH_PREFIX, deviceId, pid);
      patches[patchId] = {
        id: patchId,
        profileId: pid,
        source: "material",
        material: {
          materialType: "customize",
          materialId: 0,
          paramSource: "customParams",
          planType,
        },
        overrides: { ...values },
      };
      binding = {
        bindingId: shortId(BINDING_PREFIX, deviceId, pid),
        baseProfileId: pid,
        patchIds: [patchId],
        displayIds: [],
        canvasId,
        mode: activeMode,
      };
      bindingByProfile.set(pid, binding);
    }
    (binding.displayIds as string[]).push(displayId);
  }

  const profileRefs = profileOrder.slice();
  const bindings = profileOrder.map((pid) => bindingByProfile.get(pid)!);

  const device: V2Device = {
    ...baseDevice,
    processing: {
      ...baseDevice.processing,
      [canvasId]: {
        id: canvasId,
        activeMode,
        modes: {
          [activeMode]: {
            ignoredDisplayIds: baseMode.ignoredDisplayIds ?? [],
            data: modeData,
            profileRefs,
            patches,
            bindings,
          },
        },
      },
    },
  };
  return { device, profiles };
}

/** layerData keyed by lowercase hex, one entry per layer color (writer.py
 *  `_layer_data`). Falls back to the legacy raw's layerData when present. */
function rebuildLayerData(
  displays: V2Display[],
  legacyLayerData: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (legacyLayerData && Object.keys(legacyLayerData).length > 0) {
    return legacyLayerData;
  }
  const layerData: Record<string, unknown> = {};
  let order = 1;
  for (const disp of displays) {
    const color = (disp.layerColor as string) || "";
    if (color && !(color in layerData)) {
      layerData[color] = { name: color.toUpperCase(), order: order++, visible: true };
    }
  }
  return layerData;
}

/** Decode a `data:[mime];base64,<payload>` data URL to raw bytes (or undefined
 *  when the string isn't a base64 data URL). */
function decodeDataUrl(value: unknown): Uint8Array | undefined {
  if (typeof value !== "string") return undefined;
  const comma = value.indexOf(",");
  if (!value.startsWith("data:") || comma < 0) return undefined;
  if (!/;base64/i.test(value.slice(0, comma))) return undefined;
  const b64 = value.slice(comma + 1);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** A tiny valid 16×16 grey PNG, mirroring resources.py `_placeholder_cover_png`.
 *  Used as the project cover when synthesizing a bundle from a legacy `.xcs`
 *  that has no extractable thumbnail. */
const _PLACEHOLDER_COVER_PNG = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAJklEQVR4nO3BAQ0AAADC" +
      "oPdPbQ43oAAAAAAAAAAAAAAAAAAAAADwGzG0AAFhI5VBAAAAAElFTkSuQmCC",
  )
    .split("")
    .map((c) => c.charCodeAt(0)),
);

const _COVER_NAME = "project-cover.png";

function _imageSidecar(ref: string, value: string, withMime: boolean): Uint8Array {
  const metadata: Record<string, unknown> = {
    kind: "image",
    source: { type: "workspace", value },
  };
  if (withMime) metadata.mimeType = "image/png";
  return compact({ ref, metadata });
}

/** Synthesize the resources/* members for a set of raster PNGs (content-
 *  addressed, deduped by sha) plus the literal project cover. Mirrors
 *  resources.py `ResourceStore.members`. */
function synthResources(pngs: Map<string, Uint8Array>): Bundle {
  const out: Bundle = {};
  const coverRef = `resources/${_COVER_NAME}`;
  out[coverRef] = _PLACEHOLDER_COVER_PNG;
  out[`${coverRef}.meta.json`] = _imageSidecar(coverRef, _COVER_NAME, true);
  for (const [sha, data] of pngs) {
    const name = `resources/${sha}.png`;
    out[name] = data;
    out[`${name}.meta.json`] = _imageSidecar(name, `${sha}.png`, false);
  }
  return out;
}

/** Build the `data` block for a device mode, mirroring devices.py `_mode_data`. */
function synthModeData(mode: string): Record<string, unknown> {
  const isRelief = mode === "RELIEF_PROCESS";
  return {
    material: 0,
    lightSourceMode: isRelief ? "red" : "blue",
    thickness: isRelief ? null : null,
    isProcessByLayer: false,
    pathPlanning: "auto",
    fillPlanning: "separate",
    dreedyTsp: false,
    avoidSmokeModal: false,
    scanDirection: "topToBottom",
    enableOddEvenKerf: true,
    xcsUsed: [],
  };
}

const _RELIEF_TYPES = new Set(["INTAGLIO", "RELIEF"]);

/** Synthesize a complete `.xs` bundle from a legacy-shaped raw with NO retained
 *  v2 members (i.e. the Forge input was a legacy `.xcs`). Builds project.json,
 *  meta, .format, canvases/<cid>{,.json}, profiles.json, the device graph, and
 *  extracts each BITMAP display's inline base64 raster into a content-addressed
 *  `resources/<sha>.png` (so emboss heightmaps survive). Mirrors the python
 *  emitter (writer.py / devices.py / resources.py) closely enough for xTool
 *  Studio + the python round-trip to accept it. */
function synthesizeXsFromLegacy(r: LegacyRaw): ArrayBuffer {
  const legacyDisplays = r.canvas?.[0]?.displays ?? [];
  const legacyData = r.device?.data ?? {};
  const group = legacyData.value?.[0];
  const canvasId = group?.[0] ?? "00000000-0000-4000-8000-000000000000";

  const processingTypes = (group?.[1]?.displays?.value ?? []).map(
    ([, e]) => e.processingType ?? "",
  );
  const activeMode = processingTypes.some((pt) => _RELIEF_TYPES.has(pt))
    ? "RELIEF_PROCESS"
    : "LASER_PLANE";

  // Extract inline base64 rasters -> content-addressed PNGs; rewrite each
  // BITMAP display to a resourcePath, matching displays.py.
  const pngs = new Map<string, Uint8Array>();
  const v2Displays = legacyDisplays.map((disp, i) => {
    const out = toV2Display(disp, i);
    const bytes = decodeDataUrl(disp.base64 ?? disp.currentUrl);
    if (bytes) {
      const sha = sha256Bytes(bytes);
      pngs.set(sha, bytes);
      out.resourcePath = `resources/${sha}.png`;
      delete (out as Record<string, unknown>).base64;
    }
    return out;
  });

  // A minimal device skeleton; rebuildDeviceAndProfiles fills in the binding
  // graph from the legacy device.data Map.
  const deviceId = "GS004-CLASS-4-1";
  const skeleton: V2Device = {
    id: deviceId,
    deviceCode: "GS004-CLASS-4",
    extId: "GS004-CLASS-4",
    extName: "F2 Ultra",
    power: [60, 40],
    processing: {
      [canvasId]: {
        id: canvasId,
        activeMode,
        modes: { [activeMode]: { data: synthModeData(activeMode) } },
      },
    },
    customProjectData: {},
  } as V2Device;

  const { device, profiles } = rebuildDeviceAndProfiles(
    skeleton,
    canvasId,
    activeMode,
    legacyData,
  );
  const layerData = rebuildLayerData(v2Displays, r.canvas?.[0]?.layerData);

  const out: Bundle = {};
  out[".format"] = strToU8("v2");
  out["meta/persistence-meta.json"] = compact({
    schemaVersion: "2.0.0",
    protocol: "xcs-workspace-v2",
  });
  out["project.json"] = compact({
    __v2__: true,
    version: "2.0.0",
    schemaMeta: { schemaVersion: "2", format: "directory", migratedFrom: "v1", migratedAt: 0 },
    projectId: canvasId,
    projectTraceID: canvasId,
    projectName: "contour-forge",
    activeCanvasId: canvasId,
    activeDeviceId: deviceId,
    versionInfo: {
      source: "web",
      appVersion: "1.7.24",
      savedAt: 0,
      minRequiredVersion: "2.6.0",
      appMinRequiredVersion: "",
      webMinRequiredVersion: "",
    },
    created: 0,
    modify: 0,
    modules: { canvases: [canvasId], devices: [deviceId] },
    cover: `resources/${_COVER_NAME}`,
    customProjectData: { projectTraceID: canvasId },
  });
  out["profiles.json"] = compact({ profiles });
  out[`devices/device-${deviceId}.json`] = compact(device);
  out[`canvases/${canvasId}.json`] = compact({
    id: canvasId,
    title: "{panel}1",
    hidden: false,
    layerData,
    groupData: {},
    extendInfo: {
      version: "2.16.1",
      minCanvasVersion: "0.0.0",
      displayProcessConfigMap: {},
      rulerPluginData: { rulerGuide: [] },
      type: "2d",
    },
    chunkLayout: { displayCount: v2Displays.length, chunkCount: 1, chunkIndexes: [0] },
  });
  out[displaysMemberName(canvasId)] = compact({
    canvasId,
    chunkIndex: 0,
    displays: v2Displays,
  });
  Object.assign(out, synthResources(pngs));

  const zipped = zipSync(out, { level: 6 });
  return zipped.buffer.slice(zipped.byteOffset, zipped.byteOffset + zipped.byteLength);
}

/** Build a `.xs` ZIP from a (possibly Forge-modified) legacy-shaped raw.
 *
 *  When `bundle` is provided (the input was already `.xs`), repack faithfully:
 *  keep resources / meta / .format / cover and the untouched project.json, and
 *  regenerate displays-0.json, profiles.json, the device file, and
 *  canvases/<cid>.json. When `bundle` is null (the input was legacy `.xcs`),
 *  synthesize a fresh bundle from scratch (extracting inline base64 rasters into
 *  the resource store). */
export function legacyRawToXs(raw: unknown, bundle: Bundle | null): ArrayBuffer {
  const r = raw as LegacyRaw;
  if (!bundle) return synthesizeXsFromLegacy(r);

  const meta = r.__xsMeta;
  const canvasId =
    meta?.canvasId ??
    decodeJson<{ activeCanvasId?: string }>(bundle, "project.json")?.activeCanvasId;
  if (!canvasId) throw new Error("cannot repack .xs: no canvas id");

  const deviceName = meta?.deviceName ?? deviceMemberName(bundle);
  const baseDevice = deviceName ? decodeJson<V2Device>(bundle, deviceName) : undefined;
  if (!deviceName || !baseDevice) throw new Error("cannot repack .xs: no device member");
  const activeMode =
    meta?.activeMode ?? baseDevice.processing?.[canvasId]?.activeMode ?? "RELIEF_PROCESS";

  const legacyDisplays = r.canvas?.[0]?.displays ?? [];
  const v2Displays = legacyDisplays.map((d, i) => toV2Display(d, i));

  const { device, profiles } = rebuildDeviceAndProfiles(
    baseDevice,
    canvasId,
    activeMode,
    r.device?.data ?? {},
  );

  const layerData = rebuildLayerData(v2Displays, r.canvas?.[0]?.layerData);

  // Start from the retained members so resources / cover / meta / .format /
  // project.json survive verbatim, then overwrite the regenerated ones.
  const out: Bundle = { ...bundle };
  // never carry our sidecar into output
  delete (out as Record<string, unknown>).__xsMeta;

  out[displaysMemberName(canvasId)] = compact({
    canvasId,
    chunkIndex: 0,
    displays: v2Displays,
  });
  out["profiles.json"] = compact({ profiles });
  out[deviceName] = compact(device);

  // canvases/<cid>.json: reuse the retained one, refreshing layerData + count.
  const canvasDoc =
    decodeJson<Record<string, unknown>>(bundle, `canvases/${canvasId}.json`) ?? {
      id: canvasId,
      title: "{panel}1",
      hidden: false,
      groupData: {},
      extendInfo: {
        version: "2.16.1",
        minCanvasVersion: "0.0.0",
        displayProcessConfigMap: {},
        rulerPluginData: { rulerGuide: [] },
        type: "2d",
      },
    };
  canvasDoc.layerData = layerData;
  canvasDoc.chunkLayout = {
    displayCount: v2Displays.length,
    chunkCount: 1,
    chunkIndexes: [0],
  };
  out[`canvases/${canvasId}.json`] = compact(canvasDoc);

  // Ensure the v2 marker member is present.
  if (!out[".format"]) out[".format"] = strToU8("v2");

  // Drop the empty zero-length directory entries (fflate recreates the tree
  // from the member paths; keeping/omitting them is valid per the spec). We
  // keep any non-directory members and re-zip.
  const zipInput: Record<string, Uint8Array> = {};
  for (const [name, data] of Object.entries(out)) {
    if (name.endsWith("/")) continue; // skip dir entries; paths imply the tree
    zipInput[name] = data;
  }

  const zipped = zipSync(zipInput, { level: 6 });
  return zipped.buffer.slice(zipped.byteOffset, zipped.byteOffset + zipped.byteLength);
}
