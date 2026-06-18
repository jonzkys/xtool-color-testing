/**
 * Import depth-map / emboss jobs from an xTool Studio ``.xs`` workspace.
 *
 * An ``.xs`` is a ZIP (xcs-workspace-v2). A depth-map / emboss job is a
 * ``BITMAP`` display whose processing type is ``RELIEF`` (emboss, raised) or
 * ``INTAGLIO`` (engraved relief) — both drive engraving from a grayscale
 * height map, which is exactly what the Relief cleaner wants.
 *
 * Layout (per a real export, e.g. CutwithEmboss.xs):
 *   - project.json          → modules.canvases[] (canvas ids)
 *   - canvases/<cid>/displays-<n>.json → { displays: [...] }; BITMAP displays
 *                             carry resourcePath, mm width/height, name
 *   - devices/device-*.json → processing.<cid>.modes.<MODE>.bindings[] →
 *                             { displayIds, baseProfileId }
 *   - profiles.json         → profiles[baseProfileId].processingType
 *   - resources/<hash>.png  → the raster pixels
 *
 * So we resolve ``displayId → processingType`` through the device bindings'
 * ``baseProfileId``, then keep the RELIEF / INTAGLIO bitmaps and read their
 * ``resources/<hash>.png`` bytes. Pure + client-side (``fflate``); no backend.
 */

import { unzipSync, strFromU8 } from "fflate";

/** A relief/emboss raster job recovered from an ``.xs``. */
export interface XsDepthJob {
  /** Display name if present, else a generated "Depth map N". */
  name: string;
  processingType: "RELIEF" | "INTAGLIO";
  /** Placed size on the canvas, millimetres (informational). */
  widthMm: number;
  heightMm: number;
  /** The raster bytes (a PNG) — feed straight into the cleaner. */
  pngBytes: Uint8Array;
}

/** Processing types that consume a grayscale height map (a "depth map"). */
const DEPTH_TYPES = new Set(["RELIEF", "INTAGLIO"]);

/** Wrap a job's raster bytes as a PNG Blob. Copies into a fresh
 *  ArrayBuffer-backed view — fflate yields ``Uint8Array<ArrayBufferLike>``,
 *  which the ``Blob`` constructor's types reject directly. */
export function pngBlob(bytes: Uint8Array): Blob {
  return new Blob([new Uint8Array(bytes)], { type: "image/png" });
}

type Members = Record<string, Uint8Array>;

function readJson(members: Members, path: string): unknown {
  const buf = members[path];
  if (!buf) return null;
  try {
    return JSON.parse(strFromU8(buf));
  } catch {
    return null;
  }
}

/** ``profileId → processingType`` from profiles.json. */
function profileTypes(members: Members): Map<string, string> {
  const out = new Map<string, string>();
  const doc = readJson(members, "profiles.json") as
    | { profiles?: Record<string, { processingType?: string }> }
    | null;
  for (const [id, p] of Object.entries(doc?.profiles ?? {})) {
    if (p?.processingType) out.set(id, p.processingType);
  }
  return out;
}

/** ``displayId → processingType`` by walking every device file's binding graph
 *  (processing.<cid>.modes.<MODE>.bindings[].baseProfileId → profiles). */
function displayTypes(members: Members, profiles: Map<string, string>): Map<string, string> {
  const out = new Map<string, string>();
  for (const path of Object.keys(members)) {
    if (!/^devices\/.*\.json$/.test(path)) continue;
    const dev = readJson(members, path) as
      | { processing?: Record<string, { modes?: Record<string, { bindings?: unknown[] }> }> }
      | null;
    for (const cdata of Object.values(dev?.processing ?? {})) {
      for (const mode of Object.values(cdata?.modes ?? {})) {
        for (const b of mode?.bindings ?? []) {
          const bind = b as { displayIds?: string[]; baseProfileId?: string };
          const pt = bind.baseProfileId ? profiles.get(bind.baseProfileId) : undefined;
          if (!pt) continue;
          for (const did of bind.displayIds ?? []) out.set(did, pt);
        }
      }
    }
  }
  return out;
}

interface RawDisplay {
  id?: string;
  type?: string;
  name?: string | null;
  resourcePath?: string;
  width?: number;
  height?: number;
}

/** Every display across all canvas display chunks. */
function allDisplays(members: Members): RawDisplay[] {
  const out: RawDisplay[] = [];
  for (const path of Object.keys(members)) {
    if (!/^canvases\/[^/]+\/displays-\d+\.json$/.test(path)) continue;
    const doc = readJson(members, path) as { displays?: RawDisplay[] } | null;
    for (const d of doc?.displays ?? []) out.push(d);
  }
  return out;
}

/**
 * Parse an ``.xs`` byte buffer and return its depth-map / emboss jobs (RELIEF
 * or INTAGLIO bitmaps, with their raster bytes). Returns ``[]`` for a workspace
 * with no such jobs. Throws if ``bytes`` is not a readable zip.
 */
export function parseXsDepthMaps(bytes: Uint8Array): XsDepthJob[] {
  const members = unzipSync(bytes); // throws on a non-zip / corrupt archive
  const profiles = profileTypes(members);
  const byDisplay = displayTypes(members, profiles);

  const jobs: XsDepthJob[] = [];
  for (const d of allDisplays(members)) {
    if (d.type !== "BITMAP" || !d.id || !d.resourcePath) continue;
    const pt = byDisplay.get(d.id);
    if (!pt || !DEPTH_TYPES.has(pt)) continue;
    const png = members[d.resourcePath];
    if (!png) continue; // resource missing — skip rather than offer a broken job
    jobs.push({
      name: d.name?.trim() || `Depth map ${jobs.length + 1}`,
      processingType: pt as "RELIEF" | "INTAGLIO",
      widthMm: typeof d.width === "number" ? d.width : 0,
      heightMm: typeof d.height === "number" ? d.height : 0,
      pngBytes: png,
    });
  }
  return jobs;
}
