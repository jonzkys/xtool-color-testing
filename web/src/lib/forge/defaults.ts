// web/src/lib/forge/defaults.ts
import type { ForgeConfig } from "./types";

/** Sensible default profile per the spec. Layer ranges span 0..256. */
export const DEFAULT_CONFIG: ForgeConfig = {
  beamWidthMm: 0.05,
  sideMode: "outside",
  mmPerUnitOverride: null,
  seed: {
    enabled: true,
    widthMultiplier: 2, // ~2x beam width conditioning track
    layerCount: 3, // <= 5 enforced in UI
    outsideOnly: true,
  },
  perforate: {
    enabled: true,
    spacingMm: 2,
    cornerBoost: true,
    cornerAngleThresholdDeg: 35,
    pocketSizeMm: 0.2,
    outsideBias: true,
  },
  deepen: {
    groups: [
      { name: "CUT_03_DEEPEN_A_0_50_1X", fromLayer: 0, toLayer: 50, widthMultiplier: 1, enabled: true },
      { name: "CUT_04_DEEPEN_B_50_100_2X", fromLayer: 50, toLayer: 100, widthMultiplier: 2, enabled: true },
      { name: "CUT_05_DEEPEN_C_100_200_4X", fromLayer: 100, toLayer: 200, widthMultiplier: 4, enabled: true },
      { name: "CUT_06_DEEPEN_D_200_256_8X", fromLayer: 200, toLayer: 256, widthMultiplier: 8, enabled: true },
    ],
    outsideOnly: true,
  },
  clean: {
    enabled: true,
    offsetSelection: "walls",
    passes: 1,
  },
  stageParams: {},
};
