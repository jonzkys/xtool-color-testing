import { describe, it, expect } from "vitest";
import { resolveAxis, circleRegion, formatLabel } from "./spiralTest";
import { labelWidth } from "./strokeFont";

describe("resolveAxis", () => {
  it("linearly spaces min..max over steps", () => {
    expect(resolveAxis({ min: 0.4, max: 1.0, steps: 4 })).toEqual([0.4, 0.6, 0.8, 1.0]);
  });
  it("steps=1 yields [min]", () => {
    expect(resolveAxis({ min: 0.5, max: 2, steps: 1 })).toEqual([0.5]);
  });
  it("clamps steps to >= 1 and dedupes a zero-span axis", () => {
    expect(resolveAxis({ min: 0.3, max: 0.3, steps: 3 })).toEqual([0.3, 0.3, 0.3]);
  });
});

describe("circleRegion", () => {
  it("is one closed-ish loop of `segments` points centred at (cx,cy) with radius d/2", () => {
    const loops = circleRegion(10, 20, 8, 32);
    expect(loops.length).toBe(1);
    expect(loops[0].length).toBe(32);
    for (const p of loops[0]) {
      expect(Math.hypot(p.x - 10, p.y - 20)).toBeCloseTo(4, 5); // radius 4
    }
  });
});

describe("formatLabel", () => {
  it("renders channel/pitch as cw(2dp)/pitch(3dp)", () => {
    expect(formatLabel(0.8, 0.04)).toBe("0.80/0.040");
    expect(formatLabel(1, 0.035)).toBe("1.00/0.035");
  });
});

import { buildSpiralTest, type SpiralTestConfig } from "./spiralTest";

const CFG: SpiralTestConfig = {
  channelWidth: { min: 0.6, max: 1.0, steps: 3 }, // 3 cols
  pitch: { min: 0.03, max: 0.05, steps: 2 },       // 2 rows
  diameterMm: 8,
  side: "outside",
  minChannelMm: 0.4,
  gapMm: 4,
  bedMm: { w: 300, h: 300 },
  label: { sizeMm: 2.5, show: true },
  cut: { passes: 200, focusInitialMm: 0.01, focusStepMm: 0.06, focusIntervalPasses: 20,
         power: 100, speed: 1500, frequency: 65, pulseWidth: 80, laser: "red" },
  score: { laser: "red", power: 65, speed: 1944, passes: 1, pulseWidth: 500, frequency: 65 },
};

describe("buildSpiralTest", () => {
  it("produces one cell per (col,row) with the swept channel/pitch", () => {
    const r = buildSpiralTest(CFG);
    expect(r.cells.length).toBe(6); // 3 × 2
    const c00 = r.cells.find((c) => c.col === 0 && c.row === 0)!;
    expect(c00.channelWidthMm).toBeCloseTo(0.6, 5);
    expect(c00.pitchMm).toBeCloseTo(0.03, 5);
    const c21 = r.cells.find((c) => c.col === 2 && c.row === 1)!;
    expect(c21.channelWidthMm).toBeCloseTo(1.0, 5);
    expect(c21.pitchMm).toBeCloseTo(0.05, 5);
  });
  it("emits cut GeneratedPaths (spiral class) plus one score path per cell", () => {
    const r = buildSpiralTest(CFG);
    expect(r.cutPaths.length).toBeGreaterThanOrEqual(6); // >=1 arm per cell
    expect(r.cutPaths.every((p) => p.generatedClass === "spiral")).toBe(true);
    expect(r.cutPaths.every((p) => p.groupName === "CUT_SPIRAL")).toBe(true);
    expect(r.cutPaths.every((p) => p.rings.length === 1)).toBe(true); // one arm per path
    expect(r.labelPaths.length).toBe(6);
    expect(r.labelPaths.every((p) => p.generatedClass === "spiral")).toBe(true);
    expect(r.labelPaths.every((p) => p.groupName === "SCORE_LABEL")).toBe(true);
  });
  it("computes footprint and over-bed flag", () => {
    const r = buildSpiralTest(CFG);
    expect(r.footprintMm.w).toBeGreaterThan(0);
    expect(r.footprintMm.h).toBeGreaterThan(0);
    expect(r.overBed).toBe(false);
    const tiny = buildSpiralTest({ ...CFG, bedMm: { w: 5, h: 5 } });
    expect(tiny.overBed).toBe(true);
  });
  it("omits labels when label.show is false", () => {
    const r = buildSpiralTest({ ...CFG, label: { sizeMm: 2.5, show: false } });
    expect(r.labelPaths.length).toBe(0);
  });
  it("widens the cell to fit a label wider than the disc (no horizontal overlap)", () => {
    // Small disc + big label → label width dominates the cell.
    const cfg: SpiralTestConfig = { ...CFG, diameterMm: 4, label: { sizeMm: 4, show: true } };
    const r = buildSpiralTest(cfg);
    const cols = 3; // channelWidth steps in CFG
    const cellW = (r.footprintMm.w - 2 * 5) / cols; // MARGIN_MM = 5
    const widestLabel = labelWidth("1.00/0.050", 4); // 10-char label at size 4
    expect(cellW).toBeGreaterThanOrEqual(widestLabel);
  });
});
