// web/src/lib/forge/materialState.ts
// Per-brass-thickness spiral configs for the Spiral Cut page. Each thickness
// owns a full ForgeConfig, persisted independently. Pure (storage passed in).
import type { ForgeConfig, MaterialThicknessMm } from "./types";
import { MATERIAL_THICKNESSES_MM } from "./types";
import { SPIRAL_CUT } from "./presets";

export const MATERIAL_LS_KEY = "spiral.material.v1";
export const OLD_CONFIG_LS_KEY = "spiral.config.v1";

export interface MaterialState {
  activeThicknessMm: MaterialThicknessMm;
  configs: Record<string, ForgeConfig>; // keyed by String(thicknessMm)
}

/** Floor a persisted (partial) config on SPIRAL_CUT, restoring only the fields
 *  the Spiral page mutates and enforcing the spiral-only invariants. Mirrors the
 *  page's previous loadConfig merge. */
function thicknessConfig(persisted: Partial<ForgeConfig> | undefined): ForgeConfig {
  const base = structuredClone(SPIRAL_CUT);
  if (!persisted) return base;
  return {
    ...base,
    beamWidthMm: persisted.beamWidthMm ?? base.beamWidthMm,
    mmPerUnitOverride: persisted.mmPerUnitOverride ?? base.mmPerUnitOverride,
    spiral: { ...base.spiral, ...(persisted.spiral ?? {}), enabled: true },
    stageParams: persisted.stageParams ?? base.stageParams,
    activePreset: "spiral",
  };
}

function allDefault(): Record<string, ForgeConfig> {
  const configs: Record<string, ForgeConfig> = {};
  for (const mm of MATERIAL_THICKNESSES_MM) configs[String(mm)] = structuredClone(SPIRAL_CUT);
  return configs;
}

/**
 * Load the per-thickness state from storage. Prefers the new key; otherwise
 * MIGRATES from the old single `spiral.config.v1` (seeding EVERY thickness from
 * it so a returning user keeps their tuning). Falls back to all-defaults on any
 * parse error. Side-effect free — the caller persists + removes the old key.
 */
export function loadMaterialState(getItem: (k: string) => string | null): MaterialState {
  try {
    const rawNew = getItem(MATERIAL_LS_KEY);
    if (rawNew) {
      const parsed = JSON.parse(rawNew) as {
        activeThicknessMm?: number;
        configs?: Record<string, Partial<ForgeConfig>>;
      };
      const configs: Record<string, ForgeConfig> = {};
      for (const mm of MATERIAL_THICKNESSES_MM) configs[String(mm)] = thicknessConfig(parsed.configs?.[String(mm)]);
      const active = (MATERIAL_THICKNESSES_MM as number[]).includes(parsed.activeThicknessMm as number)
        ? (parsed.activeThicknessMm as MaterialThicknessMm)
        : MATERIAL_THICKNESSES_MM[0];
      return { activeThicknessMm: active, configs };
    }
    // Migrate from the old single-config key.
    const rawOld = getItem(OLD_CONFIG_LS_KEY);
    const old = rawOld ? (JSON.parse(rawOld) as Partial<ForgeConfig>) : undefined;
    const configs: Record<string, ForgeConfig> = {};
    for (const mm of MATERIAL_THICKNESSES_MM) configs[String(mm)] = thicknessConfig(old);
    return { activeThicknessMm: MATERIAL_THICKNESSES_MM[0], configs };
  } catch {
    return { activeThicknessMm: MATERIAL_THICKNESSES_MM[0], configs: allDefault() };
  }
}

export function serializeMaterialState(s: MaterialState): string {
  return JSON.stringify(s);
}
