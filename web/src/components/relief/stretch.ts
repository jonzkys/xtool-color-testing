/**
 * Relief — tone stretch (experimental).
 *
 * Pure, DOM-free tone-mapping for a smoothed depth map. Every monotonic mode
 * is a 256-entry lookup table (input gray → output gray): instant to apply in
 * the browser and resolution-independent, so the preview LUT is the exact same
 * one used for the full-res export. CLAHE is spatially adaptive (not a single
 * LUT) and is handled on the backend — here it resolves to identity.
 *
 * The stretch runs AFTER smoothing (denoise-then-stretch): stretching first
 * would amplify the very noise the smoother removes.
 */

export type StretchMode =
  | "none"
  | "linear"
  | "gamma"
  | "asinh"
  | "equalize"
  | "clahe";

export interface StretchParams {
  mode: StretchMode;
  /** Linear: low/high percentile clip (0..10 %). */
  clipLowPct: number;
  clipHighPct: number;
  /** Gamma / Asinh: symmetric percentile clip applied to both ends (0..10 %). */
  clipPct: number;
  /** Gamma exponent (0.2..2.5). <1 lifts midtones, >1 lowers them. */
  gamma: number;
  /** Asinh lift strength (0..1). */
  asinhStrength: number;
  /** CLAHE (backend) clip limit (1..8). */
  claheClipLimit: number;
  /** CLAHE (backend) tile grid (one axis): 4 | 8 | 16. */
  claheTiles: number;
  /** Offset the lowest populated value to 0 (drop unused bottom of the range). */
  removeEmptyLayers: boolean;
  /** Mask near-black (or near-white) pixels to transparency — backend. */
  removeBackground: boolean;
  bgThreshold: number;
  /** Background removal method. */
  bgMode: "dark" | "bright" | "colour";
  /** Picked background colour (RGB) for `colour` mode; null until sampled. */
  bgColor: [number, number, number] | null;
  /** Euclidean RGB distance for `colour` mode (0..441). */
  bgTolerance: number;
  /** Trim (erode) the object outline by trimPct% of its shorter side. */
  trimEnabled: boolean;
  trimPct: number;
  /** Non-linear edge falloff over falloffPct% of the shorter side. */
  falloffEnabled: boolean;
  falloffPct: number;
  falloffDir: "down" | "up";
}

export const DEFAULT_STRETCH_PARAMS: StretchParams = {
  mode: "none",
  clipLowPct: 0.1,
  clipHighPct: 0.1,
  clipPct: 0.1,
  gamma: 1.0,
  asinhStrength: 0.5,
  claheClipLimit: 2,
  claheTiles: 8,
  removeEmptyLayers: false,
  removeBackground: false,
  bgThreshold: 8,
  bgMode: "dark",
  bgColor: null,
  bgTolerance: 40,
  trimEnabled: false,
  trimPct: 2,
  falloffEnabled: false,
  falloffPct: 5,
  falloffDir: "down",
};

/** Rec. 601 luma — for a grayscale depth map R=G=B so this is just the value. */
function luma(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

/** 256-bin luminance histogram for an ImageData. */
export function histogram(src: ImageData): Uint32Array {
  const bins = new Uint32Array(256);
  const px = src.data;
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] < 128) continue; // skip transparent (background) pixels
    const l = luma(px[i], px[i + 1], px[i + 2]);
    bins[Math.min(255, Math.max(0, Math.round(l)))]++;
  }
  return bins;
}

/** Value bounds [lo, hi] after trimming lowPct/highPct of the population. */
function percentileBounds(
  hist: Uint32Array,
  lowPct: number,
  highPct: number,
): [number, number] {
  let total = 0;
  for (let i = 0; i < 256; i++) total += hist[i];
  if (total === 0) return [0, 255];
  const loTarget = (Math.max(0, lowPct) / 100) * total;
  const hiTarget = (1 - Math.max(0, highPct) / 100) * total;

  let cum = 0;
  let lo = 0;
  for (let i = 0; i < 256; i++) {
    cum += hist[i];
    if (cum > loTarget) {
      lo = i;
      break;
    }
  }
  cum = 0;
  let hi = 255;
  for (let i = 0; i < 256; i++) {
    cum += hist[i];
    if (cum >= hiTarget) {
      hi = i;
      break;
    }
  }
  if (hi <= lo) hi = Math.min(255, lo + 1);
  return [lo, hi];
}

/** Build the 256-entry tone LUT for the given params + source histogram. */
export function buildLut(p: StretchParams, hist: Uint32Array): Uint8Array {
  const lut = new Uint8Array(256);

  // None and CLAHE (backend) are identity here — except None gains an optional
  // floor offset ("remove initial empty layers").
  if (p.mode === "none" || p.mode === "clahe") {
    if (p.removeEmptyLayers && p.mode === "none") {
      let floor = 0;
      for (let i = 0; i < 256; i++) {
        if (hist[i] > 0) {
          floor = i;
          break;
        }
      }
      for (let v = 0; v < 256; v++) lut[v] = Math.max(0, Math.min(255, v - floor));
    } else {
      for (let v = 0; v < 256; v++) lut[v] = v;
    }
    return lut;
  }

  if (p.mode === "equalize") {
    let total = 0;
    for (let i = 0; i < 256; i++) total += hist[i];
    if (total === 0) {
      for (let v = 0; v < 256; v++) lut[v] = v;
      return lut;
    }
    const cdf = new Float64Array(256);
    let cum = 0;
    let cdfMin = 0;
    let foundMin = false;
    for (let i = 0; i < 256; i++) {
      cum += hist[i];
      cdf[i] = cum;
      if (!foundMin && hist[i] > 0) {
        cdfMin = cum;
        foundMin = true;
      }
    }
    const denom = Math.max(1, total - cdfMin);
    for (let v = 0; v < 256; v++) {
      const y = Math.round(((cdf[v] - cdfMin) / denom) * 255);
      lut[v] = Math.max(0, Math.min(255, y));
    }
    return lut;
  }

  // linear / gamma / asinh share a linear percentile trim first.
  const [lo, hi] =
    p.mode === "linear"
      ? percentileBounds(hist, p.clipLowPct, p.clipHighPct)
      : percentileBounds(hist, p.clipPct, p.clipPct);
  const range = Math.max(1, hi - lo);
  const k = 1 + p.asinhStrength * 40; // asinh curvature

  for (let v = 0; v < 256; v++) {
    let x = (v - lo) / range;
    if (x < 0) x = 0;
    if (x > 1) x = 1;

    let y: number;
    if (p.mode === "gamma") {
      y = Math.pow(x, p.gamma);
    } else if (p.mode === "asinh") {
      y = Math.asinh(k * x) / Math.asinh(k);
    } else {
      y = x; // linear
    }
    lut[v] = Math.max(0, Math.min(255, Math.round(y * 255)));
  }
  return lut;
}

/** Apply a 256-LUT to every R/G/B channel; alpha and dimensions preserved. */
export function applyLut(src: ImageData, lut: Uint8Array): ImageData {
  const out = new Uint8ClampedArray(src.data.length);
  const s = src.data;
  for (let i = 0; i < s.length; i += 4) {
    out[i] = lut[s[i]];
    out[i + 1] = lut[s[i + 1]];
    out[i + 2] = lut[s[i + 2]];
    out[i + 3] = s[i + 3];
  }
  return new ImageData(out, src.width, src.height);
}
