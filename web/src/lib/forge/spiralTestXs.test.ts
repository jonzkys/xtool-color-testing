import { describe, it, expect } from "vitest";
import { buildSpiralTest, type SpiralTestConfig } from "./spiralTest";
import { buildSpiralTestXs } from "./spiralTestXs";
import { isXsBuffer, xsToLegacyRaw } from "./xs";

const CFG: SpiralTestConfig = {
  channelWidth: { min: 0.6, max: 1.0, steps: 2 },
  pitch: { min: 0.03, max: 0.05, steps: 2 },
  diameterMm: 8, side: "outside", minChannelMm: 0.4, gapMm: 4,
  bedMm: { w: 300, h: 300 }, label: { sizeMm: 2.5, show: true },
  cut: { passes: 200, focusInitialMm: 0.01, focusStepMm: 0.06, focusIntervalPasses: 20,
         power: 100, speed: 1500, frequency: 65, pulseWidth: 80, laser: "red" },
  score: { laser: "red", power: 65, speed: 1944, passes: 1, pulseWidth: 500, frequency: 65 },
};

describe("buildSpiralTestXs", () => {
  it("emits a valid .xs that round-trips with a VECTOR_CUTTING cut op + a VECTOR_ENGRAVING label op", () => {
    const result = buildSpiralTest(CFG);
    const buf = buildSpiralTestXs(result, CFG);
    expect(isXsBuffer(buf)).toBe(true);

    const { raw } = xsToLegacyRaw(buf);
    const r = raw as { canvas: Array<{ displays: Array<{ id: string }> }>;
      device: { data: { value: Array<[string, { displays: { value: Array<[string, { processingType?: string;
        data?: Record<string, { parameter?: { customize?: Record<string, unknown> } }> }]> } }]> } } };

    // displays: at least one per source path (cut arms may be chunked into multiple displays)
    expect(r.canvas[0].displays.length).toBeGreaterThanOrEqual(result.cutPaths.length + result.labelPaths.length);

    const entries = r.device.data.value[0][1].displays.value;
    const types = entries.map(([, e]) => e.processingType);
    // two operations: spiral cuts (VECTOR_CUTTING) + engraved labels (VECTOR_ENGRAVING)
    expect(types).toContain("VECTOR_CUTTING");
    expect(types).toContain("VECTOR_ENGRAVING");

    // the cut group carries focus step-down; at least one entry has it on
    const anyFocus = entries.some(([, e]) => {
      const cz = e.data?.VECTOR_CUTTING?.parameter?.customize as Record<string, unknown> | undefined;
      return cz?.cuttingDrop === true && cz?.descentPerStep === 0.06;
    });
    expect(anyFocus).toBe(true);
    // at least one entry is the label vector-engrave op carrying the MOPA IR params
    const anyEngrave = entries.some(([, e]) => {
      const cz = e.data?.VECTOR_ENGRAVING?.parameter?.customize as Record<string, unknown> | undefined;
      return cz?.power === 65 && cz?.speed === 1944 && cz?.pulseWidth === 500
        && cz?.mopaFrequency === 65 && cz?.processingLightSource === "red";
    });
    expect(anyEngrave).toBe(true);
  });
});
