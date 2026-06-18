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
  score: { power: 8, speed: 300, passes: 1 },
};

describe("buildSpiralTestXs", () => {
  it("emits a valid .xs that round-trips with both cut and score operations", () => {
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
    // every generated path is VECTOR_CUTTING (labels are low-power single-pass cuts)
    expect(types.every((t) => t === "VECTOR_CUTTING")).toBe(true);

    // the cut group carries focus step-down; at least one entry has it on
    const anyFocus = entries.some(([, e]) => {
      const cz = e.data?.VECTOR_CUTTING?.parameter?.customize as Record<string, unknown> | undefined;
      return cz?.cuttingDrop === true && cz?.descentPerStep === 0.06;
    });
    expect(anyFocus).toBe(true);
    // at least one entry is the low-power label op (power 8, no descent)
    const anyLabel = entries.some(([, e]) => {
      const cz = e.data?.VECTOR_CUTTING?.parameter?.customize as Record<string, unknown> | undefined;
      return cz?.power === 8 && cz?.cuttingDrop === false;
    });
    expect(anyLabel).toBe(true);
  });
});
