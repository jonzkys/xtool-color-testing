import { describe, it, expect } from "vitest";
import { PARAMS, PARAM_ORDER, formatValue } from "./spiralParams";

describe("spiralParams registry", () => {
  it("has 9 params in a stable order, each fully described", () => {
    expect(PARAM_ORDER).toEqual([
      "channelWidth", "pitch", "speed", "passes", "power",
      "frequency", "pulseWidth", "focusStep", "focusInterval",
    ]);
    for (const k of PARAM_ORDER) {
      const d = PARAMS[k];
      expect(d.key).toBe(k);
      expect(d.label.length).toBeGreaterThan(0);
      expect(d.abbrev.length).toBeGreaterThan(0);
      expect(["geometry", "profile"]).toContain(d.kind);
      expect(Number.isFinite(d.defaultFixed)).toBe(true);
      expect(d.step).toBeGreaterThan(0); // precision-appropriate, never the default 1-snap
      expect(d.defaultAxis.steps).toBeGreaterThanOrEqual(1);
    }
  });
  it("classifies channel width + pitch as geometry, the rest as profile", () => {
    const geom = PARAM_ORDER.filter((k) => PARAMS[k].kind === "geometry");
    expect(geom).toEqual(["channelWidth", "pitch"]);
  });
  it("formats values at each param's precision", () => {
    expect(formatValue("channelWidth", 0.6)).toBe("0.60");
    expect(formatValue("pitch", 0.03)).toBe("0.030");
    expect(formatValue("speed", 1533.33)).toBe("1533");
    expect(formatValue("focusStep", 0.06)).toBe("0.06");
    expect(formatValue("passes", 250)).toBe("250");
  });
  it("clamps to each param's domain", () => {
    expect(PARAMS.passes.clamp(2.6)).toBe(3);          // round, >= 1
    expect(PARAMS.passes.clamp(0.2)).toBe(1);
    expect(PARAMS.focusInterval.clamp(0)).toBe(1);     // >= 1
    expect(PARAMS.power.clamp(150)).toBe(100);         // 0..100
    expect(PARAMS.power.clamp(-5)).toBe(0);
    expect(PARAMS.pulseWidth.clamp(-3)).toBe(0);       // >= 0
    expect(PARAMS.pitch.clamp(-1)).toBe(0.01);         // floored at 0.01 (no near-zero spiral explosion)
    expect(PARAMS.pitch.clamp(0)).toBe(0.01);
    expect(PARAMS.pitch.clamp(0.04)).toBe(0.04);       // normal values pass through
    expect(PARAMS.focusStep.clamp(0)).toBe(0);         // >= 0
  });
});
