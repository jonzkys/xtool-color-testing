/**
 * Client-side raster → SVG tracer.
 *
 * Lazy-loads the ``vtracer-wasm`` module + its WASM blob on first call so the
 * main JS bundle stays small. Once loaded it stays cached for the page's
 * lifetime.
 *
 * Before this existed, the frontend posted the raster to the backend which
 * ran the Python ``vtracer`` wrapper. The backend version was expensive, per
 * vtracer-run, and scaled with user count × knob-changes. Doing the exact
 * same work in the browser removes the server from the loop — zero backend
 * CPU, zero network round-trip, and instant feedback for the user.
 *
 * vtracer-wasm is a first-party WASM build of the same visioncortex Rust
 * library the Python wrapper uses, so SVG output matches what the old
 * backend produced for the same inputs.
 */

import type { RasterTraceOptions } from "../generate";
import { quantizeRgba } from "./quantize";

// Full config shape the wasm module wants — learned from
// https://github.com/jsscheller/vtracer-wasm/blob/master/src/lib.rs
interface VtracerConfig {
  binary: boolean;
  mode: "polygon" | "spline" | "pixel";
  hierarchical: "stacked" | "cutout";
  cornerThreshold: number;
  lengthThreshold: number;
  maxIterations: number;
  spliceThreshold: number;
  filterSpeckle: number;
  colorPrecision: number;
  layerDifference: number;
  pathPrecision: number;
}

// Match the Python backend's defaults for the fields we don't expose to the
// user — corner/length/splice thresholds, max iterations, path precision.
// These are the same numbers `vtracer` (Rust CLI) uses in its colour preset.
const FIXED_CONFIG: Omit<
  VtracerConfig,
  "colorPrecision" | "layerDifference" | "filterSpeckle"
> = {
  binary: false,
  mode: "spline",
  hierarchical: "stacked",
  cornerThreshold: 60,
  lengthThreshold: 4,
  maxIterations: 10,
  spliceThreshold: 45,
  pathPrecision: 3,
};

// Module-scope cache: the lazy-loaded vtracer-wasm API once initialised.
let _tracerPromise: Promise<{
  toSvg: (
    pixels: Uint8Array,
    width: number,
    height: number,
    config: VtracerConfig,
  ) => string;
}> | null = null;

async function getTracer() {
  if (!_tracerPromise) {
    _tracerPromise = (async () => {
      // Dynamic import so Vite emits a separate chunk for vtracer-wasm
      // (both the JS wrapper and the underlying .wasm blob).
      const mod = await import("vtracer-wasm");
      // The published package references `vtracer_bg.wasm` from its init
      // code, but the shipped file is `vtracer.wasm` — naming mismatch
      // in the upstream publish. Vite's ?url import gives us the hashed
      // asset URL that's actually emitted into dist/, which we hand to
      // init() so it can fetch the right blob.
      const wasmUrl = (await import("vtracer-wasm/vtracer.wasm?url")).default;
      await mod.default(wasmUrl);
      return { toSvg: mod.to_svg };
    })();
  }
  return _tracerPromise;
}


/**
 * Decode a data URL into an RGBA pixel buffer + dimensions via
 * a temporary ``HTMLImageElement`` + canvas. Using ``createImageBitmap``
 * when available for slightly faster paths; falling back to the Image
 * + canvas dance for older Safari.
 */
