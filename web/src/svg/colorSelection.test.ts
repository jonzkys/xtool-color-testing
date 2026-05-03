import { describe, expect, it } from "vitest";
import { deltaE76, seedFarthestPointSample } from "./colorSelection";
import type { PaletteEntry } from "../types";

const lab = (id: number, l: number, a: number, b: number): PaletteEntry => ({
  id,
  machine_id: "F2Ultra",
  test_id: null,
  material_id: 1,
  x_value: null, y_value: null,
  hex: "#000000", lab: [l, a, b],
  params: {}, sigma: 0, source: "manual",
  source_result_id: null, notes: "", favorited: false,
  created_at: "",
});

describe("deltaE76", () => {
  it("is zero for identical Lab", () => {
    expect(deltaE76([50, 0, 0], [50, 0, 0])).toBe(0);
  });
  it("is the Euclidean distance otherwise", () => {
    expect(deltaE76([0, 0, 0], [3, 4, 0])).toBeCloseTo(5);
  });
});

describe("seedFarthestPointSample", () => {
  it("returns empty when the palette is empty", () => {
    expect(seedFarthestPointSample([], 5).size).toBe(0);
  });

  it("never returns more than min(N, palette size)", () => {
    const palette = [lab(1, 30, 0, 0), lab(2, 70, 0, 0)];
    expect(seedFarthestPointSample(palette, 10).size).toBe(2);
  });

  it("seeds with the entry farthest from mean L*", () => {
    const palette = [lab(1, 50, 0, 0), lab(2, 51, 0, 0), lab(3, 90, 0, 0)];
    const picked = seedFarthestPointSample(palette, 1);
    expect(Array.from(picked)).toEqual([3]);
  });

  it("picks a second entry that maximises minimum ΔE76 to the seed", () => {
    const palette = [
      lab(1, 50, 0, 0),
      lab(2, 50, 5, 0),
      lab(3, 50, 50, 50),
    ];
    const picked = seedFarthestPointSample(palette, 2);
    expect(picked.has(3)).toBe(true);
  });

  it("is deterministic for tied inputs", () => {
    const palette = [lab(1, 30, 0, 0), lab(2, 70, 0, 0), lab(3, 50, 50, 50)];
    const a = Array.from(seedFarthestPointSample(palette, 3));
    const b = Array.from(seedFarthestPointSample(palette, 3));
    expect(a).toEqual(b);
  });
});
