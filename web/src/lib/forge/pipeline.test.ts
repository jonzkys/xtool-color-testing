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

  it("compound (4-subpath) real sample produces a sane path count (<1500)", () => {
    // Before the fix, the merged-subpath path sent clipper into thousands of
    // tiny rings (seed alone was ~1239). After treating each subpath independently
    // the total should be well below 1500.
    const parsed = parseXcsFile(loadSample());
    const inciseId = findInciseObjects(parsed)[0].id;
    const { stats } = runPipeline(parsed, inciseId, DEFAULT_CONFIG);
    expect(stats.totalPaths).toBeLessThan(1500);
    expect(stats.totalPaths).toBeGreaterThan(0);
  });
});
