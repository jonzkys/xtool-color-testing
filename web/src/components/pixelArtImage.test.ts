import { describe, it, expect } from "vitest";
import { sampleCellGrid } from "./pixelArtImage";

// jsdom doesn't ship the ImageData constructor. Shim a structural
// equivalent (only .width/.height/.data are read by sampleCellGrid).
if (typeof globalThis.ImageData === "undefined") {
  class ImageDataPolyfill {
    readonly data: Uint8ClampedArray;
    readonly width: number;
    readonly height: number;
    readonly colorSpace: PredefinedColorSpace = "srgb";
    constructor(data: Uint8ClampedArray, width: number, height: number) {
      this.data = data;
      this.width = width;
      this.height = height;
    }
  }
  (globalThis as unknown as { ImageData: typeof ImageData }).ImageData =
    ImageDataPolyfill as unknown as typeof ImageData;
}

function makeImageData(
  width: number,
  height: number,
  pixel: (x: number, y: number) => [number, number, number, number],
): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = pixel(x, y);
      const i = (y * width + x) * 4;
      data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = a;
    }
  }
  return new ImageData(data, width, height);
}

describe("sampleCellGrid", () => {
  it("averages source pixels inside each cell", () => {
    const img = makeImageData(4, 4, () => [0, 0, 0, 255]);
    const cells = sampleCellGrid(img, { cols: 2, rows: 2 });
    expect(cells).toEqual(["#000000", "#000000", "#000000", "#000000"]);
  });

  it("returns null for cells whose mean alpha < 30", () => {
    const img = makeImageData(2, 2, (x, y) =>
      x === 0 && y === 0 ? [255, 0, 0, 0] : [255, 0, 0, 255]
    );
    const cells = sampleCellGrid(img, { cols: 2, rows: 2 });
    expect(cells[0]).toBeNull();
    expect(cells[1]).toBe("#ff0000");
    expect(cells[2]).toBe("#ff0000");
    expect(cells[3]).toBe("#ff0000");
  });

  it("crops to the requested source-rect before sampling", () => {
    const img = makeImageData(4, 4, (x) => (x < 2 ? [0, 0, 0, 255] : [255, 255, 255, 255]));
    const cells = sampleCellGrid(img, { cols: 1, rows: 1, cropX: 2, cropY: 0, cropW: 2, cropH: 4 });
    expect(cells[0]).toBe("#ffffff");
  });
});
