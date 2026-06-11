// Named staged-strategy presets. LEAN ships as the default (lib/forge/defaults.ts);
// AGGRESSIVE preserves the original deep 1/2/4/8 schedule verbatim.
import type { ForgeConfig } from "./types";

const COMMON = {
  beamWidthMm: 0.03,
  sideMode: "outside" as const,
  mmPerUnitOverride: null,
  stageParams: {},
  optimizeScanAngle: false,
  manualScanAngleDeg: null,
  timeBudgetX: 1.5,
  spiral: {
    enabled: false, channelWidthMm: 0.8, pitchMm: 0.04, side: "outside" as const,
    minChannelMm: 0.4, passes: 500, focusStepMm: 0.06, focusIntervalPasses: 10,
  },
};

/** LEAN — one main full-depth incise + shallow seed/clean, sparse perforation,
 *  with a one-click disabled relief group. Targets ≈ 1.1–1.4× a plain incise. */
export const LEAN: ForgeConfig = {
  ...COMMON,
  activePreset: "lean",
  seed: { enabled: true, widthMultiplier: 2, layerCount: 3, outsideOnly: true },
  perforate: { enabled: true, spacingMm: 4, cornerBoost: true, cornerAngleThresholdDeg: 35, pocketSizeMm: 0.2, outsideBias: true, layerCount: 2, shape: "slot", nearGap: true, gapThresholdMm: 1.5, slotLengthMm: 0.8 },
  deepen: {
    groups: [
      { name: "CUT_03_MAIN", toLayer: 256, widthMultiplier: 1, enabled: true },
      { name: "CUT_04_WIDEN", toLayer: 64, widthMultiplier: 2, enabled: false, copyParamsFromFirst: true },
    ],
    outsideOnly: true,
  },
  clean: { enabled: true, offsetSelection: "walls", passes: 1, layerCount: 10 },
};

/** AGGRESSIVE — the original deep, progressively-widening schedule. */
export const AGGRESSIVE: ForgeConfig = {
  ...COMMON,
  activePreset: "aggressive",
  timeBudgetX: null,
  seed: { enabled: true, widthMultiplier: 2, layerCount: 3, outsideOnly: true },
  perforate: { enabled: true, spacingMm: 2, cornerBoost: true, cornerAngleThresholdDeg: 35, pocketSizeMm: 0.2, outsideBias: true, layerCount: 2, shape: "pocket", nearGap: false, gapThresholdMm: 1.5, slotLengthMm: 0.8 },
  deepen: {
    groups: [
      { name: "CUT_03_DEEPEN_A_50_1X", toLayer: 50, widthMultiplier: 1, enabled: true },
      { name: "CUT_04_DEEPEN_B_100_2X", toLayer: 100, widthMultiplier: 2, enabled: true, copyParamsFromFirst: true },
      { name: "CUT_05_DEEPEN_C_200_4X", toLayer: 200, widthMultiplier: 4, enabled: true, copyParamsFromFirst: true },
      { name: "CUT_06_DEEPEN_D_256_8X", toLayer: 256, widthMultiplier: 8, enabled: true, copyParamsFromFirst: true },
    ],
    outsideOnly: true,
  },
  clean: { enabled: true, offsetSelection: "walls", passes: 1, layerCount: 10 },
};

/** SPIRAL_CUT — standalone continuous-spiral cut. All incise stages off; one
 *  flat-mode VECTOR_CUTTING strategy with the confirmed 3mm-brass recipe. */
export const SPIRAL_CUT: ForgeConfig = {
  ...COMMON,
  activePreset: "spiral",
  timeBudgetX: null,
  seed: { enabled: false, widthMultiplier: 2, layerCount: 3, outsideOnly: true },
  perforate: { enabled: false, spacingMm: 4, cornerBoost: false, cornerAngleThresholdDeg: 35, pocketSizeMm: 0.2, outsideBias: true, layerCount: 2, shape: "slot", nearGap: false, gapThresholdMm: 1.5, slotLengthMm: 0.8 },
  deepen: { groups: [], outsideOnly: true },
  clean: { enabled: false, offsetSelection: "walls", passes: 1, layerCount: 10 },
  spiral: {
    enabled: true, channelWidthMm: 0.8, pitchMm: 0.04, side: "outside",
    minChannelMm: 0.4, passes: 500, focusStepMm: 0.06, focusIntervalPasses: 10,
  },
  stageParams: {
    CUT_08_SPIRAL: { power: 100, speed: 1500, frequency: 65, pulseWidth: 80, laser: "red" },
  },
};

export const PRESETS = { lean: LEAN, aggressive: AGGRESSIVE, spiral: SPIRAL_CUT } as const;
export type PresetId = keyof typeof PRESETS;
