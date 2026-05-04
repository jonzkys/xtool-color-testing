import { describe, it, expect } from "vitest";
import { kMeansLab } from "./pixelArtMath";

describe("kMeansLab", () => {
  it("returns K labels for K clearly-separated colour clusters", () => {
    const cells: (string | null)[] = ["#000000", "#000000", "#ffffff", "#ffffff"];
    const result = kMeansLab(cells, 2);
    expect(result.labels).toHaveLength(4);
    expect(result.labels[0]).toBe(result.labels[1]);
    expect(result.labels[2]).toBe(result.labels[3]);
    expect(result.labels[0]).not.toBe(result.labels[2]);
    expect(result.centroidsHex).toHaveLength(2);
  });

  it("propagates skip cells (null) as label = -1", () => {
    const cells: (string | null)[] = ["#000000", null, "#ffffff"];
    const result = kMeansLab(cells, 2);
    expect(result.labels[1]).toBe(-1);
  });

  it("clamps K when fewer unique colours exist", () => {
    const cells: (string | null)[] = ["#000000", "#000000", "#000000"];
    const result = kMeansLab(cells, 4);
    expect(result.centroidsHex.length).toBeLessThanOrEqual(4);
    expect(new Set(result.labels.filter((l) => l >= 0)).size).toBeLessThanOrEqual(1);
  });
});
