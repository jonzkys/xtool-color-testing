import { describe, it, expect } from "vitest";
import { buildSpiralTest, type SpiralTestConfig } from "./spiralTest";
import { buildSpiralTestXs } from "./spiralTestXs";
import { isXsBuffer, xsToLegacyRaw } from "./xs";
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
    xAxis: { min: 0.6, max: 1.0, steps: 2 }, yAxis: { min: 0.03, max: 0.05, steps: 2 },
    fixed, diameterMm: 10, side: "outside", minChannelMm: 0.4, gapMm: 4, bedMm: { w: 300, h: 300 },
    focusInitialMm: 0.01, laser: "red",
    labels: { show: true, titlePrefix: "" },
    score: { laser: "red", power: 65, speed: 1944, passes: 1, linesPerCm: 300, scanMode: "bidirectional", pulseWidth: 500, frequency: 65 },
    ...over,
  };
}

type Raw = {
  device: { data: { value: Array<[string, { displays: { value: Array<[string, {
    processingType?: string;
    data?: Record<string, { parameter?: { customize?: Record<string, unknown> } }>;
  }]> } }]> } };
};

function cutCustomizes(raw: unknown): Record<string, unknown>[] {
  const entries = (raw as Raw).device.data.value[0][1].displays.value;
  return entries
    .filter(([, e]) => e.processingType === "VECTOR_CUTTING")
    .map(([, e]) => e.data!.VECTOR_CUTTING!.parameter!.customize as Record<string, unknown>);
}
function types(raw: unknown): string[] {
  return (raw as Raw).device.data.value[0][1].displays.value.map(([, e]) => e.processingType ?? "");
}

describe("buildSpiralTestXs", () => {
  it("round-trips a geometry sweep to a single VECTOR_CUTTING profile + the FILL_VECTOR_ENGRAVING labels", () => {
    const buf = buildSpiralTestXs(buildSpiralTest(baseCfg()), baseCfg());
    expect(isXsBuffer(buf)).toBe(true);
    const { raw } = xsToLegacyRaw(buf);
    expect(types(raw)).toContain("VECTOR_CUTTING");
    expect(types(raw)).toContain("FILL_VECTOR_ENGRAVING");
    // geometry-only sweep → all cut entries share one speed (one profile)
    const speeds = new Set(cutCustomizes(raw).map((c) => c.speed));
    expect(speeds.size).toBe(1);
    expect([...speeds][0]).toBe(1500);
  });
  it("a speed sweep produces multiple distinct VECTOR_CUTTING speeds", () => {
    const cfg = baseCfg({ xParam: "speed", yParam: "pitch", xAxis: { min: 1000, max: 2000, steps: 2 } });
    const { raw } = xsToLegacyRaw(buildSpiralTestXs(buildSpiralTest(cfg), cfg));
    const speeds = new Set(cutCustomizes(raw).map((c) => c.speed));
    expect(speeds.has(1000)).toBe(true);
    expect(speeds.has(2000)).toBe(true);
  });
  it("a focus-step sweep varies descentPerStep on the cut profiles", () => {
    const cfg = baseCfg({ xParam: "focusStep", yParam: "pitch", xAxis: { min: 0.04, max: 0.08, steps: 2 } });
    const { raw } = xsToLegacyRaw(buildSpiralTestXs(buildSpiralTest(cfg), cfg));
    const steps = new Set(cutCustomizes(raw).map((c) => c.descentPerStep));
    expect(steps.has(0.04)).toBe(true);
    expect(steps.has(0.08)).toBe(true);
  });
  it("carries the MOPA IR fill-engrave label profile", () => {
    const { raw } = xsToLegacyRaw(buildSpiralTestXs(buildSpiralTest(baseCfg()), baseCfg()));
    const entries = (raw as Raw).device.data.value[0][1].displays.value;
    const anyFill = entries.some(([, e]) => {
      const cz = e.data?.FILL_VECTOR_ENGRAVING?.parameter?.customize as Record<string, unknown> | undefined;
      return cz?.power === 65 && cz?.speed === 1944 && cz?.density === 300 && cz?.bitmapScanMode === "zMode";
    });
    expect(anyFill).toBe(true);
  });
  it("a pulse-width sweep emits distinct cut pulse widths from the allowed set", () => {
    const cfg = baseCfg({ xParam: "pulseWidth", yParam: "pitch", xAxis: { min: 60, max: 150, steps: 99 } });
    const { raw } = xsToLegacyRaw(buildSpiralTestXs(buildSpiralTest(cfg, CUT_PROFILE), cfg));
    const pws = new Set(cutCustomizes(raw).map((c) => c.pulseWidth));
    expect(pws.has(60)).toBe(true);
    expect(pws.has(80)).toBe(true);
    expect(pws.has(150)).toBe(true);
    expect(pws.has(83)).toBe(false); // only allowed values appear
  });
});
