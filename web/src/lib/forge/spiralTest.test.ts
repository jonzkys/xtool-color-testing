import { describe, it, expect } from "vitest";
import { resolveAxis, circleRegion, composeTitle, buildSpiralTest, type SpiralTestConfig } from "./spiralTest";

const CFG: SpiralTestConfig = {
  channelWidth: { min: 0.6, max: 1.0, steps: 3 },
  pitch: { min: 0.03, max: 0.05, steps: 2 },
  diameterMm: 10, side: "outside", minChannelMm: 0.4, gapMm: 4,
  bedMm: { w: 300, h: 300 }, labels: { show: true, titlePrefix: "" },
  cut: { passes: 250, focusInitialMm: 0.01, focusStepMm: 0.06, focusIntervalPasses: 20,
         power: 100, speed: 1500, frequency: 65, pulseWidth: 80, laser: "red" },
  score: { laser: "red", power: 65, speed: 1944, passes: 1, linesPerCm: 300, scanMode: "bidirectional", pulseWidth: 500, frequency: 65 },
};

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
  it("summarises the fixed params (D/P/F/PW/S/ID/DI/DS)", () => {
    expect(composeTitle(CFG)).toBe("D:10 P:100 F:65 PW:80 S:1500 ID:0.01 DI:20 DS:0.06");
  });
  it("prepends a non-empty prefix", () => {
    expect(composeTitle({ ...CFG, labels: { show: true, titlePrefix: "BRASS" } }))
      .toBe("BRASS  D:10 P:100 F:65 PW:80 S:1500 ID:0.01 DI:20 DS:0.06");
  });
});

describe("buildSpiralTest", () => {
  it("produces one cell per (col,row) with the swept values", () => {
    const r = buildSpiralTest(CFG);
    expect(r.cells.length).toBe(6);
    expect(r.cells.find((c) => c.col === 0 && c.row === 0)!.channelWidthMm).toBeCloseTo(0.6, 5);
    expect(r.cells.find((c) => c.col === 2 && c.row === 1)!.pitchMm).toBeCloseTo(0.05, 5);
  });
  it("emits spiral cut paths (one arm per path)", () => {
    const r = buildSpiralTest(CFG);
    expect(r.cutPaths.length).toBeGreaterThanOrEqual(6);
    expect(r.cutPaths.every((p) => p.generatedClass === "spiral" && p.groupName === "CUT_SPIRAL" && p.rings.length === 1)).toBe(true);
  });
  it("emits axis labels: 1 title + cols X-values + rows Y-values", () => {
    const r = buildSpiralTest(CFG);
    expect(r.labelOutlines.length).toBe(1 + 3 + 2); // title + 3 cols + 2 rows
    expect(r.labelOutlines[0].text).toBe(composeTitle(CFG));
    expect(r.labelOutlines.some((l) => l.text === "0.60")).toBe(true); // an X value
    expect(r.labelOutlines.some((l) => l.text === "0.030")).toBe(true); // a Y value
    expect(r.labelOutlines.every((l) => l.rings.length >= 1)).toBe(true);
  });
  it("omits labels when labels.show is false", () => {
    expect(buildSpiralTest({ ...CFG, labels: { show: false, titlePrefix: "" } }).labelOutlines.length).toBe(0);
  });
  it("axis text scales with diameter (diameter-aware)", () => {
    const small = buildSpiralTest({ ...CFG, diameterMm: 4 });
    const big = buildSpiralTest({ ...CFG, diameterMm: 20 });
    // a Y label's height grows with the cell/diameter
    const yH = (res: ReturnType<typeof buildSpiralTest>) => {
      const l = res.labelOutlines.find((o) => o.text === "0.030")!;
      const ys = l.rings.flat().map((p) => p.y);
      return Math.max(...ys) - Math.min(...ys);
    };
    expect(yH(big)).toBeGreaterThan(yH(small));
  });
  it("footprint exceeds a tiny bed", () => {
    expect(buildSpiralTest({ ...CFG, bedMm: { w: 5, h: 5 } }).overBed).toBe(true);
  });
});
