export interface ReliefParams {
  strength: number;       // bilateral spatial radius (px, full-res)
  edgePreserve: boolean;
  edgeThreshold: number;  // 1..255
  spikeRemoval: boolean;
  medianKsize: number;    // 3 | 5
}

export const DEFAULT_RELIEF_PARAMS: ReliefParams = {
  strength: 8,
  edgePreserve: true,
  edgeThreshold: 40,
  spikeRemoval: true,
  medianKsize: 3,
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

/** POST a depth-map blob + params (multipart) and resolve the cleaned PNG blob. */
export async function reliefSmooth(blob: Blob, p: ReliefParams): Promise<Blob> {
  const fd = new FormData();
  fd.append("file", blob, "depth.png");
  fd.append("strength", String(p.strength));
  fd.append("edge_preserve", String(p.edgePreserve));
  fd.append("edge_threshold", String(p.edgeThreshold));
  fd.append("spike_removal", String(p.spikeRemoval));
  fd.append("median_ksize", String(p.medianKsize));
  const res = await fetch("/api/relief/smooth", { method: "POST", body: fd });
  if (!res.ok) throw new Error(`relief smooth failed: ${res.status}`);
  return res.blob();
}

/** Downscale an ImageBitmap to <=maxEdge longest edge, return { blob, ratio }.
 *  ratio is what scaleParamsForPreview() expects. Browser-only (canvas). */
export async function downscaleForPreview(
  bitmap: ImageBitmap,
  maxEdge: number,
): Promise<{ blob: Blob; ratio: number }> {
  const ratio = previewRatio(bitmap.width, bitmap.height, maxEdge);
  const w = Math.max(1, Math.round(bitmap.width * ratio));
  const h = Math.max(1, Math.round(bitmap.height * ratio));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, w, h);
  const blob = await new Promise<Blob>((resolve) =>
    canvas.toBlob((b) => resolve(b!), "image/png"),
  );
  return { blob, ratio };
}
