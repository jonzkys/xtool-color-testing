import { describe, it, expect } from "vitest";
import { resolveAxis, circleRegion, composeTitle, buildSpiralTest, type SpiralTestConfig } from "./spiralTest";
import { PARAMS, PARAM_ORDER, type ParamKey } from "./spiralParams";
import type { ValidationProfile } from "../../types";

const CUT_PROFILE: ValidationProfile = {
  power: { kind: "range", min: 1, max: 100, step: 1 },
  speed: { kind: "range", min: 2, max: 10000, step: 1 },
  frequency: { kind: "range", min: 1, max: 4000, step: 1 },
  passes: { kind: "range", min: 1, max: 300, step: 1 },
  pulse_width: { kind: "stepped", values: [2, 4, 6, 9, 13, 20, 30, 45, 60, 80, 100, 150, 200, 250, 350, 500] },
  laser: { kind: "enum", values: ["red", "blue"] },
};

function baseCfg(over: Partial<SpiralTestConfig> = {}): SpiralTestConfig {
  const fixed = Object.fromEntries(PARAM_ORDER.map((k) => [k, PARAMS[k].defaultFixed])) as Record<ParamKey, number>;
  return {
    xParam: "channelWidth", yParam: "pitch",
    xAxis: { min: 0.6, max: 1.0, steps: 3 }, yAxis: { min: 0.03, max: 0.05, steps: 2 },
    fixed, diameterMm: 10, side: "outside", minChannelMm: 0.4, gapMm: 4, bedMm: { w: 300, h: 300 },
    focusInitialMm: 0.01, laser: "red",
    labels: { show: true, titlePrefix: "" },
    score: { laser: "red", power: 65, speed: 1944, passes: 1, linesPerCm: 300, scanMode: "bidirectional", pulseWidth: 500, frequency: 65 },
    ...over,
  };
}

describe("resolveAxis", () => {
  it("linearly spaces min..max over steps", () => {
    expect(resolveAxis({ min: 0.4, max: 1.0, steps: 4 })).toEqual([0.4, 0.6, 0.8, 1.0]);
  });
  it("steps=1 yields [min]", () => {
    expect(resolveAxis({ min: 0.5, max: 2, steps: 1 })).toEqual([0.5]);
  });
});

describe("circleRegion", () => {
  it("is one loop at radius d/2 around (cx,cy)", () => {
    const loops = circleRegion(10, 20, 8, 32);
    expect(loops[0].length).toBe(32);
    for (const p of loops[0]) expect(Math.hypot(p.x - 10, p.y - 20)).toBeCloseTo(4, 5);
  });
});

describe("composeTitle", () => {
  it("names both axes and lists only off-axis params (+ D, ID)", () => {
    const t = composeTitle(baseCfg());
    expect(t).toContain("X:Channel width");
    expect(t).toContain("Y:Pitch");
    expect(t).toContain("D:10");
    expect(t).toContain("ID:0.01");
    expect(t).toContain("S:1500");   // off-axis speed shown
    expect(t).not.toContain("CW:");  // channel width is on X — not in the fixed list
    expect(t).not.toContain("PT:");  // pitch is on Y
  });
  it("prepends a non-empty prefix", () => {
    expect(composeTitle(baseCfg({ labels: { show: true, titlePrefix: "BRASS" } }))).toMatch(/^BRASS {2}X:Channel width/);
  });
});

