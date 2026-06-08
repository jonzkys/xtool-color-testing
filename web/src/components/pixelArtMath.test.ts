import { describe, it, expect } from "vitest";
import { kMeansLab, cellsToLoops, cellsToSquares, clampGridToBudget } from "./pixelArtMath";

describe("clampGridToBudget", () => {
  it("leaves a within-budget grid unchanged", () => {
    expect(clampGridToBudget(100, 100, 65536)).toEqual({ cols: 100, rows: 100 });
  });
  it("scales a huge square grid under the cell budget, preserving aspect", () => {
    const { cols, rows } = clampGridToBudget(2500, 2500, 65536);
    expect(cols * rows).toBeLessThanOrEqual(65536);
    expect(cols).toBeGreaterThanOrEqual(1);
    expect(Math.abs(cols - rows)).toBeLessThanOrEqual(1);
  });
  it("bounds a tall, narrow grid (the crop-explosion case)", () => {
    const { cols, rows } = clampGridToBudget(256, 4000, 65536);
    expect(cols * rows).toBeLessThanOrEqual(65536);
    expect(rows).toBeGreaterThan(cols); // aspect preserved
  });
});

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

  it("is deterministic across repeated runs on identical input", () => {
    // 12 spread hues with K=3 make the clustering genuinely seed-sensitive, so
    // an unseeded k-means++ yields different centroids run-to-run.
    const cells: (string | null)[] = [
      "#ff0000", "#ff8000", "#ffff00", "#80ff00",
      "#00ff00", "#00ff80", "#00ffff", "#0080ff",
      "#0000ff", "#8000ff", "#ff00ff", "#ff0080",
    ];
    const runs = Array.from({ length: 20 }, () => JSON.stringify(kMeansLab(cells, 3)));
    expect(new Set(runs).size).toBe(1);
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

// A loop is rotation/winding agnostic — compare as a sorted set of "x,y".
function cornerSet(loop: [number, number][]): string[] {
  return loop.map(([x, y]) => `${x},${y}`).sort();
}

describe("cellsToSquares", () => {
  it("emits one 4-corner loop per non-skip cell, grouped by label", () => {
    // 2x1 grid: [0, 1]
    const m = cellsToSquares([0, 1], 2, 1);
    expect(m.get(0)).toHaveLength(1);
    expect(m.get(1)).toHaveLength(1);
    expect(m.get(0)![0]).toEqual([[0, 0], [1, 0], [1, 1], [0, 1]]);
  });

  it("drops skip cells (-1)", () => {
    const m = cellsToSquares([0, -1, 0], 3, 1);
    expect(m.get(0)).toHaveLength(2);
    expect(m.has(-1)).toBe(false);
  });
});

describe("cellsToLoops", () => {
  it("collapses a solid grid to one 4-corner loop", () => {
    const labels = new Array(9).fill(0);
    const loops = cellsToLoops(labels, 3, 3).get(0)!;
    expect(loops).toHaveLength(1);
    expect(loops[0]).toHaveLength(4);
    expect(cornerSet(loops[0])).toEqual(["0,0", "0,3", "3,0", "3,3"]);
  });

  it("collapses a straight strip to 4 corners (colinear merge)", () => {
    // 1 row of 5 cells, all label 0.
    const loops = cellsToLoops(new Array(5).fill(0), 5, 1).get(0)!;
    expect(loops).toHaveLength(1);
    expect(loops[0]).toHaveLength(4);
    expect(cornerSet(loops[0])).toEqual(["0,0", "0,1", "5,0", "5,1"]);
  });

  it("traces an L-shape as one 6-corner loop", () => {
    // 2x2 grid, bottom-right is skip:
    //   0 0
    //   0 -1
    const loops = cellsToLoops([0, 0, 0, -1], 2, 2).get(0)!;
    expect(loops).toHaveLength(1);
    expect(loops[0]).toHaveLength(6);
    expect(cornerSet(loops[0])).toEqual(
      ["0,0", "0,2", "1,1", "1,2", "2,0", "2,1"],
    );
  });

  it("traces a ring (hole) as two loops", () => {
    // 3x3 with the centre skipped → outer loop + hole loop.
    const labels = [0, 0, 0, 0, -1, 0, 0, 0, 0];
    const loops = cellsToLoops(labels, 3, 3).get(0)!;
    expect(loops).toHaveLength(2);
    const sizes = loops.map((l) => l.length).sort();
    expect(sizes).toEqual([4, 4]); // outer square + inner square hole
  });

  it("keeps diagonal-touching cells separate (4-connected)", () => {
    // 2x2 checkerboard; label 0 sits on the diagonal (0,0) & (1,1).
    //   0 1
    //   1 0
    const loops = cellsToLoops([0, 1, 1, 0], 2, 2).get(0)!;
    expect(loops).toHaveLength(2); // NOT merged through the pinch
    for (const l of loops) expect(l).toHaveLength(4);
  });

  it("omits skip cells from the output map", () => {
    const m = cellsToLoops([0, -1, 0], 3, 1);
    expect(m.has(-1)).toBe(false);
    expect(m.get(0)).toHaveLength(2); // two disjoint single cells
  });
});
