// web/src/lib/forge/defaults.ts
import type { ForgeConfig } from "./types";

/** Sensible default profile per the spec. Layer ranges span 0..256. */
export const DEFAULT_CONFIG: ForgeConfig = {
  beamWidthMm: 0.03, // F2 Ultra spot ≈ 30µm
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
      { name: "CUT_03_DEEPEN_A_50_1X", toLayer: 50, widthMultiplier: 1, enabled: true },
      { name: "CUT_04_DEEPEN_B_100_2X", toLayer: 100, widthMultiplier: 2, enabled: true, copyParamsFromFirst: true },
      { name: "CUT_05_DEEPEN_C_200_4X", toLayer: 200, widthMultiplier: 4, enabled: true, copyParamsFromFirst: true },
      { name: "CUT_06_DEEPEN_D_256_8X", toLayer: 256, widthMultiplier: 8, enabled: true, copyParamsFromFirst: true },
    ],
    outsideOnly: true,
  },
  clean: {
    enabled: true,
    offsetSelection: "walls",
    passes: 1,
  },
  stageParams: {},
  optimizeScanAngle: false,
};
