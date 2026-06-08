import { describe, it, expect } from "vitest";
import { LEAN, AGGRESSIVE, PRESETS } from "./presets";

describe("forge presets", () => {
  it("AGGRESSIVE keeps the 1/2/4/8 × 50/100/200/256 deepen schedule", () => {
    expect(AGGRESSIVE.deepen.groups.map((g) => [g.toLayer, g.widthMultiplier])).toEqual([
      [50, 1], [100, 2], [200, 4], [256, 8],
    ]);
    expect(AGGRESSIVE.activePreset).toBe("aggressive");
  });

  it("LEAN is one main full-depth group + a disabled relief group, sparse perforation", () => {
    const enabled = LEAN.deepen.groups.filter((g) => g.enabled);
    expect(enabled).toHaveLength(1);
    expect(enabled[0].widthMultiplier).toBe(1);
    expect(LEAN.perforate.spacingMm).toBeGreaterThanOrEqual(4);
    expect(LEAN.seed.layerCount).toBeLessThanOrEqual(5);
    expect(LEAN.activePreset).toBe("lean");
  });

  it("PRESETS is keyed by id", () => {
    expect(PRESETS.lean).toBe(LEAN);
    expect(PRESETS.aggressive).toBe(AGGRESSIVE);
  });
});
