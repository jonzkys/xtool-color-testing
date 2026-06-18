import { describe, it, expect } from "vitest";
import { buildSpiralTest, type SpiralTestConfig } from "./spiralTest";
import { estimateSpiralTestSeconds } from "./spiralTestTime";
import { PARAMS, PARAM_ORDER, type ParamKey } from "./spiralParams";

function baseCfg(over: Partial<SpiralTestConfig> = {}): SpiralTestConfig {
  const fixed = Object.fromEntries(PARAM_ORDER.map((k) => [k, PARAMS[k].defaultFixed])) as Record<ParamKey, number>;
  return {
    xParam: "channelWidth", yParam: "pitch",
    xAxis: { min: 0.6, max: 1.0, steps: 2 }, yAxis: { min: 0.03, max: 0.05, steps: 2 },
    fixed, diameterMm: 10, side: "outside", minChannelMm: 0.4, gapMm: 4, bedMm: { w: 300, h: 300 },
    focusInitialMm: 0.01, laser: "red",
    labels: { show: true, titlePrefix: "" },
    score: { laser: "red", power: 65, speed: 1944, passes: 1, linesPerCm: 300, scanMode: "bidirectional", pulseWidth: 500, frequency: 65 },
    ...over,
  };
}

describe("estimateSpiralTestSeconds", () => {
  it("cut-only when labels are off; total === cut", () => {
    const cfg = baseCfg({ labels: { show: false, titlePrefix: "" } });
    const r = estimateSpiralTestSeconds(buildSpiralTest(cfg), cfg);
    expect(r.cutSeconds).toBeGreaterThan(0);
    expect(r.engraveSeconds).toBe(0);
    expect(r.totalSeconds).toBeCloseTo(r.cutSeconds, 6);
  });
  it("labels add engrave time; total = cut + engrave", () => {
    const cfg = baseCfg();
    const r = estimateSpiralTestSeconds(buildSpiralTest(cfg), cfg);
    expect(r.engraveSeconds).toBeGreaterThan(0);
    expect(r.totalSeconds).toBeCloseTo(r.cutSeconds + r.engraveSeconds, 6);
  });
  it("doubling fixed passes ~doubles cut time", () => {
    const lo = baseCfg({ fixed: { ...baseCfg().fixed, passes: 100 }, labels: { show: false, titlePrefix: "" } });
    const hi = baseCfg({ fixed: { ...baseCfg().fixed, passes: 200 }, labels: { show: false, titlePrefix: "" } });
    const ratio = estimateSpiralTestSeconds(buildSpiralTest(hi), hi).cutSeconds
      / estimateSpiralTestSeconds(buildSpiralTest(lo), lo).cutSeconds;
    expect(ratio).toBeGreaterThan(1.9);
    expect(ratio).toBeLessThan(2.1);
  });
  it("doubling fixed speed ~halves cut time", () => {
    const slow = baseCfg({ fixed: { ...baseCfg().fixed, speed: 1000 }, labels: { show: false, titlePrefix: "" } });
    const fast = baseCfg({ fixed: { ...baseCfg().fixed, speed: 2000 }, labels: { show: false, titlePrefix: "" } });
    const ratio = estimateSpiralTestSeconds(buildSpiralTest(slow), slow).cutSeconds
      / estimateSpiralTestSeconds(buildSpiralTest(fast), fast).cutSeconds;
    expect(ratio).toBeGreaterThan(1.8);
    expect(ratio).toBeLessThan(2.1);
  });
  it("a larger grid takes longer", () => {
    const small = baseCfg();
    const big = baseCfg({ xAxis: { min: 0.6, max: 1.0, steps: 4 }, yAxis: { min: 0.03, max: 0.05, steps: 4 } });
    expect(estimateSpiralTestSeconds(buildSpiralTest(big), big).totalSeconds)
      .toBeGreaterThan(estimateSpiralTestSeconds(buildSpiralTest(small), small).totalSeconds);
  });
});
