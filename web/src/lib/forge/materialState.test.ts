import { describe, it, expect } from "vitest";
import { loadMaterialState, serializeMaterialState, MATERIAL_LS_KEY, OLD_CONFIG_LS_KEY } from "./materialState";
import { MATERIAL_THICKNESSES_MM } from "./types";
import { SPIRAL_CUT } from "./presets";

const store = (m: Record<string, string>) => (k: string) => (k in m ? m[k] : null);

describe("loadMaterialState", () => {
  it("fresh (no keys) → all five thicknesses default to SPIRAL_CUT, active 1mm", () => {
    const s = loadMaterialState(store({}));
    expect(s.activeThicknessMm).toBe(1);
    expect(Object.keys(s.configs).sort()).toEqual(MATERIAL_THICKNESSES_MM.map(String).sort());
    expect(s.configs["2"].spiral.channelWidthMm).toBe(SPIRAL_CUT.spiral.channelWidthMm);
    expect(s.configs["4"].spiral.baselineIncise).toEqual(SPIRAL_CUT.spiral.baselineIncise);
  });

  it("bakes per-thickness baseline defaults (1.5mm=250 layers, 2mm=500, others share SPIRAL_CUT)", () => {
    const s = loadMaterialState(store({}));
    expect(s.configs["1.5"].spiral.baselineIncise).toEqual({ speed: 1500, layers: 250 });
    expect(s.configs["2"].spiral.baselineIncise).toEqual({ speed: 1500, layers: 500 });
    // a thickness with no override keeps the shared SPIRAL_CUT default (100 layers)
    expect(s.configs["1"].spiral.baselineIncise).toEqual(SPIRAL_CUT.spiral.baselineIncise);
    expect(s.configs["3"].spiral.baselineIncise).toEqual(SPIRAL_CUT.spiral.baselineIncise);
  });

  it("a persisted per-thickness baseline edit overrides the baked default", () => {
    const state = { activeThicknessMm: 2, configs: { "2": { spiral: { ...SPIRAL_CUT.spiral, baselineIncise: { speed: 800, layers: 600 } } } } };
    const s = loadMaterialState(store({ [MATERIAL_LS_KEY]: JSON.stringify(state) }));
    expect(s.configs["2"].spiral.baselineIncise).toEqual({ speed: 800, layers: 600 });
    // an unedited thickness still gets its baked default
    expect(s.configs["1.5"].spiral.baselineIncise).toEqual({ speed: 1500, layers: 250 });
  });

  it("migrates from the old single config → every thickness seeded from it", () => {
    const old = JSON.stringify({ spiral: { ...SPIRAL_CUT.spiral, channelWidthMm: 0.99 } });
    const s = loadMaterialState(store({ [OLD_CONFIG_LS_KEY]: old }));
    for (const mm of MATERIAL_THICKNESSES_MM) {
      expect(s.configs[String(mm)].spiral.channelWidthMm).toBe(0.99);
    }
  });

  it("new key wins over old; restores active + per-thickness fields", () => {
    const state = {
      activeThicknessMm: 3,
      configs: { "3": { spiral: { ...SPIRAL_CUT.spiral, pitchMm: 0.07 } } },
    };
    const s = loadMaterialState(store({ [MATERIAL_LS_KEY]: JSON.stringify(state), [OLD_CONFIG_LS_KEY]: "{}" }));
    expect(s.activeThicknessMm).toBe(3);
    expect(s.configs["3"].spiral.pitchMm).toBe(0.07);
    expect(s.configs["1"].spiral.pitchMm).toBe(SPIRAL_CUT.spiral.pitchMm);
  });

  it("round-trips through serialize", () => {
    const s = loadMaterialState(store({}));
    s.configs["2"].spiral.channelWidthMm = 0.6;
    const back = loadMaterialState(store({ [MATERIAL_LS_KEY]: serializeMaterialState(s) }));
    expect(back.configs["2"].spiral.channelWidthMm).toBe(0.6);
    expect(back.configs["1"].spiral.channelWidthMm).toBe(SPIRAL_CUT.spiral.channelWidthMm);
  });

  it("corrupt JSON → all-defaults fallback", () => {
    const s = loadMaterialState(store({ [MATERIAL_LS_KEY]: "{not json" }));
    expect(s.activeThicknessMm).toBe(1);
    expect(s.configs["1"].spiral.channelWidthMm).toBe(SPIRAL_CUT.spiral.channelWidthMm);
  });

  it("always enforces spiral.enabled = true", () => {
    const old = JSON.stringify({ spiral: { ...SPIRAL_CUT.spiral, enabled: false } });
    const s = loadMaterialState(store({ [OLD_CONFIG_LS_KEY]: old }));
    expect(s.configs["1"].spiral.enabled).toBe(true);
  });
});
