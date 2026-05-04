import { describe, it, expect } from "vitest";
import { kMeansLab, greedyRectCover } from "./pixelArtMath";

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

describe("greedyRectCover", () => {
  it("collapses a uniform grid to a single rect", () => {
    const labels = new Array(9).fill(0);
    const result = greedyRectCover(labels, 3, 3);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ x: 0, y: 0, width: 3, height: 3, label: 0 });
  });

  it("treats -1 (skip) cells as gaps that are never covered", () => {
    const labels = [0, -1, 0, 0, -1, 0];
    const result = greedyRectCover(labels, 3, 2);
    expect(result.filter((r) => r.label === 0)).toHaveLength(2);
    expect(result.every((r) => r.label !== -1)).toBe(true);
  });

  it("handles a checkerboard worst case (every cell its own rect)", () => {
    const labels = [0, 1, 0, 1, 1, 0, 1, 0];
    const result = greedyRectCover(labels, 4, 2);
    expect(result).toHaveLength(8);
  });

  it("emits a single rect for two adjacent same-label cells", () => {
    const labels = [0, 0, 0];
    const result = greedyRectCover(labels, 3, 1);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ x: 0, y: 0, width: 3, height: 1, label: 0 });
  });
});