async function decodeImage(dataUrl: string): Promise<{
  pixels: Uint8ClampedArray;
  width: number;
  height: number;
}> {
  // createImageBitmap is faster where available; Safari < 15 lacks it for
  // blob inputs, so fall back to the classic Image+canvas route.
  let bitmap: ImageBitmap | null = null;
  try {
    const resp = await fetch(dataUrl);
    const blob = await resp.blob();
    bitmap = await createImageBitmap(blob);
  } catch {
    bitmap = null;
  }

  let width: number, height: number;
  let source: CanvasImageSource;
  if (bitmap) {
    width = bitmap.width;
    height = bitmap.height;
    source = bitmap;
  } else {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const im = new Image();
      im.onload = () => resolve(im);
      im.onerror = (e) => reject(new Error(`image decode failed: ${String(e)}`));
      im.src = dataUrl;
    });
    width = img.naturalWidth;
    height = img.naturalHeight;
    source = img;
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("2D canvas context unavailable");
  ctx.drawImage(source, 0, 0);
  const imageData = ctx.getImageData(0, 0, width, height);
  bitmap?.close?.();
  return { pixels: imageData.data, width, height };
}

/**
 * Main entry point. Same signature as the old ``rasterToSvg`` API
 * helper, so call sites don't need to change.
 */
export async function traceImageToSvg(
  dataUrl: string,
  opts: RasterTraceOptions,
): Promise<string> {
  const [{ pixels, width, height }, { toSvg }] = await Promise.all([
    decodeImage(dataUrl),
    getTracer(),
  ]);

  // Optional pre-quantisation (the old backend's PIL step). Disabled at
  // max_colors === 0, otherwise collapse the palette before vtracer sees it.
  const processed =
    opts.max_colors > 1 ? quantizeRgba(pixels, opts.max_colors) : pixels;

  const config: VtracerConfig = {
    ...FIXED_CONFIG,
    // vtracer-wasm hands ``colorPrecision`` straight through as
    // visioncortex's ``is_same_color_a`` = precision LOSS. The upstream
    // vtracer CLI instead converts the user-facing precision to loss via
    // ``8 - color_precision`` (see visioncortex/vtracer config.rs). Our
    // UI uses the CLI's convention (higher = more fidelity), so we do
    // the same conversion here. Without it, 8 collapses the whole image
    // and 1 over-splits — backwards from the knob's help text.
    colorPrecision: Math.max(0, Math.min(8, 8 - opts.color_precision)),
    layerDifference: opts.layer_difference,
    filterSpeckle: opts.filter_speckle,
  };
  // vtracer-wasm wants a plain Uint8Array; getImageData gives Uint8ClampedArray.
  const svg = toSvg(
    new Uint8Array(processed.buffer, processed.byteOffset, processed.byteLength),
    width, height, config,
  );

  // Backdrop layers: vtracer's stacked output partitions pixels into N
  // colour buckets, but anti-aliased edges and gradient slivers near the
  // image border can land between buckets and end up uncovered. We
  // prepend one rect per quadrant at the bottom of the z-stack, each
  // filled with the actual source-image colour from that quadrant's
  // corner — so a missed sliver in (say) the top-left picks up sky
  // blue, the bottom-left picks up the ground colour, and so on. Most
  // central content is still painted by vtracer over the top.
  return injectCornerBackdrops(svg, processed, width, height);
}

function sampleCornerColor(
  pixels: Uint8ClampedArray, width: number, height: number,
  corner: "tl" | "tr" | "bl" | "br",
): string {
  const PATCH = Math.max(1, Math.min(16, Math.floor(Math.min(width, height) / 8)));
  let x0: number, y0: number;
  switch (corner) {
    case "tl": x0 = 0; y0 = 0; break;
    case "tr": x0 = width - PATCH; y0 = 0; break;
    case "bl": x0 = 0; y0 = height - PATCH; break;
    case "br": x0 = width - PATCH; y0 = height - PATCH; break;
  }
  let r = 0, g = 0, b = 0;
  for (let yy = 0; yy < PATCH; yy++) {
    for (let xx = 0; xx < PATCH; xx++) {
      const i = ((y0 + yy) * width + (x0 + xx)) * 4;
      r += pixels[i]; g += pixels[i + 1]; b += pixels[i + 2];
    }
  }
  const n = PATCH * PATCH;
  const hx = (v: number) => Math.round(v / n).toString(16).padStart(2, "0");
  return `#${hx(r)}${hx(g)}${hx(b)}`;
}

