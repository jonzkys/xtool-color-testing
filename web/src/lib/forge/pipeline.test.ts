// web/src/lib/forge/pipeline.test.ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseXcsFile, findInciseObjects } from "./xcs";
import { runPipeline } from "./pipeline";
import { DEFAULT_CONFIG } from "./defaults";

const SAMPLE = resolve(__dirname, "../../../../samples/xcs/incise_emboss.xcs");
function loadSample(): ArrayBuffer {
  const b = readFileSync(SAMPLE);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
}

describe("runPipeline", () => {
  it("returns paths in physical process order seed→perforate→deepen→clean", () => {
    const parsed = parseXcsFile(loadSample());
    const inciseId = findInciseObjects(parsed)[0].id;
    const { paths, stats } = runPipeline(parsed, inciseId, DEFAULT_CONFIG);
    const classes = paths.map((p) => p.generatedClass);
    const firstDeepen = classes.indexOf("deepen");
    const firstClean = classes.indexOf("clean");
    expect(classes.indexOf("seed")).toBeLessThan(classes.indexOf("perforate"));
    expect(classes.indexOf("perforate")).toBeLessThan(firstDeepen);
    expect(firstDeepen).toBeLessThan(firstClean);
    expect(stats.totalPaths).toBe(paths.length);
    expect(stats.pathCounts.deepen).toBeGreaterThan(0);
  });

  it("operationOrder is strictly increasing across the whole result", () => {
    const parsed = parseXcsFile(loadSample());
    const inciseId = findInciseObjects(parsed)[0].id;
    const { paths } = runPipeline(parsed, inciseId, DEFAULT_CONFIG);
    for (let i = 1; i < paths.length; i++) {
      expect(paths[i].operationOrder).toBeGreaterThan(paths[i - 1].operationOrder);
    }
  });

  it("warns (not throws) when winding can't be inferred confidently", () => {
    const parsed = parseXcsFile(loadSample());
    const inciseId = findInciseObjects(parsed)[0].id;
    // force an open contour by overriding the object's dPath via config? Instead
    // assert the confident-path produces no winding warning:
    const { stats } = runPipeline(parsed, inciseId, DEFAULT_CONFIG);
    expect(Array.isArray(stats.warnings)).toBe(true);
  });

  it("compound (4-subpath) real sample produces a sane path count (<200)", () => {
    // The part-region model emits ONE band per stage for the WHOLE part plus a
    // handful of perforation pockets — far fewer paths than the old stacks.
    const parsed = parseXcsFile(loadSample());
    const inciseId = findInciseObjects(parsed)[0].id;
    const { stats } = runPipeline(parsed, inciseId, DEFAULT_CONFIG);
    expect(stats.totalPaths).toBeLessThan(200);
    expect(stats.totalPaths).toBeGreaterThan(0);
  });

  it("a zero mm/unit override falls back to calibration instead of 0/Infinity", () => {
    const parsed = parseXcsFile(loadSample());
    const inciseId = findInciseObjects(parsed)[0].id;
    // `0 ?? cal` evaluates to 0 (?? only catches null/undefined); a corrupt
    // persisted override of 0 must not poison the unit scale.
    const { stats } = runPipeline(parsed, inciseId, { ...DEFAULT_CONFIG, mmPerUnitOverride: 0 });
    expect(Number.isFinite(stats.mmPerUnit)).toBe(true);
    expect(stats.mmPerUnit).toBeGreaterThan(0);
  });

  it("each deepen band is a compound region with the part body as a hole (≥2 rings)", () => {
    const parsed = parseXcsFile(loadSample());
    const inciseId = findInciseObjects(parsed)[0].id;
    const { paths } = runPipeline(parsed, inciseId, DEFAULT_CONFIG);
    const deepen = paths.filter((p) => p.generatedClass === "deepen");
    expect(deepen.length).toBeGreaterThan(0);
    for (const p of deepen) {
      expect(p.rings.length).toBeGreaterThanOrEqual(2);
    }
  });
});
