import type { Subtraction, StretchParams } from "../components/relief/stretch";

export interface ReliefParams {
  strength: number;       // bilateral spatial radius (px, full-res)
  edgePreserve: boolean;
  edgeThreshold: number;  // 1..255
  spikeRemoval: boolean;
  medianKsize: number;    // 3 | 5
  /** Master switch for the smoothing pass — off = use the raw heightfield. */
  smoothEnabled: boolean;
}

export const DEFAULT_RELIEF_PARAMS: ReliefParams = {
  strength: 8,
  edgePreserve: true,
  edgeThreshold: 40,
  spikeRemoval: true,
  medianKsize: 3,
  smoothEnabled: true,
};

/** Longest-edge downscale ratio for a max edge (<=1; 1 if already small). */
export function previewRatio(width: number, height: number, maxEdge: number): number {
  const longest = Math.max(width, height);
  return longest <= maxEdge ? 1 : maxEdge / longest;
}

/** Scale spatial params for a downscaled preview so preview ≈ full-res export.
 *  Thresholds are intensity-domain and stay fixed; only the pixel radius scales. */
export function scaleParamsForPreview(p: ReliefParams, ratio: number): ReliefParams {
  const r = Math.min(1, Math.max(0.01, ratio));
  return { ...p, strength: Math.max(1, Math.round(p.strength * r)) };
}

/** POST a depth-map blob + params (multipart) and resolve the cleaned PNG blob.
 *  ``opts.clahe`` requests backend tile-adaptive local-contrast stretch;
 *  ``opts.background`` requests near-black/white → transparency (LA PNG). The
 *  monotonic tone modes are applied client-side as a LUT, not here. */
export async function reliefSmooth(
  blob: Blob,
  p: ReliefParams,
  opts?: {
    clahe?: { clipLimit: number; tiles: number };
    background?: {
      subtractions: Subtraction[];
      perimeterPct: number; // 0 = off
      trimPct: number;    // 0 = off
      falloffPct: number; // 0 = off
      falloffMode: "inward" | "outward";
      falloffTarget: number;    // 0 (floor) .. 100 (peak) % of tone range
      falloffIntensity: number; // 0..100
      shapeInternal: boolean;
    };
  },
): Promise<Blob> {
  const fd = new FormData();
  fd.append("file", blob, "depth.png");
  fd.append("strength", String(p.strength));
  fd.append("edge_preserve", String(p.edgePreserve));
  fd.append("edge_threshold", String(p.edgeThreshold));
  fd.append("spike_removal", String(p.spikeRemoval));
  fd.append("median_ksize", String(p.medianKsize));
  fd.append("smooth", String(p.smoothEnabled));
  if (opts?.clahe) {
    fd.append("clahe", "true");
    fd.append("clahe_clip", String(opts.clahe.clipLimit));
    fd.append("clahe_tiles", String(opts.clahe.tiles));
  }
  if (opts?.background) {
    const b = opts.background;
    fd.append("remove_bg", "true");
    fd.append(
      "subtractions",
      JSON.stringify(
        b.subtractions.map((s) => ({
          method: s.method,
          threshold: s.threshold,
          color: s.color,
          tolerance: s.tolerance,
          seedX: s.seedX,
          seedY: s.seedY,
        })),
      ),
    );
    fd.append("shape_internal", String(b.shapeInternal));
    fd.append("perimeter_pct", String(b.perimeterPct));
    fd.append("trim_pct", String(b.trimPct));
    fd.append("falloff_pct", String(b.falloffPct));
    fd.append("falloff_mode", b.falloffMode);
    fd.append("falloff_target", String(b.falloffTarget));
    fd.append("falloff_intensity", String(b.falloffIntensity));
  }
  const res = await fetch("/api/relief/smooth", { method: "POST", body: fd });
  if (!res.ok) throw new Error(`relief smooth failed: ${res.status}`);
  return res.blob();
}

/** Background-removal opts — the exact shape `ReliefPage.bgOpts()` returns. */
export interface ReliefBackgroundOpts {
  subtractions: Subtraction[];
  perimeterPct: number;
  trimPct: number;
  falloffPct: number;
  falloffMode: "inward" | "outward";
  falloffTarget: number;
  falloffIntensity: number;
  shapeInternal: boolean;
}

export interface ReliefExportArgs {
  params: ReliefParams;
  stretch: StretchParams;
  background?: ReliefBackgroundOpts;
  expandPct: number;
  padColor: [number, number, number];
  bitDepth: 8 | 16;
}

/** POST the ORIGINAL source bytes + the full param set to the full-precision
 *  backend render and resolve the 8/16-bit PNG blob. Unlike reliefSmooth this
 *  carries the tone mode (applied on the backend, not as a client LUT) and the
 *  bit depth, and sends the unmodified source so 16-bit input is preserved. */
