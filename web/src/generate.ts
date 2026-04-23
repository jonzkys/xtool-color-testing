import type { DetectedLayer, SvgLayersRequest, SvgStackRequest } from "./types";

async function postAndDownload(endpoint: string, body: unknown, filename: string): Promise<void> {
  const resp = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    let detail = `HTTP ${resp.status}`;
    try {
      const err = await resp.json();
      detail = err.detail ?? detail;
    } catch { /* keep default */ }
    throw new Error(detail);
  }

  const blob = await resp.blob();
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function svgStackAndDownload(request: SvgStackRequest): Promise<void> {
  return postAndDownload("/api/svg-stack", request, `${request.name || "svg-stack"}.xcs`);
}

export async function svgLayersAndDownload(request: SvgLayersRequest): Promise<void> {
  return postAndDownload("/api/svg-layers", request, `${request.name || "svg-layers"}.xcs`);
}

export async function detectSvgLayers(svg_content: string, width_mm: number): Promise<DetectedLayer[]> {
  const resp = await fetch("/api/svg-detect-layers", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ svg_content, width_mm }),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.detail ?? `HTTP ${resp.status}`);
  }
  return resp.json();
}

export interface RasterTraceOptions {
  color_precision: number;
  layer_difference: number;
  filter_speckle: number;
  max_colors: number;  // 0 = disabled, 2-256 = PIL pre-quantize palette size
}

export const DEFAULT_RASTER_TRACE_OPTIONS: RasterTraceOptions = {
  color_precision: 4,
  layer_difference: 32,
  filter_speckle: 8,
  max_colors: 6,  // Default for raster: cap palette at 6 colors - best UX for photos
};

// Raster-to-SVG tracing is now client-side via vtracer-wasm; see
// web/src/tracer/vtracer.ts. The old /api/raster-to-svg helper used
// to live here.

export async function previewSvg(
  svg_content: string,
  opts: { enabled_colors?: string[] | null; subtract_overlaps?: boolean; width_mm?: number } = {},
): Promise<string> {
  const resp = await fetch("/api/svg-preview", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      svg_content,
      width_mm: opts.width_mm ?? 100,
      enabled_colors: opts.enabled_colors ?? null,
      subtract_overlaps: opts.subtract_overlaps ?? false,
    }),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.detail ?? `HTTP ${resp.status}`);
  }
  const data = await resp.json();
  return data.svg as string;
}
