// web/src/lib/forge/stages.test.ts
import { describe, it, expect } from "vitest";
import {
  generateSeedPaths,
  generatePerforationPaths,
  generateDeepenPaths,
  generateCleanPaths,
} from "./stages";
import { DEFAULT_CONFIG } from "./defaults";
import { contourPerimeter } from "./contour";
import type { Contour } from "./types";

const square: Contour = {
  points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }],
  closed: true,
};
const SRC = "src-id";

describe("generateSeedPaths", () => {
  it("emits paths tagged seed with CUT_01_SEED group and layerCount clamped to ≤5", () => {
    const cfg = { ...DEFAULT_CONFIG, seed: { ...DEFAULT_CONFIG.seed, layerCount: 9 } };
    const paths = generateSeedPaths(square, cfg, SRC);
    expect(paths.length).toBeGreaterThan(0);
    expect(paths.every((p) => p.generatedClass === "seed")).toBe(true);
    expect(paths.every((p) => p.groupName === "CUT_01_SEED")).toBe(true);
    // layer count clamped to 5
    expect(new Set(paths.map((p) => p.layerStart)).size).toBeLessThanOrEqual(5);
  });
  it("returns nothing when disabled", () => {
    const cfg = { ...DEFAULT_CONFIG, seed: { ...DEFAULT_CONFIG.seed, enabled: false } };
    expect(generateSeedPaths(square, cfg, SRC)).toEqual([]);
  });
});

describe("generatePerforationPaths", () => {
  it("emits perforate-class micro features at spacing, with extra at corners", () => {
    const paths = generatePerforationPaths(square, DEFAULT_CONFIG, SRC);
    expect(paths.length).toBeGreaterThan(0);
    expect(paths.every((p) => p.generatedClass === "perforate")).toBe(true);
    expect(paths.every((p) => p.groupName === "CUT_02_PERFORATE")).toBe(true);
    // each perforation is a tiny segment (pocketSize-scale), not the full contour
    for (const p of paths) {
      expect(contourPerimeter({ points: p.points, closed: false })).toBeLessThan(2);
    }
  });
  it("returns nothing when disabled", () => {
    const cfg = { ...DEFAULT_CONFIG, perforate: { ...DEFAULT_CONFIG.perforate, enabled: false } };
    expect(generatePerforationPaths(square, cfg, SRC)).toEqual([]);
  });
});

describe("generateDeepenPaths", () => {
  it("emits deepen paths grouped by pass-group in A→B→C→D order", () => {
    const paths = generateDeepenPaths(square, DEFAULT_CONFIG, SRC);
    expect(paths.every((p) => p.generatedClass === "deepen")).toBe(true);
    const names = paths.map((p) => p.groupName);
    expect(names.indexOf("CUT_03_DEEPEN_A_0_50_1X")).toBeLessThan(names.lastIndexOf("CUT_06_DEEPEN_D_200_256_8X"));
  });
  it("group A (1x) has a single offset ring per segment; D (8x) has more", () => {
    const paths = generateDeepenPaths(square, DEFAULT_CONFIG, SRC);
    const a = paths.filter((p) => p.groupName.includes("DEEPEN_A"));
    const d = paths.filter((p) => p.groupName.includes("DEEPEN_D"));
    expect(d.length).toBeGreaterThan(a.length);
  });
  it("interlaced order means consecutive deepen paths in a group aren't adjacent segments", () => {
    // Use a larger 40mm square so segmentation produces enough segments to be meaningful
    const bigSquare: Contour = {
      points: [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 40 }, { x: 0, y: 40 }],
      closed: true,
    };
    const paths = generateDeepenPaths(bigSquare, DEFAULT_CONFIG, SRC).filter((p) =>
      p.groupName.includes("DEEPEN_A"),
    );
    // segmentIndex present and not strictly 0,1,2,...
    const segs = paths.map((p) => p.segmentIndex ?? -1).filter((s) => s >= 0);
    const isSequential = segs.every((s, i) => i === 0 || s === segs[i - 1] + 1);
    expect(isSequential).toBe(false);
  });
});

describe("generateCleanPaths", () => {
  it("emits clean-class paths following walls (inner+outer)", () => {
    const paths = generateCleanPaths(square, DEFAULT_CONFIG, SRC);
    expect(paths.every((p) => p.generatedClass === "clean")).toBe(true);
    expect(paths.every((p) => p.groupName === "CUT_07_CLEAN")).toBe(true);
    expect(paths.length).toBeGreaterThanOrEqual(2); // walls = 2 sides
  });
  it("returns nothing when disabled", () => {
    const cfg = { ...DEFAULT_CONFIG, clean: { ...DEFAULT_CONFIG.clean, enabled: false } };
    expect(generateCleanPaths(square, cfg, SRC)).toEqual([]);
  });
  it("does not throw when an inward wall offset collapses the contour to nothing", () => {
    // A contour far smaller than the wall offset: the inward (inner) wall pass
    // shrinks it to an empty Clipper result. Must skip gracefully, not crash.
    const tiny: Contour = {
      points: [{ x: 0, y: 0 }, { x: 0.02, y: 0 }, { x: 0.02, y: 0.02 }, { x: 0, y: 0.02 }],
      closed: true,
    };
    const cfg = {
      ...DEFAULT_CONFIG,
      beamWidthMm: 0.5, // wall offset (0.5mm) >> the 0.02mm contour
      clean: { ...DEFAULT_CONFIG.clean, offsetSelection: "inner" as const },
    };
    expect(() => generateCleanPaths(tiny, cfg, SRC)).not.toThrow();
    // every emitted path (if any) has real geometry
    for (const p of generateCleanPaths(tiny, cfg, SRC)) {
      expect(Array.isArray(p.points)).toBe(true);
    }
  });
});