export async function reliefExport(originalBytes: Blob, a: ReliefExportArgs): Promise<Blob> {
  const fd = new FormData();
  fd.append("file", originalBytes, "source.png");
  fd.append("bit_depth", String(a.bitDepth));
  const p = a.params;
  fd.append("strength", String(p.strength));
  fd.append("edge_preserve", String(p.edgePreserve));
  fd.append("edge_threshold", String(p.edgeThreshold));
  fd.append("spike_removal", String(p.spikeRemoval));
  fd.append("median_ksize", String(p.medianKsize));
  fd.append("smooth", String(p.smoothEnabled));
  const s = a.stretch;
  fd.append("tone_mode", s.mode);
  fd.append("clip_low_pct", String(s.clipLowPct));
  fd.append("clip_high_pct", String(s.clipHighPct));
  fd.append("clip_pct", String(s.clipPct));
  fd.append("gamma", String(s.gamma));
  fd.append("asinh_strength", String(s.asinhStrength));
  fd.append("remove_empty_layers", String(s.removeEmptyLayers));
  fd.append("clahe_clip", String(s.claheClipLimit));
  fd.append("clahe_tiles", String(s.claheTiles));
  fd.append("expand_pct", String(a.expandPct));
  fd.append("pad_color", `${a.padColor[0]},${a.padColor[1]},${a.padColor[2]}`);
  if (a.background) {
    const b = a.background;
    fd.append("remove_bg", "true");
    fd.append("subtractions", JSON.stringify(b.subtractions.map((x) => ({
      method: x.method, threshold: x.threshold, color: x.color,
      tolerance: x.tolerance, seedX: x.seedX, seedY: x.seedY,
    }))));
    fd.append("shape_internal", String(b.shapeInternal));
    fd.append("perimeter_pct", String(b.perimeterPct));
    fd.append("trim_pct", String(b.trimPct));
    fd.append("falloff_pct", String(b.falloffPct));
    fd.append("falloff_mode", b.falloffMode);
    fd.append("falloff_target", String(b.falloffTarget));
    fd.append("falloff_intensity", String(b.falloffIntensity));
  }
  const res = await fetch("/api/relief/export", { method: "POST", body: fd });
  if (!res.ok) throw new Error(`relief export failed: ${res.status}`);
  return res.blob();
}

/** RGB at a fractional (0..1) position in an ImageData. Fractions are clamped to
 *  [0,1); used by the eyedropper to map a click on the source image to a pixel. */
export function sampleRgb(
  data: ImageData,
  fracX: number,
  fracY: number,
): [number, number, number] {
  const cx = Math.min(0.999999, Math.max(0, fracX));
  const cy = Math.min(0.999999, Math.max(0, fracY));
  const x = Math.min(data.width - 1, Math.floor(cx * data.width));
  const y = Math.min(data.height - 1, Math.floor(cy * data.height));
  const i = (y * data.width + x) * 4;
  return [data.data[i], data.data[i + 1], data.data[i + 2]];
}

/** A drawable image source with intrinsic pixel dimensions — either the
 *  decoded upload (ImageBitmap) or an expanded/padded copy (canvas). */
export type ReliefSource = ImageBitmap | HTMLCanvasElement;

/** Pad ``src`` by ``padPct``% of each dimension on every side, filling the new
 *  border with ``color``. Returns a canvas (no ImageBitmap lifecycle to manage).
 *  Used by the "Expand canvas" control so an object near the border has room
 *  for an outward berm / offset; the border fills with the background colour so
 *  background removal clears it. ``padPct <= 0`` (or sub-pixel) returns ``src``. */
export function padToCanvas(
  src: ReliefSource,
  padPct: number,
  color: [number, number, number],
): ReliefSource {
  const f = Math.max(0, Math.min(50, padPct)) / 100;
  if (f <= 0) return src;
  const padX = Math.round(src.width * f);
  const padY = Math.round(src.height * f);
  if (padX <= 0 && padY <= 0) return src;
  const c = document.createElement("canvas");
  c.width = src.width + 2 * padX;
  c.height = src.height + 2 * padY;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = `rgb(${color[0]},${color[1]},${color[2]})`;
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(src, padX, padY);
  return c;
}

/** Downscale a source to <=maxEdge longest edge, return { blob, ratio }.
 *  ratio is what scaleParamsForPreview() expects. Browser-only (canvas). */
export async function downscaleForPreview(
  src: ReliefSource,
  maxEdge: number,
): Promise<{ blob: Blob; ratio: number }> {
  const ratio = previewRatio(src.width, src.height, maxEdge);
  const w = Math.max(1, Math.round(src.width * ratio));
  const h = Math.max(1, Math.round(src.height * ratio));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  canvas.getContext("2d")!.drawImage(src, 0, 0, w, h);
  const blob = await new Promise<Blob>((resolve) =>
    canvas.toBlob((b) => resolve(b!), "image/png"),
  );
  return { blob, ratio };
}
