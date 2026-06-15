// web/src/lib/forge/materialState.ts
// Per-brass-thickness spiral configs for the Spiral Cut page. Each thickness
// owns a full ForgeConfig, persisted independently. Pure (storage passed in).
import type { ForgeConfig, MaterialThicknessMm } from "./types";
import { MATERIAL_THICKNESSES_MM } from "./types";
import { SPIRAL_CUT, THICKNESS_DEFAULTS } from "./presets";

export const MATERIAL_LS_KEY = "spiral.material.v2";
export const OLD_CONFIG_LS_KEY = "spiral.config.v1";
/** Pre-v2 material key, discarded on load: its per-thickness configs predate the
 *  baked-in per-thickness baseline defaults, so a persisted placeholder baseline
 *  would otherwise mask the new THICKNESS_DEFAULTS. The caller removes it. */
export const LEGACY_MATERIAL_LS_KEY = "spiral.material.v1";

export interface MaterialState {
  activeThicknessMm: MaterialThicknessMm;
  configs: Record<string, ForgeConfig>; // keyed by String(thicknessMm)
}

/** Floor a persisted (partial) config on SPIRAL_CUT, restoring only the fields
 *  the Spiral page mutates and enforcing the spiral-only invariants. Mirrors the
 *  page's previous loadConfig merge. */
function thicknessConfig(persisted: Partial<ForgeConfig> | undefined, mm: MaterialThicknessMm): ForgeConfig {
  const base = structuredClone(SPIRAL_CUT);
  // Per-thickness preset baseline (the Studio incise reference for that brass)
  // sits between the SPIRAL_CUT default and any persisted user edits.
  const def = THICKNESS_DEFAULTS[String(mm)]?.baselineIncise;
  if (def) base.spiral.baselineIncise = { ...base.spiral.baselineIncise, ...def };
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
  for (const mm of MATERIAL_THICKNESSES_MM) configs[String(mm)] = thicknessConfig(undefined, mm);
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
      for (const mm of MATERIAL_THICKNESSES_MM) configs[String(mm)] = thicknessConfig(parsed.configs?.[String(mm)], mm);
      const active = (MATERIAL_THICKNESSES_MM as number[]).includes(parsed.activeThicknessMm as number)
        ? (parsed.activeThicknessMm as MaterialThicknessMm)
        : MATERIAL_THICKNESSES_MM[0];
      return { activeThicknessMm: active, configs };
    }
    // Migrate from the old single-config key.
    const rawOld = getItem(OLD_CONFIG_LS_KEY);
    const old = rawOld ? (JSON.parse(rawOld) as Partial<ForgeConfig>) : undefined;
    const configs: Record<string, ForgeConfig> = {};
    for (const mm of MATERIAL_THICKNESSES_MM) configs[String(mm)] = thicknessConfig(old, mm);
    return { activeThicknessMm: MATERIAL_THICKNESSES_MM[0], configs };
  } catch {
    return { activeThicknessMm: MATERIAL_THICKNESSES_MM[0], configs: allDefault() };
  }
}

export function serializeMaterialState(s: MaterialState): string {
  return JSON.stringify(s);
}
