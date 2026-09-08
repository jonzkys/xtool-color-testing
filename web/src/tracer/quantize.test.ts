import { describe, expect, test } from "vitest";
import {
  quantizeRgba,
  quantizeRgbaWithPalette,
  rgbToHex,
  snapFillsToPalette,
} from "./quantize";

/** Build an RGBA buffer from a list of [r,g,b] triples. */
function rgba(...px: [number, number, number][]): Uint8ClampedArray {
  const out = new Uint8ClampedArray(px.length * 4);
  px.forEach(([r, g, b], i) => {
    out[i * 4] = r;
    out[i * 4 + 1] = g;
    out[i * 4 + 2] = b;
    out[i * 4 + 3] = 255;
  });
  return out;
}

function distinctColors(buf: Uint8ClampedArray): number {
  const s = new Set<number>();
  for (let i = 0; i < buf.length; i += 4) {
    if (buf[i + 3] === 0) continue;
    s.add((buf[i] << 16) | (buf[i + 1] << 8) | buf[i + 2]);
  }
  return s.size;
}

describe("quantizeRgbaWithPalette", () => {
  test("reports exactly the colours present in its own output", () => {
    const src = rgba(
      [255, 0, 0], [250, 5, 5], [0, 255, 0], [5, 250, 5],
      [0, 0, 255], [5, 5, 250], [128, 128, 128], [130, 130, 130],
    );
    const { pixels, palette } = quantizeRgbaWithPalette(src, 3);
    expect(palette.length).toBe(distinctColors(pixels));
    expect(palette.length).toBeLessThanOrEqual(3);
  });

  test("handles the pass-through case where the image is already small enough", () => {
    // quantizeRgba returns the input untouched when it has <= maxColors
    // colours, so the palette must be read off the buffer, not assumed.
    const src = rgba([1, 2, 3], [4, 5, 6]);
    const { pixels, palette } = quantizeRgbaWithPalette(src, 6);
    expect(pixels).toBe(src);
    expect(palette.length).toBe(2);
    expect(palette).toContainEqual([1, 2, 3]);
  });

  test("ignores fully transparent pixels", () => {
    const src = rgba([10, 10, 10], [20, 20, 20]);
    src[7] = 0; // second pixel alpha = 0
    const { palette } = quantizeRgbaWithPalette(src, 6);
    expect(palette).toEqual([[10, 10, 10]]);
  });
});

describe("snapFillsToPalette", () => {
  const palette: [number, number, number][] = [
    [255, 0, 0],
    [0, 0, 255],
  ];

  test("collapses near-palette fills onto exact palette entries", () => {
    // This is the whole point: vtracer emits per-region AVERAGES, so a file
    // quantised to 2 colours comes back with dozens of in-between fills, and
    // the layers UI makes one layer per distinct hex.
    const svg =
      '<path fill="#FE0101"/><path fill="#F50A0A"/><path fill="#0505FA"/>';
    const out = snapFillsToPalette(svg, palette);
    expect(out).toBe(
      '<path fill="#FF0000"/><path fill="#FF0000"/><path fill="#0000FF"/>',
    );
  });

  test("accepts lowercase hex (injectCornerBackdrops emits it)", () => {
    expect(snapFillsToPalette('<rect fill="#fe0101"/>', palette)).toBe(
      '<rect fill="#FF0000"/>',
    );
  });

  test("leaves non-fill attributes and non-hex fills alone", () => {
    const svg = '<path stroke="#FE0101" fill="none"/>';
    expect(snapFillsToPalette(svg, palette)).toBe(svg);
  });

  test("is a no-op with an empty palette", () => {
    const svg = '<path fill="#123456"/>';
    expect(snapFillsToPalette(svg, [])).toBe(svg);
  });

  test("picks the nearest entry by squared RGB distance, not the first", () => {
    expect(snapFillsToPalette('<path fill="#3300CC"/>', palette)).toBe(
      '<path fill="#0000FF"/>',
    );
  });

  test("end to end: quantised buffer + snap yields at most maxColors fills", () => {
    const src = rgba(
      [255, 0, 0], [0, 0, 255], [250, 10, 10], [10, 10, 250],
      [200, 30, 30], [30, 30, 200],
    );
    const { palette: p } = quantizeRgbaWithPalette(src, 2);
    // Simulate vtracer inventing in-between colours.
    const svg = [
      "#FF0000", "#DC1E1E", "#8C1E8C", "#1E1EC8", "#0000FF",
    ].map((h) => `<path fill="${h}"/>`).join("");
    const out = snapFillsToPalette(svg, p);
    const fills = new Set([...out.matchAll(/fill="([^"]+)"/g)].map((m) => m[1]));
    expect(fills.size).toBeLessThanOrEqual(2);
  });
});

describe("rgbToHex", () => {
  test("pads and uppercases", () => {
    expect(rgbToHex(0, 10, 255)).toBe("#000AFF");
  });
});

describe("quantizeRgba (unchanged behaviour)", () => {
  test("still returns the input untouched below the colour cap", () => {
    const src = rgba([1, 2, 3]);
    expect(quantizeRgba(src, 6)).toBe(src);
  });

  test("still reduces to at most maxColors", () => {
    const px: [number, number, number][] = [];
    for (let i = 0; i < 64; i++) px.push([i * 4, 255 - i * 4, i]);
    expect(distinctColors(quantizeRgba(rgba(...px), 4))).toBeLessThanOrEqual(4);
  });
});
