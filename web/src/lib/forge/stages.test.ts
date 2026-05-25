// web/src/lib/forge/stages.test.ts
import { describe, it, expect } from "vitest";
import {
  generateSeedPaths,
  generatePerforationPaths,
  generateDeepenPaths,
  generateCleanPaths,
} from "./stages";
import { buildPartRegion } from "./offset";
import { DEFAULT_CONFIG } from "./defaults";
import type { Contour, Pt } from "./types";

const square: Contour = {
  points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }],
  closed: true,
};
const PART = buildPartRegion([square]); // solid 10x10 region
const SRC = "src-id";

/** Axis-aligned bbox diagonal of a ring set's outermost extent. */
function bboxSpan(rings: Pt[][]): number {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const r of rings) for (const p of r) {
    minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
  }
  return Math.hypot(maxX - minX, maxY - minY);
}

describe("generateSeedPaths", () => {
  it("emits ONE seed band (≥2 rings) tagged CUT_01_SEED", () => {
    const paths = generateSeedPaths(PART, DEFAULT_CONFIG, SRC);
    expect(paths.length).toBe(1);
    expect(paths[0].generatedClass).toBe("seed");
    expect(paths[0].groupName).toBe("CUT_01_SEED");
    expect(paths[0].rings.length).toBeGreaterThanOrEqual(2);
  });
  it("returns nothing when disabled", () => {
    const cfg = { ...DEFAULT_CONFIG, seed: { ...DEFAULT_CONFIG.seed, enabled: false } };
    expect(generateSeedPaths(PART, cfg, SRC)).toEqual([]);
  });
});

describe("generatePerforationPaths", () => {
  it("emits small single-ring pockets at spacing, more with cornerBoost", () => {
    const paths = generatePerforationPaths(PART, DEFAULT_CONFIG, SRC);
    expect(paths.length).toBeGreaterThan(0);
    expect(paths.every((p) => p.generatedClass === "perforate")).toBe(true);
    expect(paths.every((p) => p.groupName === "CUT_02_PERFORATE")).toBe(true);
    // each pocket is a single solid loop, pocketSize-scale (small bbox)
    for (const p of paths) {
      expect(p.rings.length).toBe(1);
      expect(bboxSpan(p.rings)).toBeLessThan(2);
    }
    // corner boost adds extra pockets
    const noBoost = generatePerforationPaths(
      PART,
      { ...DEFAULT_CONFIG, perforate: { ...DEFAULT_CONFIG.perforate, cornerBoost: false } },
      SRC,
    );
    expect(paths.length).toBeGreaterThan(noBoost.length);
  });
  it("returns nothing when disabled", () => {
    const cfg = { ...DEFAULT_CONFIG, perforate: { ...DEFAULT_CONFIG.perforate, enabled: false } };
    expect(generatePerforationPaths(PART, cfg, SRC)).toEqual([]);
  });
});

describe("generateDeepenPaths", () => {
  it("emits one band per enabled group in A→B→C→D order with correct names", () => {
    const paths = generateDeepenPaths(PART, DEFAULT_CONFIG, SRC);
    const enabled = DEFAULT_CONFIG.deepen.groups.filter((g) => g.enabled);
    expect(paths.length).toBe(enabled.length);
    expect(paths.every((p) => p.generatedClass === "deepen")).toBe(true);
    expect(paths.map((p) => p.groupName)).toEqual(enabled.map((g) => g.name));
    expect(paths.every((p) => p.rings.length >= 2)).toBe(true);
  });
  it("a wider group has a larger outer-ring bbox than a narrower one", () => {
    const paths = generateDeepenPaths(PART, DEFAULT_CONFIG, SRC);
    const a = paths.find((p) => p.groupName.includes("DEEPEN_A"))!;
    const d = paths.find((p) => p.groupName.includes("DEEPEN_D"))!;
    expect(bboxSpan(d.rings)).toBeGreaterThan(bboxSpan(a.rings));
  });
  it("skips disabled groups", () => {
    const cfg = {
      ...DEFAULT_CONFIG,
      deepen: {
        ...DEFAULT_CONFIG.deepen,
        groups: DEFAULT_CONFIG.deepen.groups.map((g, i) => ({ ...g, enabled: i === 0 })),
      },
    };
    const paths = generateDeepenPaths(PART, cfg, SRC);
    expect(paths.length).toBe(1);
  });
});

describe("generateCleanPaths", () => {
  it("emits wall band(s) tagged CUT_07_CLEAN", () => {
    const paths = generateCleanPaths(PART, DEFAULT_CONFIG, SRC);
    expect(paths.every((p) => p.generatedClass === "clean")).toBe(true);
    expect(paths.every((p) => p.groupName === "CUT_07_CLEAN")).toBe(true);
    expect(paths.every((p) => p.rings.length >= 2)).toBe(true);
    expect(paths.length).toBeGreaterThanOrEqual(2); // both walls
  });
  it("outer-only / inner-only emit a single wall band", () => {
    const outer = generateCleanPaths(
      PART,
      { ...DEFAULT_CONFIG, clean: { ...DEFAULT_CONFIG.clean, offsetSelection: "outer" } },
      SRC,
    );
    expect(outer.length).toBe(1);
    expect(outer[0].sideMode).toBe("outside");
  });
  it("returns nothing when disabled", () => {
    const cfg = { ...DEFAULT_CONFIG, clean: { ...DEFAULT_CONFIG.clean, enabled: false } };
    expect(generateCleanPaths(PART, cfg, SRC)).toEqual([]);
  });
  it("does not throw when an inward wall offset collapses a tiny part to nothing", () => {
    const tinyPart = buildPartRegion([
      {
        points: [{ x: 0, y: 0 }, { x: 0.02, y: 0 }, { x: 0.02, y: 0.02 }, { x: 0, y: 0.02 }],
        closed: true,
      },
    ]);
    const cfg = {
      ...DEFAULT_CONFIG,
      beamWidthMm: 0.5, // wall offset (0.5mm) >> the 0.02mm part
      clean: { ...DEFAULT_CONFIG.clean, offsetSelection: "inner" as const },
    };
    expect(() => generateCleanPaths(tinyPart, cfg, SRC)).not.toThrow();
    // any emitted band is a real ≥2-loop band, never a single-loop flood fill
    for (const p of generateCleanPaths(tinyPart, cfg, SRC)) {
      expect(p.rings.length).toBeGreaterThanOrEqual(2);
    }
  });
});
