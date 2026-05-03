// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { parsePathSubpaths, type SubPath } from "./svgGeometry";

const open = (pts: [number, number][]): SubPath => ({
  closed: false, points: pts.map(([x, y]) => ({ x, y })),
});
const closed = (pts: [number, number][]): SubPath => ({
  closed: true, points: pts.map(([x, y]) => ({ x, y })),
});

describe("parsePathSubpaths", () => {
  it("parses a single open polyline", () => {
    expect(parsePathSubpaths("M0 0 L10 0 L10 10")).toEqual([
      open([[0, 0], [10, 0], [10, 10]]),
    ]);
  });

  it("parses a single closed ring", () => {
    expect(parsePathSubpaths("M0 0 L10 0 L10 10 L0 10 Z")).toEqual([
      closed([[0, 0], [10, 0], [10, 10], [0, 10]]),
    ]);
  });

  it("splits sequential M-introduced subpaths", () => {
    // Two disjoint closed squares — typical vtracer multi-region output.
    const d = "M0 0 L10 0 L10 10 L0 10 Z M20 20 L30 20 L30 30 L20 30 Z";
    expect(parsePathSubpaths(d)).toEqual([
      closed([[0, 0], [10, 0], [10, 10], [0, 10]]),
      closed([[20, 20], [30, 20], [30, 30], [20, 30]]),
    ]);
  });

  it("treats a fresh M after a Z as a new subpath", () => {
    const d = "M0 0 L1 0 Z M5 5 L6 5";
    expect(parsePathSubpaths(d)).toEqual([
      closed([[0, 0], [1, 0]]),
      open([[5, 5], [6, 5]]),
    ]);
  });

  it("handles relative m/l/h/v and lowercase z", () => {
    // M0 0 l10 0 v10 h-10 z  → closed unit square at origin scaled 10×10
    expect(parsePathSubpaths("M0 0 l10 0 v10 h-10 z")).toEqual([
      closed([[0, 0], [10, 0], [10, 10], [0, 10]]),
    ]);
  });

  it("returns [] when the path uses curves (caller will skip)", () => {
    expect(parsePathSubpaths("M0 0 C 1 1 2 2 3 3")).toEqual([]);
  });

  it("returns [] when malformed", () => {
    expect(parsePathSubpaths("L10 10")).toEqual([]); // missing leading M
  });
});
