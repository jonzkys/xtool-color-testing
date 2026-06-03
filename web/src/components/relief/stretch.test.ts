import { describe, it, expect } from "vitest";
import {
  DEFAULT_STRETCH_PARAMS,
  histogram,
  buildLut,
  applyLut,
  type StretchParams,
} from "./stretch";

// jsdom doesn't ship the ImageData constructor. Shim a structural
// equivalent with the data-first signature the repo uses elsewhere
// (see pixelArtImage.test.ts).
if (typeof globalThis.ImageData === "undefined") {
  class ImageDataPolyfill {
    readonly data: Uint8ClampedArray;
    readonly width: number;
    readonly height: number;
    constructor(data: Uint8ClampedArray, width: number, height: number) {
      this.data = data;
      this.width = width;
      this.height = height;
    }
  }
  (globalThis as unknown as { ImageData: typeof ImageData }).ImageData =
    ImageDataPolyfill as unknown as typeof ImageData;
}

/** Solid-gray image of a given value. */
function makeGray(width: number, height: number, value: number): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = data[i + 1] = data[i + 2] = value;
    data[i + 3] = 255;
  }
  return new ImageData(data, width, height);
}

/** Histogram bunched in [lo, hi] — one pixel per value in that band. */
function bunchedHist(lo: number, hi: number): Uint32Array {
  const h = new Uint32Array(256);
  for (let v = lo; v <= hi; v++) h[v] = 100;
  return h;
}

const params = (over: Partial<StretchParams>): StretchParams => ({
  ...DEFAULT_STRETCH_PARAMS,
  ...over,
});

describe("buildLut", () => {
  it("none → identity", () => {
    const lut = buildLut(params({ mode: "none" }), bunchedHist(60, 180));
    for (let v = 0; v < 256; v++) expect(lut[v]).toBe(v);
  });

  it("clahe → identity (handled on the backend)", () => {
    const lut = buildLut(params({ mode: "clahe" }), bunchedHist(60, 180));
    for (let v = 0; v < 256; v++) expect(lut[v]).toBe(v);
  });

  it("linear maps the populated band to the full range", () => {
    const lut = buildLut(
      params({ mode: "linear", clipLowPct: 0, clipHighPct: 0 }),
      bunchedHist(60, 180),
    );
    expect(lut[60]).toBeLessThanOrEqual(1);
    expect(lut[180]).toBeGreaterThanOrEqual(254);
    for (let v = 1; v < 256; v++) expect(lut[v]).toBeGreaterThanOrEqual(lut[v - 1]);
  });

  it("gamma < 1 lifts midtones; > 1 lowers them", () => {
    const hist = bunchedHist(0, 255);
    const lo = buildLut(params({ mode: "gamma", clipPct: 0, gamma: 0.5 }), hist);
    const hi = buildLut(params({ mode: "gamma", clipPct: 0, gamma: 2.0 }), hist);
    expect(lo[128]).toBeGreaterThan(128);
    expect(hi[128]).toBeLessThan(128);
  });

  it("asinh is monotonic and lifts low values", () => {
    const lut = buildLut(
      params({ mode: "asinh", clipPct: 0, asinhStrength: 0.7 }),
      bunchedHist(0, 255),
    );
    expect(lut[64]).toBeGreaterThan(64);
    for (let v = 1; v < 256; v++) expect(lut[v]).toBeGreaterThanOrEqual(lut[v - 1]);
  });

  it("equalize flattens a peaked histogram toward uniform", () => {
    const lut = buildLut(params({ mode: "equalize" }), bunchedHist(100, 140));
    expect(lut[100]).toBeLessThan(60);
    expect(lut[140]).toBeGreaterThan(195);
    for (let v = 1; v < 256; v++) expect(lut[v]).toBeGreaterThanOrEqual(lut[v - 1]);
  });
});

describe("applyLut", () => {
  it("preserves dimensions and alpha, maps RGB through the LUT", () => {
    const src = makeGray(3, 2, 100);
    const lut = new Uint8Array(256);
    for (let v = 0; v < 256; v++) lut[v] = Math.min(255, v + 10);
    const out = applyLut(src, lut);
    expect(out.width).toBe(3);
    expect(out.height).toBe(2);
    expect(out.data[0]).toBe(110); // R
    expect(out.data[1]).toBe(110); // G
    expect(out.data[2]).toBe(110); // B
    expect(out.data[3]).toBe(255); // A preserved
  });
});

describe("histogram", () => {
  it("counts luminance into 256 bins", () => {
    const h = histogram(makeGray(10, 10, 100));
    expect(h[100]).toBe(100);
    expect(h.reduce((a, b) => a + b, 0)).toBe(100);
  });

  it("skips transparent pixels", () => {
    // 4 pixels: two opaque value 100, two transparent value 0.
    const data = new Uint8ClampedArray(4 * 4);
    data.set([100, 100, 100, 255], 0);
    data.set([100, 100, 100, 255], 4);
    data.set([0, 0, 0, 0], 8);
    data.set([0, 0, 0, 0], 12);
    const img = new ImageData(data, 4, 1);
    const h = histogram(img);
    expect(h[100]).toBe(2);
    expect(h[0]).toBe(0); // transparent pixels not counted
  });
});

describe("removeEmptyLayers", () => {
  it("offsets the floor to 0 in None mode", () => {
    const lut = buildLut(
      params({ mode: "none", removeEmptyLayers: true }),
      bunchedHist(60, 180),
    );
    expect(lut[60]).toBe(0);
    expect(lut[100]).toBe(40);
    expect(lut[180]).toBe(120);
  });

  it("is identity in None mode when off", () => {
    const lut = buildLut(
      params({ mode: "none", removeEmptyLayers: false }),
      bunchedHist(60, 180),
    );
    for (let v = 0; v < 256; v++) expect(lut[v]).toBe(v);
  });

  it("is a no-op under Linear (mode already zeros the floor)", () => {
    const hist = bunchedHist(60, 180);
    const off = buildLut(params({ mode: "linear", removeEmptyLayers: false }), hist);
    const on = buildLut(params({ mode: "linear", removeEmptyLayers: true }), hist);
    for (let v = 0; v < 256; v++) expect(on[v]).toBe(off[v]);
  });
});