/** Squared RGB distance — fast proxy for ΔE; we only need a "are these
 *  colours visually close enough to count as one" test, not perceptual
 *  fidelity. Threshold 600 ≈ 8 RGB units per channel. */
function rgbDistSq(a: string, b: string): number {
  const ar = parseInt(a.slice(1, 3), 16), ag = parseInt(a.slice(3, 5), 16), ab = parseInt(a.slice(5, 7), 16);
  const br = parseInt(b.slice(1, 3), 16), bg = parseInt(b.slice(3, 5), 16), bb = parseInt(b.slice(5, 7), 16);
  const dr = ar - br, dg = ag - bg, db = ab - bb;
  return dr * dr + dg * dg + db * db;
}

function injectCornerBackdrops(
  svg: string, pixels: Uint8ClampedArray, width: number, height: number,
): string {
  const tl = sampleCornerColor(pixels, width, height, "tl");
  const tr = sampleCornerColor(pixels, width, height, "tr");
  const bl = sampleCornerColor(pixels, width, height, "bl");
  const br = sampleCornerColor(pixels, width, height, "br");

  // Threshold for "visually the same" — ≈ ΔE ~5 in RGB squared distance.
  // Below this we collapse adjacent corners into one rect to avoid
  // emitting near-duplicate backdrop layers (which xCS Studio can
  // silently skip when they look identical).
  const THRESH_SQ = 600;
  const eq = (a: string, b: string) => rgbDistSq(a, b) < THRESH_SQ;
  const allFour = eq(tl, tr) && eq(tl, bl) && eq(tl, br);
  const topRowSame = eq(tl, tr);
  const botRowSame = eq(bl, br);
  const leftColSame = eq(tl, bl);
  const rightColSame = eq(tr, br);

  // Each rect is expanded by 1 px on every side so adjacent rects
  // overlap by 1 px along the midlines (no hairline seam) and each
  // extends 1 px past the canvas edge (no hairline where vtracer's
  // traced shapes meet the canvas border). The viewBox clips overshoot.
  const halfW = width / 2;
  const halfH = height / 2;
  const W2 = halfW + 1;
  const H2 = halfH + 1;

  let rects: string;
  if (allFour) {
    // One full-canvas rect — typical case for cartoons / icons with a
    // single background tone all the way to the edges.
    rects = `<rect x="-1" y="-1" width="${width + 2}" height="${height + 2}" fill="${tl}"/>`;
  } else if (topRowSame && botRowSame) {
    // Top half + bottom half — common when the top half is sky and
    // the bottom is ground.
    rects = [
      `<rect x="-1" y="-1" width="${width + 2}" height="${H2}" fill="${tl}"/>`,
      `<rect x="-1" y="${halfH}" width="${width + 2}" height="${H2}" fill="${bl}"/>`,
    ].join("");
  } else if (leftColSame && rightColSame) {
    // Left half + right half — when columns share a tone.
    rects = [
      `<rect x="-1" y="-1" width="${W2}" height="${height + 2}" fill="${tl}"/>`,
      `<rect x="${halfW}" y="-1" width="${W2}" height="${height + 2}" fill="${tr}"/>`,
    ].join("");
  } else {
    // Four distinct corners — fall back to per-quadrant rects.
    rects = [
      `<rect x="-1" y="-1" width="${W2}" height="${H2}" fill="${tl}"/>`,
      `<rect x="${halfW}" y="-1" width="${W2}" height="${H2}" fill="${tr}"/>`,
      `<rect x="-1" y="${halfH}" width="${W2}" height="${H2}" fill="${bl}"/>`,
      `<rect x="${halfW}" y="${halfH}" width="${W2}" height="${H2}" fill="${br}"/>`,
    ].join("");
  }

  const match = svg.match(/<svg\b[^>]*>/);
  if (!match) return svg;
  return svg.replace(match[0], `${match[0]}${rects}`);
}