describe("buildSpiralTest", () => {
  it("produces one cell per (col,row) with the swept X/Y values", () => {
    const r = buildSpiralTest(baseCfg()); // 3 cols × 2 rows
    expect(r.cells.length).toBe(6);
    expect(r.cells.find((c) => c.col === 0 && c.row === 0)!.xValue).toBeCloseTo(0.6, 5);
    expect(r.cells.find((c) => c.col === 2 && c.row === 1)!.yValue).toBeCloseTo(0.05, 5);
  });
  it("emits spiral cut paths (one arm per path) tagged with a known group", () => {
    const r = buildSpiralTest(baseCfg());
    expect(r.cutPaths.length).toBeGreaterThanOrEqual(6);
    expect(r.cutPaths.every((p) => p.generatedClass === "spiral" && p.rings.length === 1)).toBe(true);
    expect(r.cutPaths.every((p) => p.groupName in r.stageParams)).toBe(true);
  });
  it("dedupes profiles: a geometry-only sweep is ONE cut profile", () => {
    const r = buildSpiralTest(baseCfg()); // channel × pitch — both geometry
    expect(Object.keys(r.stageParams).length).toBe(1);
  });
  it("a profile×profile sweep fans out to N×M profiles", () => {
    const r = buildSpiralTest(baseCfg({
      xParam: "speed", yParam: "passes",
      xAxis: { min: 1000, max: 2000, steps: 2 }, yAxis: { min: 150, max: 300, steps: 2 },
    }));
    expect(Object.keys(r.stageParams).length).toBe(4);
    const speeds = Object.values(r.stageParams).map((s) => s.speed).sort((a, b) => a! - b!);
    expect(speeds).toEqual([1000, 1000, 2000, 2000]);
  });
  it("a mixed sweep (geometry × profile) makes one profile per profile-value", () => {
    const r = buildSpiralTest(baseCfg({
      xParam: "channelWidth", yParam: "speed",
      xAxis: { min: 0.6, max: 1.0, steps: 3 }, yAxis: { min: 1000, max: 2000, steps: 2 },
    }));
    expect(Object.keys(r.stageParams).length).toBe(2); // one per speed
  });
  it("emits axis labels: 1 title + cols X-values + rows Y-values, at param precision", () => {
    const r = buildSpiralTest(baseCfg({
      xParam: "speed", xAxis: { min: 1000, max: 2000, steps: 3 },
    }));
    expect(r.labelOutlines.length).toBe(1 + 3 + 2);
    expect(r.labelOutlines.some((l) => l.text === "1000")).toBe(true); // speed 0dp
    expect(r.labelOutlines.some((l) => l.text === "0.030")).toBe(true); // pitch 3dp
  });
  it("omits labels when labels.show is false", () => {
    expect(buildSpiralTest(baseCfg({ labels: { show: false, titlePrefix: "" } })).labelOutlines.length).toBe(0);
  });
  it("focus-interval/step sweeps land in the cut profile", () => {
    const r = buildSpiralTest(baseCfg({
      xParam: "focusStep", yParam: "focusInterval",
      xAxis: { min: 0.04, max: 0.08, steps: 2 }, yAxis: { min: 10, max: 20, steps: 2 },
    }));
    const steps = new Set(Object.values(r.stageParams).map((s) => s.descentPerStep));
    expect(steps.has(0.04)).toBe(true);
    expect(steps.has(0.08)).toBe(true);
    const intervals = new Set(Object.values(r.stageParams).map((s) => s.descentIntervalDescent));
    expect(intervals.has(10)).toBe(true);
    expect(intervals.has(20)).toBe(true);
  });
  it("footprint exceeds a tiny bed", () => {
    expect(buildSpiralTest(baseCfg({ bedMm: { w: 5, h: 5 } })).overBed).toBe(true);
  });
});

describe("buildSpiralTest with a machine profile", () => {
  it("a pulse-width axis sweeps the allowed-in-range values (cells = allowed × rows)", () => {
    const r = buildSpiralTest(baseCfg({
      xParam: "pulseWidth", yParam: "pitch",
      xAxis: { min: 60, max: 150, steps: 99 }, yAxis: { min: 0.03, max: 0.05, steps: 2 },
    }), CUT_PROFILE);
    // allowed in [60,150] = 60,80,100,150 → 4 cols × 2 rows
    expect(r.cells.length).toBe(8);
    expect(r.labelOutlines.some((l) => l.text === "80")).toBe(true);
    expect(r.labelOutlines.some((l) => l.text === "150")).toBe(true);
  });
  it("clamps a fixed value above the machine max into the cut profile", () => {
    const r = buildSpiralTest(baseCfg({
      fixed: { ...baseCfg().fixed, speed: 99999 },
    }), CUT_PROFILE);
    expect(Object.values(r.stageParams).every((s) => s.speed === 10000)).toBe(true);
  });
  it("omitting the profile preserves the app-clamp behaviour", () => {
    const r = buildSpiralTest(baseCfg({ fixed: { ...baseCfg().fixed, speed: 99999 } }));
    expect(Object.values(r.stageParams).every((s) => s.speed === 99999)).toBe(true);
  });
});

import type { CellShape } from "./spiralTest";

describe("cell shapes", () => {
  const SHAPES: CellShape[] = ["circle", "square", "diamond", "hexagon", "octagon", "star", "letterJ"];
  it("every shape produces exactly one continuous arm per cell", () => {
    for (const cellShape of SHAPES) {
      const r = buildSpiralTest(baseCfg({
        cellShape,
        xAxis: { min: 0.6, max: 1.0, steps: 2 }, yAxis: { min: 0.03, max: 0.05, steps: 2 },
      }));
      expect(r.cells.length).toBe(4);
      expect(r.cells.every((c) => c.cut.length === 1)).toBe(true);
      expect(r.cutPaths.length).toBe(r.cells.length);
    }
  });
  it("defaults to circle when cellShape is omitted", () => {
    const omitted = buildSpiralTest(baseCfg());
    const circle = buildSpiralTest(baseCfg({ cellShape: "circle" }));
    expect(omitted.cutPaths.length).toBe(circle.cutPaths.length);
  });
});
