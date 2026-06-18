import { describe, it, expect } from "vitest";
import { buildSpiralTest, type SpiralTestConfig } from "./spiralTest";
import { buildSpiralTestXs } from "./spiralTestXs";
import { isXsBuffer, xsToLegacyRaw } from "./xs";

const CFG: SpiralTestConfig = {
  channelWidth: { min: 0.6, max: 1.0, steps: 2 },
  pitch: { min: 0.03, max: 0.05, steps: 2 },
  diameterMm: 10, side: "outside", minChannelMm: 0.4, gapMm: 4,
  bedMm: { w: 300, h: 300 }, labels: { show: true, titlePrefix: "" },
  cut: { passes: 200, focusInitialMm: 0.01, focusStepMm: 0.06, focusIntervalPasses: 20,
         power: 100, speed: 1500, frequency: 65, pulseWidth: 80, laser: "red" },
  score: { laser: "red", power: 65, speed: 1944, passes: 1, linesPerCm: 300, scanMode: "bidirectional", pulseWidth: 500, frequency: 65 },
};

describe("buildSpiralTestXs", () => {
  it("round-trips with a VECTOR_CUTTING cut op + a FILL_VECTOR_ENGRAVING label op", () => {
    const result = buildSpiralTest(CFG);
    const buf = buildSpiralTestXs(result, CFG);
    expect(isXsBuffer(buf)).toBe(true);

    const { raw } = xsToLegacyRaw(buf);
    const r = raw as { canvas: Array<{ displays: Array<{ id: string; isFill?: boolean; fillRule?: string }> }>;
      device: { data: { value: Array<[string, { displays: { value: Array<[string, { processingType?: string;
        data?: Record<string, { parameter?: { customize?: Record<string, unknown> } }> }]> } }]> } } };

    const entries = r.device.data.value[0][1].displays.value;
    const types = entries.map(([, e]) => e.processingType);
    expect(types).toContain("VECTOR_CUTTING");
    expect(types).toContain("FILL_VECTOR_ENGRAVING");

    const anyFocus = entries.some(([, e]) => {
      const cz = e.data?.VECTOR_CUTTING?.parameter?.customize as Record<string, unknown> | undefined;
      return cz?.cuttingDrop === true && cz?.descentPerStep === 0.06;
    });
    expect(anyFocus).toBe(true);

    const anyFill = entries.some(([, e]) => {
      const cz = e.data?.FILL_VECTOR_ENGRAVING?.parameter?.customize as Record<string, unknown> | undefined;
      return cz?.power === 65 && cz?.speed === 1944 && cz?.density === 300
        && cz?.bitmapScanMode === "zMode" && cz?.processingLightSource === "red";
    });
    expect(anyFill).toBe(true);

    // label displays are filled, nonzero-wound
    const labelDisp = r.canvas[0].displays.filter((d) => d.fillRule === "nonzero");
    expect(labelDisp.length).toBeGreaterThanOrEqual(result.labelOutlines.length);
    expect(labelDisp.every((d) => d.isFill === true)).toBe(true);
  });
});
